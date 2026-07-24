CREATE TABLE `hosted_taste_snapshots` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`generated_at` text NOT NULL,
	`status` text NOT NULL,
	`payload_json` text NOT NULL,
	`active` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refresh_locks` (
	`lock_name` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
