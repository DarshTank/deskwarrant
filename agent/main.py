"""DeskWarrant host agent -- supervisor loop (build plan §10 Stage 1, §13).

Run from source:   python main.py
Force re-pairing:  python main.py --pair
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import logging.handlers
import sys
import time
from typing import Any

import credentials
import pairing
from config import AGENT_VERSION, AgentConfig, config_dir, log_path
from tools import ToolError, dispatch
from transport import AuthRevoked, Transport, TransportError
from watch.rules import EVALUATION_INTERVAL_S, WatchEvaluator

log = logging.getLogger("deskwarrant")


def setup_logging(verbose: bool = False) -> None:
    config_dir().mkdir(parents=True, exist_ok=True)
    level = logging.DEBUG if verbose else logging.INFO

    root = logging.getLogger()
    root.setLevel(level)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(
        logging.Formatter("%(asctime)s  %(levelname)-7s %(message)s", "%H:%M:%S")
    )
    root.addHandler(console_handler)

    file_handler = logging.handlers.RotatingFileHandler(
        log_path(), maxBytes=1_000_000, backupCount=2, encoding="utf-8"
    )
    file_handler.setFormatter(
        logging.Formatter("%(asctime)s  %(levelname)-7s %(name)s  %(message)s")
    )
    root.addHandler(file_handler)

    # These are extremely chatty at INFO and drown out the agent's own log.
    for noisy in ("aiohttp", "aiohttp.access", "httpx", "httpcore", "comtypes"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


class Agent:
    """Owns the poll loop, job execution, watch evaluation, and live view."""

    def __init__(self, config: AgentConfig, transport: Transport) -> None:
        self.config = config
        self.transport = transport
        self.evaluator = WatchEvaluator(config)
        self.config_version = 0
        self._last_watch_run = 0.0
        self._status = "connecting"

        # Live view. Both are created lazily on the first session so an agent
        # that never opens live view never imports mss, Pillow, or aiohttp.
        self._view_server: Any = None
        self._tunnel: Any = None
        self._reported_tunnel_state: str | None = None
        self._view_session_id: str | None = None

    @property
    def status(self) -> str:
        return self._status

    # ---------- jobs ----------

    async def _run_job(self, job: dict[str, Any]) -> None:
        job_id = job.get("id")
        tool_name = job.get("toolName", "")
        args = job.get("args") or {}
        if not job_id:
            return

        log.info("Job %s: %s(%s)", job_id[:8], tool_name, args)
        started = time.monotonic()

        try:
            result = await dispatch(tool_name, args, self.config)
        except ToolError as exc:
            log.warning("Job %s failed: %s", job_id[:8], exc)
            await self._report(job_id, error=str(exc))
            return
        except Exception as exc:  # noqa: BLE001
            log.exception("Job %s crashed", job_id[:8])
            await self._report(job_id, error=f"{type(exc).__name__}: {exc}")
            return

        elapsed = time.monotonic() - started
        log.info("Job %s done in %.2fs", job_id[:8], elapsed)
        await self._report(job_id, result=result)

    async def _report(
        self, job_id: str, *, result: Any = None, error: str | None = None
    ) -> None:
        try:
            await self.transport.post_job_result(job_id, result=result, error=error)
        except TransportError as exc:
            # The console will expire the job on its own; losing the result is
            # recoverable, crashing the agent is not.
            log.error("Could not report job %s: %s", job_id[:8], exc)

    # ---------- live view ----------

    async def _sync_view(self, active: bool, session_id: str | None) -> None:
        """Match the local live-view stack to the console's session state.

        Called every poll, so both directions must be cheap when already in the
        requested state.
        """
        if not active:
            await self._stop_view()
            return

        # A new session id means a different browser session, even if we never
        # observed the gap between them. Forget what was reported so the fresh
        # session hears the tunnel's state instead of waiting on a stale row.
        if session_id != self._view_session_id:
            self._view_session_id = session_id
            self._reported_tunnel_state = None

        await self._start_view()

    async def _start_view(self) -> None:
        # Imported lazily: aiohttp, mss, and Pillow are only needed once a
        # browser actually asks to watch.
        if self._view_server is None:
            from server.app import ViewServer
            from server.tunnel import TunnelSupervisor

            self._view_server = ViewServer(
                self.config, self.transport.verify_view_token
            )
            self._tunnel = TunnelSupervisor(self.config.view)

        try:
            await self._view_server.start()
        except OSError as exc:
            log.error("Could not bind the live-view server: %s", exc)
            await self._report_tunnel_state(
                "FAILED", error=f"Local port {self.config.view.local_port} is in use."
            )
            return

        await self._tunnel.ensure_started()
        await self._tunnel.supervise()
        await self._report_tunnel_state(
            self._tunnel.state.value, error=self._tunnel.error
        )
        self._status = "live" if self._tunnel.state.value == "UP" else "online"

    async def _stop_view(self) -> None:
        if self._tunnel is None and self._view_server is None:
            return

        if self._tunnel is not None:
            await self._tunnel.stop()
        if self._view_server is not None:
            await self._view_server.stop()

        # STOPPED is reported once per session, not on every idle poll.
        await self._report_tunnel_state("STOPPED")
        self._view_session_id = None
        self._status = "online"

    async def shutdown(self) -> None:
        """Tear the live-view stack down on exit.

        Best effort and never raises: this runs on the way out, including after
        a revoked-device error, and must not mask the original failure.
        """
        try:
            if self._tunnel is not None:
                await self._tunnel.stop()
            if self._view_server is not None:
                await self._view_server.stop()
        except Exception:  # noqa: BLE001
            log.exception("Live-view shutdown failed")

    async def _report_tunnel_state(
        self, state: str, error: str | None = None
    ) -> None:
        if state == self._reported_tunnel_state:
            return
        self._reported_tunnel_state = state
        try:
            await self.transport.post_view_state(
                state,
                tunnel_error=error,
                # Sent every time: this is how the console learns the device's
                # hostname after the one-time cloudflared setup (§8).
                tunnel_hostname=self.config.view.hostname or None,
                tunnel_name=self.config.view.tunnel_name or None,
            )
        except TransportError as exc:
            # A lost status update self-corrects on the next transition; the
            # browser will meanwhile see the session time out.
            log.error("Could not report tunnel state: %s", exc)

    # ---------- watch ----------

    async def _run_watch(self) -> None:
        now = time.monotonic()
        if now - self._last_watch_run < EVALUATION_INTERVAL_S:
            return
        self._last_watch_run = now

        if self.evaluator.rule_count == 0:
            return

        loop = asyncio.get_running_loop()
        events = await loop.run_in_executor(None, self.evaluator.evaluate)
        if not events:
            return

        log.info("Watch fired %d event(s)", len(events))
        try:
            await self.transport.post_events(events)
        except TransportError as exc:
            log.error("Could not post watch events: %s", exc)

    # ---------- main loop ----------

    async def run(self) -> None:
        log.info("DeskWarrant agent %s started", AGENT_VERSION)
        log.info("Console: %s", self.config.console_url)

        while True:
            try:
                poll = await self.transport.poll(self.config_version)
            except AuthRevoked:
                raise
            except TransportError:
                self._status = "offline"
                await self.transport.sleep_backoff()
                continue

            self.transport.reset_backoff()

            if poll.watch_rules is not None:
                self.evaluator.set_rules(poll.watch_rules)
            self.config_version = poll.config_version

            await self._sync_view(poll.view_active, poll.view_session_id)

            did_work = False
            if poll.jobs:
                did_work = True
                # Run the batch concurrently: the console dispatches a turn's
                # read tools together precisely so they can overlap (§9c).
                await asyncio.gather(
                    *(self._run_job(job) for job in poll.jobs),
                    return_exceptions=True,
                )

            await self._run_watch()

            if did_work:
                # Re-poll immediately after returning results, so a multi-step
                # assistant turn does not pay the poll interval twice.
                continue

            await asyncio.sleep(poll.poll_interval_ms / 1000.0)


async def bootstrap(args: argparse.Namespace) -> int:
    config = AgentConfig.load()

    if args.console_url:
        config.console_url = args.console_url.rstrip("/")
        config.save()

    token = None if args.pair else credentials.get_token()

    if args.pair or not token or not config.console_url:
        if args.pair:
            credentials.clear_token()
        print()
        print("  DeskWarrant agent setup")
        print("  " + "-" * 34)
        try:
            token = await pairing.interactive_pair(config)
        except (KeyboardInterrupt, EOFError):
            print("\n  Setup cancelled.")
            return 1

    config = AgentConfig.load()  # pick up anything pairing wrote
    transport = Transport(config, token)
    agent = Agent(config, transport)

    tray = None
    if not args.no_tray:
        try:
            from tray import TrayIcon

            tray = TrayIcon(lambda: agent.status, config)
            tray.start()
        except Exception as exc:  # noqa: BLE001
            log.debug("Tray icon unavailable: %s", exc)

    try:
        await agent.run()
    except AuthRevoked:
        log.error("This device was revoked in the console. Clearing credentials.")
        credentials.clear_token()
        print()
        print("  This PC was removed from your DeskWarrant account.")
        print("  Run the agent again to pair it back.")
        return 2
    except KeyboardInterrupt:
        log.info("Shutting down")
        return 0
    finally:
        # Never leave a cloudflared process behind: an orphaned tunnel would
        # keep the PC publicly reachable after the agent is gone.
        await agent.shutdown()
        if tray is not None:
            tray.stop()
        await transport.aclose()

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="deskwarrant-agent",
        description="DeskWarrant host agent.",
    )
    parser.add_argument(
        "--pair", action="store_true", help="Forget the stored token and pair again."
    )
    parser.add_argument(
        "--console-url", help="Set the console URL without going through pairing."
    )
    parser.add_argument("--verbose", action="store_true", help="Debug logging.")
    parser.add_argument(
        "--no-tray", action="store_true", help="Do not show a system tray icon."
    )
    args = parser.parse_args()

    setup_logging(args.verbose)

    try:
        return asyncio.run(bootstrap(args))
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
