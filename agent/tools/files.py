"""Folder listing and download inspection (build plan §8.1).

Every path here goes through safety.resolve_allowed_path first. That function,
not this one, is the security boundary.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import AgentConfig
from safety import (
    SafetyError,
    matches_pattern,
    optional_str,
    require_str,
    resolve_allowed_path,
)

# Extensions browsers and download managers use for incomplete files (§8.1).
PARTIAL_SUFFIXES = {".crdownload", ".part", ".tmp", ".download", ".partial"}

MAX_ENTRIES = 300
DOWNLOAD_SAMPLE_SECONDS = 2.0


def _is_partial(name: str) -> bool:
    return Path(name).suffix.lower() in PARTIAL_SUFFIXES


def _entry(path: Path) -> dict[str, Any] | None:
    try:
        stat = path.stat()
        is_dir = path.is_dir()
    except (OSError, PermissionError):
        return None
    return {
        "name": path.name,
        "sizeBytes": 0 if is_dir else stat.st_size,
        "modifiedAt": datetime.fromtimestamp(
            stat.st_mtime, tz=timezone.utc
        ).isoformat(),
        "isDir": is_dir,
        "isPartialDownload": (not is_dir) and _is_partial(path.name),
    }


def list_folder(args: dict[str, Any], config: AgentConfig) -> list[dict[str, Any]]:
    raw_path = require_str(args, "path")
    pattern = optional_str(args, "pattern", max_length=64)

    folder = resolve_allowed_path(raw_path, config)
    if not folder.exists():
        raise SafetyError("That folder does not exist.")
    if not folder.is_dir():
        raise SafetyError("That path is a file, not a folder.")

    rows: list[dict[str, Any]] = []
    try:
        for child in folder.iterdir():
            if not matches_pattern(child.name, pattern):
                continue
            entry = _entry(child)
            if entry is not None:
                rows.append(entry)
            if len(rows) >= MAX_ENTRIES:
                break
    except PermissionError as exc:
        raise SafetyError("Windows denied access to that folder.") from exc

    rows.sort(key=lambda r: (not r["isDir"], r["name"].lower()))
    return rows


def get_download_status(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    """Distinguish an actively growing download from a stalled one.

    Two size samples two seconds apart is the whole trick: the file API cannot
    tell us whether a writer is still attached, but a file that grew is
    unambiguously still being written.
    """
    raw_folder = optional_str(args, "folder")

    if raw_folder:
        folder = resolve_allowed_path(raw_folder, config)
    else:
        default = config.downloads_dir()
        if default is None:
            raise SafetyError("No Downloads folder is configured on this PC.")
        folder = default

    if not folder.is_dir():
        raise SafetyError("That folder does not exist.")

    def sample() -> dict[str, int]:
        sizes: dict[str, int] = {}
        try:
            for child in folder.iterdir():
                try:
                    if child.is_file() and _is_partial(child.name):
                        sizes[child.name] = child.stat().st_size
                except (OSError, PermissionError):
                    continue
        except PermissionError:
            return {}
        return sizes

    first = sample()
    if not first:
        # Nothing partial. Report the most recent completed file so the
        # assistant can say what finished rather than just "nothing running".
        recent = _most_recent_file(folder)
        return {
            "folder": str(folder),
            "inProgress": [],
            "anyActive": False,
            "mostRecentCompleted": recent,
        }

    time.sleep(DOWNLOAD_SAMPLE_SECONDS)
    second = sample()

    in_progress: list[dict[str, Any]] = []
    for name, start_size in first.items():
        end_size = second.get(name)
        if end_size is None:
            # It vanished between samples: the download finished and the
            # browser renamed it to its final name.
            in_progress.append(
                {
                    "name": name,
                    "sizeBytes": start_size,
                    "growthBytes": 0,
                    "state": "completed",
                }
            )
            continue
        growth = end_size - start_size
        in_progress.append(
            {
                "name": name,
                "sizeBytes": end_size,
                "growthBytes": growth,
                "state": "downloading" if growth > 0 else "stalled",
            }
        )

    return {
        "folder": str(folder),
        "sampleSeconds": DOWNLOAD_SAMPLE_SECONDS,
        "inProgress": in_progress,
        "anyActive": any(item["state"] == "downloading" for item in in_progress),
        "mostRecentCompleted": _most_recent_file(folder),
    }


def _most_recent_file(folder: Path) -> dict[str, Any] | None:
    newest: tuple[float, Path] | None = None
    try:
        for child in folder.iterdir():
            try:
                if not child.is_file() or _is_partial(child.name):
                    continue
                mtime = child.stat().st_mtime
            except (OSError, PermissionError):
                continue
            if newest is None or mtime > newest[0]:
                newest = (mtime, child)
    except (OSError, PermissionError):
        return None

    if newest is None:
        return None

    mtime, path = newest
    try:
        size = path.stat().st_size
    except OSError:
        size = 0
    return {
        "name": path.name,
        "sizeBytes": size,
        "modifiedAt": datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat(),
    }
