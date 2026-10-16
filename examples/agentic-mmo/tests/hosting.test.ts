import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { DIRECTOR_EVENTS } from '../core/content.ts';
import { applyCommand, applyHistoryAdvance, applyRelease, catchUpClock, catchUpStrategy } from '../core/engine.ts';
import { createWorker } from '../server/worker.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const now = () => new Date('2026-10-16T01:00:00.000Z');
const identity = 'verified-site-operator';

class SqliteStatement implements D1Statement {
  private readonly database: DatabaseSync;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: DatabaseSync, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { results: [], meta: { changes: Number(result.changes) } };
  }
  async run(): Promise<D1Result> { return this.execute(); }
}

class SqliteD1 implements D1Database {
  readonly database: DatabaseSync;
  readonly prepared: string[] = [];
  batches = 0;
  constructor(path = ':memory:') { this.database = new DatabaseSync(path); }
  prepare(sql: string): D1Statement { this.prepared.push(sql); return new SqliteStatement(this.database, sql); }
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
    assert.equal(journal.entries.length, 1);
    const entry: unknown = journal.entries[0];
    assert.equal(object(entry).tag, '0000_world');
    const snapshotValue: unknown = JSON.parse(readFileSync(new URL('../server/migrations/meta/0000_snapshot.json', import.meta.url), 'utf8'));
    const snapshot = object(snapshotValue);
    assert.equal(snapshot.version, object(entry).version);
    assert.equal(snapshot.dialect, journal.dialect);
    assert.deepEqual(new Set(Object.keys(object(snapshot.tables))), new Set(['world_state', 'world_transitions', 'world_receipts']));
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_state').get()).count, 0);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_transitions').get()).count, 0);
    assert.equal(object(item.database.database.prepare('SELECT COUNT(*) AS count FROM world_receipts').get()).count, 0);
    item.database.database.prepare('INSERT INTO world_state VALUES (?, ?, ?, ?, ?)').run('constraint-world', 0, '{}', '{}', epoch);
    assert.throws(() => item.database.database.prepare('UPDATE world_state SET revision = -1').run());
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
