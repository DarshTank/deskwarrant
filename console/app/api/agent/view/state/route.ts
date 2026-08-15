import { z } from "zod";
import { authenticateAgent } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  tunnelState: z.enum(["STARTING", "UP", "FAILED", "STOPPED"]),
  tunnelError: z.string().max(500).optional(),
});

/**
 * POST /api/agent/view/state — the agent reporting on its tunnel's liveness.
 *
 * Identity is not reported here: the console provisions the tunnel through the
 * Cloudflare API and already knows its id and hostname. The agent is only ever
 * telling us whether the process it was told to run is actually up.
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    const device = await authenticateAgent(req);
    const body = await parseBody(req, bodySchema);

    // updateMany, not update: with no session row there is nothing to report
    // on, and a stopped session must not be resurrected by a late report.
    await prisma.viewSession.updateMany({
      where: { deviceId: device.id, endedAt: null },
      data: {
        tunnelState: body.tunnelState,
        tunnelError: body.tunnelError ?? null,
      },
    });

    return json({ ok: true });
  });
}
