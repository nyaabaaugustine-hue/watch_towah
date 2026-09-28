"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { isWatchtowerError } from "@/lib/errors";
import { permissionLevels } from "@/lib/circle";
import { requireUserId } from "@/server/session";
import {
  addGuardianContact,
  removeGuardianContact,
  updateGuardianContact,
} from "@/server/guardian-contacts";

export type CircleActionState = { ok: true; message: string } | { ok: false; message: string };

const permissionLevelSchema = z.enum(permissionLevels, {
  message: "Choose what this contact is allowed to see.",
});

const addSchema = z.object({
  name: z.string().trim().min(1, "Enter their name.").max(120),
  phone: z.string().trim().min(1, "Enter their phone number."),
  relationship: z.string().trim().max(60).optional(),
  permissionLevel: permissionLevelSchema.default("emergency_only"),
  canViewGuardianCircle: z.boolean().default(false),
});

/** A checkbox is absent from `FormData` entirely when it is unticked. */
const checked = (formData: FormData, name: string): boolean => formData.get(name) === "on";

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const contactIdFrom = (formData: FormData): string => text(formData, "contactId");

const toActionError = (error: unknown): CircleActionState => {
  if (isWatchtowerError(error)) {
    return { ok: false, message: error.message };
  }
  // As on the journey actions, the detail stays in the log: this string is
  // rendered on a phone held by somebody configuring the contacts who will
  // receive an SOS.
  console.error("[circle] action failed", error);
  return { ok: false, message: "Something went wrong. Please try again." };
};

export const addCircleContactAction = async (
  _prevState: CircleActionState,
  formData: FormData,
): Promise<CircleActionState> => {
  const userId = await requireUserId();

  const parsed = addSchema.safeParse({
    name: text(formData, "name"),
    phone: text(formData, "phone"),
    relationship: text(formData, "relationship") || undefined,
    permissionLevel: text(formData, "permissionLevel") || "emergency_only",
    canViewGuardianCircle: checked(formData, "canViewGuardianCircle"),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  }

  try {
    const added = await addGuardianContact(db, userId, {
      name: parsed.data.name,
      phone: parsed.data.phone,
      ...(parsed.data.relationship === undefined ? {} : { relationship: parsed.data.relationship }),
      permissionLevel: parsed.data.permissionLevel,
      canViewGuardianCircle: parsed.data.canViewGuardianCircle,
    });
    // Named rather than "Contact added": the name is the one thing worth
    // confirming, because the person is checking they added the right person.
    revalidatePath("/circle");
    revalidatePath("/");
    revalidatePath("/share");
    return { ok: true, message: `${added.name} will be told if you raise an SOS.` };
  } catch (error) {
    return toActionError(error);
  }
};

export const updateCircleContactAction = async (
  _prevState: CircleActionState,
  formData: FormData,
): Promise<CircleActionState> => {
  const userId = await requireUserId();
  const contactId = contactIdFrom(formData);

  if (contactId === "") {
    return { ok: false, message: "That contact could not be found." };
  }

  // A hidden `intent` field distinguishes "set this to false" from "leave it
  // alone". Without it, unticking `canViewGuardianCircle` would be read as an
  // absent key and silently ignored, which is the opposite of what the tap means.
  const intent = text(formData, "intent");
  const patch: Record<string, unknown> = {};
  if (intent === "permission" || intent === "full") {
    if (text(formData, "name") !== "") {
      patch.name = text(formData, "name");
    }
    if (text(formData, "phone") !== "") {
      patch.phone = text(formData, "phone");
    }
    if (text(formData, "relationship") !== "") {
      patch.relationship = text(formData, "relationship");
    }
    const level = text(formData, "permissionLevel");
    if (level !== "") {
      patch.permissionLevel = level;
    }
  }
  if (intent === "permission" || intent === "viewer") {
    patch.canViewGuardianCircle = checked(formData, "canViewGuardianCircle");
  }

  try {
    await updateGuardianContact(db, userId, contactId, patch);
    revalidatePath("/circle");
    revalidatePath("/");
    revalidatePath("/share");
    return { ok: true, message: "Guardian updated." };
  } catch (error) {
    return toActionError(error);
  }
};

/**
 * Remove a guardian.
 *
 * Worth spelling out why this is not reversible and is not hidden behind a
 * "are you sure": the list this edits is the set of people who get an SOS. An
 * accidental delete does not merely tidy a list, it can leave a user believing
 * somebody is watching out for them when nobody is.
 */
export const removeCircleContactAction = async (
  _prevState: CircleActionState,
  formData: FormData,
): Promise<CircleActionState> => {
  const userId = await requireUserId();
  const contactId = contactIdFrom(formData);

  if (contactId === "") {
    return { ok: false, message: "That contact could not be found." };
  }

  try {
    await removeGuardianContact(db, userId, contactId);
    revalidatePath("/circle");
    revalidatePath("/");
    revalidatePath("/share");
    return { ok: true, message: "Guardian removed. They will no longer be told about your SOS." };
  } catch (error) {
    return toActionError(error);
  }
};
