"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

/** Header of a frame message (build plan §5 wire format, unchanged). */
interface FrameHeader {
  seq: number;
  ts: number;
  w: number;
  h: number;
  full: boolean;
  tiles: { x: number; y: number; w: number; h: number; len: number }[];
}

interface ViewStatus {
  active: boolean;
  tunnelState: "STARTING" | "UP" | "FAILED" | "STOPPED";
  tunnelError: string | null;
  tunnelHostname: string | null;
  tunnelConfigured: boolean;
  deviceOnline: boolean;
}

type Phase = "idle" | "starting" | "connecting" | "live" | "failed" | "closed";

const HEARTBEAT_INTERVAL_MS = 5_000;
const STATUS_POLL_INTERVAL_MS = 700;
/** The tunnel normally comes up in 3–6s; past 30s it is not coming up. */
const TUNNEL_TIMEOUT_MS = 30_000;
/** Same rule as the DataChannel had — only the property name changed. */
const BUFFER_HIGH_WATER_BYTES = 1_000_000;

export function LiveView({
  deviceId,
  online,
  interactive = true,
}: {
  deviceId: string;
  online: boolean;
  interactive?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const stoppedRef = useRef(false);
  const startedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState<string>("Not connected");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ fps: 0, kbps: 0, seq: 0 });

  // `since: 0` rather than Date.now(): reading the clock during render is an
  // impure call, and the first frame initialises the window anyway.
  const frameCounter = useRef({ frames: 0, bytes: 0, since: 0 });

  // ---------- Frame rendering (unchanged: same wire format) ----------

  const drawFrame = useCallback(async (buffer: ArrayBuffer) => {
    const view = new DataView(buffer);
    if (buffer.byteLength < 4) return;
    const headerLength = view.getUint32(0, true); // uint32 LE
    if (buffer.byteLength < 4 + headerLength) return;

    const headerBytes = new Uint8Array(buffer, 4, headerLength);
    let header: FrameHeader;
    try {
      header = JSON.parse(new TextDecoder().decode(headerBytes)) as FrameHeader;
    } catch {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== header.w || canvas.height !== header.h) {
      canvas.width = header.w;
      canvas.height = header.h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Payloads are concatenated in header order, immediately after the header.
    let offset = 4 + headerLength;
    const decodes: Promise<void>[] = [];

    for (const tile of header.tiles) {
      const slice = buffer.slice(offset, offset + tile.len);
      offset += tile.len;
      if (slice.byteLength === 0) continue;
      const blob = new Blob([slice], { type: "image/webp" });
      decodes.push(
        createImageBitmap(blob)
          .then((bitmap) => {
            ctx.drawImage(bitmap, tile.x, tile.y);
            bitmap.close();
          })
          .catch(() => {
            /* a corrupt tile is dropped; the next keyframe repairs it */
          }),
      );
    }

    await Promise.all(decodes);

    const counter = frameCounter.current;
    if (counter.since === 0) counter.since = Date.now();
    counter.frames += 1;
    counter.bytes += buffer.byteLength;
    const elapsed = Date.now() - counter.since;
    if (elapsed >= 1000) {
      setStats({
        fps: Math.round((counter.frames * 1000) / elapsed),
        kbps: Math.round((counter.bytes * 8) / elapsed), // bytes/ms → kbit/s
        seq: header.seq,
      });
      counter.frames = 0;
      counter.bytes = 0;
      counter.since = Date.now();
    }
  }, []);

  // ---------- Teardown ----------

  const stop = useCallback(async () => {
    stoppedRef.current = true;
    socketRef.current?.close();
    socketRef.current = null;
    setPhase("closed");
    setDetail("Disconnected");

    if (!startedRef.current) return;
    startedRef.current = false;

    // Ends the session now rather than waiting ~20s for the heartbeat to
    // lapse, so cloudflared exits on the PC within a few seconds.
    await api(`/api/devices/${deviceId}/view/stop`, { method: "POST" }).catch(
      () => {},
    );
  }, [deviceId]);

  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  // The unmount cleanup does not run when the tab is closed outright, and a
  // session left open would hold the tunnel up for its full 20s timeout.
  useEffect(() => {
    const onUnload = () => {
      if (!startedRef.current) return;
      navigator.sendBeacon?.(`/api/devices/${deviceId}/view/stop`);
    };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, [deviceId]);

  // ---------- Heartbeat ----------

  useEffect(() => {
    // `starting` is included deliberately. It is the longest phase — waiting
    // for the tunnel is allowed to take TUNNEL_TIMEOUT_MS (30s), which is
    // longer than VIEW_SESSION_STALE_MS (20s) — so a session that does not
    // beat while starting can die before the browser ever connects.
    if (phase !== "starting" && phase !== "connecting" && phase !== "live") {
      return;
    }

    const beat = () => {
      void api(`/api/devices/${deviceId}/view/heartbeat`, {
        method: "POST",
      }).catch(() => {
        /* one missed beat is harmless; four in a row ends the session */
      });
    };

    // Beat immediately, not only after the first interval elapses. `phase` is
    // a dependency, so every transition tears this effect down and rebuilds
    // it; with interval-only beats a transition landing mid-interval resets
    // the timer, and a session could reach its 20s deadline having sent none.
    beat();
    const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [deviceId, phase]);

  // ---------- Connect ----------

  const connect = useCallback(async () => {
    stoppedRef.current = false;
    setError(null);
    setPhase("starting");
    setDetail("Starting secure connection…");

    try {
      await api(`/api/devices/${deviceId}/view/start`, { method: "POST" });
      startedRef.current = true;

      const status = await waitForTunnel(deviceId, stoppedRef, setDetail);
      if (stoppedRef.current) return;

      if (status.tunnelState !== "UP") {
        throw new Error(
          status.tunnelError ??
            (status.tunnelConfigured
              ? "The PC could not open its tunnel."
              : "This PC has no Cloudflare tunnel configured yet. Run the one-time setup in the README."),
        );
      }

      setPhase("connecting");
      setDetail("Opening the stream…");

      const { token, wsUrl } = await api<{ token: string; wsUrl: string }>(
        `/api/devices/${deviceId}/view-token`,
        { method: "POST" },
      );
      if (stoppedRef.current) return;

      const socket = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        setPhase("live");
        setDetail("Live");
        socket.send(JSON.stringify({ t: "c", e: "keyframe" }));
      };
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) void drawFrame(event.data);
      };
      socket.onerror = () => {
        if (stoppedRef.current) return;
        setPhase("failed");
        setError("The connection to your PC dropped.");
      };
      socket.onclose = (event) => {
        if (stoppedRef.current) return;
        if (event.code === 4401) {
          setPhase("failed");
          setError(
            "Your PC rejected the access token. Try starting live view again.",
          );
          return;
        }
        setPhase("closed");
        setDetail("Disconnected");
      };
    } catch (err) {
      if (stoppedRef.current) return;
      setPhase("failed");
      setError(err instanceof Error ? err.message : "Live view failed to start.");

      // End the session now instead of letting the heartbeat lapse, so the PC
      // stops trying to hold a tunnel up. Deliberately not `stop()`: that would
      // set phase to "closed" and hide the error the user needs to read.
      if (startedRef.current) {
        startedRef.current = false;
        void api(`/api/devices/${deviceId}/view/stop`, { method: "POST" }).catch(
          () => {},
        );
      }
    }
  }, [deviceId, drawFrame]);

  // ---------- Input (build plan §6, message shapes unchanged) ----------

  const sendInput = useCallback((payload: unknown) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    // Never queue input behind a congested socket: a stale click is worse than
    // a dropped one.
    if (socket.bufferedAmount > BUFFER_HIGH_WATER_BYTES) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      /* socket closed underneath us */
    }
  }, []);

  /**
   * Coordinates are normalised 0–1 and mapped to monitor pixels on the agent.
   * The canvas is almost never the same size as the remote display, so sending
   * raw pixels would be wrong on every device.
   */
  const toNormalised = useCallback((e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  }, []);

  const live = phase === "live";

  useEffect(() => {
    if (!interactive || !live) return;

    const onKey = (e: KeyboardEvent) => {
      // Only capture when the canvas has focus, so the chat box still types.
      if (document.activeElement !== canvasRef.current) return;
      e.preventDefault();
      sendInput({
        t: "k",
        e: e.type === "keydown" ? "down" : "up",
        code: e.code,
        mods:
          (e.shiftKey ? 1 : 0) |
          (e.ctrlKey ? 2 : 0) |
          (e.altKey ? 4 : 0) |
          (e.metaKey ? 8 : 0),
      });
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [interactive, live, sendInput]);

  const busy = phase === "starting" || phase === "connecting";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-xs">
        <span className="text-muted">
          {detail}
          {live && ` · ${stats.fps} fps · ${stats.kbps} kbit/s`}
        </span>
        <div className="ml-auto flex gap-2">
          {live && (
            <button
              type="button"
              onClick={() => sendInput({ t: "c", e: "keyframe" })}
              className="rounded-md border border-border px-2 py-1 text-muted transition-colors hover:text-foreground"
            >
              Refresh
            </button>
          )}
          {busy ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="rounded-md border border-border px-3 py-1 transition-colors hover:bg-surface"
            >
              Cancel
            </button>
          ) : live ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="rounded-md border border-border px-3 py-1 transition-colors hover:bg-surface"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={!online}
              className="rounded-md bg-accent px-3 py-1 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {online
                ? phase === "failed"
                  ? "Retry live view"
                  : "Start live view"
                : "PC offline"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="shrink-0 border-b border-danger/40 bg-danger/10 px-4 py-2 text-xs text-danger">
          <p>{error}</p>
          {/* There is no degraded view mode to fall back to, so say plainly
              what still works rather than leaving a dead canvas on screen. */}
          <p className="mt-1 text-muted">
            Ask, Act, and Watch are unaffected — they do not use the tunnel.
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 bg-black/90 p-2">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          className="h-full w-full object-contain outline-none focus:ring-1 focus:ring-accent"
          onPointerMove={(e) => {
            if (!interactive || !live) return;
            const p = toNormalised(e);
            if (p) sendInput({ t: "m", e: "move", ...p });
          }}
          onPointerDown={(e) => {
            if (!interactive || !live) return;
            canvasRef.current?.focus();
            const p = toNormalised(e);
            if (p) sendInput({ t: "m", e: "down", ...p, b: e.button });
          }}
          onPointerUp={(e) => {
            if (!interactive || !live) return;
            const p = toNormalised(e);
            if (p) sendInput({ t: "m", e: "up", ...p, b: e.button });
          }}
          onWheel={(e) => {
            if (!interactive || !live) return;
            const p = toNormalised(e);
            if (p) sendInput({ t: "m", e: "wheel", ...p, d: e.deltaY });
          }}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      {live && interactive && (
        <p className="shrink-0 border-t border-border px-4 py-1.5 text-[11px] text-muted">
          Click the screen to capture the keyboard. The agent runs unelevated —
          it cannot see the lock screen or UAC prompts.
        </p>
      )}
    </div>
  );
}

// ---------- helpers ----------

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Poll session status until the tunnel is up, fails, or the deadline passes.
 *
 * Returns the last status seen rather than throwing on timeout, so the caller
 * can report the actual state the PC got stuck in.
 */
async function waitForTunnel(
  deviceId: string,
  stoppedRef: { current: boolean },
  onProgress: (message: string) => void,
): Promise<ViewStatus> {
  const deadline = Date.now() + TUNNEL_TIMEOUT_MS;
  let last: ViewStatus = {
    active: false,
    tunnelState: "STARTING",
    tunnelError: null,
    tunnelHostname: null,
    tunnelConfigured: true,
    deviceOnline: true,
  };

  while (Date.now() < deadline && !stoppedRef.current) {
    const status = await api<ViewStatus>(
      `/api/devices/${deviceId}/view`,
    ).catch(() => null);

    if (status) {
      last = status;
      if (status.tunnelState === "UP") return status;
      if (status.tunnelState === "FAILED") return status;
      if (!status.deviceOnline) {
        return { ...status, tunnelError: "That PC went offline." };
      }
    }

    onProgress("Starting secure connection…");
    await new Promise((r) => setTimeout(r, STATUS_POLL_INTERVAL_MS));
  }

  return {
    ...last,
    tunnelState: "FAILED",
    tunnelError:
      last.tunnelError ?? "The PC did not bring its tunnel up in time.",
  };
}
