import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";

import { WatchtowerMark } from "@/components/brand/watchtower-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "No connection",
  description: "You are offline. Your location is being recorded and will be sent when you reconnect.",
};

/**
 * The document the service worker serves when a navigation cannot reach the
 * network.
 *
 * It has to do three things honestly: say what is still working, say what is not
 * going to work, and not make a person wonder whether the app has broken. The
 * location queue in `lib/offline-store.ts` keeps recording breadcrumbs, so the
 * honest thing to say is that nothing has been lost — it just has not arrived yet.
 *
 * This page is public on purpose. A signed-out visitor with no connection still
 * deserves to see why the app will not load, rather than being bounced to a
 * sign-in form that cannot submit.
 */
const OfflinePage = () => (
  <main className="safe-area-top flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
    <WatchtowerMark className="size-12" title="Watchtower" />

    <div>
      <h1 className="font-display text-title text-ink">You are offline</h1>
      <p className="mt-2 text-body text-ink-muted">
        Watchtower needs a connection to reach your Guardian Circle. Your location is still
        being recorded on this phone and will be sent the moment you reconnect.
      </p>
    </div>

    <Card className="w-full max-w-sm p-4 text-left">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <WifiOff className="size-4 shrink-0 text-ink-muted" aria-hidden />
        While you are offline
      </p>
      <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
        <li>Location is saved on this phone and sent later.</li>
        <li>SOS will not reach anyone until you reconnect.</li>
        <li>Anything you have already written stays on the server.</li>
      </ul>
    </Card>

    <p className="max-w-xs text-xs text-ink-faint">
      If someone needs to reach you, call them directly. Do not rely on Watchtower to send
      an alert without a connection.
    </p>

    <Link href="/">
      <Button variant="secondary" fullWidth>
        Try again
      </Button>
    </Link>
  </main>
);

export default OfflinePage;
