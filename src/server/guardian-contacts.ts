import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/db";
import { guardianContacts, users } from "@/db/schema";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { normalizeGhanaPhone } from "@/lib/phone";

/** Permission levels a Guardian Circle member can hold. Mirrors the pgEnum. */
export const permissionLevels = ["always_on", "scheduled", "emergency_only"] as const;
export type PermissionLevel = (typeof permissionLevels)[number];

export const permissionLevelSchema = z.enum(permissionLevels, {
  message: "Choose what this contact is allowed to see.",
});

export const guardianContactInputSchema = z.object({
  name: z.string().trim().min(1, "Enter their name.").max(120),
  phone: z.string().trim().min(1, "Enter their phone number."),
  relationship: z.string().trim().max(60).optional(),
  permissionLevel: permissionLevelSchema.default("emergency_only"),
  canViewGuardianCircle: z.boolean().default(false),
});

export type GuardianContactInput = z.infer<typeof guardianContactInputSchema>;

export const listGuardianContacts = (db: Database, userId: string) =>
  db
    .select()
    .from(guardianContacts)
    .where(eq(guardianContacts.userId, userId))
    .orderBy(asc(guardianContacts.createdAt));

/**
 * Load a contact, proving it belongs to `userId`.
 *
 * Every mutation goes through this rather than trusting a `contactId` from the
 * client. Without the ownership check, guessing another user's contact UUID
 * would let an attacker rename or delete a stranger's guardian.
 */
const loadOwnedContact = async (db: Database, userId: string, contactId: string) => {
  const rows = await db
    .select()
    .from(guardianContacts)
    .where(and(eq(guardianContacts.id, contactId), eq(guardianContacts.userId, userId)))
    .limit(1);

  const contact = rows[0];
  if (contact === undefined) {
    throw new NotFoundError("That contact is not in your Guardian Circle.", { contactId });
  }
  return contact;
};

export const addGuardianContact = async (
  db: Database,
  userId: string,
  rawInput: unknown,
): Promise<GuardianContactInput & { id: string }> => {
  const parsed = guardianContactInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError("Check the contact details and try again.", {
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const phone = normalizeGhanaPhone(parsed.data.phone, "phone");

  const ownPhone = await selfPhone(db, userId);
  if (ownPhone !== null && phone === normalizeGhanaPhoneGuard(ownPhone, "phone")) {
    throw new ValidationError("You cannot add yourself to your own Guardian Circle.", {
      field: "phone",
    });
  }

  const existing = await db
    .select({ id: guardianContacts.id })
    .from(guardianContacts)
    .where(and(eq(guardianContacts.userId, userId), eq(guardianContacts.phone, phone)))
    .limit(1);

  if (existing[0] !== undefined) {
    throw new ConflictError("That number is already in your Guardian Circle.", { field: "phone" });
  }

  const inserted = await db
    .insert(guardianContacts)
    .values({
      userId,
      name: parsed.data.name,
      phone,
      relationship: parsed.data.relationship ?? null,
      permissionLevel: parsed.data.permissionLevel,
      canViewGuardianCircle: parsed.data.canViewGuardianCircle,
    })
    .returning({ id: guardianContacts.id });

  const row = inserted[0];
  if (row === undefined) {
    throw new Error("Guardian contact insert returned no row.");
  }
  return { id: row.id, ...parsed.data, phone };
};

/**
 * The account's own phone, or null when it registered by email only.
 *
 * Returning null rather than throwing matters: the self-add guard below is a
 * convenience check, and a user who signed up with an email address only must
 * still be able to build a Guardian Circle during onboarding. Blocking them
 * there would leave SOS configured for nobody.
 */
const selfPhone = async (db: Database, userId: string): Promise<string | null> => {
  const rows = await db
    .select({ phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const phone = rows[0]?.phone;
  if (phone === undefined) {
    throw new NotFoundError("Your account could not be loaded.", { userId });
  }
  return phone;
};

/** Normalises without throwing, for comparison against an already-stored value. */
const normalizeGhanaPhoneGuard = (raw: string, fieldName: string): string => {
  try {
    return normalizeGhanaPhone(raw, fieldName);
  } catch {
    return raw;
  }
};

export const updateGuardianContact = async (
  db: Database,
  userId: string,
  contactId: string,
  rawPatch: unknown,
): Promise<void> => {
  await loadOwnedContact(db, userId, contactId);

  const parsed = guardianContactInputSchema.partial().safeParse(rawPatch);
  if (!parsed.success) {
    throw new ValidationError("Check the contact details and try again.", {
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const phone =
    parsed.data.phone === undefined ? undefined : normalizeGhanaPhone(parsed.data.phone, "phone");

  if (phone !== undefined) {
    // Exclude the row being edited, otherwise saving an unchanged phone number
    // collides with the contact's own current value.
    const clash = await db
      .select({ id: guardianContacts.id })
      .from(guardianContacts)
      .where(
        and(
          eq(guardianContacts.userId, userId),
          eq(guardianContacts.phone, phone),
          ne(guardianContacts.id, contactId),
        ),
      )
      .limit(1);

    if (clash[0] !== undefined) {
      throw new ConflictError("Another contact already uses that phone number.", {
        field: "phone",
      });
    }
  }

  await db
    .update(guardianContacts)
    .set({
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      ...(phone === undefined ? {} : { phone }),
      ...(parsed.data.relationship === undefined ? {} : { relationship: parsed.data.relationship }),
      ...(parsed.data.permissionLevel === undefined ? {} : { permissionLevel: parsed.data.permissionLevel }),
      ...(parsed.data.canViewGuardianCircle === undefined
        ? {}
        : { canViewGuardianCircle: parsed.data.canViewGuardianCircle }),
    })
    .where(eq(guardianContacts.id, contactId));
};

export const removeGuardianContact = async (
  db: Database,
  userId: string,
  contactId: string,
): Promise<void> => {
  await loadOwnedContact(db, userId, contactId);
  await db.delete(guardianContacts).where(eq(guardianContacts.id, contactId));
};

/**
 * Contacts that must be told about an emergency.
 *
 * Every member is included regardless of permission level: `emergency_only` is
 * a statement about routine tracking, not about being reachable in a crisis.
 * Excluding them would mean someone who opted into the least surveillance is
 * also the last to learn their relative is in danger, which is precisely
 * backwards.
 */
export const resolveEmergencyRecipients = (db: Database, userId: string) =>
  db
    .select({
      id: guardianContacts.id,
      name: guardianContacts.name,
      phone: guardianContacts.phone,
      contactUserId: guardianContacts.contactUserId,
      permissionLevel: guardianContacts.permissionLevel,
    })
    .from(guardianContacts)
    .where(eq(guardianContacts.userId, userId));

/** Recipients permitted to see routine (non-emergency) location updates. */
export const resolveRoutineViewers = async (db: Database, userId: string) => {
  const all = await resolveEmergencyRecipients(db, userId);
  return all.filter((contact) => contact.permissionLevel === "always_on");
};

export const assertContactBelongsToUser = async (
  db: Database,
  contactId: string,
  userId: string,
): Promise<void> => {
  const rows = await db
    .select({ userId: guardianContacts.userId })
    .from(guardianContacts)
    .where(eq(guardianContacts.id, contactId))
    .limit(1);

  const owner = rows[0];
  if (owner === undefined || owner.userId !== userId) {
    throw new AuthorizationError("That contact is not in your Guardian Circle.", { contactId });
  }
};

/**
 * Attach unlinked contact rows that carry this phone number to the account.
 *
 * A guardian is added by phone number long before they have a Watchtower
 * account, so without a claim step `guardian_contacts.contact_user_id` stayed
 * NULL forever. That is what made the whole in-app side of being a guardian
 * unreachable: `resolveViewerAccess` and the SOS acknowledgement guard both key
 * on it, so every guardian was permanently SMS-only and the push path in
 * `dispatchSosAlert` never ran for a real account.
 *
 * Claiming happens on a successful phone-code sign-in, which is the moment the
 * user has proved they control the number. The number is the credential, so
 * there is no separate invite token to lose.
 *
 * Deliberately scoped to rows this phone is the *contact* on. A row the user
 * owns themselves is skipped, so an account cannot claim its own contact row
 * and become a guardian of itself.
 *
 * @returns How many rows were linked.
 */
export const linkGuardianContactsForPhone = async (
  db: Database,
  phone: string,
  userId: string,
): Promise<number> => {
  const linked = await db
    .update(guardianContacts)
    .set({ contactUserId: userId, verifiedAt: new Date() })
    .where(
      and(
        eq(guardianContacts.phone, phone),
        isNull(guardianContacts.contactUserId),
        ne(guardianContacts.userId, userId),
      ),
    )
    .returning({ id: guardianContacts.id });

  return linked.length;
};
