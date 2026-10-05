DROP INDEX IF EXISTS `healthDataPoint_userId_dataType_observedAtMs_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `healthSyncRun_startedAt_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `healthSyncState_userId_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `healthSyncState_disabledAt_lastSyncAt_idx`;--> statement-breakpoint
DROP TABLE `health_data_point`;--> statement-breakpoint
DROP TABLE `health_sync_account`;--> statement-breakpoint
DROP TABLE `health_sync_lease`;--> statement-breakpoint
DROP TABLE `health_sync_run`;--> statement-breakpoint
DROP TABLE `health_sync_state`;