import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { MapPin, PhoneCall, ShieldCheck } from "lucide-react";

import { auth } from "@/auth";
import { WatchtowerMark } from "@/components/brand/watchtower-mark";
import { TrackingActions, TrackingView } from "@/components/track/tracking-view";
import { db } from "@/db";
import { locationPings, sosAlerts, users } from "@/db/schema";
import { env } from "@/lib/env";
import { formatDistance } from "@/lib/geo";
import { isWatchtowerError } from "@/lib/errors";
import { recordAcknowledgement } from "@/server/sos";

/**
 * A live position for someone who is afraid must never end up in a search
 * index, and the token in the URL is the only thing protecting it.
 */
export const metadata: Metadata = {
  title: "Live SOS tracking",
  robots: { index: false, follow: false, nocache: true },
};

/** How long a finished alert's page keeps rendering before it says nothing. */
const TRACKING_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** No caching: a guardian refreshing must not be served a stale position. */
export const dynamic = "force-dynamic";

type TrackableAlert = Pick<
  typeof sosAlerts.$inferSelect,
  "id" | "userId" | "status" | "triggeredAt" | "resolvedAt" | "lat" | "lng" | "accuracy"
>;

const formatElapsed = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) {
    return "less than a minute ago";
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  // A live alert that nobody dispatched stays live for as long as the sweep is
  // broken, so "5 days ago" has to be a possible thing to read here.
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

/**
 * A link is finished once the alert is resolved, and it stops rendering a day
 * later so a screenshot of a crisis does not become a permanent record of where
 * somebody was standing.
 */
const isStillRenderable = (alert: TrackableAlert, nowMs: number): boolean => {
  if (alert.status === "cancelled") {
    return false;
  }
  if (alert.status !== "resolved") {
    return true;
  }
  if (alert.resolvedAt === null) {
    return false;
  }
  return nowMs - alert.resolvedAt.getTime() <= TRACKING_LINK_TTL_MS;
};

/**
 * Note, when possible, that a Guardian Circle member has seen the alert.
 *
 * A non-guardian is a completely normal visitor here: the SMS is often read on
 * a relative's phone, or forwarded. Bookkeeping must never stand between
 * someone and the page, so an expected refusal is logged and stepped over.
 */
const noteGuardianAcknowledgement = async (alertId: string): Promise<void> => {
  const session = await auth();
  const viewerId = session?.user.id;
  if (viewerId === undefined) {
    return;
  }

  try {
    await recordAcknowledgement(db, alertId, viewerId);
  } catch (error) {
    if (isWatchtowerError(error)) {
      console.info("tracking visit not recorded as an acknowledgement", {
        alertId,
        code: error.code,
      });
    } else {
      console.error("tracking acknowledgement failed", { alertId, cause: error });
    }
  }
};

const InactiveNotice = () => (
  <div className="app-shell flex min-h-dvh flex-col bg-ink-canvas">
    <div className="ghana-rule" aria-hidden />
    <main className="safe-area-top flex flex-1 flex-col items-center justify-center px-6 text-center">
      <WatchtowerMark className="size-12" title="Watchtower" />
      <h1 className="mt-5 font-display text-title text-ink">This link is no longer active</h1>
      <p className="mt-2 max-w-xs text-sm text-ink-muted">
        Live tracking links stop working once an alert is cancelled or a day after it is resolved. If
        you think someone is in danger now, call them and the police.
      </p>
    </main>
  </div>
);

const TrackPage = async ({ params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const nowMs = Date.now();

  const alertRows = await db
    .select({
      id: sosAlerts.id,
      userId: sosAlerts.userId,
      status: sosAlerts.status,
      triggeredAt: sosAlerts.triggeredAt,
      resolvedAt: sosAlerts.resolvedAt,
      lat: sosAlerts.lat,
      lng: sosAlerts.lng,
      accuracy: sosAlerts.accuracy,
    })
    .from(sosAlerts)
    .where(eq(sosAlerts.shareToken, token))
    .limit(1);

  const alert = alertRows[0];

  if (alert === undefined || !isStillRenderable(alert, nowMs)) {
    return <InactiveNotice />;
  }

  const ownerRows = await db
    .select({ name: users.name, phone: users.phone })
    .from(users)
    .where(eq(users.id, alert.userId))
    .limit(1);

  const owner = ownerRows[0];
  if (owner === undefined) {
    return <InactiveNotice />;
  }

  const isResolved = alert.status === "resolved";

  if (!isResolved) {
    await noteGuardianAcknowledgement(alert.id);
  }

  const latestPingRows = await db
    .select({
      recordedAt: locationPings.recordedAt,
      lat: locationPings.lat,
      lng: locationPings.lng,
      accuracy: locationPings.accuracy,
    })
    .from(locationPings)
    .where(eq(locationPings.userId, alert.userId))
    .orderBy(desc(locationPings.recordedAt))
    .limit(1);

  const latestPing = latestPingRows[0];
  // A ping older than the alert says nothing about the incident, so the alert's
  // own trigger coordinates stand until a newer fix actually arrives.
  const hasNewerPing = latestPing !== undefined && latestPing.recordedAt.getTime() > alert.triggeredAt.getTime();
  const lastKnownAt = hasNewerPing && latestPing !== undefined ? latestPing.recordedAt : alert.triggeredAt;
  const lat = hasNewerPing && latestPing !== undefined ? latestPing.lat : alert.lat;
  const lng = hasNewerPing && latestPing !== undefined ? latestPing.lng : alert.lng;
  const accuracy = hasNewerPing && latestPing !== undefined ? latestPing.accuracy : alert.accuracy;
  const hasPosition = lat !== null && lng !== null;
  const trackingUrl = `${env.NEXTAUTH_URL.replace(/\/+$/, "")}/track/${token}`;

  return (
    <div className="app-shell flex min-h-dvh flex-col bg-ink-canvas">
      <div className="ghana-rule" aria-hidden />

      <header className="safe-area-top flex items-center gap-2 px-5 pt-4">
        <WatchtowerMark className="size-7" title="Watchtower" />
        <span className="font-display text-sm font-bold tracking-tight text-watchtower-800">
          Watchtower
        </span>
      </header>

      <main className="flex-1 space-y-5 px-5 pb-10 pt-4">
        {isResolved ? (
          <>
            <div className="inline-flex items-center gap-1.5 rounded-pill bg-safe-50 px-3 py-1.5 text-xs font-bold text-safe-700 ring-1 ring-safe-200">
              <ShieldCheck className="size-4" aria-hidden />
              Resolved
            </div>
            <h1 className="font-display text-display text-ink">{owner.name} is safe</h1>
            <p className="text-sm text-ink-muted">
              They marked this alert safe {formatElapsed(nowMs - (alert.resolvedAt?.getTime() ?? nowMs))}.
              {/* Deliberately not "the circle has been told": this page never checks
                  how many guardians were actually reached, and an alert whose
                  every notification failed still resolves. Asserting the fan-out
                  succeeded here would tell a guardian that other family members
                  already know, which is exactly what a failed dispatch cannot
                  promise. Plumbing countNotifiedGuardians through is the fuller fix. */}
              No further action is needed on this link.
            </p>
            <TrackingActions personName={owner.name} phone={owner.phone} trackingUrl={trackingUrl} />
            <p className="text-xs text-ink-faint">
              This link stops working 24 hours after the alert is resolved.
            </p>
          </>
        ) : (
          <>
            <div className="inline-flex animate-sos-flash items-center gap-1.5 rounded-pill bg-sos-500 px-3 py-1.5 text-xs font-black tracking-wide text-white">
              <PhoneCall className="size-4" aria-hidden />
              EMERGENCY SOS — LIVE
            </div>

            <h1 className="font-display text-display text-ink">{owner.name} needs help</h1>
            <p className="text-sm text-ink-muted">
              They raised an SOS from Watchtower {formatElapsed(nowMs - alert.triggeredAt.getTime())}.
            </p>

            <TrackingActions personName={owner.name} phone={owner.phone} trackingUrl={trackingUrl} />

            {hasPosition ? (
              <>
                <TrackingView
                  accessToken={env.MAPBOX_ACCESS_TOKEN}
                  lat={lat}
                  lng={lng}
                  accuracy={accuracy}
                />
                <div className="rounded-card bg-ink-surface p-4 ring-1 ring-ink/5">
                  <p className="text-sm font-semibold text-ink">
                    Last updated {formatElapsed(nowMs - lastKnownAt.getTime())},{" "}
                    {accuracy === null
                      ? "accuracy unknown"
                      : `accurate to about ${formatDistance(accuracy)}`}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    This is where their phone last reported a position, not where they are right now.
                    A fix this old may be minutes or hours out of date.
                  </p>
                  <a
                    href={`https://maps.google.com/?q=${lat},${lng}`}
                    className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-pill bg-watchtower-50 px-4 text-sm font-bold text-watchtower-800 ring-1 ring-inset ring-watchtower-200"
                  >
                    <MapPin className="size-4" aria-hidden />
                    Open in Google Maps
                  </a>
                </div>
              </>
            ) : (
              <div className="rounded-card bg-ink-surface p-4 text-sm text-ink-muted ring-1 ring-ink/5">
                Their phone has not reported a position for this alert yet. Call them now — the call
                does not depend on this page.
              </div>
            )}

            <section className="rounded-card bg-ink-surface p-4 ring-1 ring-ink/5">
              <h2 className="font-display text-section text-ink">What to do now</h2>
              <ol className="mt-2 space-y-2 text-sm text-ink-muted">
                <li className="flex gap-2">
                  <span className="font-bold text-watchtower-800">1.</span>
                  Call them. Do not wait for the map to move.
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-watchtower-800">2.</span>
                  Keep this page open, or send the link to another relative who is closer.
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-watchtower-800">3.</span>
                  If you cannot reach them, call the police. Watchtower cannot call for you.
                </li>
              </ol>
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default TrackPage;
