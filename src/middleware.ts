import { NextResponse } from "next/server";
import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

/**
 * Paths reachable without a session.
 *
 * `/track/*` is the SMS link a Guardian Circle opens while someone is in
 * danger. It cannot require a login — the whole point is that an anxious
 * relative can follow the link from a text message immediately, on someone
 * else's phone, with no account. Access is instead gated by an unguessable
 * share token, and that check lives in the data layer.
 */
const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/track"];

const isPublicPath = (pathname: string): boolean =>
  PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

/**
 * A middleware-local Auth.js instance built from the Edge-safe config only.
 * Importing the full `@/auth` here would drag bcrypt, Drizzle, and
 * `node:crypto` into the Edge bundle, which fails the build outright.
 */
const { auth } = NextAuth(authConfig);

export default auth((request) => {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (request.auth === null) {
    const signInUrl = new URL("/sign-in", request.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  /**
   * API routes are excluded on purpose: every route handler authenticates its
   * own caller, and a few (SSE streams, location ingest) need finer-grained
   * checks than "is there a session" anyway.
   *
   * Everything with a static file extension is excluded as well, rather than
   * naming each asset. Listing files individually is how `/icon-192.png` ended
   * up 307-redirecting to `/sign-in`: the old pattern excluded a path *segment*
   * called `icons`, which does not match an icon file sitting at the root. A
   * PWA whose manifest points at a manifest-guarded icon has a broken home
   * screen, and the service worker's precache of `/icon-192.png` would store a
   * redirect. Pages in this app have no extension, so this cannot over-match a
   * route, and any asset added to `public/` later is public by default.
   */
  matcher: [
    "/((?!api|_next/static|_next/image|offline|.*\\.(?:svg|png|jpe?g|gif|webp|avif|ico|webmanifest|js|mjs|css|map|txt|xml|json|woff2?)$).*)",
  ],
};
