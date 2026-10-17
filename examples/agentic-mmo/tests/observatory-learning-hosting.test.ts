import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, applyRelease, catchUpStrategy } from '../core/engine.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';
import { observatoryPrefix } from './fixtures/observatory-prefix.ts';
import { observatoryLearningOperationJourney } from './fixtures/observatory-learning-journey.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const actor = 'synthetic-observatory-owner';
const model = 'synthetic-observatory-host-fixture';

class Statement implements D1Statement {
  private readonly database: ObservatoryDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: ObservatoryDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class ObservatoryDatabase implements D1Database {
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
  private readonly directory = mkdtempSync(join(tmpdir(), 'observatory-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new ObservatoryDatabase(this.path);
  constructor() { this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8')); }
  get store() { return new WorldRepository(this.database); }
  async state() { const result = await this.store.read(); assert.ok(result); return result.state; }
  async initialize() { await this.store.initialize({ seed: 1701, clockEpoch: coastalPrefixTime(0), commandId: 'initialize' }, actor, coastalPrefixTime(0)); }
  async input(commandId: string, action: GameAction) { return { seat: 0, expectedRevision: (await this.state()).revision, model, commandId, action: { type: 'strategy-action', action } }; }
  send(input: Record<string, unknown>, seconds: number) { return this.store.mutate('action', input, actor, coastalPrefixTime(seconds)); }
  async beat() { const state = await this.state(); const seconds = ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60; return this.store.mutate('strategy-catchup', { expectedRevision: state.revision, commandId: `beat-${state.revision}`, timestamp: coastalPrefixTime(seconds), model }, actor, coastalPrefixTime(seconds)); }
  reopen() { this.database.sql.close(); this.database = new ObservatoryDatabase(this.path); }
  close() { this.database.sql.close(); rmSync(this.directory, { recursive: true, force: true }); }
}
async function replay(item: Fixture) {
  const saved = await item.store.read(); assert.ok(saved); let state = saved.initial; let after = 0; let count = 0;
  for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
    const page = await item.store.history(after, 25);
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

function stepArguments(step: CoastalPrefixStep, commandId: string): Record<string, unknown> {
  const input = step.input;
  if (input.kind === 'strategy') return { expectedRevision: step.before.revision, timestamp: input.timestamp, model, commandId };
  if (input.kind === 'release') return { ...input.command, model, commandId };
  return { seat: input.command.seat, expectedRevision: input.command.expectedRevision, action: { type: 'strategy-action', action: input.command.action }, ...(input.command.plan === undefined ? {} : { plan: input.command.plan }), model, commandId };
}
function sendStep(item: Fixture, step: CoastalPrefixStep, commandId: string) {
  const input = step.input; const timestamp = input.kind === 'strategy' ? input.timestamp : input.command.timestamp; assert.ok(timestamp);
  return item.store.mutate(input.kind === 'strategy' ? 'strategy-catchup' : input.kind === 'release' ? 'release-apply' : 'action', stepArguments(step, commandId), actor, timestamp);
}
async function persist(item: Fixture, steps: CoastalPrefixStep[], through = Number.MAX_SAFE_INTEGER): Promise<void> {
  await item.initialize();
  for (const [index, step] of steps.entries()) {
    if (step.result.state.revision > through) break;
    await sendStep(item, step, `observatory-step-${index}`); assert.deepEqual(await item.state(), step.result.state); assert.ok(isWorldState(await item.state()));
  }
}

let cachedPrefix: ReturnType<typeof observatoryPrefix> | undefined;
function prefix() { cachedPrefix ??= observatoryPrefix(); return cachedPrefix; }

await test('observatory real686-frame predecessor preserves Campus and paid recipes through SQLite reopen replay', async context => {
  const previous = prefix(); const item = new Fixture();
  try {
    assert.equal(previous.steps.length, 686); assert.equal(previous.state.revision, 686);
    assert.equal(previous.campusTileId, 39); assert.deepEqual(previous.highGroundTileIds, [22, 56]);
    assert.ok(previous.state.cities.every(city => !Object.hasOwn(city, 'buildingHighGround')));
    await persist(item, previous.steps); const before = item.database.records(); item.reopen();
    assert.deepEqual(await item.state(), previous.state); assert.deepEqual(item.database.records(), before);
    for (const action of [{ type: 'research', technology: 'sailing' }, { type: 'build', project: 'observatory', cityId: previous.cityId }]) {
      await assert.rejects(item.store.mutate('action', { seat: previous.seat, expectedRevision: previous.state.revision, commandId: `unreleased-${JSON.stringify(action)}`, model, action: { type: 'strategy-action', action } }, actor, previous.timestamp));
      assert.deepEqual(item.database.records(), before);
    }
    assert.equal(await replay(item), 686);
    context.diagnostic(JSON.stringify({ basis: 'Unedited legal predecessor', revision: previous.state.revision, round: previous.state.round, campusTileId: previous.campusTileId, highGroundTileIds: previous.highGroundTileIds }));
  } finally { item.close(); }
});

await test('observatory prospective canonical guard rejects source mapping before its release', () => {
  const state = structuredClone(prefix().state); const city = state.cities.find(value => value.id === prefix().cityId); assert.ok(city);
  Reflect.set(city, 'buildingHighGround', { observatory: { campusTileId: 39, sourceTileId: 22 } });
  assert.equal(isWorldState(state), false, 'Unreleased uninstalled high-ground provenance must not be silently accepted');
});

let cachedStory: ReturnType<typeof observatoryLearningOperationJourney> | undefined;
function story() { cachedStory ??= observatoryLearningOperationJourney(); return cachedStory; }
function town(state: WorldState) { const city = state.cities.find(value => value.id === 'city-0'); assert.ok(city); return city; }
function order(state: WorldState) { const city = town(state); const value = city.construction?.active ?? city.construction?.lastCompleted; assert.ok(value && !('kind' in value)); return value; }
function startStep() { const value = story(); const step = value.journey.steps.find(candidate => candidate.result.state.revision === value.started.revision); assert.ok(step?.input.kind === 'action' && step.input.command.timestamp); return { value, step }; }

await test('observatory exact paid source and later staffed output persist once through full SQLite replay and public detail', async context => {
  const value = story(); const item = new Fixture(); const selected = new Set([value.journey.adopted.revision, value.started.revision, value.completed.revision, value.operated.revision]);
  for (const key of ['tiles', 'cities', 'civilizations', 'wonders', 'tileAcquisitions', 'strategicDeposits', 'pastoralSites', 'routes', 'rng', 'clockTicks'] as const) assert.deepEqual(value.journey.adopted[key], value.journey.beforeRelease[key]);
  try {
    await item.initialize();
    for (const [index, step] of value.journey.steps.entries()) {
      const commandId = `observatory-step-${index}`;
      if (selected.has(step.result.state.revision)) {
        const replies = await Promise.all([sendStep(item, step, commandId), sendStep(item, step, commandId)]);
        assert.equal(replies.filter(reply => reply.duplicate).length, 1); assert.ok(replies.every(reply => reply.acceptedRevision === step.result.state.revision));
      } else await sendStep(item, step, commandId);
      assert.deepEqual(await item.state(), step.result.state);
    }
    const started = order(value.started); assert.equal(started.buildingId, 'observatory');
    assert.deepEqual(started.highGround, { campusTileId: 39, sourceTileId: 22 }); assert.deepEqual(started.paid, { materials: 30, credits: 16 }); assert.equal(started.workRequired, 14);
    assert.equal(Object.hasOwn(started, 'tileId'), false); assert.equal(Object.hasOwn(started, 'catchmentTileId'), false);
    assert.deepEqual(town(value.completed).buildingHighGround, { observatory: started.highGround });
    assert.deepEqual(order(value.completed).highGround, started.highGround); assert.equal(town(value.completed).buildingOperations?.observatory?.lastResult, null);
    const operated = town(value.operated).buildingOperations?.observatory?.lastResult; assert.ok(operated);
    assert.equal(operated.status, 'operated'); assert.deepEqual(operated.paid, { credits: 2 }); assert.equal(operated.residents?.allocated, 3); assert.ok((operated.produced.science ?? 0) > 0);
    assert.equal(operated.round, value.completed.round + 1); assert.equal(Object.hasOwn(operated, 'strategicPaid'), false);
    const committed = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), value.operated); assert.deepEqual(item.database.records(), committed);
    for (const revision of selected) {
      const index = value.journey.steps.findIndex(step => step.result.state.revision === revision); const step = value.journey.steps[index]; assert.ok(step);
      const duplicate = await sendStep(item, step, `observatory-step-${index}`); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, revision); assert.deepEqual(item.database.records(), committed);
    }
    for (const revision of [value.started.revision, value.completed.revision, value.operated.revision]) {
      const step = value.journey.steps.find(candidate => candidate.result.state.revision === revision); assert.ok(step);
      const page = await item.store.boundedChronicle({ format: 'recorded-choices-v1', after: step.before.revision, through: revision, limit: 1 }); assert.deepEqual(page.entries[0]?.events, step.result.events);
      const detail = await item.store.recordedChoiceDetail({ endRevision: revision, civilizationId: 0, cityId: value.journey.cityId });
      assert.equal(detail.consequences.status, 'available'); assert.equal(detail.consequences.town.status, 'available');
      if (revision === value.started.revision) assert.deepEqual(detail.consequences.town.construction.started, started);
      if (revision === value.completed.revision) assert.deepEqual(detail.consequences.town.construction.completed, order(value.completed));
      for (const secret of [actor, 'actorUserId', 'request_json', 'receipt_key', '"tiles":', '"civilizations":']) assert.equal(JSON.stringify(detail).includes(secret), false);
      assert.equal(detail.recordedReason, null);
    }
    assert.deepEqual(item.database.records(), committed); assert.equal(await replay(item), value.journey.steps.length);
    context.diagnostic(JSON.stringify({ basis: 'Real legal686-frame predecessor plus exact paid Observatory journey', revision: value.operated.revision, round: value.operated.round, started, completed: order(value.completed), operated }));
  } finally { item.close(); }
});

for (const milestone of ['start', 'completion'] as const) for (const table of ['world_transitions', 'world_receipts']) await test(`observatory ${milestone} ${table} fault rolls back then exact reopened retry commits once`, async () => {
  const value = story(); const step = milestone === 'start' ? startStep().step : value.completionStep; const item = new Fixture();
  try {
    await persist(item, value.journey.steps, step.before.revision); const before = item.database.records(); const operation = step.input.kind === 'action' ? 'action' : 'strategy-catchup';
    item.database.sql.exec(`CREATE TRIGGER fail_observatory BEFORE INSERT ON ${table} WHEN NEW.receipt_key = '${operation}:observatory-fault' BEGIN SELECT RAISE(ABORT, 'synthetic observatory rollback'); END;`);
    await assert.rejects(sendStep(item, step, 'observatory-fault'), /synthetic observatory rollback/); assert.deepEqual(item.database.records(), before);
    item.reopen(); assert.deepEqual(await item.state(), step.before); assert.deepEqual(item.database.records(), before); item.database.sql.exec('DROP TRIGGER fail_observatory');
    const reply = await sendStep(item, step, 'observatory-fault'); assert.equal(reply.acceptedRevision, step.result.state.revision); assert.deepEqual(await item.state(), step.result.state);
    const committed = item.database.records(); const duplicate = await sendStep(item, step, 'observatory-fault'); assert.equal(duplicate.duplicate, true); assert.deepEqual(item.database.records(), committed);
  } finally { item.close(); }
});

await test('observatory competing exact starts commit one payment with a stale CAS loser', async () => {
  const { value, step } = startStep(); const item = new Fixture();
  try {
    await persist(item, value.journey.steps, step.before.revision); const before = item.database.records();
    const replies = await Promise.allSettled([sendStep(item, step, 'observatory-race-a'), sendStep(item, step, 'observatory-race-b')]);
    assert.equal(replies.filter(reply => reply.status === 'fulfilled').length, 1); const loser = replies.find(reply => reply.status === 'rejected'); assert.ok(loser?.status === 'rejected'); assert.match(String(loser.reason), /stale_revision/);
    assert.deepEqual(await item.state(), step.result.state); const committed = item.database.records(); assert.equal(committed.history.length, before.history.length + 1); assert.equal(committed.receipts.length, before.receipts.length + 1);
    item.reopen(); assert.deepEqual(await item.state(), step.result.state);
  } finally { item.close(); }
});

await test('observatory foreign absent and forged-source actions roll back candidate upkeep and every row', async () => {
  const { value, step } = startStep(); const item = new Fixture();
  try {
    await persist(item, value.journey.steps, step.before.revision); const before = item.database.records(); const timestamp = coastalPrefixTime(((step.before.independentTurns?.strategyTicks ?? 0) + 1) * 60);
    for (const [index, action] of [
      { type: 'build', project: 'observatory', cityId: 'city-1' },
      { type: 'build', project: 'observatory', cityId: 'missing-town' },
      { type: 'build', project: 'observatory', cityId: value.journey.cityId, highGround: { campusTileId: 39, sourceTileId: 56 } },
    ].entries()) {
      await assert.rejects(item.store.mutate('action', { seat: 0, expectedRevision: step.before.revision, commandId: `observatory-refused-${index}`, model, action: { type: 'strategy-action', action } }, actor, timestamp)); assert.deepEqual(item.database.records(), before);
    }
    item.reopen(); assert.deepEqual(await item.state(), step.before);
  } finally { item.close(); }
});

await test('observatory strict historical source rejects malformed missing foreign nonadjacent and mismatched aliases', () => {
  const value = story();
  const invalid: unknown[] = [undefined, null, {}, [], { campusTileId: 39 }, { sourceTileId: 22 }, { campusTileId: 39, sourceTileId: -1 }, { campusTileId: 39, sourceTileId: 22.5 }, { campusTileId: 39, sourceTileId: 999999 }, { campusTileId: 40, sourceTileId: 22 }, { campusTileId: 39, sourceTileId: 39 }, { campusTileId: 39, sourceTileId: 5 }, { campusTileId: 39, sourceTileId: 22, terrain: 'mountain' }];
  for (const source of [value.started, value.completed]) for (const replacement of invalid) {
    const state = structuredClone(source); const target = order(state); if (replacement === undefined) Reflect.deleteProperty(target, 'highGround'); else Reflect.set(target, 'highGround', replacement);
    assert.equal(isWorldState(state), false, JSON.stringify(replacement));
  }
  for (const replacement of [undefined, null, {}, { observatory: { campusTileId: 39, sourceTileId: 56 } }, { observatory: { campusTileId: 39, sourceTileId: 22 }, library: { campusTileId: 39, sourceTileId: 22 } }]) {
    const state = structuredClone(value.completed); if (replacement === undefined) Reflect.deleteProperty(town(state), 'buildingHighGround'); else Reflect.set(town(state), 'buildingHighGround', replacement);
    assert.equal(isWorldState(state), false, JSON.stringify(replacement));
  }
  const wrongBuilding = structuredClone(value.journey.beforeRelease); const ordinary = wrongBuilding.cities.map(city => city.construction?.lastCompleted).find(entry => entry && !('kind' in entry)); assert.ok(ordinary); Reflect.set(ordinary, 'highGround', { campusTileId: 39, sourceTileId: 22 }); assert.equal(isWorldState(wrongBuilding), false);
  const ungated = structuredClone(value.started); ungated.unlockedFeatures = ungated.unlockedFeatures.filter(feature => feature !== 'observatory-learning'); assert.equal(isWorldState(ungated), false);
  for (const patch of [{ type: 'improvement-completed' }, { round: value.completed.round - 1 }, { actor: 1 }, { target: 1 }, { tileId: 39 }]) {
    const state = structuredClone(value.completed); const completion = town(state).construction?.lastCompleted; assert.ok(completion); const event = state.events.find(candidate => candidate.id === completion.eventId); assert.ok(event); Object.assign(event, patch); assert.equal(isWorldState(state), false, JSON.stringify(patch));
  }
});

await test('observatory paid provenance survives changed source terrain ownership population tuning and trimmed events', () => {
  const value = story();
  for (const source of [value.started, value.completed]) {
    const state = structuredClone(source); const city = town(state); const target = order(state); const site = state.tiles.find(tile => tile.id === target.highGround?.sourceTileId); assert.ok(site);
    site.terrain = 'ocean'; site.elevation = 0; site.owner = 4; city.population = 3; target.paid = { materials: 901, credits: 1 }; target.workRequired = 1000; state.events = [];
    assert.ok(isWorldState(state)); assert.deepEqual(target.highGround, { campusTileId: 39, sourceTileId: 22 });
  }
  const state = structuredClone(value.operated); const receipt = town(state).buildingOperations?.observatory?.lastResult; assert.ok(receipt); receipt.paid = { credits: 7 }; receipt.produced = { science: 99 }; assert.ok(isWorldState(state));
  const later = structuredClone(value.completed); const city = town(later); assert.ok(city.construction); city.construction.lastCompleted = null; later.events = []; assert.ok(isWorldState(later), 'Durable installed source survives replacement of the bounded last-completion slot');
});

await test('observatory malformed retained source is explicit SQLite current and historical corruption with zero repair writes', async () => {
  const value = story(); const item = new Fixture();
  try {
    await persist(item, value.journey.steps, value.completed.revision); const state = await item.state(); Reflect.set(town(state), 'buildingHighGround', { observatory: { campusTileId: 39, sourceTileId: 56 } }); assert.equal(isWorldState(state), false);
    item.database.sql.prepare('UPDATE world_state SET state_json=? WHERE world_id=?').run(JSON.stringify(state), 'main'); const corrupt = item.database.records(); item.reopen();
    await assert.rejects(item.store.read(), { message: 'corrupt_or_incompatible_world' }); assert.deepEqual(item.database.records(), corrupt);
    item.database.sql.prepare('UPDATE world_state SET state_json=? WHERE world_id=?').run(JSON.stringify(value.completed), 'main');
    item.database.sql.prepare('UPDATE world_transitions SET state_json=? WHERE end_revision=?').run(JSON.stringify(state), value.completed.revision); const historical = item.database.records();
    await assert.rejects(item.store.history(value.completionStep.before.revision, 1), { message: 'corrupt_or_incompatible_world' });
    await assert.rejects(item.store.recordedChoiceDetail({ endRevision: value.completed.revision, civilizationId: 0, cityId: value.journey.cityId }), { message: 'corrupt_or_incompatible_world' }); assert.deepEqual(item.database.records(), historical);
  } finally { item.close(); }
});

await test('observatory new operation requires retained residents while historical ordinary receipts remain valid', () => {
  const value = story(); const state = structuredClone(value.operated); const result = town(state).buildingOperations?.observatory?.lastResult; assert.ok(result);
  Reflect.deleteProperty(result, 'residents'); assert.equal(isWorldState(state), false);
  const legacy = structuredClone(value.journey.beforeRelease); const ordinary = town(legacy).buildingOperations?.library?.lastResult; assert.ok(ordinary);
  Reflect.deleteProperty(ordinary, 'residents'); assert.ok(isWorldState(legacy));
});
