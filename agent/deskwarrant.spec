# PyInstaller spec for the DeskWarrant agent (build plan §10 Stage 8).
#
# Build:  .venv\Scripts\python.exe -m PyInstaller deskwarrant.spec --noconfirm
# Output: dist\DeskWarrantAgent.exe
#
# The binary is UNSIGNED, so SmartScreen will warn on first run. That is
# expected and documented in the README.

# ruff: noqa
from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

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
]

# aiortc and av pull in a large native tree; collecting submodules avoids a
# long tail of "module not found" failures at runtime.
hidden_imports += collect_submodules("aiortc")
hidden_imports += collect_submodules("av")

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Never needed by the agent and individually large.
        "tkinter",
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
    # console=True so first-run pairing can prompt for the code. Once paired,
    # install.ps1 registers the task to run minimized.
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
