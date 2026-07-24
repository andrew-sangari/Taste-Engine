CREATE TABLE `feedback_state` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recommendation_snapshots` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`generated_at` text NOT NULL,
	`payload_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`active` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recommendation_snapshots_payload_hash_idx` ON `recommendation_snapshots` (`payload_hash`);--> statement-breakpoint
CREATE TABLE `source_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`source_health_json` text,
	`error_summary` text
);
--> statement-breakpoint
CREATE TABLE `spotify_oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`verifier` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spotify_playlist_selections` (
	`owner_email` text NOT NULL,
	`playlist_id` text NOT NULL,
	`playlist_name` text NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_email`, `playlist_id`)
);
--> statement-breakpoint
CREATE TABLE `spotify_tokens` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` integer NOT NULL,
	`scopes` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spotify_top_artist_windows` (
	`owner_email` text NOT NULL,
	`window_key` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`items_json` text NOT NULL,
	PRIMARY KEY(`owner_email`, `window_key`)
);
