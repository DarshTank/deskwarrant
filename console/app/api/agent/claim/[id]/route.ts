import { prisma } from "@/lib/db";
import {
  handleRoute,
  json,
  notFound,
  unauthorized,
} from "@/lib/http";
import { buildDeviceCreate, provisionDeviceTunnel } from "@/lib/pairing";
import { hashToken, safeEqualHex } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function presentedSecret(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([0-9a-f]{64})$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * POST /api/agent/claim/:id — the agent polls here until someone decides.
 *
 * POST rather than GET because the approved case has a side effect: this is
 * where the device row is actually created. Nothing is written at approval
 * time, so no device token exists anywhere — not even encrypted — until the
 * agent that opened the claim comes back and proves it with the secret.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const secret = presentedSecret(req);
    if (!secret) return unauthorized("Missing or malformed claim secret");

    const { id } = await params;
    const claim = await prisma.pairingClaim.findUnique({ where: { id } });
    if (!claim) return notFound("Unknown claim");

    if (!safeEqualHex(hashToken(secret), claim.secretHash)) {
      return unauthorized("Claim secret does not match");
    }

    if (claim.status === "PENDING" && claim.expiresAt < new Date()) {
      await prisma.pairingClaim.update({
        where: { id: claim.id },
        data: { status: "EXPIRED" },
      });
      return json({ status: "EXPIRED" });
    }

    if (claim.status !== "APPROVED" || !claim.userId) {
      return json({ status: claim.status });
    }

    const userId = claim.userId;
    const { deviceToken, data } = buildDeviceCreate({
      userId,
      hostname: claim.hostname,
      osVersion: claim.osVersion,
      agentVersion: claim.agentVersion,
    });

    const device = await prisma.$transaction(async (tx) => {
      // Flip the claim first and bail if it was already taken, so a retried
      // poll that overlaps the original cannot mint two devices.
      const consumed = await tx.pairingClaim.updateMany({
        where: { id: claim.id, status: "APPROVED" },
        data: { status: "CONSUMED" },
      });
      if (consumed.count === 0) return null;

      return tx.device.create({ data });
    });

    if (!device) {
      return json({ status: "CONSUMED" });
    }

    await provisionDeviceTunnel(device.id);

    return json({ status: "PAIRED", deviceId: device.id, deviceToken });
  });
}
