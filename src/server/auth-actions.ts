"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth, issueLoginOtp, newOtpCode, signIn, signOut } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { assertNotThrottled, clearAuthFailures, consumeAuthAttempt } from "@/lib/auth-throttle";
import { isWatchtowerError, RateLimitError } from "@/lib/errors";
import { normalizeGhanaPhone } from "@/lib/phone";
import { addGuardianContact, listGuardianContacts } from "@/server/guardian-contacts";
import type { PermissionLevel } from "@/server/guardian-contacts";
import { sendSms } from "@/server/sms";
import {
  createUser,
  findUserByEmail,
  findUserById,
  findUserByPhone,
  hashPassword,
  passwordSchema,
} from "@/server/users";

/* -------------------------------------------------------------------------- */
/*                                   Results                                   */
/* -------------------------------------------------------------------------- */

export type ActionState =
  | { ok: true }
  | { ok: false; message: string; fieldErrors: Record<string, string> };

export type GuardianContactSummary = {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
  permissionLevel: PermissionLevel;
};

/** The circle step needs the refreshed list back so the UI cannot drift. */
export type GuardianCircleState =
  | { ok: true; contacts: readonly GuardianContactSummary[] }
  | { ok: false; message: string; fieldErrors: Record<string, string> };

export type CompletionState = { ok: true } | { ok: false; message: string };

const fail = (message: string, fieldErrors: Record<string, string> = {}): ActionState => ({
  ok: false,
  message,
  fieldErrors,
});

const circleFail = (message: string, fieldErrors: Record<string, string> = {}): GuardianCircleState => ({
  ok: false,
  message,
  fieldErrors,
});

/* -------------------------------------------------------------------------- */
/*                              Shared plumbing                                */
/* -------------------------------------------------------------------------- */

const text = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

type IssueDetail = { field: string; message: string };

const isIssueDetail = (value: unknown): value is IssueDetail =>
  typeof value === "object" &&
  value !== null &&
  "field" in value &&
  typeof value.field === "string" &&
  "message" in value &&
  typeof value.message === "string";

const fieldErrorsFrom = (error: z.ZodError): Record<string, string> => {
  const acc: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key.length > 0 && acc[key] === undefined) {
      acc[key] = issue.message;
    }
  }
  return acc;
};

/**
 * Turn a thrown `WatchtowerError` into a message plus per-field errors.
 *
 * `ConflictError` carries `details.field`; `addGuardianContact` carries a list
 * of `details.issues` instead. Both are mapped so the inline message lands next
 * to the input that caused it rather than at the top of the form.
 */
const describe = (cause: unknown): { message: string; fieldErrors: Record<string, string> } => {
  if (!isWatchtowerError(cause)) {
    return { message: "Something went wrong on our side. Try again in a moment.", fieldErrors: {} };
  }

  const fieldErrors: Record<string, string> = {};
  const direct = cause.details.field;
  if (typeof direct === "string") {
    fieldErrors[direct] = cause.message;
  } else {
    const raw = cause.details.issues;
    const entries: readonly unknown[] = Array.isArray(raw) ? raw : [];
    for (const entry of entries) {
      if (isIssueDetail(entry) && fieldErrors[entry.field] === undefined) {
        fieldErrors[entry.field] = entry.message;
      }
    }
  }

  return { message: cause.message, fieldErrors };
};

const logFields = (cause: unknown): Record<string, unknown> =>
  isWatchtowerError(cause)
    ? cause.toLogFields()
    : { cause: cause instanceof Error ? cause.message : String(cause) };

/**
 * `callbackUrl` arrives from the query string, which the middleware writes but
 * a stranger can also craft. `redirect()` follows absolute URLs, so anything
 * that is not a plain same-site path is discarded rather than trusted.
 */
const safeRedirectPath = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }
  return trimmed;
};

/** Same wording for every credential rejection, so nothing is disclosed. */
const WRONG_CREDENTIALS = "That email and password do not match an account. Check them and try again.";
const WRONG_CODE = "That code is not right. Check the text message and try again.";

type SignInOutcome = { ok: true; redirectTo: string } | { ok: false; message: string };

const isErrorRedirect = (target: string): boolean => {
  try {
    return new URL(target, "https://watchtower.invalid").searchParams.has("error");
  } catch (cause) {
    console.error("signIn returned an unparseable target", logFields(cause));
    return true;
  }
};

/**
 * Auth.js reports a rejected credentials sign-in as a redirect to
 * `pages.error?error=CredentialsSignin` rather than by throwing, so the only
 * way to keep the user on the form with an inline message is to run with
 * `redirect: false` and inspect the URL it hands back.
 */
const attemptSignIn = async (
  providerId: "email-password" | "phone-otp",
  credentials: Record<string, string>,
  callbackUrl: string,
  failureMessage: string,
): Promise<SignInOutcome> => {
  let target: unknown;
  try {
    target = await signIn(providerId, { ...credentials, redirectTo: callbackUrl, redirect: false });
  } catch (cause) {
    console.error("signIn threw", { providerId, ...logFields(cause) });
    return { ok: false, message: failureMessage };
  }

  if (typeof target !== "string") {
    console.error("signIn returned a non-URL result", { providerId });
    return { ok: false, message: failureMessage };
  }

  if (isErrorRedirect(target)) {
    return { ok: false, message: failureMessage };
  }

  return { ok: true, redirectTo: target };
};

/* -------------------------------------------------------------------------- */
/*                                  Sign up                                    */
/* -------------------------------------------------------------------------- */

/**
 * Exactly one of email / phone, decided from the submitted values rather than
 * from a client-supplied discriminator: a hidden field would be attacker
 * controlled, and the "which one did you mean" question has no safe answer
 * other than looking at what was actually typed.
 */
const signUpSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Tell us what to call you.")
      .max(120, "Keep your name under 120 characters."),
    email: z
      .string()
      .trim()
      .max(320, "That email address is too long.")
      .email("That does not look like an email address.")
      .or(z.literal(""))
      .optional(),
    phone: z.string().trim().max(20, "That phone number is too long.").optional(),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .superRefine((value, ctx) => {
    const hasEmail = (value.email ?? "").length > 0;
    const hasPhone = (value.phone ?? "").length > 0;

    if (hasEmail && hasPhone) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Use either an email address or a phone number, not both.",
      });
    } else if (!hasEmail && !hasPhone) {
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "Enter an email address or a Ghanaian phone number.",
      });
    }

    if (value.password !== value.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Those two passwords do not match.",
      });
    }
  });

export const signUpAction = async (
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> => {
  const parsed = signUpSchema.safeParse({
    name: text(formData, "name"),
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    password: text(formData, "password"),
    confirmPassword: text(formData, "confirmPassword"),
  });

  if (!parsed.success) {
    return fail("Check the highlighted fields and try again.", fieldErrorsFrom(parsed.error));
  }

  const { name, password } = parsed.data;
  const rawEmail = parsed.data.email ?? "";
  const rawPhone = parsed.data.phone ?? "";
  const email = rawEmail.length > 0 ? rawEmail.toLowerCase() : null;

  let phone: string | null;
  try {
    phone = rawPhone.length > 0 ? normalizeGhanaPhone(rawPhone, "phone") : null;
  } catch (cause) {
    const described = describe(cause);
    return fail(described.message, described.fieldErrors);
  }

  // `createUser` only checks for a taken identifier when it is given both an
  // email and a phone, so a single-identifier signup would fall through to the
  // database unique index and surface as an opaque 500. Check first and answer
  // with the same `ConflictError` shape the rest of the app uses.
  if (email !== null) {
    const taken = await findUserByEmail(db, email);
    if (taken[0] !== undefined) {
      const takenMessage = "An account already uses that email address.";
      return fail(takenMessage, { email: takenMessage });
    }
  }
  if (phone !== null) {
    const taken = await findUserByPhone(db, phone);
    if (taken[0] !== undefined) {
      const takenMessage = "An account already uses that phone number.";
      return fail(takenMessage, { phone: takenMessage });
    }
  }

  try {
    await createUser(db, {
      name,
      email,
      phone,
      passwordHash: await hashPassword(password),
    });
  } catch (cause) {
    const described = describe(cause);
    return fail(described.message, described.fieldErrors);
  }

  if (email === null || phone === null) {
    // A phone-only account has nothing for the email-password provider to match,
    // and calling it anyway would look like sign-up silently did nothing. Send
    // the person straight to the code step with their number pre-filled.
    const destination = phone === null ? "/sign-in" : `/sign-in?method=phone&phone=${encodeURIComponent(phone)}`;
    redirect(destination);
  }

  const outcome = await attemptSignIn(
    "email-password",
    { email, password },
    "/onboarding",
    WRONG_CREDENTIALS,
  );
  if (!outcome.ok) {
    return fail(outcome.message);
  }
  redirect(outcome.redirectTo);
};

/* -------------------------------------------------------------------------- */
/*                                 Sign in                                     */
/* -------------------------------------------------------------------------- */

const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .email("That does not look like an email address."),
  password: z.string().min(1, "Enter your password."),
});

export const signInWithPasswordAction = async (
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> => {
  const parsed = signInSchema.safeParse({
    email: text(formData, "email"),
    password: text(formData, "password"),
  });

  if (!parsed.success) {
    return fail("Check the highlighted fields and try again.", fieldErrorsFrom(parsed.error));
  }

  const email = parsed.data.email.toLowerCase();

  // Checked before the attempt so a locked-out person is told to wait rather
  // than being handed the generic wrong-credentials message, which is
  // indistinguishable from a typo and would send them round the same loop.
  try {
    await assertNotThrottled(db, "email", email);
  } catch (cause) {
    if (cause instanceof RateLimitError) {
      return fail(cause.message);
    }
    throw cause;
  }

  const outcome = await attemptSignIn(
    "email-password",
    { email, password: parsed.data.password },
    safeRedirectPath(text(formData, "callbackUrl")),
    WRONG_CREDENTIALS,
  );
  if (!outcome.ok) {
    return fail(outcome.message);
  }
  redirect(outcome.redirectTo);
};

/* -------------------------------------------------------------------------- */
/*                              Phone code sign in                             */
/* -------------------------------------------------------------------------- */

/**
 * Mint a login code and put it in front of the user by SMS — or deliberately
 * do nothing.
 *
 * This function must not leak whether an account exists, and must not leak the
 * code: a distinct error, a distinct latency, or a log the caller can act on
 * all turn this endpoint into an account-enumeration oracle. It throws only
 * `RateLimitError`, which is about the requester, not the account.
 */
export const deliverLoginCode = async (phone: string): Promise<void> => {
  await assertNotThrottled(db, "otp-request", phone);

  const found = await findUserByPhone(db, phone);
  const user = found[0];

  if (user === undefined) {
    // Nothing was sent and nothing was spent, so there is nothing to limit.
    // Counting it would also hand an attacker a way to lock a real person out
    // of their own account by guessing their number.
    return;
  }

  // Charged before the send, in one statement. This is a limit on how many
  // texts may be sent, so it is only reached after the account check above:
  // counting unknown numbers would be an account-existence oracle.
  await consumeAuthAttempt(db, "otp-request", phone, (minutes) =>
    `Too many codes requested. Wait ${minutes} minute(s) before asking for another.`,
  );

  const code = newOtpCode();
  try {
    await issueLoginOtp(user.id, phone, code);
    await sendSms(
      `Your Watchtower code is ${code}. It expires in 10 minutes. Do not share it.`,
      [phone],
    );
  } catch (cause) {
    // Logged with structured fields and never rethrown: the caller reports the
    // same success either way. The plaintext code is deliberately absent.
    console.error("login code delivery failed", { phone, ...logFields(cause) });
  }
};

const requestCodeSchema = z.object({
  phone: z.string().trim().min(1, "Enter your phone number."),
});

const codeVerificationSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the text message."),
});

export const requestPhoneCodeAction = async (
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> => {
  const parsed = requestCodeSchema.safeParse({ phone: text(formData, "phone") });
  if (!parsed.success) {
    return fail("Check the highlighted fields and try again.", fieldErrorsFrom(parsed.error));
  }

  let phone: string;
  try {
    phone = normalizeGhanaPhone(parsed.data.phone, "phone");
  } catch (cause) {
    const described = describe(cause);
    return fail(described.message, described.fieldErrors);
  }

  try {
    await deliverLoginCode(phone);
  } catch (cause) {
    if (cause instanceof RateLimitError) {
      return fail(cause.message);
    }
    console.error("login code request failed", { phone, ...logFields(cause) });
  }

  // Identical for a known number, an unknown number, and a failed send. Saying
  // anything else here would let anyone check whether a number has an account.
  return { ok: true };
};

export const signInWithPhoneCodeAction = async (
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> => {
  const parsed = codeVerificationSchema.safeParse({ code: text(formData, "code") });
  if (!parsed.success) {
    return fail("Check the highlighted fields and try again.", fieldErrorsFrom(parsed.error));
  }

  let phone: string;
  try {
    phone = normalizeGhanaPhone(text(formData, "phone"), "phone");
  } catch (cause) {
    const described = describe(cause);
    return fail(described.message, described.fieldErrors);
  }

  try {
    await assertNotThrottled(db, "phone", phone);
  } catch (cause) {
    if (cause instanceof RateLimitError) {
      return fail(cause.message);
    }
    throw cause;
  }

  const outcome = await attemptSignIn(
    "phone-otp",
    { phone, code: parsed.data.code },
    safeRedirectPath(text(formData, "callbackUrl")),
    WRONG_CODE,
  );
  if (!outcome.ok) {
    return fail(outcome.message);
  }

  await clearAuthFailures(db, "otp-request", phone);
  redirect(outcome.redirectTo);
};

/* -------------------------------------------------------------------------- */
/*                                  Sign out                                   */
/* -------------------------------------------------------------------------- */

export const signOutAction = async (): Promise<void> => {
  await signOut({ redirectTo: "/" });
};

/* -------------------------------------------------------------------------- */
/*                                 Onboarding                                  */
/* -------------------------------------------------------------------------- */

/**
 * The onboarding server actions live beside the auth ones because signup and
 * onboarding are one continuous funnel in this wave: every caller is a screen
 * reached from the sign-up redirect, and there is no second consumer that
 * would justify a separate module.
 */

const nameSchema = z
  .string()
  .trim()
  .min(1, "Tell us what to call you.")
  .max(120, "Keep your name under 120 characters.");

export const updateProfileNameAction = async (
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> => {
  const session = await auth();
  if (session === null) {
    return fail("Your session expired. Sign in again to continue.");
  }

  const parsed = nameSchema.safeParse(text(formData, "name"));
  if (!parsed.success) {
    return fail("Check the highlighted fields and try again.", fieldErrorsFrom(parsed.error));
  }

  const user = await findUserById(db, session.user.id);
  await db
    .update(users)
    .set({ name: parsed.data, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return { ok: true };
};

const summarize = (
  rows: Awaited<ReturnType<typeof listGuardianContacts>>,
): readonly GuardianContactSummary[] =>
  rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    relationship: row.relationship,
    permissionLevel: row.permissionLevel,
  }));

export const addGuardianContactAction = async (
  _prevState: GuardianCircleState,
  formData: FormData,
): Promise<GuardianCircleState> => {
  const session = await auth();
  if (session === null) {
    return circleFail("Your session expired. Sign in again to continue.");
  }

  try {
    await addGuardianContact(db, session.user.id, {
      name: text(formData, "name"),
      phone: text(formData, "phone"),
      relationship: text(formData, "relationship"),
      permissionLevel: text(formData, "permissionLevel"),
    });
  } catch (cause) {
    const described = describe(cause);
    if (isWatchtowerError(cause) && cause.code === "NOT_FOUND") {
      // `addGuardianContact` refuses to run without a phone on the account, so
      // an email-only signup cannot build a circle until one is on file.
      return circleFail(
        "We need your own phone number on file before a Guardian can be added. Add it from your profile, then come back here.",
        {},
      );
    }
    return circleFail(described.message, described.fieldErrors);
  }

  return { ok: true, contacts: summarize(await listGuardianContacts(db, session.user.id)) };
};

export const completeOnboardingAction = async (): Promise<CompletionState> => {
  const session = await auth();
  if (session === null) {
    redirect("/sign-in?callbackUrl=%2Fonboarding");
  }

  // An empty circle means a pressed SOS reaches nobody. Finishing anyway would
  // hand the person a false sense of being protected, so the gate lives on the
  // server as well as on the button.
  const contacts = await listGuardianContacts(db, session.user.id);
  if (contacts.length === 0) {
    return { ok: false, message: "Add at least one Guardian to your circle before you finish." };
  }

  await db
    .update(users)
    .set({ onboardingComplete: true, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));

  redirect("/");
};
