import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, legalActions, observe } from '../core/engine.ts';
import { projectCapabilities } from '../core/capabilities.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { availableMountainCatchments } from '../core/simulation/water.ts';
import { cityGrowthFacts } from '../core/simulation/growth.ts';
import { BUILDINGS } from '../core/content.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import { isWorldState } from '../core/validation.ts';
import { waterLandOperationJourney, waterLandPastureJourney, waterLandTown } from './fixtures/water-land-journey.ts';
import { coastalPrefixTime, replayCoastalStep } from './fixtures/coastal-prefix.ts';

await test('water land canonical reveal is civilization specific and detached', () => {
  const value = waterLandPastureJourney(); const state = value.revealed;
  const before = structuredClone(state); const timestamp = coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 30);
  assert.deepEqual(observe(state, 0, timestamp).revealedPastoralSites, []);
  const observation = observe(state, 1, timestamp); assert.ok(observation.revealedPastoralSites?.some(site => site.tileId === 47));
  const projection = projectCapabilities(state, 1, 'city-1', timestamp);
  assert.deepEqual(projection.pastoral?.revealedPastoralSites, observation.revealedPastoralSites);
  assert.ok(projection.improvements?.find(row => row.nodeId === 'improvement:pasture')?.availableSites.some(site => site.tileId === 47));
  assert.ok(observation.revealedPastoralSites); observation.revealedPastoralSites.length = 0;
  assert.deepEqual(state, before); assert.ok(projection.pastoral?.revealedPastoralSites?.length);
});

await test('water land synthetic opening resident shortage and later site loss never staff Pasture', () => {
  const value = waterLandPastureJourney(); const scarce = structuredClone(value.operated);
  const city = waterLandTown(scarce, value.cityId); city.population = 6;
  allocateOperations(scarce);
  assert.equal(city.buildingOperations?.library?.lastResult?.residents?.allocated, 3);
  assert.equal(city.improvements?.['47']?.operation.lastResult?.blockedReason, 'resident-shortage');
  assert.equal(city.improvements?.['47']?.operation.lastResult?.residents.allocated, 0);
  assert.deepEqual(city.improvements?.['47']?.operation.lastResult?.produced, {});
  const library = city.buildingOperations?.library; assert.ok(library); library.enabled = false;
  allocateOperations(scarce); assert.equal(city.improvements?.['47']?.operation.lastResult?.residents.allocated, 1);
  const site = scarce.tiles.find(tile => tile.id === 47); assert.ok(site); site.terrain = 'ocean';
  allocateOperations(scarce); assert.equal(city.improvements?.['47']?.operation.lastResult?.blockedReason, 'site-ineligible');
  assert.equal(city.improvements?.['47']?.operation.lastResult?.residents.allocated, 0);
  assert.deepEqual(city.improvements?.['47']?.operation.lastResult?.produced, {});
});

await test('water land legal Mine and Pasture share numeric priority after paid buildings under synthetic scarcity', () => {
  const value = waterLandPastureJourney(); const journey = value.journey;
  journey.research('kiln-firing', 1); journey.research('mining', 1);
  const mine = legalActions(journey.state, 1, journey.time()).find(option => option.action.type === 'improve' && option.action.cityId === value.cityId && option.action.improvementId === 'mine' && option.action.tileId > value.tileId)?.action;
  assert.ok(mine?.type === 'improve'); journey.act(mine, 1);
  journey.until(() => !!waterLandTown(journey.state, value.cityId).improvements?.[String(mine.tileId)]);
  const state = structuredClone(journey.state); const city = waterLandTown(state, value.cityId); city.population = 7;
  allocateOperations(state);
  assert.equal(city.buildingOperations?.library?.lastResult?.residents?.allocated, 3);
  assert.equal(city.improvements?.['47']?.operation.lastResult?.residents.allocated, 1);
  assert.equal(city.improvements?.[String(mine.tileId)]?.operation.lastResult?.blockedReason, 'resident-shortage');
  const pasture = city.improvements?.['47']; assert.ok(pasture); pasture.operation.enabled = false;
  allocateOperations(state);
  assert.equal(pasture.operation.lastResult?.residents.allocated, 0);
  assert.equal(city.improvements?.[String(mine.tileId)]?.operation.lastResult?.residents.allocated, 1);
});

await test('water land actual reveal permits a paid exact pasture with later staffed food', context => {
  const value = waterLandPastureJourney(); const order = waterLandTown(value.started, value.cityId).construction?.active;
  assert.ok(order && 'kind' in order && order.kind === 'improvement');
  assert.equal(order.improvementId, 'pasture'); assert.equal(order.tileId, 47); assert.equal(order.workRequired, 3); assert.deepEqual(order.paid, { materials: 6, credits: 3 });
  assert.equal(waterLandTown(value.completed, value.cityId).improvements?.['47']?.operation.lastResult, null);
  const result = waterLandTown(value.operated, value.cityId).improvements?.['47']?.operation.lastResult; assert.ok(result);
  assert.equal(result.status, 'operated'); assert.equal(result.residents.allocated, 1); assert.deepEqual(result.paid, {}); assert.ok((result.produced.food ?? 0) > 0);
  assert.equal(result.extraction, undefined);
  context.diagnostic(JSON.stringify({ transitions: value.journey.steps.length, round: value.operated.round, result }));
});

await test('water land pasture pauses and resumes through exact legal commands', () => {
  const value = waterLandPastureJourney();
  value.journey.act({ type: 'set-improvement-operation', cityId: value.cityId, tileId: value.tileId, improvementId: 'pasture', enabled: false }, value.seat); value.journey.beat();
  const paused = waterLandTown(value.journey.state, value.cityId).improvements?.['47']?.operation.lastResult; assert.ok(paused);
  assert.equal(paused.status, 'paused'); assert.equal(paused.residents.allocated, 0); assert.deepEqual(paused.produced, {});
  value.journey.act({ type: 'set-improvement-operation', cityId: value.cityId, tileId: value.tileId, improvementId: 'pasture', enabled: true }, value.seat); value.journey.beat();
  assert.equal(waterLandTown(value.journey.state, value.cityId).improvements?.['47']?.operation.lastResult?.status, 'operated');
});

await test('water land a real revealed positive does not authorize absent horse sites or foreign towns', () => {
  const value = waterLandPastureJourney(); const state = value.revealed;
  const timestamp = coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 30);
  assert.ok(legalActions(state, 1, timestamp).some(option => option.action.type === 'improve' && option.action.improvementId === 'pasture' && option.action.cityId === 'city-1' && option.action.tileId === 47));
  for (const [cityId, tileId] of [['city-1', 48], ['city-1', 66], ['city-0', 47], ['missing', 47]] as const) {
    const before = structuredClone(state);
    const result = applyCommand(state, { seat: 1, expectedRevision: state.revision, timestamp, action: { type: 'improve', cityId, tileId, improvementId: 'pasture' } });
    assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(state, before); assert.deepEqual(result.events, []);
  }
});

await test('water land completed irrigation belongs to the exact mill town', () => {
  const value = waterLandOperationJourney(); const state = value.millReady;
  const timestamp = coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 30);
  assert.ok(legalActions(state, 0, timestamp).some(option => option.action.type === 'build' && option.action.project === 'water-mill' && option.action.cityId === 'city-0'));
  assert.ok(!waterLandTown(state, value.journey.previous.aqueduct.cityId).buildings.includes('irrigation'));
  for (const cityId of [value.journey.previous.aqueduct.cityId, 'city-1', 'missing']) {
    const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp, action: { type: 'build', project: 'water-mill', cityId } });
    assert.equal(result.ok, false); assert.deepEqual(result.state, state); assert.deepEqual(result.events, []);
  }
});

await test('water land actual mill and mountain aqueduct share the old construction lane and paid growth boundary', context => {
  const value = waterLandOperationJourney(); const millOrder = waterLandTown(value.millStarted, 'city-0').construction?.active;
  assert.ok(millOrder && !('kind' in millOrder)); assert.equal(millOrder.workRequired, 8); assert.deepEqual(millOrder.paid, { materials: 16, credits: 6 });
  const withoutMill = structuredClone(value.millCompleted);
  const controlTown = waterLandTown(withoutMill, 'city-0');
  controlTown.buildings = controlTown.buildings.filter(id => id !== 'water-mill');
  const control = replayCoastalStep(withoutMill, { kind: 'strategy', timestamp: coastalPrefixTime(((withoutMill.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  assert.ok(control.ok, control.error);
  const mill = BUILDINGS.find(building => building.id === 'water-mill'); assert.ok(mill);
  const productivity = cityProductivity(waterLandTown(value.millCompleted, 'city-0'));
  const outputDelta: Record<string, number> = {};
  for (const resource of ['food', 'materials'] as const) {
    const delta = Math.round(((value.millOperated.civilizations[0]?.resources[resource] ?? 0) - (control.state.civilizations[0]?.resources[resource] ?? 0)) * 100) / 100;
    assert.equal(delta, Math.round((mill.production[resource] ?? 0) * productivity * 100) / 100);
    assert.ok(delta > 0); outputDelta[resource] = delta;
  }
  assert.deepEqual(value.millOperated.cities.map(city => city.population), control.state.cities.map(city => city.population));
  context.diagnostic(JSON.stringify({ syntheticMillOnlyRemovalControl: true, openingProductivity: productivity, laterOutputDelta: outputDelta }));
  const order = waterLandTown(value.aqueductStarted, value.journey.previous.aqueduct.cityId).construction?.active; assert.ok(order && !('kind' in order));
  assert.equal(order.workRequired, 12); assert.deepEqual(order.paid, { materials: 22, credits: 8 });
  assert.equal(order.catchmentTileId, 5); assert.equal(order.tileId, undefined);
  assert.deepEqual(availableMountainCatchments(value.aqueductReady, waterLandTown(value.aqueductReady, value.journey.previous.aqueduct.cityId)), [5, 22, 24]);
  const completion = waterLandTown(value.aqueductCompleted, value.journey.previous.aqueduct.cityId).construction?.lastCompleted; assert.ok(completion && !('kind' in completion));
  assert.equal(completion.catchmentTileId, 5);
  assert.equal(waterLandTown(value.aqueductCompleted, value.journey.previous.aqueduct.cityId).buildingCatchments?.aqueduct, 5);
  assert.deepEqual(waterLandTown(value.aqueductCompleted, value.journey.previous.aqueduct.cityId).districtSites, waterLandTown(value.aqueductReady, value.journey.previous.aqueduct.cityId).districtSites);
  assert.equal(cityGrowthFacts(value.aqueductStarted, waterLandTown(value.aqueductStarted, value.journey.previous.aqueduct.cityId)).capacity, 8);
  assert.equal(cityGrowthFacts(value.aqueductCompleted, waterLandTown(value.aqueductCompleted, value.journey.previous.aqueduct.cityId)).capacity, 14);
  assert.equal(waterLandTown(value.aqueductCompleted, value.journey.previous.aqueduct.cityId).population, 8);
  assert.equal(waterLandTown(value.grown, value.journey.previous.aqueduct.cityId).population, 9);
  assert.ok(value.aqueductCompletionStep.result.events.every(event => !event.populationGrowth || event.populationGrowth.cityId !== value.journey.previous.aqueduct.cityId));
  context.diagnostic(JSON.stringify({ transitions: value.journey.steps.length, round: value.grown.round, aqueduct: waterLandTown(value.aqueductCompleted, value.journey.previous.aqueduct.cityId).construction?.lastCompleted }));
});

await test('water land wrong town and no mountain starts refuse with identical state and no payment', () => {
  const value = waterLandOperationJourney();
  for (const cityId of ['city-0', 'city-1', 'missing']) {
    const state = value.aqueductReady; const timestamp = coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 30);
    assert.ok(legalActions(state, 0, timestamp).some(option => option.action.type === 'build' && option.action.project === 'aqueduct' && option.action.cityId === value.journey.previous.aqueduct.cityId));
    const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp, action: { type: 'build', project: 'aqueduct', cityId } });
    assert.equal(result.ok, false); assert.deepEqual(result.state, state); assert.deepEqual(result.events, []);
  }
});

await test('water land legal later construction preserves the installed Aqueduct source', () => {
  const value = waterLandOperationJourney(); const cityId = value.journey.previous.aqueduct.cityId;
  assert.equal(waterLandTown(value.journey.state, cityId).buildings.includes('farm'), false);
  value.journey.act({ type: 'build', project: 'farm', cityId });
  value.journey.until(() => waterLandTown(value.journey.state, cityId).buildings.includes('farm'));
  const city = waterLandTown(value.journey.state, cityId); const completion = city.construction?.lastCompleted;
  assert.ok(completion && !('kind' in completion)); assert.equal(completion.buildingId, 'farm'); assert.equal(completion.catchmentTileId, undefined);
  assert.equal(city.buildingCatchments?.aqueduct, 5); assert.ok(isWorldState(value.journey.state));
  const projection = projectCapabilities(value.journey.state, 0, cityId, value.journey.time());
  assert.equal(projection.buildings.find(row => row.nodeId === 'building:aqueduct')?.catchment?.retainedTileId, 5);
});

await test('water land completion-beat production equals an explicitly synthetic unfinished-order control', () => {
  const value = waterLandOperationJourney();
  for (const [step, cityId, seat] of [[value.pasture.completionStep, 'city-1', 1], [value.millCompletionStep, 'city-0', 0]] as const) {
    const control = structuredClone(step.before); const city = waterLandTown(control, cityId); assert.ok(city.construction?.active); city.construction.active = null;
    const result = replayCoastalStep(control, structuredClone(step.input)); assert.ok(result.ok, result.error);
    assert.deepEqual(result.state.civilizations[seat]?.resources, step.result.state.civilizations[seat]?.resources);
  }
});

await test('water land explicit synthetic root and actual connected branch replay exactly with canonical frames', () => {
  const value = waterLandOperationJourney(); let state = structuredClone(value.journey.initial);
  for (const step of value.journey.steps) {
    assert.deepEqual(state, step.before); const before = structuredClone(state); const result = replayCoastalStep(state, structuredClone(step.input));
    assert.deepEqual(result, step.result); assert.deepEqual(state, before); assert.ok(isWorldState(result.state)); state = result.state;
  }
  assert.deepEqual(state, value.grown);
});
