import type { Metadata } from "next";
import { Route } from "lucide-react";

import { auth } from "@/auth";
import { JourneyCard } from "@/components/journey/journey-card";
import { JourneyCreateForm } from "@/components/journey/journey-create-form";
import { Card, CardHeader } from "@/components/ui/card";
import { db } from "@/db";
import { describeJourney } from "@/lib/journey";
import { listJourneys } from "@/server/journeys";

export const metadata: Metadata = {
  title: "Journey monitoring",
  description: "Have your Guardian Circle watch a trip from leaving to arriving.",
};

/**
 * Journey monitoring.
 *
 * A server component, so the clock is read here and the derived status is
 * passed down. That is deliberate: "due in 4 min" computed in the browser
 * disagrees with the same card computed on the server by the time a slow 2G
 * response lands, and the mismatch shows up as a card that flickers between
 * "Live" and "Overdue" for somebody who is watching it to decide whether to
 * worry.
 */
const JourneyPage = async () => {
  const session = await auth();
  if (session === null) {
    return null;
  }

  const now = new Date();
  const journeys = await listJourneys(db, session.user.id);

  const open = journeys.filter((journey) => journey.status !== "arrived" && journey.status !== "cancelled");
  const closed = journeys.filter((journey) => journey.status === "arrived" || journey.status === "cancelled");

  const renderCard = (journey: (typeof journeys)[number]) => (
    <li key={journey.id}>
      <JourneyCard
        id={journey.id}
        destinationLabel={journey.destinationLabel}
        startLabel={journey.startLabel}
        status={journey.status}
        display={describeJourney(journey, now)}
      />
    </li>
  );

  return (
    <main className="safe-area-top flex flex-col gap-4 px-4">
      <header>
        <h1 className="font-display text-title text-ink">Journey monitoring</h1>
        <p className="mt-1 text-body text-ink-muted">
          Tell us where you are going and when you expect to arrive. If the time passes and
          you have not arrived, your circle is alerted.
        </p>
      </header>

      <Card className="p-4">
        <CardHeader
          title={open.length > 0 ? "Add another trip" : "Plan a trip"}
          icon={<Route className="size-5 text-watchtower-600" aria-hidden />}
          subtitle="Nothing is shared until you plan a journey."
        />
        <div className="mt-4">
          <JourneyCreateForm />
        </div>
      </Card>

      {open.length > 0 ? (
        <section aria-label="Journeys being watched" className="flex flex-col gap-3">
          <h2 className="font-display text-section text-ink">Being watched</h2>
          <ul className="flex flex-col gap-3">{open.map(renderCard)}</ul>
        </section>
      ) : null}

      {closed.length > 0 ? (
        <section aria-label="Past journeys" className="flex flex-col gap-3">
          <h2 className="font-display text-section text-ink-muted">Past journeys</h2>
          <ul className="flex flex-col gap-3">{closed.map(renderCard)}</ul>
        </section>
      ) : null}

      {journeys.length === 0 ? (
        <p className="text-sm text-ink-faint">
          No journeys yet. Plan one above and your Guardian Circle can watch it.
        </p>
      ) : null}
    </main>
  );
};

export default JourneyPage;
