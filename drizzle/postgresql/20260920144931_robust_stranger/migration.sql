CREATE TABLE "health_sync_lease" (
	"id" text PRIMARY KEY,
	"holder" text,
	"acquired_at" timestamp,
	"expires_at" timestamp,
	"heartbeat_at" timestamp,
	"cursor_user_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_sync_run" (
	"id" text PRIMARY KEY,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp,
	"trigger" text NOT NULL,
	"outcome" text,
	"users_considered" integer DEFAULT 0 NOT NULL,
	"users_touched" integer DEFAULT 0 NOT NULL,
	"tasks_planned" integer DEFAULT 0 NOT NULL,
	"tasks_ran" integer DEFAULT 0 NOT NULL,
	"points_inserted" integer DEFAULT 0 NOT NULL,
	"points_updated" integer DEFAULT 0 NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"blocks_written" integer DEFAULT 0 NOT NULL,
	"more_work" boolean DEFAULT false NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "healthSyncRun_startedAt_idx" ON "health_sync_run" ("started_at");
--> statement-breakpoint
-- Seed the single lease row.
--
-- One row, created here, is what lets `acquireLease` be a plain conditional
-- UPDATE: with no row to update, acquire would need a dialect-specific upsert
-- whose conflict semantics differ on all three engines.
--
-- Only the id is written. `holder IS NULL` is what says the lease is free, and
-- `updated_at` takes its column default — MySQL's TIMESTAMP cannot represent
-- the epoch at all (its range starts at 1970-01-01 00:00:01 UTC), so spelling
-- a "never held" timestamp portably is not worth doing for a value nothing
-- reads.
INSERT INTO "health_sync_lease" ("id") VALUES ('default');
