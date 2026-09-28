import { NextResponse } from "next/server";

import { db } from "@/db";
import { isWatchtowerError, toErrorBody } from "@/lib/errors";
import { getLatestPing } from "@/server/location";
import { requireUserId } from "@/server/session";

export const dynamic = "force-dynamic";

const toWire = (ping: Awaited<ReturnType<typeof getLatestPing>>) => {
  if (ping === null) {
    return null;
  }

  return {
    id: ping.id,
    lat: ping.lat,
    lng: ping.lng,
    accuracy: ping.accuracy,
    batteryLevel: ping.batteryLevel,
    source: ping.source,
    recordedAt: ping.recordedAt.toISOString(),
  };
};

/**
 * The signed-in user's own most recent position.
 *
 * Only ever returns the caller's own location. Other people's positions go
 * through the SSE stream, which re-checks Guardian Circle permissions on every
 * connection.
 */
export const GET = async (): Promise<NextResponse> => {
  try {
    const userId = await requireUserId();
    const ping = await getLatestPing(db, userId);

    return NextResponse.json({ ping: toWire(ping) }, { status: 200 });
  } catch (error) {
    if (isWatchtowerError(error)) {
      return NextResponse.json(toErrorBody(error), { status: error.status });
    }
    console.error("location latest route failed", { cause: error });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Watchtower could not load your location." } },
      { status: 500 },
    );
  }
};
