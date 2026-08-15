import { isDeviceOnline, requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { badRequest, handleRoute, json } from "@/lib/http";
import { isViewSessionAlive } from "@/lib/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/devices/:id/view/start
 *
 * Creates the session the agent watches for on poll. Seeing it, the agent
 * launches `cloudflared` and reports back as the tunnel comes up.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const device = await requireOwnedDevice(id, user.id);

    if (!isDeviceOnline(device.lastSeenAt)) {
      return badRequest("That PC is offline, so live view cannot start.");
    }

    const existing = await prisma.viewSession.findUnique({
      where: { deviceId: device.id },
    });

    // Re-entering an already-live session only refreshes the heartbeat.
    // Resetting tunnelState to STARTING here would strand the browser: the
    // agent reports each state once per session, so a tunnel already UP would
    // never announce itself again.
    if (isViewSessionAlive(existing)) {
      const session = await prisma.viewSession.update({
        where: { deviceId: device.id },
        data: { lastHeartbeat: new Date() },
      });
      return json({
        sessionId: session.id,
        tunnelState: session.tunnelState,
        tunnelError: session.tunnelError,
        resumed: true,
      });
    }

    const now = new Date();
    const session = await prisma.viewSession.upsert({
      where: { deviceId: device.id },
      create: { deviceId: device.id, userId: user.id },
      update: {
        userId: user.id,
        lastHeartbeat: now,
        startedAt: now,
        endedAt: null,
        tunnelState: "STARTING",
        tunnelError: null,
      },
    });

    return json({
      sessionId: session.id,
      tunnelState: session.tunnelState,
      tunnelError: session.tunnelError,
      resumed: false,
    });
  });
}
