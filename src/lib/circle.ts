/**
 * Guardian Circle vocabulary shared by the server, the server components and the
 * client form.
 *
 * The canonical `permission_level` pgEnum lives in `src/db/schema.ts` and is
 * validated by `src/server/guardian-contacts.ts`. This module deliberately does
 * not re-export from either: `@/server/guardian-contacts` imports Drizzle, and
 * nothing server-side may reach the browser bundle, while `@/db/schema` pulls in
 * the same dependency chain. Declaring the union here — as
 * `src/components/dashboard/guardian-summary.tsx` already does — keeps the three
 * copies of this list the same literal, which is what stops them drifting.
 */

export const permissionLevels = ["always_on", "scheduled", "emergency_only"] as const;

export type PermissionLevel = (typeof permissionLevels)[number];

type PermissionLevelDetail = {
  label: string;
  description: string;
};

/**
 * `emergency_only` is the default, and the wording is chosen to make clear that
 * it does not mean "will be ignored in an emergency". A person reading this list
 * while setting up the one feature that pages their family must not be able to
 * mistake a privacy default for a reliability one.
 */
export const permissionLevelDetails: Record<PermissionLevel, PermissionLevelDetail> = {
  always_on: {
    label: "Always on",
    description: "Sees your location the whole time sharing is switched on.",
  },
  scheduled: {
    label: "Scheduled",
    description: "Only sees your location during times you set.",
  },
  emergency_only: {
    label: "Emergency only",
    description: "Sees nothing day to day, but is still contacted if you raise an SOS.",
  },
};

export const permissionLevelLabel = (level: PermissionLevel): string =>
  permissionLevelDetails[level].label;

/** Only `always_on` may see routine location; every level is reached for an SOS. */
export const seesRoutineLocation = (level: PermissionLevel): boolean => level === "always_on";
