"use client";

import { useCallback, useEffect, useState } from "react";

import { BatteryCharging, BellRing, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/** `prompt` means the browser is still willing to ask, which is not the same as
 * being able to ask right now. */
type Capability = "unknown" | "prompt" | "granted" | "denied" | "unsupported";

const capabilityCopy: Record<Capability, string> = {
  unknown: "Not checked yet",
  prompt: "Still off",
  granted: "On",
  denied: "Blocked in your browser settings",
  unsupported: "This browser cannot do this",
};

const fromPermissionState = (state: PermissionState): Capability => state;

/** `Notification.requestPermission()` can also answer "default", which the
 * Permissions API never returns; treat it as still-off rather than as a denial. */
const fromNotificationPermission = (value: NotificationPermission): Capability =>
  value === "granted" ? "granted" : value === "denied" ? "denied" : "prompt";

/** `PermissionStatus.prompt()` is Chromium-only and is absent from TypeScript's
 * lib.dom, so it is detected structurally rather than called blind. */
type PromptCapable = { prompt: () => Promise<PermissionStatus> };

const hasPromptMethod = (status: PermissionStatus): status is PermissionStatus & PromptCapable =>
  typeof (status as Partial<PromptCapable>).prompt === "function";

const queryPermission = async (name: PermissionName): Promise<PermissionStatus | null> => {
  if (!("permissions" in navigator)) {
    return null;
  }
  try {
    // Firefox and Safari throw a TypeError for permission names they do not
    // model, so "unsupported" has to be a normal outcome rather than a crash.
    return await navigator.permissions.query({ name });
  } catch (cause) {
    console.warn("permissions.query is not available for this permission", { name, cause: String(cause) });
    return null;
  }
};

/** One coarse fix is enough to flip the permission and costs almost nothing on a
 * metered connection; nothing is uploaded from here. */
const currentPositionOnce = (): Promise<GeolocationPosition> =>
  new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 15_000,
      maximumAge: 60_000,
    });
  });

const promptVia = async (queried: PermissionStatus | null): Promise<Capability | null> => {
  if (queried === null || !hasPromptMethod(queried)) {
    return null;
  }
  return fromPermissionState((await queried.prompt()).state);
};

const requestGeolocation = async (): Promise<Capability> => {
  if (!("geolocation" in navigator)) {
    return "unsupported";
  }

  const queried = await queryPermission("geolocation");
  const viaPermissions = await promptVia(queried);
  if (viaPermissions !== null) {
    return viaPermissions;
  }

  // The Permissions API cannot show a prompt on most browsers, so the real one
  // is used instead.
  try {
    await currentPositionOnce();
    return "granted";
  } catch (cause) {
    console.warn("geolocation prompt did not complete", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    const after = await queryPermission("geolocation");
    return after === null ? "denied" : fromPermissionState(after.state);
  }
};

const requestNotifications = async (): Promise<Capability> => {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }

  const queried = await queryPermission("notifications");
  const viaPermissions = await promptVia(queried);
  if (viaPermissions !== null) {
    return viaPermissions;
  }

  return fromNotificationPermission(await Notification.requestPermission());
};

type PermissionRowProps = {
  Icon: typeof MapPin;
  title: string;
  detail: string;
  capability: Capability;
  busy: boolean;
  onRequest: () => void;
};

const PermissionRow = ({ Icon, title, detail, capability, busy, onRequest }: PermissionRowProps) => {
  const settled =
    capability === "granted" || capability === "denied" || capability === "unsupported";

  return (
    <li className="rounded-card bg-ink-surface p-4 ring-1 ring-ink/5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-watchtower-50 text-watchtower-700">
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-section text-ink">{title}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">{detail}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p
          className={cn(
            "text-sm font-semibold",
            capability === "granted" ? "text-safe-700" : "text-ink-faint",
          )}
        >
          <span className="sr-only">{title}: </span>
          {capabilityCopy[capability]}
        </p>
        <Button
          type="button"
          size="md"
          variant={capability === "granted" ? "secondary" : "primary"}
          disabled={busy || settled}
          onClick={onRequest}
        >
          {busy ? "Asking your phone…" : capability === "granted" ? "Already on" : "Turn on"}
        </Button>
      </div>
    </li>
  );
};

export const OnboardingStepPermissions = () => {
  const [location, setLocation] = useState<Capability>("unknown");
  const [notifications, setNotifications] = useState<Capability>("unknown");
  const [askingLocation, setAskingLocation] = useState(false);
  const [askingNotifications, setAskingNotifications] = useState(false);

  const readCurrent = useCallback(async (name: PermissionName): Promise<Capability> => {
    const status = await queryPermission(name);
    if (status !== null) {
      return fromPermissionState(status.state);
    }
    if (name === "geolocation") {
      return "geolocation" in navigator ? "unknown" : "unsupported";
    }
    return typeof Notification === "undefined" ? "unsupported" : "unknown";
  }, []);

  const refresh = useCallback(async () => {
    const [loc, notif] = await Promise.all([
      readCurrent("geolocation"),
      readCurrent("notifications"),
    ]);
    setLocation(loc);
    setNotifications(notif);
  }, [readCurrent]);

  useEffect(() => {
    // Read the current state on arrival so someone who already granted location
    // is not asked a second time.
    void refresh();
  }, [refresh]);

  const askForLocation = () => {
    setAskingLocation(true);
    void requestGeolocation()
      .then(setLocation)
      .catch((cause: unknown) => {
        console.error("geolocation request failed", { cause: String(cause) });
        setLocation("denied");
      })
      .finally(() => setAskingLocation(false));
  };

  const askForNotifications = () => {
    setAskingNotifications(true);
    void requestNotifications()
      .then(setNotifications)
      .catch((cause: unknown) => {
        console.error("notification request failed", { cause: String(cause) });
        setNotifications("denied");
      })
      .finally(() => setAskingNotifications(false));
  };

  const missing = location !== "granted" || notifications !== "granted";

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-ink-muted">
        Watchtower asks your phone for two things. Turning either one on is optional — you can finish
        setup without them and change your mind later — but here is exactly what stops working if
        you do.
      </p>

      <ul className="space-y-3">
        <PermissionRow
          Icon={MapPin}
          title="Location"
          detail="Without this, live location and journey monitoring stay off, and an SOS can only send the last place your phone knew about."
          capability={location}
          busy={askingLocation}
          onRequest={askForLocation}
        />
        <PermissionRow
          Icon={BellRing}
          title="Alerts"
          detail="Without this, a Guardian with the app installed gets no push and only finds out if your SMS fallback also fails."
          capability={notifications}
          busy={askingNotifications}
          onRequest={askForNotifications}
        />
      </ul>

      <div className="flex items-start gap-2.5 rounded-card bg-safe-50 px-3.5 py-3 text-sm text-safe-800">
        <BatteryCharging aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="font-semibold">Your battery is the constraint.</span> Watchtower checks in
          every few minutes while nothing is happening and every few seconds only while an alert is
          live, so leaving it open all day costs far less than a music or navigation app. Low Data
          Mode shortens the windows further.
        </p>
      </div>

      {missing ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          You can finish without these. If location is blocked, the app will say so plainly wherever
          it would otherwise show a live map, rather than leaving a stale dot that looks current.
        </p>
      ) : null}
    </div>
  );
};
