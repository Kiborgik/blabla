import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, applyRelease, catchUpStrategy, legalActions } from '../core/engine.ts';
import { BUILDINGS } from '../core/content.ts';
import { buildingBaseProduction, districtAdjacencyFacts } from '../core/simulation/districts.ts';
import type { GameAction } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';
import { learningCommerceJourney } from './learning-commerce.test.ts';
import { manufacturingOperationJourney } from './manufacturing-loop.test.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const actor = 'synthetic-manufacturing-owner';
const model = 'synthetic-manufacturing-host-fixture';

class Statement implements D1Statement {
  private readonly database: ManufacturingDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: ManufacturingDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class ManufacturingDatabase implements D1Database {
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
  private readonly directory = mkdtempSync(join(tmpdir(), 'manufacturing-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new ManufacturingDatabase(this.path);
  constructor() { this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8')); }
  get store() { return new WorldRepository(this.database); }
  async state() { const result = await this.store.read(); assert.ok(result); return result.state; }
  async initialize() { await this.store.initialize({ seed: 1701, clockEpoch: coastalPrefixTime(0), commandId: 'initialize' }, actor, coastalPrefixTime(0)); }
  async input(commandId: string, action: GameAction) { return { seat: 0, expectedRevision: (await this.state()).revision, model, commandId, action: { type: 'strategy-action', action } }; }
  send(input: Record<string, unknown>, seconds: number) { return this.store.mutate('action', input, actor, coastalPrefixTime(seconds)); }
  async beat() { const state = await this.state(); const seconds = ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60; return this.store.mutate('strategy-catchup', { expectedRevision: state.revision, commandId: `beat-${state.revision}`, timestamp: coastalPrefixTime(seconds), model }, actor, coastalPrefixTime(seconds)); }
  reopen() { this.database.sql.close(); this.database = new ManufacturingDatabase(this.path); }
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
    await sendStep(item, step, `manufacturing-step-${index}`); assert.deepEqual(await item.state(), step.result.state); assert.ok(isWorldState(await item.state()));
  }
}
function fullJourney() {
  const result = manufacturingOperationJourney(); const journey = result.journey;
  const step = journey.steps.find(item => item.result.state.revision === result.zoneActive.revision);
  assert.ok(step?.input.kind === 'action' && step.input.command.action.type === 'build' && step.input.command.action.tileId !== undefined && step.input.command.timestamp);
  journey.act({ type: 'set-building-operation', buildingId: 'guild-workshop', cityId: 'city-0', enabled: false }); journey.beat();
  return { journey, ready: result.researched, timestamp: step.input.command.timestamp, action: step.input.command.action, started: result.zoneActive, zoneCompleted: result.zoneCompleted, workshopCompleted: result.workshopCompleted, operated: result.operated, steps: [...journey.previous.prefix.steps, ...journey.previous.steps, ...journey.steps] };
}
let cached: ReturnType<typeof fullJourney> | undefined;
function story() { cached ??= fullJourney(); return cached; }

await test('manufacturing predecessor preserves the real connected learning world through SQLite reopen and replay', async () => {
  const previous = learningCommerceJourney().journey; const item = new Fixture();
  try {
    await persist(item, [...previous.prefix.steps, ...previous.steps]); const records = item.database.records(); item.reopen();
    assert.deepEqual(await item.state(), previous.state); assert.deepEqual(item.database.records(), records); assert.equal(await replay(item), previous.state.revision);
    const before = item.database.records(); const request = await item.input('unreleased-manufacturing', { type: 'research', technology: 'iron-working' });
    await assert.rejects(item.send(request, (previous.state.independentTurns?.strategyTicks ?? 0) * 60 + 50)); assert.deepEqual(item.database.records(), before);
  } finally { item.close(); }
});

await test('manufacturing legal exact district and staffed workshop survive one-payment duplicates reopen and full replay', async context => {
  const route = story(); const item = new Fixture();
  try {
    await item.initialize(); let duplicateRevision = 0; let duplicateIndex = -1;
    for (const [index, step] of route.steps.entries()) {
      if (step.result.state.revision === route.started.revision) {
        const replies = await Promise.all([sendStep(item, step, `manufacturing-step-${index}`), sendStep(item, step, `manufacturing-step-${index}`)]);
        assert.equal(replies.filter(reply => reply.duplicate).length, 1); duplicateRevision = step.result.state.revision; duplicateIndex = index;
        const priorActor = step.before.civilizations[0]; const acceptedActor = step.result.state.civilizations[0]; assert.ok(priorActor && acceptedActor);
        assert.equal(priorActor.resources.materials - acceptedActor.resources.materials, 24);
        assert.equal(priorActor.resources.credits - acceptedActor.resources.credits, 12);
      } else await sendStep(item, step, `manufacturing-step-${index}`);
      assert.deepEqual(await item.state(), step.result.state);
    }
    const zone = route.zoneCompleted.cities[0]; assert.ok(zone); assert.equal(zone.districtSites?.['industrial-zone'], route.action.tileId);
    assert.equal(route.workshopCompleted.cities[0]?.buildingOperations?.['guild-workshop']?.lastResult, null);
    const result = route.operated.cities[0]?.buildingOperations?.['guild-workshop']?.lastResult; assert.ok(result);
    assert.deepEqual(result.paid, { energy: 2 }); assert.ok((result.produced.materials ?? 0) > 0); assert.equal(result.residents?.allocated, 3);
    const state = await item.state(); const paused = state.cities[0]?.buildingOperations?.['guild-workshop']?.lastResult; assert.ok(paused);
    assert.equal(paused.status, 'paused'); assert.deepEqual(paused.paid, {}); assert.deepEqual(paused.produced, {}); assert.equal(paused.residents?.allocated, 0);
    const records = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), state);
    const reopened = await item.state(); const definition = BUILDINGS.find(building => building.id === 'industrial-zone'); const city = reopened.cities[0]; assert.ok(definition && city && route.action.tileId !== undefined);
    const adjacency = districtAdjacencyFacts(reopened, definition, route.action.tileId); assert.ok(adjacency); assert.equal(adjacency.source, 'improvement'); assert.deepEqual(adjacency.tileIds, [56]); assert.equal(adjacency.bonus, 1);
    assert.equal(buildingBaseProduction(reopened, city, definition, route.action.tileId).materials, 3);
    const step = route.steps[duplicateIndex]; assert.ok(step); const retry = await sendStep(item, step, `manufacturing-step-${duplicateIndex}`);
    assert.equal(retry.duplicate, true); assert.equal(retry.acceptedRevision, duplicateRevision); assert.deepEqual(item.database.records(), records);
    const changed = { ...stepArguments(step, `manufacturing-step-${duplicateIndex}`), action: { type: 'strategy-action', action: { ...route.action, tileId: 9999 } } };
    await assert.rejects(item.store.mutate('action', changed, actor, route.journey.time()), { message: 'idempotency_key_reused' }); assert.deepEqual(item.database.records(), records);
    context.diagnostic(JSON.stringify({ basis: 'entirely legal predecessor and actual SQLite repository; no injected stock, technology, era or site', revision: state.revision, round: state.round, site: route.action.tileId, adjacency, district: zone.construction?.lastCompleted, operated: result, replayFrames: await replay(item) }));
  } finally { item.close(); }
});

for (const table of ['world_transitions', 'world_receipts']) await test(`manufacturing ${table} fault rolls back due production payment and exact site before one reopened retry`, async () => {
  const route = story(); const item = new Fixture();
  try {
    await persist(item, route.steps, route.ready.revision); const before = item.database.records();
    const seconds = ((route.ready.independentTurns?.strategyTicks ?? 0) + 1) * 60 + 1;
    const input = await item.input('manufacturing-zone-atomic', route.action);
    item.database.sql.exec(`CREATE TRIGGER fail_manufacturing BEFORE INSERT ON ${table} WHEN NEW.receipt_key = 'action:manufacturing-zone-atomic' BEGIN SELECT RAISE(ABORT, 'synthetic manufacturing rollback'); END;`);
    await assert.rejects(item.send(input, seconds), /synthetic manufacturing rollback/); assert.deepEqual(item.database.records(), before);
    item.reopen(); assert.deepEqual(item.database.records(), before); item.database.sql.exec('DROP TRIGGER fail_manufacturing');
    const reply = await item.send(input, seconds); const accepted = await item.state();
    const caught = catchUpStrategy(route.ready, coastalPrefixTime(seconds)); assert.ok(caught.ok, caught.error);
    const priorActor = caught.state.civilizations[0]; const acceptedActor = accepted.civilizations[0]; assert.ok(priorActor && acceptedActor);
    assert.equal(priorActor.resources.materials - acceptedActor.resources.materials, 24);
    assert.equal(priorActor.resources.credits - acceptedActor.resources.credits, 12);
    const order = accepted.cities[0]?.construction?.active; assert.ok(order && !('kind' in order)); assert.equal(order.buildingId, 'industrial-zone'); assert.equal(order.tileId, route.action.tileId);
    const records = item.database.records(); item.reopen(); const duplicate = await item.send(input, seconds + 600);
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, reply.acceptedRevision); assert.deepEqual(item.database.records(), records); await replay(item);
  } finally { item.close(); }
});

await test('manufacturing foreign occupied missing sites and a competing CAS retain zero losing effects', async () => {
  const route = story(); const item = new Fixture();
  try {
    await persist(item, route.steps, route.ready.revision); const before = item.database.records();
    const seconds = ((route.ready.independentTurns?.strategyTicks ?? 0) + 1) * 60 + 1;
    const foreign = route.ready.tiles.find(tile => tile.owner === 1); assert.ok(foreign);
    for (const tileId of [foreign.id, 56, 39, 9999]) {
      const request = await item.input(`invalid-manufacturing-${tileId}`, { ...route.action, tileId });
      await assert.rejects(item.send(request, seconds)); assert.deepEqual(item.database.records(), before);
    }
    const other = route.ready.cities.find(city => city.civId === 0 && city.id !== 'city-0'); assert.ok(other);
    const dependent = await item.input('missing-own-zone', { type: 'build', project: 'guild-workshop', cityId: other.id });
    await assert.rejects(item.send(dependent, seconds)); assert.deepEqual(item.database.records(), before);
    const at = coastalPrefixTime((route.ready.independentTurns?.strategyTicks ?? 0) * 60 + 50);
    const option = legalActions(route.ready, 2, at).find(choice => choice.action.type === 'focus'); assert.ok(option);
    const competing = applyCommand(route.ready, { seat: 2, expectedRevision: route.ready.revision, timestamp: at, action: option.action }); assert.ok(competing.ok, competing.error);
    item.database.beforeBatch = () => { item.database.sql.prepare('UPDATE world_state SET revision=?, state_json=? WHERE world_id=?').run(competing.state.revision, JSON.stringify(competing.state), 'main'); };
    const request = await item.input('manufacturing-cas', route.action);
    await assert.rejects(item.send(request, seconds), { message: 'stale_revision' });
    assert.deepEqual(await item.state(), competing.state); assert.deepEqual(item.database.records().history, before.history); assert.deepEqual(item.database.records().receipts, before.receipts);
    item.reopen(); assert.deepEqual(await item.state(), competing.state);
  } finally { item.close(); }
});

await test('manufacturing exact historical site and workshop dependencies reject corruption without repricing receipts', async () => {
  const route = story(); const old = structuredClone(route.workshopCompleted); old.events = [];
  const town = old.cities[0]; assert.ok(town?.construction?.lastCompleted); town.construction.lastCompleted.paid = { energy: 0.25 }; town.construction.lastCompleted.workRequired = 999;
  assert.ok(isWorldState(old));
  for (const corrupt of [
    (state: typeof old) => { const city = state.cities[0]; assert.ok(city?.districtSites); city.districtSites['industrial-zone'] = 56; },
    (state: typeof old) => { const city = state.cities[0]; assert.ok(city?.districtSites); Reflect.deleteProperty(city.districtSites, 'industrial-zone'); },
    (state: typeof old) => { const city = state.cities[0]; assert.ok(city?.districtSites); city.buildings = city.buildings.filter(id => id !== 'industrial-zone'); Reflect.deleteProperty(city.districtSites, 'industrial-zone'); },
  ]) { const bad = structuredClone(old); corrupt(bad); assert.equal(isWorldState(bad), false); }
  const item = new Fixture();
  try {
    await persist(item, route.steps); const good = await item.state(); const bad = structuredClone(good); const city = bad.cities[0]; assert.ok(city?.districtSites); city.districtSites['industrial-zone'] = 9999;
    item.database.sql.prepare('UPDATE world_state SET state_json=? WHERE world_id=?').run(JSON.stringify(bad), 'main'); const current = item.database.records();
    await assert.rejects(item.store.read(), { message: 'corrupt_or_incompatible_world' }); assert.deepEqual(item.database.records(), current);
    item.database.sql.prepare('UPDATE world_state SET state_json=? WHERE world_id=?').run(JSON.stringify(good), 'main');
    item.database.sql.prepare('UPDATE world_transitions SET state_json=? WHERE end_revision=?').run(JSON.stringify(bad), good.revision); const history = item.database.records();
    await assert.rejects(item.store.history(good.revision - 1, 1), { message: 'corrupt_or_incompatible_world' }); assert.deepEqual(item.database.records(), history);
  } finally { item.close(); }
});
