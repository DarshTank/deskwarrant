# PyInstaller spec for the DeskWarrant agent (build plan §10 Stage 8).
#
# Build:  .venv\Scripts\python.exe -m PyInstaller deskwarrant.spec --noconfirm
# Output: dist\DeskWarrantAgent.exe
#
# The binary is UNSIGNED, so SmartScreen will warn on first run. That is
# expected and documented in the README.

# ruff: noqa
import shutil
from pathlib import Path

block_cipher = None

# cloudflared ships beside the exe (~30 MB). Looked up here at build time from
# PATH, or from agent\cloudflared.exe if you dropped a copy in. tunnel.py finds
# it again at runtime by checking the same places.
_cloudflared = shutil.which("cloudflared") or str(
    Path(SPECPATH) / "cloudflared.exe"
)
_binaries = []
if Path(_cloudflared).is_file():
    _binaries.append((_cloudflared, "."))
else:
    print(
        "  WARNING: cloudflared.exe was not found, so live view will not work "
        "in this build. Install cloudflared or place it in agent\\."
    )

hidden_imports = [
    # keyring resolves its backend at runtime by entry point, which PyInstaller
    # cannot see statically. Without this the frozen agent finds no backend and
    # cannot read the device token.
    "keyring.backends.Windows",
    "win32timezone",
    # COM stack used by uiautomation, pycaw, and read_window_text.
    "comtypes",
    "comtypes.stream",
    "pycaw",
    "pycaw.pycaw",
    # Tray backend is selected at runtime.
    "pystray._win32",
    # Both are imported inside functions so an agent that never pairs does not
    # pay for Tk. Named here so the Tcl/Tk runtime is definitely bundled --
    # without it the pairing window silently degrades and the match code
    # becomes unreadable, which is the one thing it exists to prevent.
    "pairing_window",
    "tkinter",
]

# The live-view stack is imported lazily inside main.py, so PyInstaller cannot
# see it from the import graph.
hidden_imports += [
    "aiohttp",
    "server.app",
    "server.tunnel",
    "server.capture",
    "server.input",
]

# Written by the release workflow, absent in a source checkout. config.py
# imports it inside a try/except, which PyInstaller cannot always follow.
if Path(SPECPATH, "_build_config.py").is_file():
    hidden_imports.append("_build_config")
else:
    print(
        "  NOTE: _build_config.py is absent, so this build has no console URL "
        "baked in and will ask for one on first run."
    )

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=_binaries,
    datas=[],
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Never needed by the agent and individually large. tkinter is NOT
        # excluded: the pairing window is the only place the user can read the
        # match code, and a windowed build has no console to print it to.
        "matplotlib",
        "numpy.distutils",
        "pytest",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="DeskWarrantAgent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    # No console window. Pairing no longer prompts for anything -- it opens a
    # claim and sends the user to the browser -- so a black terminal would only
    # make an ordinary app look like a script, and closing it would kill the
    # agent. The tray icon is the UI; fatal errors get a message box.
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
