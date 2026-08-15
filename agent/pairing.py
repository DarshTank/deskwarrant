"""First-run pairing (build plan §7.1, §10 Stage 1).

The user generates a 6-character code in the console and types it here. In
exchange the console returns a device token, which is written straight to
Windows Credential Manager and never stored anywhere else.
"""

from __future__ import annotations

import logging
import platform
import socket

import httpx

import credentials
from config import AGENT_VERSION, AgentConfig

log = logging.getLogger(__name__)


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


def prompt_for_console_url(config: AgentConfig) -> str:
    if config.console_url:
        return config.console_url
    while True:
        entered = input(
            "Console URL (e.g. https://deskwarrant.vercel.app): "
        ).strip()
        if entered.startswith("http://") or entered.startswith("https://"):
            return entered.rstrip("/")
        print("  Please enter a full URL including https://")


async def interactive_pair(config: AgentConfig) -> str:
    """Run the console pairing flow. Returns the device token."""
    config.console_url = prompt_for_console_url(config)

    print()
    print("  Open the DeskWarrant console, click 'Generate pairing code',")
    print("  then type the 6-character code below.")
    print()

    while True:
        code = input("  Pairing code: ").strip().upper()
        if len(code.replace("-", "").replace(" ", "")) < 4:
            print("  That does not look like a pairing code.")
            continue
        try:
            device_id, token = await pair(config.console_url, code)
        except RuntimeError as exc:
            print(f"  {exc}")
            print("  Generate a fresh code and try again.")
            continue
        except httpx.HTTPError as exc:
            print(f"  Could not reach the console: {exc}")
            continue

        credentials.set_token(token)
        config.device_id = device_id
        config.save()
        print()
        print(f"  Paired. This PC is now '{hostname()}' in the console.")
        print()
        return token
