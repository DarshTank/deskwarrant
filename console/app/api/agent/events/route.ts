import { z } from "zod";
import { authenticateAgent } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json, parseBody } from "@/lib/http";
import { sendPushToUser } from "@/lib/push";
import { assertEventQuota } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  events: z
    .array(
      z.object({
        ruleId: z.string().min(1).max(64),
        message: z.string().min(1).max(500),
        payload: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(20),
});

/**
 * POST /api/agent/events
 *
 * The agent evaluates rules locally and reports triggers. Cooldown is enforced
 * HERE rather than on the agent: the server owns lastTriggeredAt, so an agent
 * that restarts (losing its in-memory state) still cannot spam notifications.
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    const device = await authenticateAgent(req);
    const body = await parseBody(req, bodySchema);

    await assertEventQuota(device.id, body.events.length);

    const now = new Date();
    const accepted: { message: string; eventId: string }[] = [];

    for (const incoming of body.events) {
      const rule = await prisma.watchRule.findUnique({
        where: { id: incoming.ruleId },
      });
      if (!rule || rule.deviceId !== device.id || !rule.enabled) continue;

      if (rule.lastTriggeredAt) {
        const readyAt =
          rule.lastTriggeredAt.getTime() + rule.cooldownSeconds * 1000;
        if (readyAt > now.getTime()) continue; // suppressed by cooldown
      }

      const event = await prisma.$transaction(async (tx) => {
        // Re-assert the cooldown inside the transaction so two agent posts
        // arriving together cannot both pass the check above.
        const claimed = await tx.watchRule.updateMany({
          where: {
            id: rule.id,
            OR: [
              { lastTriggeredAt: null },
              {
                lastTriggeredAt: {
                  lt: new Date(now.getTime() - rule.cooldownSeconds * 1000),
                },
              },
            ],
          },
          data: { lastTriggeredAt: now },
        });
        if (claimed.count === 0) return null;

        return tx.watchEvent.create({
          data: {
            ruleId: rule.id,
            deviceId: device.id,
            message: incoming.message,
            payload: (incoming.payload ?? null) as object,
          },
        });
      });

      if (event) {
        accepted.push({ message: event.message, eventId: event.id });
      }
    }

    // Notify after the rows are committed; push failure must not lose an event.
    for (const item of accepted) {
      await sendPushToUser(device.userId, {
        title: device.name,
        body: item.message,
        deviceId: device.id,
        eventId: item.eventId,
      });
    }

    return json({ ok: true, accepted: accepted.length });
  });
}
