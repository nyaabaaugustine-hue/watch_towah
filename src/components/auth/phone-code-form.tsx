"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { FormErrorBanner, EMPTY_ACTION_STATE, FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { requestPhoneCodeAction, signInWithPhoneCodeAction } from "@/server/auth-actions";

/**
 * Mirrors `OTP_TTL_MS` in `@/auth`, which cannot be imported here without
 * dragging the whole server auth config into the client bundle. If the server
 * TTL ever changes, this countdown must change with it.
 */
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;

const formatCountdown = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

type PhoneCodeFormProps = {
  callbackUrl: string;
  initialPhone: string;
};

export const PhoneCodeForm = ({ callbackUrl, initialPhone }: PhoneCodeFormProps) => {
  const [requestState, requestAction, requestPending] = useActionState(
    requestPhoneCodeAction,
    EMPTY_ACTION_STATE,
  );
  const [verifyState, verifyAction, verifyPending] = useActionState(
    signInWithPhoneCodeAction,
    EMPTY_ACTION_STATE,
  );

  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"request" | "verify">("request");
  const [issuedAt, setIssuedAt] = useState<number | null>(null);
  // Null until the first post-hydration tick so the server render and the
  // client render agree and React never reports a hydration mismatch.
  const [now, setNow] = useState<number | null>(null);
  const codePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (requestState.ok) {
      setStage("verify");
      setIssuedAt(Date.now());
    }
  }, [requestState]);

  useEffect(() => {
    if (stage !== "verify" || issuedAt === null) {
      return;
    }

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [stage, issuedAt]);

  useEffect(() => {
    if (stage !== "verify") {
      return;
    }
    // The code box is the only thing the person can do next, so the keyboard
    // goes straight there on a phone where typing is most of the effort.
    codePanelRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [stage]);

  const elapsed = issuedAt === null || now === null ? 0 : now - issuedAt;
  const expiresInSeconds = Math.max(0, Math.ceil((CODE_TTL_MS - elapsed) / 1000));
  const resendInSeconds = Math.max(0, Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000));
  const expired = issuedAt !== null && now !== null && expiresInSeconds === 0;

  if (stage === "verify") {
    const resendLabel = resendInSeconds > 0
      ? `Resend code in ${resendInSeconds}s`
      : requestPending
        ? "Resending…"
        : "Resend code";

    return (
      <div className="space-y-4">
        <FormErrorBanner message={verifyState.ok ? undefined : verifyState.message} />

        <div ref={codePanelRef}>
          <form action={verifyAction} className="space-y-4" noValidate>
            <input type="hidden" name="phone" value={phone} />
            <input type="hidden" name="callbackUrl" value={callbackUrl} />

            <div className="rounded-card bg-watchtower-50 px-3.5 py-3 text-sm text-watchtower-900">
              <p>
                We texted a 6-digit code to{" "}
                <span className="font-display font-bold tabular-nums">{phone}</span>.
              </p>
              <p className="mt-1 font-semibold text-watchtower-800">
                {expired
                  ? "That code has expired. Request a new one below."
                  : `It expires in ${formatCountdown(expiresInSeconds)}.`}
              </p>
            </div>

            <FormField
              label="6-digit code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]*"
              placeholder="000000"
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              error={verifyState.ok ? undefined : verifyState.fieldErrors.code}
            />

            <Button type="submit" size="lg" fullWidth disabled={verifyPending}>
              {verifyPending ? "Checking your code…" : "Sign in"}
            </Button>
          </form>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-1">
          <button
            type="button"
            className="min-h-11 px-1 text-sm font-semibold text-watchtower-700 underline"
            onClick={() => {
              setStage("request");
              setIssuedAt(null);
              setCode("");
            }}
          >
            Use a different number
          </button>
          <Button
            variant="ghost"
            size="md"
            disabled={resendInSeconds > 0 || requestPending}
            onClick={() => {
              const payload = new FormData();
              payload.set("phone", phone);
              requestAction(payload);
            }}
          >
            {resendLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={requestAction} className="space-y-4" noValidate>
      <FormErrorBanner message={requestState.ok ? undefined : requestState.message} />

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
        hint="We will text you a code. Standard message rates apply."
        error={requestState.ok ? undefined : requestState.fieldErrors.phone}
      />

      <Button type="submit" size="lg" fullWidth disabled={requestPending}>
        {requestPending ? "Sending your code…" : "Text me a code"}
      </Button>

      <p className="text-center text-xs leading-relaxed text-ink-faint">
        No account on that number? You get the same confirmation either way, so nobody can look up
        whether someone uses Watchtower.
      </p>
    </form>
  );
};
