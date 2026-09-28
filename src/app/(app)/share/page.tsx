import type { Metadata } from "next";
import { MapPin } from "lucide-react";

import { auth } from "@/auth";
import { Card, CardHeader } from "@/components/ui/card";
import { MapView, type MapMarker } from "@/components/map/map-view";
import { LocationWatch } from "@/components/location/location-watch";
import { ShareLocationControl, type ShareTarget } from "@/components/share/share-location-control";
import { db } from "@/db";
import { env } from "@/lib/env";
import { listGuardianContacts } from "@/server/guardian-contacts";
import { getLatestPing, getRecentPings } from "@/server/location";
import { getOrCreateUserSettings } from "@/server/users";

export const metadata: Metadata = {
  title: "Share location",
  description: "Let your Guardian Circle follow you for as long as you choose.",
};

const TRAIL_LENGTH = 40;

/**
 * Location sharing.
 *
 * A server component, so the Mapbox token is read here and handed down as a
 * prop. Reading it in the client would mean bundling the secret-validating env
 * module into the browser, which has none of those variables and would throw.
 */
const SharePage = async () => {
  const session = await auth();
  if (session === null) {
    return null;
  }

  const userId = session.user.id;

  const [settings, contacts, latest, trail] = await Promise.all([
    getOrCreateUserSettings(db, userId),
    listGuardianContacts(db, userId),
    getLatestPing(db, userId),
    getRecentPings(db, userId, TRAIL_LENGTH),
  ]);

  // Oldest first: the trail is drawn as a line and reversing it would connect
  // the points backwards.
  const trailMarkers: MapMarker[] = [...trail]
    .reverse()
    .map((ping) => ({ lat: ping.lat, lng: ping.lng, kind: "self" as const }));

  const ownMarkers: MapMarker[] =
    latest === null ? [] : [{ lat: latest.lat, lng: latest.lng, kind: "self" as const }];

  const circle: ShareTarget[] = contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    relationship: contact.relationship,
  }));

  return (
    <main className="safe-area-top flex flex-col gap-4 px-4">
      <header>
        <h1 className="font-display text-title text-ink">Share location</h1>
        <p className="mt-1 text-body text-ink-muted">
          You decide who can see where you are, and you can stop it at any time. Nobody
          can ask for your location.
        </p>
      </header>

      {/* Mounts the geolocation watcher and renders nothing itself. */}
      <LocationWatch
        baseSeconds={settings.backgroundIntervalSeconds}
        isUrgent={false}
      />

      <Card className="p-4">
        <CardHeader
          title="Where you are now"
          icon={<MapPin className="size-5 text-watchtower-600" aria-hidden />}
          subtitle={
            latest === null
              ? "Nothing recorded yet."
              : `Last recorded ${new Date(latest.recordedAt).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
          }
        />
        <MapView
          className="mt-3"
          accessToken={env.MAPBOX_ACCESS_TOKEN}
          markers={ownMarkers}
          trail={trailMarkers}
          lowDataMode={settings.lowDataMode}
          emptyMessage="Your location will appear here once your phone shares a position."
        />
      </Card>

      <ShareLocationControl circle={circle} lowDataMode={settings.lowDataMode} />
    </main>
  );
};

export default SharePage;
