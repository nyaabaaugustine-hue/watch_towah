import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";

import type { Database } from "@/db";
import { authThrottle, journeys, otpCodes } from "@/db/schema";
import type { JourneyStatus } from "@/lib/journey";
import { findEscalationCandidates, markJourneyEscalated, releaseJourneyEscalation } from "@/server/journeys";
import { sweepExpiredLocationPings } from "@/server/location";
import { createSosAlert, dispatchDueSosAlerts, dispatchSosAlert } from "@/server/sos";

/**
 * Scheduled work that has to happen with nobody present.
 *
 * Three separate promises were documented in this codebase and none of them ran.
 * The journey dead-man switch had `findEscalationCandidates` and
 * `markJourneyEscalated` written with zero call sites, so a missed check-in
 * could never alert anybody. Location retention was a `pg_cron` job in the
 * initial migration, which was never registered, so breadcrumbs were kept
 * indefinitely. Login codes and throttle rows were never deleted at all.
 *
 * All of it runs from one scheduled job so there is a single thing to configure
 * and a single thing to reason about when it stops running.
 */

/** Rows deleted per sweep, chosen to stay well inside the function's budget. */
const SWEEP_BATCH = 500;

/** A login code has no value once its TTL has passed and it was not used. */
const OTP_KEEP_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * A throttle key that is neither locked nor recently touched is inert. Rows were
 * only ever removed on a successful sign-in, so every number that ever failed a
 * guess kept its row for the life of the deployment.
 */
const THROTTLE_KEEP_AFTER_MS = 24 * 60 * 60 * 1000;

export type JourneyEscalationResult = {
  candidates: number;
  escalated: number;
  /** Journeys whose family notification has not completed. */
  failed: number;
};

/**
 * Page the Guardian Circle for journeys nobody arrived for.
 *
 * The order of operations is the design. The journey is claimed first, because
 * `markJourneyEscalated` is guarded on `sosAlertId IS NULL` and that conditional
 * update is what stops two concurrent sweeps from paging the same family twice.
 * Only the winner creates an alert, so a losing sweep leaves no stray row to
 * clean up. If the function is reclaimed between the claim and the dispatch, the
 * alert is left `triggered` with no cancel window and the SOS backstop in this
 * same job collects it on the next run, rather than the escalation being
 * silently dropped.
 *
 * If the claim lands but the alert cannot be created, the journey is released
 * and counted as a failure. The common cause is the owner already having a live
 * alert, which means somebody already told their family and there is nothing
 * more to send, but the journey must not keep claiming otherwise.
 */
export const escalateOverdueJourneys = async (db: Database): Promise<JourneyEscalationResult> => {
  const candidates = await findEscalationCandidates(db);
  const result: JourneyEscalationResult = {
    candidates: candidates.length,
    escalated: 0,
    failed: 0,
  };

  for (const journey of candidates) {
    // Captured before the claim, because releasing the journey means putting it
    // back the way it was found.
    const previousStatus = journey.status as JourneyStatus;

    const claimed = await markJourneyEscalated(db, journey.id, null);
    if (!claimed) {
      continue;
    }

    let alertId: string;
    try {
      const alert = await createSosAlert(db, journey.userId, {
        trigger: "journey",
        escalatedFrom: { kind: "journey", id: journey.id },
        lat: null,
        lng: null,
        note: `Missed check-in on the way to ${journey.destinationLabel}.`,
      });
      alertId = alert.id;

      // Set after the alert exists, so the journey can only ever point at an
      // alert that was really raised for it.
      await db.update(journeys).set({ sosAlertId: alert.id }).where(eq(journeys.id, journey.id));
    } catch (cause) {
      // Hand the journey back. `createSosAlert` rejects when the user already has
      // a live alert, which is the expected outcome for somebody who pressed SOS
      // by hand and then also missed a check-in. The family has already been
      // told by the first alert, so there is nothing more to send; but the
      // journey must not be left looking escalated, or the UI would claim a
      // notification that never happened and no later sweep would pick it up.
      const released = await releaseJourneyEscalation(db, journey.id, previousStatus);

      console.error("journey escalation could not raise an alert", {
        journeyId: journey.id,
        released,
        cause,
      });
      result.failed += 1;
      continue;
    }

    try {
      await dispatchSosAlert(db, alertId);
      result.escalated += 1;
    } catch (cause) {
      // No release here. The alert exists, so the backstop sweep in this same
      // job will finish notifying; releasing the journey would only invite a
      // second alert and a second round of calls.
      console.error("journey escalation dispatch failed", { journeyId: journey.id, alertId, cause });
      result.failed += 1;
    }
  }

  return result;
};

/** Delete login codes that expired a day ago, or were consumed a day ago. */
export const sweepExpiredOtpCodes = async (db: Database, limit = SWEEP_BATCH): Promise<number> => {
  const now = new Date();
  const cutoff = new Date(now.getTime() - OTP_KEEP_AFTER_MS);

  const rows = await db
    .select({ id: otpCodes.id })
    .from(otpCodes)
    .where(or(lt(otpCodes.expiresAt, now), and(isNotNull(otpCodes.consumedAt), lt(otpCodes.consumedAt, cutoff))))
    .limit(limit);

  if (rows.length === 0) {
    return 0;
  }

  const deleted = await db
    .delete(otpCodes)
    .where(
      and(
        inArray(otpCodes.id, rows.map((row: { id: string }) => row.id)),
        or(lt(otpCodes.expiresAt, now), and(isNotNull(otpCodes.consumedAt), lt(otpCodes.consumedAt, cutoff))),
      ),
    )
    .returning({ id: otpCodes.id });

  return deleted.length;
};

/** Delete throttle keys that can no longer lock anybody out. */
export const sweepStaleAuthThrottle = async (db: Database, limit = SWEEP_BATCH): Promise<number> => {
  const now = new Date();
  const cutoff = new Date(now.getTime() - THROTTLE_KEEP_AFTER_MS);

  const rows = await db
    .select({ key: authThrottle.key })
    .from(authThrottle)
    .where(
      and(
        lt(authThrottle.updatedAt, cutoff),
        or(isNull(authThrottle.lockedUntil), lt(authThrottle.lockedUntil, now)),
      ),
    )
    .limit(limit);

  if (rows.length === 0) {
    return 0;
  }

  const deleted = await db
    .delete(authThrottle)
    .where(
      and(
        inArray(authThrottle.key, rows.map((row: { key: string }) => row.key)),
        lt(authThrottle.updatedAt, cutoff),
        or(isNull(authThrottle.lockedUntil), lt(authThrottle.lockedUntil, now)),
      ),
    )
    .returning({ key: authThrottle.key });

  return deleted.length;
};

export type SafetySweepResult = {
  sos: { attempted: number; notified: number; failed: number };
  journeys: JourneyEscalationResult;
  deletedPings: number;
  deletedOtpCodes: number;
  deletedThrottleKeys: number;
};

/**
 * One pass of every scheduled guarantee, in dependency order.
 *
 * The SOS backstop runs first because it is the only time-critical part. Journey
 * escalation runs next so a page is never delayed behind bulk deletes. The
 * retention sweeps run last: being one cycle late is harmless there, because
 * every row carries its own deadline and the next run collects it.
 */
export const runSafetySweep = async (db: Database): Promise<SafetySweepResult> => {
  const sos = await dispatchDueSosAlerts(db);
  const journeyResult = await escalateOverdueJourneys(db);
  const deletedPings = await sweepExpiredLocationPings(db);
  const deletedOtpCodes = await sweepExpiredOtpCodes(db);
  const deletedThrottleKeys = await sweepStaleAuthThrottle(db);

  return { sos, journeys: journeyResult, deletedPings, deletedOtpCodes, deletedThrottleKeys };
};
