import { z } from "zod";
import { requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { badRequest, handleRoute, json, notFound, parseBody } from "@/lib/http";
import { isWatchTemplate, validateWatchParams } from "@/lib/watch/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  params: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
  cooldownSeconds: z.number().int().min(30).max(86_400).optional(),
});

async function bumpConfigVersion(deviceId: string) {
  await prisma.device.update({
    where: { id: deviceId },
    data: { configVersion: { increment: 1 } },
  });
}

/** PATCH /api/devices/:id/watch-rules/:ruleId */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; ruleId: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id, ruleId } = await params;
    const device = await requireOwnedDevice(id, user.id);
    const body = await parseBody(req, patchSchema);

    const rule = await prisma.watchRule.findUnique({ where: { id: ruleId } });
    if (!rule || rule.deviceId !== device.id) return notFound("Rule not found");

    const data: Record<string, unknown> = {};

    if (body.params !== undefined) {
      if (!isWatchTemplate(rule.template)) {
        return badRequest("This rule uses a template that no longer exists.");
      }
      const validated = validateWatchParams(rule.template, body.params);
      if (!validated.ok) {
        return badRequest(`Invalid parameters: ${validated.error}`);
      }
      data.params = validated.params;
    }
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.cooldownSeconds !== undefined) {
      data.cooldownSeconds = body.cooldownSeconds;
    }

    const updated = await prisma.watchRule.update({
      where: { id: rule.id },
      data,
    });
    await bumpConfigVersion(device.id);

    return json({
      rule: {
        id: updated.id,
        template: updated.template,
        params: updated.params,
        enabled: updated.enabled,
        cooldownSeconds: updated.cooldownSeconds,
        lastTriggeredAt: updated.lastTriggeredAt?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
      },
    });
  });
}

/** DELETE /api/devices/:id/watch-rules/:ruleId */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; ruleId: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id, ruleId } = await params;
    const device = await requireOwnedDevice(id, user.id);

    const rule = await prisma.watchRule.findUnique({ where: { id: ruleId } });
    if (!rule || rule.deviceId !== device.id) return notFound("Rule not found");

    await prisma.watchRule.delete({ where: { id: rule.id } });
    await bumpConfigVersion(device.id);

    return json({ ok: true });
  });
}
