"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Siren, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/cn";

/** Minutes is the resolution this needs; ticking every second is battery for nothing. */
const ELAPSED_TICK_MS = 15_000;

/** Beyond this the last known position is history, not a location, and must not be called fresh. */
const FRESH_LOCATION_MINUTES = 15;

const humaniseAge = (ageMinutes: number): string => {
  if (ageMinutes < 1) {
    return "less than a minute";
  }
  if (ageMinutes < 60) {
    return ageMinutes === 1 ? "1 minute" : `${ageMinutes} minutes`;
  }
  const hours = Math.floor(ageMinutes / 60);
  return hours === 1 ? "1 hour" : `${hours} hours`;
};

const humaniseCount = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

type ActiveAlertSummary = {
  /** ISO instant. */
  triggeredAt: string;
  notified: number;
};

type LocationFreshness = "none" | "fresh" | "stale";

const locationFreshnessOf = (ageMinutes: number | null): LocationFreshness => {
  if (ageMinutes === null) {
    return "none";
  }
  return ageMinutes >= FRESH_LOCATION_MINUTES ? "stale" : "fresh";
};

type StatusHeroProps = {
  guardianCount: number;
  /** Whole minutes since the last ping. Null when there has never been one. */
  lastSeenAgeMinutes: number | null;
  activeAlert: ActiveAlertSummary | null;
};

/**
 * The one thing the dashboard is for: what is true right now, said plainly.
 *
 * The headline only claims protection that has actually been configured. An
 * empty Guardian Circle is the single most consequential state this screen can
 * be in — pressing SOS would notify nobody — so it gets its own treatment
 * rather than a reassuring green panel with a footnote.
 */
export const StatusHero = ({ guardianCount, lastSeenAgeMinutes, activeAlert }: StatusHeroProps) => {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (activeAlert === null) {
      return;
    }
    const tick = (): void => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, ELAPSED_TICK_MS);
    return () => window.clearInterval(timer);
  }, [activeAlert]);

  const circleLine = `${humaniseCount(guardianCount, "person", "people")} in your circle will be told`;
  const locationFreshness = locationFreshnessOf(lastSeenAgeMinutes);

  const safeLine = (): string => {
    if (guardianCount === 0) {
      return "Your Guardian Circle is empty. An SOS would reach nobody until you add someone.";
    }
    if (lastSeenAgeMinutes === null) {
      return `${circleLine} if you press SOS. Location starts working once you allow it in your browser.`;
    }
    const age = humaniseAge(lastSeenAgeMinutes);
    // Fresh and stale are worded differently on purpose. A ping from twenty
    // minutes ago is not a location, and calling it one would put a family in
    // the wrong place at the wrong moment.
    return locationFreshness === "stale"
      ? `${circleLine} if you press SOS. Your last location is ${age} old, so it may not be where you are now.`
      : `${circleLine} if you press SOS. Your last location is ${age} old.`;
  };

  if (activeAlert !== null) {
    const elapsed =
      now === null
        ? "just now"
        : `${humaniseAge(Math.max(0, Math.floor((now - Date.parse(activeAlert.triggeredAt)) / 60_000)))} ago`;

    return (
      <section className="rounded-card bg-sos-50 p-5 shadow-sos ring-1 ring-sos-200">
        <div className="flex items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-sos-500 text-white">
            <Siren className="size-7" aria-hidden />
          </span>
          <h1 className="font-display text-display leading-none text-sos-700">Alert raised</h1>
        </div>

        <p className="mt-3 text-sm text-ink-muted">
          Raised{" "}
          <time dateTime={activeAlert.triggeredAt}>{elapsed}</time>.{" "}
          {activeAlert.notified > 0
            ? `${humaniseCount(activeAlert.notified, "person has", "people have")} been notified.`
            : "No one has been told yet."}
        </p>

        <p className="mt-4 font-display text-title font-black uppercase leading-[1.15] tracking-tight text-ink-faint">
          Stay safe.
          <br />
          Stay connected.
          <br />
          Stay protected.
        </p>
      </section>
    );
  }

  const unprotected = guardianCount === 0;

  return (
    <section
      className={cn(
        "rounded-card p-5 shadow-card ring-1",
        unprotected ? "bg-amber-50 ring-amber-200" : "bg-safe-50 ring-safe-200",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid size-12 shrink-0 place-items-center rounded-full text-white",
            unprotected ? "bg-amber-500" : "bg-safe-600",
          )}
        >
          {unprotected ? (
            <TriangleAlert className="size-7" aria-hidden />
          ) : (
            <ShieldCheck className="size-7" aria-hidden />
          )}
        </span>
        <h1
          className={cn(
            "font-display text-display leading-none",
            unprotected ? "text-amber-900" : "text-safe-800",
          )}
        >
          {unprotected ? "Nobody is watching yet" : "You are protected"}
        </h1>
      </div>

      <div className="ghana-rule mt-4" aria-hidden />

      <p className="mt-3 text-sm leading-relaxed text-ink-muted">{safeLine()}</p>

      <p className="mt-4 font-display text-title font-black uppercase leading-[1.15] tracking-tight text-ink-faint">
        Stay safe.
        <br />
        Stay connected.
        <br />
        Stay protected.
      </p>
    </section>
  );
};
