"use client";

import { useActionState, useState } from "react";

import { FormErrorBanner, EMPTY_ACTION_STATE, FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { signUpAction } from "@/server/auth-actions";

type Identifier = "email" | "phone";

/**
 * Plain-English strength, no entropy maths. People pick a passphrase far more
 * often than they invent a random string, and telling someone "your password is
 * weak" without telling them what to do next just makes them add "1".
 */
const describeStrength = (value: string): { label: string; tone: "weak" | "fair" | "good" } => {
  if (value.length === 0) {
    return { label: "Use at least 8 characters.", tone: "weak" };
  }
  if (value.length < 8) {
    return { label: "Too short — 8 characters minimum.", tone: "weak" };
  }

  const varied = /[^A-Za-z0-9]/.test(value) || /[A-Z]/.test(value) || /[0-9]/.test(value);
  if (value.length >= 14) {
    return { label: "Strong. Keep it to yourself.", tone: "good" };
  }
  if (varied) {
    return { label: "Good. A few more characters would make it stronger.", tone: "good" };
  }
  return { label: "Fair — mix in a number or a capital letter.", tone: "fair" };
};

const toneClasses = {
  weak: "text-ink-faint",
  fair: "text-watchtower-700",
  good: "text-safe-700",
} as const;

export const SignUpForm = () => {
  const [state, formAction, pending] = useActionState(signUpAction, EMPTY_ACTION_STATE);
  const [identifier, setIdentifier] = useState<Identifier>("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  const strength = describeStrength(password);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormErrorBanner message={state.ok ? undefined : state.message} />

      <FormField
        label="Your name"
        name="name"
        type="text"
        autoComplete="name"
        inputMode="text"
        placeholder="Ama Serwaa"
        required
        error={state.ok ? undefined : state.fieldErrors.name}
      />

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-semibold text-ink">How should we reach you?</legend>
        <div className="grid grid-cols-2 gap-1 rounded-pill bg-ink-canvas p-1" role="group">
          {(["email", "phone"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setIdentifier(option);
                // Clearing the other field is what makes the pair mutually
                // exclusive; the server would reject both being filled anyway.
                if (option === "email") {
                  setPhone("");
                } else {
                  setEmail("");
                }
              }}
              aria-pressed={identifier === option}
              className={
                identifier === option
                  ? "min-h-11 rounded-pill bg-ink-surface font-display text-sm font-bold text-watchtower-800 shadow-card"
                  : "min-h-11 rounded-pill font-display text-sm font-bold text-ink-muted"
              }
            >
              {option === "email" ? "Email" : "Phone number"}
            </button>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-ink-faint">
          Pick one. A phone number is the one we can text a code to, which is why most people in Ghana
          choose it.
        </p>
      </fieldset>

      {identifier === "email" ? (
        <FormField
          label="Email address"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={state.ok ? undefined : state.fieldErrors.email}
        />
      ) : (
        <FormField
          label="Phone number"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="024 123 4567"
          required
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          hint="Any format is fine — 0241234567, +233 24 123 4567, and so on."
          error={state.ok ? undefined : state.fieldErrors.phone}
        />
      )}

      <FormField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        hint={<span className={toneClasses[strength.tone]}>{strength.label}</span>}
        error={state.ok ? undefined : state.fieldErrors.password}
      />

      <FormField
        label="Confirm password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        error={state.ok ? undefined : state.fieldErrors.confirmPassword}
      />

      <Button type="submit" size="lg" fullWidth disabled={pending}>
        {pending ? "Creating your account…" : "Create my account"}
      </Button>
    </form>
  );
};
