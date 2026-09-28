import { and, eq, gt, isNull, sql } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { db } from "@/db";
import { otpCodes } from "@/db/schema";
import {
  clearAuthFailures,
  consumeAuthAttempt,
  hashesMatch,
  hashOtpCode,
  newOtpCode,
} from "@/lib/auth-throttle";
import { env } from "@/lib/env";
import { normalizeGhanaPhone } from "@/lib/phone";
import { linkGuardianContactsForPhone } from "@/server/guardian-contacts";
import { burnPasswordCompare, findUserByEmail, findUserByPhone, verifyPassword } from "@/server/users";

/** An unconsumed code is only good for this long. */
export const OTP_TTL_MS = 10 * 60 * 1000;

/**
 * Guesses tolerated against a single issued code.
 *
 * `otp_codes.attempts` is the per-code budget the schema documents. It used to
 * be read by the consume predicate but never written, so the test was always
 * `0 = 0` and the column enforced nothing. The phone-level throttle in
 * `consumeAuthAttempt` is a separate, coarser limit: it resets whenever a new
 * code is issued, so on its own it does not bound guesses against one code.
 */
const MAX_OTP_ATTEMPTS = 5;
const emailCredentialsSchema = z.object({
  email: z.string().min(1, "Enter your email address.").email("That does not look like an email address."),
  password: z.string().min(1, "Enter your password."),
});

const otpCredentialsSchema = z.object({
  phone: z.string().min(1, "Enter your phone number."),
  code: z.string().min(1, "Enter the code we sent you."),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.AUTH_SECRET,
  trustHost: true,
  // Credentials providers cannot use a database session, and we do not want a
  // session row per sign-in on a metered connection anyway.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  providers: [
    Credentials({
      id: "email-password",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = emailCredentialsSchema.safeParse(raw);
        if (!parsed.success) {
          return null;
        }

        const email = parsed.data.email.toLowerCase();
        // Charged before the comparison, not after a failure. Counting afterwards
        // let a parallel burst of submissions all pass the lockout check before
        // any of them recorded a failure.
        await consumeAuthAttempt(db, "email", email);

        const found = await findUserByEmail(db, email);
        const user = found[0];
        if (user === undefined || user.passwordHash === null) {
          // Spend the same work either way, so a missing account and a wrong
          // password take indistinguishable time.
          await burnPasswordCompare(parsed.data.password);
          return null;
        }

        const passwordOk = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!passwordOk) {
          return null;
        }

        await clearAuthFailures(db, "email", email);
        return { id: user.id, email: user.email, name: user.name, image: user.avatarUrl };
      },
    }),
    Credentials({
      id: "phone-otp",
      name: "Phone code",
      credentials: {
        phone: { label: "Phone", type: "tel" },
        code: { label: "Code", type: "text" },
      },
      authorize: async (raw) => {
        const parsed = otpCredentialsSchema.safeParse(raw);
        if (!parsed.success) {
          return null;
        }

        const phone = normalizeGhanaPhone(parsed.data.phone, "phone");
        const code = parsed.data.code.trim();
        await consumeAuthAttempt(db, "phone", phone);

        // The account is resolved from the phone rather than from a code-hash
        // match, because a guess has to be charged against the outstanding code
        // row and that row can only be found once the owner is known. An unknown
        // number returns null through exactly the same path as a wrong guess, so
        // this endpoint cannot be used to discover which numbers are registered.
        const found = await findUserByPhone(db, phone);
        const user = found[0];
        if (user === undefined) {
          return null;
        }

        const now = new Date();
        const [match] = await db
          .select({ id: otpCodes.id, codeHash: otpCodes.codeHash, attempts: otpCodes.attempts })
          .from(otpCodes)
          .where(
            and(
              eq(otpCodes.userId, user.id),
              eq(otpCodes.purpose, "login"),
              isNull(otpCodes.consumedAt),
              gt(otpCodes.expiresAt, now),
            ),
          )
          .limit(1);

        if (match === undefined || match.attempts >= MAX_OTP_ATTEMPTS) {
          return null;
        }

        if (!hashesMatch(match.codeHash, hashOtpCode(phone, "login", code))) {
          await db
            .update(otpCodes)
            .set({ attempts: sql`${otpCodes.attempts} + 1` })
            .where(and(eq(otpCodes.id, match.id), isNull(otpCodes.consumedAt)));
          return null;
        }

        // Burn the code inside the same statement that verifies it, so two
        // parallel requests with the same code cannot both succeed.
        const consumed = await db
          .update(otpCodes)
          .set({ consumedAt: now })
          .where(and(eq(otpCodes.id, match.id), isNull(otpCodes.consumedAt), eq(otpCodes.attempts, match.attempts)))
          .returning({ id: otpCodes.id });

        if (consumed.length === 0) {
          return null;
        }

        // A guardian is added by phone number long before they have an account,
        // so this is the moment their contact row gets a user to attach to.
        await linkGuardianContactsForPhone(db, phone, user.id);

        await clearAuthFailures(db, "phone", phone);
        return { id: user.id, email: user.email, name: user.name, image: user.avatarUrl };
      },
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user !== undefined) {
        token.userId = user.id;
      }
      return token;
    },
    session: ({ session, token }) => {
      if (token.userId !== undefined) {
        session.user.id = token.userId;
      }
      return session;
    },
  },
});

/**
 * Mint a login code and persist only its hash. The plaintext is handed back to
 * the caller for SMS delivery and is never written to disk or logs.
 *
 * The caller must resolve the user first: an unknown phone number must not
 * produce a row, and must not be distinguishable from a known one by the shape
 * of the response.
 */
export const issueLoginOtp = async (userId: string, phone: string, code: string): Promise<void> => {
  // Retire any outstanding codes so an intercepted earlier SMS stops working.
  await db
    .update(otpCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpCodes.userId, userId), eq(otpCodes.purpose, "login"), isNull(otpCodes.consumedAt)));

  await db.insert(otpCodes).values({
    userId,
    codeHash: hashOtpCode(phone, "login", code),
    purpose: "login",
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
};

export { newOtpCode };
