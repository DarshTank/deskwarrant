"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { api } from "@/lib/client-api";

/** Header of a frame message (build plan §5 wire format, unchanged). */
interface FrameHeader {
  seq: number;
  ts: number;
  w: number;
  h: number;
  full: boolean;
  /** Pointer position, normalised to the captured monitor. Absent when the
   *  cursor is on another display. */
  cx?: number;
  cy?: number;
  tiles: { x: number; y: number; w: number; h: number; len: number }[];
}

/** Neither of these is in every lib.dom we build against, and both are absent
 *  at runtime outside Chromium, so they are typed narrowly and called through
 *  optional chaining rather than assumed. */
type NavigatorWithKeyboard = Navigator & {
  keyboard?: { lock?: () => Promise<void>; unlock?: () => void };
};
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
};

interface ViewStatus {
  active: boolean;
  tunnelState: "STARTING" | "UP" | "FAILED" | "STOPPED";
  tunnelError: string | null;
  tunnelHostname: string | null;
  tunnelConfigured: boolean;
  deviceOnline: boolean;
}

type Phase = "idle" | "starting" | "connecting" | "live" | "failed" | "closed";
/** Quarter turns clockwise. The PC never learns about this -- rotation is
 *  purely how the browser presents the frames it already receives. */
type Rotation = 0 | 90 | 180 | 270;

const HEARTBEAT_INTERVAL_MS = 5_000;
const STATUS_POLL_INTERVAL_MS = 700;
/** The tunnel normally comes up in 3–6s; past 30s it is not coming up. */
const TUNNEL_TIMEOUT_MS = 30_000;
/** Same rule as the DataChannel had — only the property name changed. */
const BUFFER_HIGH_WATER_BYTES = 1_000_000;
/**
 * WebP quality requested per mode. Fullscreen scales the picture up, so the
 * artefacts that were invisible in a small window land on text and become the
 * first thing you notice. The agent clamps this and backpressure can still
 * override it downward, so asking high is safe.
 */
const QUALITY_WINDOWED = 70;
const QUALITY_FULLSCREEN = 88;

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
  const cursorRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // The unrotated box the rotated wrapper is centred in, and the only
  // rectangle pointer maths may be done against.
  const stageInnerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const stoppedRef = useRef(false);
  const startedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState<string>("Not connected");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ fps: 0, kbps: 0, seq: 0 });
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  // iOS Safari implements the Fullscreen API on <video> only, so on iPhone the
  // CSS fallback is not a nicety -- it is the only path there is.
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

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
    drawCursor(cursorRef.current, header);

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
    // Cleared here, in the handler, so a later reconnect starts windowed rather
    // than silently reopening full-screen.
    setPseudoFullscreen(false);

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
  const toNormalised = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const container = stageInnerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return null;
      if (canvas.width === 0 || canvas.height === 0) return null;

      // Measured on the UNROTATED container. getBoundingClientRect on the
      // rotated wrapper returns its axis-aligned bounding box, which at 90 and
      // 270 degrees is a different rectangle from the one the image sits in.
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;

      const [rx, ry] = unrotate(
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
        rotation,
      );

      // Past the un-rotation, the wrapper's own box is what the image was
      // fitted into, and at 90/270 that box is the container with its
      // dimensions swapped.
      const turned = rotation === 90 || rotation === 270;
      const boxW = turned ? rect.height : rect.width;
      const boxH = turned ? rect.width : rect.height;

      // object-contain letterboxes the bitmap inside that box, so the box and
      // the visible image are different rectangles. Mapping against the box
      // skews every coordinate by the width of the bars -- unnoticeable while
      // the panel happens to match the PC's aspect ratio, and glaring in
      // fullscreen on a phone, where it never does.
      const scale = Math.min(boxW / canvas.width, boxH / canvas.height);
      const shownW = canvas.width * scale;
      const shownH = canvas.height * scale;

      return {
        x: clamp01((rx * boxW - (boxW - shownW) / 2) / shownW),
        y: clamp01((ry * boxH - (boxH - shownH) / 2) / shownH),
      };
    },
    [rotation],
  );

  const live = phase === "live";
  // Gated on `live` rather than cleared by an effect when the stream dies:
  // deriving it means no death path can strand the viewer full-screen on a
  // black rectangle, and no setState cascades out of a render.
  const fullscreen = (nativeFullscreen || pseudoFullscreen) && live;
  const turned = rotation === 90 || rotation === 270;

  // Subscribed to rather than measured inline: ResizeObserver delivers the
  // first size in its own callback, so no setState happens during the effect.
  useEffect(() => {
    const el = stageInnerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setStageSize((prev) =>
        prev.w === box.width && prev.h === box.height
          ? prev
          : { w: box.width, h: box.height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * A quarter-turned view is sized with the container's dimensions swapped and
   * then rotated about its centre, so the turned box lands back exactly on the
   * container. That cannot be expressed in CSS alone inside a flex parent,
   * hence the measurement above. Before the first measurement it falls back to
   * filling the container, which is already correct at 0 degrees.
   */
  const stageMeasured = stageSize.w > 0 && stageSize.h > 0;
  const wrapperStyle: CSSProperties = stageMeasured
    ? {
        width: turned ? stageSize.h : stageSize.w,
        height: turned ? stageSize.w : stageSize.h,
        left: "50%",
        top: "50%",
        transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
      }
    : { width: "100%", height: "100%", left: 0, top: 0 };

  const rotate = useCallback(
    () => setRotation((r) => (((r + 90) % 360) as Rotation)),
    [],
  );

  // ---------- Fullscreen ----------

  const enterFullscreen = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (typeof stage.requestFullscreen !== "function") {
      setPseudoFullscreen(true);
      return;
    }
    try {
      await stage.requestFullscreen({ navigationUI: "hide" });
    } catch {
      // Permission-policy blocked, or an iPad pretending to be a desktop.
      setPseudoFullscreen(true);
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    setPseudoFullscreen(false);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        /* already gone */
      }
    }
  }, []);

  // The browser can leave fullscreen without us -- Esc, F11, the OS -- so the
  // flag is derived from the event, never from the call that requested it.
  useEffect(() => {
    const onChange = () => setNativeFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // The browser's own fullscreen has to be released explicitly. This touches
  // only the external API -- the React flag above is already derived.
  useEffect(() => {
    if (live || !document.fullscreenElement) return;
    void document.exitFullscreen().catch(() => {});
  }, [live]);

  useEffect(() => {
    if (!live) return;
    sendInput({
      t: "c",
      e: "quality",
      q: fullscreen ? QUALITY_FULLSCREEN : QUALITY_WINDOWED,
    });
  }, [fullscreen, live, sendInput]);

  useEffect(() => {
    if (!fullscreen) return;

    // Keyboard Lock exists for exactly this case: without it Ctrl+W closes the
    // browser tab instead of the window on the PC. Chromium-only, and harmless
    // where it is missing. Esc becomes ours too, so the browser switches to
    // hold-Esc to leave -- which is why the on-screen exit control stays.
    const keyboard = (navigator as NavigatorWithKeyboard).keyboard;
    void keyboard?.lock?.().catch(() => {});

    // A phone dimming mid-session is the most common way a remote session dies.
    let sentinel: { release: () => Promise<void> } | null = null;
    let released = false;
    void (navigator as NavigatorWithWakeLock).wakeLock
      ?.request("screen")
      .then((s) => {
        if (released) void s.release().catch(() => {});
        else sentinel = s;
      })
      .catch(() => {});

    // Landscape only works while actually fullscreen, and throws on desktop and
    // iOS. The attempt is free and the failure is expected.
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    void orientation?.lock?.("landscape").catch(() => {});

    return () => {
      keyboard?.unlock?.();
      released = true;
      void sentinel?.release().catch(() => {});
      void orientation?.unlock?.();
    };
  }, [fullscreen]);

  useEffect(() => {
    if (!interactive || !live) return;

    const onKey = (e: KeyboardEvent) => {
      // Windowed, keys only count while the canvas has focus, so the chat box
      // still types. Fullscreen there is nothing else to type into, and the
      // focus check would silently eat keys any time the browser moved focus.
      if (!fullscreen && document.activeElement !== canvasRef.current) return;
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
  }, [interactive, live, sendInput, fullscreen]);

  const busy = phase === "starting" || phase === "connecting";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-[clamp(12px,3vw,24px)] py-2.5">
        <span className="flex min-w-0 items-center gap-2 font-mono text-[12px] text-faint">
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              live
                ? "bg-signal dw-beat"
                : busy
                  ? "bg-warn dw-beat"
                  : phase === "failed"
                    ? "bg-danger"
                    : "bg-offline"
            }`}
            aria-hidden="true"
          />
          <span className="truncate">{detail}</span>
        </span>

        {live && (
          <span className="font-mono text-[12px] text-faint tabular-nums">
            {stats.fps} fps · {stats.kbps} kbit/s
          </span>
        )}

        <div className="ml-auto flex shrink-0 gap-2">
          {live && (
            <button
              type="button"
              onClick={rotate}
              title="Turn the view a quarter turn clockwise"
              className="rounded-full px-3 py-1.5 text-[13px] text-soft tabular-nums transition-colors hover:bg-ink/[0.05] hover:text-ink"
            >
              {rotation === 0 ? "Rotate" : `${rotation}°`}
            </button>
          )}
          {live && (
            <button
              type="button"
              onClick={() =>
                void (fullscreen ? exitFullscreen() : enterFullscreen())
              }
              className="rounded-full px-3 py-1.5 text-[13px] text-soft transition-colors hover:bg-ink/[0.05] hover:text-ink"
            >
              Full screen
            </button>
          )}
          {live && (
            <button
              type="button"
              onClick={() => sendInput({ t: "c", e: "keyframe" })}
              className="rounded-full px-3 py-1.5 text-[13px] text-soft transition-colors hover:bg-ink/[0.05] hover:text-ink"
            >
              Refresh
            </button>
          )}
          {busy ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="rounded-full border border-line px-4 py-1.5 text-[13px] font-medium text-soft transition-colors hover:border-ink/35 hover:text-ink"
            >
              Cancel
            </button>
          ) : live ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="rounded-full border border-line px-4 py-1.5 text-[13px] font-medium text-soft transition-colors hover:border-danger/45 hover:text-danger"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={!online}
              className="rounded-full bg-ink px-4 py-1.5 text-[13px] font-medium text-paper transition-opacity hover:opacity-85 disabled:opacity-35"
            >
              {online
                ? phase === "failed"
                  ? "Retry"
                  : "Start live view"
                : "PC offline"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="shrink-0 border-b border-danger/25 bg-danger/[0.07] px-[clamp(12px,3vw,24px)] py-2.5 text-[13px] text-danger">
          <p>{error}</p>
          {/* There is no degraded view mode to fall back to, so say plainly
              what still works rather than leaving a dead canvas on screen. */}
          <p className="mt-1 text-soft">
            Ask, Act and Watch are unaffected — they do not use the tunnel.
          </p>
        </div>
      )}

      <div
        ref={stageRef}
        className={`relative min-h-0 flex-1 bg-[#0b0b0d] ${
          fullscreen ? "p-0" : "p-[clamp(6px,1.5vw,12px)]"
        } ${pseudoFullscreen ? "fixed inset-0 z-50" : ""}`}
      >
        {/* Both canvases are absolutely stacked at the same size with the same
            object-contain, so the pointer layer letterboxes identically to the
            picture without any offset arithmetic -- and both turn together,
            because rotation is applied to the wrapper around the pair. */}
        <div
          ref={stageInnerRef}
          className="relative h-full w-full overflow-hidden"
        >
          <div className="absolute" style={wrapperStyle}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            className={`absolute inset-0 h-full w-full object-contain outline-none transition-opacity duration-500 focus-visible:ring-2 focus-visible:ring-signal ${
              fullscreen ? "" : "rounded-xl"
            } ${fullscreen ? "cursor-none" : ""} ${
              live ? "opacity-100" : "opacity-0"
            }`}
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
          <canvas
            ref={cursorRef}
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-500 ${
              live ? "opacity-100" : "opacity-0"
            }`}
          />
          </div>
        </div>

        {fullscreen && (
          <div className="absolute right-4 top-4 flex items-center gap-2 opacity-30 transition-opacity duration-200 focus-within:opacity-100 hover:opacity-100">
            <span className="hidden rounded-full bg-black/60 px-3 py-1.5 font-mono text-[11px] text-white/70 backdrop-blur sm:inline">
              hold Esc to exit
            </span>
            <button
              type="button"
              onClick={rotate}
              title="Turn the view a quarter turn clockwise"
              className="rounded-full bg-black/60 px-3 py-1.5 text-[13px] tabular-nums text-white/90 backdrop-blur transition-colors hover:bg-black/80"
            >
              {rotation === 0 ? "Rotate" : `${rotation}°`}
            </button>
            <button
              type="button"
              onClick={() => void exitFullscreen()}
              className="rounded-full bg-black/60 px-3 py-1.5 text-[13px] text-white/90 backdrop-blur transition-colors hover:bg-black/80"
            >
              Exit full screen
            </button>
          </div>
        )}

        {/* A landscape desktop inside a portrait phone is a letterboxed strip.
            The orientation lock handles Android; iOS has to be asked. */}
        {fullscreen && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 hidden justify-center portrait:flex">
            <span className="rounded-full bg-black/60 px-4 py-2 text-[13px] text-white/80 backdrop-blur">
              Rotate your device for a full-width view
            </span>
          </div>
        )}

        {/* An empty black rectangle reads as a broken player. Until frames
            arrive, the stage says what it is waiting for. */}
        {!live && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center">
            <div className="pointer-events-auto max-w-[34ch]">
              <EyeGlyph busy={busy} />
              <p className="mt-5 font-serif text-[clamp(20px,3vw,26px)] leading-tight tracking-[-0.02em] text-[#f2f1ee]">
                {busy
                  ? "Opening the tunnel…"
                  : phase === "failed"
                    ? "The screen did not come up."
                    : online
                      ? "The screen is off until you look."
                      : "This machine is offline."}
              </p>
              <p className="mt-3 text-[14px] leading-relaxed text-[#8f8c97]">
                {busy
                  ? "The PC is bringing up its tunnel. This takes a few seconds the first time."
                  : phase === "failed"
                    ? "Nothing is left running on the PC. Try again, or use chat — it does not need the tunnel."
                    : online
                      ? "Your PC becomes reachable only while this view is open, and stops seconds after you close it."
                      : "It has to be awake and online. There is no remote wake."}
              </p>
              {!busy && online && (
                <button
                  type="button"
                  onClick={() => void connect()}
                  className="mt-6 rounded-full bg-[#f2f1ee] px-5 py-2.5 text-[14px] font-medium text-[#0e0e11] transition-opacity hover:opacity-85"
                >
                  {phase === "failed" ? "Try again" : "Start live view"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {live && interactive && (
        <p className="shrink-0 border-t border-line px-[clamp(12px,3vw,24px)] py-2 text-[11.5px] text-faint">
          Click the screen to capture the keyboard. The agent runs unelevated —
          it cannot see the lock screen or UAC prompts.
        </p>
      )}
    </div>
  );
}

function EyeGlyph({ busy }: { busy: boolean }) {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#62d4b0"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`mx-auto ${busy ? "dw-beat" : ""}`}
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

// ---------- helpers ----------

/**
 * Paint the remote pointer on its own canvas, stacked over the video canvas.
 *
 * It gets a separate layer because unchanged tiles are never redrawn: a pointer
 * painted into the video canvas would leave a trail behind it everywhere the
 * screen happened to be static, which is most of the screen most of the time.
 */
function drawCursor(overlay: HTMLCanvasElement | null, header: FrameHeader) {
  if (!overlay) return;
  if (overlay.width !== header.w || overlay.height !== header.h) {
    overlay.width = header.w;
    overlay.height = header.h;
  }
  const ctx = overlay.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (typeof header.cx !== "number" || typeof header.cy !== "number") return;

  const x = header.cx * header.w;
  const y = header.cy * header.h;
  const s = 20;

  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, s);
  ctx.lineTo(s * 0.28, s * 0.75);
  ctx.lineTo(s * 0.46, s * 1.14);
  ctx.lineTo(s * 0.63, s * 1.06);
  ctx.lineTo(s * 0.45, s * 0.68);
  ctx.lineTo(s * 0.73, s * 0.64);
  ctx.closePath();
  // Outlined in black and filled white, the same way every OS draws it, so it
  // stays legible over both a dark terminal and a white document.
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
}

/**
 * Map a point in the displayed (rotated) box back onto the unrotated image.
 *
 * Forward, a quarter turn clockwise sends source (sx, sy) to (1 - sy, sx).
 * These are the inverses of that, applied before any letterbox correction --
 * without them a rotated view still renders correctly but every click lands
 * somewhere else on the PC, which is worse than not offering rotation at all.
 */
function unrotate(nx: number, ny: number, rotation: Rotation): [number, number] {
  switch (rotation) {
    case 90:
      return [ny, 1 - nx];
    case 180:
      return [1 - nx, 1 - ny];
    case 270:
      return [1 - ny, nx];
    default:
      return [nx, ny];
  }
}

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
