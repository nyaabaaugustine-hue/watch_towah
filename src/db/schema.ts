import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/*                                  Enums                                      */
/* -------------------------------------------------------------------------- */

/** How much a Guardian Circle member is allowed to see. */
export const permissionLevelEnum = pgEnum("permission_level", [
  "always_on",
  "scheduled",
  "emergency_only",
]);

/** Lifecycle of an SOS incident, from trigger to guardian acknowledgement. */
export const sosStatusEnum = pgEnum("sos_status", [
  "triggered",
  "dispatching",
  "active",
  "acknowledged",
  "resolved",
  "cancelled",
]);

/** Transport used to deliver an alert to one recipient. */
export const alertChannelEnum = pgEnum("alert_channel", ["push", "sms"]);

/** Per-recipient delivery outcome. Drives SMS fallback when push fails. */
export const deliveryStatusEnum = pgEnum("delivery_status", [
  "pending",
  "sent",
  "delivered",
  "failed",
]);

export const journeyStatusEnum = pgEnum("journey_status", [
  "planned",
  "active",
  "arrived",
  "overdue",
  "escalated",
  "cancelled",
]);

export const checkinStatusEnum = pgEnum("checkin_status", [
  "scheduled",
  "responded",
  "missed",
  "cancelled",
]);

export const evidenceTypeEnum = pgEnum("evidence_type", [
  "photo",
  "audio",
  "location_log",
  "note",
]);

export const zoneEventEnum = pgEnum("zone_event", ["enter", "exit"]);

/** Shared incident record backing Missing Person Mode and SOS timelines. */
export const incidentKindEnum = pgEnum("incident_kind", ["sos", "missing_person"]);
export const incidentStatusEnum = pgEnum("incident_status", ["open", "resolved"]);

/** Share-link audience. Public links are unauthenticated and time-boxed. */
export const shareAudienceEnum = pgEnum("share_audience", ["circle", "public_link"]);

/* -------------------------------------------------------------------------- */
/*                                  Users                                      */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    /**
     * At least one of phone / email is required. Enforced in application code
     * because the guarantee spans two columns and a partial unique index on
     * each is the closest portable expression (Neon Postgres has no exclusion
     * constraints on nullable column pairs without a btree_gist extension).
     */
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 320 }),
    passwordHash: text("password_hash"),
    avatarUrl: text("avatar_url"),
    /** False until the onboarding flow has collected profile + Guardian Circle. */
    onboardingComplete: boolean("onboarding_complete").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_key").on(table.email),
    uniqueIndex("users_phone_key").on(table.phone),
  ],
);

/**
 * Single-use phone OTP codes. Codes are stored hashed so a database leak does
 * not hand out live login credentials.
 */
export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    purpose: varchar("purpose", { length: 24 }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("otp_codes_user_purpose_idx").on(table.userId, table.purpose),
    index("otp_codes_expiry_idx").on(table.expiresAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*                              Guardian Circle                                */
/* -------------------------------------------------------------------------- */

/**
 * A trusted contact. `contactUserId` is set when the contact also uses
 * Watchtower (they get push + a rich in-app view); when null the contact is
 * reached by SMS only, which is the common case in Ghana.
 */
export const guardianContacts = pgTable(
  "guardian_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactUserId: uuid("contact_user_id").references(() => users.id, { onDelete: "set null" }),
    name: varchar("name", { length: 120 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    relationship: varchar("relationship", { length: 60 }),
    permissionLevel: permissionLevelEnum("permission_level").notNull().default("emergency_only"),
    /** Guardians may not see each other unless this is true. */
    canViewGuardianCircle: boolean("can_view_guardian_circle").notNull().default(false),
    /** Invitation was delivered and accepted by an app user. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("guardian_contacts_user_idx").on(table.userId),
    index("guardian_contacts_contact_user_idx").on(table.contactUserId),
    uniqueIndex("guardian_contacts_user_phone_key").on(table.userId, table.phone),
  ],
);

/* -------------------------------------------------------------------------- */
/*                             Location tracking                               */
/* -------------------------------------------------------------------------- */

/**
 * Append-only breadcrumb trail. This is the highest-volume table in the
 * database — see `location_pings_user_recorded_idx` for the covering read
 * path and the retention sweep that enforces data minimisation.
 */
export const locationPings = pgTable(
  "location_pings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    /** Horizontal accuracy in metres, straight from the Geolocation API. */
    accuracy: doublePrecision("accuracy"),
    /** Metres above sea level, when the device supplies altitude. */
    altitude: doublePrecision("altitude"),
    speed: doublePrecision("speed"),
    heading: doublePrecision("heading"),
    /** 0-100. Used by the battery-aware polling and low-battery warnings. */
    batteryLevel: integer("battery_level"),
    /** Which capture path produced this ping (manual, journey, sos, ...). */
    source: varchar("source", { length: 24 }).notNull().default("background"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    /** Data-minimisation deadline; background job hard-deletes past this. */
    retentionExpiresAt: timestamp("retention_expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("location_pings_user_recorded_idx").on(table.userId, table.recordedAt),
    index("location_pings_retention_idx").on(table.retentionExpiresAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                   SOS                                       */
/* -------------------------------------------------------------------------- */

export const sosAlerts = pgTable(
  "sos_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
    status: sosStatusEnum("status").notNull().default("triggered"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    accuracy: doublePrecision("accuracy"),
    /**
     * Press-and-hold grace window. The user can cancel until this instant
     * without anyone being notified — a misfire must never page a family.
     */
    cancellableUntil: timestamp("cancellable_until", { withTimezone: true }),
    /** How the alert was raised. "silent" is the discreet shake/hold path. */
    trigger: varchar("trigger", { length: 24 }).notNull().default("button"),
    /** Set when this alert was auto-escalated from a journey or check-in. */
    escalatedFrom: varchar("escalated_from", { length: 32 }),
    note: text("note"),
    /** Short random slug embedded in the tracking URL sent by SMS. */
    shareToken: varchar("share_token", { length: 64 }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sos_alerts_user_triggered_idx").on(table.userId, table.triggeredAt),
    index("sos_alerts_status_idx").on(table.status),
    uniqueIndex("sos_alerts_share_token_key").on(table.shareToken),
  ],
);

/**
 * One row per recipient per alert. Recording every attempt is what makes the
 * push -> SMS fallback auditable: if push fails we can prove we tried before
 * spending an SMS credit.
 */
export const alertDeliveries = pgTable(
  "alert_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sosAlertId: uuid("sos_alert_id")
      .notNull()
      .references(() => sosAlerts.id, { onDelete: "cascade" }),
    guardianContactId: uuid("guardian_contact_id")
      .notNull()
      .references(() => guardianContacts.id, { onDelete: "cascade" }),
    channel: alertChannelEnum("channel").notNull(),
    status: deliveryStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    providerMessageId: varchar("provider_message_id", { length: 120 }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_deliveries_alert_contact_channel_key").on(
      table.sosAlertId,
      table.guardianContactId,
      table.channel,
    ),
    index("alert_deliveries_status_idx").on(table.status),
  ],
);

/** VAPID subscription records. Keyed by endpoint since that is the push identity. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_key").on(table.endpoint),
    index("push_subscriptions_user_idx").on(table.userId),
  ],
);

/* -------------------------------------------------------------------------- */
/*                             Live location sharing                            */
/* -------------------------------------------------------------------------- */

/**
 * A time-boxed window during which guardians may watch the owner move. The
 * row is the authority on visibility: the SSE stream refuses to emit a ping
 * to a viewer with no active, unexpired share.
 */
export const locationShares = pgTable(
  "location_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    audience: shareAudienceEnum("audience").notNull().default("circle"),
    /** Random slug for public_link shares. Null for circle shares. */
    shareToken: varchar("share_token", { length: 64 }),
    label: varchar("label", { length: 80 }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null means "until manually stopped". */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("location_shares_user_active_idx").on(table.userId, table.stoppedAt),
    uniqueIndex("location_shares_share_token_key").on(table.shareToken),
  ],
);

/** Join table: which guardians were granted a given share. */
export const locationShareRecipients = pgTable(
  "location_share_recipients",
  {
    shareId: uuid("share_id")
      .notNull()
      .references(() => locationShares.id, { onDelete: "cascade" }),
    guardianContactId: uuid("guardian_contact_id")
      .notNull()
      .references(() => guardianContacts.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.shareId, table.guardianContactId] }),
    index("location_share_recipients_contact_idx").on(table.guardianContactId),
  ],
);

/* -------------------------------------------------------------------------- */
/*                             Journey monitoring                              */
/* -------------------------------------------------------------------------- */

export const journeys = pgTable(
  "journeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startLat: doublePrecision("start_lat"),
    startLng: doublePrecision("start_lng"),
    startLabel: varchar("start_label", { length: 160 }),
    destinationLabel: varchar("destination_label", { length: 160 }).notNull(),
    destinationLat: doublePrecision("destination_lat"),
    destinationLng: doublePrecision("destination_lng"),
    expectedArrival: timestamp("expected_arrival", { withTimezone: true }).notNull(),
    /**
     * Grace minutes added to expected_arrival before auto-escalation. A
     * guardian who misses the first alert should not page everyone instantly.
     */
    graceMinutes: integer("grace_minutes").notNull().default(15),
    status: journeyStatusEnum("status").notNull().default("planned"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    actualArrival: timestamp("actual_arrival", { withTimezone: true }),
    /** Set once auto-escalation has fired, so it never fires twice. */
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    /** Links a journey-escalated SOS back to its origin journey. */
    sosAlertId: uuid("sos_alert_id").references(() => sosAlerts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("journeys_user_status_idx").on(table.userId, table.status),
    index("journeys_expected_arrival_idx").on(table.status, table.expectedArrival),
  ],
);

/* -------------------------------------------------------------------------- */
/*                             Safety check-ins                                */
/* -------------------------------------------------------------------------- */

export const checkins = pgTable(
  "checkins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Recurrence rule, e.g. every 2h while a journey is active. */
    intervalMinutes: integer("interval_minutes").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    /** Minutes after scheduledAt before the check-in counts as missed. */
    graceMinutes: integer("grace_minutes").notNull().default(20),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    status: checkinStatusEnum("status").notNull().default("scheduled"),
    responseNote: text("response_note"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    /** Set once the miss has escalated, preventing duplicate SOS sends. */
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("checkins_user_status_idx").on(table.userId, table.status),
    index("checkins_due_idx").on(table.status, table.scheduledAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*                             Safety zones                                    */
/* -------------------------------------------------------------------------- */

export const safetyZones = pgTable(
  "safety_zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    centerLat: doublePrecision("center_lat").notNull(),
    centerLng: doublePrecision("center_lng").notNull(),
    radiusMeters: integer("radius_meters").notNull(),
    /** Notify the circle on entry/exit. Off for a pure "am I home" marker. */
    notifyCircle: boolean("notify_circle").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("safety_zones_user_idx").on(table.userId)],
);

export const zoneEvents = pgTable(
  "zone_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => safetyZones.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: zoneEventEnum("event").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("zone_events_user_occurred_idx").on(table.userId, table.occurredAt)],
);

/* -------------------------------------------------------------------------- */
/*                          Emergency evidence vault                          */
/* -------------------------------------------------------------------------- */

/**
 * Media lives in Cloudinary; this row holds the pointer plus the chain of
 * custody. `capturedAt` and the device-reported coordinates are immutable once
 * written so the export is defensible as a record of events.
 */
export const evidenceItems = pgTable(
  "evidence_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sosAlertId: uuid("sos_alert_id").references(() => sosAlerts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: evidenceTypeEnum("type").notNull(),
    /** Cloudinary public id. Null for entries that never uploaded (offline). */
    cloudinaryPublicId: varchar("cloudinary_public_id", { length: 160 }),
    /** Local blob retained in IndexedDB while the upload is pending. */
    pendingUpload: boolean("pending_upload").notNull().default(false),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    mimeType: varchar("mime_type", { length: 80 }),
    /** Encrypted-at-rest sidecar: device label, note, and edit history. */
    encryptedMetadata: text("encrypted_metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("evidence_items_alert_idx").on(table.sosAlertId),
    index("evidence_items_user_captured_idx").on(table.userId, table.capturedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*                          Incidents / missing person                        */
/* -------------------------------------------------------------------------- */

/**
 * The shared record a Guardian Circle collaborates on. An SOS opens one
 * automatically; Missing Person Mode opens one explicitly. Every timeline
 * entry hangs off this so the whole circle sees the same story.
 */
export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: incidentKindEnum("kind").notNull(),
    status: incidentStatusEnum("status").notNull().default("open"),
    /** For kind = sos this is the originating alert. */
    sosAlertId: uuid("sos_alert_id").references(() => sosAlerts.id, { onDelete: "set null" }),
    /** For kind = missing_person this is the circle member being searched for. */
    missingUserId: uuid("missing_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Circle member who raised a missing-person report. */
    reportedByUserId: uuid("reported_by_user_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 160 }).notNull(),
    lastKnownLat: doublePrecision("last_known_lat"),
    lastKnownLng: doublePrecision("last_known_lng"),
    lastKnownAt: timestamp("last_known_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    summary: text("summary"),
  },
  (table) => [
    index("incidents_status_opened_idx").on(table.status, table.openedAt),
    index("incidents_missing_user_idx").on(table.missingUserId),
  ],
);

/** Append-only, circle-visible narrative for an incident. */
export const incidentTimeline = pgTable(
  "incident_timeline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Null for system-generated entries (pings, alerts, zone breaches). */
    body: text("body"),
    entryType: varchar("entry_type", { length: 32 }).notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("incident_timeline_incident_occurred_idx").on(table.incidentId, table.occurredAt)],
);

/* -------------------------------------------------------------------------- */
/*                              Auth throttling                                */
/* -------------------------------------------------------------------------- */

/**
 * Failed-login accounting, keyed by the identifier being attacked (never the
 * password). This has to live in Postgres rather than process memory because
 * a Vercel function's memory is discarded between invocations, which would make
 * an in-memory limiter trivially bypassable by just retrying.
 *
 * Password hashes are not keys: an attacker must not be able to enumerate
 * which emails or phone numbers have accounts through lockout timing.
 */
export const authThrottle = pgTable("auth_throttle", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/*                                 Settings                                    */
/* -------------------------------------------------------------------------- */

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Strips map tiles to a low-detail style and shortens share windows. */
  lowDataMode: boolean("low_data_mode").notNull().default(false),
  /** Caps background ping frequency to protect battery. */
  batterySaver: boolean("battery_saver").notNull().default(false),
  /** Base background ping interval. SOS and journeys override this upward. */
  backgroundIntervalSeconds: integer("background_interval_seconds").notNull().default(60),
  /** Extra interval used whenever an incident is live. */
  activeIntervalSeconds: integer("active_interval_seconds").notNull().default(10),
  /** Which channel is tried first. SMS is the guaranteed fallback. */
  smsFallbackEnabled: boolean("sms_fallback_enabled").notNull().default(true),
  /** When true, unreachable guardians only get SMS. */
  smsOnly: boolean("sms_only").notNull().default(false),
  shareLocationByDefault: boolean("share_location_by_default").notNull().default(false),
  /** Days of location history to keep before the retention sweep deletes it. */
  locationRetentionDays: integer("location_retention_days").notNull().default(30),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

