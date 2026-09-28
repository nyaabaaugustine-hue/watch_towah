import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { WatchtowerMark } from "@/components/brand/watchtower-mark";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { db } from "@/db";
import { users } from "@/db/schema";
import { listGuardianContacts } from "@/server/guardian-contacts";

/**
 * Onboarding gate.
 *
 * The middleware already bounces anonymous visitors away from everything that is
 * not public, so the session check here is a second line rather than the only
 * one — and it is what lets this page be safe to link to directly.
 */
const OnboardingPage = async () => {
  const session = await auth();
  if (session === null) {
    redirect("/sign-in?callbackUrl=%2Fonboarding");
  }

  const rows = await db
    .select({ name: users.name, onboardingComplete: users.onboardingComplete })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const user = rows[0];
  if (user === undefined) {
    // A live session pointing at a row that no longer exists.
    redirect("/sign-in");
  }

  if (user.onboardingComplete) {
    redirect("/");
  }

  const contacts = await listGuardianContacts(db, session.user.id);

  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-ink-canvas">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-56 bg-brand-gradient" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-56 bg-gradient-to-b from-white/45 to-transparent"
      />

      <header className="safe-area-top flex flex-col items-center px-5 pt-8 text-center">
        <WatchtowerMark className="size-10" title="Watchtower" />
        <p className="mt-2 font-display text-sm font-bold tracking-wide text-white">
          Your Safety. Our Priority.
        </p>
      </header>

      <div className="flex flex-1 px-5 pb-10 pt-7">
        <OnboardingFlow
          initialName={user.name}
          initialContacts={contacts.map((contact) => ({
            id: contact.id,
            name: contact.name,
            phone: contact.phone,
            relationship: contact.relationship,
            permissionLevel: contact.permissionLevel,
          }))}
        />
      </div>
    </main>
  );
};

export default OnboardingPage;
