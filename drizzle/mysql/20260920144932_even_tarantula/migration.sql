CREATE TABLE `health_sync_lease` (
	`id` varchar(32) PRIMARY KEY,
	`holder` varchar(32),
	`acquired_at` timestamp(3),
	`expires_at` timestamp(3),
	`heartbeat_at` timestamp(3),
	`cursor_user_id` varchar(36),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE TABLE `health_sync_run` (
	`id` varchar(32) PRIMARY KEY,
	`started_at` timestamp(3) NOT NULL,
	`finished_at` timestamp(3),
	`trigger` varchar(16) NOT NULL,
	`outcome` varchar(32),
	`users_considered` int NOT NULL DEFAULT 0,
	`users_touched` int NOT NULL DEFAULT 0,
	`tasks_planned` int NOT NULL DEFAULT 0,
	`tasks_ran` int NOT NULL DEFAULT 0,
	`points_inserted` int NOT NULL DEFAULT 0,
	`points_updated` int NOT NULL DEFAULT 0,
	`retries` int NOT NULL DEFAULT 0,
	`blocks_written` int NOT NULL DEFAULT 0,
	`more_work` boolean NOT NULL DEFAULT false,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `healthSyncRun_startedAt_idx` ON `health_sync_run` (`started_at`);
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
INSERT INTO `health_sync_lease` (`id`) VALUES ('default');
