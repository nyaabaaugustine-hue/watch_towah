import { randomBytes } from "node:crypto";

import { and, asc, countDistinct, desc, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import type { RequestOptions } from "web-push";

import type { Database } from "@/db";
import {
  alertDeliveries,
  guardianContacts,
  incidentTimeline,
  incidents,
  locationPings,
  sosAlerts,
} from "@/db/schema";
import { env } from "@/lib/env";
import { AuthorizationError, ConflictError, isUniqueViolation, NotFoundError, UpstreamError } from "@/lib/errors";
import { toCompactPhone } from "@/lib/phone";
import { resolveEmergencyRecipients } from "@/server/guardian-contacts";
import { sendPushToUser } from "@/server/push";
import { sendSms } from "@/server/sms";
import { findUserById, getOrCreateUserSettings } from "@/server/users";

/**
 * How long a misfire stays harmless.
 *
 * The alert row is written immediately so evidence has a home and the owner's
 * screen can honestly say "notifying your Guardian Circle", but nothing is sent
 * until this has elapsed. A phone in a pocket must never page a family.
 */
export const GRACE_PERIOD_MS = 5000;

/**
 * An incident's breadcrumb trail is evidence, not routine telemetry, so the
 * retention sweep must not be allowed to erase it while the family still needs
 * it. Routine location pings expire in 30 days (`user_settings
 * .location_retention_days`); an SOS ping is kept for a year.
 */
const EVIDENCE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

export const SOS_TRIGGERS = ["button", "shake", "journey", "checkin"] as const;
export type SosTrigger = (typeof SOS_TRIGGERS)[number];

export const ESCALATION_KINDS = ["journey", "checkin"] as const;
export type SosEscalationKind = (typeof ESCALATION_KINDS)[number];

/**
 * Statuses that still represent a live incident.
 *
 * `acknowledged` is included deliberately: a guardian opening the tracking page
 * means someone has *seen* the alert, not that it is over. Excluding it would
 * make the owner's dashboard quietly drop the cancel and resolve controls the
 * moment a relative looked, and would let a second trigger start a parallel
 * incident while the first was still running.
 */
const LIVE_ALERT_STATUSES = ["triggered", "dispatching", "active", "acknowledged"] as const;
export type SosLiveStatus = (typeof LIVE_ALERT_STATUSES)[number];

const TERMINAL_ALERT_STATUSES = ["resolved", "cancelled"] as const;

type AlertRow = typeof sosAlerts.$inferSelect;

export type CreateSosAlertInput = {
  /**
   * Nullable because a person in danger may have GPS denied, in a tunnel, or on
   * a low-end phone whose fix takes too long. Their circle must still be told,
   * so an SOS without coordinates is a valid alert rather than a rejected one.
   */
  lat: number | null;
  lng: number | null;
  accuracy?: number | null;
  batteryLevel?: number | null;
  trigger: SosTrigger;
  note?: string;
  /** Set when the alert was raised by the system rather than the person. */
  escalatedFrom?: { kind: SosEscalationKind; id: string };
};

export type SosDispatchResult = {
  alertId: string;
  dispatched: boolean;
  notified: number;
};

/**
 * Push for an SOS is a wake-up call: it must survive the receiver's phone
 * being idle or on mobile data, and the push service holds it for an hour
 * rather than the four-week default so a retry stays possible.
 */
const SOS_PUSH_OPTIONS: RequestOptions = {
  TTL: 60 * 60,
  urgency: "high",
};

/* -------------------------------------------------------------------------- */
/*                              Timeline helpers                                */
/* -------------------------------------------------------------------------- */

const findIncidentIdForAlert = async (db: Database, alertId: string): Promise<string | null> => {
  const rows = await db
    .select({ id: incidents.id })
    .from(incidents)
    .where(eq(incidents.sosAlertId, alertId))
    .limit(1);
  return rows[0]?.id ?? null;
};

const appendIncidentTimeline = async (
  db: Database,
  incidentId: string | null,
  entry: {
    entryType: string;
    body: string;
    authorUserId: string | null;
    lat: number | null;
    lng: number | null;
  },
): Promise<void> => {
  if (incidentId === null) {
    return;
  }
  await db.insert(incidentTimeline).values({ incidentId, ...entry });
};

/* -------------------------------------------------------------------------- */
/*                              Message construction                            */
/* -------------------------------------------------------------------------- */

/**
 * Dispatch runs out-of-band — from a scheduled sweep, with no request to take
 * an origin from — so the tracking link in the SMS body is built from the
 * configured canonical origin rather than a `Host` header.
 */
const trackingUrlFor = (shareToken: string): string =>
  `${env.NEXTAUTH_URL.replace(/\/+$/, "")}/track/${shareToken}`;

/**
 * SMS is metered and read one-handed while panicking. Lead with the facts that
 * change what the reader does next: who, how urgent, where, where to follow
 * live, and that a phone call is the fastest thing they can do.
 */
const buildSosSms = (params: {
  name: string;
  lat: number | null;
  lng: number | null;
  trackingUrl: string;
}): string => {
  const lastSeen =
    params.lat !== null && params.lng !== null
      ? ` Last seen: https://maps.google.com/?q=${params.lat},${params.lng}.`
      : " Last location is not available yet.";

  return `Watchtower SOS: ${params.name} needs help.${lastSeen} Live tracking: ${params.trackingUrl}. Call them now.`;
};

const buildSosPushPayload = (params: {
  alertId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  triggeredAtIso: string;
  trackingUrl: string;
}): string =>
  JSON.stringify({
    type: "sos",
    title: `${params.name} needs help`,
    body: "Emergency SOS triggered in Watchtower.",
    alertId: params.alertId,
    lat: params.lat,
    lng: params.lng,
    triggeredAt: params.triggeredAtIso,
    trackingUrl: params.trackingUrl,
  });

/* -------------------------------------------------------------------------- */
/*                              Delivery ledger                                 */
/* -------------------------------------------------------------------------- */

type DeliveryOutcome = {
  channel: "push" | "sms";
  guardianContactIds: readonly string[];
  status: "sent" | "failed";
  lastError: string;
  providerMessageId: string | null;
};

const markDeliveries = async (db: Database, alertId: string, outcome: DeliveryOutcome): Promise<void> => {
  if (outcome.guardianContactIds.length === 0) {
    return;
  }

  await db
    .update(alertDeliveries)
    .set({
      status: outcome.status,
      // Incremented rather than assigned so a later retry records the true
      // number of attempts instead of overwriting the first one.
      attempts: sql`${alertDeliveries.attempts} + 1`,
      lastError: outcome.lastError === "" ? null : outcome.lastError,
      providerMessageId: outcome.providerMessageId,
      sentAt: outcome.status === "sent" ? new Date() : null,
    })
    .where(
      and(
        eq(alertDeliveries.sosAlertId, alertId),
        eq(alertDeliveries.channel, outcome.channel),
        inArray(alertDeliveries.guardianContactId, outcome.guardianContactIds),
      ),
    );
};

/** Recipients the SMS gateway named as unreachable, so they stay retryable. */
const unreachableNumbers = (cause: unknown): ReadonlySet<string> => {
  const numbers = new Set<string>();
  if (!(cause instanceof UpstreamError)) {
    return numbers;
  }

  const detail: unknown = cause.details.failedRecipients;
  if (!Array.isArray(detail)) {
    return numbers;
  }

  for (const entry of detail) {
    if (typeof entry === "object" && entry !== null && "recipient" in entry) {
      const recipient = (entry as { recipient: unknown }).recipient;
      if (typeof recipient === "string") {
        numbers.add(recipient);
      }
    }
  }
  return numbers;
};

const failureMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message.slice(0, 500) : "Unknown delivery failure.";

/* -------------------------------------------------------------------------- */
/*                                  Creation                                    */
/* -------------------------------------------------------------------------- */

const loadOwnedAlert = async (db: Database, userId: string, alertId: string): Promise<AlertRow> => {
  const rows = await db
    .select()
    .from(sosAlerts)
    .where(and(eq(sosAlerts.id, alertId), eq(sosAlerts.userId, userId)))
    .limit(1);

  const alert = rows[0];
  if (alert === undefined) {
    throw new NotFoundError("That alert does not exist on your account.", { alertId });
  }
  return alert;
};

/**
 * Record a new SOS. Nothing is sent here: the row exists so the owner sees an
 * honest "notifying…" screen and so the trigger's coordinates have somewhere to
 * live, but `dispatchSosAlert` waits out the grace window first.
 *
 * @throws ConflictError when the user already has a live alert. A second
 *   trigger while one is running is a duplicate press, not a second emergency.
 */
export const createSosAlert = async (
  db: Database,
  userId: string,
  input: CreateSosAlertInput,
): Promise<AlertRow> => {
  const now = new Date();

  const live = await db
    .select({ id: sosAlerts.id, status: sosAlerts.status })
    .from(sosAlerts)
    .where(and(eq(sosAlerts.userId, userId), inArray(sosAlerts.status, LIVE_ALERT_STATUSES)))
    .limit(1);

  const existing = live[0];
  if (existing !== undefined) {
    throw new ConflictError(
      "An alert is already running. Your Guardian Circle is already being told.",
      { alertId: existing.id },
    );
  }

  // The pre-check above is only there to produce a friendly message in the
  // common case. The authoritative guard is the partial unique index, so the
  // insert is wrapped to turn its violation into the same conflict rather than
  // letting a 23505 reach the client as a generic server error.
  let inserted: AlertRow[];
  try {
    inserted = await db
      .insert(sosAlerts)
      .values({
        userId,
        triggeredAt: now,
        status: "triggered",
        // A press-and-hold gets a cancel window because a person is standing
        // there who can change their mind. A missed-journey escalation is
        // nobody watching the screen, so there is nothing to cancel: it goes
        // out as soon as it is claimed, and `dispatchSosAlert` treats a null
        // window as "no grace period" rather than stranding the alert.
        cancellableUntil:
          input.escalatedFrom === undefined || input.escalatedFrom === null
            ? new Date(now.getTime() + GRACE_PERIOD_MS)
            : null,
        // 24 bytes of CSPRNG output, base64url encoded. This is the only
        // credential standing between a stranger and a live map of where a
        // frightened person is standing, so it must not be guessable or derived
        // from anything observable such as the alert id or the clock.
        shareToken: randomBytes(24).toString("base64url"),
        trigger: input.trigger,
        note: input.note ?? null,
        lat: input.lat,
        lng: input.lng,
        accuracy: input.accuracy ?? null,
        // Only the origin kind is stored; `journeys.sosAlertId` is what links
        // the escalation back to the journey or check-in that produced it.
        escalatedFrom: input.escalatedFrom?.kind ?? null,
      })
      .returning();
  } catch (cause) {
    if (isUniqueViolation(cause)) {
      throw new ConflictError("An alert is already running. Your Guardian Circle is already being told.");
    }
    throw cause;
  }

  const alert = inserted[0];
  if (alert === undefined) {
    throw new Error("SOS alert insert returned no row; RETURNING should always yield one.");
  }

  // `location_pings.lat` / `.lng` are NOT NULL, so a location-less alert simply
  // records no ping. Skipping the row is the honest outcome: a fabricated
  // coordinate would put a frightened person's family looking at the wrong place
  // on the map, which is worse than showing no breadcrumb at all.
  if (input.lat !== null && input.lng !== null) {
    await db.insert(locationPings).values({
      userId,
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy ?? null,
      batteryLevel: input.batteryLevel ?? null,
      source: "sos",
      recordedAt: now,
      // One year, not the routine 30-day window. An incident's breadcrumb trail
      // is evidence of where someone was, and the retention sweep must not be
      // allowed to delete it while the family still needs it.
      retentionExpiresAt: new Date(now.getTime() + EVIDENCE_RETENTION_MS),
    });
  }

  return alert;
};

/* -------------------------------------------------------------------------- */
/*                                 Dispatch                                     */
/* -------------------------------------------------------------------------- */

/**
 * Tell the Guardian Circle. Push first where it can work, SMS as the guaranteed
 * fallback, with every attempt written to the delivery ledger.
 *
 * Safe to call more than once: the row is claimed with a single conditional
 * UPDATE, so a second caller (a retry, or a sweep racing a manual dispatch)
 * observes zero rows and leaves the alert alone rather than sending the same
 * "I AM IN DANGER" twice.
 */
export const dispatchSosAlert = async (db: Database, alertId: string): Promise<SosDispatchResult> => {
  const loaded = await db.select().from(sosAlerts).where(eq(sosAlerts.id, alertId)).limit(1);
  const alert = loaded[0];
  if (alert === undefined) {
    throw new NotFoundError("SOS alert not found.", { alertId });
  }

  if (alert.status === "cancelled") {
    return { alertId, dispatched: false, notified: 0 };
  }

  const now = new Date();

  const claimed = await db
    .update(sosAlerts)
    .set({ status: "dispatching" })
    .where(
      and(
        eq(sosAlerts.id, alertId),
        eq(sosAlerts.status, "triggered"),
        // A null window means the alert was never cancellable (a system
        // escalation), so it goes out immediately rather than being stranded.
        or(isNull(sosAlerts.cancellableUntil), lte(sosAlerts.cancellableUntil, now)),
      ),
    )
    .returning({ userId: sosAlerts.userId });

  if (claimed.length === 0) {
    return { alertId, dispatched: false, notified: 0 };
  }

  try {
    const owner = await findUserById(db, alert.userId);
    const settings = await getOrCreateUserSettings(db, alert.userId);
    // No permission-level filter. `resolveEmergencyRecipients` returns the
    // whole circle on purpose: `emergency_only` describes routine tracking, not
    // whether a person must be told that a relative is in danger.
    const recipients = await resolveEmergencyRecipients(db, alert.userId);
    const trackingUrl = trackingUrlFor(alert.shareToken);

    const incidentRows = await db
      .insert(incidents)
      .values({
        kind: "sos",
        sosAlertId: alert.id,
        title: `${owner.name} needs help`,
        lastKnownLat: alert.lat,
        lastKnownLng: alert.lng,
        lastKnownAt: alert.triggeredAt,
        status: "open",
        summary:
          alert.trigger === "shake"
            ? "SOS raised by the silent shake alert."
            : "SOS raised from the Watchtower app.",
      })
      .returning({ id: incidents.id });

    const incidentId = incidentRows[0]?.id ?? null;

    // The tracking link is a capability URL, so it is never written into the
    // circle-visible timeline — the SMS carries it to recipients directly.
    await appendIncidentTimeline(db, incidentId, {
      entryType: "sos_triggered",
      body: `${owner.name} raised an emergency SOS from Watchtower.`,
      authorUserId: alert.userId,
      lat: alert.lat,
      lng: alert.lng,
    });

    if (recipients.length === 0) {
      console.error("sos raised with an empty guardian circle", { alertId, userId: alert.userId });
      await appendIncidentTimeline(db, incidentId, {
        entryType: "sos_no_recipients",
        body:
          "Nobody was notified: this account has no Guardian Circle yet. Add a contact and raise SOS again.",
        authorUserId: null,
        lat: alert.lat,
        lng: alert.lng,
      });
    }

    // The ledger is written up front so a crash halfway through still proves
    // what was attempted, and so an SMS fallback knows it is a fallback.
    const pendingRows: (typeof alertDeliveries.$inferInsert)[] = recipients.flatMap((contact) => [
      { sosAlertId: alert.id, guardianContactId: contact.id, channel: "push" as const },
      { sosAlertId: alert.id, guardianContactId: contact.id, channel: "sms" as const },
    ]);

    if (pendingRows.length > 0) {
      await db.insert(alertDeliveries).values(pendingRows);
    }

    const pushPayload = buildSosPushPayload({
      alertId: alert.id,
      name: owner.name,
      lat: alert.lat,
      lng: alert.lng,
      triggeredAtIso: alert.triggeredAt.toISOString(),
      trackingUrl,
    });

    const pushAttempted: string[] = [];
    const pushAccepted: string[] = [];
    const pushWithoutAccount: string[] = [];
    const pushSuppressedBySmsOnly: string[] = [];

    for (const contact of recipients) {
      if (settings.smsOnly) {
        pushSuppressedBySmsOnly.push(contact.id);
        continue;
      }
      if (contact.contactUserId === null) {
        // The common case in Ghana: a relative on a feature phone. They get SMS.
        pushWithoutAccount.push(contact.id);
        continue;
      }

      pushAttempted.push(contact.id);
      const accepted = await sendPushToUser(db, contact.contactUserId, pushPayload, SOS_PUSH_OPTIONS);
      if (accepted > 0) {
        pushAccepted.push(contact.id);
      }
    }

    const pushAcceptedIds = new Set(pushAccepted);
    const pushFailedIds = pushAttempted.filter((id) => !pushAcceptedIds.has(id));

    await markDeliveries(db, alert.id, {
      channel: "push",
      guardianContactIds: pushAccepted,
      status: "sent",
      lastError: "",
      providerMessageId: null,
    });
    await markDeliveries(db, alert.id, {
      channel: "push",
      guardianContactIds: pushFailedIds,
      status: "failed",
      lastError: "The push service did not accept the notification for any of this device's subscriptions.",
      providerMessageId: null,
    });
    await markDeliveries(db, alert.id, {
      channel: "push",
      guardianContactIds: pushWithoutAccount,
      status: "failed",
      lastError: "This contact has no Watchtower app account, so only SMS can reach them.",
      providerMessageId: null,
    });
    await markDeliveries(db, alert.id, {
      channel: "push",
      guardianContactIds: pushSuppressedBySmsOnly,
      status: "failed",
      lastError: "The alert owner has SMS-only alerts switched on.",
      providerMessageId: null,
    });

    // SMS covers everyone the push did not land for: not attempted (no app
    // account, or SMS-only mode), or attempted and rejected.
    const smsTargets = recipients.filter((contact) => !pushAcceptedIds.has(contact.id));
    let smsAccepted = 0;
    let smsFailed = 0;
    const overrideNote = !settings.smsFallbackEnabled && smsTargets.length > 0
      ? " SMS fallback was switched off, but the text was sent anyway: it is the only channel guaranteed to reach a relative without the app."
      : "";

    if (smsTargets.length > 0) {
      // One batched call, because every number in a batched send shares the
      // per-message gateway cost. The ledger still records a row per guardian,
      // so a single unreachable number stays visible to the circle.
      const numbers = smsTargets.map((contact) => toCompactPhone(contact.phone));

      try {
        const result = await sendSms(
          buildSosSms({ name: owner.name, lat: alert.lat, lng: alert.lng, trackingUrl }),
          numbers,
        );

        await markDeliveries(db, alert.id, {
          channel: "sms",
          guardianContactIds: smsTargets.map((contact) => contact.id),
          status: "sent",
          lastError: "",
          providerMessageId: result.providerMessageId,
        });
        smsAccepted = smsTargets.length;
      } catch (cause) {
        const unreachable = unreachableNumbers(cause);
        const acceptedIds: string[] = [];
        const failedIds: string[] = [];

        for (const contact of smsTargets) {
          const number = toCompactPhone(contact.phone);
          // When the gateway names the numbers it could not reach, the rest of
          // the batch was accepted — marking the whole batch failed would hide
          // which guardian actually still needs to be called.
          if (unreachable.size === 0 || unreachable.has(number)) {
            failedIds.push(contact.id);
          } else {
            acceptedIds.push(contact.id);
          }
        }

        await markDeliveries(db, alert.id, {
          channel: "sms",
          guardianContactIds: acceptedIds,
          status: "sent",
          lastError: "",
          providerMessageId: null,
        });
        await markDeliveries(db, alert.id, {
          channel: "sms",
          guardianContactIds: failedIds,
          status: "failed",
          lastError: failureMessage(cause),
          providerMessageId: null,
        });

        smsAccepted = acceptedIds.length;
        smsFailed = failedIds.length;
        console.error("sos sms fallback did not reach every guardian", {
          alertId,
          acceptedCount: smsAccepted,
          failedCount: smsFailed,
          cause,
        });
      }
    }

    await appendIncidentTimeline(db, incidentId, {
      entryType: "sos_dispatched",
      body:
        recipients.length === 0
          ? "No Guardian Circle members were available to notify."
          : `Guardian Circle notified: ${pushAccepted.length} by push, ${smsAccepted} by SMS.${smsFailed > 0 ? ` ${smsFailed} could not be reached by SMS.` : ""}${overrideNote}`,
      authorUserId: null,
      lat: alert.lat,
      lng: alert.lng,
    });
  } catch (cause) {
    // The alert is live whatever went wrong, and the ledger already records how
    // far the fan-out got. Re-queueing it as `triggered` instead would replay a
    // partially delivered batch and land a second identical "I AM IN DANGER"
    // text on someone who already has the first.
    console.error("sos dispatch failed mid-flight", { alertId, cause });
  }

  // Only from `dispatching`, so an alert the user cancelled or resolved while
  // the fan-out was in the air is not resurrected.
  await db
    .update(sosAlerts)
    .set({ status: "active" })
    .where(and(eq(sosAlerts.id, alertId), eq(sosAlerts.status, "dispatching")));

  return { alertId, dispatched: true, notified: await countNotifiedGuardians(db, alertId) };
};

/**
 * How many distinct guardians actually received the alert, from the delivery
 * ledger rather than a guess at what "sent" meant.
 */
export const countNotifiedGuardians = async (db: Database, alertId: string): Promise<number> => {
  const rows = await db
    .select({ value: countDistinct(alertDeliveries.guardianContactId) })
    .from(alertDeliveries)
    .where(and(eq(alertDeliveries.sosAlertId, alertId), eq(alertDeliveries.status, "sent")));

  return Number(rows[0]?.value ?? 0);
};

/* -------------------------------------------------------------------------- */
/*                              Lifecycle transitions                           */
/* -------------------------------------------------------------------------- */

/**
 * Stop an alert that nobody has been told about yet.
 *
 * Idempotent: a double tap on CANCEL is very likely on a shaking phone, and
 * answering the second tap with a conflict error would tell the user their own
 * successful cancellation failed.
 */
export const cancelSosAlert = async (
  db: Database,
  userId: string,
  alertId: string,
): Promise<AlertRow> => {
  const alert = await loadOwnedAlert(db, userId, alertId);
  if (alert.status === "cancelled") {
    return alert;
  }

  const now = new Date();
  if (alert.cancellableUntil === null || alert.cancellableUntil.getTime() <= now.getTime()) {
    throw new ConflictError(
      "This alert has already gone out to your Guardian Circle and can no longer be cancelled.",
      { alertId },
    );
  }

  const cancelled = await db
    .update(sosAlerts)
    .set({ status: "cancelled", resolvedAt: now })
    .where(and(eq(sosAlerts.id, alertId), eq(sosAlerts.status, "triggered")))
    .returning();

  const result = cancelled[0];
  if (result === undefined) {
    throw new ConflictError(
      "This alert has already gone out to your Guardian Circle and can no longer be cancelled.",
      { alertId },
    );
  }

  const incidentId = await findIncidentIdForAlert(db, alertId);
  if (incidentId === null) {
    // Dispatch had not run yet, so there is no incident. Opening a resolved one
    // for a misfire would fill the circle's incident list with something that
    // never happened; the cancelled alert row is the whole record.
    console.info("sos cancelled inside the grace window; no incident opened", { alertId });
    return result;
  }

  await db
    .update(incidents)
    .set({ status: "resolved", resolvedAt: now })
    .where(and(eq(incidents.id, incidentId), eq(incidents.status, "open")));

  await appendIncidentTimeline(db, incidentId, {
    entryType: "sos_cancelled",
    body: "The alert owner cancelled this SOS. It did not reach the Guardian Circle.",
    authorUserId: userId,
    lat: alert.lat,
    lng: alert.lng,
  });

  return result;
};

/** Stand the incident down: the owner says they are safe. */
export const resolveSosAlert = async (
  db: Database,
  userId: string,
  alertId: string,
): Promise<AlertRow> => {
  const alert = await loadOwnedAlert(db, userId, alertId);
  if (alert.status === "resolved") {
    return alert;
  }

  const now = new Date();
  const resolved = await db
    .update(sosAlerts)
    .set({ status: "resolved", resolvedAt: now })
    .where(
      and(
        eq(sosAlerts.id, alertId),
        notInArray(sosAlerts.status, [...TERMINAL_ALERT_STATUSES]),
      ),
    )
    .returning();

  const result = resolved[0];
  if (result === undefined) {
    // Already cancelled, so there is nothing live left to stand down.
    return alert;
  }

  const incidentId = await findIncidentIdForAlert(db, alertId);
  if (incidentId !== null) {
    await db
      .update(incidents)
      .set({ status: "resolved", resolvedAt: now })
      .where(and(eq(incidents.id, incidentId), eq(incidents.status, "open")));

    await appendIncidentTimeline(db, incidentId, {
      entryType: "sos_resolved",
      body: "The alert owner marked themselves safe. No further action is needed.",
      authorUserId: userId,
      lat: alert.lat,
      lng: alert.lng,
    });
  }

  return result;
};

const isLiveStatus = (value: AlertRow["status"]): value is SosLiveStatus =>
  LIVE_ALERT_STATUSES.some((status) => status === value);

/**
 * The owner's current live alert, or null.
 *
 * The status is re-checked in application code as well as in SQL so the
 * declared type is honest: a caller cannot hand a terminal status to a UI that
 * only knows how to render a running incident.
 */
export const getActiveSosAlert = async (
  db: Database,
  userId: string,
): Promise<(AlertRow & { status: SosLiveStatus }) | null> => {
  const rows = await db
    .select()
    .from(sosAlerts)
    .where(and(eq(sosAlerts.userId, userId), inArray(sosAlerts.status, LIVE_ALERT_STATUSES)))
    .orderBy(desc(sosAlerts.triggeredAt))
    .limit(1);

  const alert = rows[0];
  if (alert === undefined || !isLiveStatus(alert.status)) {
    return null;
  }
  return { ...alert, status: alert.status };
};

/**
 * A Guardian Circle member opened the live tracking link.
 *
 * Throws AuthorizationError unless the viewer really is a guardian of the
 * person who raised the alert, because the tracking token is shareable and
 * anyone holding it can open the page.
 */
export const recordAcknowledgement = async (
  db: Database,
  alertId: string,
  guardianUserId: string,
): Promise<void> => {
  const loaded = await db.select().from(sosAlerts).where(eq(sosAlerts.id, alertId)).limit(1);
  const alert = loaded[0];
  if (alert === undefined) {
    throw new NotFoundError("SOS alert not found.", { alertId });
  }

  if (alert.status === "acknowledged") {
    return;
  }
  if (alert.status === "resolved" || alert.status === "cancelled") {
    return;
  }

  const guardian = await db
    .select({ id: guardianContacts.id })
    .from(guardianContacts)
    .where(
      and(
        eq(guardianContacts.contactUserId, guardianUserId),
        eq(guardianContacts.userId, alert.userId),
      ),
    )
    .limit(1);

  if (guardian.length === 0) {
    throw new AuthorizationError("You are not a Guardian Circle member for this alert.", { alertId });
  }

  if (alert.status === "triggered") {
    // Dispatch claims rows by status = 'triggered', so flipping to
    // 'acknowledged' here would stop the alert from ever being sent at all.
    console.warn("acknowledgement arrived before the alert was dispatched", {
      alertId,
      guardianUserId,
    });
  } else {
    await db
      .update(sosAlerts)
      .set({ status: "acknowledged" })
      .where(
        and(
          eq(sosAlerts.id, alertId),
          inArray(sosAlerts.status, ["dispatching", "active"]),
        ),
      );
  }

  const incidentId = await findIncidentIdForAlert(db, alertId);
  await appendIncidentTimeline(db, incidentId, {
    entryType: "guardian_acknowledged",
    // Wording matters here: this is written by a page load, not by a button
    // press, so it records only what actually happened. A browser prefetch or a
    // link scanner can trigger it, and "they have seen this alert" in a safety
    // record is a claim the data does not support.
    body: "A Guardian Circle member opened the live tracking link. Whether they have read the full alert cannot be known from here.",
    authorUserId: guardianUserId,
    lat: alert.lat,
    lng: alert.lng,
  });
};

/* -------------------------------------------------------------------------- */
/*                                 Sweeping                                     */
/* -------------------------------------------------------------------------- */

const SWEEP_BATCH_SIZE = 50;

/**
 * Send every alert whose grace window has closed.
 *
 * Dispatch deliberately cannot be a `setTimeout` in the request that created
 * the alert: a serverless invocation can be frozen or reclaimed the moment it
 * returns, so a pending timer is not a promise that anyone will ever be told.
 * The database is the durable queue — the row is written synchronously and a
 * later sweep finds it, however many times the sweep runs. It is safe to run
 * this repeatedly, and safe to run it late.
 */
export const dispatchDueSosAlerts = async (
  db: Database,
): Promise<{ attempted: number; notified: number; failed: number }> => {
  const now = new Date();

  const due = await db
    .select({ id: sosAlerts.id })
    .from(sosAlerts)
    .where(
      and(
        eq(sosAlerts.status, "triggered"),
        or(isNull(sosAlerts.cancellableUntil), lte(sosAlerts.cancellableUntil, now)),
      ),
    )
    .orderBy(asc(sosAlerts.triggeredAt))
    .limit(SWEEP_BATCH_SIZE);

  let attempted = 0;
  let notified = 0;
  let failed = 0;

  for (const row of due) {
    try {
      const result = await dispatchSosAlert(db, row.id);
      if (result.dispatched) {
        attempted += 1;
        notified += result.notified;
      }
    } catch (cause) {
      failed += 1;
      console.error("sos sweep could not process an alert", { alertId: row.id, cause });
    }
  }

  return { attempted, notified, failed };
};
