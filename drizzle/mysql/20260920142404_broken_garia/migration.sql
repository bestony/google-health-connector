CREATE TABLE `health_data_point` (
	`id` varchar(32) PRIMARY KEY,
	`user_id` varchar(36) NOT NULL,
	`data_type` varchar(64) NOT NULL,
	`grain` varchar(16) NOT NULL DEFAULT 'point',
	`time_shape` varchar(16) NOT NULL,
	`observed_at_ms` bigint NOT NULL,
	`observed_end_ms` bigint NOT NULL,
	`observed_time` json NOT NULL,
	`value` json NOT NULL,
	`source` json,
	`source_key` varchar(32),
	`resource_name` text,
	`content_hash` varchar(32) NOT NULL,
	`synced_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE TABLE `health_sync_account` (
	`user_id` varchar(36) PRIMARY KEY,
	`enabled` boolean NOT NULL DEFAULT false,
	`enabled_at` timestamp(3),
	`disabled_at` timestamp(3),
	`time_zone` varchar(64),
	`time_zone_source` varchar(16),
	`membership_start_date_ms` bigint,
	`last_probed_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE TABLE `health_sync_state` (
	`id` varchar(32) PRIMARY KEY,
	`user_id` varchar(36) NOT NULL,
	`data_type` varchar(64) NOT NULL,
	`covered_from_ms` bigint,
	`covered_through_ms` bigint,
	`backfill_complete` boolean NOT NULL DEFAULT false,
	`last_sync_at` timestamp(3),
	`last_attempt_at` timestamp(3),
	`last_point_count` int NOT NULL DEFAULT 0,
	`failure_status` int,
	`failure_code` varchar(64),
	`failure_message` text,
	`failure_count` int NOT NULL DEFAULT 0,
	`failed_at` timestamp(3),
	`disabled_at` timestamp(3),
	`retry_after` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE INDEX `healthDataPoint_userId_dataType_observedAtMs_idx` ON `health_data_point` (`user_id`,`data_type`,`observed_at_ms`);--> statement-breakpoint
CREATE INDEX `healthSyncState_userId_idx` ON `health_sync_state` (`user_id`);--> statement-breakpoint
CREATE INDEX `healthSyncState_disabledAt_lastSyncAt_idx` ON `health_sync_state` (`disabled_at`,`last_sync_at`);--> statement-breakpoint
ALTER TABLE `health_data_point` ADD CONSTRAINT `health_data_point_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `health_sync_account` ADD CONSTRAINT `health_sync_account_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `health_sync_state` ADD CONSTRAINT `health_sync_state_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;