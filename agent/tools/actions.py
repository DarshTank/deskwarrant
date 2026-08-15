"""Action tools (build plan §8.2).

Confirmation for destructive actions is enforced by the CONSOLE: a job only
reaches the agent as PENDING after the user approved it. The agent still
re-validates arguments and refuses categorically dangerous targets, because a
forged job must not be able to take down the machine.
"""

from __future__ import annotations

import ctypes
import logging
import os
import time
from typing import Any

import psutil
import win32con
import win32gui

from config import AgentConfig
from safety import SafetyError, require_int, resolve_allowed_path, require_str

log = logging.getLogger(__name__)

TERMINATE_GRACE_SECONDS = 3.0

# Killing any of these takes the machine down or forces a reboot. The model has
# no legitimate reason to target them, and a prompt-injection payload asking for
# "kill pid 4" must fail closed even if every layer above this one is bypassed.
_PROTECTED_PIDS = {0, 4}
_PROTECTED_NAMES = {
    "system",
    "system idle process",
    "registry",
    "smss.exe",
    "csrss.exe",
    "wininit.exe",
    "winlogon.exe",
    "services.exe",
    "lsass.exe",
    "svchost.exe",
    "fontdrvhost.exe",
    "dwm.exe",
    "memory compression",
}


# ---------- window actions ----------


def focus_window(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    hwnd = require_int(args, "hwnd")
    if not win32gui.IsWindow(hwnd):
        raise SafetyError("That window no longer exists.")

    title = win32gui.GetWindowText(hwnd)
    try:
        placement = win32gui.GetWindowPlacement(hwnd)
        if placement[1] == win32con.SW_SHOWMINIMIZED:
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
    except Exception as exc:  # noqa: BLE001
        # Windows refuses SetForegroundWindow unless the calling process owns
        # the foreground or input is idle. Report it rather than pretending.
        raise SafetyError(
            f"Windows would not bring that window forward: {exc}"
        ) from exc

    return {"hwnd": hwnd, "title": title, "focused": True}


def minimize_window(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    hwnd = require_int(args, "hwnd")
    if not win32gui.IsWindow(hwnd):
        raise SafetyError("That window no longer exists.")
    title = win32gui.GetWindowText(hwnd)
    win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
    return {"hwnd": hwnd, "title": title, "minimized": True}


def close_window(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    hwnd = require_int(args, "hwnd")
    if not win32gui.IsWindow(hwnd):
        raise SafetyError("That window no longer exists.")

    title = win32gui.GetWindowText(hwnd)
    # WM_CLOSE is a request, not a kill: the app may prompt to save. That is
    # the intended behaviour -- close_window must not discard the user's work.
    win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)

    time.sleep(0.4)
    still_open = bool(win32gui.IsWindow(hwnd))
    return {
        "hwnd": hwnd,
        "title": title,
        "closed": not still_open,
        "note": (
            "The application is still open; it may be showing a save prompt."
            if still_open
            else "The window closed."
        ),
    }


# ---------- process actions ----------


def kill_process(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    pid = require_int(args, "pid", minimum=1)

    if pid in _PROTECTED_PIDS:
        raise SafetyError("That process is critical to Windows and cannot be killed.")
    if pid == os.getpid():
        raise SafetyError("That is the DeskWarrant agent itself.")

    try:
        proc = psutil.Process(pid)
        name = proc.name()
    except psutil.NoSuchProcess as exc:
        raise SafetyError(f"Process {pid} is not running.") from exc
    except psutil.AccessDenied as exc:
        raise SafetyError(
            f"Windows denied access to process {pid}. The agent runs unelevated."
        ) from exc

    if name.lower() in _PROTECTED_NAMES:
        raise SafetyError(
            f"{name} is a critical Windows process and cannot be killed."
        )

    try:
        proc.terminate()
        try:
            proc.wait(timeout=TERMINATE_GRACE_SECONDS)
        except psutil.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=TERMINATE_GRACE_SECONDS)
    except psutil.NoSuchProcess:
        pass  # it exited during the grace window, which is success
    except psutil.AccessDenied as exc:
        raise SafetyError(
            f"Windows denied permission to end {name}. The agent runs unelevated."
        ) from exc
    except psutil.TimeoutExpired as exc:
        raise SafetyError(f"{name} did not exit.") from exc

    return {"pid": pid, "name": name, "terminated": True}


# ---------- shell actions ----------


def open_path(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    raw = require_str(args, "path")
    target = resolve_allowed_path(raw, config)
    if not target.exists():
        raise SafetyError("That file or folder does not exist.")

    try:
        os.startfile(str(target))  # noqa: S606 - the path cleared the allowlist
    except OSError as exc:
        raise SafetyError(f"Windows could not open that: {exc}") from exc

    return {"path": str(target), "opened": True}


def lock_workstation(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    ok = bool(ctypes.windll.user32.LockWorkStation())
    if not ok:
        raise SafetyError("Windows refused to lock the workstation.")
    return {
        "locked": True,
        "note": (
            "The workstation is locked. The agent cannot see or interact with "
            "the lock screen, so live view and window tools will return nothing "
            "until you sign back in."
        ),
    }


# ---------- audio ----------


def set_volume(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    level = require_int(args, "level", minimum=0, maximum=100)

    try:
        # Imported lazily so the agent still starts on a machine where the
        # audio stack is missing (headless VMs, no audio endpoint).
        from ctypes import POINTER, cast

        from comtypes import CLSCTX_ALL  # type: ignore[import-untyped]
        from pycaw.pycaw import (  # type: ignore[import-untyped]
            AudioUtilities,
            IAudioEndpointVolume,
        )
    except ImportError as exc:
        raise SafetyError(
            "Volume control is unavailable: the pycaw package is not installed."
        ) from exc

    import pythoncom  # type: ignore[import-untyped]

    pythoncom.CoInitialize()
    try:
        speakers = AudioUtilities.GetSpeakers()
        if speakers is None:
            raise SafetyError("This PC has no active audio output device.")
        interface = speakers.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        volume = cast(interface, POINTER(IAudioEndpointVolume))
        volume.SetMasterVolumeLevelScalar(level / 100.0, None)
        if level == 0:
            volume.SetMute(1, None)
        else:
            volume.SetMute(0, None)
    except SafetyError:
        raise
    except Exception as exc:  # noqa: BLE001 - COM raises broadly
        raise SafetyError(f"Could not set the volume: {exc}") from exc
    finally:
        pythoncom.CoUninitialize()

    return {"level": level, "muted": level == 0}
