"use client";

import { LogOut } from "lucide-react";
import { useTransition } from "react";

import { clearQueue } from "@/lib/offline-store";
import { signOutAction } from "@/server/auth-actions";

/**
 * Signs the user out and discards the offline location queue.
 *
 * Two things were wrong before this existed. `signOutAction` was written and
 * never referenced by any screen, so there was no way to sign out of the app at
 * all on a shared phone. And `clearQueue` was the only code that could discard
 * queued breadcrumbs, also unreferenced, which matters twice over: the queue is
 * stored in the browser and is not scoped to a user, so the next person to sign
 * in on this device would replay the previous user's unsent locations under
 * their own account.
 *
 * The queue is cleared in the browser before the session is destroyed, because
 * a server action cannot reach another origin's IndexedDB and a redirect would
 * tear the page down mid-write.
 */
export const SignOutButton = () => {
  const [pending, startTransition] = useTransition();

  const handleSignOut = (): void => {
    startTransition(async () => {
      await clearQueue();
      await signOutAction();
    });
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-card border border-ink-line px-4 py-3 text-sm font-bold text-ink transition-colors hover:bg-ink-5 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <LogOut className="size-4" aria-hidden />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
};
