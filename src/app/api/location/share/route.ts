import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { isWatchtowerError, toErrorBody, ValidationError } from "@/lib/errors";
import { listActiveShares, startLocationShare, stopLocationShare } from "@/server/location";
import { requireUserId } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * One route for both directions, because "sharing my location" and "stop
 * sharing" are the same resource and splitting them invites a client to keep a
 * stop button that hits a different code path than the toggle.
 */
const bodySchema = z.union([
  z.object({
    action: z.literal("start"),
    audience: z.enum(["circle", "public_link"]),
    label: z.string().trim().max(80).optional(),
    durationMinutes: z.number().int().min(1).max(24 * 60).optional(),
    guardianContactIds: z.array(z.uuid()).default([]),
  }),
  z.object({ action: z.literal("stop"), stopShareId: z.uuid() }),
]);

const toWire = (share: Awaited<ReturnType<typeof listActiveShares>>[number]) => ({
  shareId: share.id,
  audience: share.audience,
  label: share.label,
  startedAt: share.startedAt.toISOString(),
  expiresAt: share.expiresAt?.toISOString() ?? null,
});

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

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError("That sharing request could not be read.", {
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    if (parsed.data.action === "stop") {
      const stopped = await stopLocationShare(db, userId, parsed.data.stopShareId);
      return NextResponse.json({ stopped: toWire(stopped) }, { status: 200 });
    }

    // Rebuilt field by field rather than spreading the parsed object, so the
    // `action` discriminant can never leak into the share row.
    const { share, shareToken } = await startLocationShare(db, userId, {
      audience: parsed.data.audience,
      guardianContactIds: parsed.data.guardianContactIds,
      ...(parsed.data.label === undefined ? {} : { label: parsed.data.label }),
      ...(parsed.data.durationMinutes === undefined
        ? {}
        : { durationMinutes: parsed.data.durationMinutes }),
    });

    return NextResponse.json(
      {
        share: toWire(share),
        // Null for circle shares, which are authorised by session rather than
        // by a bearer token.
        shareToken,
        shareUrl: shareToken === null ? null : `/track/${shareToken}`,
      },
      { status: 201 },
    );
  } catch (error) {
    if (isWatchtowerError(error)) {
      return NextResponse.json(toErrorBody(error), { status: error.status });
    }
    console.error("location share route failed", { cause: error });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Watchtower could not change who can see you." } },
      { status: 500 },
    );
  }
};

/** Every share the caller currently has running, so the UI can render toggles. */
export const GET = async (): Promise<NextResponse> => {
  try {
    const userId = await requireUserId();
    const shares = await listActiveShares(db, userId);

    return NextResponse.json({ shares: shares.map(toWire) }, { status: 200 });
  } catch (error) {
    if (isWatchtowerError(error)) {
      return NextResponse.json(toErrorBody(error), { status: error.status });
    }
    console.error("location share list failed", { cause: error });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Watchtower could not load your shares." } },
      { status: 500 },
    );
  }
};
