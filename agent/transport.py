"""Control-plane HTTP client (build plan §5, §7.1).

Vercel functions cannot hold long-lived connections, so the agent polls. The
poll doubles as the heartbeat that drives online/offline status in the console.
"""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass, field
from typing import Any

import httpx

from config import AGENT_VERSION, AgentConfig

log = logging.getLogger(__name__)

REQUEST_TIMEOUT_S = 15.0
BACKOFF_START_S = 2.0
BACKOFF_MAX_S = 30.0


class AuthRevoked(Exception):
    """The console rejected our token; the device was revoked or deleted."""


class TransportError(Exception):
    """A transient network or server failure. The caller should back off."""


@dataclass
class PollResult:
    jobs: list[dict[str, Any]] = field(default_factory=list)
    watch_rules: list[dict[str, Any]] | None = None  # None = unchanged
    poll_interval_ms: int = 2000
    config_version: int = 0
    # `view.active` is what starts and stops the tunnel. Absent means inactive.
    view: dict[str, Any] = field(default_factory=dict)

    @property
    def view_active(self) -> bool:
        return bool(self.view.get("active"))

    @property
    def view_session_id(self) -> str | None:
        value = self.view.get("sessionId")
        return str(value) if value else None

    @property
    def tunnel_token(self) -> str | None:
        """Runs this device's tunnel. Sent only while a session is active."""
        value = self.view.get("tunnelToken")
        return str(value) if value else None

    @property
    def tunnel_hostname(self) -> str | None:
        value = self.view.get("hostname")
        return str(value) if value else None

    @property
    def view_local_port(self) -> int | None:
        """The console configures tunnel ingress against this exact port, so it
        is authoritative -- a local override would just break routing."""
        value = self.view.get("localPort")
        return int(value) if value else None


class Transport:
    def __init__(self, config: AgentConfig, token: str) -> None:
        self._config = config
        self._token = token
        self._client = httpx.AsyncClient(
            base_url=config.console_url,
            timeout=REQUEST_TIMEOUT_S,
            headers={
                "Authorization": f"Bearer {token}",
                "User-Agent": f"DeskWarrant-Agent/{AGENT_VERSION}",
            },
            follow_redirects=True,
        )
        self._backoff = BACKOFF_START_S

    async def aclose(self) -> None:
        await self._client.aclose()

    # ---------- backoff ----------

    def reset_backoff(self) -> None:
        self._backoff = BACKOFF_START_S

    async def sleep_backoff(self) -> None:
        """Exponential backoff to 30s, with jitter to avoid a thundering herd
        of reconnecting agents after a console outage."""
        delay = min(self._backoff, BACKOFF_MAX_S)
        jittered = delay * (0.8 + random.random() * 0.4)
        log.warning("Network trouble; retrying in %.1fs", jittered)
        await asyncio.sleep(jittered)
        self._backoff = min(self._backoff * 2, BACKOFF_MAX_S)

    # ---------- request helper ----------

    async def _request(self, method: str, url: str, **kwargs: Any) -> Any:
        try:
            response = await self._client.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            raise TransportError(str(exc)) from exc

        if response.status_code == 401:
            raise AuthRevoked(response.text[:200])
        if response.status_code == 429:
            raise TransportError("rate limited by the console")
        if response.status_code >= 500:
            raise TransportError(f"console error {response.status_code}")
        if response.status_code >= 400:
            # 4xx other than 401 is our bug, not a transient fault. Surface it
            # but do not treat it as a reason to back off forever.
            log.error("%s %s -> %s %s", method, url, response.status_code,
                      response.text[:200])
            raise TransportError(f"request rejected ({response.status_code})")

        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError as exc:
            raise TransportError("console returned a non-JSON body") from exc

    # ---------- endpoints ----------

    async def poll(self, config_version: int) -> PollResult:
        data = await self._request(
            "GET", "/api/agent/poll", params={"configVersion": config_version}
        )
        return PollResult(
            jobs=data.get("jobs") or [],
            # An absent key means "unchanged"; an empty list means "no rules".
            watch_rules=data.get("watchRules"),
            poll_interval_ms=int(data.get("pollIntervalMs", 2000)),
            config_version=int(data.get("configVersion", 0)),
            view=data.get("view") or {},
        )

    async def post_job_result(
        self,
        job_id: str,
        *,
        result: Any = None,
        error: str | None = None,
    ) -> None:
        if error is not None:
            payload: dict[str, Any] = {"status": "FAILED", "error": error[:2000]}
        else:
            payload = {"status": "DONE", "result": result}
        await self._request("POST", f"/api/agent/jobs/{job_id}/result", json=payload)

    async def post_view_state(
        self, tunnel_state: str, *, tunnel_error: str | None = None
    ) -> None:
        """Report tunnel status to the console.

        The console provisions the tunnel and already knows its hostname, so
        the agent has nothing to tell it about identity -- only liveness.
        """
        payload: dict[str, Any] = {"tunnelState": tunnel_state}
        if tunnel_error:
            payload["tunnelError"] = tunnel_error[:500]
        await self._request("POST", "/api/agent/view/state", json=payload)

    async def verify_view_token(self, token: str) -> bool:
        """Ask the console whether a token presented on the socket is good.

        Checked against the console on every connect rather than a local cache,
        so revoking the device or ending the session kills live tokens at once.
        """
        data = await self._request(
            "POST", "/api/agent/view-token/verify", json={"token": token}
        )
        return bool(data.get("valid"))

    async def post_events(self, events: list[dict[str, Any]]) -> None:
        if not events:
            return
        await self._request("POST", "/api/agent/events", json={"events": events})
