CREATE TABLE `sys_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text(64) NOT NULL,
	`app_key` text(64) NOT NULL,
	`app_secret_encrypted` text(512) NOT NULL,
	`description` text(255),
	`status` text(16) DEFAULT 'active' NOT NULL,
	`created_by` text(32),
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sys_apps_app_key_unique` ON `sys_apps` (`app_key`);--> statement-breakpoint
CREATE INDEX `idx_apps_app_key` ON `sys_apps` (`app_key`);--> statement-breakpoint
CREATE TABLE `sys_role_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text(32) NOT NULL,
	`permission` text(64) NOT NULL,
	`resource` text(128) DEFAULT '*' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_role_permissions_role` ON `sys_role_permissions` (`role_id`);--> statement-breakpoint
CREATE INDEX `idx_role_permissions_uniq` ON `sys_role_permissions` (`role_id`,`permission`,`resource`);--> statement-breakpoint
CREATE TABLE `sys_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text(32) NOT NULL,
	`name` text(64) NOT NULL,
	`description` text(255),
	`status` text(16) DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sys_roles_code_unique` ON `sys_roles` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `sys_roles_name_unique` ON `sys_roles` (`name`);--> statement-breakpoint
CREATE INDEX `idx_roles_code` ON `sys_roles` (`code`);--> statement-breakpoint
CREATE TABLE `sys_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text(64) NOT NULL,
	`email` text(128),
	`password_hash` text(255) NOT NULL,
	`display_name` text(64),
	`role_id` text(32),
	`status` text(16) DEFAULT 'active' NOT NULL,
	`last_login_at` integer,
	`login_fail_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sys_users_username_unique` ON `sys_users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `sys_users_email_unique` ON `sys_users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_username` ON `sys_users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_users_role` ON `sys_users` (`role_id`);--> statement-breakpoint
CREATE TABLE `datasource` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text(128) NOT NULL,
	`code` text(64) NOT NULL,
	`type` text(32) NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`description` text(255),
	`status` text(16) DEFAULT 'active' NOT NULL,
	`last_test_status` text(16),
	`last_test_at` integer,
	`last_test_error` text(512),
	`created_by` text(32),
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `datasource_code_unique` ON `datasource` (`code`);--> statement-breakpoint
CREATE INDEX `idx_ds_type` ON `datasource` (`type`);--> statement-breakpoint
CREATE INDEX `idx_ds_code` ON `datasource` (`code`);--> statement-breakpoint
CREATE TABLE `integration_job` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text(128) NOT NULL,
	`code` text(64) NOT NULL,
	`description` text(255),
	`source_datasource_id` text(32) NOT NULL,
	`target_datasource_id` text(32) NOT NULL,
	`source_config` text DEFAULT '{}' NOT NULL,
	`target_config` text DEFAULT '{}' NOT NULL,
	`field_mapping` text DEFAULT '[]' NOT NULL,
	`filter_condition` text(1024),
	`sync_mode` text(16) DEFAULT 'full' NOT NULL,
	`watermark_field` text(64),
	`watermark_value` text(128),
	`schedule_type` text(16) DEFAULT 'cron' NOT NULL,
	`schedule_cron` text(64),
	`batch_size` integer DEFAULT 1000 NOT NULL,
	`concurrency` integer DEFAULT 1 NOT NULL,
	`retry_count` integer DEFAULT 3 NOT NULL,
	`retry_interval` integer DEFAULT 60 NOT NULL,
	`status` text(16) DEFAULT 'stopped' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text(32),
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_job_code_unique` ON `integration_job` (`code`);--> statement-breakpoint
CREATE INDEX `idx_job_status` ON `integration_job` (`status`);--> statement-breakpoint
CREATE INDEX `idx_job_schedule` ON `integration_job` (`schedule_type`,`status`);--> statement-breakpoint
CREATE INDEX `idx_job_source` ON `integration_job` (`source_datasource_id`);--> statement-breakpoint
CREATE INDEX `idx_job_target` ON `integration_job` (`target_datasource_id`);--> statement-breakpoint
CREATE TABLE `dead_letter_message` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text(32) NOT NULL,
	`execution_id` text(32) NOT NULL,
	`payload` text NOT NULL,
	`error_message` text(2000),
	`error_type` text(64),
	`retry_count` integer DEFAULT 0 NOT NULL,
	`status` text(16) DEFAULT 'pending' NOT NULL,
	`processed_at` integer,
	`processed_by` text(32),
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dlq_job_id` ON `dead_letter_message` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_dlq_exec_id` ON `dead_letter_message` (`execution_id`);--> statement-breakpoint
CREATE INDEX `idx_dlq_status` ON `dead_letter_message` (`status`);--> statement-breakpoint
CREATE TABLE `job_execution` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text(32) NOT NULL,
	`trigger_type` text(16) NOT NULL,
	`triggered_by` text(32),
	`status` text(16) DEFAULT 'pending' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`duration_ms` integer,
	`total_rows` integer DEFAULT 0,
	`success_rows` integer DEFAULT 0,
	`failed_rows` integer DEFAULT 0,
	`skipped_rows` integer DEFAULT 0,
	`start_watermark` text(128),
	`end_watermark` text(128),
	`error_message` text(2000),
	`error_stack` text(4000),
	`retry_attempts` integer DEFAULT 0,
	`queue_job_id` text(64),
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_exec_job_id` ON `job_execution` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_exec_status` ON `job_execution` (`status`);--> statement-breakpoint
CREATE INDEX `idx_exec_created_at` ON `job_execution` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_exec_job_created` ON `job_execution` (`job_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sys_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text(32),
	`username` text(64),
	`action` text(32) NOT NULL,
	`resource_type` text(64),
	`resource_id` text(64),
	`resource_name` text(256),
	`detail` text,
	`ip` text(64),
	`user_agent` text(512),
	`trace_id` text(64),
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_user_id` ON `sys_audit_log` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_resource` ON `sys_audit_log` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_action` ON `sys_audit_log` (`action`);--> statement-breakpoint
CREATE INDEX `idx_audit_created_at` ON `sys_audit_log` (`created_at`);