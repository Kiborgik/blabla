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
import { cultureProductionPrefix, cultureProductionOperationJourney } from './fixtures/culture-production-journey.ts';
import { BUILDINGS } from '../core/content.ts';
import { buildingBaseProduction, districtAdjacencyFacts } from '../core/simulation/districts.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const actor = 'synthetic-culture-owner';
const model = 'synthetic-culture-host-fixture';

class Statement implements D1Statement {
  private readonly database: CultureDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: CultureDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class CultureDatabase implements D1Database {
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
  private readonly directory = mkdtempSync(join(tmpdir(), 'culture-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new CultureDatabase(this.path);
  constructor() { this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8')); }
  get store() { return new WorldRepository(this.database); }
  async state() { const result = await this.store.read(); assert.ok(result); return result.state; }
  async initialize(state: WorldState) { seedHostedWorld(this.database.sql, state); }
  async input(commandId: string, action: GameAction) { return { seat: 0, expectedRevision: (await this.state()).revision, model, commandId, action: { type: 'strategy-action', action } }; }
  send(input: Record<string, unknown>, seconds: number) { return this.store.mutate('action', input, actor, coastalPrefixTime(seconds)); }
  async beat() { const state = await this.state(); const seconds = ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60; return this.store.mutate('strategy-catchup', { expectedRevision: state.revision, commandId: `beat-${state.revision}`, timestamp: coastalPrefixTime(seconds), model }, actor, coastalPrefixTime(seconds)); }
  reopen() { this.database.sql.close(); this.database = new CultureDatabase(this.path); }
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
    await sendStep(item, step, `culture-step-${index}`); assert.deepEqual(await item.state(), step.result.state); assert.ok(isWorldState(await item.state()));
  }
}

let cachedPrefix: ReturnType<typeof cultureProductionPrefix> | undefined;
function prefix() { cachedPrefix ??= cultureProductionPrefix(); return cachedPrefix; }
let cachedStory: ReturnType<typeof cultureProductionOperationJourney> | undefined;
function story() { cachedStory ??= cultureProductionOperationJourney(); return cachedStory; }
function theaterStart() {
  const value = story(); const step = value.journey.steps.find(candidate => candidate.result.state.revision === value.theaterActive.revision);
  assert.ok(step?.input.kind === 'action' && step.input.command.action.type === 'build' && step.input.command.timestamp);
  return { value, step, action: step.input.command.action, timestamp: step.input.command.timestamp };
}

await test('culture fresh synthetic prerequisite fixture preserves exact completed wonder and refuses consumers without researched prerequisites through SQLite reopen replay', async context => {
  const previous = prefix(); const item = new Fixture();
  try {
    assert.equal(previous.initial.revision, 0); assert.equal(previous.state.revision, previous.steps.length); assert.equal(previous.state.civilizations[0]?.era, 2);
    assert.equal(previous.state.wonders?.['great-library']?.completion.tileId, previous.wonderTileId); assert.notEqual(previous.theaterTileId, previous.wonderTileId);
    await persist(item, previous.steps, Number.MAX_SAFE_INTEGER, previous.initial); const before = item.database.records(); item.reopen();
    assert.deepEqual(await item.state(), previous.state); assert.equal(await replay(item), previous.steps.length);
    for (const action of [
      { type: 'build', project: 'theater-square', cityId: previous.cityId, tileId: previous.theaterTileId },
      { type: 'build', project: 'printing-house', cityId: previous.cityId },
    ]) {
      await assert.rejects(item.store.mutate('action', { seat: previous.seat, expectedRevision: previous.state.revision, model, commandId: `unreleased-${JSON.stringify(action)}`, action: { type: 'strategy-action', action } }, actor, previous.time()));
      assert.deepEqual(item.database.records(), before);
    }
    context.diagnostic(JSON.stringify({ basis: 'Fresh synthetic prerequisites followed by actual paid unique-wonder completion', revision: previous.state.revision, round: previous.state.round, wonder: previous.wonderTileId, theaterCandidate: previous.theaterTileId, replayFrames: previous.steps.length }));
  } finally { item.close(); }
});

await test('culture prospective exact Theater and paid Printing house retain one payment site adjacency and later staffed output after reopen replay', async context => {
  const value = story(); const item = new Fixture();
  const witnesses = new Set([value.theaterActive.revision, value.theaterCompleted.revision, value.printingActive.revision, value.printingCompleted.revision]);
  try {
    await item.initialize(value.journey.initial);
    for (const [index, step] of value.journey.steps.entries()) {
      const commandId = `culture-step-${index}`;
      if (step.result.state.revision === value.theaterActive.revision || step.result.state.revision === value.printingActive.revision) {
        const beforeStock = step.before.civilizations[0]?.resources; const afterStock = step.result.state.civilizations[0]?.resources; assert.ok(beforeStock && afterStock);
        const isTheater = step.result.state.revision === value.theaterActive.revision;
        assert.equal(Number((beforeStock.materials - afterStock.materials).toFixed(2)), isTheater ? 20 : 30);
        assert.equal(Number((beforeStock.credits - afterStock.credits).toFixed(2)), isTheater ? 10 : 16);
      }
      if (step.result.state.revision === value.printingActive.revision) {
        assert.ok(step.before.civilizations[0]?.technologies.includes('printing'));
        const other = step.before.cities.find(city => city.id === value.journey.alternateCityId); assert.ok(other && other.civId === 0 && !other.buildings.includes('theater-square'));
        const before = item.database.records(); const timestamp = step.input.kind === 'strategy' ? step.input.timestamp : step.input.command.timestamp; assert.ok(timestamp);
        await assert.rejects(item.store.mutate('action', { seat: 0, expectedRevision: step.before.revision, model, commandId: 'printing-needs-own-theater', action: { type: 'strategy-action', action: { type: 'build', project: 'printing-house', cityId: other.id } } }, actor, timestamp));
        assert.deepEqual(item.database.records(), before);
      }
      if (witnesses.has(step.result.state.revision)) {
        const replies = await Promise.all([sendStep(item, step, commandId), sendStep(item, step, commandId)]);
        assert.equal(replies.filter(reply => reply.duplicate).length, 1); assert.ok(replies.every(reply => reply.acceptedRevision === step.result.state.revision));
      } else await sendStep(item, step, commandId);
      assert.deepEqual(await item.state(), step.result.state);
    }
    const active = value.theaterActive.cities.find(city => city.id === value.journey.cityId)?.construction?.active;
    assert.ok(active && !('kind' in active)); assert.equal(active.buildingId, 'theater-square'); assert.equal(active.tileId, value.journey.theaterTileId);
    assert.deepEqual(active.paid, { materials: 20, credits: 10 }); assert.equal(active.workRequired, 10);
    const printing = value.printingActive.cities.find(city => city.id === value.journey.cityId)?.construction?.active;
    assert.ok(printing && !('kind' in printing)); assert.equal(printing.buildingId, 'printing-house'); assert.deepEqual(printing.paid, { materials: 30, credits: 16 }); assert.equal(printing.workRequired, 14);
    const city = value.operated.cities.find(candidate => candidate.id === value.journey.cityId); const definition = BUILDINGS.find(building => building.id === 'theater-square'); assert.ok(city && definition);
    assert.equal(city.districtSites?.['theater-square'], value.journey.theaterTileId);
    const adjacency = districtAdjacencyFacts(value.operated, definition, value.journey.theaterTileId); assert.ok(adjacency);
    assert.deepEqual(adjacency.tileIds, [value.journey.wonderTileId]); assert.equal(adjacency.bonus, 2);
    assert.equal(buildingBaseProduction(value.operated, city, definition, value.journey.theaterTileId).culture, 4);
    assert.equal(value.printingCompleted.cities.find(candidate => candidate.id === city.id)?.buildingOperations?.['printing-house']?.lastResult, null);
    const operation = city.buildingOperations?.['printing-house']?.lastResult; assert.ok(operation);
    assert.equal(operation.status, 'operated'); assert.deepEqual(operation.paid, { materials: 1 }); assert.ok((operation.produced.culture ?? 0) > 0); assert.equal(operation.residents?.allocated, 3);
    const committed = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), value.operated);
    for (const revision of witnesses) {
      const index = value.journey.steps.findIndex(step => step.result.state.revision === revision); const step = value.journey.steps[index]; assert.ok(step);
      const reply = await sendStep(item, step, `culture-step-${index}`); assert.equal(reply.duplicate, true); assert.equal(reply.acceptedRevision, revision); assert.deepEqual(item.database.records(), committed);
    }
    assert.equal(await replay(item), value.journey.steps.length);
    context.diagnostic(JSON.stringify({ basis: 'Full legal exact-site and staffed operation journey persisted through SQLite', frames: value.journey.steps.length, revision: value.operated.revision, round: value.operated.round, theater: active, printing, adjacency, operation }));
  } finally { item.close(); }
});

for (const table of ['world_transitions', 'world_receipts']) await test(`culture prospective ${table} fault rolls back candidate upkeep payment site reservation and exact request`, async () => {
  const { value, step, action } = theaterStart(); const item = new Fixture();
  try {
    await persist(item, value.journey.steps, step.before.revision, value.journey.initial); const before = item.database.records();
    const seconds = ((step.before.independentTurns?.strategyTicks ?? 0) + 1) * 60 + 1;
    const input = await item.input('culture-theater-fault', action);
    item.database.sql.exec(`CREATE TRIGGER fail_culture BEFORE INSERT ON ${table} WHEN NEW.receipt_key = 'action:culture-theater-fault' BEGIN SELECT RAISE(ABORT, 'synthetic culture rollback'); END;`);
    await assert.rejects(item.send(input, seconds), /synthetic culture rollback/); assert.deepEqual(item.database.records(), before);
    item.reopen(); assert.deepEqual(await item.state(), step.before); item.database.sql.exec('DROP TRIGGER fail_culture');
    const accepted = await item.send(input, seconds); const caught = catchUpStrategy(step.before, coastalPrefixTime(seconds)); assert.ok(caught.ok, caught.error);
    const expected = applyCommand(caught.state, { seat: value.journey.seat, expectedRevision: caught.state.revision, timestamp: coastalPrefixTime(seconds), action }); assert.ok(expected.ok, expected.error);
    assert.deepEqual(await item.state(), expected.state); const committed = item.database.records(); item.reopen();
    const duplicate = await item.send(input, seconds); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, accepted.acceptedRevision); assert.deepEqual(item.database.records(), committed);
    await replay(item);
  } finally { item.close(); }
});

await test('culture prospective exact competing starts yield one payment reservation and stale loser', async () => {
  const { value, step } = theaterStart(); const item = new Fixture();
  try {
    await persist(item, value.journey.steps, step.before.revision, value.journey.initial); const before = item.database.records();
    const replies = await Promise.allSettled([sendStep(item, step, 'culture-race-a'), sendStep(item, step, 'culture-race-b')]);
    assert.equal(replies.filter(reply => reply.status === 'fulfilled').length, 1);
    const loser = replies.find(reply => reply.status === 'rejected'); assert.ok(loser?.status === 'rejected'); assert.match(String(loser.reason), /stale_revision/);
    assert.deepEqual(await item.state(), step.result.state); const committed = item.database.records(); assert.equal(committed.history.length, before.history.length + 1); assert.equal(committed.receipts.length, before.receipts.length + 1);
    item.reopen(); assert.deepEqual(await item.state(), step.result.state);
  } finally { item.close(); }
});

await test('culture prospective exact foreign occupied and premature Printing requests have zero durable effects', async () => {
  const { value, step } = theaterStart(); const item = new Fixture();
  try {
    await persist(item, value.journey.steps, step.before.revision, value.journey.initial); const before = item.database.records();
    const timestamp = coastalPrefixTime(((step.before.independentTurns?.strategyTicks ?? 0) + 1) * 60);
    for (const [index, action] of [
      { type: 'build', project: 'theater-square', cityId: 'city-1', tileId: value.journey.theaterTileId },
      { type: 'build', project: 'theater-square', cityId: value.journey.cityId, tileId: value.journey.wonderTileId },
      { type: 'build', project: 'printing-house', cityId: value.journey.cityId },
      { type: 'build', project: 'theater-square', cityId: value.journey.cityId, tileId: value.journey.theaterTileId, paid: {} },
    ].entries()) {
      await assert.rejects(item.store.mutate('action', { seat: 0, expectedRevision: step.before.revision, commandId: `culture-refused-${index}`, model, action: { type: 'strategy-action', action } }, actor, timestamp));
      assert.deepEqual(item.database.records(), before);
    }
    item.reopen(); assert.deepEqual(await item.state(), step.before);
  } finally { item.close(); }
});

await test('culture prospective paid Printing house pause retains historical operation then stores zero allocation on next beat', async () => {
  const value = cultureProductionOperationJourney(); const item = new Fixture();
  try {
    const historical = value.operated.cities.find(city => city.id === value.journey.cityId)?.buildingOperations?.['printing-house']?.lastResult; assert.ok(historical);
    value.journey.act({ type: 'set-building-operation', cityId: value.journey.cityId, buildingId: 'printing-house', enabled: false });
    assert.deepEqual(value.journey.state.cities.find(city => city.id === value.journey.cityId)?.buildingOperations?.['printing-house']?.lastResult, historical);
    value.journey.beat(); await persist(item, value.journey.steps, Number.MAX_SAFE_INTEGER, value.journey.initial); item.reopen();
    const state = await item.state(); const paused = state.cities.find(city => city.id === value.journey.cityId)?.buildingOperations?.['printing-house']?.lastResult; assert.ok(paused);
    assert.equal(paused.status, 'paused'); assert.deepEqual(paused.paid, {}); assert.deepEqual(paused.produced, {}); assert.equal(paused.residents?.allocated, 0);
    assert.equal(await replay(item), value.journey.steps.length);
  } finally { item.close(); }
});
