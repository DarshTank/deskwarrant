import { z } from "zod";
import { requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { badRequest, handleRoute, json, parseBody } from "@/lib/http";
import {
  isWatchTemplate,
  validateWatchParams,
  watchCatalog,
} from "@/lib/watch/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  template: z.string().min(1).max(40),
  params: z.record(z.string(), z.unknown()).optional(),
  cooldownSeconds: z.number().int().min(30).max(86_400).optional(),
});

/**
 * Bumping configVersion is how the agent learns its rules changed: the next
 * poll sees a mismatch and receives the new rule set (§7.1).
 */
async function bumpConfigVersion(deviceId: string) {
  await prisma.device.update({
    where: { id: deviceId },
    data: { configVersion: { increment: 1 } },
  });
}

/** GET /api/devices/:id/watch-rules */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const device = await requireOwnedDevice(id, user.id);

    const rules = await prisma.watchRule.findMany({
      where: { deviceId: device.id },
      orderBy: { createdAt: "asc" },
    });

    return json({
      catalog: watchCatalog(),
      rules: rules.map((r) => ({
        id: r.id,
        template: r.template,
        params: r.params,
        enabled: r.enabled,
        cooldownSeconds: r.cooldownSeconds,
        lastTriggeredAt: r.lastTriggeredAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });
}

/** POST /api/devices/:id/watch-rules */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const device = await requireOwnedDevice(id, user.id);
    const body = await parseBody(req, createSchema);

    if (!isWatchTemplate(body.template)) {
      return badRequest(`Unknown watch template "${body.template}".`);
    }
    const validated = validateWatchParams(body.template, body.params ?? {});
    if (!validated.ok) {
      return badRequest(`Invalid parameters: ${validated.error}`);
    }

    const rule = await prisma.watchRule.create({
      data: {
        deviceId: device.id,
        template: body.template,
        params: validated.params as object,
        cooldownSeconds: body.cooldownSeconds ?? 600,
      },
    });
    await bumpConfigVersion(device.id);

    return json({
      rule: {
        id: rule.id,
        template: rule.template,
        params: rule.params,
        enabled: rule.enabled,
        cooldownSeconds: rule.cooldownSeconds,
        lastTriggeredAt: null,
        createdAt: rule.createdAt.toISOString(),
      },
    });
  });
}
