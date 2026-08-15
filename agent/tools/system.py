"""System statistics (build plan §8.1)."""

from __future__ import annotations

import time
from typing import Any

import psutil

_GB = 1024**3


def get_system_stats(args: dict[str, Any], config: Any) -> dict[str, Any]:
    # interval=0.2 gives a real reading; interval=None would return the average
    # since boot on the first call, which is meaningless for "what's it doing
    # right now".
    cpu_percent = psutil.cpu_percent(interval=0.2)

    memory = psutil.virtual_memory()

    disks: list[dict[str, Any]] = []
    for partition in psutil.disk_partitions(all=False):
        # Skip empty optical/removable drives, which raise on usage().
        if "cdrom" in partition.opts or not partition.fstype:
            continue
        try:
            usage = psutil.disk_usage(partition.mountpoint)
        except (PermissionError, OSError):
            continue
        disks.append(
            {
                "volume": partition.device.rstrip("\\"),
                "freeGb": round(usage.free / _GB, 1),
                "totalGb": round(usage.total / _GB, 1),
                "percentUsed": round(usage.percent, 1),
            }
        )

    stats: dict[str, Any] = {
        "cpuPercent": round(cpu_percent, 1),
        "ram": {
            "usedGb": round((memory.total - memory.available) / _GB, 1),
            "totalGb": round(memory.total / _GB, 1),
        },
        "disks": disks,
        "uptimeSeconds": int(time.time() - psutil.boot_time()),
    }

    battery = _battery()
    if battery is not None:
        stats["battery"] = battery

    return stats


def _battery() -> dict[str, Any] | None:
    """None on desktops, which have no battery sensor."""
    try:
        sensor = psutil.sensors_battery()
    except (AttributeError, OSError):
        return None
    if sensor is None:
        return None
    return {
        "percent": round(sensor.percent, 1),
        "charging": bool(sensor.power_plugged),
    }
