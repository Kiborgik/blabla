import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, applyRelease, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import type { GameAction } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';
import { createWorker } from '../server/worker.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const at = (seconds: number) => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const actor = 'synthetic-strategy-owner';
const model = 'synthetic-strategy-fixture';
function object(value: unknown): Record<string, unknown> { assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value)); return Object.fromEntries(Object.entries(value)); }
async function body(response: Response) { const value: unknown = await response.json(); return object(value); }
class Statement implements D1Statement {
  private readonly db: Database;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(db: Database, sql: string) { this.db = db; this.sql = sql; }
  bind(...values: SqlValue[]) { this.values = values; return this; }
  async all(): Promise<D1Result> { this.db.reads++; return { results: this.db.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.db.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run() { return this.execute(); }
}
class Database implements D1Database {
  readonly sql: DatabaseSync;
  reads = 0;
  batches = 0;
  beforeBatch: (() => void) | null = null;
  constructor(path: string) { this.sql = new DatabaseSync(path); }
  prepare(sql: string): D1Statement { return new Statement(this, sql); }
  async batch(statements: D1Statement[]) {
    this.batches++;
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
  private readonly directory = mkdtempSync(join(tmpdir(), 'strategy-action-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new Database(this.path);
  constructor() { this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8')); }
  get store() { return new WorldRepository(this.database); }
  async initialize(plans = false) {
    await this.store.initialize({ seed: 1701, clockEpoch: epoch, commandId: 'initialize' }, actor, epoch);
    for (const targetReleaseId of ['settlement-foundations-2', 'settlement-independent-1', ...(plans ? ['settlement-plans-1'] : [])]) {
      const state = await this.state();
      await this.store.mutate('release-apply', { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, model, commandId: targetReleaseId }, actor, epoch);
    }
  }
  async state() { const value = await this.store.read(); assert.ok(value); return value.state; }
  async input(action: GameAction = { type: 'focus', focus: 'culture' }, commandId = 'combined') { return { seat: 0, expectedRevision: (await this.state()).revision, model, commandId, action: { type: 'strategy-action', action } }; }
  async send(input: Record<string, unknown>, seconds = 61, mcp = false, authenticated = true) {
    const worker = createWorker(undefined, { now: () => new Date(at(seconds)) });
    const request = new Request(`https://world.test${mcp ? '/mcp' : '/api/action'}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { 'oai-authenticated-user-id': actor } : {}) }, body: JSON.stringify(mcp ? { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'play_action', arguments: input } } : input) });
    return worker.fetch(request, { DB: this.database, AGENT_WRITER_USER_IDS: actor });
  }
  reopen() { this.database.sql.close(); this.database = new Database(this.path); }
  close() { this.database.sql.close(); rmSync(this.directory, { recursive: true, force: true }); }
}

for (const mcp of [false, true]) await test(`${mcp ? 'MCP' : 'HTTP'} explicit combined action commits due upkeep and only the named action at one captured time`, async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    const before = await item.state();
    const input = await item.input();
    const response = await item.send(input, 121, mcp);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const wire = await body(response);
    const reply = mcp ? object(object(wire.result).structuredContent) : wire;
    assert.equal(reply.operation, 'strategy-action');
    assert.equal(reply.strategyTicks, 2);
    assert.equal(reply.strategyStartRevision, before.revision);
    assert.equal(reply.strategyEndRevision, before.revision + 2);
    assert.equal(reply.strategyTimestamp, at(121));
    assert.equal(reply.remainingTicks, 0);
    assert.equal(reply.acceptedRevision, before.revision + 3);
    const caught = catchUpStrategy(before, at(121));
    const acted = applyCommand(caught.state, { seat: 0, expectedRevision: caught.state.revision, action: input.action.action, timestamp: at(121) });
    assert.ok(acted.ok);
    assert.deepEqual(await item.state(), acted.state);
    assert.equal(acted.state.year, before.year);
    assert.equal(acted.state.clockTicks, before.clockTicks);
    assert.equal(acted.state.independentTurns?.actionsInWindow[0], 1);
    const history = await item.store.history(before.revision);
    assert.equal(history.entries.length, 2);
    assert.deepEqual(history.entries.map(entry => entry.transition.kind), ['strategy-catchup', 'action']);
    assert.deepEqual(history.entries[0]?.state, caught.state);
    assert.deepEqual(history.entries[1]?.state, acted.state);
    assert.equal(history.entries[0]?.endRevision, history.entries[1]?.startRevision);
    assert.equal(history.entries[0]?.provenance.kind, 'clock-service');
    assert.equal(history.entries[1]?.provenance.model, model);
    assert.equal(item.database.records().receipts.filter(row => object(row).receipt_key === 'action:combined').length, 1);
    const readback = await item.store.actionReceipt({ commandId: 'combined' }, actor);
    assert.equal(readback.status, 'accepted');
    if (readback.status === 'accepted') assert.equal(readback.acceptedRevision, acted.state.revision);
  } finally { item.close(); }
});

await test('identical combined retries survive real database restart and changed payload reuse refuses without effects', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    const input = await item.input();
    const response = await item.send(input);
    assert.equal(response.status, 200);
    const accepted = await body(response);
    const records = item.database.records();
    item.reopen();
    const repeated = await item.send(input, 999);
    assert.equal(repeated.status, 200);
    assert.deepEqual(await body(repeated), { ...accepted, duplicate: true });
    assert.deepEqual(item.database.records(), records);
    const changed = await item.send({ ...input, action: { type: 'strategy-action', action: { type: 'focus', focus: 'industry' } } }, 999);
    assert.equal(changed.status, 409);
    assert.equal((await body(changed)).error, 'idempotency_key_reused');
    assert.deepEqual(item.database.records(), records);
  } finally { item.close(); }
});

await test('an explicit combined request with no due beat persists one action frame and one receipt only', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    const before = await item.state();
    const response = await item.send(await item.input(), 10);
    assert.equal(response.status, 200);
    const reply = await body(response);
    assert.equal(reply.strategyTicks, 0);
    assert.equal(reply.revision, before.revision + 1);
    assert.deepEqual((await item.store.history(before.revision)).entries.map(entry => entry.transition.kind), ['action']);
  } finally { item.close(); }
});

await test('ordinary overdue action retains its original zero-effect refusal instead of implicitly catching up', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    const input = await item.input();
    const before = item.database.records();
    const response = await item.send({ ...input, action: input.action.action });
    assert.equal(response.status, 400);
    assert.equal((await body(response)).error, 'strategy_catchup_required');
    assert.deepEqual(item.database.records(), before);
  } finally { item.close(); }
});

await test('illegal action, unavailable budget and mismatched attached head roll back candidate upkeep and all storage', async () => {
  const item = new Fixture();
  try {
    await item.initialize(true);
    const invalid = await item.input({ type: 'build', project: 'unknown-building' });
    const before = item.database.records();
    assert.equal((await item.send(invalid)).status, 400);
    assert.deepEqual(item.database.records(), before);
    const valid = await item.input();
    assert.equal((await item.send({ ...valid, plan: [{ action: { type: 'wait' }, reason: 'Mismatch fixture' }] })).status, 400);
    assert.deepEqual(item.database.records(), before);
    const ordinary = { ...valid, commandId: 'ordinary-budget', action: { type: 'wait' } };
    assert.equal((await item.send(ordinary, 0)).status, 200);
    const charged = item.database.records();
    const response = await item.send(await item.input({ type: 'focus', focus: 'industry' }, 'blocked-budget'), 0);
    assert.equal(response.status, 400);
    assert.deepEqual(item.database.records(), charged);
  } finally { item.close(); }
});

await test('attached plan preserves original observation revision while matching the exact inner action', async () => {
  const item = new Fixture();
  try {
    await item.initialize(true);
    const input = await item.input();
    const response = await item.send({ ...input, plan: [{ action: input.action.action, reason: 'Make culture the standing priority' }, { action: { type: 'wait' }, reason: 'Review the next season before another change' }] });
    assert.equal(response.status, 200);
    const state = await item.state();
    assert.equal(state.actionPlans?.[0]?.observedRevision, input.expectedRevision);
    assert.equal(state.actionPlans?.[0]?.committedRevision, state.revision);
    assert.equal(state.actionPlans?.[0]?.items[0]?.status, 'completed');
    assert.equal(state.actionPlans?.[0]?.items[1]?.status, 'needs-review');
    const history = await item.store.history(input.expectedRevision);
    const transition = history.entries.at(-1)?.transition;
    assert.ok(transition?.kind === 'action');
    assert.equal(transition.command.observedRevision, input.expectedRevision);
    assert.deepEqual(transition.command.action, input.action.action);
  } finally { item.close(); }
});

await test('oversized backlog refuses the composite unchanged and explicit upkeep-only drains at most60 without charging an actor', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    const state = await item.state();
    const input = await item.input();
    const before = item.database.records();
    const denied = await item.send(input, 3661);
    assert.equal(denied.status, 400);
    const failure = await body(denied);
    assert.equal(failure.error, 'strategy_backlog_remaining');
    assert.equal(failure.remainingTicks, 61);
    assert.equal(failure.processedTicks, 0);
    assert.deepEqual(item.database.records(), before);
    const upkeep = { ...input, commandId: 'explicit-upkeep', action: { type: 'strategy-catchup', timestamp: at(3661) } };
    const drained = await item.send(upkeep, 3661, true);
    assert.equal(drained.status, 200);
    const reply = object(object((await body(drained)).result).structuredContent);
    assert.equal(reply.operation, 'strategy-catchup');
    assert.equal(reply.remainingTicks, 1);
    const caught = await item.state();
    assert.equal(caught.round, state.round + 60);
    assert.deepEqual(caught.independentTurns?.actionsInWindow, state.independentTurns?.actionsInWindow);
    assert.deepEqual(caught.independentTurns?.lastActionWindow, state.independentTurns?.lastActionWindow);
    assert.equal(caught.clockTicks, state.clockTicks);
    const tail = await item.send(await item.input({ type: 'focus', focus: 'culture' }, 'after-backlog'), 3661);
    assert.equal(tail.status, 200);
    assert.equal((await body(tail)).strategyTicks, 1);
  } finally { item.close(); }
});

await test('upkeep-only has an exact once-only no-op receipt and rejects a future timestamp', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    const state = await item.state();
    const input = { ...await item.input(), action: { type: 'strategy-catchup', timestamp: epoch } };
    const response = await item.send(input, 0);
    assert.equal(response.status, 200);
    const first = await body(response);
    assert.equal(first.operation, 'strategy-catchup');
    assert.equal(first.revision, state.revision);
    const records = item.database.records();
    const repeated = await item.send(input, 61);
    assert.deepEqual(await body(repeated), { ...first, duplicate: true });
    assert.deepEqual(item.database.records(), records);
    const future = await item.send({ ...input, commandId: 'future', action: { type: 'strategy-catchup', timestamp: at(62) } }, 61);
    assert.equal(future.status, 400);
    assert.deepEqual(item.database.records(), records);
  } finally { item.close(); }
});

await test('strict stale revision and real competing CAS discard the entire prepared composite', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    const input = await item.input();
    const state = await item.state();
    const unrelated = applyCommand(state, { seat: 1, expectedRevision: state.revision, action: { type: 'wait' }, timestamp: epoch });
    assert.ok(unrelated.ok && isWorldState(unrelated.state));
    item.database.beforeBatch = () => { item.database.sql.prepare('UPDATE world_state SET revision = ?, state_json = ? WHERE world_id = ?').run(unrelated.state.revision, JSON.stringify(unrelated.state), 'main'); };
    const response = await item.send(input);
    assert.equal(response.status, 409);
    assert.equal((await body(response)).error, 'stale_revision');
    assert.deepEqual(await item.state(), unrelated.state);
    assert.equal((await item.store.history(state.revision)).entries.length, 0);
    assert.equal(item.database.records().receipts.some(row => object(row).receipt_key === 'action:combined'), false);
    const before = item.database.records();
    assert.equal((await item.send(input)).status, 409);
    assert.deepEqual(item.database.records(), before);
  } finally { item.close(); }
});

for (const table of ['world_transitions', 'world_receipts']) await test(`${table} insertion failure rolls back both frames, final state and receipt before an explicit restart retry`, async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    const input = await item.input();
    const before = item.database.records();
    item.database.sql.exec(`CREATE TRIGGER fail_composite BEFORE INSERT ON ${table} WHEN NEW.receipt_key = 'action:combined' BEGIN SELECT RAISE(ABORT, 'synthetic atomic rollback'); END;`);
    assert.equal((await item.send(input)).status, 500);
    assert.deepEqual(item.database.records(), before);
    item.reopen();
    assert.deepEqual(item.database.records(), before);
    item.database.sql.exec('DROP TRIGGER fail_composite');
    assert.equal((await item.send(input)).status, 200);
    assert.equal((await item.store.history(input.expectedRevision)).entries.length, 2);
  } finally { item.close(); }
});

await test('hostile wrappers reject before database access and authenticated method authority remains intact', async () => {
  const item = new Fixture();
  try {
    const base = { seat: 0, expectedRevision: 0, model, commandId: 'bad' };
    const bad = [
      { ...base, action: { type: 'strategy-action' } },
      { ...base, action: { type: 'strategy-action', action: { type: 'wait' }, extra: true } },
      { ...base, action: { type: 'strategy-action', action: { type: 'wait', ignored: true } } },
      { ...base, action: { type: 'strategy-action', action: { type: 'strategy-action', action: { type: 'wait' } } } },
      { ...base, action: { type: 'strategy-action', action: { type: 'wait' } }, choice: 0 },
      { ...base, action: { type: 'strategy-action', action: { type: 'wait' } }, timestamp: epoch },
      { ...base, action: { type: 'strategy-catchup', timestamp: epoch }, plan: [] },
      { ...base, action: { type: 'strategy-catchup', timestamp: 'yesterday' } },
      { ...base, action: { type: 'strategy-catchup', timestamp: at(100) } },
      { ...base, action: { type: 'strategy-action', action: { type: 'wait' } }, seat: 7 },
      { ...base, action: { type: 'strategy-action', action: { type: 'wait' } }, model: '' },
    ];
    for (const input of bad) {
      const before = item.database.reads;
      assert.equal((await item.send(input)).status, 400);
      assert.equal(item.database.reads, before);
      assert.equal(item.database.batches, 0);
    }
    const valid = { ...base, action: { type: 'strategy-action', action: { type: 'wait' } } };
    assert.equal((await item.send(valid, 61, true, false)).status, 401);
    assert.equal(item.database.reads, 0);
  } finally { item.close(); }
});

await test('recorded existing transitions reproduce every persisted composite frame without a new interpreter kind', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    assert.equal((await item.send(await item.input())).status, 200);
    const history = await item.store.history(0);
    let replay = createWorld(1701, epoch);
    for (const entry of history.entries) {
      const transition = entry.transition;
      const result = transition.kind === 'release-apply' ? applyRelease(replay, transition.command) : transition.kind === 'strategy-catchup' ? catchUpStrategy(replay, transition.timestamp) : transition.kind === 'action' ? applyCommand(replay, transition.command) : null;
      assert.ok(result?.ok);
      assert.deepEqual(result.state, entry.state);
      assert.deepEqual(result.events, entry.events);
      replay = result.state;
    }
    assert.deepEqual(replay, await item.state());
  } finally { item.close(); }
});

await test('upkeep-only fingerprints retain the exact submitted envelope rather than discarding changed seat fields', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    const input = { ...await item.input(), action: { type: 'strategy-catchup', timestamp: epoch } };
    assert.equal((await item.send(input, 0)).status, 200);
    const before = item.database.records();
    assert.equal((await item.send({ ...input, seat: 1 }, 0)).status, 409);
    assert.deepEqual(item.database.records(), before);
  } finally { item.close(); }
});

await test('identical competing composites commit one upkeep frame, one action and one original receipt', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    const input = await item.input();
    const responses = await Promise.all([item.send(input), item.send(input)]);
    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    const replies = await Promise.all(responses.map(body));
    assert.equal(replies.filter(reply => reply.duplicate === true).length, 1);
    assert.equal((await item.store.history(input.expectedRevision)).entries.length, 2);
    assert.equal((await item.state()).revision, input.expectedRevision + 2);
  } finally { item.close(); }
});

await test('candidate-state legality allows a named build after due research and refuses a now-duplicate build without upkeep', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    const selected = await item.input();
    assert.equal((await item.send({ ...selected, commandId: 'start-cultivation', action: { type: 'research', technology: 'agriculture' } }, 0)).status, 200);
    const before = await item.state();
    assert.equal(before.civilizations[0]?.technologies.includes('agriculture'), false);
    const input = await item.input({ type: 'build', project: 'farm' }, 'cultivated-fields');
    const response = await item.send(input, 181);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const state = await item.state();
    assert.ok(state.civilizations[0]?.technologies.includes('agriculture'));
    assert.ok(state.cities.find(city => city.civId === 0)?.buildings.includes('farm'));
    const records = item.database.records();
    const duplicate = await item.send(await item.input({ type: 'build', project: 'farm' }, 'do-not-redirect'), 241);
    assert.equal(duplicate.status, 400);
    assert.deepEqual(item.database.records(), records);
  } finally { item.close(); }
});

await test('a trade proposal preserves exact towns and recipe when due research changes its numeric legal position', async () => {
  const item = new Fixture();
  try {
    await item.initialize();
    for (const targetReleaseId of ['settlement-production-1', 'settlement-frontiers-1', 'settlement-specialization-1', 'settlement-recovery-1', 'settlement-civics-1', 'settlement-charters-1', 'settlement-endpoints-1', 'settlement-land-transport-1', 'settlement-operating-exchange-1']) {
      const state = await item.state();
      await item.store.mutate('release-apply', { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, commandId: targetReleaseId, model }, actor, epoch);
    }
    const initial = await item.input();
    assert.equal((await item.send({ ...initial, commandId: 'research-before-trade', action: { type: 'research', technology: 'agriculture' } }, 0)).status, 200);
    const before = await item.state();
    const action: GameAction = { type: 'propose-trade', partner: 4, recipeId: 'energy-for-materials', sourceCityId: 'city-0', recipientCityId: 'city-4' };
    const key = JSON.stringify(action);
    const originalIndex = legalActions(before, 0).findIndex(option => JSON.stringify(option.action) === key);
    const candidate = catchUpStrategy(before, at(181));
    const candidateIndex = legalActions(candidate.state, 0).findIndex(option => JSON.stringify(option.action) === key);
    assert.ok(originalIndex >= 0 && candidateIndex >= 0);
    assert.notEqual(originalIndex, candidateIndex);
    const response = await item.send(await item.input(action, 'exact-trade-after-research'), 181);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const state = await item.state();
    const offered = state.tradeOffers?.find(offer => offer.proposer === 0);
    assert.ok(offered);
    assert.equal(offered.from, 'city-0');
    assert.equal(offered.to, 'city-4');
    assert.equal(offered.terms.recipeId, 'energy-for-materials');
    const transition = (await item.store.history(before.revision)).entries.at(-1)?.transition;
    assert.ok(transition?.kind === 'action');
    assert.deepEqual(transition.command.action, action);
  } finally { item.close(); }
});
