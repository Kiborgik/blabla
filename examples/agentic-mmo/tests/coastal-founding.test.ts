import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { ECONOMY_RULES, RESOURCE_IDS } from '../core/content.ts';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import { createCoastalPlanner, coastalTopologyBlock, coastalPathBlock, isCoastalFoundingQuote } from '../core/simulation/coastal.ts';
import { observeCompactTrade } from '../core/observation.ts';
import { isWorldState } from '../core/validation.ts';
import { isGameAction, validateAttachedPlan } from '../core/planning.ts';
import type { GameAction, Resources, WorldState } from '../core/types.ts';
import { coastalDeparturePrefix, coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput } from './fixtures/coastal-prefix.ts';

function journey() {
  const prefix = coastalDeparturePrefix('settlement-coastal-1');
  let state = prefix.state;
  let seconds = (Date.parse(prefix.timestamp) - Date.parse(coastalPrefixTime(0))) / 1000;
  const steps: Array<{ before: WorldState; input: CoastalPrefixInput; after: WorldState }> = [];
  const commit = (input: CoastalPrefixInput) => {
    const before = structuredClone(state);
    const result = replayCoastalStep(state, input);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(state, before);
    assert.ok(isWorldState(result.state), `Canonical world after ${JSON.stringify(input)} at ${result.state.revision}`);
    steps.push({ before, input, after: result.state });
    state = result.state;
    return result;
  };
  const action = (value: GameAction) => {
    assert.ok(legalActions(state, 0, coastalPrefixTime(seconds)).some(option => isDeepStrictEqual(option.action, value)), JSON.stringify(value));
    const result = commit({ kind: 'action', command: { seat: 0, expectedRevision: state.revision, timestamp: coastalPrefixTime(seconds), action: value } });
    seconds += 10;
    return result;
  };
  const beat = () => {
    assert.ok(state.independentTurns);
    seconds = (state.independentTurns.strategyTicks + 1) * 60;
    commit({ kind: 'strategy', timestamp: coastalPrefixTime(seconds) });
    seconds += 10;
  };
  const opening = structuredClone(state);
  for (const technology of ['civic-institutions', 'navigation']) {
    action({ type: 'research', technology });
    for (let count = 0; count < 64; count++) { if (state.civilizations[0]?.technologies.includes(technology)) break; beat(); }
    assert.ok(state.civilizations[0]?.technologies.includes(technology));
  }
  action({ type: 'build', cityId: prefix.departureCityId, project: 'boat-yard' });
  const building = structuredClone(state);
  for (let count = 0; count < 32 && !state.cities.find(city => city.id === prefix.departureCityId)?.buildings.includes('boat-yard'); count++) beat();
  assert.ok(state.cities.find(city => city.id === prefix.departureCityId)?.buildings.includes('boat-yard'));
  const completion = state.events.find(event => event.type === 'building-completed' && event.tileId === 23);
  assert.ok(completion?.effects.includes('Completed capability coastal-departure'));
  return { prefix, opening, building, state, timestamp: coastalPrefixTime(seconds), steps, action };
}

function refused(state: WorldState, action: GameAction, timestamp: string) {
  const before = structuredClone(state);
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp, action });
  assert.equal(result.ok, false);
  assert.deepEqual(result.state, before);
  assert.deepEqual(state, before);
  assert.deepEqual(result.events, []);
}

void test('coastal exact action has strict plan parsing without changing old source-less land shapes', () => {
  assert.equal(isGameAction({ type: 'settle-coast', sourceCityId: 'city-0', tileId: 26 }), true);
  for (const action of [{ type: 'settle-coast', tileId: 26 }, { type: 'settle-coast', sourceCityId: '', tileId: 26 }, { type: 'settle-coast', sourceCityId: 'city-0', tileId: -1 }, { type: 'settle-coast', sourceCityId: 'city-0', tileId: 26, extra: true }]) assert.equal(isGameAction(action), false);
  assert.equal(isGameAction({ type: 'settle', tileId: 26 }), true);
});

void test('released Boat yard canonically requires an exact coastal town in choices and tree', () => {
  const prefix = coastalDeparturePrefix('settlement-coastal-1');
  let state = prefix.state;

  const options = legalActions(state, 0, prefix.timestamp);
  assert.ok(options.some(option => option.action.type === 'build' && option.action.project === 'boat-yard' && option.action.cityId === prefix.departureCityId));
  assert.equal(options.some(option => option.action.type === 'build' && option.action.project === 'boat-yard' && option.action.cityId === 'city-0'), false);
  assert.equal(projectCapabilities(state, 0, 'city-0', prefix.timestamp).buildings.find(row => row.nodeId === 'building:boat-yard')?.status, 'locked');
});

void test('current-rules legal prefix discovers Navigation, completes timed yard and gains genuinely new conserved coastal reach', context => {
  const run = journey();
  const action: GameAction = { type: 'settle-coast', sourceCityId: run.prefix.departureCityId, tileId: 26 };
  const options = legalActions(run.state, 0, run.timestamp);
  const option = options.find(candidate => isDeepStrictEqual(candidate.action, action));
  assert.ok(option);
  assert.deepEqual(option.coastalQuote, { mode: 'coast', ruleVersion: 1, tileIds: [23, 6, 7, 8, 26], edges: 4 });
  assert.equal(options.some(candidate => candidate.action.type === 'settle' && candidate.action.tileId === 26), false);
  refused(run.state, { ...action, type: 'settle' }, run.timestamp);
  assert.equal(run.building.cities.find(city => city.id === run.prefix.departureCityId)?.buildings.includes('boat-yard'), false);
  assert.equal(run.building.cities.find(city => city.id === run.prefix.departureCityId)?.construction?.active?.workRequired, 6);
  const before = structuredClone(run.state);
  const result = run.action(action);
  const city = result.state.cities.find(candidate => candidate.tileId === 26);
  assert.ok(city);
  assert.equal(result.state.cities.reduce((sum, candidate) => sum + candidate.population, 0), before.cities.reduce((sum, candidate) => sum + candidate.population, 0));
  const source = before.cities.find(candidate => candidate.id === run.prefix.departureCityId);
  assert.ok(source);
  assert.equal(result.state.cities.find(candidate => candidate.id === source.id)?.population, source.population - ECONOMY_RULES.settle.population);
  assert.equal(city.focus, source.focus);
  const cost: Partial<Resources> = ECONOMY_RULES.settle.cost;
  for (const resource of RESOURCE_IDS) assert.equal(result.state.civilizations[0]?.resources[resource], Math.round(((before.civilizations[0]?.resources[resource] ?? 0) - (cost[resource] ?? 0)) * 100) / 100);
  const event = result.events.find(candidate => candidate.type === 'coastal-founded');
  assert.ok(event);
  assert.deepEqual(city.coastalFounding, { ruleVersion: 1, sourceCityId: source.id, sourceTileId: 23, destinationTileId: 26, pathTileIds: [23, 6, 7, 8, 26], population: 3, paid: ECONOMY_RULES.settle.cost, foundedRound: before.round, eventId: event.id });
  assert.deepEqual(event.coastalFounding, city.coastalFounding);
  context.diagnostic(JSON.stringify({ prefixFrames: run.prefix.steps.length, addedFrames: run.steps.length, round: result.state.round, coastalChoices: options.filter(candidate => candidate.action.type === 'settle-coast').length, optionBytes: Buffer.byteLength(JSON.stringify(options)), receipt: city.coastalFounding }));
});

void test('current coastal steps and exact JSON restart preserve the legal prefix and installed assets', () => {
  const run = journey();
  assert.deepEqual(run.opening.cities, run.prefix.state.cities);
  assert.deepEqual(run.opening.tiles, run.prefix.state.tiles);
  for (const step of run.steps) assert.deepEqual(replayCoastalStep(JSON.parse(JSON.stringify(step.before)), step.input).state, step.after);
  const action: GameAction = { type: 'settle-coast', sourceCityId: run.prefix.departureCityId, tileId: 26 };
  const command = { seat: 0, expectedRevision: run.state.revision, timestamp: run.timestamp, action, plan: [{ action, reason: 'Establish a reachable new shore with existing residents' }] };
  assert.equal(validateAttachedPlan(run.state, command, command.plan).ok, true);
  assert.equal(validateAttachedPlan(run.state, command, [{ action: { ...action, tileId: 27 }, reason: 'Other site' }]).ok, false);
  const result = applyCommand(run.state, command);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(applyCommand(JSON.parse(JSON.stringify(run.state)), command), result);
  refused(run.prefix.state, action, run.prefix.timestamp);
});

void test('labeled synthetic hostile source, site, supplies, coast and unfinished yard refuse atomically', () => {
  const run = journey();
  const action: GameAction = { type: 'settle-coast', sourceCityId: run.prefix.departureCityId, tileId: 26 };
  for (const mutate of [
    (state: WorldState) => { const city = state.cities.find(candidate => candidate.id === action.sourceCityId); assert.ok(city); city.population = 5; },
    (state: WorldState) => { const city = state.cities.find(candidate => candidate.id === action.sourceCityId); assert.ok(city); city.buildings = city.buildings.filter(id => id !== 'boat-yard'); },
    (state: WorldState) => { const civ = state.civilizations[0]; assert.ok(civ); civ.technologies = civ.technologies.filter(id => id !== 'navigation'); },
    (state: WorldState) => { const civ = state.civilizations[0]; assert.ok(civ); civ.resources.materials = 0; },
    (state: WorldState) => { const tile = state.tiles.find(candidate => candidate.id === 26); assert.ok(tile); tile.owner = 1; },
    (state: WorldState) => { for (const tile of state.tiles) if (tile.terrain === 'ocean') tile.terrain = 'mountain'; },
  ]) { const state = structuredClone(run.state); mutate(state); refused(state, action, run.timestamp); }
  refused(run.state, { ...action, sourceCityId: 'city-1' }, run.timestamp);
  refused(run.state, { ...action, sourceCityId: 'missing' }, run.timestamp);
  refused(run.state, { ...action, tileId: 9999 }, run.timestamp);
  const beforeCompletion = run.building;
  const timestamp = coastalPrefixTime((beforeCompletion.independentTurns?.strategyTicks ?? 0) * 60 + 20);
  refused(beforeCompletion, action, timestamp);
  assert.equal(catchUpStrategy(run.state, run.timestamp).ok, true);
});

void test('ocean planner reuses one departure tree and remains deterministic under tile reordering', context => {
  const run = journey();
  const planner = createCoastalPlanner(run.state);
  const quote = planner.quote(23, 26);
  assert.ok(quote);
  assert.equal(isCoastalFoundingQuote(quote, run.state.tiles.length), true);
  assert.equal(coastalPathBlock(run.state, quote, 23, 26), null);
  for (const tile of run.state.tiles) planner.quote(23, tile.id);
  assert.equal(planner.work.trees, 1);
  assert.ok(planner.work.visitedTiles <= run.state.tiles.length);
  assert.deepEqual(createCoastalPlanner({ tiles: run.state.tiles.toReversed() }).quote(23, 26), quote);
  assert.equal(planner.quote(23, 23), null);
  const damaged = structuredClone(run.state);
  const ocean = damaged.tiles.find(tile => tile.id === 7); assert.ok(ocean); ocean.terrain = 'forest';
  assert.equal(coastalTopologyBlock(damaged, quote, 23, 26), null);
  assert.notEqual(coastalPathBlock(damaged, quote, 23, 26), null);
  const sparse: number[] = [23]; sparse.length = 3; sparse[2] = 26;
  for (const invalid of [{ ...quote, ruleVersion: 2 }, { ...quote, tileIds: [23, 6, 6, 26], edges: 3 }, { ...quote, tileIds: [23, 26], edges: 1 }, { ...quote, extra: 1 }, { ...quote, tileIds: sparse, edges: 2 }]) assert.equal(isCoastalFoundingQuote(invalid, run.state.tiles.length), false);
  assert.notEqual(coastalTopologyBlock(run.state, { ...quote, tileIds: [23, 7, 26], edges: 2 }, 23, 26), null);
  assert.notEqual(coastalTopologyBlock(run.state, quote, 26, 23), null);
  context.diagnostic(JSON.stringify({ actualPlannerWork: planner.work, mapTiles: run.state.tiles.length }));
});

void test('full and compact exact coast choices and quotations are detached with no hidden truncation', context => {
  const run = journey();
  const before = structuredClone(run.state);
  const full = legalActions(run.state, 0, run.timestamp);
  const compact = observeCompactTrade(run.state, 0, run.timestamp);
  assert.deepEqual(compact.legalActions.map(option => option.action), full.map(option => option.action));
  assert.deepEqual(compact.legalActions.filter(option => option.action.type === 'settle-coast'), full.filter(option => option.action.type === 'settle-coast'));
  const first = compact.legalActions.find(option => option.coastalQuote);
  assert.ok(first?.coastalQuote);
  first.coastalQuote.tileIds[0] = 999;
  assert.deepEqual(run.state, before);
  assert.deepEqual(legalActions(run.state, 0, run.timestamp), full);
  const coast = full.filter(option => option.coastalQuote);
  assert.ok(coast.length > 1);
  const second = coast[1]?.coastalQuote; assert.ok(second);
  assert.notEqual(second.tileIds[0], 999);
  context.diagnostic(JSON.stringify({ allOptions: full.length, coastalOptions: coast.length, pureCompactBytes: Buffer.byteLength(JSON.stringify(observeCompactTrade(run.state, 0, run.timestamp))), first20OptionsBytes: Buffer.byteLength(JSON.stringify(full.slice(0, 20))) }));
});

void test('current land option identities and source history replay exactly alongside coastal choices', () => {
  const run = journey();
  const before = legalActions(run.prefix.state, 0, run.prefix.timestamp).filter(option => option.action.type === 'settle');
  const after = legalActions(run.opening, 0, run.prefix.timestamp).filter(option => option.action.type === 'settle');
  assert.deepEqual(after, before);
  let replay = run.prefix.initial;
  for (const step of run.prefix.steps) { const result = replayCoastalStep(replay, step.input); assert.deepEqual(result, step.result); replay = result.state; }
  const yard = capabilityCatalogue().buildings.find(building => building.id === 'boat-yard');
  assert.deepEqual(yard?.capabilities, ['coastal-departure']);
  assert.equal(yard?.siteRequirement, 'coastal');
  assert.deepEqual(yard?.production, {});
  assert.deepEqual(yard?.effects, []);
  const row = projectCapabilities(run.opening, 0, 'city-0', run.prefix.timestamp).buildings.find(building => building.nodeId === 'building:boat-yard');
  assert.ok(row?.blockers.some(blocker => blocker.kind === 'coastal-site'));
});

void test('newly founded exact town reopens genuine construction choices and duplicate stale founding cannot charge twice', () => {
  const run = journey();
  const command = { seat: 0, expectedRevision: run.state.revision, timestamp: run.timestamp, action: { type: 'settle-coast' as const, sourceCityId: run.prefix.departureCityId, tileId: 26 } };
  const result = applyCommand(run.state, command);
  assert.equal(result.ok, true, result.error);
  const city = result.state.cities.find(candidate => candidate.tileId === 26); assert.ok(city);
  const timestamp = new Date(Date.parse(run.timestamp) + 10_000).toISOString();
  const projection = projectCapabilities(result.state, 0, city.id, timestamp);
  assert.equal(projection.decisions?.construction.find(lane => lane.cityId === city.id)?.status, 'required');
  const farm: GameAction = { type: 'build', project: 'farm', cityId: city.id };
  assert.ok(legalActions(result.state, 0, timestamp).some(option => isDeepStrictEqual(option.action, farm)));
  const duplicate = applyCommand(result.state, command);
  assert.equal(duplicate.ok, false);
  assert.deepEqual(duplicate.state, result.state);
  assert.deepEqual(duplicate.events, []);
  const started = applyCommand(result.state, { seat: 0, expectedRevision: result.state.revision, timestamp, action: farm });
  assert.equal(started.ok, true, started.error);
  const farmOrder = started.state.cities.find(candidate => candidate.id === city.id)?.construction?.active;
  assert.ok(farmOrder && !('kind' in farmOrder));
  assert.equal(farmOrder.buildingId, 'farm');
  assert.equal(started.state.cities.find(candidate => candidate.id === run.prefix.departureCityId)?.construction?.active, null);
  assert.deepEqual(started.state.cities.find(candidate => candidate.id === city.id)?.coastalFounding, city.coastalFounding);
});
