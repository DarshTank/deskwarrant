import { requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/devices/:id/view/stop
 *
 * Ends the session immediately rather than waiting for the heartbeat to lapse,
 * so closing the tab takes the tunnel down in seconds instead of ~20.
 *
 * Outstanding tokens are deleted with it: the agent revalidates every socket
 * connect against this session, so a token in a stale tab dies here too.
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
      select: { id: true },
    });

    if (!session) return json({ ok: true });

    await prisma.$transaction([
      prisma.viewToken.deleteMany({ where: { sessionId: session.id } }),
      prisma.viewSession.update({
        where: { deviceId: device.id },
        data: { endedAt: new Date(), tunnelState: "STOPPED" },
      }),
    ]);

    return json({ ok: true });
  });
}
