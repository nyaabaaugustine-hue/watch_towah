import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { db } from "@/db";
import { AuthenticationError, isWatchtowerError, toErrorBody, ValidationError } from "@/lib/errors";
import { subscribeToPush } from "@/server/push";

export const dynamic = "force-dynamic";

const subscribeBodySchema = z.object({
  endpoint: z.url("That push endpoint is not a valid URL.").max(2048),
  keys: z.object({
    p256dh: z.string().min(1, "Missing the push public key.").max(256),
    auth: z.string().min(1, "Missing the push auth secret.").max(128),
  }),
});

/**
 * A device registers its push subscription here, after `pushManager.subscribe()`
 * in the service worker. Keyed on the endpoint, so re-subscribing from the same
 * browser updates the existing row instead of piling up duplicates that would
 * each cost a round trip on every future alert.
 */
export const POST = async (request: Request): Promise<NextResponse> => {
  try {
    const session = await auth();
    const userId = session?.user.id;
    if (userId === undefined) {
      throw new AuthenticationError("Sign in to receive alerts on this device.");
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch (cause) {
      throw new ValidationError("That request body was not valid JSON.", {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }

    const parsed = subscribeBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError("This device could not be registered for alerts.", {
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    await subscribeToPush(db, userId, parsed.data, request.headers.get("user-agent"));

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (isWatchtowerError(error)) {
      return NextResponse.json(toErrorBody(error), { status: error.status });
    }
    console.error("push subscribe route failed", { cause: error });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "This device could not be registered for alerts." } },
      { status: 500 },
    );
  }
};
