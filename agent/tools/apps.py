"""Start Menu enumeration and app launching (build plan §8.2).

`open_path` deliberately cannot reach Program Files, so before this module the
assistant had no way to start an installed application at all. The fix is not to
widen the filesystem allowlist -- it is to stop the model supplying a path.

`list_apps` returns opaque ids; `launch_app` accepts only an id this agent
itself produced. That is the same indirection `hwnd` and `pid` already use, and
it means a prompt-injection payload cannot name a target that was never listed.

The two Start Menu roots live under %ProgramData% and %APPDATA%, and the former
is inside safety._DENIED_PREFIXES. That is not a bypass: nothing here takes a
caller-supplied path, so there is no path to validate. The enumeration roots are
fixed constants and the only thing a caller can choose is an id from the result.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

from config import AgentConfig
from safety import SafetyError, optional_str, require_str

log = logging.getLogger(__name__)

MAX_APPS = 400
MAX_SCAN_DEPTH = 5
CACHE_TTL_SECONDS = 60.0

_APP_ID_RE = re.compile(r"^[0-9a-f]{12}$")


class _ResolverUnavailable(RuntimeError):
    """Shortcut targets cannot be read at all, so no catalogue is trustworthy."""

# Launching one of these gives the model an interactive shell or interpreter. It
# cannot type into one today -- there is no type_text tool -- so a bare shell
# window is inert, but a capability that is useless to the user and useful to an
# attacker is not worth shipping. Matched on the resolved target's file name,
# which is precise; name matching below is only for links with no target at all.
#
# This list was checked against a real Start Menu, not written from memory:
# Git Bash, Git CMD, Node, Python and WSL all ship shortcuts that a cmd.exe-only
# denylist sails straight past.
_DENIED_TARGETS = {
    # Windows shells and script hosts
    "cmd.exe",
    "powershell.exe",
    "powershell_ise.exe",
    "pwsh.exe",
    "wt.exe",
    "openconsole.exe",
    "conhost.exe",
    "cscript.exe",
    "wscript.exe",
    "mshta.exe",
    "rundll32.exe",
    "regedit.exe",
    "regedt32.exe",
    "mmc.exe",
    # POSIX shells, usually via Git for Windows
    "bash.exe",
    "sh.exe",
    "git-bash.exe",
    "git-cmd.exe",
    # WSL distributions
    "wsl.exe",
    "wslg.exe",
    "ubuntu.exe",
    "debian.exe",
    # Language REPLs -- an interactive interpreter is a shell by another name
    "python.exe",
    "pythonw.exe",
    "py.exe",
    "pyw.exe",
    "node.exe",
    "perl.exe",
    "ruby.exe",
    "irb.exe",
    # Remote shells
    "ssh.exe",
    "telnet.exe",
}

# Second net, for shortcuts that resolve to no filesystem target at all (UWP and
# packaged apps). Matched as a substring of the lower-cased shortcut name.
_DENIED_NAME_FRAGMENTS = (
    "command prompt",
    "powershell",
    "registry editor",
    "windows terminal",
    "git bash",
    "git cmd",
)


def _start_menu_roots() -> list[Path]:
    """The machine-wide and per-user Start Menu program folders."""
    candidates = [
        os.path.join(
            os.environ.get("ProgramData", r"C:\ProgramData"),
            r"Microsoft\Windows\Start Menu\Programs",
        ),
        os.path.join(
            os.environ.get("APPDATA", ""),
            r"Microsoft\Windows\Start Menu\Programs",
        ),
    ]
    roots: list[Path] = []
    for entry in candidates:
        if not entry:
            continue
        try:
            path = Path(entry).resolve(strict=False)
        except (OSError, ValueError):
            continue
        if path.is_dir():
            roots.append(path)
    return roots


def _shell_api() -> tuple[Any, Any]:
    """The COM modules .lnk resolution needs, or a loud failure.

    Both are imported inside a function, which is precisely the shape
    PyInstaller cannot see -- so this is the first thing to break in a frozen
    build while working perfectly from source.
    """
    try:
        import pythoncom  # type: ignore[import-untyped]
        from win32com.shell import shell  # type: ignore[import-untyped]
    except ImportError as exc:
        raise _ResolverUnavailable(
            f"the Windows shell API is missing ({exc})"
        ) from exc
    return pythoncom, shell


def _resolve_target(lnk: Path, pythoncom: Any, shell: Any) -> str | None:
    """The executable a .lnk points at.

    Returns "" for the packaged and UWP shortcuts that legitimately have no
    path target -- they are still launchable through the .lnk itself, so that
    is not an error. Returns None when this particular link could not be read,
    which is different and must not be conflated: an unreadable link is one
    whose target the denylist was never able to check.
    """
    try:
        link = pythoncom.CoCreateInstance(
            shell.CLSID_ShellLink,
            None,
            pythoncom.CLSCTX_INPROC_SERVER,
            shell.IID_IShellLink,
        )
        link.QueryInterface(pythoncom.IID_IPersistFile).Load(str(lnk))
        # GetPath also hands back a WIN32_FIND_DATA, and pywin32 converts its
        # timestamps using win32timezone -- imported lazily, at this call, not
        # at module load. A frozen build missing it raises here, on every
        # single link, which is why the failure has to be counted below rather
        # than shrugged off.
        target, _find_data = link.GetPath(shell.SLGP_RAWPATH)
    except Exception:  # noqa: BLE001 - COM raises broadly on malformed links
        return None

    # SLGP_RAWPATH leaves %windir%-style variables unexpanded, and the denylist
    # compares file names, so they have to be expanded before that check.
    return os.path.expandvars(target or "").strip()


def _is_denied(name: str, target: str) -> bool:
    if target and Path(target).name.lower() in _DENIED_TARGETS:
        return True
    lowered = name.lower()
    return any(fragment in lowered for fragment in _DENIED_NAME_FRAGMENTS)


def _app_id(target: str, lnk: Path) -> str:
    """Stable id for one app.

    Keyed on the resolved target so the machine-wide and per-user shortcuts to
    the same program collapse to one entry, and so ids survive a restart.
    """
    basis = (target or str(lnk)).lower()
    return hashlib.sha1(basis.encode("utf-8", "replace")).hexdigest()[:12]


def _scan() -> dict[str, dict[str, Any]]:
    apps: dict[str, dict[str, Any]] = {}
    attempted = 0
    unreadable = 0

    pythoncom, shell = _shell_api()

    # One CoInitialize for the whole scan rather than one per shortcut: a full
    # Start Menu is a few hundred links and the COM setup dominates otherwise.
    pythoncom.CoInitialize()
    try:
        for root in _start_menu_roots():
            base_depth = len(root.parts)
            for dirpath, dirnames, filenames in os.walk(root, onerror=None):
                current = Path(dirpath)
                if len(current.parts) - base_depth >= MAX_SCAN_DEPTH:
                    dirnames[:] = []

                for filename in filenames:
                    if not filename.lower().endswith(".lnk"):
                        continue
                    if len(apps) >= MAX_APPS:
                        return apps

                    lnk = current / filename
                    name = lnk.stem
                    attempted += 1

                    target = _resolve_target(lnk, pythoncom, shell)
                    if target is None:
                        # Its target was never checked against the denylist, so
                        # listing it would be asserting something unverified.
                        unreadable += 1
                        continue

                    if _is_denied(name, target):
                        continue

                    app_id = _app_id(target, lnk)
                    # First shortcut wins. The machine-wide root is walked
                    # first, which is the copy more likely to be intact.
                    apps.setdefault(
                        app_id,
                        {
                            "appId": app_id,
                            "name": name,
                            "lnk": str(lnk),
                            "target": target,
                        },
                    )
    finally:
        pythoncom.CoUninitialize()

    # Every single link failing is not a Start Menu full of broken shortcuts,
    # it is the resolver itself being broken -- and the visible result would be
    # an empty app list with no explanation. Say so instead.
    if attempted > 0 and unreadable == attempted:
        raise _ResolverUnavailable(
            f"none of the {attempted} shortcuts could be read"
        )

    if unreadable:
        log.warning(
            "%d of %d Start Menu shortcuts were unreadable and were omitted",
            unreadable,
            attempted,
        )

    return apps


_cache: dict[str, Any] = {"at": 0.0, "apps": {}}


def _catalog(force: bool = False) -> dict[str, dict[str, Any]]:
    """The app table, rescanned at most once per TTL.

    Two tool calls landing on different executor threads may both scan. That
    wastes a walk but cannot corrupt anything -- the result is only ever
    published by rebinding, never mutated in place.
    """
    now = time.monotonic()
    if not force and _cache["apps"] and now - _cache["at"] < CACHE_TTL_SECONDS:
        return _cache["apps"]

    try:
        apps = _scan()
    except Exception as exc:  # noqa: BLE001
        log.exception("Start Menu scan failed")
        raise SafetyError(f"The installed app list could not be read: {exc}") from exc

    _cache["apps"] = apps
    _cache["at"] = now
    return apps


def list_apps(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    name_filter = (optional_str(args, "filter", max_length=64) or "").strip().lower()

    apps = _catalog()
    rows = [
        {"appId": app["appId"], "name": app["name"]}
        for app in apps.values()
        if not name_filter or name_filter in app["name"].lower()
    ]
    rows.sort(key=lambda a: a["name"].lower())

    return {
        "apps": rows,
        "count": len(rows),
        "truncated": len(apps) >= MAX_APPS,
    }


def launch_app(args: dict[str, Any], config: AgentConfig) -> dict[str, Any]:
    app_id = require_str(args, "appId", max_length=32).strip().lower()
    if not _APP_ID_RE.match(app_id):
        raise SafetyError("That is not a valid app id. Call list_apps first.")

    app = _catalog().get(app_id)
    if app is None:
        # The catalog may simply be stale -- an app installed since the last
        # scan has no id yet, and one uninstalled since then still does.
        app = _catalog(force=True).get(app_id)
    if app is None:
        raise SafetyError("No such app. Call list_apps for the current list.")

    # Re-checked at launch, not just at listing time. A denied app never gets an
    # id in the first place, so this can only fire if the denylist grew between
    # the scan and now -- but that is exactly when failing closed matters.
    if _is_denied(app["name"], app["target"]):
        raise SafetyError(f"{app['name']} cannot be launched from here.")

    lnk = Path(app["lnk"])
    if not lnk.exists():
        raise SafetyError(f"{app['name']} is no longer installed.")

    try:
        # The .lnk is opened rather than its target: shortcuts carry command
        # line arguments and a working directory that launching the exe loses.
        os.startfile(str(lnk))  # noqa: S606 - not a caller-supplied path
    except OSError as exc:
        raise SafetyError(f"Windows could not start {app['name']}: {exc}") from exc

    return {"appId": app_id, "name": app["name"], "launched": True}
