import { eq } from "drizzle-orm";
import {
  type PushSubscription,
  type RequestOptions,
  sendNotification,
  setVapidDetails,
  WebPushError,
} from "web-push";

import type { Database } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { env } from "@/lib/env";
import { ValidationError } from "@/lib/errors";

/** The browser's `PushSubscription`, reduced to the two fields worth trusting. */
export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/**
 * A push endpoint is a capability URL: anyone holding it can receive this user's
 * notifications. Only its host is ever logged, never the path or the keys.
 */
const endpointHost = (endpoint: string): string => {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unparseable-endpoint";
  }
};

/**
 * Applied per call rather than once at module load: `setVapidDetails` is
 * idempotent assignment, and a module-level "already configured" flag would be
 * state that survives into the next request in a reused serverless container.
 */
const applyVapidDetails = (): void => {
  setVapidDetails(env.VAPID_SUBJECT_MAILTO, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
};

/**
 * Record a browser's push subscription.
 *
 * The endpoint is the push identity, not the user: a single account can be
 * subscribed from several devices, and the same device re-subscribing after a
 * rotation or a reinstall must update its row rather than accumulate a second
 * one. Keying on `endpoint` alone means a stale row for a device the user no
 * longer owns is overwritten by whoever holds that endpoint next.
 */
export const subscribeToPush = async (
  db: Database,
  userId: string,
  subscription: PushSubscriptionInput,
  userAgent: string | null,
): Promise<void> => {
  if (!subscription.endpoint.startsWith("https://")) {
    // The stored endpoint is dialled by the server with the user's push keys.
    // A plaintext or off-origin value would turn every alert into an outbound
    // request to an attacker-chosen host.
    throw new ValidationError("That push subscription is not a valid HTTPS endpoint.", {
      field: "endpoint",
    });
  }

  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent,
        lastSeenAt: new Date(),
      },
    });
};

/**
 * Fan a push payload out to every device this user has subscribed.
 *
 * Returns the number of subscriptions the push service accepted. Callers treat
 * "zero accepted" as "this guardian did not hear the push" and escalate to SMS,
 * so a single dead device must never abort the rest of the fan-out.
 */
export const sendPushToUser = async (
  db: Database,
  userId: string,
  payloadJson: string,
  payloadOptions: RequestOptions,
): Promise<number> => {
  const subscriptions = await db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  if (subscriptions.length === 0) {
    return 0;
  }

  applyVapidDetails();

  let accepted = 0;

  for (const row of subscriptions) {
    const subscription: PushSubscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };

    try {
      await sendNotification(subscription, payloadJson, payloadOptions);
      accepted += 1;
    } catch (cause) {
      if (cause instanceof WebPushError && (cause.statusCode === 404 || cause.statusCode === 410)) {
        // The browser discarded this subscription. Leaving it in place would make
        // every future alert pay a full round trip to a dead endpoint and then
        // look like a push failure that should trigger an SMS.
        try {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, row.endpoint));
          console.error("discarded expired push subscription", {
            userId,
            endpointHost: endpointHost(row.endpoint),
            statusCode: cause.statusCode,
          });
        } catch (deleteCause) {
          console.error("could not delete expired push subscription", {
            userId,
            endpointHost: endpointHost(row.endpoint),
            cause: deleteCause,
          });
        }
        continue;
      }

      // A transient 5xx or a dead network must not cancel the remaining
      // devices, and must not be mistaken for "this guardian is unreachable".
      console.error("web push send failed", {
        userId,
        endpointHost: endpointHost(row.endpoint),
        cause,
      });
    }
  }

  return accepted;
};
