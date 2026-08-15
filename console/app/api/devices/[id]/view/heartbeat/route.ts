import { requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json, notFound } from "@/lib/http";
import { isViewSessionAlive } from "@/lib/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/devices/:id/view/heartbeat — called by the browser every 5s.
 *
 * This is the tunnel's dead-man's switch. Stop calling it and the agent stops
 * seeing an active session, kills `cloudflared`, and the PC drops off the
 * public internet.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const device = await requireOwnedDevice(id, user.id);

    const session = await prisma.viewSession.findUnique({
      where: { deviceId: device.id },
    });

    // A lapsed session is not silently revived: the agent has already torn the
    // tunnel down, so the browser must go through /view/start again.
    if (!isViewSessionAlive(session)) {
      return notFound("No active view session. Start live view again.");
    }

    const updated = await prisma.viewSession.update({
      where: { deviceId: device.id },
      data: { lastHeartbeat: new Date() },
    });

    return json({
      ok: true,
      tunnelState: updated.tunnelState,
      tunnelError: updated.tunnelError,
    });
  });
}
