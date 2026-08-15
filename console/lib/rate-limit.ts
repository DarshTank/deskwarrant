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
