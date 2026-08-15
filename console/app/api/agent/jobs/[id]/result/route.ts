import { z } from "zod";
import { authenticateAgent } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json, notFound, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("DONE"), result: z.unknown().optional() }),
  z.object({ status: z.literal("FAILED"), error: z.string().max(2000) }),
]);

/** POST /api/agent/jobs/:id/result */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const device = await authenticateAgent(req);
    const { id } = await params;
    const body = await parseBody(req, bodySchema);

    const job = await prisma.job.findUnique({ where: { id } });
    // Ownership check: a device may only report on its own jobs.
    if (!job || job.deviceId !== device.id) {
      return notFound("Job not found");
    }

    // A job the server already gave up on stays EXPIRED — the model was told it
    // timed out, and flipping it to DONE now would contradict the transcript.
    if (job.status !== "DISPATCHED") {
      return json({ ok: true, ignored: true, status: job.status });
    }

    const updated = await prisma.job.update({
      where: { id: job.id },
      data:
        body.status === "DONE"
          ? {
              status: "DONE",
              result: (body.result ?? null) as object,
              completedAt: new Date(),
            }
          : {
              status: "FAILED",
              error: body.error,
              completedAt: new Date(),
            },
    });

    return json({ ok: true, status: updated.status });
  });
}
