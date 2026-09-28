/**
 * End-to-end login check against the running dev server.
 *
 * Exercises the real Auth.js credentials flow over HTTP rather than calling
 * internals, because the failure mode worth catching is a credential that the
 * database accepts but the HTTP layer rejects: wrong callback path, missing CSRF
 * token, or a session cookie that is issued but then bounces the user back to
 * /sign-in. A green `auth()` in a unit test misses all three.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SEED_EMAIL ?? "amma@watchtower.test";
const PASSWORD = process.env.SEED_PASSWORD ?? "WatchtowerDev1!";

let cookie = "";

const storeCookies = (response) => {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const entry of raw) {
    const pair = entry.split(";")[0];
    if (pair) cookie = cookie ? `${cookie}; ${pair}` : pair;
  }
};

const fail = (message) => {
  console.log(`FAILED: ${message}`);
  process.exitCode = 1;
};

// 1. CSRF token, which Auth.js requires on the credentials callback.
const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { redirect: "manual" });
storeCookies(csrfRes);
if (!csrfRes.ok) {
  fail(`GET /api/auth/csrf -> ${csrfRes.status}`);
  process.exit(1);
}
const { csrfToken } = await csrfRes.json();
if (!csrfToken) {
  fail("no csrfToken in response");
  process.exit(1);
}
console.log("1. csrf token acquired");

// 2. Submit credentials. The provider id is `email-password`, not the built-in
// `credentials`; posting to /callback/credentials yields error=Configuration.
const form = new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: `${BASE}/` });
const authRes = await fetch(`${BASE}/api/auth/callback/email-password`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", cookie },
  body: form,
  redirect: "manual",
});
storeCookies(authRes);
const location = authRes.headers.get("location") ?? "";
console.log(`2. credentials callback -> ${authRes.status} ${decodeURIComponent(location)}`);

if (location.includes("error=")) {
  fail(`auth rejected the login: ${decodeURIComponent(location)}`);
  process.exit(1);
}

if (!cookie.includes("authjs.session-token")) {
  fail(`no session cookie issued (cookie names: ${cookie.split("; ").map((c) => c.split("=")[0]).join(", ")})`);
  process.exit(1);
}
console.log("   session cookie issued");

// 3. The session must actually be valid server-side.
const sessionRes = await fetch(`${BASE}/api/auth/session`, { headers: { cookie } });
const session = await sessionRes.json();
if (!session?.user?.email) {
  fail(`session not resolved: ${JSON.stringify(session)}`);
  process.exit(1);
}
console.log(`3. session resolves user: ${session.user.email}`);

// 4. An authenticated request to a protected page must render, not redirect.
const pageRes = await fetch(`${BASE}/`, { headers: { cookie }, redirect: "manual" });
console.log(`4. GET / as signed-in user -> ${pageRes.status}`);
if (pageRes.status !== 200) {
  fail(`expected 200 on protected page, got ${pageRes.status}`);
  process.exit(1);
}

const html = await pageRes.text();
if (/Internal Server Error|Application error/i.test(html)) {
  fail("protected page rendered an error page");
  process.exit(1);
}

console.log(`   page bytes: ${html.length}`);
console.log(`   mentions user name: ${html.includes("Amma") || html.includes("Akosua")}`);
console.log("\nLOGIN OK");
