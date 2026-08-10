CREATE TABLE `apikey` (
	`id` varchar(36) PRIMARY KEY,
	`config_id` varchar(255) NOT NULL DEFAULT 'default',
	`name` text,
	`start` text,
	`reference_id` varchar(255) NOT NULL,
	`prefix` text,
	`key` varchar(255) NOT NULL,
	`refill_interval` int,
	`refill_amount` int,
	`last_refill_at` timestamp(3),
	`enabled` boolean DEFAULT true,
	`rate_limit_enabled` boolean DEFAULT true,
	`rate_limit_time_window` int DEFAULT 60000,
	`rate_limit_max` int DEFAULT 120,
	`request_count` int DEFAULT 0,
	`remaining` int,
	`last_request` timestamp(3),
	`expires_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	`permissions` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `apikey_configId_idx` ON `apikey` (`config_id`);--> statement-breakpoint
CREATE INDEX `apikey_referenceId_idx` ON `apikey` (`reference_id`);--> statement-breakpoint
CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);