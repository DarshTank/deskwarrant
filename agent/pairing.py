"""First-run pairing (build plan §7.1, §10 Stage 1).

Default path: this PC opens a claim, the console shows an approval screen, and
the user clicks. Nothing is typed. The console returns a device token, which is
written straight to Windows Credential Manager and never stored anywhere else.

The typed 6-character code is kept as `--code` for a PC with no browser and no
phone within reach.
"""

from __future__ import annotations

import asyncio
import logging
import platform
import socket
import sys
import webbrowser
from dataclasses import dataclass

import httpx

import credentials
from config import AGENT_VERSION, AgentConfig

log = logging.getLogger(__name__)

CLAIM_POLL_INTERVAL_S = 2.0
# The console expires claims at 10 minutes; stop a little after so the agent
# reports the console's own verdict rather than guessing at the deadline.
CLAIM_TIMEOUT_S = 11 * 60


def hostname() -> str:
    try:
        return socket.gethostname() or "Windows PC"
    except OSError:
        return "Windows PC"


def os_version() -> str:
    """A human-readable Windows version, e.g. 'Windows 11 23H2'.

    platform.release() reports '10' for Windows 11, so the build number is used
    to distinguish them: 22000+ is Windows 11.
    """
    try:
        release = platform.release()
        version = platform.version()  # e.g. '10.0.22631'
        build = int(version.split(".")[-1]) if version else 0
        if release == "10" and build >= 22000:
            release = "11"
        edition = platform.win32_edition() if hasattr(platform, "win32_edition") else None
        label = f"Windows {release}"
        if build:
            label += f" (build {build})"
        if edition:
            label += f" {edition}"
        return label[:120]
    except (ValueError, AttributeError, OSError):
        return platform.platform()[:120]


async def pair(console_url: str, code: str) -> tuple[str, str]:
    """Exchange a pairing code for (device_id, device_token)."""
    payload = {
        "code": code.strip().upper(),
        "hostname": hostname(),
        "osVersion": os_version(),
        "agentVersion": AGENT_VERSION,
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            f"{console_url.rstrip('/')}/api/agent/pair", json=payload
        )

    if response.status_code != 200:
        detail = ""
        try:
            detail = response.json().get("error", "")
        except ValueError:
            detail = response.text[:200]
        raise RuntimeError(detail or f"Pairing failed ({response.status_code}).")

    data = response.json()
    device_id = data.get("deviceId")
    device_token = data.get("deviceToken")
    if not device_id or not device_token:
        raise RuntimeError("The console returned an incomplete pairing response.")

    return device_id, device_token


# ---------- claim flow ----------


@dataclass
class Claim:
    """An outstanding request for this PC to join an account."""

    claim_id: str
    claim_secret: str
    match_code: str
    approve_url: str


class PairingFailed(RuntimeError):
    """Pairing ended without a token: denied, expired, or unreachable."""


async def open_claim(console_url: str) -> Claim:
    """Ask the console to open a pairing request for this PC."""
    payload = {
        "hostname": hostname(),
        "osVersion": os_version(),
        "agentVersion": AGENT_VERSION,
    }

    base = console_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(f"{base}/api/agent/claim", json=payload)
    except httpx.HTTPError as exc:
        raise PairingFailed(f"Could not reach the console at {base}: {exc}") from exc

    if response.status_code != 200:
        detail = ""
        try:
            detail = response.json().get("error", "")
        except ValueError:
            detail = response.text[:200]
        raise PairingFailed(detail or f"Could not start pairing ({response.status_code}).")

    data = response.json()
    claim_id = data.get("claimId")
    claim_secret = data.get("claimSecret")
    match_code = data.get("matchCode")
    approve_path = data.get("approvePath")
    if not (claim_id and claim_secret and match_code and approve_path):
        raise PairingFailed("The console returned an incomplete pairing response.")

    return Claim(
        claim_id=claim_id,
        claim_secret=claim_secret,
        match_code=match_code,
        approve_url=f"{base}{approve_path}",
    )


async def await_approval(console_url: str, claim: Claim) -> tuple[str, str]:
    """Poll until the claim is answered. Returns (device_id, device_token)."""
    url = f"{console_url.rstrip('/')}/api/agent/claim/{claim.claim_id}"
    headers = {"Authorization": f"Bearer {claim.claim_secret}"}
    deadline = asyncio.get_running_loop().time() + CLAIM_TIMEOUT_S

    async with httpx.AsyncClient(timeout=20.0) as client:
        while True:
            if asyncio.get_running_loop().time() > deadline:
                raise PairingFailed("Nobody approved this PC in time.")

            try:
                response = await client.post(url, headers=headers)
            except httpx.HTTPError as exc:
                # The console being briefly unreachable is not a reason to
                # abandon a claim the user may be walking over to approve.
                log.debug("Claim poll failed, retrying: %s", exc)
                await asyncio.sleep(CLAIM_POLL_INTERVAL_S)
                continue

            if response.status_code >= 500:
                await asyncio.sleep(CLAIM_POLL_INTERVAL_S)
                continue
            if response.status_code != 200:
                raise PairingFailed(f"Pairing was rejected ({response.status_code}).")

            data = response.json()
            status = data.get("status")

            if status == "PAIRED":
                device_id = data.get("deviceId")
                token = data.get("deviceToken")
                if not device_id or not token:
                    raise PairingFailed("The console approved this PC but sent no token.")
                return device_id, token

            if status == "DENIED":
                raise PairingFailed("The request was denied in the console.")
            if status == "EXPIRED":
                raise PairingFailed("The request expired. Start the agent again.")
            if status == "CONSUMED":
                raise PairingFailed("That request was already used.")

            await asyncio.sleep(CLAIM_POLL_INTERVAL_S)


# ---------- entry points ----------


def _has_console() -> bool:
    """False under Task Scheduler, where there is no stdin to read."""
    try:
        return bool(sys.stdin and sys.stdin.isatty())
    except (AttributeError, ValueError):
        return False


def resolve_console_url(config: AgentConfig) -> str:
    if config.console_url:
        return config.console_url
    if not _has_console():
        raise PairingFailed(
            "No console URL is configured. Set DESKWARRANT_CONSOLE_URL or run "
            "the agent once with --console-url."
        )
    while True:
        entered = input(
            "Console URL (e.g. https://deskwarrant.vercel.app): "
        ).strip()
        if entered.startswith("http://") or entered.startswith("https://"):
            return entered.rstrip("/")
        print("  Please enter a full URL including https://")


def _announce(claim: Claim) -> None:
    print()
    print("  Approve this PC in your browser:")
    print(f"    {claim.approve_url}")
    print()
    print("  Then pick this code:")
    print(f"    {claim.match_code}")
    print()
    print("  Waiting for approval…")
    print()
    # Logged as well as printed: under Task Scheduler nothing is printed
    # anywhere a person will see, and the log is the only way to recover the
    # link short of the tray menu.
    log.info("Pairing: approve at %s with code %s", claim.approve_url, claim.match_code)


async def claim_pair(config: AgentConfig, on_claim=None) -> str:
    """Default flow: open a claim, send the user to the console, wait."""
    config.console_url = resolve_console_url(config)

    claim = await open_claim(config.console_url)
    _announce(claim)
    if on_claim is not None:
        on_claim(claim)

    # Best effort: under Task Scheduler, or over RDP with no default browser,
    # this quietly does nothing and the printed link is the fallback.
    try:
        webbrowser.open(claim.approve_url)
    except Exception as exc:  # noqa: BLE001
        log.debug("Could not open a browser: %s", exc)

    try:
        device_id, token = await await_approval(config.console_url, claim)
    finally:
        if on_claim is not None:
            on_claim(None)

    return _store(config, device_id, token)


async def code_pair(config: AgentConfig, code: str | None) -> str:
    """Fallback flow: a 6-character code typed from the console."""
    config.console_url = resolve_console_url(config)

    if code:
        # A code passed on the command line gets one attempt: there is nobody
        # at a prompt to retype it, so a failure has to surface as a clean
        # message rather than a traceback.
        try:
            device_id, token = await pair(config.console_url, code)
        except httpx.HTTPError as exc:
            raise PairingFailed(f"Could not reach the console: {exc}") from exc
        except RuntimeError as exc:
            raise PairingFailed(str(exc)) from exc
        return _store(config, device_id, token)

    if not _has_console():
        raise PairingFailed("No terminal to read a pairing code from.")

    print()
    print("  Open the DeskWarrant console, reveal the typed-code fallback,")
    print("  then type the 6-character code below.")
    print()

    while True:
        entered = input("  Pairing code: ").strip().upper()
        if len(entered.replace("-", "").replace(" ", "")) < 4:
            print("  That does not look like a pairing code.")
            continue
        try:
            device_id, token = await pair(config.console_url, entered)
        except RuntimeError as exc:
            print(f"  {exc}")
            print("  Generate a fresh code and try again.")
            continue
        except httpx.HTTPError as exc:
            print(f"  Could not reach the console: {exc}")
            continue

        return _store(config, device_id, token)


def _store(config: AgentConfig, device_id: str, token: str) -> str:
    credentials.set_token(token)
    config.device_id = device_id
    config.save()
    print()
    print(f"  Paired. This PC is now '{hostname()}' in the console.")
    print()
    log.info("Paired as device %s", device_id[:8])
    return token
