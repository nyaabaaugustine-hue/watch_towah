import type { Metadata } from "next";
import { LogOut, Settings2 } from "lucide-react";

import { auth } from "@/auth";
import { SettingsForm } from "@/components/settings/settings-form";
import { SignOutButton } from "@/components/settings/sign-out-button";
import { Card, CardHeader } from "@/components/ui/card";
import { db } from "@/db";
import { getOrCreateUserSettings } from "@/server/users";

export const metadata: Metadata = {
  title: "Settings",
  description: "Control how often Watchtower checks in, and how it alerts your circle.",
};

const SettingsPage = async () => {
  const session = await auth();
  if (session === null) {
    return null;
  }

  const settings = await getOrCreateUserSettings(db, session.user.id);

  return (
    <main className="safe-area-top flex flex-col gap-4 px-4">
      <header>
        <h1 className="font-display text-title text-ink">Settings</h1>
        <p className="mt-1 text-body text-ink-muted">
          Watchtower tries to be quiet and cheap. These are the dials for how often it talks to the
          network, and what happens when it cannot reach your guardians.
        </p>
      </header>

      <Card className="p-4">
        <CardHeader
          title="Your preferences"
          icon={<Settings2 className="size-5 text-watchtower-600" aria-hidden />}
          subtitle="Changes apply straight away."
        />
        <div className="mt-4">
          <SettingsForm
            lowDataMode={settings.lowDataMode}
            batterySaver={settings.batterySaver}
            backgroundIntervalSeconds={settings.backgroundIntervalSeconds}
            activeIntervalSeconds={settings.activeIntervalSeconds}
            smsFallbackEnabled={settings.smsFallbackEnabled}
            smsOnly={settings.smsOnly}
            shareLocationByDefault={settings.shareLocationByDefault}
            locationRetentionDays={settings.locationRetentionDays}
          />
        </div>
      </Card>

      <Card className="p-4">
        <CardHeader
          title="This account"
          icon={<LogOut className="size-5 text-watchtower-600" aria-hidden />}
          subtitle="Signing out also clears any locations still queued on this phone."
        />
        <div className="mt-4">
          <SignOutButton />
        </div>
      </Card>
    </main>
  );
};

export default SettingsPage;
