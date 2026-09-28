"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * How long the button must be held before anything is sent.
 *
 * Deliberately shorter than the "2 seconds" the label promises. Rounding the
 * hold up in the copy is the safe direction: the alert goes out while the user
 * is still counting, and a control that finishes early is trusted, while one
 * that finishes late reads as "it did not work" at the worst possible moment.
 */
const HOLD_DURATION_MS = 1200;

/**
 * A thumb is not a mouse. Resting on this button while scrolling the page
 * moves the contact point by far more than this, and that must read as "I was
 * not trying to press this" rather than as intent.
 */
const MOVE_TOLERANCE_PX = 10;

const GEOLOCATION_TIMEOUT_MS = 8000;

/**
 * A cached fix can still come back from a compliant implementation, and the
 * server stamps every ping with the request time. Sending a stale coordinate
 * would put a family at the wrong place with a fresh timestamp, so anything
 * older than this is discarded rather than sent.
 */
const MAX_FIX_AGE_MS = 30_000;

const ARM_TICK_MS = 12;
const ALERT_VIBRATION_MS = [80, 60, 160];

const LOCATION_UNAVAILABLE_NOTICE =
  "Your location could not be captured, so your Guardian Circle is being told that you need help but not where you are. Step outside if you can, and call them to tell them where you are.";

const NETWORK_FAILURE_MESSAGE =
  "Watchtower could not be reached, so nothing has been sent yet. Call your Guardian Circle now if you can, then try again.";

const UNKNOWN_FAILURE_MESSAGE = "Watchtower could not raise that alert. Try again.";

const CONFLICT_FALLBACK_MESSAGE =
  "An alert is already running, so a second one was not created. Your Guardian Circle is already being told.";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const RING_RADIUS = 56;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Mirrors `SOS_TRIGGERS` in `@/server/sos` rather than importing it: Drizzle must never reach the browser bundle. */
type SosTrigger = "button" | "shake" | "journey" | "checkin";

const createResponseSchema = z.object({
  alertId: z.string(),
  status: z.string(),
  cancellableUntil: z.string().nullable(),
  notified: z.number(),
  trackingUrl: z.string(),
});

const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

type SosPhase =
  | "idle"
  | "arming"
  | "locating"
  | "sending"
  | "sent"
  | "already-running"
  | "failed";

type Fix = {
  lat: number;
  lng: number;
  accuracy: number;
};

type SentSummary = {
  notified: number;
  trackingUrl: string;
};

/**
 * The current position, or null for every failure mode: unsupported, denied,
 * unavailable, or slow. A null is never a reason to withhold the alert — a
 * circle that has been told "help, unknown location" can still act, and a
 * circle that was never told cannot.
 */
const readCurrentFix = (): Promise<Fix | null> =>
  new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (Date.now() - position.timestamp > MAX_FIX_AGE_MS) {
          resolve(null);
          return;
        }
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (failure) => {
        console.info("sos raised without a location fix", { reason: failure.code, message: failure.message });
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 0 },
    );
  });

const vibrate = (pattern: number | number[]): void => {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  try {
    navigator.vibrate(pattern);
  } catch (cause) {
    // iOS Safari has no Vibration API at all, and some Android builds throw
    // rather than return false when the page is not visible. Neither is worth
    // surfacing: the visual ring already shows the hold.
    console.info("haptics unavailable on this device", { cause });
  }
};

/**
 * Read the message the server actually sent, falling back to plain wording when
 * the body is not the shape we expect. Inventing an error the user then acts
 * on is worse than saying something generic.
 */
const readErrorMessage = async (response: Response): Promise<string | null> => {
  try {
    const parsed = errorResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error.message : null;
  } catch (cause) {
    console.error("sos request returned a body that is not json", { status: response.status, cause });
    return null;
  }
};

const humanCount = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

/**
 * The SOS trigger.
 *
 * Press and hold, never tap. A single accidental brush of the biggest button on
 * a frightened person's screen must not page their family, so the alert is
 * armed only by sustained contact, and any drift of the contact point — a thumb
 * sliding as the page scrolls — abandons the arming silently.
 */
export const SosControl = () => {
  const router = useRouter();
  const hintId = useId();

  const [phase, setPhaseState] = useState<SosPhase>("idle");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState<SentSummary | null>(null);

  const ringRef = useRef<SVGCircleElement>(null);
  const frameRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const holdStartedAtRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const phaseRef = useRef<SosPhase>("idle");

  /**
   * A hold spans many frames and several closures, and the pointer-up handler
   * that ends it belongs to whichever render started it. Mirroring the phase in
   * a ref keeps the end of a hold from being judged by a stale render.
   */
  const updatePhase = useCallback((next: SosPhase): void => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent): void => setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const setRingProgress = useCallback((progress: number): void => {
    const ring = ringRef.current;
    if (ring === null) {
      return;
    }
    ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
  }, []);

  const stopLoop = useCallback((): void => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  useEffect(() => stopLoop, [stopLoop]);

  const dispatch = useCallback(
    async (trigger: SosTrigger): Promise<void> => {
      stopLoop();
      originRef.current = null;
      setSent(null);
      setNotice(null);
      setMessage(null);
      updatePhase("locating");
      vibrate(ALERT_VIBRATION_MS);

      const fix = await readCurrentFix();
      setNotice(fix === null ? LOCATION_UNAVAILABLE_NOTICE : null);
      updatePhase("sending");

      let response: Response;
      try {
        response = await fetch("/api/sos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trigger,
            // Coordinates are omitted rather than guessed when there is no fix.
            // A plausible-looking wrong location is more dangerous than none.
            ...(fix === null ? {} : { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }),
          }),
        });
      } catch (cause) {
        console.error("sos request never reached watchtower", { trigger, cause });
        setMessage(NETWORK_FAILURE_MESSAGE);
        updatePhase("failed");
        return;
      }

      if (response.status === 409) {
        const serverMessage = await readErrorMessage(response);
        setMessage(serverMessage ?? CONFLICT_FALLBACK_MESSAGE);
        updatePhase("already-running");
        // Pull the live alert into the server render so the owner sees the same
        // panel their guardians' phones are following.
        router.refresh();
        return;
      }

      if (!response.ok) {
        const serverMessage = await readErrorMessage(response);
        console.error("sos create was rejected", { status: response.status, trigger });
        setMessage(serverMessage ?? UNKNOWN_FAILURE_MESSAGE);
        updatePhase("failed");
        return;
      }

      const parsed = createResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        // The alert exists server-side whatever the body looked like. Reporting a
        // failure here would push the user to send a second one.
        console.error("sos create returned an unexpected body", {
          status: response.status,
          issues: parsed.error.issues.map((issue) => issue.path.join(".")),
        });
        setSent({ notified: 0, trackingUrl: "" });
        updatePhase("sent");
        router.refresh();
        return;
      }

      setSent({ notified: parsed.data.notified, trackingUrl: parsed.data.trackingUrl });
      updatePhase("sent");
      router.refresh();
    },
    [router, stopLoop, updatePhase],
  );

  const begin = useCallback(
    (origin: { x: number; y: number } | null): void => {
      if (phaseRef.current !== "idle" && phaseRef.current !== "failed") {
        return;
      }

      originRef.current = origin;
      setNotice(null);
      setMessage(null);
      updatePhase("arming");
      vibrate(ARM_TICK_MS);

      if (reducedMotionRef.current) {
        return;
      }

      holdStartedAtRef.current = performance.now();
      const tick = (now: number): void => {
        const progress = Math.min(1, (now - holdStartedAtRef.current) / HOLD_DURATION_MS);
        setRingProgress(progress);
        if (progress >= 1) {
          frameRef.current = null;
          void dispatch("button");
          return;
        }
        frameRef.current = window.requestAnimationFrame(tick);
      };
      frameRef.current = window.requestAnimationFrame(tick);
    },
    [dispatch, setRingProgress, updatePhase],
  );

  const abort = useCallback((): void => {
    if (phaseRef.current !== "arming") {
      return;
    }
    stopLoop();
    originRef.current = null;
    // Released early: the user was reaching for something, not asking for help.
    // Silence is the whole point — there is nothing to dismiss and nothing to
    // be frightened of.
    updatePhase("idle");
  }, [stopLoop, updatePhase]);

  useEffect(() => {
    if (phase === "arming") {
      // With reduced motion the ring jumps to half rather than sweeping, so
      // progress stays legible without anything animating frame to frame.
      setRingProgress(reducedMotion ? 0.5 : 0);
      return;
    }
    if (phase === "locating" || phase === "sending") {
      setRingProgress(1);
      return;
    }
    setRingProgress(0);
  }, [phase, reducedMotion, setRingProgress]);

  // Still a live control while arming: the hold is in progress, not unavailable.
  const interactive = phase === "idle" || phase === "arming" || phase === "failed";
  const busy = phase === "locating" || phase === "sending";

  const statusLine =
    phase === "arming"
      ? "Keep holding…"
      : phase === "locating"
        ? "Reading your location…"
        : phase === "sending"
          ? "Sending the alert…"
            : phase === "sent"
              ? "Alert raised"
            : phase === "already-running"
              ? "Alert already running"
              : phase === "failed"
                ? "Not sent"
                : "Press and hold 2 seconds";

  return (
    <section aria-labelledby={`${hintId}-label`} className="flex flex-col items-center">
      <h2 id={`${hintId}-label`} className="sr-only">
        Emergency SOS
      </h2>

      <div className="relative grid place-items-center">
        {reducedMotion ? null : (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 animate-sos-pulse rounded-full bg-sos-500/30"
          />
        )}

        <Button
          variant="sos"
          size="lg"
          aria-disabled={!interactive}
          aria-label="Emergency SOS. Press and hold for two seconds."
          aria-describedby={hintId}
          className={cn(
            "relative size-44 touch-none select-none rounded-full p-0 [webkit-touch-callout:none]",
            phase === "arming" && "scale-95",
          )}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            if (event.pointerType === "mouse" && event.button !== 0) {
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            begin({ x: event.clientX, y: event.clientY });
          }}
          onPointerMove={(event) => {
            const origin = originRef.current;
            if (origin === null) {
              return;
            }
            const travelled = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
            if (travelled > MOVE_TOLERANCE_PX) {
              abort();
            }
          }}
          onPointerUp={abort}
          onPointerCancel={abort}
          onLostPointerCapture={abort}
          onKeyDown={(event) => {
            if (event.key !== " " && event.key !== "Enter") {
              return;
            }
            // A held key repeats; treating each repeat as a fresh hold would
            // restart the ring under a keyboard user's finger.
            if (event.repeat || originRef.current !== null) {
              event.preventDefault();
              return;
            }
            event.preventDefault();
            begin(null);
          }}
          onKeyUp={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              abort();
            }
          }}
          onBlur={abort}
        >
          <span className="flex flex-col items-center gap-1 leading-none">
            {busy ? (
              <Loader2 className="size-8 animate-spin" aria-hidden />
            ) : phase === "sent" ? (
              <ShieldCheck className="size-8" aria-hidden />
            ) : phase === "failed" ? (
              <RotateCcw className="size-8" aria-hidden />
            ) : (
              <ShieldAlert className="size-8" aria-hidden />
            )}
            <span className="font-display text-3xl">SOS</span>
          </span>
        </Button>

        <svg
          aria-hidden
          viewBox="0 0 120 120"
          className="pointer-events-none absolute size-56 text-sos-500"
          focusable="false"
        >
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.25}
            strokeWidth="5"
          />
          <circle
            ref={ringRef}
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            transform="rotate(-90 60 60)"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE}
            className={cn(
              "transition-[stroke-dashoffset] duration-200 ease-out",
              phase === "arming" && "transition-none",
            )}
          />
        </svg>
      </div>

      <p id={hintId} aria-live="polite" className="mt-3 text-center text-sm font-semibold text-ink-muted">
        {statusLine}
      </p>

      {notice !== null && phase !== "idle" && phase !== "arming" ? (
        <p className="mt-2 max-w-xs text-center text-sm font-semibold text-amber-800">{notice}</p>
      ) : null}

      {phase === "failed" && message !== null ? (
        <div role="alert" className="mt-3 w-full rounded-card bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="font-display text-section text-ink">{message}</p>
          <div className="mt-3">
            <Button
              variant="sos"
              size="lg"
              fullWidth
              onClick={() => {
                void dispatch("button");
              }}
            >
              <RotateCcw className="size-5" aria-hidden />
              Send again
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Trying again reads your location once more. Nothing has been sent to your Guardian
            Circle.
          </p>
        </div>
      ) : null}

      {phase === "already-running" && message !== null ? (
        <div className="mt-3 w-full rounded-card bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="font-display text-section text-ink">{message}</p>
        </div>
      ) : null}

      {phase === "sent" && sent !== null ? (
        <div className="mt-3 w-full rounded-card bg-sos-50 p-4 ring-1 ring-sos-200">
          <p className="font-display text-section text-sos-700">
            {sent.notified > 0
              ? `${humanCount(sent.notified, "person has", "people have")} been told.`
              : "Your alert is raised."}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {sent.notified > 0
              ? "Your Guardian Circle is following your live location."
              : "Watchtower tried and could not reach anyone. Call them now."}
          </p>
          {sent.trackingUrl === "" ? null : (
            <Link
              href={sent.trackingUrl}
              className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-watchtower-700"
            >
              Open the live alert
            </Link>
          )}
        </div>
      ) : null}
    </section>
  );
};
