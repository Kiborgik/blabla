import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { RESOURCE_IDS, TRADE_RECIPES } from '../core/content.ts';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import type { GameAction, Resources, TradeOffer, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';
import { createWorker } from '../server/worker.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const actor = 'synthetic-operating-exchange-owner';
const model = 'synthetic-operating-host-fixture';
const recipeId = 'energy-for-materials';

class Statement implements D1Statement {
  private readonly database: ExchangeDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: ExchangeDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}

class ExchangeDatabase implements D1Database {
  readonly sql: DatabaseSync;
  constructor(path: string) { this.sql = new DatabaseSync(path); }
  prepare(sql: string): D1Statement { return new Statement(this, sql); }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
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

class Fixture {
  private readonly directory = mkdtempSync(join(tmpdir(), 'operating-exchange-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new ExchangeDatabase(this.path);
  constructor(state?: WorldState) {
    this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8'));
    if (state) {
      assert.ok(isWorldState(state));
      this.database.sql.prepare('INSERT INTO world_state (world_id, revision, initial_json, state_json, updated_at) VALUES (?, ?, ?, ?, ?)').run('main', state.revision, JSON.stringify(state), JSON.stringify(state), epoch);
    }
  }
  get store(): WorldRepository { return new WorldRepository(this.database); }
  reopen(): void { this.database.sql.close(); this.database = new ExchangeDatabase(this.path); }
  close(): void { this.database.sql.close(); rmSync(this.directory, { recursive: true, force: true }); }
  async read() { const value = await this.store.read(); assert.ok(value); return value; }
  async input(seat: number, action: GameAction, commandId: string) {
    return { seat, action, commandId, model, expectedRevision: (await this.read()).state.revision };
  }
  async post(path: string, input: Record<string, unknown>, seconds = 0): Promise<Response> {
    const worker = createWorker(undefined, { now: () => new Date(at(seconds)) });
    const request = new Request(`https://world.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': actor }, body: JSON.stringify(input) });
    return worker.fetch(request, { DB: this.database, AGENT_WRITER_USER_IDS: actor });
  }
  async beat(round: number, commandId = `synthetic-beat-${round}`) {
    const input = { expectedRevision: (await this.read()).state.revision, timestamp: at(round * 60), commandId };
    assert.equal((await this.post('/api/strategy-catchup', input, round * 60)).status, 200);
    return input;
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}

function proposal(seat = 1, partner = 4, recipe = recipeId): GameAction {
  return { type: 'propose-trade', partner, recipeId: recipe, sourceCityId: `city-${seat}`, recipientCityId: `city-${partner}` };
}

function offer(state: WorldState, proposer = 1): TradeOffer {
  const value = state.tradeOffers?.find(candidate => candidate.proposer === proposer);
  assert.ok(value);
  return value;
}

function route(state: WorldState) {
  const value = state.routes.find(candidate => candidate.agreement?.terms.recipeId === recipeId);
  assert.ok(value?.agreement);
  return { ...value, agreement: value.agreement };
}

function resources(state: WorldState, seat: number): Resources {
  const civilization = state.civilizations.find(candidate => candidate.id === seat);
  assert.ok(civilization);
  return civilization.resources;
}

async function online(item: Fixture, energy = true): Promise<void> {
  await item.store.initialize({ seed: 1701, clockEpoch: epoch, registeredRulesId: energy ? 'settlement-operating-exchange-1' : 'settlement-land-transport-1', commandId: 'synthetic-initialize' }, actor, epoch);
}

async function proposed(item: Fixture): Promise<TradeOffer> {
  const input = await item.input(1, proposal(), 'synthetic-energy-proposal');
  assert.equal((await item.post('/api/action', input)).status, 200);
  return structuredClone(offer((await item.read()).state));
}

async function agreed(item: Fixture) {
  const terms = await proposed(item);
  const input = await item.input(4, { type: 'respond-trade', offerId: terms.id, accept: true }, 'synthetic-energy-consent');
  const response = await item.post('/api/action', input);
  assert.equal(response.status, 200);
  return { input, reply: await json(response), offer: terms };
}

async function stoppedControl(state: WorldState): Promise<Fixture> {
  const control = new Fixture(state);
  const input = await control.input(1, { type: 'stop-trade', routeId: route(state).id }, 'synthetic-stopped-control');
  assert.equal((await control.post('/api/action', input, state.round * 60 + 10)).status, 200);
  return control;
}

function assertShipmentNet(delivered: WorldState, stopped: WorldState): void {
  for (let seat = 0; seat < 5; seat++) for (const resource of RESOURCE_IDS) {
    const net: Partial<Resources> = seat === 1 ? { energy: -5, materials: 3, credits: 2 } : seat === 4 ? { energy: 3, materials: -3, credits: 2 } : {};
    assert.ok(Math.abs(resources(delivered, seat)[resource] - resources(stopped, seat)[resource] - (net[resource] ?? 0)) < 0.000001, `${seat}:${resource}`);
  }
}

async function assertReplay(item: Fixture): Promise<void> {
  const current = await item.read();
  let replayed = current.initial;
  let after = 0;
  for (;;) {
    const page = await item.store.history(after, 3);
    for (const entry of page.entries) {
      const result = entry.transition.kind === 'action' ? applyCommand(replayed, entry.transition.command)
          : entry.transition.kind === 'strategy-catchup' ? catchUpStrategy(replayed, entry.transition.timestamp) : null;
      assert.ok(result?.ok);
      assert.deepEqual(result.state, entry.state);
      assert.deepEqual(result.events, entry.events);
      replayed = result.state;
    }
    if (!page.hasMore) break;
    assert.ok(page.nextRevision !== null && page.nextRevision > after);
    after = page.nextRevision;
  }
  assert.deepEqual(replayed, current.state);
}

await test('real hosted energy consent waits until due, settles exact gross vectors and survives reopen, replay and old retries', async context => {
  const item = new Fixture();
  let control: Fixture | undefined;
  try {
    await online(item);
    const before = (await item.read()).state;
    const option = legalActions(before, 1, epoch).find(candidate => JSON.stringify(candidate.action) === JSON.stringify(proposal()));
    assert.ok(option?.tradeQuote);
    const terms = await proposed(item);
    const pending = (await item.read()).state;
    assert.deepEqual(pending.civilizations, before.civilizations);
    assert.deepEqual(terms.terms.proposerCargo, { energy: 4 });
    assert.deepEqual(terms.terms.recipientCargo, { materials: 3 });
    assert.deepEqual(terms.terms.proposerUpkeep, { energy: 1 });
    assert.deepEqual(terms.terms.recipientUpkeep, { energy: 1 });
    assert.deepEqual(terms.terms.transport, option.tradeQuote.transport);
    const consent = await item.input(4, { type: 'respond-trade', offerId: terms.id, accept: true }, 'synthetic-durable-consent');
    const accepted = await json(await item.post('/api/action', consent));
    const state = (await item.read()).state;
    assert.deepEqual(resources(state, 4), resources(before, 4));
    for (const resource of RESOURCE_IDS) assert.equal(resources(state, 1)[resource], resources(before, 1)[resource] - (terms.terms.constructionCost[resource] ?? 0));
    assert.deepEqual(route(state).agreement.terms, terms.terms);
    assert.equal(route(state).agreement.deliveryCount, 0);
    const due = route(state).agreement.nextDeliveryRound;
    assert.equal(due, state.round + option.tradeQuote.cadenceRounds);
    for (let round = 1; round < due; round++) {
      await item.beat(round);
      assert.equal(route((await item.read()).state).agreement.deliveryCount, 0);
    }
    control = await stoppedControl((await item.read()).state);
    const delivery = await item.beat(due);
    await control.beat(due);
    const after = await item.read();
    assertShipmentNet(after.state, (await control.read()).state);
    assert.equal(route(after.state).agreement.deliveryCount, 1);
    assert.equal(route(after.state).agreement.lastDeliveryRound, due);
    assert.deepEqual(route(after.state).agreement.terms, terms.terms);
    const records = item.database.records();
    item.reopen();
    assert.deepEqual(await item.read(), after);
    assert.deepEqual(await item.store.actionReceipt({ commandId: consent.commandId }, actor), { ok: true, operation: 'action', commandId: consent.commandId, status: 'accepted', observedRevision: after.state.revision, acceptedRevision: accepted.acceptedRevision });
    assert.equal((await json(await item.post('/api/action', consent, due * 60))).duplicate, true);
    assert.equal((await json(await item.post('/api/strategy-catchup', delivery, due * 60))).duplicate, true);
    assert.deepEqual(item.database.records(), records);
    await assertReplay(item);
    context.diagnostic(JSON.stringify({ fixture: 'fresh registered-rule repository initialization, exact proposal/consent, due beats; no stock or map edits', due, edges: terms.terms.transport?.edges, finalRevision: after.state.revision, transitions: records.transitions.length, receipts: records.receipts.length }));
  } finally { control?.close(); item.close(); }
});

await test('concurrent independent proposals and identical energy consent keep exact intent and charge construction once', async () => {
  const item = new Fixture();
  try {
    await online(item);
    const first = await item.input(1, proposal(), 'synthetic-cas-energy');
    const second = await item.input(2, proposal(2, 3), 'synthetic-cas-peer');
    assert.equal(first.expectedRevision, second.expectedRevision);
    const proposedReplies = await Promise.all([first, second].map(input => item.post('/api/action', input)));
    assert.deepEqual(proposedReplies.map(value => value.status), [200, 200]);
    const pending = (await item.read()).state;
    assert.equal(pending.revision, first.expectedRevision + 2);
    assert.equal(pending.tradeOffers?.length, 2);
    const frozen = structuredClone(offer(pending).terms);
    const consent = await item.input(4, { type: 'respond-trade', offerId: offer(pending).id, accept: true }, 'synthetic-racing-consent');
    const responses = await Promise.all([item.post('/api/action', consent), item.post('/api/action', consent)]);
    assert.deepEqual(responses.map(value => value.status), [200, 200]);
    const replies = await Promise.all(responses.map(json));
    assert.equal(replies.filter(value => value.duplicate === true).length, 1);
    const after = (await item.read()).state;
    assert.equal(after.revision, pending.revision + 1);
    assert.equal(after.routes.length, 1);
    assert.deepEqual(route(after).agreement.terms, frozen);
    for (const resource of RESOURCE_IDS) assert.equal(resources(after, 1)[resource], resources(pending, 1)[resource] - (frozen.constructionCost[resource] ?? 0));
    const records = item.database.records();
    assert.equal((await item.post('/api/action', { ...consent, action: { type: 'respond-trade', offerId: offer(pending).id, accept: false } })).status, 409);
    assert.deepEqual(item.database.records(), records);
    await assertReplay(item);
  } finally { item.close(); }
});

for (const phase of ['consent', 'delivery'] as const) {
  await test(`${phase} receipt failure rolls back every payment and frame before exact retry and reopen`, async () => {
    const item = new Fixture();
    try {
      await online(item);
      let input: Record<string, unknown>;
      let path = '/api/action';
      let seconds = 0;
      if (phase === 'consent') {
        const pending = await proposed(item);
        input = await item.input(4, { type: 'respond-trade', offerId: pending.id, accept: true }, 'synthetic-fault-consent');
      } else {
        await agreed(item);
        const due = route((await item.read()).state).agreement.nextDeliveryRound;
        await item.beat(due - 1);
        seconds = due * 60;
        path = '/api/strategy-catchup';
        input = { expectedRevision: (await item.read()).state.revision, timestamp: at(seconds), commandId: 'synthetic-fault-delivery' };
      }
      const key = phase === 'consent' ? 'action:synthetic-fault-consent' : 'strategy-catchup:synthetic-fault-delivery';
      const before = item.database.records();
      item.database.sql.exec(`CREATE TRIGGER fail_exchange_receipt BEFORE INSERT ON world_receipts WHEN NEW.receipt_key = '${key}' BEGIN SELECT RAISE(ABORT, 'synthetic exchange receipt failure'); END;`);
      assert.equal((await item.post(path, input, seconds)).status, 500);
      assert.deepEqual(item.database.records(), before);
      item.reopen();
      assert.deepEqual(item.database.records(), before);
      item.database.sql.exec('DROP TRIGGER fail_exchange_receipt');
      const response = await item.post(path, input, seconds);
      assert.equal(response.status, 200);
      const accepted = await json(response);
      const after = await item.read();
      assert.equal(route(after.state).agreement.deliveryCount, phase === 'delivery' ? 1 : 0);
      const committed = item.database.records();
      item.reopen();
      const repeated = await json(await item.post(path, input, seconds));
      assert.equal(repeated.duplicate, true);
      assert.equal(repeated.acceptedRevision, accepted.acceptedRevision);
      assert.deepEqual(item.database.records(), committed);
      await assertReplay(item);
    } finally { item.close(); }
  });
}

await test('stored energy vectors remain readable and payable after current catalogue tuning changes', async () => {
  const item = new Fixture();
  let control: Fixture | undefined;
  const recipe = TRADE_RECIPES.find(candidate => candidate.id === recipeId);
  assert.ok(recipe);
  const original = structuredClone(recipe.terms);
  try {
    await online(item);
    const pending = await proposed(item);
    recipe.terms.proposerCargo.energy = 40;
    recipe.terms.recipientCargo.materials = 30;
    recipe.terms.proposerUpkeep.energy = 10;
    recipe.terms.recipientUpkeep.energy = 10;
    recipe.terms.constructionCost.materials = 60;
    recipe.terms.cadenceRounds = 99;
    const consent = await item.input(4, { type: 'respond-trade', offerId: pending.id, accept: true }, 'synthetic-original-terms');
    assert.equal((await item.post('/api/action', consent)).status, 200);
    const accepted = (await item.read()).state;
    assert.deepEqual(route(accepted).agreement.terms, pending.terms);
    control = await stoppedControl(accepted);
    const due = route(accepted).agreement.nextDeliveryRound;
    assert.equal(due, pending.terms.cadenceRounds);
    await item.beat(due);
    await control.beat(due);
    const after = await item.read();
    assertShipmentNet(after.state, (await control.read()).state);
    assert.deepEqual(route(after.state).agreement.terms, pending.terms);
    item.reopen();
    assert.deepEqual(await item.read(), after);
    assert.ok((await item.store.history()).entries.every(entry => isWorldState(entry.state)));
  } finally { recipe.terms = original; control?.close(); item.close(); }
});

for (const scarce of ['exporter', 'importer'] as const) {
  await test(`persisted ${scarce} gross-energy shortage blocks both sides without spending incoming cargo`, async () => {
    const legal = new Fixture();
    let item: Fixture | undefined;
    let control: Fixture | undefined;
    try {
      await online(legal);
      await agreed(legal);
      const due = route((await legal.read()).state).agreement.nextDeliveryRound;
      await legal.beat(due - 1);
      const synthetic = structuredClone((await legal.read()).state);
      resources(synthetic, 1).energy = scarce === 'exporter' ? 4 : 20;
      resources(synthetic, 4).energy = scarce === 'importer' ? 0 : 20;
      resources(synthetic, 4).materials = 20;
      for (const city of synthetic.cities) city.damage = 100;
      item = new Fixture(synthetic);
      control = await stoppedControl(synthetic);
      const input = await item.beat(due);
      await control.beat(due);
      const blocked = await item.read();
      const agreement = route(blocked.state).agreement;
      assert.equal(agreement.deliveryCount, 0);
      assert.equal(agreement.blockedBy, scarce === 'exporter' ? 1 : 4);
      assert.match(agreement.blockedReason ?? '', /Combined cargo and upkeep shortage.*energy/);
      assert.deepEqual(blocked.state.civilizations.map(value => value.resources), (await control.read()).state.civilizations.map(value => value.resources));
      assert.deepEqual(agreement.terms, route(synthetic).agreement.terms);
      const history = await item.store.history();
      assert.equal(history.entries.length, 1);
      assert.ok(history.entries[0]?.events.some(event => event.type === 'trade-blocked'));
      const records = item.database.records();
      item.reopen();
      assert.deepEqual(await item.read(), blocked);
      assert.equal((await json(await item.post('/api/strategy-catchup', input, due * 60))).duplicate, true);
      assert.deepEqual(item.database.records(), records);
    } finally { control?.close(); item?.close(); legal.close(); }
  });
}

await test('fresh selected-rule gate and refused migration keep the exact food agreement byte-identical', async () => {
  const item = new Fixture();
  try {
    await online(item, false);
    const before = item.database.records();
    assert.equal((await item.post('/api/action', await item.input(1, proposal(), 'synthetic-unreleased-energy'))).status, 400);
    assert.deepEqual(item.database.records(), before);
    const food = await item.input(1, proposal(1, 4, 'harvest-for-materials'), 'synthetic-food-proposal');
    assert.equal((await item.post('/api/action', food)).status, 200);
    const pending = offer((await item.read()).state);
    assert.equal((await item.post('/api/action', await item.input(4, { type: 'respond-trade', offerId: pending.id, accept: true }, 'synthetic-food-consent'))).status, 200);
    const old = await item.read();
    const beforeRefusal = item.database.records();
    await assert.rejects(item.store.mutate('release-apply', { expectedRevision: old.state.revision, expectedFromReleaseId: old.state.releaseId, targetReleaseId: 'settlement-operating-exchange-1', commandId: 'synthetic-refused-energy-migration', model }, actor, epoch), /pre_release_migration_disabled/);
    assert.deepEqual(item.database.records(), beforeRefusal);
    const after = await item.read();
    assert.deepEqual(after.state.routes, old.state.routes);
    assert.deepEqual(after.state.tradeOffers, old.state.tradeOffers);
    item.reopen();
    assert.deepEqual(await item.read(), after);
    await assertReplay(item);
  } finally { item.close(); }
});
