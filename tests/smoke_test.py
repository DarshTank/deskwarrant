"""Agent smoke test: imports, tool dispatch, allowlist, frame encoding."""

import asyncio
import json
import os
import struct
import sys
import traceback

from pathlib import Path

# Import the agent package from its sibling directory, so this runs from
# anywhere without an install step.
AGENT_DIR = Path(__file__).resolve().parent.parent / "agent"
sys.path.insert(0, str(AGENT_DIR))

FAILURES = []
PASSES = []


def check(name, fn):
    try:
        result = fn()
        PASSES.append(name)
        return result
    except Exception as exc:
        FAILURES.append((name, f"{type(exc).__name__}: {exc}"))
        traceback.print_exc()
        return None


def expect_raises(name, fn, exc_type):
    try:
        fn()
        FAILURES.append((name, "expected an exception, got none"))
    except exc_type as exc:
        PASSES.append(f"{name} -> refused: {str(exc)[:70]}")
    except Exception as exc:
        FAILURES.append((name, f"wrong exception {type(exc).__name__}: {exc}"))


print("=" * 70)
print("1. IMPORTS")
print("=" * 70)

check("import config", lambda: __import__("config"))
check("import credentials", lambda: __import__("credentials"))
check("import safety", lambda: __import__("safety"))
check("import transport", lambda: __import__("transport"))
check("import pairing", lambda: __import__("pairing"))
check("import tools", lambda: __import__("tools"))
check("import watch.rules", lambda: __import__("watch.rules", fromlist=["x"]))
check("import rtc.capture", lambda: __import__("rtc.capture", fromlist=["x"]))
check("import rtc.input", lambda: __import__("rtc.input", fromlist=["x"]))
check("import rtc.session", lambda: __import__("rtc.session", fromlist=["x"]))
check("import tray", lambda: __import__("tray"))
check("import main", lambda: __import__("main"))

from config import AgentConfig
from safety import SafetyError, resolve_allowed_path
from tools import REGISTRY, ToolError, dispatch

print()
print("=" * 70)
print("2. TOOL REGISTRY vs CONSOLE CATALOG")
print("=" * 70)

CONSOLE_TOOLS = {
    "list_processes", "list_windows", "read_window_text", "list_folder",
    "get_system_stats", "get_download_status", "focus_window",
    "minimize_window", "open_path", "set_volume", "close_window",
    "kill_process", "lock_workstation",
}
agent_tools = set(REGISTRY)
if agent_tools == CONSOLE_TOOLS:
    PASSES.append(f"registry matches console catalog ({len(agent_tools)} tools)")
else:
    FAILURES.append((
        "registry parity",
        f"agent-only={agent_tools - CONSOLE_TOOLS} console-only={CONSOLE_TOOLS - agent_tools}",
    ))

print()
print("=" * 70)
print("3. PATH ALLOWLIST (safety.py)")
print("=" * 70)

cfg = AgentConfig()
roots = cfg.resolved_roots()
print(f"   resolved roots: {[str(r) for r in roots]}")
if not roots:
    FAILURES.append(("allowlist roots", "no roots resolved"))

downloads = cfg.downloads_dir()
print(f"   downloads dir : {downloads}")

if downloads:
    check("allow Downloads", lambda: resolve_allowed_path(str(downloads), cfg))
    check("allow subpath of Downloads",
          lambda: resolve_allowed_path(str(downloads / "sub" / "file.txt"), cfg))

expect_raises("deny C:\\Windows\\System32",
              lambda: resolve_allowed_path(r"C:\Windows\System32", cfg), SafetyError)
expect_raises("deny C:\\Program Files",
              lambda: resolve_allowed_path(r"C:\Program Files", cfg), SafetyError)
expect_raises("deny traversal out of Downloads",
              lambda: resolve_allowed_path(str(downloads) + r"\..\..\..\Windows", cfg),
              SafetyError)
expect_raises("deny UNC path",
              lambda: resolve_allowed_path(r"\\server\share", cfg), SafetyError)
expect_raises("deny relative path",
              lambda: resolve_allowed_path("notes.txt", cfg), SafetyError)
expect_raises("deny empty path",
              lambda: resolve_allowed_path("", cfg), SafetyError)

print()
print("=" * 70)
print("4. READ TOOLS (live data)")
print("=" * 70)


async def run_tools():
    # list_processes
    procs = await dispatch("list_processes", {"limit": 5, "sortBy": "cpu"}, cfg)
    assert isinstance(procs, list) and procs, "no processes returned"
    first = procs[0]
    for key in ("pid", "name", "cpuPercent", "memoryMb", "status", "startedAt"):
        assert key in first, f"missing key {key}"
    PASSES.append(f"list_processes -> {len(procs)} rows, top={first['name']} "
                  f"cpu={first['cpuPercent']}%")

    # filter
    filtered = await dispatch("list_processes", {"filter": "python"}, cfg)
    PASSES.append(f"list_processes(filter=python) -> {len(filtered)} rows")

    # limit clamp
    try:
        await dispatch("list_processes", {"limit": 999}, cfg)
        FAILURES.append(("list_processes limit clamp", "999 was accepted"))
    except ToolError:
        PASSES.append("list_processes(limit=999) -> refused by re-validation")

    # get_system_stats
    stats = await dispatch("get_system_stats", {}, cfg)
    for key in ("cpuPercent", "ram", "disks", "uptimeSeconds"):
        assert key in stats, f"missing {key}"
    PASSES.append(
        f"get_system_stats -> cpu={stats['cpuPercent']}% "
        f"ram={stats['ram']['usedGb']}/{stats['ram']['totalGb']}GB "
        f"disks={len(stats['disks'])} battery={'battery' in stats}"
    )

    # list_windows
    wins = await dispatch("list_windows", {}, cfg)
    assert isinstance(wins, list)
    PASSES.append(f"list_windows -> {len(wins)} windows")
    if wins:
        w = wins[0]
        for key in ("hwnd", "title", "processName", "pid", "isMinimized", "isForeground"):
            assert key in w, f"missing {key}"
        PASSES.append(f"  top window: {w['title'][:45]!r} ({w['processName']})")

        # read_window_text on a real window
        text = await dispatch("read_window_text", {"hwnd": w["hwnd"]}, cfg)
        assert "title" in text and "text" in text
        PASSES.append(f"  read_window_text -> {len(text['text'])} chars"
                      + (" (note: no accessible text)" if not text["text"] else ""))

    # read_window_text on a bogus handle
    try:
        await dispatch("read_window_text", {"hwnd": 999999999}, cfg)
        FAILURES.append(("read_window_text bogus hwnd", "accepted"))
    except ToolError:
        PASSES.append("read_window_text(bogus hwnd) -> refused")

    # list_folder
    if downloads:
        entries = await dispatch("list_folder", {"path": str(downloads)}, cfg)
        assert isinstance(entries, list)
        PASSES.append(f"list_folder(Downloads) -> {len(entries)} entries")
        if entries:
            for key in ("name", "sizeBytes", "modifiedAt", "isDir", "isPartialDownload"):
                assert key in entries[0], f"missing {key}"

    # list_folder on a denied path -- the Stage 2 checkpoint
    try:
        await dispatch("list_folder", {"path": r"C:\Windows\System32"}, cfg)
        FAILURES.append(("list_folder System32", "ALLOWED - allowlist bypassed"))
    except ToolError as exc:
        PASSES.append(f"list_folder(System32) -> refused: {str(exc)[:60]}")

    # get_download_status
    dl = await dispatch("get_download_status", {}, cfg)
    assert "inProgress" in dl and "anyActive" in dl
    PASSES.append(f"get_download_status -> active={dl['anyActive']} "
                  f"partials={len(dl['inProgress'])}")

    # unknown tool
    try:
        await dispatch("rm_minus_rf", {}, cfg)
        FAILURES.append(("unknown tool", "accepted"))
    except ToolError:
        PASSES.append("unknown tool -> refused")

    # kill_process on a protected pid (defence in depth vs prompt injection)
    try:
        await dispatch("kill_process", {"pid": 4}, cfg)
        FAILURES.append(("kill_process(4)", "ALLOWED - protected pid killed"))
    except ToolError as exc:
        PASSES.append(f"kill_process(pid=4) -> refused: {str(exc)[:60]}")

    try:
        await dispatch("kill_process", {"pid": os.getpid()}, cfg)
        FAILURES.append(("kill_process(self)", "ALLOWED - agent killed itself"))
    except ToolError as exc:
        PASSES.append(f"kill_process(self) -> refused: {str(exc)[:60]}")


check("read tools", lambda: asyncio.run(run_tools()))

print()
print("=" * 70)
print("5. FRAME ENCODER + WIRE FORMAT")
print("=" * 70)


def test_encoder():
    from PIL import Image
    from rtc.capture import FrameEncoder

    enc = FrameEncoder(tile_size=128, quality=70)
    img = Image.new("RGB", (640, 480), (20, 20, 30))

    frame = enc.encode(img, force_full=True)
    assert frame, "no keyframe produced"

    header_len = struct.unpack("<I", frame[:4])[0]
    header = json.loads(frame[4:4 + header_len].decode("utf-8"))
    assert header["full"] is True
    assert header["w"] == 640 and header["h"] == 480
    # Partial edge tiles are covered too: ceil(640/128) x ceil(480/128).
    expected_tiles = -(-640 // 128) * -(-480 // 128)
    assert len(header["tiles"]) == expected_tiles, \
        f"expected {expected_tiles} tiles, got {len(header['tiles'])}"

    payload_total = sum(t["len"] for t in header["tiles"])
    assert 4 + header_len + payload_total == len(frame), \
        "declared tile lengths do not match the message size"
    PASSES.append(
        f"keyframe: {len(header['tiles'])} tiles, {len(frame)} bytes, "
        f"header {header_len}B"
    )

    # An identical frame must produce nothing at all.
    assert enc.encode(img, force_full=False) is None, \
        "unchanged frame still emitted tiles"
    PASSES.append("unchanged frame -> None (zero bandwidth when static)")

    # Change one tile only.
    img2 = img.copy()
    for x in range(10, 60):
        for y in range(10, 60):
            img2.putpixel((x, y), (255, 0, 0))
    delta = enc.encode(img2, force_full=False)
    assert delta, "changed frame produced nothing"
    dlen = struct.unpack("<I", delta[:4])[0]
    dheader = json.loads(delta[4:4 + dlen].decode("utf-8"))
    assert dheader["full"] is False
    assert len(dheader["tiles"]) == 1, \
        f"expected 1 changed tile, got {len(dheader['tiles'])}"
    assert dheader["tiles"][0]["x"] == 0 and dheader["tiles"][0]["y"] == 0
    PASSES.append(f"one changed region -> 1 tile, {len(delta)} bytes")

    # Resolution change forces a full frame.
    big = Image.new("RGB", (800, 600), (5, 5, 5))
    resized = enc.encode(big, force_full=False)
    rlen = struct.unpack("<I", resized[:4])[0]
    rheader = json.loads(resized[4:4 + rlen].decode("utf-8"))
    assert rheader["full"] is True, "resolution change did not force a keyframe"
    PASSES.append("resolution change -> forced keyframe")

    # Quality backpressure steps down and floors.
    q0 = enc.quality
    enc.lower_quality()
    assert enc.quality < q0
    for _ in range(10):
        enc.lower_quality()
    assert enc.quality == 25 and enc.lower_quality() is False
    PASSES.append(f"backpressure: quality {q0} -> floor {enc.quality}")


check("frame encoder", test_encoder)

print()
print("=" * 70)
print("6. SCREEN CAPTURE (real display)")
print("=" * 70)


def test_capture():
    from rtc.capture import FrameEncoder, ScreenGrabber

    grab = ScreenGrabber(0)
    try:
        img = grab.grab()
        assert img.size[0] > 0 and img.size[1] > 0
        enc = FrameEncoder(128, 70)
        frame = enc.encode(img, force_full=True)
        assert frame
        hl = struct.unpack("<I", frame[:4])[0]
        h = json.loads(frame[4:4 + hl].decode("utf-8"))
        PASSES.append(
            f"captured {grab.width}x{grab.height}, keyframe {len(frame) // 1024} KB, "
            f"{len(h['tiles'])} tiles"
        )
    finally:
        grab.close()


check("screen capture", test_capture)

print()
print("=" * 70)
print("7. INPUT MAPPING")
print("=" * 70)


def test_input():
    from rtc.input import _EXTENDED, _SCANCODES, InputInjector

    inj = InputInjector({})
    assert inj._absolute(0.0, 0.0) == (0, 0)
    assert inj._absolute(1.0, 1.0) == (65535, 65535)
    assert inj._absolute(0.5, 0.5) == (32768, 32768)
    assert inj._absolute(-5.0, 9.0) == (0, 65535), "out-of-range not clamped"
    PASSES.append("normalised 0-1 -> 0-65535 absolute mapping, clamped")

    for key in ("KeyA", "Enter", "ShiftLeft", "ControlLeft", "Space", "F1",
                "ArrowUp", "Delete", "Digit1", "Backspace", "Tab", "Escape"):
        assert key in _SCANCODES, f"{key} missing from the scancode table"
    assert _SCANCODES["KeyC"] == 0x2E and _SCANCODES["KeyV"] == 0x2F
    assert "ArrowUp" in _EXTENDED and "ControlRight" in _EXTENDED
    PASSES.append(f"scancode table: {len(_SCANCODES)} keys, "
                  f"{len(_EXTENDED)} extended")

    # Unmapped keys must be ignored, not crash.
    inj.key("NotARealKey", down=True)
    PASSES.append("unmapped key code ignored without raising")

    # release_all must clear tracked state (no real injection asserted here).
    inj._pressed.add("KeyA")
    inj.release_all()
    assert not inj._pressed
    PASSES.append("release_all clears held keys")


check("input mapping", test_input)

print()
print("=" * 70)
print("8. WATCH EVALUATOR")
print("=" * 70)


def test_watch():
    from watch.rules import WatchEvaluator

    ev = WatchEvaluator(cfg)
    ev.set_rules([
        {"id": "r1", "template": "DISK_LOW",
         "params": {"volume": "C:", "thresholdPercent": 99}, "cooldownSeconds": 600},
        {"id": "r2", "template": "PROCESS_EXITED",
         "params": {"processName": "definitely-not-running.exe"},
         "cooldownSeconds": 600},
        {"id": "r3", "template": "CPU_SUSTAINED_HIGH",
         "params": {"thresholdPercent": 100, "durationSeconds": 60},
         "cooldownSeconds": 600},
    ])
    assert ev.rule_count == 3

    # DISK_LOW at 99% free-threshold fires immediately (edge into condition).
    events = ev.evaluate()
    ids = {e["ruleId"] for e in events}
    assert "r1" in ids, "DISK_LOW did not fire at a 99% threshold"
    disk_event = next(e for e in events if e["ruleId"] == "r1")
    assert "message" in disk_event and "payload" in disk_event
    PASSES.append(f"DISK_LOW fired: {disk_event['message']}")

    # Edge-triggered: the same condition must NOT fire twice.
    events2 = ev.evaluate()
    assert "r1" not in {e["ruleId"] for e in events2}, \
        "DISK_LOW re-fired while the condition merely persisted"
    PASSES.append("DISK_LOW did not re-fire (edge-triggered, not level)")

    # PROCESS_EXITED must not fire on the baseline pass.
    assert "r2" not in ids, "PROCESS_EXITED fired on its first evaluation"
    PASSES.append("PROCESS_EXITED took a baseline instead of firing at startup")

    # A rule set swap drops stale state.
    ev.set_rules([])
    assert ev.rule_count == 0 and not ev._state
    PASSES.append("rule swap clears per-rule state")


check("watch evaluator", test_watch)

print()
print("=" * 70)
print("9. CONFIG ROUND TRIP")
print("=" * 70)


def test_config():
    from config import CaptureConfig
    c = AgentConfig(console_url="https://x.vercel.app/", poll_interval_ms=2000,
                    capture=CaptureConfig(tile_size=128, target_fps=10,
                                          webp_quality=70))
    d = c.capture.to_dict()
    assert d == {"tileSize": 128, "targetFps": 10, "webpQuality": 70}
    assert CaptureConfig.from_dict(d).tile_size == 128
    PASSES.append("capture config round trip matches the §12 JSON shape")


check("config", test_config)

print()
print("=" * 70)
print("RESULTS")
print("=" * 70)
for p in PASSES:
    print(f"  PASS  {p}")
print()
if FAILURES:
    for name, err in FAILURES:
        print(f"  FAIL  {name}: {err}")
    print()
    print(f"{len(PASSES)} passed, {len(FAILURES)} FAILED")
    sys.exit(1)
print(f"{len(PASSES)} passed, 0 failed")
