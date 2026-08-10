ALTER TABLE `apikey` MODIFY COLUMN `rate_limit_time_window` int DEFAULT 1000;--> statement-breakpoint
ALTER TABLE `apikey` MODIFY COLUMN `rate_limit_max` int DEFAULT 100;