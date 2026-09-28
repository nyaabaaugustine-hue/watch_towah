import { Clock, LocateFixed, MapPin, TriangleAlert } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/card";
import { formatDistance } from "@/lib/geo";

const FRESH_MINUTES = 2;
const RECENT_MINUTES = 15;

const humaniseAge = (ageMinutes: number): string => {
  if (ageMinutes < 1) {
    return "less than a minute";
  }
  if (ageMinutes < 60) {
    return ageMinutes === 1 ? "1 minute" : `${ageMinutes} minutes`;
  }
  const hours = Math.floor(ageMinutes / 60);
  return hours === 1 ? "1 hour" : `${hours} hours`;
};

export type LastSeenPing = {
  lat: number;
  lng: number;
  /** Metres, or null when the device reported no accuracy figure. */
  accuracy: number | null;
  ageMinutes: number;
};

type LastSeenProps = {
  ping: LastSeenPing | null;
};

/**
 * The most recent position Watchtower holds for this person.
 *
 * The value of this card is entirely in its honesty about age and precision. A
 * stale fix presented without a timestamp is how a family ends up driving to
 * where someone was two hours ago, so both the age and the accuracy are on the
 * face of it, and an absent fix says plainly that there isn't one.
 */
export const LastSeen = ({ ping }: LastSeenProps) => {
  if (ping === null) {
    return (
      <Card className="p-4">
        <CardHeader
          title="Last known location"
          icon={<MapPin className="size-5 text-watchtower-600" aria-hidden />}
          subtitle="Watchtower has not recorded a position for you yet."
        />
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Location starts working once you allow it. Open Journey Monitoring or Share Location and
          your browser will ask — on a metered connection, granting it once is enough to keep it.
        </p>
      </Card>
    );
  }

  const fresh = ping.ageMinutes < FRESH_MINUTES;
  const recent = ping.ageMinutes < RECENT_MINUTES;

  return (
    <Card className="p-4">
      <CardHeader
        title="Last known location"
        icon={<MapPin className="size-5 text-watchtower-600" aria-hidden />}
        subtitle={fresh ? "Updated just now" : `Updated ${humaniseAge(ping.ageMinutes)} ago`}
        action={
          fresh ? (
            // Brand, not safe-*: a recent fix says the phone is reporting, not
            // that the person is protected.
            <span className="rounded-pill bg-watchtower-50 px-2.5 py-1 text-xs font-bold text-watchtower-700">
              Live
            </span>
          ) : recent ? null : (
            <span className="rounded-pill bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">
              Out of date
            </span>
          )
        }
      />

      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex items-center gap-2 text-ink-muted">
          <Clock className="size-4 shrink-0" aria-hidden />
          <dt className="sr-only">Age</dt>
          <dd>
            Last updated {humaniseAge(ping.ageMinutes)} ago
            {recent ? "" : " — anything shared now would be a guess"}
          </dd>
        </div>
        <div className="flex items-center gap-2 text-ink-muted">
          <LocateFixed className="size-4 shrink-0" aria-hidden />
          <dt className="sr-only">Accuracy</dt>
          <dd>
            {ping.accuracy === null
              ? "This phone did not report how accurate the fix was"
              : `Accurate to about ${formatDistance(ping.accuracy)}`}
          </dd>
        </div>
        <div className="flex items-center gap-2 text-ink-muted">
          <MapPin className="size-4 shrink-0" aria-hidden />
          <dt className="sr-only">Coordinates</dt>
          <dd className="tabular-nums">
            {ping.lat.toFixed(5)}, {ping.lng.toFixed(5)}
          </dd>
        </div>
      </dl>

      {!recent ? (
        <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-amber-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Start a journey or share your location to refresh this.
        </p>
      ) : null}
    </Card>
  );
};
