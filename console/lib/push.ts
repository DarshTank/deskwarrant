import webpush from "web-push";
import { prisma } from "./db";
import { env, hasEnv } from "./env";

let configured = false;

function configure(): boolean {
  if (configured) return true;
  if (
    !hasEnv("VAPID_PUBLIC_KEY") ||
    !hasEnv("VAPID_PRIVATE_KEY")
  ) {
    return false;
  }
  webpush.setVapidDetails(
    env.vapidSubject,
    env.vapidPublicKey,
    env.vapidPrivateKey,
  );
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  deviceId: string;
  eventId?: string;
}

/**
 * Fan a watch event out to every browser the user has subscribed.
 *
 * Push failures are never allowed to fail the caller: the WatchEvent row is the
 * durable record, and the notification is a best-effort nudge on top of it.
 * A 404/410 from the push service means the subscription is dead, so it is
 * pruned rather than retried forever.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  if (!configure()) {
    console.warn("[push] VAPID keys not configured; skipping notification");
    return;
  }

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => {});
        } else {
          console.error("[push] send failed", statusCode ?? err);
        }
      }
    }),
  );
}
