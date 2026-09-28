"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, ShieldCheck, X } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";

/**
 * Mirrors the API contract rather than being imported from `@/server/sos`:
 * that module pulls in Drizzle, and nothing server-side may reach the browser
 * bundle of the dashboard.
 */
const LIVE_STATUSES = ["triggered", "dispatching", "active", "acknowledged"] as const;
type LiveStatus = (typeof LIVE_STATUSES)[number];

/** Long enough to notice, short enough not to drain a low-end phone. */
const POLL_INTERVAL_MS = 10_000;
const COPY_FEEDBACK_MS = 2000;
const CONFIRM_AUTO_RESET_MS = 6000;

const pollResponseSchema = z.object({
  active: z
    .object({
      alertId: z.string(),
      status: z.enum(LIVE_STATUSES),
      cancellableUntil: z.string().nullable(),
      notified: z.number(),
    })
    .nullable(),
});

const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

type ActionOutcome = { ok: true } | { ok: false; message: string };

const secondsUntil = (isoInstant: string): number =>
  Math.max(0, Math.ceil((Date.parse(isoInstant) - Date.now()) / 1000));

/**
 * Read the error the server actually sent, falling back to plain wording when
 * the body is not the shape we expect. Guessing at a message the user then acts
 * on is worse than saying something generic.
 */
const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const parsed = errorBodySchema.safeParse(await response.json());
    return parsed.success
      ? parsed.data.error.message
      : "Watchtower could not do that. Try again.";
  } catch (cause) {
    console.error("sos banner got a non-json error body", { status: response.status, cause });
    return "Watchtower could not do that. Try again.";
  }
};

const postSosAction = async (path: string, alertId: string): Promise<ActionOutcome> => {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId }),
    });

    if (response.ok) {
      return { ok: true };
    }
    return { ok: false, message: await readErrorMessage(response) };
  } catch (cause) {
    console.error("sos banner request failed", { path, alertId, cause });
    return {
      ok: false,
      message: "Watchtower could not be reached. Check your connection and try again.",
    };
  }
};

/**
 * The headline is derived from the notified count, not from the status alone.
 *
 * `active` means "we finished attempting", not "the message arrived" — an alert
 * whose every SMS failed still reaches `active`, because there is nothing left
 * to retry inline. Keying the headline off the status therefore produced a
 * banner that said "Your Guardian Circle has been told" directly above "No one
 * has been notified yet", and the headline is what somebody in danger reads
 * first. A count of zero has to say so in the loudest text on the screen.
 */
const headlineFor = (status: LiveStatus, notified: number): string => {
  if (status === "triggered") {
    return "Notifying your Guardian Circle";
  }
  if (status === "dispatching") {
    return "Sending the alert";
  }
  if (status === "acknowledged") {
    return "A guardian has seen this alert";
  }
  return notified > 0 ? "Your Guardian Circle has been told" : "Watchtower could not reach your circle";
};

type ActiveAlertBannerProps = {
  alertId: string;
  status: LiveStatus;
  /** ISO instant. */
  triggeredAt: string;
  lat: number | null;
  lng: number | null;
  /** ISO instant, or null once the cancellation window has passed. */
  cancellableUntil: string | null;
  trackingUrl: string;
  notified: number;
};

/**
 * The owner's own view of a live SOS.
 *
 * It is deliberately the loudest thing on the dashboard while an alert runs,
 * and the first thing to say when one ends. Between those two states it never
 * claims more than it knows: an unreachable network is reported as unreachable
 * rather than smoothed over, because someone in danger deciding whether their
 * family has been told must not be misled.
 */
export const ActiveAlertBanner = ({
  alertId,
  status,
  triggeredAt,
  lat,
  lng,
  cancellableUntil,
  trackingUrl,
  notified,
}: ActiveAlertBannerProps) => {
  const [phase, setPhase] = useState<"live" | "cancelled" | "resolved" | "ended">("live");
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(status);
  const [notifiedCount, setNotifiedCount] = useState<number>(notified);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(() =>
    cancellableUntil === null ? null : secondsUntil(cancellableUntil),
  );
  const [busy, setBusy] = useState<"cancel" | "resolve" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingResolve, setConfirmingResolve] = useState(false);
  const [copied, setCopied] = useState(false);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    if (cancellableUntil === null) {
      return;
    }
    const tick = () => setSecondsLeft(secondsUntil(cancellableUntil));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [cancellableUntil]);

  const poll = useCallback(async (): Promise<void> => {
    // A backgrounded tab on a metered connection must not keep asking. The
    // person who needs this banner is looking at it.
    if (document.visibilityState !== "visible") {
      return;
    }

    try {
      const response = await fetch("/api/sos", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`GET /api/sos responded ${response.status}`);
      }

      const parsed = pollResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error(
          `GET /api/sos returned an unexpected body: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
        );
      }

      setUnreachable(false);

      if (parsed.data.active === null) {
        setPhase((current) => (current === "live" ? "ended" : current));
        return;
      }

      // A different live alert means this one is over. Without this check the
      // banner would quietly adopt a *new* SOS's status and guardian count, and
      // the person would read someone else's alert as their own.
      if (parsed.data.active.alertId !== alertId) {
        setPhase((current) => (current === "live" ? "ended" : current));
        return;
      }

      setLiveStatus(parsed.data.active.status);
      setNotifiedCount(parsed.data.active.notified);
      setSecondsLeft(
        parsed.data.active.cancellableUntil === null
          ? null
          : secondsUntil(parsed.data.active.cancellableUntil),
      );
    } catch (cause) {
      console.error("sos banner status poll failed", { alertId, cause });
      setUnreachable(true);
    }
  }, [alertId]);

  useEffect(() => {
    if (phase !== "live") {
      return;
    }
    const timer = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [phase, poll]);

  useEffect(() => {
    if (!confirmingResolve) {
      return;
    }
    const timer = window.setTimeout(() => setConfirmingResolve(false), CONFIRM_AUTO_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [confirmingResolve]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(trackingUrl);
      setCopied(true);
    } catch (cause) {
      console.error("clipboard write failed", { cause });
      setActionError("This phone would not let Watchtower copy the link. Tap the link and copy it by hand.");
    }
  };

  const onCancel = async (): Promise<void> => {
    setBusy("cancel");
    setActionError(null);
    const outcome = await postSosAction("/api/sos/cancel", alertId);
    setBusy(null);

    if (!outcome.ok) {
      setActionError(outcome.message);
      return;
    }
    setPhase("cancelled");
  };

  const onResolve = async (): Promise<void> => {
    setBusy("resolve");
    setActionError(null);
    const outcome = await postSosAction("/api/sos/resolve", alertId);
    setBusy(null);

    if (!outcome.ok) {
      setActionError(outcome.message);
      return;
    }
    setPhase("resolved");
  };

  if (phase !== "live") {
    const resolved = phase === "resolved";
    return (
      <section
        aria-live="polite"
        className="rounded-card bg-safe-50 p-4 shadow-card ring-1 ring-safe-200"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-safe-700" aria-hidden />
          <div className="min-w-0">
            <p className="font-display text-section text-safe-700">
              {resolved ? "You marked yourself safe" : "This alert is no longer active"}
            </p>
            <p className="mt-0.5 text-sm text-ink-muted">
              {resolved
                ? notifiedCount > 0
                  ? "You are marked safe. Nobody has been sent a new message saying so, so if your circle is still waiting, tell them directly."
                  : "You are marked safe. Watchtower never reached your circle during this alert, so if they are still looking for you, tell them you are fine."
                : "It was cancelled, or it was resolved from another device. Nothing further is being sent."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const canCancel = secondsLeft !== null && secondsLeft > 0;

  return (
    <section aria-live="polite" className="rounded-card bg-sos-50 p-4 shadow-sos ring-1 ring-sos-200">
      <div className="flex items-start gap-3">
        <span className="relative mt-1.5 flex size-3 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full animate-sos-pulse rounded-full bg-sos-500" />
          <span className="relative inline-flex size-3 rounded-full bg-sos-500" />
        </span>
        <div className="min-w-0">
          <p className="font-display text-section text-sos-700">
            {headlineFor(liveStatus, notifiedCount)}
          </p>
          <p className="mt-0.5 text-sm text-ink-muted">
            {notifiedCount > 0
              ? `${notifiedCount} ${notifiedCount === 1 ? "person has" : "people have"} been notified.`
              : "No one has been notified. Call your Guardian Circle directly — do not wait for Watchtower."}
          </p>
        </div>
      </div>

      {unreachable ? (
        <p className="mt-3 text-sm font-semibold text-sos-700">
          Cannot reach Watchtower, retrying. The alert is still recorded — call your Guardian Circle
          directly if this continues.
        </p>
      ) : null}

      {canCancel ? (
        <div className="mt-3 space-y-2">
          {/* This paragraph rewrites itself every second. Left inside the
              section's polite live region it would make a screen reader
              announce the countdown forever, drowning out the one update that
              matters: the guardian count going up. */}
          <p aria-live="off" className="text-sm text-ink-muted">
            You can cancel for {secondsLeft} more {secondsLeft === 1 ? "second" : "seconds"}.
          </p>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            disabled={busy !== null}
            onClick={() => {
              void onCancel();
            }}
          >
            <X className="size-5" aria-hidden />
            {busy === "cancel" ? "Cancelling…" : "Cancel — this was a mistake"}
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">
          {notifiedCount > 0
            ? "This alert has gone out and can no longer be cancelled."
            : "You can no longer cancel this from here. Nothing reached your circle, so call them yourself."}
        </p>
      )}

      <div className="mt-4 border-t border-sos-200 pt-3">
        <p className="flex items-center gap-1.5 text-xs font-bold text-ink-muted">
          <Link2 className="size-3.5" aria-hidden />
          Live tracking link
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            readOnly
            value={trackingUrl}
            aria-label="Live tracking link"
            onFocus={(event) => event.currentTarget.select()}
            className="min-h-11 w-0 min-w-0 flex-1 rounded-pill bg-white px-3 text-sm text-ink-muted ring-1 ring-inset ring-sos-200"
          />
          <Button
            variant="secondary"
            size="md"
            aria-label="Copy the live tracking link"
            onClick={() => {
              void onCopy();
            }}
          >
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        {lat !== null && lng !== null ? (
          <p className="mt-1.5 text-xs text-ink-faint">
            Sharing {lat.toFixed(5)}, {lng.toFixed(5)} · raised{" "}
            {/* Rendered on the server in the server's timezone, so the first
                client render can disagree by hours. suppressHydrationWarning is
                exactly the escape hatch for a wall-clock string; the value is
                still there for anyone reading the HTML. */}
            <time dateTime={triggeredAt} suppressHydrationWarning>
              {new Date(triggeredAt).toLocaleTimeString()}
            </time>
          </p>
        ) : null}
      </div>

      <div className="mt-4 border-t border-sos-200 pt-3">
        {confirmingResolve ? (
          <Button
            variant="safe"
            size="lg"
            fullWidth
            disabled={busy !== null}
            onClick={() => {
              void onResolve();
            }}
          >
            <Check className="size-5" aria-hidden />
            {busy === "resolve" ? "Resolving…" : "Tap again to confirm you are safe"}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            disabled={busy !== null}
            onClick={() => setConfirmingResolve(true)}
          >
            I am safe — resolve this alert
          </Button>
        )}
        {actionError !== null ? (
          <p role="alert" className="mt-2 text-sm font-semibold text-sos-700">
            {actionError}
          </p>
        ) : null}
      </div>
    </section>
  );
};
