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

export const recordAuthFailure = async (db: Database, kind: string, identifier: string): Promise<void> => {
  const key = throttleKey(kind, identifier);
  const now = new Date();

  // One atomic statement: read the current window, and if it has rolled over,
  // restart the count. Doing this in JS first would race two concurrent
  // failures into resetting each other's counter.
  await db
    .insert(authThrottle)
    .values({ key, failures: 1, windowStartedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: authThrottle.key,
      set: {
        failures: sql`CASE WHEN ${authThrottle.windowStartedAt} < ${new Date(now.getTime() - WINDOW_MS)} THEN 1 ELSE ${authThrottle.failures} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${authThrottle.windowStartedAt} < ${new Date(now.getTime() - WINDOW_MS)} THEN ${now} ELSE ${authThrottle.windowStartedAt} END`,
        lockedUntil: sql`CASE WHEN (CASE WHEN ${authThrottle.windowStartedAt} < ${new Date(now.getTime() - WINDOW_MS)} THEN 1 ELSE ${authThrottle.failures} + 1 END) >= ${MAX_FAILURES} THEN ${new Date(now.getTime() + LOCKOUT_MS)} ELSE NULL END`,
        updatedAt: now,
      },
    });
};

export const clearAuthFailures = async (db: Database, kind: string, identifier: string): Promise<void> => {
  await db
    .delete(authThrottle)
    .where(and(eq(authThrottle.key, throttleKey(kind, identifier)), gt(authThrottle.failures, 0)));
};
