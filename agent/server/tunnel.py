"""Cloudflare Tunnel supervisor (migration §5.2).

`cloudflared` runs ON DEMAND, only while a view session is alive. That is the
whole security posture of the data plane: with no session there is no process,
and the public hostname resolves to nothing. A permanently-running tunnel would
leave the PC reachable from the internet 24/7 for the sake of saving the 3-6
seconds this costs at session start.

The tunnel is outbound-only -- it dials Cloudflare's edge rather than listening
-- so there is no NAT traversal, no ICE, and no relay quota to run out of.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import sys
import time
from enum import Enum
from pathlib import Path

import httpx

from config import ViewConfig

log = logging.getLogger(__name__)

# The edge has to accept the connection and DNS has to propagate to the point
# where the hostname routes. 3-6s is typical; 20s means something is wrong.
STARTUP_TIMEOUT_S = 20.0
HEALTH_POLL_INTERVAL_S = 0.75
HEALTH_TIMEOUT_S = 5.0

# Windows kills politely first, then not.
TERMINATE_GRACE_S = 5.0


class TunnelState(str, Enum):
    """Mirrors the console's TunnelState enum."""

    STARTING = "STARTING"
    UP = "UP"
    FAILED = "FAILED"
    STOPPED = "STOPPED"


class TunnelError(Exception):
    """The tunnel could not be established or did not stay up."""


def resolve_binary() -> str | None:
    """Locate `cloudflared`.

    Checked in order: an explicit override, the directory the agent was frozen
    into (PyInstaller bundles the binary alongside the exe), then PATH.
    """
    override = os.environ.get("DESKWARRANT_CLOUDFLARED")
    if override and Path(override).is_file():
        return override

    # sys._MEIPASS is the onefile extraction dir; sys.executable's parent is
    # where the exe itself lives. Check both -- which one holds the binary
    # depends on how the spec adds it.
    candidates: list[Path] = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(Path(meipass) / "cloudflared.exe")
    if getattr(sys, "frozen", False):
        candidates.append(Path(sys.executable).parent / "cloudflared.exe")
    candidates.append(Path(__file__).resolve().parent.parent / "cloudflared.exe")

    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)

    return shutil.which("cloudflared")


class TunnelSupervisor:
    """Owns the `cloudflared` subprocess for one device.

    Start and stop are idempotent: the poll loop calls them on every tick based
    on whether a view session is active, so they must be cheap to call when
    already in the requested state.
    """

    def __init__(self, config: ViewConfig) -> None:
        self._config = config
        self._process: subprocess.Popen[bytes] | None = None
        self._state = TunnelState.STOPPED
        self._error: str | None = None
        self._starting: asyncio.Task[None] | None = None
        self._restarted_once = False

    # ---------- observable state ----------

    @property
    def state(self) -> TunnelState:
        return self._state

    @property
    def error(self) -> str | None:
        return self._error

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    # ---------- lifecycle ----------

    async def ensure_started(self) -> None:
        """Bring the tunnel up if it is not already coming up or running."""
        if self._state in (TunnelState.UP, TunnelState.STARTING):
            if self._starting is not None and not self._starting.done():
                return
            if self._state is TunnelState.UP and self.running:
                return

        if self._state is TunnelState.FAILED and self._starting is not None:
            # A failure stays sticky until the browser explicitly stops and
            # restarts the session, so a hopeless config is not retried in a
            # tight loop for as long as the tab is open.
            return

        self._restarted_once = False
        self._starting = asyncio.ensure_future(self._start())

    async def stop(self) -> None:
        """Kill the tunnel and return to STOPPED."""
        if self._starting is not None:
            self._starting.cancel()
            try:
                await self._starting
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._starting = None

        self._terminate()
        self._state = TunnelState.STOPPED
        self._error = None
        self._restarted_once = False

    async def supervise(self) -> None:
        """Called each poll tick while a session is active.

        Restarts the tunnel once if `cloudflared` died on its own, then gives
        up and reports FAILED rather than flapping indefinitely.
        """
        if self._state is not TunnelState.UP:
            return
        if self.running:
            return

        code = self._process.poll() if self._process else None
        log.warning("cloudflared exited unexpectedly (code %s)", code)

        if self._restarted_once:
            self._fail(f"cloudflared exited unexpectedly (code {code})")
            return

        self._restarted_once = True
        self._state = TunnelState.STARTING
        self._starting = asyncio.ensure_future(self._start(is_restart=True))

    # ---------- internals ----------

    async def _start(self, is_restart: bool = False) -> None:
        self._state = TunnelState.STARTING
        self._error = None

        if not self._config.configured:
            self._fail(
                "No tunnel configured for this PC. Run the one-time cloudflared "
                "setup and put tunnelName and hostname in config.json."
            )
            return

        binary = resolve_binary()
        if binary is None:
            self._fail(
                "cloudflared was not found. Install it and make sure it is on "
                "PATH, or set DESKWARRANT_CLOUDFLARED to its full path."
            )
            return

        self._terminate()  # never leave an orphan behind

        command = [
            binary,
            "tunnel",
            "--no-autoupdate",
            "run",
            self._config.tunnel_name,
        ]
        log.info(
            "Starting tunnel '%s' -> %s%s",
            self._config.tunnel_name,
            self._config.hostname,
            " (restart)" if is_restart else "",
        )

        try:
            self._process = subprocess.Popen(  # noqa: S603
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                # No console window when the agent runs from Task Scheduler.
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except OSError as exc:
            self._fail(f"Could not launch cloudflared: {exc}")
            return

        try:
            await self._await_health()
        except asyncio.CancelledError:
            self._terminate()
            raise
        except TunnelError as exc:
            self._terminate()
            self._fail(str(exc))
            return

        self._state = TunnelState.UP
        self._error = None
        log.info("Tunnel is up at https://%s", self._config.hostname)

    async def _await_health(self) -> None:
        """Poll /health THROUGH the public hostname until it answers.

        Probing the local port would only prove the agent's own server is up.
        Going through the hostname is what proves the whole path -- edge, DNS,
        and tunnel -- is actually carrying traffic, which is what the browser
        is about to depend on.
        """
        deadline = time.monotonic() + STARTUP_TIMEOUT_S
        url = self._config.health_url
        last_detail = "no response"

        async with httpx.AsyncClient(timeout=HEALTH_TIMEOUT_S) as client:
            while time.monotonic() < deadline:
                if self._process is not None and self._process.poll() is not None:
                    raise TunnelError(
                        f"cloudflared exited during startup "
                        f"(code {self._process.returncode})"
                    )
                try:
                    response = await client.get(url)
                    if response.status_code == 200:
                        return
                    last_detail = f"HTTP {response.status_code}"
                except httpx.HTTPError as exc:
                    last_detail = type(exc).__name__

                await asyncio.sleep(HEALTH_POLL_INTERVAL_S)

        raise TunnelError(
            f"The tunnel did not come up within {STARTUP_TIMEOUT_S:.0f}s "
            f"({last_detail}). Check the tunnel's DNS route."
        )

    def _fail(self, message: str) -> None:
        log.error("Tunnel failed: %s", message)
        self._state = TunnelState.FAILED
        self._error = message[:500]

    def _terminate(self) -> None:
        process = self._process
        self._process = None
        if process is None or process.poll() is not None:
            return

        try:
            process.terminate()
            process.wait(timeout=TERMINATE_GRACE_S)
        except subprocess.TimeoutExpired:
            log.warning("cloudflared ignored terminate; killing it")
            try:
                process.kill()
                process.wait(timeout=TERMINATE_GRACE_S)
            except Exception:  # noqa: BLE001
                log.exception("Could not kill cloudflared")
        except Exception:  # noqa: BLE001
            log.exception("Could not terminate cloudflared")
        else:
            log.info("Tunnel stopped")
