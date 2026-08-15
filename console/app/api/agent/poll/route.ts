import { authenticateAgent } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json } from "@/lib/http";
import { isViewSessionAlive } from "@/lib/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 2_000;

/**
 * Live-view defaults advertised to the agent.
 *
 * The agent prefers whatever is in its own config.json — the local port is a
 * local binding fact, and the encoder settings are tuned per machine. These
 * travel in the poll so the contract is complete and a future console-side
 * setting has somewhere to live.
 */
const VIEW_LOCAL_PORT = 47_821;
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

    // Heartbeat.
    await prisma.device.update({
      where: { id: device.id },
      data: { status: "ONLINE", lastSeenAt: now },
    });

    // Sweep this device's stale work before handing out new work.
    await prisma.job.updateMany({
      where: {
        deviceId: device.id,
        status: { in: ["PENDING", "AWAITING_CONFIRM"] },
        expiresAt: { lt: now },
      },
      data: { status: "EXPIRED", completedAt: now },
    });

    // Claim pending jobs atomically: select ids, then transition only the rows
    // still PENDING. A second concurrent poll gets count 0 and no duplicates.
    const candidates = await prisma.job.findMany({
      where: { deviceId: device.id, status: "PENDING", expiresAt: { gte: now } },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { id: true, toolName: true, args: true },
    });

    let jobs: { id: string; toolName: string; args: unknown }[] = [];
    if (candidates.length > 0) {
      const ids = candidates.map((c) => c.id);
      await prisma.job.updateMany({
        where: { id: { in: ids }, status: "PENDING" },
        data: { status: "DISPATCHED", dispatchedAt: now },
      });
      const claimed = await prisma.job.findMany({
        where: { id: { in: ids }, status: "DISPATCHED", dispatchedAt: now },
        select: { id: true, toolName: true, args: true },
      });
      jobs = claimed.map((j) => ({
        id: j.id,
        toolName: j.toolName,
        args: j.args,
      }));
    }

    // Live view. `active` is what starts and stops `cloudflared` on the PC, so
    // a lapsed heartbeat here is what takes the machine back off the internet.
    const viewSession = await prisma.viewSession.findUnique({
      where: { deviceId: device.id },
      select: { id: true, lastHeartbeat: true, endedAt: true },
    });
    const viewActive = isViewSessionAlive(viewSession);

    const payload: Record<string, unknown> = {
      jobs,
      view: {
        active: viewActive,
        // Lets the agent tell one session from the next even when it never
        // observes the gap between them, so it re-reports tunnel state for a
        // fresh session instead of leaving the browser waiting on a stale one.
        sessionId: viewActive ? viewSession?.id : null,
        localPort: VIEW_LOCAL_PORT,
        fps: VIEW_TARGET_FPS,
        tileSize: VIEW_TILE_SIZE,
        quality: VIEW_WEBP_QUALITY,
      },
      pollIntervalMs: POLL_INTERVAL_MS,
      configVersion: device.configVersion,
    };

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
