import { requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { badRequest, handleRoute, json, notFound } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/:id/cancel — reject a job awaiting confirmation.
 *
 * The job becomes CANCELLED, which the Assistant loop feeds back to the model
 * as "the user declined this action", so the turn ends with an acknowledgement
 * rather than a retry.
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

    await requireOwnedDevice(job.deviceId, user.id);

    if (!["AWAITING_CONFIRM", "PENDING"].includes(job.status)) {
      return badRequest(`This action can no longer be cancelled (status: ${job.status}).`);
    }

    const updated = await prisma.job.update({
      where: { id: job.id },
      data: { status: "CANCELLED", completedAt: new Date() },
    });

    return json({ ok: true, jobId: updated.id, status: updated.status });
  });
}
