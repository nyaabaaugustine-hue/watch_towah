"use client";

import { useEffect, useRef, useState } from "react";

import { MapView, type MapMarker } from "@/components/map/map-view";
import { cn } from "@/lib/cn";
import { formatDistance } from "@/lib/geo";

export type StreamPing = {
  id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  batteryLevel: number | null;
  source: string;
  recordedAt: string;
};

type LiveMapProps = {
  /** Whose position to watch. */
  ownerId: string;
  accessToken: string;
  /** Shown as the map caption, e.g. "Ama Serwaa". */
  ownerName: string;
  lowDataMode?: boolean;
};

/** A fix older than this is shown as stale rather than as a live position. */
const STALE_AFTER_MS = 3 * 60_000;

type ConnectionState = "connecting" | "live" | "revoked" | "unavailable";

export const LiveMap = ({ ownerId, accessToken, ownerName, lowDataMode }: LiveMapProps) => {
  const [pings, setPings] = useState<StreamPing[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [now, setNow] = useState(() => Date.now());
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // EventSource reconnects on its own using the server's `retry` hint, so this
    // effect only needs to build the connection and translate its events.
    const source = new EventSource(`/api/stream/location?ownerId=${encodeURIComponent(ownerId)}`);
    sourceRef.current = source;

    const onPing = (event: MessageEvent<string>): void => {
      try {
        const ping = JSON.parse(event.data) as StreamPing;
        setPings((current) => {
          // Cap the trail. The server sends one position per ping, and an
          // all-day session would otherwise grow the array without bound.
          const next = [ping, ...current.filter((existing) => existing.id !== ping.id)];
          return next.slice(0, 50);
        });
        setConnection("live");
      } catch (cause) {
        console.error("could not parse location stream event", { cause });
      }
    };

    const onEnd = (event: MessageEvent<string>): void => {
      let reason = "ended";
      try {
        reason = (JSON.parse(event.data) as { reason?: string }).reason ?? "ended";
      } catch {
        // A malformed end frame still means the stream is over.
      }
      setConnection(reason === "revoked" ? "revoked" : "unavailable");
      source.close();
    };

    source.addEventListener("ping", onPing as EventListener);
    source.addEventListener("end", onEnd as EventListener);
    source.onopen = () => setConnection("live");
    source.onerror = () => {
      // EventSource fires `error` on every dropped connection and then retries.
      // Only a 403 is terminal, and the server signals that by closing without
      // a retry, so the browser stops reconnecting on its own.
      if (source.readyState === EventSource.CLOSED) {
        setConnection((current) => (current === "revoked" ? current : "connecting"));
      }
    };

    return () => {
      source.removeEventListener("ping", onPing as EventListener);
      source.removeEventListener("end", onEnd as EventListener);
      source.close();
      sourceRef.current = null;
    };
  }, [ownerId]);

  // Drives the "updated N ago" label without re-rendering the map.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const newest = pings[0];
  const isStale = newest === undefined || now - new Date(newest.recordedAt).getTime() > STALE_AFTER_MS;

  const markers: MapMarker[] = newest === undefined ? [] : [{ lat: newest.lat, lng: newest.lng, kind: "self" }];

  // Oldest first, because the trail is drawn as a line and reversing it would
  // connect the points backwards through walls.
  const trail: MapMarker[] = [...pings]
    .reverse()
    .map((ping) => ({ lat: ping.lat, lng: ping.lng }));

  return (
    <div className="space-y-3">
      <MapView
        accessToken={accessToken}
        markers={markers}
        trail={trail}
        lowDataMode={lowDataMode}
        emptyMessage={`Waiting for ${ownerName}'s location.`}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span
          className={cn(
            "inline-flex items-center gap-2",
            connection === "live" && !isStale ? "text-safe" : "text-ink/60",
          )}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              connection === "live" && !isStale ? "bg-safe" : "bg-ink/25",
            )}
            aria-hidden
          />
          {connection === "revoked"
            ? "Sharing stopped"
            : isStale
              ? "Last known location"
              : "Live"}
        </span>

        {newest !== undefined && (
          <span className="text-ink/60">
            {newest.accuracy !== null
              ? `±${formatDistance(newest.accuracy)} · `
              : ""}
            {new Date(newest.recordedAt).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      {isStale && newest !== undefined && (
        <p className="text-sm text-ink/60">
          This is where {ownerName} was last seen, not where they are now.
        </p>
      )}
    </div>
  );
};
