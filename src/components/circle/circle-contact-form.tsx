"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { permissionLevelDetails, permissionLevels, type PermissionLevel } from "@/lib/circle";
import { addCircleContactAction, type CircleActionState } from "@/server/circle-actions";

const initialState: CircleActionState = { ok: false, message: "" };

const fieldClass =
  "min-h-11 w-full rounded-card bg-ink-canvas px-3 text-body text-ink ring-1 ring-inset ring-ink/10";

const labelClass = "mb-1.5 block text-sm font-bold text-ink";

/**
 * Add someone to the Guardian Circle.
 *
 * The form resets itself after a successful add by keying on the contact count
 * from the server. Leaving the fields populated for a second person is the
 * common way these forms cause duplicate entries, and a duplicate guardian
 * means an SOS texts the same relative twice.
 */
const CircleContactForm = ({ contactCount }: { contactCount: number }) => {
  const [state, action, pending] = useActionState<CircleActionState, FormData>(
    addCircleContactAction,
    initialState,
  );

  return (
    <form action={action} className="flex flex-col gap-3" key={contactCount}>
      <div>
        <label className={labelClass} htmlFor="name">
          Their name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={120}
          autoComplete="off"
          placeholder="Ama Serwaa"
          className={fieldClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="phone">
          Their phone number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          required
          autoComplete="off"
          inputMode="tel"
          placeholder="024 400 0111"
          className={fieldClass}
        />
        <p className="mt-1 text-xs text-ink-faint">
          Used to send the alert. Ghana numbers only — 024, 020, 026, 027, 028, 054 or 059.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="relationship">
          Relationship <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <input
          id="relationship"
          name="relationship"
          type="text"
          maxLength={60}
          autoComplete="off"
          placeholder="Sister"
          className={fieldClass}
        />
      </div>

      <fieldset>
        <legend className={labelClass}>What they can see</legend>
        <div className="flex flex-col gap-2">
          {permissionLevels.map((level) => (
            <label
              key={level}
              className="flex cursor-pointer items-start gap-2.5 rounded-card bg-ink-canvas p-3 ring-1 ring-inset ring-ink/10"
            >
              <input
                type="radio"
                name="permissionLevel"
                value={level}
                defaultChecked={level === "emergency_only"}
                className="mt-0.5 size-4 shrink-0 accent-watchtower-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink">
                  {permissionLevelDetails[level].label}
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {permissionLevelDetails[level].description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          name="canViewGuardianCircle"
          className="mt-0.5 size-4 shrink-0 accent-watchtower-600"
        />
        <span className="min-w-0">
          <span className="block text-sm font-bold text-ink">Let them see my Guardian Circle</span>
          <span className="mt-0.5 block text-xs text-ink-muted">
            Off by default. Only turn this on for somebody you would trust with the names and
            numbers of your other guardians. It applies if they ever sign up with this number.
          </span>
        </span>
      </label>

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
        {pending ? "Adding…" : "Add to my circle"}
      </Button>
    </form>
  );
};

export { CircleContactForm };
export type { PermissionLevel };
