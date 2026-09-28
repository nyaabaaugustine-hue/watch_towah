import type { ReactNode } from "react";

import { MoveRight } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

/**
 * `warning` is deliberately outside the Watchtower palette. The sos reds are
 * reserved for a live incident, so an overdue check-in — urgent, but with
 * nobody paged yet — must not spend that signal. Red here would train the user
 * to stop reading red as "someone has been told".
 */
const statusToneClasses = {
  neutral: "bg-ink-canvas text-ink-muted",
  brand: "bg-watchtower-50 text-watchtower-700",
  warning: "bg-amber-100 text-amber-800",
} as const;

export type QuickActionStatus = {
  label: string;
  tone: keyof typeof statusToneClasses;
};

type QuickActionCardProps = {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
  /** The live truth about this feature, or null when there is nothing to report. */
  status: QuickActionStatus | null;
};

/**
 * One destination, with whatever is true about it right now.
 *
 * The whole card is the tap target, which is what makes a 44px minimum
 * reachable with a thumb. The negative margin pulls the link over the card's
 * own padding rather than nesting a link inside padded content, so there is
 * still exactly one interactive element and one accessible name.
 */
export const QuickActionCard = ({ href, title, description, icon, status }: QuickActionCardProps) => (
  <Card className="p-4">
    <Link
      href={href}
      className="-m-4 flex min-h-14 items-center gap-3 p-4 focus-visible:rounded-card"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-watchtower-50 text-watchtower-700">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-section text-ink">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-muted">{description}</span>
        {status === null ? null : (
          <span
            className={cn(
              "mt-2 inline-block rounded-pill px-2.5 py-1 text-xs font-bold",
              statusToneClasses[status.tone],
            )}
          >
            {status.label}
          </span>
        )}
      </span>
      <MoveRight className="size-5 shrink-0 text-ink-faint" aria-hidden />
    </Link>
  </Card>
);
