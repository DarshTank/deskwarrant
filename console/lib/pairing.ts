/**
 * Device creation, shared by both ways a PC can join an account.
 *
 * There are two entry points -- the typed pairing code (`/api/agent/pair`) and
 * the click-to-approve claim (`/api/agent/claim/[id]`) -- and they must produce
 * byte-identical devices. Keeping the row shape and the tunnel provisioning
 * here is what stops the two paths from drifting apart.
 */

import type { Prisma } from "@prisma/client";
import { isTunnelProvisioningEnabled, provisionTunnel } from "./cloudflare";
import { encryptSecret } from "./crypto";
import { prisma } from "./db";
import { generateDeviceToken, hashToken } from "./tokens";

export interface DeviceIdentity {
  userId: string;
  hostname: string;
  osVersion: string;
  agentVersion: string;
}

/**
 * The fields for a fresh device row, plus the plaintext token.
 *
 * Returned rather than written so each caller can create the device inside its
 * own transaction -- both paths need the write to race safely against a second
 * agent redeeming the same code or claim.
 */
export function buildDeviceCreate(identity: DeviceIdentity): {
  deviceToken: string;
  data: Prisma.DeviceUncheckedCreateInput;
} {
  const deviceToken = generateDeviceToken();
  return {
    deviceToken,
    data: {
      userId: identity.userId,
      name: identity.hostname,
      hostname: identity.hostname,
      osVersion: identity.osVersion,
      agentVersion: identity.agentVersion,
      tokenHash: hashToken(deviceToken),
      status: "ONLINE",
      lastSeenAt: new Date(),
    },
  };
}

/**
 * Give the device its Cloudflare tunnel.
 *
 * Deliberately runs after the device row exists and outside any transaction: a
 * Cloudflare outage must not cost the user their pairing. Ask, Act, and Watch
 * work regardless -- only live view needs the tunnel, and it can be provisioned
 * later by re-pairing.
 */
export async function provisionDeviceTunnel(deviceId: string): Promise<void> {
  if (!isTunnelProvisioningEnabled()) return;

  try {
    const tunnel = await provisionTunnel(deviceId);
    await prisma.device.update({
      where: { id: deviceId },
      data: {
        tunnelId: tunnel.tunnelId,
        tunnelHostname: tunnel.hostname,
        tunnelTokenEnc: encryptSecret(tunnel.token),
        tunnelError: null,
      },
    });
  } catch (err) {
    console.error("[pairing] tunnel provisioning failed", err);
    await prisma.device.update({
      where: { id: deviceId },
      data: {
        tunnelError:
          "Live view could not be set up for this PC. Try revoking and pairing it again.",
      },
    });
  }
}
