import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';
import { createWorker } from '../server/worker.ts';

const owner = 'synthetic-private-owner';
const other = 'synthetic-private-other';
const epoch = '2026-10-16T00:00:00.000Z';

function object(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}

class Statement implements D1Statement {
  private readonly database: ReceiptDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: ReceiptDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> {
    const results = this.database.sql.prepare(this.sql).all(...this.values);
    this.database.reads.push({ sql: this.sql, values: this.values, results });
    const after = this.database.afterRead;
    this.database.afterRead = undefined;
    await after?.();
    return { results, meta: { changes: 0 } };
  }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}

class ReceiptDatabase implements D1Database {
  readonly sql: DatabaseSync;
  readonly reads: Array<{ sql: string; values: SqlValue[]; results: unknown[] }> = [];
  afterRead: (() => Promise<void>) | undefined;
  batches = 0;
  constructor(path: string) { this.sql = new DatabaseSync(path); }
  prepare(sql: string): D1Statement { return new Statement(this, sql); }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
    this.batches += 1;
    this.sql.exec('BEGIN');
    try {
      const results = statements.map((statement) => { assert.ok(statement instanceof Statement); return statement.execute(); });
      this.sql.exec('COMMIT');
      return results;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}

async function fixture(initialized = true) {
  const directory = mkdtempSync(join(tmpdir(), 'action-receipt-'));
  const path = join(directory, 'world.sqlite');
  const database = new ReceiptDatabase(path);
  database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8'));
  const repository = new WorldRepository(database);
  if (initialized) await repository.initialize({ seed: 1701, clockEpoch: epoch, commandId: 'synthetic-initialize' }, owner, epoch);
  const worker = createWorker(undefined, { now: () => new Date('2030-01-01T00:00:00.000Z') });
  const env = { DB: database, AGENT_WRITER_USER_IDS: `${owner},${other}` };
  return { database, repository, worker, env, path, cleanup: () => { database.sql.close(); rmSync(directory, { recursive: true, force: true }); } };
}

function rpc(name: string, args: Record<string, unknown>, caller: string | null = owner, origin?: string): Request {
  return new Request('https://world.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...(caller === null ? {} : { 'oai-authenticated-user-id': caller }), ...(origin === undefined ? {} : { origin }) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
}

async function outcome(response: Response): Promise<Record<string, unknown>> {
  assert.equal(response.status, 200);
  const value: unknown = await response.json();
  const result = object(object(value).result);
  assert.equal(result.isError, false);
  const structured = object(result.structuredContent);
  assert.ok(Array.isArray(result.content));
  assert.equal(object(result.content[0]).text, JSON.stringify(structured));
  return structured;
}

function records(database: ReceiptDatabase) {
  return {
    state: database.sql.prepare('SELECT * FROM world_state ORDER BY world_id').all(),
    transitions: database.sql.prepare('SELECT * FROM world_transitions ORDER BY world_id, end_revision').all(),
    receipts: database.sql.prepare('SELECT * FROM world_receipts ORDER BY world_id, receipt_key').all(),
    changes: database.sql.prepare('SELECT total_changes() AS count').get(),
    batches: database.batches,
  };
}

async function accept(item: Awaited<ReturnType<typeof fixture>>, commandId = 'synthetic-action', seat = 0, expectedRevision = 0) {
  return item.repository.mutate('action', { seat, expectedRevision, action: { type: 'wait' }, model: 'synthetic-receipt-fixture', commandId, privateFixtureMarker: 'request-must-never-escape' }, owner, epoch);
}

await test('action receipt discovery declares the exact read-only command-ID surface', async () => {
  const item = await fixture();
  try {
    const response = await item.worker.fetch(new Request('https://world.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), item.env);
    assert.equal(response.status, 200);
    const raw: unknown = await response.json();
    const tools = object(object(raw).result).tools;
    assert.ok(Array.isArray(tools));
    const tool = tools.map(object).find((candidate) => candidate.name === 'action_receipt');
    assert.ok(tool);
    assert.equal(object(tool.annotations).readOnlyHint, true);
    const schema = object(tool.inputSchema);
    assert.deepEqual(schema.required, ['commandId']);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(Object.keys(object(schema.properties)), ['commandId']);
  } finally { item.cleanup(); }
});

await test('owned receipt preserves original acceptance across later commits and uses one indexed revision/key read', async () => {
  const item = await fixture();
  try {
    await accept(item);
    await accept(item, 'synthetic-later-action', 1, 1);
    item.database.reads.length = 0;
    const before = records(item.database);
    const result = await outcome(await item.worker.fetch(rpc('action_receipt', { commandId: 'synthetic-action' }), item.env));
    assert.deepEqual(result, { ok: true, operation: 'action', commandId: 'synthetic-action', status: 'accepted', observedRevision: 2, acceptedRevision: 1 });
    assert.deepEqual(records(item.database), before);
    assert.equal(item.database.reads.length, 1);
    const read = item.database.reads[0];
    assert.ok(read);
    assert.equal(read.results.length, 1);
    assert.ok(/world_state/.test(read.sql) && /world_receipts/.test(read.sql));
    assert.equal(/state_json|initial_json|world_transitions/i.test(read.sql), false);
    const plans = item.database.sql.prepare(`EXPLAIN QUERY PLAN ${read.sql}`).all(...read.values);
    assert.ok(plans.filter((plan) => /SEARCH.*INDEX/.test(String(plan.detail))).length >= 2);
    assert.equal(plans.some((plan) => /SCAN|TEMP B-TREE/.test(String(plan.detail))), false);
    const serialized = JSON.stringify(result);
    for (const secret of [owner, other, 'actorUserId', 'request_json', 'response_json', 'request-must-never-escape']) assert.equal(serialized.includes(secret), false);
  } finally { item.cleanup(); }
});

await test('receipt read survives process restart without rewriting state or receipts', async () => {
  const item = await fixture();
  try {
    await accept(item);
    const restarted = new ReceiptDatabase(item.path);
    try {
      const before = records(restarted);
      const result = await outcome(await item.worker.fetch(rpc('action_receipt', { commandId: 'synthetic-action' }), { ...item.env, DB: restarted }));
      assert.equal(result.status, 'accepted');
      assert.equal(result.acceptedRevision, 1);
      assert.deepEqual(records(restarted), before);
    } finally { restarted.sql.close(); }
  } finally { item.cleanup(); }
});

await test('missing and another enrolled callers key are indistinguishable snapshot-scoped absences', async () => {
  const item = await fixture();
  try {
    await accept(item);
    const before = records(item.database);
    const absent = await outcome(await item.worker.fetch(rpc('action_receipt', { commandId: 'unseen-action' }, other), item.env));
    const foreign = await outcome(await item.worker.fetch(rpc('action_receipt', { commandId: 'synthetic-action' }, other), item.env));
    assert.deepEqual(absent, { ok: true, operation: 'action', commandId: 'unseen-action', status: 'not_found', observedRevision: 1 });
    assert.deepEqual({ ...foreign, commandId: 'unseen-action' }, absent);
    assert.deepEqual(records(item.database), before);
    item.database.sql.prepare('UPDATE world_receipts SET response_json = ? WHERE receipt_key = ?').run('not-json-private-response', 'action:synthetic-action');
    assert.deepEqual(await outcome(await item.worker.fetch(rpc('action_receipt', { commandId: 'synthetic-action' }, other), item.env)), foreign);
  } finally { item.cleanup(); }
});

await test('receipt reads enforce enrolled identity and origin without trusting input identity or touching the database', async () => {
  const item = await fixture();
  try {
    await accept(item);
    const before = records(item.database);
    for (const [caller, origin, expected] of [[null, undefined, 401], ['not-enrolled', undefined, 403], [owner, 'https://foreign.test', 403]] as const) {
      item.database.reads.length = 0;
      const response = await item.worker.fetch(rpc('action_receipt', { commandId: 'synthetic-action', actorUserId: owner }, caller, origin), item.env);
      assert.equal(response.status, expected);
      assert.equal(item.database.reads.length, 0);
      assert.deepEqual(records(item.database), before);
    }
    item.database.reads.length = 0;
    assert.equal((await item.worker.fetch(rpc('action_receipt', { commandId: 'synthetic-action', actorUserId: other }), item.env)).status, 400);
    assert.equal(item.database.reads.length, 0);
  } finally { item.cleanup(); }
});

await test('invalid command IDs fail before SQL and the exact nonblank ID is never normalized', async () => {
  const item = await fixture();
  try {
    for (const commandId of [undefined, null, '', '   ', 1, 'a'.repeat(201)]) {
      item.database.reads.length = 0;
      assert.equal((await item.worker.fetch(rpc('action_receipt', { commandId }), item.env)).status, 400);
      assert.equal(item.database.reads.length, 0);
    }
    await accept(item, ' exact key ');
    assert.equal((await outcome(await item.worker.fetch(rpc('action_receipt', { commandId: ' exact key ' }), item.env))).status, 'accepted');
    assert.equal((await outcome(await item.worker.fetch(rpc('action_receipt', { commandId: 'exact key' }), item.env))).status, 'not_found');
  } finally { item.cleanup(); }
});

await test('one read reports a consistent pre-commit absence even when the original action commits before its response returns', async () => {
  const item = await fixture();
  try {
    item.database.afterRead = async () => { await accept(item); };
    const beforeCommit = await outcome(await item.worker.fetch(rpc('action_receipt', { commandId: 'synthetic-action' }), item.env));
    assert.deepEqual(beforeCommit, { ok: true, operation: 'action', commandId: 'synthetic-action', status: 'not_found', observedRevision: 0 });
    assert.equal((await item.repository.read())?.state.revision, 1);
    const afterCommit = await outcome(await item.worker.fetch(rpc('action_receipt', { commandId: 'synthetic-action' }), item.env));
    assert.equal(afterCommit.status, 'accepted');
    assert.equal(afterCommit.acceptedRevision, 1);
    assert.equal(afterCommit.observedRevision, 1);
  } finally { item.cleanup(); }
});

await test('a rolled-back action has no accepted readback and an uninitialized world is unavailable', async () => {
  const item = await fixture();
  try {
    item.database.sql.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON world_receipts WHEN NEW.receipt_key = 'action:synthetic-action' BEGIN SELECT RAISE(ABORT, 'fixture receipt failure'); END;");
    await assert.rejects(accept(item));
    const before = records(item.database);
    assert.deepEqual(await outcome(await item.worker.fetch(rpc('action_receipt', { commandId: 'synthetic-action' }), item.env)), { ok: true, operation: 'action', commandId: 'synthetic-action', status: 'not_found', observedRevision: 0 });
    assert.deepEqual(records(item.database), before);
  } finally { item.cleanup(); }
  const empty = await fixture(false);
  try {
    const response = await empty.worker.fetch(rpc('action_receipt', { commandId: 'synthetic-action' }), empty.env);
    assert.equal(response.status, 503);
    const value: unknown = await response.json();
    assert.equal(object(object(value).error).message, 'world_not_initialized');
  } finally { empty.cleanup(); }
});

for (const [label, column, malformed] of [
  ['invalid stored ownership JSON', 'request_json', '{'],
  ['missing stored ownership', 'request_json', JSON.stringify({ operation: 'action', input: { commandId: 'synthetic-action' } })],
  ['mismatched owned operation', 'request_json', JSON.stringify({ actorUserId: owner, operation: 'clock-catchup', input: { commandId: 'synthetic-action' } })],
  ['mismatched owned key', 'request_json', JSON.stringify({ actorUserId: owner, operation: 'action', input: { commandId: 'different-key' } })],
  ['invalid response JSON', 'response_json', '{'],
  ['refusal posing as success', 'response_json', JSON.stringify({ ok: false, revision: 1, acceptedRevision: 1 })],
  ['future accepted revision', 'response_json', JSON.stringify({ ok: true, revision: 9, acceptedRevision: 9 })],
  ['fractional accepted revision', 'response_json', JSON.stringify({ ok: true, revision: 1, acceptedRevision: 0.5 })],
] as const) {
  await test(`receipt read fails explicitly on ${label} without fabricating absence or writing`, async () => {
    const item = await fixture();
    try {
      await accept(item);
      item.database.sql.prepare(`UPDATE world_receipts SET ${column} = ? WHERE receipt_key = ?`).run(malformed, 'action:synthetic-action');
      const before = records(item.database);
      const response = await item.worker.fetch(rpc('action_receipt', { commandId: 'synthetic-action' }), item.env);
      assert.equal(response.status, 503);
      assert.deepEqual(records(item.database), before);
      const content = await response.text();
      assert.equal(content.includes(owner), false);
      assert.equal(content.includes('request-must-never-escape'), false);
    } finally { item.cleanup(); }
  });
}
