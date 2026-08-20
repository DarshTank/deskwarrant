"""Local live-view server (migration §5.1).

Bound to 127.0.0.1 and nothing else. `cloudflared` connects to it over the
loopback interface, so there is never a reason to listen wider -- binding
0.0.0.0 would publish the screen stream to every machine on the LAN.

    GET  /health            200, used to confirm the tunnel is actually carrying
                            traffic before the browser tries to connect
    WS   /stream?token=...  the single live-view channel

Over the socket:

    agent  -> browser   binary frames, the same wire format as before
    browser -> agent    JSON input and control messages, unchanged

Only the transport underneath changed. `capture.py` and `input.py` are the same
files that ran under WebRTC.
"""

from __future__ import annotations

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Awaitable, Callable

from aiohttp import WSMsgType, web

from config import AgentConfig

from .capture import FrameEncoder, ScreenGrabber
from .input import InputInjector

log = logging.getLogger(__name__)

# Never queue frames: when the link is congested, dropping a frame beats growing
# a backlog of stale ones. Same rule and same threshold as the DataChannel
# version -- only the property being read changed.
BUFFER_HIGH_WATER_BYTES = 1_000_000

# Close code for a rejected token. A plain HTTP 401 on the upgrade surfaces in
# the browser as an opaque 1006, indistinguishable from the network being down;
# a 4xxx close code lets the UI say "not authorised" and mean it.
CLOSE_UNAUTHORIZED = 4401

TokenVerifier = Callable[[str], Awaitable[bool]]


class ViewServer:
    """The agent's loopback HTTP/WebSocket server.

    One live socket at a time: a second connection supersedes the first, which
    matches the product (one browser tab controlling one PC) and keeps exactly
    one capture loop running.
    """

    def __init__(self, config: AgentConfig, verify_token: TokenVerifier) -> None:
        self._config = config
        self._verify_token = verify_token
        self._runner: web.AppRunner | None = None
        self._active: web.WebSocketResponse | None = None
        self._injector = InputInjector({})

        # Owned by the capture loop but declared here: a keyframe request can
        # arrive on the read loop before the capture task has had its first
        # tick, and it must not race against attribute creation.
        self._encoder = FrameEncoder(
            tile_size=config.view.tile_size, quality=config.view.webp_quality
        )
        self._grabber: ScreenGrabber | None = None
        self._force_keyframe = True

    @property
    def has_viewer(self) -> bool:
        return self._active is not None and not self._active.closed

    # ---------- lifecycle ----------

    async def start(self) -> None:
        if self._runner is not None:
            return

        app = web.Application()
        app.router.add_get("/health", self._handle_health)
        app.router.add_get("/stream", self._handle_stream)

        runner = web.AppRunner(app, access_log=None)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", self._config.view.local_port)
        await site.start()
        self._runner = runner
        log.info("Live-view server listening on 127.0.0.1:%d", self._config.view.local_port)

    async def stop(self) -> None:
        await self.close_viewer()
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None
            log.info("Live-view server stopped")

    async def close_viewer(self) -> None:
        """Drop the current viewer, if any, and release held keys."""
        socket = self._active
        self._active = None
        if socket is not None and not socket.closed:
            try:
                await socket.close()
            except Exception:  # noqa: BLE001
                log.debug("Viewer socket close failed", exc_info=True)
        self._release_keys()

    # ---------- routes ----------

    async def _handle_health(self, _request: web.Request) -> web.Response:
        return web.Response(text="ok")

    async def _handle_stream(self, request: web.Request) -> web.WebSocketResponse:
        socket = web.WebSocketResponse(heartbeat=20.0, max_msg_size=4 * 1024 * 1024)
        await socket.prepare(request)

        token = request.query.get("token", "").strip()
        if not token or not await self._authorise(token):
            # Nothing is captured and no frame is written before this point.
            await socket.close(code=CLOSE_UNAUTHORIZED, message=b"invalid view token")
            return socket

        # A new viewer supersedes the old one.
        if self._active is not None and not self._active.closed:
            log.info("Replacing the active viewer")
            previous = self._active
            self._active = None
            try:
                await previous.close()
            except Exception:  # noqa: BLE001
                pass

        self._active = socket
        log.info("Viewer connected")

        capture = asyncio.ensure_future(self._capture_loop(socket, request))
        try:
            await self._read_loop(socket)
        finally:
            capture.cancel()
            try:
                await capture
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            if self._active is socket:
                self._active = None
            self._release_keys()
            log.info("Viewer disconnected")

        return socket

    async def _authorise(self, token: str) -> bool:
        """Verify the token with the console rather than against a local cache.

        The round trip costs one request per connect and buys instant
        revocation: delete the device or stop the session and any token still
        in a browser's hands is dead immediately.
        """
        try:
            return await self._verify_token(token)
        except Exception:  # noqa: BLE001
            log.exception("View token verification failed")
            return False

    # ---------- browser -> agent ----------

    async def _read_loop(self, socket: web.WebSocketResponse) -> None:
        async for message in socket:
            if message.type is WSMsgType.ERROR:
                log.warning("Viewer socket error: %s", socket.exception())
                break
            if message.type is not WSMsgType.TEXT:
                # Input and control are always JSON text; binary from the
                # browser is not part of the protocol.
                continue
            try:
                payload = json.loads(message.data)
            except (ValueError, TypeError):
                continue
            if isinstance(payload, dict):
                self._handle_client_message(payload)

    def _handle_client_message(self, payload: dict[str, Any]) -> None:
        if payload.get("t") == "c":
            event = payload.get("e")
            if event == "keyframe":
                self._force_keyframe = True
                self._encoder.reset()
            elif event == "quality":
                self._request_quality(payload.get("q"))
            return
        try:
            self._injector.handle(payload)
        except Exception:  # noqa: BLE001
            log.exception("Input injection failed")

    def _request_quality(self, requested: Any) -> None:
        """Honour a viewer's quality request. Fullscreen asks for more.

        Backpressure still has the last word: if the link cannot carry the
        higher quality, the very next congested tick steps it back down. That
        makes an over-optimistic request self-correcting rather than fatal.
        """
        if isinstance(requested, bool) or not isinstance(requested, (int, float)):
            return
        if self._encoder.set_quality(int(requested)):
            self._force_keyframe = True
            log.info("Viewer requested WebP quality %d", self._encoder.quality)

    def _release_keys(self) -> None:
        try:
            self._injector.release_all()
        except Exception:  # noqa: BLE001
            log.debug("Key release failed", exc_info=True)

    # ---------- agent -> browser ----------

    def _grab_and_encode(self, force_full: bool) -> bytes | None:
        if self._grabber is None:
            self._grabber = ScreenGrabber(self._config.monitor_index)
        # Grabbed before the image so the reported pointer never leads the
        # pixels it is drawn over by a whole frame.
        cursor = self._grabber.cursor()
        return self._encoder.encode(
            self._grabber.grab(), force_full=force_full, cursor=cursor
        )

    async def _capture_loop(
        self, socket: web.WebSocketResponse, request: web.Request
    ) -> None:
        view = self._config.view
        # A fresh encoder per session: quality may have been stepped down under
        # backpressure last time, and the tile hashes belong to a dead screen.
        self._encoder = FrameEncoder(
            tile_size=view.tile_size, quality=view.webp_quality
        )
        # mss instances are not thread-safe and must be used on the thread that
        # created them, so a single worker owns the handle for the whole session.
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dw-capture")

        loop = asyncio.get_running_loop()
        interval = 1.0 / max(1, min(view.target_fps, 30))
        # The first frame must be a keyframe or the browser has nothing to
        # composite later tile updates onto.
        self._force_keyframe = True

        try:
            while not socket.closed:
                started = loop.time()

                if self._buffered_bytes(request) > BUFFER_HIGH_WATER_BYTES:
                    self._encoder.lower_quality()
                    await asyncio.sleep(interval)
                    continue

                force_full = self._force_keyframe
                self._force_keyframe = False

                try:
                    frame = await loop.run_in_executor(
                        executor, self._grab_and_encode, force_full
                    )
                except Exception:  # noqa: BLE001
                    log.exception("Frame capture failed")
                    await asyncio.sleep(interval)
                    continue

                if frame:
                    try:
                        await socket.send_bytes(frame)
                    except (ConnectionResetError, RuntimeError):
                        break
                    except Exception:  # noqa: BLE001
                        log.exception("Frame send failed")
                        break

                elapsed = loop.time() - started
                await asyncio.sleep(max(0.0, interval - elapsed))
        except asyncio.CancelledError:
            raise
        finally:
            if self._grabber is not None:
                self._grabber.close()
                self._grabber = None
            executor.shutdown(wait=False)

    @staticmethod
    def _buffered_bytes(request: web.Request) -> int:
        """Bytes queued in the socket's write buffer.

        The agent-side equivalent of the browser's `bufferedAmount`.
        """
        transport = request.transport
        if transport is None:
            return 0
        try:
            return int(transport.get_write_buffer_size())
        except Exception:  # noqa: BLE001
            return 0
