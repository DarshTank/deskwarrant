import { authenticateAgent } from "@/lib/api-auth";
import { VIEW_LOCAL_PORT } from "@/lib/cloudflare";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { handleRoute, json } from "@/lib/http";
import { isViewSessionAlive } from "@/lib/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 2_000;

/**
 * Cadence while an assistant turn is in flight, and how long "in flight" lasts
 * after the most recent job was created.
 *
 * A multi-step turn alternates model call -> job -> result -> model call, and
 * the agent can only collect a job on its next poll. The agent already re-polls
 * immediately after finishing work (agent/main.py), but that poll lands while
 * the console is still waiting on the model, finds nothing, and commits to a
 * full-length sleep -- so the *next* job sits idle for most of an interval. A
 * measured turn spent 1.85s of its 18s exactly there.
 *
 * Only devices that ran a job in the last window poll fast, so an idle fleet is
 * completely unaffected and the extra invocations are bounded by real activity.
 */
const ACTIVE_POLL_INTERVAL_MS = 600;
const TURN_ACTIVE_WINDOW_MS = 15_000;

/** Encoder defaults advertised to the agent, overridable in its own config. */
const VIEW_TARGET_FPS = 10;
const VIEW_TILE_SIZE = 128;
const VIEW_WEBP_QUALITY = 70;

/**
 * GET /api/agent/poll — the control plane's only inbound channel.
 *
 * Vercel functions cannot hold long-lived connections, so the agent polls and
 * the poll doubles as the heartbeat driving online/offline status (§5).
 *
 * `watchRules` is returned only when the device's configVersion has moved past
 * what the agent reports via ?configVersion=N, keeping the steady-state payload
 * small (§7.1).
 */
export async function GET(req: Request) {
  return handleRoute(async () => {
    const device = await authenticateAgent(req);
    const url = new URL(req.url);
    const agentConfigVersion = Number(url.searchParams.get("configVersion") ?? "0");

    const now = new Date();

    // Everything below that does not depend on another result travels in one
    // batch. Prisma's array-form $transaction ships the whole array to Postgres
    // as a single round trip, and round trips are what this route was actually
    // spending its time on: it used to make five to seven of them, every two
    // seconds, per device. Functions and the database now share a region
    // (vercel.json pins bom1 to match ap-south-1 Supabase), so each is cheap --
    // but this route runs often enough that the count still matters.
    //
    // The candidate select is safe to batch alongside the expiry sweep even
    // though it reads rows the sweep may retire: it filters on
    // `expiresAt >= now` itself, so an expired row can never reach it whether
    // or not the sweep has landed yet.
    const [, , candidates, viewSession, recentJob] = await prisma.$transaction([
      // Heartbeat.
      prisma.device.update({
        where: { id: device.id },
        data: { status: "ONLINE", lastSeenAt: now },
      }),
      // Sweep this device's stale work before handing out new work.
      prisma.job.updateMany({
        where: {
          deviceId: device.id,
          status: { in: ["PENDING", "AWAITING_CONFIRM"] },
          expiresAt: { lt: now },
        },
        data: { status: "EXPIRED", completedAt: now },
      }),
      prisma.job.findMany({
        where: {
          deviceId: device.id,
          status: "PENDING",
          expiresAt: { gte: now },
        },
        orderBy: { createdAt: "asc" },
        take: 20,
        select: { id: true },
      }),
      // Live view. `active` is what starts and stops `cloudflared` on the PC,
      // so a lapsed heartbeat here is what takes the machine back off the
      // internet.
      prisma.viewSession.findUnique({
        where: { deviceId: device.id },
        select: { id: true, lastHeartbeat: true, endedAt: true },
      }),
      // Recent job activity, in the same batch so it costs no extra round trip.
      // Any status counts: the gap worth closing is the one *after* a job
      // finishes, while the model decides what to call next.
      prisma.job.findFirst({
        where: {
          deviceId: device.id,
          createdAt: { gte: new Date(now.getTime() - TURN_ACTIVE_WINDOW_MS) },
        },
        select: { id: true },
      }),
    ]);

    // Claim atomically with a single UPDATE ... RETURNING: only rows still
    // PENDING are transitioned, and only the rows this statement transitioned
    // come back. A concurrent poll gets the rest, never a duplicate. (The
    // previous updateMany-then-reread pair needed two round trips to establish
    // the same thing, and leaned on `dispatchedAt` equality to do it.)
    let jobs: { id: string; toolName: string; args: unknown }[] = [];
    if (candidates.length > 0) {
      jobs = await prisma.job.updateManyAndReturn({
        where: { id: { in: candidates.map((c) => c.id) }, status: "PENDING" },
        data: { status: "DISPATCHED", dispatchedAt: now },
        select: { id: true, toolName: true, args: true },
      });
    }

    const viewActive = isViewSessionAlive(viewSession);

    const payload: Record<string, unknown> = {
      jobs,
      view: {
        active: viewActive,
        // Lets the agent tell one session from the next even when it never
        // observes the gap between them, so it re-reports tunnel state for a
        // fresh session instead of leaving the browser waiting on a stale one.
        sessionId: viewActive ? viewSession?.id : null,
        // The tunnel token is sent only while a session is live, so an idle
        // agent is not holding a runnable credential in memory for no reason.
        // Ingress is configured server-side against this exact port, so the
        // console is authoritative for it rather than the agent's config.
        tunnelToken:
          viewActive && device.tunnelTokenEnc
            ? decryptSecret(device.tunnelTokenEnc)
            : null,
        hostname: device.tunnelHostname,
        localPort: VIEW_LOCAL_PORT,
        fps: VIEW_TARGET_FPS,
        tileSize: VIEW_TILE_SIZE,
        quality: VIEW_WEBP_QUALITY,
      },
      pollIntervalMs: recentJob ? ACTIVE_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
      configVersion: device.configVersion,
    };

    // Deliberately left as its own round trip rather than folded into the batch
    // above: it fires only when the agent's configVersion has drifted, so
    // batching it would run the query on every steady-state poll to save a
    // round trip that almost never happens.
    if (agentConfigVersion !== device.configVersion) {
      const rules = await prisma.watchRule.findMany({
        where: { deviceId: device.id, enabled: true },
        select: {
          id: true,
          template: true,
          params: true,
          cooldownSeconds: true,
        },
      });
      payload.watchRules = rules;
    }

    return json(payload);
  });
}
