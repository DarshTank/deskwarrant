import { z } from "zod";
import {
  isTunnelProvisioningEnabled,
  provisionTunnel,
} from "@/lib/cloudflare";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { badRequest, handleRoute, json, parseBody } from "@/lib/http";
import { assertDeviceQuota } from "@/lib/rate-limit";
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

    await assertDeviceQuota(pairing.userId);

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

    // Provision the device's tunnel and hostname. Deliberately after the
    // device row exists and outside the transaction: a Cloudflare outage must
    // not cost the user their pairing. Ask, Act, and Watch work regardless —
    // only live view needs the tunnel, and it can be provisioned later.
    if (isTunnelProvisioningEnabled()) {
      try {
        const tunnel = await provisionTunnel(device.id);
        await prisma.device.update({
          where: { id: device.id },
          data: {
            tunnelId: tunnel.tunnelId,
            tunnelHostname: tunnel.hostname,
            tunnelTokenEnc: encryptSecret(tunnel.token),
            tunnelError: null,
          },
        });
      } catch (err) {
        console.error("[pair] tunnel provisioning failed", err);
        await prisma.device.update({
          where: { id: device.id },
          data: {
            tunnelError:
              "Live view could not be set up for this PC. Try revoking and pairing it again.",
          },
        });
      }
    }

    return json({ deviceId: device.id, deviceToken });
  });
}
