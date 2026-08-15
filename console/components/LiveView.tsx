"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

interface TurnResponse {
  iceServers: IceServer[];
  turnConfigured: boolean;
  warning?: string;
}

/** Header of a frame message (build plan §5 wire format). */
interface FrameHeader {
  seq: number;
  ts: number;
  w: number;
  h: number;
  full: boolean;
  tiles: { x: number; y: number; w: number; h: number; len: number }[];
}

type Phase =
  | "idle"
  | "requesting-ice"
  | "gathering"
  | "signaling"
  | "waiting-answer"
  | "connecting"
  | "live"
  | "failed"
  | "closed";

const ANSWER_POLL_INTERVAL_MS = 500;
const ANSWER_TIMEOUT_MS = 30_000;
const ICE_GATHER_TIMEOUT_MS = 5_000;

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
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [iceState, setIceState] = useState<string>("new");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [stats, setStats] = useState({ fps: 0, kbps: 0, seq: 0 });

  // `since: 0` rather than Date.now(): reading the clock during render is an
  // impure call, and the first frame initialises the window anyway.
  const frameCounter = useRef({ frames: 0, bytes: 0, since: 0 });

  // ---------- Frame rendering ----------

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
    channelRef.current?.close();
    channelRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    setPhase("closed");
    setIceState("closed");

    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sessionId) {
      // Best effort: tell the agent to return to idle.
      await api(`/api/devices/${deviceId}/rtc/${sessionId}`, {
        method: "DELETE",
      }).catch(() => {});
    }
  }, [deviceId]);

  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  // ---------- Connect ----------

  const connect = useCallback(async () => {
    stoppedRef.current = false;
    setError(null);
    setWarning(null);
    setPhase("requesting-ice");

    try {
      const turn = await api<TurnResponse>("/api/turn-credentials");
      if (!turn.turnConfigured) {
        setWarning(
          turn.warning ??
            "TURN is not configured, so this will only connect on the same network.",
        );
      }

      const pc = new RTCPeerConnection({ iceServers: turn.iceServers });
      pcRef.current = pc;

      pc.oniceconnectionstatechange = () => {
        setIceState(pc.iceConnectionState);
        if (pc.iceConnectionState === "connected") setPhase("live");
        if (
          pc.iceConnectionState === "failed" ||
          pc.iceConnectionState === "disconnected"
        ) {
          setPhase("failed");
          setError(
            "The peer connection dropped. If this only happens off your home network, TURN relay is not working.",
          );
        }
      };

      const channel = pc.createDataChannel("deskwarrant", {
        ordered: true,
        // Frames are self-contained; a late tile is worse than a dropped one.
        maxRetransmits: 0,
      });
      channel.binaryType = "arraybuffer";
      channelRef.current = channel;

      channel.onopen = () => {
        setPhase("live");
        channel.send(JSON.stringify({ t: "c", e: "keyframe" }));
      };
      channel.onclose = () => {
        if (!stoppedRef.current) setPhase("closed");
      };
      channel.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          void drawFrame(event.data);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Non-trickle ICE (build plan §5): gather to completion, then post ONE
      // complete SDP. Costs 1–3s of setup and removes the need for any
      // persistent signalling connection.
      setPhase("gathering");
      await waitForIceGathering(pc);
      if (stoppedRef.current) return;

      setPhase("signaling");
      const { sessionId } = await api<{ sessionId: string }>(
        `/api/devices/${deviceId}/rtc/offer`,
        {
          method: "POST",
          json: { offerSdp: pc.localDescription?.sdp ?? offer.sdp },
        },
      );
      sessionIdRef.current = sessionId;

      setPhase("waiting-answer");
      const answerSdp = await pollForAnswer(deviceId, sessionId, stoppedRef);
      if (stoppedRef.current) return;
      if (!answerSdp) {
        throw new Error(
          "The PC did not answer. Check that the agent is running and online.",
        );
      }

      setPhase("connecting");
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (err) {
      if (stoppedRef.current) return;
      setPhase("failed");
      setError(err instanceof Error ? err.message : "Live view failed to start.");
    }
  }, [deviceId, drawFrame]);

  // ---------- Input (build plan §6) ----------

  const sendInput = useCallback((payload: unknown) => {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") return;
    try {
      channel.send(JSON.stringify(payload));
    } catch {
      /* channel closed underneath us */
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-xs">
        <span className="text-muted">
          {phaseLabel(phase)}
          {live && ` · ${stats.fps} fps · ${stats.kbps} kbit/s`}
        </span>
        <span className="font-mono text-muted">ice: {iceState}</span>
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
          {phase === "idle" || phase === "closed" || phase === "failed" ? (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={!online}
              className="rounded-md bg-accent px-3 py-1 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {online ? "Start live view" : "PC offline"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void stop()}
              className="rounded-md border border-border px-3 py-1 transition-colors hover:bg-surface"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {warning && (
        <p className="shrink-0 border-b border-warn/40 bg-warn/10 px-4 py-2 text-xs text-warn">
          {warning}
        </p>
      )}
      {error && (
        <p className="shrink-0 border-b border-danger/40 bg-danger/10 px-4 py-2 text-xs text-danger">
          {error}
        </p>
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

/** Resolve once ICE gathering completes, or after a timeout with what we have. */
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      pc.removeEventListener("icegatheringstatechange", onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    pc.addEventListener("icegatheringstatechange", onChange);
    // Some networks never report "complete"; ship whatever gathered by then.
    const timer = setTimeout(finish, ICE_GATHER_TIMEOUT_MS);
  });
}

async function pollForAnswer(
  deviceId: string,
  sessionId: string,
  stoppedRef: { current: boolean },
): Promise<string | null> {
  const deadline = Date.now() + ANSWER_TIMEOUT_MS;
  while (Date.now() < deadline && !stoppedRef.current) {
    const data = await api<{ status: string; answerSdp: string | null }>(
      `/api/devices/${deviceId}/rtc/${sessionId}`,
    ).catch(() => null);

    if (data?.status === "ANSWERED" && data.answerSdp) return data.answerSdp;
    if (data && ["FAILED", "EXPIRED", "CLOSED"].includes(data.status)) {
      return null;
    }
    await new Promise((r) => setTimeout(r, ANSWER_POLL_INTERVAL_MS));
  }
  return null;
}

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case "idle":
      return "Not connected";
    case "requesting-ice":
      return "Fetching relay credentials";
    case "gathering":
      return "Gathering network candidates";
    case "signaling":
      return "Sending offer";
    case "waiting-answer":
      return "Waiting for the PC";
    case "connecting":
      return "Connecting";
    case "live":
      return "Live";
    case "failed":
      return "Failed";
    case "closed":
      return "Disconnected";
  }
}
