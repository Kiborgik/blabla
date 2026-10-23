import assert from 'node:assert/strict';
import { seedHostedWorld } from './fixtures/current-world.ts';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';
import { mapExpansionJourney } from './fixtures/map-expansion-journey.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const actor = 'synthetic-map-expansion-owner';
const model = 'synthetic-map-expansion-host-fixture';

class Statement implements D1Statement {
  private readonly database: MapDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: MapDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class MapDatabase implements D1Database {
  readonly sql: DatabaseSync;
  beforeBatch: (() => void) | null = null;
  constructor(path: string) { this.sql = new DatabaseSync(path); }
  prepare(sql: string): D1Statement { return new Statement(this, sql); }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
    const hook = this.beforeBatch; this.beforeBatch = null; hook?.(); this.sql.exec('BEGIN');
    try { const result = statements.map(statement => { assert.ok(statement instanceof Statement); return statement.execute(); }); this.sql.exec('COMMIT'); return result; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
  records() { return { state: this.sql.prepare('SELECT * FROM world_state').all(), history: this.sql.prepare('SELECT * FROM world_transitions ORDER BY end_revision').all(), receipts: this.sql.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all() }; }
}
class Fixture {
  private readonly directory = mkdtempSync(join(tmpdir(), 'map-expansion-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new MapDatabase(this.path);
  constructor() { this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8')); }
  get store() { return new WorldRepository(this.database); }
  async state() { const result = await this.store.read(); assert.ok(result); return result.state; }
  async initialize(state: WorldState) { seedHostedWorld(this.database.sql, state); }
  async input(commandId: string, action: GameAction) { return { seat: 0, expectedRevision: (await this.state()).revision, model, commandId, action: { type: 'strategy-action', action } }; }
  send(input: Record<string, unknown>, seconds: number) { return this.store.mutate('action', input, actor, coastalPrefixTime(seconds)); }
  async beat() { const state = await this.state(); const seconds = ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60; return this.store.mutate('strategy-catchup', { expectedRevision: state.revision, commandId: `beat-${state.revision}`, timestamp: coastalPrefixTime(seconds), model }, actor, coastalPrefixTime(seconds)); }
  reopen() { this.database.sql.close(); this.database = new MapDatabase(this.path); }
  close() { this.database.sql.close(); rmSync(this.directory, { recursive: true, force: true }); }
}
async function replay(item: Fixture) {
  const saved = await item.store.read(); assert.ok(saved); let state = saved.initial; let after = 0; let count = 0;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = await item.store.history(after, 3);
    for (const entry of page.entries) {
      const transition = entry.transition;
      const result = transition.kind === 'action' ? applyCommand(state, transition.command) : transition.kind === 'strategy-catchup' ? catchUpStrategy(state, transition.timestamp) : null;
      assert.ok(result?.ok, result?.error); assert.ok(isWorldState(entry.state)); assert.deepEqual(result.state, entry.state); assert.deepEqual(result.events, entry.events); state = result.state; count++;
    }
    if (!page.hasMore) { assert.deepEqual(state, saved.state); return count; }
    assert.ok(page.nextRevision !== null && page.nextRevision > after); after = page.nextRevision;
  }
  return assert.fail('bounded replay did not terminate');
}

function stepArguments(step: CoastalPrefixStep, commandId: string): Record<string, unknown> {
  const input = step.input;
  if (input.kind === 'strategy') return { expectedRevision: step.before.revision, timestamp: input.timestamp, model, commandId };
  return { seat: input.command.seat, expectedRevision: input.command.expectedRevision, action: { type: 'strategy-action', action: input.command.action }, ...(input.command.plan === undefined ? {} : { plan: input.command.plan }), model, commandId };
}
function sendStep(item: Fixture, step: CoastalPrefixStep, commandId: string) {
  const input = step.input; const timestamp = input.kind === 'strategy' ? input.timestamp : input.command.timestamp; assert.ok(timestamp);
  return item.store.mutate(input.kind === 'strategy' ? 'strategy-catchup' : 'action', stepArguments(step, commandId), actor, timestamp);
}
async function persist(item: Fixture, steps: CoastalPrefixStep[], through = Number.MAX_SAFE_INTEGER, initial = steps[0]?.before): Promise<void> {
  assert.ok(initial); await item.initialize(initial);
  for (const [index, step] of steps.entries()) {
    if (step.result.state.revision > through) break;
    await sendStep(item, step, `map-expansion-step-${index}`); assert.deepEqual(await item.state(), step.result.state); assert.ok(isWorldState(await item.state()));
  }
}

await test('fresh registered small-world geography and asset references persist without synthetic history', async () => {
  const state = createWorld(1701, coastalPrefixTime(0), 'settlement-forest-production-1'); const item = new Fixture();
  try {
    await item.initialize(state);
    assert.equal(state.width, 18); assert.equal(state.height, 12); assert.equal(state.tiles.length, 216);
    assert.deepEqual(state.tiles.map(tile => tile.id), Array.from({ length: 216 }, (_, index) => index));
    assert.ok(state.tiles.every(tile => tile.id === tile.r * 18 + tile.q && tile.q < 18 && tile.r < 12));
    const references = [...state.cities.map(city => city.tileId), ...(state.strategicDeposits?.tileIds ?? []), ...(state.pastoralSites?.tileIds ?? [])];
    assert.ok(references.every(id => id >= 0 && id < 216));
    const records = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), state); assert.deepEqual(item.database.records(), records);
    assert.equal(await replay(item), 0); assert.equal(records.history.length, 0); assert.equal(records.receipts.length, 0);
  } finally { item.close(); }
});

await test('fresh expanded geography reopens exactly and release attempts cannot rewrite it', async () => {
  const state = createWorld(1701, coastalPrefixTime(0), 'settlement-world-expansion-1'); const item = new Fixture();
  try {
    await item.initialize(state); const records = item.database.records();
    assert.equal(state.width, 18); assert.equal(state.height, 24); assert.equal(state.tiles.length, 432);
    assert.deepEqual(state.tiles.map(tile => tile.id), Array.from({ length: 432 }, (_, index) => index));
    assert.ok(state.tiles.every(tile => tile.id === tile.r * 18 + tile.q && tile.r < 24 && tile.q < 18));
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(item.store.mutate('release-apply', { expectedRevision: 0, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-territory-1', model, commandId: 'map-migration-refused' }, actor, coastalPrefixTime(0)), /pre_release_migration_disabled/);
      assert.deepEqual(item.database.records(), records);
    }
    item.reopen(); assert.deepEqual(await item.state(), state); assert.deepEqual((await item.store.read())?.initial, state); assert.equal(await replay(item), 0);
  } finally { item.close(); }
});

for (const table of ['world_transitions', 'world_receipts']) await test(`fresh expanded-world founding ${table} failure rolls back exact payment geography and receipt`, async () => {
  const value = mapExpansionJourney(); const item = new Fixture();
  try {
    const step = value.steps.find(candidate => candidate.result.state.revision === value.founded.revision); assert.ok(step);
    await persist(item, value.steps, step.before.revision, value.initial); const before = item.database.records();
    item.database.sql.exec(`CREATE TRIGGER fail_map BEFORE INSERT ON ${table} WHEN NEW.receipt_key = 'action:map-fault' BEGIN SELECT RAISE(ABORT, 'synthetic map rollback'); END;`);
    await assert.rejects(sendStep(item, step, 'map-fault'), /synthetic map rollback/); assert.deepEqual(item.database.records(), before);
    item.reopen(); assert.deepEqual(await item.state(), step.before); item.database.sql.exec('DROP TRIGGER fail_map');
    const accepted = await sendStep(item, step, 'map-fault'); const committed = item.database.records(); item.reopen();
    const duplicate = await sendStep(item, step, 'map-fault'); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, accepted.acceptedRevision); assert.deepEqual(item.database.records(), committed);
    assert.deepEqual(await item.state(), value.founded); assert.equal(await replay(item), value.steps.filter(candidate => candidate.result.state.revision <= value.founded.revision).length);
  } finally { item.close(); }
});

await test('fresh expanded-world exact founding CAS excludes losing payment history and receipts', async () => {
  const value = mapExpansionJourney(); const item = new Fixture();
  try {
    const step = value.steps.find(candidate => candidate.result.state.revision === value.founded.revision); assert.ok(step?.input.kind === 'action');
    await persist(item, value.steps, step.before.revision, value.initial); const state = await item.state(); const before = item.database.records();
    const timestamp = step.input.command.timestamp; assert.ok(timestamp);
    const option = legalActions(state, 2, timestamp).find(candidate => candidate.action.type === 'focus'); assert.ok(option);
    const competing = applyCommand(state, { seat: 2, expectedRevision: state.revision, timestamp, action: option.action }); assert.ok(competing.ok, competing.error);
    item.database.beforeBatch = () => { item.database.sql.prepare('UPDATE world_state SET revision=?,state_json=? WHERE world_id=?').run(competing.state.revision, JSON.stringify(competing.state), 'main'); };
    await assert.rejects(sendStep(item, step, 'map-cas'), /stale_revision/);
    assert.deepEqual(await item.state(), competing.state); assert.equal((await item.state()).height, 24);
    assert.deepEqual(item.database.records().history, before.history); assert.deepEqual(item.database.records().receipts, before.receipts); item.reopen(); assert.deepEqual(await item.state(), competing.state);
  } finally { item.close(); }
});

await test('fresh expanded world admits exact lower-row town with one payment receipt and useful next opening', async context => {
  const value = mapExpansionJourney(); const item = new Fixture();
  try {
    assert.equal(value.initial.revision, 0);
    assert.ok(value.prepared.cities.some(city => city.civId === 2 && city.tileId === 199));
    const founding = value.steps.find(step => step.input.kind === 'action' && step.input.command.action.type === 'settle' && step.input.command.action.tileId === 218);
    assert.ok(founding); assert.equal(founding.before.revision, value.prepared.revision);
    assert.equal(founding.input.kind, 'action');
    if (founding.input.kind !== 'action') assert.fail('exact founding command absent');
    assert.deepEqual(founding.input.command.action, { type: 'settle', sourceCityId: 'city-2', tileId: 218 });
    await persist(item, value.steps, value.prepared.revision, value.initial);
    const accepted = await sendStep(item, founding, 'map-new-row-town'); const committed = item.database.records();
    assert.deepEqual(await item.state(), value.founded);
    const town = value.founded.cities.find(city => city.tileId === 218); assert.ok(town); assert.equal(town.civId, 2); assert.equal(town.population, 3); assert.equal(town.housing?.baseCapacity, 8);
    assert.equal(value.founded.cities.reduce((total, city) => total + city.population, 0), value.prepared.cities.reduce((total, city) => total + city.population, 0));
    assert.deepEqual(value.founded.tiles.slice(0, 216), value.prepared.tiles.slice(0, 216));
    item.reopen(); const duplicate = await sendStep(item, founding, 'map-new-row-town');
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, accepted.acceptedRevision); assert.deepEqual(item.database.records(), committed);
    const opening = value.steps.at(-1); assert.ok(opening); assert.equal(opening.input.kind, 'strategy');
    await sendStep(item, opening, 'map-new-row-opening'); assert.deepEqual(await item.state(), value.operated);
    const grown = value.operated.cities.find(city => city.id === town.id); assert.ok(grown); assert.equal(grown.tileId, 218); assert.ok(grown.population >= town.population);
    assert.ok(opening.result.events.some(event => event.type === 'settlement-production' && event.actor === 2));
    const saved = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), value.operated); assert.deepEqual(item.database.records(), saved);
    assert.equal(await replay(item), value.steps.length);
    context.diagnostic(JSON.stringify({ basis: 'Fresh synthetic frontier prerequisites, exact lower-row founding and next economy opening', frames: value.steps.length, foundedTile: town.tileId, foundedCity: town.id, foundingRevision: value.founded.revision, operatedRound: value.operated.round, populationAfterOpening: grown.population, currentStateUtf8Bytes: Buffer.byteLength(JSON.stringify(value.operated), 'utf8') }));
  } finally { item.close(); }
});
