import { requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { badRequest, handleRoute, json, notFound } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/:id/confirm — approve a job in AWAITING_CONFIRM.
 *
 * Moving it to PENDING is what makes it visible to the agent's next poll. The
 * expiry is extended from this moment, because the 60s clock should measure the
 * agent's responsiveness, not how long the user took to decide.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;

    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return notFound("Job not found");

    // Ownership flows through the device.
    await requireOwnedDevice(job.deviceId, user.id);

    if (job.status !== "AWAITING_CONFIRM") {
      return badRequest(
        `This action is no longer awaiting confirmation (status: ${job.status}).`,
      );
    }
    if (job.expiresAt < new Date()) {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "EXPIRED", completedAt: new Date() },
      });
      return badRequest("This action expired before it was confirmed.");
    }

    const now = new Date();
    const updated = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "PENDING",
        confirmedAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      },
    });

    return json({ ok: true, jobId: updated.id, status: updated.status });
  });
}
