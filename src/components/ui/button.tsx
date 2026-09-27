import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "sos" | "safe";
type ButtonSize = "sm" | "md" | "lg";

/**
 * `sos` is intentionally not just a colour variant. It is the only variant that
 * may render in emergency red, and it forces a large minimum target — the
 * design system treats "this is the SOS button" as a structural fact rather
 * than a styling choice a caller can accidentally opt out of.
 */
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-gradient text-white shadow-card hover:brightness-110 active:brightness-95 disabled:opacity-50",
  secondary:
    "bg-watchtower-50 text-watchtower-800 ring-1 ring-inset ring-watchtower-200 hover:bg-watchtower-100 active:bg-watchtower-200 disabled:opacity-50",
  ghost: "bg-transparent text-ink-muted hover:bg-ink-canvas hover:text-ink active:bg-ink-canvas disabled:opacity-50",
  sos: "bg-sos-500 text-white shadow-sos hover:bg-sos-600 active:bg-sos-700 disabled:opacity-50",
  safe: "bg-safe-600 text-white shadow-card hover:bg-safe-700 active:bg-safe-800 disabled:opacity-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-sm rounded-pill",
  md: "min-h-11 px-5 text-[0.9375rem] rounded-pill",
  lg: "min-h-14 px-7 text-base rounded-pill",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
};

export const Button = ({
  className,
  variant = "primary",
  size = "md",
  fullWidth = false,
  type = "button",
  ...props
}: ButtonProps) => (
  <button
    type={type}
    className={cn(
      "inline-flex items-center justify-center gap-2 font-display font-bold tracking-tight",
      "transition duration-150 ease-spring disabled:cursor-not-allowed",
      variantClasses[variant],
      sizeClasses[size],
      fullWidth && "w-full",
      className,
    )}
    {...props}
  />
);
