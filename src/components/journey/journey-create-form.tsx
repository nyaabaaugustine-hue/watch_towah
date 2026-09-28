"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { DEFAULT_GRACE_MINUTES, graceOptions } from "@/lib/journey";
import { createJourneyAction, type JourneyActionState } from "@/server/journey-actions";

const initialState: JourneyActionState = { ok: false, message: "" };

const MINUTE_MS = 60_000;

/**
 * A `datetime-local` value in the browser's own timezone, an hour from now.
 *
 * Defaulting to a blank field would make the common case — "I'm going home in
 * about forty minutes" — a three-field form. Defaulting to a time in the past
 * would submit a value the server rejects, which reads as the app being broken
 * rather than the input being wrong. The offset is subtracted because
 * `toISOString` converts to UTC, while `datetime-local` expects local wall time.
 */
const defaultArrival = (): string => {
  const when = new Date(Date.now() + 60 * MINUTE_MS);
  const local = new Date(when.getTime() - when.getTimezoneOffset() * MINUTE_MS);
  return local.toISOString().slice(0, 16);
};

const fieldClass =
  "min-h-11 w-full rounded-card bg-ink-canvas px-3 text-body text-ink ring-1 ring-inset ring-ink/10";

const labelClass = "mb-1.5 block text-sm font-bold text-ink";

const JourneyCreateForm = () => {
  const [state, action, pending] = useActionState<JourneyActionState, FormData>(
    createJourneyAction,
    initialState,
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <div>
        <label className={labelClass} htmlFor="destinationLabel">
          Where are you going?
        </label>
        <input
          id="destinationLabel"
          name="destinationLabel"
          type="text"
          required
          maxLength={160}
          autoComplete="off"
          placeholder="Home, or Madina"
          className={fieldClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="startLabel">
          Starting from <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <input
          id="startLabel"
          name="startLabel"
          type="text"
          maxLength={160}
          autoComplete="off"
          placeholder="Office"
          className={fieldClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="expectedArrival">
          Expected arrival
        </label>
        <input
          id="expectedArrival"
          name="expectedArrival"
          type="datetime-local"
          required
          defaultValue={defaultArrival()}
          className={fieldClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="graceMinutes">
          Alert my circle if I&apos;m not back within
        </label>
        <select id="graceMinutes" name="graceMinutes" defaultValue={DEFAULT_GRACE_MINUTES} className={fieldClass}>
          {graceOptions().map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} minutes
            </option>
          ))}
        </select>
      </div>

      {/*
        The success message is rendered here rather than in a toast because the
        form disappears when the journey appears in the list below, and a toast
        that outlives its own trigger is a message nobody reads.
      */}
      {state.message !== "" ? (
        <p
          role="status"
          className={
            state.ok
              ? "text-sm font-bold text-safe-700"
              : "text-sm font-bold text-sos-600"
          }
        >
          {state.message}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" fullWidth disabled={pending}>
        {pending ? "Setting up…" : "Start monitoring this trip"}
      </Button>
    </form>
  );
};

export { JourneyCreateForm };
