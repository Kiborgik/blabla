import { sql } from 'drizzle-orm';
import { check, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const worldState = sqliteTable('world_state', {
  worldId: text('world_id').primaryKey().notNull(),
  revision: integer('revision').notNull(),
  initialJson: text('initial_json').notNull(),
  stateJson: text('state_json').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [check('world_state_revision_nonnegative', sql`${table.revision} >= 0`)]);

export const worldTransitions = sqliteTable('world_transitions', {
  worldId: text('world_id').notNull().references(() => worldState.worldId),
  startRevision: integer('start_revision').notNull(),
  endRevision: integer('end_revision').notNull(),
  receiptKey: text('receipt_key').notNull(),
  transitionJson: text('transition_json').notNull(),
  provenanceJson: text('provenance_json').notNull(),
  stateJson: text('state_json').notNull(),
  eventsJson: text('events_json').notNull(),
}, (table) => [
  primaryKey({ columns: [table.worldId, table.endRevision] }),
  uniqueIndex('world_transitions_receipt_unique').on(table.worldId, table.receiptKey),
  check('world_transitions_revision_advances', sql`${table.endRevision} > ${table.startRevision}`),
]);

export const worldReceipts = sqliteTable('world_receipts', {
  worldId: text('world_id').notNull().references(() => worldState.worldId),
  receiptKey: text('receipt_key').notNull(),
  requestJson: text('request_json').notNull(),
  responseJson: text('response_json').notNull(),
}, (table) => [primaryKey({ columns: [table.worldId, table.receiptKey] })]);

export const worldAutonomy = sqliteTable('world_autonomy', {
  worldId: text('world_id').primaryKey().notNull().references(() => worldState.worldId),
  revision: integer('revision').notNull(),
  stateJson: text('state_json').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [check('world_autonomy_revision_positive', sql`${table.revision} > 0`)]);
