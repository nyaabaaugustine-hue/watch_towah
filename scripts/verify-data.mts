/**
 * Read-only sanity check over the real database.
 *
 * Exists because every screen in this app claims something about state — "N
 * people would be told", "Settings saved", "your trip is being watched". A green
 * HTTP 200 proves the page rendered, not that the claim on it is true. This
 * prints the rows those claims are derived from so a browser result can be
 * checked against storage instead of taken on trust.
 *
 * Run: node --env-file=.env.local scripts/verify-data.mts
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL ?? "");

const counts = await sql`
  select
    (select count(*)::int from users) as users,
    (select count(*)::int from guardian_contacts) as contacts,
    (select count(*)::int from user_settings) as settings,
    (select count(*)::int from location_pings) as pings,
    (select count(*)::int from journeys) as journeys,
    (select count(*)::int from sos_alerts) as sos_alerts,
    (select count(*)::int from alert_deliveries) as deliveries
`;

console.log("row counts:", counts[0]);

const settings = await sql`select * from user_settings`;
console.log("\nuser_settings:");
for (const s of settings) {
  console.log(
    `  low_data=${s.low_data_mode} battery_saver=${s.battery_saver} ` +
      `background=${s.background_interval_seconds}s active=${s.active_interval_seconds}s ` +
      `sms_fallback=${s.sms_fallback_enabled} sms_only=${s.sms_only} ` +
      `share_by_default=${s.share_location_by_default} retention=${s.location_retention_days}d`,
  );
}

const contacts = await sql`
  select name, phone, permission_level, can_view_guardian_circle, contact_user_id
  from guardian_contacts order by created_at
`;
console.log("\nguardian_contacts:");
for (const c of contacts) {
  console.log(
    `  ${c.name} | ${c.phone} | ${c.permission_level} | viewer=${c.can_view_guardian_circle} | ` +
      `signedUp=${c.contact_user_id !== null}`,
  );
}

const journeys = await sql`select * from journeys order by created_at`;
console.log("\njourneys:");
for (const j of journeys) {
  console.log(
    `  ${j.destination_label ?? "(none)"} | status=${j.status} | grace=${j.grace_minutes} | ` +
      `started=${j.started_at !== null} | arrived=${j.actual_arrival !== null}`,
  );
}

const alerts = await sql`select * from sos_alerts order by triggered_at desc limit 3`;
console.log("\nsos_alerts (latest):");
for (const a of alerts) {
  // Notification is a derived fact, not a column. `notified_at` and
  // `cancelled_at` were read here for a long time; neither has ever existed on
  // `sos_alerts`, so both were quietly `undefined` and the `?? "-"` fallback
  // printed a dash that looked like a real answer. Cancellation is recorded as
  // `status = 'cancelled'` plus `resolved_at`, and who was reached is a count
  // over `alert_deliveries`.
  // `sos_alert_id`, not `alert_id`.
  const delivered = await sql`
    select count(distinct guardian_contact_id)::int as reached
    from alert_deliveries
    where sos_alert_id = ${a.id} and status = 'sent'
  `;
  const reached = delivered[0]?.reached ?? 0;

  console.log(
    `  status=${a.status} | reached=${reached} | resolved=${a.resolved_at ?? "-"} | ` +
      `lat=${a.lat ?? "null"}`,
  );
}
