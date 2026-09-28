"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";

import { CircleAlert, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import type { ActionState } from "@/server/auth-actions";
/**
 * Starting point for `useActionState`. Lives in a client module rather than
 * beside the actions because a `"use server"` file may only export async
 * functions, and every form needs the same empty shape.
 */
export const EMPTY_ACTION_STATE: ActionState = { ok: false, message: "", fieldErrors: {} };

/**
 * Form-level error. Used instead of an alert so the message is reachable by a
 * screen reader on render rather than only after a focus change.
 */
export const FormErrorBanner = ({ message }: { message: string | undefined }) => {
  if (message === undefined || message.length === 0) {
    return null;
  }

  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-card bg-red-50 px-3.5 py-3 text-sm font-medium text-red-700"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
};

type FormFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "id"> & {
  label: string;
  name: string;
  hint?: ReactNode;
  error?: string;
  /** True while the enclosing form's action is in flight. */
  pending?: boolean;
  /** Right-aligned control inside the input, e.g. a "change number" button. */
  trailing?: ReactNode;
  containerClassName?: string;
};

/**
 * The one labelled input used by every screen in this flow, so an error always
 * looks the same wherever it appears.
 *
 * Validation red deliberately comes from the base Tailwind scale rather than the
 * `sos-*` palette: the Watchtower system reserves that red for the emergency
 * affordance, and reusing it for a mistyped email would spend the signal on
 * something that is not an emergency.
 */
export const FormField = ({
  label,
  name,
  hint,
  error,
  pending = false,
  trailing,
  containerClassName,
  className,
  disabled,
  ...props
}: FormFieldProps) => {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((value): value is string => value !== null)
    .join(" ");

  return (
    <div className={cn("space-y-1.5", containerClassName)} aria-busy={pending}>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          {...props}
          id={id}
          name={name}
          disabled={disabled === true || pending}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy.length > 0 ? describedBy : undefined}
          className={cn(
            "min-h-11 w-full rounded-pill border-0 bg-ink-canvas px-4 text-base text-ink",
            "ring-1 ring-inset placeholder:text-ink-faint focus:ring-2",
            "disabled:cursor-not-allowed disabled:opacity-60",
            error === undefined ? "ring-ink/10 focus:ring-watchtower-500" : "ring-red-300 focus:ring-red-500",
            trailing === undefined ? null : "pr-16",
            className,
          )}
        />
        {pending ? (
          <Loader2
            aria-hidden
            className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-faint"
          />
        ) : trailing === undefined ? null : (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</div>
        )}
      </div>
      {hint === undefined ? null : (
        <p id={hintId} className="text-xs leading-relaxed text-ink-faint">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-red-700">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
};
