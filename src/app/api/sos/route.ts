import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/auth";
import { db } from "@/db";
import { sosAlerts } from "@/db/schema";
import { AuthenticationError, isWatchtowerError, toErrorBody, ValidationError } from "@/lib/errors";
import {
  countNotifiedGuardians,
  createSosAlert,
  dispatchSosAlert,
  ESCALATION_KINDS,
  getActiveSosAlert,
  SOS_TRIGGERS,
} from "@/server/sos";

// Location pings and the live-alert read both hit the database on every call,
// so this route must never be served from a build-time snapshot.
export const dynamic = "force-dynamic";

/**
 * The request deliberately stays open for the five-second cancel window before
 * responding, so the function needs a ceiling above that. Vercel's Hobby default
 * is 10s, which fits; this only matters if the grace period is ever raised.
 */
export const maxDuration = 10;

const createBodySchema = z
  .object({
    // Nullable on purpose. A person in danger may have location permission
    // denied, no fix yet, or a phone too slow to lock one. Refusing the alert
    // would mean the app silently fails at the exact moment it matters most, so
    // the circle is notified without a coordinate and the SMS omits the map link.
    lat: z.number().min(-90, "Latitude is out of range.").max(90, "Latitude is out of range.").nullable().optional(),
    lng: z.number().min(-180, "Longitude is out of range.").max(180, "Longitude is out of range.").nullable().optional(),
    accuracy: z.number().min(0).max(100_000).nullable().optional(),
    batteryLevel: z.number().int().min(0).max(100).nullable().optional(),
    trigger: z.enum(SOS_TRIGGERS, { message: "Unknown SOS trigger." }),
    note: z.string().trim().max(500).optional(),
    escalatedFrom: z
      .object({
        kind: z.enum(ESCALATION_KINDS),
        id: z.uuid(),
      })
      .optional(),
  })
  // A half-known position is worse than none: it cannot be plotted and would
  // read as a real fix on the tracking map. Accept both coordinates or neither.
  .refine((value) => (value.lat == null) === (value.lng == null), {
    message: "Send both latitude and longitude, or neither.",
    path: ["lat"],
  });

const currentUserId = async (): Promise<string> => {
  const session = await auth();
  const userId = session?.user.id;
  if (userId === undefined) {
    throw new AuthenticationError("Sign in to send an SOS alert.");
  }
  return userId;
};

/** Sleeps the remainder of the cancel window. */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Block until the press-and-hold grace window has closed.
 *
 * A null or already-past deadline returns immediately, so an alert raised by an
 * escalation rather than a button press does not sit here for five seconds.
 */
const waitOutGracePeriod = async (cancellableUntil: Date | null): Promise<void> => {
  if (cancellableUntil === null) {
    return;
  }

  const remaining = cancellableUntil.getTime() - Date.now();
  if (remaining > 0) {
    await sleep(remaining);
  }
};

export const POST = async (request: Request): Promise<NextResponse> => {
  try {
    const userId = await currentUserId();

    let raw: unknown;
    try {
      raw = await request.json();
    } catch (cause) {
      throw new ValidationError("That request body was not valid JSON.", {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }

    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError("That alert could not be read. Try again.", {
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { lat, lng, ...rest } = parsed.data;

    const alert = await createSosAlert(db, userId, {
      ...rest,
      lat: lat ?? null,
      lng: lng ?? null,
    });

    // Hold this request open through the cancel window, then notify.
    //
    // The alternative — returning now and dispatching from a background timer or
    // waiting for a cron sweep — is what made this button silently do nothing.
    // A serverless invocation can be frozen or reclaimed the moment it responds,
    // so a pending timer is not a promise that anyone will ever be told. Staying
    // alive inside the request is the one guarantee available here.
    //
    // Sleeping is safe with respect to cancellation: if the user cancels during
    // the wait, the row stops being `triggered` and the conditional claim in
    // `dispatchSosAlert` finds nothing to claim, so nobody is paged for a misfire.
    await waitOutGracePeriod(alert.cancellableUntil);

    let notified = 0;
    try {
      const outcome = await dispatchSosAlert(db, alert.id);
      notified = outcome.notified;
    } catch (cause) {
      // The alert is durable and still `triggered`, so the cron sweep will pick
      // it up. The owner is told it was raised rather than being shown a failure
      // that would only invite a second press.
      console.error("sos dispatch failed, leaving the alert for the sweep", {
        alertId: alert.id,
        cause,
      });
    }

    // Re-read rather than trusting the row from before the wait: it may have been
    // cancelled, and reporting "sent" for a cancelled alert would be a lie the
    // owner's own screen repeats back to them.
    const [current] = await db
      .select({ status: sosAlerts.status })
      .from(sosAlerts)
      .where(eq(sosAlerts.id, alert.id))
      .limit(1);

    return NextResponse.json(
      {
        alertId: alert.id,
        status: current?.status ?? alert.status,
        cancellableUntil: alert.cancellableUntil?.toISOString() ?? null,
        notified,
        trackingUrl: `${new URL(request.url).origin}/track/${alert.shareToken}`,
      },
      { status: 200 },
    );
  } catch (error) {
    if (isWatchtowerError(error)) {
      return NextResponse.json(toErrorBody(error), { status: error.status });
    }
    console.error("sos create route failed", { cause: error });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Watchtower could not raise that alert. Try again." } },
      { status: 500 },
    );
  }
};

export const GET = async (request: Request): Promise<NextResponse> => {
  try {
    const userId = await currentUserId();
    const alert = await getActiveSosAlert(db, userId);

    if (alert === null) {
      return NextResponse.json({ active: null }, { status: 200 });
    }

    return NextResponse.json(
      {
        active: {
          alertId: alert.id,
          status: alert.status,
          triggeredAt: alert.triggeredAt.toISOString(),
          lat: alert.lat,
          lng: alert.lng,
          accuracy: alert.accuracy,
          cancellableUntil: alert.cancellableUntil?.toISOString() ?? null,
          notified: await countNotifiedGuardians(db, alert.id),
          trackingUrl: `${new URL(request.url).origin}/track/${alert.shareToken}`,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (isWatchtowerError(error)) {
      return NextResponse.json(toErrorBody(error), { status: error.status });
    }
    console.error("sos read route failed", { cause: error });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Watchtower could not load your alert. Try again." } },
      { status: 500 },
    );
  }
};
