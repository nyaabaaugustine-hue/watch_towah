/**
 * Journey rules that are pure data or pure functions.
 *
 * Kept out of `server/journeys.ts` on purpose. That module imports Drizzle and
 * the database handle, so anything it re-exports becomes un-importable from a
 * client component — which is exactly where the grace bounds and the status
 * wording are needed, to build a `<select>` and to label a card. A "use client"
 * file importing from `server/` fails the build, and the fix is a shared module
 * rather than duplicating the numbers.
 */

export const OPEN_JOURNEY_STATUSES = ["planned", "active", "overdue", "escalated"] as const;

/** Closed journeys are kept as history: "did you get home" is asked afterwards. */
export const CLOSED_JOURNEY_STATUSES = ["arrived", "cancelled"] as const;

export type OpenJourneyStatus = (typeof OPEN_JOURNEY_STATUSES)[number];
export type JourneyStatus = OpenJourneyStatus | (typeof CLOSED_JOURNEY_STATUSES)[number];

/**
 * Grace is bounded below because a zero-minute grace turns "due now" into an
 * instant emergency, which is how a safety app teaches people to ignore it.
 */
export const MIN_GRACE_MINUTES = 5;
export const MAX_GRACE_MINUTES = 120;
export const DEFAULT_GRACE_MINUTES = 15;

export const GRACE_STEP_MINUTES = 5;

export const graceOptions = (): number[] => {
  const count = Math.floor((MAX_GRACE_MINUTES - MIN_GRACE_MINUTES) / GRACE_STEP_MINUTES) + 1;
  return Array.from({ length: count }, (_, index) => MIN_GRACE_MINUTES + index * GRACE_STEP_MINUTES);
};

const MINUTE_MS = 60_000;

/** The subset of a journey the wording depends on. */
export type JourneyFacts = {
  status: JourneyStatus;
  expectedArrival: Date;
  graceMinutes: number;
  actualArrival: Date | null;
};

export type JourneyTone = "brand" | "warning" | "muted" | "safe";

export type JourneyDisplay = {
  status: JourneyStatus;
  label: string;
  detail: string;
  tone: JourneyTone;
  dueInMinutes: number;
  overdue: boolean;
};

const clockTime = (when: Date): string =>
  when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * How a journey should read right now.
 *
 * Status is derived from the clock rather than trusted blindly. A trip stored as
 * `planned` whose expected arrival was ten minutes ago is overdue, and saying so
 * is the entire point of the screen — the stored status is only ever updated by
 * the escalation sweep, which may not have run yet.
 */
export const describeJourney = (journey: JourneyFacts, now: Date): JourneyDisplay => {
  const dueInMinutes = Math.round((journey.expectedArrival.getTime() - now.getTime()) / MINUTE_MS);
  const deadline = new Date(journey.expectedArrival.getTime() + journey.graceMinutes * MINUTE_MS);
  const pastDeadline = now.getTime() > deadline.getTime();
  const arrival = clockTime(journey.expectedArrival);

  if (journey.status === "arrived") {
    return {
      status: journey.status,
      label: "Arrived",
      detail:
        journey.actualArrival === null
          ? "Marked as arrived."
          : `Arrived ${clockTime(journey.actualArrival)}.`,
      tone: "safe",
      dueInMinutes,
      overdue: false,
    };
  }

  if (journey.status === "cancelled") {
    return {
      status: journey.status,
      label: "Cancelled",
      detail: "This journey is no longer being watched.",
      tone: "muted",
      dueInMinutes,
      overdue: false,
    };
  }

  if (journey.status === "escalated") {
    return {
      status: journey.status,
      label: "Escalated",
      detail: "Your Guardian Circle has been alerted that you are overdue.",
      tone: "warning",
      dueInMinutes,
      overdue: true,
    };
  }

  if (pastDeadline || dueInMinutes < 0) {
    return {
      status: "overdue",
      label: "Overdue",
      detail: `Expected by ${arrival}. Check in so your circle knows you are safe.`,
      tone: "warning",
      dueInMinutes,
      overdue: true,
    };
  }

  if (dueInMinutes <= 0) {
    return {
      status: journey.status,
      label: "Due now",
      detail: `Expected around ${arrival}.`,
      tone: "warning",
      dueInMinutes,
      overdue: false,
    };
  }

  return {
    status: journey.status,
    label: journey.status === "active" ? "Live" : "Planned",
    detail: `Due ${arrival}, in about ${dueInMinutes} min.`,
    tone: "brand",
    dueInMinutes,
    overdue: false,
  };
};
