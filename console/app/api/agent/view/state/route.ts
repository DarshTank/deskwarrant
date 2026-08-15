import { z } from "zod";
import { authenticateAgent } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A DNS label plus domain. Anchored and character-restricted because this
 * value is interpolated into the `wss://` URL handed to the browser.
 */
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const bodySchema = z.object({
  tunnelState: z.enum(["STARTING", "UP", "FAILED", "STOPPED"]),
  tunnelError: z.string().max(500).optional(),
  tunnelHostname: z.string().max(253).regex(HOSTNAME).optional(),
  tunnelName: z.string().max(128).optional(),
});

/**
 * POST /api/agent/view/state — the agent reporting on its tunnel.
 *
 * Also how the console learns the device's tunnel identity: hostname and name
 * are provisioned by hand on the PC (§8), and this is the agent telling the
 * console what they turned out to be. The console never mints them, so no
 * Cloudflare API token ever has to live on the device.
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    const device = await authenticateAgent(req);
    const body = await parseBody(req, bodySchema);

    if (body.tunnelHostname || body.tunnelName) {
      await prisma.device.update({
        where: { id: device.id },
        data: {
          ...(body.tunnelHostname
            ? { tunnelHostname: body.tunnelHostname.toLowerCase() }
            : {}),
          ...(body.tunnelName ? { tunnelName: body.tunnelName } : {}),
        },
      });
    }

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
