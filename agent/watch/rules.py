"""Watch-rule evaluation (build plan §7, §10 Stage 7).

Rules are evaluated locally every 15s and triggers are POSTed to the console,
which owns cooldown enforcement and notification delivery.

Everything here is EDGE-triggered: a rule fires on the transition into its
condition, not while the condition holds. Without that, "disk below 10%" would
fire every 15 seconds until the user freed space. The server's cooldown is a
second line of defence, not the primary one.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psutil

from config import AgentConfig
from safety import SafetyError, resolve_allowed_path
from tools.files import PARTIAL_SUFFIXES

log = logging.getLogger(__name__)

EVALUATION_INTERVAL_S = 15.0
_GB = 1024**3


@dataclass
class RuleState:
    """Per-rule memory carried between evaluations."""

    condition_met: bool = False
    high_since: float | None = None  # CPU_SUSTAINED_HIGH
    known_partials: set[str] = field(default_factory=set)  # DOWNLOAD_COMPLETE
    initialised: bool = False


class WatchEvaluator:
    def __init__(self, config: AgentConfig) -> None:
        self._config = config
        self._rules: list[dict[str, Any]] = []
        self._state: dict[str, RuleState] = {}

    def set_rules(self, rules: list[dict[str, Any]]) -> None:
        """Replace the rule set (called when configVersion changes)."""
        self._rules = rules
        keep = {rule["id"] for rule in rules}
        self._state = {k: v for k, v in self._state.items() if k in keep}
        log.info("Watch rules updated: %d active", len(rules))

    @property
    def rule_count(self) -> int:
        return len(self._rules)

    def evaluate(self) -> list[dict[str, Any]]:
        """Return the events that fired this cycle. Never raises."""
        events: list[dict[str, Any]] = []
        for rule in self._rules:
            rule_id = rule.get("id")
            if not rule_id:
                continue
            state = self._state.setdefault(rule_id, RuleState())
            try:
                event = self._evaluate_one(rule, state)
            except Exception:  # noqa: BLE001
                log.exception("Watch rule %s failed to evaluate", rule_id)
                continue
            if event is not None:
                events.append({"ruleId": rule_id, **event})
        return events

    # ---------- per-template evaluation ----------

    def _evaluate_one(
        self, rule: dict[str, Any], state: RuleState
    ) -> dict[str, Any] | None:
        template = rule.get("template")
        params = rule.get("params") or {}

        if template == "DISK_LOW":
            return self._disk_low(params, state)
        if template == "PROCESS_EXITED":
            return self._process_transition(params, state, want_running=False)
        if template == "PROCESS_STARTED":
            return self._process_transition(params, state, want_running=True)
        if template == "CPU_SUSTAINED_HIGH":
            return self._cpu_sustained(params, state)
        if template == "DOWNLOAD_COMPLETE":
            return self._download_complete(params, state)
        if template == "BATTERY_LOW":
            return self._battery_low(params, state)

        log.warning("Unknown watch template %s", template)
        return None

    def _disk_low(
        self, params: dict[str, Any], state: RuleState
    ) -> dict[str, Any] | None:
        volume = str(params.get("volume", "C:")).rstrip("\\")
        threshold = float(params.get("thresholdPercent", 10))

        try:
            usage = psutil.disk_usage(f"{volume}\\")
        except (OSError, ValueError):
            return None

        free_percent = 100.0 - usage.percent
        met = free_percent < threshold

        fired = met and not state.condition_met
        state.condition_met = met
        if not fired:
            return None

        return {
            "message": (
                f"Disk {volume} is {usage.percent:.0f}% full "
                f"({usage.free / _GB:.1f} GB free)."
            ),
            "payload": {
                "volume": volume,
                "freeGb": round(usage.free / _GB, 1),
                "percentUsed": round(usage.percent, 1),
            },
        }

    def _process_transition(
        self, params: dict[str, Any], state: RuleState, *, want_running: bool
    ) -> dict[str, Any] | None:
        name = str(params.get("processName", "")).lower()
        if not name:
            return None

        running = any(
            (proc.info.get("name") or "").lower() == name
            for proc in psutil.process_iter(["name"])
        )

        # The first evaluation only records a baseline. Firing "notepad exited"
        # merely because the agent started while it was closed would be wrong.
        if not state.initialised:
            state.initialised = True
            state.condition_met = running
            return None

        was_running = state.condition_met
        state.condition_met = running

        if want_running and running and not was_running:
            return {
                "message": f"{params.get('processName')} started.",
                "payload": {"processName": params.get("processName")},
            }
        if not want_running and was_running and not running:
            return {
                "message": f"{params.get('processName')} closed.",
                "payload": {"processName": params.get("processName")},
            }
        return None

    def _cpu_sustained(
        self, params: dict[str, Any], state: RuleState
    ) -> dict[str, Any] | None:
        threshold = float(params.get("thresholdPercent", 90))
        duration = float(params.get("durationSeconds", 300))

        # interval=None reads the average since the previous call, which for a
        # 15s evaluation cadence is exactly the window we want.
        cpu = psutil.cpu_percent(interval=None)
        now = time.time()

        if cpu < threshold:
            state.high_since = None
            state.condition_met = False
            return None

        if state.high_since is None:
            state.high_since = now
            return None

        if state.condition_met:
            return None  # already reported this episode

        if now - state.high_since < duration:
            return None

        state.condition_met = True
        return {
            "message": (
                f"CPU has been above {threshold:.0f}% for "
                f"{int((now - state.high_since) / 60)} minutes."
            ),
            "payload": {"cpuPercent": round(cpu, 1), "thresholdPercent": threshold},
        }

    def _download_complete(
        self, params: dict[str, Any], state: RuleState
    ) -> dict[str, Any] | None:
        raw_folder = params.get("folder")
        try:
            if raw_folder:
                folder = resolve_allowed_path(str(raw_folder), self._config)
            else:
                default = self._config.downloads_dir()
                if default is None:
                    return None
                folder = default
        except SafetyError:
            return None

        partials = _partial_names(folder)

        if not state.initialised:
            state.initialised = True
            state.known_partials = partials
            return None

        finished = state.known_partials - partials
        state.known_partials = partials

        if not finished or partials:
            # Report only once the folder is fully quiet, so a batch of
            # downloads produces one notification rather than one per file.
            return None

        names = sorted(finished)
        preview = ", ".join(n.rsplit(".", 1)[0] for n in names[:3])
        suffix = "" if len(names) <= 3 else f" and {len(names) - 3} more"

        return {
            "message": f"Download finished: {preview}{suffix}.",
            "payload": {"folder": str(folder), "files": names[:10]},
        }

    def _battery_low(
        self, params: dict[str, Any], state: RuleState
    ) -> dict[str, Any] | None:
        threshold = float(params.get("thresholdPercent", 20))
        try:
            sensor = psutil.sensors_battery()
        except (AttributeError, OSError):
            return None
        if sensor is None:
            return None

        met = sensor.percent < threshold and not sensor.power_plugged
        fired = met and not state.condition_met
        state.condition_met = met
        if not fired:
            return None

        return {
            "message": f"Battery is at {sensor.percent:.0f}% and not charging.",
            "payload": {"percent": round(sensor.percent, 1), "charging": False},
        }


def _partial_names(folder: Path) -> set[str]:
    names: set[str] = set()
    try:
        for child in folder.iterdir():
            try:
                if child.is_file() and child.suffix.lower() in PARTIAL_SUFFIXES:
                    names.add(child.name)
            except (OSError, PermissionError):
                continue
    except (OSError, PermissionError):
        return names
    return names
