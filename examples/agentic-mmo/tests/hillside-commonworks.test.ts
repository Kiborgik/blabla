import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exchangePromisedResources, knowledgeCommitmentHorizon } from '../core/behavior-knowledge.ts';
import { createPaidFoodSiteAffordability } from '../core/behavior-paid-food-sites.ts';
import { civilizationBehaviorProfile } from '../core/behavior-profiles.ts';
import { deriveProgressionPlan } from '../core/behavior-progression.ts';
import { assessCivilizationBehavior, chooseCivilizationBehavior, createBehaviorMemory } from '../core/behaviors.ts';
import { BUILDINGS, CONTENT, IMPROVEMENTS, validateContent } from '../core/content.ts';
import { applyCommand, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { isCoastalSite } from '../core/simulation/coastal.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { civilizationFoodUpkeep, forecastCityFoodProduction } from '../core/simulation/food-security.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { availableImprovementSites, improvementSiteBlock } from '../core/simulation/improvements.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import type { City, GameAction, HexTile, ImprovementDefinition, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { COASTAL_PREFIX_EPOCH, coastalDeparturePrefix, coastalPrefixTime, freshFixtureJourney, replayCoastalStep, syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';

const rulesId = 'settlement-hillside-commonworks-1';
const definition = (id = 'hill-commons'): ImprovementDefinition => { const value = IMPROVEMENTS.find(item => item.id === id); assert.ok(value); return value; };
const rounded = (value: number): number => Math.round(value * 100) / 100;
const cityOf = (state: WorldState): City => state.cities.find(city => city.id === 'city-0')!;
const time = (state: WorldState): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ((state.independentTurns?.lastActionWindow[0] ?? -1) + 1) * 10));
const actionFor = (tileId: number, improvementId = 'hill-commons'): Extract<GameAction, { type: 'improve' }> => ({ type: 'improve', cityId: 'city-0', tileId, improvementId });
function nextBeat(state: WorldState): WorldState {
  const result = catchUpStrategy(state, coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60));
  assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state)); return result.state;
}
function unrecordedSite(state: WorldState, tile: HexTile): boolean {
  return !state.cities.some(city => city.tileId === tile.id) && !state.strategicDeposits?.deposits[String(tile.id)]
    && !state.coalDeposits?.deposits[String(tile.id)] && !state.pastoralSites?.sites[String(tile.id)];
}
function syntheticHill(state: WorldState, tile: HexTile): void {
  assert.ok(unrecordedSite(state, tile)); tile.terrain = 'grassland'; tile.elevation = 70; tile.owner = 0;
}
function journey() {
  const siteIds: number[] = [];
  const run = freshFixtureJourney(rulesId, state => {
    syntheticTechnologies(state, 0, ['masonry', 'water-management']);
    const center = state.tiles.find(tile => tile.id === cityOf(state).tileId)!;
    const sites = state.tiles.filter(tile => hexDistance(center, tile) === 1 && unrecordedSite(state, tile)).toSorted((a, b) => a.id - b.id).slice(0, 2);
    assert.equal(sites.length, 2);
    for (const tile of sites) { syntheticHill(state, tile); siteIds.push(tile.id); }
  }, 'Synthetic known prerequisites and two exact owned grassland hills; all subsequent construction payments, work, operation and restart use actual commands and strategic beats');
  return { run, siteIds };
}
let installed: { state: WorldState; siteIds: number[] } | undefined;
function completed(two = false) {
  if (!installed) {
    const { run, siteIds } = journey(); run.act(actionFor(siteIds[1]!));
    run.until(() => !cityOf(run.state).construction?.active, 'Paid six-work hillside construction completes', 16);
    installed = { state: structuredClone(run.state), siteIds };
  }
  const { state: first, siteIds } = structuredClone(installed);
  let state = first;
  if (two) {
    const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: time(state), action: actionFor(siteIds[0]!) });
    assert.ok(result.ok, result.error); state = result.state;
    for (let beat = 0; beat < 16 && cityOf(state).construction?.active; beat++) state = nextBeat(state);
    assert.equal(cityOf(state).construction?.active, null); assert.ok(isWorldState(state));
  }
  const city = cityOf(state); const tileId = siteIds[1]!;
  return { state, city, tileId, siteIds, actor: state.civilizations[0]!, improvement: city.improvements![String(tileId)]! };
}
function syntheticIrrigationAndLibrary(state: WorldState, library = false): void {
  syntheticInstitution(state, 'city-0', 'irrigation');
  if (library) {
    syntheticTechnologies(state, 0, ['writing']); syntheticInstitution(state, 'city-0', 'campus'); syntheticInstitution(state, 'city-0', 'library');
  }
}

function currentKnowledgeCorridor(accept = true) {
  const sites = new Map<number, number>();
  const run = freshFixtureJourney(rulesId, state => {
    for (const id of [1, 4]) {
      const actor = state.civilizations[id]!; const city = state.cities.find(city => city.civId === id)!;
      actor.era = 1; actor.resources = { food: 300, materials: 300, energy: 300, credits: 300, science: 0, culture: 300 };
      syntheticTechnologies(state, id, ['civic-institutions', 'water-management', 'masonry', 'wheel', 'kiln-firing', 'animal-husbandry', ...(id === 1 ? ['engineering'] : [])]);
      city.population = 7; city.wellbeing = 40; city.infrastructure = 0; city.focus = 'research';
      syntheticInstitution(state, city.id, 'academy'); syntheticInstitution(state, city.id, 'monument');
      const center = state.tiles.find(tile => tile.id === city.tileId)!;
      const site = state.tiles.find(tile => tile.owner === id && hexDistance(center, tile) === 1 && unrecordedSite(state, tile)); assert.ok(site);
      site.terrain = 'grassland'; site.elevation = 70; sites.set(id, site.id);
    }
    state.civilizations[4]!.researchTarget = 'engineering';
  }, 'Synthetic current Knowledge institutions, known prerequisites, stock and owned hills; actual consenting trade, delivered cargo and independent accepted promises follow');
  run.act({ type: 'propose-trade', partner: 4, recipeId: 'harvest-for-materials', sourceCityId: 'city-1', recipientCityId: 'city-4' }, 1);
  run.act({ type: 'respond-trade', offerId: run.state.tradeOffers!.at(-1)!.id, accept: true }, 4);
  run.until(() => run.state.routes[0]!.agreement!.deliveryCount === 1, 'The exact consenting corridor actually delivers', 8);
  if (accept) {
    run.act({ type: 'propose-knowledge', routeId: run.state.routes[0]!.id, teacherCityId: 'city-1', learnerCityId: 'city-4', technologyId: 'engineering', teacherInstitutionId: 'academy', learnerInstitutionId: 'academy' }, 1);
    run.act({ type: 'respond-knowledge', compactId: run.state.knowledge!.active[0]!.id, accept: true }, 4);
    assert.equal(run.state.knowledge!.active[0]!.status, 'accepted');
  }
  return { run, sites };
}

void test('optional hillside content retains exact prices, prerequisites and gates without changing existing Food or housing choices', () => {
  const common = definition(); assert.deepEqual(validateContent(), []);
  assert.deepEqual(common.cost, { materials: 12, credits: 6 }); assert.equal(common.requiredWork, 6);
  assert.deepEqual(common.requires, ['masonry', 'water-management']); assert.equal(common.minEra, 0);
  assert.equal(common.siteRequirement, 'grassland-hill'); assert.equal(common.siteRange, 3);
  assert.equal(common.residentsRequired, 1); assert.deepEqual(common.operatingInputs, { materials: 1 }); assert.deepEqual(common.production, { food: 3 });
  assert.deepEqual(common.requiredFeatures, ['hillside-commonworks', 'worked-land', 'resident-capacity', 'recurring-decisions', 'building-operations', 'food-budget']);
  for (const [id, cost, production, housing] of [
    ['farm', { materials: 8, credits: 4 }, { food: 4 }, undefined],
    ['granary', { materials: 14, credits: 6 }, { food: 2 }, 4],
    ['aqueduct', { materials: 22, credits: 8 }, {}, 6],
  ] as const) { const building = BUILDINGS.find(value => value.id === id)!; assert.deepEqual(building.cost, cost); assert.deepEqual(building.production, production); assert.equal(building.housing, housing); }
  for (const id of ['hill-commons', 'shore-fishery']) for (const mutate of [
    (value: ImprovementDefinition) => { value.requiredFeatures = value.requiredFeatures.filter(feature => feature !== (id === 'hill-commons' ? 'hillside-commonworks' : 'shore-fisheries')); },
    (value: ImprovementDefinition) => { value.requiredFeatures = value.requiredFeatures.filter(feature => feature !== 'building-operations'); },
    (value: ImprovementDefinition) => { value.requiredFeatures = value.requiredFeatures.filter(feature => feature !== 'food-budget'); },
    (value: ImprovementDefinition) => { value.operatingInputs = {}; },
    (value: ImprovementDefinition) => { value.operatingInputs = { materials: -1 }; },
    (value: ImprovementDefinition) => { value.siteRange = 4; },
  ]) { const content = structuredClone(CONTENT); mutate(content.improvements.find(value => value.id === id)!); assert.ok(validateContent(content).some(error => error.startsWith(`improvement ${id}:`))); }
});

void test('synthetic exact hill boundaries use inclusive 70..88, grassland, ownership, exact-town support and range three', () => {
  const { run, siteIds } = journey(); const base = run.state; const tileId = siteIds[0]!;
  for (const [elevation, eligible] of [[69, false], [70, true], [88, true], [89, false]] as const) {
    const state = structuredClone(base); state.tiles.find(tile => tile.id === tileId)!.elevation = elevation;
    assert.equal(improvementSiteBlock(state, cityOf(state), definition(), tileId) === null, eligible);
    assert.equal(legalActions(state, 0, time(state)).some(option => option.action.type === 'improve' && option.action.improvementId === 'hill-commons' && option.action.tileId === tileId), eligible);
  }
  for (const terrain of ['forest', 'desert', 'tundra', 'ocean', 'mountain'] as const) {
    const state = structuredClone(base); state.tiles.find(tile => tile.id === tileId)!.terrain = terrain;
    assert.notEqual(improvementSiteBlock(state, cityOf(state), definition(), tileId), null, terrain);
  }
  for (const radius of [3, 4]) {
    const state = structuredClone(base); const center = state.tiles.find(tile => tile.id === cityOf(state).tileId)!;
    const site = state.tiles.find(tile => hexDistance(center, tile) === radius && unrecordedSite(state, tile))!; syntheticHill(state, site);
    assert.equal(improvementSiteBlock(state, cityOf(state), definition(), site.id) === null, radius === 3);
  }
  const cases: Array<[string, (state: WorldState) => void]> = [
    ['foreign site', state => { state.tiles.find(tile => tile.id === tileId)!.owner = 1; }],
    ['unowned site', state => { state.tiles.find(tile => tile.id === tileId)!.owner = null; }],
    ['foreign support town', state => { state.tiles.find(tile => tile.id === cityOf(state).tileId)!.owner = 1; }],
    ['other exact town purchase', state => { state.tileAcquisitions![String(tileId)] = { ruleVersion: 1, id: 'territory-1', cityId: 'city-1', civId: 0, cityTileId: cityOf(state).tileId, tileId, pathTileIds: [cityOf(state).tileId, tileId], distance: 1, priorCivilizationPurchases: 0, acquiredRound: 0, paid: { credits: 8 }, eventId: 'synthetic-binding' }; }],
    ['completed district', state => { cityOf(state).districtSites = { campus: tileId }; }],
    ['reserved improvement', state => { cityOf(state).construction = { active: { kind: 'improvement', id: 'construction-1', cityId: 'city-0', improvementId: 'hill-commons', tileId, ruleVersion: 1, startedRound: 0, paid: { materials: 12, credits: 6 }, workRequired: 6, workDone: 0 }, lastCompleted: null }; }],
  ];
  for (const [name, mutate] of cases) {
    const state = structuredClone(base); mutate(state); const before = structuredClone(state);
    assert.notEqual(improvementSiteBlock(state, cityOf(state), definition(), tileId), null, name);
    const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: time(state), action: actionFor(tileId) });
    assert.equal(result.ok, false, name); assert.deepEqual(result.events, [], name); assert.deepEqual(result.state, before, name); assert.deepEqual(state, before, name);
  }
  const center = structuredClone(base); const town = cityOf(center); const site = center.tiles.find(tile => tile.id === town.tileId)!; site.terrain = 'grassland'; site.elevation = 70;
  assert.match(improvementSiteBlock(center, town, definition(), town.tileId)!, /center/);
});

void test('fresh release and both technologies are required; unaffordable starts have no partial effect', () => {
  const { run, siteIds } = journey(); const tileId = siteIds[0]!;
  for (const mutate of [
    (state: WorldState) => { state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== 'hillside-commonworks'); },
    (state: WorldState) => { state.civilizations[0]!.technologies = state.civilizations[0]!.technologies.filter(id => id !== 'masonry'); },
    (state: WorldState) => { state.civilizations[0]!.technologies = state.civilizations[0]!.technologies.filter(id => id !== 'water-management'); },
    (state: WorldState) => { state.civilizations[0]!.resources.materials = 11; },
    (state: WorldState) => { state.civilizations[0]!.resources.credits = 5; },
  ]) {
    const state = structuredClone(run.state); mutate(state); const before = structuredClone(state);
    const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: time(state), action: actionFor(tileId) });
    assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(state, before); assert.deepEqual(result.events, []);
  }
  const predecessor = createWorld(1701, COASTAL_PREFIX_EPOCH, 'settlement-knowledge-compacts-1');
  assert.ok(!legalActions(predecessor, 0, COASTAL_PREFIX_EPOCH).some(option => option.action.type === 'improve' && option.action.improvementId === 'hill-commons'));
});

void test('valid synthetic prerequisites lead to actual one-time paid construction, later Food and exact same-version restart', context => {
  const { run, siteIds } = journey(); const tileId = siteIds[0]!; const before = structuredClone(run.state);
  run.act(actionFor(tileId)); const started = structuredClone(run.state); const order = cityOf(started).construction!.active!;
  assert.ok('kind' in order && order.kind === 'improvement'); assert.deepEqual(order.paid, { materials: 12, credits: 6 }); assert.equal(order.workRequired, 6); assert.equal(order.workDone, 0);
  assert.equal(started.civilizations[0]!.resources.materials, before.civilizations[0]!.resources.materials - 12);
  assert.equal(started.civilizations[0]!.resources.credits, before.civilizations[0]!.resources.credits - 6);
  const repeat = applyCommand(started, { seat: 0, expectedRevision: started.revision, timestamp: time(started), action: actionFor(siteIds[1]!) });
  assert.equal(repeat.ok, false); assert.deepEqual(repeat.state, started); assert.deepEqual(repeat.events, []);
  assert.ok(!legalActions(started, 0, time(started)).some(option => option.action.type === 'improve' || option.action.type === 'build'));
  run.until(() => !cityOf(run.state).construction?.active, 'Exact paid work completes', 16);
  const complete = cityOf(run.state).improvements![String(tileId)]!;
  assert.equal(complete.operation.lastResult, null); assert.deepEqual(complete.completion.paid, order.paid); assert.equal(complete.completion.workRequired, 6); assert.equal(complete.completion.orderId, order.id);
  assert.deepEqual(cityOf(run.state).housing, cityOf(before).housing); assert.equal(cityOf(run.state).infrastructure, cityOf(before).infrastructure);
  const forecast = forecastCityFoodProduction(run.state, cityOf(run.state)); run.beat();
  const receipt = cityOf(run.state).improvements![String(tileId)]!.operation.lastResult!;
  assert.equal(receipt.status, 'operated'); assert.deepEqual(receipt.paid, { materials: 1 }); assert.equal(receipt.residents.allocated, 1); assert.ok(receipt.produced.food! > 0);
  assert.equal(cityOf(run.state).lastFoodSupply!.produced, forecast); assert.ok(receipt.round > complete.completion.completedRound);
  for (const step of run.steps) { const restored: unknown = JSON.parse(JSON.stringify(step.before)); assert.ok(isWorldState(restored)); assert.deepEqual(replayCoastalStep(restored, structuredClone(step.input)), step.result); }
  context.diagnostic(JSON.stringify({ provenance: run.provenance, exactTown: 'city-0', tileId, paid: order.paid, workRequired: order.workRequired, transitions: run.steps.length, receipt }));
});

void test('opening Materials and remaining local residents are one atomic allocation after paid buildings', () => {
  for (const [population, materials, library, operated, reason] of [
    [6, 2, false, false, 'resident-shortage'], [7, 1, false, false, 'input-shortage'], [7, 2, false, true, null],
    [9, 2, true, false, 'resident-shortage'], [10, 2, true, true, null],
  ] as const) {
    const { state, city, actor, improvement } = completed(); syntheticIrrigationAndLibrary(state, library); city.population = population; actor.resources.materials = materials; actor.resources.credits = 20; state.round++;
    const opening = { ...actor.resources }; allocateOperations(state); const receipt = improvement.operation.lastResult!;
    assert.equal(city.buildingOperations!.irrigation!.lastResult!.status, 'operated');
    assert.equal(receipt.status, operated ? 'operated' : 'blocked'); assert.equal(receipt.blockedReason, reason);
    assert.deepEqual(receipt.inputs, [{ resource: 'materials', required: 1, available: materials - 1 }]);
    assert.equal(receipt.residents.available, population - 3 - (library ? 6 : 3)); assert.equal(receipt.residents.allocated, operated ? 1 : 0);
    assert.equal(actor.resources.materials, opening.materials - 1 - Number(operated)); assert.equal(city.population, population);
    assert.deepEqual(receipt.paid, operated ? { materials: 1 } : {}); assert.deepEqual(receipt.produced, {});
  }
});

void test('two actually purchased commons contend in numeric site order without reusing one resident or Material', () => {
  const base = completed(true);
  for (const tileId of base.siteIds) assert.notEqual(improvementSiteBlock(base.state, base.city, definition(), tileId), null);
  for (const [population, materials, blockedReason] of [[4, 2, 'resident-shortage'], [5, 1, 'input-shortage']] as const) {
    const state = structuredClone(base.state); const city = cityOf(state); city.population = population; state.civilizations[0]!.resources.materials = materials; state.round++;
    allocateOperations(state); const receipts = base.siteIds.map(tileId => city.improvements![String(tileId)]!.operation.lastResult!);
    assert.deepEqual(receipts.map(receipt => receipt.residents.allocated), [1, 0]); assert.equal(receipts[1]!.blockedReason, blockedReason);
    assert.equal(receipts.reduce((total, receipt) => total + (receipt.paid.materials ?? 0), 0), 1); assert.equal(state.civilizations[0]!.resources.materials, materials - 1);
  }
});

void test('same-beat Material production never pays a site until the following opening', () => {
  const { state, city, actor, tileId } = completed(); city.population = 4; actor.resources.materials = 0;
  const after = nextBeat(state); const blocked = cityOf(after).improvements![String(tileId)]!.operation.lastResult!;
  assert.equal(blocked.blockedReason, 'input-shortage'); assert.deepEqual(blocked.paid, {}); assert.deepEqual(blocked.produced, {}); assert.equal(blocked.residents.allocated, 0);
  assert.ok(after.civilizations[0]!.resources.materials > 0);
  const later = nextBeat(after); assert.equal(cityOf(later).improvements![String(tileId)]!.operation.lastResult!.status, 'operated');
});

void test('pause and invalid current site preserve paid construction but consume neither inputs nor residents', () => {
  const base = completed(); const operated = nextBeat(base.state); const history = structuredClone(cityOf(operated).improvements![String(base.tileId)]!.operation.lastResult);
  const pause = applyCommand(operated, { seat: 0, expectedRevision: operated.revision, timestamp: time(operated), action: { type: 'set-improvement-operation', cityId: 'city-0', tileId: base.tileId, improvementId: 'hill-commons', enabled: false } });
  assert.ok(pause.ok, pause.error); assert.deepEqual(cityOf(pause.state).improvements![String(base.tileId)]!.operation.lastResult, history);
  const paused = nextBeat(pause.state); const receipt = cityOf(paused).improvements![String(base.tileId)]!.operation.lastResult!;
  assert.equal(receipt.status, 'paused'); assert.deepEqual(receipt.paid, {}); assert.deepEqual(receipt.produced, {}); assert.equal(receipt.residents.allocated, 0);
  for (const mutate of [
    (state: WorldState) => { state.tiles.find(tile => tile.id === base.tileId)!.owner = 1; },
    (state: WorldState) => { state.tiles.find(tile => tile.id === base.tileId)!.terrain = 'forest'; },
    (state: WorldState) => { state.tiles.find(tile => tile.id === base.tileId)!.elevation = 89; },
    (state: WorldState) => { state.tiles.find(tile => tile.id === cityOf(state).tileId)!.owner = 1; },
  ]) {
    const state = structuredClone(base.state); mutate(state); state.civilizations[0]!.resources.materials = 1; state.round++;
    const completion = structuredClone(cityOf(state).improvements![String(base.tileId)]!.completion); allocateOperations(state);
    const result = cityOf(state).improvements![String(base.tileId)]!.operation.lastResult!;
    assert.equal(result.blockedReason, 'site-ineligible'); assert.deepEqual(result.paid, {}); assert.deepEqual(result.produced, {}); assert.equal(result.residents.allocated, 0); assert.equal(state.civilizations[0]!.resources.materials, 1);
    assert.deepEqual(cityOf(state).improvements![String(base.tileId)]!.completion, completion);
  }
});

void test('actual marginal Food follows wellbeing and damage, never infrastructure amplification', () => {
  for (const [wellbeing, damage] of [[67, 13], [40, 55], [100, 100]] as const) {
    const { state, city, actor, tileId } = completed(); city.population = 8; city.wellbeing = wellbeing; city.damage = damage; city.focus = 'research'; actor.resources.materials = 1;
    const results: number[] = [];
    for (const infrastructure of [1, 9]) {
      const on = structuredClone(state); const off = structuredClone(state); cityOf(on).infrastructure = infrastructure; cityOf(off).infrastructure = infrastructure; cityOf(off).improvements![String(tileId)]!.operation.enabled = false;
      const before = structuredClone(on); const forecast = forecastCityFoodProduction(on, cityOf(on)); assert.deepEqual(on, before);
      const active = nextBeat(on); const paused = nextBeat(off); const result = cityOf(active).improvements![String(tileId)]!.operation.lastResult!;
      assert.equal(cityOf(active).lastFoodSupply!.produced, forecast); assert.equal(result.produced.food ?? 0, rounded(cityOf(active).lastFoodSupply!.produced - cityOf(paused).lastFoodSupply!.produced));
      assert.equal(rounded(paused.civilizations[0]!.resources.materials - active.civilizations[0]!.resources.materials), 1); results.push(result.produced.food ?? 0);
    }
    assert.equal(results[0], results[1]); if (damage === 100) assert.equal(results[0], 0);
  }
});

void test('a conditional low-Food household receives three real extra meals at one opening Material cost', () => {
  const { state, city, actor, tileId } = completed(); city.population = 8; city.wellbeing = 50; city.damage = 0; city.focus = 'research'; actor.resources.food = 0; actor.resources.materials = 1;
  const paused = structuredClone(state); cityOf(paused).improvements![String(tileId)]!.operation.enabled = false;
  state.round++; paused.round++; resolveEconomy(state, []); resolveEconomy(paused, []);
  assert.equal(city.lastFoodSupply!.required, 10); assert.equal(city.lastFoodSupply!.paid, 10); assert.equal(cityOf(paused).lastFoodSupply!.paid, 7);
  assert.equal(rounded(city.lastFoodSupply!.produced - cityOf(paused).lastFoodSupply!.produced), 3);
  assert.equal(rounded(paused.civilizations[0]!.resources.materials - actor.resources.materials), 1);
});

void test('construction affordability uses actual Food risk or four-upkeep reserves and the post-payment opening allocator', () => {
  const { run, siteIds } = journey(); const base = run.state; const action = actionFor(siteIds[0]!);
  for (const [population, materials, food, irrigation, expected] of [
    [4, 13, 0, false, true], [4, 12, 0, false, false], [3, 13, 0, false, false],
    [4, 13, 20, false, false], [20, 13, 100, false, true],
    [6, 14, 0, true, false], [7, 13, 0, true, false], [7, 14, 0, true, true],
  ] as const) {
    const state = structuredClone(base); const city = cityOf(state); city.population = population; state.civilizations[0]!.resources.materials = materials; state.civilizations[0]!.resources.food = food;
    if (irrigation) syntheticIrrigationAndLibrary(state);
    const before = structuredClone(state); assert.equal(createPaidFoodSiteAffordability(state, 0)(action), expected, JSON.stringify({ population, materials, food, irrigation })); assert.deepEqual(state, before);
  }
  const boundary = structuredClone(base); cityOf(boundary).population = 4; boundary.civilizations[0]!.resources.materials = 13; boundary.civilizations[0]!.resources.food = civilizationFoodUpkeep(boundary, 0) * 4 - 0.01;
  assert.equal(createPaidFoodSiteAffordability(boundary, 0)(action), true);
  cityOf(boundary).damage = 100; assert.equal(createPaidFoodSiteAffordability(boundary, 0)(action), false);
});

void test('a lower numeric proposed site cannot displace an existing productive Food site even when the proposed one would operate', () => {
  for (const population of [4, 5]) {
    const { state, city, actor, siteIds, improvement } = completed(); city.population = population; actor.resources.materials = population === 4 ? 14 : 13; actor.resources.food = 0;
    const candidate = actionFor(siteIds[0]!); assert.equal(createPaidFoodSiteAffordability(state, 0)(candidate), false);
    improvement.operation.enabled = false; assert.equal(createPaidFoodSiteAffordability(state, 0)(candidate), true);
  }
});

void test('actual current Knowledge consent preserves both tuition budgets, cadence promises and selected institutions before paid Food construction', () => {
  const { run, sites } = currentKnowledgeCorridor();
  for (const id of [1, 4]) {
    const state = structuredClone(run.state); const actor = state.civilizations[id]!;
    const action: Extract<GameAction, { type: 'improve' }> = { type: 'improve', cityId: `city-${id}`, tileId: sites.get(id)!, improvementId: 'hill-commons' };
    const horizon = knowledgeCommitmentHorizon(state, id); assert.equal(horizon, 8);
    const held = exchangePromisedResources(state, id, horizon);
    assert.equal(held.ordinary.materials, id === 1 ? 0 : 9); assert.equal(held.ordinary.credits, id === 1 ? 0 : 4);
    assert.equal(held.ordinary.culture, id === 1 ? 2 : 0); assert.equal(held.ordinary.food, id === 1 ? 8 : 0); assert.equal(held.ordinary.energy, 2);
    actor.resources.food = held.ordinary.food; actor.resources.materials = 13 + held.ordinary.materials;
    actor.resources.credits = 7 + held.ordinary.credits; actor.resources.culture = 2 + held.ordinary.culture; actor.resources.energy = held.ordinary.energy;
    assert.ok(isWorldState(state)); const before = structuredClone(state);
    assert.equal(createPaidFoodSiteAffordability(state, id)(action), true); assert.deepEqual(state, before);
    for (const resource of ['materials', 'credits', 'culture', 'energy'] as const) {
      const short = structuredClone(state); short.civilizations[id]!.resources[resource] = rounded(short.civilizations[id]!.resources[resource] - 0.01);
      assert.ok(isWorldState(short)); assert.equal(createPaidFoodSiteAffordability(short, id)(action), false, `${id}/${resource}`);
    }
    const paused = structuredClone(state); paused.cities.find(city => city.id === action.cityId)!.buildingOperations!.academy!.enabled = false;
    assert.ok(isWorldState(paused)); assert.equal(createPaidFoodSiteAffordability(paused, id)(action), false);
    const started = applyCommand(state, { seat: id, expectedRevision: state.revision, timestamp: run.time(), action }); assert.ok(started.ok, started.error);
    assert.ok(isWorldState(started.state)); assert.deepEqual(started.state.knowledge, state.knowledge);
    assert.equal(started.state.civilizations[id]!.resources.materials, 1 + held.ordinary.materials);
    assert.equal(started.state.civilizations[id]!.resources.credits, 1 + held.ordinary.credits);
    const operated = nextBeat(started.state); assert.equal(operated.cities.find(city => city.id === action.cityId)!.buildingOperations!.academy!.lastResult!.status, 'operated');
    const compact = operated.knowledge!.active[0]!; assert.ok(compact.status === 'accepted'); assert.equal(compact.studies.length, 0);
  }
});

void test('actual public and relief promises plus the next trade shipment are reserved once without multiplying opening operations', () => {
  const { run, sites } = currentKnowledgeCorridor(false);
  run.state.routes[0]!.damage = 25; run.state.civilizations[4]!.resources.food = 0;
  assert.ok(isWorldState(run.state), 'Explicit synthetic route damage and recipient need precede actual promises');
  run.act({ type: 'propose-public-project', routeId: run.state.routes[0]!.id, recipeId: 'joint-road-repair' }, 1);
  run.act({ type: 'respond-public-project', projectId: run.state.publicProjects![0]!.id, accept: true }, 4);
  run.act({ type: 'propose-relief', routeId: run.state.routes[0]!.id, sourceCityId: 'city-1', recipientCityId: 'city-4' }, 1);
  run.act({ type: 'respond-relief', charterId: run.state.relief!.active[0]!.id, accept: true }, 4);
  const state = run.state; const actor = state.civilizations[1]!; const relief = state.relief!.active[0]!;
  assert.equal(state.publicProjects![0]!.status, 'committed'); assert.equal(relief.status, 'accepted'); assert.equal(knowledgeCommitmentHorizon(state, 1), 1);
  const held = exchangePromisedResources(state, 1, state.routes[0]!.agreement!.nextDeliveryRound - state.round);
  assert.equal(held.ordinary.materials, 2); assert.equal(held.ordinary.food, relief.terms.food + 4); assert.equal(held.ordinary.energy, 3);
  actor.resources.materials = 15; actor.resources.credits = 7; actor.resources.culture = 2; actor.resources.food = held.ordinary.food; actor.resources.energy = held.ordinary.energy;
  assert.ok(isWorldState(state)); const before = structuredClone(state);
  const action: Extract<GameAction, { type: 'improve' }> = { type: 'improve', cityId: 'city-1', tileId: sites.get(1)!, improvementId: 'hill-commons' };
  assert.equal(createPaidFoodSiteAffordability(state, 1)(action), true); assert.deepEqual(state, before);
  for (const resource of ['materials', 'credits', 'food', 'energy'] as const) {
    const short = structuredClone(state); short.civilizations[1]!.resources[resource] = rounded(short.civilizations[1]!.resources[resource] - 0.01);
    assert.ok(isWorldState(short)); assert.equal(createPaidFoodSiteAffordability(short, 1)(action), false, resource);
  }
});

void test('desired paid improvements reserve input costs and confirm their proposed set through the actual allocator', () => {
  const base = completed(true);
  for (const materials of [0, 1, 2]) {
    const state = structuredClone(base.state); const actor = state.civilizations[0]!; cityOf(state).population = 5; actor.resources.materials = materials;
    const plan = deriveProgressionPlan(state, actor, civilizationBehaviorProfile(state.seed, 0), []);
    assert.equal(plan.desiredImprovements.size, materials);
    for (const [index, tileId] of base.siteIds.entries()) assert.equal(plan.desiredImprovements.has(`city-0/${tileId}`), index < materials);
  }
});

void test('paid-site weighting keeps cheaper Food and repair choices and excludes unaffordable commons without cancelling work', () => {
  const { run, siteIds } = journey(); const state = run.state; const actor = state.civilizations[0]!; const city = cityOf(state); city.population = 4; actor.resources.food = 0; actor.resources.materials = 13; city.damage = 30;
  const memory = createBehaviorMemory(state, 0); const options = legalActions(state, 0, time(state));
  const assessed = assessCivilizationBehavior(state, 0, memory, options); const commons = assessed.candidates.find(candidate => candidate.option.action.type === 'improve' && candidate.option.action.improvementId === 'hill-commons' && candidate.option.action.tileId === siteIds[0]);
  const farm = assessed.candidates.find(candidate => candidate.option.action.type === 'build' && candidate.option.action.project === 'farm');
  const repair = assessed.candidates.find(candidate => candidate.option.action.type === 'repair-city');
  assert.ok(commons && commons.weight > 0); assert.ok(farm && farm.weight > commons.weight); assert.ok(repair && repair.weight > 0);
  const decision = chooseCivilizationBehavior(state, 0, memory, time(state)); assert.ok(decision.action && options.some(option => JSON.stringify(option.action) === JSON.stringify(decision.action)));
  assert.deepEqual(decision, chooseCivilizationBehavior(JSON.parse(JSON.stringify(state)) as WorldState, 0, JSON.parse(JSON.stringify(memory)), time(state)));
  actor.resources.materials = 12;
  const declined = assessCivilizationBehavior(state, 0, memory, legalActions(state, 0, time(state)));
  assert.ok(declined.candidates.filter(candidate => candidate.option.action.type === 'improve' && candidate.option.action.improvementId === 'hill-commons').every(candidate => candidate.weight === 0));
  const started = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: time(state), action: { type: 'build', cityId: 'city-0', project: 'farm' } }); assert.ok(started.ok, started.error);
  assert.equal(createPaidFoodSiteAffordability(started.state, 0)(actionFor(siteIds[0]!)), false); assert.equal(cityOf(started.state).construction!.active && 'kind' in cityOf(started.state).construction!.active!, false);
});

void test('the existing shore fishery uses the same post-payment operating affordability guard', () => {
  const prefix = coastalDeparturePrefix(rulesId); let state = prefix.state;
  const city = (): City => state.cities.find(candidate => candidate.id === prefix.departureCityId)!;
  if (!availableImprovementSites(state, city(), definition('shore-fishery')).length) {
    const purchase = legalActions(state, 0, time(state)).find(option => option.action.type === 'acquire-tile' && option.action.cityId === city().id && isCoastalSite(state, option.action.tileId));
    assert.ok(purchase);
    const acquired = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: time(state), action: purchase.action });
    assert.ok(acquired.ok, acquired.error); state = acquired.state;
  }
  const tileId = availableImprovementSites(state, city(), definition('shore-fishery'))[0]; assert.notEqual(tileId, undefined);
  city().population = 4; state.civilizations[0]!.resources.food = 0;
  assert.ok(isWorldState(state)); assert.equal(improvementSiteBlock(state, city(), definition('shore-fishery'), tileId!), null);
  const action: Extract<GameAction, { type: 'improve' }> = { type: 'improve', cityId: city().id, tileId: tileId!, improvementId: 'shore-fishery' };
  for (const materials of [8, 9]) {
    state.civilizations[0]!.resources.materials = materials; assert.ok(isWorldState(state));
    assert.equal(createPaidFoodSiteAffordability(state, 0)(action), materials === 9);
  }
});

void test('paid commonwork save validation rejects invented inputs, construction payments and output', () => {
  const { state, tileId } = completed(); const valid = nextBeat(state); assert.ok(isWorldState(valid));
  const receipt = (world: WorldState) => cityOf(world).improvements![String(tileId)]!.operation.lastResult!;
  for (const mutate of [
    (world: WorldState) => { receipt(world).paid = {}; },
    (world: WorldState) => { receipt(world).paid.materials = 2; },
    (world: WorldState) => { receipt(world).produced.materials = 1; },
    (world: WorldState) => { receipt(world).residents.allocated = 0; },
    (world: WorldState) => { receipt(world).inputs![0]!.available = 0; },
    (world: WorldState) => { cityOf(world).improvements![String(tileId)]!.completion.paid.materials = 11; },
    (world: WorldState) => { cityOf(world).improvements![String(tileId)]!.completion.workRequired = 5; },
  ]) { const corrupt = structuredClone(valid); mutate(corrupt); assert.equal(isWorldState(corrupt), false); }
});

void test('six fixed generated seeds count real owned eligible hills without creating or guaranteeing opportunities', context => {
  const counts = [0, 1, 73, 1701, 90210, 4294967295].map(seed => {
    const state = createGeneratedWorld(seed, COASTAL_PREFIX_EPOCH, rulesId);
    const before = structuredClone(state);
    const towns = state.cities.map(city => ({ cityId: city.id, eligibleSites: availableImprovementSites(state, city, definition()).length }));
    assert.deepEqual(state, before); assert.ok(isWorldState(state));
    return { seed, eligibleTowns: towns.filter(town => town.eligibleSites > 0).length, noneligibleTowns: towns.filter(town => town.eligibleSites === 0).length, towns };
  });
  assert.equal(counts.length, 6); context.diagnostic(JSON.stringify({ scope: 'Fresh fixed generated geography only; no campaign or guaranteed eligibility', counts }));
});
