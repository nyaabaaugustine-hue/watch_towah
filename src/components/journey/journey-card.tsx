"use client";

import { useActionState } from "react";
import { Check, Play, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { JourneyDisplay, JourneyStatus } from "@/lib/journey";
import {
  arriveJourneyAction,
  cancelJourneyAction,
  startJourneyAction,
  type JourneyActionState,
} from "@/server/journey-actions";

export type JourneyCardProps = {
  id: string;
  destinationLabel: string;
  startLabel: string | null;
  display: JourneyDisplay;
  /**
   * Passed in rather than imported from the server module: a "use client" file
   * cannot import Drizzle, and pulling the enum across would fail the build.
   */
  status: JourneyStatus;
};

const toneClasses: Record<JourneyDisplay["tone"], string> = {
  brand: "bg-watchtower-50 text-watchtower-800",
  warning: "bg-sos-50 text-sos-700",
  muted: "bg-ink-canvas text-ink-muted",
  safe: "bg-safe-50 text-safe-700",
};

const dotClasses: Record<JourneyDisplay["tone"], string> = {
  brand: "bg-watchtower-500",
  warning: "bg-sos-500",
  muted: "bg-ink-faint",
  safe: "bg-safe-500",
};

const initialState: JourneyActionState = { ok: false, message: "" };

/**
 * One journey, with the three actions that can change it.
 *
 * "I have arrived" and "Cancel" are separate buttons on purpose. Arriving is a
 * claim about safety; cancelling is a change of plan. Merging them would let
 * somebody silence a real "she never arrived" alert by tapping the wrong one,
 * which is the worst outcome this screen could have.
 */
const JourneyCard = ({ id, destinationLabel, startLabel, display, status }: JourneyCardProps) => {
  const [startState, startAction, startPending] = useActionState<JourneyActionState, FormData>(
    startJourneyAction,
    initialState,
  );
  const [arriveState, arriveAction, arrivePending] = useActionState<JourneyActionState, FormData>(
    arriveJourneyAction,
    initialState,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState<JourneyActionState, FormData>(
    cancelJourneyAction,
    initialState,
  );

  const isClosed = status === "arrived" || status === "cancelled";
  const feedback = arriveState.message || startState.message || cancelState.message;

  return (
    <Card className="p-4" tone={display.overdue ? "alert" : "neutral"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-section text-ink">{destinationLabel}</h3>
          {startLabel !== null ? <p className="text-sm text-ink-muted">From {startLabel}</p> : null}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-bold ${toneClasses[display.tone]}`}
        >
          <span className={`size-1.5 rounded-full ${dotClasses[display.tone]}`} aria-hidden />
          {display.label}
        </span>
      </div>

      <p className="mt-2 text-sm text-ink-muted">{display.detail}</p>

      {feedback !== "" ? (
        <p role="status" className="mt-2 text-sm font-bold text-ink">
          {feedback}
        </p>
      ) : null}

      {isClosed ? null : (
        <div className="mt-3 flex flex-wrap gap-2">
          {status === "planned" ? (
            <form action={startAction}>
              <input type="hidden" name="journeyId" value={id} />
              <Button type="submit" variant="secondary" size="sm" disabled={startPending}>
                <Play className="size-4" aria-hidden />
                Start now
              </Button>
            </form>
          ) : null}

          <form action={arriveAction}>
            <input type="hidden" name="journeyId" value={id} />
            <Button type="submit" variant="safe" size="sm" disabled={arrivePending}>
              <Check className="size-4" aria-hidden />
              I have arrived
            </Button>
          </form>

          <form action={cancelAction}>
            <input type="hidden" name="journeyId" value={id} />
            <Button type="submit" variant="ghost" size="sm" disabled={cancelPending}>
              <X className="size-4" aria-hidden />
              Cancel
            </Button>
          </form>
        </div>
      )}
    </Card>
  );
};

export { JourneyCard };
