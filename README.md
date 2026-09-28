# Watchtower

A low-data personal-safety web app for Ghana. SOS alerting, live location
sharing, journey (dead-man) monitoring, and a Guardian Circle of people who get
contacted when something goes wrong.

Built as a PWA so it installs to a phone home screen and keeps working on a weak
connection.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router), React 19 |
| Language | TypeScript, strict |
| Database | Neon Postgres via Drizzle ORM |
| Auth | Auth.js v5, JWT sessions, email+password and phone OTP |
| Styling | Tailwind CSS |
| Push | Web Push (VAPID) |
| SMS | Africa's Talking |
| Maps | Mapbox GL JS |

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the placeholders
npm run db:push              # create the schema
npm run db:seed              # development data only
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The seed creates a development account: `amma@watchtower.test` /
`WatchtowerDev1!`. It is a fixed, published password, which is why `db:seed`
refuses to run against a remote database unless you set
`WATCHTOWER_ALLOW_SEED=1`.

## Environment

`src/lib/env.ts` validates every variable at boot and fails loudly rather than
starting a half-working app. `.env.example` is filled with placeholders that
satisfy that validation, so a fresh clone boots and individual features fail at
call time until you supply real credentials.

One trap worth knowing: to disable the optional `CRON_SECRET`, **delete the
line**, do not set it to `""`. An empty string is not "unset" as far as the schema
is concerned, so `CRON_SECRET=""` fails its minimum-length check and takes the
whole app down.

### Database URL

Use Neon's **pooled** URL (the one ending in `-pooler.<region>.aws.neon.tech`).
`src/db/index.ts` uses the `neon-http` driver, which expects the pooled
endpoint; pointing it at the direct connection is what exhausts a serverless
deployment's connection limit.

## Scheduled work

`/api/cron/dispatch-sos` runs one safety sweep. It pages guardians for journeys
nobody arrived for, retries alerts whose dispatch never completed, and deletes
expired location breadcrumbs, login codes, and stale throttle rows.

> **The schedule is a plan limitation, and it weakens the app's promises.**
> Vercel's Hobby plan allows cron jobs only once per day, so `vercel.json` is set
> to `0 3 * * *`. Two guarantees are consequently looser than the rest of the app
> suggests:
>
> - A journey nobody arrives for is escalated **up to 24 hours late**, not within
>   the grace period the dashboard displays.
> - Location breadcrumbs are deleted **up to 24 hours after** their
>   `retention_expires_at`. The deletion claim in the privacy copy is about rows
>   being *gone*; on this schedule they are gone late.
>
> On Pro, set the schedule to `*/15 * * * *` and both windows drop to 15 minutes.
> No code changes are needed — the sweep is already safe to run frequently
> because `dispatchSosAlert` claims each row with a single conditional UPDATE.

Because the window is wide on Hobby, the endpoint accepts a manually pasted
token so an operator can close the gap during a real incident instead of waiting
for 03:00.

Vercel calls it with `Authorization: Bearer $CRON_SECRET`. The route refuses to
run without that secret rather than exposing an endpoint that can page somebody's
family on demand. Local testing, and an out-of-band run in production:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/dispatch-sos
```

The scheme prefix is matched case-insensitively; a bare token with no scheme also
works. Anything else returns 403.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Fails: no test runner is configured yet |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:push` | Apply schema directly (development) |
| `npm run db:seed` | Seed development data |
| `npm run keygen:vapid` | Generate a Web Push key pair |
| `npm run verify:data` | Print the rows the UI's claims are derived from |

`npm test` deliberately exits non-zero. There is no test suite yet, and a script
that silently succeeds when it has checked nothing is worse than an honest
failure.

## Architecture notes

- **Server modules in `src/server/*` are the only writers.** Client components
  call actions and API routes; they never touch Drizzle.
- **SOS truth is `countNotifiedGuardians`.** It counts `alert_deliveries` rows
  with `status = 'sent'`. There is no `notified_at` column, and the UI does not
  imply otherwise.
- **State is derived, never computed in the browser from a stale copy.** A phone
  that has been offline for an hour must still show the truth, so every status is
  read from stored data.
- **Location pings are idempotent.** Each reading carries a device-generated
  `clientId` with a partial unique index, so a retry after a lost response
  returns the original row instead of writing a duplicate breadcrumb.
- **Retention is enforced in application code.** Location breadcrumbs carry a
  `retention_expires_at` deadline and are hard-deleted by the safety sweep. This
  used to depend on a `pg_cron` job in the initial migration that was never
  registered, which meant breadcrumbs were kept indefinitely.

## Status

Feature-complete enough to walk the primary flows: sign-up, Guardian Circle, SOS,
journeys, location sharing, and offline queueing.

Not finished, and not stubbed to look otherwise: Evidence Vault media handling,
Missing Person mode, incident timeline UI, safety zones UI, and guardian-side
circle viewing.

Real SMS, Web Push, and Mapbox delivery are untested because those credentials
are placeholders. Every delivery attempt against the seeded data currently fails
at the provider.
