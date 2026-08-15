import { requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { badRequest, handleRoute, json } from "@/lib/http";
import { assertViewTokenQuota } from "@/lib/rate-limit";
import { hashToken } from "@/lib/tokens";
import {
  generateViewToken,
  isViewSessionAlive,
  VIEW_TOKEN_TTL_MS,
  viewSocketUrl,
} from "@/lib/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/devices/:id/view-token → { token, wsUrl, expiresAt }
 *
 * The plaintext token is returned once and never stored — only its SHA-256
 * hash is, exactly as device tokens are handled. The agent hands it back to
 * /api/agent/view-token/verify on every socket connect.
 *
 * Reusable within its 5-minute TTL rather than single-use: a dropped socket
 * would otherwise need a fresh round trip through the console before the user
 * could see their screen again.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const device = await requireOwnedDevice(id, user.id);

    if (!device.tunnelHostname) {
      return badRequest(
        device.tunnelError ??
          "Live view is not set up for this PC yet. Revoke it and pair it again.",
      );
    }

    const session = await prisma.viewSession.findUnique({
      where: { deviceId: device.id },
    });
    if (!isViewSessionAlive(session) || !session) {
      return badRequest("No active view session. Start live view first.");
    }

    await assertViewTokenQuota(device.id);

    const token = generateViewToken();
    const expiresAt = new Date(Date.now() + VIEW_TOKEN_TTL_MS);

    await prisma.viewToken.create({
      data: {
        sessionId: session.id,
        deviceId: device.id,
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt,
      },
    });

    return json({
      token,
      wsUrl: viewSocketUrl(device.tunnelHostname),
      expiresAt: expiresAt.toISOString(),
    });
  });
}
