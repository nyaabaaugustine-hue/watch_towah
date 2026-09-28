import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL ?? "");

const counts = await sql`
  select
    (select count(*)::int from users)                                    as users,
    (select count(*)::int from user_settings)                            as settings,
    (select count(*)::int from guardian_contacts)                        as contacts,
    (select count(*)::int from location_pings)                           as pings,
    (select count(*)::int from journeys)                                 as journeys,
    (select count(*)::int from push_subscriptions)                       as push_subs
`;

const columns = await sql`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'users' order by ordinal_position
`;

const user = await sql`select * from users where email = 'amma@watchtower.test'`;

console.log("seeded row counts:", counts[0]);
console.log("\nusers table columns:");
console.log("  " + columns.map((c) => c.column_name).join(", "));

if (user.length > 0) {
  const row = user[0];
  console.log("\nseeded user:");
  for (const key of Object.keys(row)) {
    const value = row[key];
    const shown = key.toLowerCase().includes("hash") ? `${String(value).slice(0, 18)}...` : value;
    console.log(`  ${key.padEnd(22)} ${shown}`);
  }
}

const contacts = await sql`select * from guardian_contacts order by created_at`;
console.log("\nguardian contacts:");
for (const c of contacts) {
  const summary = Object.entries(c)
    .filter(([k, v]) => v !== null && !k.startsWith("id") && k !== "created_at" && k !== "user_id")
    .slice(0, 5)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`  ${summary}`);
}

const pings = await sql`select count(*)::int as n, min(recorded_at) as first, max(recorded_at) as last from location_pings`;
console.log(`\nlocation pings: ${pings[0].n} (${pings[0].first} -> ${pings[0].last})`);

const journey = await sql`select * from journeys limit 1`;
if (journey.length > 0) {
  console.log(`\njourney columns: ${Object.keys(journey[0]).join(", ")}`);
  console.log(`journey status: ${journey[0].status}, expected_arrival: ${journey[0].expected_arrival}`);
}
