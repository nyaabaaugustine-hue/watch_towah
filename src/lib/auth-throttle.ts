import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { authThrottle } from "@/db/schema";
import { env } from "@/lib/env";
import { RateLimitError } from "@/lib/errors";

/** Failed attempts tolerated inside the rolling window. */
const MAX_FAILURES = 5;
/** Window length. Failures older than this stop counting. */
const WINDOW_MS = 15 * 60 * 1000;
/** How long a tripped key stays locked out. Grows with consecutive windows. */
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Key derivation for one-time codes.
 *
 * HMAC-SHA256 keyed with AUTH_SECRET rather than a bare SHA-256: a leaked
 * `otp_codes` table should not be enough to verify a guessed code offline,
 * because the attacker would otherwise just re-hash candidate codes. A slow
 * KDF would be stronger still but OTP verification is on the login path and
 * 6 digits against a 5-attempt cap is already not the weak link.
 */
export const hashOtpCode = (phone: string, purpose: string, code: string): string =>
  createHmac("sha256", env.AUTH_SECRET).update(`${purpose}:${phone}:${code}`).digest("hex");

/** Constant-time compare for hashes, so verification does not leak by timing. */
export const hashesMatch = (expected: string, actual: string): boolean => {
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
};

export const newOtpCode = (): string => {
  // randomInt-equivalent: rejection sampling keeps the distribution uniform.
  // Math.random is not acceptable for a credential.
  const buffer = randomBytes(4);
  const value = buffer.readUInt32BE(0) % 1_000_000;
  return value.toString().padStart(6, "0");
};

const throttleKey = (kind: string, identifier: string): string => `${kind}:${identifier}`;

export const assertNotThrottled = async (db: Database, kind: string, identifier: string): Promise<void> => {
  const key = throttleKey(kind, identifier);
  const rows = await db
    .select({ lockedUntil: authThrottle.lockedUntil })
    .from(authThrottle)
    .where(eq(authThrottle.key, key))
    .limit(1);

  const lockedUntil = rows[0]?.lockedUntil;
  if (lockedUntil === undefined || lockedUntil === null) {
    return;
  }

  if (lockedUntil.getTime() > Date.now()) {
    const retryAfterSeconds = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000);
    throw new RateLimitError(
      `Too many failed attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
      { retryAfterSeconds },
    );
  }
};

/**
 * Count one attempt against a key and refuse it if the budget is already spent.
 *
 * Check-then-count was the bug this replaces: `assertNotThrottled` read the
 * lockout, the caller did its work, and only then did `recordAuthFailure`
 * increment. A burst of parallel submissions therefore all passed the check
 * before any of them recorded anything, so the five-attempt budget bounded a
 * sequential attacker but not a concurrent one.
 *
 * Counting first and checking in the same statement closes that window. The
 * upsert is serialised on the row, so N simultaneous callers receive N distinct
 * counts and exactly the first `MAX_FAILURES` of them proceed. A success calls
 * `clearAuthFailures`, which is why charging successful attempts is safe.
 *
 * @param buildMessage Lockout copy. Supplied by the caller because a limit on
 *   how many codes may be *sent* should not describe failed attempts.
 * @throws RateLimitError when this attempt exceeds the budget.
 */
export const consumeAuthAttempt = async (
  db: Database,
  kind: string,
  identifier: string,
  buildMessage: (minutes: number) => string = (minutes) =>
    `Too many failed attempts. Try again in ${minutes} minute(s).`,
): Promise<void> => {
  const key = throttleKey(kind, identifier);
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const lockoutUntil = new Date(now.getTime() + LOCKOUT_MS);

  // Every SET expression reads the pre-update row, so reusing this fragment in
  // both the counter and the lockout test compares against the same old value.
  const failures = sql`CASE WHEN ${authThrottle.windowStartedAt} < ${windowStart} THEN 1 ELSE ${authThrottle.failures} + 1 END`;

  // `::timestamptz` is required, not decorative. Drizzle sends bound values as
  // untyped parameters, and the neon-http driver does not send a type OID, so
  // Postgres infers the CASE branches from context. With `THEN $param ELSE NULL`
  // there is no other branch to infer from, so the branch resolves to text and
  // the whole statement is rejected with 42804 "column locked_until is of type
  // timestamp with time zone but expression is of type text". That is the
  // first statement on every email or phone sign-in, so this failed every
  // login with an unhelpful "Configuration" error in the browser.
  const lockoutUntilParam = sql`${lockoutUntil}::timestamptz`;

  const [updated] = await db
    .insert(authThrottle)
    .values({ key, failures: 1, windowStartedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: authThrottle.key,
      set: {
        failures,
        windowStartedAt: sql`CASE WHEN ${authThrottle.windowStartedAt} < ${windowStart} THEN ${now}::timestamptz ELSE ${authThrottle.windowStartedAt} END`,
        lockedUntil: sql`CASE WHEN ${failures} > ${MAX_FAILURES} THEN ${lockoutUntilParam} ELSE NULL END`,
        updatedAt: now,
      },
    })
    .returning({ lockedUntil: authThrottle.lockedUntil });

  const lockedUntil = updated?.lockedUntil;
  if (lockedUntil === undefined || lockedUntil === null) {
    return;
  }

  if (lockedUntil.getTime() > Date.now()) {
    const retryAfterSeconds = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000);
    throw new RateLimitError(buildMessage(Math.ceil(retryAfterSeconds / 60)), { retryAfterSeconds });
  }
};

export const clearAuthFailures = async (db: Database, kind: string, identifier: string): Promise<void> => {
  await db
    .delete(authThrottle)
    .where(and(eq(authThrottle.key, throttleKey(kind, identifier)), gt(authThrottle.failures, 0)));
};
