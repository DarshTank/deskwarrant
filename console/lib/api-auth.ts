import type { Device, User } from "@prisma/client";
import { auth } from "./auth";
import { prisma } from "./db";
import { HttpError, notFound, unauthorized } from "./http";
import { hashToken } from "./tokens";

/**
 * A device is considered offline once its last poll is older than this.
 * Computed at read time — there is no cron sweeping stale rows (build plan §7.1).
 */
export const OFFLINE_AFTER_MS = 15_000;

export function isDeviceOnline(lastSeenAt: Date | null | undefined): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - lastSeenAt.getTime() < OFFLINE_AFTER_MS;
}

/** Console-facing: resolve the signed-in user or unwind with 401. */
export async function requireUser(): Promise<{ id: string; email: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new HttpError(unauthorized("Sign-in required"));
  }
  return { id: session.user.id, email: session.user.email ?? "" };
}

/**
 * Console-facing: load a device and assert the caller owns it.
 *
 * There is no sharing model in v1, so this single check *is* the entire
 * authorization layer (build plan §7.2). Every device-scoped handler calls it.
 * A device owned by someone else returns 404, not 403 — a 403 would confirm the
 * id exists to a caller who has no business knowing that.
 */
export async function requireOwnedDevice(
  deviceId: string,
  userId: string,
): Promise<Device> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || device.userId !== userId || device.revokedAt) {
    throw new HttpError(notFound("Device not found"));
  }
  return device;
}

/**
 * Agent-facing: authenticate by `Authorization: Bearer <device_token>`.
 *
 * The plaintext token is never stored; we hash the presented value and look up
 * the unique tokenHash. A revoked device is rejected so the agent's next poll
 * receives 401 and it wipes its stored credentials.
 */
export async function authenticateAgent(req: Request): Promise<Device> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    throw new HttpError(unauthorized("Missing bearer token"));
  }
  const presented = match[1].trim();
  if (!/^[0-9a-f]{64}$/i.test(presented)) {
    throw new HttpError(unauthorized("Malformed device token"));
  }

  const device = await prisma.device.findUnique({
    where: { tokenHash: hashToken(presented) },
  });
  if (!device) {
    throw new HttpError(unauthorized("Unknown device token"));
  }
  if (device.revokedAt) {
    throw new HttpError(unauthorized("Device has been revoked"));
  }
  return device;
}

export type { Device, User };
