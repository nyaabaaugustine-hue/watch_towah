import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { db } from "@/db";
import { AuthenticationError, isWatchtowerError, toErrorBody, ValidationError } from "@/lib/errors";
import { resolveSosAlert } from "@/server/sos";

export const dynamic = "force-dynamic";

const resolveBodySchema = z.object({
  alertId: z.uuid("That alert reference is not valid."),
});

export const POST = async (request: Request): Promise<NextResponse> => {
  try {
    const session = await auth();
    const userId = session?.user.id;
    if (userId === undefined) {
      throw new AuthenticationError("Sign in to resolve an alert.");
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch (cause) {
      throw new ValidationError("That request body was not valid JSON.", {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }

    const parsed = resolveBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError("That alert could not be read. Try again.", {
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const alert = await resolveSosAlert(db, userId, parsed.data.alertId);

    return NextResponse.json({ alertId: alert.id, status: alert.status }, { status: 200 });
  } catch (error) {
    if (isWatchtowerError(error)) {
      return NextResponse.json(toErrorBody(error), { status: error.status });
    }
    console.error("sos resolve route failed", { cause: error });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Watchtower could not resolve that alert. Try again." } },
      { status: 500 },
    );
  }
};
