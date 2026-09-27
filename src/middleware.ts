import { NextResponse } from "next/server";

import { auth } from "@/auth";

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
   * checks than "is there a session" anyway. Static assets are excluded so the
   * service worker and manifest stay reachable while signed out.
   */
  matcher: ["/((?!api|_next/static|_next/image|icons|favicon.ico|manifest.webmanifest|sw.js|offline).*)"],
};
