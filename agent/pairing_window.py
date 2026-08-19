"""The pairing code, shown on the PC.

The match code only defends anything if the person approving is looking at this
machine. That is the entire premise: someone sent a stranger's approval link has
no code in front of them and should press Deny. So the code has to be *visible*
-- not printed to a console the windowed build does not have, not buried in a
tray menu nobody thinks to right-click, and not in a log file.

The window runs in a SEPARATE PROCESS, and that is not incidental. Tkinter is
only supported on a process's main thread, and the agent's main thread belongs
to asyncio. Running Tk on a background thread instead appears to work and then
crashes the whole agent: the widgets are eventually garbage-collected from the
main thread, Tcl detects the cross-thread access, and aborts inside tcl86t.dll
with 0x80000003 -- taking the agent down seconds after pairing succeeded.

A child process sidesteps that completely. Tk owns its own main thread, which is
the supported arrangement, and anything that goes wrong in it is confined to a
throwaway process rather than killing the agent.
"""

from __future__ import annotations

import logging
import subprocess
import sys
from pathlib import Path

log = logging.getLogger(__name__)

_BG = "#111113"
_FG = "#fafafa"
_MUTED = "#8b8b94"
_ACCENT = "#6366f1"

STOP_GRACE_S = 3.0


class PairingWindow:
    """Spawns and reaps the child process that displays the code."""

    def __init__(self, code: str, url: str, hostname: str) -> None:
        self._code = code
        self._url = url
        self._hostname = hostname
        self._process: subprocess.Popen[bytes] | None = None

    def _command(self) -> list[str]:
        args = ["--show-pairing-code", self._code, self._url, self._hostname]
        if getattr(sys, "frozen", False):
            # The frozen agent re-invokes itself; sys.executable IS the agent.
            return [sys.executable, *args]
        return [sys.executable, str(Path(__file__).resolve().parent / "main.py"), *args]

    def start(self) -> None:
        try:
            self._process = subprocess.Popen(  # noqa: S603
                self._command(),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                # No console flash when the agent runs from Task Scheduler.
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except OSError as exc:
            # Pairing still works without it -- the code is in the tray menu and
            # the log -- so this must never be fatal.
            log.warning("Could not show the pairing window: %s", exc)

    def stop(self) -> None:
        process = self._process
        self._process = None
        if process is None or process.poll() is not None:
            return

        try:
            process.terminate()
            process.wait(timeout=STOP_GRACE_S)
        except subprocess.TimeoutExpired:
            try:
                process.kill()
            except OSError:
                pass
        except OSError as exc:
            log.debug("Could not close the pairing window: %s", exc)


def show_pairing_window(code: str, url: str, hostname: str) -> None:
    """Entry point for the child process. Runs Tk on ITS main thread."""
    import tkinter as tk
    import webbrowser

    root = tk.Tk()
    root.title("DeskWarrant - pair this PC")
    root.configure(bg=_BG)
    root.resizable(False, False)
    root.attributes("-topmost", True)

    frame = tk.Frame(root, bg=_BG, padx=32, pady=26)
    frame.pack()

    tk.Label(
        frame, text="PAIRING THIS PC", bg=_BG, fg=_MUTED, font=("Segoe UI", 9)
    ).pack()
    tk.Label(
        frame, text=hostname, bg=_BG, fg=_FG, font=("Segoe UI", 13, "bold")
    ).pack(pady=(2, 16))
    tk.Label(
        frame,
        text="Pick this code in your browser:",
        bg=_BG,
        fg=_FG,
        font=("Segoe UI", 10),
    ).pack()
    tk.Label(
        frame,
        text=" ".join(code),
        bg=_BG,
        fg=_ACCENT,
        font=("Consolas", 40, "bold"),
    ).pack(pady=(6, 16))
    tk.Label(
        frame,
        text="If your browser did not open, click below.",
        bg=_BG,
        fg=_MUTED,
        font=("Segoe UI", 9),
        wraplength=340,
    ).pack()

    tk.Button(
        frame,
        text="Open the approval page",
        command=lambda: webbrowser.open(url),
        bg=_ACCENT,
        fg="#ffffff",
        activebackground=_ACCENT,
        activeforeground="#ffffff",
        relief="flat",
        font=("Segoe UI", 10),
        padx=14,
        pady=7,
        cursor="hand2",
    ).pack(pady=(10, 0))

    tk.Label(
        frame,
        text="This window closes by itself once you approve.",
        bg=_BG,
        fg=_MUTED,
        font=("Segoe UI", 8),
    ).pack(pady=(14, 0))

    root.update_idletasks()
    x = (root.winfo_screenwidth() - root.winfo_width()) // 2
    y = (root.winfo_screenheight() - root.winfo_height()) // 3
    root.geometry(f"+{x}+{y}")

    root.mainloop()
