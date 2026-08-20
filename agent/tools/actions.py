"""Action tools (build plan §8.2).

Confirmation for destructive actions is enforced by the CONSOLE: a job only
reaches the agent as PENDING after the user approved it. The agent still
re-validates arguments and refuses categorically dangerous targets, because a
forged job must not be able to take down the machine.
"""

from __future__ import annotations

import ctypes
import gc
import logging
import os
import time
from typing import Any

import psutil
import win32con
import win32gui

from config import AgentConfig
from safety import (
    SafetyError,
    require_bool,
    require_int,
    require_str,
    resolve_allowed_path,
)

log = logging.getLogger(__name__)

TERMINATE_GRACE_SECONDS = 3.0

KEYEVENTF_KEYUP = 0x0002

# Virtual-key codes for the media transport keys. Windows routes these to
# whichever application currently owns media playback, so no target is
# needed -- which is exactly why they work when no window is focused.
_MEDIA_KEYS = {
    "play_pause": 0xB3,
    "next": 0xB0,
    "previous": 0xB1,
    "stop": 0xB2,
}

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


def _live_window(args: dict[str, Any]) -> tuple[int, str]:
    """Validate an hwnd argument and return it with the window's title.

    Every window tool needs the same two checks, and the title is read BEFORE
    acting so the result still names the window even if the act destroys it.
    """
    hwnd = require_int(args, "hwnd")
    if not win32gui.IsWindow(hwnd):
        raise SafetyError("That window no longer exists.")
    return hwnd, win32gui.GetWindowText(hwnd)


def focus_window(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    hwnd, title = _live_window(args)
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
    hwnd, title = _live_window(args)
    win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
    return {"hwnd": hwnd, "title": title, "minimized": True}


def maximize_window(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    hwnd, title = _live_window(args)
    win32gui.ShowWindow(hwnd, win32con.SW_MAXIMIZE)
    return {"hwnd": hwnd, "title": title, "maximized": True}


def restore_window(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    """Undo either a minimise or a maximise.

    SW_RESTORE covers both: it returns a window to the size and position it had
    before whichever of the two put it where it is.
    """
    hwnd, title = _live_window(args)
    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    return {"hwnd": hwnd, "title": title, "restored": True}


def close_window(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    hwnd, title = _live_window(args)
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


def _with_endpoint_volume(operation: Any) -> Any:
    """Run `operation(volume)` against the default output device.

    All three audio tools need the same COM dance, and getting it subtly
    different in each is how a CoUninitialize gets skipped on an error path.
    """
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
    speakers = None
    interface = None
    volume = None
    try:
        speakers = AudioUtilities.GetSpeakers()
        if speakers is None:
            raise SafetyError("This PC has no active audio output device.")
        interface = speakers.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        volume = cast(interface, POINTER(IAudioEndpointVolume))
        return operation(volume)
    except SafetyError:
        raise
    except Exception as exc:  # noqa: BLE001 - COM raises broadly
        raise SafetyError(f"The audio device could not be reached: {exc}") from exc
    finally:
        # comtypes proxies sit in reference cycles, so simply returning is not
        # enough to release them: the pointer outlives this call and is freed
        # later by the cyclic collector, on whatever thread happened to trigger
        # it, after CoUninitialize has already run. That is an access violation
        # that kills the whole agent, and the stack it crashes on is wherever
        # the GC fired -- nowhere near here. Dropping the references and
        # collecting on the creating thread keeps Release inside the apartment
        # that owns it.
        speakers = interface = volume = None
        gc.collect()
        pythoncom.CoUninitialize()


def _read_state(volume: Any) -> dict[str, Any]:
    return {
        "level": int(round(volume.GetMasterVolumeLevelScalar() * 100)),
        "muted": bool(volume.GetMute()),
    }


def get_volume(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    return _with_endpoint_volume(_read_state)


def set_volume(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    level = require_int(args, "level", minimum=0, maximum=100)

    def apply(volume: Any) -> dict[str, Any]:
        volume.SetMasterVolumeLevelScalar(level / 100.0, None)
        # Setting a level of 0 and leaving the mute flag clear would leave the
        # PC silent but reporting "not muted", so the two are kept consistent.
        volume.SetMute(1 if level == 0 else 0, None)
        return {"level": level, "muted": level == 0}

    return _with_endpoint_volume(apply)


def set_mute(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    muted = require_bool(args, "muted")

    def apply(volume: Any) -> dict[str, Any]:
        volume.SetMute(1 if muted else 0, None)
        # The level is reported back because unmuting to a volume of 0 is a
        # confusing outcome the assistant should be able to mention.
        return _read_state(volume)

    return _with_endpoint_volume(apply)


def media_key(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    """Send one media transport key to whatever is playing.

    keybd_event rather than SendInput: media keys are a virtual-key concept and
    the INPUT structs are owned by the view server's injector, which this module
    has no business importing.
    """
    key = require_str(args, "key", max_length=16).strip().lower()
    code = _MEDIA_KEYS.get(key)
    if code is None:
        allowed = ", ".join(sorted(_MEDIA_KEYS))
        raise SafetyError(f"Unknown media key '{key}'. Allowed: {allowed}.")

    user32 = ctypes.windll.user32
    user32.keybd_event(code, 0, 0, 0)
    user32.keybd_event(code, 0, KEYEVENTF_KEYUP, 0)

    # Windows gives no delivery signal: if no app has registered for media keys
    # the press is silently discarded, so this reports "sent", never "worked".
    return {"key": key, "sent": True}
