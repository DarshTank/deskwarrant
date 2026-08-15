"""Mouse and keyboard injection via SendInput (build plan §6).

Two decisions matter here:

* Coordinates arrive normalised 0-1 and are mapped to the monitor here. The
  browser canvas is almost never the same size as the remote display, so raw
  pixels from the browser would be wrong on every device.
* Keys are injected as SCANCODES, not virtual key codes. Games and remote
  desktop clients read scancodes directly and ignore synthetic VK events, so
  scancodes work in far more applications.
"""

from __future__ import annotations

import ctypes
import logging
from ctypes import wintypes
from typing import Any

log = logging.getLogger(__name__)

user32 = ctypes.WinDLL("user32", use_last_error=True)

# ---------- SendInput structures ----------

INPUT_MOUSE = 0
INPUT_KEYBOARD = 1

MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_MIDDLEDOWN = 0x0020
MOUSEEVENTF_MIDDLEUP = 0x0040
MOUSEEVENTF_WHEEL = 0x0800
MOUSEEVENTF_ABSOLUTE = 0x8000

KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_SCANCODE = 0x0008

WHEEL_DELTA = 120

ULONG_PTR = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class _INPUTunion(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _INPUTunion)]


def _send(*inputs: INPUT) -> None:
    count = len(inputs)
    array = (INPUT * count)(*inputs)
    sent = user32.SendInput(count, array, ctypes.sizeof(INPUT))
    if sent != count:
        error = ctypes.get_last_error()
        # The usual cause is UIPI: a more-privileged window has focus and an
        # unelevated process may not inject into it. Nothing to do but log.
        log.warning("SendInput delivered %d/%d events (error %d)", sent, count, error)


# ---------- scancode table ----------
#
# Browser KeyboardEvent.code -> PS/2 set 1 make code.
# Entries in _EXTENDED additionally need the E0 prefix flag.

_SCANCODES: dict[str, int] = {
    "Escape": 0x01,
    "Digit1": 0x02, "Digit2": 0x03, "Digit3": 0x04, "Digit4": 0x05,
    "Digit5": 0x06, "Digit6": 0x07, "Digit7": 0x08, "Digit8": 0x09,
    "Digit9": 0x0A, "Digit0": 0x0B,
    "Minus": 0x0C, "Equal": 0x0D, "Backspace": 0x0E, "Tab": 0x0F,
    "KeyQ": 0x10, "KeyW": 0x11, "KeyE": 0x12, "KeyR": 0x13, "KeyT": 0x14,
    "KeyY": 0x15, "KeyU": 0x16, "KeyI": 0x17, "KeyO": 0x18, "KeyP": 0x19,
    "BracketLeft": 0x1A, "BracketRight": 0x1B, "Enter": 0x1C,
    "ControlLeft": 0x1D,
    "KeyA": 0x1E, "KeyS": 0x1F, "KeyD": 0x20, "KeyF": 0x21, "KeyG": 0x22,
    "KeyH": 0x23, "KeyJ": 0x24, "KeyK": 0x25, "KeyL": 0x26,
    "Semicolon": 0x27, "Quote": 0x28, "Backquote": 0x29,
    "ShiftLeft": 0x2A, "Backslash": 0x2B,
    "KeyZ": 0x2C, "KeyX": 0x2D, "KeyC": 0x2E, "KeyV": 0x2F, "KeyB": 0x30,
    "KeyN": 0x31, "KeyM": 0x32,
    "Comma": 0x33, "Period": 0x34, "Slash": 0x35, "ShiftRight": 0x36,
    "NumpadMultiply": 0x37, "AltLeft": 0x38, "Space": 0x39, "CapsLock": 0x3A,
    "F1": 0x3B, "F2": 0x3C, "F3": 0x3D, "F4": 0x3E, "F5": 0x3F, "F6": 0x40,
    "F7": 0x41, "F8": 0x42, "F9": 0x43, "F10": 0x44,
    "NumLock": 0x45, "ScrollLock": 0x46,
    "Numpad7": 0x47, "Numpad8": 0x48, "Numpad9": 0x49, "NumpadSubtract": 0x4A,
    "Numpad4": 0x4B, "Numpad5": 0x4C, "Numpad6": 0x4D, "NumpadAdd": 0x4E,
    "Numpad1": 0x4F, "Numpad2": 0x50, "Numpad3": 0x51, "Numpad0": 0x52,
    "NumpadDecimal": 0x53,
    "F11": 0x57, "F12": 0x58,
    # Extended (E0-prefixed) keys.
    "NumpadEnter": 0x1C, "ControlRight": 0x1D, "NumpadDivide": 0x35,
    "AltRight": 0x38,
    "Home": 0x47, "ArrowUp": 0x48, "PageUp": 0x49, "ArrowLeft": 0x4B,
    "ArrowRight": 0x4D, "End": 0x4F, "ArrowDown": 0x50, "PageDown": 0x51,
    "Insert": 0x52, "Delete": 0x53,
    "MetaLeft": 0x5B, "MetaRight": 0x5C, "ContextMenu": 0x5D,
}

_EXTENDED = {
    "NumpadEnter", "ControlRight", "NumpadDivide", "AltRight",
    "Home", "ArrowUp", "PageUp", "ArrowLeft", "ArrowRight", "End",
    "ArrowDown", "PageDown", "Insert", "Delete",
    "MetaLeft", "MetaRight", "ContextMenu",
}


class InputInjector:
    """Maps normalised events onto the captured monitor's pixel space."""

    def __init__(self, monitor: dict[str, int]) -> None:
        self.monitor = monitor
        self._pressed: set[str] = set()

    # ---------- mouse ----------

    def _absolute(self, x: float, y: float) -> tuple[int, int]:
        """Normalised 0-1 -> the 0-65535 space SendInput expects.

        MOUSEEVENTF_ABSOLUTE without MOUSEEVENTF_VIRTUALDESK is relative to the
        PRIMARY monitor, which is exactly what v1 captures.
        """
        clamped_x = min(1.0, max(0.0, x))
        clamped_y = min(1.0, max(0.0, y))
        return int(round(clamped_x * 65535)), int(round(clamped_y * 65535))

    def move(self, x: float, y: float) -> None:
        dx, dy = self._absolute(x, y)
        _send(
            INPUT(
                type=INPUT_MOUSE,
                mi=MOUSEINPUT(dx, dy, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, 0, 0),
            )
        )

    def button(self, x: float, y: float, button: int, down: bool) -> None:
        # Move first so the click lands where the user pointed, even if a
        # preceding move message was dropped.
        self.move(x, y)
        flags = {
            0: (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
            1: (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
            2: (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        }.get(button)
        if flags is None:
            return
        _send(
            INPUT(
                type=INPUT_MOUSE,
                mi=MOUSEINPUT(0, 0, 0, flags[0] if down else flags[1], 0, 0),
            )
        )

    def wheel(self, x: float, y: float, delta: float) -> None:
        self.move(x, y)
        # Browser deltaY is positive when scrolling DOWN; Windows wheel data is
        # positive when scrolling UP (away from the user). Hence the negation.
        notches = int(round(-delta / 100.0)) or (-1 if delta > 0 else 1)
        amount = notches * WHEEL_DELTA
        _send(
            INPUT(
                type=INPUT_MOUSE,
                mi=MOUSEINPUT(0, 0, amount & 0xFFFFFFFF, MOUSEEVENTF_WHEEL, 0, 0),
            )
        )

    # ---------- keyboard ----------

    def key(self, code: str, down: bool) -> None:
        scan = _SCANCODES.get(code)
        if scan is None:
            log.debug("Ignoring unmapped key code %s", code)
            return

        flags = KEYEVENTF_SCANCODE
        if code in _EXTENDED:
            flags |= KEYEVENTF_EXTENDEDKEY
        if not down:
            flags |= KEYEVENTF_KEYUP

        if down:
            self._pressed.add(code)
        else:
            self._pressed.discard(code)

        _send(INPUT(type=INPUT_KEYBOARD, ki=KEYBDINPUT(0, scan, flags, 0, 0)))

    def release_all(self) -> None:
        """Release every key still held when a session ends.

        Without this, disconnecting mid-chord leaves Ctrl or Shift latched down
        on the physical machine, which is a genuinely nasty state to leave a
        user in.
        """
        for code in list(self._pressed):
            self.key(code, down=False)
        self._pressed.clear()

    # ---------- dispatch ----------

    def handle(self, message: dict[str, Any]) -> None:
        kind = message.get("t")

        if kind == "m":
            event = message.get("e")
            x = float(message.get("x", 0.0))
            y = float(message.get("y", 0.0))
            if event == "move":
                self.move(x, y)
            elif event == "down":
                self.button(x, y, int(message.get("b", 0)), down=True)
            elif event == "up":
                self.button(x, y, int(message.get("b", 0)), down=False)
            elif event == "wheel":
                self.wheel(x, y, float(message.get("d", 0.0)))

        elif kind == "k":
            code = message.get("code")
            if isinstance(code, str):
                self.key(code, down=message.get("e") == "down")
