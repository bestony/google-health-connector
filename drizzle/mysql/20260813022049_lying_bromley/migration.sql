CREATE TABLE `oauth_client_assertion` (
	`id` varchar(36) PRIMARY KEY,
	`expires_at` timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_resource` (
	`id` varchar(36) PRIMARY KEY,
	`identifier` varchar(255) NOT NULL,
	`name` text NOT NULL,
	`access_token_ttl` int,
	`refresh_token_ttl` int,
	`signing_algorithm` text,
	`signing_key_id` text,
	`allowed_scopes` text,
	`custom_claims` json,
	`dpop_bound_access_tokens_required` boolean DEFAULT false,
	`disabled` boolean DEFAULT false,
	`created_at` timestamp(3),
	`updated_at` timestamp(3),
	`policy_version` int DEFAULT 1,
	`metadata` json,
	CONSTRAINT `identifier_unique` UNIQUE INDEX(`identifier`)
);
--> statement-breakpoint
CREATE TABLE `oauth_client_resource` (
	`id` varchar(36) PRIMARY KEY,
	`client_id` varchar(255) NOT NULL,
	`resource_id` varchar(255) NOT NULL,
	`metadata` json,
	`created_at` timestamp(3),
	CONSTRAINT `oauthClientResource_clientId_resourceId_uidx` UNIQUE INDEX(`client_id`,`resource_id`)
);
--> statement-breakpoint
ALTER TABLE `account` MODIFY COLUMN `account_id` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `account` ADD `issuer` varchar(191);--> statement-breakpoint
UPDATE `account` SET `issuer` = CASE WHEN `provider_id` = 'credential' THEN 'local:credential' ELSE CONCAT('local:oauth:', `provider_id`) END WHERE `issuer` IS NULL;--> statement-breakpoint
ALTER TABLE `account` MODIFY COLUMN `issuer` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `jwks` ADD `alg` text;--> statement-breakpoint
ALTER TABLE `jwks` ADD `crv` text;--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD `authorization_code_id` varchar(255);--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD `resources` text;--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD `requested_user_info_claims` text;--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD `revoked` timestamp(3);--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD `confirmation` json;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `client_discovery_id` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `client_credentials_scopes` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `backchannel_logout_uri` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `backchannel_logout_session_required` boolean;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `application_type` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `jwks` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `jwks_uri` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `dpop_bound_access_tokens` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `oauth_consent` ADD `resources` text;--> statement-breakpoint
ALTER TABLE `oauth_consent` ADD `requested_user_info_claims` text;--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `authorization_code_id` varchar(255);--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `resources` text;--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `requested_user_info_claims` text;--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `rotated_at` timestamp(3);--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `rotation_replay_response` text;--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `rotation_replay_expires_at` timestamp(3);--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `confirmation` json;--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_accountId_uidx` ON `account` (`issuer`,`account_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_authorizationCodeId_idx` ON `oauth_access_token` (`authorization_code_id`);--> statement-breakpoint
CREATE INDEX `oauthClientResource_clientId_idx` ON `oauth_client_resource` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthClientResource_resourceId_idx` ON `oauth_client_resource` (`resource_id`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_authorizationCodeId_idx` ON `oauth_refresh_token` (`authorization_code_id`);--> statement-breakpoint
ALTER TABLE `oauth_client_resource` ADD CONSTRAINT `oauth_client_resource_client_id_oauth_client_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `oauth_client_resource` ADD CONSTRAINT `oauth_client_resource_dn2L1gs9Dolm_fkey` FOREIGN KEY (`resource_id`) REFERENCES `oauth_resource`(`identifier`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `oauth_client` DROP COLUMN `public`;--> statement-breakpoint
ALTER TABLE `oauth_client` DROP COLUMN `type`;
