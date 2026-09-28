import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  guardianContacts,
  journeys,
  locationPings,
  locationShareRecipients,
  locationShares,
  type LocationPing,
} from "@/db/schema";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import { getActiveSosAlert } from "@/server/sos";
import { getOrCreateUserSettings } from "@/server/users";

/* -------------------------------------------------------------------------- */
/*                                   Types                                     */
/* -------------------------------------------------------------------------- */

export type LocationPingSource = "background" | "manual" | "journey" | "sos" | "shared";

export type RecordPingInput = {
  lat: number;
  lng: number;
  accuracy?: number | null;
  altitude?: number | null;
  speed?: number | null;
  heading?: number | null;
  batteryLevel?: number | null;
  source: LocationPingSource;
  /** Client capture time. Defaults to now when the caller does not supply it. */
  recordedAt?: Date;
  /**
   * Stable device-generated UUID for this reading, reused on every retry.
   *
   * Supplying it makes the insert idempotent: a client that never saw the
   * response to its first attempt can retry safely and get the original row
   * back instead of a duplicate breadcrumb.
   */
  clientId?: string | null;
};
export type StartShareInput = {
  audience: "circle" | "public_link";
  label?: string;
  /** Minutes the share stays open. Omit for "until manually stopped". */
  durationMinutes?: number;
  /** Circle shares only: which guardians were granted access. */
  guardianContactIds: string[];
};

export type LocationShareRow = typeof locationShares.$inferSelect;

export type ShareStartResult = {
  share: LocationShareRow;
  /** Only public links get a token; circle shares are authorised by session. */
  shareToken: string | null;
};

export type ViewerAccess = {
  allowed: boolean;
  reason: "granted" | "no_contact" | "no_share" | "permission_denied" | "not_permitted_yet";
  permissionLevel: "always_on" | "scheduled" | "emergency_only" | null;
};

export const MAX_SHARE_MINUTES = 24 * 60;

/**
 * How far a client-supplied capture time may sit from now.
 *
 * `recordedAt` arrives from the device, so it is attacker-controlled and the
 * schema used to coerce anything it was given. `z.coerce.date()` turns `null`
 * and `0` into the epoch, which produced a breadcrumb stamped 1970: its
 * retention deadline was instantly in the past, and because
 * `getLatestPing` orders by `recordedAt` a later real ping still won, so the
 * damage was a row that looked like ancient history. The far end was worse in
 * principle: a far-future stamp pushes the retention deadline past any sweep.
 *
 * The forward skew is tight because a queued ping is only ever minutes old. The
 * backward window is generous because a phone can be off for days.
 */
export const MAX_PING_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const MAX_PING_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;

/** @throws ValidationError when `at` is not a real reading close to now. */
export const assertPlausibleRecordedAt = (at: Date, now: Date = new Date()): void => {
  const delta = at.getTime() - now.getTime();

  if (Number.isNaN(delta)) {
    throw new ValidationError("That timestamp could not be read.");
  }
  if (delta > MAX_PING_CLOCK_SKEW_MS) {
    throw new ValidationError("That reading is stamped in the future.");
  }
  if (delta < -MAX_PING_BACKDATE_MS) {
    throw new ValidationError("That reading is too old to be a real location.");
  }
};

/* -------------------------------------------------------------------------- */
/*                              Retention policy                               */
/* -------------------------------------------------------------------------- */

/**
 * Data minimisation deadline for a new ping, taken from the owner's own setting.
 *
 * Read per insert rather than cached, because the retention sweep in the initial
 * migration compares against this column and a stale value would either delete
 * history early or keep it past the window the user agreed to.
 */
const resolveRetentionExpiry = async (db: Database, userId: string, recordedAt: Date): Promise<Date> => {
  // Creating the row on first use keeps a user who has not finished onboarding
  // from silently falling back to a retention window nobody chose.
  const settings = await getOrCreateUserSettings(db, userId);
  return new Date(recordedAt.getTime() + settings.locationRetentionDays * 24 * 60 * 60 * 1000);
};

/* -------------------------------------------------------------------------- */
/*                                  Recording                                   */
/* -------------------------------------------------------------------------- */

/**
 * Append one breadcrumb for a user.
 *
 * @throws ValidationError when the coordinates are out of range. Callers should
 *   have validated already; this guards direct server-side callers.
 */
export const recordLocationPing = async (
  db: Database,
  userId: string,
  input: RecordPingInput,
): Promise<LocationPing> => {
  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90) {
    throw new ValidationError("Latitude is out of range.");
  }
  if (!Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180) {
    throw new ValidationError("Longitude is out of range.");
  }

  const recordedAt = input.recordedAt ?? new Date();
  // Re-checked here rather than trusted from the route, because this function is
  // also called directly by the SOS path and by any future server-side writer.
  assertPlausibleRecordedAt(recordedAt);
  const retentionExpiresAt = await resolveRetentionExpiry(db, userId, recordedAt);

  const clientId = input.clientId ?? null;

  const [inserted] = await db
    .insert(locationPings)
    .values({
      userId,
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy ?? null,
      altitude: input.altitude ?? null,
      speed: input.speed ?? null,
      heading: input.heading ?? null,
      batteryLevel: input.batteryLevel ?? null,
      source: input.source,
      recordedAt,
      clientId,
      retentionExpiresAt,
    })
    .onConflictDoNothing({
      // Matches location_pings_user_client_key, including its partial predicate.
      // Postgres only treats the insert as conflicting if the existing row also
      // satisfies the index WHERE clause, so the same condition has to be
      // repeated here. Without a clientId there is nothing to conflict on, so
      // this only ever fires on a genuine retry.
      target: [locationPings.userId, locationPings.clientId],
      where: isNotNull(locationPings.clientId),
    })
    .returning();

  if (inserted !== undefined) {
    return inserted;
  }

  // Conflict: this exact reading was already stored, which means the previous
  // attempt succeeded and its response was lost. Return the original row so the
  // client sees a success and stops retrying.
  if (clientId !== null) {
    const [existing] = await db
      .select()
      .from(locationPings)
      .where(and(eq(locationPings.userId, userId), eq(locationPings.clientId, clientId)))
      .limit(1);

    if (existing !== undefined) {
      return existing;
    }
  }

  throw new Error("location_pings insert returned no row; RETURNING should always yield one.");
};

/** The owner's most recent breadcrumb, or null if they have never reported one. */
export const getLatestPing = async (db: Database, userId: string): Promise<LocationPing | null> => {
  const [ping] = await db
    .select()
    .from(locationPings)
    .where(eq(locationPings.userId, userId))
    .orderBy(desc(locationPings.recordedAt))
    .limit(1);

  return ping ?? null;
};

/**
 * Breadcrumbs newest-first for drawing a trail.
 *
 * @param limit Hard cap on rows. The trail is a visual, not a location history,
 *   so this is deliberately small enough to stay cheap on a 2G connection.
 */
export const getRecentPings = async (
  db: Database,
  userId: string,
  limit: number,
): Promise<LocationPing[]> => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ValidationError("Limit must be a positive whole number.");
  }

  return db
    .select()
    .from(locationPings)
    .where(eq(locationPings.userId, userId))
    .orderBy(desc(locationPings.recordedAt))
    .limit(limit);
};

/* -------------------------------------------------------------------------- */
/*                              Share lifecycle                                */
/* -------------------------------------------------------------------------- */

/** A share is live when it was not stopped and has not passed its expiry. */
const activeShareConditions = (now: Date) =>
  and(
    isNull(locationShares.stoppedAt),
    or(isNull(locationShares.expiresAt), gt(locationShares.expiresAt, now)),
  );

export const startLocationShare = async (
  db: Database,
  userId: string,
  input: StartShareInput,
): Promise<ShareStartResult> => {
  const now = new Date();

  if (input.durationMinutes !== undefined && input.durationMinutes > MAX_SHARE_MINUTES) {
    throw new ValidationError("A share can stay open for at most 24 hours.");
  }

  // A circle share is meaningless with nobody on the other end of it, so reject
  // it early rather than creating a row that grants access to no one.
  if (input.audience === "circle" && input.guardianContactIds.length === 0) {
    throw new ValidationError("Choose at least one person in your circle to share with.");
  }

  if (input.guardianContactIds.length > 0) {
    // Contacts must belong to this owner. Without the check, a caller could name
    // another account's contact id and grant that stranger live location.
    const owned = await db
      .select({ id: guardianContacts.id })
      .from(guardianContacts)
      .where(
        and(
          eq(guardianContacts.userId, userId),
          inArray(guardianContacts.id, input.guardianContactIds),
        ),
      );

    if (owned.length !== input.guardianContactIds.length) {
      throw new ValidationError("One of those people is not in your circle.");
    }
  }

  // Only public links get a token. Circle access is authorised by session, so
  // minting a guessable-by-UUID capability for it would add risk and no benefit.
  const shareToken = input.audience === "public_link" ? randomBytes(24).toString("base64url") : null;

  const [share] = await db
    .insert(locationShares)
    .values({
      userId,
      audience: input.audience,
      shareToken,
      label: input.label ?? null,
      startedAt: now,
      expiresAt:
        input.durationMinutes === undefined
          ? null
          : new Date(now.getTime() + input.durationMinutes * 60_000),
    })
    .returning();

  if (share === undefined) {
    throw new Error("location_shares insert returned no row; RETURNING should always yield one.");
  }

  if (input.guardianContactIds.length > 0) {
    await db
      .insert(locationShareRecipients)
      .values(
        input.guardianContactIds.map((guardianContactId) => ({
          shareId: share.id,
          guardianContactId,
        })),
      );
  }

  return { share, shareToken };
};

/**
 * Stop a share the caller owns.
 *
 * @throws NotFoundError when the share does not exist or belongs to someone
 *   else. Both cases return the same error so this cannot be used to probe for
 *   the existence of another user's share ids.
 */
export const stopLocationShare = async (
  db: Database,
  userId: string,
  shareId: string,
): Promise<LocationShareRow> => {
  const now = new Date();

  const [stopped] = await db
    .update(locationShares)
    .set({ stoppedAt: now })
    .where(
      and(
        eq(locationShares.id, shareId),
        eq(locationShares.userId, userId),
        isNull(locationShares.stoppedAt),
      ),
    )
    .returning();

  if (stopped === undefined) {
    throw new NotFoundError("That share is not running.");
  }

  return stopped;
};

export const listActiveShares = async (
  db: Database,
  userId: string,
): Promise<LocationShareRow[]> => {
  const now = new Date();
  return db
    .select()
    .from(locationShares)
    .where(and(eq(locationShares.userId, userId), activeShareConditions(now)))
    .orderBy(desc(locationShares.startedAt));
};

export const getShareByToken = async (
  db: Database,
  token: string,
): Promise<LocationShareRow | null> => {
  const [share] = await db
    .select()
    .from(locationShares)
    .where(eq(locationShares.shareToken, token))
    .limit(1);

  return share ?? null;
};

/* -------------------------------------------------------------------------- */
/*                              Access decisions                                */
/* -------------------------------------------------------------------------- */

/**
 * Whether a signed-in guardian may watch the owner's live location right now.
 *
 * Conditions that must all hold:
 *
 * 1. The viewer is a guardian contact of the owner, pointing at their own user
 *    id via `contactUserId`. Being in the same Guardian Circle as someone else
 *    is not enough.
 * 2. The owner's permission level permits visibility in the current situation.
 *    `always_on` always does; `scheduled` does while a journey is under way;
 *    `emergency_only` does only while an SOS is live.
 * 3. There is an active share, unless a live SOS is standing in as the authority
 *    to reveal location. A stopped or expired share is refused even for an
 *    `always_on` guardian, because sharing is something the owner starts and ends.
 * 4. The viewer is one of the people that share was granted to. This used to be
 *    missing, and it made the whole per-recipient grant meaningless: an
 *    `always_on` guardian who was left off a share could still open the live
 *    stream, because only the parent `location_shares` row was consulted and the
 *    `location_share_recipients` rows were written and then never read.
 *
 * @param viewerUserId The signed-in guardian.
 * @param ownerUserId The person whose position is being requested.
 * @returns The decision plus which condition failed, for logging. Never throws,
 *   because every caller ends up refusing an unauthorised viewer anyway.
 */
export const resolveViewerAccess = async (
  db: Database,
  viewerUserId: string,
  ownerUserId: string,
): Promise<ViewerAccess> => {
  if (viewerUserId === ownerUserId) {
    return { allowed: true, reason: "granted", permissionLevel: "always_on" };
  }

  const [contact] = await db
    .select({ id: guardianContacts.id, level: guardianContacts.permissionLevel })
    .from(guardianContacts)
    .where(
      and(
        eq(guardianContacts.userId, ownerUserId),
        eq(guardianContacts.contactUserId, viewerUserId),
      ),
    )
    .limit(1);

  if (contact === undefined) {
    return { allowed: false, reason: "no_contact", permissionLevel: null };
  }

  const level = contact.level;

  const liveAlert = await getActiveSosAlert(db, ownerUserId);
  const sosIsLive = liveAlert !== null;

  // A live SOS is the owner's own act of escalation. It overrides a stopped
  // share, because someone pressing the button expects help to be able to find
  // them even if sharing had been switched off beforehand. It also overrides the
  // recipient grant: in a crisis the owner is not selecting from a list.
  if (!sosIsLive) {
    const [activeShare] = await db
      .select({ id: locationShares.id, audience: locationShares.audience })
      .from(locationShares)
      .where(and(eq(locationShares.userId, ownerUserId), activeShareConditions(new Date())))
      .limit(1);

    if (activeShare === undefined) {
      return { allowed: false, reason: "no_share", permissionLevel: level };
    }

    // A public link carries its own capability in the URL and is authorised by
    // token, not by session. It must not become a session-wide licence for every
    // guardian of the owner, so a session viewer is refused against one.
    if (activeShare.audience === "public_link") {
      return { allowed: false, reason: "permission_denied", permissionLevel: level };
    }

    const [grant] = await db
      .select({ guardianContactId: locationShareRecipients.guardianContactId })
      .from(locationShareRecipients)
      .where(
        and(
          eq(locationShareRecipients.shareId, activeShare.id),
          eq(locationShareRecipients.guardianContactId, contact.id),
        ),
      )
      .limit(1);

    if (grant === undefined) {
      return { allowed: false, reason: "permission_denied", permissionLevel: level };
    }
  }

  if (level === "always_on") {
    return { allowed: true, reason: "granted", permissionLevel: level };
  }

  if (level === "emergency_only") {
    return sosIsLive
      ? { allowed: true, reason: "granted", permissionLevel: level }
      : { allowed: false, reason: "not_permitted_yet", permissionLevel: level };
  }

  // `scheduled`: visible while a journey is running, and during an SOS.
  const [activeJourney] = await db
    .select({ id: journeys.id })
    .from(journeys)
    .where(
      and(
        eq(journeys.userId, ownerUserId),
        inArray(journeys.status, ["active", "overdue", "planned"]),
      ),
    )
    .limit(1);

  if (sosIsLive || activeJourney !== undefined) {
    return { allowed: true, reason: "granted", permissionLevel: level };
  }

  return { allowed: false, reason: "not_permitted_yet", permissionLevel: level };
};

/**
 * Guard for stream routes: turn an access decision into an error.
 *
 * @throws AuthorizationError when the viewer is not allowed to see the owner.
 *   The message is deliberately vague about why, so a stranger cannot use it to
 *   discover whether a given account exists or has sharing switched on.
 */
export const assertViewerAccess = async (
  db: Database,
  viewerUserId: string,
  ownerUserId: string,
): Promise<void> => {
  const access = await resolveViewerAccess(db, viewerUserId, ownerUserId);
  if (!access.allowed) {
    throw new AuthorizationError("You are not able to view this location right now.");
  }
};

/* -------------------------------------------------------------------------- */
/*                             Retention sweep                                  */
/* -------------------------------------------------------------------------- */

/**
 * Hard-delete breadcrumbs whose retention deadline has passed.
 *
 * This used to be a `pg_cron` job declared in the initial migration, which
 * never ran. Two independent reasons: the schema in this project was created by
 * `drizzle-kit push`, which executes no migration-file SQL, so the job was
 * never registered at all; and had `migrate` been used, it fails on its first
 * statement because Neon only permits `CREATE EXTENSION pg_cron` in the
 * `postgres` database rather than the application database, rolling the whole
 * migration back. Even if both had worked, pg_cron only fires while a compute
 * is awake, which is not something a location-retention promise should depend
 * on.
 *
 * So the guarantee is enforced in application code, driven by the Vercel cron
 * the app already has. Each row carries its own deadline, so the sweep is
 * correct at any cadence and safe to run more than once.
 *
 * @param limit Rows deleted per call, so one busy run cannot exceed the
 *   function's time budget. A backlog drains over successive runs.
 */
export const sweepExpiredLocationPings = async (db: Database, limit = 500): Promise<number> => {
  const now = new Date();

  const stale = await db
    .select({ id: locationPings.id })
    .from(locationPings)
    .where(sql`${locationPings.retentionExpiresAt} <= ${now}`)
    .orderBy(asc(locationPings.retentionExpiresAt))
    .limit(limit);

  if (stale.length === 0) {
    return 0;
  }

  // Re-check the deadline in the DELETE rather than trusting the SELECT above.
  // Between the two statements a row could be read, and its owner could still be
  // inside the window they chose, so deleting on the id alone would delete live
  // data.
  const deleted = await db
    .delete(locationPings)
    .where(
      and(
        inArray(locationPings.id, stale.map((row) => row.id)),
        sql`${locationPings.retentionExpiresAt} <= ${now}`,
      ),
    )
    .returning({ id: locationPings.id });

  return deleted.length;
};

/* -------------------------------------------------------------------------- */
/*                             Live ping fan-out                                */
/* -------------------------------------------------------------------------- */

export type PingListener = (ping: LocationPing) => void;

export type WatcherRegistry = {
  subscribe: (userId: string, listener: PingListener) => () => void;
  publish: (userId: string, ping: LocationPing) => void;
  listenerCount: (userId: string) => number;
};

/**
 * In-process pub/sub used by the SSE route.
 *
 * Each serverless instance only knows about the connections it is holding, so
 * this fans out to whoever happens to be attached to *this* instance. That is
 * the accepted trade-off for SSE on Vercel: a guardian reconnecting after a cold
 * start immediately re-reads the latest ping from the database and catches up,
 * so no position is permanently missed.
 *
 * The returned unsubscribe function is safe to call more than once, because the
 * stream's abort handler and its normal close path both run on teardown.
 */
export const createWatcherRegistry = (): WatcherRegistry => {
  const listeners = new Map<string, Set<PingListener>>();

  const subscribe = (userId: string, listener: PingListener): (() => void) => {
    const existing = listeners.get(userId);
    if (existing === undefined) {
      listeners.set(userId, new Set([listener]));
    } else {
      existing.add(listener);
    }

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;

      const bucket = listeners.get(userId);
      if (bucket === undefined) {
        return;
      }

      bucket.delete(listener);
      if (bucket.size === 0) {
        listeners.delete(userId);
      }
    };
  };

  const publish = (userId: string, ping: LocationPing): void => {
    const bucket = listeners.get(userId);
    if (bucket === undefined) {
      return;
    }

    // Copy before iterating: a listener may unsubscribe from inside its own
    // callback, and mutating the live Set mid-iteration would skip a listener.
    for (const listener of [...bucket]) {
      try {
        listener(ping);
      } catch (cause) {
        // One broken socket must not stop the others being told.
        console.error("location watcher threw", { userId, cause });
      }
    }
  };

  const listenerCount = (userId: string): number => listeners.get(userId)?.size ?? 0;

  return { subscribe, publish, listenerCount };
};

/**
 * Process-wide registry. Module scope is intentional: Next.js can re-invoke a
 * route module, and a fresh registry per invocation would strand every existing
 * subscriber.
 */
export const watcherRegistry: WatcherRegistry = createWatcherRegistry();
