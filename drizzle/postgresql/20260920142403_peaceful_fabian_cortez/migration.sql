CREATE TABLE "health_data_point" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"data_type" text NOT NULL,
	"grain" text DEFAULT 'point' NOT NULL,
	"time_shape" text NOT NULL,
	"observed_at_ms" bigint NOT NULL,
	"observed_end_ms" bigint NOT NULL,
	"observed_time" jsonb NOT NULL,
	"value" jsonb NOT NULL,
	"source" jsonb,
	"source_key" text,
	"resource_name" text,
	"content_hash" text NOT NULL,
	"synced_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_sync_account" (
	"user_id" text PRIMARY KEY,
	"enabled" boolean DEFAULT false NOT NULL,
	"enabled_at" timestamp,
	"disabled_at" timestamp,
	"time_zone" text,
	"time_zone_source" text,
	"membership_start_date_ms" bigint,
	"last_probed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_sync_state" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"data_type" text NOT NULL,
	"covered_from_ms" bigint,
	"covered_through_ms" bigint,
	"backfill_complete" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp,
	"last_attempt_at" timestamp,
	"last_point_count" integer DEFAULT 0 NOT NULL,
	"failure_status" integer,
	"failure_code" text,
	"failure_message" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"failed_at" timestamp,
	"disabled_at" timestamp,
	"retry_after" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "healthDataPoint_userId_dataType_observedAtMs_idx" ON "health_data_point" ("user_id","data_type","observed_at_ms");--> statement-breakpoint
CREATE INDEX "healthSyncState_userId_idx" ON "health_sync_state" ("user_id");--> statement-breakpoint
CREATE INDEX "healthSyncState_disabledAt_lastSyncAt_idx" ON "health_sync_state" ("disabled_at","last_sync_at");--> statement-breakpoint
ALTER TABLE "health_data_point" ADD CONSTRAINT "health_data_point_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "health_sync_account" ADD CONSTRAINT "health_sync_account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "health_sync_state" ADD CONSTRAINT "health_sync_state_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;