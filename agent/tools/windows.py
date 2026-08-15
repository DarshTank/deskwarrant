"""Window enumeration and UI Automation text extraction (build plan §8.1)."""

from __future__ import annotations

import logging
from typing import Any

import psutil
import win32con
import win32gui
import win32process

from safety import SafetyError, require_int

log = logging.getLogger(__name__)

MAX_TEXT_CHARS = 4000
MAX_UIA_NODES = 400
MAX_WINDOWS = 80

# Shell windows that are always present and never what the user means.
_IGNORED_CLASSES = {
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Windows.UI.Core.CoreWindow",
    "ApplicationFrameWindow_Hidden",
}


def _process_name(pid: int) -> str:
    try:
        return psutil.Process(pid).name()
    except (psutil.NoSuchProcess, psutil.AccessDenied, OSError):
        return "unknown"


def list_windows(args: dict[str, Any], config: Any) -> list[dict[str, Any]]:
    foreground = win32gui.GetForegroundWindow()
    results: list[dict[str, Any]] = []

    def callback(hwnd: int, _extra: Any) -> bool:
        if not win32gui.IsWindowVisible(hwnd):
            return True
        title = win32gui.GetWindowText(hwnd)
        if not title.strip():
            return True
        try:
            class_name = win32gui.GetClassName(hwnd)
        except Exception:  # noqa: BLE001 - win32gui raises bare pywintypes.error
            class_name = ""
        if class_name in _IGNORED_CLASSES:
            return True

        try:
            _thread_id, pid = win32process.GetWindowThreadProcessId(hwnd)
        except Exception:  # noqa: BLE001
            pid = 0

        try:
            placement = win32gui.GetWindowPlacement(hwnd)
            minimized = placement[1] == win32con.SW_SHOWMINIMIZED
        except Exception:  # noqa: BLE001
            minimized = False

        results.append(
            {
                "hwnd": int(hwnd),
                "title": title[:200],
                "processName": _process_name(pid) if pid else "unknown",
                "pid": int(pid),
                "isMinimized": bool(minimized),
                "isForeground": hwnd == foreground,
            }
        )
        return True

    win32gui.EnumWindows(callback, None)

    # Foreground first, then non-minimized, then the rest: the window the user
    # is talking about is overwhelmingly likely to be near the top.
    results.sort(key=lambda w: (not w["isForeground"], w["isMinimized"]))
    return results[:MAX_WINDOWS]


def read_window_text(args: dict[str, Any], config: Any) -> dict[str, Any]:
    hwnd = require_int(args, "hwnd")

    if not win32gui.IsWindow(hwnd):
        raise SafetyError("That window no longer exists.")

    title = win32gui.GetWindowText(hwnd)

    # Imported lazily: uiautomation initialises COM at import time, which is
    # wasteful for the many agent runs that never read window text.
    import pythoncom  # type: ignore[import-untyped]

    pythoncom.CoInitialize()
    try:
        import uiautomation as auto  # type: ignore[import-untyped]

        try:
            control = auto.ControlFromHandle(hwnd)
        except Exception as exc:  # noqa: BLE001 - comtypes raises broadly
            raise SafetyError(f"Could not attach to that window: {exc}") from exc

        if control is None:
            return {
                "title": title,
                "text": "",
                "note": "This window exposes no accessible text.",
            }

        fragments: list[str] = []
        seen: set[str] = set()
        nodes = 0

        # Depth-limited walk: some apps expose thousands of nodes and a full
        # traversal can take many seconds.
        for child, _depth in auto.WalkControl(control, includeTop=True, maxDepth=12):
            nodes += 1
            if nodes > MAX_UIA_NODES:
                break
            for value in (_safe_name(child), _safe_value(child)):
                text = (value or "").strip()
                if not text or len(text) > 500:
                    continue
                if text in seen:
                    continue
                seen.add(text)
                fragments.append(text)
            if sum(len(f) for f in fragments) > MAX_TEXT_CHARS:
                break

        flattened = "\n".join(fragments)[:MAX_TEXT_CHARS]

        result: dict[str, Any] = {"title": title, "text": flattened}
        if not flattened:
            result["note"] = (
                "This window draws custom UI with no accessible text. "
                "Live view would be needed to read it."
            )
        return result
    finally:
        pythoncom.CoUninitialize()


def _safe_name(control: Any) -> str:
    try:
        return control.Name or ""
    except Exception:  # noqa: BLE001
        return ""


def _safe_value(control: Any) -> str:
    try:
        pattern = control.GetValuePattern()
        return pattern.Value or ""
    except Exception:  # noqa: BLE001
        # Most controls have no ValuePattern; that is normal, not an error.
        return ""
