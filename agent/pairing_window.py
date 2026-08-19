"""The pairing code, shown on the PC.

The match code only defends anything if the person approving is looking at this
machine. That is the entire premise: someone sent a stranger's approval link has
no code in front of them and should press Deny. So the code has to be *visible*
-- not printed to a console the windowed build does not have, not buried in a
tray menu nobody thinks to right-click, and not in a log file.

Runs its own Tk mainloop on a dedicated thread. Tk is not thread-safe, so this
thread creates the root, owns it, and is the only thread that touches it; the
asyncio loop signals it to close through a threading.Event that a periodic
`after` callback polls.
"""

from __future__ import annotations

import logging
import threading
import webbrowser

log = logging.getLogger(__name__)

_BG = "#111113"
_FG = "#fafafa"
_MUTED = "#8b8b94"
_ACCENT = "#6366f1"

CLOSE_POLL_MS = 200


class PairingWindow:
    """A small always-on-top window showing the match code and approval link."""

    def __init__(self, code: str, url: str, hostname: str) -> None:
        self._code = code
        self._url = url
        self._hostname = hostname
        self._close = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(
            target=self._run, name="dw-pairing-window", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._close.set()
        if self._thread is not None:
            # Short join: the window is cosmetic and must never hold up pairing
            # or delay shutdown if Tk is wedged.
            self._thread.join(timeout=3.0)

    # ---------- the Tk thread ----------

    def _run(self) -> None:
        try:
            import tkinter as tk
        except ImportError:
            # A build without Tk still pairs -- the tray menu and the log carry
            # the code. Degrade quietly rather than failing the pairing.
            log.debug("tkinter unavailable; no pairing window")
            return

        try:
            root = tk.Tk()
        except Exception as exc:  # noqa: BLE001
            log.debug("Could not open the pairing window: %s", exc)
            return

        root.title("DeskWarrant - pair this PC")
        root.configure(bg=_BG)
        root.resizable(False, False)
        root.attributes("-topmost", True)

        # Closing the window must not cancel pairing: the agent is still
        # polling, and the code is still valid in the tray menu.
        root.protocol("WM_DELETE_WINDOW", lambda: self._close.set())

        frame = tk.Frame(root, bg=_BG, padx=32, pady=26)
        frame.pack()

        tk.Label(
            frame,
            text="PAIRING THIS PC",
            bg=_BG,
            fg=_MUTED,
            font=("Segoe UI", 9),
        ).pack()

        tk.Label(
            frame,
            text=self._hostname,
            bg=_BG,
            fg=_FG,
            font=("Segoe UI", 13, "bold"),
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
            text=" ".join(self._code),
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
            command=self._open,
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

        self._centre(root)

        def poll() -> None:
            if self._close.is_set():
                root.destroy()
                return
            root.after(CLOSE_POLL_MS, poll)

        root.after(CLOSE_POLL_MS, poll)

        try:
            root.mainloop()
        except Exception:  # noqa: BLE001
            log.debug("Pairing window closed unexpectedly", exc_info=True)

    def _open(self) -> None:
        try:
            webbrowser.open(self._url)
        except Exception as exc:  # noqa: BLE001
            log.debug("Could not open a browser: %s", exc)

    @staticmethod
    def _centre(root: object) -> None:
        root.update_idletasks()  # type: ignore[attr-defined]
        width = root.winfo_width()  # type: ignore[attr-defined]
        height = root.winfo_height()  # type: ignore[attr-defined]
        x = (root.winfo_screenwidth() - width) // 2  # type: ignore[attr-defined]
        y = (root.winfo_screenheight() - height) // 3  # type: ignore[attr-defined]
        root.geometry(f"+{x}+{y}")  # type: ignore[attr-defined]
