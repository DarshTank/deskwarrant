import { randomBytes } from "node:crypto";
import type { ViewSession } from "@prisma/client";

/**
 * Live-view session and token rules (migration §4, §5.3).
 *
 * The session's heartbeat is the only thing keeping `cloudflared` alive on the
 * PC. Let it lapse and the agent kills the tunnel, so the public hostname stops
 * resolving — which is what keeps the machine off the public internet except
 * while someone is actually watching.
 */

/** The browser heartbeats every 5s; four missed beats ends the session. */
export const VIEW_SESSION_STALE_MS = 20_000;

/** Long enough to survive a reconnect, short enough that a leak expires fast. */
export const VIEW_TOKEN_TTL_MS = 5 * 60_000;

export function isViewSessionAlive(
  session: Pick<ViewSession, "endedAt" | "lastHeartbeat"> | null,
): boolean {
  if (!session || session.endedAt) return false;
  return Date.now() - session.lastHeartbeat.getTime() < VIEW_SESSION_STALE_MS;
}

/** 32 random bytes as hex. Returned to the browser once; only its hash is stored. */
export function generateViewToken(): string {
  return randomBytes(32).toString("hex");
}

/** The agent's WebSocket endpoint, through the device's tunnel hostname. */
export function viewSocketUrl(hostname: string): string {
  return `wss://${hostname}/stream`;
}
