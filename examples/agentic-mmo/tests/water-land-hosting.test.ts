import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, applyRelease, catchUpStrategy, legalActions } from '../core/engine.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';
import { waterLandPrefix } from './fixtures/water-land-prefix.ts';
import { waterLandOperationJourney, waterLandPastureJourney, waterLandTown } from './fixtures/water-land-journey.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const actor = 'synthetic-water-land-owner';
const model = 'synthetic-water-land-host-fixture';

class Statement implements D1Statement {
  private readonly database: WaterLandDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: WaterLandDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class WaterLandDatabase implements D1Database {
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
  private readonly directory = mkdtempSync(join(tmpdir(), 'water-land-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new WaterLandDatabase(this.path);
  constructor() { this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8')); }
  get store() { return new WorldRepository(this.database); }
  async state() { const result = await this.store.read(); assert.ok(result); return result.state; }
  async initialize() { await this.store.initialize({ seed: 1701, clockEpoch: coastalPrefixTime(0), commandId: 'initialize' }, actor, coastalPrefixTime(0)); }
  async input(commandId: string, action: GameAction) { return { seat: 0, expectedRevision: (await this.state()).revision, model, commandId, action: { type: 'strategy-action', action } }; }
  send(input: Record<string, unknown>, seconds: number) { return this.store.mutate('action', input, actor, coastalPrefixTime(seconds)); }
  async beat() { const state = await this.state(); const seconds = ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60; return this.store.mutate('strategy-catchup', { expectedRevision: state.revision, commandId: `beat-${state.revision}`, timestamp: coastalPrefixTime(seconds), model }, actor, coastalPrefixTime(seconds)); }
  reopen() { this.database.sql.close(); this.database = new WaterLandDatabase(this.path); }
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
    await sendStep(item, step, `water-land-step-${index}`); assert.deepEqual(await item.state(), step.result.state); assert.ok(isWorldState(await item.state()));
  }
}

let cachedPrefix: ReturnType<typeof waterLandPrefix> | undefined;
function prefix() { cachedPrefix ??= waterLandPrefix(); return structuredClone(cachedPrefix); }

await test('water land predecessor retains all217 legal frames and real candidate geography through SQLite reopen and replay', async context => {
  const previous = prefix(); const item = new Fixture();
  try {
    assert.equal(previous.state.revision, 217); assert.equal(previous.steps.length, 217);
    await persist(item, previous.steps);
    const saved = await item.state();
    assert.equal(Object.hasOwn(saved, 'pastoralSites'), false);
    assert.equal(previous.pasture.cityId, 'city-1'); assert.equal(previous.pasture.tileId, 47);
    assert.equal(saved.tiles.find(tile => tile.id === 47)?.terrain, 'grassland');
    assert.equal(saved.tiles.find(tile => tile.id === 47)?.owner, 1);
    assert.equal(previous.mill.cityId, 'city-0'); assert.equal(previous.mill.irrigation?.status, 'operated');
    assert.deepEqual(previous.aqueduct.mountainTileIds, [5, 22, 24]);
    for (const tileId of previous.aqueduct.mountainTileIds) assert.equal(saved.tiles.find(tile => tile.id === tileId)?.terrain, 'mountain');
    const before = item.database.records(); item.reopen();
    assert.deepEqual(await item.state(), previous.state); assert.deepEqual(item.database.records(), before);
    assert.equal(await replay(item), 217);
    const actions: GameAction[] = [
      { type: 'research', technology: 'animal-husbandry' },
      { type: 'improve', cityId: previous.pasture.cityId, tileId: previous.pasture.tileId, improvementId: 'pasture' },
      { type: 'build', cityId: previous.mill.cityId, project: 'water-mill' },
      { type: 'build', cityId: previous.aqueduct.cityId, project: 'aqueduct' },
    ];
    for (const [index, action] of actions.entries()) {
      const input = await item.input(`old-water-land-${index}`, action);
      if (action.type === 'improve') input.seat = previous.pasture.seat;
      await assert.rejects(item.store.mutate('action', input, actor, previous.timestamp));
      assert.deepEqual(item.database.records(), before);
    }
    context.diagnostic(JSON.stringify({ basis: previous.provenance, revision: saved.revision, round: saved.round, pastureCandidate: previous.pasture, mill: previous.mill, catchment: previous.aqueduct, replayFrames: 217 }));
  } finally { item.close(); }
});

await test('water land prospective compatible adoption persists a real retained horse-site layer once', async () => {
  const previous = prefix(); const item = new Fixture();
  try {
    await persist(item, previous.steps); const before = item.database.records();
    const input = { expectedRevision: previous.state.revision, expectedFromReleaseId: previous.state.releaseId, targetReleaseId: 'settlement-water-land-1', timestamp: previous.timestamp, model, commandId: 'water-land-adopt' };
    const accepted = await item.store.mutate('release-apply', input, actor, previous.timestamp);
    assert.equal(accepted.acceptedRevision, 218);
    const after = await item.state(); assert.ok(Object.hasOwn(after, 'pastoralSites'));
    assert.deepEqual(after.tiles, previous.state.tiles); assert.equal(after.rng, previous.state.rng);
    assert.deepEqual(after.strategicDeposits, previous.state.strategicDeposits);
    assert.deepEqual(after.civilizations, previous.state.civilizations); assert.deepEqual(after.cities, previous.state.cities);
    const committed = item.database.records(); assert.equal(committed.history.length, before.history.length + 1);
    item.reopen(); assert.deepEqual(await item.state(), after);
    const duplicate = await item.store.mutate('release-apply', input, actor, previous.timestamp);
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, accepted.acceptedRevision);
    assert.deepEqual(item.database.records(), committed); assert.equal(await replay(item), 218);
  } finally { item.close(); }
});

let cachedStory: ReturnType<typeof waterLandOperationJourney> | undefined;
function story() { cachedStory ??= waterLandOperationJourney(); return cachedStory; }

await test('water land real revealed Pasture Mill and exact Aqueduct source persist once across reopen and full replay', async context => {
  const route = story(); const item = new Fixture();
  const witnessed = new Set([route.journey.adopted.revision, route.pasture.started.revision, route.pasture.completed.revision, route.millStarted.revision, route.millCompleted.revision, route.aqueductStarted.revision, route.aqueductCompleted.revision]);
  try {
    await item.initialize();
    for (const [index, step] of route.journey.steps.entries()) {
      const id = `water-land-step-${index}`;
      if (witnessed.has(step.result.state.revision)) {
        const replies = await Promise.all([sendStep(item, step, id), sendStep(item, step, id)]);
        assert.equal(replies.filter(reply => reply.duplicate).length, 1);
        assert.ok(replies.every(reply => reply.acceptedRevision === step.result.state.revision));
      } else await sendStep(item, step, id);
      assert.deepEqual(await item.state(), step.result.state);
    }
    const pastureStart = waterLandTown(route.pasture.started, route.pasture.cityId).construction?.active;
    assert.ok(pastureStart && 'kind' in pastureStart && pastureStart.kind === 'improvement');
    assert.equal(pastureStart.tileId, route.pasture.tileId); assert.deepEqual(pastureStart.paid, { materials: 6, credits: 3 }); assert.equal(pastureStart.workRequired, 3);
    const installed = waterLandTown(route.pasture.completed, route.pasture.cityId).improvements?.[String(route.pasture.tileId)]; assert.ok(installed);
    assert.equal(installed.operation.lastResult, null);
    const worked = waterLandTown(route.pasture.operated, route.pasture.cityId).improvements?.[String(route.pasture.tileId)]?.operation.lastResult; assert.ok(worked);
    assert.equal(worked.status, 'operated'); assert.equal(worked.residents.allocated, 1); assert.deepEqual(worked.paid, {}); assert.ok((worked.produced.food ?? 0) > 0);
    assert.equal(Object.hasOwn(worked, 'extraction'), false);
    const mill = waterLandTown(route.millStarted, route.journey.previous.mill.cityId).construction?.active;
    assert.ok(mill && !('kind' in mill)); assert.deepEqual(mill.paid, { materials: 16, credits: 6 }); assert.equal(mill.workRequired, 8);
    const beforeAqueduct = waterLandTown(route.aqueductReady, route.journey.previous.aqueduct.cityId);
    const aqueduct = waterLandTown(route.aqueductStarted, beforeAqueduct.id).construction?.active;
    assert.ok(aqueduct && !('kind' in aqueduct)); assert.deepEqual(aqueduct.paid, { materials: 22, credits: 8 }); assert.equal(aqueduct.workRequired, 12);
    assert.equal(Reflect.get(aqueduct, 'catchmentTileId'), 5); assert.equal(Object.hasOwn(aqueduct, 'tileId'), false);
    const town = waterLandTown(route.aqueductCompleted, beforeAqueduct.id);
    assert.deepEqual(town.housing, beforeAqueduct.housing);
    assert.deepEqual(Reflect.get(town, 'buildingCatchments'), { aqueduct: 5 });
    assert.equal(Reflect.get(town.construction?.lastCompleted ?? {}, 'catchmentTileId'), 5);
    assert.deepEqual(town.districtSites, beforeAqueduct.districtSites);
    const records = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), route.grown); assert.deepEqual(item.database.records(), records);
    for (const revision of witnessed) {
      const index = route.journey.steps.findIndex(step => step.result.state.revision === revision); const step = route.journey.steps[index]; assert.ok(step);
      const duplicate = await sendStep(item, step, `water-land-step-${index}`);
      assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, revision); assert.deepEqual(item.database.records(), records);
    }
    for (const step of [route.pasture.completionStep, route.millCompletionStep, route.aqueductCompletionStep]) {
      const page = await item.store.boundedChronicle({ format: 'recorded-choices-v1', after: step.before.revision, through: step.result.state.revision, limit: 1 });
      assert.deepEqual(page.entries[0]?.events, step.result.events);
    }
    assert.deepEqual(item.database.records(), records);
    context.diagnostic(JSON.stringify({ basis: 'real legal217-frame predecessor and connected repository after-half', revision: route.grown.revision, round: route.grown.round, pasture: worked, millOrder: mill, aqueductOrder: aqueduct, aqueductCompletion: town.construction?.lastCompleted, replayFrames: await replay(item) }));
  } finally { item.close(); }
});

for (const milestone of ['pasture-start', 'aqueduct-completion'] as const) for (const table of ['world_transitions', 'world_receipts']) await test(`water land ${milestone} ${table} fault fully rolls back before exact reopened retry`, async () => {
  const route = story(); const item = new Fixture();
  const step = milestone === 'aqueduct-completion' ? route.aqueductCompletionStep : route.journey.steps.find(value => value.result.state.revision === route.pasture.started.revision); assert.ok(step);
  try {
    await persist(item, route.journey.steps, step.before.revision); const before = item.database.records();
    const operation = step.input.kind === 'action' ? 'action' : 'strategy-catchup';
    item.database.sql.exec(`CREATE TRIGGER fail_water_land BEFORE INSERT ON ${table} WHEN NEW.receipt_key = '${operation}:water-land-fault' BEGIN SELECT RAISE(ABORT, 'synthetic water land rollback'); END;`);
    await assert.rejects(sendStep(item, step, 'water-land-fault'), /synthetic water land rollback/); assert.deepEqual(item.database.records(), before);
    item.reopen(); assert.deepEqual(item.database.records(), before); item.database.sql.exec('DROP TRIGGER fail_water_land');
    const accepted = await sendStep(item, step, 'water-land-fault'); assert.deepEqual(await item.state(), step.result.state);
    const committed = item.database.records(); item.reopen();
    const duplicate = await sendStep(item, step, 'water-land-fault'); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, accepted.acceptedRevision);
    assert.deepEqual(item.database.records(), committed); assert.equal(await replay(item), step.result.state.revision);
  } finally { item.close(); }
});

await test('water land exact unavailable sites and own infrastructure refusals leave candidate upkeep uncommitted', async () => {
  const route = story();
  const cases = [
    { state: route.journey.adopted, seat: 1, action: { type: 'improve', cityId: route.pasture.cityId, tileId: route.pasture.tileId, improvementId: 'pasture' } },
    { state: route.pasture.revealed, seat: 0, action: { type: 'improve', cityId: 'city-0', tileId: route.pasture.tileId, improvementId: 'pasture' } },
    { state: route.pasture.revealed, seat: 1, action: { type: 'improve', cityId: route.pasture.cityId, tileId: 48, improvementId: 'pasture' } },
    { state: route.millReady, seat: 0, action: { type: 'build', project: 'water-mill', cityId: 'city-0-14' } },
    { state: route.aqueductReady, seat: 0, action: { type: 'build', project: 'aqueduct', cityId: 'city-0' } },
    { state: route.aqueductReady, seat: 0, action: { type: 'build', project: 'aqueduct', cityId: 'city-0-14', catchmentTileId: 22 } },
  ];
  for (const [index, value] of cases.entries()) {
    const item = new Fixture();
    try {
      await persist(item, route.journey.steps, value.state.revision); const before = item.database.records();
      const timestamp = coastalPrefixTime(((value.state.independentTurns?.strategyTicks ?? 0) + 1) * 60 + 1);
      await assert.rejects(item.store.mutate('action', { seat: value.seat, expectedRevision: value.state.revision, model, commandId: `water-land-refusal-${index}`, action: { type: 'strategy-action', action: value.action } }, actor, timestamp));
      assert.deepEqual(item.database.records(), before); item.reopen(); assert.deepEqual(await item.state(), value.state);
    } finally { item.close(); }
  }
});

await test('water land synthetic concurrent legal commit prevents a stale exact paid Pasture start', async () => {
  const route = story(); const item = new Fixture();
  const step = route.journey.steps.find(value => value.result.state.revision === route.pasture.started.revision); assert.ok(step && step.input.kind === 'action' && step.input.command.timestamp);
  try {
    await persist(item, route.journey.steps, step.before.revision); const before = item.database.records();
    const timestamp = step.input.command.timestamp;
    const option = legalActions(step.before, 2, timestamp).find(value => value.action.type === 'focus'); assert.ok(option);
    const competing = applyCommand(step.before, { seat: 2, expectedRevision: step.before.revision, timestamp, action: option.action }); assert.ok(competing.ok, competing.error); assert.ok(isWorldState(competing.state));
    item.database.beforeBatch = () => { item.database.sql.prepare('UPDATE world_state SET revision=?,state_json=? WHERE world_id=?').run(competing.state.revision, JSON.stringify(competing.state), 'main'); };
    await assert.rejects(sendStep(item, step, 'water-land-cas'), { message: 'stale_revision' });
    assert.deepEqual(await item.state(), competing.state); assert.deepEqual(item.database.records().history, before.history); assert.deepEqual(item.database.records().receipts, before.receipts);
    item.reopen(); assert.deepEqual(await item.state(), competing.state);
  } finally { item.close(); }
});

await test('water land prospective canonical guard refuses new site and source fields before their feature', () => {
  const previous = prefix().state;
  const layer = structuredClone(previous);
  Reflect.set(layer, 'pastoralSites', { ruleVersion: 1, placementId: 'pastoral-sites-1', seed: previous.seed, tileIds: [47], sites: { '47': { tileId: 47, resource: 'horses' } } });
  assert.equal(isWorldState(layer), false, 'Unreleased horse-site records must not be silently accepted');
});

await test('water land prospective canonical guard refuses an uninstalled catchment before its feature', () => {
  const source = prefix().state; const city = source.cities.find(value => value.id === 'city-0-14'); assert.ok(city);
  Reflect.set(city, 'buildingCatchments', { aqueduct: 5 });
  assert.equal(isWorldState(source), false, 'Unreleased uninstalled Aqueduct source must not be silently accepted');
});

await test('water land exact Pasture pause retains prior receipt then blocks later output and resumes once', async () => {
  const route = waterLandPastureJourney(); const { journey, cityId, tileId, seat } = route;
  const previous = structuredClone(waterLandTown(journey.state, cityId).improvements?.[String(tileId)]?.operation.lastResult); assert.ok(previous);
  journey.act({ type: 'set-improvement-operation', cityId, tileId, improvementId: 'pasture', enabled: false }, seat);
  assert.deepEqual(waterLandTown(journey.state, cityId).improvements?.[String(tileId)]?.operation.lastResult, previous);
  journey.beat();
  const paused = waterLandTown(journey.state, cityId).improvements?.[String(tileId)]?.operation.lastResult; assert.ok(paused);
  assert.equal(paused.status, 'paused'); assert.equal(paused.residents.allocated, 0); assert.deepEqual(paused.produced, {}); assert.deepEqual(paused.paid, {});
  journey.act({ type: 'set-improvement-operation', cityId, tileId, improvementId: 'pasture', enabled: true }, seat);
  journey.beat();
  const resumed = waterLandTown(journey.state, cityId).improvements?.[String(tileId)]?.operation.lastResult; assert.ok(resumed);
  assert.equal(resumed.status, 'operated'); assert.equal(resumed.residents.allocated, 1); assert.ok((resumed.produced.food ?? 0) > 0);
  const item = new Fixture();
  try { await persist(item, journey.steps); const before = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), journey.state); assert.deepEqual(item.database.records(), before); assert.equal(await replay(item), journey.state.revision); }
  finally { item.close(); }
});

await test('water land Aqueduct source survives a later different completed order and exact public detail', async () => {
  const route = waterLandOperationJourney(); const { journey } = route; const cityId = journey.previous.aqueduct.cityId;
  journey.act({ type: 'build', cityId, project: 'granary' });
  journey.until(() => waterLandTown(journey.state, cityId).buildings.includes('granary'));
  const town = waterLandTown(journey.state, cityId); const last = town.construction?.lastCompleted; assert.ok(last && !('kind' in last));
  assert.equal(last.buildingId, 'granary'); assert.equal(Object.hasOwn(last, 'catchmentTileId'), false);
  assert.deepEqual(Reflect.get(town, 'buildingCatchments'), { aqueduct: 5 });
  const item = new Fixture();
  try {
    await persist(item, journey.steps); const before = item.database.records(); item.reopen(); assert.deepEqual(await item.state(), journey.state);
    const detail = await item.store.recordedChoiceDetail({ endRevision: route.aqueductCompleted.revision, civilizationId: 0, cityId });
    assert.equal(detail.consequences.status, 'available'); assert.equal(detail.consequences.town.status, 'available');
    assert.deepEqual(detail.consequences.town.construction.completed, waterLandTown(route.aqueductCompleted, cityId).construction?.lastCompleted);
    assert.equal(detail.recordedReason, null);
    for (const secret of [actor, 'actorUserId', 'request_json', 'receipt_key', '"tiles":', '"civilizations":']) assert.equal(JSON.stringify(detail).includes(secret), false);
    assert.deepEqual(item.database.records(), before); assert.equal(await replay(item), journey.state.revision);
  } finally { item.close(); }
});


await test('water land canonical retained placement rejects malformed identity bounds keys and iron overlap', () => {
  const source = story().journey.adopted; const original = source.pastoralSites; assert.ok(original);
  const sparse = [47]; Reflect.deleteProperty(sparse, '0');
  const replacements: unknown[] = [null, {}, { ...original, ruleVersion: 2 }, { ...original, placementId: 'future' }, { ...original, seed: source.seed + 1 },
    { ...original, tileIds: [47, 47] }, { ...original, tileIds: [47.5] }, { ...original, tileIds: [-1] }, { ...original, tileIds: [999999] },
    { ...original, tileIds: sparse }, { ...original, extra: true }, { ...original, sites: { '047': { tileId: 47, resource: 'horses' } } },
    { ...original, tileIds: [47], sites: { '47': { tileId: 48, resource: 'horses' } } },
    { ...original, tileIds: [47], sites: { '47': { tileId: 47, resource: 'iron' } } },
    { ...original, tileIds: [47], sites: { '47': { tileId: 47, resource: 'horses', remaining: 200 } } },
    { ...original, tileIds: Array.from({ length: 11 }, (_, index) => index), sites: Object.fromEntries(Array.from({ length: 11 }, (_, index) => [String(index), { tileId: index, resource: 'horses' }])) },
  ];
  const iron = source.strategicDeposits?.tileIds[0]; assert.ok(iron !== undefined);
  replacements.push({ ...original, tileIds: [iron], sites: { [String(iron)]: { tileId: iron, resource: 'horses' } } });
  for (const replacement of replacements) { const state = structuredClone(source); Reflect.set(state, 'pastoralSites', replacement); assert.equal(isWorldState(state), false, JSON.stringify(replacement)); }
  const absent = structuredClone(source); Reflect.deleteProperty(absent, 'pastoralSites'); assert.equal(isWorldState(absent), false);
  const later = structuredClone(source); const site = later.tiles.find(value => value.id === 47); assert.ok(site);
  site.terrain = 'desert'; site.owner = 2; site.resource = 'energy'; assert.ok(isWorldState(later), 'Retained migration identity is not rerolled against later terrain ownership or resource markers');
});

await test('water land canonical exact catchment aliases reject missing misplaced nonadjacent and corrupt event bindings', () => {
  const route = story(); const cityId = route.journey.previous.aqueduct.cityId;
  for (const source of [route.aqueductStarted, route.aqueductCompleted]) {
    const city = waterLandTown(source, cityId); const entry = city.construction?.active ?? city.construction?.lastCompleted; assert.ok(entry && !('kind' in entry));
    for (const replacement of [undefined, null, -1, 5.5, 999999, city.tileId, 47]) {
      const state = structuredClone(source); const selected = waterLandTown(state, cityId).construction; assert.ok(selected);
      const record = selected.active ?? selected.lastCompleted; assert.ok(record);
      if (replacement === undefined) Reflect.deleteProperty(record, 'catchmentTileId'); else Reflect.set(record, 'catchmentTileId', replacement);
      assert.equal(isWorldState(state), false, String(replacement));
    }
  }
  const source = route.aqueductCompleted;
  for (const replacement of [undefined, null, {}, { aqueduct: 22 }, { aqueduct: 5, granary: 22 }, { aqueduct: 999999 }]) {
    const state = structuredClone(source); const city = waterLandTown(state, cityId);
    if (replacement === undefined) Reflect.deleteProperty(city, 'buildingCatchments'); else Reflect.set(city, 'buildingCatchments', replacement);
    assert.equal(isWorldState(state), false, JSON.stringify(replacement));
  }
  for (const patch of [{ type: 'improvement-completed' }, { round: source.round - 1 }, { actor: 1 }, { target: 1 }, { tileId: 5 }]) {
    const state = structuredClone(source); const completion = waterLandTown(state, cityId).construction?.lastCompleted; assert.ok(completion);
    const event = state.events.find(value => value.id === completion.eventId); assert.ok(event); Object.assign(event, patch);
    assert.equal(isWorldState(state), false, JSON.stringify(patch));
  }
  for (const previous of [route.millStarted, route.pasture.started]) {
    const state = structuredClone(previous); const city = state.cities.find(value => value.construction?.active); assert.ok(city?.construction?.active);
    Reflect.set(city.construction.active, 'catchmentTileId', 5); assert.equal(isWorldState(state), false);
  }
});

await test('water land canonical history retains paid work sources and receipts after tuning terrain and feed changes', () => {
  const route = story(); const cityId = route.journey.previous.aqueduct.cityId;
  for (const source of [route.aqueductStarted, route.aqueductCompleted]) {
    const state = structuredClone(source); const city = waterLandTown(state, cityId); const entry = city.construction?.active ?? city.construction?.lastCompleted; assert.ok(entry);
    entry.paid = { materials: 999, credits: 1 }; entry.workRequired = 1000;
    const mountain = state.tiles.find(value => value.id === 5); assert.ok(mountain); mountain.terrain = 'grassland'; mountain.owner = 3;
    city.population = 3; state.events = [];
    assert.ok(isWorldState(state), 'Paid source identity survives later terrain population and mutable tuning without requiring retained event membership');
  }
  const state = structuredClone(route.pasture.operated); const city = waterLandTown(state, route.pasture.cityId);
  const improvement = city.improvements?.[String(route.pasture.tileId)]; assert.ok(improvement?.operation.lastResult);
  improvement.completion.paid = { materials: 100 }; improvement.completion.workRequired = 100;
  if (city.construction?.lastCompleted?.orderId === improvement.completion.orderId) city.construction.lastCompleted = structuredClone(improvement.completion);
  improvement.operation.lastResult.produced = { food: 99 }; city.population = 3;
  const site = state.tiles.find(value => value.id === route.pasture.tileId); assert.ok(site); site.terrain = 'ocean'; site.owner = 4;
  state.events = []; assert.ok(isWorldState(state), 'Installed renewable site and actual historical output are retained after later ineligibility');
});

await test('water land malformed saved renewable site and catchment are explicit corruption after SQLite reopen', async () => {
  const route = story(); const item = new Fixture();
  const corruptions: ((state: WorldState) => void)[] = [
    state => { Reflect.deleteProperty(state, 'pastoralSites'); },
    state => { Reflect.set(waterLandTown(state, route.journey.previous.aqueduct.cityId), 'buildingCatchments', { aqueduct: 22 }); },
    state => { const site = waterLandTown(state, route.pasture.cityId).improvements?.[String(route.pasture.tileId)]; assert.ok(site?.operation.lastResult); Reflect.set(site.operation.lastResult, 'extraction', { ruleVersion: 1, tileId: route.pasture.tileId, round: state.round, resource: 'iron', quantity: 0, reserveBefore: 0, reserveAfter: 0, stockBefore: 0, stockAfter: 0, capacity: 10, status: 'exhausted' }); },
  ];
  try {
    await persist(item, route.journey.steps, route.aqueductCompleted.revision); const saved = await item.state();
    for (const corrupt of corruptions) {
      const state = structuredClone(saved); corrupt(state); assert.equal(isWorldState(state), false);
      item.database.sql.prepare('UPDATE world_state SET state_json=? WHERE world_id=?').run(JSON.stringify(state), 'main');
      const records = item.database.records(); item.reopen(); await assert.rejects(item.store.read(), { message: 'corrupt_or_incompatible_world' }); assert.deepEqual(item.database.records(), records);
    }
  } finally { item.close(); }
});
