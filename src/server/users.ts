import { compare, hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/db";
import { userSettings, users } from "@/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { normalizeGhanaPhone } from "@/lib/phone";

/**
 * bcrypt work factor. Chosen so a verification costs real time on the server
 * while staying inside a serverless function's execution budget.
 */
const PASSWORD_ROUNDS = 12;

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(200, "That password is unexpectedly long.");

/**
 * Decoy used to keep "no such account" and "wrong password" indistinguishable
 * by response time. Without it, a wrong password returns in ~1ms while an
 * unknown email takes ~400ms of bcrypt, which is a free account-enumeration
 * oracle.
 */
let decoyHash: string | undefined;

export const burnPasswordCompare = async (password: string): Promise<void> => {
  decoyHash ??= await hash(`decoy-${password.length}-${password.charCodeAt(0) ?? 0}`, PASSWORD_ROUNDS);
  await compare(password, decoyHash);
};

export const hashPassword = (password: string): Promise<string> => hash(password, PASSWORD_ROUNDS);

export const verifyPassword = (password: string, passwordHash: string): Promise<boolean> =>
  compare(password, passwordHash);

export const findUserByEmail = (db: Database, email: string) =>
  db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);

export const findUserByPhone = (db: Database, phone: string) =>
  db.select().from(users).where(eq(users.phone, phone)).limit(1);

export const findUserById = async (db: Database, userId: string) => {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (user === undefined) {
    throw new NotFoundError("Account not found.", { userId });
  }
  return user;
};

export const createUser = async (
  db: Database,
  input: {
    name: string;
    email: string | null;
    phone: string | null;
    passwordHash: string;
  },
) => {
  if (input.email === null && input.phone === null) {
    throw new ValidationError("An email address or phone number is required to create an account.");
  }

  if (input.email !== null && input.phone !== null) {
    const emailTaken = await findUserByEmail(db, input.email);
    if (emailTaken[0] !== undefined) {
      throw new ConflictError("An account already uses that email address.", { field: "email" });
    }
    const phoneTaken = await findUserByPhone(db, input.phone);
    if (phoneTaken[0] !== undefined) {
      throw new ConflictError("An account already uses that phone number.", { field: "phone" });
    }
  }

  const inserted = await db
    .insert(users)
    .values({
      name: input.name,
      email: input.email === null ? null : input.email.toLowerCase(),
      phone: input.phone,
      passwordHash: input.passwordHash,
    })
    .returning();

  const user = inserted[0];
  if (user === undefined) {
    throw new Error("Insert returned no row; the user row should always be returned on conflict.");
  }
  return user;
};

/** Settings are created lazily on first read so signup stays a single insert. */
export const getOrCreateUserSettings = async (db: Database, userId: string) => {
  const existing = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const found = existing[0];
  if (found !== undefined) {
    return found;
  }

  const created = await db
    .insert(userSettings)
    .values({ userId })
    .onConflictDoNothing({ target: userSettings.userId })
    .returning();

  if (created[0] !== undefined) {
    return created[0];
  }

  // Lost the race with a concurrent first read; the other writer won.
  const retried = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const row = retried[0];
  if (row === undefined) {
    throw new Error("User settings row vanished between insert and re-read.");
  }
  return row;
};

export const normalizeUserPhone = (raw: string, fieldName: string): string =>
  normalizeGhanaPhone(raw, fieldName);
