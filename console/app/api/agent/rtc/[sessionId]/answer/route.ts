import { z } from "zod";
import { authenticateAgent } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json, notFound, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  answerSdp: z.string().min(1).max(64_000),
});

/**
 * POST /api/agent/rtc/:sessionId/answer
 *
 * Non-trickle ICE: the agent has already gathered every candidate before
 * posting, so this single SDP is the complete answer (build plan §5).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  return handleRoute(async () => {
    const device = await authenticateAgent(req);
    const { sessionId } = await params;
    const body = await parseBody(req, bodySchema);

    const session = await prisma.rtcSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.deviceId !== device.id) {
      return notFound("Session not found");
    }
    if (session.status !== "OFFERED") {
      return json({ ok: true, ignored: true, status: session.status });
    }

    await prisma.rtcSession.update({
      where: { id: session.id },
      data: { answerSdp: body.answerSdp, status: "ANSWERED" },
    });

    return json({ ok: true });
  });
}
