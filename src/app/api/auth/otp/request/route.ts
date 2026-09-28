import { NextResponse } from "next/server";
import { z } from "zod";

import { isWatchtowerError, RateLimitError } from "@/lib/errors";
import { normalizeGhanaPhone } from "@/lib/phone";
import { deliverLoginCode } from "@/server/auth-actions";

/**
 * Why this route exists alongside the `requestPhoneCodeAction` server action: a
 * background script, a native shell, or a client that lost its page mid-request
 * needs a plain HTTP endpoint for a login code. Server actions are not a
 * general-purpose API surface.
 */
const bodySchema = z.object({
  phone: z.string().trim().min(1, "Enter your phone number."),
});

/** The only response a caller ever gets, on purpose. */
const accepted = (): NextResponse => NextResponse.json({ sent: true });

export const POST = async (request: Request): Promise<NextResponse> => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch (cause) {
    console.error("otp request body was not json", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return NextResponse.json({ error: "Send a JSON body of { phone }." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Enter your phone number." },
      { status: 400 },
    );
  }

  let phone: string;
  try {
    phone = normalizeGhanaPhone(parsed.data.phone, "phone");
  } catch (cause) {
    // A malformed number is a client bug, not an account question, so it is the
    // one case allowed to answer differently.
    return NextResponse.json(
      { error: isWatchtowerError(cause) ? cause.message : "Enter a valid Ghanaian phone number." },
      { status: 400 },
    );
  }

  try {
    await deliverLoginCode(phone);
  } catch (cause) {
    // Rate limiting, provider outages and unknown accounts all land here. The
    // caller is told the same thing in every case: the message went out, or as
    // far as they can tell it did. Saying "we could not find that number" would
    // hand anyone a way to test whether a phone is registered with Watchtower.
    if (!(cause instanceof RateLimitError)) {
      console.error("otp request failed", {
        phone,
        ...(isWatchtowerError(cause) ? cause.toLogFields() : { cause: String(cause) }),
      });
    }
  }

  return accepted();
};
