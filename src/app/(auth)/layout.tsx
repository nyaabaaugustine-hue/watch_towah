import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  /**
   * Nothing behind a sign-in or sign-up form should end up in a search index —
   * these are account pages, not content, and a cached copy of one could be
   * handed to the next person who searches for the URL.
   */
  robots: { index: false, follow: false },
};

/**
 * The auth screens are short and self-contained, so the sticky header and the
 * bottom nav that the app shell shows are both in the way here: the emergency
 * contact copy in the footer is the only chrome an auth screen needs.
 */
export const viewport: Viewport = {
  themeColor: "#4B0FA8",
};

/**
 * Auth screens live outside the `(app)` route group so they opt out of the
 * authenticated shell: no bottom nav, no dashboard chrome. The branded frame
 * that replaces it is `AuthShell`, and every page in this group renders one, so
 * the two screens cannot drift apart.
 */
const AuthLayout = ({ children }: { children: ReactNode }) => <>{children}</>;

export default AuthLayout;
