import type { NextAuthConfig } from "next-auth";

import { env } from "@/lib/env";

/**
 * Edge-safe half of the auth configuration.
 *
 * `middleware.ts` runs on the Edge runtime, which cannot bundle Node builtins
 * or the database driver. The credentials providers in `auth.ts` need
 * `bcryptjs`, Drizzle, and `node:crypto`, so this split exists to keep that
 * dependency graph out of the middleware bundle: middleware only needs to read
 * the JWT cookie, and the providers are never invoked there.
 *
 * `auth.ts` spreads this object and adds `providers`, so the two halves cannot
 * drift on session strategy, pages, or callbacks.
 */
export const authConfig = {
  secret: env.AUTH_SECRET,
  trustHost: true,
  // Credentials providers cannot use a database session, and a session row per
  // sign-in is wasteful on a metered connection anyway.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  // Populated by `auth.ts`. Empty here so the Edge bundle stays free of
    // bcrypt and Drizzle.
  providers: [],
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
} satisfies NextAuthConfig;
