"""Agent configuration (build plan §12).

Lives at %LOCALAPPDATA%\\DeskWarrant\\config.json. The device token is NEVER
stored here -- it goes to Windows Credential Manager via credentials.py.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

AGENT_VERSION = "0.1.0"
APP_DIR_NAME = "DeskWarrant"

DEFAULT_ALLOWED_ROOTS = [
    r"%USERPROFILE%\Downloads",
    r"%USERPROFILE%\Documents",
    r"%USERPROFILE%\Desktop",
    r"%USERPROFILE%\Pictures",
    r"%USERPROFILE%\Videos",
]


def config_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(base) / APP_DIR_NAME


def config_path() -> Path:
    return config_dir() / "config.json"


def log_path() -> Path:
    return config_dir() / "agent.log"


@dataclass
class CaptureConfig:
    tile_size: int = 128
    target_fps: int = 10
    webp_quality: int = 70

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "CaptureConfig":
        return cls(
            tile_size=int(raw.get("tileSize", 128)),
            target_fps=int(raw.get("targetFps", 10)),
            webp_quality=int(raw.get("webpQuality", 70)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "tileSize": self.tile_size,
            "targetFps": self.target_fps,
            "webpQuality": self.webp_quality,
        }


@dataclass
class AgentConfig:
    console_url: str = ""
    poll_interval_ms: int = 2000
    allowed_roots: list[str] = field(default_factory=lambda: list(DEFAULT_ALLOWED_ROOTS))
    capture: CaptureConfig = field(default_factory=CaptureConfig)
    device_id: str | None = None
    monitor_index: int = 0

    # ---------- persistence ----------

    @classmethod
    def load(cls) -> "AgentConfig":
        path = config_path()
        if not path.exists():
            return cls()
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            # A corrupt config must not brick the agent; fall back to defaults
            # and let the user re-pair rather than crash-looping at startup.
            return cls()

        return cls(
            console_url=str(raw.get("consoleUrl", "")).rstrip("/"),
            poll_interval_ms=int(raw.get("pollIntervalMs", 2000)),
            allowed_roots=list(raw.get("allowedRoots", DEFAULT_ALLOWED_ROOTS)),
            capture=CaptureConfig.from_dict(raw.get("capture", {})),
            device_id=raw.get("deviceId"),
            monitor_index=int(raw.get("monitorIndex", 0)),
        )

    def save(self) -> None:
        directory = config_dir()
        directory.mkdir(parents=True, exist_ok=True)
        payload = {
            "consoleUrl": self.console_url,
            "pollIntervalMs": self.poll_interval_ms,
            "allowedRoots": self.allowed_roots,
            "capture": self.capture.to_dict(),
            "deviceId": self.device_id,
            "monitorIndex": self.monitor_index,
        }
        config_path().write_text(
            json.dumps(payload, indent=2), encoding="utf-8"
        )

    # ---------- derived ----------

    def resolved_roots(self) -> list[Path]:
        """Expand %VARS% and resolve to absolute paths.

        Roots that do not exist are dropped rather than raising: a machine
        without a Videos folder should not break file listing entirely.
        """
        roots: list[Path] = []
        for entry in self.allowed_roots:
            expanded = os.path.expandvars(entry)
            if "%" in expanded:
                continue  # an env var that did not resolve
            try:
                path = Path(expanded).resolve(strict=False)
            except (OSError, ValueError):
                continue
            if path.is_dir():
                roots.append(path)
        return roots

    def downloads_dir(self) -> Path | None:
        for root in self.resolved_roots():
            if root.name.lower() == "downloads":
                return root
        return None
