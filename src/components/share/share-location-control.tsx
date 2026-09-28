"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, MapPin, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export type ShareTarget = {
  id: string;
  name: string;
  relationship: string | null;
};

type ActiveShare = {
  shareId: string;
  audience: "circle" | "public_link";
  label: string | null;
  startedAt: string;
  expiresAt: string | null;
};

type ShareLocationControlProps = {
  /** Circle members who can be granted access. */
  circle: ShareTarget[];
  lowDataMode?: boolean;
  onChanged?: () => void;
};

const DURATION_CHOICES = [
  { minutes: 15, label: "15 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 60 * 4, label: "4 hours" },
  { minutes: 60 * 24, label: "Until I stop it" },
] as const;

/**
 * Start and stop location sharing.
 *
 * The UI is built around one idea from the product's privacy rules: sharing is
 * something the owner starts and ends, never something a guardian can request.
 * So there is no "request location" affordance anywhere in here, and stopping is
 * always one tap away with no confirmation dialog — a confirmation step is
 * friction at exactly the moment someone is trying to stop being visible.
 */
export const ShareLocationControl = ({
  circle,
  lowDataMode,
  onChanged,
}: ShareLocationControlProps) => {
  const [shares, setShares] = useState<ActiveShare[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [publicLink, setPublicLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadShares = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/location/share", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as { shares: ActiveShare[] };
      setShares(body.shares);
    } catch (cause) {
      console.error("could not load active shares", { cause });
    }
  }, []);

  useEffect(() => {
    void loadShares();
  }, [loadShares]);

  const toggleContact = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const start = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/location/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          audience: "circle",
          guardianContactIds: [...selected],
          // The 24h choice is expressed by omitting the field, which the server
          // reads as "no expiry" rather than as a 24-hour countdown.
          ...(durationMinutes === 60 * 24 ? {} : { durationMinutes }),
        }),
      });

      const body = (await response.json()) as {
        error?: { message?: string };
      };

      if (!response.ok) {
        setMessage(body.error?.message ?? "Watchtower could not start sharing.");
        return;
      }

      setSelected(new Set());
      setMessage(
        selected.size === 1
          ? "Sharing with 1 person."
          : `Sharing with ${selected.size} people.`,
      );
      await loadShares();
      onChanged?.();
    } catch {
      setMessage("No connection. Your sharing setting was not changed.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async (shareId: string): Promise<void> => {
    setBusy(true);

    try {
      const response = await fetch("/api/location/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop", stopShareId: shareId }),
      });

      if (response.ok) {
        setPublicLink(null);
        setMessage("Sharing stopped.");
        await loadShares();
        onChanged?.();
      }
    } catch {
      setMessage("No connection. Try again to stop sharing.");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (): Promise<void> => {
    if (publicLink === null) {
      return;
    }

    const absolute = `${window.location.origin}/track/${publicLink}`;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage(absolute);
    }
  };

  return (
    <div className="space-y-4">
      {shares.map((share) => (
        <Card key={share.shareId} tone="brand" className="p-4">
          <CardHeader
            title="You are sharing your location"
            icon={<MapPin className="size-5 text-white" aria-hidden />}
            subtitle={
              share.expiresAt === null
                ? "Until you stop it"
                : `Until ${new Date(share.expiresAt).toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
            }
            action={
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void stop(share.shareId)}
              >
                Stop
              </Button>
            }
          />
        </Card>
      ))}

      <Card className="p-4">
        <CardHeader
          title="Share with your circle"
          icon={<Users className="size-5 text-watchtower-600" aria-hidden />}
          subtitle="Pick who can see where you are. They cannot request it."
        />

        {circle.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            Add someone to your Guardian Circle first.
          </p>
        ) : (
          <>
            <ul className="mt-3 space-y-1">
              {circle.map((person) => (
                <li key={person.id}>
                  <label
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-pill px-3",
                      "transition hover:bg-ink-canvas",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-5 accent-watchtower-600"
                      checked={selected.has(person.id)}
                      onChange={() => toggleContact(person.id)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-display text-body text-ink">
                        {person.name}
                      </span>
                      {person.relationship !== null && (
                        <span className="block text-xs text-ink-muted">
                          {person.relationship}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <fieldset className="mt-3">
              <legend className="text-sm font-semibold text-ink-muted">For how long?</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {DURATION_CHOICES.map((choice) => (
                  <button
                    key={choice.minutes}
                    type="button"
                    onClick={() => setDurationMinutes(choice.minutes)}
                    aria-pressed={durationMinutes === choice.minutes}
                    className={cn(
                      "min-h-9 rounded-pill px-3 text-sm font-semibold transition",
                      durationMinutes === choice.minutes
                        ? "bg-watchtower-600 text-white"
                        : "bg-watchtower-50 text-watchtower-800 ring-1 ring-watchtower-200",
                    )}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <Button
              className="mt-4"
              fullWidth
              disabled={busy || selected.size === 0}
              onClick={() => void start()}
            >
              {busy ? "Working…" : "Start sharing"}
            </Button>
          </>
        )}
      </Card>

      <Card className="p-4">
        <CardHeader
          title="Share by link"
          icon={<Link2 className="size-5 text-watchtower-600" aria-hidden />}
          subtitle="For someone not in Watchtower. The link stops working when you stop it."
        />

        {publicLink === null ? (
          <Button
            className="mt-3"
            variant="secondary"
            fullWidth
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void (async () => {
                try {
                  const response = await fetch("/api/location/share", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "start",
                      audience: "public_link",
                      guardianContactIds: [],
                    }),
                  });
                  const body = (await response.json()) as { shareToken?: string | null };
                  if (response.ok && typeof body.shareToken === "string") {
                    setPublicLink(body.shareToken);
                    await loadShares();
                  }
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Create a link
          </Button>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="truncate rounded-pill bg-ink-canvas px-3 py-2 text-sm text-ink-muted">
              {`${typeof window === "undefined" ? "" : window.location.origin}/track/${publicLink}`}
            </p>
            <Button variant="secondary" fullWidth onClick={() => void copyLink()}>
              <Copy className="size-4" aria-hidden />
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        )}
      </Card>

      {lowDataMode === true && (
        <p className="text-xs text-ink-muted">
          Low data mode is on, so the map uses a lighter style.
        </p>
      )}

      {message !== null && (
        <p role="status" className="text-sm text-ink-muted">
          {message}
        </p>
      )}
    </div>
  );
};
