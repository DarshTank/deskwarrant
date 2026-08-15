import { z } from "zod";
import { isDeviceOnline, requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { deprovisionTunnel } from "@/lib/cloudflare";
import { prisma } from "@/lib/db";
import { handleRoute, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(60),
});

/** GET /api/devices/:id */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const device = await requireOwnedDevice(id, user.id);

    return json({
      device: {
        id: device.id,
        name: device.name,
        hostname: device.hostname,
        osVersion: device.osVersion,
        agentVersion: device.agentVersion,
        online: isDeviceOnline(device.lastSeenAt),
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        pairedAt: device.pairedAt.toISOString(),
      },
    });
  });
}

/** PATCH /api/devices/:id — rename */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const device = await requireOwnedDevice(id, user.id);
    const body = await parseBody(req, patchSchema);

    const updated = await prisma.device.update({
      where: { id: device.id },
      data: { name: body.name.trim() },
    });

    return json({ device: { id: updated.id, name: updated.name } });
  });
}

/**
 * DELETE /api/devices/:id — revoke.
 *
 * The row is kept (jobs and conversations reference it) but the token stops
 * authenticating, so the agent's next poll gets 401 and wipes its stored
 * credentials.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const device = await requireOwnedDevice(id, user.id);

    await prisma.$transaction([
      prisma.device.update({
        where: { id: device.id },
        data: { revokedAt: new Date(), status: "OFFLINE" },
      }),
      // Nothing queued should survive revocation.
      prisma.job.updateMany({
        where: {
          deviceId: device.id,
          status: { in: ["PENDING", "AWAITING_CONFIRM", "DISPATCHED"] },
        },
        data: { status: "CANCELLED", completedAt: new Date() },
      }),
      // End any live view and kill its tokens. The agent revalidates every
      // socket connect against the console, so this drops an in-flight viewer
      // immediately rather than at the next heartbeat.
      prisma.viewToken.deleteMany({ where: { deviceId: device.id } }),
      prisma.viewSession.updateMany({
        where: { deviceId: device.id, endedAt: null },
        data: { endedAt: new Date(), tunnelState: "STOPPED" },
      }),
    ]);

    // Tear down the Cloudflare side so the hostname stops resolving and the
    // account does not accumulate dead tunnels. Best effort by design: the
    // user must be able to revoke a PC even if Cloudflare is unreachable.
    await deprovisionTunnel({
      tunnelId: device.tunnelId,
      hostname: device.tunnelHostname,
    });
    await prisma.device.update({
      where: { id: device.id },
      data: { tunnelId: null, tunnelHostname: null, tunnelTokenEnc: null },
    });

    return json({ ok: true });
  });
}
