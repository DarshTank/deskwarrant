"""WebRTC data-plane session (build plan §4, §5, §6).

One session at a time. Frames go peer-to-peer, DTLS-encrypted, straight to the
user's browser -- the console never sees a pixel.
"""

from __future__ import annotations

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from aiortc import (
    RTCConfiguration,
    RTCIceServer,
    RTCPeerConnection,
    RTCSessionDescription,
)

from config import AgentConfig
from .capture import FrameEncoder, ScreenGrabber
from .input import InputInjector

log = logging.getLogger(__name__)

# Never queue frames: if the channel is congested, dropping a frame is always
# better than growing an unbounded backlog of stale ones (build plan §5).
BUFFER_HIGH_WATER_BYTES = 1_000_000

# The agent uses STUN only. The browser side supplies the TURN relay candidate,
# and one relay endpoint is enough to traverse symmetric NAT on either side.
STUN_URL = "stun:stun.cloudflare.com:3478"

CONNECT_TIMEOUT_S = 30.0


class RtcSession:
    def __init__(
        self,
        session_id: str,
        offer_sdp: str,
        config: AgentConfig,
        on_closed: Any = None,
    ) -> None:
        self.session_id = session_id
        self.offer_sdp = offer_sdp
        self.config = config
        self._on_closed = on_closed

        self._pc: RTCPeerConnection | None = None
        self._encoder = FrameEncoder(
            tile_size=config.capture.tile_size,
            quality=config.capture.webp_quality,
        )
        self._injector = InputInjector({})
        self._capture_task: asyncio.Task[None] | None = None
        # A single worker guarantees every mss call happens on the thread that
        # created the mss instance, which mss requires.
        self._executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="dw-capture"
        )
        self._grabber: ScreenGrabber | None = None
        self._force_keyframe = True
        self._closed = asyncio.Event()

    # ---------- lifecycle ----------

    async def answer(self) -> str:
        """Apply the offer and return a COMPLETE answer SDP.

        aiortc gathers ICE to completion inside setLocalDescription, so the
        returned SDP already carries every candidate -- which is precisely the
        non-trickle contract the console's signalling assumes (§5).
        """
        pc = RTCPeerConnection(
            RTCConfiguration(iceServers=[RTCIceServer(urls=STUN_URL)])
        )
        self._pc = pc

        @pc.on("datachannel")
        def on_datachannel(channel: Any) -> None:  # noqa: ANN401
            log.info("DataChannel '%s' opened", channel.label)
            self._attach_channel(channel)

        @pc.on("connectionstatechange")
        async def on_state_change() -> None:
            log.info("RTC connection state: %s", pc.connectionState)
            if pc.connectionState in ("failed", "closed", "disconnected"):
                await self.close()

        await pc.setRemoteDescription(
            RTCSessionDescription(sdp=self.offer_sdp, type="offer")
        )
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        assert pc.localDescription is not None
        return pc.localDescription.sdp

    async def close(self) -> None:
        if self._closed.is_set():
            return
        self._closed.set()

        if self._capture_task:
            self._capture_task.cancel()
            try:
                await self._capture_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._capture_task = None

        # Release any key the user was holding when the tab closed.
        try:
            self._injector.release_all()
        except Exception:  # noqa: BLE001
            pass

        if self._grabber is not None:
            self._grabber.close()
            self._grabber = None

        self._executor.shutdown(wait=False)

        if self._pc is not None:
            try:
                await self._pc.close()
            except Exception:  # noqa: BLE001
                pass
            self._pc = None

        log.info("RTC session %s closed", self.session_id)
        if self._on_closed is not None:
            self._on_closed(self.session_id)

    async def wait_closed(self) -> None:
        await self._closed.wait()

    # ---------- channel ----------

    def _attach_channel(self, channel: Any) -> None:  # noqa: ANN401
        @channel.on("message")
        def on_message(message: Any) -> None:  # noqa: ANN401
            # Only control/input travels browser -> agent, and it is always JSON.
            if isinstance(message, bytes):
                return
            try:
                payload = json.loads(message)
            except (ValueError, TypeError):
                return
            self._handle_client_message(payload)

        @channel.on("close")
        def on_close() -> None:
            log.info("DataChannel closed")
            asyncio.ensure_future(self.close())

        self._capture_task = asyncio.ensure_future(self._capture_loop(channel))

    def _handle_client_message(self, payload: dict[str, Any]) -> None:
        kind = payload.get("t")
        if kind == "c":
            if payload.get("e") == "keyframe":
                self._force_keyframe = True
                self._encoder.reset()
            return
        try:
            self._injector.handle(payload)
        except Exception:  # noqa: BLE001
            log.exception("Input injection failed")

    # ---------- capture ----------

    def _grab_and_encode(self, force_full: bool) -> bytes | None:
        if self._grabber is None:
            self._grabber = ScreenGrabber(self.config.monitor_index)
        image = self._grabber.grab()
        return self._encoder.encode(image, force_full=force_full)

    async def _capture_loop(self, channel: Any) -> None:  # noqa: ANN401
        loop = asyncio.get_running_loop()
        target_fps = max(1, min(self.config.capture.target_fps, 30))
        interval = 1.0 / target_fps

        # The first frame must be a full keyframe or the browser has nothing
        # to composite subsequent tile updates onto.
        self._force_keyframe = True

        try:
            while not self._closed.is_set():
                started = loop.time()

                if channel.readyState != "open":
                    break

                # Backpressure: skip the frame and step quality down rather
                # than queueing (build plan §5).
                buffered = getattr(channel, "bufferedAmount", 0) or 0
                if buffered > BUFFER_HIGH_WATER_BYTES:
                    self._encoder.lower_quality()
                    await asyncio.sleep(interval)
                    continue

                force_full = self._force_keyframe
                self._force_keyframe = False

                try:
                    frame = await loop.run_in_executor(
                        self._executor, self._grab_and_encode, force_full
                    )
                except Exception:  # noqa: BLE001
                    log.exception("Frame capture failed")
                    await asyncio.sleep(interval)
                    continue

                if frame:
                    try:
                        channel.send(frame)
                    except Exception:  # noqa: BLE001
                        log.exception("Frame send failed")
                        break

                elapsed = loop.time() - started
                await asyncio.sleep(max(0.0, interval - elapsed))
        except asyncio.CancelledError:
            raise
        finally:
            log.debug("Capture loop for %s ended", self.session_id)
