"use client";

import { MapPin, Route, Settings, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

const destinations = [
  { href: "/", label: "Home", Icon: ShieldCheck },
  { href: "/journey", label: "Journey", Icon: Route },
  { href: "/share", label: "Share", Icon: MapPin },
  { href: "/circle", label: "Circle", Icon: Users },
  { href: "/settings", label: "Settings", Icon: Settings },
] as const;

type BottomNavProps = {
  /** Unread/missed counts rendered as a dot on the relevant tab. */
  alerts?: { journeys: number; circle: number };
};

export const BottomNav = ({ alerts }: BottomNavProps) => {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="safe-area-bottom sticky bottom-0 z-30 border-t border-ink/5 bg-ink-surface/95 backdrop-blur"
    >
      <ul className="flex items-stretch justify-around">
        {destinations.map(({ href, label, Icon }) => {
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const badge = href === "/journey" ? alerts?.journeys : href === "/circle" ? alerts?.circle : undefined;

          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2",
                  "text-[0.6875rem] font-bold transition-colors",
                  isActive ? "text-watchtower-800" : "text-ink-faint",
                )}
              >
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-4 top-0 h-0.5 rounded-b-full bg-brand-gradient"
                  />
                ) : null}
                <span className="relative">
                  <Icon className="size-5" aria-hidden />
                  {badge !== undefined && badge > 0 ? (
                    <span
                      className="absolute -right-1.5 -top-1 grid size-4 place-items-center rounded-full bg-sos-500 text-[0.5625rem] font-black text-white"
                      aria-label={`${badge} needing attention`}
                    >
                      {badge > 9 ? "9+" : badge}
                    </span>
                  ) : null}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
