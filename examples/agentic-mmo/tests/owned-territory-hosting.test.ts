import assert from 'node:assert/strict';
import { seedHostedWorld } from './fixtures/current-world.ts';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, catchUpStrategy, observe } from '../core/engine.ts';
import { ECONOMY_RULES, SETTLEMENT_SITE_OUTPUTS } from '../core/content.ts';
import { observeCompactTrade } from '../core/observation.ts';
import { createWorker } from '../server/worker.ts';
import type { GameAction, Resources, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';
import { ownedTerritoryPrefix } from './fixtures/owned-territory-prefix.ts';
import { acquisitionReceipts, ownedTerritoryJourney, ownedTerritoryPastureJourney, ownedTerritoryForestJourney } from './fixtures/owned-territory-journey.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const actor = 'synthetic-territory-owner';
const model = 'synthetic-territory-host-fixture';

class Statement implements D1Statement {
  private readonly database: TerritoryDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: TerritoryDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class TerritoryDatabase implements D1Database {
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
  private readonly directory = mkdtempSync(join(tmpdir(), 'territory-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new TerritoryDatabase(this.path);
  constructor() { this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8')); }
  get store() { return new WorldRepository(this.database); }
  async state() { const result = await this.store.read(); assert.ok(result); return result.state; }
  async initialize(state: WorldState) { seedHostedWorld(this.database.sql, state); }
  async input(commandId: string, action: GameAction) { return { seat: 0, expectedRevision: (await this.state()).revision, model, commandId, action: { type: 'strategy-action', action } }; }
  send(input: Record<string, unknown>, seconds: number) { return this.store.mutate('action', input, actor, coastalPrefixTime(seconds)); }
  async beat() { const state = await this.state(); const seconds = ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60; return this.store.mutate('strategy-catchup', { expectedRevision: state.revision, commandId: `beat-${state.revision}`, timestamp: coastalPrefixTime(seconds), model }, actor, coastalPrefixTime(seconds)); }
  reopen() { this.database.sql.close(); this.database = new TerritoryDatabase(this.path); }
  close() { this.database.sql.close(); rmSync(this.directory, { recursive: true, force: true }); }
}
async function replay(item: Fixture) {
  const saved = await item.store.read(); assert.ok(saved); let state = saved.initial; let after = 0; let count = 0;
  for (let pageNumber = 0; pageNumber < 200; pageNumber++) {
    const page = await item.store.history(after, 3);
    for (const entry of page.entries) {
      const transition = entry.transition;
      const result = transition.kind === 'action' ? applyCommand(state, transition.command) : transition.kind === 'strategy-catchup' ? catchUpStrategy(state, transition.timestamp) : null;
      assert.ok(result?.ok, result?.error); assert.ok(isWorldState(entry.state)); assert.deepEqual(result.state, entry.state); assert.deepEqual(result.events, entry.events); state = result.state; count++;
    }
    if (!page.hasMore) { assert.deepEqual(state, saved.state); return count; }
    assert.ok(page.nextRevision !== null && page.nextRevision > after); after = page.nextRevision;
  }
  return assert.fail('bounded replay did not terminate');
}

function stepArguments(step: CoastalPrefixStep, commandId: string): Record<string, unknown> {
  const input = step.input;
  if (input.kind === 'strategy') return { expectedRevision: step.before.revision, timestamp: input.timestamp, model, commandId };
  return { seat: input.command.seat, expectedRevision: input.command.expectedRevision, action: { type: 'strategy-action', action: input.command.action }, ...(input.command.plan === undefined ? {} : { plan: input.command.plan }), model, commandId };
}
function sendStep(item: Fixture, step: CoastalPrefixStep, commandId: string) {
  const input = step.input; const timestamp = input.kind === 'strategy' ? input.timestamp : input.command.timestamp; assert.ok(timestamp);
  return item.store.mutate(input.kind === 'strategy' ? 'strategy-catchup' : 'action', stepArguments(step, commandId), actor, timestamp);
}
async function persist(item: Fixture, steps: CoastalPrefixStep[], through = Number.MAX_SAFE_INTEGER, initial = steps[0]?.before): Promise<void> {
  assert.ok(initial); await item.initialize(initial);
  for (const [index, step] of steps.entries()) {
    if (step.result.state.revision > through) break;
    await sendStep(item, step, `territory-step-${index}`); assert.deepEqual(await item.state(), step.result.state); assert.ok(isWorldState(await item.state()));
  }
}

let cachedPrefix: ReturnType<typeof ownedTerritoryPrefix> | undefined;
function prefix() { cachedPrefix ??= ownedTerritoryPrefix(); return cachedPrefix; }
let cachedStory: ReturnType<typeof ownedTerritoryPastureJourney> | undefined;
function story() { cachedStory ??= ownedTerritoryPastureJourney(); return cachedStory; }
function purchaseStep() {
  const value = story();
  const step = value.journey.steps.find(candidate => candidate.result.state.revision === value.firstPurchased.revision);
  assert.ok(step); return { value, step };
}

await test('territory fresh synthetic prerequisite fixture retains revealed horses and rejects unowned work without durable effects', async context => {
  const previous = prefix(); const item = new Fixture();
  try {
    assert.equal(previous.initial.revision, 0); assert.equal(previous.state.revision, previous.steps.length);
    assert.equal(previous.state.tiles.find(tile => tile.id === 181)?.owner, null);
    assert.equal(previous.state.tiles.find(tile => tile.id === 164)?.owner, null);
    assert.equal(previous.state.pastoralSites?.sites['164']?.resource, 'horses');
    assert.ok(previous.state.civilizations[2]?.technologies.includes('animal-husbandry'));
    await persist(item, previous.steps, Number.MAX_SAFE_INTEGER, previous.initial); const before = item.database.records(); item.reopen();
    assert.deepEqual(await item.state(), previous.state); assert.deepEqual(item.database.records(), before);
    assert.equal(await replay(item), previous.steps.length);
    for (const action of [
      { type: 'acquire-tile', cityId: previous.cityId, tileId: 164 },
      { type: 'improve', cityId: previous.cityId, tileId: 164, improvementId: 'pasture' },
    ]) {
      await assert.rejects(item.store.mutate('action', { seat: previous.seat, expectedRevision: previous.state.revision, model, commandId: `old-${action.type}`, action: { type: 'strategy-action', action } }, actor, previous.timestamp));
      assert.deepEqual(item.database.records(), before);
    }
    context.diagnostic(JSON.stringify({ basis: 'Fresh synthetic prerequisites followed by actual founding, research and growth', revision: previous.state.revision, cityId: previous.cityId, path: previous.pathTileIds, replayFrames: previous.steps.length }));
  } finally { item.close(); }
});

await test('fresh territory initialization retains empty purchase records and refuses migration without rewriting assets', async () => {
  const value = ownedTerritoryJourney(); const item = new Fixture();
  try {
    await persist(item, value.steps, value.prepared.revision, value.initial);
    const state = await item.state(); assert.deepEqual(state, value.prepared); assert.deepEqual(acquisitionReceipts(state), {});
    const before = item.database.records();
    const input = { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-culture-production-1', model, commandId: 'territory-refused' };
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(item.store.mutate('release-apply', input, actor, value.time()), /pre_release_migration_disabled/);
      assert.deepEqual(item.database.records(), before);
    }
    item.reopen(); assert.deepEqual(await item.state(), state); assert.deepEqual(item.database.records(), before);
    assert.equal(await replay(item), value.steps.filter(step => step.result.state.revision <= value.prepared.revision).length);
  } finally { item.close(); }
});

await test('territory prospective exact purchases and staffed retained Pasture persist once through SQLite and strict public page detail', async context => {
  const value = story(); const item = new Fixture();
  const witnesses = new Set([value.firstPurchased.revision, value.purchased.revision, value.started.revision, value.completed.revision]);
  try {
    await item.initialize(value.journey.initial);
    for (const [index, step] of value.journey.steps.entries()) {
      const commandId = `territory-step-${index}`;
      if (witnesses.has(step.result.state.revision)) {
        const replies = await Promise.all([sendStep(item, step, commandId), sendStep(item, step, commandId)]);
        assert.equal(replies.filter(reply => reply.duplicate).length, 1);
        assert.ok(replies.every(reply => reply.acceptedRevision === step.result.state.revision));
      } else await sendStep(item, step, commandId);
      assert.deepEqual(await item.state(), step.result.state);
    }
    const receipts = acquisitionReceipts(value.purchased); assert.ok(receipts);
    assert.deepEqual(Object.keys(receipts), ['164', '181']);
    const first = receipts['181']; const second = receipts['164']; assert.ok(first && second);
    assert.equal(first.cityId, value.cityId); assert.equal(second.cityId, value.cityId);
    assert.deepEqual(first.pathTileIds, [199, 181]); assert.deepEqual(second.pathTileIds, [199, 181, 164]);
    assert.deepEqual(first.paid, { credits: 12 }); assert.deepEqual(second.paid, { credits: 18 });
    assert.equal(first.priorCivilizationPurchases, 0); assert.equal(second.priorCivilizationPurchases, 1);
    const beforeOwner = value.journey.prepared.civilizations[2]; const afterOwner = value.purchased.civilizations[2]; assert.ok(beforeOwner && afterOwner);
    assert.equal(beforeOwner.resources.credits - afterOwner.resources.credits, 30);
    assert.deepEqual(value.purchased.pastoralSites, value.journey.prepared.pastoralSites);
    assert.equal(value.purchased.rng, value.journey.prepared.rng);
    const operation = value.operated.cities.find(city => city.id === value.cityId)?.improvements?.['164']?.operation.lastResult; assert.ok(operation);
    assert.equal(operation.status, 'operated'); assert.equal(operation.residents.allocated, 1); assert.ok((operation.produced.food ?? 0) > 0); assert.equal(Object.hasOwn(operation, 'extraction'), false);
    const committed = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), value.operated);
    for (const revision of witnesses) {
      const index = value.journey.steps.findIndex(step => step.result.state.revision === revision); const step = value.journey.steps[index]; assert.ok(step);
      const duplicate = await sendStep(item, step, `territory-step-${index}`); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, revision);
      assert.deepEqual(item.database.records(), committed);
    }
    for (const revision of [value.firstPurchased.revision, value.purchased.revision]) {
      const step = value.journey.steps.find(candidate => candidate.result.state.revision === revision); assert.ok(step);
      const page = await item.store.boundedChronicle({ format: 'recorded-choices-v1', after: step.before.revision, through: revision, limit: 1 });
      assert.deepEqual(page.entries[0]?.events, step.result.events);
      const detail = await item.store.recordedChoiceDetail({ endRevision: revision, civilizationId: value.seat, cityId: value.cityId });
      assert.equal(detail.consequences.status, 'available'); assert.equal(detail.recordedReason, null);
      for (const secret of [actor, 'actorUserId', 'request_json', 'receipt_key', '"tiles":', '"civilizations":']) assert.equal(JSON.stringify(detail).includes(secret), false);
      assert.deepEqual(item.database.records(), committed);
    }
    assert.equal(await replay(item), value.journey.steps.length);
    context.diagnostic(JSON.stringify({ basis: 'Actual legal research, two paid exact purchases, construction and later staffing', cityId: value.cityId, first, second, operation, replayFrames: value.journey.steps.length }));
  } finally { item.close(); }
});

for (const table of ['world_transitions', 'world_receipts']) await test(`territory prospective ${table} failure rolls back payment ownership beneficiary and receipt before exact retry`, async () => {
  const { value, step } = purchaseStep(); const item = new Fixture();
  try {
    await persist(item, value.journey.steps, step.before.revision, value.journey.initial); const before = item.database.records();
    item.database.sql.exec(`CREATE TRIGGER fail_territory BEFORE INSERT ON ${table} WHEN NEW.receipt_key = 'action:territory-fault' BEGIN SELECT RAISE(ABORT, 'synthetic territory rollback'); END;`);
    await assert.rejects(sendStep(item, step, 'territory-fault'), /synthetic territory rollback/); assert.deepEqual(item.database.records(), before);
    item.reopen(); assert.deepEqual(await item.state(), step.before); item.database.sql.exec('DROP TRIGGER fail_territory');
    const accepted = await sendStep(item, step, 'territory-fault'); assert.deepEqual(await item.state(), step.result.state);
    const committed = item.database.records(); item.reopen(); const duplicate = await sendStep(item, step, 'territory-fault');
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, accepted.acceptedRevision); assert.deepEqual(item.database.records(), committed);
    assert.equal(await replay(item), step.result.state.revision);
  } finally { item.close(); }
});

await test('territory prospective two competing exact requests commit one payment and one beneficiary with explicit stale loser', async () => {
  const { value, step } = purchaseStep(); const item = new Fixture();
  try {
    await persist(item, value.journey.steps, step.before.revision, value.journey.initial); const before = item.database.records();
    const replies = await Promise.allSettled([sendStep(item, step, 'territory-race-a'), sendStep(item, step, 'territory-race-b')]);
    assert.equal(replies.filter(reply => reply.status === 'fulfilled').length, 1);
    const refusal = replies.find(reply => reply.status === 'rejected'); assert.ok(refusal?.status === 'rejected');
    assert.match(String(refusal.reason), /stale_revision/);
    assert.deepEqual(await item.state(), step.result.state);
    const committed = item.database.records(); assert.equal(committed.receipts.length, before.receipts.length + 1); assert.equal(committed.history.length, before.history.length + 1);
    item.reopen(); assert.deepEqual(await item.state(), step.result.state); assert.deepEqual(item.database.records(), committed);
  } finally { item.close(); }
});

await test('territory prospective invalid exact and forged requests roll back due candidate upkeep without writes', async () => {
  const value = story(); const item = new Fixture();
  try {
    await persist(item, value.journey.steps, value.purchased.revision, value.journey.initial); const state = await item.state(); const before = item.database.records();
    const timestamp = coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60);
    const actions = [
      { type: 'acquire-tile', cityId: value.cityId, tileId: 164 },
      { type: 'acquire-tile', cityId: 'missing-town', tileId: 180 },
      { type: 'acquire-tile', cityId: 'city-0', tileId: 180 },
      { type: 'acquire-tile', cityId: value.cityId, tileId: 199 },
      { type: 'acquire-tile', cityId: value.cityId, tileId: 164.5 },
      { type: 'acquire-tile', cityId: value.cityId, tileId: 180, paid: { credits: 0 } },
    ];
    for (const [index, action] of actions.entries()) {
      await assert.rejects(item.store.mutate('action', { seat: value.seat, expectedRevision: state.revision, model, commandId: `territory-invalid-${index}`, action: { type: 'strategy-action', action } }, actor, timestamp));
      assert.deepEqual(item.database.records(), before);
    }
    item.reopen(); assert.deepEqual(await item.state(), state); assert.deepEqual(item.database.records(), before);
  } finally { item.close(); }
});

await test('territory prospective public receipt rejects unknown event fields without repair writes', async () => {
  const { value, step } = purchaseStep(); const item = new Fixture();
  try {
    await persist(item, value.journey.steps, step.result.state.revision, value.journey.initial);
    const event = step.result.events.find(candidate => candidate.type === 'territory-acquired'); assert.ok(event);
    const corrupt = step.result.events.map(candidate => candidate.id === event.id ? { ...candidate, unexpectedReceiptField: true } : candidate);
    item.database.sql.prepare('UPDATE world_transitions SET events_json=? WHERE end_revision=?').run(JSON.stringify(corrupt), step.result.state.revision);
    const before = item.database.records();
    await assert.rejects(item.store.boundedChronicle({ format: 'recorded-choices-v1', after: step.before.revision, through: step.result.state.revision, limit: 1 }), { message: 'corrupt_history' });
    assert.deepEqual(item.database.records(), before);
    await assert.rejects(item.store.recordedChoiceDetail({ endRevision: step.result.state.revision, civilizationId: value.seat, cityId: value.cityId }), { message: 'corrupt_history' });
    assert.deepEqual(item.database.records(), before);
  } finally { item.close(); }
});

await test('territory canonical registry and event aliases reject malformed historical purchase records', async context => {
  const value = story(); const baseline = value.purchased; assert.ok(isWorldState(baseline));
  const mutations: Array<[string, (state: typeof baseline) => void]> = [
    ['missing adopted registry', state => { Reflect.deleteProperty(state, 'tileAcquisitions'); }],
    ['before feature gate', state => { state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== 'owned-territory'); }],
    ['noncanonical key', state => { const records = acquisitionReceipts(state); assert.ok(records?.['181']); records['0181'] = records['181']; delete records['181']; }],
    ['mismatched tile', state => { const receipt = acquisitionReceipts(state)?.['181']; assert.ok(receipt); receipt.tileId = 180; }],
    ['future identity', state => { const receipt = acquisitionReceipts(state)?.['181']; assert.ok(receipt); receipt.id = `territory-${state.revision + 1}`; }],
    ['duplicate identity', state => { const records = acquisitionReceipts(state); assert.ok(records?.['181'] && records['164']); records['164'].id = records['181'].id; }],
    ['wrong center', state => { const receipt = acquisitionReceipts(state)?.['181']; assert.ok(receipt); receipt.cityTileId = 198; }],
    ['disconnected path', state => { const receipt = acquisitionReceipts(state)?.['164']; assert.ok(receipt); receipt.pathTileIds = [199, 57, 164]; }],
    ['repeated path', state => { const receipt = acquisitionReceipts(state)?.['164']; assert.ok(receipt); receipt.pathTileIds = [199, 181, 199, 181, 164]; }],
    ['fractional prior count', state => { const receipt = acquisitionReceipts(state)?.['181']; assert.ok(receipt); receipt.priorCivilizationPurchases = 0.5; }],
    ['skipped retained count', state => { state.events = []; const receipt = acquisitionReceipts(state)?.['164']; assert.ok(receipt); receipt.priorCivilizationPurchases = 2; }],
    ['reordered retained count', state => { state.events = []; const records = acquisitionReceipts(state); assert.ok(records?.['181'] && records['164']); records['181'].priorCivilizationPurchases = 1; records['164'].priorCivilizationPurchases = 0; }],
    ['removed earlier retained purchase', state => { state.events = []; const records = acquisitionReceipts(state); assert.ok(records); delete records['181']; }],
    ['negative credits', state => { const receipt = acquisitionReceipts(state)?.['181']; assert.ok(receipt); receipt.paid.credits = -1; }],
    ['unknown payment field', state => { const receipt = acquisitionReceipts(state)?.['181']; assert.ok(receipt); Reflect.set(receipt.paid, 'materials', 1); }],
    ['wrong retained owner', state => { const tile = state.tiles.find(candidate => candidate.id === 181); assert.ok(tile); tile.owner = 0; }],
    ['different event alias', state => { const receipt = acquisitionReceipts(state)?.['164']; assert.ok(receipt); const event = state.events.find(candidate => candidate.id === receipt.eventId); assert.ok(event); Reflect.set(event, 'territoryAcquisition', { ...receipt, distance: 3 }); }],
    ['missing structured event receipt', state => { const receipt = acquisitionReceipts(state)?.['164']; assert.ok(receipt); const event = state.events.find(candidate => candidate.id === receipt.eventId); assert.ok(event); Reflect.deleteProperty(event, 'territoryAcquisition'); }],
  ];
  for (const [name, mutate] of mutations) await context.test(name, () => { const state = structuredClone(baseline); mutate(state); assert.equal(isWorldState(state), false); });
});

await test('territory historical purchase topology and payment survive feed trimming source loss and mutable terrain', () => {
  const value = story(); const state = structuredClone(value.purchased); state.events = [];
  state.cities = state.cities.filter(city => city.id !== value.cityId);
  const target = state.tiles.find(tile => tile.id === 164); assert.ok(target); target.terrain = 'mountain';
  const receipt = acquisitionReceipts(state)?.['164']; assert.ok(receipt); receipt.paid.credits = 99;
  assert.ok(isWorldState(state)); assert.equal(acquisitionReceipts(state)?.['164']?.cityId, value.cityId);
});

await test('territory actual appended-row purchases open exact staffed forest work with retained civilization-wide history', async context => {
  const value = ownedTerritoryForestJourney(); const item = new Fixture();
  try {
    assert.equal(value.journey.initial.revision, 0); assert.ok(value.journey.steps.length > 0);
    assert.equal(value.operated.revision, value.journey.steps.length); assert.equal(value.founded.cities.find(city => city.id === value.cityId)?.tileId, 218);
    await persist(item, value.journey.steps, Number.MAX_SAFE_INTEGER, value.journey.initial); const committed = item.database.records(); item.reopen();
    assert.deepEqual(await item.state(), value.operated);
    const purchases = Object.values(value.operated.tileAcquisitions ?? {}).toSorted((left, right) => left.priorCivilizationPurchases - right.priorCivilizationPurchases);
    assert.deepEqual(purchases.map(receipt => receipt.tileId), [181, 164, 219, 237]);
    assert.deepEqual(purchases.map(receipt => receipt.priorCivilizationPurchases), [0, 1, 2, 3]);
    assert.ok(purchases.slice(2).every(receipt => receipt.cityId === value.cityId));
    const installed = value.operated.cities.find(city => city.id === value.cityId)?.improvements?.['237']; assert.ok(installed);
    assert.equal(installed.improvementId, 'lumber-mill'); assert.equal(installed.operation.lastResult?.status, 'operated');
    assert.equal(installed.operation.lastResult.residents.allocated, 1);
    assert.deepEqual(installed.completion.paid, { materials: 10, credits: 5 }); assert.equal(installed.completion.workRequired, 6);
    const openingStep = value.journey.steps.at(-1); assert.ok(openingStep?.input.kind === 'strategy'); assert.deepEqual(openingStep.result.state, value.operated);
    const openingCity = openingStep.before.cities.find(city => city.id === value.cityId); const openingActor = openingStep.before.civilizations[value.seat]; assert.ok(openingCity && openingActor);
    const site = openingStep.before.tiles.find(tile => tile.id === openingCity.tileId); assert.ok(site);
    assert.ok(openingStep.before.unlockedFeatures.includes('terrain-production'));
    assert.deepEqual(openingCity.buildings, []); assert.deepEqual(Object.keys(openingCity.improvements ?? {}), ['237']);
    assert.equal(openingActor.government?.active ?? null, null); assert.ok(!Object.values(openingStep.before.wonders ?? {}).some(wonder => wonder.completion.cityId === value.cityId));
    const focus: Partial<Resources> = ECONOMY_RULES.focusProduction[openingCity.focus];
    const rawMaterials = ECONOMY_RULES.baseProduction.materials + (focus.materials ?? 0) + (SETTLEMENT_SITE_OUTPUTS[site.terrain]?.materials ?? 0) + (site.resource === 'materials' ? 1 : 0);
    const productivity = (0.5 + openingCity.wellbeing / 100) * (1 - openingCity.damage / 100) * (1 + openingCity.infrastructure / 10);
    const expectedMaterials = Math.round((Math.round((rawMaterials + 4) * productivity * 100) / 100 - Math.round(rawMaterials * productivity * 100) / 100) * 100) / 100;
    assert.ok(expectedMaterials > 0); assert.equal(installed.operation.lastResult.produced.materials, expectedMaterials);
    assert.equal(committed.history.length, value.journey.steps.length); assert.equal(committed.receipts.length, value.journey.steps.length);
    assert.equal(await replay(item), value.journey.steps.length); assert.deepEqual(item.database.records(), committed);
    const retained = structuredClone(value.operated); retained.events = []; retained.cities = retained.cities.filter(city => city.id !== value.pasture.cityId);
    assert.ok(isWorldState(retained)); assert.equal(Object.keys(retained.tileAcquisitions ?? {}).length, 4);
    context.diagnostic(JSON.stringify({ basis: 'Actual appended-row founding and exact purchases after legal productive research', frames: value.journey.steps.length, cityId: value.cityId, purchases, operation: installed.operation.lastResult }));
  } finally { item.close(); }
});

await test('territory canonical purchased-site beneficiary cannot be redirected after completed or active work', () => {
  const value = story();
  for (const source of [value.started, value.operated]) {
    const state = structuredClone(source); state.events = [];
    const receipt = state.tileAcquisitions?.['164']; assert.ok(receipt);
    receipt.cityId = 'removed-other-beneficiary';
    assert.equal(isWorldState(state), false);
  }
});

function object(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}

await test('territory generic protected action and public full compact observations preserve detached canonical facts without worker edits', async () => {
  const { value, step } = purchaseStep(); const item = new Fixture();
  try {
    await persist(item, value.journey.steps, step.before.revision, value.journey.initial);
    assert.ok(step.input.kind === 'action' && step.input.command.timestamp);
    const timestamp = step.input.command.timestamp; let readTimestamp = timestamp; const worker = createWorker(undefined, { now: () => new Date(readTimestamp) });
    const env = { DB: item.database, AGENT_WRITER_USER_IDS: actor };
    const request = new Request('https://world.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': actor }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'play_action', arguments: stepArguments(step, 'territory-mcp-exact') } }) });
    const response = await worker.fetch(request, env); assert.equal(response.status, 200);
    const reply: unknown = await response.json(); assert.equal(object(object(reply).result).isError, false);
    assert.deepEqual(await item.state(), step.result.state);
    const next = value.journey.steps.find(candidate => candidate.result.state.revision === value.purchased.revision); assert.ok(next?.input.kind === 'action' && next.input.command.timestamp);
    readTimestamp = next.input.command.timestamp;
    const before = item.database.records(); const changes = item.database.sql.prepare('SELECT total_changes() AS count').get();
    for (const compact of [false, true]) {
      const read = await worker.fetch(new Request(`https://world.test/api/observe?seat=2${compact ? '&observationFormat=compact-trade-v1' : ''}`), env);
      assert.equal(read.status, 200); const raw: unknown = await read.json(); const view = object(raw);
      const canonical = compact ? observeCompactTrade(step.result.state, 2, readTimestamp) : observe(step.result.state, 2, readTimestamp);
      assert.deepEqual(view.territory, canonical.territory);
      assert.deepEqual(view.legalActions, compact ? canonical.legalActions.map((option, choice) => ({ choice, ...option })) : canonical.legalActions);
      assert.ok(canonical.legalActions.some(option => option.territoryQuote?.tileId === 164));
      object(view.territory).purchases = [];
      assert.deepEqual(await item.state(), step.result.state);
    }
    assert.deepEqual(item.database.records(), before); assert.deepEqual(item.database.sql.prepare('SELECT total_changes() AS count').get(), changes);
  } finally { item.close(); }
});

await test('territory malformed persisted registry refuses reopening without repair writes', async () => {
  const value = story(); const item = new Fixture();
  try {
    await persist(item, value.journey.steps, value.purchased.revision, value.journey.initial);
    const corrupt = structuredClone(value.purchased); const receipt = corrupt.tileAcquisitions?.['164']; assert.ok(receipt); corrupt.events = []; receipt.priorCivilizationPurchases = 7;
    item.database.sql.prepare('UPDATE world_state SET state_json=?').run(JSON.stringify(corrupt)); item.reopen();
    const before = item.database.records(); await assert.rejects(item.store.read()); assert.deepEqual(item.database.records(), before);
  } finally { item.close(); }
});
