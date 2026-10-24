import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, legalActions } from '../core/engine.ts';
import { IMPROVEMENTS, TECHNOLOGIES } from '../core/content.ts';
import { projectCapabilities } from '../core/capabilities.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, replayCoastalStep } from './fixtures/coastal-prefix.ts';
import { waterLandTown } from './fixtures/water-land-journey.ts';
import { forestProductionJourney, forestProductionOperationJourney } from './fixtures/forest-production-journey.ts';

await test('forest fresh selected rules require Archery before Machinery', () => {
  const value = forestProductionJourney();
  assert.equal(value.prepared.releaseId, 'settlement-forest-production-1');
  assert.equal(value.initial.revision, 0);
  assert.ok(legalActions(value.state, 0, value.time()).some(option => option.action.type === 'research' && option.action.technology === 'archery'));
  assert.ok(!legalActions(value.state, 0, value.time()).some(option => option.action.type === 'research' && option.action.technology === 'machinery'));
});

await test('forest actual data retains accepted science prerequisites and paid site recipe', () => {
  assert.deepEqual(TECHNOLOGIES.find(value => value.id === 'archery')?.requires, ['animal-husbandry']);
  assert.equal(TECHNOLOGIES.find(value => value.id === 'archery')?.cost, 72);
  assert.deepEqual(TECHNOLOGIES.find(value => value.id === 'machinery')?.requires.toSorted(), ['archery', 'engineering']);
  assert.equal(TECHNOLOGIES.find(value => value.id === 'machinery')?.cost, 234);
  const mill = IMPROVEMENTS.find(value => value.id === 'lumber-mill'); assert.ok(mill);
  assert.equal(mill.requiredWork, 6); assert.equal(mill.residentsRequired, 1); assert.deepEqual(mill.production, { materials: 4 }); assert.deepEqual(mill.cost, { materials: 10, credits: 5 });
});

await test('forest legal Archery Machinery exact Lumber mill produces only after completion', context => {
  const value = forestProductionOperationJourney(); const order = waterLandTown(value.started, value.cityId).construction?.active;
  assert.ok(order && 'kind' in order && order.kind === 'improvement'); assert.equal(order.tileId, 56); assert.equal(order.improvementId, 'lumber-mill');
  assert.equal(order.workRequired, 6); assert.deepEqual(order.paid, { materials: 10, credits: 5 });
  assert.equal(waterLandTown(value.completed, value.cityId).improvements?.['56']?.operation.lastResult, null);
  const result = waterLandTown(value.operated, value.cityId).improvements?.['56']?.operation.lastResult; assert.ok(result);
  assert.equal(result.status, 'operated'); assert.equal(result.residents.allocated, 1); assert.deepEqual(result.paid, {}); assert.ok((result.produced.materials ?? 0) > 0); assert.equal(result.extraction, undefined);
  const control = structuredClone(value.completionStep.before); const city = waterLandTown(control, value.cityId); assert.ok(city.construction); city.construction.active = null;
  const noCompletion = replayCoastalStep(control, structuredClone(value.completionStep.input)); assert.ok(noCompletion.ok);
  assert.deepEqual(noCompletion.state.civilizations[0]?.resources, value.completed.civilizations[0]?.resources);
  context.diagnostic(JSON.stringify({ transitions: value.journey.steps.length, round: value.operated.round, result }));
});

await test('forest exact invalid and occupied sites refuse without payment beside a legal positive', () => {
  const value = forestProductionOperationJourney(); const state = value.ready;
  const timestamp = coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 30);
  assert.ok(legalActions(state, 0, timestamp).some(option => option.action.type === 'improve' && option.action.improvementId === 'lumber-mill' && option.action.tileId === 56 && option.action.cityId === value.cityId));
  for (const [cityId, tileId] of [['city-0', 57], ['city-0', 39], ['city-0', 74], ['city-0', 47], ['city-1', 56], ['missing', 56]] as const) {
    const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp, action: { type: 'improve', cityId, tileId, improvementId: 'lumber-mill' } });
    assert.equal(result.ok, false); assert.deepEqual(result.state, state); assert.deepEqual(result.events, []);
  }
});

await test('forest synthetic low elevation does not turn the forest requirement into a hill requirement', () => {
  const value = forestProductionOperationJourney(); const state = structuredClone(value.ready);
  const site = state.tiles.find(tile => tile.id === value.tileId); assert.ok(site); site.elevation = 20;
  const timestamp = coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 30);
  assert.ok(legalActions(state, 0, timestamp).some(option => option.action.type === 'improve' && option.action.cityId === value.cityId && option.action.improvementId === 'lumber-mill' && option.action.tileId === value.tileId));
  assert.ok(!legalActions(state, 0, timestamp).some(option => option.action.type === 'improve' && option.action.improvementId === 'mine' && option.action.tileId === value.tileId));
});

await test('forest legal Lumber mill and Mine share numeric allocation under synthetic remaining-resident scarcity', () => {
  const value = forestProductionOperationJourney(); const journey = value.journey;
  journey.act({ type: 'improve', cityId: value.cityId, tileId: 58, improvementId: 'mine' });
  journey.until(() => !!waterLandTown(journey.state, value.cityId).improvements?.['58']);
  const state = structuredClone(journey.state); const city = waterLandTown(state, value.cityId); city.population = 4;
  for (const operation of Object.values(city.buildingOperations ?? {})) operation.enabled = false;
  allocateOperations(state);
  assert.equal(city.improvements?.['56']?.operation.lastResult?.residents.allocated, 1);
  assert.equal(city.improvements?.['58']?.operation.lastResult?.blockedReason, 'resident-shortage');
  const mill = city.improvements?.['56']; assert.ok(mill); mill.operation.enabled = false;
  allocateOperations(state); assert.equal(mill.operation.lastResult?.residents.allocated, 0);
  assert.equal(city.improvements?.['58']?.operation.lastResult?.residents.allocated, 1);
});

await test('forest real pause resume and detached exact installed projection', () => {
  const value = forestProductionOperationJourney();
  value.journey.act({ type: 'set-improvement-operation', cityId: value.cityId, tileId: value.tileId, improvementId: 'lumber-mill', enabled: false }); value.journey.beat();
  const paused = waterLandTown(value.journey.state, value.cityId).improvements?.['56']?.operation.lastResult; assert.ok(paused); assert.equal(paused.status, 'paused'); assert.equal(paused.residents.allocated, 0); assert.deepEqual(paused.produced, {});
  value.journey.act({ type: 'set-improvement-operation', cityId: value.cityId, tileId: value.tileId, improvementId: 'lumber-mill', enabled: true }); value.journey.beat();
  const state = value.journey.state; const before = structuredClone(state); const projection = projectCapabilities(state, 0, value.cityId, value.journey.time());
  const installed = projection.improvements?.find(row => row.nodeId === 'improvement:lumber-mill')?.installed.find(site => site.tileId === 56); assert.ok(installed);
  assert.equal(installed.operation.lastResult?.status, 'operated'); installed.operation.enabled = false; assert.deepEqual(state, before);
});

await test('forest synthetic opening scarcity and later terrain loss leave retained sites without output', () => {
  const value = forestProductionOperationJourney(); const state = structuredClone(value.operated); const city = waterLandTown(state, value.cityId); city.population = 3;
  for (const operation of Object.values(city.buildingOperations ?? {})) operation.enabled = false;
  allocateOperations(state); const mill = city.improvements?.['56']; assert.ok(mill);
  assert.equal(mill.operation.lastResult?.blockedReason, 'resident-shortage'); assert.equal(mill.operation.lastResult?.residents.allocated, 0); assert.deepEqual(mill.operation.lastResult?.produced, {});
  city.population = 4;
  allocateOperations(state); assert.equal(mill.operation.lastResult?.residents.allocated, 1);
  const site = state.tiles.find(tile => tile.id === 56); assert.ok(site); site.terrain = 'grassland';
  allocateOperations(state); assert.equal(mill.operation.lastResult?.blockedReason, 'site-ineligible'); assert.equal(mill.operation.lastResult?.residents.allocated, 0); assert.deepEqual(mill.operation.lastResult?.produced, {});
});

await test('forest actual productive branch replays from declared synthetic prerequisites', () => {
  const value = forestProductionOperationJourney(); let state = structuredClone(value.journey.initial);
  for (const step of value.journey.steps) { assert.deepEqual(state, step.before); const before = structuredClone(state); const result = replayCoastalStep(state, structuredClone(step.input)); assert.deepEqual(state, before); assert.deepEqual(result, step.result); assert.ok(isWorldState(result.state)); state = result.state; }
  assert.deepEqual(state, value.operated);
});
