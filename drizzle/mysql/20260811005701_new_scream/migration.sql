CREATE TABLE `jwks` (
	`id` varchar(36) PRIMARY KEY,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`expires_at` timestamp(3)
);
--> statement-breakpoint
CREATE TABLE `oauth_access_token` (
	`id` varchar(36) PRIMARY KEY,
	`token` varchar(255) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`session_id` varchar(36),
	`user_id` varchar(36),
	`reference_id` text,
	`refresh_id` varchar(36),
	`expires_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`scopes` text NOT NULL,
	CONSTRAINT `token_unique` UNIQUE INDEX(`token`)
);
--> statement-breakpoint
CREATE TABLE `oauth_client` (
	`id` varchar(36) PRIMARY KEY,
	`client_id` varchar(255) NOT NULL,
	`client_secret` text,
	`disabled` boolean DEFAULT false,
	`skip_consent` boolean,
	`enable_end_session` boolean,
	`subject_type` text,
	`scopes` text,
	`user_id` varchar(36),
	`created_at` timestamp(3),
	`updated_at` timestamp(3),
	`name` text,
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`software_id` text,
	`software_version` text,
	`software_statement` text,
	`redirect_uris` text NOT NULL,
	`post_logout_redirect_uris` text,
	`token_endpoint_auth_method` text,
	`grant_types` text,
	`response_types` text,
	`public` boolean,
	`type` text,
	`require_pkce` boolean,
	`reference_id` text,
	`metadata` json,
	CONSTRAINT `client_id_unique` UNIQUE INDEX(`client_id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_consent` (
	`id` varchar(36) PRIMARY KEY,
	`client_id` varchar(255) NOT NULL,
	`user_id` varchar(36),
	`reference_id` text,
	`scopes` text NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_refresh_token` (
	`id` varchar(36) PRIMARY KEY,
	`token` varchar(255) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`session_id` varchar(36),
	`user_id` varchar(36) NOT NULL,
	`reference_id` text,
	`expires_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`revoked` timestamp(3),
	`auth_time` timestamp(3),
	`scopes` text NOT NULL,
	CONSTRAINT `token_unique` UNIQUE INDEX(`token`)
);
--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` varchar(36) PRIMARY KEY,
	`key` varchar(255) NOT NULL,
	`count` int NOT NULL,
	`last_request` bigint NOT NULL,
	CONSTRAINT `key_unique` UNIQUE INDEX(`key`)
);
--> statement-breakpoint
CREATE INDEX `oauthAccessToken_clientId_idx` ON `oauth_access_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_sessionId_idx` ON `oauth_access_token` (`session_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_userId_idx` ON `oauth_access_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_refreshId_idx` ON `oauth_access_token` (`refresh_id`);--> statement-breakpoint
CREATE INDEX `oauthClient_userId_idx` ON `oauth_client` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauthConsent_clientId_idx` ON `oauth_consent` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthConsent_userId_idx` ON `oauth_consent` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_clientId_idx` ON `oauth_refresh_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_sessionId_idx` ON `oauth_refresh_token` (`session_id`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_userId_idx` ON `oauth_refresh_token` (`user_id`);--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD CONSTRAINT `oauth_access_token_client_id_oauth_client_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD CONSTRAINT `oauth_access_token_session_id_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD CONSTRAINT `oauth_access_token_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD CONSTRAINT `oauth_access_token_refresh_id_oauth_refresh_token_id_fkey` FOREIGN KEY (`refresh_id`) REFERENCES `oauth_refresh_token`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD CONSTRAINT `oauth_client_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `oauth_consent` ADD CONSTRAINT `oauth_consent_client_id_oauth_client_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `oauth_consent` ADD CONSTRAINT `oauth_consent_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD CONSTRAINT `oauth_refresh_token_client_id_oauth_client_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD CONSTRAINT `oauth_refresh_token_session_id_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD CONSTRAINT `oauth_refresh_token_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;