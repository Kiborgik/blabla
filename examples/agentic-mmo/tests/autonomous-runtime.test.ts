import assert from 'node:assert/strict';
import { seedHostedWorld } from './fixtures/current-world.ts';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { applyCommand, applyDirectorTick, applyHistoryAdvance, catchUpClock, catchUpStrategy } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { BEHAVIOR_POLICY_VERSION, FOOD_BUDGET_BEHAVIOR_POLICY_VERSION, createBehaviorMemory } from '../core/behaviors.ts';
import { assertAutonomousState, createAutonomousState, planAutonomousWake } from '../server/autonomous-runner.ts';
import { RequestFailure } from '../server/validation.ts';
import { createWorker } from '../server/worker.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const actor = 'enrolled-simulation-operator';

class Statement implements D1Statement {
  readonly database: DatabaseSync;
  readonly sql: string;
  readonly afterRead: (sql: string) => Promise<void>;
  values: SqlValue[] = [];
  constructor(database: DatabaseSync, sql: string, afterRead: (sql: string) => Promise<void>) { this.database = database; this.sql = sql; this.afterRead = afterRead; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { const results = this.database.prepare(this.sql).all(...this.values); await this.afterRead(this.sql); return { results, meta: { changes: 0 } }; }
  async run(): Promise<D1Result> { return this.execute(); }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.prepare(this.sql).run(...this.values).changes) } }; }
}

class SqliteD1 implements D1Database {
  readonly sqlite: DatabaseSync;
  batches = 0;
  beforeBatch: (() => Promise<void>) | undefined;
  afterWorldRead: (() => Promise<void>) | undefined;
  loseCommitResponse = false;
  constructor(path: string) { this.sqlite = new DatabaseSync(path); }
  prepare(sql: string): D1Statement {
    return new Statement(this.sqlite, sql, async statement => {
      if (!statement.includes('FROM world_state ')) return;
      const after = this.afterWorldRead;
      this.afterWorldRead = undefined;
      if (after) await after();
    });
  }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
    const before = this.beforeBatch;
    this.beforeBatch = undefined;
    if (before) await before();
    this.batches += 1;
    this.sqlite.exec('BEGIN');
    let results: D1Result[];
    try {
      results = statements.map(statement => { assert.ok(statement instanceof Statement); return statement.execute(); });
      this.sqlite.exec('COMMIT');
    } catch (failure) { this.sqlite.exec('ROLLBACK'); throw failure; }
    if (this.loseCommitResponse) { this.loseCommitResponse = false; throw new Error('Committed response lost'); }
    return results;
  }
}

function object(value: unknown): Record<string, unknown> { assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value)); return Object.fromEntries(Object.entries(value)); }
async function json(response: Response): Promise<Record<string, unknown>> { return object(await response.json()); }
function post(path: string, value: Record<string, unknown>, authenticated = true): Request { return new Request(`https://world.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { 'oai-authenticated-user-id': actor } : {}) }, body: JSON.stringify(value) }); }

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'procedural-runtime-'));
  const path = join(directory, 'world.sqlite');
  let database = new SqliteD1(path);
  const journal = JSON.parse(readFileSync(new URL('../server/migrations/meta/_journal.json', import.meta.url), 'utf8')) as { entries: Array<{ tag: string }> };
  for (const entry of journal.entries) database.sqlite.exec(readFileSync(new URL(`../server/migrations/${entry.tag}.sql`, import.meta.url), 'utf8'));
  let time = epoch;
  const worker = createWorker(undefined, { now: () => new Date(time) });
  const env = () => ({ DB: database, AGENT_WRITER_USER_IDS: actor });
  const repository = () => new WorldRepository(database);
  return {
    worker, env, repository, database: () => database, setTime: (value: string) => { time = value; },
    restart: () => { database.sqlite.close(); database = new SqliteD1(path); },
    cleanup: () => { database.sqlite.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

async function initialize(item: ReturnType<typeof fixture>, independent = false, registeredRulesId = independent ? 'settlement-independent-1' : 'settlement-foundations-1') {
  await item.repository().initialize({ seed: 1701, clockEpoch: epoch, registeredRulesId, commandId: 'initial' }, actor, epoch);
}

async function activate(item: ReturnType<typeof fixture>) {
  const revision = await item.repository().revision();
  assert.notEqual(revision, null);
  const response = await item.worker.fetch(post('/api/simulation/activate', { expectedRevision: revision, enabled: true, commandId: 'activate' }), item.env());
  assert.equal(response.status, 200, JSON.stringify(await json(response)));
}

async function wake(item: ReturnType<typeof fixture>, commandId = 'wake-1') {
  const response = await item.worker.fetch(post('/api/simulation/run', { commandId }), item.env());
  const value = await json(response);
  assert.equal(response.status, 200, JSON.stringify(value));
  return value;
}

function snapshot(item: ReturnType<typeof fixture>) {
  return ['world_state', 'world_transitions', 'world_receipts', 'world_autonomy'].map(table => item.database().sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all());
}

void test('observation never activates or advances a procedural world and writes retain enrollment', async () => {
  const item = fixture();
  try {
    await initialize(item);
    const before = snapshot(item);
    item.setTime('2026-10-16T03:00:00.000Z');
    for (const path of ['/api/world', '/api/observe', '/api/simulation', '/api/chronicle']) assert.equal((await item.worker.fetch(new Request(`https://world.test${path}`), item.env())).status, 200);
    assert.equal((await item.repository().simulation()).enabled, false);
    assert.deepEqual(snapshot(item), before);
    assert.equal((await item.worker.fetch(post('/api/simulation/run', { commandId: 'no-activation' }), item.env())).status, 409);
    for (const path of ['/api/simulation/activate', '/api/simulation/run']) assert.equal((await item.worker.fetch(post(path, { commandId: 'unauthorized', expectedRevision: 0, enabled: true }, false), item.env())).status, 401);
    assert.deepEqual(snapshot(item), before);
  } finally { item.cleanup(); }
});

void test('activation is explicit, idempotent and does not alter existing world or historical provenance', async () => {
  const item = fixture();
  try {
    await initialize(item, true);
    const before = await item.repository().read();
    const history = await item.repository().history();
    await activate(item);
    assert.deepEqual(await item.repository().read(), before);
    assert.deepEqual(await item.repository().history(), history);
    const duplicate = await item.worker.fetch(post('/api/simulation/activate', { expectedRevision: 0, enabled: true, commandId: 'activate' }), item.env());
    assert.equal((await json(duplicate)).duplicate, true);
    assert.equal((await item.repository().simulation()).runtimeRevision, 1);
    assert.equal((await item.worker.fetch(post('/api/simulation/activate', { expectedRevision: 0, enabled: false, commandId: 'activate' }), item.env())).status, 409);
    assert.equal((await item.repository().simulation()).enabled, true);
    assert.equal(history.entries.length, 0);
  } finally { item.cleanup(); }
});

void test('one wake records all six exact legal procedural commands and atomic durable memories', async () => {
  const item = fixture();
  try {
    await initialize(item, true);
    await activate(item);
    const value = await wake(item);
    assert.equal(object(value.simulation).decisions, 6);
    const status = await item.repository().simulation();
    assert.equal(status.wakeCount, 1);
    assert.deepEqual(status.actors.map(entry => entry.decisions), [1, 1, 1, 1, 1, 1]);
    const history = await item.repository().history();
    const procedural = history.entries.filter(entry => entry.provenance.kind === 'procedural-policy');
    assert.equal(procedural.length, 6);
    for (const entry of procedural) {
      assert.equal(entry.provenance.model, null);
      assert.ok(entry.provenance.policy?.reason);
      assert.equal(entry.provenance.policy?.decision, 1);
      const receipt = item.database().sqlite.prepare('SELECT response_json FROM world_receipts WHERE receipt_key = ?').get(entry.provenance.commandId);
      assert.ok(receipt);
      assert.equal(object(JSON.parse(String(receipt.response_json))).acceptedRevision, entry.endRevision);
    }
    const current = await item.repository().read();
    assert.ok(current);
    let reproduced = current.initial;
    for (const entry of history.entries) {
      const transition = entry.transition;
      const result = transition.kind === 'action' ? applyCommand(reproduced, transition.command)
        : transition.kind === 'director-tick' ? applyDirectorTick(reproduced, transition.command)
            : transition.kind === 'history-advance' ? applyHistoryAdvance(reproduced, transition.command)
              : transition.kind === 'strategy-catchup' ? catchUpStrategy(reproduced, transition.timestamp) : catchUpClock(reproduced, transition.timestamp);
      assert.equal(result.ok, true, result.error);
      assert.deepEqual(result.state, entry.state);
      reproduced = result.state;
    }
    assert.deepEqual(reproduced, current.state);
    const publicHistory = await json(await item.worker.fetch(new Request('https://world.test/api/chronicle'), item.env()));
    assert.equal(JSON.stringify(publicHistory).includes(actor), false);
    assert.equal(JSON.stringify(publicHistory).includes('procedural-policy'), true);
    assert.equal(JSON.stringify(publicHistory).includes('profileId'), true);
  } finally { item.cleanup(); }
});

void test('duplicate and concurrent wakes cannot duplicate decisions, including sequential worlds', async () => {
  for (const independent of [false, true]) {
    const item = fixture();
    try {
      await initialize(item, independent);
      await activate(item);
      const responses = await Promise.all(['same-wake', 'same-wake', 'different-wake'].map(commandId => wake(item, commandId)));
      assert.equal(responses.filter(response => response.duplicate === true).length, 1);
      assert.deepEqual((await item.repository().simulation()).actors.map(entry => entry.decisions), [1, 1, 1, 1, 1, 1]);
      const history = await item.repository().history();
      assert.equal(history.entries.filter(entry => entry.provenance.kind === 'procedural-policy').length, 6);
      assert.equal(object((await wake(item, 'another-same-window')).simulation).decisions, 0);
      item.setTime('2026-10-16T00:00:10.000Z');
      assert.equal(object((await wake(item, 'next-window')).simulation).decisions, 6);
    } finally { item.cleanup(); }
  }
});

void test('world and policy reads remain coherent when another wake commits across the read boundary', async () => {
  for (const operation of ['wake', 'status', 'configure']) {
    const item = fixture();
    try {
      await initialize(item, true);
      await activate(item);
      item.setTime('2026-10-16T00:01:00.000Z');
      let competingWakes = 0;
      item.database().afterWorldRead = async () => {
        competingWakes += 1;
        assert.equal(object((await wake(item, 'read-boundary-competitor')).simulation).decisions, 6);
      };
      if (operation === 'wake') assert.equal(object((await wake(item, 'outer-read-boundary')).simulation).decisions, 0);
      else if (operation === 'status') assert.equal((await item.repository().simulation()).wakeCount, 0);
      else {
        const response = await item.worker.fetch(post('/api/simulation/activate', { expectedRevision: 0, enabled: false, commandId: 'stale-configure' }), item.env());
        assert.equal(response.status, 409);
        assert.equal((await json(response)).error, 'stale_simulation_revision');
      }
      assert.equal(competingWakes, 1);
      const current = await item.repository().read();
      assert.equal(current?.state.round, 1);
      assert.equal(current?.state.revision, 7);
      const status = await item.repository().simulation();
      assert.equal(status.enabled, true);
      assert.equal(status.wakeCount, operation === 'wake' ? 2 : 1);
      assert.deepEqual(status.actors.map(entry => entry.decisions), [1, 1, 1, 1, 1, 1]);
      assert.equal((await item.repository().history()).entries.filter(entry => entry.provenance.kind === 'procedural-policy').length, 6);
    } finally { item.cleanup(); }
  }
});

void test('restart and lost commit responses reconcile the original receipt without rechoosing', async () => {
  const item = fixture();
  try {
    await initialize(item, true);
    await activate(item);
    item.database().loseCommitResponse = true;
    const recovered = await wake(item, 'response-lost');
    assert.equal(recovered.duplicate, true);
    const before = snapshot(item);
    item.restart();
    item.setTime('2026-10-16T00:03:00.000Z');
    const duplicate = await wake(item, 'response-lost');
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.acceptedRevision, recovered.acceptedRevision);
    assert.deepEqual(snapshot(item), before);
    assert.equal((await item.repository().simulation()).wakeCount, 1);
  } finally { item.cleanup(); }
});

void test('a receipt failure rolls back all world, history and policy-memory changes', async () => {
  const item = fixture();
  try {
    await initialize(item, true);
    await activate(item);
    item.database().sqlite.exec("CREATE TRIGGER reject_wake BEFORE INSERT ON world_receipts WHEN NEW.receipt_key = 'simulation-wake:failed' BEGIN SELECT RAISE(ABORT, 'receipt failed'); END");
    const before = snapshot(item);
    const response = await item.worker.fetch(post('/api/simulation/run', { commandId: 'failed' }), item.env());
    assert.equal(response.status, 500);
    assert.deepEqual(snapshot(item), before);
    item.database().sqlite.exec('DROP TRIGGER reject_wake');
    assert.equal(object((await wake(item, 'failed')).simulation).decisions, 6);
    assert.deepEqual((await item.repository().simulation()).actors.map(entry => entry.decisions), [1, 1, 1, 1, 1, 1]);
  } finally { item.cleanup(); }
});

void test('a competing committed world update is reobserved after a zero-effect CAS loss', async () => {
  const item = fixture();
  try {
    await initialize(item, true);
    await activate(item);
    item.database().beforeBatch = async () => {
      await item.repository().mutate('action', { expectedRevision: 0, seat: 0, action: { type: 'wait' }, model: 'historical-development-agent', commandId: 'concurrent-human-owned-action' }, actor, epoch);
    };
    const value = await wake(item);
    assert.equal(object(value.simulation).decisions, 5);
    assert.deepEqual((await item.repository().simulation()).actors.map(entry => entry.decisions), [0, 1, 1, 1, 1, 1]);
    assert.equal((await item.repository().history()).entries.filter(entry => entry.provenance.commandId === 'concurrent-human-owned-action').length, 1);
  } finally { item.cleanup(); }
});

void test('bounded upkeep reports remaining work and never spends missed tactical allowances', async () => {
  const item = fixture();
  try {
    await initialize(item, true);
    await activate(item);
    item.setTime('2026-10-16T02:01:00.000Z');
    const first = object((await wake(item, 'backlog-1')).simulation);
    assert.equal(first.strategyTicks, 60);
    assert.equal(first.remainingStrategyTicks, 61);
    assert.equal(first.decisions, 0);
    assert.deepEqual((await item.repository().simulation()).actors.map(entry => entry.decisions), [0, 0, 0, 0, 0, 0]);
    const second = object((await wake(item, 'backlog-2')).simulation);
    assert.equal(second.strategyTicks, 60);
    assert.equal(second.remainingStrategyTicks, 1);
    assert.equal(second.decisions, 0);
    const last = object((await wake(item, 'backlog-3')).simulation);
    assert.equal(last.strategyTicks, 1);
    assert.equal(last.remainingStrategyTicks, 0);
    assert.equal(last.decisions, 6);
    assert.equal(object((await wake(item, 'same-time')).simulation).decisions, 0);
    const current = await item.repository().read();
    assert.equal(current?.state.independentTurns?.strategyTicks, 121);
    assert.equal(current?.state.clockTicks, 20);
  } finally { item.cleanup(); }
});

void test('pause preserves policy memory and a resume cannot reset the current decision window', async () => {
  const item = fixture();
  try {
    await initialize(item);
    await activate(item);
    await wake(item);
    const revision = await item.repository().revision();
    await item.repository().configureSimulation({ expectedRevision: revision, enabled: false, commandId: 'pause' }, actor, epoch);
    const before = snapshot(item);
    assert.equal((await item.worker.fetch(post('/api/simulation/run', { commandId: 'paused' }), item.env())).status, 409);
    assert.deepEqual(snapshot(item), before);
    await item.repository().configureSimulation({ expectedRevision: revision, enabled: true, commandId: 'resume' }, actor, epoch);
    assert.equal(object((await wake(item, 'resumed')).simulation).decisions, 0);
    assert.deepEqual((await item.repository().simulation()).actors.map(entry => entry.decisions), [1, 1, 1, 1, 1, 1]);
  } finally { item.cleanup(); }
});

void test('unsupported inputs and corrupt policy state fail closed with no world effects', async () => {
  const item = fixture();
  try {
    await initialize(item, true);
    await activate(item);
    for (const extra of [{ action: { type: 'wait' } }, { model: 'pretend-model' }, { timestamp: '2099-01-01T00:00:00.000Z' }, { seat: 5 }]) {
      const before = snapshot(item);
      assert.equal((await item.worker.fetch(post('/api/simulation/run', { commandId: 'injected', ...extra }), item.env())).status, 400);
      assert.deepEqual(snapshot(item), before);
    }
    item.database().sqlite.prepare("UPDATE world_autonomy SET state_json = json_set(state_json, '$.memories[0].decisionCount', -1)").run();
    const corrupt = snapshot(item);
    assert.equal((await item.worker.fetch(post('/api/simulation/run', { commandId: 'corrupt' }), item.env())).status, 503);
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/simulation'), item.env())).status, 503);
    assert.equal((await item.worker.fetch(post('/api/simulation/activate', { expectedRevision: 0, enabled: false, commandId: 'corrupt-pause' }), item.env())).status, 503);
    assert.deepEqual(snapshot(item), corrupt);
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/world'), item.env())).status, 200);
  } finally { item.cleanup(); }
});

void test('a procedural decision cannot be exposed as a model decision after provenance corruption', async () => {
  const item = fixture();
  try {
    await initialize(item, true);
    await activate(item);
    await wake(item);
    item.database().sqlite.prepare("UPDATE world_transitions SET provenance_json = json_set(provenance_json, '$.model', 'not-a-model-call') WHERE receipt_key = 'simulation-step:wake-1:seat-0'").run();
    const before = snapshot(item);
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/chronicle'), item.env())).status, 503);
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/history'), item.env())).status, 503);
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/world'), item.env())).status, 200);
    assert.deepEqual(snapshot(item), before);
  } finally { item.cleanup(); }
});

void test('coherent simulation reads preserve fail-closed validation of the original world', async () => {
  const item = fixture();
  try {
    await initialize(item, true);
    await activate(item);
    item.database().sqlite.prepare("UPDATE world_state SET initial_json = '{}'").run();
    const before = snapshot(item);
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/simulation'), item.env())).status, 503);
    assert.equal((await item.worker.fetch(post('/api/simulation/activate', { expectedRevision: 0, enabled: false, commandId: 'invalid-initial-pause' }), item.env())).status, 503);
    assert.equal((await item.worker.fetch(post('/api/simulation/run', { commandId: 'invalid-initial-wake' }), item.env())).status, 503);
    assert.deepEqual(snapshot(item), before);
  } finally { item.cleanup(); }
});

void test('identical persisted seeds and wake times produce the same world across process restarts', async () => {
  const left = fixture();
  const right = fixture();
  try {
    for (const item of [left, right]) { await initialize(item, true); await activate(item); }
    for (let index = 0; index < 8; index += 1) {
      const timestamp = new Date(Date.parse(epoch) + index * 10_000).toISOString();
      left.setTime(timestamp); right.setTime(timestamp);
      await wake(left, `left-${index}`);
      right.restart();
      await wake(right, `right-${index}`);
      assert.deepEqual(await left.repository().read(), await right.repository().read());
      assert.deepEqual(await left.repository().simulation(), await right.repository().simulation());
    }
  } finally { left.cleanup(); right.cleanup(); }
});

void test('released exact-town commitments keep their bounded plans and procedural reasons', async () => {
  const item = fixture();
  try {
    await initialize(item, true, 'settlement-regional-targets-1');
    await activate(item);
    for (let index = 0; index < 12; index += 1) {
      item.setTime(new Date(Date.parse(epoch) + index * 10_000).toISOString());
      assert.equal(object((await wake(item, `mature-${index}`)).simulation).decisions, 6);
    }
    const current = await item.repository().read();
    assert.ok(current);
    assert.ok(current.state.actionPlans?.every(plan => plan !== null && plan.items.length === 1 && plan.items[0]?.status === 'completed'));
    const chronicle = await item.repository().chronicle(0, 200);
    const actions = chronicle.entries.filter(entry => entry.provenance.kind === 'procedural-policy');
    assert.equal(actions.length, 72);
    assert.ok(actions.every(entry => entry.provenance.policy?.version === BEHAVIOR_POLICY_VERSION));
    assert.equal((await item.repository().simulation()).policyVersion, BEHAVIOR_POLICY_VERSION);
    assert.ok(actions.some(entry => entry.transition.kind === 'action' && entry.transition.command.action.type === 'research'));
    assert.ok(actions.some(entry => entry.transition.kind === 'action' && entry.transition.command.action.type === 'build' && typeof entry.transition.command.action.cityId === 'string'));
    for (const entry of actions) if (entry.transition.kind === 'action') assert.equal(entry.transition.command.plan?.[0]?.reason, entry.provenance.policy?.reason);
  } finally { item.cleanup(); }
});

void test('hosted controller envelopes require the exact supported world and every memory policy', () => {
  const legacy = createGeneratedWorld(73, epoch, 'settlement-regional-targets-1');
  const food = createGeneratedWorld(73, epoch, 'settlement-food-budget-1');
  const runtime = createAutonomousState(legacy, epoch, true, 'legacy-activation');
  const original = JSON.stringify({ legacy, food, runtime });
  assert.doesNotThrow(() => assertAutonomousState(JSON.parse(JSON.stringify(runtime)), legacy));
  assert.throws(() => createAutonomousState(food, epoch, true, 'unsupported'), (error: unknown) => error instanceof RequestFailure && error.status === 409 && error.code === 'unsupported_hosted_policy_version');
  assert.throws(() => assertAutonomousState(runtime, food), (error: unknown) => error instanceof RequestFailure && error.code === 'corrupt_or_incompatible_simulation');
  assert.throws(() => planAutonomousWake(food, runtime, epoch, 'unsupported-wake'), (error: unknown) => error instanceof RequestFailure && error.code === 'corrupt_or_incompatible_simulation');
  const mixed = structuredClone(runtime);
  mixed.memories[0] = createBehaviorMemory(food, 0);
  assert.equal(mixed.memories[0]?.policyVersion, FOOD_BUDGET_BEHAVIOR_POLICY_VERSION);
  assert.throws(() => assertAutonomousState(mixed, legacy), (error: unknown) => error instanceof RequestFailure && error.code === 'corrupt_or_incompatible_simulation');
  const mislabeled = { ...runtime, policyVersion: FOOD_BUDGET_BEHAVIOR_POLICY_VERSION, memories: Array.from({ length: 6 }, (_, seat) => createBehaviorMemory(food, seat)) };
  assert.throws(() => assertAutonomousState(mislabeled, food), (error: unknown) => error instanceof RequestFailure && error.code === 'corrupt_or_incompatible_simulation');
  assert.equal(JSON.stringify({ legacy, food, runtime }), original);
});

void test('hosted Food-policy configuration refuses before any runtime or receipt write', async () => {
  const item = fixture();
  try {
    const world = createGeneratedWorld(73, epoch, 'settlement-food-budget-1');
    seedHostedWorld(item.database().sqlite, world);
    const before = snapshot(item);
    const batches = item.database().batches;
    for (const enabled of [false, true]) {
      await assert.rejects(item.repository().configureSimulation({ expectedRevision: world.revision, enabled, commandId: `unsupported-${enabled}` }, actor, epoch), (error: unknown) => error instanceof RequestFailure && error.status === 409 && error.code === 'unsupported_hosted_policy_version');
      assert.deepEqual(snapshot(item), before);
      assert.equal(item.database().batches, batches);
    }
    assert.equal((await item.repository().simulation()).configured, false);
  } finally { item.cleanup(); }
});

void test('hosted release policy changes refuse atomically with or without an active legacy controller', async () => {
  for (const mode of ['unconfigured', 'paused', 'enabled']) {
    const item = fixture();
    try {
      const world = createGeneratedWorld(73, epoch, 'settlement-regional-targets-1');
      seedHostedWorld(item.database().sqlite, world);
      if (mode !== 'unconfigured') await item.repository().configureSimulation({ expectedRevision: world.revision, enabled: mode === 'enabled', commandId: `legacy-${mode}` }, actor, epoch);
      const before = snapshot(item);
      const batches = item.database().batches;
      const input = { expectedRevision: world.revision, expectedFromReleaseId: world.releaseId, targetReleaseId: 'settlement-food-budget-1', model: 'development-agent-fixture', commandId: 'unsupported-policy-release' };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await assert.rejects(item.repository().mutate('release-apply', input, actor, epoch), (error: unknown) => error instanceof RequestFailure && error.status === 409 && error.code === 'pre_release_migration_disabled');
        assert.deepEqual(snapshot(item), before);
        assert.equal(item.database().batches, batches);
      }
      if (mode === 'enabled') {
        assert.equal((await item.repository().simulation()).policyVersion, BEHAVIOR_POLICY_VERSION);
        await wake(item, 'unchanged-legacy-controller');
        assert.equal((await item.repository().simulation()).policyVersion, BEHAVIOR_POLICY_VERSION);
      }
    } finally { item.cleanup(); }
  }
});
