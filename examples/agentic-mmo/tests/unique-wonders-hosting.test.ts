import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, applyRelease, catchUpStrategy, legalActions } from '../core/engine.ts';
import type { CompletedWonderRecord, GameAction, WorldState } from '../core/types.ts';
import { isGameEvent, isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';
import { greatLibraryPrefix } from './fixtures/great-library-prefix.ts';
import { uniqueWonderCompletionJourney, uniqueWonderBoostJourney } from './unique-wonders.test.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const actor = 'synthetic-wonder-owner';
const model = 'synthetic-wonder-host-fixture';

class Statement implements D1Statement {
  private readonly database: WonderDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: WonderDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class WonderDatabase implements D1Database {
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
  private readonly directory = mkdtempSync(join(tmpdir(), 'wonder-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new WonderDatabase(this.path);
  constructor() { this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8')); }
  get store() { return new WorldRepository(this.database); }
  async state() { const result = await this.store.read(); assert.ok(result); return result.state; }
  async initialize() { await this.store.initialize({ seed: 1701, clockEpoch: coastalPrefixTime(0), commandId: 'initialize' }, actor, coastalPrefixTime(0)); }
  async input(commandId: string, action: GameAction, seat = 0) { return { seat, expectedRevision: (await this.state()).revision, model, commandId, action: { type: 'strategy-action', action } }; }
  send(input: Record<string, unknown>, seconds: number) { return this.store.mutate('action', input, actor, coastalPrefixTime(seconds)); }
  async beat() { const state = await this.state(); const seconds = ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60; return this.store.mutate('strategy-catchup', { expectedRevision: state.revision, commandId: `beat-${state.revision}`, timestamp: coastalPrefixTime(seconds), model }, actor, coastalPrefixTime(seconds)); }
  reopen() { this.database.sql.close(); this.database = new WonderDatabase(this.path); }
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
    await sendStep(item, step, `wonder-step-${index}`); assert.deepEqual(await item.state(), step.result.state); assert.ok(isWorldState(await item.state()));
  }
}

await test('unique wonder predecessor keeps all117 real legal frames through SQLite reopen and exact replay', async () => {
  const prefix = greatLibraryPrefix(); const item = new Fixture();
  try {
    assert.equal(prefix.state.revision, 117); assert.equal(prefix.steps.length, 117);
    await persist(item, prefix.steps); const records = item.database.records(); item.reopen();
    assert.deepEqual(await item.state(), prefix.state); assert.deepEqual(item.database.records(), records); assert.equal(await replay(item), 117);
    assert.ok(prefix.contenders.every(contender => (prefix.state.civilizations.find(civilization => civilization.id === contender.seat)?.era ?? 0) >= 1));
    assert.equal(Object.hasOwn(prefix.state, 'wonders'), false);
    assert.ok(legalActions(prefix.state, 0, prefix.timestamp).every(option => option.action.type !== 'build-wonder'));
    const request = { seat: 0, expectedRevision: prefix.state.revision, commandId: 'wonder-before-release', model, action: { type: 'strategy-action', action: { type: 'build-wonder', wonderId: 'great-library', cityId: 'city-0', tileId: 74 } } };
    await assert.rejects(item.store.mutate('action', request, actor, prefix.timestamp)); assert.deepEqual(item.database.records(), records);
  } finally { item.close(); }
});

function completedRecord(state: WorldState): CompletedWonderRecord {
  const value = state.wonders?.['great-library']; assert.ok(value); return value;
}
function firstLoss(state: WorldState) { const value = completedRecord(state).losses[0]; assert.ok(value); return value; }
function completionStory() {
  const route = uniqueWonderCompletionJourney(); route.journey.beat();
  const steps = [...route.journey.previous.steps, ...route.journey.steps];
  const start = steps.find(step => step.input.kind === 'action' && step.input.command.action.type === 'build-wonder');
  const resolution = steps.find(step => !step.before.wonders?.['great-library'] && step.result.state.wonders?.['great-library']);
  assert.ok(start?.input.kind === 'action' && start.input.command.action.type === 'build-wonder' && start.input.command.timestamp);
  assert.ok(resolution?.input.kind === 'strategy');
  return { ...route, start, resolution, operated: structuredClone(route.journey.state), steps };
}
let cachedCompletion: ReturnType<typeof completionStory> | undefined;
function story() { cachedCompletion ??= completionStory(); return cachedCompletion; }

await test('unique wonder actual contention winner and losing refund survive one-payment SQLite duplicates reopen and full replay', async context => {
  const route = story(); const item = new Fixture();
  try {
    await item.initialize();
    for (const [index, step] of route.steps.entries()) {
      const key = `wonder-step-${index}`;
      if (step === route.start || step === route.resolution) {
        const replies = await Promise.all([sendStep(item, step, key), sendStep(item, step, key)]);
        assert.equal(replies.filter(reply => reply.duplicate).length, 1);
        assert.ok(replies.every(reply => reply.acceptedRevision === step.result.state.revision));
      } else await sendStep(item, step, key);
      assert.deepEqual(await item.state(), step.result.state);
      if (step.input.kind === 'action' && step.input.command.action.type === 'build-wonder') {
        const action = step.input.command.action; const seat = step.input.command.seat; const before = step.before.civilizations[seat]; const after = step.result.state.civilizations[seat]; assert.ok(before && after);
        assert.equal(before.resources.materials - after.resources.materials, 50); assert.equal(before.resources.credits - after.resources.credits, 25);
        const order = step.result.state.cities.find(city => city.id === action.cityId)?.construction?.active;
        assert.ok(order && 'kind' in order && order.kind === 'wonder'); assert.equal(order.tileId, action.tileId); assert.deepEqual(order.paid, { materials: 50, credits: 25 });
      }
    }
    const completed = completedRecord(route.completed); assert.equal(completed.losses.length, 1); assert.equal(completed.boostLimit, 2); assert.deepEqual(completed.boosts, []);
    const loss = completed.losses[0]; assert.ok(loss); assert.deepEqual(loss.refund, { materials: 25 }); assert.deepEqual(loss.paid, { materials: 50, credits: 25 });
    assert.equal(loss.winnerOrderId, completed.completion.orderId); assert.notEqual(loss.tileId, completed.completion.tileId);
    for (const contender of route.journey.previous.contenders) assert.equal(route.completed.cities.find(city => city.id === contender.cityId)?.construction?.active, null);
    const state = await item.state(); assert.deepEqual(completedRecord(state), completed); const records = item.database.records(); item.reopen();
    assert.deepEqual(await item.state(), state); assert.deepEqual(item.database.records(), records);
    for (const step of [route.start, route.resolution]) {
      const index = route.steps.indexOf(step); const reply = await sendStep(item, step, `wonder-step-${index}`);
      assert.equal(reply.duplicate, true); assert.equal(reply.acceptedRevision, step.result.state.revision); assert.deepEqual(item.database.records(), records);
    }
    const start = route.start; assert.ok(start.input.kind === 'action' && start.input.command.action.type === 'build-wonder');
    const changed = { ...stepArguments(start, `wonder-step-${route.steps.indexOf(start)}`), action: { type: 'strategy-action', action: { ...start.input.command.action, tileId: 9999 } } };
    await assert.rejects(item.store.mutate('action', changed, actor, route.journey.time()), { message: 'idempotency_key_reused' }); assert.deepEqual(item.database.records(), records);
    context.diagnostic(JSON.stringify({ basis: 'entirely legal117-frame predecessor and real SQLite repository', revision: state.revision, round: state.round, completion: completed.completion, loss, replayFrames: await replay(item) }));
  } finally { item.close(); }
});

for (const table of ['world_transitions', 'world_receipts']) await test(`unique wonder ${table} fault rolls back winner losing refund and due economy before exact reopened retry`, async () => {
  const route = story(); const step = route.resolution; assert.ok(step.input.kind === 'strategy'); const item = new Fixture();
  try {
    await persist(item, route.steps, step.before.revision); const before = item.database.records();
    item.database.sql.exec(`CREATE TRIGGER fail_wonder BEFORE INSERT ON ${table} WHEN NEW.receipt_key = 'strategy-catchup:wonder-resolution-fault' BEGIN SELECT RAISE(ABORT, 'synthetic wonder rollback'); END;`);
    await assert.rejects(sendStep(item, step, 'wonder-resolution-fault'), /synthetic wonder rollback/); assert.deepEqual(item.database.records(), before);
    item.reopen(); assert.deepEqual(item.database.records(), before); assert.equal((await item.state()).wonders?.['great-library'], undefined);
    item.database.sql.exec('DROP TRIGGER fail_wonder'); const accepted = await sendStep(item, step, 'wonder-resolution-fault');
    assert.deepEqual(await item.state(), step.result.state); const records = item.database.records(); item.reopen();
    const duplicate = await sendStep(item, step, 'wonder-resolution-fault'); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, accepted.acceptedRevision); assert.deepEqual(item.database.records(), records);
    assert.deepEqual(completedRecord(await item.state()).losses.map(loss => loss.refund), [{ materials: 25 }]); await replay(item);
  } finally { item.close(); }
});

await test('unique wonder refused exact actions roll back candidate completion refunds and invalid site work', async () => {
  const route = story(); const start = route.start; assert.ok(start.input.kind === 'action' && start.input.command.action.type === 'build-wonder'); const item = new Fixture();
  try {
    await persist(item, route.steps, start.before.revision); const before = item.database.records(); const action = start.input.command.action;
    const city = start.before.cities.find(value => value.id === action.cityId); const foreign = start.before.cities.find(value => value.civId !== 0); assert.ok(city && foreign);
    for (const [index, invalid] of [
      { ...action, tileId: city.tileId }, { ...action, tileId: 39 }, { ...action, tileId: 9999 }, { ...action, cityId: foreign.id, tileId: foreign.tileId },
    ].entries()) {
      const request = await item.input(`wonder-invalid-site-${index}`, invalid);
      await assert.rejects(item.store.mutate('action', request, actor, start.input.command.timestamp ?? route.journey.time())); assert.deepEqual(item.database.records(), before);
    }
    for (const [index, step] of route.steps.entries()) if (step.before.revision >= start.before.revision && step.result.state.revision <= route.resolution.before.revision) await sendStep(item, step, `wonder-step-${index}`);
    const contested = item.database.records(); assert.ok(route.resolution.input.kind === 'strategy');
    const refused = await item.input('wonder-refuse-after-candidate-resolution', { type: 'apply-research-boost', wonderId: 'great-library', technology: 'spaceflight' });
    await assert.rejects(item.store.mutate('action', refused, actor, route.resolution.input.timestamp)); assert.deepEqual(item.database.records(), contested);
    assert.equal((await item.state()).wonders?.['great-library'], undefined);
    await sendStep(item, route.resolution, 'wonder-actual-resolution'); const completed = item.database.records();
    const late = await item.input('wonder-late-start', action); await assert.rejects(item.store.mutate('action', late, actor, route.journey.time())); assert.deepEqual(item.database.records(), completed);
  } finally { item.close(); }
});

await test('unique wonder strict CAS leaves no losing completion refund or receipt', async () => {
  const route = story(); const step = route.resolution; const item = new Fixture();
  try {
    await persist(item, route.steps, step.before.revision); const before = item.database.records();
    const at = coastalPrefixTime((step.before.independentTurns?.strategyTicks ?? 0) * 60 + 50);
    const option = legalActions(step.before, 2, at).find(choice => choice.action.type === 'focus'); assert.ok(option);
    const competing = applyCommand(step.before, { seat: 2, expectedRevision: step.before.revision, timestamp: at, action: option.action }); assert.ok(competing.ok, competing.error); assert.ok(isWorldState(competing.state));
    item.database.beforeBatch = () => { item.database.sql.prepare('UPDATE world_state SET revision=?, state_json=? WHERE world_id=?').run(competing.state.revision, JSON.stringify(competing.state), 'main'); };
    await assert.rejects(sendStep(item, step, 'wonder-cas-resolution'), { message: 'stale_revision' });
    assert.deepEqual(await item.state(), competing.state); assert.deepEqual(item.database.records().history, before.history); assert.deepEqual(item.database.records().receipts, before.receipts);
    item.reopen(); assert.deepEqual(await item.state(), competing.state); assert.equal((await item.state()).wonders?.['great-library'], undefined);
  } finally { item.close(); }
});

await test('unique wonder canonical frames accept exact active and completed aliases and require the released registry', () => {
  const route = story();
  assert.ok(isWorldState(route.contested), 'real paid contenders must be canonical');
  assert.ok(isWorldState(route.completed), 'real winner and loss receipts must be canonical');
  for (const step of route.steps) assert.ok(isWorldState(JSON.parse(JSON.stringify(step.result.state))), `canonical revision ${step.result.state.revision}`);
  const missing = structuredClone(route.start.before); Reflect.deleteProperty(missing, 'wonders'); assert.equal(isWorldState(missing), false);
  const earlier = greatLibraryPrefix().state; earlier.wonders = {}; assert.equal(isWorldState(earlier), false);
});

await test('unique wonder strict historical identities reject malformed registry aliases refunds and retained event joins', () => {
  const route = story(); const old = structuredClone(route.completed); old.events = [];
  const award = completedRecord(old); const town = old.cities.find(city => city.id === award.completion.cityId); assert.ok(town?.construction);
  award.completion.paid = { energy: 0.25 }; award.completion.workRequired = 999; town.construction.lastCompleted = structuredClone(award.completion);
  const loss = award.losses[0]; assert.ok(loss); loss.paid = { materials: 19, energy: 0.5 }; loss.refund = { materials: 9.5 }; loss.workRequired = 999;
  assert.ok(isWorldState(old), 'trimmed historical paid/work snapshots are independent of current costs');
  for (const corrupt of [
    (state: WorldState) => { completedRecord(state).completion.cityId = 'missing'; },
    (state: WorldState) => { completedRecord(state).completion.tileId = state.cities[0]?.tileId ?? 0; },
    (state: WorldState) => { completedRecord(state).completion.eventId = `${state.revision + 1}:0`; },
    (state: WorldState) => { firstLoss(state).refund.materials = 26; },
    (state: WorldState) => { firstLoss(state).refund.credits = 1; },
    (state: WorldState) => { firstLoss(state).winnerOrderId = 'construction-1'; },
    (state: WorldState) => { firstLoss(state).orderId = completedRecord(state).completion.orderId; },
    (state: WorldState) => { completedRecord(state).losses.push(structuredClone(firstLoss(state))); },
    (state: WorldState) => { Reflect.set(completedRecord(state), 'boostLimit', 3); },
    (state: WorldState) => { const event = state.events.find(value => value.wonderCompletion); assert.ok(event?.wonderCompletion); event.wonderCompletion.tileId++; },
    (state: WorldState) => { const event = state.events.find(value => value.wonderLoss); assert.ok(event?.wonderLoss); event.wonderLoss.refund.materials = 26; },
  ]) { const invalid = structuredClone(route.completed); corrupt(invalid); assert.equal(isWorldState(invalid), false); }
});

function boostStory() {
  const route = uniqueWonderBoostJourney();
  const immediate = route.journey.steps.find(step => step.result.state.revision === route.boosted.revision);
  assert.ok(immediate?.input.kind === 'action' && immediate.input.command.action.type === 'apply-research-boost');
  route.journey.beat();
  return { ...route, immediate, steps: [...route.journey.previous.steps, ...route.journey.steps] };
}
let cachedBoost: ReturnType<typeof boostStory> | undefined;
function boostedStory() { cachedBoost ??= boostStory(); return cachedBoost; }

await test('unique wonder two legal explicit boosts preserve capped immediate completion stock and original receipts through SQLite replay', async context => {
  const route = boostedStory(); const item = new Fixture();
  try {
    await item.initialize();
    for (const [index, step] of route.steps.entries()) {
      if (step.input.kind === 'action' && step.input.command.action.type === 'apply-research-boost') {
        const replies = await Promise.all([sendStep(item, step, `wonder-step-${index}`), sendStep(item, step, `wonder-step-${index}`)]);
        assert.equal(replies.filter(reply => reply.duplicate).length, 1); assert.ok(replies.every(reply => reply.acceptedRevision === step.result.state.revision));
        assert.equal(step.result.state.civilizations[step.input.command.seat]?.resources.science, step.before.civilizations[step.input.command.seat]?.resources.science);
      } else await sendStep(item, step, `wonder-step-${index}`);
      assert.deepEqual(await item.state(), step.result.state); assert.ok(isWorldState(step.result.state));
    }
    const award = completedRecord(route.boosted); const [partial, capped] = award.boosts; assert.ok(partial && capped);
    assert.equal(partial.technologyId, 'currency'); assert.equal(partial.amount, 25.2); assert.equal(partial.researchCompletionEventId, null);
    assert.equal(capped.technologyId, 'mathematics'); assert.equal(capped.progressAfter, capped.costBasis); assert.ok(capped.unusedAmount > 0 && capped.amount > 0);
    const civilization = route.boosted.civilizations.find(civ => civ.id === capped.civId); assert.ok(civilization);
    assert.equal(civilization.researchTarget, ''); assert.equal(civilization.researchProgress, 0); assert.equal(civilization.lastResearchCompletion?.eventId, capped.researchCompletionEventId);
    assert.equal(route.immediate.result.events.filter(event => event.type === 'research-completed').length, 1);
    assert.equal(route.journey.steps.at(-1)?.result.events.filter(event => event.type === 'research-completed' && event.actor === capped.civId).length, 0);
    const final = await item.state(); const records = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), final);
    const duplicate = await sendStep(item, route.immediate, `wonder-step-${route.steps.indexOf(route.immediate)}`);
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, route.boosted.revision); assert.deepEqual(item.database.records(), records);
    context.diagnostic(JSON.stringify({ basis: 'legal117-frame predecessor plus actual contest and distinct model-action-shaped boost steps; local SQLite', revision: final.revision, round: final.round, boosts: award.boosts, replayFrames: await replay(item) }));
  } finally { item.close(); }
});

for (const table of ['world_transitions', 'world_receipts']) await test(`unique wonder ${table} fault rolls back immediate boost charge progress and completion before reopened exact retry`, async () => {
  const route = boostedStory(); const step = route.immediate; const item = new Fixture();
  try {
    await persist(item, route.steps, route.beforeCapped.revision); const before = item.database.records();
    item.database.sql.exec(`CREATE TRIGGER fail_boost BEFORE INSERT ON ${table} WHEN NEW.receipt_key = 'action:wonder-boost-fault' BEGIN SELECT RAISE(ABORT, 'synthetic boost rollback'); END;`);
    await assert.rejects(sendStep(item, step, 'wonder-boost-fault'), /synthetic boost rollback/); assert.deepEqual(item.database.records(), before);
    item.reopen(); assert.deepEqual(item.database.records(), before); assert.equal(completedRecord(await item.state()).boosts.length, 1);
    item.database.sql.exec('DROP TRIGGER fail_boost'); const accepted = await sendStep(item, step, 'wonder-boost-fault'); assert.deepEqual(await item.state(), route.boosted);
    const records = item.database.records(); item.reopen(); const duplicate = await sendStep(item, step, 'wonder-boost-fault');
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, accepted.acceptedRevision); assert.deepEqual(item.database.records(), records); await replay(item);
  } finally { item.close(); }
});

await test('unique wonder invalid owner target repeated charge and malformed boost history cannot mutate durable state', async () => {
  const route = boostedStory(); const item = new Fixture();
  try {
    await persist(item, route.steps, route.beforeCapped.revision); const before = item.database.records(); const seat = completedRecord(route.beforeCapped).completion.civId;
    for (const [index, candidate] of [
      { seat, technology: 'currency', wonderId: 'great-library' },
      { seat, technology: 'spaceflight', wonderId: 'great-library' },
      { seat, technology: 'mathematics', wonderId: 'missing' },
      { seat: (seat + 1) % 5, technology: 'mathematics', wonderId: 'great-library' },
    ].entries()) {
      const input = await item.input(`wonder-boost-refused-${index}`, { type: 'apply-research-boost', technology: candidate.technology, wonderId: candidate.wonderId }, candidate.seat);
      assert.ok(route.immediate.input.kind === 'action' && route.immediate.input.command.timestamp);
      await assert.rejects(item.store.mutate('action', input, actor, route.immediate.input.command.timestamp)); assert.deepEqual(item.database.records(), before);
    }
    await sendStep(item, route.immediate, 'wonder-boost-final'); const exhausted = item.database.records();
    const third = await item.input('wonder-boost-third', { type: 'apply-research-boost', technology: 'mathematics', wonderId: 'great-library' }, seat);
    await assert.rejects(item.store.mutate('action', third, actor, route.journey.time())); assert.deepEqual(item.database.records(), exhausted);
    const historical = structuredClone(route.boosted); historical.events = [];
    const partial = completedRecord(historical).boosts[0]; assert.ok(partial);
    Object.assign(partial, { costBasis: 200, nominalAmount: 40, amount: 40, progressAfter: 40 }); assert.ok(isWorldState(historical));
    for (const corrupt of [
      (fact: CompletedWonderRecord) => { const boost = fact.boosts[1]; assert.ok(boost); boost.amount++; },
      (fact: CompletedWonderRecord) => { const boost = fact.boosts[1]; assert.ok(boost); boost.researchCompletionEventId = null; },
      (fact: CompletedWonderRecord) => { const boost = fact.boosts[0]; assert.ok(boost); boost.wonderCompletionEventId = '1:0'; },
      (fact: CompletedWonderRecord) => { const boost = fact.boosts[0]; assert.ok(boost); boost.civId = (boost.civId + 1) % 5; },
      (fact: CompletedWonderRecord) => { const boost = fact.boosts[0]; assert.ok(boost); fact.boosts.push(structuredClone(boost)); },
      (fact: CompletedWonderRecord) => { const boost = fact.boosts[1]; assert.ok(boost); boost.technologyId = 'currency'; },
    ]) {
      const invalid = structuredClone(route.boosted); corrupt(completedRecord(invalid)); assert.equal(isWorldState(invalid), false);
      item.database.sql.prepare('UPDATE world_state SET state_json=? WHERE world_id=?').run(JSON.stringify(invalid), 'main');
      await assert.rejects(item.store.read(), { message: 'corrupt_or_incompatible_world' });
    }
  } finally { item.close(); }
});

await test('unique wonder historical geometry and overwritten town slot retain one registry identity while active occupancy stays exclusive', () => {
  const route = story();
  const historical = structuredClone(route.completed); historical.events = [];
  const won = completedRecord(historical).completion; const site = historical.tiles.find(tile => tile.id === won.tileId); assert.ok(site);
  site.terrain = 'ocean'; site.owner = null; assert.ok(isWorldState(historical));
  const town = historical.cities.find(city => city.id === won.cityId); assert.ok(town?.construction); town.construction.lastCompleted = null;
  assert.ok(isWorldState(historical), 'the permanent completion is independent of the latest town slot');
  const lostSite = historical.tiles.find(tile => tile.id === firstLoss(historical).tileId); assert.ok(lostSite); lostSite.terrain = 'mountain'; lostSite.owner = null;
  assert.ok(isWorldState(historical));
  for (const corrupt of [
    (state: WorldState) => { const active = state.cities.find(city => city.civId === 0)?.construction?.active; assert.ok(active); active.tileId = 39; },
    (state: WorldState) => { const active = state.cities.find(city => city.civId === 0)?.construction?.active; assert.ok(active); active.tileId = 9999; },
    (state: WorldState) => { const first = state.cities.find(city => city.civId === 0)?.construction?.active; const second = state.cities.find(city => city.civId === 1)?.construction?.active; assert.ok(first && second && first.tileId !== undefined); second.tileId = first.tileId; },
    (state: WorldState) => { const first = state.cities.find(city => city.civId === 0)?.construction?.active; assert.ok(first); const other = state.cities.find(city => city.civId === 0 && city.id !== first.cityId); assert.ok(other); other.construction = { active: { ...first, id: 'construction-119', cityId: other.id, tileId: other.tileId }, lastCompleted: null }; },
  ]) { const invalid = structuredClone(route.contested); corrupt(invalid); assert.equal(isWorldState(invalid), false); }
  for (const field of ['wonderCompletion', 'wonderLoss'] as const) {
    const event = route.completed.events.find(value => value[field]); assert.ok(event); assert.ok(isGameEvent(event));
    const absent = structuredClone(event); Reflect.deleteProperty(absent, field); assert.equal(isGameEvent(absent), false);
    const malformed = structuredClone(event); const fact = malformed[field]; assert.ok(fact); Reflect.set(fact, 'unknown', true); assert.equal(isGameEvent(malformed), false);
    const wrong = structuredClone(event); wrong.type = 'unrelated-event'; assert.equal(isGameEvent(wrong), false);
  }
});

await test('unique wonder boost snapshots enforce each arithmetic identity and retained event linkage without current-price reinterpretation', () => {
  const route = boostedStory(); const valid = route.boosted; assert.ok(isWorldState(valid));
  const mutations: Array<(state: WorldState) => void> = [
    state => { const boost = completedRecord(state).boosts[0]; assert.ok(boost); boost.nominalAmount++; },
    state => { const boost = completedRecord(state).boosts[0]; assert.ok(boost); boost.progressAfter++; },
    state => { const boost = completedRecord(state).boosts[0]; assert.ok(boost); boost.unusedAmount++; },
    state => { const boost = completedRecord(state).boosts[0]; assert.ok(boost); boost.progressBefore = -1; },
    state => { const boost = completedRecord(state).boosts[0]; assert.ok(boost); boost.basisReleaseId = 'settlement-manufacturing-1'; },
    state => { const boost = completedRecord(state).boosts[0]; assert.ok(boost); boost.eventId = '999999:0'; },
    state => { const boost = completedRecord(state).boosts[1]; assert.ok(boost); boost.researchCompletionEventId = boost.eventId; },
    state => { const boost = completedRecord(state).boosts[1]; assert.ok(boost); const event = state.events.find(value => value.id === boost.researchCompletionEventId); assert.ok(event); event.type = 'unrelated-event'; },
    state => { const boost = completedRecord(state).boosts[1]; assert.ok(boost); const event = state.events.find(value => value.id === boost.eventId); assert.ok(event); event.tileId = 9999; },
    state => { const boost = completedRecord(state).boosts[1]; assert.ok(boost); const latest = state.civilizations[boost.civId]?.lastResearchCompletion; assert.ok(latest); latest.technologyId = 'currency'; },
  ];
  for (const mutate of mutations) { const invalid = structuredClone(valid); mutate(invalid); assert.equal(isWorldState(invalid), false); }
  const event = valid.events.find(value => value.researchBoost); assert.ok(event); assert.ok(isGameEvent(event));
  const missing = structuredClone(event); Reflect.deleteProperty(missing, 'researchBoost'); assert.equal(isGameEvent(missing), false);
  const noFeed = structuredClone(valid); noFeed.events = []; assert.ok(isWorldState(noFeed));
});
