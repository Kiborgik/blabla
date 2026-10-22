CREATE TABLE `world_autonomy` (
	`world_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `world_state`(`world_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "world_autonomy_revision_positive" CHECK("world_autonomy"."revision" > 0)
);
