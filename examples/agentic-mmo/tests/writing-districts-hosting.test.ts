import assert from 'node:assert/strict';
import { seedHostedWorld } from './fixtures/current-world.ts';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import type { City, GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalDeparturePrefix, coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput } from './fixtures/coastal-prefix.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const actor = 'synthetic-writing-owner';
const model = 'synthetic-writing-host-fixture';
const campus = { type: 'build', project: 'campus', cityId: 'city-0', tileId: 39 } as const;
const library = { type: 'build', project: 'library', cityId: 'city-0' } as const;
function town(state: WorldState): City { const city = state.cities.find(value => value.id === 'city-0'); assert.ok(city); return city; }
function active(state: WorldState) { const order = town(state).construction?.active; assert.ok(order); return order; }
function completion(state: WorldState) { const result = town(state).construction?.lastCompleted; assert.ok(result); return result; }
function preparedJourney() {
  const prefix = coastalDeparturePrefix('settlement-writing-1');
  let state = prefix.state;
  let seconds = (Date.parse(prefix.timestamp) - Date.parse(coastalPrefixTime(0))) / 1000;
  const steps: CoastalPrefixInput[] = prefix.steps.map(step => step.input);
  const frames: WorldState[] = prefix.steps.map(step => step.result.state);
  const commit = (input: CoastalPrefixInput) => { const result = replayCoastalStep(state, input); assert.ok(result.ok, result.error); state = result.state; steps.push(input); frames.push(state); };
  const action = (value: GameAction) => { assert.ok(legalActions(state, 0, coastalPrefixTime(seconds)).some(option => JSON.stringify(option.action) === JSON.stringify(value))); commit({ kind: 'action', command: { seat: 0, expectedRevision: state.revision, timestamp: coastalPrefixTime(seconds), action: value } }); seconds += 10; };
  const beat = () => { seconds = ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60; commit({ kind: 'strategy', timestamp: coastalPrefixTime(seconds) }); seconds += 10; };
  const prepared = state;
  action({ type: 'research', technology: 'writing' });
  for (let count = 0; count < 40 && !state.civilizations[0]?.technologies.includes('writing'); count++) beat();
  assert.ok(state.civilizations[0]?.technologies.includes('writing'));
  const before = state; const prefixSteps = [...steps]; const beforeSeconds = seconds;
  action(campus); const started = state;
  for (let count = 0; count < 24 && !town(state).buildings.includes('campus'); count++) beat();
  assert.ok(town(state).buildings.includes('campus')); const completed = state;
  action(library); const libraryStarted = state;
  for (let count = 0; count < 24 && !town(state).buildings.includes('library'); count++) beat();
  assert.ok(town(state).buildings.includes('library')); const libraryCompleted = state;
  beat();
  return { initial: prefix.initial, prepared, before, beforeSeconds, prefixSteps, started, completed, libraryStarted, libraryCompleted, operated: state, frames };
}
const journey = preparedJourney();

await test('every fresh Writing fixture action frame canonically retains exact district and Library records', () => {
  for (const state of journey.frames) assert.ok(isWorldState(JSON.parse(JSON.stringify(state))), `revision ${state.revision}`);
  assert.equal(active(journey.started).tileId, 39);
  assert.deepEqual(town(journey.completed).districtSites, { campus: 39 });
  assert.equal(completion(journey.completed).tileId, 39);
  assert.equal(active(journey.libraryStarted).tileId, undefined);
  assert.equal(completion(journey.libraryCompleted).tileId, undefined);
  assert.equal(town(journey.operated).buildingOperations?.library?.lastResult?.status, 'operated');
});

const faults: Array<[string, (state: WorldState) => void]> = [
  ['missing completed mapping', state => { delete town(state).districtSites; }],
  ['null mapping', state => { Reflect.set(town(state), 'districtSites', null); }],
  ['array mapping', state => { Reflect.set(town(state), 'districtSites', []); }],
  ['unknown mapping key', state => { town(state).districtSites = { campus: 39, farm: 56 }; }],
  ['missing Campus entry', state => { town(state).districtSites = {}; }],
  ['noninteger site', state => { town(state).districtSites = { campus: 39.5 }; }],
  ['string site', state => { Reflect.set(town(state), 'districtSites', { campus: '39' }); }],
  ['uninstalled mapped Campus', state => { town(state).buildings = town(state).buildings.filter(id => id !== 'campus'); town(state).construction = { active: null, lastCompleted: null }; }],
  ['missing district feature', state => { state.unlockedFeatures = state.unlockedFeatures.filter(id => id !== 'district-planning'); }],
  ['missing completion tile', state => { delete completion(state).tileId; }],
  ['null completion tile', state => { Reflect.set(completion(state), 'tileId', null); }],
  ['different valid completion tile', state => { completion(state).tileId = 56; }],
  ['foreign current owner', state => { const tile = state.tiles.find(value => value.id === 39); assert.ok(tile); tile.owner = 1; }],
  ['unowned current site', state => { const tile = state.tiles.find(value => value.id === 39); assert.ok(tile); tile.owner = null; }],
  ['current ocean site', state => { const tile = state.tiles.find(value => value.id === 39); assert.ok(tile); tile.terrain = 'ocean'; }],
  ['current mountain site', state => { const tile = state.tiles.find(value => value.id === 39); assert.ok(tile); tile.terrain = 'mountain'; }],
  ['city-center collision', state => { town(state).districtSites = { campus: 57 }; completion(state).tileId = 57; state.events = []; }],
  ['distant owned site', state => { const tile = state.tiles.find(value => value.id === 215); assert.ok(tile); tile.owner = 0; tile.terrain = 'grassland'; town(state).districtSites = { campus: 215 }; completion(state).tileId = 215; state.events = []; }],
  ['unknown site', state => { town(state).districtSites = { campus: 9999 }; completion(state).tileId = 9999; state.events = []; }],
  ['duplicate completed site', state => { const city = state.cities.find(value => value.civId === 0 && value.id !== 'city-0'); assert.ok(city); city.buildings.push('campus'); city.districtSites = { campus: 39 }; }],
  ['retained event wrong tile', state => { const event = state.events.find(value => value.id === completion(state).eventId); assert.ok(event); event.tileId = 56; }],
  ['retained event wrong round', state => { const event = state.events.find(value => value.id === completion(state).eventId); assert.ok(event); event.round--; }],
  ['retained event wrong type', state => { const event = state.events.find(value => value.id === completion(state).eventId); assert.ok(event); event.type = 'other-event'; state.eventCounts['other-event'] = 1; }],
  ['retained event wrong actor', state => { const event = state.events.find(value => value.id === completion(state).eventId); assert.ok(event); event.actor = 1; }],
  ['retained event wrong target', state => { const event = state.events.find(value => value.id === completion(state).eventId); assert.ok(event); event.target = 1; }],
];
for (const [name, corrupt] of faults) await test(`district save rejects ${name}`, () => { const state = structuredClone(journey.completed); corrupt(state); assert.equal(isWorldState(state), false); });

await test('active district reservations require exact sites and remain globally exclusive', () => {
  for (const tileId of [undefined, null, -1, 0.5, '39', 9999, 57]) {
    const state = structuredClone(journey.started); Reflect.set(active(state), 'tileId', tileId);
    assert.equal(isWorldState(state), false);
  }
  const missing = structuredClone(journey.started); delete active(missing).tileId; assert.equal(isWorldState(missing), false);
  const duplicate = structuredClone(journey.started); const other = duplicate.cities.find(city => city.civId === 0 && city.id !== 'city-0'); assert.ok(other);
  other.buildings.push('campus'); other.districtSites = { campus: 39 }; assert.equal(isWorldState(duplicate), false);
  const scalar = structuredClone(journey.libraryStarted); active(scalar).tileId = 56; assert.equal(isWorldState(scalar), false);
  const scalarCompleted = structuredClone(journey.libraryCompleted); completion(scalarCompleted).tileId = 56; assert.equal(isWorldState(scalarCompleted), false);
  const old = structuredClone(journey.initial); town(old).districtSites = { campus: 39 }; assert.equal(isWorldState(old), false);
});

await test('Library active completed and installed records require their own completed Campus', () => {
  for (const fixture of [journey.libraryStarted, journey.libraryCompleted, journey.operated]) {
    const state = structuredClone(fixture); const city = town(state);
    city.buildings = city.buildings.filter(id => id !== 'campus'); delete city.districtSites;
    const last = city.construction?.lastCompleted;
    if (last && !('kind' in last) && last.buildingId === 'campus' && city.construction) city.construction.lastCompleted = null;
    assert.equal(isWorldState(state), false);
  }
});

await test('fresh no-site prerequisites and recorded payment work and trimmed events remain valid', () => {
  assert.ok(isWorldState(journey.initial)); assert.ok(isWorldState(journey.prepared));
  assert.equal(Object.hasOwn(town(journey.prepared), 'districtSites'), false);
  const started = structuredClone(journey.started); active(started).paid = { energy: 0.25 }; active(started).workRequired = 123; town(started).population = 1;
  assert.ok(isWorldState(started));
  const completed = structuredClone(journey.completed); completed.events = []; completion(completed).paid = { culture: 7 }; completion(completed).workRequired = 123; town(completed).population = 1;
  assert.ok(isWorldState(completed));
  const before = JSON.stringify(completed); assert.ok(isWorldState(completed)); assert.equal(JSON.stringify(completed), before);
});

class Statement implements D1Statement {
  private readonly database: WritingDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: WritingDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class WritingDatabase implements D1Database {
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
  private readonly directory = mkdtempSync(join(tmpdir(), 'writing-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new WritingDatabase(this.path);
  constructor() { this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8')); }
  get store() { return new WorldRepository(this.database); }
  async state() { const result = await this.store.read(); assert.ok(result); return result.state; }
  async prefix() {
    seedHostedWorld(this.database.sql, journey.initial);
    for (const [index, step] of journey.prefixSteps.entries()) {
      const meta = { commandId: `prefix-${index}`, model };
      if (step.kind === 'action') await this.store.mutate('action', { ...step.command, ...meta }, actor, step.command.timestamp ?? coastalPrefixTime(0));
      else await this.store.mutate('strategy-catchup', { expectedRevision: (await this.state()).revision, timestamp: step.timestamp, ...meta }, actor, step.timestamp);
    }
    assert.deepEqual(await this.state(), journey.before);
  }
  async input(commandId: string, action: GameAction = campus) { return { seat: 0, expectedRevision: (await this.state()).revision, model, commandId, action: { type: 'strategy-action', action } }; }
  send(input: Record<string, unknown>, seconds: number) { return this.store.mutate('action', input, actor, coastalPrefixTime(seconds)); }
  async beat() { const state = await this.state(); const seconds = ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60; return this.store.mutate('strategy-catchup', { expectedRevision: state.revision, commandId: `beat-${state.revision}`, timestamp: coastalPrefixTime(seconds), model }, actor, coastalPrefixTime(seconds)); }
  reopen() { this.database.sql.close(); this.database = new WritingDatabase(this.path); }
  close() { this.database.sql.close(); rmSync(this.directory, { recursive: true, force: true }); }
}
const dueSeconds = ((journey.before.independentTurns?.strategyTicks ?? 0) + 1) * 60 + 1;
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

await test('real repository Campus and Library preserve exact sites across duplicate restart completion operation and full replay', async context => {
  const item = new Fixture();
  try {
    await item.prefix(); const before = await item.state(); const input = await item.input('campus-once');
    const replies = await Promise.all([item.send(input, dueSeconds), item.send(input, dueSeconds)]);
    assert.equal(replies.filter(reply => reply.duplicate === true).length, 1);
    const started = await item.state(); const caught = catchUpStrategy(before, coastalPrefixTime(dueSeconds)); assert.ok(caught.ok);
    const expected = applyCommand(caught.state, { seat: 0, expectedRevision: caught.state.revision, timestamp: coastalPrefixTime(dueSeconds), action: campus }); assert.ok(expected.ok); assert.deepEqual(started, expected.state);
    assert.equal(active(started).tileId, 39); assert.deepEqual(active(started).paid, { materials: 16, credits: 8 });
    const rows = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), started);
    const duplicate = await item.send(input, dueSeconds + 600); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, started.revision); assert.deepEqual(item.database.records(), rows);
    await assert.rejects(item.send({ ...input, action: { type: 'strategy-action', action: { ...campus, tileId: 56 } } }, dueSeconds), { message: 'idempotency_key_reused' }); assert.deepEqual(item.database.records(), rows);
    for (let count = 0; count < 24 && !town(await item.state()).buildings.includes('campus'); count++) await item.beat();
    const completed = await item.state(); assert.equal(completion(completed).tileId, 39); assert.deepEqual(town(completed).districtSites, { campus: 39 }); item.reopen(); assert.deepEqual(await item.state(), completed);
    const libraryInput = await item.input('library-once', library); const seconds = (completed.independentTurns?.strategyTicks ?? 0) * 60 + 20;
    await item.send(libraryInput, seconds);
    for (let count = 0; count < 24 && !town(await item.state()).buildings.includes('library'); count++) await item.beat();
    const installed = await item.state(); assert.equal(town(installed).buildingOperations?.library?.lastResult, null);
    await item.beat(); const operated = await item.state(); const result = town(operated).buildingOperations?.library?.lastResult;
    assert.equal(result?.status, 'operated'); assert.deepEqual(result.paid, { credits: 1 }); assert.equal(result.residents?.allocated, 3); assert.ok((result.produced.science ?? 0) > 0);
    const finalRows = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), operated);
    assert.equal((await item.send(libraryInput, seconds + 3600)).duplicate, true); assert.deepEqual(item.database.records(), finalRows);
    context.diagnostic(JSON.stringify({ fixture: 'fresh registered-rule prerequisite fixture and every repository action/beat', revision: operated.revision, round: operated.round, replayFrames: await replay(item), campusSite: town(operated).districtSites?.campus, libraryResult: result }));
  } finally { item.close(); }
});

for (const table of ['world_transitions', 'world_receipts']) await test(`${table} failure rolls back due beats exact site reservation payment and receipt before restart retry`, async () => {
  const item = new Fixture();
  try {
    await item.prefix(); const input = await item.input('campus-failure'); const before = item.database.records();
    item.database.sql.exec(`CREATE TRIGGER fail_district BEFORE INSERT ON ${table} WHEN NEW.receipt_key = 'action:campus-failure' BEGIN SELECT RAISE(ABORT, 'synthetic district rollback'); END;`);
    await assert.rejects(item.send(input, dueSeconds), /synthetic district rollback/); assert.deepEqual(item.database.records(), before);
    item.reopen(); assert.deepEqual(item.database.records(), before); item.database.sql.exec('DROP TRIGGER fail_district');
    await item.send(input, dueSeconds); assert.equal(active(await item.state()).tileId, 39);
    const after = item.database.records(); item.reopen(); assert.equal((await item.send(input, dueSeconds + 600)).duplicate, true); assert.deepEqual(item.database.records(), after); await replay(item);
  } finally { item.close(); }
});

await test('exact wrong sites own-town dependency and strict competing CAS refuse without retarget or candidate effects', async () => {
  const item = new Fixture();
  try {
    await item.prefix(); const before = item.database.records();
    for (const action of [{ ...campus, tileId: 57 }, { ...campus, tileId: 9999 }, { ...campus, cityId: 'city-1' }, { type: 'build', project: 'campus', cityId: 'city-0' } as const, library]) {
      await assert.rejects(item.send(await item.input(`refused-${JSON.stringify(action)}`, action), dueSeconds)); assert.deepEqual(item.database.records(), before);
    }
    const state = await item.state(); const input = await item.input('campus-cas');
    const competing = applyCommand(state, { seat: 1, expectedRevision: state.revision, timestamp: coastalPrefixTime(journey.beforeSeconds), action: { type: 'research', technology: 'agriculture' } }); assert.ok(competing.ok, competing.error);
    item.database.beforeBatch = () => { item.database.sql.prepare('UPDATE world_state SET revision=?, state_json=? WHERE world_id=?').run(competing.state.revision, JSON.stringify(competing.state), 'main'); };
    await assert.rejects(item.send(input, dueSeconds), { message: 'stale_revision' }); assert.deepEqual(await item.state(), competing.state); assert.deepEqual(item.database.records().history, before.history); assert.deepEqual(item.database.records().receipts, before.receipts);
    item.reopen(); assert.deepEqual(await item.state(), competing.state);
  } finally { item.close(); }
});

await test('malformed retained district snapshots fail current and exact history reads without repair writes', async () => {
  const item = new Fixture();
  try {
    await item.prefix(); await item.send(await item.input('campus-corrupt'), dueSeconds); const good = await item.state(); const bad = structuredClone(good); active(bad).tileId = 9999;
    item.database.sql.prepare('UPDATE world_state SET state_json=? WHERE world_id=?').run(JSON.stringify(bad), 'main'); const current = item.database.records();
    await assert.rejects(item.store.read(), { message: 'corrupt_or_incompatible_world' }); assert.deepEqual(item.database.records(), current);
    item.database.sql.prepare('UPDATE world_state SET state_json=? WHERE world_id=?').run(JSON.stringify(good), 'main');
    item.database.sql.prepare('UPDATE world_transitions SET state_json=? WHERE end_revision=?').run(JSON.stringify(bad), good.revision); const history = item.database.records();
    await assert.rejects(item.store.history(good.revision - 1, 1), { message: 'corrupt_or_incompatible_world' }); assert.deepEqual(item.database.records(), history);
  } finally { item.close(); }
});
