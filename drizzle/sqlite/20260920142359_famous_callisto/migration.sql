CREATE TABLE `health_data_point` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`data_type` text NOT NULL,
	`grain` text DEFAULT 'point' NOT NULL,
	`time_shape` text NOT NULL,
	`observed_at_ms` integer NOT NULL,
	`observed_end_ms` integer NOT NULL,
	`observed_time` text NOT NULL,
	`value` text NOT NULL,
	`source` text,
	`source_key` text,
	`resource_name` text,
	`content_hash` text NOT NULL,
	`synced_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_health_data_point_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `health_sync_account` (
	`user_id` text PRIMARY KEY,
	`enabled` integer DEFAULT false NOT NULL,
	`enabled_at` integer,
	`disabled_at` integer,
	`time_zone` text,
	`time_zone_source` text,
	`membership_start_date_ms` integer,
	`last_probed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_health_sync_account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `health_sync_state` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`data_type` text NOT NULL,
	`covered_from_ms` integer,
	`covered_through_ms` integer,
	`backfill_complete` integer DEFAULT false NOT NULL,
	`last_sync_at` integer,
	`last_attempt_at` integer,
	`last_point_count` integer DEFAULT 0 NOT NULL,
	`failure_status` integer,
	`failure_code` text,
	`failure_message` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`failed_at` integer,
	`disabled_at` integer,
	`retry_after` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_health_sync_state_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `healthDataPoint_userId_dataType_observedAtMs_idx` ON `health_data_point` (`user_id`,`data_type`,`observed_at_ms`);--> statement-breakpoint
CREATE INDEX `healthSyncState_userId_idx` ON `health_sync_state` (`user_id`);--> statement-breakpoint
CREATE INDEX `healthSyncState_disabledAt_lastSyncAt_idx` ON `health_sync_state` (`disabled_at`,`last_sync_at`);