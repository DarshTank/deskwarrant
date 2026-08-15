import { z } from "zod";
import { authenticateAgent } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json, parseBody } from "@/lib/http";
import { hashToken } from "@/lib/tokens";
import { isViewSessionAlive } from "@/lib/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(1).max(256),
});

/**
 * POST /api/agent/view-token/verify — agent-authenticated. Body `{ token }`.
 *
 * The agent asks on every socket connect rather than caching a token list
 * locally, which is what makes revocation instant: delete the device or stop
 * the session and tokens already in a browser's hands stop working at once.
 *
 * An invalid *view* token returns 200 `{ valid: false }`, not 401. A 401 here
 * means the agent's own device token is bad, and the agent responds to that by
 * wiping its credentials — conflating the two would make one stale browser tab
 * unpair the PC.
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    const device = await authenticateAgent(req);
    const body = await parseBody(req, bodySchema);

    const record = await prisma.viewToken.findUnique({
      where: { tokenHash: hashToken(body.token) },
      include: { session: true },
    });

    const valid =
      record !== null &&
      record.deviceId === device.id &&
      record.expiresAt.getTime() > Date.now() &&
      isViewSessionAlive(record.session);

    if (!valid) return json({ valid: false });

    return json({ valid: true, deviceId: device.id });
  });
}
