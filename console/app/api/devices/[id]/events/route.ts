import { z } from "zod";
import { requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/devices/:id/events — the watch feed. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const device = await requireOwnedDevice(id, user.id);

    const limit = Math.min(
      Number(new URL(req.url).searchParams.get("limit") ?? "50") || 50,
      200,
    );

    const events = await prisma.watchEvent.findMany({
      where: { deviceId: device.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { rule: { select: { template: true } } },
    });

    return json({
      events: events.map((e) => ({
        id: e.id,
        message: e.message,
        payload: e.payload,
        template: e.rule.template,
        readAt: e.readAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  });
}

const patchSchema = z.object({
  /** Omit to mark every unread event on this device as read. */
  eventIds: z.array(z.string().max(64)).max(200).optional(),
});

/** PATCH /api/devices/:id/events — mark read. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const device = await requireOwnedDevice(id, user.id);
    const body = await parseBody(req, patchSchema);

    const result = await prisma.watchEvent.updateMany({
      where: {
        deviceId: device.id,
        readAt: null,
        ...(body.eventIds ? { id: { in: body.eventIds } } : {}),
      },
      data: { readAt: new Date() },
    });

    return json({ ok: true, marked: result.count });
  });
}
