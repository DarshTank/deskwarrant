import { requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json, notFound } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/devices/:id/rtc/:sessionId → { status, answerSdp }
 *
 * The browser polls this after posting its offer. Non-trickle ICE means one
 * complete answer arrives at once and no further signalling is needed.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id, sessionId } = await params;
    const device = await requireOwnedDevice(id, user.id);

    const session = await prisma.rtcSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.deviceId !== device.id) {
      return notFound("Session not found");
    }

    if (session.status === "OFFERED" && session.expiresAt < new Date()) {
      await prisma.rtcSession.update({
        where: { id: session.id },
        data: { status: "EXPIRED" },
      });
      return json({ status: "EXPIRED", answerSdp: null });
    }

    return json({
      status: session.status,
      answerSdp: session.answerSdp ?? null,
    });
  });
}

/** DELETE — tear the session down when the tab closes. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id, sessionId } = await params;
    const device = await requireOwnedDevice(id, user.id);

    const session = await prisma.rtcSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.deviceId !== device.id) {
      return notFound("Session not found");
    }

    await prisma.rtcSession.update({
      where: { id: session.id },
      data: { status: "CLOSED" },
    });

    return json({ ok: true });
  });
}
