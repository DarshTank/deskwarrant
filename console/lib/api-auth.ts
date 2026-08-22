import type { Device, User } from "@prisma/client";
import { cookies } from "next/headers";
import { auth } from "./auth";
import { prisma } from "./db";
import { HttpError, notFound, serviceUnavailable, unauthorized } from "./http";
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

/** Auth.js writes `authjs.session-token`, prefixed `__Secure-` over HTTPS. */
const SESSION_COOKIE = /(?:authjs|next-auth)\.session-token/;

async function hasSessionCookie(): Promise<boolean> {
  try {
    const jar = await cookies();
    return jar.getAll().some((c) => SESSION_COOKIE.test(c.name));
  } catch {
    return false; // Not in a request scope; treat as no cookie.
  }
}

/**
 * Console-facing: resolve the signed-in user, or unwind with 401 (no session)
 * or 503 (the session could not be looked up).
 *
 * The 503 branch exists because Auth.js cannot tell us the difference. With
 * `session.strategy = "database"` the session lives behind the Prisma adapter,
 * and `@auth/core`'s session action wraps that lookup in a try/catch that
 * merely logs the failure and returns an empty session. A database outage
 * therefore arrives here looking exactly like a signed-out visitor, and every
 * console route answers 401 -- which reads as an auth bug and sends whoever is
 * on call to the wrong place entirely.
 *
 * So: if the caller presented a session cookie but no session resolved, ask the
 * database whether it is actually there before blaming their credentials. The
 * probe only runs on a path that was going to fail anyway, so the happy path
 * still costs exactly one session lookup.
 */
export async function requireUser(): Promise<{ id: string; email: string }> {
  const session = await auth();
  if (session?.user?.id) {
    return { id: session.user.id, email: session.user.email ?? "" };
  }

  if (await hasSessionCookie()) {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      console.error("[auth] session lookup failed; database unreachable", err);
      throw new HttpError(serviceUnavailable("Database unavailable"));
    }
  }

  throw new HttpError(unauthorized("Sign-in required"));
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
