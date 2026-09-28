"use client";

import { useEffect, useState } from "react";
import { Flag, Route, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

/** The countdown reads in whole minutes, so a per-second tick is battery for nothing. */
const COUNTDOWN_TICK_MS = 15_000;

const formatSpan = (milliseconds: number): string => {
  const totalMinutes = Math.round(Math.abs(milliseconds) / 60_000);
  if (totalMinutes < 1) {
    return "less than a minute";
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourPart = hours === 0 ? "" : `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const minutePart =
    hours === 0
      ? `${totalMinutes} ${totalMinutes === 1 ? "minute" : "minutes"}`
      : minutes === 0
        ? ""
        : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;

  return [hourPart, minutePart].filter((part) => part !== "").join(" ");
};

export type JourneySummaryJourney = {
  id: string;
  destinationLabel: string;
  startLabel: string | null;
  /** ISO instant. */
  expectedArrival: string;
  status: "planned" | "active" | "overdue" | "escalated";
};

type JourneySummaryProps = {
  journey: JourneySummaryJourney | null;
};

/**
 * The journey someone is being watched through, with a live countdown.
 *
 * Overdue and escalated are deliberately different treatments. Overdue means
 * late but not yet escalated, so amber — urgent, nobody paged. Escalated means
 * an SOS was raised from this journey, which is a live incident and earns the
 * sos palette. Flattening the two would either understate an alert or
 * overstate a delay.
 */
export const JourneySummary = ({ journey }: JourneySummaryProps) => {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (journey === null) {
      return;
    }
    const tick = (): void => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, COUNTDOWN_TICK_MS);
    return () => window.clearInterval(timer);
  }, [journey]);

  if (journey === null) {
    return null;
  }

  // Null until the first tick: the server has no idea what time it is on the
  // phone, and guessing "not overdue yet" would flash the wrong urgency.
  const remainingMs = now === null ? null : Date.parse(journey.expectedArrival) - now;
  const late = remainingMs !== null && remainingMs <= 0;
  const escalated = journey.status === "escalated";
  const overdue = journey.status === "overdue";

  const headline = (): string => {
    // The span is measured from the expected arrival, so on an escalated trip it
    // is how late the journey ran — never how long ago it was escalated, which
    // would be a different instant entirely.
    if (escalated) {
      return remainingMs === null ? "Escalated" : `Escalated, ${formatSpan(remainingMs)} late`;
    }
    if (overdue || late) {
      return remainingMs === null ? "Overdue" : `Overdue by ${formatSpan(remainingMs)}`;
    }
    if (remainingMs === null) {
      return journey.status === "planned" ? "Expected soon" : "Due soon";
    }
    return journey.status === "planned"
      ? `Expected in ${formatSpan(remainingMs)}`
      : `Due in ${formatSpan(remainingMs)}`;
  };

  const detail = (): string => {
    if (escalated) {
      return "This journey ran past its expected arrival and Watchtower raised an SOS from it.";
    }
    if (overdue || late) {
      return "Your Guardian Circle has not been told yet. Mark yourself arrived if you are safe — otherwise this escalates on its own.";
    }
    if (journey.status === "planned") {
      return "Not started. Start it when you set off so your circle is actually watching.";
    }
    return "Your Guardian Circle is watching this trip.";
  };

  return (
    <Card
      tone={escalated ? "alert" : "neutral"}
      className={cn(
        "p-4",
        // A trip the clock has already passed is amber even if the sweep has not
        // rewritten its status yet: the delay is real now.
        (overdue || late) && !escalated && "bg-amber-50 ring-amber-200",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full",
            escalated ? "bg-sos-500 text-white" : overdue || late ? "bg-amber-100 text-amber-800" : "bg-watchtower-50 text-watchtower-700",
          )}
        >
          {escalated || overdue || late ? (
            <TriangleAlert className="size-5" aria-hidden />
          ) : (
            <Route className="size-5" aria-hidden />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-display text-section text-ink">Trip to {journey.destinationLabel}</p>
          <p
            className={cn(
              "mt-0.5 font-display text-title tabular-nums",
              escalated ? "text-sos-700" : overdue || late ? "text-amber-900" : "text-ink",
            )}
          >
            {headline()}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">{detail()}</p>
          <p className="mt-1 text-sm text-ink-faint">
            Expected{" "}
            <time dateTime={journey.expectedArrival} suppressHydrationWarning>
              {new Date(journey.expectedArrival).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            {journey.startLabel === null ? null : ` · from ${journey.startLabel}`}
          </p>

          <Link
            href="/journey"
            className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-watchtower-700"
          >
            <Flag className="size-4" aria-hidden />
            Open journey
          </Link>
        </div>
      </div>
    </Card>
  );
};
