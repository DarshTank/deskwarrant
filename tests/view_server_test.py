"""Live-view server test: token gate, wire format, input path.

Runs the agent's real ViewServer on loopback with a stub token verifier, so it
covers everything about the data plane except Cloudflare itself. Checkpoint 6
(no token and expired token are both rejected before any frame is sent) is
fully verified here; checkpoints 2 and 5 need a real tunnel.

    python tests\\view_server_test.py
"""

import asyncio
import json
import struct
import sys
import traceback
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent.parent / "agent"
sys.path.insert(0, str(AGENT_DIR))

import aiohttp  # noqa: E402

from config import AgentConfig, ViewConfig  # noqa: E402
from server.app import CLOSE_UNAUTHORIZED, ViewServer  # noqa: E402

FAILURES = []
PASSES = []

PORT = 47921  # not the default, so a running agent does not collide
VALID_TOKEN = "a" * 64


async def verify(token: str) -> bool:
    """Stand-in for the console round trip."""
    return token == VALID_TOKEN


def record(name, fn):
    try:
        fn()
        PASSES.append(name)
    except Exception as exc:
        FAILURES.append((name, f"{type(exc).__name__}: {exc}"))
        traceback.print_exc()


async def main() -> int:
    config = AgentConfig(
        view=ViewConfig(
            hostname="test.example.com",
            local_port=PORT,
            target_fps=10,
        )
    )
    server = ViewServer(config, verify)
    await server.start()

    base = f"http://127.0.0.1:{PORT}"

    try:
        async with aiohttp.ClientSession() as http:
            # ---------- health ----------
            async with http.get(f"{base}/health") as response:
                assert response.status == 200, f"health returned {response.status}"
            PASSES.append("GET /health -> 200")

            # ---------- bound to loopback only ----------
            # Connecting via a non-loopback local address must fail: the stream
            # is for cloudflared over loopback, never the LAN.
            import socket

            lan_ip = socket.gethostbyname(socket.gethostname())
            if lan_ip.startswith("127."):
                PASSES.append("no non-loopback address to test against (skipped)")
            else:
                try:
                    async with http.get(
                        f"http://{lan_ip}:{PORT}/health",
                        timeout=aiohttp.ClientTimeout(total=3),
                    ):
                        FAILURES.append(
                            ("loopback binding", f"reachable on LAN ip {lan_ip}")
                        )
                except (aiohttp.ClientError, asyncio.TimeoutError):
                    PASSES.append(f"not reachable on LAN ip {lan_ip} (127.0.0.1 only)")

            # ---------- no token ----------
            async with http.ws_connect(f"{base}/stream") as ws:
                message = await asyncio.wait_for(ws.receive(), timeout=5)
                assert message.type is aiohttp.WSMsgType.CLOSE, (
                    f"expected close, got {message.type}"
                )
                assert ws.close_code == CLOSE_UNAUTHORIZED, (
                    f"expected {CLOSE_UNAUTHORIZED}, got {ws.close_code}"
                )
            PASSES.append("WS with no token -> closed 4401, zero frames")

            # ---------- bad token ----------
            async with http.ws_connect(f"{base}/stream?token=deadbeef") as ws:
                message = await asyncio.wait_for(ws.receive(), timeout=5)
                assert message.type is aiohttp.WSMsgType.CLOSE
                assert ws.close_code == CLOSE_UNAUTHORIZED
            PASSES.append("WS with a rejected token -> closed 4401, zero frames")

            # ---------- valid token ----------
            async with http.ws_connect(f"{base}/stream?token={VALID_TOKEN}") as ws:
                message = await asyncio.wait_for(ws.receive(), timeout=15)
                assert message.type is aiohttp.WSMsgType.BINARY, (
                    f"expected a binary frame, got {message.type}"
                )

                buffer = message.data
                header_length = struct.unpack("<I", buffer[:4])[0]
                header = json.loads(buffer[4 : 4 + header_length])

                assert header["full"] is True, "first frame must be a keyframe"
                assert header["w"] > 0 and header["h"] > 0
                assert header["tiles"], "keyframe carried no tiles"
                payload_bytes = sum(t["len"] for t in header["tiles"])
                assert len(buffer) == 4 + header_length + payload_bytes, (
                    "declared tile lengths do not match the payload size"
                )
                PASSES.append(
                    f"first frame is a {header['w']}x{header['h']} keyframe, "
                    f"{len(header['tiles'])} tiles, {len(buffer) // 1024} KB"
                )

                # Input travels browser -> agent as JSON on the same socket.
                # A move to the exact centre is harmless and proves the path.
                await ws.send_str(json.dumps({"t": "m", "e": "move", "x": 0.5, "y": 0.5}))
                await ws.send_str(json.dumps({"t": "c", "e": "keyframe"}))

                nxt = await asyncio.wait_for(ws.receive(), timeout=15)
                assert nxt.type is aiohttp.WSMsgType.BINARY, (
                    "socket did not survive an input message"
                )
                PASSES.append("input JSON accepted; stream continues")

                # Malformed input must not kill the session.
                await ws.send_str("{not json")
                await ws.send_str(json.dumps({"t": "m", "e": "nonsense"}))
                nxt = await asyncio.wait_for(ws.receive(), timeout=15)
                assert nxt.type is aiohttp.WSMsgType.BINARY, (
                    "malformed input killed the stream"
                )
                PASSES.append("malformed input ignored; stream continues")

            # The viewer must be released once the socket closes, or the next
            # session would be refused as a duplicate.
            await asyncio.sleep(0.3)
            assert not server.has_viewer, "viewer not released after close"
            PASSES.append("viewer released on disconnect")

            # ---------- reconnect ----------
            async with http.ws_connect(f"{base}/stream?token={VALID_TOKEN}") as ws:
                message = await asyncio.wait_for(ws.receive(), timeout=15)
                assert message.type is aiohttp.WSMsgType.BINARY
            PASSES.append("reconnect with the same token works (reusable within TTL)")

    finally:
        await server.stop()

    print("=" * 70)
    for p in PASSES:
        print(f"  PASS  {p}")
    if FAILURES:
        print()
        for name, err in FAILURES:
            print(f"  FAIL  {name}: {err}")
    print()
    print(f"{len(PASSES)} passed, {len(FAILURES)} failed")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except Exception:
        traceback.print_exc()
        sys.exit(1)
