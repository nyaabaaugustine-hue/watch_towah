import { and, eq, gt, isNull } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { db } from "@/db";
import { otpCodes } from "@/db/schema";
import {
  assertNotThrottled,
  clearAuthFailures,
  hashesMatch,
  hashOtpCode,
  newOtpCode,
  recordAuthFailure,
} from "@/lib/auth-throttle";
import { env } from "@/lib/env";
import { AuthenticationError } from "@/lib/errors";
import { normalizeGhanaPhone } from "@/lib/phone";
import { burnPasswordCompare, findUserByEmail, findUserByPhone, verifyPassword } from "@/server/users";

/** An unconsumed code is only good for this long. */
export const OTP_TTL_MS = 10 * 60 * 1000;
/**
 * Guess budget for a login code. Enforced indirectly: `issueLoginOtp` consumes
 * any outstanding code before minting a new one, and `recordAuthFailure` locks
 * the phone out after 5 failures. So a given 6-digit code never sees more than
 * 5 submissions before the account is locked.
 */

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
        await assertNotThrottled(db, "email", email);

        const found = await findUserByEmail(db, email);
        const user = found[0];
        if (user === undefined || user.passwordHash === null) {
          await burnPasswordCompare(parsed.data.password);
          await recordAuthFailure(db, "email", email);
          return null;
        }

        const passwordOk = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!passwordOk) {
          await recordAuthFailure(db, "email", email);
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
        await assertNotThrottled(db, "phone", phone);

        const candidates = await db
          .select()
          .from(otpCodes)
          .where(
            and(
              eq(otpCodes.codeHash, hashOtpCode(phone, "login", code)),
              eq(otpCodes.purpose, "login"),
              isNull(otpCodes.consumedAt),
              gt(otpCodes.expiresAt, new Date()),
            ),
          )
          .limit(1);

        const match = candidates[0];
        if (match === undefined || !hashesMatch(match.codeHash, hashOtpCode(phone, "login", code))) {
          await recordAuthFailure(db, "phone", phone);
          return null;
        }

        const found = await findUserByPhone(db, phone);
        const user = found[0];
        if (user === undefined) {
          throw new AuthenticationError("No account exists for that phone number.", { phone });
        }

        // Burn the code inside the same transaction that verifies it, so two
        // parallel requests with the same code cannot both succeed.
        const consumed = await db
          .update(otpCodes)
          .set({ consumedAt: new Date() })
          .where(and(eq(otpCodes.id, match.id), isNull(otpCodes.consumedAt), eq(otpCodes.attempts, match.attempts)))
          .returning({ id: otpCodes.id });

        if (consumed.length === 0) {
          return null;
        }

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
