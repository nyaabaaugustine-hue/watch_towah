import type { ReactNode } from "react";

import { WatchtowerMark } from "@/components/brand/watchtower-mark";
import { cn } from "@/lib/cn";

/**
 * The frame shared by sign-in and sign-up.
 *
 * Both screens run through one component so a change to the brand panel, the
 * tagline, or the reassurance line can never land on only one of them. The
 * panel is a blurred gradient rather than a photo: on a 2G connection a hero
 * image is the single most expensive thing on an auth screen, and nobody
 * chooses a safety app for its photography.
 */
type AuthShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Rendered under the card, e.g. the trust badges on sign-in. */
  aside?: ReactNode;
  className?: string;
};

export const AuthShell = ({ title, subtitle, children, aside, className }: AuthShellProps) => (
  <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-ink-canvas">
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-brand-gradient" />
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-gradient-to-b from-white/45 to-transparent"
    />
    <div
      aria-hidden
      className="pointer-events-none absolute -left-16 top-40 -z-10 size-64 rounded-full bg-watchtower-400/25 blur-3xl"
    />

    <div className="safe-area-top flex flex-col items-center px-5 pt-8 text-center">
      <WatchtowerMark className="size-11" title="Watchtower" />
      <p className="mt-3 font-display text-title text-white drop-shadow-sm">Watchtower</p>
      <p className="mt-1 font-display text-sm font-bold tracking-wide text-white/90">
        Your Safety. Our Priority.
      </p>
      <div className="ghana-rule mt-4 w-24" role="presentation" />
    </div>

    <div className={cn("flex flex-1 items-start px-5 pb-8 pt-8", className)}>
      <div className="mx-auto w-full max-w-md">
        <div className="rounded-card bg-ink-surface p-5 shadow-lift sm:p-6">
          <h1 className="font-display text-title text-ink">{title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
          <div className="mt-5">{children}</div>
        </div>
        {aside === undefined ? null : <div className="mt-6">{aside}</div>}
      </div>
    </div>

    <footer className="safe-area-bottom px-5 pb-6">
      <div className="mx-auto max-w-md rounded-card bg-watchtower-950/90 px-4 py-4 text-center">
        <p className="font-display text-sm font-bold text-white">
          In danger right now? Do not wait for the app.
        </p>
        <p className="mt-1 text-sm leading-relaxed text-watchtower-100">
          Call your Guardian Circle directly, or dial 112 from any phone in Ghana. Watchtower never
          stands between you and help.
        </p>
      </div>
    </footer>
  </main>
);
