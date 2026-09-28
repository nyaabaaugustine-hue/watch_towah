"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { drainQueue, queuedPingCount, type QueuedPing, queuePing } from "@/lib/offline-store";

export type LocationWatchState = "idle" | "watching" | "denied" | "unavailable";

type PostResult = { ok: true } | { ok: false };

/**
 * Battery-aware interval.
 *
 * The app's promise is to be battery-friendly, which means the polling rate has
 * to respond to the actual device rather than running a fixed cadence. A phone on
 * 4% is about to be someone's lifeline and should not be spending that charge on
 * a 10-second heartbeat; a phone on a journey or mid-SOS should be far more
 * eager, because the accuracy is the whole point.
 *
 * @param baseSeconds The owner's configured background interval.
 * @param isUrgent True during a journey or a live alert.
 * @param batteryLevel 0-100, or null when the Battery API is unavailable.
 * @returns The interval to use, in seconds.
 */
const chooseIntervalSeconds = (
  baseSeconds: number,
  isUrgent: boolean,
  batteryLevel: number | null,
): number => {
  if (isUrgent) {
    return 10;
  }

  // Below 20% the phone is being rationed; halve the sampling rather than let
  // it run flat. 15s would drain a low-end device over a long evening.
  if (batteryLevel !== null && batteryLevel < 20) {
    return Math.max(baseSeconds * 2, 120);
  }

  return baseSeconds;
};

/** Reads the Battery Status API where it exists. Returns null elsewhere. */
const readBattery = async (): Promise<number | null> => {
  if (typeof navigator === "undefined" || !("getBattery" in navigator)) {
    return null;
  }

  try {
    const manager = (
      navigator as Navigator & {
        getBattery: () => Promise<{ level: number }>;
      }
    ).getBattery;
    const battery = await manager.call(navigator);
    return Math.round(battery.level * 100);
  } catch {
    // Firefox and iOS Safari do not expose this. Not an error worth surfacing.
    return null;
  }
};

export type LocationWatchHandle = {
  /** Force an immediate fix, e.g. when the user taps "Share my location". */
  captureNow: () => void;
  /** Coalesced by React; safe to use directly in an effect dependency list. */
  sendPing: (position: GeolocationPosition) => void;
  state: LocationWatchState;
  lastSentAt: number | null;
  queuedCount: number;
};

/**
 * Reports the device position to `/api/location` on an adaptive interval, and
 * queues anything that fails so an outage does not create gaps in the trail.
 *
 * Renders nothing. The dashboard and share page each decide how much of the
 * position to surface, because a person's live position is not something every
 * screen should display.
 *
 * @param baseSeconds Background interval from the owner's settings.
 * @param isUrgent True during a journey or live alert, which overrides the
 *   battery-aware interval.
 */
export const useLocationWatch = (
  baseSeconds: number,
  isUrgent: boolean,
): LocationWatchHandle => {
  const [state, setState] = useState<LocationWatchState>("idle");
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [queuedCount, setQueuedCount] = useState<number>(0);

  const watchIdRef = useRef<number | null>(null);
  const batteryRef = useRef<number | null>(null);

  const postPing = useCallback(async (ping: QueuedPing): Promise<PostResult> => {
    try {
      const response = await fetch("/api/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ping),
      });
      return { ok: response.ok };
    } catch {
      // Network-level failure, which is exactly the case the queue exists for.
      return { ok: false };
    }
  }, []);

  const sendPing = useCallback(
    (position: GeolocationPosition): void => {
      // Mined once here and reused by the queue, so a retry of this exact reading
      // keeps the same idempotency key.
      const ping: QueuedPing = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        batteryLevel: batteryRef.current,
        source: "background",
        recordedAt: new Date(position.timestamp).toISOString(),
        clientId: crypto.randomUUID(),
      };

      void (async () => {
        const result = await postPing(ping);

        if (result.ok) {
          setLastSentAt(Date.now());
          return;
        }

        // Keep it for later. A dropped ping during a tunnel is the difference
        // between a continuous trail and a gap someone has to explain.
        if (await queuePing(ping)) {
          setQueuedCount(await queuedPingCount());
        }
      })();
    },
    [postPing],
  );

  // Flush the backlog the moment the device reports it is back online.
  useEffect(() => {
    const flush = (): void => {
      void (async () => {
        const sent = await drainQueue(async (ping) => {
          const result = await postPing(ping);
          return result.ok;
        });

        if (sent > 0) {
          setQueuedCount(await queuedPingCount());
        }
      })();
    };

    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [postPing]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setState("unavailable");
      return;
    }

    void readBattery().then((level) => {
      batteryRef.current = level;
    });

    const intervalMs = chooseIntervalSeconds(baseSeconds, isUrgent, batteryRef.current) * 1000;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setState("watching");
        sendPing(position);
      },
      (error) => {
        // A single transient failure must not tear the watch down, so only a
        // refusal is treated as terminal. Transient errors resolve on the next fix.
        if (error.code === error.PERMISSION_DENIED) {
          setState("denied");
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
        }
      },
      {
        enableHighAccuracy: true,
        // Asking for a fix from scratch on every tick would dominate battery;
        // a cached position is usually good enough between pings.
        maximumAge: intervalMs / 2,
        // A tight timeout would mean constant failures on a weak signal, which
        // is the normal case here rather than an edge case.
        timeout: Math.max(intervalMs * 2, 30_000),
      },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [baseSeconds, isUrgent, sendPing]);

  return {
    state,
    lastSentAt,
    queuedCount,
    sendPing,
    captureNow: () => {
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => sendPing(position),
        () => {
          // A manual capture is best-effort; the interval keeps trying.
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
      );
    },
  };
};

/**
 * Wrapper so a page can mount the watcher declaratively.
 *
 * `LocationWatch` exists because hooks cannot be called conditionally, and every
 * consumer wants the same "mount it and it runs" behaviour.
 */
export const LocationWatch = ({
  baseSeconds,
  isUrgent,
  onStateChange,
}: {
  baseSeconds: number;
  isUrgent: boolean;
  onStateChange?: (state: LocationWatchState) => void;
}): null => {
  const { state } = useLocationWatch(baseSeconds, isUrgent);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  return null;
};
