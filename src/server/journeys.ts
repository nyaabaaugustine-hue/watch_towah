import { and, asc, desc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";

import type { Database } from "@/db";
import { journeys } from "@/db/schema";
import { CLOSED_JOURNEY_STATUSES, OPEN_JOURNEY_STATUSES, type JourneyStatus } from "@/lib/journey";

/**
 * Journey persistence.
 *
 * A journey is a promise that somebody will arrive somewhere by a time. The
 * feature exists to catch the one case that matters: the phone stops answering.
 * So the rules are about time rather than geography, and the important property
 * is that every state a journey can be in is derived from stored data. Nothing
 * is computed in the browser from a stale copy, because a phone that has been
 * offline for an hour must still show the truth.
 *
 * The pure wording and status rules live in `@/lib/journey` so that client
 * components can use them without pulling Drizzle into the browser bundle.
 */

export type JourneyRow = typeof journeys.$inferSelect;

export type CreateJourneyInput = {
  userId: string;
  destinationLabel: string;
  startLabel: string | null;
  expectedArrival: Date;
  graceMinutes: number;
  startLat: number | null;
  startLng: number | null;
  destinationLat: number | null;
  destinationLng: number | null;
};

/** Every journey for a user, most recently expected first. */
export const listJourneys = async (db: Database, userId: string): Promise<JourneyRow[]> => {
  return db
    .select()
    .from(journeys)
    .where(eq(journeys.userId, userId))
    .orderBy(desc(journeys.expectedArrival));
};

/** Only the journeys still being watched, soonest expected arrival first. */
export const listOpenJourneys = async (db: Database, userId: string): Promise<JourneyRow[]> => {
  return db
    .select()
    .from(journeys)
    .where(and(eq(journeys.userId, userId), inArray(journeys.status, [...OPEN_JOURNEY_STATUSES])))
    .orderBy(asc(journeys.expectedArrival));
};

export const findJourney = async (
  db: Database,
  userId: string,
  journeyId: string,
): Promise<JourneyRow | null> => {
  const rows = await db
    .select()
    .from(journeys)
    .where(and(eq(journeys.id, journeyId), eq(journeys.userId, userId)))
    .limit(1);

  return rows[0] ?? null;
};

/** @throws Error when the insert returns no row, which means the write was lost. */
export const createJourney = async (db: Database, input: CreateJourneyInput): Promise<JourneyRow> => {
  const rows = await db
    .insert(journeys)
    .values({
      userId: input.userId,
      destinationLabel: input.destinationLabel,
      startLabel: input.startLabel,
      expectedArrival: input.expectedArrival,
      graceMinutes: input.graceMinutes,
      startLat: input.startLat,
      startLng: input.startLng,
      destinationLat: input.destinationLat,
      destinationLng: input.destinationLng,
      status: "planned",
    })
    .returning();

  const created = rows[0];
  if (created === undefined) {
    throw new Error("Journey insert returned no row.");
  }

  return created;
};

const updateJourney = async (db: Database, journeyId: string, patch: Partial<JourneyRow>): Promise<JourneyRow> => {
  const rows = await db.update(journeys).set(patch).where(eq(journeys.id, journeyId)).returning();

  const updated = rows[0];
  if (updated === undefined) {
    throw new Error("Journey update returned no row.");
  }

  return updated;
};

/**
 * @throws Error when the journey does not exist, does not belong to this user,
 * or is not in a state the transition allows.
 */
export const startJourney = async (db: Database, userId: string, journeyId: string): Promise<JourneyRow> => {
  const journey = await findJourney(db, userId, journeyId);
  if (journey === null) {
    throw new Error("Journey not found.");
  }
  if (journey.status !== "planned") {
    throw new Error("Only a planned journey can be started.");
  }

  return updateJourney(db, journeyId, { status: "active", startedAt: new Date() });
};

/**
 * Record that the person arrived, which is what stops an escalation.
 *
 * @throws Error when the journey is already closed.
 */
export const markJourneyArrived = async (
  db: Database,
  userId: string,
  journeyId: string,
): Promise<JourneyRow> => {
  const journey = await findJourney(db, userId, journeyId);
  if (journey === null) {
    throw new Error("Journey not found.");
  }
  if ((CLOSED_JOURNEY_STATUSES as readonly string[]).includes(journey.status)) {
    throw new Error("This journey is already closed.");
  }

  return updateJourney(db, journeyId, { status: "arrived", actualArrival: new Date() });
};

/**
 * Cancel so the journey never escalates.
 *
 * @throws Error when the journey is already closed.
 */
export const cancelJourney = async (db: Database, userId: string, journeyId: string): Promise<JourneyRow> => {
  const journey = await findJourney(db, userId, journeyId);
  if (journey === null) {
    throw new Error("Journey not found.");
  }
  if ((CLOSED_JOURNEY_STATUSES as readonly string[]).includes(journey.status)) {
    throw new Error("This journey is already closed.");
  }

  return updateJourney(db, journeyId, { status: "cancelled" });
};

/**
 * Journeys past their expected arrival that nobody has escalated yet.
 *
 * The filter is `sosAlertId IS NULL`, not `status IN ('planned', 'active')`.
 * Those are not the same set, and the difference is a family notification that
 * silently never happens.
 *
 * A journey is claimed by writing `escalatedAt` before the alert is created, so
 * that a crash in between cannot page the family twice. But if the alert
 * creation then fails, the journey is left with `escalatedAt` set and
 * `sosAlertId` null: the claim landed, the notification did not. Filtering on
 * status excludes exactly that journey, so it is never retried and never
 * reported. Filtering on `sosAlertId` instead picks it up again on the next
 * run, and still excludes journeys whose alert really did go out.
 */
export const findEscalationCandidates = async (db: Database): Promise<JourneyRow[]> => {
  return db
    .select()
    .from(journeys)
    .where(
      and(
        inArray(journeys.status, ["planned", "active", "overdue", "escalated"]),
        lte(journeys.expectedArrival, new Date()),
        isNull(journeys.sosAlertId),
      ),
    );
};

/**
 * Claim a journey for escalation, but only if nobody has claimed it already.
 *
 * The guard is `sosAlertId IS NULL` and that is load-bearing. Guarding on
 * `escalatedAt IS NULL` looks equivalent and is not: it makes the claim
 * unrepeatable, so a journey whose claim landed but whose alert failed can never
 * be retried. The alert id is the fact that matters, because it is the thing
 * that proves the family was told.
 *
 * The conditional UPDATE is still atomic, so two concurrent sweeps cannot both
 * win: the loser's `sosAlertId IS NULL` no longer matches.
 *
 * @returns true when this call is the one that claimed it.
 */
export const markJourneyEscalated = async (
  db: Database,
  journeyId: string,
  sosAlertId: string | null,
): Promise<boolean> => {
  const rows = await db
    .update(journeys)
    .set({ status: "escalated", escalatedAt: new Date(), sosAlertId })
    .where(and(eq(journeys.id, journeyId), isNull(journeys.sosAlertId)))
    .returning();

  return rows.length > 0;
};

/**
 * Undo a claim that could not be completed.
 *
 * Not strictly required for correctness any more, since `findEscalationCandidates`
 * now retries anything with a null `sosAlertId`. It is still worth doing, because
 * leaving a journey reading `escalated` is a lie the user can see on the Journey
 * screen, and a lie that says "we told your family" when we did not is the worst
 * kind in this app.
 *
 * Restores the journey completely, `escalatedAt` included. A half-released
 * journey is worse than an unreleased one: it leaves a timestamp claiming an
 * escalation happened, and that timestamp is the only record of the attempt.
 *
 * Only releases a claim that still has no alert, so a concurrent sweep that
 * completed in the meantime is never undone.
 *
 * @param previousStatus Status to restore, captured before the claim.
 * @returns true when this call is the one that released it.
 */
export const releaseJourneyEscalation = async (
  db: Database,
  journeyId: string,
  previousStatus: JourneyStatus,
): Promise<boolean> => {
  const rows = await db
    .update(journeys)
    .set({ status: previousStatus, escalatedAt: null, sosAlertId: null })
    .where(
      and(
        eq(journeys.id, journeyId),
        isNull(journeys.sosAlertId),
        isNotNull(journeys.escalatedAt),
      ),
    )
    .returning();

  return rows.length > 0;
};
