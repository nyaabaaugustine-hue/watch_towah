import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Compose class names, letting later Tailwind utilities win over earlier ones.
 * Needed because a `cn` call that concatenated strings would emit conflicting
 * `px-*` / `bg-*` classes and let CSS order decide the result.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
