import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { BottomNav } from "@/components/app/bottom-nav";
import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * Authenticated app shell.
 *
 * The session and onboarding gates live here rather than in each page so no
 * screen can be reached while signed out or half-onboarded by forgetting to
 * add a check. `auth()` reads the JWT, so this is a cookie read and not a
 * database round trip on every navigation.
 */
const AppLayout = async ({ children }: { children: React.ReactNode }) => {
  const session = await auth();
  if (session === null) {
    redirect("/sign-in");
  }

  const rows = await db
    .select({ onboardingComplete: users.onboardingComplete })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  // A valid session pointing at a deleted account: treat as signed out rather
  // than crashing every page with a foreign-key error.
  if (rows[0] === undefined) {
    redirect("/sign-in");
  }

  if (!rows[0].onboardingComplete) {
    redirect("/onboarding");
  }

  return (
    <div className="app-shell flex min-h-dvh flex-col">
      <div className="flex-1">{children}</div>
      <BottomNav />
    </div>
  );
};

export default AppLayout;
