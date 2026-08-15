import { z } from "zod";
import { isDeviceOnline, requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { badRequest, handleRoute, json, parseBody } from "@/lib/http";
import { assertRtcOfferQuota } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RTC_TTL_MS = 60_000;

const bodySchema = z.object({
  // Non-trickle: this is the COMPLETE offer, after ICE gathering finished.
  offerSdp: z.string().min(1).max(64_000),
});

/** POST /api/devices/:id/rtc/offer → { sessionId } */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const device = await requireOwnedDevice(id, user.id);
    const body = await parseBody(req, bodySchema);

    if (!isDeviceOnline(device.lastSeenAt)) {
      return badRequest("That PC is offline, so live view cannot start.");
    }

    await assertRtcOfferQuota(device.id);

    // Retire any previous attempt; the agent should only ever see one live offer.
    await prisma.rtcSession.updateMany({
      where: { deviceId: device.id, status: "OFFERED" },
      data: { status: "EXPIRED" },
    });

    const session = await prisma.rtcSession.create({
      data: {
        deviceId: device.id,
        userId: user.id,
        offerSdp: body.offerSdp,
        expiresAt: new Date(Date.now() + RTC_TTL_MS),
      },
    });

    return json({ sessionId: session.id });
  });
}
