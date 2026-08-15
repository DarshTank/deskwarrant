import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(300),
    auth: z.string().min(1).max(300),
  }),
});

/**
 * POST /api/push/subscribe
 *
 * Endpoints are unique, so re-subscribing on the same browser updates the
 * owning user rather than creating a duplicate row.
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    const user = await requireUser();
    const body = await parseBody(req, bodySchema);

    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        userId: user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
      update: {
        userId: user.id,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });

    return json({ ok: true });
  });
}

/** DELETE — unsubscribe. */
export async function DELETE(req: Request) {
  return handleRoute(async () => {
    const user = await requireUser();
    const body = await parseBody(
      req,
      z.object({ endpoint: z.string().url().max(1000) }),
    );

    await prisma.pushSubscription.deleteMany({
      where: { endpoint: body.endpoint, userId: user.id },
    });

    return json({ ok: true });
  });
}
