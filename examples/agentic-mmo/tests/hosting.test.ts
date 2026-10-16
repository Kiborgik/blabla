import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { applyCommand, catchUpClock } from '../core/engine.ts';
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
  constructor(path = ':memory:') { this.database = new DatabaseSync(path); }
  prepare(sql: string): D1Statement { return new SqliteStatement(this.database, sql); }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
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
