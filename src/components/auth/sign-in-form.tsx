"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";

import { FormErrorBanner, EMPTY_ACTION_STATE, FormField } from "@/components/auth/form-field";
import { PhoneCodeForm } from "@/components/auth/phone-code-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { signInWithPasswordAction } from "@/server/auth-actions";

type Method = "password" | "phone";

type SignInFormProps = {
  /** Written by the middleware when it bounces an anonymous visitor. */
  callbackUrl: string;
  initialMethod: Method;
  initialPhone: string;
};

const tabClass = (selected: boolean): string =>
  cn(
    "min-h-11 flex-1 rounded-pill font-display text-sm font-bold",
    selected ? "bg-ink-surface text-watchtower-800 shadow-card" : "text-ink-muted",
  );

export const SignInForm = ({ callbackUrl, initialMethod, initialPhone }: SignInFormProps) => {
  const [method, setMethod] = useState<Method>(initialMethod);
  const [state, formAction, pending] = useActionState(signInWithPasswordAction, EMPTY_ACTION_STATE);
  const baseId = useId();

  const tabIds = {
    password: `${baseId}-password`,
    phone: `${baseId}-phone`,
  } as const;

  return (
    <div>
      <div className="grid grid-cols-2 gap-1 rounded-pill bg-ink-canvas p-1" role="tablist" aria-label="Sign-in method">
        {(["password", "phone"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            id={tabIds[option]}
            aria-selected={method === option}
            aria-controls={`${tabIds[option]}-panel`}
            onClick={() => setMethod(option)}
            className={tabClass(method === option)}
          >
            {option === "password" ? "Password" : "Phone code"}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`${tabIds.password}-panel`}
        aria-labelledby={tabIds.password}
        hidden={method !== "password"}
        className="mt-5"
      >
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="callbackUrl" value={callbackUrl} />

          <FormErrorBanner message={state.ok ? undefined : state.message} />

          <FormField
            label="Email address"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            error={state.ok ? undefined : state.fieldErrors.email}
          />

          <FormField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            error={state.ok ? undefined : state.fieldErrors.password}
          />

          <Button type="submit" size="lg" fullWidth disabled={pending}>
            {pending ? "Signing you in…" : "Sign in"}
          </Button>
        </form>
      </div>

      <div
        role="tabpanel"
        id={`${tabIds.phone}-panel`}
        aria-labelledby={tabIds.phone}
        hidden={method !== "phone"}
        className="mt-5"
      >
        <PhoneCodeForm callbackUrl={callbackUrl} initialPhone={initialPhone} />
      </div>

      <p className="mt-6 text-center text-sm text-ink-muted">
        New to Watchtower?{" "}
        <Link
          href={`/sign-up?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="inline-flex min-h-11 items-center font-display font-bold text-watchtower-700 underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
};
