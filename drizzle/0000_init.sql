-- Watchtower initial schema.
--
-- pg_cron backs the location-retention sweep. The extension must be enabled
-- before the schedule is registered, and it can only be created outside a
-- transaction block on Neon, so it is prepended here rather than emitted by
-- `drizzle-kit generate` (which does not manage extensions).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE TYPE "public"."alert_channel" AS ENUM('push', 'sms');--> statement-breakpoint
CREATE TYPE "public"."checkin_status" AS ENUM('scheduled', 'responded', 'missed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'sent', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('photo', 'audio', 'location_log', 'note');--> statement-breakpoint
CREATE TYPE "public"."incident_kind" AS ENUM('sos', 'missing_person');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."journey_status" AS ENUM('planned', 'active', 'arrived', 'overdue', 'escalated', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."permission_level" AS ENUM('always_on', 'scheduled', 'emergency_only');--> statement-breakpoint
CREATE TYPE "public"."share_audience" AS ENUM('circle', 'public_link');--> statement-breakpoint
CREATE TYPE "public"."sos_status" AS ENUM('triggered', 'dispatching', 'active', 'acknowledged', 'resolved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."zone_event" AS ENUM('enter', 'exit');--> statement-breakpoint
CREATE TABLE "alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sos_alert_id" uuid NOT NULL,
	"guardian_contact_id" uuid NOT NULL,
	"channel" "alert_channel" NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" varchar(120),
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"interval_minutes" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"grace_minutes" integer DEFAULT 20 NOT NULL,
	"responded_at" timestamp with time zone,
	"status" "checkin_status" DEFAULT 'scheduled' NOT NULL,
	"response_note" text,
	"lat" double precision,
	"lng" double precision,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sos_alert_id" uuid,
	"user_id" uuid NOT NULL,
	"type" "evidence_type" NOT NULL,
	"cloudinary_public_id" varchar(160),
	"pending_upload" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"mime_type" varchar(80),
	"encrypted_metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardian_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"contact_user_id" uuid,
	"name" varchar(120) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"relationship" varchar(60),
	"permission_level" "permission_level" DEFAULT 'emergency_only' NOT NULL,
	"can_view_guardian_circle" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_timeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text,
	"entry_type" varchar(32) NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "incident_kind" NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"sos_alert_id" uuid,
	"missing_user_id" uuid,
	"reported_by_user_id" uuid,
	"title" varchar(160) NOT NULL,
	"last_known_lat" double precision,
	"last_known_lng" double precision,
	"last_known_at" timestamp with time zone,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"summary" text
);
--> statement-breakpoint
CREATE TABLE "journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"start_lat" double precision,
	"start_lng" double precision,
	"start_label" varchar(160),
	"destination_label" varchar(160) NOT NULL,
	"destination_lat" double precision,
	"destination_lng" double precision,
	"expected_arrival" timestamp with time zone NOT NULL,
	"grace_minutes" integer DEFAULT 15 NOT NULL,
	"status" "journey_status" DEFAULT 'planned' NOT NULL,
	"started_at" timestamp with time zone,
	"actual_arrival" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"sos_alert_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_pings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy" double precision,
	"altitude" double precision,
	"speed" double precision,
	"heading" double precision,
	"battery_level" integer,
	"source" varchar(24) DEFAULT 'background' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_share_recipients" (
	"share_id" uuid NOT NULL,
	"guardian_contact_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_share_recipients_share_id_guardian_contact_id_pk" PRIMARY KEY("share_id","guardian_contact_id")
);
--> statement-breakpoint
CREATE TABLE "location_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"audience" "share_audience" DEFAULT 'circle' NOT NULL,
	"share_token" varchar(64),
	"label" varchar(80),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"purpose" varchar(24) NOT NULL,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"center_lat" double precision NOT NULL,
	"center_lng" double precision NOT NULL,
	"radius_meters" integer NOT NULL,
	"notify_circle" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sos_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "sos_status" DEFAULT 'triggered' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"accuracy" double precision,
	"cancellable_until" timestamp with time zone,
	"trigger" varchar(24) DEFAULT 'button' NOT NULL,
	"escalated_from" varchar(32),
	"note" text,
	"share_token" varchar(64) NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"low_data_mode" boolean DEFAULT false NOT NULL,
	"battery_saver" boolean DEFAULT false NOT NULL,
	"background_interval_seconds" integer DEFAULT 60 NOT NULL,
	"active_interval_seconds" integer DEFAULT 10 NOT NULL,
	"sms_fallback_enabled" boolean DEFAULT true NOT NULL,
	"sms_only" boolean DEFAULT false NOT NULL,
	"share_location_by_default" boolean DEFAULT false NOT NULL,
	"location_retention_days" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone" varchar(20),
	"email" varchar(320),
	"password_hash" text,
	"avatar_url" text,
	"onboarding_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zone_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event" "zone_event" NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_sos_alert_id_sos_alerts_id_fk" FOREIGN KEY ("sos_alert_id") REFERENCES "public"."sos_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_guardian_contact_id_guardian_contacts_id_fk" FOREIGN KEY ("guardian_contact_id") REFERENCES "public"."guardian_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_sos_alert_id_sos_alerts_id_fk" FOREIGN KEY ("sos_alert_id") REFERENCES "public"."sos_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_contacts" ADD CONSTRAINT "guardian_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_contacts" ADD CONSTRAINT "guardian_contacts_contact_user_id_users_id_fk" FOREIGN KEY ("contact_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_timeline" ADD CONSTRAINT "incident_timeline_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_timeline" ADD CONSTRAINT "incident_timeline_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_sos_alert_id_sos_alerts_id_fk" FOREIGN KEY ("sos_alert_id") REFERENCES "public"."sos_alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_missing_user_id_users_id_fk" FOREIGN KEY ("missing_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_sos_alert_id_sos_alerts_id_fk" FOREIGN KEY ("sos_alert_id") REFERENCES "public"."sos_alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_share_recipients" ADD CONSTRAINT "location_share_recipients_share_id_location_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."location_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_share_recipients" ADD CONSTRAINT "location_share_recipients_guardian_contact_id_guardian_contacts_id_fk" FOREIGN KEY ("guardian_contact_id") REFERENCES "public"."guardian_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_shares" ADD CONSTRAINT "location_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_zones" ADD CONSTRAINT "safety_zones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_alerts" ADD CONSTRAINT "sos_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_events" ADD CONSTRAINT "zone_events_zone_id_safety_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."safety_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_events" ADD CONSTRAINT "zone_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_deliveries_alert_contact_channel_key" ON "alert_deliveries" USING btree ("sos_alert_id","guardian_contact_id","channel");--> statement-breakpoint
CREATE INDEX "alert_deliveries_status_idx" ON "alert_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "checkins_user_status_idx" ON "checkins" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "checkins_due_idx" ON "checkins" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "evidence_items_alert_idx" ON "evidence_items" USING btree ("sos_alert_id");--> statement-breakpoint
CREATE INDEX "evidence_items_user_captured_idx" ON "evidence_items" USING btree ("user_id","captured_at");--> statement-breakpoint
CREATE INDEX "guardian_contacts_user_idx" ON "guardian_contacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "guardian_contacts_contact_user_idx" ON "guardian_contacts" USING btree ("contact_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_contacts_user_phone_key" ON "guardian_contacts" USING btree ("user_id","phone");--> statement-breakpoint
CREATE INDEX "incident_timeline_incident_occurred_idx" ON "incident_timeline" USING btree ("incident_id","occurred_at");--> statement-breakpoint
CREATE INDEX "incidents_status_opened_idx" ON "incidents" USING btree ("status","opened_at");--> statement-breakpoint
CREATE INDEX "incidents_missing_user_idx" ON "incidents" USING btree ("missing_user_id");--> statement-breakpoint
CREATE INDEX "journeys_user_status_idx" ON "journeys" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "journeys_expected_arrival_idx" ON "journeys" USING btree ("status","expected_arrival");--> statement-breakpoint
CREATE INDEX "location_pings_user_recorded_idx" ON "location_pings" USING btree ("user_id","recorded_at");--> statement-breakpoint
CREATE INDEX "location_pings_retention_idx" ON "location_pings" USING btree ("retention_expires_at");--> statement-breakpoint
CREATE INDEX "location_share_recipients_contact_idx" ON "location_share_recipients" USING btree ("guardian_contact_id");--> statement-breakpoint
CREATE INDEX "location_shares_user_active_idx" ON "location_shares" USING btree ("user_id","stopped_at");--> statement-breakpoint
CREATE UNIQUE INDEX "location_shares_share_token_key" ON "location_shares" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "otp_codes_user_purpose_idx" ON "otp_codes" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "otp_codes_expiry_idx" ON "otp_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "safety_zones_user_idx" ON "safety_zones" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sos_alerts_user_triggered_idx" ON "sos_alerts" USING btree ("user_id","triggered_at");--> statement-breakpoint
CREATE INDEX "sos_alerts_status_idx" ON "sos_alerts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sos_alerts_share_token_key" ON "sos_alerts" USING btree ("share_token");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "zone_events_user_occurred_idx" ON "zone_events" USING btree ("user_id","occurred_at");
-- Statement-breakpoint
-- Enforce the data-minimisation promise: location breadcrumbs are hard-deleted
-- once their retention deadline passes, whether or not a client ever reconnects.
SELECT cron.schedule(
  'watchtower-retention',
  '*/15 * * * *',
  'DELETE FROM location_pings WHERE "retention_expires_at" < now()'
);