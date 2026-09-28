"use client";

import "mapbox-gl/dist/mapbox-gl.css";

import { Phone, Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap, Marker as MapboxMarker } from "mapbox-gl";

import { Button } from "@/components/ui/button";

/**
 * How often the page re-runs its server component to pick up a newer fix.
 * Gated on document visibility: a guardian who switches to the dialler to call
 * this person must not have a backgrounded tab polling a metered connection.
 */
const LIVE_REFRESH_MS = 30_000;

const zoomForAccuracy = (accuracyMeters: number | null): number => {
  if (accuracyMeters === null) {
    return 15;
  }
  if (accuracyMeters <= 50) {
    return 16;
  }
  if (accuracyMeters <= 200) {
    return 15;
  }
  return 14;
};

type TrackingViewProps = {
  /**
   * Mapbox's public token, read from `env.MAPBOX_ACCESS_TOKEN` by the server
   * page and handed down. It is a `pk.` token designed to be public, but `env`
   * validates the entire process environment on every access — which cannot
   * succeed inside a browser bundle — so the server has to pass it explicitly.
   */
  accessToken: string;
  lat: number;
  lng: number;
  accuracy: number | null;
};

type MapStatus = "loading" | "ready" | "failed";

/**
 * The last known position, and nothing else.
 *
 * A guardian opening this page is scared and on mobile data, so this component
 * does one job: show where the person was, and say plainly when the map could
 * not load rather than leaving a grey box where their relative should be.
 */
export const TrackingView = ({ accessToken, lat, lng, accuracy }: TrackingViewProps) => {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerRef = useRef<MapboxMarker | null>(null);
  const [status, setStatus] = useState<MapStatus>("loading");

  // Keep the live position moving without rebuilding the map, which would
  // re-download the style and flash the page on every fix.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (map === null || marker === null) {
      return;
    }
    map.jumpTo({ center: [lng, lat], zoom: zoomForAccuracy(accuracy) });
    marker.setLngLat([lng, lat]);
  }, [lat, lng, accuracy]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || accessToken === "") {
      setStatus("failed");
      return;
    }

    let disposed = false;
    const initial = { lat, lng, accuracy };

    const mount = async (): Promise<void> => {
      try {
        // mapbox-gl is roughly 200KB. The person who needs this page most is
        // reading it on mobile data, so the words above the map have to render
        // first and the library has to stay out of the initial bundle entirely.
        const mapboxgl = await import("mapbox-gl");
        if (disposed) {
          return;
        }

        const map = new mapboxgl.default.Map({
          container,
          accessToken,
          // dark-v11 is the lightest built-in style to render: it reads at
          // night and requests far fewer labels, glyphs and sprites than the
          // standard styles. On a 2G connection that difference is seconds.
          style: "mapbox://styles/mapbox/dark-v11",
          center: [initial.lng, initial.lat],
          zoom: zoomForAccuracy(initial.accuracy),
          dragRotate: false,
          pitchWithRotate: false,
          // Mapbox's terms require visible attribution.
          attributionControl: true,
          fadeDuration: 0,
        });

        const marker = new mapboxgl.default.Marker({ color: "#E53935" })
          .setLngLat([initial.lng, initial.lat])
          .addTo(map);

        map.on("error", (event) => {
          // Individual tile failures are normal on a weak connection. Log them
          // rather than tearing the map down: the marker and the coordinates
          // below it are still the most useful thing on the page.
          console.error("tracking map tile error", { message: event.error.message });
        });

        mapRef.current = map;
        markerRef.current = marker;
        setStatus("ready");
      } catch (cause) {
        console.error("tracking map failed to load", { cause });
        if (!disposed) {
          setStatus("failed");
        }
      }
    };

    void mount();

    return () => {
      disposed = true;
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // `lat`/`lng`/`accuracy` are deliberately not dependencies: they are applied
    // by the effect above, and re-running this one would rebuild the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      router.refresh();
    }, LIVE_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <div>
      <p className="sr-only">
        Map of the last known position, at latitude {lat}, longitude {lng}.
      </p>
      <div className="relative">
        {/* mapbox-gl owns this element's children once it initialises, so the
            loading and failure states are laid over it rather than inside it. */}
        <div
          ref={containerRef}
          className="h-64 w-full overflow-hidden rounded-card bg-ink-surface ring-1 ring-ink/10"
        />
        {status === "loading" ? (
          <div className="absolute inset-0 grid place-items-center rounded-card bg-ink-canvas text-sm text-ink-faint">
            Loading the map…
          </div>
        ) : null}
        {status === "failed" ? (
          <div className="absolute inset-0 grid place-items-center rounded-card bg-ink-surface px-6 text-center text-sm text-ink-muted ring-1 ring-ink/10">
            The map could not load on this connection. The coordinates below still show where they
            were.
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        {lat.toFixed(5)}, {lng.toFixed(5)}
      </p>
    </div>
  );
};

type TrackingActionsProps = {
  personName: string;
  /** Null when the account has no number on file; the call link is then absent. */
  phone: string | null;
  trackingUrl: string;
};

/**
 * The two things a guardian can do from this page: call the person, or pull
 * someone else in. Both are rendered into the server HTML, so the `tel:` link
 * works with no JavaScript and no data — the fastest possible route to help.
 */
export const TrackingActions = ({ personName, phone, trackingUrl }: TrackingActionsProps) => {
  const [canShare, setCanShare] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    setCanShare(typeof navigator.share === "function");
  }, []);

  const onShare = async (): Promise<void> => {
    setShareError(null);
    try {
      await navigator.share({
        title: `${personName} needs help`,
        text: `${personName} has raised an emergency SOS in Watchtower.`,
        url: trackingUrl,
      });
    } catch (cause) {
      // Dismissing the OS share sheet rejects the promise. That is the user's
      // choice, not a failure, and reporting it would be noise.
      if (cause instanceof DOMException && cause.name === "AbortError") {
        return;
      }
      console.error("share sheet failed", { cause });
      setShareError("This phone could not open the share sheet. Copy the link below instead.");
    }
  };

  return (
    <div className="space-y-3">
      {phone === null ? (
        <p className="rounded-card bg-ink-surface p-4 text-sm text-ink-muted ring-1 ring-ink/5">
          Watchtower has no phone number for {personName} on file, so this page has nothing to call
          for you. Send the link below to someone who can reach them.
        </p>
      ) : (
        <a
          href={`tel:${phone}`}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-pill bg-sos-500 px-7 font-display text-base font-bold text-white shadow-sos transition hover:bg-sos-600"
        >
          <Phone className="size-5" aria-hidden />
          Call {personName.split(" ")[0] ?? personName}
        </a>
      )}

      {canShare ? (
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onClick={() => {
            void onShare();
          }}
        >
          <Share2 className="size-5" aria-hidden />
          Share this with others
        </Button>
      ) : null}

      {shareError !== null ? (
        <p role="alert" className="text-sm font-semibold text-sos-700">
          {shareError}
        </p>
      ) : null}

      <p className="break-all text-xs text-ink-faint">{trackingUrl}</p>
    </div>
  );
};
