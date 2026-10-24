import assert from 'node:assert/strict';
import { seedHostedWorld } from './fixtures/current-world.ts';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';
import { foundryProductionOperationJourney } from './fixtures/foundry-production-journey.ts';
import { foundryPrefix } from './fixtures/foundry-prefix.ts';
import { strategicCapacity } from '../core/simulation/metals.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const actor = 'synthetic-foundry-owner';
const model = 'synthetic-foundry-host-fixture';

class Statement implements D1Statement {
  private readonly database: FoundryDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: FoundryDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class FoundryDatabase implements D1Database {
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
  private readonly directory = mkdtempSync(join(tmpdir(), 'foundry-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new FoundryDatabase(this.path);
  constructor() { this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8')); }
  get store() { return new WorldRepository(this.database); }
  async state() { const result = await this.store.read(); assert.ok(result); return result.state; }
  async initialize(state: WorldState) { seedHostedWorld(this.database.sql, state); }
  async input(commandId: string, action: GameAction) { return { seat: 1, expectedRevision: (await this.state()).revision, model, commandId, action: { type: 'strategy-action', action } }; }
  send(input: Record<string, unknown>, seconds: number) { return this.store.mutate('action', input, actor, coastalPrefixTime(seconds)); }
  async beat() { const state = await this.state(); const seconds = ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60; return this.store.mutate('strategy-catchup', { expectedRevision: state.revision, commandId: `beat-${state.revision}`, timestamp: coastalPrefixTime(seconds), model }, actor, coastalPrefixTime(seconds)); }
  reopen() { this.database.sql.close(); this.database = new FoundryDatabase(this.path); }
  close() { this.database.sql.close(); rmSync(this.directory, { recursive: true, force: true }); }
}
async function replay(item: Fixture) {
  const saved = await item.store.read(); assert.ok(saved); let state = saved.initial; let after = 0; let count = 0;
  for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
    const page = await item.store.history(after, 25);
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
    await sendStep(item, step, `foundry-step-${index}`); assert.deepEqual(await item.state(), step.result.state); assert.ok(isWorldState(await item.state()));
  }
}

let cachedPrefix: ReturnType<typeof foundryPrefix> | undefined;
function prefix() { cachedPrefix ??= foundryPrefix(); return cachedPrefix; }
let cachedStory: ReturnType<typeof foundryProductionOperationJourney> | undefined;
function story() { cachedStory ??= foundryProductionOperationJourney(); return cachedStory; }
function mutableRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function foundryStart() {
  const value = story(); const step = value.journey.steps.find(candidate => candidate.result.state.revision === value.started.revision);
  assert.ok(step?.input.kind === 'action' && step.input.command.action.type === 'build' && step.input.command.timestamp);
  return { value, step, action: step.input.command.action };
}

await test('foundry fresh synthetic prerequisite fixture persists capacity-blocked consent and refuses consumer without researched prerequisites without writes', async context => {
  const previous = prefix(); const item = new Fixture();
  try {
    assert.equal(previous.initial.revision, 0); assert.equal(previous.state.revision, previous.steps.length); assert.equal(previous.state.civilizations[previous.seat]?.era, 2);
    assert.equal(previous.state.civilizations[previous.seat]?.strategicResources?.iron, strategicCapacity(previous.state, previous.seat));
    const route = previous.state.routes.find(candidate => candidate.id === previous.routeId); assert.ok(route?.agreement);
    assert.equal(route.agreement.lastAttemptRound, previous.state.round); assert.match(route.agreement.blockedReason ?? '', /storage full/i);
    await persist(item, previous.steps, Number.MAX_SAFE_INTEGER, previous.initial); const before = item.database.records(); item.reopen();
    assert.deepEqual(await item.state(), previous.state); assert.equal(await replay(item), previous.steps.length);
    for (const action of [{ type: 'build', project: 'foundry', cityId: previous.cityId }]) {
      await assert.rejects(item.store.mutate('action', { seat: previous.seat, expectedRevision: previous.state.revision, commandId: `unreleased-${JSON.stringify(action)}`, model, action: { type: 'strategy-action', action } }, actor, previous.timestamp));
      assert.deepEqual(item.database.records(), before);
    }
    context.diagnostic(JSON.stringify({ basis: 'fresh synthetic prerequisite fixture with actual consent and due storage refusal', frames: previous.steps.length, round: previous.state.round, cityId: previous.cityId, route }));
  } finally { item.close(); }
});

await test('foundry prospective exact paid order and mixed-ledger first operation survive duplicate reopen replay', async context => {
  const value = story(); const item = new Fixture(); const witnesses = new Set([value.started.revision, value.completed.revision, value.operated.revision]);
  try {
    await item.initialize(value.journey.initial);
    for (const [index, step] of value.journey.steps.entries()) {
      const commandId = `foundry-step-${index}`;
      if (witnesses.has(step.result.state.revision)) {
        const replies = await Promise.all([sendStep(item, step, commandId), sendStep(item, step, commandId)]);
        assert.equal(replies.filter(reply => reply.duplicate).length, 1); assert.ok(replies.every(reply => reply.acceptedRevision === step.result.state.revision));
      } else await sendStep(item, step, commandId);
      assert.deepEqual(await item.state(), step.result.state);
    }
    const active = value.started.cities.find(city => city.id === value.journey.cityId)?.construction?.active;
    assert.ok(active && !('kind' in active)); assert.equal(active.buildingId, 'foundry'); assert.equal(active.cityId, value.journey.cityId);
    assert.deepEqual(active.paid, { materials: 32, credits: 16 }); assert.equal(active.workRequired, 14);
    const start = foundryStart().step; const before = start.before.civilizations[value.journey.seat]?.resources; const after = start.result.state.civilizations[value.journey.seat]?.resources; assert.ok(before && after);
    assert.equal(Number((before.materials - after.materials).toFixed(2)), 32); assert.equal(Number((before.credits - after.credits).toFixed(2)), 16);
    assert.equal(value.completed.cities.find(city => city.id === value.journey.cityId)?.buildingOperations?.foundry?.lastResult, null);
    const operation = value.operated.cities.find(city => city.id === value.journey.cityId)?.buildingOperations?.foundry?.lastResult; assert.ok(operation);
    assert.equal(operation.status, 'operated'); assert.deepEqual(operation.paid, { energy: 2 }); assert.ok((operation.produced.materials ?? 0) > 0);
    assert.ok('strategicPaid' in operation && 'strategicShortages' in operation); assert.deepEqual(operation.strategicPaid, { iron: 1 }); assert.deepEqual(operation.strategicShortages, []);
    assert.equal(operation.residents?.required, 3); assert.equal(operation.residents?.allocated, 3);
    const committed = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), value.operated);
    for (const revision of witnesses) {
      const index = value.journey.steps.findIndex(step => step.result.state.revision === revision); const step = value.journey.steps[index]; assert.ok(step);
      const duplicate = await sendStep(item, step, `foundry-step-${index}`); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, revision); assert.deepEqual(item.database.records(), committed);
    }
    const detail = await item.store.recordedChoiceDetail({ endRevision: value.operated.revision, civilizationId: value.journey.seat, cityId: value.journey.cityId });
    assert.ok(detail.consequences.status === 'available' && detail.consequences.town.status === 'available');
    const publicOperation = detail.consequences.town.operations.find(entry => entry.buildingId === 'foundry')?.result;
    assert.deepEqual(publicOperation, operation); assert.ok(publicOperation); publicOperation.paid.energy = 999;
    assert.equal(operation.paid.energy, 2); assert.deepEqual(item.database.records(), committed);
    for (const secret of [actor, 'actorUserId', 'request_json', 'receipt_key', '"tiles":', '"civilizations":']) assert.equal(JSON.stringify(detail).includes(secret), false);
    assert.equal(await replay(item), value.journey.steps.length);
    context.diagnostic(JSON.stringify({ basis: 'Unedited legal after-half and real SQLite restart', frames: value.journey.steps.length, revision: value.operated.revision, round: value.operated.round, active, operation }));
  } finally { item.close(); }
});

for (const table of ['world_transitions', 'world_receipts']) await test(`foundry prospective ${table} fault rolls back every mixed-ledger beat and exact action receipt`, async () => {
  const value = story(); const item = new Fixture(); const step = value.operationStep; assert.equal(step.input.kind, 'strategy');
  try {
    await persist(item, value.journey.steps, step.before.revision, value.journey.initial); const before = item.database.records();
    item.database.sql.exec(`CREATE TRIGGER fail_foundry BEFORE INSERT ON ${table} WHEN NEW.receipt_key = 'strategy-catchup:foundry-operation-fault' BEGIN SELECT RAISE(ABORT, 'synthetic foundry rollback'); END;`);
    await assert.rejects(sendStep(item, step, 'foundry-operation-fault'), /synthetic foundry rollback/); assert.deepEqual(item.database.records(), before);
    item.reopen(); assert.deepEqual(await item.state(), step.before); item.database.sql.exec('DROP TRIGGER fail_foundry');
    const accepted = await sendStep(item, step, 'foundry-operation-fault'); assert.deepEqual(await item.state(), step.result.state);
    const committed = item.database.records(); item.reopen(); const duplicate = await sendStep(item, step, 'foundry-operation-fault');
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, accepted.acceptedRevision); assert.deepEqual(item.database.records(), committed); await replay(item);
  } finally { item.close(); }
});

await test('foundry prospective competing exact starts commit one payment with a stale CAS loser', async () => {
  const { value, step } = foundryStart(); const item = new Fixture();
  try {
    await persist(item, value.journey.steps, step.before.revision, value.journey.initial); const before = item.database.records();
    const replies = await Promise.allSettled([sendStep(item, step, 'foundry-race-a'), sendStep(item, step, 'foundry-race-b')]);
    assert.equal(replies.filter(reply => reply.status === 'fulfilled').length, 1);
    const loser = replies.find(reply => reply.status === 'rejected'); assert.ok(loser?.status === 'rejected'); assert.match(String(loser.reason), /stale_revision/);
    assert.deepEqual(await item.state(), step.result.state); const committed = item.database.records(); assert.equal(committed.history.length, before.history.length + 1); assert.equal(committed.receipts.length, before.receipts.length + 1);
    item.reopen(); assert.deepEqual(await item.state(), step.result.state);
  } finally { item.close(); }
});

await test('foundry prospective foreign wrong-town and forged resource requests refuse candidate upkeep without writes', async () => {
  const { value, step } = foundryStart(); const item = new Fixture();
  try {
    await persist(item, value.journey.steps, step.before.revision, value.journey.initial); const before = item.database.records(); const timestamp = coastalPrefixTime(((step.before.independentTurns?.strategyTicks ?? 0) + 1) * 60);
    for (const [index, action] of [
      { type: 'build', project: 'foundry', cityId: 'city-0' },
      { type: 'build', project: 'foundry', cityId: 'missing-town' },
      { type: 'build', project: 'foundry', cityId: value.journey.cityId, strategicPaid: {} },
    ].entries()) {
      await assert.rejects(item.store.mutate('action', { seat: value.journey.seat, expectedRevision: step.before.revision, commandId: `foundry-refused-${index}`, model, action: { type: 'strategy-action', action } }, actor, timestamp));
      assert.deepEqual(item.database.records(), before);
    }
    item.reopen(); assert.deepEqual(await item.state(), step.before);
  } finally { item.close(); }
});

await test('foundry prospective legal pause preserves prior receipt then records empty two-ledger payment and zero residents', async () => {
  const value = foundryProductionOperationJourney(); const item = new Fixture(); const cityId = value.journey.cityId;
  const historical = value.operated.cities.find(city => city.id === cityId)?.buildingOperations?.foundry?.lastResult; assert.ok(historical);
  value.journey.act({ type: 'set-building-operation', cityId, buildingId: 'foundry', enabled: false });
  assert.deepEqual(value.journey.state.cities.find(city => city.id === cityId)?.buildingOperations?.foundry?.lastResult, historical);
  value.journey.beat();
  try {
    await persist(item, value.journey.steps, Number.MAX_SAFE_INTEGER, value.journey.initial); item.reopen(); const state = await item.state();
    const result = state.cities.find(city => city.id === cityId)?.buildingOperations?.foundry?.lastResult; assert.ok(result);
    assert.equal(result.status, 'paused'); assert.deepEqual(result.paid, {}); assert.deepEqual(result.produced, {}); assert.equal(result.residents?.allocated, 0);
    assert.ok('strategicPaid' in result && 'strategicShortages' in result); assert.deepEqual(result.strategicPaid, {}); assert.deepEqual(result.strategicShortages, []);
    assert.equal(await replay(item), value.journey.steps.length);
  } finally { item.close(); }
});

await test('foundry prospective consumption permits a real later due gross shipment after proven full storage refusal', async context => {
  const value = foundryProductionOperationJourney(); const item = new Fixture(); const journey = value.journey; const previous = journey.previous;
  const prior = previous.state.routes.find(route => route.id === previous.routeId)?.agreement; assert.ok(prior); assert.match(prior.blockedReason ?? '', /storage full/i);
  const first = value.operationStep; assert.ok(first.before.civilizations[journey.seat]);
  assert.equal(value.completed.civilizations[journey.seat]?.strategicResources?.iron, strategicCapacity(value.completed, journey.seat));
  assert.equal(value.operated.civilizations[journey.seat]?.strategicResources?.iron, (value.completed.civilizations[journey.seat]?.strategicResources?.iron ?? 0) - 1);
  const beforeCount = value.completed.routes.find(route => route.id === previous.routeId)?.agreement?.deliveryCount; assert.ok(beforeCount !== undefined);
  journey.until(() => (journey.state.routes.find(route => route.id === previous.routeId)?.agreement?.deliveryCount ?? 0) > beforeCount);
  const deliveryStep = journey.steps.at(-1); assert.ok(deliveryStep);
  const route = journey.state.routes.find(candidate => candidate.id === previous.routeId); assert.ok(route?.agreement);
  const event = deliveryStep.result.events.find(candidate => candidate.strategicShipment?.routeId === previous.routeId); assert.ok(event?.strategicShipment);
  assert.ok(deliveryStep.result.state.round > value.completed.round); assert.equal(route.agreement.lastDeliveryRound, deliveryStep.result.state.round);
  assert.equal((route.agreement.lastDeliveryRound - route.agreement.acceptedRound) % route.agreement.terms.cadenceRounds, 0);
  assert.deepEqual(route.agreement.terms, prior.terms);
  assert.deepEqual(event.strategicShipment.proposerSent, { iron: 2 }); assert.deepEqual(event.strategicShipment.recipientSent, {});
  assert.ok((deliveryStep.before.civilizations[journey.seat]?.strategicResources?.iron ?? 0) < strategicCapacity(deliveryStep.before, journey.seat));
  try {
    await persist(item, journey.steps, Number.MAX_SAFE_INTEGER, journey.initial); const committed = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), journey.state);
    const index = journey.steps.indexOf(deliveryStep); const duplicate = await sendStep(item, deliveryStep, `foundry-step-${index}`);
    assert.equal(duplicate.duplicate, true); assert.deepEqual(item.database.records(), committed); assert.equal(await replay(item), journey.steps.length);
    const publicPage = await item.store.boundedChronicle({ format: 'recorded-choices-v1', after: deliveryStep.before.revision, through: deliveryStep.result.state.revision, limit: 20 });
    assert.ok(publicPage.entries.some(entry => entry.events.some(candidate => candidate.id === event.id && candidate.strategicShipment?.routeId === previous.routeId)));
    context.diagnostic(JSON.stringify({ basis: 'Actual legal blocked-capacity route then later due delivery after mixed-ledger operation', beforeCount, afterCount: route.agreement.deliveryCount, operationRound: value.operated.round, deliveryRound: route.agreement.lastDeliveryRound, shipment: event.strategicShipment }));
  } finally { item.close(); }
});

await test('foundry prospective canonical strategic receipts reject malformed vectors shortages and partial payments', async context => {
  const value = story();
  const cases: Array<[string, (receipt: Record<string, unknown>) => void]> = [
    ['missing Foundry resident snapshot', receipt => { delete receipt.residents; }],
    ['missing both strategic fields', receipt => { delete receipt.strategicPaid; delete receipt.strategicShortages; }],
    ['missing strategic shortages', receipt => { delete receipt.strategicShortages; }],
    ['missing strategic payment', receipt => { delete receipt.strategicPaid; }],
    ['unknown strategic resource', receipt => { receipt.strategicPaid = { horses: 1 }; }],
    ['ordinary resource in strategic payment', receipt => { receipt.strategicPaid = { energy: 2 }; }],
    ['negative strategic payment', receipt => { receipt.strategicPaid = { iron: -1 }; }],
    ['fractional strategic payment', receipt => { receipt.strategicPaid = { iron: 0.5 }; }],
    ['nonfinite strategic payment', receipt => { receipt.strategicPaid = { iron: Infinity }; }],
    ['strategic resource in ordinary payment', receipt => { receipt.paid = { iron: 1, energy: 2 }; }],
    ['operated strategic shortage', receipt => { receipt.strategicShortages = [{ resource: 'iron', required: 1, available: 0 }]; }],
    ['unknown receipt field', receipt => { receipt.strategicOutput = { iron: 1 }; }],
    ['blocked partial payment', receipt => { receipt.status = 'blocked'; receipt.strategicShortages = [{ resource: 'iron', required: 1, available: 0 }]; }],
    ['paused strategic shortage', receipt => { receipt.status = 'paused'; receipt.paid = {}; receipt.produced = {}; receipt.strategicPaid = {}; receipt.residents = { ruleVersion: 1, openingPopulation: 6, communityReserve: 3, required: 3, available: 3, allocated: 0 }; receipt.strategicShortages = [{ resource: 'iron', required: 1, available: 0 }]; }],
  ];
  for (const [label, corrupt] of cases) await context.test(label, () => {
    const state = structuredClone(value.operated); const receipt = state.cities.find(city => city.id === value.journey.cityId)?.buildingOperations?.foundry?.lastResult; assert.ok(receipt);
    assert.ok(mutableRecord(receipt)); corrupt(receipt); assert.equal(isWorldState(state), false);
  });
  for (const [label, shortages] of [
    ['duplicate shortage', [{ resource: 'iron', required: 1, available: 0 }, { resource: 'iron', required: 2, available: 0 }]],
    ['unknown shortage resource', [{ resource: 'horses', required: 1, available: 0 }]],
    ['not a real shortage', [{ resource: 'iron', required: 1, available: 1 }]],
    ['fractional shortage', [{ resource: 'iron', required: 1, available: 0.5 }]],
    ['unknown shortage field', [{ resource: 'iron', required: 1, available: 0, routeId: 'invented' }]],
  ] as const) await context.test(label, () => {
    const state = structuredClone(value.operated); const receipt = state.cities.find(city => city.id === value.journey.cityId)?.buildingOperations?.foundry?.lastResult; assert.ok(receipt);
    Object.assign(receipt, { status: 'blocked', paid: {}, produced: {}, shortages: [], strategicPaid: {}, strategicShortages: shortages, residents: { ruleVersion: 1, openingPopulation: 6, communityReserve: 3, required: 3, available: 3, allocated: 0 } });
    assert.equal(isWorldState(state), false);
  });
});

await test('foundry prospective public strict page and detail preserve corruption failure with zero repair writes', async () => {
  const value = story(); const item = new Fixture(); const step = value.operationStep;
  try {
    await persist(item, value.journey.steps, Number.MAX_SAFE_INTEGER, value.journey.initial);
    const event = step.result.events.find(candidate => candidate.type === 'building-operation' && candidate.detail.startsWith(`${value.journey.cityId}/foundry `)); assert.ok(event);
    const altered = step.result.events.map(candidate => candidate.id === event.id ? { ...candidate, unknownStrategicReceipt: true } : candidate);
    item.database.sql.prepare('UPDATE world_transitions SET events_json=? WHERE end_revision=?').run(JSON.stringify(altered), value.operated.revision); const before = item.database.records();
    await assert.rejects(item.store.boundedChronicle({ format: 'recorded-choices-v1', after: step.before.revision, through: value.operated.revision, limit: 1 }), { message: 'corrupt_history' });
    await assert.rejects(item.store.recordedChoiceDetail({ endRevision: value.operated.revision, civilizationId: value.journey.seat, cityId: value.journey.cityId }), { message: 'corrupt_history' });
    assert.deepEqual(item.database.records(), before);
  } finally { item.close(); }
});

await test('foundry operated strategic receipt requires a positive retained debit', () => {
  const value = story();
  for (const payment of [{}, { iron: 0 }, { iron: 7 }]) {
    const state = structuredClone(value.operated);
    const receipt = state.cities.find(city => city.id === value.journey.cityId)?.buildingOperations?.foundry?.lastResult; assert.ok(receipt);
    Object.assign(receipt, { strategicPaid: payment });
    assert.equal(isWorldState(state), (payment.iron ?? 0) > 0, JSON.stringify(payment));
  }
  assert.ok(isWorldState(value.journey.prepared));
});

await test('foundry prospective historical strategic receipts retain recorded amounts without mutable tuning or current-stock equality', () => {
  const value = story(); const historical = structuredClone(value.operated);
  const civilization = historical.civilizations[value.journey.seat]; assert.ok(civilization); civilization.strategicResources = {};
  const result = historical.cities.find(city => city.id === value.journey.cityId)?.buildingOperations?.foundry?.lastResult; assert.ok(result);
  Object.assign(result, { strategicPaid: { iron: 7 }, strategicShortages: [] }); assert.ok(isWorldState(historical));
  const blocked = structuredClone(historical); const receipt = blocked.cities.find(city => city.id === value.journey.cityId)?.buildingOperations?.foundry?.lastResult; assert.ok(receipt);
  Object.assign(receipt, { status: 'blocked', paid: {}, produced: {}, shortages: [], strategicPaid: {}, strategicShortages: [{ resource: 'iron', required: 9, available: 3 }], residents: { ruleVersion: 1, openingPopulation: 6, communityReserve: 3, required: 3, available: 3, allocated: 0 } });
  assert.ok(isWorldState(blocked));
  const ungated = structuredClone(blocked); ungated.unlockedFeatures = ungated.unlockedFeatures.filter(feature => feature !== 'foundry-production'); assert.equal(isWorldState(ungated), false);
  assert.ok(isWorldState(value.journey.prepared));
});

await test('foundry prospective synthetic iron energy and resident scarcity persist no partial debit after SQLite restart', async context => {
  const value = story();
  for (const missing of ['iron', 'energy', 'residents'] as const) await context.test(missing, async () => {
    const state = structuredClone(value.completed); const city = state.cities.find(candidate => candidate.id === value.journey.cityId); const civilization = state.civilizations[value.journey.seat]; assert.ok(city && civilization);
    for (const town of state.cities) for (const [id, operation] of Object.entries(town.buildingOperations ?? {})) operation.enabled = town.id === city.id && id === 'foundry';
    city.population = missing === 'residents' ? 5 : 6; civilization.resources.energy = missing === 'energy' ? 1 : 2; civilization.strategicResources = { iron: missing === 'iron' ? 0 : 1 };
    assert.ok(isWorldState(state)); const paused = structuredClone(state); const control = paused.cities.find(candidate => candidate.id === city.id)?.buildingOperations?.foundry; assert.ok(control); control.enabled = false;
    const timestamp = coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60);
    const expected = catchUpStrategy(state, timestamp); const withoutFoundry = catchUpStrategy(paused, timestamp); assert.ok(expected.ok && withoutFoundry.ok);
    assert.deepEqual(expected.state.civilizations, withoutFoundry.state.civilizations);
    const item = new Fixture();
    try {
      await item.initialize(story().journey.initial); item.database.sql.prepare('UPDATE world_state SET revision=?, state_json=?').run(state.revision, JSON.stringify(state));
      const input = { expectedRevision: state.revision, commandId: `synthetic-foundry-${missing}`, timestamp, model };
      const reply = await item.store.mutate('strategy-catchup', input, actor, timestamp); assert.deepEqual(await item.state(), expected.state);
      const result = expected.state.cities.find(candidate => candidate.id === city.id)?.buildingOperations?.foundry?.lastResult; assert.ok(result);
      assert.equal(result.status, 'blocked'); assert.deepEqual(result.paid, {}); assert.deepEqual(result.produced, {}); assert.equal(result.residents?.allocated, 0);
      assert.ok('strategicPaid' in result && 'strategicShortages' in result); assert.deepEqual(result.strategicPaid, {});
      if (missing === 'iron') { assert.deepEqual(result.shortages, []); assert.deepEqual(result.strategicShortages, [{ resource: 'iron', required: 1, available: 0 }]); }
      const committed = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), expected.state);
      const duplicate = await item.store.mutate('strategy-catchup', input, actor, timestamp); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, reply.acceptedRevision); assert.deepEqual(item.database.records(), committed);
      const history = await item.store.history(state.revision, 1); assert.deepEqual(history.entries[0]?.state, expected.state);
      context.diagnostic(JSON.stringify({ basis: 'Explicit synthetic scarcity checkpoint after actual legal Foundry completion; no full-history replay claim', missing, result }));
    } finally { item.close(); }
  });
});
