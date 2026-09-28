import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { isWatchtowerError, toErrorBody, ValidationError } from "@/lib/errors";
import {
  MAX_PING_BACKDATE_MS,
  MAX_PING_CLOCK_SKEW_MS,
  recordLocationPing,
  watcherRegistry,
} from "@/server/location";
import { requireUserId } from "@/server/session";

// Every call writes a row, so this must never be served from a build snapshot.
export const dynamic = "force-dynamic";

/**
 * Client capture time.
 *
 * Not `z.coerce.date()`, which accepts anything and turns `null` and `0` into
 * the epoch. A ping stamped 1970 is invisible to the age-based queue index and
 * gets a retention deadline that is already in the past, so it is a row that
 * can never be collected. Rejecting non-timestamps up front and bounding the
 * value keeps the offline queue, the trail ordering, and the retention deadline
 * all agreeing about when the reading happened.
 */
const recordedAtSchema = z
  .union([z.iso.datetime(), z.date(), z.number()])
  .transform((value) => (value instanceof Date ? value : new Date(value)))
  .refine(
    (value) => Number.isFinite(value.getTime()),
    "That timestamp could not be read.",
  )
  .refine(
    (value) => value.getTime() <= Date.now() + MAX_PING_CLOCK_SKEW_MS,
    "That reading is stamped in the future.",
  )
  .refine(
    (value) => value.getTime() >= Date.now() - MAX_PING_BACKDATE_MS,
    "That reading is too old to be a real location.",
  );

const pingBodySchema = z.object({
  lat: z.number().min(-90, "Latitude is out of range.").max(90, "Latitude is out of range."),
  lng: z.number().min(-180, "Longitude is out of range.").max(180, "Longitude is out of range."),
  accuracy: z.number().min(0).max(100_000).nullable().optional(),
  altitude: z.number().min(-500).max(9_000).nullable().optional(),
  speed: z.number().min(0).max(400).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  batteryLevel: z.number().int().min(0).max(100).nullable().optional(),
  // Only these capture paths are accepted. Free text here would let a client
  // label a ping `sos` and have retention treat it as incident evidence.
  source: z.enum(["background", "manual", "journey", "sos", "shared"]).default("background"),
  recordedAt: recordedAtSchema.optional(),
  // Idempotency key for a retry of the same reading. Validated as a real UUID
  // rather than any string, because it reaches a unique index: an arbitrary
  // string would still be safe but would let a client pin a row it owns.
  clientId: z.uuid("That reading id was not a valid identifier.").optional(),
});

/**
 * Record one location breadcrumb for the signed-in user.
 *
 * Returns the retention deadline rather than the row: a phone on 2G needs the
 * smallest possible acknowledgement, and the caller needs to know when its own
 * cached copy is safe to drop.
 */
export const POST = async (request: Request): Promise<NextResponse> => {
  try {
    const userId = await requireUserId();

    let raw: unknown;
    try {
      raw = await request.json();
    } catch (cause) {
      throw new ValidationError("That request body was not valid JSON.", {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }

    const parsed = pingBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError("That location could not be read. Try again.", {
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { lat, lng, recordedAt, ...rest } = parsed.data;
    const ping = await recordLocationPing(db, userId, {
      ...rest,
      lat,
      lng,
      ...(recordedAt === undefined ? {} : { recordedAt }),
    });

    // Push to any guardian watching on this instance. The SSE route also polls
    // as a backstop, so a viewer on a different instance still catches up.
    watcherRegistry.publish(userId, ping);

    return NextResponse.json(
      {
        ok: true,
        pingId: ping.id,
        retentionExpiresAt: ping.retentionExpiresAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    if (isWatchtowerError(error)) {
      return NextResponse.json(toErrorBody(error), { status: error.status });
    }
    console.error("location record route failed", { cause: error });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Watchtower could not save that location." } },
      { status: 500 },
    );
  }
};
