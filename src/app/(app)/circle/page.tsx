import type { Metadata } from "next";
import { Users } from "lucide-react";

import { auth } from "@/auth";
import { CircleContactCard } from "@/components/circle/circle-contact-card";
import { CircleContactForm } from "@/components/circle/circle-contact-form";
import { Card, CardHeader } from "@/components/ui/card";
import { db } from "@/db";
import { seesRoutineLocation, type PermissionLevel } from "@/lib/circle";
import { listGuardianContacts } from "@/server/guardian-contacts";

export const metadata: Metadata = {
  title: "Guardian Circle",
  description: "The people Watchtower contacts if you raise an SOS.",
};

/**
 * A short, plain summary of who gets told.
 *
 * It sits above the list because the failure this page protects against is not
 * "forgot to add a contact" but "added two and thought three were covered". The
 * number of people an SOS would actually reach is the thing worth being able to
 * read at a glance.
 */
const CircleSummary = ({
  total,
  alwaysOn,
}: {
  total: number;
  alwaysOn: number;
}) => {
  if (total === 0) {
    return (
      <Card className="bg-sos-50 p-4 ring-sos-200" tone="alert">
        <p className="font-display text-section text-sos-700">Nobody is watching out for you yet</p>
        <p className="mt-1 text-sm text-ink-muted">
          An SOS with an empty Guardian Circle cannot tell anybody. Add at least one person below
          before you need it.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-baseline gap-2">
        <p className="font-display text-display text-ink">{total}</p>
        <p className="text-body text-ink-muted">
          {total === 1 ? "person would" : "people would"} be told if you raise an SOS
        </p>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        {alwaysOn > 0
          ? `${alwaysOn} of them ${alwaysOn === 1 ? "follows" : "follow"} your location while sharing is on.`
          : "None of them follow your location day to day — you stay private until you raise an SOS."}
      </p>
    </Card>
  );
};

const CirclePage = async () => {
  const session = await auth();
  if (session === null) {
    return null;
  }

  const userId = session.user.id;
  const contacts = await listGuardianContacts(db, userId);

  const alwaysOn = contacts.filter((contact) =>
    seesRoutineLocation(contact.permissionLevel as PermissionLevel),
  ).length;

  return (
    <main className="safe-area-top flex flex-col gap-4 px-4">
      <header>
        <h1 className="font-display text-title text-ink">Guardian Circle</h1>
        <p className="mt-1 text-body text-ink-muted">
          These are the people Watchtower contacts when you raise an SOS. Everyone here is
          emailed, messaged or called whatever their privacy setting says — the settings only
          control day-to-day location sharing.
        </p>
      </header>

      <CircleSummary total={contacts.length} alwaysOn={alwaysOn} />

      {contacts.length > 0 ? (
        <section aria-label="Your guardians" className="flex flex-col gap-3">
          <h2 className="font-display text-section text-ink">Your guardians</h2>
          <ul className="flex flex-col gap-3">
            {contacts.map((contact) => (
              <li key={contact.id}>
                <CircleContactCard
                  id={contact.id}
                  name={contact.name}
                  phone={contact.phone}
                  relationship={contact.relationship}
                  permissionLevel={contact.permissionLevel as PermissionLevel}
                  canViewGuardianCircle={contact.canViewGuardianCircle}
                  isSignedUp={contact.contactUserId !== null}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Card className="p-4">
        <CardHeader
          title={contacts.length > 0 ? "Add someone else" : "Add your first guardian"}
          icon={<Users className="size-5 text-watchtower-600" aria-hidden />}
          subtitle="Use a phone number they check. That is what the SMS falls back to."
        />
        <div className="mt-4">
          <CircleContactForm contactCount={contacts.length} />
        </div>
      </Card>
    </main>
  );
};

export default CirclePage;
