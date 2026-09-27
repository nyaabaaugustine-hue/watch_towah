import type { SVGProps } from "react";

import { cn } from "@/lib/cn";

type WatchtowerMarkProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** Accessible name. Omit for purely decorative instances. */
  title?: string;
};

/**
 * The Watchtower mark: a lookout tower inside a shield.
 *
 * Drawn inline rather than shipped as a raster or SVG asset so it inherits
 * `currentColor`, costs no extra request on a metered connection, and stays
 * crisp at the 96px the SOS header needs.
 */
export const WatchtowerMark = ({ className, title, ...props }: WatchtowerMarkProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={cn("size-8", className)}
    role={title === undefined ? "presentation" : "img"}
    aria-hidden={title === undefined ? true : undefined}
    {...props}
  >
    {title !== undefined ? <title>{title}</title> : null}
    <path
      d="M12 1.75 20.25 5.4V11c0 5.1-3.5 9.7-8.25 11.35C7.25 20.7 3.75 16.1 3.75 11V5.4L12 1.75Z"
      className="fill-watchtower-800"
    />
    {/* Watchtower roof */}
    <path d="M7.6 10.4 12 6.9l4.4 3.5H7.6Z" className="fill-white" />
    {/* Lantern room */}
    <rect x="9.1" y="10.4" width="5.8" height="2.1" rx="0.4" className="fill-ghana-gold" />
    {/* Tower shaft */}
    <rect x="9.9" y="12.5" width="4.2" height="4.3" rx="0.4" className="fill-white" />
    <rect x="11.2" y="13.5" width="1.6" height="1.5" rx="0.25" className="fill-watchtower-800" />
  </svg>
);
