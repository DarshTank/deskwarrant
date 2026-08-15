import { isDeviceOnline, requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json } from "@/lib/http";
import { isViewSessionAlive } from "@/lib/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/devices/:id/view — session status, polled by the browser while the
 * tunnel comes up (expect `UP` within 3–6s of /view/start).
 */
export async function GET(
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
    const active = isViewSessionAlive(session);

    return json({
      active,
      // A stale session's last known state is meaningless to the browser — the
      // agent has already stopped reporting on it.
      tunnelState: active ? session?.tunnelState : "STOPPED",
      tunnelError: active ? session?.tunnelError : null,
      tunnelHostname: device.tunnelHostname,
      // False before the one-time cloudflared setup has been recorded, which is
      // the difference between "starting up" and "will never work".
      tunnelConfigured: Boolean(device.tunnelHostname),
      deviceOnline: isDeviceOnline(device.lastSeenAt),
    });
  });
}
