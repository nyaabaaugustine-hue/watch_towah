import { db } from "@/db";
import { isWatchtowerError, toErrorBody } from "@/lib/errors";
import { getLatestPing, resolveViewerAccess, watcherRegistry } from "@/server/location";
import { requireUserId } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * Heartbeat interval. Under a minute so idle connections are not reaped by
 * intermediaries, and because it doubles as the signal that lets the client
 * notice a silently dead socket and reconnect.
 */
const HEARTBEAT_MS = 25_000;

/**
 * Database poll interval used as a backstop.
 *
 * The in-process registry only reaches viewers attached to the same serverless
 * instance, so a guardian on a cold instance would otherwise never see a move.
 * Polling closes that gap. It is deliberately slow: this is a safety feed, not a
 * live-navigation product, and the registry handles the common case instantly.
 */
const POLL_MS = 15_000;

const toWire = (ping: NonNullable<Awaited<ReturnType<typeof getLatestPing>>>) => ({
  id: ping.id,
  lat: ping.lat,
  lng: ping.lng,
  accuracy: ping.accuracy,
  batteryLevel: ping.batteryLevel,
  source: ping.source,
  recordedAt: ping.recordedAt.toISOString(),
});

/**
 * Server-Sent Events stream of a watched person's position.
 *
 * Selected over WebSockets because the feed is one-directional, and because
 * SSE survives the serverless request model without holding a stateful socket
 * open. The client reconnects on its own, so a dropped connection is not a
 * lost guardian.
 *
 * Access is decided once at connect time. Permissions can change mid-stream, so
 * the stream re-checks on every poll and closes itself the moment access is
 * revoked rather than continuing to emit positions.
 */
export const GET = async (request: Request): Promise<Response> => {
  try {
    const viewerId = await requireUserId();

    const ownerId = new URL(request.url).searchParams.get("ownerId");
    if (ownerId === null || ownerId.length === 0) {
      return Response.json(
        { error: { code: "VALIDATION_ERROR", message: "Whose location are you watching?" } },
        { status: 400 },
      );
    }

    const initialAccess = await resolveViewerAccess(db, viewerId, ownerId);
    if (!initialAccess.allowed) {
      return Response.json(
        { error: { code: "FORBIDDEN", message: "You are not able to view this location right now." } },
        { status: 403 },
      );
    }

    const encoder = new TextEncoder();
    let closed = false;
    let lastPingId: string | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, data: unknown): void => {
          if (closed) {
            return;
          }
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        const stop = (): void => {
          if (closed) {
            return;
          }
          closed = true;
          unsubscribe();
          clearInterval(heartbeat);
          clearInterval(poll);
          controller.close();
        };

        const emitLatest = async (): Promise<void> => {
          try {
            const ping = await getLatestPing(db, ownerId);
            if (ping === null || ping.id === lastPingId) {
              return;
            }
            lastPingId = ping.id;
            send("ping", toWire(ping));
          } catch (cause) {
            console.error("location stream poll failed", { ownerId, cause });
          }
        };

        // Instantiate the no-op unsubscribe first so `stop` can be wired to
        // `request.signal` before the real handle exists.
        let unsubscribe = (): void => {};

        unsubscribe = watcherRegistry.subscribe(ownerId, (ping) => {
          if (ping.id === lastPingId) {
            return;
          }
          lastPingId = ping.id;
          send("ping", toWire(ping));
        });

        const heartbeat = setInterval(() => send("heartbeat", { at: Date.now() }), HEARTBEAT_MS);
        const poll = setInterval(() => {
          void (async () => {
            // Re-check on every tick: a guardian removed from the circle, or a
            // share that was stopped, must take effect without a reconnect.
            const access = await resolveViewerAccess(db, viewerId, ownerId);
            if (!access.allowed) {
              send("end", { reason: "revoked" });
              stop();
              return;
            }
            await emitLatest();
          })();
        }, POLL_MS);

        request.signal.addEventListener("abort", stop, { once: true });

        // Open with a `retry` so EventSource reconnects on the platform default
        // rather than the browser's 3s, then send the current position at once
        // so the map is never blank on arrival.
        controller.enqueue(encoder.encode("retry: 5000\n\n"));
        void emitLatest();
      },

      cancel() {
        closed = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Nginx and some proxies buffer event streams unless told not to.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (isWatchtowerError(error)) {
      return Response.json(toErrorBody(error), { status: error.status });
    }
    console.error("location stream route failed", { cause: error });
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "Watchtower could not open that stream." } },
      { status: 500 },
    );
  }
};
