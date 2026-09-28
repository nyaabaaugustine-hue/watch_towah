/**
 * Development-only seed. Creates one known account plus enough related rows for
 * the dashboard, Guardian Circle and journey cards to render real data instead
 * of empty states.
 *
 * This is deliberately a separate script rather than app code: nothing in the
 * running application imports it, so a fixed password can never reach
 * production. It refuses to run against a placeholder DATABASE_URL, and it is
 * idempotent by deleting the dev user first and leaning on ON DELETE CASCADE.
 *
 * Usage: npm run db:seed
 */
import { eq } from "drizzle-orm";
import { hash } from "bcryptjs";

import { db } from "@/db";
import { guardianContacts, journeys, locationPings, userSettings, users } from "@/db/schema";
import { env } from "@/lib/env";

const DEV_EMAIL = "amma@watchtower.test";
const DEV_PASSWORD = "WatchtowerDev1!";
const DEV_PHONE = "+233244000111";
const DEV_NAME = "Ama Serwaa";

/** Accra city centre, used as the origin for the seeded breadcrumb trail. */
const ACCRA_LAT = 5.6037;
const ACCRA_LNG = -0.187;

const PLACEHOLDER_MARKERS = ["placeholder", "localhost", "127.0.0.1"];

/**
 * Refuse to seed anything that is not plainly a development database.
 *
 * The old check only rejected URLs containing "placeholder", "localhost" or
 * "127.0.0.1". A real Neon production URL contains none of those, so
 * `npm run db:seed` would happily create an account with the published
 * password `WatchtowerDev1!` against production data. The names in this project
 * all end in `.test`, so the guard keys on the host instead: only a loopback
 * host or an explicit opt-in may be seeded.
 */
const assertUsableDatabase = (): void => {
  const url = env.DATABASE_URL.toLowerCase();
  const looksFake = PLACEHOLDER_MARKERS.some((marker) => url.includes(marker));
  if (looksFake) {
    throw new Error(
      "DATABASE_URL still looks like a placeholder. Put your real Neon connection\n" +
        "string in .env.local before seeding, or this will create nothing.",
    );
  }

  if (process.env.WATCHTOWER_ALLOW_SEED === "1") {
    return;
  }

  let hostname: string;
  try {
    hostname = new URL(env.DATABASE_URL).hostname;
  } catch {
    throw new Error("DATABASE_URL could not be parsed, so it cannot be checked for safety.");
  }

  const isLoopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local");

  if (!isLoopback) {
    throw new Error(
      `Refusing to seed ${hostname}.\n\n` +
        "This script creates an account with a known password. It is only allowed\n" +
        "against a local database. For a remote development database, re-run with\n" +
        "WATCHTOWER_ALLOW_SEED=1 once you are certain it holds no real data.",
    );
  }
};

const main = async (): Promise<void> => {
  assertUsableDatabase();

  console.log("Seeding Watchtower development data...");
  console.log(`  target: ${env.DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);

  // Cascade clears settings, contacts, pings and journeys for this user, so
  // re-running the script never accumulates duplicates.
  await db.delete(users).where(eq(users.email, DEV_EMAIL));

  const [user] = await db
    .insert(users)
    .values({
      name: DEV_NAME,
      email: DEV_EMAIL,
      phone: DEV_PHONE,
      // Same cost the sign-up path uses, so the hash is not distinguishable.
      passwordHash: await hash(DEV_PASSWORD, 12),
      // Skip onboarding so the seed account lands straight on the dashboard.
      onboardingComplete: true,
    })
    .returning({ id: users.id });

  if (user === undefined) {
    throw new Error("User insert returned no row.");
  }

  await db.insert(userSettings).values({
    userId: user.id,
    lowDataMode: false,
    batterySaver: false,
    backgroundIntervalSeconds: 60,
    activeIntervalSeconds: 10,
    smsFallbackEnabled: true,
    smsOnly: false,
    shareLocationByDefault: false,
    locationRetentionDays: 30,
  });

  await db.insert(guardianContacts).values([
    {
      userId: user.id,
      name: "Kwame Mensah",
      phone: "+233201234567",
      relationship: "Brother",
      permissionLevel: "always_on",
      canViewGuardianCircle: true,
    },
    {
      userId: user.id,
      name: "Efua Danso",
      phone: "+233553301884",
      relationship: "Mother",
      permissionLevel: "scheduled",
      canViewGuardianCircle: true,
    },
    {
      userId: user.id,
      name: "Yaw Boateng",
      phone: "+233277112233",
      relationship: "Friend",
      permissionLevel: "emergency_only",
      canViewGuardianCircle: false,
    },
  ]);

  // A short walk south from Accra city centre, so "last seen" and any distance
  // readout have something plausible to show.
  const now = Date.now();
  const trail = [
    { minutesAgo: 90, latOffset: 0.0121, lngOffset: -0.0102, battery: 78 },
    { minutesAgo: 75, latOffset: 0.0098, lngOffset: -0.0086, battery: 76 },
    { minutesAgo: 60, latOffset: 0.0074, lngOffset: -0.0061, battery: 74 },
    { minutesAgo: 45, latOffset: 0.0051, lngOffset: -0.0044, battery: 71 },
    { minutesAgo: 30, latOffset: 0.0032, lngOffset: -0.0029, battery: 69 },
    { minutesAgo: 15, latOffset: 0.0014, lngOffset: -0.0011, battery: 66 },
    { minutesAgo: 2, latOffset: 0, lngOffset: 0, battery: 64 },
  ];

  await db.insert(locationPings).values(
    trail.map((point) => {
      const recordedAt = new Date(now - point.minutesAgo * 60_000);
      return {
        userId: user.id,
        lat: ACCRA_LAT + point.latOffset,
        lng: ACCRA_LNG + point.lngOffset,
        accuracy: 12,
        batteryLevel: point.battery,
        source: "background",
        recordedAt,
        retentionExpiresAt: new Date(recordedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
      };
    }),
  );

  await db.insert(journeys).values({
    userId: user.id,
    startLat: ACCRA_LAT,
    startLng: ACCRA_LNG,
    startLabel: "Osu, Accra",
    destinationLabel: "Madina Market",
    destinationLat: ACCRA_LAT + 0.0412,
    destinationLng: ACCRA_LNG - 0.0287,
    expectedArrival: new Date(now + 45 * 60_000),
    graceMinutes: 15,
    status: "planned",
  });

  console.log("\nSeed complete.");
  console.log("  Sign in at /sign-in with:");
  console.log(`    email:    ${DEV_EMAIL}`);
  console.log(`    password: ${DEV_PASSWORD}`);
  console.log(`    phone:    ${DEV_PHONE}`);
  console.log("\n  3 guardian contacts, 7 location pings and 1 planned journey created.");
  console.log("  Re-running this script resets this account back to the same state.");
};

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("\nSeed failed:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
