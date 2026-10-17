import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, applyRelease, catchUpStrategy } from '../core/engine.ts';
import { RESOURCE_IDS } from '../core/content.ts';
import type { GameAction, WorldState, StrategicExtractionResult, BuildingOperationResult } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';
import { metalEconomyPrefix } from './fixtures/metal-economy-prefix.ts';
import { metalDeliveryJourney } from './metal-economy.test.ts';
import { learningCommerceJourney } from './learning-commerce.test.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const actor = 'synthetic-metal-owner';
const model = 'synthetic-metal-host-fixture';
const predecessor = metalEconomyPrefix();

class Statement implements D1Statement {
  private readonly database: MetalDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: MetalDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class MetalDatabase implements D1Database {
  readonly sql: DatabaseSync;
  beforeBatch: (() => void) | null = null;
  constructor(path: string) { this.sql = new DatabaseSync(path); }
  prepare(sql: string): D1Statement { return new Statement(this, sql); }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
    const hook = this.beforeBatch; this.beforeBatch = null; hook?.(); this.sql.exec('BEGIN');
    try { const result = statements.map(statement => { assert.ok(statement instanceof Statement); return statement.execute(); }); this.sql.exec('COMMIT'); return result; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
  records() { return { state: this.sql.prepare('SELECT * FROM world_state').all(), history: this.sql.prepare('SELECT * FROM world_transitions ORDER BY end_revision').all(), receipts: this.sql.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all() }; }
}
class Fixture {
  private readonly directory = mkdtempSync(join(tmpdir(), 'metal-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new MetalDatabase(this.path);
  constructor() { this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8')); }
  get store() { return new WorldRepository(this.database); }
  async state() { const result = await this.store.read(); assert.ok(result); return result.state; }
  async prefix() {
    await this.store.initialize({ seed: 1701, clockEpoch: coastalPrefixTime(0), commandId: 'initialize' }, actor, coastalPrefixTime(0));
    for (const [index, { input: step }] of predecessor.steps.entries()) {
      const meta = { commandId: `prefix-${index}`, model };
      if (step.kind === 'release') await this.store.mutate('release-apply', { ...step.command, ...meta }, actor, step.command.timestamp ?? coastalPrefixTime(0));
      else if (step.kind === 'action') await this.store.mutate('action', { ...step.command, ...meta }, actor, step.command.timestamp ?? coastalPrefixTime(0));
      else await this.store.mutate('strategy-catchup', { expectedRevision: (await this.state()).revision, timestamp: step.timestamp, ...meta }, actor, step.timestamp);
    }
    assert.deepEqual(await this.state(), predecessor.state);
  }
  async input(commandId: string, action: GameAction) { return { seat: 0, expectedRevision: (await this.state()).revision, model, commandId, action: { type: 'strategy-action', action } }; }
  send(input: Record<string, unknown>, seconds: number) { return this.store.mutate('action', input, actor, coastalPrefixTime(seconds)); }
  async beat() { const state = await this.state(); const seconds = ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60; return this.store.mutate('strategy-catchup', { expectedRevision: state.revision, commandId: `beat-${state.revision}`, timestamp: coastalPrefixTime(seconds), model }, actor, coastalPrefixTime(seconds)); }
  reopen() { this.database.sql.close(); this.database = new MetalDatabase(this.path); }
  close() { this.database.sql.close(); rmSync(this.directory, { recursive: true, force: true }); }
}
async function replay(item: Fixture) {
  const saved = await item.store.read(); assert.ok(saved); let state = saved.initial; let after = 0; let count = 0;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = await item.store.history(after, 3);
    for (const entry of page.entries) {
      const transition = entry.transition;
      const result = transition.kind === 'action' ? applyCommand(state, transition.command) : transition.kind === 'release-apply' ? applyRelease(state, transition.command) : transition.kind === 'strategy-catchup' ? catchUpStrategy(state, transition.timestamp) : null;
      assert.ok(result?.ok, result?.error); assert.ok(isWorldState(entry.state)); assert.deepEqual(result.state, entry.state); assert.deepEqual(result.events, entry.events); state = result.state; count++;
    }
    if (!page.hasMore) { assert.deepEqual(state, saved.state); return count; }
    assert.ok(page.nextRevision !== null && page.nextRevision > after); after = page.nextRevision;
  }
  return assert.fail('bounded replay did not terminate');
}

await test('the legal71 predecessor keeps canonical six-resource snapshots with no strategic rewrite', () => {
  assert.equal(predecessor.state.revision, 71);
  assert.equal(predecessor.steps.length, 71);
  assert.equal(predecessor.state.releaseId, 'settlement-mining-1');
  for (const { result } of predecessor.steps) assert.ok(isWorldState(JSON.parse(JSON.stringify(result.state))));
  for (const civilization of predecessor.state.civilizations) {
    assert.equal(Object.hasOwn(civilization, 'strategicResources'), false);
    assert.deepEqual(Object.keys(civilization.resources).toSorted(), [...RESOURCE_IDS].toSorted());
  }
  assert.equal(Object.hasOwn(predecessor.state, 'deposits'), false);
});

await test('real SQLite predecessor reopens and replays every retained old frame before metal adoption', async () => {
  const item = new Fixture();
  try {
    await item.prefix(); const state = await item.state(); const rows = item.database.records();
    item.reopen(); assert.deepEqual(await item.state(), state); assert.deepEqual(item.database.records(), rows);
    assert.equal(await replay(item), 71);
  } finally { item.close(); }
});

function syntheticMetalState(): WorldState {
  const state = structuredClone(predecessor.state);
  state.releaseId = 'settlement-metal-learning-1';
  state.unlockedFeatures.push('finite-metals', 'learning-commerce');
  state.strategicDeposits = { ruleVersion: 1, placementId: 'iron-placement-1', seed: state.seed, tileIds: [56], deposits: { '56': { tileId: 56, resource: 'iron', initialReserve: 240, remaining: 240 } } };
  for (const civilization of state.civilizations) civilization.strategicResources = {};
  return state;
}
function deposit(state: WorldState) { const value = state.strategicDeposits?.deposits['56']; assert.ok(value); return value; }
function ledger(state: WorldState) { const value = state.civilizations[0]?.strategicResources; assert.ok(value); return value; }
function extraction(state: WorldState): StrategicExtractionResult {
  const result = state.cities.find(city => city.id === 'city-0')?.improvements?.['56']?.operation.lastResult?.extraction;
  assert.ok(result); return result;
}
function syntheticExtractionState(): WorldState {
  const state = syntheticMetalState(); state.events = [];
  const result = state.cities.find(city => city.id === 'city-0')?.improvements?.['56']?.operation.lastResult;
  assert.ok(result);
  result.extraction = { ruleVersion: 1, tileId: 56, round: result.round, resource: 'iron', quantity: 2, reserveBefore: 240, reserveAfter: 238, stockBefore: 0, stockAfter: 2, capacity: 80, status: 'extracted' };
  deposit(state).remaining = 238; ledger(state).iron = 2;
  return state;
}

await test('metal save rejects strategic data before its release gate without rewriting old saves', () => {
  const old = structuredClone(predecessor.state); const before = JSON.stringify(old);
  assert.ok(isWorldState(old)); assert.equal(JSON.stringify(old), before);
  const stock = structuredClone(old); const civilization = stock.civilizations[0]; assert.ok(civilization); civilization.strategicResources = { iron: 0 };
  assert.equal(isWorldState(stock), false);
  const layer = structuredClone(old); const added = syntheticMetalState().strategicDeposits; assert.ok(added); layer.strategicDeposits = added;
  assert.equal(isWorldState(layer), false);
});

const metalFaults: Array<[string, (state: WorldState) => void]> = [
  ['missing adopted layer', state => { Reflect.deleteProperty(state, 'strategicDeposits'); }],
  ['missing adopted ledger', state => { const civilization = state.civilizations[0]; assert.ok(civilization); Reflect.deleteProperty(civilization, 'strategicResources'); }],
  ['negative stock', state => { ledger(state).iron = -1; }],
  ['fractional stock', state => { ledger(state).iron = 0.5; }],
  ['unknown strategic resource', state => { Reflect.set(ledger(state), 'copper', 1); }],
  ['unsafe stock', state => { ledger(state).iron = Number.MAX_SAFE_INTEGER + 1; }],
  ['wrong placement identity', state => { Reflect.set(state.strategicDeposits ?? {}, 'placementId', 'unknown'); }],
  ['wrong recorded seed', state => { const layer = state.strategicDeposits; assert.ok(layer); layer.seed++; }],
  ['duplicate recorded site', state => { const layer = state.strategicDeposits; assert.ok(layer); layer.tileIds.push(56); }],
  ['missing recorded site', state => { const layer = state.strategicDeposits; assert.ok(layer); layer.tileIds = []; }],
  ['unknown layer version', state => { Reflect.set(state.strategicDeposits ?? {}, 'ruleVersion', 2); }],
  ['extra layer field', state => { Reflect.set(state.strategicDeposits ?? {}, 'extra', true); }],
  ['leading-zero deposit key', state => { const layer = state.strategicDeposits; assert.ok(layer); layer.deposits = { '056': deposit(state) }; }],
  ['deposit key identity mismatch', state => { deposit(state).tileId = 58; }],
  ['unknown deposit site', state => { const layer = state.strategicDeposits; assert.ok(layer); layer.deposits = { '9999': { ...deposit(state), tileId: 9999 } }; }],
  ['unknown deposit resource', state => { Reflect.set(deposit(state), 'resource', 'copper'); }],
  ['zero initial reserve', state => { deposit(state).initialReserve = 0; }],
  ['reserve creation', state => { deposit(state).remaining = 241; }],
  ['negative reserve', state => { deposit(state).remaining = -1; }],
  ['fractional reserve', state => { deposit(state).remaining = 0.5; }],
  ['extra deposit field', state => { Reflect.set(deposit(state), 'extra', true); }],
];
for (const [name, corrupt] of metalFaults) await test(`metal save rejects ${name}`, () => { const state = syntheticMetalState(); corrupt(state); assert.equal(isWorldState(state), false); });

await test('synthetic historical metal snapshots preserve own arithmetic after stock capacity and terrain change', () => {
  const state = syntheticExtractionState(); assert.ok(isWorldState(state));
  ledger(state).iron = 200; deposit(state).remaining = 100;
  const tile = state.tiles.find(site => site.id === 56); assert.ok(tile); tile.terrain = 'ocean'; tile.owner = 1;
  const before = JSON.stringify(state); assert.ok(isWorldState(state)); assert.equal(JSON.stringify(state), before);
  assert.equal(extraction(state).capacity, 80);
});

const extractionFaults: Array<[string, (state: WorldState) => void]> = [
  ['unknown version', state => { Reflect.set(extraction(state), 'ruleVersion', 2); }],
  ['wrong exact tile', state => { extraction(state).tileId = 58; }],
  ['wrong operation round', state => { extraction(state).round--; }],
  ['negative quantity', state => { extraction(state).quantity = -1; }],
  ['fractional quantity', state => { extraction(state).quantity = 0.5; }],
  ['unequal reserve debit', state => { extraction(state).reserveAfter++; }],
  ['unequal stock credit', state => { extraction(state).stockAfter++; }],
  ['extracted beyond historical capacity', state => { extraction(state).capacity = 1; }],
  ['zero extracted quantity', state => { const result = extraction(state); result.quantity = 0; result.reserveAfter = result.reserveBefore; result.stockAfter = result.stockBefore; }],
  ['non-extracted positive quantity', state => { extraction(state).status = 'storage-full'; }],
  ['extra receipt field', state => { Reflect.set(extraction(state), 'extra', true); }],
  ['paused extraction', state => { const result = state.cities.find(city => city.id === 'city-0')?.improvements?.['56']?.operation.lastResult; assert.ok(result); result.status = 'paused'; result.produced = {}; result.residents.allocated = 0; }],
];
for (const [name, corrupt] of extractionFaults) await test(`extraction save rejects ${name}`, () => { const state = syntheticExtractionState(); corrupt(state); assert.equal(isWorldState(state), false); });

await test('metal save rejects a sparse recorded placement list', () => { const state = syntheticMetalState(); const layer = state.strategicDeposits; assert.ok(layer); Reflect.deleteProperty(layer.tileIds, '0'); assert.equal(isWorldState(state), false); });

const metalStory = metalDeliveryJourney();
const learningStory = learningCommerceJourney();

function stepArguments(step: CoastalPrefixStep, commandId: string): Record<string, unknown> {
  const input = step.input;
  if (input.kind === 'strategy') return { expectedRevision: step.before.revision, timestamp: input.timestamp, model, commandId };
  if (input.kind === 'release') return { ...input.command, model, commandId };
  return { seat: input.command.seat, expectedRevision: input.command.expectedRevision, action: { type: 'strategy-action', action: input.command.action }, ...(input.command.plan === undefined ? {} : { plan: input.command.plan }), model, commandId };
}
function sendStep(item: Fixture, step: CoastalPrefixStep, commandId: string) {
  const input = step.input;
  const timestamp = input.kind === 'strategy' ? input.timestamp : input.command.timestamp;
  assert.ok(timestamp);
  return item.store.mutate(input.kind === 'strategy' ? 'strategy-catchup' : input.kind === 'release' ? 'release-apply' : 'action', stepArguments(step, commandId), actor, timestamp);
}
async function persistThrough(item: Fixture, steps: CoastalPrefixStep[], revision: number): Promise<void> {
  await item.prefix();
  for (const [index, step] of steps.entries()) {
    if (step.result.state.revision > revision) break;
    await sendStep(item, step, `metal-step-${index}`);
    assert.deepEqual(await item.state(), step.result.state);
  }
  assert.equal((await item.state()).revision, revision);
}

await test('real SQLite legal Bronze Currency extraction consent and due shipment keep exact duplicates and full reopened replay', async context => {
  const item = new Fixture();
  try {
    await item.prefix();
    const steps = metalStory.journey.steps;
    const consentIndex = steps.findIndex(step => step.input.kind === 'action' && step.input.command.action.type === 'respond-trade');
    assert.ok(consentIndex >= 0);
    for (const [index, step] of steps.entries()) {
      const id = `metal-step-${index}`;
      if (index === consentIndex) {
        const results = await Promise.all([sendStep(item, step, id), sendStep(item, step, id)]);
        assert.equal(results.filter(result => result.duplicate === true).length, 1);
        const accepted = await item.state(); const connection = accepted.routes.find(route => route.id === metalStory.routeId); assert.ok(connection?.agreement);
        assert.equal(connection.agreement.deliveryCount, 0);
        assert.deepEqual(accepted.civilizations.map(civ => civ.strategicResources), step.before.civilizations.map(civ => civ.strategicResources));
      } else await sendStep(item, step, id);
      assert.deepEqual(await item.state(), step.result.state);
      assert.ok(isWorldState(await item.state()));
    }
    const state = await item.state(); const rows = item.database.records(); item.reopen();
    assert.deepEqual(await item.state(), state);
    const consent = steps[consentIndex]; assert.ok(consent);
    const duplicate = await sendStep(item, consent, `metal-step-${consentIndex}`);
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, consent.result.state.revision);
    const args = stepArguments(consent, `metal-step-${consentIndex}`);
    await assert.rejects(item.store.mutate('action', { ...args, action: { type: 'strategy-action', action: { type: 'respond-trade', offerId: 'other-offer', accept: true } } }, actor, metalStory.journey.time()), { message: 'idempotency_key_reused' });
    const release = steps[0]; assert.ok(release); assert.equal((await sendStep(item, release, 'metal-step-0')).duplicate, true);
    assert.deepEqual(item.database.records(), rows);
    const connection = state.routes.find(route => route.id === metalStory.routeId); assert.ok(connection?.agreement);
    assert.equal(connection.agreement.deliveryCount, 1);
    assert.equal(state.civilizations[1]?.strategicResources?.iron, 2);
    assert.deepEqual(connection.agreement.terms.strategicCargo, { proposer: { iron: 2 }, recipient: {} });
    context.diagnostic(JSON.stringify({ basis: 'Entirely legal71 predecessor and actual repository release/research/consent/due beats', revision: state.revision, round: state.round, replayFrames: await replay(item), extraction: state.cities[0]?.improvements?.['58']?.operation.lastResult?.extraction, shipment: state.events.find(event => event.strategicShipment?.routeId === connection.id)?.strategicShipment, research: metalStory.journey.researchWork }));
  } finally { item.close(); }
});

await test('real SQLite connected learning and commerce retain exact district dependencies paid histories and later operation', async context => {
  const item = new Fixture();
  try {
    await persistThrough(item, learningStory.journey.steps, learningStory.journey.state.revision);
    const state = await item.state(); const city = state.cities.find(value => value.id === 'city-0'); assert.ok(city);
    assert.equal(state.civilizations[0]?.era, 2);
    assert.ok(city.districtSites?.['commercial-hub'] !== undefined);
    for (const id of ['university', 'market', 'bank']) {
      const result: BuildingOperationResult | null | undefined = city.buildingOperations?.[id]?.lastResult; assert.ok(result);
      assert.equal(result.status, 'operated'); assert.equal(result.residents?.allocated, 3);
    }
    const records = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), state); assert.deepEqual(item.database.records(), records);
    context.diagnostic(JSON.stringify({ basis: 'Actual repository commands through real research, milestones and local prerequisites', revision: state.revision, round: state.round, replayFrames: await replay(item), districtSites: city.districtSites, university: city.buildingOperations?.university?.lastResult, market: city.buildingOperations?.market?.lastResult, bank: city.buildingOperations?.bank?.lastResult }));
  } finally { item.close(); }
});

function dueDeliverySeconds(state: WorldState): number {
  const connection = state.routes.find(route => route.id === metalStory.routeId); assert.ok(connection?.agreement && state.independentTurns);
  return (state.independentTurns.strategyTicks + connection.agreement.nextDeliveryRound - state.round) * 60 + 1;
}
for (const table of ['world_transitions', 'world_receipts']) await test(`${table} failure rolls back every due extraction shipment and exact action before one reopened retry`, async () => {
  const item = new Fixture();
  try {
    await persistThrough(item, metalStory.journey.steps, metalStory.accepted.revision);
    const before = item.database.records(); const seconds = dueDeliverySeconds(await item.state());
    const input = await item.input('metal-delivery-atomic', { type: 'research', technology: 'mathematics' });
    item.database.sql.exec(`CREATE TRIGGER fail_metal BEFORE INSERT ON ${table} WHEN NEW.receipt_key = 'action:metal-delivery-atomic' BEGIN SELECT RAISE(ABORT, 'synthetic metal rollback'); END;`);
    await assert.rejects(item.send(input, seconds), /synthetic metal rollback/); assert.deepEqual(item.database.records(), before);
    item.reopen(); assert.deepEqual(item.database.records(), before); item.database.sql.exec('DROP TRIGGER fail_metal');
    const receipt = await item.send(input, seconds); const after = await item.state();
    assert.equal(after.civilizations[0]?.researchTarget, 'mathematics'); assert.equal(after.civilizations[1]?.strategicResources?.iron, 2);
    assert.equal(after.routes.find(route => route.id === metalStory.routeId)?.agreement?.deliveryCount, 1);
    const records = item.database.records(); item.reopen(); const duplicate = await item.send(input, seconds + 600);
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, receipt.acceptedRevision); assert.deepEqual(item.database.records(), records);
    await replay(item);
  } finally { item.close(); }
});

await test('illegal exact action and strict CAS preserve all candidate metal upkeep and shipment effects', async () => {
  const item = new Fixture();
  try {
    await persistThrough(item, metalStory.journey.steps, metalStory.accepted.revision);
    const before = item.database.records(); const state = await item.state(); const seconds = dueDeliverySeconds(state);
    const invalid = await item.input('metal-invalid', { type: 'build', project: 'university', cityId: 'city-1' });
    await assert.rejects(item.send(invalid, seconds)); assert.deepEqual(item.database.records(), before);
    const input = await item.input('metal-cas', { type: 'research', technology: 'mathematics' });
    const competing = applyCommand(state, { seat: 2, expectedRevision: state.revision, timestamp: coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 50), action: { type: 'research', technology: 'agriculture' } });
    assert.ok(competing.ok, competing.error);
    item.database.beforeBatch = () => { item.database.sql.prepare('UPDATE world_state SET revision=?, state_json=? WHERE world_id=?').run(competing.state.revision, JSON.stringify(competing.state), 'main'); };
    await assert.rejects(item.send(input, seconds), { message: 'stale_revision' });
    assert.deepEqual(await item.state(), competing.state); assert.deepEqual(item.database.records().history, before.history); assert.deepEqual(item.database.records().receipts, before.receipts);
    item.reopen(); assert.deepEqual(await item.state(), competing.state);
  } finally { item.close(); }
});

await test('immutable mixed cargo and structured extraction shipment records reject mismatched retained identities', () => {
  const accepted = metalStory.accepted; assert.ok(isWorldState(accepted));
  const cases: Array<(state: WorldState) => void> = [
    state => { const terms = state.routes.find(route => route.id === metalStory.routeId)?.agreement?.terms; assert.ok(terms?.strategicCargo); terms.strategicCargo.proposer.iron = 3; },
    state => { const terms = state.tradeOffers?.find(offer => offer.terms.recipeId === 'iron-for-food')?.terms; assert.ok(terms?.strategicCargo); Reflect.set(terms.strategicCargo.recipient, 'copper', 1); },
    state => { const terms = state.routes.find(route => route.id === metalStory.routeId)?.agreement?.terms; assert.ok(terms?.strategicCargo); terms.strategicCargo.proposer.iron = 0.5; },
  ];
  for (const corrupt of cases) { const state = structuredClone(accepted); corrupt(state); assert.equal(isWorldState(state), false); }
  const delivered = structuredClone(metalStory.journey.state); const event = delivered.events.find(value => value.strategicShipment); assert.ok(event?.strategicShipment);
  event.strategicShipment.proposerSent.iron = 3; assert.equal(isWorldState(delivered), false);
  const extracted = structuredClone(metalStory.extracted); const receipt = extracted.events.find(value => value.strategicExtraction); assert.ok(receipt?.strategicExtraction);
  receipt.strategicExtraction.quantity = 1; receipt.strategicExtraction.reserveAfter++; receipt.strategicExtraction.stockAfter--;
  assert.equal(isWorldState(extracted), false);
});

await test('new local institutions require their exact completed district while historical paid and work snapshots remain valid', () => {
  const state = structuredClone(learningStory.journey.state); state.events = [];
  const city = state.cities.find(value => value.id === 'city-0'); assert.ok(city?.construction?.lastCompleted);
  city.construction.lastCompleted.paid = { energy: 0.25 }; city.construction.lastCompleted.workRequired = 999;
  assert.ok(isWorldState(state));
  for (const district of ['campus', 'commercial-hub']) {
    const bad = structuredClone(state); const target = bad.cities.find(value => value.id === 'city-0'); assert.ok(target);
    target.buildings = target.buildings.filter(id => id !== district); if (target.districtSites) Reflect.deleteProperty(target.districtSites, district);
    assert.equal(isWorldState(bad), false);
  }
});

await test('corrupt retained strategic records fail current and history reads without writes', async () => {
  const item = new Fixture();
  try {
    await persistThrough(item, metalStory.journey.steps, metalStory.journey.state.revision);
    const good = await item.state(); const corrupt = structuredClone(good); const civ = corrupt.civilizations[0]; assert.ok(civ?.strategicResources); civ.strategicResources.iron = -1;
    item.database.sql.prepare('UPDATE world_state SET state_json=? WHERE world_id=?').run(JSON.stringify(corrupt), 'main'); const before = item.database.records();
    await assert.rejects(item.store.read(), { message: 'corrupt_or_incompatible_world' }); assert.deepEqual(item.database.records(), before);
    item.database.sql.prepare('UPDATE world_state SET state_json=? WHERE world_id=?').run(JSON.stringify(good), 'main');
    item.database.sql.prepare('UPDATE world_transitions SET state_json=? WHERE end_revision=?').run(JSON.stringify(corrupt), good.revision); const history = item.database.records();
    await assert.rejects(item.store.history(good.revision - 1, 1), { message: 'corrupt_or_incompatible_world' }); assert.deepEqual(item.database.records(), history);
  } finally { item.close(); }
});

await test('retained exact extraction event cannot outlive a mismatched current operation copy', () => {
  const missing = structuredClone(metalStory.extracted);
  const result = missing.cities[0]?.improvements?.['58']?.operation.lastResult; assert.ok(result?.extraction);
  Reflect.deleteProperty(result, 'extraction'); assert.equal(isWorldState(missing), false);
  const foreign = structuredClone(metalStory.extracted); const event = foreign.events.find(candidate => candidate.strategicExtraction?.tileId === 58 && candidate.round === result.round); assert.ok(event);
  event.actor = 1; event.target = 1; assert.equal(isWorldState(foreign), false);
});

await test('iron-placement-1 refuses a ninth recorded deposit independently of current catalogue tuning', () => {
  const state = syntheticMetalState(); const layer = state.strategicDeposits; assert.ok(layer);
  layer.tileIds = state.tiles.slice(0, 9).map(tile => tile.id);
  layer.deposits = Object.fromEntries(layer.tileIds.map(tileId => [String(tileId), { tileId, resource: 'iron', initialReserve: 240, remaining: 240 }]));
  assert.equal(isWorldState(state), false);
});

await test('synthetic full receiving storage persists a complete zero-payment block through SQLite reopen', async () => {
  const item = new Fixture();
  try {
    await persistThrough(item, metalStory.journey.steps, metalStory.accepted.revision);
    const state = await item.state(); const recipient = state.civilizations[1]; assert.ok(recipient?.strategicResources && state.independentTurns);
    recipient.strategicResources.iron = 40; assert.ok(isWorldState(state));
    item.database.sql.prepare('UPDATE world_state SET state_json=? WHERE world_id=?').run(JSON.stringify(state), 'main');
    const stopped = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: coastalPrefixTime(state.independentTurns.strategyTicks * 60 + 40), action: { type: 'stop-trade', routeId: metalStory.routeId } }); assert.ok(stopped.ok, stopped.error);
    const timestamp = coastalPrefixTime(dueDeliverySeconds(state)); const control = catchUpStrategy(stopped.state, timestamp); assert.ok(control.ok, control.error);
    const request = { expectedRevision: state.revision, timestamp, model, commandId: 'full-storage-block' };
    const receipt = await item.store.mutate('strategy-catchup', request, actor, timestamp); const blocked = await item.state();
    assert.deepEqual(blocked.civilizations, control.state.civilizations);
    const route = blocked.routes.find(connection => connection.id === metalStory.routeId); assert.ok(route?.agreement);
    assert.equal(route.agreement.deliveryCount, 0); assert.equal(route.active, false); assert.match(route.agreement.blockedReason ?? '', /storage/);
    assert.equal(blocked.events.some(event => event.strategicShipment?.routeId === metalStory.routeId), false);
    assert.ok(isWorldState(blocked)); const records = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), blocked);
    const duplicate = await item.store.mutate('strategy-catchup', request, actor, timestamp); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, receipt.acceptedRevision); assert.deepEqual(item.database.records(), records);
    const history = await item.store.history(state.revision, 1); assert.deepEqual(history.entries[0]?.state, blocked);
  } finally { item.close(); }
});
