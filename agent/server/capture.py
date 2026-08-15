"""Screen capture, tile diffing, and frame encoding (build plan §5).

Wire format, one binary DataChannel message per frame:

    [4 bytes: header length, uint32 LE]
    [header: JSON - {seq, ts, w, h, full, tiles: [{x,y,w,h,len}]}]
    [concatenated WebP tile payloads, in header order]

Only tiles whose content hash changed since the last frame are sent, so a
static desktop costs almost nothing.
"""

from __future__ import annotations

import io
import json
import logging
import struct
import time
from dataclasses import dataclass
from typing import Any

import mss
import xxhash
from PIL import Image

log = logging.getLogger(__name__)

# A full keyframe every 5s repairs any tile lost to a dropped message.
KEYFRAME_INTERVAL_S = 5.0


@dataclass
class Tile:
    x: int
    y: int
    w: int
    h: int
    payload: bytes


class ScreenGrabber:
    """Owns the mss handle.

    mss instances are not thread-safe and must be created on the thread that
    uses them, so this is constructed inside the capture worker.
    """

    def __init__(self, monitor_index: int = 0) -> None:
        self._sct = mss.mss()
        # monitors[0] is the union of all displays; monitors[1] is primary.
        # v1 is primary-only, but the index is plumbed through for later.
        self._monitor_number = monitor_index + 1
        if self._monitor_number >= len(self._sct.monitors):
            self._monitor_number = 1
        self.monitor = self._sct.monitors[self._monitor_number]

    @property
    def width(self) -> int:
        return int(self.monitor["width"])

    @property
    def height(self) -> int:
        return int(self.monitor["height"])

    def grab(self) -> Image.Image:
        shot = self._sct.grab(self.monitor)
        # mss hands back BGRA; "BGRX" tells PIL to ignore the alpha byte, which
        # is faster than converting a full RGBA image.
        return Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")

    def close(self) -> None:
        try:
            self._sct.close()
        except Exception:  # noqa: BLE001
            pass


class FrameEncoder:
    """Diffs successive frames at tile granularity and encodes changed tiles."""

    def __init__(self, tile_size: int = 128, quality: int = 70) -> None:
        self.tile_size = max(32, tile_size)
        self.quality = max(10, min(quality, 95))
        self._hashes: dict[tuple[int, int], int] = {}
        self._seq = 0
        self._last_keyframe = 0.0
        self._dimensions: tuple[int, int] | None = None

    def reset(self) -> None:
        """Force the next frame to be a full keyframe."""
        self._hashes.clear()
        self._last_keyframe = 0.0

    def lower_quality(self) -> bool:
        """Step quality down under backpressure. False once at the floor."""
        if self.quality <= 25:
            return False
        self.quality = max(25, self.quality - 15)
        log.info("Lowering WebP quality to %d under backpressure", self.quality)
        return True

    def encode(self, image: Image.Image, force_full: bool = False) -> bytes | None:
        """Return one wire-format frame, or None when nothing changed."""
        width, height = image.size

        # A resolution change invalidates every cached hash.
        if self._dimensions != (width, height):
            self._dimensions = (width, height)
            self._hashes.clear()
            force_full = True

        now = time.time()
        if now - self._last_keyframe >= KEYFRAME_INTERVAL_S:
            force_full = True

        tiles: list[Tile] = []
        step = self.tile_size

        for top in range(0, height, step):
            for left in range(0, width, step):
                right = min(left + step, width)
                bottom = min(top + step, height)
                box = (left, top, right, bottom)
                region = image.crop(box)

                digest = xxhash.xxh64(region.tobytes()).intdigest()
                key = (left, top)

                if not force_full and self._hashes.get(key) == digest:
                    continue
                self._hashes[key] = digest

                buffer = io.BytesIO()
                region.save(buffer, format="WEBP", quality=self.quality, method=0)
                tiles.append(
                    Tile(
                        x=left,
                        y=top,
                        w=right - left,
                        h=bottom - top,
                        payload=buffer.getvalue(),
                    )
                )

        if not tiles:
            return None

        if force_full:
            self._last_keyframe = now

        self._seq += 1
        header: dict[str, Any] = {
            "seq": self._seq,
            "ts": int(now * 1000),
            "w": width,
            "h": height,
            "full": force_full,
            "tiles": [
                {"x": t.x, "y": t.y, "w": t.w, "h": t.h, "len": len(t.payload)}
                for t in tiles
            ],
        }

        header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
        parts = [struct.pack("<I", len(header_bytes)), header_bytes]
        parts.extend(t.payload for t in tiles)
        return b"".join(parts)
