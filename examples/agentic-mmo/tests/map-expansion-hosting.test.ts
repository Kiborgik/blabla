import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, applyRelease, catchUpStrategy, legalActions } from '../core/engine.ts';
import type { GameAction } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';
import { waterLandOperationJourney } from './fixtures/water-land-journey.ts';
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
  async initialize() { await this.store.initialize({ seed: 1701, clockEpoch: coastalPrefixTime(0), commandId: 'initialize' }, actor, coastalPrefixTime(0)); }
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
      const result = transition.kind === 'action' ? applyCommand(state, transition.command) : transition.kind === 'release-apply' ? applyRelease(state, transition.command) : transition.kind === 'strategy-catchup' ? catchUpStrategy(state, transition.timestamp) : null;
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
  if (input.kind === 'release') return { ...input.command, model, commandId };
  return { seat: input.command.seat, expectedRevision: input.command.expectedRevision, action: { type: 'strategy-action', action: input.command.action }, ...(input.command.plan === undefined ? {} : { plan: input.command.plan }), model, commandId };
}
function sendStep(item: Fixture, step: CoastalPrefixStep, commandId: string) {
  const input = step.input; const timestamp = input.kind === 'strategy' ? input.timestamp : input.command.timestamp; assert.ok(timestamp);
  return item.store.mutate(input.kind === 'strategy' ? 'strategy-catchup' : input.kind === 'release' ? 'release-apply' : 'action', stepArguments(step, commandId), actor, timestamp);
}
async function persist(item: Fixture, steps: CoastalPrefixStep[], through = Number.MAX_SAFE_INTEGER): Promise<void> {
  await item.initialize();
  for (const [index, step] of steps.entries()) {
    if (step.result.state.revision > through) break;
    await sendStep(item, step, `map-expansion-step-${index}`); assert.deepEqual(await item.state(), step.result.state); assert.ok(isWorldState(await item.state()));
  }
}

let cachedPrevious: ReturnType<typeof waterLandOperationJourney> | undefined;
function previous() { cachedPrevious ??= waterLandOperationJourney(); return cachedPrevious; }

await test('map expansion before-half retains all216 exact original tiles and referenced assets across262 real SQLite transitions', async context => {
  const value = previous(); const state = value.grown; const item = new Fixture();
  try {
    assert.equal(state.width, 18); assert.equal(state.height, 12); assert.equal(state.tiles.length, 216);
    assert.deepEqual(state.tiles.map(tile => tile.id), Array.from({ length: 216 }, (_, index) => index));
    assert.ok(state.tiles.every(tile => tile.id === tile.r * 18 + tile.q && tile.q < 18 && tile.r < 12));
    await persist(item, value.journey.steps); const records = item.database.records(); item.reopen();
    assert.deepEqual(await item.state(), state); assert.deepEqual(item.database.records(), records); assert.equal(await replay(item), 262);
    const references = [
      ...state.cities.flatMap(city => [city.tileId, ...Object.values(city.districtSites ?? {}), ...Object.values(city.buildingCatchments ?? {}), ...Object.values(city.improvements ?? {}).map(improvement => improvement.tileId)]),
      ...(state.strategicDeposits?.tileIds ?? []), ...(state.pastoralSites?.tileIds ?? []),
      ...state.routes.flatMap(route => route.agreement?.terms.transport?.tileIds ?? []),
    ];
    assert.ok(references.every(id => id >= 0 && id < 216));
    context.diagnostic(JSON.stringify({ basis: 'Entirely legal262-frame inhabited water-land predecessor', revision: state.revision, width: state.width, height: state.height, tiles: state.tiles.length, retainedReferenceCount: references.length, replayFrames: 262 }));
  } finally { item.close(); }
});

async function forestPredecessor(item: Fixture) {
  const value = previous(); await persist(item, value.journey.steps);
  const state = await item.state(); const timestamp = value.journey.time();
  await item.store.mutate('release-apply', { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-forest-production-1', timestamp, model, commandId: 'map-forest-predecessor' }, actor, timestamp);
  return { state: await item.state(), timestamp };
}
function expansionInput(state: Awaited<ReturnType<Fixture['state']>>, timestamp: string, commandId = 'map-adopt') {
  return { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-world-expansion-1', timestamp, model, commandId };
}
function retainedFields(state: Awaited<ReturnType<Fixture['state']>>) {
  const retained = structuredClone(state);
  for (const key of ['revision', 'releaseId', 'unlockedFeatures', 'events', 'eventCounts', 'height', 'tiles']) Reflect.deleteProperty(retained, key);
  return retained;
}

await test('map expansion prospective legal forest then world successor appends216 sites without rewriting old geography or assets', async context => {
  const item = new Fixture();
  try {
    const { state: before, timestamp } = await forestPredecessor(item); const records = item.database.records();
    assert.equal(before.releaseId, 'settlement-forest-production-1');
    const input = expansionInput(before, timestamp); const accepted = await item.store.mutate('release-apply', input, actor, timestamp);
    const after = await item.state(); assert.equal(after.width, 18); assert.equal(after.height, 24); assert.equal(after.tiles.length, 432);
    assert.deepEqual(after.tiles.slice(0, 216), before.tiles);
    assert.deepEqual(after.tiles.map(tile => tile.id), Array.from({ length: 432 }, (_, index) => index));
    assert.ok(after.tiles.slice(216).every(tile => tile.id === tile.r * 18 + tile.q && tile.r >= 12 && tile.r < 24 && tile.q < 18 && tile.owner === null));
    assert.deepEqual(retainedFields(after), retainedFields(before)); assert.ok(isWorldState(after));
    const committed = item.database.records(); assert.equal(committed.history.length, records.history.length + 1);
    assert.deepEqual(committed.history.slice(0, records.history.length), records.history);
    item.reopen(); assert.deepEqual(await item.state(), after);
    const duplicate = await item.store.mutate('release-apply', input, actor, timestamp); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, accepted.acceptedRevision); assert.deepEqual(item.database.records(), committed);
    const page = await item.store.history(before.revision - 1, 2); assert.deepEqual(page.entries.map(entry => entry.state.height), [12, 24]);
    assert.deepEqual(item.database.records(), committed);
    context.diagnostic(JSON.stringify({ basis: 'Actual legal262-frame prefix then compatible forest and expansion releases', revision: after.revision, oldTiles: before.tiles.length, newTiles: after.tiles.length, replayFrames: await replay(item) }));
  } finally { item.close(); }
});

for (const table of ['world_transitions', 'world_receipts']) await test(`map expansion prospective ${table} insertion fault leaves all old geography and migration receipt unchanged`, async () => {
  const item = new Fixture();
  try {
    const { state, timestamp } = await forestPredecessor(item); const before = item.database.records(); const input = expansionInput(state, timestamp, 'map-fault');
    item.database.sql.exec(`CREATE TRIGGER fail_map BEFORE INSERT ON ${table} WHEN NEW.receipt_key = 'release-apply:map-fault' BEGIN SELECT RAISE(ABORT, 'synthetic map rollback'); END;`);
    await assert.rejects(item.store.mutate('release-apply', input, actor, timestamp), /synthetic map rollback/); assert.deepEqual(item.database.records(), before);
    item.reopen(); assert.deepEqual(await item.state(), state); item.database.sql.exec('DROP TRIGGER fail_map');
    const accepted = await item.store.mutate('release-apply', input, actor, timestamp); const committed = item.database.records(); item.reopen();
    const duplicate = await item.store.mutate('release-apply', input, actor, timestamp); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, accepted.acceptedRevision); assert.deepEqual(item.database.records(), committed);
    assert.equal((await item.state()).tiles.length, 432); assert.equal(await replay(item), accepted.acceptedRevision);
  } finally { item.close(); }
});


await test('map expansion prospective competing legal CAS keeps the old extent and excludes losing migration history', async () => {
  const item = new Fixture();
  try {
    const { state, timestamp } = await forestPredecessor(item); const before = item.database.records();
    const option = legalActions(state, 2, timestamp).find(value => value.action.type === 'focus'); assert.ok(option);
    const competing = applyCommand(state, { seat: 2, expectedRevision: state.revision, timestamp, action: option.action }); assert.ok(competing.ok, competing.error); assert.ok(isWorldState(competing.state));
    item.database.beforeBatch = () => { item.database.sql.prepare('UPDATE world_state SET revision=?,state_json=? WHERE world_id=?').run(competing.state.revision, JSON.stringify(competing.state), 'main'); };
    await assert.rejects(item.store.mutate('release-apply', expansionInput(state, timestamp, 'map-cas'), actor, timestamp), { message: 'stale_revision' });
    assert.deepEqual(await item.state(), competing.state); assert.equal((await item.state()).height, 12);
    assert.deepEqual(item.database.records().history, before.history); assert.deepEqual(item.database.records().receipts, before.receipts); item.reopen(); assert.deepEqual(await item.state(), competing.state);
  } finally { item.close(); }
});

await test('map expansion prospective real successor admits exact appended-row town with one receipt and useful next opening', async context => {
  const value = mapExpansionJourney(); const item = new Fixture();
  try {
    assert.equal(value.previous.steps.length, 263);
    assert.ok(value.previous.state.cities.some(city => city.civId === 2 && city.tileId === 199));
    const founding = value.steps.find(step => step.input.kind === 'action' && step.input.command.action.type === 'settle' && step.input.command.action.tileId === 218);
    assert.ok(founding); assert.equal(founding.before.revision, value.adopted.revision);
    assert.equal(founding.input.kind, 'action');
    if (founding.input.kind !== 'action') assert.fail('exact founding command absent');
    assert.deepEqual(founding.input.command.action, { type: 'settle', sourceCityId: 'city-2', tileId: 218 });
    await persist(item, value.steps, value.adopted.revision);
    const accepted = await sendStep(item, founding, 'map-new-row-town'); const committed = item.database.records();
    assert.deepEqual(await item.state(), value.founded);
    const town = value.founded.cities.find(city => city.tileId === 218); assert.ok(town); assert.equal(town.civId, 2); assert.equal(town.population, 3); assert.equal(town.housing?.baseCapacity, 8);
    assert.equal(value.founded.cities.reduce((total, city) => total + city.population, 0), value.adopted.cities.reduce((total, city) => total + city.population, 0));
    assert.deepEqual(value.founded.tiles.slice(0, 216), value.adopted.tiles.slice(0, 216));
    item.reopen(); const duplicate = await sendStep(item, founding, 'map-new-row-town');
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, accepted.acceptedRevision); assert.deepEqual(item.database.records(), committed);
    const opening = value.steps.at(-1); assert.ok(opening); assert.equal(opening.input.kind, 'strategy');
    await sendStep(item, opening, 'map-new-row-opening'); assert.deepEqual(await item.state(), value.operated);
    const grown = value.operated.cities.find(city => city.id === town.id); assert.ok(grown); assert.equal(grown.tileId, 218); assert.ok(grown.population >= town.population);
    assert.ok(opening.result.events.some(event => event.type === 'settlement-production' && event.actor === 2));
    const saved = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), value.operated); assert.deepEqual(item.database.records(), saved);
    assert.equal(await replay(item), value.steps.length);
    context.diagnostic(JSON.stringify({ basis: 'Actual legal263-frame frontier prefix, two compatible releases, exact new-row founding and next economy opening', frames: value.steps.length, foundedTile: town.tileId, foundedCity: town.id, foundingRevision: value.founded.revision, operatedRound: value.operated.round, populationAfterOpening: grown.population, currentStateUtf8Bytes: Buffer.byteLength(JSON.stringify(value.operated), 'utf8') }));
  } finally { item.close(); }
});
