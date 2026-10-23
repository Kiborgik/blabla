import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { TRADE_RECIPES } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { observeCompactTrade } from '../core/observation.ts';
import type { WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import type { D1Database, D1Result, D1Statement, SqlValue } from '../server/repository.ts';
import { createWorker } from '../server/worker.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const format = 'compact-trade-pages-v1';

function object(value: unknown): Record<string, unknown> { assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value)); return Object.fromEntries(Object.entries(value)); }
function world(): WorldState {
  const state = createWorld(1701, epoch, 'settlement-operating-exchange-1');
  const capitals = structuredClone(state.cities);
  const occupied = new Set(state.cities.map(city => city.tileId));
  const sites = state.tiles.filter(tile => !occupied.has(tile.id) && tile.owner === null && tile.terrain !== 'mountain' && tile.terrain !== 'ocean');
  for (let index = 5; index < 25; index++) {
    const template = capitals[index % 5];
    const site = sites[index - 5];
    assert.ok(template && site);
    site.owner = template.civId;
    state.cities.push({ ...structuredClone(template), id: `exchange-fixture-${index}`, name: `Exchange fixture ${index}`, tileId: site.id, population: 3 });
  }
  assert.ok(isWorldState(state));
  return state;
}

class Database implements D1Database {
  readonly sql = new DatabaseSync(':memory:');
  reads = 0;
  writes = 0;
  constructor(state: WorldState) {
    this.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8'));
    this.sql.prepare('INSERT INTO world_state (world_id, revision, initial_json, state_json, updated_at) VALUES (?, ?, ?, ?, ?)').run('main', state.revision, JSON.stringify(state), JSON.stringify(state), epoch);
  }
  prepare(sql: string): D1Statement {
    let values: SqlValue[] = [];
    const statement: D1Statement = {
      bind: (...input) => { values = input; return statement; },
      all: async () => { assert.match(sql, /^SELECT /); this.reads++; return { results: this.sql.prepare(sql).all(...values), meta: { changes: 0 } }; },
      run: async () => { this.writes++; throw new Error('Read attempted a write'); },
    };
    return statement;
  }
  async batch(): Promise<D1Result[]> { this.writes++; throw new Error('Read attempted a batch'); }
  snapshot() { return { state: this.sql.prepare('SELECT * FROM world_state').all(), transitions: this.sql.prepare('SELECT * FROM world_transitions').all(), receipts: this.sql.prepare('SELECT * FROM world_receipts').all(), changes: this.sql.prepare('SELECT total_changes() AS n').get() }; }
}

function fixture() {
  const state = world();
  const database = new Database(state);
  let timestamp = epoch;
  const worker = createWorker(undefined, { now: () => new Date(timestamp) });
  const env = { DB: database, AGENT_WRITER_USER_IDS: 'synthetic-page-owner' };
  return { state, database, env, worker, time: (value: string) => { timestamp = value; }, close: () => database.sql.close() };
}

function http(args: Record<string, string>): Request { return new Request(`https://world.test/api/observe?${new URLSearchParams(args)}`); }
function rpc(args: Record<string, unknown>, headers: Record<string, string> = {}): Request { return new Request('https://world.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'observe_world', arguments: args } }) }); }
async function readResponse(response: Response, mcp = false) {
  assert.equal(response.status, 200);
  const wire = await response.text();
  const body = object(JSON.parse(wire));
  const view = mcp ? object(object(body.result).structuredContent) : body;
  if (mcp) {
    const content = object(body.result).content;
    assert.ok(Array.isArray(content) && content.length === 1);
    const text = object(content[0]).text;
    assert.equal(typeof text, 'string');
    assert.deepEqual(JSON.parse(String(text)), view);
  }
  return { view, bytes: Buffer.byteLength(wire), body };
}

await test('public HTTP and MCP return the same complete twenty-choice page and preserve full indexed actions', async () => {
  const item = fixture();
  try {
    const before = item.database.snapshot();
    const expected = observeCompactTrade(item.state, 0, epoch);
    const plain = await readResponse(await item.worker.fetch(http({ seat: '0', observationFormat: format }), item.env));
    const mcp = await readResponse(await item.worker.fetch(rpc({ seat: 0, observationFormat: format }), item.env), true);
    assert.deepEqual(mcp.view, plain.view);
    const options = plain.view.legalActions;
    assert.ok(Array.isArray(options));
    assert.equal(options.length, 20);
    assert.deepEqual(options.map((entry, index) => { const option = object(entry); assert.equal(option.choice, index); assert.match(String(option.actionId), /^[0-9a-f]{64}$/); return option.action; }), expected.legalActions.slice(0, 20).map(option => option.action));
    assert.equal(plain.view.choices, undefined);
    assert.deepEqual(object(plain.view.context).tradeFacts, expected.tradeFacts);
    assert.equal(item.database.reads, 2);
    assert.equal(item.database.writes, 0);
    assert.deepEqual(item.database.snapshot(), before);
  } finally { item.close(); }
});

for (const mcp of [false, true]) await test(`${mcp ? 'MCP' : 'HTTP'} continuations reconstruct the original menu after server time passes the next strategy boundary`, async (context) => {
  const item = fixture();
  try {
    const before = item.database.snapshot();
    const expected = observeCompactTrade(item.state, 0, epoch);
    const full = await readResponse(await item.worker.fetch(mcp ? rpc({ seat: 0, observationFormat: 'compact-trade-v1' }) : http({ seat: '0', observationFormat: 'compact-trade-v1' }), item.env), mcp);
    let cursor: string | undefined;
    let pages = 0;
    let firstBytes = 0;
    let totalBytes = 0;
    const actions: unknown[] = [];
    do {
      const pageRequest = mcp ? rpc({ observationFormat: format, ...(cursor === undefined ? { seat: 0 } : { choiceCursor: cursor }) }) : http({ observationFormat: format, ...(cursor === undefined ? { seat: '0' } : { choiceCursor: cursor }) });
      const result = await readResponse(await item.worker.fetch(pageRequest, item.env), mcp);
      if (pages === 0) firstBytes = result.bytes;
      totalBytes += result.bytes;
      const page = object(result.view.page);
      assert.equal(page.offset, actions.length);
      assert.equal(page.observedAt, epoch);
      assert.equal(page.total, expected.legalActions.length);
      assert.equal(result.view.context === undefined, pages !== 0);
      const options = result.view.legalActions;
      assert.ok(Array.isArray(options) && options.length > 0 && options.length <= 20);
      for (const entry of options) { const option = object(entry); assert.equal(option.choice, actions.length); actions.push(option.action); }
      assert.ok(page.nextCursor === null || typeof page.nextCursor === 'string');
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
      pages++;
      assert.ok(pages <= 12);
      item.time('2026-10-16T00:01:00.000Z');
    } while (cursor !== undefined);
    assert.equal(pages, 12);
    assert.deepEqual(actions, expected.legalActions.map(option => option.action));
    assert.ok(firstBytes < full.bytes * 0.25);
    assert.ok(totalBytes > full.bytes);
    assert.equal(item.database.reads, pages + 1);
    assert.deepEqual(item.database.snapshot(), before);
    context.diagnostic(JSON.stringify({ fixture: 'synthetic 25-city two-recipe world; actual Worker response bodies', transport: mcp ? 'MCP' : 'HTTP', choices: actions.length, pages, compactBytes: full.bytes, firstBytes, totalBytes, reads: item.database.reads, writes: item.database.writes }));
  } finally { item.close(); }
});

await test('malformed cursors and conflicting selectors refuse before SQL through both transports', async () => {
  const item = fixture();
  try {
    for (const request of [http({ observationFormat: format, choiceCursor: '!' }), rpc({ observationFormat: format, choiceCursor: null }), rpc({ observationFormat: format, choiceCursor: 'x'.repeat(2049) }), http({ choiceCursor: '!' }), rpc({ observationFormat: 'compact-trade-v1', choiceCursor: '!' }), rpc({ observationFormat: format, timestamp: epoch }), rpc({ observationFormat: format, choiceLimit: 100 }), http({ observationFormat: format, choiceLimit: '100' })]) {
      const response = await item.worker.fetch(request, item.env);
      assert.equal(response.status, 400);
      assert.match(await response.text(), /invalid_choice_cursor/);
    }
    const duplicate = new Request(`https://world.test/api/observe?observationFormat=${format}&choiceCursor=a&choiceCursor=b`);
    assert.equal((await item.worker.fetch(duplicate, item.env)).status, 400);
    assert.equal(item.database.reads, 0);
    assert.equal(item.database.writes, 0);
  } finally { item.close(); }
});

await test('an actual changed stored revision refuses the old cursor with no choices or replacement', async () => {
  const item = fixture();
  try {
    const first = await readResponse(await item.worker.fetch(http({ seat: '0', observationFormat: format }), item.env));
    const cursor = object(first.view.page).nextCursor;
    assert.equal(typeof cursor, 'string');
    const changed = structuredClone(item.state);
    changed.revision++;
    item.database.sql.prepare('UPDATE world_state SET revision = ?, state_json = ? WHERE world_id = ?').run(changed.revision, JSON.stringify(changed), 'main');
    const before = item.database.snapshot();
    const response = await item.worker.fetch(http({ observationFormat: format, choiceCursor: String(cursor) }), item.env);
    assert.equal(response.status, 409);
    const body = object(await response.json());
    assert.equal(body.error, 'stale_choice_cursor');
    assert.equal(body.reason, 'revision_changed');
    assert.equal(body.revision, changed.revision);
    assert.equal(body.legalActions, undefined);
    assert.equal(body.nextCursor, undefined);
    assert.deepEqual(item.database.snapshot(), before);
  } finally { item.close(); }
});

await test('paging does not change the default compact response or existing MCP origin guard', async () => {
  const item = fixture();
  try {
    const compact = await readResponse(await item.worker.fetch(http({ seat: '0', observationFormat: 'compact-trade-v1' }), item.env));
    const expected = observeCompactTrade(item.state, 0, epoch);
    const actions = compact.view.legalActions;
    assert.ok(Array.isArray(actions));
    assert.deepEqual(actions.map(entry => object(entry)), expected.legalActions.map((option, choice) => ({ choice, ...option })));
    assert.equal(compact.view.page, undefined);
    assert.equal(compact.view.context, undefined);
    const reads = item.database.reads;
    const blocked = await item.worker.fetch(rpc({ seat: 0, observationFormat: format }, { origin: 'https://foreign.test' }), item.env);
    assert.equal(blocked.status, 403);
    assert.equal(item.database.reads, reads);
    assert.equal(item.database.writes, 0);
  } finally { item.close(); }
});

await test('discovery adds only the opt-in page selector and bounded read-only cursor argument', async () => {
  const item = fixture();
  try {
    const response = await item.worker.fetch(new Request('https://world.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), item.env);
    assert.equal(response.status, 200);
    const result = object(object(await response.json()).result);
    assert.ok(Array.isArray(result.tools));
    const tool = object(result.tools.find(entry => object(entry).name === 'observe_world'));
    const properties = object(object(tool.inputSchema).properties);
    assert.deepEqual(object(properties.observationFormat).enum, ['compact-trade-v1', format]);
    assert.deepEqual(properties.choiceCursor, { type: 'string', minLength: 1, maxLength: 2048 });
    assert.equal(object(tool.annotations).readOnlyHint, true);
    assert.equal(item.database.reads, 0);
  } finally { item.close(); }
});

await test('a future cursor and conflicting seat fail before a second read', async () => {
  const item = fixture();
  try {
    const first = await readResponse(await item.worker.fetch(http({ seat: '0', observationFormat: format }), item.env));
    const cursor = object(first.view.page).nextCursor;
    assert.equal(typeof cursor, 'string');
    const reads = item.database.reads;
    const conflict = await item.worker.fetch(rpc({ seat: 1, observationFormat: format, choiceCursor: cursor }), item.env);
    assert.equal(conflict.status, 400);
    item.time('2026-10-15T23:59:59.000Z');
    const future = await item.worker.fetch(http({ observationFormat: format, choiceCursor: String(cursor) }), item.env);
    assert.equal(future.status, 400);
    assert.equal(item.database.reads, reads);
    assert.equal(item.database.writes, 0);
  } finally { item.close(); }
});

await test('MCP projection staleness preserves its error envelope and cannot silently refresh catalogue facts', async () => {
  const item = fixture();
  const recipe = TRADE_RECIPES.find(candidate => candidate.id === 'energy-for-materials');
  assert.ok(recipe);
  const original = recipe.description;
  try {
    const first = await readResponse(await item.worker.fetch(rpc({ seat: 0, observationFormat: format }), item.env), true);
    const cursor = object(first.view.page).nextCursor;
    assert.equal(typeof cursor, 'string');
    const before = item.database.snapshot();
    recipe.description = 'Changed current catalogue facts';
    const response = await item.worker.fetch(rpc({ observationFormat: format, choiceCursor: cursor }), item.env);
    assert.equal(response.status, 409);
    const body = object(await response.json());
    assert.equal(body.jsonrpc, '2.0');
    const error = object(body.error);
    assert.equal(error.message, 'stale_choice_cursor');
    assert.equal(object(error.data).reason, 'projection_changed');
    assert.equal(object(error.data).revision, item.state.revision);
    assert.equal(body.result, undefined);
    assert.deepEqual(item.database.snapshot(), before);
  } finally { recipe.description = original; item.close(); }
});

await test('equal-revision worlds remain isolated and corrupt persisted worlds retain their explicit refusal', async () => {
  const item = fixture();
  try {
    const first = await readResponse(await item.worker.fetch(http({ seat: '0', observationFormat: format }), item.env));
    const cursor = object(first.view.page).nextCursor;
    assert.equal(typeof cursor, 'string');
    item.database.sql.prepare('INSERT INTO world_state SELECT ?, revision, initial_json, state_json, updated_at FROM world_state WHERE world_id = ?').run('other', 'main');
    const before = item.database.snapshot();
    const response = await item.worker.fetch(http({ observationFormat: format, choiceCursor: String(cursor) }), { ...item.env, WORLD_ID: 'other' });
    assert.equal(response.status, 409);
    const body = object(await response.json());
    assert.equal(body.reason, 'run_changed');
    assert.equal(body.legalActions, undefined);
    assert.deepEqual(item.database.snapshot(), before);
    item.database.sql.prepare('UPDATE world_state SET state_json = ? WHERE world_id = ?').run('{invalid', 'main');
    const corruptBefore = item.database.snapshot();
    const corrupt = await item.worker.fetch(http({ observationFormat: format, choiceCursor: String(cursor) }), item.env);
    assert.equal(corrupt.status, 503);
    assert.match(await corrupt.text(), /corrupt_persisted_json/);
    assert.deepEqual(item.database.snapshot(), corruptBefore);
    assert.equal(item.database.writes, 0);
  } finally { item.close(); }
});
