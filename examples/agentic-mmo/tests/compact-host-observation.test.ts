import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, applyRelease, createWorld, observe } from '../core/engine.ts';
import { observeCompactTrade } from '../core/observation.ts';
import type { WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import type { D1Database, D1Result, D1Statement, SqlValue } from '../server/repository.ts';
import { createWorker } from '../server/worker.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const timestamp = '2026-10-16T00:00:10.000Z';
const format = 'compact-trade-v1';

function object(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}

function syntheticWorld(count = 5): WorldState {
  let state = createWorld(17, epoch);
  for (const targetReleaseId of ['settlement-foundations-2', 'settlement-independent-1', 'settlement-production-1', 'settlement-frontiers-1', 'settlement-specialization-1', 'settlement-recovery-1', 'settlement-civics-1', 'settlement-charters-1', 'settlement-endpoints-1']) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: epoch });
    assert.equal(result.ok, true, result.error);
    state = result.state;
  }
  const capitals = structuredClone(state.cities);
  const occupied = new Set(state.cities.map(city => city.tileId));
  const sites = state.tiles.filter(tile => !occupied.has(tile.id) && tile.owner === null && tile.terrain !== 'ocean' && tile.terrain !== 'mountain');
  for (let index = 5; index < count; index++) {
    const capital = capitals[index % 5];
    const site = sites[index - 5];
    assert.ok(capital && site);
    site.owner = capital.civId;
    state.cities.push({ ...structuredClone(capital), id: `transport-city-${index}`, name: `Transport town ${index}`, tileId: site.id });
  }
  for (const city of state.cities) { city.population = 3; city.buildings = ['workshop']; }
  assert.ok(isWorldState(state));
  return state;
}

class ReadDatabase implements D1Database {
  readonly sql = new DatabaseSync(':memory:');
  readonly reads: string[] = [];
  writes = 0;
  constructor(state: WorldState) {
    this.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8'));
    this.sql.prepare('INSERT INTO world_state (world_id, revision, initial_json, state_json, updated_at) VALUES (?, ?, ?, ?, ?)').run('main', state.revision, JSON.stringify(createWorld(17, epoch)), JSON.stringify(state), timestamp);
  }
  prepare(sql: string): D1Statement {
    let values: SqlValue[] = [];
    const statement: D1Statement = {
      bind: (...bound: SqlValue[]) => { values = bound; return statement; },
      all: async () => { this.reads.push(sql); return { results: this.sql.prepare(sql).all(...values), meta: { changes: 0 } }; },
      run: async () => { this.writes++; throw new Error('Observation attempted a write'); },
    };
    return statement;
  }
  async batch(): Promise<D1Result[]> { this.writes++; throw new Error('Observation attempted a batch'); }
  snapshot() {
    return {
      state: this.sql.prepare('SELECT * FROM world_state').all(),
      transitions: this.sql.prepare('SELECT * FROM world_transitions').all(),
      receipts: this.sql.prepare('SELECT * FROM world_receipts').all(),
      changes: this.sql.prepare('SELECT total_changes() AS count').get(),
      writes: this.writes,
    };
  }
}

function fixture(state = syntheticWorld(), time = timestamp) {
  const database = new ReadDatabase(state);
  const worker = createWorker(undefined, { now: () => new Date(time) });
  return { database, worker, env: { DB: database, AGENT_WRITER_USER_IDS: 'synthetic-enrolled-operator' }, close: () => database.sql.close() };
}

function rpc(args: Record<string, unknown>, headers: Record<string, string> = {}, name = 'observe_world'): Request {
  return new Request('https://world.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
}

async function read(response: Response, mcp: boolean) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const wire = await response.text();
  const raw: unknown = JSON.parse(wire);
  let view = object(raw);
  if (mcp) {
    const result = object(view.result);
    assert.equal(result.isError, false);
    view = object(result.structuredContent);
    assert.ok(Array.isArray(result.content));
    assert.equal(object(result.content[0]).text, JSON.stringify(view));
  }
  return { view, wireBytes: Buffer.byteLength(wire), viewBytes: Buffer.byteLength(JSON.stringify(view)) };
}

function expected(state: WorldState, seat: number, compact: boolean, time = timestamp) {
  const view = compact ? observeCompactTrade(state, seat, time) : observe(state, seat, time);
  const metadata = { serverTimestamp: time, releaseId: state.releaseId, unlockedFeatures: state.unlockedFeatures, calendarMilestones: state.calendarMilestones, clockEpoch: state.clockEpoch, clockTicks: state.clockTicks };
  const indexed = view.legalActions.map((option, choice) => ({ choice, ...option }));
  return compact ? { ...view, ...metadata, legalActions: indexed } : { ...view, ...metadata, choices: indexed };
}

await test('observation discovery advertises the optional compact formats and retains its read-only hint', async () => {
  const item = fixture();
  try {
    const response = await item.worker.fetch(new Request('https://world.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), item.env);
    const raw: unknown = await response.json();
    const tools = object(object(raw).result).tools;
    assert.ok(Array.isArray(tools));
    const tool = tools.map(object).find(candidate => candidate.name === 'observe_world');
    assert.ok(tool);
    const schema = object(tool.inputSchema);
    assert.equal(object(tool.annotations).readOnlyHint, true);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(object(object(schema.properties).observationFormat).enum, [format, 'compact-trade-pages-v1']);
    assert.equal(Array.isArray(schema.required) && schema.required.includes('observationFormat'), false);
    assert.equal(item.database.reads.length, 0);
  } finally { item.close(); }
});

await test('omitting the selector preserves the complete default wrapper for all six seats and both public transports', async () => {
  const state = syntheticWorld();
  const item = fixture(state);
  const before = item.database.snapshot();
  try {
    for (let seat = 0; seat < 6; seat++) {
      for (const mcp of [false, true]) {
        const request = mcp ? rpc({ seat }) : new Request(`https://world.test/api/observe?seat=${seat}`);
        const result = await read(await item.worker.fetch(request, item.env), mcp);
        assert.deepEqual(result.view, expected(state, seat, false));
        assert.equal(JSON.stringify(result.view), JSON.stringify(expected(state, seat, false)));
        assert.equal('observationFormat' in result.view, false);
        assert.equal('tradeFacts' in result.view, false);
      }
    }
    assert.deepEqual(item.database.snapshot(), before);
  } finally { item.close(); }
});

for (const mcp of [false, true]) {
  await test(`${mcp ? 'MCP' : 'HTTP'} compact output retains every indexed action and metadata with no duplicate choices alias`, async () => {
    const state = syntheticWorld(25);
    const item = fixture(state);
    try {
      for (let seat = 0; seat < 6; seat++) {
        const args = { seat, observationFormat: format };
        const request = mcp ? rpc(args) : new Request(`https://world.test/api/observe?seat=${seat}&observationFormat=${format}`);
        const result = await read(await item.worker.fetch(request, item.env), mcp);
        assert.equal(result.view.observationFormat, format);
        assert.deepEqual(result.view, expected(state, seat, true));
        assert.equal('choices' in result.view, false);
        assert.ok(Array.isArray(result.view.legalActions));
        assert.deepEqual(result.view.legalActions.map(option => object(option).action), observe(state, seat, timestamp).legalActions.map(option => option.action));
        assert.deepEqual(result.view.legalActions.map(option => object(option).choice), result.view.legalActions.map((_, choice) => choice));
      }
      assert.equal(item.database.reads.length, 6);
      assert.equal(item.database.writes, 0);
    } finally { item.close(); }
  });
}

await test('invalid MCP selectors are refused before any database access without falling back to the default', async () => {
  const item = fixture();
  const before = item.database.snapshot();
  try {
    for (const observationFormat of [null, '', 'compact-trade-v2', 'compact-trade-v1 ', 1, true, [], {}]) {
      const response = await item.worker.fetch(rpc({ seat: 0, observationFormat }), item.env);
      assert.equal(response.status, 400, JSON.stringify(observationFormat));
      const raw: unknown = await response.json();
      assert.equal(object(object(raw).error).message, 'invalid_observation_format');
      assert.equal(item.database.reads.length, 0);
    }
    assert.deepEqual(item.database.snapshot(), before);
  } finally { item.close(); }
});

await test('invalid and duplicate HTTP format selectors are refused before any database access', async () => {
  const item = fixture();
  try {
    for (const query of ['', 'compact-trade-v2', 'compact-trade-v1%20', 'null', `${format}&observationFormat=${format}`]) {
      const response = await item.worker.fetch(new Request(`https://world.test/api/observe?observationFormat=${query}`), item.env);
      assert.equal(response.status, 400, query);
      const raw: unknown = await response.json();
      assert.equal(object(raw).error, 'invalid_observation_format');
      assert.equal(item.database.reads.length, 0);
      assert.equal(item.database.writes, 0);
    }
  } finally { item.close(); }
});

await test('compact public reads retain current anonymous and unenrolled access while MCP origin and mutation guards remain intact', async () => {
  const item = fixture();
  try {
    for (const headers of [{}, { 'oai-authenticated-user-id': 'synthetic-unenrolled' }]) {
      const result = await read(await item.worker.fetch(rpc({ seat: 0, observationFormat: format }, headers), item.env), true);
      assert.equal(result.view.observationFormat, format);
    }
    const get = await read(await item.worker.fetch(new Request(`https://world.test/api/observe?observationFormat=${format}`, { headers: { origin: 'https://spectator.test' } }), item.env), false);
    assert.equal(get.view.observationFormat, format);
    item.database.reads.length = 0;
    assert.equal((await item.worker.fetch(rpc({ observationFormat: format }, { origin: 'https://foreign.test' }), item.env)).status, 403);
    assert.equal((await item.worker.fetch(rpc({}, {}, 'play_action'), item.env)).status, 401);
    assert.equal((await item.worker.fetch(rpc({}, { 'oai-authenticated-user-id': 'synthetic-unenrolled' }, 'play_action'), item.env)).status, 403);
    assert.equal(item.database.reads.length, 0);
    assert.equal(item.database.writes, 0);
  } finally { item.close(); }
});

await test('compact results are detached repeated reads and overdue observations cannot realize time or write receipts', async () => {
  const state = syntheticWorld(10);
  const time = '2030-01-01T00:00:00.000Z';
  const item = fixture(state, time);
  const before = item.database.snapshot();
  try {
    const first = await read(await item.worker.fetch(rpc({ seat: 0, observationFormat: format }), item.env), true);
    assert.equal(first.view.observationFormat, format);
    assert.deepEqual(first.view, expected(state, 0, true, time));
    Object.assign(first.view, { revision: 999, tradeFacts: { cities: [], recipes: [] }, legalActions: [] });
    const second = await read(await item.worker.fetch(rpc({ seat: 0, observationFormat: format }), item.env), true);
    assert.deepEqual(second.view, expected(state, 0, true, time));
    assert.deepEqual(item.database.snapshot(), before);
    assert.equal(item.database.reads.length, 2);
  } finally { item.close(); }
});

await test('compact transport preserves pending consent snapshots and bounded plan lifecycle without submitting their successor', async () => {
  const state = syntheticWorld(10);
  const offerAction = observe(state, 0, epoch).legalActions.find(option => option.action.type === 'propose-trade')?.action;
  assert.ok(offerAction && offerAction.type === 'propose-trade');
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: epoch, action: offerAction, plan: [{ action: offerAction, reason: 'Offer the chosen towns' }, { action: { type: 'wait' }, reason: 'Reassess after the recipient answers' }] });
  assert.equal(result.ok, true, result.error);
  assert.ok(isWorldState(result.state));
  const item = fixture(result.state);
  const before = item.database.snapshot();
  try {
    for (const seat of [0, offerAction.partner]) {
      const output = await read(await item.worker.fetch(rpc({ seat, observationFormat: format }), item.env), true);
      assert.equal(output.view.observationFormat, format);
      assert.deepEqual(output.view, expected(result.state, seat, true));
      assert.deepEqual(output.view.tradeOffers, observe(result.state, seat, timestamp).tradeOffers);
      assert.deepEqual(output.view.actionPlan, observe(result.state, seat, timestamp).actionPlan);
    }
    assert.deepEqual(item.database.snapshot(), before);
  } finally { item.close(); }
});

await test('actual HTTP and MCP UTF-8 wrapper bytes are measured for finite five and twenty-five town fixtures', async (context) => {
  const measurements = [];
  for (const count of [5, 25]) {
    const state = syntheticWorld(count);
    const item = fixture(state);
    try {
      const fullHttp = await read(await item.worker.fetch(new Request('https://world.test/api/observe?seat=0'), item.env), false);
      const compactHttp = await read(await item.worker.fetch(new Request(`https://world.test/api/observe?seat=0&observationFormat=${format}`), item.env), false);
      const fullMcp = await read(await item.worker.fetch(rpc({ seat: 0 }), item.env), true);
      const compactMcp = await read(await item.worker.fetch(rpc({ seat: 0, observationFormat: format }), item.env), true);
      const proposals = observe(state, 0, timestamp).legalActions.filter(option => option.action.type === 'propose-trade').length;
      measurements.push({ cities: count, proposals, choices: observe(state, 0, timestamp).legalActions.length, stateSha256: createHash('sha256').update(JSON.stringify(state)).digest('hex'), fullHttpBytes: fullHttp.wireBytes, compactHttpBytes: compactHttp.wireBytes, fullMcpBytes: fullMcp.wireBytes, compactMcpBytes: compactMcp.wireBytes, compactViewBytes: compactMcp.viewBytes });
      assert.deepEqual(compactHttp.view, compactMcp.view);
    } finally { item.close(); }
  }
  context.diagnostic(JSON.stringify({ provenance: 'finite canonical synthetic town fixture; actual local Worker Response bodies; no live play, token, CPU or provider quota claim', node: process.version, measurements }));
  const large = measurements.find(value => value.cities === 25);
  assert.ok(large);
  assert.equal(large.proposals, 100);
  assert.ok(large.compactHttpBytes < large.fullHttpBytes * 0.7);
  assert.ok(large.compactMcpBytes < large.fullMcpBytes * 0.7);
});
