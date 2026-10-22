import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { DIRECTOR_EVENTS, ECONOMY_RULES, RESOURCE_IDS } from '../core/content.ts';
import type { Resources } from '../core/types.ts';
import type { ActionPlan } from '../core/planning.ts';
import { applyCommand, applyDirectorTick, applyHistoryAdvance, applyRelease, catchUpClock, catchUpStrategy, legalActions } from '../core/engine.ts';
import { createWorker } from '../server/worker.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const now = () => new Date('2026-10-16T01:00:00.000Z');
const identity = 'verified-site-operator';

class SqliteStatement implements D1Statement {
  private readonly database: DatabaseSync;
  private readonly sql: string;
  private values: SqlValue[] = [];
  private readonly onRead: (sql: string, values: SqlValue[], results: unknown[]) => void;
  constructor(database: DatabaseSync, sql: string, onRead: (sql: string, values: SqlValue[], results: unknown[]) => void = () => undefined) { this.database = database; this.sql = sql; this.onRead = onRead; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { const results = this.database.prepare(this.sql).all(...this.values); this.onRead(this.sql, this.values, results); return { results, meta: { changes: 0 } }; }
  execute(): D1Result {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { results: [], meta: { changes: Number(result.changes) } };
  }
  async run(): Promise<D1Result> { return this.execute(); }
}

class SqliteD1 implements D1Database {
  readonly database: DatabaseSync;
  readonly prepared: string[] = [];
  readonly reads: Array<{ sql: string; values: SqlValue[]; results: unknown[] }> = [];
  batches = 0;
  constructor(path = ':memory:') { this.database = new DatabaseSync(path); }
  prepare(sql: string): D1Statement { this.prepared.push(sql); return new SqliteStatement(this.database, sql, (statement, values, results) => { this.reads.push({ sql: statement, values, results }); }); }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
    this.batches += 1;
    this.database.exec('BEGIN');
    try {
      const result: D1Result[] = [];
      for (const statement of statements) {
        assert.ok(statement instanceof SqliteStatement);
        result.push(statement.execute());
      }
      this.database.exec('COMMIT');
      return result;
    } catch (failure) { this.database.exec('ROLLBACK'); throw failure; }
  }
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'agentic-host-'));
  const path = join(directory, 'world.sqlite');
  const database = new SqliteD1(path);
  database.database.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8'));
  const env = { DB: database, AGENT_WRITER_USER_IDS: identity };
  const worker = createWorker(undefined, { now });
  return { path, database, env, worker, cleanup: () => { database.database.close(); rmSync(directory, { recursive: true, force: true }); } };
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}

async function body(response: Response): Promise<Record<string, unknown>> { const value: unknown = await response.json(); return object(value); }

function post(path: string, payload: Record<string, unknown>, authenticated = true): Request {
  return new Request(`https://world.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { 'oai-authenticated-user-id': identity } : {}) }, body: JSON.stringify(payload) });
}

function initialize() { return { seed: 1701, clockEpoch: epoch, commandId: 'initialize-online-run' }; }
function action(commandId = 'aster-first-choice') { return { seat: 0, expectedRevision: 0, choice: 1, model: 'gpt-6.1-sol', commandId }; }

async function independentWorld(item: ReturnType<typeof fixture>): Promise<void> {
  assert.equal((await item.worker.fetch(post('/api/init', initialize()), item.env)).status, 200);
  for (const [expectedRevision, expectedFromReleaseId, targetReleaseId] of [[0, 'settlement-foundations-1', 'settlement-foundations-2'], [1, 'settlement-foundations-2', 'settlement-independent-1']] as const) {
    const response = await item.worker.fetch(post('/api/release-apply', { expectedRevision, expectedFromReleaseId, targetReleaseId, model: 'gpt-6-astra', commandId: `release-${expectedRevision}` }), item.env);
    assert.equal(response.status, 200, JSON.stringify(await body(response)));
  }
}

async function planningWorld(item: ReturnType<typeof fixture>): Promise<void> {
  await independentWorld(item);
  const response = await item.worker.fetch(post('/api/release-apply', { expectedRevision: 2, expectedFromReleaseId: 'settlement-independent-1', targetReleaseId: 'settlement-plans-1', model: 'gpt-6-astra', commandId: 'release-plans' }), item.env);
  assert.equal(response.status, 200, JSON.stringify(await body(response)));
}

async function productionWorld(item: ReturnType<typeof fixture>): Promise<void> {
  await independentWorld(item);
  const repository = new WorldRepository(item.database);
  const send = async (path: string, input: Record<string, unknown>, timestamp: string) => {
    const current = await repository.read();
    assert.ok(current);
    const worker = createWorker(undefined, { now: () => new Date(timestamp) });
    const reply = await worker.fetch(post(path, { ...input, expectedRevision: current.state.revision }), item.env);
    assert.equal(reply.status, 200, JSON.stringify(await body(reply)));
  };
  await send('/api/release-apply', { expectedFromReleaseId: 'settlement-independent-1', targetReleaseId: 'settlement-production-1', model: 'gpt-6-astra', commandId: 'release-production' }, '2026-10-16T01:00:00.000Z');
  await send('/api/action', { seat: 0, action: { type: 'research', technology: 'agriculture' }, model: 'gpt-6-astra', commandId: 'production-cultivation' }, '2026-10-16T01:00:00.000Z');
  await send('/api/strategy-catchup', { timestamp: '2026-10-16T01:04:00.000Z', commandId: 'production-four-beats' }, '2026-10-16T01:04:00.000Z');
  await send('/api/action', { seat: 0, action: { type: 'research', technology: 'water-management' }, model: 'gpt-6-astra', commandId: 'production-water' }, '2026-10-16T01:04:00.000Z');
  await send('/api/strategy-catchup', { timestamp: '2026-10-16T01:06:00.000Z', commandId: 'production-water-beat' }, '2026-10-16T01:06:00.000Z');
  await send('/api/action', { seat: 0, action: { type: 'build', project: 'irrigation' }, model: 'gpt-6-astra', commandId: 'production-irrigation' }, '2026-10-16T01:06:00.000Z');
}

async function frontierWorld(item: ReturnType<typeof fixture>): Promise<void> {
  await independentWorld(item);
  for (const [expectedRevision, expectedFromReleaseId, targetReleaseId] of [[2, 'settlement-independent-1', 'settlement-production-1'], [3, 'settlement-production-1', 'settlement-frontiers-1']] as const) {
    const response = await item.worker.fetch(post('/api/release-apply', { expectedRevision, expectedFromReleaseId, targetReleaseId, model: 'gpt-6-astra', commandId: `frontier-release-${expectedRevision}` }), item.env);
    assert.equal(response.status, 200, JSON.stringify(await body(response)));
  }
}

async function specializationWorld(item: ReturnType<typeof fixture>): Promise<void> {
  await frontierWorld(item);
  const repository = new WorldRepository(item.database);
  const initial = await repository.read();
  assert.ok(initial);
  const founding = legalActions(initial.state, 0).find((option) => option.action.type === 'settle')?.action;
  assert.ok(founding);
  const steps: Array<[string, Record<string, unknown>, string]> = [
    ['/api/action', { seat: 0, action: founding, commandId: 'specialization-frontier' }, '2026-10-16T01:00:00.000Z'],
    ['/api/action', { seat: 0, action: { type: 'research', technology: 'agriculture' }, commandId: 'specialization-cultivation' }, '2026-10-16T01:00:10.000Z'],
    ['/api/strategy-catchup', { timestamp: '2026-10-16T01:02:00.000Z', commandId: 'specialization-research-beats' }, '2026-10-16T01:02:00.000Z'],
    ['/api/release-apply', { expectedFromReleaseId: 'settlement-frontiers-1', targetReleaseId: 'settlement-specialization-1', commandId: 'specialization-release' }, '2026-10-16T01:02:00.000Z'],
  ];
  for (const [path, input, timestamp] of steps) {
    const current = await repository.read();
    assert.ok(current);
    const worker = createWorker(undefined, { now: () => new Date(timestamp) });
    const response = await worker.fetch(post(path, { ...input, expectedRevision: current.state.revision, model: 'gpt-6-astra' }), item.env);
    assert.equal(response.status, 200, JSON.stringify(await body(response)));
  }
}

async function recoveryWorld(item: ReturnType<typeof fixture>) {
  await specializationWorld(item);
  const repository = new WorldRepository(item.database);
  const worker = createWorker(undefined, { now: () => new Date('2026-10-16T01:02:00.000Z') });
  const current = await repository.read();
  assert.ok(current);
  assert.equal((await worker.fetch(post('/api/release-apply', { expectedRevision: current.state.revision, expectedFromReleaseId: 'settlement-specialization-1', targetReleaseId: 'settlement-recovery-1', model: 'gpt-6-astra', commandId: 'recovery-release' }), item.env)).status, 200);
  const released = await repository.read();
  assert.ok(released);
  const quake = { expectedRevision: released.state.revision, kind: 'event', intervalId: 'recovery-earthquake', timestamp: '2026-10-16T01:02:00.000Z', event: 'earthquake', target: 0, model: 'gpt-6-astra' };
  assert.equal((await worker.fetch(post('/api/tick', quake), item.env)).status, 200);
  const damaged = await repository.read();
  assert.ok(damaged);
  assert.equal((await body(await worker.fetch(post('/api/tick', quake), item.env))).duplicate, true);
  assert.deepEqual(damaged.state.cities.map((city) => city.infrastructure), released.state.cities.map((city) => city.infrastructure));
  assert.equal(damaged.state.cities.filter((city) => city.civId === 0).every((city) => city.damage === 35), true);
  return { repository, worker, damaged };
}

void test('city recovery charges the exact target once through concurrent rebase and partial repair', async () => {
  const item = fixture();
  try {
    const { repository, worker, damaged } = await recoveryWorld(item);
    const target = damaged.state.cities.find((city) => city.civId === 0 && city.id !== 'city-0');
    assert.ok(target);
    const repair = { type: 'repair-city', cityId: target.id };
    const input = { seat: 0, expectedRevision: damaged.state.revision, action: repair, plan: [{ action: repair, reason: 'Restore this damaged frontier' }], model: 'gpt-6-astra', commandId: 'exact-city-repair' };
    const replies = await Promise.all([input, { seat: 1, expectedRevision: damaged.state.revision, action: { type: 'focus', focus: 'industry', cityId: 'city-1' }, model: 'gpt-6-astra', commandId: 'recovery-other-actor' }].map((request) => worker.fetch(post('/api/action', request), item.env)));
    assert.deepEqual(replies.map((reply) => reply.status), [200, 200]);
    const first = await repository.read();
    assert.ok(first);
    assert.equal(first.state.cities.find((city) => city.id === target.id)?.damage, 10);
    assert.deepEqual(first.state.cities.find((city) => city.id === 'city-0'), damaged.state.cities.find((city) => city.id === 'city-0'));
    const beforeResources = damaged.state.civilizations[0]?.resources;
    const afterResources = first.state.civilizations[0]?.resources;
    assert.ok(beforeResources && afterResources);
    for (const resource of RESOURCE_IDS) assert.equal(afterResources[resource], beforeResources[resource] - (resource === 'materials' ? ECONOMY_RULES.repair.cost.materials : resource === 'energy' ? ECONOMY_RULES.repair.cost.energy : 0));
    assert.equal(first.state.actionPlans?.[0]?.observedRevision, damaged.state.revision);
    assert.equal((await body(await worker.fetch(post('/api/action', input), item.env))).duplicate, true);
    assert.deepEqual(await repository.read(), first);
    assert.equal((await worker.fetch(post('/api/action', { ...input, action: { ...repair, cityId: 'city-0' } }), item.env)).status, 409);
    assert.equal((await worker.fetch(post('/api/action', { seat: 2, expectedRevision: damaged.state.revision, choice: 0, model: 'gpt-6-astra', commandId: 'stale-recovery-index' }), item.env)).status, 409);
    const later = createWorker(undefined, { now: () => new Date('2026-10-16T01:02:10.000Z') });
    assert.equal((await later.fetch(post('/api/action', { ...input, commandId: 'partial-city-repair' }), item.env)).status, 200);
    const second = await repository.read();
    assert.ok(second);
    assert.equal(second.state.cities.find((city) => city.id === target.id)?.damage, 0);
    assert.equal(second.state.civilizations[0]?.resources.materials, beforeResources.materials - 2 * ECONOMY_RULES.repair.cost.materials);
    assert.equal(second.state.civilizations[0]?.resources.energy, beforeResources.energy - 2 * ECONOMY_RULES.repair.cost.energy);
    const availableAgain = createWorker(undefined, { now: () => new Date('2026-10-16T01:02:20.000Z') });
    const batches = item.database.batches;
    assert.equal((await availableAgain.fetch(post('/api/action', { ...input, expectedRevision: second.state.revision, commandId: 'healthy-city-repair' }), item.env)).status, 400);
    assert.deepEqual(await repository.read(), second);
    assert.equal(item.database.batches, batches);
    let reproduced = second.initial;
    for (const entry of (await repository.history()).entries) {
      const transition = entry.transition;
      const result = transition.kind === 'release-apply' ? applyRelease(reproduced, transition.command)
        : transition.kind === 'action' ? applyCommand(reproduced, transition.command)
          : transition.kind === 'director-tick' ? applyDirectorTick(reproduced, transition.command)
            : transition.kind === 'strategy-catchup' ? catchUpStrategy(reproduced, transition.timestamp) : null;
      assert.ok(result?.ok);
      assert.deepEqual(result.state, entry.state);
      reproduced = result.state;
    }
    assert.deepEqual(reproduced, second.state);
  } finally { item.cleanup(); }
});

void test('city recovery refuses invalid targets and real depleted stocks without authoritative writes', async () => {
  const item = fixture();
  try {
    const { repository, worker, damaged } = await recoveryWorld(item);
    const history = await repository.history();
    const receipts = item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all();
    const batches = item.database.batches;
    const invalid = [{ type: 'repair-city' }, ...[null, 9, '', ' ', 'x'.repeat(129), 'missing-city', 'city-1'].map((cityId) => ({ type: 'repair-city', cityId })), { type: 'repair-city', cityId: 'city-0', amount: 100 }];
    for (const [index, attempted] of invalid.entries()) {
      assert.equal((await worker.fetch(post('/api/action', { seat: 0, expectedRevision: damaged.state.revision, action: attempted, model: 'gpt-6-astra', commandId: `bad-repair-${index}` }), item.env)).status, 400);
      assert.deepEqual(await repository.read(), damaged);
      assert.deepEqual(await repository.history(), history);
      assert.deepEqual(item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all(), receipts);
      assert.equal(item.database.batches, batches);
    }
    assert.equal((await worker.fetch(post('/api/action', { seat: 0, expectedRevision: damaged.state.revision, action: { type: 'build', project: 'farm', cityId: 'city-0' }, model: 'gpt-6-astra', commandId: 'spend-before-repair' }), item.env)).status, 200);
    const later = createWorker(undefined, { now: () => new Date('2026-10-16T01:02:10.000Z') });
    const funded = await repository.read();
    assert.ok(funded);
    assert.equal((await later.fetch(post('/api/action', { seat: 0, expectedRevision: funded.state.revision, action: { type: 'repair-city', cityId: 'city-0' }, model: 'gpt-6-astra', commandId: 'last-funded-repair' }), item.env)).status, 200);
    const partiallyFunded = await repository.read();
    assert.ok(partiallyFunded);
    const frontier = partiallyFunded.state.cities.find((city) => city.civId === 0 && city.id !== 'city-0');
    assert.ok(frontier);
    const finalFunded = createWorker(undefined, { now: () => new Date('2026-10-16T01:02:20.000Z') });
    assert.equal((await finalFunded.fetch(post('/api/action', { seat: 0, expectedRevision: partiallyFunded.state.revision, action: { type: 'repair-city', cityId: frontier.id }, model: 'gpt-6-astra', commandId: 'depleting-repair' }), item.env)).status, 200);
    const depleted = await repository.read();
    assert.ok(depleted);
    assert.ok((depleted.state.civilizations[0]?.resources.materials ?? Infinity) < ECONOMY_RULES.repair.cost.materials, JSON.stringify(depleted.state.civilizations[0]?.resources));
    assert.equal(depleted.state.cities.find((city) => city.id === 'city-0')?.damage, 10);
    const availableAgain = createWorker(undefined, { now: () => new Date('2026-10-16T01:02:30.000Z') });
    const depletedHistory = await repository.history();
    const depletedReceipts = item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all();
    const depletedBatches = item.database.batches;
    assert.equal((await availableAgain.fetch(post('/api/action', { seat: 0, expectedRevision: depleted.state.revision, action: { type: 'repair-city', cityId: 'city-0' }, model: 'gpt-6-astra', commandId: 'unfunded-repair' }), item.env)).status, 400);
    assert.deepEqual(await repository.read(), depleted);
    assert.deepEqual(await repository.history(), depletedHistory);
    assert.deepEqual(item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all(), depletedReceipts);
    assert.equal(item.database.batches, depletedBatches);
  } finally { item.cleanup(); }
});

void test('city recovery receipt failure rolls back damage and payment and survives database restart', async () => {
  const item = fixture();
  try {
    const { repository, worker, damaged } = await recoveryWorld(item);
    const history = await repository.history();
    const receipts = item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all();
    const input = { seat: 0, expectedRevision: damaged.state.revision, action: { type: 'repair-city', cityId: 'city-0' }, model: 'gpt-6-astra', commandId: 'repair-rollback' };
    item.database.database.exec("CREATE TRIGGER fail_repair_receipt BEFORE INSERT ON world_receipts WHEN NEW.receipt_key = 'action:repair-rollback' BEGIN SELECT RAISE(ABORT, 'test city repair receipt failure'); END;");
    assert.equal((await worker.fetch(post('/api/action', input), item.env)).status, 500);
    assert.deepEqual(await repository.read(), damaged);
    assert.deepEqual(await repository.history(), history);
    assert.deepEqual(item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all(), receipts);
    item.database.database.exec('DROP TRIGGER fail_repair_receipt');
    assert.equal((await worker.fetch(post('/api/action', input), item.env)).status, 200);
    const current = await repository.read();
    assert.ok(current);
    assert.equal(current.state.cities.find((city) => city.id === 'city-0')?.damage, 10);
    assert.equal(current.state.civilizations[0]?.resources.materials, (damaged.state.civilizations[0]?.resources.materials ?? 0) - ECONOMY_RULES.repair.cost.materials);
    const restarted = new SqliteD1(item.path);
    try {
      assert.deepEqual(await new WorldRepository(restarted).read(), current);
      assert.equal((await body(await worker.fetch(post('/api/action', input), { ...item.env, DB: restarted }))).duplicate, true);
      assert.deepEqual(await repository.read(), current);
    } finally { restarted.database.close(); }
  } finally { item.cleanup(); }
});

void test('hosted recovery history validates exact stored repair shapes without rewriting rows', async () => {
  const item = fixture();
  try {
    const { repository, worker, damaged } = await recoveryWorld(item);
    assert.equal((await worker.fetch(post('/api/action', { seat: 0, expectedRevision: damaged.state.revision, action: { type: 'repair-city', cityId: 'city-0' }, model: 'gpt-6-astra', commandId: 'stored-repair-shape' }), item.env)).status, 200);
    const current = await repository.read();
    const row = object(item.database.database.prepare("SELECT transition_json FROM world_transitions WHERE receipt_key = 'action:stored-repair-shape'").get());
    const parsed: unknown = JSON.parse(String(row.transition_json));
    const transition = object(parsed);
    const batches = item.database.batches;
    for (const attempted of [{ type: 'repair-city' }, { type: 'repair-city', cityId: null }, { type: 'repair-city', cityId: '' }, { type: 'repair-city', cityId: 'city-0', amount: 100 }]) {
      const bytes = JSON.stringify({ ...transition, command: { ...object(transition.command), action: attempted } });
      item.database.database.prepare("UPDATE world_transitions SET transition_json = ? WHERE receipt_key = 'action:stored-repair-shape'").run(bytes);
      for (const path of ['/api/chronicle', '/api/history']) assert.equal((await worker.fetch(new Request(`https://world.test${path}`), item.env)).status, 503);
      assert.equal(object(item.database.database.prepare("SELECT transition_json FROM world_transitions WHERE receipt_key = 'action:stored-repair-shape'").get()).transition_json, bytes);
      assert.deepEqual(await repository.read(), current);
      assert.equal(item.database.batches, batches);
    }
    item.database.database.prepare("UPDATE world_transitions SET transition_json = ? WHERE receipt_key = 'action:stored-repair-shape'").run(String(row.transition_json));
    for (const path of ['/api/chronicle', '/api/history']) assert.equal((await worker.fetch(new Request(`https://world.test${path}`), item.env)).status, 200);
  } finally { item.cleanup(); }
});

void test('targeted focus and construction retain their city through concurrent rebase and exact history', async () => {
  const item = fixture();
  try {
    await specializationWorld(item);
    const repository = new WorldRepository(item.database);
    const before = await repository.read();
    assert.ok(before);
    const target = before.state.cities.find((city) => city.civId === 0 && city.id !== 'city-0');
    assert.ok(target);
    const focus = { type: 'focus', focus: 'growth', cityId: target.id };
    const build = { type: 'build', project: 'farm', cityId: target.id };
    const plan = [{ action: focus, reason: 'Give the frontier a food-producing role' }, { action: build, reason: 'Review whether a local farm can support its residents' }];
    const input = { seat: 0, expectedRevision: before.state.revision, action: focus, plan, model: 'gpt-6-astra', commandId: 'targeted-focus' };
    const worker = createWorker(undefined, { now: () => new Date('2026-10-16T01:02:00.000Z') });
    const replies = await Promise.all([input, { seat: 1, expectedRevision: before.state.revision, action: { type: 'focus', focus: 'industry', cityId: 'city-1' }, model: 'gpt-6-astra', commandId: 'other-city-focus' }].map((request) => worker.fetch(post('/api/action', request), item.env)));
    assert.deepEqual(replies.map((reply) => reply.status), [200, 200]);
    const focused = await repository.read();
    assert.ok(focused);
    assert.equal(focused.state.cities.find((city) => city.id === target.id)?.focus, 'growth');
    assert.deepEqual(focused.state.cities.find((city) => city.id === 'city-0'), before.state.cities.find((city) => city.id === 'city-0'));
    assert.equal((await body(await worker.fetch(post('/api/action', input), item.env))).duplicate, true);
    assert.equal((await worker.fetch(post('/api/action', { ...input, action: { ...focus, cityId: 'city-0' } }), item.env)).status, 409);
    assert.equal((await worker.fetch(post('/api/action', { seat: 2, expectedRevision: before.state.revision, choice: 0, model: 'gpt-6-astra', commandId: 'stale-city-index' }), item.env)).status, 409);
    const later = createWorker(undefined, { now: () => new Date('2026-10-16T01:02:10.000Z') });
    const construction = { seat: 0, expectedRevision: before.state.revision, action: build, plan: [{ action: build, reason: 'Build the reviewed farm in this exact frontier' }], model: 'gpt-6-astra', commandId: 'targeted-farm' };
    assert.equal((await later.fetch(post('/api/action', construction), item.env)).status, 200);
    const built = await repository.read();
    assert.ok(built);
    assert.equal(built.state.cities.find((city) => city.id === target.id)?.buildings.includes('farm'), true);
    assert.deepEqual(built.state.cities.find((city) => city.id === 'city-0'), before.state.cities.find((city) => city.id === 'city-0'));
    assert.equal(built.state.actionPlans?.[0]?.observedRevision, before.state.revision);
    const availableAgain = createWorker(undefined, { now: () => new Date('2026-10-16T01:02:20.000Z') });
    const batches = item.database.batches;
    assert.equal((await availableAgain.fetch(post('/api/action', { ...construction, expectedRevision: built.state.revision, commandId: 'duplicate-local-building' }), item.env)).status, 400);
    assert.deepEqual(await repository.read(), built);
    assert.equal(item.database.batches, batches);
    let reproduced = built.initial;
    for (const entry of (await repository.history()).entries) {
      const transition = entry.transition;
      const result = transition.kind === 'release-apply' ? applyRelease(reproduced, transition.command)
        : transition.kind === 'action' ? applyCommand(reproduced, transition.command)
          : transition.kind === 'strategy-catchup' ? catchUpStrategy(reproduced, transition.timestamp) : null;
      assert.ok(result?.ok);
      assert.deepEqual(result.state, entry.state);
      reproduced = result.state;
    }
    assert.deepEqual(reproduced, built.state);
  } finally { item.cleanup(); }
});

void test('missing malformed foreign and unchanged city targets refuse without persistence effects', async () => {
  const item = fixture();
  try {
    await specializationWorld(item);
    const repository = new WorldRepository(item.database);
    const before = await repository.read();
    assert.ok(before);
    const history = await repository.history();
    const receipts = item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all();
    const worker = createWorker(undefined, { now: () => new Date('2026-10-16T01:02:00.000Z') });
    const batches = item.database.batches;
    const invalid: Record<string, unknown>[] = [{ type: 'focus', focus: 'research', cityId: 'city-0' }];
    for (const base of [{ type: 'focus', focus: 'growth' }, { type: 'build', project: 'farm' }]) {
      invalid.push(base);
      for (const cityId of [null, 3, '', ' ', 'x'.repeat(129), 'missing-city', 'city-1']) invalid.push({ ...base, cityId });
      invalid.push({ ...base, cityId: 'city-0', fallback: true });
    }
    for (const [index, attempted] of invalid.entries()) {
      assert.equal((await worker.fetch(post('/api/action', { seat: 0, expectedRevision: before.state.revision, action: attempted, model: 'gpt-6-astra', commandId: `invalid-city-${index}` }), item.env)).status, 400);
      assert.deepEqual(await repository.read(), before);
      assert.deepEqual(await repository.history(), history);
      assert.deepEqual(item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all(), receipts);
      assert.equal(item.database.batches, batches);
    }
  } finally { item.cleanup(); }
});

void test('targeted construction receipt rollback preserves the intended city and all authoritative rows', async () => {
  const item = fixture();
  try {
    await specializationWorld(item);
    const repository = new WorldRepository(item.database);
    const before = await repository.read();
    assert.ok(before);
    const target = before.state.cities.find((city) => city.civId === 0 && city.id !== 'city-0');
    assert.ok(target);
    const history = await repository.history();
    const receipts = item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all();
    item.database.database.exec("CREATE TRIGGER fail_target_receipt BEFORE INSERT ON world_receipts WHEN NEW.receipt_key = 'action:target-rollback' BEGIN SELECT RAISE(ABORT, 'test city target receipt failure'); END;");
    const worker = createWorker(undefined, { now: () => new Date('2026-10-16T01:02:00.000Z') });
    const input = { seat: 0, expectedRevision: before.state.revision, action: { type: 'build', project: 'farm', cityId: target.id }, model: 'gpt-6-astra', commandId: 'target-rollback' };
    assert.equal((await worker.fetch(post('/api/action', input), item.env)).status, 500);
    assert.deepEqual(await repository.read(), before);
    assert.deepEqual(await repository.history(), history);
    assert.deepEqual(item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all(), receipts);
    item.database.database.exec('DROP TRIGGER fail_target_receipt');
    assert.equal((await worker.fetch(post('/api/action', input), item.env)).status, 200);
    const restarted = new SqliteD1(item.path);
    try {
      const current = await new WorldRepository(restarted).read();
      assert.equal(current?.state.cities.find((city) => city.id === target.id)?.buildings.includes('farm'), true);
      assert.equal(current?.state.cities.find((city) => city.id === 'city-0')?.buildings.includes('farm'), false);
      assert.equal((await body(await worker.fetch(post('/api/action', input), item.env))).duplicate, true);
      assert.deepEqual(await repository.read(), current);
    } finally { restarted.database.close(); }
  } finally { item.cleanup(); }
});

void test('public history rejects malformed stored city targets while old untargeted shapes remain readable', async () => {
  const item = fixture();
  try {
    assert.equal((await item.worker.fetch(post('/api/init', initialize()), item.env)).status, 200);
    assert.equal((await item.worker.fetch(post('/api/action', action('target-shape-fixture')), item.env)).status, 200);
    const row = object(item.database.database.prepare('SELECT transition_json FROM world_transitions').get());
    const parsed: unknown = JSON.parse(String(row.transition_json));
    const transition = object(parsed);
    const batches = item.database.batches;
    for (const attempted of [{ type: 'focus', focus: 'industry', cityId: null }, { type: 'build', project: 'farm', cityId: ' ' }]) {
      item.database.database.prepare('UPDATE world_transitions SET transition_json = ?').run(JSON.stringify({ ...transition, command: { ...object(transition.command), action: attempted } }));
      for (const path of ['/api/chronicle', '/api/history']) assert.equal((await item.worker.fetch(new Request(`https://world.test${path}`), item.env)).status, 503);
      assert.equal(item.database.batches, batches);
    }
    item.database.database.prepare('UPDATE world_transitions SET transition_json = ?').run(String(row.transition_json));
    for (const path of ['/api/chronicle', '/api/history']) assert.equal((await item.worker.fetch(new Request(`https://world.test${path}`), item.env)).status, 200);
    assert.equal(item.database.batches, batches);
  } finally { item.cleanup(); }
});

void test('hosted frontier founding preserves exact source and transfers residents once across replay', async () => {
  const item = fixture();
  try {
    await frontierWorld(item);
    const repository = new WorldRepository(item.database);
    const before = await repository.read();
    assert.ok(before);
    const founding = legalActions(before.state, 0).find((option) => option.action.type === 'settle')?.action;
    assert.ok(founding?.type === 'settle');
    assert.equal(founding.sourceCityId, 'city-0');
    const source = before.state.cities.find((city) => city.id === founding.sourceCityId);
    const civilization = before.state.civilizations[0];
    assert.ok(source && civilization);
    const input = { seat: 0, expectedRevision: before.state.revision, action: founding, plan: [{ action: founding, reason: 'Found a nearby settlement without creating population' }], model: 'gpt-6-astra', commandId: 'explicit-frontier' };
    const response = await body(await item.worker.fetch(post('/api/action', input), item.env));
    assert.equal(response.ok, true, JSON.stringify(response));
    const after = await repository.read();
    assert.ok(after);
    const founded = after.state.cities.find((city) => city.tileId === founding.tileId);
    assert.ok(founded);
    assert.equal(founded.id, `city-0-${after.state.revision}`);
    assert.equal(founded.population, ECONOMY_RULES.settle.population);
    assert.equal(founded.focus, source.focus);
    assert.equal(after.state.cities.find((city) => city.id === source.id)?.population, source.population - founded.population);
    assert.equal(after.state.cities.reduce((sum, city) => sum + city.population, 0), before.state.cities.reduce((sum, city) => sum + city.population, 0));
    assert.equal(after.state.tiles.find((tile) => tile.id === founding.tileId)?.owner, 0);
    const cost: Partial<Resources> = ECONOMY_RULES.settle.cost;
    for (const resource of RESOURCE_IDS) assert.equal(after.state.civilizations[0]?.resources[resource], civilization.resources[resource] - (cost[resource] ?? 0));
    assert.equal((await body(await item.worker.fetch(post('/api/action', input), item.env))).duplicate, true);
    assert.deepEqual(await repository.read(), after);
    assert.equal((await item.worker.fetch(post('/api/action', { ...input, action: { ...founding, sourceCityId: founded.id } }), item.env)).status, 409);
    let reproduced = after.initial;
    for (const entry of (await repository.history()).entries) {
      const next = entry.transition.kind === 'release-apply' ? applyRelease(reproduced, entry.transition.command)
        : entry.transition.kind === 'action' ? applyCommand(reproduced, entry.transition.command) : null;
      assert.ok(next?.ok);
      assert.deepEqual(next.state, entry.state);
      reproduced = next.state;
    }
    assert.deepEqual(reproduced, after.state);
  } finally { item.cleanup(); }
});

void test('unrelated frontier founders rebase exact sources while contested sites commit only one owner', async () => {
  for (const contested of [false, true]) {
    const item = fixture();
    try {
      await frontierWorld(item);
      const repository = new WorldRepository(item.database);
      const before = await repository.read();
      assert.ok(before);
      const seats = contested ? [0, 2] : [0, 1];
      const firstOptions = legalActions(before.state, 0).flatMap((option) => option.action.type === 'settle' ? [option.action] : []);
      const secondSeat = seats[1];
      assert.ok(secondSeat !== undefined);
      const secondOptions = legalActions(before.state, secondSeat).flatMap((option) => option.action.type === 'settle' ? [option.action] : []);
      const first = contested ? firstOptions.find((option) => secondOptions.some((other) => other.tileId === option.tileId)) : firstOptions[0];
      const second = contested ? secondOptions.find((option) => option.tileId === first?.tileId) : secondOptions[0];
      assert.ok(first && second);
      const inputs = [first, second].map((founding, index) => ({ seat: seats[index], expectedRevision: before.state.revision, action: founding, plan: [{ action: founding, reason: 'Transfer an explicit frontier group from this settlement' }], model: 'gpt-6-astra', commandId: `racing-founder-${index}` }));
      const responses = await Promise.all(inputs.map((input) => item.worker.fetch(post('/api/action', input), item.env)));
      assert.deepEqual(responses.map((response) => response.status).toSorted((left, right) => left - right), contested ? [200, 400] : [200, 200]);
      const after = await repository.read();
      assert.ok(after);
      assert.equal(after.state.cities.length, before.state.cities.length + (contested ? 1 : 2));
      assert.equal(after.state.cities.reduce((sum, city) => sum + city.population, 0), before.state.cities.reduce((sum, city) => sum + city.population, 0));
      const entries = (await repository.history()).entries.filter((entry) => entry.transition.kind === 'action');
      for (const entry of entries) {
        assert.equal(entry.transition.kind, 'action');
        if (entry.transition.kind !== 'action') continue;
        const accepted = entry.transition.command;
        const expected = inputs.find((input) => input.seat === accepted.seat);
        assert.deepEqual(entry.transition.command.action, expected?.action);
        assert.equal(entry.transition.command.observedRevision, before.state.revision);
        assert.equal(entry.state.actionPlans?.[entry.transition.command.seat]?.observedRevision, before.state.revision);
      }
      if (contested) {
        const loser = seats[responses.findIndex((response) => response.status !== 200)];
        assert.ok(loser !== undefined);
        assert.deepEqual(after.state.civilizations[loser]?.resources, before.state.civilizations[loser]?.resources);
        assert.equal(after.state.cities.find((city) => city.civId === loser)?.population, before.state.cities.find((city) => city.civId === loser)?.population);
        assert.equal(after.state.independentTurns?.actionsInWindow[loser], 0);
      }
    } finally { item.cleanup(); }
  }
});

void test('frontier refusals and same-source races never reserve targets or spend twice', async () => {
  const item = fixture();
  try {
    await frontierWorld(item);
    const repository = new WorldRepository(item.database);
    const before = await repository.read();
    assert.ok(before);
    const options = legalActions(before.state, 0).flatMap((option) => option.action.type === 'settle' ? [option.action] : []);
    const first = options[0];
    const second = options[1];
    assert.ok(first && second);
    const invalid = [
      { type: 'settle', tileId: first.tileId },
      ...[null, 7, '', ' ', 'missing-city', 'city-1'].map((sourceCityId) => ({ ...first, sourceCityId })),
      { ...first, tileId: before.state.cities[0]?.tileId },
      { ...first, tileId: before.state.tiles.find((tile) => tile.terrain === 'ocean')?.id },
      { ...first, tileId: before.state.tiles.length },
      { ...first, tileId: -1 },
      { ...first, tileId: 1.5 },
      { ...first, source: first.sourceCityId },
    ];
    const batches = item.database.batches;
    const history = await repository.history();
    for (const [index, founding] of invalid.entries()) {
      assert.equal((await item.worker.fetch(post('/api/action', { seat: 0, expectedRevision: before.state.revision, action: founding, model: 'gpt-6-astra', commandId: `refused-founding-${index}` }), item.env)).status, 400);
      assert.deepEqual(await repository.read(), before);
      assert.deepEqual(await repository.history(), history);
      assert.equal(item.database.batches, batches);
    }
    const replies = await Promise.all([first, second].map((founding, index) => item.worker.fetch(post('/api/action', { seat: 0, expectedRevision: before.state.revision, action: founding, model: 'gpt-6-astra', commandId: `same-source-${index}` }), item.env)));
    assert.deepEqual(replies.map((reply) => reply.status).toSorted((left, right) => left - right), [200, 400]);
    const after = await repository.read();
    assert.ok(after);
    assert.equal(after.state.cities.length, before.state.cities.length + 1);
    assert.equal(after.state.cities[0]?.population, ECONOMY_RULES.settle.minimumSourcePopulation);
    const later = createWorker(undefined, { now: () => new Date('2026-10-16T01:00:10.000Z') });
    const unused = [first, second].find((founding) => !after.state.cities.some((city) => city.tileId === founding.tileId));
    assert.ok(unused);
    assert.equal((await later.fetch(post('/api/action', { seat: 0, expectedRevision: before.state.revision, action: unused, model: 'gpt-6-astra', commandId: 'depleted-source-next-window' }), item.env)).status, 400);
    assert.deepEqual(await repository.read(), after);
  } finally { item.cleanup(); }
});

void test('failed founding receipt rolls back population transfer, tile claim and history before restart', async () => {
  const item = fixture();
  try {
    await frontierWorld(item);
    const repository = new WorldRepository(item.database);
    const before = await repository.read();
    assert.ok(before);
    const founding = legalActions(before.state, 0).find((option) => option.action.type === 'settle')?.action;
    assert.ok(founding);
    const history = await repository.history();
    const receipts = item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all();
    item.database.database.exec("CREATE TRIGGER fail_founding_receipt BEFORE INSERT ON world_receipts WHEN NEW.receipt_key = 'action:founding-rollback' BEGIN SELECT RAISE(ABORT, 'test founding receipt failure'); END;");
    const input = { seat: 0, expectedRevision: before.state.revision, action: founding, model: 'gpt-6-astra', commandId: 'founding-rollback' };
    const batches = item.database.batches;
    assert.equal((await item.worker.fetch(post('/api/action', input), item.env)).status, 500);
    assert.equal(item.database.batches, batches + 1);
    assert.deepEqual(await repository.read(), before);
    assert.deepEqual(await repository.history(), history);
    assert.deepEqual(item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all(), receipts);
    item.database.database.exec('DROP TRIGGER fail_founding_receipt');
    assert.equal((await item.worker.fetch(post('/api/action', input), item.env)).status, 200);
    const restarted = new SqliteD1(item.path);
    try {
      const after = await new WorldRepository(restarted).read();
      assert.equal(after?.state.cities.length, before.state.cities.length + 1);
      assert.equal((await body(await item.worker.fetch(post('/api/action', input), item.env))).duplicate, true);
      assert.deepEqual(await repository.read(), after);
    } finally { restarted.database.close(); }
  } finally { item.cleanup(); }
});

void test('chronicle and full history refuse malformed stored founding sources without reading snapshots or writing', async () => {
  const item = fixture();
  try {
    assert.equal((await item.worker.fetch(post('/api/init', initialize()), item.env)).status, 200);
    assert.equal((await item.worker.fetch(post('/api/action', action('corrupt-founding-source')), item.env)).status, 200);
    const row = object(item.database.database.prepare('SELECT transition_json FROM world_transitions').get());
    assert.equal(typeof row.transition_json, 'string');
    const transition = JSON.parse(String(row.transition_json)) as unknown;
    const saved = object(transition);
    for (const sourceCityId of [7, null, '', '   ', 'x'.repeat(129)]) {
      const corrupt = { ...saved, command: { ...object(saved.command), action: { type: 'settle', tileId: 0, sourceCityId } } };
      const bytes = JSON.stringify(corrupt);
      item.database.database.prepare('UPDATE world_transitions SET transition_json = ?').run(bytes);
      const batches = item.database.batches;
      item.database.prepared.length = 0;
      assert.equal((await item.worker.fetch(new Request('https://world.test/api/chronicle'), item.env)).status, 503);
      assert.equal(item.database.prepared.some((query) => query.includes('state_json')), false);
      assert.equal((await item.worker.fetch(new Request('https://world.test/api/history'), item.env)).status, 503);
      assert.equal(item.database.batches, batches);
      assert.equal(object(item.database.database.prepare('SELECT transition_json FROM world_transitions').get()).transition_json, bytes);
    }
  } finally { item.cleanup(); }
});

const attachedPlan = [
  { action: { type: 'focus', focus: 'industry' }, reason: 'Gather materials for the next settlement improvement' },
  { action: { type: 'build', project: 'farm' }, reason: 'Feed the growing population when cultivation is available' },
];

void test('attached plans retain true observation revision through concurrent exact-action replay', async () => {
  const item = fixture();
  try {
    await planningWorld(item);
    const input = { expectedRevision: 3, observedRevision: 999, model: 'gpt-6-astra', action: attachedPlan[0]?.action, plan: attachedPlan };
    const replies = await Promise.all([0, 1].map((seat) => item.worker.fetch(post('/api/action', { ...input, seat, commandId: `planned-${seat}` }), item.env)));
    assert.deepEqual(replies.map((reply) => reply.status), [200, 200]);
    for (const reply of replies) assert.equal(object((await body(reply)).actionOutcome).status, 'completed');
    const repository = new WorldRepository(item.database);
    const current = await repository.read();
    assert.ok(current);
    assert.equal(current.state.actionPlans?.length, 6);
    for (const seat of [0, 1]) {
      const plan: ActionPlan | null | undefined = current.state.actionPlans?.[seat];
      assert.equal(plan?.observedRevision, 3);
      assert.deepEqual(plan?.items.map((entry) => entry.status), ['completed', 'needs-review']);
      assert.deepEqual(plan?.items.map(({ action: plannedAction, reason }) => ({ action: plannedAction, reason })), attachedPlan);
    }
    const history = await repository.history();
    let reproduced = current.initial;
    for (const entry of history.entries) {
      const result = entry.transition.kind === 'release-apply' ? applyRelease(reproduced, entry.transition.command)
        : entry.transition.kind === 'action' ? applyCommand(reproduced, entry.transition.command) : null;
      assert.ok(result?.ok);
      reproduced = result.state;
      if (entry.transition.kind === 'action') {
        assert.equal(entry.transition.command.observedRevision, 3);
        assert.deepEqual(entry.transition.command.plan, attachedPlan);
      }
    }
    assert.deepEqual(reproduced, current.state);
    const retry = await body(await item.worker.fetch(post('/api/action', { ...input, seat: 0, commandId: 'planned-0' }), item.env));
    assert.equal(retry.duplicate, true);
    assert.equal(object(retry.actionOutcome).status, 'completed');
    const changed = attachedPlan.map((entry) => ({ ...entry, reason: `${entry.reason} changed` }));
    assert.equal((await item.worker.fetch(post('/api/action', { ...input, plan: changed, seat: 0, commandId: 'planned-0' }), item.env)).status, 409);
  } finally { item.cleanup(); }
});

void test('invalid attached plans leave state, history, receipts and allowance untouched', async () => {
  const item = fixture();
  try {
    await planningWorld(item);
    const repository = new WorldRepository(item.database);
    const before = await repository.read();
    const batches = item.database.batches;
    const invalid: unknown[] = [null, {}, [...attachedPlan, attachedPlan[0]], [{ action: { type: 'wait' }, reason: 'Different head' }], [{ action: attachedPlan[0]?.action, reason: '' }], [{ action: attachedPlan[0]?.action, reason: 'x'.repeat(281) }], [{ action: { ...attachedPlan[0]?.action, injected: true }, reason: 'Extra action field' }]];
    for (const [index, plan] of invalid.entries()) {
      const response = await item.worker.fetch(post('/api/action', { seat: 0, expectedRevision: 3, action: attachedPlan[0]?.action, plan, model: 'gpt-6-astra', commandId: `invalid-plan-${index}` }), item.env);
      assert.equal(response.status, 400);
      assert.equal(object((await body(response)).actionOutcome).status, 'failed');
      assert.deepEqual(await repository.read(), before);
      assert.equal(item.database.batches, batches);
    }
    assert.equal((await repository.history()).entries.length, 3);
  } finally { item.cleanup(); }
});

void test('MCP plans expose bounded schema and let the same agent preflight strategy before explicit follow-up', async () => {
  const item = fixture();
  try {
    await planningWorld(item);
    const repository = new WorldRepository(item.database);
    const plan = [attachedPlan[0], { action: { type: 'wait' }, reason: 'Review production before choosing another investment' }];
    const call = (worker: ReturnType<typeof createWorker>, method: string, params: Record<string, unknown> = {}) => worker.fetch(post('/mcp', { jsonrpc: '2.0', id: 1, method, params }), item.env);
    const discovery = object((await body(await call(item.worker, 'tools/list'))).result);
    assert.ok(Array.isArray(discovery.tools));
    const playTool = discovery.tools.map(object).find((tool) => tool.name === 'play_action');
    assert.ok(playTool);
    assert.equal(object(object(object(playTool.inputSchema).properties).plan).maxItems, 2);
    assert.match(String(playTool.description), /catchup_strategy/);
    assert.equal((await call(item.worker, 'tools/call', { name: 'play_action', arguments: { seat: 0, expectedRevision: 3, action: plan[0]?.action, plan, model: 'gpt-6-astra', commandId: 'mcp-plan' } })).status, 200);
    const lateWorker = createWorker(undefined, { now: () => new Date('2026-10-16T01:01:00.000Z') });
    const before = await repository.read();
    const batches = item.database.batches;
    const late = await body(await call(lateWorker, 'tools/call', { name: 'play_action', arguments: { seat: 0, expectedRevision: 4, action: { type: 'wait' }, model: 'gpt-6-astra', commandId: 'late-follow-up' } }));
    const failure = object(late.error);
    assert.equal(failure.message, 'strategy_catchup_required');
    assert.equal(object(object(failure.data).actionOutcome).status, 'blocked');
    assert.deepEqual(await repository.read(), before);
    assert.equal(item.database.batches, batches);
    const caught = await body(await call(lateWorker, 'tools/call', { name: 'catchup_strategy', arguments: { expectedRevision: 4, timestamp: '2026-10-16T01:01:00.000Z', commandId: 'self-preflight', model: 'gpt-6-astra' } }));
    assert.equal(object(object(caught.result).structuredContent).remainingTicks, 0);
    const afterBeat = await repository.read();
    assert.equal(afterBeat?.state.actionPlans?.[0]?.items[1]?.status, 'needs-review');
    assert.equal((await repository.history()).entries.filter((entry) => entry.transition.kind === 'action').length, 1);
    const afterBatches = item.database.batches;
    const viewReply = await body(await call(lateWorker, 'tools/call', { name: 'observe_world', arguments: { seat: 0 } }));
    const view = object(object(viewReply.result).structuredContent);
    const projected = object(view.actionPlan);
    assert.ok(Array.isArray(projected.items));
    assert.equal(object(projected.items[1]).status, 'ready');
    assert.deepEqual(await repository.read(), afterBeat);
    assert.equal(item.database.batches, afterBatches);
    assert.equal((await call(lateWorker, 'tools/call', { name: 'play_action', arguments: { seat: 0, expectedRevision: 5, action: { type: 'wait' }, plan: [], model: 'gpt-6-astra', commandId: 'chosen-follow-up' } })).status, 200);
    assert.equal((await repository.read())?.state.actionPlans?.[0], null);
  } finally { item.cleanup(); }
});

void test('a failed plan receipt rolls back plan, gameplay, history and allowance together', async () => {
  const item = fixture();
  try {
    await planningWorld(item);
    const repository = new WorldRepository(item.database);
    const before = await repository.read();
    const batches = item.database.batches;
    item.database.database.exec("CREATE TRIGGER fail_plan_receipt BEFORE INSERT ON world_receipts WHEN NEW.receipt_key = 'action:fail-plan' BEGIN SELECT RAISE(ABORT, 'test plan receipt failure'); END;");
    const input = { seat: 0, expectedRevision: 3, action: attachedPlan[0]?.action, plan: attachedPlan, model: 'gpt-6-astra', commandId: 'fail-plan' };
    assert.equal((await item.worker.fetch(post('/api/action', input), item.env)).status, 500);
    assert.equal(item.database.batches, batches + 1);
    assert.deepEqual(await repository.read(), before);
    assert.equal((await repository.history()).entries.length, 3);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_receipts').get()).count, 4);
    item.database.database.exec('DROP TRIGGER fail_plan_receipt');
    assert.equal((await item.worker.fetch(post('/api/action', input), item.env)).status, 200);
    assert.equal((await repository.read())?.state.actionPlans?.[0]?.items.length, 2);
  } finally { item.cleanup(); }
});

void test('malformed stored plans fail closed before hosted reads or writes', async () => {
  const item = fixture();
  try {
    await planningWorld(item);
    const current = await new WorldRepository(item.database).read();
    assert.ok(current);
    const corrupt = JSON.stringify({ ...current.state, actionPlans: [] });
    item.database.database.prepare('UPDATE world_state SET state_json = ?').run(corrupt);
    const batches = item.database.batches;
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/observe?seat=0'), item.env)).status, 503);
    assert.equal((await item.worker.fetch(post('/api/action', { seat: 0, expectedRevision: 3, action: attachedPlan[0]?.action, plan: attachedPlan, model: 'gpt-6-astra', commandId: 'corrupt-plan-write' }), item.env)).status, 503);
    assert.equal(item.database.batches, batches);
    assert.equal(object(item.database.database.prepare('SELECT state_json FROM world_state').get()).state_json, corrupt);
  } finally { item.cleanup(); }
});

void test('unconstructed production records fail closed before hosted exposure or writes', async () => {
  const item = fixture();
  try {
    assert.equal((await item.worker.fetch(post('/api/init', initialize()), item.env)).status, 200);
    const current = await new WorldRepository(item.database).read();
    assert.ok(current);
    const corrupt = JSON.stringify({ ...current.state, cities: current.state.cities.map((city, index) => index === 0 ? { ...city, buildingOperations: { 'unconstructed-operation': { enabled: true, lastResult: null } } } : city) });
    item.database.database.prepare('UPDATE world_state SET state_json = ?').run(corrupt);
    const batches = item.database.batches;
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/observe?seat=0'), item.env)).status, 503);
    assert.equal((await item.worker.fetch(post('/api/action', action('operation-corruption')), item.env)).status, 503);
    assert.equal(item.database.batches, batches);
    assert.equal(object(item.database.database.prepare('SELECT state_json FROM world_state').get()).state_json, corrupt);
  } finally { item.cleanup(); }
});

void test('paid production and owner pause persist exact replay without spending on refused controls', async () => {
  const item = fixture();
  try {
    await productionWorld(item);
    const repository = new WorldRepository(item.database);
    const built = await repository.read();
    assert.ok(built);
    const city = built.state.cities[0];
    assert.ok(city);
    assert.deepEqual(object(city).buildingOperations, { irrigation: { enabled: true, lastResult: null } });
    const worker = createWorker(undefined, { now: () => new Date('2026-10-16T01:07:00.000Z') });
    assert.equal((await worker.fetch(post('/api/strategy-catchup', { expectedRevision: built.state.revision, timestamp: '2026-10-16T01:07:00.000Z', commandId: 'first-paid-operation' }), item.env)).status, 200);
    const operated = await repository.read();
    assert.ok(operated);
    const operations = object(object(operated.state.cities[0]).buildingOperations);
    const result = object(object(operations.irrigation).lastResult);
    assert.equal(result.status, 'operated');
    assert.deepEqual(result.paid, { materials: 1 });
    assert.ok(Number(object(result.produced).food) > 0);
    const pause = { type: 'set-building-operation', cityId: city.id, buildingId: 'irrigation', enabled: false };
    const original = await repository.read();
    const batches = item.database.batches;
    for (const [index, input] of [{ seat: 1, action: pause }, { seat: 0, action: { ...pause, buildingId: 'farm' } }, { seat: 0, action: { ...pause, enabled: 'false' } }].entries()) {
      assert.equal((await worker.fetch(post('/api/action', { ...input, expectedRevision: operated.state.revision, model: 'gpt-6-astra', commandId: `refused-operation-${index}` }), item.env)).status, 400);
      assert.deepEqual(await repository.read(), original);
      assert.equal(item.database.batches, batches);
    }
    const input = { seat: 0, expectedRevision: operated.state.revision, action: pause, plan: [{ action: pause, reason: 'Reserve materials while reviewing the next project' }], model: 'gpt-6-astra', commandId: 'pause-irrigation' };
    assert.equal((await worker.fetch(post('/api/action', input), item.env)).status, 200);
    const paused = await repository.read();
    assert.ok(paused);
    assert.equal(object(object(object(paused.state.cities[0]).buildingOperations).irrigation).enabled, false);
    assert.deepEqual(object(object(object(paused.state.cities[0]).buildingOperations).irrigation).lastResult, result);
    assert.equal((await body(await worker.fetch(post('/api/action', input), item.env))).duplicate, true);
    assert.equal((await worker.fetch(post('/api/action', { ...input, action: { ...pause, enabled: true } }), item.env)).status, 409);
    const later = createWorker(undefined, { now: () => new Date('2026-10-16T01:08:00.000Z') });
    assert.equal((await later.fetch(post('/api/strategy-catchup', { expectedRevision: paused.state.revision, timestamp: '2026-10-16T01:08:00.000Z', commandId: 'paused-operation-beat' }), item.env)).status, 200);
    const current = await repository.read();
    assert.ok(current);
    const pausedResult = object(object(object(object(current.state.cities[0]).buildingOperations).irrigation).lastResult);
    assert.deepEqual(pausedResult, { round: current.state.round, status: 'paused', paid: {}, produced: {}, shortages: [] });
    let reproduced = current.initial;
    for (const entry of (await repository.history()).entries) {
      const transition = entry.transition;
      const next = transition.kind === 'release-apply' ? applyRelease(reproduced, transition.command) : transition.kind === 'action' ? applyCommand(reproduced, transition.command) : transition.kind === 'strategy-catchup' ? catchUpStrategy(reproduced, transition.timestamp) : null;
      assert.ok(next?.ok);
      assert.deepEqual(next.state, entry.state);
      reproduced = next.state;
    }
    assert.deepEqual(reproduced, current.state);
  } finally { item.cleanup(); }
});

void test('paid operation receipt failure rolls back inputs, result and every audit row together', async () => {
  const item = fixture();
  try {
    await productionWorld(item);
    const repository = new WorldRepository(item.database);
    const before = await repository.read();
    assert.ok(before);
    const history = await repository.history();
    const receipts = item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all();
    item.database.database.exec("CREATE TRIGGER fail_paid_receipt BEFORE INSERT ON world_receipts WHEN NEW.receipt_key = 'strategy-catchup:paid-rollback' BEGIN SELECT RAISE(ABORT, 'test paid receipt failure'); END;");
    const worker = createWorker(undefined, { now: () => new Date('2026-10-16T01:07:00.000Z') });
    const input = { expectedRevision: before.state.revision, timestamp: '2026-10-16T01:07:00.000Z', commandId: 'paid-rollback' };
    const batches = item.database.batches;
    assert.equal((await worker.fetch(post('/api/strategy-catchup', input), item.env)).status, 500);
    assert.equal(item.database.batches, batches + 1);
    assert.deepEqual(await repository.read(), before);
    assert.deepEqual(await repository.history(), history);
    assert.deepEqual(item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all(), receipts);
    item.database.database.exec('DROP TRIGGER fail_paid_receipt');
    assert.equal((await worker.fetch(post('/api/strategy-catchup', input), item.env)).status, 200);
    const restarted = new SqliteD1(item.path);
    try {
      const stored = await new WorldRepository(restarted).read();
      assert.equal(stored?.state.cities[0]?.buildingOperations?.irrigation?.lastResult?.status, 'operated');
      const afterBatches = item.database.batches;
      const view = await body(await worker.fetch(new Request('https://world.test/api/observe?seat=0'), item.env));
      assert.deepEqual(view.buildingRecipes, [{ buildingId: 'irrigation', inputs: { materials: 1 }, outputs: { food: 5 } }]);
      assert.equal(item.database.batches, afterBatches);
      assert.equal((await body(await worker.fetch(post('/api/strategy-catchup', input), item.env))).duplicate, true);
      assert.deepEqual(await repository.read(), stored);
    } finally { restarted.database.close(); }
  } finally { item.cleanup(); }
});

void test('independent release records authoritative epoch and unrelated concurrent exact actions both commit', async () => {
  const item = fixture();
  try {
    await independentWorld(item);
    const repository = new WorldRepository(item.database);
    assert.equal((await repository.read())?.state.independentTurns?.epoch, now().toISOString());
    const input = { expectedRevision: 2, model: 'gpt-6-astra', action: { type: 'focus', focus: 'industry' }, timestamp: '2099-01-01T00:00:00Z' };
    const replies = await Promise.all([0, 1].map((seat) => item.worker.fetch(post('/api/action', { ...input, seat, commandId: `parallel-${seat}` }), item.env)));
    assert.deepEqual(replies.map((reply) => reply.status), [200, 200]);
    const current = await repository.read();
    assert.equal(current?.state.revision, 4);
    assert.equal(current?.state.round, 0);
    assert.deepEqual(current?.state.cities.slice(0, 2).map((city) => city.focus), ['industry', 'industry']);
    const history = await repository.history();
    for (const entry of history.entries.filter((candidate) => candidate.transition.kind === 'action')) {
      assert.equal(entry.transition.kind === 'action' && entry.transition.command.timestamp, now().toISOString());
      assert.equal(entry.provenance.model, 'gpt-6-astra');
    }
    const view = await body(await item.worker.fetch(new Request('https://world.test/api/observe?seat=2'), item.env));
    assert.equal(view.activeSeat, null);
    assert.equal(object(view.admission).mode, 'independent');
    assert.equal((await item.worker.fetch(post('/api/action', { ...input, seat: 0, commandId: 'same-window' }), item.env)).status, 400);
    assert.equal((await item.worker.fetch(post('/api/action', { seat: 2, expectedRevision: 2, choice: 0, model: 'gpt-6-astra', commandId: 'stale-index' }), item.env)).status, 409);
    assert.equal((await repository.read())?.state.revision, 4);
    assert.equal((await body(await item.worker.fetch(post('/api/action', { ...input, seat: 0, commandId: 'parallel-0' }), item.env))).duplicate, true);
  } finally { item.cleanup(); }
});

void test('protected strategic catchup is separate from invalid actions and persists bounded receipts', async () => {
  const item = fixture();
  try {
    await independentWorld(item);
    const worker = createWorker(undefined, { now: () => new Date('2026-10-16T02:02:00.000Z') });
    const repository = new WorldRepository(item.database);
    const before = await repository.read();
    const batches = item.database.batches;
    const invalid = await worker.fetch(post('/api/action', { seat: 4, expectedRevision: 2, action: { type: 'build', project: 'missing' }, model: 'gpt-6-astra', commandId: 'invalid-late' }), item.env);
    assert.equal(invalid.status, 400);
    assert.equal(item.database.batches, batches);
    assert.deepEqual(await repository.read(), before);
    const input = { expectedRevision: 2, timestamp: '2026-10-16T02:02:00.000Z', commandId: 'strategy-1' };
    assert.equal((await worker.fetch(post('/api/strategy-catchup', input, false), item.env)).status, 401);
    const reply = await worker.fetch(post('/api/strategy-catchup', input), item.env);
    assert.equal(reply.status, 200);
    assert.equal((await body(reply)).remainingTicks, 2);
    const current = await repository.read();
    assert.equal(current?.state.independentTurns?.strategyTicks, 60);
    assert.equal(current?.state.round, 60);
    assert.equal(current?.state.year, before?.state.year);
    assert.equal((await body(await worker.fetch(post('/api/strategy-catchup', input), item.env))).duplicate, true);
    const history = await repository.history();
    assert.equal(history.entries.at(-1)?.transition.kind, 'strategy-catchup');
    assert.equal(history.entries.at(-1)?.provenance.kind, 'clock-service');
    assert.ok(current);
    let reproduced = current.initial;
    for (const entry of history.entries) {
      const result = entry.transition.kind === 'release-apply' ? applyRelease(reproduced, entry.transition.command)
        : entry.transition.kind === 'strategy-catchup' ? catchUpStrategy(reproduced, entry.transition.timestamp) : null;
      assert.ok(result?.ok);
      reproduced = result.state;
    }
    assert.deepEqual(reproduced, current.state);
  } finally { item.cleanup(); }
});

void test('all six independent actors can race while one actor cannot spend its allowance twice', async () => {
  const item = fixture();
  try {
    await independentWorld(item);
    const input = { expectedRevision: 2, model: 'gpt-6-astra', action: { type: 'wait' } };
    const replies = await Promise.all(Array.from({ length: 6 }, (_, seat) => item.worker.fetch(post('/api/action', { ...input, seat, commandId: `all-six-${seat}` }), item.env)));
    assert.deepEqual(replies.map((reply) => reply.status), [200, 200, 200, 200, 200, 200]);
    const repository = new WorldRepository(item.database);
    assert.deepEqual((await repository.read())?.state.independentTurns?.actionsInWindow, [1, 1, 1, 1, 1, 1]);
    assert.equal((await repository.read())?.state.round, 0);
    const worker = createWorker(undefined, { now: () => new Date('2026-10-16T01:00:10.000Z') });
    const competing = await Promise.all(['a', 'b'].map((id) => worker.fetch(post('/api/action', { ...input, seat: 0, expectedRevision: 8, commandId: `same-actor-${id}` }), item.env)));
    assert.deepEqual(competing.map((reply) => reply.status).toSorted((a, b) => a - b), [200, 400]);
    assert.equal((await repository.read())?.state.revision, 9);
    const entries = (await repository.history()).entries;
    const final = entries.at(-1);
    assert.equal(final?.transition.kind === 'action' && final.transition.command.timestamp, '2026-10-16T01:00:10.000Z');
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_receipts').get()).count, 10);
  } finally { item.cleanup(); }
});

void test('late valid actions return an actionable strategy guard without partial effects', async () => {
  const item = fixture();
  try {
    await independentWorld(item);
    const worker = createWorker(undefined, { now: () => new Date('2026-10-16T01:01:00.000Z') });
    const before = await new WorldRepository(item.database).read();
    const batches = item.database.batches;
    const response = await worker.fetch(post('/api/action', { seat: 3, expectedRevision: 2, action: { type: 'focus', focus: 'growth' }, model: 'gpt-6-astra', commandId: 'late-growth' }), item.env);
    assert.equal(response.status, 400);
    const result = await body(response);
    assert.equal(result.error, 'strategy_catchup_required');
    assert.equal(object(result.admission).nextStrategyAt, '2026-10-16T01:01:00.000Z');
    assert.equal(item.database.batches, batches);
    assert.deepEqual(await new WorldRepository(item.database).read(), before);
  } finally { item.cleanup(); }
});

void test('a duplicate committed between receipt lookup and snapshot read still returns its receipt', async () => {
  const item = fixture();
  try {
    await independentWorld(item);
    const input = { seat: 1, expectedRevision: 2, action: { type: 'wait' }, model: 'gpt-6-astra', commandId: 'interleaved-duplicate' };
    const first = new WorldRepository(item.database);
    class InterleavedRepository extends WorldRepository {
      pending = true;
      override async read() {
        if (this.pending) {
          this.pending = false;
          await first.mutate('action', input, identity, now().toISOString());
        }
        return super.read();
      }
    }
    const reply = await new InterleavedRepository(item.database).mutate('action', input, identity, now().toISOString());
    assert.equal(reply.duplicate, true);
    assert.equal(reply.acceptedRevision, 3);
    assert.equal((await first.read())?.state.revision, 3);
  } finally { item.cleanup(); }
});

void test('strategic receipt failure rolls back every realized beat and never retries a database failure', async () => {
  const item = fixture();
  try {
    await independentWorld(item);
    const repository = new WorldRepository(item.database);
    const before = await repository.read();
    const worker = createWorker(undefined, { now: () => new Date('2026-10-16T01:03:00.000Z') });
    item.database.database.exec("CREATE TRIGGER fail_strategy_receipt BEFORE INSERT ON world_receipts WHEN NEW.receipt_key = 'strategy-catchup:fail-strategy' BEGIN SELECT RAISE(ABORT, 'test strategy receipt failure'); END;");
    const batches = item.database.batches;
    const input = { expectedRevision: 2, timestamp: '2026-10-16T01:03:00.000Z', commandId: 'fail-strategy' };
    assert.equal((await worker.fetch(post('/api/strategy-catchup', input), item.env)).status, 500);
    assert.equal(item.database.batches, batches + 1);
    assert.deepEqual(await repository.read(), before);
    assert.equal((await repository.history()).entries.length, 2);
    item.database.database.exec('DROP TRIGGER fail_strategy_receipt');
    assert.equal((await worker.fetch(post('/api/strategy-catchup', input), item.env)).status, 200);
    assert.equal((await repository.read())?.state.independentTurns?.strategyTicks, 3);
  } finally { item.cleanup(); }
});

void test('corrupt independent ledgers fail closed before public exposure or protected mutation', async () => {
  const item = fixture();
  try {
    await independentWorld(item);
    const current = await new WorldRepository(item.database).read();
    assert.ok(current?.state.independentTurns);
    current.state.independentTurns.actionsInWindow[5] = 2;
    const bytes = JSON.stringify(current.state);
    item.database.database.prepare('UPDATE world_state SET state_json = ?').run(bytes);
    const batches = item.database.batches;
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/world'), item.env)).status, 503);
    assert.equal((await item.worker.fetch(post('/api/action', { seat: 0, expectedRevision: 2, action: { type: 'wait' }, model: 'gpt-6-astra', commandId: 'corrupt-ledger' }), item.env)).status, 503);
    assert.equal(item.database.batches, batches);
    assert.equal(object(item.database.database.prepare('SELECT state_json FROM world_state').get()).state_json, bytes);
  } finally { item.cleanup(); }
});

void test('public reads work without identity while every mutation fails closed without enrollment', async () => {
  const item = fixture();
  try {
    assert.equal((await item.worker.fetch(post('/api/init', initialize(), false), item.env)).status, 401);
    assert.equal((await item.worker.fetch(post('/api/init', initialize()), { DB: item.database })).status, 403);
    assert.equal((await item.worker.fetch(post('/api/init', initialize()), item.env)).status, 200);
    const read = await item.worker.fetch(new Request('https://world.test/api/world'), item.env);
    assert.equal(read.status, 200);
    assert.equal(object((await body(read)).state).revision, 0);
  } finally { item.cleanup(); }
});

void test('initialization cannot overwrite a durable world and restart reads the same revision', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    assert.equal((await item.worker.fetch(post('/api/action', action()), item.env)).status, 200);
    assert.equal((await item.worker.fetch(post('/api/init', { ...initialize(), seed: 99, commandId: 'replace' }), item.env)).status, 409);
    const restarted = new SqliteD1(item.path);
    try {
      const response = await createWorker(undefined, { now }).fetch(new Request('https://world.test/api/world'), { DB: restarted });
      const state = object((await body(response)).state);
      assert.equal(state.revision, 1);
      assert.equal(state.seed, 1701);
    } finally { restarted.database.close(); }
  } finally { item.cleanup(); }
});

void test('concurrent different commands commit only one CAS transition and one receipt', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    const replies = await Promise.all([item.worker.fetch(post('/api/action', action('a')), item.env), item.worker.fetch(post('/api/action', action('b')), item.env)]);
    assert.deepEqual(replies.map((response) => response.status).toSorted((left, right) => left - right), [200, 409]);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_transitions').get()).count, 1);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_receipts').get()).count, 2);
    const state = await new WorldRepository(item.database).read();
    assert.equal(state?.state.revision, 1);
  } finally { item.cleanup(); }
});

void test('racing identical retries resolve through one receipt and reject changed command content', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    const replies = await Promise.all([item.worker.fetch(post('/api/action', action()), item.env), item.worker.fetch(post('/api/action', action()), item.env)]);
    assert.deepEqual(replies.map((response) => response.status), [200, 200]);
    const payloads = await Promise.all(replies.map(body));
    assert.equal(payloads.filter((reply) => reply.duplicate === true).length, 1);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_transitions').get()).count, 1);
    assert.equal((await item.worker.fetch(post('/api/action', { ...action(), choice: 2 }), item.env)).status, 409);
  } finally { item.cleanup(); }
});

void test('malformed, invalid and stale actions preserve all authoritative records', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    for (const request of [{ ...action(), choice: -1 }, { ...action(), expectedRevision: 8 }, { ...action(), model: '' }, { ...action(), seat: 1 }]) {
      const response = await item.worker.fetch(post('/api/action', request), item.env);
      assert.ok(response.status >= 400 && response.status < 500);
    }
    const malformed = new Request('https://world.test/api/action', { method: 'POST', headers: { 'oai-authenticated-user-id': identity, 'content-type': 'application/json' }, body: '{' });
    assert.equal((await item.worker.fetch(malformed, item.env)).status, 400);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_transitions').get()).count, 0);
    assert.equal((await new WorldRepository(item.database).read())?.state.revision, 0);
  } finally { item.cleanup(); }
});

void test('clock catchup is durable, authenticated, bounded and independent of public readers', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    const command = { expectedRevision: 0, timestamp: '2026-10-16T00:18:00.000Z', commandId: 'root-scheduler-1' };
    const result = await body(await item.worker.fetch(post('/api/catchup', command), item.env));
    assert.equal(result.revision, 3);
    assert.equal(result.remainingTicks, 0);
    assert.equal((await body(await item.worker.fetch(post('/api/catchup', command), item.env))).duplicate, true);
    const snapshot = await new WorldRepository(item.database).read();
    assert.equal(snapshot?.state.clockTicks, 3);
    assert.equal(snapshot?.state.phase, 0);
    await item.worker.fetch(new Request('https://world.test/api/world'), item.env);
    assert.equal((await new WorldRepository(item.database).read())?.state.revision, 3);
    const future = await item.worker.fetch(post('/api/catchup', { ...command, expectedRevision: 3, timestamp: '2026-10-17T00:00:00.000Z', commandId: 'future' }), item.env);
    assert.equal(future.status, 400);
  } finally { item.cleanup(); }
});

void test('public history contains real persisted transitions and reproduces the same core state', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    await item.worker.fetch(post('/api/action', action()), item.env);
    await item.worker.fetch(post('/api/catchup', { expectedRevision: 1, timestamp: '2026-10-16T00:12:00.000Z', commandId: 'clock' }), item.env);
    const repository = new WorldRepository(item.database);
    const current = await repository.read();
    assert.ok(current);
    const history = await repository.history(0, 50);
    assert.equal(history.entries.length, 2);
    let reproduced = current.initial;
    for (const entry of history.entries) {
      assert.ok(entry.provenance.actorUserId === identity);
      const result = entry.transition.kind === 'action' ? applyCommand(reproduced, entry.transition.command)
        : entry.transition.kind === 'clock-catchup' ? catchUpClock(reproduced, entry.transition.timestamp) : null;
      assert.ok(result?.ok);
      reproduced = result.state;
    }
    assert.deepEqual(reproduced, current.state);
    assert.equal(history.entries[0]?.provenance.model, 'gpt-6.1-sol');
    assert.equal(history.entries[1]?.provenance.kind, 'clock-service');
    assert.equal(history.entries[1]?.provenance.model, null);
    const first = await repository.history(0, 1);
    assert.equal(first.hasMore, true);
    assert.equal((await repository.history(first.nextRevision ?? 0, 1)).entries.length, 1);
  } finally { item.cleanup(); }
});

void test('MCP discovery is public, whoami requires identity and tools honor the same write policy', async () => {
  const item = fixture();
  try {
    const call = (method: string, params: Record<string, unknown> = {}, authenticated = true) => item.worker.fetch(post('/mcp', { jsonrpc: '2.0', id: 1, method, params }, authenticated), item.env);
    const initialized = await body(await call('initialize', {}, false));
    assert.equal(object(initialized.result).protocolVersion, '2025-06-18');
    assert.equal((await call('tools/list', {}, false)).status, 200);
    assert.equal((await call('tools/call', { name: 'whoami', arguments: {} }, false)).status, 401);
    const whoami = await body(await call('tools/call', { name: 'whoami', arguments: {} }));
    const result = object(whoami.result);
    assert.equal(object(result.structuredContent).userId, identity);
    assert.equal((await call('tools/call', { name: 'initialize_world', arguments: initialize() })).status, 200);
    assert.equal((await call('tools/call', { name: 'play_action', arguments: action() })).status, 200);
  } finally { item.cleanup(); }
});

void test('unbound databases fail explicitly and optional asset responses do not shadow API routes', async () => {
  const worker = createWorker((request) => new URL(request.url).pathname === '/' ? new Response('spectator') : null, { now });
  assert.equal(await (await worker.fetch(new Request('https://world.test/'), {})).text(), 'spectator');
  assert.equal((await worker.fetch(new Request('https://world.test/api/world'), {})).status, 503);
  assert.equal((await worker.fetch(new Request('https://world.test/missing'), {})).status, 404);
});

void test('failed receipt insertion rolls back the world CAS and transition together', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    item.database.database.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON world_receipts WHEN NEW.receipt_key = 'action:fail-write' BEGIN SELECT RAISE(ABORT, 'test receipt failure'); END;");
    assert.equal((await item.worker.fetch(post('/api/action', action('fail-write')), item.env)).status, 500);
    assert.equal((await new WorldRepository(item.database).read())?.state.revision, 0);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_transitions').get()).count, 0);
    item.database.database.exec('DROP TRIGGER fail_receipt');
    assert.equal((await item.worker.fetch(post('/api/action', action('fail-write')), item.env)).status, 200);
  } finally { item.cleanup(); }
});

void test('user command ids cannot collide with typed Director receipt namespaces', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    assert.equal((await item.worker.fetch(post('/api/action', action('clock:1')), item.env)).status, 200);
    const tick = { expectedRevision: 1, kind: 'clock', intervalId: '1', timestamp: '2026-10-16T00:06:00.000Z' };
    assert.equal((await item.worker.fetch(post('/api/tick', tick), item.env)).status, 200);
    assert.equal((await new WorldRepository(item.database).read())?.state.clockTicks, 1);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_transitions').get()).count, 2);
  } finally { item.cleanup(); }
});

void test('corrupt persisted calendar state is rejected before clock arithmetic or further writes', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    const stored = object(item.database.database.prepare('SELECT state_json FROM world_state').get());
    assert.equal(typeof stored.state_json, 'string');
    if (typeof stored.state_json !== 'string') throw new Error('missing state');
    const parsed: unknown = JSON.parse(stored.state_json);
    const corrupt = object(parsed);
    corrupt.year = 'broken';
    item.database.database.prepare('UPDATE world_state SET state_json = ?').run(JSON.stringify(corrupt));
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/world'), item.env)).status, 503);
    assert.equal((await item.worker.fetch(post('/api/catchup', { expectedRevision: 0, timestamp: '2026-10-16T00:06:00.000Z', commandId: 'corrupt-clock' }), item.env)).status, 503);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_transitions').get()).count, 0);
  } finally { item.cleanup(); }
});

void test('public history redacts operator identity and service bypass does not create identity', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    await item.worker.fetch(post('/api/action', action()), item.env);
    const history = await body(await item.worker.fetch(new Request('https://world.test/api/history'), item.env));
    assert.ok(Array.isArray(history.entries));
    const entry: unknown = history.entries[0];
    assert.equal('actorUserId' in object(object(entry).provenance), false);
    const bypass = post('/api/catchup', { expectedRevision: 1, timestamp: '2026-10-16T00:06:00.000Z', commandId: 'no-identity', userId: identity }, false);
    bypass.headers.set('OAI-Sites-Authorization', 'Bearer untrusted-test-value');
    assert.equal((await item.worker.fetch(bypass, item.env)).status, 401);
  } finally { item.cleanup(); }
});

void test('MCP validates origins even during public discovery', async () => {
  const item = fixture();
  try {
    const request = post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, false);
    request.headers.set('origin', 'https://untrusted.test');
    assert.equal((await item.worker.fetch(request, item.env)).status, 403);
    assert.equal((await item.worker.fetch(new Request('https://world.test/mcp'), item.env)).status, 405);
  } finally { item.cleanup(); }
});

void test('oversized streaming requests are cancelled before the entire body is consumed', async () => {
  const item = fixture();
  try {
    let chunks = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks += 1;
        controller.enqueue(new Uint8Array(1024).fill(32));
        if (chunks === 1000) controller.close();
      },
      cancel() { cancelled = true; },
    });
    const options = { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': identity }, body: stream, duplex: 'half' };
    const response = await item.worker.fetch(new Request('https://world.test/api/action', options), item.env);
    assert.equal(response.status, 413);
    assert.equal(cancelled, true);
    assert.ok(chunks < 200);
  } finally { item.cleanup(); }
});

void test('generated migrations carry real metadata and preserve schema constraints without seeded worlds', () => {
  const item = fixture();
  try {
    const parsed: unknown = JSON.parse(readFileSync(new URL('../server/migrations/meta/_journal.json', import.meta.url), 'utf8'));
    const journal = object(parsed);
    assert.equal(journal.dialect, 'sqlite');
    assert.ok(Array.isArray(journal.entries));
    assert.ok(journal.entries.length >= 2);
    assert.equal(object(journal.entries[0]).tag, '0000_world');
    let previousId = '00000000-0000-0000-0000-000000000000';
    let previousWhen = 0;
    let currentSnapshot: Record<string, unknown> = {};
    for (const [index, value] of journal.entries.entries()) {
      const entry = object(value);
      const prefix = String(index).padStart(4, '0');
      assert.equal(entry.idx, index);
      assert.equal(entry.breakpoints, true);
      assert.equal(typeof entry.tag, 'string');
      assert.match(String(entry.tag), new RegExp(`^${prefix}_[a-z0-9_]+$`));
      assert.ok(Number.isSafeInteger(entry.when) && Number(entry.when) >= previousWhen);
      const sql = readFileSync(new URL(`../server/migrations/${String(entry.tag)}.sql`, import.meta.url), 'utf8');
      assert.ok(sql.trim().length > 0);
      if (index > 0) item.database.database.exec(sql);
      currentSnapshot = object(JSON.parse(readFileSync(new URL(`../server/migrations/meta/${prefix}_snapshot.json`, import.meta.url), 'utf8')));
      assert.equal(currentSnapshot.version, entry.version);
      assert.equal(currentSnapshot.dialect, journal.dialect);
      assert.equal(currentSnapshot.prevId, previousId);
      assert.equal(typeof currentSnapshot.id, 'string');
      assert.notEqual(currentSnapshot.id, previousId);
      if (index === 0) assert.deepEqual(new Set(Object.keys(object(currentSnapshot.tables))), new Set(['world_state', 'world_transitions', 'world_receipts']));
      previousId = String(currentSnapshot.id);
      previousWhen = Number(entry.when);
    }
    const tables = item.database.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    assert.deepEqual(new Set(Object.keys(object(currentSnapshot.tables))), new Set(tables.map(table => table.name)));
    assert.ok(Object.hasOwn(object(currentSnapshot.tables), 'world_autonomy'));
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_state').get()).count, 0);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_transitions').get()).count, 0);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_receipts').get()).count, 0);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_autonomy').get()).count, 0);
    item.database.database.prepare('INSERT INTO world_state VALUES (?, ?, ?, ?, ?)').run('constraint-world', 0, '{}', '{}', epoch);
    assert.throws(() => item.database.database.prepare('UPDATE world_state SET revision = -1').run());
    const autonomy = item.database.database.prepare('INSERT INTO world_autonomy VALUES (?, ?, ?, ?)');
    assert.throws(() => autonomy.run('constraint-world', 0, '{}', epoch));
    assert.throws(() => autonomy.run('missing-world', 1, '{}', epoch));
    autonomy.run('constraint-world', 1, '{}', epoch);
    assert.throws(() => autonomy.run('constraint-world', 2, '{}', epoch));
    const insert = item.database.database.prepare('INSERT INTO world_transitions VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    assert.throws(() => insert.run('constraint-world', 0, 0, 'invalid-revision', '{}', '{}', '{}', '[]'));
    insert.run('constraint-world', 0, 1, 'same-receipt', '{}', '{}', '{}', '[]');
    assert.throws(() => insert.run('constraint-world', 1, 2, 'same-receipt', '{}', '{}', '{}', '[]'));
    assert.throws(() => insert.run('missing-world', 0, 1, 'foreign-key', '{}', '{}', '{}', '[]'));
    const indices = item.database.database.prepare("PRAGMA index_list('world_transitions')").all();
    assert.ok(indices.some((index) => index.name === 'world_transitions_receipt_unique' && index.unique === 1));
  } finally { item.cleanup(); }
});

function releaseInput(expectedRevision = 0): Record<string, unknown> {
  return { expectedRevision, expectedFromReleaseId: 'settlement-foundations-1', targetReleaseId: 'settlement-foundations-2', model: 'gpt-6.1-sol', commandId: 'release-2' };
}
function advanceInput(expectedRevision = 1): Record<string, unknown> {
  return { expectedRevision, cause: { kind: 'feature', id: 'history-advancement' }, reason: 'Verified delivery', deltaYears: 75, timestamp: '2026-10-16T00:01:00.000Z', model: 'gpt-6.1-sol', commandId: 'history-delivery' };
}

void test('protected release and history writes keep exact durable replay and the six-minute baseline', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    for (const route of ['/api/release-apply', '/api/history-advance']) assert.equal((await item.worker.fetch(post(route, {}, false), item.env)).status, 401);
    assert.equal((await item.worker.fetch(post('/api/release-apply', releaseInput()), item.env)).status, 200);
    assert.equal((await item.worker.fetch(post('/api/history-advance', advanceInput()), item.env)).status, 200);
    assert.equal((await body(await item.worker.fetch(post('/api/history-advance', advanceInput()), item.env))).duplicate, true);
    assert.equal((await item.worker.fetch(post('/api/catchup', { expectedRevision: 2, timestamp: '2026-10-16T00:06:00.000Z', commandId: 'normal-clock' }), item.env)).status, 200);
    const reopened = new SqliteD1(item.path);
    try {
      const repository = new WorldRepository(reopened);
      const current = await repository.read();
      assert.equal(current?.state.year, -9915);
      assert.equal(current?.state.clockTicks, 1);
      assert.equal(current?.state.clockEpoch, epoch);
      assert.equal(current?.state.phase, 0);
      assert.equal(current?.initial.releaseId, 'settlement-foundations-1');
      const history = await repository.history();
      assert.deepEqual(history.entries.map((entry) => entry.transition.kind), ['release-apply', 'history-advance', 'clock-catchup']);
      assert.equal(object(object(history.entries[0]?.transition).command).targetReleaseId, 'settlement-foundations-2');
      assert.ok(current);
      let reproduced = current.initial;
      for (const { transition } of history.entries) {
        const result = transition.kind === 'release-apply' ? applyRelease(reproduced, transition.command)
          : transition.kind === 'history-advance' ? applyHistoryAdvance(reproduced, transition.command)
            : transition.kind === 'clock-catchup' ? catchUpClock(reproduced, transition.timestamp) : null;
        assert.ok(result?.ok);
        reproduced = result.state;
      }
      assert.deepEqual(reproduced, current.state);
    } finally { reopened.database.close(); }
  } finally { item.cleanup(); }
});

void test('release races commit once and changed or stale history writes leave no partial records', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    const releases = await Promise.all([item.worker.fetch(post('/api/release-apply', releaseInput()), item.env), item.worker.fetch(post('/api/release-apply', releaseInput()), item.env)]);
    assert.deepEqual(releases.map((reply) => reply.status), [200, 200]);
    assert.equal((await Promise.all(releases.map(body))).filter((value) => value.duplicate === true).length, 1);
    for (const input of [{ ...advanceInput(), deltaYears: -1 }, { ...advanceInput(), timestamp: '2026-10-17T00:00:00.000Z' }, { ...advanceInput(), cause: { kind: 'event', id: 'unknown' } }, { ...advanceInput(), expectedRevision: 0 }]) assert.ok((await item.worker.fetch(post('/api/history-advance', input), item.env)).status >= 400);
    assert.equal((await new WorldRepository(item.database).read())?.state.revision, 1);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_transitions').get()).count, 1);
    assert.equal((await item.worker.fetch(post('/api/history-advance', advanceInput()), item.env)).status, 200);
    assert.equal((await item.worker.fetch(post('/api/history-advance', { ...advanceInput(), deltaYears: 76 }), item.env)).status, 409);
    assert.equal((await item.worker.fetch(post('/api/history-advance', { ...advanceInput(2), commandId: 'same-cause' }), item.env)).status, 400);
  } finally { item.cleanup(); }
});

void test('MCP discovers and applies explicit release and history operations through the same authorization', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    const invoke = (name: string, args: Record<string, unknown>, authenticated = true) => item.worker.fetch(post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, authenticated), item.env);
    assert.equal((await invoke('apply_release', releaseInput(), false)).status, 401);
    assert.equal((await invoke('apply_release', releaseInput())).status, 200);
    assert.equal((await invoke('advance_history', advanceInput())).status, 200);
    assert.equal((await new WorldRepository(item.database).read())?.state.revision, 2);
    const discovery = await body(await item.worker.fetch(post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, false), item.env));
    const listed = object(discovery.result).tools;
    assert.ok(Array.isArray(listed));
    assert.ok(listed.some((entry: unknown) => object(entry).name === 'apply_release'));
    assert.ok(listed.some((entry: unknown) => object(entry).name === 'advance_history'));
  } finally { item.cleanup(); }
});

void test('competing history causes commit one atomic transition and operation namespaces remain independent', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    const release = { ...releaseInput(), commandId: 'shared-id' };
    assert.equal((await item.worker.fetch(post('/api/release-apply', release), item.env)).status, 200);
    const requests = [{ ...advanceInput(), commandId: 'shared-id' }, { ...advanceInput(), cause: { kind: 'feature', id: 'release-evolution' }, commandId: 'other-cause' }];
    const replies = await Promise.all(requests.map((request) => item.worker.fetch(post('/api/history-advance', request), item.env)));
    assert.deepEqual(replies.map((reply) => reply.status).toSorted((a, b) => a - b), [200, 409]);
    assert.equal((await body(await item.worker.fetch(post('/api/release-apply', release), item.env))).duplicate, true);
    const current = await new WorldRepository(item.database).read();
    assert.equal(current?.state.revision, 2);
    assert.equal(Object.keys(current?.state.historyAdvances ?? {}).length, 1);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_transitions').get()).count, 2);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_receipts').get()).count, 3);
  } finally { item.cleanup(); }
});

void test('persisted corrupt history ledger fails closed for public reads and protected writes', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    await item.worker.fetch(post('/api/release-apply', releaseInput()), item.env);
    await item.worker.fetch(post('/api/history-advance', advanceInput()), item.env);
    const current = await new WorldRepository(item.database).read();
    assert.ok(current);
    const receipt = current.state.historyAdvances?.['feature:history-advancement'];
    assert.ok(receipt);
    receipt.yearAfter += 1;
    const bytes = JSON.stringify(current.state);
    item.database.database.prepare('UPDATE world_state SET state_json = ?').run(bytes);
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/world'), item.env)).status, 503);
    assert.equal((await item.worker.fetch(post('/api/catchup', { expectedRevision: 2, timestamp: epoch, commandId: 'corrupt-write' }), item.env)).status, 503);
    assert.equal(object(item.database.database.prepare('SELECT state_json FROM world_state').get()).state_json, bytes);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_transitions').get()).count, 2);
  } finally { item.cleanup(); }
});

void test('Director tool event discovery follows the shared event catalogue', async () => {
  const item = fixture();
  try {
    const discovery = await body(await item.worker.fetch(post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, false), item.env));
    const listed = object(discovery.result).tools;
    assert.ok(Array.isArray(listed));
    const director: unknown = listed.find((entry: unknown) => object(entry).name === 'director_tick');
    const properties = object(object(object(director).inputSchema).properties);
    assert.deepEqual(object(properties.event).enum, DIRECTOR_EVENTS.map((event) => event.id));
  } finally { item.cleanup(); }
});

void test('unchanged world reads use one revision-only indexed query, no snapshot parsing and no writes', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    const initial = await item.worker.fetch(new Request('https://world.test/api/world'), item.env);
    const etag = initial.headers.get('etag');
    assert.ok(etag);
    item.database.database.prepare("UPDATE world_state SET initial_json = '{', state_json = '{'").run();
    const changes = item.database.database.prepare('SELECT total_changes() AS count').get();
    const batches = item.database.batches;
    item.database.prepared.length = 0;
    const unchanged = await item.worker.fetch(new Request('https://world.test/api/world', { headers: { 'if-none-match': etag } }), item.env);
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.headers.get('etag'), etag);
    assert.equal(unchanged.headers.get('cache-control'), initial.headers.get('cache-control'));
    assert.equal(unchanged.headers.get('content-type'), null);
    assert.equal(unchanged.headers.get('content-length'), null);
    assert.equal(unchanged.body, null);
    assert.equal(await unchanged.text(), '');
    assert.deepEqual(item.database.prepared, ['SELECT revision FROM world_state WHERE world_id = ?']);
    assert.equal(item.database.batches, batches);
    assert.deepEqual(item.database.database.prepare('SELECT total_changes() AS count').get(), changes);
    const plan = item.database.database.prepare(`EXPLAIN QUERY PLAN ${item.database.prepared[0]}`).all('main');
    assert.ok(plan.some((row) => typeof row.detail === 'string' && row.detail.includes('SEARCH world_state USING INDEX')));
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/world'), item.env)).status, 503);
  } finally { item.cleanup(); }
});

void test('world ETags support weak comparisons, lists and wildcard and change only with committed revision', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    const initial = await item.worker.fetch(new Request('https://world.test/api/world'), item.env);
    const etag = initial.headers.get('etag');
    assert.ok(etag);
    const strong = etag.replace(/^W\//, '');
    for (const candidate of [etag, strong, `"other,tag", ${strong}`, `W/"other", ${etag}`, '*']) {
      assert.equal((await item.worker.fetch(new Request('https://world.test/api/world', { headers: { 'if-none-match': candidate } }), item.env)).status, 304);
    }
    for (const candidate of ['"other"', etag.slice(0, -1), `${strong}junk`, `*, ${strong}`]) {
      const current = await item.worker.fetch(new Request('https://world.test/api/world', { headers: { 'if-none-match': candidate } }), item.env);
      assert.equal(current.status, 200);
      assert.equal(current.headers.get('etag'), etag);
    }
    await item.worker.fetch(post('/api/action', action()), item.env);
    const updated = await item.worker.fetch(new Request('https://world.test/api/world', { headers: { 'if-none-match': etag } }), item.env);
    assert.equal(updated.status, 200);
    assert.notEqual(updated.headers.get('etag'), etag);
    assert.equal(object((await body(updated)).state).revision, 1);
  } finally { item.cleanup(); }
});

void test('conditional reads preserve unavailable-world errors and isolate equal revisions in separate runs', async () => {
  const item = fixture();
  try {
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/world', { headers: { 'if-none-match': '*' } }), item.env)).status, 503);
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    const first = await item.worker.fetch(new Request('https://world.test/api/world'), item.env);
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const other = { ...item.env, WORLD_ID: 'other-run' };
    await item.worker.fetch(post('/api/init', initialize()), other);
    const second = await item.worker.fetch(new Request('https://world.test/api/world', { headers: { 'if-none-match': etag } }), other);
    assert.equal(second.status, 200);
    assert.notEqual(second.headers.get('etag'), etag);
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/world', { headers: { 'if-none-match': etag } }), {})).status, 503);
  } finally { item.cleanup(); }
});

void test('conditional world reads tolerate bounded empty list elements without loading snapshots', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    const initial = await item.worker.fetch(new Request('https://world.test/api/world'), item.env);
    const etag = initial.headers.get('etag');
    assert.ok(etag);
    const strong = etag.replace(/^W\//, '');
    const changes = item.database.database.prepare('SELECT total_changes() AS count').get();
    const batches = item.database.batches;
    for (const candidate of [`, ${etag}`, `${etag},`, `"other", , ${etag}`, `, , ${etag}, ,`, `, "other,tag", , ${strong},`, `${','.repeat(32)}${etag}`]) {
      item.database.prepared.length = 0;
      const unchanged = await item.worker.fetch(new Request('https://world.test/api/world', { headers: { 'if-none-match': candidate } }), item.env);
      assert.equal(unchanged.status, 304, candidate);
      assert.equal(unchanged.headers.get('etag'), etag);
      assert.equal(unchanged.body, null);
      assert.deepEqual(item.database.prepared, ['SELECT revision FROM world_state WHERE world_id = ?']);
    }
    for (const candidate of [', ,', `, ${etag}, junk`, `${etag}, , W/invalid`, `${','.repeat(33)}${etag}`, `, *, ${etag}`]) {
      const current = await item.worker.fetch(new Request('https://world.test/api/world', { headers: { 'if-none-match': candidate } }), item.env);
      assert.equal(current.status, 200, candidate);
      assert.equal(current.headers.get('etag'), etag);
    }
    assert.equal(item.database.batches, batches);
    assert.deepEqual(item.database.database.prepare('SELECT total_changes() AS count').get(), changes);
  } finally { item.cleanup(); }
});

void test('bounded public chronicle pages omit snapshots and private identity while preserving full replay history', async (context) => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    await item.worker.fetch(post('/api/action', action()), item.env);
    await item.worker.fetch(post('/api/catchup', { expectedRevision: 1, timestamp: '2026-10-16T00:18:00.000Z', commandId: 'chronicle-clock' }), item.env);
    const store = new WorldRepository(item.database);
    const full = await store.history();
    const batches = item.database.batches;
    const changes = item.database.database.prepare('SELECT total_changes() AS count').get();
    item.database.prepared.length = 0;
    const first = await body(await item.worker.fetch(new Request('https://world.test/api/chronicle?after=0&limit=1'), item.env));
    assert.equal(first.hasMore, true);
    assert.equal(first.nextRevision, 1);
    assert.ok(Array.isArray(first.entries));
    assert.equal(first.entries.length, 1);
    const entry = object(first.entries[0]);
    assert.equal('state' in entry, false);
    assert.equal('actorUserId' in object(entry.provenance), false);
    assert.deepEqual(entry.events, full.entries[0]?.events);
    assert.deepEqual(entry.transition, full.entries[0]?.transition);
    assert.equal(entry.startRevision, 0);
    assert.equal(entry.endRevision, 1);
    assert.equal(item.database.prepared.length, 1);
    const query = item.database.prepared[0];
    assert.ok(query);
    assert.equal(query.includes('state_json'), false);
    assert.equal(query.includes('OFFSET'), false);
    const plan = item.database.database.prepare(`EXPLAIN QUERY PLAN ${query}`).all('main', 0, 2);
    assert.ok(plan.some((row) => typeof row.detail === 'string' && row.detail.includes('SEARCH world_transitions USING INDEX') && row.detail.includes('end_revision>?')));
    assert.equal(plan.some((row) => typeof row.detail === 'string' && row.detail.includes('TEMP B-TREE')), false);
    const second = await body(await item.worker.fetch(new Request(`https://world.test/api/chronicle?after=${first.nextRevision}&limit=1`), item.env));
    assert.equal(second.hasMore, false);
    assert.equal(second.nextRevision, null);
    assert.ok(Array.isArray(second.entries));
    assert.equal(object(second.entries[0]).startRevision, 1);
    assert.equal(object(second.entries[0]).endRevision, 4);
    const publicHistory = await body(await item.worker.fetch(new Request('https://world.test/api/history'), item.env));
    assert.ok(Array.isArray(publicHistory.entries));
    assert.deepEqual(object(publicHistory.entries[0]).state, full.entries[0]?.state);
    const firstEntries: unknown[] = first.entries;
    const secondEntries: unknown[] = second.entries;
    const chronicleBytes = Buffer.byteLength(JSON.stringify({ entries: [...firstEntries, ...secondEntries], hasMore: false, nextRevision: null }));
    const historyBytes = Buffer.byteLength(JSON.stringify(publicHistory));
    assert.ok(chronicleBytes * 5 < historyBytes);
    context.diagnostic(JSON.stringify({ workload: 'one-action-three-clock-ticks-two-transition-page', historyBytes, chronicleBytes, unchangedWorldBodyBytes: 0 }));
    assert.equal(item.database.batches, batches);
    assert.deepEqual(item.database.database.prepare('SELECT total_changes() AS count').get(), changes);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_receipts').get()).count, 3);
  } finally { item.cleanup(); }
});

void test('chronicle bounds reject invalid cursors and limits before SQL and never parse stored snapshots', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    await item.worker.fetch(post('/api/action', action()), item.env);
    item.database.prepared.length = 0;
    for (const query of ['after=-1', 'after=1.5', 'after=nope', 'after=9007199254740992', 'limit=0', 'limit=201', 'limit=1.5']) {
      assert.equal((await item.worker.fetch(new Request(`https://world.test/api/chronicle?${query}`), item.env)).status, 400);
    }
    assert.deepEqual(item.database.prepared, []);
    item.database.database.prepare("UPDATE world_transitions SET state_json = '{'").run();
    const chronicle = await item.worker.fetch(new Request('https://world.test/api/chronicle'), item.env);
    assert.equal(chronicle.status, 200);
    const page = await body(chronicle);
    assert.ok(Array.isArray(page.entries));
    assert.equal(page.entries.length, 1);
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/history'), item.env)).status, 503);
  } finally { item.cleanup(); }
});

void test('malformed optional trade state fails closed through the shared hosted validator without writes', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    const current = await new WorldRepository(item.database).read();
    assert.ok(current);
    const invalid = { ...current.state, tradeOffers: { forged: true } };
    const bytes = JSON.stringify(invalid);
    item.database.database.prepare('UPDATE world_state SET state_json = ?').run(bytes);
    const changes = item.database.database.prepare('SELECT total_changes() AS count').get();
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/world'), item.env)).status, 503);
    assert.equal((await item.worker.fetch(post('/api/action', action()), item.env)).status, 503);
    assert.equal(object(item.database.database.prepare('SELECT state_json FROM world_state').get()).state_json, bytes);
    assert.deepEqual(item.database.database.prepare('SELECT total_changes() AS count').get(), changes);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_transitions').get()).count, 0);
  } finally { item.cleanup(); }
});

function encodedHistoryFixture(source: string, overrides: Record<string, unknown> = {}) {
  const bytes = Buffer.from(source);
  return 'blabla-snapshot:' + JSON.stringify({ version: 1, codec: 'gzip', utf8Bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), data: gzipSync(bytes).toString('base64'), ...overrides });
}

await test('mixed versioned history preserves exact frames, pagination, replay and duplicate receipts after restart', async () => {
  const item = fixture();
  try {
    assert.equal((await item.worker.fetch(post('/api/init', initialize()), item.env)).status, 200);
    assert.equal((await item.worker.fetch(post('/api/action', action()), item.env)).status, 200);
    assert.equal((await item.worker.fetch(post('/api/catchup', { expectedRevision: 1, timestamp: '2026-10-16T00:12:00.000Z', commandId: 'mixed-clock' }), item.env)).status, 200);
    const repository = new WorldRepository(item.database);
    const original = await repository.history();
    const current = await repository.read();
    assert.ok(current);
    const row = object(item.database.database.prepare('SELECT state_json FROM world_transitions WHERE end_revision = 1').get());
    assert.equal(typeof row.state_json, 'string');
    item.database.database.prepare('UPDATE world_transitions SET state_json = ? WHERE end_revision = 1').run(encodedHistoryFixture(String(row.state_json)));
    const restarted = new SqliteD1(item.path);
    try {
      const store = new WorldRepository(restarted);
      const beforeChanges = object(restarted.database.prepare('SELECT total_changes() AS count').get()).count;
      assert.deepEqual(await store.history(), original);
      const first = await store.history(0, 1);
      assert.equal(first.hasMore, true);
      assert.equal(first.nextRevision, 1);
      const second = await store.history(first.nextRevision, 1);
      assert.equal(second.hasMore, false);
      assert.deepEqual([...first.entries, ...second.entries], original.entries);
      let reproduced = current.initial;
      for (const entry of (await store.history()).entries) {
        const result = entry.transition.kind === 'action' ? applyCommand(reproduced, entry.transition.command)
          : entry.transition.kind === 'clock-catchup' ? catchUpClock(reproduced, entry.transition.timestamp) : null;
        assert.ok(result?.ok);
        assert.deepEqual(result.state, entry.state);
        reproduced = result.state;
      }
      assert.deepEqual(reproduced, current.state);
      const response = await item.worker.fetch(new Request('https://world.test/api/history?limit=1'), { ...item.env, DB: restarted });
      assert.equal(response.status, 200);
      const page = await body(response);
      assert.ok(Array.isArray(page.entries));
      assert.equal('actorUserId' in object(object(page.entries[0]).provenance), false);
      const duplicate = await body(await item.worker.fetch(post('/api/action', action()), { ...item.env, DB: restarted }));
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.acceptedRevision, 1);
      assert.equal(object(restarted.database.prepare('SELECT total_changes() AS count').get()).count, beforeChanges);
      assert.deepEqual(await store.read(), current);
    } finally { restarted.database.close(); }
  } finally { item.cleanup(); }
});

await test('malformed versioned history fails with 503 without changing world, receipts or unrelated reads', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    await item.worker.fetch(post('/api/action', action()), item.env);
    const repository = new WorldRepository(item.database);
    const current = await repository.read();
    const row = object(item.database.database.prepare('SELECT state_json FROM world_transitions').get());
    assert.equal(typeof row.state_json, 'string');
    for (const encoded of [encodedHistoryFixture(String(row.state_json), { version: 2 }), encodedHistoryFixture(String(row.state_json), { codec: 'deflate' }), encodedHistoryFixture(String(row.state_json), { sha256: '0'.repeat(64) }), 'blabla-snapshot:{', 'blabla-snapshot:' + '!'.repeat(200 * 1024 + 1)]) {
      item.database.database.prepare('UPDATE world_transitions SET state_json = ?').run(encoded);
      const changes = object(item.database.database.prepare('SELECT total_changes() AS count').get()).count;
      const receipts = item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all();
      const response = await item.worker.fetch(new Request('https://world.test/api/history'), item.env);
      assert.equal(response.status, 503);
      assert.equal((await body(response)).ok, false);
      assert.equal((await item.worker.fetch(new Request('https://world.test/api/chronicle'), item.env)).status, 200);
      assert.equal((await item.worker.fetch(new Request('https://world.test/api/world'), item.env)).status, 200);
      assert.deepEqual(await repository.read(), current);
      assert.deepEqual(item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all(), receipts);
      assert.equal(object(item.database.database.prepare('SELECT total_changes() AS count').get()).count, changes);
    }
    item.database.database.prepare('UPDATE world_transitions SET state_json = ?').run(String(row.state_json));
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/history'), item.env)).status, 200);
  } finally { item.cleanup(); }
});

await test('history decoder introduction leaves initial, current and every newly written transition raw', async () => {
  const item = fixture();
  try {
    await item.worker.fetch(post('/api/init', initialize()), item.env);
    await item.worker.fetch(post('/api/action', action()), item.env);
    const repository = new WorldRepository(item.database);
    const original = await repository.history();
    const first = original.entries[0];
    assert.ok(first);
    const historical = JSON.stringify(first.state);
    item.database.database.prepare('UPDATE world_transitions SET state_json = ?').run(encodedHistoryFixture(historical));
    assert.equal((await item.worker.fetch(post('/api/catchup', { expectedRevision: 1, timestamp: '2026-10-16T00:12:00.000Z', commandId: 'raw-writer-clock' }), item.env)).status, 200);
    const current = await repository.read();
    assert.ok(current);
    const row = object(item.database.database.prepare('SELECT initial_json, state_json FROM world_state').get());
    assert.equal(row.initial_json, JSON.stringify(current.initial));
    assert.equal(row.state_json, JSON.stringify(current.state));
    const latest = object(item.database.database.prepare('SELECT state_json FROM world_transitions ORDER BY end_revision DESC LIMIT 1').get());
    assert.equal(latest.state_json, JSON.stringify(current.state));
    assert.deepEqual((await repository.history()).entries[0]?.state, original.entries[0]?.state);
    item.database.database.prepare('UPDATE world_state SET state_json = ?').run(encodedHistoryFixture(JSON.stringify(current.state)));
    assert.equal((await item.worker.fetch(new Request('https://world.test/api/world'), item.env)).status, 503);
    item.database.database.prepare('UPDATE world_state SET state_json = ?').run(JSON.stringify(current.state));
  } finally { item.cleanup(); }
});

await test('mixed encoded recovery history retains every release, production and damage frame exactly', async () => {
  const item = fixture();
  try {
    const { repository, damaged } = await recoveryWorld(item);
    const original = await repository.history(0, 200);
    assert.equal(original.entries.length, 10);
    for (const [index, entry] of original.entries.entries()) {
      if (index % 2 === 0)
        item.database.database.prepare('UPDATE world_transitions SET state_json = ? WHERE end_revision = ?').run(encodedHistoryFixture(JSON.stringify(entry.state)), entry.endRevision);
    }
    const changes = object(item.database.database.prepare('SELECT total_changes() AS count').get()).count;
    const decoded = await repository.history(0, 200);
    assert.deepEqual(decoded, original);
    let reproduced = damaged.initial;
    for (const entry of decoded.entries) {
      const transition = entry.transition;
      const result = transition.kind === 'action' ? applyCommand(reproduced, transition.command)
        : transition.kind === 'release-apply' ? applyRelease(reproduced, transition.command)
        : transition.kind === 'strategy-catchup' ? catchUpStrategy(reproduced, transition.timestamp)
        : transition.kind === 'director-tick' ? applyDirectorTick(reproduced, transition.command) : null;
      assert.ok(result?.ok);
      assert.deepEqual(result.state, entry.state);
      reproduced = result.state;
    }
    assert.deepEqual(reproduced, damaged.state);
    assert.equal(object(item.database.database.prepare('SELECT total_changes() AS count').get()).count, changes);
  } finally { item.cleanup(); }
});

for (const encoded of [false, true]) {
  await test(`${encoded ? 'encoded' : 'raw'} history rejects a canonical frame whose revision does not match its transition row`, async () => {
    const item = fixture();
    try {
      await item.worker.fetch(post('/api/init', initialize()), item.env);
      await item.worker.fetch(post('/api/action', action()), item.env);
      const repository = new WorldRepository(item.database);
      const current = await repository.read();
      assert.ok(current);
      assert.equal(current.initial.revision, 0);
      assert.equal(current.state.revision, 1);
      const incorrect = JSON.stringify(current.initial);
      item.database.database.prepare('UPDATE world_transitions SET state_json = ? WHERE end_revision = 1').run(encoded ? encodedHistoryFixture(incorrect) : incorrect);
      const changes = object(item.database.database.prepare('SELECT total_changes() AS count').get()).count;
      const receipts = item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all();
      const response = await item.worker.fetch(new Request('https://world.test/api/history'), item.env);
      assert.equal(response.status, 503);
      assert.equal((await body(response)).error, 'corrupt_history');
      assert.equal((await item.worker.fetch(new Request('https://world.test/api/chronicle'), item.env)).status, 200);
      assert.deepEqual(await repository.read(), current);
      assert.deepEqual(item.database.database.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all(), receipts);
      assert.equal(object(item.database.database.prepare('SELECT total_changes() AS count').get()).count, changes);
      const correct = JSON.stringify(current.state);
      item.database.database.prepare('UPDATE world_transitions SET state_json = ? WHERE end_revision = 1').run(encoded ? encodedHistoryFixture(correct) : correct);
      assert.deepEqual((await repository.history()).entries[0]?.state, current.state);
    } finally { item.cleanup(); }
  });
}

async function historyBudgetWorld(item: ReturnType<typeof fixture>, count: number) {
  const repository = new WorldRepository(item.database);
  await repository.initialize(initialize(), identity, now().toISOString());
  for (let step = 0; step < count; step += 1) {
    const current = await repository.read();
    assert.ok(current);
    await repository.mutate('action', { seat: current.state.phase, expectedRevision: current.state.revision, action: { type: 'wait' }, model: 'synthetic-history-budget-fixture', commandId: `history-budget-${step}` }, identity, now().toISOString());
  }
  return repository;
}

function replaceBudgetFrame(item: ReturnType<typeof fixture>, revision: number, objective: string, encoded = false) {
  const row = object(item.database.database.prepare('SELECT state_json FROM world_transitions WHERE end_revision = ?').get(revision));
  assert.ok(typeof row.state_json === 'string');
  const value: unknown = JSON.parse(row.state_json);
  const state = object(value);
  assert.ok(Array.isArray(state.civilizations));
  state.civilizations[0] = { ...object(state.civilizations[0]), objective };
  const text = JSON.stringify(state);
  item.database.database.prepare('UPDATE world_transitions SET state_json = ? WHERE end_revision = ?').run(encoded ? encodedHistoryFixture(text) : text, revision);
  return text;
}

await test('history budgets select UTF-8 metadata before two indexed queries and retain only a contiguous prefix', async (context) => {
  const item = fixture();
  try {
    const repository = await historyBudgetWorld(item, 4);
    const expected = [1, 2, 3, 4].map((revision) => replaceBudgetFrame(item, revision, '中'.repeat(130_000)));
    item.database.reads.length = 0;
    const changes = object(item.database.database.prepare('SELECT total_changes() AS count').get()).count;
    const page = await repository.history(0, 200);
    assert.deepEqual(page.entries.map((entry) => entry.endRevision), [1, 2]);
    assert.equal(page.hasMore, true);
    assert.equal(page.nextRevision, 2);
    assert.equal(item.database.reads.length, 2);
    const metadata = item.database.reads[0];
    const payload = item.database.reads[1];
    assert.ok(metadata && payload);
    assert.equal(metadata.results.length, 4);
    assert.equal(payload.results.length, 2);
    assert.equal(object(metadata.results[0]).snapshot_bytes, Buffer.byteLength(expected[0] ?? ''));
    assert.equal(metadata.results.every((row) => Object.values(object(row)).every((value) => typeof value === 'number')), true);
    for (const read of item.database.reads) {
      const plan = item.database.database.prepare(`EXPLAIN QUERY PLAN ${read.sql}`).all(...read.values);
      assert.ok(plan.some((row) => /SEARCH.*world_transitions.*INDEX/.test(String(row.detail))));
      assert.equal(plan.some((row) => /TEMP B-TREE/.test(String(row.detail))), false);
    }
    const retained = payload.results.reduce<number>((sum, row) => sum + ['state_json', 'transition_json', 'provenance_json', 'events_json'].reduce((bytes, key) => bytes + Buffer.byteLength(String(object(row)[key])), 0), 0);
    const output = Buffer.byteLength(JSON.stringify(page));
    assert.ok(retained <= 1024 * 1024);
    assert.ok(output <= 1024 * 1024);
    context.diagnostic(JSON.stringify({ workload: 'four-raw-frames-with-130000-CJK-objective', queries: item.database.reads.length, metadataRows: metadata.results.length, hydratedRows: payload.results.length, retainedSourceUtf8Bytes: retained, outputUtf8Bytes: output, node: process.version }));
    assert.deepEqual((await repository.history(2, 200)).entries.map((entry) => entry.endRevision), [3, 4]);
    assert.equal(object(item.database.database.prepare('SELECT total_changes() AS count').get()).count, changes);
  } finally { item.cleanup(); }
});

for (const oversizedRevision of [1, 2]) {
  await test(`oversized legacy frame at revision ${oversizedRevision} remains a single reachable page`, async () => {
    const item = fixture();
    try {
      const repository = await historyBudgetWorld(item, 3);
      const huge = replaceBudgetFrame(item, oversizedRevision, 'é'.repeat(600_000));
      const revisions: number[] = [];
      let after = 0;
      for (let pages = 0; pages < 4; pages += 1) {
        const page = await repository.history(after, 200);
        assert.ok(page.entries.length > 0);
        if (page.entries.some((entry) => entry.endRevision === oversizedRevision)) {
          assert.equal(page.entries.length, 1);
          assert.equal(JSON.stringify(page.entries[0]?.state), huge);
          assert.ok(Buffer.byteLength(JSON.stringify(page)) > 1024 * 1024);
        } else assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1024 * 1024);
        revisions.push(...page.entries.map((entry) => entry.endRevision));
        if (!page.hasMore) { assert.equal(page.nextRevision, null); break; }
        assert.ok(page.nextRevision !== null && page.nextRevision > after);
        after = page.nextRevision;
      }
      assert.deepEqual(revisions, [1, 2, 3]);
    } finally { item.cleanup(); }
  });
}

await test('encoded snapshots reserve bounded decoded space and every mixed page replays without omitted frames', async () => {
  const item = fixture();
  try {
    const repository = await historyBudgetWorld(item, 20);
    const original = item.database.database.prepare('SELECT end_revision, state_json FROM world_transitions ORDER BY end_revision').all();
    for (const row of original) {
      assert.ok(typeof row.state_json === 'string' && typeof row.end_revision === 'number');
      item.database.database.prepare('UPDATE world_transitions SET state_json = ? WHERE end_revision = ?').run(encodedHistoryFixture(row.state_json), row.end_revision);
    }
    item.database.reads.length = 0;
    const first = await repository.history(0, 200);
    assert.equal(first.entries.length, 7);
    assert.equal(first.hasMore, true);
    assert.equal(item.database.reads.length, 2);
    assert.equal(item.database.reads[1]?.results.length, 7);
    const current = await repository.read();
    assert.ok(current);
    const restored = original[7];
    assert.ok(restored && typeof restored.state_json === 'string' && typeof restored.end_revision === 'number');
    item.database.database.prepare('UPDATE world_transitions SET state_json = ? WHERE end_revision = ?').run(restored.state_json, restored.end_revision);
    let reproduced = current.initial;
    const revisions: number[] = [];
    let after = 0;
    for (let pages = 0; pages < 21; pages += 1) {
      const page = await repository.history(after, 200);
      assert.ok(page.entries.length > 0);
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1024 * 1024);
      for (const entry of page.entries) {
        assert.equal(entry.transition.kind, 'action');
        if (entry.transition.kind !== 'action') throw new Error('Expected real fixture action');
        const result = applyCommand(reproduced, entry.transition.command);
        assert.ok(result.ok);
        assert.deepEqual(result.state, entry.state);
        reproduced = result.state;
        revisions.push(entry.endRevision);
      }
      if (!page.hasMore) break;
      assert.ok(page.nextRevision !== null && page.nextRevision > after);
      after = page.nextRevision;
    }
    assert.deepEqual(revisions, Array.from({ length: 20 }, (_, index) => index + 1));
    assert.deepEqual(reproduced, current.state);
  } finally { item.cleanup(); }
});

await test('decoded output can stop before the hydrated prefix without losing the withheld frame', async () => {
  const item = fixture();
  try {
    const repository = await historyBudgetWorld(item, 3);
    for (const revision of [1, 2]) {
      const row = object(item.database.database.prepare('SELECT state_json FROM world_transitions WHERE end_revision = ?').get(revision));
      assert.ok(typeof row.state_json === 'string');
      const source = row.state_json.slice(0, -1) + ',"numericPadding":[' + Array.from({ length: 60_000 }, () => '1e9').join(',') + ']}';
      item.database.database.prepare('UPDATE world_transitions SET state_json = ? WHERE end_revision = ?').run(source, revision);
    }
    item.database.reads.length = 0;
    const first = await repository.history(0, 200);
    assert.equal(item.database.reads[1]?.results.length, 3);
    assert.deepEqual(first.entries.map((entry) => entry.endRevision), [1]);
    assert.equal(first.hasMore, true);
    assert.equal(first.nextRevision, 1);
    assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 1024 * 1024);
    const next = await repository.history(1, 200);
    assert.deepEqual(next.entries.map((entry) => entry.endRevision), [2, 3]);
    assert.equal(next.hasMore, false);
  } finally { item.cleanup(); }
});

await test('encoded frame with oversized ancillary history remains a singleton and malformed encoded input never hydrates', async () => {
  const item = fixture();
  try {
    const repository = await historyBudgetWorld(item, 2);
    const row = object(item.database.database.prepare('SELECT state_json, events_json FROM world_transitions WHERE end_revision = 1').get());
    assert.ok(typeof row.state_json === 'string' && typeof row.events_json === 'string');
    const parsed: unknown = JSON.parse(row.events_json);
    assert.ok(Array.isArray(parsed));
    parsed[0] = { ...object(parsed[0]), detail: 'x'.repeat(1024 * 1024) };
    item.database.database.prepare('UPDATE world_transitions SET state_json = ?, events_json = ? WHERE end_revision = 1').run(encodedHistoryFixture(row.state_json), JSON.stringify(parsed));
    const first = await repository.history(0, 200);
    assert.deepEqual(first.entries.map((entry) => entry.endRevision), [1]);
    assert.equal(first.hasMore, true);
    assert.deepEqual((await repository.history(1, 200)).entries.map((entry) => entry.endRevision), [2]);
    item.database.database.prepare('UPDATE world_transitions SET state_json = ? WHERE end_revision = 1').run('blabla-snapshot:' + '!'.repeat(200 * 1024 + 1));
    item.database.reads.length = 0;
    const changes = object(item.database.database.prepare('SELECT total_changes() AS count').get()).count;
    const reply = await item.worker.fetch(new Request('https://world.test/api/history'), item.env);
    assert.equal(reply.status, 503);
    assert.equal((await body(reply)).error, 'history_snapshot_envelope_limit');
    assert.equal(item.database.reads.length, 1);
    assert.equal(item.database.reads[0]?.results.every((value) => !('state_json' in object(value))), true);
    assert.equal(object(item.database.database.prepare('SELECT total_changes() AS count').get()).count, changes);
  } finally { item.cleanup(); }
});

await test('history row limits retain metadata lookahead and invalid or exhausted cursors do not hydrate rows', async () => {
  const item = fixture();
  try {
    const repository = await historyBudgetWorld(item, 3);
    for (const path of ['/api/history?after=-1', '/api/history?after=1.5', '/api/history?limit=0', '/api/history?limit=201']) {
      item.database.reads.length = 0;
      assert.equal((await item.worker.fetch(new Request(`https://world.test${path}`), item.env)).status, 400);
      assert.equal(item.database.reads.length, 0);
    }
    const revisions: number[] = [];
    for (let after = 0; after < 3; after += 1) {
      item.database.reads.length = 0;
      const page = await repository.history(after, 1);
      assert.deepEqual(page.entries.map((entry) => entry.endRevision), [after + 1]);
      assert.equal(page.hasMore, after < 2);
      assert.equal(page.nextRevision, after < 2 ? after + 1 : null);
      assert.equal(item.database.reads.length, 2);
      assert.equal(item.database.reads[0]?.values.at(-1), 2);
      assert.equal(item.database.reads[0]?.results.length, Math.min(2, 3 - after));
      assert.equal(item.database.reads[1]?.results.length, 1);
      revisions.push(...page.entries.map((entry) => entry.endRevision));
    }
    assert.deepEqual(revisions, [1, 2, 3]);
    item.database.reads.length = 0;
    assert.deepEqual(await repository.history(3), { entries: [], hasMore: false, nextRevision: null });
    assert.equal(item.database.reads.length, 1);
  } finally { item.cleanup(); }
});

await test('history refuses missing or mismatched hydrated revisions instead of advancing past a selected frame', async () => {
  const item = fixture();
  try {
    await historyBudgetWorld(item, 2);
    for (const mismatch of [false, true]) {
      const database: D1Database = {
        prepare(sql) {
          const statement = item.database.prepare(sql);
          return {
            bind(...values) { statement.bind(...values); return this; },
            async all() {
              const result = await statement.all();
              if (sql.startsWith('SELECT start_revision') && sql.includes('state_json')) {
                if (mismatch) result.results[0] = { ...object(result.results[0]), end_revision: 7 };
                else result.results.pop();
              }
              return result;
            },
            run: () => statement.run(),
          };
        },
        batch: (statements) => item.database.batch(statements),
      };
      const response = await item.worker.fetch(new Request('https://world.test/api/history'), { ...item.env, DB: database });
      assert.equal(response.status, 503);
      assert.equal((await body(response)).error, 'corrupt_history');
    }
    assert.deepEqual((await new WorldRepository(item.database).history()).entries.map((entry) => entry.endRevision), [1, 2]);
  } finally { item.cleanup(); }
});
