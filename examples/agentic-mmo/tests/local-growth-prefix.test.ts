import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { RESOURCE_IDS } from '../core/content.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import type { BuildingOperation, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { localGrowthPrefix } from './fixtures/local-growth-prefix.ts';
import { coastalPrefixTime, replayCoastalStep } from './fixtures/coastal-prefix.ts';

const recipes = ['academy', 'fuel-yard', 'irrigation', 'kiln', 'library'];

await test('synthetic population20 prerequisites operate five paid recipes while a real completed University lacks one resident', context => {
  const prefix = localGrowthPrefix();
  const city = prefix.state.cities.find(city => city.id === prefix.cityId); assert.ok(city);
  assert.equal(prefix.state.releaseId, 'settlement-growth-1'); assert.equal(prefix.initial.revision, 0);
  assert.equal(city.population, 20); assert.deepEqual(city.housing, { ruleVersion: 1, baseCapacity: 20, establishedRound: 0, origin: 'initial-capital' });
  assert.ok(city.buildings.includes('university')); assert.equal(city.construction?.active, null);
  const completed = city.construction?.lastCompleted; assert.ok(completed && !('kind' in completed));
  assert.equal(completed.buildingId, 'university');
  assert.ok(prefix.state.civilizations[0]?.technologies.includes('education'));
  assert.ok(prefix.state.civilizations[0]!.resources.credits > 20);
  for (const [index, id] of recipes.entries()) {
    const operation: BuildingOperation | undefined = city.buildingOperations?.[id]; assert.equal(operation?.enabled, true);
    assert.equal(operation?.lastResult?.status, 'operated');
    assert.equal(operation?.lastResult?.residents?.available, 17 - index * 3);
    assert.equal(operation?.lastResult?.residents?.allocated, 3);
    assert.ok(RESOURCE_IDS.some(resource => (operation?.lastResult?.paid[resource] ?? 0) > 0));
    assert.ok(RESOURCE_IDS.some(resource => (operation?.lastResult?.produced[resource] ?? 0) > 0));
  }
  const university = city.buildingOperations?.university;
  assert.equal(university?.enabled, true); assert.equal(university?.lastResult?.status, 'blocked');
  assert.deepEqual(university?.lastResult?.paid, {}); assert.deepEqual(university?.lastResult?.produced, {});
  assert.deepEqual(university?.lastResult?.shortages, []);
  assert.deepEqual(university?.lastResult?.residents, { ruleVersion: 1, openingPopulation: 20, communityReserve: 3, required: 3, available: 2, allocated: 0 });
  context.diagnostic(JSON.stringify({ basis: 'Explicit synthetic capacity prerequisite; actual paid University construction and subsequent operations', transitions: prefix.steps.length, revision: prefix.state.revision, round: prefix.state.round, cityId: prefix.cityId, university: university?.lastResult }));
});

await test('actual allocator debits opening inputs only and the subsequent canonical beat reports the same resident assignments', () => {
  const prefix = localGrowthPrefix();
  const opening = structuredClone(prefix.blockedBeat.before);
  const allocation = structuredClone(opening);
  allocateOperations(allocation);
  const city = allocation.cities.find(city => city.id === prefix.cityId); assert.ok(city);
  const afterCity = prefix.blockedBeat.result.state.cities.find(city => city.id === prefix.cityId); assert.ok(afterCity);
  for (const id of [...recipes, 'university']) {
    assert.deepEqual(city.buildingOperations?.[id]?.lastResult?.residents, afterCity.buildingOperations?.[id]?.lastResult?.residents);
    assert.deepEqual(city.buildingOperations?.[id]?.lastResult?.paid, afterCity.buildingOperations?.[id]?.lastResult?.paid);
  }
  for (const resource of RESOURCE_IDS) {
    const paid = allocation.cities.filter(city => city.civId === 0).reduce((total, city) => total + Object.values(city.buildingOperations ?? {}).reduce((sum, operation) => sum + (operation.lastResult?.paid[resource] ?? 0), 0), 0);
    assert.ok(Math.abs(opening.civilizations[0]!.resources[resource] - allocation.civilizations[0]!.resources[resource] - paid) < 1e-8);
  }
  assert.deepEqual(prefix.blockedBeat.before, opening);
});

await test('actual University transitions replay canonically from declared synthetic population stocks and technologies', () => {
  const prefix = localGrowthPrefix();
  const restored: unknown = JSON.parse(JSON.stringify(prefix.initial)); assert.ok(isWorldState(restored));
  let state: WorldState = restored;
  for (const step of prefix.steps) {
    assert.deepEqual(state, step.before);
    const before = JSON.stringify(state);
    const result = replayCoastalStep(state, structuredClone(step.input));
    assert.equal(result.ok, true, result.error); assert.deepEqual(result, step.result);
    assert.ok(isWorldState(result.state)); assert.equal(JSON.stringify(state), before);
    state = result.state;
  }
  assert.deepEqual(state, prefix.state);
});

await test('equal current-rule beats retain capacity20 and funded resident blocking without a completed housing addition', () => {
  const prefix = localGrowthPrefix();
  let state = structuredClone(prefix.state);
  const control = structuredClone(prefix.state);
  for (let count = 0; count < 4; count++) {
    const timestamp = coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60);
    const result = catchUpStrategy(state, timestamp); assert.ok(result.ok, result.error);
    assert.equal(result.remainingTicks, 0); assert.ok(isWorldState(result.state));
    state = result.state;
    const city = state.cities.find(city => city.id === prefix.cityId); assert.ok(city);
    assert.equal(city.population, 20); assert.deepEqual(city.housing, { ruleVersion: 1, baseCapacity: 20, establishedRound: 0, origin: 'initial-capital' });
    assert.equal(city.buildingOperations?.university?.lastResult?.status, 'blocked');
    assert.deepEqual(city.buildingOperations?.university?.lastResult?.shortages, []);
    assert.ok(!result.events.some(event => event.type === 'population-growth' && event.tileId === city.tileId));
  }
  assert.deepEqual(prefix.state, control);
});

await test('an explicit real pause demonstrates resident causality against an equal-beat unpaused control', () => {
  const prefix = localGrowthPrefix();
  const action = { type: 'set-building-operation', cityId: prefix.cityId, buildingId: 'irrigation', enabled: false } as const;
  assert.ok(legalActions(prefix.state, 0, prefix.timestamp).some(option => JSON.stringify(option.action) === JSON.stringify(action)));
  const paused = applyCommand(prefix.state, { seat: 0, expectedRevision: prefix.state.revision, timestamp: prefix.timestamp, action });
  assert.ok(paused.ok, paused.error); assert.ok(isWorldState(paused.state));
  const timestamp = coastalPrefixTime(((prefix.state.independentTurns?.strategyTicks ?? 0) + 1) * 60);
  const enabled = catchUpStrategy(structuredClone(prefix.state), timestamp);
  const freed = catchUpStrategy(paused.state, timestamp);
  assert.ok(enabled.ok && freed.ok); assert.ok(isWorldState(freed.state));
  assert.equal(enabled.state.round, freed.state.round);
  const unchanged = enabled.state.cities.find(city => city.id === prefix.cityId);
  const city = freed.state.cities.find(city => city.id === prefix.cityId);
  assert.equal(unchanged?.population, 20); assert.equal(city?.population, 20);
  assert.equal(unchanged?.buildingOperations?.university?.lastResult?.status, 'blocked');
  assert.equal(city?.buildingOperations?.irrigation?.lastResult?.status, 'paused');
  assert.equal(city?.buildingOperations?.university?.lastResult?.status, 'operated');
  assert.deepEqual(city?.buildingOperations?.university?.lastResult?.paid, { credits: 2 });
  assert.ok((city?.buildingOperations?.university?.lastResult?.produced.science ?? 0) > 0);
  assert.equal(prefix.state.cities.find(city => city.id === prefix.cityId)?.buildingOperations?.irrigation?.enabled, true);
});
