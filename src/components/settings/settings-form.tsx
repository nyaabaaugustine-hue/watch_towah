"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import {
  MAX_ACTIVE_INTERVAL_SECONDS,
  MIN_BACKGROUND_INTERVAL_SECONDS,
  activeIntervalOptions,
  backgroundIntervalOptions,
  describeActiveInterval,
  describeBackgroundInterval,
  nearestOption,
  retentionOptions,
} from "@/lib/settings";
import { updateSettingsAction, type SettingsActionState } from "@/server/settings-actions";

const initialState: SettingsActionState = { ok: false, message: "" };

const selectClass =
  "min-h-11 w-full rounded-card bg-ink-canvas px-3 text-body text-ink ring-1 ring-inset ring-ink/10";

type ToggleProps = {
  name: string;
  title: string;
  description: string;
  defaultChecked: boolean;
};

/**
 * A switch built on a real checkbox.
 *
 * Not a styled `<div>` with a click handler: a checkbox is what makes the
 * control reachable by keyboard, announce itself as a checkbox, and submit an
 * unchecked box as *absent* from `FormData` — which is exactly the distinction
 * the settings action relies on to tell "off" from "left alone".
 */
const SettingToggle = ({ name, title, description, defaultChecked }: ToggleProps) => (
  <label className="flex cursor-pointer items-start gap-3 rounded-card bg-ink-canvas p-3 ring-1 ring-inset ring-ink/10">
    <input
      type="checkbox"
      name={name}
      defaultChecked={defaultChecked}
      className="peer sr-only"
    />
    <span
      aria-hidden
      className="relative mt-0.5 h-6 w-11 shrink-0 rounded-pill bg-ink/15 transition-colors peer-checked:bg-watchtower-600 peer-focus-visible:ring-2 peer-focus-visible:ring-watchtower-600 peer-focus-visible:ring-offset-2"
    >
      <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-card transition-transform peer-checked:translate-x-5" />
    </span>
    <span className="min-w-0">
      <span className="block text-sm font-bold text-ink">{title}</span>
      <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>
    </span>
  </label>
);

type SettingsFormProps = {
  lowDataMode: boolean;
  batterySaver: boolean;
  backgroundIntervalSeconds: number;
  activeIntervalSeconds: number;
  smsFallbackEnabled: boolean;
  smsOnly: boolean;
  shareLocationByDefault: boolean;
  locationRetentionDays: number;
};

/**
 * Keyed on the values themselves rather than on `updatedAt`: a save that changes
 * nothing still bumps `updatedAt`, and remounting on that would wipe a half
 * typed form for a no-op. Remounting on the values means the controls always
 * match what is stored, which is the only thing the user can actually observe.
 */
const settingsKey = (settings: SettingsFormProps): string =>
  [
    settings.lowDataMode,
    settings.batterySaver,
    settings.backgroundIntervalSeconds,
    settings.activeIntervalSeconds,
    settings.smsFallbackEnabled,
    settings.smsOnly,
    settings.shareLocationByDefault,
    settings.locationRetentionDays,
  ].join("|");

const SettingsForm = (props: SettingsFormProps) => {
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(
    updateSettingsAction,
    initialState,
  );

  return (
    <form action={action} className="flex flex-col gap-5" key={settingsKey(props)}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-display text-section text-ink">Data and battery</legend>
        <SettingToggle
          name="lowDataMode"
          title="Low data mode"
          description="Strips the map down to a plain style and shortens share windows. Recommended on metered connections."
          defaultChecked={props.lowDataMode}
        />
        <SettingToggle
          name="batterySaver"
          title="Battery saver"
          description="Caps how often Watchtower checks in while nothing is happening."
          defaultChecked={props.batterySaver}
        />
      </fieldset>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-ink" htmlFor="backgroundIntervalSeconds">
          Check-in frequency
        </label>
        <select
          id="backgroundIntervalSeconds"
          name="backgroundIntervalSeconds"
          defaultValue={nearestOption(backgroundIntervalOptions, props.backgroundIntervalSeconds)}
          className={selectClass}
        >
          {backgroundIntervalOptions.map((seconds) => (
            <option key={seconds} value={seconds}>
              {describeBackgroundInterval(seconds)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-faint">
          Anything faster than {MIN_BACKGROUND_INTERVAL_SECONDS} seconds costs data without making
          you safer.
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-ink" htmlFor="activeIntervalSeconds">
          Live alert frequency
        </label>
        <select
          id="activeIntervalSeconds"
          name="activeIntervalSeconds"
          defaultValue={nearestOption(activeIntervalOptions, props.activeIntervalSeconds)}
          className={selectClass}
        >
          {activeIntervalOptions.map((seconds) => (
            <option key={seconds} value={seconds}>
              {describeActiveInterval(seconds)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-faint">
          Used while an SOS or a journey is live. Faster than {MAX_ACTIVE_INTERVAL_SECONDS} seconds
          is not offered.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-display text-section text-ink">How you are alerted</legend>
        <SettingToggle
          name="smsFallbackEnabled"
          title="Send SMS when the app cannot reach someone"
          description="Strongly recommended. Data can be dead in an emergency; an SMS usually gets through."
          defaultChecked={props.smsFallbackEnabled}
        />
        <SettingToggle
          name="smsOnly"
          title="SMS only"
          description="Contact guardians by text message alone, with no app or web alert. Turning this on turns the SMS fallback off."
          defaultChecked={props.smsOnly}
        />
        <SettingToggle
          name="shareLocationByDefault"
          title="Start sharing as soon as I open Watchtower"
          description="Off by default. On means opening the app begins sharing your location with anyone set to always on."
          defaultChecked={props.shareLocationByDefault}
        />
      </fieldset>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-ink" htmlFor="locationRetentionDays">
          Keep my location history for
        </label>
        <select
          id="locationRetentionDays"
          name="locationRetentionDays"
          defaultValue={nearestOption(retentionOptions, props.locationRetentionDays)}
          className={selectClass}
        >
          {retentionOptions.map((days) => (
            <option key={days} value={days}>
              {days === 1 ? "1 day" : days === 365 ? "1 year" : `${days} days`}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-faint">
          Older pings are deleted automatically. Shorter is safer if the phone is ever lost.
        </p>
      </div>

      {state.message !== "" ? (
        <p
          role="status"
          className={
            state.ok ? "text-sm font-bold text-safe-700" : "text-sm font-bold text-sos-600"
          }
        >
          {state.message}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" fullWidth disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
};

export { SettingsForm };
