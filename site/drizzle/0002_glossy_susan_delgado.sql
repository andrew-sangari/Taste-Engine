CREATE TABLE `feedback_records` (
	`owner_email` text NOT NULL,
	`feedback_id` text NOT NULL,
	`canonical_event_id` text NOT NULL,
	`event_date_local` text NOT NULL,
	`status` text NOT NULL,
	`recorded_at` text NOT NULL,
	`record_json` text NOT NULL,
	`evidence_json` text,
	`received_at` text NOT NULL,
	PRIMARY KEY(`owner_email`, `feedback_id`)
);
--> statement-breakpoint
CREATE TABLE `recommendation_misses` (
	`miss_id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`event_url` text,
	`event_details` text,
	`submitted_at` text NOT NULL,
	`resolution_stage` text DEFAULT 'untriaged' NOT NULL,
	`resolution_note` text,
	`resolved_at` text
);
