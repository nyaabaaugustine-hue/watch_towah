"use client";

import { useActionState, useEffect, useRef } from "react";

import { FormErrorBanner, EMPTY_ACTION_STATE, FormField } from "@/components/auth/form-field";
import { WatchtowerMark } from "@/components/brand/watchtower-mark";
import { Button } from "@/components/ui/button";
import { updateProfileNameAction } from "@/server/auth-actions";

type OnboardingStepProfileProps = {
  initialName: string;
  onDone: () => void;
};

export const OnboardingStepProfile = ({ initialName, onDone }: OnboardingStepProfileProps) => {
  const [state, formAction, pending] = useActionState(updateProfileNameAction, EMPTY_ACTION_STATE);
  const advanced = useRef(false);

  useEffect(() => {
    // `updateProfileNameAction` deliberately does not redirect: the wizard owns
    // the step change so the person can go back and correct a name. The ref
    // keeps it to one advance per successful save, because `onDone` is a fresh
    // closure on every render of the parent.
    if (!state.ok) {
      advanced.current = false;
      return;
    }
    if (advanced.current) {
      return;
    }
    advanced.current = true;
    onDone();
  }, [state, onDone]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="flex items-center gap-4">
        {/*
          Placeholder avatar. A real upload needs signed Cloudinary credentials
          and a local offline copy in IndexedDB, and that arrives with the
          evidence-vault work — a plain <img> here would look finished while
          silently failing on the low-end Android this app is built for.
        */}
        <span
          aria-hidden
          className="grid size-16 shrink-0 place-items-center rounded-full bg-watchtower-50 ring-1 ring-watchtower-200"
        >
          <WatchtowerMark className="size-9" />
        </span>
        <p className="text-sm leading-relaxed text-ink-muted">
          This is how you will appear to the people in your circle. You can add a photo once photo
          upload is switched on.
        </p>
      </div>

      <FormErrorBanner message={state.ok ? undefined : state.message} />

      <FormField
        label="Your name"
        name="name"
        type="text"
        autoComplete="name"
        placeholder="Ama Serwaa"
        required
        defaultValue={initialName}
        hint="First name is enough. This is what a Guardian sees on the alert."
        error={state.ok ? undefined : state.fieldErrors.name}
      />

      <Button type="submit" size="lg" fullWidth disabled={pending}>
        {pending ? "Saving…" : "Save and continue"}
      </Button>
    </form>
  );
};
