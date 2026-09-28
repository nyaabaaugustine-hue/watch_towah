import { MessageSquare, Smartphone, UserPlus, Users } from "lucide-react";
import Link from "next/link";

import { Card, CardHeader } from "@/components/ui/card";

export type GuardianContactSummary = {
  id: string;
  name: string;
  relationship: string | null;
  /** Null when the contact has no Watchtower account and is reachable by SMS only. */
  contactUserId: string | null;
  permissionLevel: "always_on" | "scheduled" | "emergency_only";
};

type GuardianSummaryProps = {
  contacts: readonly GuardianContactSummary[];
};

const NAMED_CONTACT_LIMIT = 3;

/**
 * Who would actually be told.
 *
 * The app/SMS split is the point of this card. In Ghana most of a person's
 * circle is on a feature phone, so "3 people in your circle" is only real
 * information if you can see that one of them will be reached by text message
 * rather than by the app — a different channel, with a different failure mode.
 */
export const GuardianSummary = ({ contacts }: GuardianSummaryProps) => {
  const total = contacts.length;
  const withApp = contacts.filter((contact) => contact.contactUserId !== null).length;
  const smsOnly = total - withApp;
  const alwaysOn = contacts.filter((contact) => contact.permissionLevel === "always_on").length;
  const named = contacts.slice(0, NAMED_CONTACT_LIMIT);

  return (
    <Card className="p-4">
      <CardHeader
        title="Guardian Circle"
        icon={<Users className="size-5 text-watchtower-600" aria-hidden />}
        subtitle={
          total === 0
            ? "Nobody is in your circle yet."
            : `${total} ${total === 1 ? "person" : "people"} will be told if you press SOS.`
        }
        action={
          <Link
            href="/circle"
            className="inline-flex min-h-11 items-center text-sm font-bold text-watchtower-700"
          >
            Manage
          </Link>
        }
      />

      {total === 0 ? (
        <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-amber-800">
          <UserPlus className="mt-0.5 size-4 shrink-0" aria-hidden />
          Until you add someone, an SOS has nobody to send. A phone number is enough — they do not
          need the app.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-ink-muted">
            <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
              <Smartphone className="size-4" aria-hidden />
              {withApp} {withApp === 1 ? "person has" : "people have"} the app
            </span>
            {" · "}
            <span className="inline-flex items-center gap-1.5">
              <MessageSquare className="size-4" aria-hidden />
              {smsOnly} by SMS only
            </span>
          </p>

          <ul className="mt-3 space-y-1.5">
            {named.map((contact) => (
              <li key={contact.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-ink">
                  {contact.name}
                  {contact.relationship === null ? null : (
                    <span className="text-ink-faint"> · {contact.relationship}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs font-semibold text-ink-faint">
                  {contact.contactUserId === null ? "SMS" : "App"}
                  {contact.permissionLevel === "always_on" ? " · always on" : ""}
                </span>
              </li>
            ))}
            {total > NAMED_CONTACT_LIMIT ? (
              <li className="text-sm text-ink-faint">
                + {total - NAMED_CONTACT_LIMIT} more in your circle
              </li>
            ) : null}
          </ul>

          {alwaysOn > 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              {alwaysOn === 1
                ? "1 person is set to always be able to see your location."
                : `${alwaysOn} people are set to always be able to see your location.`}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
};
