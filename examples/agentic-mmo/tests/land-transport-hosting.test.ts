import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, applyRelease, catchUpStrategy, createWorld } from '../core/engine.ts';
import { RESOURCE_IDS } from '../core/content.ts';
import type { GameAction, TradeAgreement, TradeOffer, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';
import { createWorker } from '../server/worker.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const actor = 'synthetic-land-transport-owner';
const releases = ['settlement-foundations-2', 'settlement-independent-1', 'settlement-production-1', 'settlement-frontiers-1', 'settlement-specialization-1', 'settlement-recovery-1', 'settlement-civics-1', 'settlement-charters-1', 'settlement-endpoints-1', 'settlement-land-transport-1'];

function object(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}

function proposal(seat = 0, partner = 1): GameAction {
  return { type: 'propose-trade', partner, recipeId: 'harvest-for-materials', sourceCityId: `city-${seat}`, recipientCityId: `city-${partner}` };
}

function pair(state: WorldState): { offer: TradeOffer; agreement: TradeAgreement } {
  const offer = state.tradeOffers?.[0];
  const agreement = state.routes[0]?.agreement;
  assert.ok(offer && agreement);
  return { offer, agreement };
}

function quotedFixture(): WorldState {
  let state = createWorld(1701, epoch);
  for (const targetReleaseId of releases.slice(0, -1)) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: epoch });
    assert.equal(result.ok, true, result.error);
    state = result.state;
  }
  const proposed = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: epoch, action: proposal() });
  assert.equal(proposed.ok, true, proposed.error);
  const offer = proposed.state.tradeOffers?.[0];
  assert.ok(offer);
  const accepted = applyCommand(proposed.state, { seat: 1, expectedRevision: proposed.state.revision, timestamp: epoch, action: { type: 'respond-trade', offerId: offer.id, accept: true } });
  assert.equal(accepted.ok, true, accepted.error);
  const upgraded = applyRelease(accepted.state, { expectedRevision: accepted.state.revision, expectedFromReleaseId: accepted.state.releaseId, targetReleaseId: 'settlement-land-transport-1', timestamp: epoch });
  assert.equal(upgraded.ok, true, upgraded.error);
  state = upgraded.state;
  const quote = { mode: 'land' as const, ruleVersion: 1 as const, tileIds: [57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 48], edges: 10 };
  for (const tile of state.tiles) tile.terrain = 'grassland';
  const records = pair(state);
  records.offer.terms.transport = structuredClone(quote);
  records.agreement.terms.transport = structuredClone(quote);
  return state;
}

class Statement implements D1Statement {
  private readonly database: LandDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: LandDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}

class LandDatabase implements D1Database {
  readonly sql: DatabaseSync;
  batches = 0;
  constructor(path: string) { this.sql = new DatabaseSync(path); }
  prepare(sql: string): D1Statement { return new Statement(this, sql); }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
    this.batches++;
    this.sql.exec('BEGIN');
    try {
      const results = statements.map(statement => { assert.ok(statement instanceof Statement); return statement.execute(); });
      this.sql.exec('COMMIT');
      return results;
    } catch (failure) { this.sql.exec('ROLLBACK'); throw failure; }
  }
  records() {
    return {
      state: this.sql.prepare('SELECT * FROM world_state').all(),
      transitions: this.sql.prepare('SELECT * FROM world_transitions ORDER BY end_revision').all(),
      receipts: this.sql.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all(),
    };
  }
}

function fixture(state?: WorldState) {
  const directory = mkdtempSync(join(tmpdir(), 'land-transport-host-'));
  const path = join(directory, 'world.sqlite');
  const database = new LandDatabase(path);
  database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8'));
  if (state) database.sql.prepare('INSERT INTO world_state (world_id, revision, initial_json, state_json, updated_at) VALUES (?, ?, ?, ?, ?)').run('main', state.revision, JSON.stringify(state), JSON.stringify(state), epoch);
  const repository = new WorldRepository(database);
  const env = { DB: database, AGENT_WRITER_USER_IDS: actor };
  return { database, repository, env, path, close: () => { database.sql.close(); rmSync(directory, { recursive: true, force: true }); } };
}

function post(path: string, input: Record<string, unknown>): Request {
  return new Request(`https://world.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': actor }, body: JSON.stringify(input) });
}

async function body(response: Response): Promise<Record<string, unknown>> { const raw: unknown = await response.json(); return object(raw); }

const quoteFaults: Array<[string, (state: WorldState) => void]> = [
  ['null quote', state => { Reflect.set(pair(state).offer.terms, 'transport', null); }],
  ['unknown mode', state => { Reflect.set(pair(state).offer.terms, 'transport', { ...pair(state).offer.terms.transport, mode: 'sea' }); }],
  ['unknown rule version', state => { Reflect.set(pair(state).offer.terms, 'transport', { ...pair(state).offer.terms.transport, ruleVersion: 2 }); }],
  ['extra quote key', state => { Reflect.set(pair(state).offer.terms, 'transport', { ...pair(state).offer.terms.transport, distance: 10 }); }],
  ['missing path', state => { Reflect.set(pair(state).offer.terms, 'transport', { mode: 'land', ruleVersion: 1, edges: 10 }); }],
  ['empty path', state => { Reflect.set(pair(state).offer.terms, 'transport', { mode: 'land', ruleVersion: 1, edges: 0, tileIds: [] }); }],
  ['one-tile path', state => { Reflect.set(pair(state).offer.terms, 'transport', { mode: 'land', ruleVersion: 1, edges: 0, tileIds: [57] }); }],
  ['oversized path', state => { Reflect.set(pair(state).offer.terms, 'transport', { mode: 'land', ruleVersion: 1, edges: state.tiles.length, tileIds: Array.from({ length: state.tiles.length + 1 }, (_, index) => index) }); }],
  ['wrong edge accounting', state => { const quote = pair(state).offer.terms.transport; assert.ok(quote); quote.edges--; }],
  ['fractional tile ID', state => { const quote = pair(state).offer.terms.transport; assert.ok(quote); quote.tileIds[1] = 58.5; }],
  ['repeated tile', state => { const quote = pair(state).offer.terms.transport; assert.ok(quote); quote.tileIds[1] = 57; }],
  ['unknown tile', state => { const quote = pair(state).offer.terms.transport; assert.ok(quote); quote.tileIds[1] = 999; }],
  ['nonadjacent tile', state => { const quote = pair(state).offer.terms.transport; assert.ok(quote); quote.tileIds[1] = 0; }],
  ['wrong origin', state => { const quote = pair(state).offer.terms.transport; assert.ok(quote); quote.tileIds[0] = 56; }],
  ['wrong destination', state => { const quote = pair(state).offer.terms.transport; assert.ok(quote); quote.tileIds[quote.tileIds.length - 1] = 49; }],
  ['reversed endpoints', state => { const quote = pair(state).offer.terms.transport; assert.ok(quote); quote.tileIds.reverse(); }],
  ['quote before feature', state => { state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== 'land-transport'); }],
  ['missing agreement quote', state => { delete pair(state).agreement.terms.transport; }],
  ['different valid agreement path', state => { pair(state).agreement.terms.transport = { mode: 'land', ruleVersion: 1, tileIds: [57, 40, 41, 42, 43, 44, 45, 46, 47, 48], edges: 9 }; }],
];

for (const [name, corrupt] of quoteFaults) {
  await test(`canonical and hosted reads refuse ${name} without changing records`, async () => {
    const state = quotedFixture();
    corrupt(state);
    assert.equal(isWorldState(state), false, name);
    const item = fixture(state);
    try {
      const before = item.database.records();
      const worker = createWorker(undefined, { now: () => new Date(epoch) });
      assert.equal((await worker.fetch(new Request('https://world.test/api/world'), item.env)).status, 503);
      assert.deepEqual(item.database.records(), before);
      assert.equal(item.database.batches, 0);
    } finally { item.close(); }
  });
}

await test('stored path remains readable after terrain becomes impassable without recomputing its quote', async () => {
  const state = quotedFixture();
  const tile = state.tiles.find(candidate => candidate.id === 60);
  assert.ok(tile);
  tile.terrain = 'ocean';
  assert.ok(isWorldState(state));
  const item = fixture(state);
  try {
    const before = item.database.records();
    assert.deepEqual((await item.repository.read())?.state, state);
    assert.deepEqual(item.database.records(), before);
  } finally { item.close(); }
});

await test('quoted acceptance-relative schedules validate while legacy global schedules remain unchanged', () => {
  const quoted = quotedFixture();
  quoted.round = 9;
  const agreement = pair(quoted).agreement;
  agreement.acceptedRound = 1;
  agreement.nextDeliveryRound = 13;
  agreement.lastAttemptRound = 9;
  agreement.lastDeliveryRound = 5;
  agreement.deliveryCount = 1;
  assert.ok(isWorldState(quoted), 'Quoted attempts and deliveries align to acceptance round one plus cadence four');
  for (const field of ['nextDeliveryRound', 'lastAttemptRound', 'lastDeliveryRound'] as const) {
    const invalid = structuredClone(quoted);
    pair(invalid).agreement[field] = field === 'nextDeliveryRound' ? 12 : field === 'lastAttemptRound' ? 8 : 4;
    assert.equal(isWorldState(invalid), false, field);
  }
  const legacy = structuredClone(quoted);
  delete pair(legacy).offer.terms.transport;
  delete pair(legacy).agreement.terms.transport;
  pair(legacy).agreement.nextDeliveryRound = 12;
  pair(legacy).agreement.lastAttemptRound = 8;
  pair(legacy).agreement.lastDeliveryRound = 4;
  assert.ok(isWorldState(legacy));
});

await test('quoted receipt terms remain valid after catalogue-independent cadence and cost snapshots', () => {
  const state = quotedFixture();
  const { offer, agreement } = pair(state);
  for (const terms of [offer.terms, agreement.terms]) { terms.cadenceRounds = 7; terms.constructionCost.materials = 17; }
  agreement.nextDeliveryRound = 7;
  assert.ok(isWorldState(state));
});

async function online(item: ReturnType<typeof fixture>, land = true): Promise<void> {
  await item.repository.initialize({ seed: 1701, clockEpoch: epoch, commandId: 'synthetic-land-initialize' }, actor, epoch);
  for (const targetReleaseId of land ? releases : releases.slice(0, -1)) {
    const current = await item.repository.read();
    assert.ok(current);
    await item.repository.mutate('release-apply', { expectedRevision: current.state.revision, expectedFromReleaseId: current.state.releaseId, targetReleaseId, commandId: `synthetic-${targetReleaseId}`, model: 'synthetic-land-host-fixture' }, actor, epoch);
  }
}

async function actionInput(item: ReturnType<typeof fixture>, seat: number, action: GameAction, commandId: string) {
  const current = await item.repository.read();
  assert.ok(current);
  return { seat, action, commandId, expectedRevision: current.state.revision, model: 'synthetic-land-host-fixture' };
}

await test('hosted geographic consent snapshots a real path and acceptance-relative due beat once through restart and replay', async () => {
  const item = fixture();
  try {
    await online(item);
    const initial = await item.repository.read();
    assert.ok(initial);
    await item.repository.mutate('strategy-catchup', { expectedRevision: initial.state.revision, timestamp: at(60), commandId: 'synthetic-first-beat' }, actor, at(60));
    const proposed = await actionInput(item, 2, proposal(2, 4), 'synthetic-geographic-proposal');
    await item.repository.mutate('action', proposed, actor, at(60));
    const pending = await item.repository.read();
    const offer = pending?.state.tradeOffers?.[0];
    assert.ok(offer?.terms.transport, 'Hosted proposal must persist a versioned actual path');
    const accepted = await actionInput(item, 4, { type: 'respond-trade', offerId: offer.id, accept: true }, 'synthetic-geographic-consent');
    const reply = await item.repository.mutate('action', accepted, actor, at(60));
    const current = await item.repository.read();
    assert.ok(current);
    const { agreement } = pair(current.state);
    assert.deepEqual(agreement.terms, offer.terms);
    assert.equal(agreement.nextDeliveryRound, 1 + offer.terms.cadenceRounds);
    assert.equal(agreement.deliveryCount, 0);
    const beforeDuplicate = item.database.records();
    assert.equal((await item.repository.mutate('action', accepted, actor, at(60))).duplicate, true);
    assert.deepEqual(item.database.records(), beforeDuplicate);
    const restarted = new LandDatabase(item.path);
    try {
      assert.deepEqual(await new WorldRepository(restarted).read(), current);
      assert.equal((await new WorldRepository(restarted).actionReceipt({ commandId: accepted.commandId }, actor)).status, 'accepted');
    } finally { restarted.sql.close(); }
    let replayed = current.initial;
    for (const entry of (await item.repository.history()).entries) {
      const result = entry.transition.kind === 'release-apply' ? applyRelease(replayed, entry.transition.command)
        : entry.transition.kind === 'action' ? applyCommand(replayed, entry.transition.command)
          : entry.transition.kind === 'strategy-catchup' ? catchUpStrategy(replayed, entry.transition.timestamp) : null;
      assert.ok(result?.ok);
      assert.deepEqual(result.state, entry.state);
      replayed = result.state;
    }
    assert.deepEqual(replayed, current.state);
    assert.equal(reply.acceptedRevision, current.state.revision);
  } finally { item.close(); }
});

await test('unrelated quoted proposals survive CAS rebase and racing identical consent charges construction once', async () => {
  const item = fixture();
  try {
    await online(item);
    const worker = createWorker(undefined, { now: () => new Date(epoch) });
    const first = await actionInput(item, 0, proposal(), 'synthetic-cas-near');
    const second = await actionInput(item, 2, proposal(2, 4), 'synthetic-cas-far');
    assert.equal(first.expectedRevision, second.expectedRevision);
    const proposals = await Promise.all([first, second].map(input => worker.fetch(post('/api/action', input), item.env)));
    assert.deepEqual(proposals.map(response => response.status), [200, 200]);
    const pending = await item.repository.read();
    assert.ok(pending);
    assert.equal(pending.state.tradeOffers?.length, 2);
    assert.ok(pending.state.tradeOffers?.every(offer => offer.terms.transport));
    const offer = pending.state.tradeOffers?.find(candidate => candidate.proposer === 0);
    const ownerBefore = pending.state.civilizations.find(civilization => civilization.id === 0);
    assert.ok(offer && ownerBefore);
    const input = await actionInput(item, 1, { type: 'respond-trade', offerId: offer.id, accept: true }, 'synthetic-consent-race');
    const responses = await Promise.all([worker.fetch(post('/api/action', input), item.env), worker.fetch(post('/api/action', input), item.env)]);
    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    const replies = await Promise.all(responses.map(body));
    assert.equal(replies.filter(reply => reply.duplicate === true).length, 1);
    const after = await item.repository.read();
    assert.ok(after);
    assert.equal(after.state.routes.length, 1);
    const ownerAfter = after.state.civilizations.find(civilization => civilization.id === 0);
    assert.ok(ownerAfter);
    for (const resource of RESOURCE_IDS) assert.equal(ownerAfter.resources[resource], ownerBefore.resources[resource] - (offer.terms.constructionCost[resource] ?? 0));
    assert.deepEqual(after.state.routes[0]?.agreement?.terms, offer.terms);
    const records = item.database.records();
    assert.equal((await worker.fetch(post('/api/action', { ...input, action: { type: 'respond-trade', offerId: offer.id, accept: false } }), item.env)).status, 409);
    assert.deepEqual(item.database.records(), records);
  } finally { item.close(); }
});

await test('quoted acceptance receipt failure rolls back path agreement, payment and history before a genuine retry and restart', async () => {
  const item = fixture();
  try {
    await online(item);
    await item.repository.mutate('action', await actionInput(item, 2, proposal(2, 4), 'synthetic-rollback-proposal'), actor, epoch);
    const current = await item.repository.read();
    const offer = current?.state.tradeOffers?.[0];
    assert.ok(offer?.terms.transport);
    const input = await actionInput(item, 4, { type: 'respond-trade', offerId: offer.id, accept: true }, 'synthetic-land-rollback');
    const before = item.database.records();
    item.database.sql.exec("CREATE TRIGGER fail_land_receipt BEFORE INSERT ON world_receipts WHEN NEW.receipt_key = 'action:synthetic-land-rollback' BEGIN SELECT RAISE(ABORT, 'synthetic land receipt failure'); END;");
    const worker = createWorker(undefined, { now: () => new Date(epoch) });
    assert.equal((await worker.fetch(post('/api/action', input), item.env)).status, 500);
    assert.deepEqual(item.database.records(), before);
    item.database.sql.exec('DROP TRIGGER fail_land_receipt');
    assert.equal((await worker.fetch(post('/api/action', input), item.env)).status, 200);
    const after = await item.repository.read();
    assert.ok(after);
    assert.equal(after.state.routes.length, 1);
    assert.deepEqual(after.state.routes[0]?.agreement?.terms, offer.terms);
    const restarted = new LandDatabase(item.path);
    try { assert.deepEqual(await new WorldRepository(restarted).read(), after); } finally { restarted.sql.close(); }
    const committed = item.database.records();
    assert.equal((await body(await worker.fetch(post('/api/action', input), item.env))).duplicate, true);
    assert.deepEqual(item.database.records(), committed);
  } finally { item.close(); }
});

await test('disconnected proposal and newly impassable quoted consent refuse with no authoritative effects', async () => {
  const connected = fixture();
  try {
    await online(connected);
    const current = await connected.repository.read();
    assert.ok(current);
    const disconnected = structuredClone(current.state);
    const towns = new Set(disconnected.cities.map(city => city.tileId));
    for (const tile of disconnected.tiles) tile.terrain = towns.has(tile.id) ? 'grassland' : 'ocean';
    assert.ok(isWorldState(disconnected));
    const isolated = fixture(disconnected);
    try {
      const worker = createWorker(undefined, { now: () => new Date(epoch) });
      const before = isolated.database.records();
      assert.equal((await worker.fetch(post('/api/action', await actionInput(isolated, 0, proposal(), 'synthetic-disconnected')), isolated.env)).status, 400);
      assert.deepEqual(isolated.database.records(), before);
      assert.equal(isolated.database.batches, 0);
    } finally { isolated.close(); }
    await connected.repository.mutate('action', await actionInput(connected, 2, proposal(2, 4), 'synthetic-before-block'), actor, epoch);
    const offered = await connected.repository.read();
    const offer = offered?.state.tradeOffers?.[0];
    assert.ok(offered && offer?.terms.transport);
    const middleId = offer.terms.transport.tileIds[1];
    const middle = offered.state.tiles.find(tile => tile.id === middleId);
    assert.ok(middle);
    middle.terrain = 'mountain';
    assert.ok(isWorldState(offered.state));
    const blocked = fixture(offered.state);
    try {
      const worker = createWorker(undefined, { now: () => new Date(epoch) });
      const before = blocked.database.records();
      const input = await actionInput(blocked, 4, { type: 'respond-trade', offerId: offer.id, accept: true }, 'synthetic-blocked-consent');
      assert.equal((await worker.fetch(post('/api/action', input), blocked.env)).status, 400);
      assert.deepEqual(blocked.database.records(), before);
      assert.equal(blocked.database.batches, 0);
    } finally { blocked.close(); }
  } finally { connected.close(); }
});

await test('future path blockage persists an honest zero-shipment receipt and keeps exact history readable', async () => {
  const state = quotedFixture();
  const tile = state.tiles.find(candidate => candidate.id === 60);
  assert.ok(tile);
  tile.terrain = 'ocean';
  const control = structuredClone(state);
  const stopped = pair(control).agreement;
  stopped.enabled = false;
  stopped.closedRound = 0;
  const controlBeat = catchUpStrategy(control, at(240));
  assert.equal(controlBeat.ok, true, controlBeat.error);
  const item = fixture(state);
  try {
    const input = { expectedRevision: state.revision, timestamp: at(240), commandId: 'synthetic-blocked-beat' };
    await item.repository.mutate('strategy-catchup', input, actor, at(240));
    const after = await item.repository.read();
    assert.ok(after);
    const { agreement } = pair(after.state);
    assert.match(agreement.blockedReason ?? '', /impassable/);
    assert.equal(agreement.deliveryCount, 0);
    assert.equal(agreement.lastAttemptRound, 4);
    assert.equal(agreement.nextDeliveryRound, 8);
    assert.deepEqual(agreement.terms, pair(state).agreement.terms);
    assert.deepEqual(after.state.civilizations.map(civilization => civilization.resources), controlBeat.state.civilizations.map(civilization => civilization.resources));
    assert.ok(isWorldState(after.state));
    const history = await item.repository.history();
    assert.equal(history.entries.length, 1);
    assert.deepEqual(history.entries[0]?.state, after.state);
    assert.ok(history.entries[0]?.events.some(event => event.type === 'trade-blocked'));
    const committed = item.database.records();
    assert.equal((await item.repository.mutate('strategy-catchup', input, actor, at(240))).duplicate, true);
    assert.deepEqual(item.database.records(), committed);
  } finally { item.close(); }
});

await test('malformed archived quote fails history explicitly while current world and private receipts remain intact', async () => {
  const item = fixture();
  try {
    await online(item);
    await item.repository.mutate('action', await actionInput(item, 2, proposal(2, 4), 'synthetic-history-quote'), actor, epoch);
    const row = object(item.database.sql.prepare('SELECT end_revision, state_json FROM world_transitions ORDER BY end_revision DESC LIMIT 1').get());
    assert.equal(typeof row.state_json, 'string');
    assert.equal(typeof row.end_revision, 'number');
    const raw: unknown = JSON.parse(String(row.state_json));
    assert.ok(isWorldState(raw));
    const offer = raw.tradeOffers?.[0];
    assert.ok(offer?.terms.transport);
    offer.terms.transport.edges++;
    item.database.sql.prepare('UPDATE world_transitions SET state_json = ? WHERE end_revision = ?').run(JSON.stringify(raw), Number(row.end_revision));
    const before = item.database.records();
    const batches = item.database.batches;
    const worker = createWorker(undefined, { now: () => new Date(epoch) });
    assert.equal((await worker.fetch(new Request('https://world.test/api/history'), item.env)).status, 503);
    assert.equal((await worker.fetch(new Request('https://world.test/api/world'), item.env)).status, 200);
    assert.equal((await item.repository.actionReceipt({ commandId: 'synthetic-history-quote' }, actor)).status, 'accepted');
    assert.deepEqual(item.database.records(), before);
    assert.equal(item.database.batches, batches);
  } finally { item.close(); }
});

await test('an abstract agreement accepted before the geographic release keeps its global schedule through replay', async () => {
  const item = fixture();
  try {
    await online(item, false);
    const start = await item.repository.read();
    assert.ok(start);
    await item.repository.mutate('strategy-catchup', { expectedRevision: start.state.revision, timestamp: at(60), commandId: 'synthetic-legacy-beat' }, actor, at(60));
    await item.repository.mutate('action', await actionInput(item, 0, proposal(), 'synthetic-legacy-proposal'), actor, at(60));
    const pending = await item.repository.read();
    const offer = pending?.state.tradeOffers?.[0];
    assert.ok(offer);
    assert.equal(Object.hasOwn(offer.terms, 'transport'), false);
    await item.repository.mutate('action', await actionInput(item, 1, { type: 'respond-trade', offerId: offer.id, accept: true }, 'synthetic-legacy-consent'), actor, at(60));
    const accepted = await item.repository.read();
    assert.ok(accepted);
    assert.equal(pair(accepted.state).agreement.nextDeliveryRound, 4);
    await item.repository.mutate('release-apply', { expectedRevision: accepted.state.revision, expectedFromReleaseId: accepted.state.releaseId, targetReleaseId: 'settlement-land-transport-1', commandId: 'synthetic-grandfather-upgrade', model: 'synthetic-land-host-fixture' }, actor, at(60));
    const upgraded = await item.repository.read();
    assert.ok(upgraded);
    assert.deepEqual(upgraded.state.routes, accepted.state.routes);
    assert.deepEqual(upgraded.state.tradeOffers, accepted.state.tradeOffers);
    await item.repository.mutate('strategy-catchup', { expectedRevision: upgraded.state.revision, timestamp: at(240), commandId: 'synthetic-legacy-delivery' }, actor, at(240));
    const after = await item.repository.read();
    assert.ok(after);
    assert.equal(pair(after.state).agreement.lastDeliveryRound, 4);
    assert.equal(pair(after.state).agreement.nextDeliveryRound, 8);
    assert.equal(Object.hasOwn(pair(after.state).agreement.terms, 'transport'), false);
    let replayed = after.initial;
    for (const entry of (await item.repository.history()).entries) {
      const result = entry.transition.kind === 'release-apply' ? applyRelease(replayed, entry.transition.command)
        : entry.transition.kind === 'action' ? applyCommand(replayed, entry.transition.command)
          : entry.transition.kind === 'strategy-catchup' ? catchUpStrategy(replayed, entry.transition.timestamp) : null;
      assert.ok(result?.ok);
      assert.deepEqual(result.state, entry.state);
      replayed = result.state;
    }
    assert.deepEqual(replayed, after.state);
  } finally { item.close(); }
});
