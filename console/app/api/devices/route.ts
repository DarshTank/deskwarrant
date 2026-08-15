import { isDeviceOnline, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface DeviceSummary {
  id: string;
  name: string;
  hostname: string;
  osVersion: string;
  agentVersion: string;
  online: boolean;
  lastSeenAt: string | null;
  pairedAt: string;
  unreadEvents: number;
}

/**
 * GET /api/devices — polled by the dashboard every 5s for live status.
 *
 * Online is derived from lastSeenAt at read time rather than trusting the
 * stored status column, so a device that dies without saying goodbye still goes
 * offline on schedule (build plan §7.1).
 */
export async function GET() {
  return handleRoute(async () => {
    const user = await requireUser();

    const devices = await prisma.device.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { pairedAt: "asc" },
      include: {
        _count: { select: { watchEvents: { where: { readAt: null } } } },
      },
    });

    const summaries: DeviceSummary[] = devices.map((d) => ({
      id: d.id,
      name: d.name,
      hostname: d.hostname,
      osVersion: d.osVersion,
      agentVersion: d.agentVersion,
      online: isDeviceOnline(d.lastSeenAt),
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      pairedAt: d.pairedAt.toISOString(),
      unreadEvents: d._count.watchEvents,
    }));

    return json({ devices: summaries });
  });
}
