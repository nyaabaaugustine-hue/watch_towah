import { BatteryCharging, CloudOff, Lock, Zap } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * The four product promises, stated as verifiable claims rather than
 * marketing adjectives.
 *
 * Copy rule for this file: a badge may only make a claim the code actually
 * keeps. Hence "Private by default" and not "end-to-end encrypted" — location
 * pings are encrypted in transit and at rest but do transit our server, and a
 * safety app that overstates its guarantees is worse than one that does not.
 */
const badges = [
  {
    id: "low-data",
    Icon: Zap,
    label: "Light on data",
    detail: "Low-data mode strips map detail and shortens update windows.",
  },
  {
    id: "battery",
    Icon: BatteryCharging,
    label: "Battery-friendly",
    detail: "Adaptive polling: seconds while an alert is live, minutes at rest.",
  },
  {
    id: "privacy",
    Icon: Lock,
    label: "Private by default",
    detail: "You choose who sees what, and location history expires on a timer.",
  },
  {
    id: "offline",
    Icon: CloudOff,
    label: "Works offline",
    detail: "Queues alerts locally and falls back to SMS when data is gone.",
  },
] as const;

type TrustBadgeId = (typeof badges)[number]["id"];

type TrustBadgesProps = {
  /** Show only these badges. Defaults to all four. */
  only?: readonly TrustBadgeId[];
  variant?: "row" | "grid" | "list";
  className?: string;
};

export const TrustBadges = ({ only, variant = "row", className }: TrustBadgesProps) => {
  const shown = only === undefined ? badges : badges.filter((badge) => only.includes(badge.id));

  if (variant === "grid") {
    return (
      <ul className={cn("grid grid-cols-2 gap-2", className)}>
        {shown.map(({ id, Icon, label }) => (
          <li
            key={id}
            className="flex items-center gap-2 rounded-pill bg-ink-surface/90 px-3 py-2 text-xs font-semibold text-ink-muted ring-1 ring-ink/5"
          >
            <Icon className="size-4 shrink-0 text-watchtower-600" aria-hidden />
            {label}
          </li>
        ))}
      </ul>
    );
  }

  if (variant === "list") {
    return (
      <ul className={cn("space-y-3", className)}>
        {shown.map(({ id, Icon, label, detail }) => (
          <li key={id} className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-safe-50 text-safe-700">
              <Icon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-display text-sm font-bold text-ink">{label}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{detail}</p>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className={cn("flex flex-wrap items-center justify-center gap-x-4 gap-y-2", className)}>
      {shown.map(({ id, Icon, label }) => (
        <li key={id} className="flex items-center gap-1.5 text-xs font-semibold text-ink-faint">
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  );
};
