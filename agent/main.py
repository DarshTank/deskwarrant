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

    # aiortc and its dependencies are extremely chatty at INFO.
    for noisy in ("aioice", "aiortc", "httpx", "httpcore", "comtypes"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


class Agent:
    """Owns the poll loop, job execution, watch evaluation, and RTC sessions."""

    def __init__(self, config: AgentConfig, transport: Transport) -> None:
        self.config = config
        self.transport = transport
        self.evaluator = WatchEvaluator(config)
        self.config_version = 0
        self._rtc_session: Any = None
        self._last_watch_run = 0.0
        self._status = "connecting"

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

    # ---------- RTC ----------

    async def _handle_offer(self, offer: dict[str, Any]) -> None:
        session_id = offer.get("sessionId")
        offer_sdp = offer.get("offerSdp")
        if not session_id or not offer_sdp:
            return

        # v1 is one live session at a time; a new offer supersedes the old.
        if self._rtc_session is not None:
            log.info("Replacing the active live session")
            await self._rtc_session.close()
            self._rtc_session = None

        log.info("Answering RTC session %s", session_id[:8])
        try:
            # Imported lazily: aiortc pulls in a large native dependency tree,
            # and an agent that never opens live view should not pay for it.
            from rtc.session import RtcSession

            session = RtcSession(session_id, offer_sdp, self.config)
            answer_sdp = await session.answer()
            await self.transport.post_rtc_answer(session_id, answer_sdp)
            self._rtc_session = session
            self._status = "live"

            asyncio.ensure_future(self._await_session_end(session))
        except TransportError as exc:
            log.error("Could not post the RTC answer: %s", exc)
        except Exception:  # noqa: BLE001
            log.exception("Failed to establish the RTC session")

    async def _await_session_end(self, session: Any) -> None:
        await session.wait_closed()
        if self._rtc_session is session:
            self._rtc_session = None
            self._status = "online"

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
            self._status = "live" if self._rtc_session else "online"

            if poll.watch_rules is not None:
                self.evaluator.set_rules(poll.watch_rules)
            self.config_version = poll.config_version

            for offer in poll.rtc_offers:
                await self._handle_offer(offer)

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
