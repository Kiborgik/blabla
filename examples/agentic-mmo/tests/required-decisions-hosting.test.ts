import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BUILDINGS, RESOURCE_IDS } from '../core/content.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';
import { createWorker } from '../server/worker.ts';
import { applyCommand, catchUpStrategy, createWorld, observe } from '../core/engine.ts';
import type { BuildingConstructionOrder, GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';

const epoch = '2026-10-16T00:00:00.000Z';

function released(): WorldState {
  return createWorld(1701, epoch, 'settlement-decisions-1');
}

function syntheticRecords(): WorldState {
  const state = released();
  state.revision = 100;
  state.round = 10;
  assert.ok(state.independentTurns);
  state.independentTurns.strategyTicks = 10;
  const first = state.cities[0];
  const second = state.cities[1];
  const owner = state.civilizations[0];
  assert.ok(first && second && owner);
  first.construction = { active: { id: 'construction-50', cityId: first.id, buildingId: 'farm', ruleVersion: 1, startedRound: 4, paid: { materials: 7.25, credits: 3.5 }, workRequired: 8.5, workDone: 1.25 }, lastCompleted: null };
  second.buildings.push('workshop');
  second.construction = { active: null, lastCompleted: { orderId: 'construction-55', cityId: second.id, buildingId: 'workshop', startedRound: 5, completedRound: 8, paid: { energy: 2.75 }, workRequired: 9.5, eventId: '80:0' } };
  owner.technologies.push('agriculture');
  owner.lastResearchCompletion = { technologyId: 'agriculture', completedRound: 7, eventId: '79:1' };
  return state;
}

function city(state: WorldState, index = 0) { const result = state.cities[index]; assert.ok(result); return result; }
function civilization(state: WorldState, index = 0) { const result = state.civilizations[index]; assert.ok(result); return result; }
function construction(state: WorldState, index = 0) { const result = city(state, index).construction; assert.ok(result); return result; }

function active(state: WorldState): BuildingConstructionOrder {
  const order = state.cities[0]?.construction?.active;
  assert.ok(order && !('kind' in order));
  return order;
}

function completion(state: WorldState) {
  const result = state.cities[1]?.construction?.lastCompleted;
  assert.ok(result);
  return result;
}

function research(state: WorldState) {
  const result = state.civilizations[0]?.lastResearchCompletion;
  assert.ok(result);
  return result;
}

await test('legacy absence and explicit adoption preserve records while stored historical work and cost differ from current tuning', () => {
  const legacy = createWorld(1701, epoch);
  assert.ok(isWorldState(legacy));
  assert.ok(isWorldState(released()));
  const historical = syntheticRecords();
  assert.ok(isWorldState(historical));
  assert.equal(historical.events.some(event => event.id === completion(historical).eventId), false);
  assert.equal(historical.events.some(event => event.id === research(historical).eventId), false);
  const copy = structuredClone(historical);
  assert.ok(isWorldState(historical));
  assert.deepEqual(historical, copy);
});

const faults: Array<[string, (state: WorldState) => void]> = [
  ['construction without released feature', state => { state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== 'recurring-decisions'); }],
  ['null construction envelope', state => { Reflect.set(city(state), 'construction', null); }],
  ['extra construction field', state => { Reflect.set(construction(state), 'queue', []); }],
  ['missing active slot', state => { Reflect.deleteProperty(construction(state), 'active'); }],
  ['unknown active field', state => { Reflect.set(active(state), 'untrusted', true); }],
  ['future order identity', state => { active(state).id = 'construction-101'; }],
  ['blank order identity', state => { active(state).id = ' '; }],
  ['noncanonical order identity', state => { active(state).id = 'construction-050'; }],
  ['foreign exact town', state => { active(state).cityId = 'city-1'; }],
  ['unknown building', state => { active(state).buildingId = 'invented'; }],
  ['active already installed building', state => { city(state).buildings.push('farm'); }],
  ['unknown rule version', state => { Reflect.set(active(state), 'ruleVersion', 2); }],
  ['future start round', state => { active(state).startedRound = 11; }],
  ['negative payment', state => { active(state).paid.materials = -1; }],
  ['unknown payment resource', state => { Reflect.set(active(state).paid, 'gold', 1); }],
  ['nonfinite required work', state => { active(state).workRequired = Infinity; }],
  ['zero required work', state => { active(state).workRequired = 0; }],
  ['negative progress', state => { active(state).workDone = -1; }],
  ['already complete active progress', state => { active(state).workDone = active(state).workRequired; }],
  ['duplicate retained order identity', state => { completion(state).orderId = active(state).id; }],
  ['foreign completed town', state => { completion(state).cityId = 'city-0'; }],
  ['completion before start', state => { completion(state).completedRound = completion(state).startedRound; }],
  ['future completion round', state => { completion(state).completedRound = 11; }],
  ['completion without installed building', state => { city(state, 1).buildings = []; }],
  ['malformed completion reference', state => { completion(state).eventId = 'not-an-event'; }],
  ['future completion event', state => { completion(state).eventId = '101:0'; }],
  ['completion before order revision', state => { completion(state).eventId = '54:0'; }],
  ['extra completion field', state => { Reflect.set(completion(state), 'queue', []); }],
  ['research completion for undiscovered technology', state => { research(state).technologyId = 'kiln-firing'; }],
  ['future research completion round', state => { research(state).completedRound = 11; }],
  ['malformed research event', state => { research(state).eventId = '0:foundation'; }],
  ['extra research completion field', state => { Reflect.set(research(state), 'order', {}); }],
];

for (const [name, corrupt] of faults) await test(`canonical recurring record refuses ${name}`, () => {
  const state = syntheticRecords();
  corrupt(state);
  assert.equal(isWorldState(state), false);
});

const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const actor = 'synthetic-decision-owner';
const model = 'synthetic-decision-host-fixture';
function object(value: unknown): Record<string, unknown> { assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value)); return Object.fromEntries(Object.entries(value)); }
async function body(response: Response): Promise<Record<string, unknown>> { const value: unknown = await response.json(); return object(value); }
class Statement implements D1Statement {
  private readonly database: DecisionDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: DecisionDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class DecisionDatabase implements D1Database {
  readonly sql: DatabaseSync;
  beforeBatch: (() => void) | null = null;
  constructor(path: string) { this.sql = new DatabaseSync(path); }
  prepare(sql: string): D1Statement { return new Statement(this, sql); }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
    const hook = this.beforeBatch;
    this.beforeBatch = null;
    hook?.();
    this.sql.exec('BEGIN');
    try {
      const results = statements.map(statement => { assert.ok(statement instanceof Statement); return statement.execute(); });
      this.sql.exec('COMMIT');
      return results;
    } catch (failure) { this.sql.exec('ROLLBACK'); throw failure; }
  }
  records() { return { state: this.sql.prepare('SELECT * FROM world_state').all(), history: this.sql.prepare('SELECT * FROM world_transitions ORDER BY end_revision').all(), receipts: this.sql.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all() }; }
}
class Fixture {
  private readonly directory = mkdtempSync(join(tmpdir(), 'required-decisions-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new DecisionDatabase(this.path);
  constructor(state?: WorldState) {
    this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8'));
    if (state) this.database.sql.prepare('INSERT INTO world_state (world_id, revision, initial_json, state_json, updated_at) VALUES (?, ?, ?, ?, ?)').run('main', state.revision, JSON.stringify(state), JSON.stringify(state), epoch);
  }
  get store(): WorldRepository { return new WorldRepository(this.database); }
  async initialize(decisions = true): Promise<void> {
    await this.store.initialize({ seed: 1701, clockEpoch: epoch, registeredRulesId: decisions ? 'settlement-decisions-1' : 'settlement-operating-exchange-1', commandId: 'initialize' }, actor, epoch);
  }
  async state(): Promise<WorldState> { const value = await this.store.read(); assert.ok(value); return value.state; }
  async input(action: GameAction, commandId: string, seat = 0, composite = false) { return { seat, expectedRevision: (await this.state()).revision, model, commandId, action: composite ? { type: 'strategy-action', action } : action }; }
  async send(input: Record<string, unknown>, seconds: number): Promise<Response> {
    const worker = createWorker(undefined, { now: () => new Date(at(seconds)) });
    const request = new Request('https://world.test/api/action', { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': actor }, body: JSON.stringify(input) });
    return worker.fetch(request, { DB: this.database, AGENT_WRITER_USER_IDS: actor });
  }
  async beat(round: number): Promise<void> {
    const input = { seat: 0, model, expectedRevision: (await this.state()).revision, commandId: `beat-${round}`, action: { type: 'strategy-catchup', timestamp: at(round * 60) } };
    const response = await this.send(input, round * 60);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  }
  reopen(): void { this.database.sql.close(); this.database = new DecisionDatabase(this.path); }
  close(): void { this.database.sql.close(); rmSync(this.directory, { recursive: true, force: true }); }
}
async function cultivate(item: Fixture): Promise<void> {
  assert.equal((await item.send(await item.input({ type: 'research', technology: 'agriculture' }, 'research-agriculture'), 0)).status, 200);
  await item.beat(3);
  assert.ok((await item.state()).civilizations[0]?.technologies.includes('agriculture'));
}
async function assertReplay(item: Fixture): Promise<void> {
  const stored = await item.store.read();
  assert.ok(stored);
  let state = stored.initial;
  let after = 0;
  for (;;) {
    const page = await item.store.history(after, 3);
    for (const entry of page.entries) {
      const transition = entry.transition;
      const result = transition.kind === 'action' ? applyCommand(state, transition.command) : transition.kind === 'strategy-catchup' ? catchUpStrategy(state, transition.timestamp) : null;
      assert.ok(result?.ok);
      assert.ok(isWorldState(entry.state));
      assert.deepEqual(result.state, entry.state);
      assert.deepEqual(result.events, entry.events);
      state = result.state;
    }
    if (!page.hasMore) break;
    assert.ok(page.nextRevision !== null && page.nextRevision > after);
    after = page.nextRevision;
  }
  assert.deepEqual(state, stored.state);
}

await test('legal hosted construction pays once, retains partial work and completion through restart, exact retry and paged replay', async context => {
  const item = new Fixture();
  try {
    await item.initialize();
    assert.ok((await item.state()).cities.every(settlement => !Object.hasOwn(settlement, 'construction')));
    await cultivate(item);
    const before = await item.state();
    assert.ok(before.civilizations[0]?.lastResearchCompletion);
    const input = await item.input({ type: 'build', project: 'farm', cityId: 'city-0' }, 'farm-order');
    const replies = await Promise.all([item.send(input, 181), item.send(input, 181)]);
    assert.deepEqual(replies.map(reply => reply.status), [200, 200]);
    const receipts = await Promise.all(replies.map(body));
    assert.equal(receipts.filter(reply => reply.duplicate === true).length, 1);
    const started = await item.state();
    const order = active(started);
    assert.equal(order.id, `construction-${started.revision}`);
    assert.equal(order.cityId, 'city-0');
    assert.equal(order.buildingId, 'farm');
    assert.equal(order.workDone, 0);
    assert.equal(started.cities[0]?.buildings.includes('farm'), false);
    const definition = BUILDINGS.find(building => building.id === 'farm');
    assert.ok(definition);
    assert.deepEqual(order.paid, definition.cost);
    for (const resource of RESOURCE_IDS) assert.equal(civilization(started).resources[resource], civilization(before).resources[resource] - (order.paid[resource] ?? 0));
    const frozenOrder = structuredClone(order);
    const records = item.database.records();
    item.reopen();
    assert.deepEqual(await item.state(), started);
    assert.equal((await body(await item.send(input, 999))).duplicate, true);
    assert.deepEqual(item.database.records(), records);
    assert.equal((await item.send(await item.input({ type: 'build', project: 'farm', cityId: 'city-0' }, 'replace-order'), 191)).status, 400);
    assert.deepEqual(item.database.records(), records);
    await item.beat(4);
    const partial = await item.state();
    assert.ok(active(partial).workDone > 0 && active(partial).workDone < order.workRequired);
    assert.equal(partial.cities[0]?.buildings.includes('farm'), false);
    item.reopen();
    assert.deepEqual(await item.state(), partial);
    let finished = partial;
    for (let round = 5; round <= 20 && finished.cities[0]?.construction?.active; round++) { await item.beat(round); finished = await item.state(); }
    const receipt = finished.cities[0]?.construction?.lastCompleted;
    assert.ok(receipt);
    assert.equal(finished.cities[0]?.construction?.active, null);
    assert.equal(finished.cities[0]?.buildings.filter(id => id === 'farm').length, 1);
    assert.equal(receipt.orderId, frozenOrder.id);
    assert.equal(receipt.cityId, frozenOrder.cityId);
    assert.equal(receipt.workRequired, frozenOrder.workRequired);
    assert.deepEqual(receipt.paid, frozenOrder.paid);
    assert.ok(finished.events.some(event => event.id === receipt.eventId && event.type === 'building-completed'));
    assert.equal(observe(finished, 0).decisions?.research.status, 'required');
    assert.equal(observe(finished, 0).decisions?.construction.find(decision => decision.cityId === 'city-0')?.status, 'required');
    const completedRecords = item.database.records();
    item.reopen();
    assert.deepEqual(await item.state(), finished);
    assert.equal((await body(await item.send(input, 2000))).duplicate, true);
    assert.deepEqual(item.database.records(), completedRecords);
    await assertReplay(item);
    context.diagnostic(JSON.stringify({ provenance: 'legal hosted seed/release/research/build/beat sequence; no stock, work or map edits', orderId: receipt.orderId, startedRound: receipt.startedRound, completedRound: receipt.completedRound, researchCompletion: finished.civilizations[0]?.lastResearchCompletion, transitions: completedRecords.history.length }));
  } finally { item.close(); }
});

await test('released Hold after candidate completion rolls back all upkeep and explicit upkeep reveals the required next research', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    assert.equal((await item.send(await item.input({ type: 'research', technology: 'agriculture' }, 'first-research'), 0)).status, 200);
    const before = item.database.records();
    const input = await item.input({ type: 'wait' }, 'refused-hold', 0, true);
    const refused = await item.send(input, 181);
    assert.equal(refused.status, 400);
    const refusal = await body(refused);
    assert.equal(refusal.error, 'required_decisions');
    assert.equal(refusal.reason, 'Required decisions remain: research, construction in city-0');
    assert.deepEqual(refusal.actionOutcome, { status: 'blocked', code: 'required_decisions', reason: refusal.reason });
    assert.deepEqual(item.database.records(), before);
    await item.beat(3);
    const completed = await item.state();
    assert.ok(completed.civilizations[0]?.lastResearchCompletion);
    assert.equal(observe(completed, 0).decisions?.research.status, 'required');
    assert.equal((await item.send(await item.input({ type: 'research', technology: 'water-management' }, 'next-research'), 181)).status, 200);
    const next = await item.state();
    assert.equal(next.civilizations[0]?.researchTarget, 'water-management');
    assert.equal(observe(next, 0).decisions?.research.status, 'active');
    await assertReplay(item);
  } finally { item.close(); }
});

for (const table of ['world_transitions', 'world_receipts']) await test(`${table} failure rolls back construction payment, candidate work and receipt across reopen`, async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    await cultivate(item);
    const input = await item.input({ type: 'build', project: 'farm', cityId: 'city-0' }, 'failed-build', 0, true);
    const before = item.database.records();
    item.database.sql.exec(`CREATE TRIGGER fail_order BEFORE INSERT ON ${table} WHEN NEW.receipt_key = 'action:failed-build' BEGIN SELECT RAISE(ABORT, 'synthetic order rollback'); END;`);
    assert.equal((await item.send(input, 241)).status, 500);
    assert.deepEqual(item.database.records(), before);
    item.reopen();
    assert.deepEqual(item.database.records(), before);
    item.database.sql.exec('DROP TRIGGER fail_order');
    assert.equal((await item.send(input, 241)).status, 200);
    const state = await item.state();
    assert.equal(active(state).workDone, 0);
    assert.equal(city(state).buildings.includes('farm'), false);
    assert.equal((await item.store.history(input.expectedRevision)).entries.length, 2);
    const accepted = item.database.records();
    item.reopen();
    assert.equal((await body(await item.send(input, 301))).duplicate, true);
    assert.deepEqual(item.database.records(), accepted);
    await assertReplay(item);
  } finally { item.close(); }
});

await test('unrelated ordinary actor CAS admits both exact town orders with distinct identities and no repeated payment', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    for (const seat of [0, 1]) assert.equal((await item.send(await item.input({ type: 'research', technology: 'agriculture' }, `cultivate-${seat}`, seat), 0)).status, 200);
    let ready = await item.state();
    for (let round = 1; round <= 24 && ![0, 1].every(seat => civilization(ready, seat).technologies.includes('agriculture')); round++) {
      await item.beat(round);
      ready = await item.state();
    }
    assert.ok([0, 1].every(seat => civilization(ready, seat).technologies.includes('agriculture')));
    const before = await item.state();
    const inputs = await Promise.all([0, 1].map(seat => item.input({ type: 'build', project: 'farm', cityId: `city-${seat}` }, `town-order-${seat}`, seat)));
    assert.equal(inputs[0]?.expectedRevision, inputs[1]?.expectedRevision);
    const responses = await Promise.all(inputs.map(input => item.send(input, before.round * 60 + 1)));
    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    const after = await item.state();
    const orders = [city(after, 0).construction?.active, city(after, 1).construction?.active];
    assert.ok(orders[0] && orders[1]);
    assert.notEqual(orders[0].id, orders[1].id);
    assert.deepEqual(orders.map(order => order?.cityId), ['city-0', 'city-1']);
    for (const seat of [0, 1]) {
      const order = orders[seat];
      assert.ok(order);
      for (const resource of RESOURCE_IDS) assert.equal(civilization(after, seat).resources[resource], civilization(before, seat).resources[resource] - (order.paid[resource] ?? 0));
    }
    assert.equal(after.revision, before.revision + 2);
    assert.ok(isWorldState(after));
    await assertReplay(item);
  } finally { item.close(); }
});

await test('strict composite CAS preserves a real competing state and discards its whole candidate construction', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    await cultivate(item);
    const before = await item.state();
    const input = await item.input({ type: 'build', project: 'farm', cityId: 'city-0' }, 'lost-composite', 0, true);
    const competitor = applyCommand(before, { seat: 1, expectedRevision: before.revision, timestamp: at(181), action: { type: 'research', technology: 'agriculture' } });
    assert.ok(competitor.ok && isWorldState(competitor.state));
    const original = item.database.records();
    item.database.beforeBatch = () => { item.database.sql.prepare('UPDATE world_state SET revision = ?, state_json = ? WHERE world_id = ?').run(competitor.state.revision, JSON.stringify(competitor.state), 'main'); };
    assert.equal((await item.send(input, 241)).status, 409);
    assert.deepEqual(await item.state(), competitor.state);
    const after = item.database.records();
    assert.deepEqual(after.history, original.history);
    assert.deepEqual(after.receipts, original.receipts);
    assert.equal(city(await item.state()).construction, undefined);
    item.reopen();
    assert.deepEqual(await item.state(), competitor.state);
  } finally { item.close(); }
});

await test('foreign target, active replacement, plan mismatch and unaffordable start preserve every durable record', async () => {
  const item = new Fixture();
  let scarce: Fixture | undefined;
  try {
    await item.initialize();
    await cultivate(item);
    const before = item.database.records();
    const invalid: Array<Record<string, unknown>> = [
      await item.input({ type: 'build', project: 'farm', cityId: 'city-1' }, 'foreign-town'),
      await item.input({ type: 'build', project: 'farm', cityId: 'missing' }, 'missing-town'),
      { ...await item.input({ type: 'build', project: 'farm', cityId: 'city-0' }, 'wrong-plan'), plan: [{ action: { type: 'research', technology: 'water-management' }, reason: 'Mismatch fixture' }] },
    ];
    for (const input of invalid) {
      assert.equal((await item.send(input, 181)).status, 400);
      assert.deepEqual(item.database.records(), before);
    }
    const lowStocks = structuredClone(await item.state());
    civilization(lowStocks).resources.materials = 0;
    scarce = new Fixture(lowStocks);
    const lowBefore = scarce.database.records();
    assert.equal((await scarce.send(await scarce.input({ type: 'build', project: 'farm', cityId: 'city-0' }, 'cannot-pay'), 181)).status, 400);
    assert.deepEqual(scarce.database.records(), lowBefore);
    assert.equal((await item.send(await item.input({ type: 'research', technology: 'water-management' }, 'active-research'), 181)).status, 200);
    const committed = item.database.records();
    assert.equal((await item.send(await item.input({ type: 'research', technology: 'kiln-firing' }, 'replace-research'), 191)).status, 400);
    assert.deepEqual(item.database.records(), committed);
  } finally { scarce?.close(); item.close(); }
});

await test('corrupt current and historical recurring records reject explicitly without repair or writes', async () => {
  const item = new Fixture(syntheticRecords());
  try {
    const original = await item.state();
    const corrupt = structuredClone(original);
    active(corrupt).cityId = 'city-1';
    item.database.sql.prepare('UPDATE world_state SET state_json = ? WHERE world_id = ?').run(JSON.stringify(corrupt), 'main');
    const broken = item.database.records();
    await assert.rejects(item.store.read(), { status: 503 });
    assert.deepEqual(item.database.records(), broken);
    item.database.sql.prepare('UPDATE world_state SET state_json = ? WHERE world_id = ?').run(JSON.stringify(original), 'main');
    item.database.sql.prepare('INSERT INTO world_transitions (world_id,start_revision,end_revision,receipt_key,transition_json,provenance_json,state_json,events_json) VALUES (?,?,?,?,?,?,?,?)').run('main', 99, 100, 'synthetic-corrupt-history', JSON.stringify({ kind: 'strategy-catchup', timestamp: at(600) }), JSON.stringify({ kind: 'clock-service', actorUserId: actor }), JSON.stringify(corrupt), '[]');
    const historyBroken = item.database.records();
    await assert.rejects(item.store.history(99, 1), { status: 503 });
    assert.deepEqual(item.database.records(), historyBroken);
    item.reopen();
    await assert.rejects(item.store.history(99, 1), { status: 503 });
    assert.deepEqual(item.database.records(), historyBroken);
  } finally { item.close(); }
});

await test('older released hosted builds remain immediate and replay without new optional records', async () => {
  const item = new Fixture();
  try {
    await item.initialize(false);
    await cultivate(item);
    const before = await item.state();
    assert.equal(civilization(before).lastResearchCompletion, undefined);
    assert.equal((await item.send(await item.input({ type: 'build', project: 'farm', cityId: 'city-0' }, 'legacy-farm'), 181)).status, 200);
    const after = await item.state();
    assert.ok(city(after).buildings.includes('farm'));
    assert.equal(city(after).construction, undefined);
    assert.equal(observe(after, 0).decisions, undefined);
    item.reopen();
    assert.deepEqual(await item.state(), after);
    await assertReplay(item);
  } finally { item.close(); }
});

await test('one bounded last completion survives recent-feed eviction and a later exact-town order', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    await cultivate(item);
    assert.equal((await item.send(await item.input({ type: 'build', project: 'farm', cityId: 'city-0' }, 'first-completion'), 181)).status, 200);
    await item.beat(20);
    const first = await item.state();
    const completed = city(first).construction?.lastCompleted;
    const discovered = civilization(first).lastResearchCompletion;
    assert.ok(completed && discovered);
    assert.equal(first.events.some(event => event.id === completed.eventId), false);
    assert.equal(first.events.some(event => event.id === discovered.eventId), false);
    assert.ok(isWorldState(first));
    item.reopen();
    assert.deepEqual(await item.state(), first);
    assert.equal((await item.send(await item.input({ type: 'build', project: 'workshop', cityId: 'city-0' }, 'second-completion'), 1201)).status, 200);
    const second = await item.state();
    assert.equal(active(second).buildingId, 'workshop');
    assert.deepEqual(city(second).construction?.lastCompleted, completed);
    await item.beat(30);
    const finished = await item.state();
    const last = city(finished).construction?.lastCompleted;
    assert.ok(last && !('kind' in last));
    assert.equal(last.buildingId, 'workshop');
    assert.notEqual(last.orderId, completed.orderId);
    assert.equal(city(finished).construction?.active, null);
    assert.deepEqual(Object.keys(city(finished).construction ?? {}).toSorted(), ['active', 'lastCompleted']);
    assert.ok(isWorldState(finished));
    item.reopen();
    assert.deepEqual(await item.state(), finished);
    await assertReplay(item);
  } finally { item.close(); }
});

for (const boundary of ['round', 'revision'] as const) await test(`a later same-town active order cannot predate its retained completion ${boundary}`, () => {
  const state = syntheticRecords();
  const prior = structuredClone(completion(state));
  prior.cityId = city(state).id;
  city(state).buildings.push('workshop');
  construction(state).lastCompleted = prior;
  construction(state, 1).lastCompleted = null;
  active(state).id = 'construction-90';
  active(state).startedRound = 8;
  assert.ok(isWorldState(state));
  if (boundary === 'round') active(state).startedRound = 7;
  else active(state).id = 'construction-80';
  assert.equal(isWorldState(state), false);
});

for (const composite of [false, true]) for (const lane of ['research', 'construction'] as const)
  await test(`hosted ${composite ? 'atomic' : 'ordinary'} ${lane} replacement preserves canonical commitment reason and every record`, async () => {
    const item = new Fixture();
    try {
      await item.initialize();
      let action: GameAction;
      let seconds: number;
      let reason: string;
      if (lane === 'research') {
        assert.equal((await item.send(await item.input({ type: 'research', technology: 'agriculture' }, 'original-research'), 0)).status, 200);
        action = { type: 'research', technology: 'kiln-firing' };
        seconds = composite ? 61 : 11;
        reason = 'Active research agriculture must finish before another research commitment';
      } else {
        await cultivate(item);
        assert.equal((await item.send(await item.input({ type: 'build', project: 'farm', cityId: 'city-0' }, 'original-order'), 181)).status, 200);
        action = { type: 'build', project: 'workshop', cityId: 'city-0' };
        seconds = composite ? 241 : 191;
        reason = 'Active construction farm in city-0 must finish before another commitment';
      }
      const before = item.database.records();
      const response = await item.send(await item.input(action, 'replacement', 0, composite), seconds);
      assert.equal(response.status, 400);
      const refusal = await body(response);
      assert.equal(refusal.error, 'active_commitment');
      assert.equal(refusal.reason, reason);
      assert.deepEqual(refusal.actionOutcome, { status: 'blocked', code: 'active_commitment', reason });
      assert.deepEqual(item.database.records(), before);
      item.reopen();
      assert.deepEqual(item.database.records(), before);
      await assertReplay(item);
    } finally { item.close(); }
  });

await test('canonical decision refusals do not mask malformed exact actions or attached-plan validation', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    assert.equal((await item.send(await item.input({ type: 'research', technology: 'agriculture' }, 'active-before-invalid'), 0)).status, 200);
    const before = item.database.records();
    const input = await item.input({ type: 'research', technology: 'kiln-firing' }, 'invalid-replacement');
    const malformed = await item.send({ ...input, action: { type: 'research', technology: 'kiln-firing', extra: true } }, 11);
    assert.equal(malformed.status, 400);
    assert.equal((await body(malformed)).error, 'illegal_action');
    assert.deepEqual(item.database.records(), before);
    const mismatched = await item.send({ ...input, plan: [{ action: { type: 'wait' }, reason: 'Explicit mismatching plan fixture' }] }, 11);
    assert.equal(mismatched.status, 400);
    const failed = await body(mismatched);
    assert.equal(failed.error, 'plan_head_mismatch');
    assert.equal(object(failed.actionOutcome).status, 'failed');
    assert.deepEqual(item.database.records(), before);
    const overdue = await item.send(input, 61);
    assert.equal(overdue.status, 400);
    const timing = await body(overdue);
    assert.equal(timing.error, 'strategy_catchup_required');
    assert.equal(object(timing.actionOutcome).status, 'blocked');
    assert.deepEqual(item.database.records(), before);
  } finally { item.close(); }
});
