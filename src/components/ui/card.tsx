import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** `alert` draws the red hairline used on anything describing a live incident. */
  tone?: "neutral" | "brand" | "alert";
  as?: "div" | "section" | "article" | "li";
};

const toneClasses: Record<NonNullable<CardProps["tone"]>, string> = {
  neutral: "bg-ink-surface ring-1 ring-ink/5",
  brand: "bg-brand-gradient text-white shadow-lift",
  alert: "bg-sos-50 ring-1 ring-sos-200",
};

const Card = ({ className, tone = "neutral", as: Element = "div", ...props }: CardProps) => (
  <Element
    className={cn("rounded-card shadow-card", toneClasses[tone], className)}
    {...(props as HTMLAttributes<HTMLElement>)}
  />
);

type CardHeaderProps = {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

const CardHeader = ({ title, subtitle, icon, action, className }: CardHeaderProps) => (
  <div className={cn("flex items-start justify-between gap-3", className)}>
    <div className="flex min-w-0 items-start gap-2.5">
      {icon !== undefined ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0">
        <h3 className="font-display text-section text-ink">{title}</h3>
        {subtitle !== undefined ? <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p> : null}
      </div>
    </div>
    {action !== undefined ? <div className="shrink-0">{action}</div> : null}
  </div>
);

export { Card, CardHeader };
