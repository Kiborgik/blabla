CREATE TABLE `world_receipts` (
	`world_id` text NOT NULL,
	`receipt_key` text NOT NULL,
	`request_json` text NOT NULL,
	`response_json` text NOT NULL,
	PRIMARY KEY(`world_id`, `receipt_key`),
	FOREIGN KEY (`world_id`) REFERENCES `world_state`(`world_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `world_state` (
	`world_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`initial_json` text NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "world_state_revision_nonnegative" CHECK("world_state"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE `world_transitions` (
	`world_id` text NOT NULL,
	`start_revision` integer NOT NULL,
	`end_revision` integer NOT NULL,
	`receipt_key` text NOT NULL,
	`transition_json` text NOT NULL,
	`provenance_json` text NOT NULL,
	`state_json` text NOT NULL,
	`events_json` text NOT NULL,
	PRIMARY KEY(`world_id`, `end_revision`),
	FOREIGN KEY (`world_id`) REFERENCES `world_state`(`world_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "world_transitions_revision_advances" CHECK("world_transitions"."end_revision" > "world_transitions"."start_revision")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `world_transitions_receipt_unique` ON `world_transitions` (`world_id`,`receipt_key`);