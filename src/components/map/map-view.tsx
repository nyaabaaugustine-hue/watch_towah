"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";

import { cn } from "@/lib/cn";

export type MapMarker = {
  lat: number;
  lng: number;
  kind?: "self" | "journey-start" | "journey-destination" | "zone";
};

export type MapViewProps = {
  /**
   * Public Mapbox token, supplied by the server component that renders this.
   *
   * It is a prop rather than an `env` read on purpose: `src/lib/env.ts` validates
   * every secret in one schema, and a browser bundle has none of them, so
   * importing `env` here would throw. Server in, client render.
   */
  accessToken: string;
  markers: MapMarker[];
  /** Breadcrumb, oldest first. Drawn as a connecting line. */
  trail?: MapMarker[];
  className?: string;
  /** Replaces the map when there is nothing to plot. */
  emptyMessage?: string;
  lowDataMode?: boolean;
};

/** Accra, used only as a fallback frame when no position is known yet. */
const FALLBACK_CENTER: [number, number] = [5.6037, -0.187];

/** Every layer and source this component owns is prefixed so it can be swept. */
const OWNED = "watchtower-";

const isUsableToken = (token: string): boolean =>
  token.length > 0 && !token.startsWith("placeholder");

export const MapView = ({
  accessToken,
  markers,
  trail,
  className,
  emptyMessage,
  lowDataMode,
}: MapViewProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const hasSomethingToPlot = markers.length > 0 || (trail?.length ?? 0) > 0;

  // Create the map once. Position updates are pushed into the existing instance
  // by the effect below, because re-creating it on every fix would reset the
  // user's pan and zoom and thrash WebGL on a low-end device.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || mapRef.current !== null) {
      return;
    }

    if (!isUsableToken(accessToken)) {
      setFailed(true);
      return;
    }

    let disposed = false;
    let created: MapboxMap | null = null;

    void (async () => {
      // Imported here rather than at module scope: mapbox-gl touches `window`
      // while loading, so a static import would throw during server rendering.
      // It also keeps ~200 kB of WebGL out of the initial bundle.
      const mapboxgl = (await import("mapbox-gl")).default;

      if (disposed || containerRef.current === null) {
        return;
      }

      mapboxgl.accessToken = accessToken;

      const focus = markers[0];
      created = new mapboxgl.Map({
        container: containerRef.current,
        style:
          lowDataMode === true
            ? "mapbox://styles/mapbox/light-v11"
            : "mapbox://styles/mapbox/streets-v12",
        center: focus === undefined ? FALLBACK_CENTER : [focus.lng, focus.lat],
        zoom: focus === undefined ? 11 : 15,
        // Rotation and 3D tilt cost battery and GPU, and neither helps someone
        // find a person. A north-up 2D map is the right trade for this device
        // class.
        attributionControl: true,
        cooperativeGestures: true,
      });

      created.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

      created.on("load", () => {
        if (!disposed) {
          setReady(true);
        }
      });

      created.on("error", () => {
        // A missing tile or a weak signal is normal in Ghana; the map degrades
        // rather than replacing itself with an error.
        if (!disposed) {
          setFailed(true);
        }
      });

      mapRef.current = created;
    })();

    return () => {
      disposed = true;
      created?.remove();
      mapRef.current = null;
    };
    // `markers[0]` and `accessToken` are intentionally not dependencies: this
    // effect owns creation only, and including them would rebuild the map on
    // every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, lowDataMode]);

  // Draw the trail and markers into the live map.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !ready) {
      return;
    }

    let disposed = false;

    void (async () => {
      if (disposed) {
        return;
      }

      // Remove whatever this component drew last time, so a shorter trail does
      // not leave the previous line behind.
      const style = map.getStyle();
      for (const layer of style.layers ?? []) {
        if (layer.id.startsWith(OWNED)) {
          map.removeLayer(layer.id);
        }
      }
      for (const sourceId of Object.keys(style.sources ?? {})) {
        if (sourceId.startsWith(OWNED)) {
          map.removeSource(sourceId);
        }
      }

      if (trail !== undefined && trail.length > 1) {
        map.addSource(`${OWNED}trail`, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: trail.map((point) => [point.lng, point.lat]),
            },
          },
        });
        map.addLayer({
          id: `${OWNED}trail-line`,
          type: "line",
          source: `${OWNED}trail`,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#4B0FA8", "line-width": 4, "line-opacity": 0.7 },
        });
      }

      if (markers.length > 0) {
        map.addSource(`${OWNED}markers`, {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: markers.map((marker) => ({
              type: "Feature",
              properties: { kind: marker.kind ?? "self" },
              geometry: { type: "Point", coordinates: [marker.lng, marker.lat] },
            })),
          },
        });

        // Halo first so the dot reads clearly against dark map tiles.
        map.addLayer({
          id: `${OWNED}marker-halo`,
          type: "circle",
          source: `${OWNED}markers`,
          paint: { "circle-radius": 10, "circle-color": "#4B0FA8", "circle-opacity": 0.22 },
        });
        map.addLayer({
          id: `${OWNED}marker-dot`,
          type: "circle",
          source: `${OWNED}markers`,
          paint: { "circle-color": "#4B0FA8", "circle-radius": 5 },
        });
      }

      // Re-frame on the newest position, but only when it is genuinely new.
      const newest = markers[0];
      if (newest !== undefined) {
        const source = map.getSource(`${OWNED}markers`) as GeoJSONSource | undefined;
        if (source !== undefined) {
          map.easeTo({ center: [newest.lng, newest.lat], duration: 600 });
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [markers, ready, trail]);

  // Skip the ~200 kB Mapbox download entirely when there is nothing to show.
  if (!hasSomethingToPlot) {
    return (
      <div
        className={cn(
          "flex min-h-48 items-center justify-center rounded-2xl border border-ink/10 bg-ink/[0.03] p-6 text-center",
          className,
        )}
      >
        <p className="max-w-xs text-sm text-ink/60">
          {emptyMessage ?? "No location to show yet."}
        </p>
      </div>
    );
  }

  if (failed) {
    return (
      <div
        className={cn(
          "flex min-h-48 items-center justify-center rounded-2xl border border-ink/10 bg-ink/[0.03] p-6 text-center",
          className,
        )}
      >
        <p className="max-w-xs text-sm text-ink/60">
          {isUsableToken(accessToken)
            ? "The map could not load on this device. Your location is still being recorded."
            : "The map needs a Mapbox access token to load."}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("w-full overflow-hidden rounded-2xl bg-ink/5", className)}
      style={{ minHeight: "12rem" }}
      role="img"
      aria-label="Map showing the shared location"
    />
  );
};
