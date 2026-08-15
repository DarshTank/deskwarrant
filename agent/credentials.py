"""Device token storage, backed by Windows Credential Manager (build plan §11).

The token is a bearer credential for this PC. It never touches config.json and
never appears in logs.
"""

from __future__ import annotations

import logging

import keyring
from keyring.errors import KeyringError

SERVICE_NAME = "DeskWarrant"
TOKEN_ENTRY = "device-token"

log = logging.getLogger(__name__)


def get_token() -> str | None:
    try:
        return keyring.get_password(SERVICE_NAME, TOKEN_ENTRY)
    except KeyringError as exc:
        log.error("Could not read the device token from Credential Manager: %s", exc)
        return None


def set_token(token: str) -> None:
    keyring.set_password(SERVICE_NAME, TOKEN_ENTRY, token)


def clear_token() -> None:
    """Called when the console revokes this device (a 401 on poll)."""
    try:
        keyring.delete_password(SERVICE_NAME, TOKEN_ENTRY)
    except KeyringError:
        pass  # already absent


def redact(token: str | None) -> str:
    if not token:
        return "<none>"
    return f"{token[:6]}…{token[-4:]}"
