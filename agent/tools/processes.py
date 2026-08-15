"""Process inspection (build plan §8.1)."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import psutil

from safety import optional_int, optional_str

# psutil reports CPU relative to a single core, so an 8-core machine can report
# 800%. Dividing by the core count matches what Task Manager shows the user,
# which is the number they will be comparing against.
_CORE_COUNT = psutil.cpu_count(logical=True) or 1

_CPU_SAMPLE_SECONDS = 0.25

# "System Idle Process" accumulates whatever CPU is NOT in use, so on a quiet
# machine it sorts to the top and the assistant would answer "System Idle
# Process is using the most CPU" -- true, and exactly backwards from what the
# user meant. Excluded so the ranking reflects real consumers.
_EXCLUDED_NAMES = {"system idle process"}


def list_processes(args: dict[str, Any], config: Any) -> list[dict[str, Any]]:
    name_filter = (optional_str(args, "filter", max_length=64) or "").lower()
    sort_by = args.get("sortBy") or "cpu"
    if sort_by not in ("cpu", "memory", "name"):
        sort_by = "cpu"
    limit = optional_int(args, "limit", 20, minimum=1, maximum=50)

    # First pass primes psutil's per-process CPU counters; a single call always
    # returns 0.0 because there is no previous sample to diff against.
    procs: list[psutil.Process] = []
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            proc.cpu_percent(None)
            procs.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    if sort_by == "cpu":
        time.sleep(_CPU_SAMPLE_SECONDS)

    rows: list[dict[str, Any]] = []
    for proc in procs:
        try:
            with proc.oneshot():
                name = proc.name()
                if name.lower() in _EXCLUDED_NAMES:
                    continue
                if name_filter and name_filter not in name.lower():
                    continue
                cpu = proc.cpu_percent(None) / _CORE_COUNT
                memory_mb = proc.memory_info().rss / (1024 * 1024)
                status = proc.status()
                started = proc.create_time()
            rows.append(
                {
                    "pid": proc.pid,
                    "name": name,
                    "cpuPercent": round(cpu, 1),
                    "memoryMb": round(memory_mb, 1),
                    "status": status,
                    "startedAt": datetime.fromtimestamp(
                        started, tz=timezone.utc
                    ).isoformat(),
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied, OSError):
            # Processes come and go mid-scan, and some are readable only by
            # SYSTEM. Skipping them is correct for an unelevated agent.
            continue

    if sort_by == "cpu":
        rows.sort(key=lambda r: r["cpuPercent"], reverse=True)
    elif sort_by == "memory":
        rows.sort(key=lambda r: r["memoryMb"], reverse=True)
    else:
        rows.sort(key=lambda r: r["name"].lower())

    return rows[:limit]
