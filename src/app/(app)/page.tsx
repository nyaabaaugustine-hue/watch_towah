import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { MapPin, Route } from "lucide-react";
import Link from "next/link";

import { auth } from "@/auth";
import { WatchtowerMark } from "@/components/brand/watchtower-mark";
import { GuardianSummary } from "@/components/dashboard/guardian-summary";
import { JourneySummary } from "@/components/dashboard/journey-summary";
import type { JourneySummaryJourney } from "@/components/dashboard/journey-summary";
import { LastSeen } from "@/components/dashboard/last-seen";
import { QuickActionCard } from "@/components/dashboard/quick-action-card";
import type { QuickActionStatus } from "@/components/dashboard/quick-action-card";
import { StatusHero } from "@/components/dashboard/status-hero";
import { ActiveAlertBanner } from "@/components/sos/active-alert-banner";
import { SosControl } from "@/components/sos/sos-control";
import { TrustBadges } from "@/components/ui/trust-badge";
import { db } from "@/db";
import { journeys, locationPings } from "@/db/schema";
import { env } from "@/lib/env";
import { listGuardianContacts } from "@/server/guardian-contacts";
import { countNotifiedGuardians, getActiveSosAlert } from "@/server/sos";

export const metadata: Metadata = {
  title: "Home",
  description: "Your safety status, Guardian Circle, and the SOS button â€” all on one screen.",
};

/** The journey statuses that mean something is still worth watching. */
const OPEN_JOURNEY_STATUSES = ["planned", "active", "overdue", "escalated"] as const;

/** A check-in that is past its grace period counts as missed even if no sweep has run yet. */
const MINUTE_MS = 60_000;

/**
 * The SQL filter already excludes closed journeys; the guard re-states the same
 * fact in the type system so the dashboard can never be handed a status it has
 * no treatment for.
 */
const isOpenJourneyStatus = (status: string): status is JourneySummaryJourney["status"] =>
  OPEN_JOURNEY_STATUSES.some((open) => open === status);

/**
 * Built from the configured origin rather than the request host: an alert link
 * sent by SMS has to open for a guardian who is nowhere near the dashboard, and
 * a link built from a preview crawler's host would hand them a dead address.
 */
const trackingUrlFor = (shareToken: string): string =>
  `${env.NEXTAUTH_URL.replace(/\/+$/, "")}/track/${shareToken}`;

const relativeMinutes = (target: Date, from: Date): number =>
  Math.round((target.getTime() - from.getTime()) / MINUTE_MS);

const compactSpan = (minutes: number): string => {
  const magnitude = Math.abs(minutes);
  if (magnitude < 60) {
    return `${magnitude} min`;
  }
  const hours = Math.round(magnitude / 60);
  return `${hours} h`;
};

const greetingFor = (now: Date): string => {
  const hour = now.getHours();
  if (hour < 12) {
    return "Good morning";
  }
  return hour < 17 ? "Good afternoon" : "Good evening";
};

const firstNameOf = (name: string | null | undefined): string | null => {
  const trimmed = (name ?? "").trim();
  if (trimmed === "") {
    return null;
  }
  const [first] = trimmed.split(" ");
  return first === undefined || first === "" ? null : first;
};

/**
 * The dashboard.
 *
 * A server component that reads the facts and hands them to small pieces: the
 * one place that knows what is true is the one place that queries for it, and
 * the client only ever re-renders the parts that must tick. Every status shown
 * here is derived from stored state â€” nothing is claimed that a query did not
 * establish, because a screen that overstates its own protection is worse than
 * one that admits a gap.
 */
const DashboardPage = async () => {
  const session = await auth();
  if (session === null) {
    // The (app) layout already redirects signed-out visitors. This is the second
    // line that makes the page safe to render on its own.
    return null;
  }

  const userId = session.user.id;
  const now = new Date();

  // Independent reads, issued together: on a high-latency link to Neon, five
  // sequential round trips is the difference between a dashboard that appears
  // and one that makes a person wait through an emergency.
  //
  // Nothing here reads `checkins`. The table and its status enum exist, but
  // nothing in the app ever inserts a check-in, so the query it used to issue
  // could only ever return nothing and the "Safety Check-In" card it fed was a
  // link to a route that does not exist. Journey monitoring is the feature that
  // actually covers "tell someone if I do not come back".
  const [activeAlert, pingRows, contacts, journeyRows] = await Promise.all([
    getActiveSosAlert(db, userId),
    db
      .select({
        lat: locationPings.lat,
        lng: locationPings.lng,
        accuracy: locationPings.accuracy,
        recordedAt: locationPings.recordedAt,
      })
      .from(locationPings)
      .where(eq(locationPings.userId, userId))
      .orderBy(desc(locationPings.recordedAt))
      .limit(1),
    listGuardianContacts(db, userId),
    db
      .select({
        id: journeys.id,
        destinationLabel: journeys.destinationLabel,
        startLabel: journeys.startLabel,
        expectedArrival: journeys.expectedArrival,
        status: journeys.status,
      })
      .from(journeys)
      .where(and(eq(journeys.userId, userId), inArray(journeys.status, [...OPEN_JOURNEY_STATUSES])))
      .orderBy(asc(journeys.expectedArrival))
      .limit(1),
  ]);

  const notified = activeAlert === null ? 0 : await countNotifiedGuardians(db, activeAlert.id);
  const trackingUrl = activeAlert === null ? null : trackingUrlFor(activeAlert.shareToken);

  const pingRow = pingRows[0];
  const lastSeen =
    pingRow === undefined
      ? null
      : {
          lat: pingRow.lat,
          lng: pingRow.lng,
          accuracy: pingRow.accuracy,
          ageMinutes: Math.max(0, relativeMinutes(pingRow.recordedAt, now)),
        };
  const lastSeenAgeMinutes = lastSeen === null ? null : lastSeen.ageMinutes;

  const journeyRow = journeyRows[0];
  const journey =
    journeyRow === undefined || !isOpenJourneyStatus(journeyRow.status)
      ? null
      : {
          id: journeyRow.id,
          destinationLabel: journeyRow.destinationLabel,
          startLabel: journeyRow.startLabel,
          expectedArrival: journeyRow.expectedArrival.toISOString(),
          status: journeyRow.status,
        };

  const journeyStatus: QuickActionStatus | null = (() => {
    if (journey === null) {
      return null;
    }
    if (journey.status === "escalated" || journey.status === "overdue") {
      return { label: journey.status === "escalated" ? "Escalated" : "Overdue", tone: "warning" };
    }
    // A trip whose expected arrival has already passed is late whatever the
    // stored status still says, so the chip reports the clock rather than
    // printing "due in" with a number that only looks reassuring.
    const dueInMinutes = relativeMinutes(new Date(journey.expectedArrival), now);
    if (dueInMinutes < 0) {
      return { label: "Running late", tone: "warning" };
    }
    return {
      label: `${journey.status === "active" ? "Live" : "Planned"} Â· due in ${compactSpan(dueInMinutes)}`,
      tone: "brand",
    };
  })();

  const firstName = firstNameOf(session.user.name);

  return (
    <main className="safe-area-top flex flex-col gap-4 px-4">
      <header className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-display text-title text-ink">
          {firstName === null ? "Your safety" : `${greetingFor(now)}, ${firstName}`}
        </p>
        <WatchtowerMark className="size-9 shrink-0" title="Watchtower" />
      </header>

      <StatusHero
        guardianCount={contacts.length}
        lastSeenAgeMinutes={lastSeenAgeMinutes}
        activeAlert={
          activeAlert === null
            ? null
            : {
                triggeredAt: activeAlert.triggeredAt.toISOString(),
                notified,
              }
        }
      />

      {/*
        A live alert replaces the trigger outright. Two SOS controls on one
        screen is an invitation to send the same emergency twice, and the
        banner already carries the cancel, the resolve, and the tracking link
        that a second control would only duplicate.
      */}
      {activeAlert !== null && trackingUrl !== null ? (
        <div className="flex flex-col gap-3">
          <ActiveAlertBanner
            alertId={activeAlert.id}
            status={activeAlert.status}
            triggeredAt={activeAlert.triggeredAt.toISOString()}
            lat={activeAlert.lat}
            lng={activeAlert.lng}
            cancellableUntil={activeAlert.cancellableUntil?.toISOString() ?? null}
            trackingUrl={trackingUrl}
            notified={notified}
          />
          <Link
            href={trackingUrl}
            className="inline-flex min-h-11 items-center justify-center text-sm font-bold text-watchtower-700"
          >
            Open the live alert page
          </Link>
        </div>
      ) : (
        <SosControl />
      )}

      <JourneySummary journey={journey} />

      <section aria-label="What you can do now" className="grid gap-3">
        <QuickActionCard
          href="/journey"
          title="Journey Monitoring"
          icon={<Route className="size-5" aria-hidden />}
          description={
            journey === null ? "Have someone watch the trip from leaving to arriving." : `To ${journey.destinationLabel}`
          }
          status={journeyStatus}
        />
        <QuickActionCard
          href="/share"
          title="Share Location"
          icon={<MapPin className="size-5" aria-hidden />}
          description="Let your circle follow you for as long as you choose."
          status={null}
        />
      </section>

      <LastSeen ping={lastSeen} />

      <GuardianSummary
        contacts={contacts.map((contact) => ({
          id: contact.id,
          name: contact.name,
          relationship: contact.relationship,
          contactUserId: contact.contactUserId,
          permissionLevel: contact.permissionLevel,
        }))}
      />

      <section aria-label="What Watchtower promises" className="pt-1">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-ink-faint">
          Built for Ghana&rsquo;s networks and phones
        </p>
        <TrustBadges variant="grid" />
      </section>
    </main>
  );
};

export default DashboardPage;
