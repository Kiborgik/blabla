import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, applyRelease, catchUpStrategy, legalActions, observe } from '../core/engine.ts';
import { projectCapabilities } from '../core/capabilities.ts';
import { cityGrowthFacts } from '../core/simulation/growth.ts';
import { DIRECTOR_SEAT, type WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { localGrowthPrefix } from './fixtures/local-growth-prefix.ts';
import { localGrowthFoundingJourney, localGrowthJourney, localGrowthOperationJourney } from './fixtures/local-growth-journey.ts';
import { coastalPrefixTime, replayCoastalStep } from './fixtures/coastal-prefix.ts';

function town(state: WorldState, cityId = 'city-0') { const city = state.cities.find(candidate => candidate.id === cityId); assert.ok(city); return city; }
function civ(state: WorldState) { const civilization = state.civilizations[0]; assert.ok(civilization); return civilization; }
function nextBeat(state: WorldState) { const result = catchUpStrategy(state, coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60)); assert.ok(result.ok, result.error); return result; }

await test('local growth old-release control retains capacity20 without housing or future Masonry Granary choices', () => {
  const prefix = localGrowthPrefix(); const before = structuredClone(prefix.state);
  assert.equal(town(before).population, 20); assert.equal('housing' in town(before), false);
  const options = legalActions(before, 0, prefix.timestamp);
  assert.ok(!options.some(option => option.action.type === 'research' && option.action.technology === 'masonry'));
  assert.ok(!options.some(option => option.action.type === 'build' && option.action.project === 'granary'));
  const result = nextBeat(before);
  assert.equal(town(result.state).population, 20); assert.equal(town(result.state).buildingOperations?.university?.lastResult?.status, 'blocked');
  assert.deepEqual(before, prefix.state); assert.ok(isWorldState(result.state));
});

await test('local growth compatible adoption preserves actual stocks population commitments and map while retaining legacy bases', () => {
  const journey = localGrowthJourney();
  assert.deepEqual(journey.adopted.tiles, journey.beforeRelease.tiles);
  assert.deepEqual(journey.adopted.civilizations, journey.beforeRelease.civilizations);
  for (const previous of journey.beforeRelease.cities) {
    const city = town(journey.adopted, previous.id);
    assert.deepEqual(city.housing, { ruleVersion: 1, baseCapacity: Math.max(20, previous.population), establishedRound: journey.beforeRelease.round, origin: 'legacy-adoption' });
    const { housing: _housing, ...retained } = city; assert.deepEqual(retained, previous);
  }
});

await test('local growth legal Masonry Granary path pays once and completes without retroactive residents', context => {
  const value = localGrowthOperationJourney(); const city = town(value.started);
  const order = city.construction?.active; assert.ok(order && !('kind' in order));
  assert.equal(order.buildingId, 'granary'); assert.equal(order.workRequired, 8); assert.deepEqual(order.paid, { materials: 14, credits: 6 });
  assert.equal(civ(value.masonryReady).resources.materials - civ(value.started).resources.materials, 14);
  assert.equal(civ(value.masonryReady).resources.credits - civ(value.started).resources.credits, 6);
  assert.equal(town(value.completed).population, 20);
  assert.ok(!value.completionStep.result.events.some(event => event.type === 'population-growth' && event.tileId === city.tileId));
  assert.equal(town(value.completed).buildingOperations?.university?.lastResult?.status, 'blocked');
  context.diagnostic(JSON.stringify({ basis: 'Entirely legal engine journey, no injected population or stocks', transitions: value.journey.steps.length, completedRound: value.completed.round, growthRound: value.growth.round, operatingRound: value.operated.round, university: town(value.operated).buildingOperations?.university?.lastResult }));
});

await test('local growth real food payment creates one resident before the next opening can fund University', () => {
  const value = localGrowthOperationJourney();
  assert.equal(town(value.growth).population, 21);
  assert.equal(town(value.growth).buildingOperations?.university?.lastResult?.status, 'blocked');
  assert.equal(town(value.growth).buildingOperations?.university?.lastResult?.residents?.openingPopulation, 20);
  const growth = value.growthStep.result.events.find(event => event.type === 'population-growth' && event.tileId === town(value.growth).tileId); assert.ok(growth);
  assert.ok(growth.effects.includes('Food -11'));
  assert.deepEqual(growth.populationGrowth, { ruleVersion: 1, cityId: 'city-0', civId: 0, round: value.growth.round, eventId: growth.id, populationBefore: 20, populationAfter: 21, capacity: 24, foodPaid: 11 });
  const operation = town(value.operated).buildingOperations?.university?.lastResult; assert.ok(operation);
  assert.equal(operation.status, 'operated'); assert.equal(operation.residents?.openingPopulation, 21); assert.equal(operation.residents?.allocated, 3);
  assert.deepEqual(operation.paid, { credits: 2 }); assert.ok((operation.produced.science ?? 0) > 0);
});

await test('local growth equal-beat unbuilt control remains at20 with blocked University and no free population', () => {
  const value = localGrowthOperationJourney(); let control = structuredClone(value.masonryReady);
  while (control.round < value.completed.round) control = nextBeat(control).state;
  assert.equal(civ(value.completed).resources.food, civ(control).resources.food);
  const firstOutputControl = nextBeat(control).state;
  const granaryFood = civ(value.growth).resources.food + 11 - civ(firstOutputControl).resources.food;
  assert.ok(granaryFood > 0, 'Granary first produces food on the beat after completion');
  while (control.round < value.operated.round) control = nextBeat(control).state;
  assert.equal(town(control).population, 20); assert.equal(town(control).buildingOperations?.university?.lastResult?.status, 'blocked');
  assert.ok(town(value.operated).population > town(control).population);
  const beforeCompletion = nextBeat(value.completionStep.before);
  assert.deepEqual(beforeCompletion, value.completionStep.result);
});

await test('local growth four real growth steps pay44 separately from upkeep and stop at local capacity24', () => {
  const value = localGrowthOperationJourney();
  value.journey.until(() => town(value.journey.state).population === 24); value.journey.beat();
  const events = value.journey.steps.filter(step => step.before.round >= value.completed.round).flatMap(step => step.result.events).filter(event => event.type === 'population-growth' && event.tileId === town(value.completed).tileId);
  assert.equal(events.length, 4); assert.ok(events.every(event => event.effects.includes('Food -11')));
  assert.equal(events.reduce((sum, event) => sum + (event.populationGrowth?.foodPaid ?? 0), 0), 44);
  assert.deepEqual(events.map(event => event.populationGrowth?.populationBefore), [20, 21, 22, 23]);
  assert.equal(town(value.journey.state).population, 24);
  assert.equal(town(value.journey.state, 'city-1').population, 20);
});

await test('local growth exact foreign missing duplicate and active-town Granary starts refuse without payment', () => {
  const value = localGrowthOperationJourney();
  for (const [state, cityId] of [[value.masonryReady, 'city-1'], [value.masonryReady, 'missing'], [value.started, 'city-0'], [value.completed, 'city-0']] as const) {
    const before = structuredClone(state);
    const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 30), action: { type: 'build', project: 'granary', cityId } });
    assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(result.events, []);
  }
});

await test('local growth complete real prefix adoption paid growth and operation replay exactly without mutating any input', () => {
  const value = localGrowthOperationJourney(); let state = structuredClone(value.journey.initial);
  for (const step of value.journey.steps) {
    assert.deepEqual(state, step.before); const before = structuredClone(state);
    const result = replayCoastalStep(state, structuredClone(step.input)); assert.deepEqual(result, step.result);
    assert.deepEqual(state, before); assert.ok(isWorldState(result.state)); state = result.state;
  }
  assert.deepEqual(state, value.operated);
});

await test('local growth real new land and coastal towns retain base8 without changing source conservation', () => {
  for (const kind of ['settle', 'settle-coast'] as const) {
    const value = localGrowthFoundingJourney(kind); const journey = value.journey;
    const before = value.prepared;
    const founded = journey.state.cities.find(city => !before.cities.some(previous => previous.id === city.id)); assert.ok(founded);
    assert.equal(founded.population, 3);
    assert.deepEqual(founded.housing, { ruleVersion: 1, baseCapacity: 8, establishedRound: journey.state.round, origin: 'founded' });
    assert.equal(before.cities.reduce((sum, city) => sum + city.population, 0), journey.state.cities.reduce((sum, city) => sum + city.population, 0));
    const source = value.action.sourceCityId; assert.ok(source);
    assert.equal(town(before, source).population - town(journey.state, source).population, 3);
  }
});

await test('local growth explicitly synthetic low wellbeing shortage and over-capacity probes cannot buy residents', () => {
  const value = localGrowthOperationJourney();
  for (const mode of ['wellbeing', 'shortage', 'over-capacity'] as const) {
    const state = structuredClone(value.completed); const city = town(state);
    if (mode === 'wellbeing') city.wellbeing = 0;
    if (mode === 'shortage') {
      civ(state).resources.food = 0;
      for (const owned of state.cities.filter(candidate => candidate.civId === 0)) owned.damage = 100;
    }
    if (mode === 'over-capacity') city.population = 25;
    const before = city.population; const result = nextBeat(state);
    assert.equal(town(result.state).population, before);
    assert.ok(!result.events.some(event => event.type === 'population-growth' && event.tileId === city.tileId));
  }
});

await test('local growth adoption requires caught-up economy and synthetic legacy populations above20 retain their actual base', () => {
  const journey = localGrowthJourney();
  const command = { expectedRevision: journey.beforeRelease.revision, expectedFromReleaseId: journey.beforeRelease.releaseId, targetReleaseId: journey.adopted.releaseId, timestamp: coastalPrefixTime(((journey.beforeRelease.independentTurns?.strategyTicks ?? 0) + 1) * 60) };
  const overdue = applyRelease(journey.beforeRelease, command);
  assert.equal(overdue.ok, false); assert.deepEqual(overdue.state, journey.beforeRelease); assert.deepEqual(overdue.events, []);
  const synthetic = structuredClone(journey.beforeRelease); town(synthetic).population = 27;
  const adopted = applyRelease(synthetic, { ...command, timestamp: coastalPrefixTime((synthetic.independentTurns?.strategyTicks ?? 0) * 60 + 20) });
  assert.ok(adopted.ok, adopted.error); assert.equal(town(adopted.state).population, 27); assert.equal(town(adopted.state).housing?.baseCapacity, 27);
  assert.deepEqual(adopted.state.civilizations, synthetic.civilizations);
});

await test('local growth canonical facts distinguish active completion and exact selected town with detached observations', () => {
  const value = localGrowthOperationJourney();
  const timestamp = coastalPrefixTime((value.completed.independentTurns?.strategyTicks ?? 0) * 60 + 30);
  const active = cityGrowthFacts(value.started, town(value.started));
  assert.equal(active.capacity, 20); assert.deepEqual(active.sources, []);
  const expected = { cityId: 'city-0', ruleVersion: 1, population: 20, baseCapacity: 20, sources: [{ buildingId: 'granary', capacity: 4 }], capacity: 24, nextGrowthFoodCost: 11 };
  assert.deepEqual(cityGrowthFacts(value.completed, town(value.completed)), expected);
  const before = structuredClone(value.completed);
  const observation = observe(value.completed, 0, timestamp);
  const projection = projectCapabilities(value.completed, 0, 'city-0', timestamp);
  assert.deepEqual(projection.growth, expected);
  assert.deepEqual(observation.growth?.find(facts => facts.cityId === 'city-0'), expected);
  assert.deepEqual(observation.growth?.map(facts => facts.cityId), value.completed.cities.filter(city => city.civId === 0).map(city => city.id));
  assert.equal(projectCapabilities(value.completed, 0, 'city-1', timestamp).growth, null);
  assert.equal(projectCapabilities(value.completed, 0, 'missing', timestamp).growth, null);
  assert.equal(observe(value.completed, DIRECTOR_SEAT, timestamp).growth?.length, value.completed.cities.length);
  assert.ok(projection.growth && observation.growth?.[0]);
  const source = projection.growth.sources[0]; assert.ok(source); source.capacity = 999;
  observation.growth[0].capacity = 999;
  assert.deepEqual(value.completed, before);
  assert.deepEqual(cityGrowthFacts(value.completed, town(value.completed)), expected);
  assert.equal('growth' in observe(value.journey.beforeRelease, 0, timestamp), false);
  assert.equal('growth' in projectCapabilities(value.journey.beforeRelease, 0, 'city-0', timestamp), false);
});
