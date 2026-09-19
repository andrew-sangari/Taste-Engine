CREATE TABLE `profiles` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`identity_hash` text NOT NULL,
	`owner_email` text NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`legacy_default` integer DEFAULT 0 NOT NULL,
	`legacy_owner_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_identity_hash_idx` ON `profiles` (`identity_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_legacy_owner_key_idx` ON `profiles` (`legacy_owner_key`);--> statement-breakpoint
CREATE INDEX `profiles_owner_email_idx` ON `profiles` (`owner_email`);--> statement-breakpoint
DROP INDEX `recommendation_snapshots_payload_hash_idx`;--> statement-breakpoint
ALTER TABLE `recommendation_snapshots` ADD `profile_id` text;--> statement-breakpoint
ALTER TABLE `recommendation_snapshots` ADD `code_version` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `recommendation_snapshots` ADD `data_schema_version` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `recommendation_snapshots_profile_payload_idx` ON `recommendation_snapshots` (`profile_id`,`payload_hash`);--> statement-breakpoint
CREATE INDEX `recommendation_snapshots_profile_active_idx` ON `recommendation_snapshots` (`profile_id`,`active`,`created_at`);--> statement-breakpoint
ALTER TABLE `feedback_records` ADD `profile_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_records_profile_feedback_idx` ON `feedback_records` (`profile_id`,`feedback_id`);--> statement-breakpoint
CREATE INDEX `feedback_records_profile_recorded_idx` ON `feedback_records` (`profile_id`,`recorded_at`);--> statement-breakpoint
ALTER TABLE `feedback_state` ADD `profile_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_state_profile_id_idx` ON `feedback_state` (`profile_id`);--> statement-breakpoint
ALTER TABLE `hosted_taste_snapshots` ADD `profile_id` text;--> statement-breakpoint
ALTER TABLE `hosted_taste_snapshots` ADD `code_version` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE INDEX `hosted_taste_snapshots_profile_active_idx` ON `hosted_taste_snapshots` (`profile_id`,`active`,`generated_at`);--> statement-breakpoint
ALTER TABLE `recommendation_misses` ADD `profile_id` text;--> statement-breakpoint
CREATE INDEX `recommendation_misses_profile_submitted_idx` ON `recommendation_misses` (`profile_id`,`submitted_at`);--> statement-breakpoint
ALTER TABLE `source_runs` ADD `profile_id` text;--> statement-breakpoint
ALTER TABLE `source_runs` ADD `code_version` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `spotify_oauth_states` ADD `profile_id` text;--> statement-breakpoint
ALTER TABLE `spotify_playlist_selections` ADD `profile_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `spotify_playlist_selections_profile_playlist_idx` ON `spotify_playlist_selections` (`profile_id`,`playlist_id`);--> statement-breakpoint
ALTER TABLE `spotify_tokens` ADD `profile_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `spotify_tokens_profile_id_idx` ON `spotify_tokens` (`profile_id`);--> statement-breakpoint
ALTER TABLE `spotify_top_artist_windows` ADD `profile_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `spotify_top_artist_windows_profile_window_idx` ON `spotify_top_artist_windows` (`profile_id`,`window_key`);
