CREATE TABLE `data_version_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text(32) NOT NULL,
	`execution_id` text(32) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`snapshot_type` text(8) NOT NULL,
	`record_count` integer DEFAULT 0 NOT NULL,
	`snapshot_data` text DEFAULT '[]' NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dvs_job_version` ON `data_version_snapshot` (`job_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_dvs_exec_id` ON `data_version_snapshot` (`execution_id`);--> statement-breakpoint
CREATE INDEX `idx_dvs_expires_at` ON `data_version_snapshot` (`expires_at`);--> statement-breakpoint
CREATE TABLE `field_change_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text(32) NOT NULL,
	`execution_id` text(32) NOT NULL,
	`record_key` text(256) NOT NULL,
	`operation` text(16) NOT NULL,
	`changes` text DEFAULT '[]' NOT NULL,
	`before_hash` text(64),
	`after_hash` text(64),
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_fca_job_id` ON `field_change_audit` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_fca_exec_id` ON `field_change_audit` (`execution_id`);--> statement-breakpoint
CREATE INDEX `idx_fca_record_key` ON `field_change_audit` (`record_key`);--> statement-breakpoint
CREATE INDEX `idx_fca_operation` ON `field_change_audit` (`operation`);--> statement-breakpoint
CREATE TABLE `department` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text(32) NOT NULL,
	`source_id` text(128) NOT NULL,
	`code` text(64) NOT NULL,
	`name` text(128) NOT NULL,
	`full_name` text(256),
	`parent_source_id` text(128),
	`path` text(512),
	`depth` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`manager` text(64),
	`status` text(16) DEFAULT 'active' NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL,
	`data_source` text(16) DEFAULT 'source' NOT NULL,
	`source_updated_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dept_job_id` ON `department` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_dept_source_id` ON `department` (`job_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_dept_parent` ON `department` (`job_id`,`parent_source_id`);--> statement-breakpoint
CREATE INDEX `idx_dept_code` ON `department` (`job_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_dept_status` ON `department` (`status`);--> statement-breakpoint
CREATE TABLE `dept_sync_execution` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text(32) NOT NULL,
	`execution_id` text(32) NOT NULL,
	`phase` text(16) NOT NULL,
	`total_count` integer DEFAULT 0,
	`created_count` integer DEFAULT 0,
	`updated_count` integer DEFAULT 0,
	`deleted_count` integer DEFAULT 0,
	`failed_count` integer DEFAULT 0,
	`skipped_count` integer DEFAULT 0,
	`error_summary` text(2000),
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dse_job_id` ON `dept_sync_execution` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_dse_exec_id` ON `dept_sync_execution` (`execution_id`);--> statement-breakpoint
CREATE TABLE `user_department` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text(32) NOT NULL,
	`user_source_id` text(128) NOT NULL,
	`dept_source_id` text(128) NOT NULL,
	`is_primary` integer DEFAULT true NOT NULL,
	`position` text(64),
	`joined_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_udept_job_id` ON `user_department` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_udept_user_dept` ON `user_department` (`job_id`,`user_source_id`,`dept_source_id`);--> statement-breakpoint
CREATE INDEX `idx_udept_dept` ON `user_department` (`job_id`,`dept_source_id`);--> statement-breakpoint
ALTER TABLE `integration_job` ADD `write_mode` text(16) DEFAULT 'insert' NOT NULL;--> statement-breakpoint
ALTER TABLE `integration_job` ADD `match_keys` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `integration_job` ADD `conflict_strategy` text(20) DEFAULT 'source_wins' NOT NULL;--> statement-breakpoint
ALTER TABLE `integration_job` ADD `conflict_compare_field` text(64);--> statement-breakpoint
ALTER TABLE `integration_job` ADD `sensitive_fields` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `integration_job` ADD `desensitize_mode` text(12) DEFAULT 'mask' NOT NULL;--> statement-breakpoint
ALTER TABLE `integration_job` ADD `enable_change_audit` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `integration_job` ADD `enable_version_snapshot` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `integration_job` ADD `version_retention_days` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `integration_job` ADD `template_type` text(20) DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE `dead_letter_message` ADD `is_desensitized` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `dead_letter_message` ADD `payload_hash` text(64);