import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { db } from "@/db";
import { env } from "@/lib/env";
import { runSafetySweep } from "@/server/maintenance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The scheme Vercel puts in front of `CRON_SECRET` on every scheduled call.
 *
 * Regex rather than `startsWith` on purpose. The scheme is case-insensitive per
 * RFC 7235, and Vercel sends a capitalised `Bearer `. An earlier version of this
 * check used `presented.startsWith("bearer ")`, which is case-sensitive, so the
 * prefix never matched, the full `Bearer <secret>` string was compared against
 * the bare secret, the lengths differed, and every scheduled invocation answered
 * 403. A silent 403 looks exactly like a healthy cron, so this was invisible
 * until someone read the logs.
 */
const BEARER_PREFIX = /^bearer\s+/i;

/**
 * Backstop sweep for alerts whose owning request never finished dispatching.
 *
 * The request path in `POST /api/sos` holds open through the cancel window and
 * then notifies, which is the primary guarantee. This exists for the cases that
 * path cannot cover: the function was reclaimed mid-request, the device lost
 * signal between creating the alert and the dispatch, or the push/SMS provider
 * was down at that instant and the row is still sitting in `triggered`.
 *
 * It is safe to run as often as the platform allows. `dispatchSosAlert` claims
 * each row with a single conditional UPDATE, so concurrent or repeated sweeps
 * cannot double-notify anybody.
 *
 * The same job runs the overdue-journey escalation and the retention sweeps.
 * One schedule on one plan is easier to reason about than several, and it keeps
 * the data-minimisation guarantee from depending on a second job being added
 * and configured correctly later.
 */

/**
 * Compares the presented secret against `CRON_SECRET` without leaking its
 * length or contents through timing.
 *
 * Vercel sends the cron secret as `Authorization: Bearer <CRON_SECRET>`, so the
 * scheme prefix is stripped before comparison. Comparing the raw header instead
 * made every scheduled invocation fail: the presented value always carried the
 * `Bearer ` prefix the secret itself does not, so the length check rejected it
 * and the sweep answered 403 on every run. A raw token with no scheme is also
 * accepted, so `curl` against a staging database works without ceremony.
 */
const isAuthorised = (presented: string | null): boolean => {
  const expected = env.CRON_SECRET ?? "";
  if (expected === "") {
    // Refusing to run unauthenticated is the safe default. A deployed instance
    // that forgets to set the secret should fail loudly rather than expose a
    // route that pages people's families on demand.
    console.error("CRON_SECRET is not set; refusing to run the SOS sweep.");
    return false;
  }

  if (presented === null) {
    return false;
  }

  const token = presented.replace(BEARER_PREFIX, "").trim();

  const a = Buffer.from(token);
  const b = Buffer.from(expected);

  // timingSafeEqual throws on a length mismatch, so compare lengths first. That
  // leaks only the length of a secret the caller already had to guess right.
  return a.length === b.length && timingSafeEqual(a, b);
};

export const GET = async (request: Request): Promise<NextResponse> => {
  const presented = request.headers.get("authorization");

  if (!isAuthorised(presented)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Not authorised." } },
      { status: 403 },
    );
  }

  try {
    const result = await runSafetySweep(db);

    // Logged rather than returned in detail: the response is reachable by
    // anyone holding the secret, and alert counts are not something a shared
    // endpoint needs to publish.
    console.info("safety sweep complete", result);

    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (cause) {
    console.error("safety sweep failed", { cause });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "The sweep did not complete." } },
      { status: 500 },
    );
  }
};
