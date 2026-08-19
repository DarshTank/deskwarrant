import { prisma } from "./db";
import { HttpError, tooManyRequests } from "./http";

/**
 * Per-device write caps (build plan §11): a compromised device token must not
 * be able to flood the database.
 *
 * These count rows written in a trailing window rather than using an in-memory
 * bucket, because Vercel functions are ephemeral and process-local state is not
 * shared between concurrent invocations. One indexed COUNT per write is cheap
 * relative to the write it guards.
 */

export const LIMITS = {
  /** Jobs created for one device, per minute, across all chat turns. */
  jobsPerMinute: 60,
  /** Watch events submitted by one device, per minute. */
  eventsPerMinute: 30,
  /** View tokens issued for one device, per minute (migration §10). */
  viewTokensPerMinute: 12,

  // ---- Per-user caps. The app is open to sign-up and every chat turn runs on
  // the operator's Groq key, so one account must not be able to drain it.
  /** Assistant messages one user may send per day, across all their devices. */
  messagesPerUserPerDay: 200,
  /** Devices one user may have paired at once. Also caps tunnel provisioning. */
  devicesPerUser: 5,
  /**
   * Pairing claims one source IP may open per hour.
   *
   * `POST /api/agent/claim` is the only endpoint that writes a row with no
   * credential of any kind, so it needs its own ceiling. Set high enough that
   * repeatedly re-pairing a PC during setup never trips it.
   */
  claimsPerIpPerHour: 60,
} as const;

export async function assertJobQuota(deviceId: string, incoming: number) {
  const since = new Date(Date.now() - 60_000);
  const used = await prisma.job.count({
    where: { deviceId, createdAt: { gte: since } },
  });
  if (used + incoming > LIMITS.jobsPerMinute) {
    throw new HttpError(
      tooManyRequests(
        `Job rate limit reached for this device (${LIMITS.jobsPerMinute}/min).`,
      ),
    );
  }
}

export async function assertEventQuota(deviceId: string, incoming: number) {
  const since = new Date(Date.now() - 60_000);
  const used = await prisma.watchEvent.count({
    where: { deviceId, createdAt: { gte: since } },
  });
  if (used + incoming > LIMITS.eventsPerMinute) {
    throw new HttpError(
      tooManyRequests(
        `Event rate limit reached for this device (${LIMITS.eventsPerMinute}/min).`,
      ),
    );
  }
}

/**
 * Cap assistant usage per user per day.
 *
 * Counted from the user's own messages rather than jobs or tokens: it is the
 * unit the user actually controls, and every one of them costs a Groq call.
 * The window is a rolling 24h, so there is no midnight cliff.
 */
export async function assertUserMessageQuota(userId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const used = await prisma.message.count({
    where: {
      role: "USER",
      createdAt: { gte: since },
      conversation: { device: { userId } },
    },
  });
  if (used >= LIMITS.messagesPerUserPerDay) {
    throw new HttpError(
      tooManyRequests(
        `Daily limit of ${LIMITS.messagesPerUserPerDay} messages reached. It resets on a rolling 24-hour window.`,
      ),
    );
  }
}

/** Cap devices per user. Each one provisions a Cloudflare tunnel. */
export async function assertDeviceQuota(userId: string) {
  const used = await prisma.device.count({
    where: { userId, revokedAt: null },
  });
  if (used >= LIMITS.devicesPerUser) {
    throw new HttpError(
      tooManyRequests(
        `You can pair up to ${LIMITS.devicesPerUser} PCs. Revoke one to add another.`,
      ),
    );
  }
}

/**
 * Cap unauthenticated pairing claims per source IP.
 *
 * Requests with no forwarded IP share one bucket rather than bypassing the
 * check: on Vercel the header is always set by the platform, so an absent one
 * means local development, and lumping those together is the safe reading.
 */
export async function assertClaimQuota(sourceIp: string | null) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const used = await prisma.pairingClaim.count({
    where: { sourceIp: sourceIp ?? null, createdAt: { gte: since } },
  });
  if (used >= LIMITS.claimsPerIpPerHour) {
    throw new HttpError(
      tooManyRequests("Too many pairing attempts. Try again in an hour."),
    );
  }
}

export async function assertViewTokenQuota(deviceId: string) {
  const since = new Date(Date.now() - 60_000);
  const used = await prisma.viewToken.count({
    where: { deviceId, createdAt: { gte: since } },
  });
  if (used + 1 > LIMITS.viewTokensPerMinute) {
    throw new HttpError(
      tooManyRequests("Too many connection attempts. Wait a moment."),
    );
  }
}
