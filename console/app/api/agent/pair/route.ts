import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, handleRoute, json, parseBody } from "@/lib/http";
import {
  generateDeviceToken,
  hashToken,
  normalizePairingCode,
} from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  code: z.string().min(4).max(16),
  hostname: z.string().min(1).max(120),
  osVersion: z.string().min(1).max(120),
  agentVersion: z.string().min(1).max(40),
});

/**
 * POST /api/agent/pair — the one agent endpoint with no bearer token.
 *
 * The plaintext device token is returned here and never again; only its SHA-256
 * digest is persisted (build plan §11).
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    const body = await parseBody(req, bodySchema);
    const code = normalizePairingCode(body.code);

    const pairing = await prisma.pairingCode.findUnique({ where: { code } });
    if (!pairing || pairing.consumedAt || pairing.expiresAt < new Date()) {
      // One message for all three cases: an attacker guessing codes learns
      // nothing about which part was wrong.
      return badRequest("That pairing code is invalid or has expired.");
    }

    const deviceToken = generateDeviceToken();

    const device = await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction so two agents racing on one code
      // cannot both pair.
      const claimed = await tx.pairingCode.updateMany({
        where: { id: pairing.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (claimed.count === 0) return null;

      return tx.device.create({
        data: {
          userId: pairing.userId,
          name: body.hostname,
          hostname: body.hostname,
          osVersion: body.osVersion,
          agentVersion: body.agentVersion,
          tokenHash: hashToken(deviceToken),
          status: "ONLINE",
          lastSeenAt: new Date(),
        },
      });
    });

    if (!device) {
      return badRequest("That pairing code has already been used.");
    }

    return json({ deviceId: device.id, deviceToken });
  });
}
