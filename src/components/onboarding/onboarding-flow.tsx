"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { FormErrorBanner } from "@/components/auth/form-field";
import { OnboardingStepCircle } from "@/components/onboarding/step-circle";
import { OnboardingStepPermissions } from "@/components/onboarding/step-permissions";
import { OnboardingStepProfile } from "@/components/onboarding/step-profile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { CompletionState, GuardianContactSummary } from "@/server/auth-actions";
import { completeOnboardingAction } from "@/server/auth-actions";

const STEPS = [
  { index: 1, title: "Your profile", blurb: "What we should call you when something happens." },
  { index: 2, title: "Guardian Circle", blurb: "Who gets the alert when you press SOS." },
  { index: 3, title: "Permissions", blurb: "What your phone is allowed to do, and why." },
] as const;

const TOTAL_STEPS = 3;

type OnboardingFlowProps = {
  initialName: string;
  initialContacts: readonly GuardianContactSummary[];
};

export const OnboardingFlow = ({ initialName, initialContacts }: OnboardingFlowProps) => {
  const [step, setStep] = useState(1);
  const [contacts, setContacts] = useState<readonly GuardianContactSummary[]>(initialContacts);
  const [completeState, completeAction, completing] = useActionState<CompletionState, FormData>(
    completeOnboardingAction,
    { ok: false, message: "" },
  );

  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Moving focus to the new step heading is what stops a keyboard or
    // screen-reader user being left on a control that no longer exists, and it
    // is why the heading is focusable rather than the first input.
    headingRef.current?.focus();
  }, [step]);

  const current = STEPS.find((entry) => entry.index === step) ?? STEPS[0];

  return (
    <div className="mx-auto w-full max-w-md pb-10">
      <ol className="flex items-center gap-1.5" aria-label="Setup progress">
        {STEPS.map((entry) => (
          <li
            key={entry.index}
            aria-current={entry.index === step ? "step" : undefined}
            className={cn(
              "h-1.5 flex-1 rounded-pill",
              entry.index <= step ? "bg-brand-gradient" : "bg-watchtower-100",
            )}
          />
        ))}
      </ol>

      <p aria-live="polite" className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Step {current.index} of {TOTAL_STEPS}
      </p>

      <h1 ref={headingRef} tabIndex={-1} className="mt-1 font-display text-title text-ink outline-none">
        {current.title}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">{current.blurb}</p>

      <div className="mt-5">
        {step === 1 ? (
          <OnboardingStepProfile initialName={initialName} onDone={() => setStep(2)} />
        ) : null}
        {step === 2 ? (
          <OnboardingStepCircle
            contacts={contacts}
            onContactsChange={setContacts}
            onDone={() => setStep(3)}
          />
        ) : null}
        {step === 3 ? (
          <form action={completeAction} className="space-y-4">
            <OnboardingStepPermissions />
            <FormErrorBanner message={completeState.ok ? undefined : completeState.message} />
            <Button type="submit" size="lg" fullWidth disabled={completing}>
              {completing ? "Finishing setup…" : "Finish setup"}
            </Button>
            <p className="text-center text-xs leading-relaxed text-ink-faint">
              You can change any of this later from your profile and settings.
            </p>
          </form>
        ) : null}
      </div>

      {step === 1 ? null : (
        <div className="mt-6">
          <Button
            variant="ghost"
            size="md"
            fullWidth
            disabled={completing}
            onClick={() => setStep(step - 1)}
          >
            Back
          </Button>
        </div>
      )}
    </div>
  );
};
