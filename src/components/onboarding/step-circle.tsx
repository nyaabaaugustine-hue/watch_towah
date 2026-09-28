"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { MessageSquareWarning, ShieldCheck, Users } from "lucide-react";

import { FormErrorBanner, FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { GuardianCircleState, GuardianContactSummary } from "@/server/auth-actions";
import type { PermissionLevel } from "@/server/guardian-contacts";
import { addGuardianContactAction } from "@/server/auth-actions";

const EMPTY_CIRCLE: GuardianCircleState = { ok: false, message: "", fieldErrors: {} };

/**
 * What each level actually means, in the words a person would use on a phone.
 * The names in the database are not shown: `always_on` says nothing about
 * whether the person is watching you at 2am.
 */
const permissionOptions = [
  {
    value: "always_on",
    label: "Always on",
    detail: "They can see where you are whenever you have the app open.",
  },
  {
    value: "scheduled",
    label: "Timed",
    detail: "They only see your location during the hours you set, like after 6pm every day.",
  },
  {
    value: "emergency_only",
    label: "Emergency only",
    detail: "They hear nothing until you press SOS. Safest if you would rather not be watched.",
  },
] as const;

const permissionLabel = (level: PermissionLevel): string =>
  permissionOptions.find((option) => option.value === level)?.label ?? "Emergency only";

type OnboardingStepCircleProps = {
  contacts: readonly GuardianContactSummary[];
  onContactsChange: (next: readonly GuardianContactSummary[]) => void;
  onDone: () => void;
};

export const OnboardingStepCircle = ({
  contacts,
  onContactsChange,
  onDone,
}: OnboardingStepCircleProps) => {
  const [state, formAction, pending] = useActionState(addGuardianContactAction, EMPTY_CIRCLE);
  const [permission, setPermission] = useState<PermissionLevel>("emergency_only");
  const applied = useRef<readonly GuardianContactSummary[] | null>(null);

  useEffect(() => {
    if (!state.ok) {
      applied.current = null;
      return;
    }
    // A ref rather than `state` alone, because the parent rebuilds
    // `onContactsChange` on every render and that must not re-fire the update.
    if (applied.current === state.contacts) {
      return;
    }
    applied.current = state.contacts;
    onContactsChange(state.contacts);
  }, [state, onContactsChange]);

  const empty = contacts.length === 0;
  // Remounting after a successful save is what clears the entry fields; without
  // it the previous contact's number is still in the box, and pressing the
  // button twice looks like a duplicate error rather than a second Guardian.
  const formKey = state.ok ? state.contacts.length : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5 rounded-card bg-watchtower-50 px-3.5 py-3 text-sm text-watchtower-900">
        <MessageSquareWarning aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p>
          Anyone you add is reached by SMS. If they have Watchtower installed they also get a push
          alert with a live map. If they do not, the text message is the whole alert — which is
          exactly how it keeps working during a network outage.
        </p>
      </div>

      {empty ? (
        <div className="flex items-start gap-2.5 rounded-card bg-safe-50 px-3.5 py-3 text-sm text-safe-800">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p className="font-medium">
            Add at least one person before you continue. An empty circle means a pressed SOS reaches
            nobody, which is worse than not having the app at all.
          </p>
        </div>
      ) : null}

      {empty ? null : (
        <ul className="space-y-2">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex items-center justify-between gap-3 rounded-card bg-ink-surface px-3.5 py-3 ring-1 ring-ink/5"
            >
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-bold text-ink">{contact.name}</p>
                <p className="truncate text-xs tabular-nums text-ink-muted">{contact.phone}</p>
              </div>
              <span className="shrink-0 rounded-pill bg-watchtower-50 px-2.5 py-1 text-xs font-semibold text-watchtower-800">
                {permissionLabel(contact.permissionLevel)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        key={formKey}
        action={formAction}
        className="space-y-4 rounded-card bg-ink-surface p-4 ring-1 ring-ink/5"
      >
        <h2 className="flex items-center gap-2 font-display text-section text-ink">
          <Users aria-hidden className="size-4 text-watchtower-600" />
          Add someone you trust
        </h2>

        <FormErrorBanner message={state.ok ? undefined : state.message} />

        <FormField
          label="Their name"
          name="name"
          type="text"
          autoComplete="off"
          placeholder="Kwame Mensah"
          required
          error={state.ok ? undefined : state.fieldErrors.name}
        />

        <FormField
          label="Their phone number"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="055 678 9012"
          required
          hint="Ghanaian mobile numbers only. This is the number we will text if you press SOS."
          error={state.ok ? undefined : state.fieldErrors.phone}
        />

        <FormField
          label="Relationship (optional)"
          name="relationship"
          type="text"
          autoComplete="off"
          placeholder="Brother, Sister, Landlord"
        />

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">What may they see?</legend>
          {permissionOptions.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-card px-3.5 py-2.5 ring-1",
                permission === option.value
                  ? "bg-watchtower-50 ring-watchtower-300"
                  : "ring-ink/10",
              )}
            >
              <input
                type="radio"
                name="permissionLevel"
                value={option.value}
                checked={permission === option.value}
                onChange={() => setPermission(option.value)}
                className="mt-0.5 size-5 shrink-0 accent-watchtower-600"
              />
              <span className="min-w-0">
                <span className="block font-display text-sm font-bold text-ink">{option.label}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-ink-muted">
                  {option.detail}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <Button type="submit" size="md" fullWidth disabled={pending}>
          {pending ? "Adding…" : "Add to my circle"}
        </Button>
      </form>

      <div className="space-y-2">
        <Button type="button" size="lg" fullWidth disabled={empty || pending} onClick={onDone}>
          Continue
        </Button>
        {empty ? (
          <p className="text-center text-xs text-ink-faint">
            Add one Guardian above to unlock the next step.
          </p>
        ) : null}
      </div>
    </div>
  );
};
