"""System tray icon (build plan §10 Stage 8).

Entirely optional: if pystray is unavailable or no tray exists (a service
session, a headless VM), the agent runs exactly as before without one.
"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
from typing import Any, Callable

from PIL import Image, ImageDraw

from config import AgentConfig, config_dir, log_path

log = logging.getLogger(__name__)

_COLOURS = {
    "online": (34, 197, 94),
    "live": (99, 102, 241),
    "offline": (161, 161, 170),
    "connecting": (245, 158, 11),
    "pairing": (245, 158, 11),
}


def _icon_image(status: str) -> Image.Image:
    """A filled circle in the status colour, drawn at 4x and downsampled so the
    edge is smooth at tray size."""
    scale = 4
    size = 64 * scale
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    colour = _COLOURS.get(status, _COLOURS["offline"])
    draw.ellipse((4 * scale, 4 * scale, size - 4 * scale, size - 4 * scale),
                 fill=(*colour, 255))
    return image.resize((64, 64), Image.LANCZOS)


class TrayIcon:
    def __init__(
        self,
        status_fn: Callable[[], str],
        config: AgentConfig,
        claim_fn: Callable[[], Any] | None = None,
    ) -> None:
        self._status_fn = status_fn
        self._config = config
        # Returns the outstanding pairing claim, or None. This is the only way
        # to finish pairing on a PC started by Task Scheduler, where nothing is
        # printed anywhere a person will look.
        self._claim_fn = claim_fn or (lambda: None)
        self._icon = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self) -> None:
        import pystray  # imported here so a missing package degrades quietly

        menu = pystray.Menu(
            pystray.MenuItem(lambda _item: f"Status: {self._status_fn()}", None,
                             enabled=False),
            # Both pairing entries hide themselves once the claim is answered,
            # so the menu is unchanged in normal operation.
            pystray.MenuItem(
                lambda _item: f"Approval code: {self._claim_code()}",
                None,
                enabled=False,
                visible=lambda _item: self._claim_fn() is not None,
            ),
            pystray.MenuItem(
                "Finish pairing…",
                self._open_approval,
                visible=lambda _item: self._claim_fn() is not None,
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open console", self._open_console),
            pystray.MenuItem("Open config folder", self._open_config_dir),
            pystray.MenuItem("View log", self._open_log),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._quit),
        )

        self._icon = pystray.Icon(
            "DeskWarrant",
            _icon_image(self._status_fn()),
            "DeskWarrant",
            menu,
        )

        self._thread = threading.Thread(
            target=self._icon.run, name="dw-tray", daemon=True
        )
        self._thread.start()

        refresher = threading.Thread(
            target=self._refresh_loop, name="dw-tray-refresh", daemon=True
        )
        refresher.start()

    def _refresh_loop(self) -> None:
        last = None
        while not self._stop.wait(3.0):
            status = self._status_fn()
            if status == last or self._icon is None:
                continue
            last = status
            try:
                self._icon.icon = _icon_image(status)
                self._icon.title = f"DeskWarrant - {status}"
            except Exception:  # noqa: BLE001
                pass

    # ---------- menu actions ----------

    def _claim_code(self) -> str:
        claim = self._claim_fn()
        return claim.match_code if claim is not None else ""

    def _open_approval(self, *_args: object) -> None:
        claim = self._claim_fn()
        if claim is not None:
            _open(claim.approve_url)

    def _open_console(self, *_args: object) -> None:
        if self._config.console_url:
            _open(self._config.console_url)

    def _open_config_dir(self, *_args: object) -> None:
        _open(str(config_dir()))

    def _open_log(self, *_args: object) -> None:
        _open(str(log_path()))

    def _quit(self, *_args: object) -> None:
        self.stop()
        os._exit(0)  # noqa: PLC0415 - the asyncio loop is on another thread

    def stop(self) -> None:
        self._stop.set()
        if self._icon is not None:
            try:
                self._icon.stop()
            except Exception:  # noqa: BLE001
                pass


def _open(target: str) -> None:
    try:
        if target.startswith("http"):
            subprocess.Popen(["cmd", "/c", "start", "", target], shell=False)
        else:
            os.startfile(target)  # noqa: S606
    except OSError as exc:
        log.debug("Could not open %s: %s", target, exc)
