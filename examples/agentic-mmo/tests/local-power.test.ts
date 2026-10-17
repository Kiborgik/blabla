import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, CONSTRUCTION_RULES, validateContent } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { allocateOperations, paidRecipe } from '../core/simulation/operations.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import type { BuildingDefinition, GameEvent, WorldState } from '../core/types.ts';

function syntheticTown(population = 9): WorldState {
  const state = createWorld(41);
  state.unlockedFeatures.push('building-operations', 'resident-capacity', 'local-power');
  const city = state.cities[0]; assert.ok(city);
  city.population = population;
  city.buildings = ['coal-plant', 'factory'];
  city.buildingOperations = Object.fromEntries(city.buildings.map(id => [id, { enabled: true, lastResult: null }]));
  state.cities = [city];
  const civilization = state.civilizations.find(item => item.id === city.civId); assert.ok(civilization);
  civilization.strategicResources = { coal: 2 };
  return state;
}

void test('local Power catalogue preserves exact accepted costs, recipes and work', () => {
  const plant = BUILDINGS.find(item => item.id === 'coal-plant'); const factory = BUILDINGS.find(item => item.id === 'factory');
  assert.ok(plant, 'Accepted Coal plant is missing'); assert.ok(factory, 'Accepted Factory is missing');
  for (const building of [plant, factory]) {
    assert.deepEqual(building.requires, ['industrialization']); assert.deepEqual(building.requiresBuildings, ['industrial-zone']);
    assert.equal(building.minEra, 3); assert.ok(building.requiredFeatures.includes('local-power'));
    assert.equal(Reflect.get(CONSTRUCTION_RULES.requiredWork, building.id), 18);
  }
  assert.deepEqual(plant.cost, { materials: 38, credits: 22 }); assert.deepEqual(plant.strategicInputs, { coal: 2 });
  assert.equal(plant.localPowerOutput, 8); assert.equal(plant.emissionsPerOperation, 4); assert.deepEqual(plant.production, {});
  assert.deepEqual(factory.cost, { materials: 40, credits: 24 }); assert.equal(factory.localPowerInput, 3); assert.deepEqual(factory.production, { materials: 12 });
  assert.deepEqual(validateContent(), []);
});

void test('data-driven paid recipes recognize Coal-only generators and Power-only consumers', () => {
  const base = BUILDINGS[0]; assert.ok(base);
  const generator: BuildingDefinition = { ...base, operatingInputs: {}, strategicInputs: { coal: 2 }, localPowerOutput: 8 };
  const consumer: BuildingDefinition = { ...base, operatingInputs: {}, localPowerInput: 3 };
  assert.equal(paidRecipe(generator), true); assert.equal(paidRecipe(consumer), true);
});

void test('synthetic local allocation pays full Coal and same-town Power with six residents', () => {
  const state = syntheticTown(); allocateOperations(state); const city = state.cities[0]; assert.ok(city);
  assert.equal(state.civilizations[0]?.strategicResources?.coal, 0);
  assert.equal(city.buildingOperations?.['coal-plant']?.lastResult?.status, 'operated');
  assert.deepEqual(city.buildingOperations?.['coal-plant']?.lastResult?.strategicPaid, { coal: 2 });
  assert.equal(city.buildingOperations?.factory?.lastResult?.status, 'operated');
  assert.equal(city.buildingOperations?.factory?.lastResult?.localPower?.consumed, 3);
  assert.equal(city.buildingOperations?.factory?.lastResult?.residents?.available, 3);
});

void test('synthetic generators reserve residents before earlier ordinary building IDs', () => {
  const state = syntheticTown(); const city = state.cities[0]; assert.ok(city?.buildingOperations);
  const civilization = state.civilizations[0]; assert.ok(civilization); civilization.resources.culture = 2;
  city.buildings.push('academy'); city.buildingOperations.academy = { enabled: true, lastResult: null };
  allocateOperations(state);
  assert.equal(city.buildingOperations['coal-plant']?.lastResult?.residents?.available, 6);
  assert.equal(city.buildingOperations.academy.lastResult?.status, 'operated');
  assert.equal(city.buildingOperations.factory?.lastResult?.status, 'blocked');
  assert.equal(city.buildingOperations.factory?.lastResult?.localPower?.consumed, 0);
});

void test('synthetic opening Coal and resident shortages never partly pay a generator or consumer', () => {
  for (const coal of [0, 1]) {
    const state = syntheticTown(); const civilization = state.civilizations[0]; assert.ok(civilization);
    civilization.strategicResources = { coal }; const before = structuredClone(civilization.resources); allocateOperations(state);
    assert.equal(civilization.strategicResources.coal, coal); assert.deepEqual(civilization.resources, before);
    for (const operation of Object.values(state.cities[0]?.buildingOperations ?? {})) { assert.equal(operation.lastResult?.status, 'blocked'); assert.deepEqual(operation.lastResult?.paid, {}); assert.equal(operation.lastResult?.residents?.allocated, 0); }
  }
  const state = syntheticTown(6); allocateOperations(state);
  assert.equal(state.cities[0]?.buildingOperations?.factory?.lastResult?.status, 'blocked');
  assert.equal(state.cities[0]?.buildingOperations?.factory?.lastResult?.localPower?.consumed, 0);
});

void test('synthetic unused generation expires honestly and retained receipts cannot fund the next beat', () => {
  const state = syntheticTown(); const city = state.cities[0]; assert.ok(city?.buildingOperations?.factory);
  city.buildingOperations.factory.enabled = false; const events: GameEvent[] = []; resolveEconomy(state, events);
  assert.equal(city.localPower?.lastBeat?.generated, 8); assert.equal(city.localPower?.lastBeat?.consumed, 0); assert.equal(city.localPower?.lastBeat?.expired, 8);
  assert.equal(city.localPower?.lastProductiveBeat, null); assert.equal(city.localPower?.lastBeat?.operations[0]?.result.emissionsProduced, 4);
  city.buildingOperations.factory.enabled = true; state.round += 1; resolveEconomy(state, []);
  assert.equal(city.buildingOperations.factory.lastResult?.status, 'blocked'); assert.equal(city.localPower?.lastBeat?.generated, 0);
});

import { localPowerJourney } from './fixtures/local-power-journey.ts';
void test('one legal industrial continuation constructs a paid plant and Factory then records a positive same-town consumer', context => {
  const journey = localPowerJourney(); const town = journey.productive.cities.find(city => city.id === journey.cityId); const proof = town?.localPower?.lastProductiveBeat;
  assert.ok(proof); assert.equal(proof.generated, 8); assert.equal(proof.consumed, 3); assert.equal(proof.expired, 5);
  assert.ok((proof.operations.find(operation => operation.buildingId === 'factory')?.result.produced.materials ?? 0) > 0);
  assert.deepEqual(journey.adopted.civilizations, journey.beforeRelease.civilizations);
  assert.deepEqual(journey.adopted.coalDeposits, journey.beforeRelease.coalDeposits); assert.deepEqual(journey.adopted.industrialEvidence, journey.beforeRelease.industrialEvidence);
  assert.equal(journey.plantCompleted.cities.find(city => city.id === journey.cityId)?.buildingOperations?.['coal-plant']?.lastResult, null);
  assert.equal(journey.factoryCompleted.cities.find(city => city.id === journey.cityId)?.buildingOperations?.factory?.lastResult, null);
  assert.deepEqual(journey.unused.cities.find(city => city.id === journey.cityId)?.localPower?.lastProductiveBeat, proof);
  assert.equal(journey.unused.cities.find(city => city.id === journey.cityId)?.localPower?.lastBeat?.expired, 8);
  assert.equal(journey.state.year, journey.beforeRelease.year); assert.equal(journey.state.clockTicks, journey.beforeRelease.clockTicks);
  context.diagnostic(JSON.stringify({ steps: journey.steps.length, cityId: journey.cityId, proof, retainedBytes: Buffer.byteLength(JSON.stringify(town?.localPower)) }));
});

void test('synthetic later powered consumer cannot partly spend remaining Power or other inputs', () => {
  const factory = BUILDINGS.find(building => building.id === 'factory'); assert.ok(factory);
  for (const funded of [false, true]) {
    const state = syntheticTown(12); const city = state.cities[0]; const civilization = state.civilizations[0]; assert.ok(city?.buildingOperations && civilization);
    const extra: BuildingDefinition = { ...factory, id: 'aa-synthetic-consumer', operatingInputs: { energy: 2 }, strategicInputs: { iron: 1 }, localPowerInput: 6 };
    city.buildings.push(extra.id); city.buildingOperations[extra.id] = { enabled: true, lastResult: null };
    civilization.resources.energy = funded ? 2 : 1; civilization.strategicResources = { coal: 2, iron: 1 };
    BUILDINGS.push(extra);
    try {
      allocateOperations(state); const result = city.buildingOperations[extra.id]?.lastResult; assert.ok(result);
      assert.equal(result.localPower?.availableBefore, 8);
      assert.equal(result.localPower?.consumed, funded ? 6 : 0);
      assert.equal(result.residents?.allocated, funded ? 3 : 0);
      assert.equal(civilization.strategicResources.iron, funded ? 0 : 1);
      assert.equal(civilization.resources.energy, funded ? 0 : 1);
      assert.equal(city.buildingOperations.factory?.lastResult?.status, funded ? 'blocked' : 'operated');
      assert.equal(city.buildingOperations.factory?.lastResult?.localPower?.consumed, funded ? 0 : 3);
      if (funded) assert.deepEqual(city.buildingOperations.factory?.lastResult?.paid, {});
    } finally { const index = BUILDINGS.indexOf(extra); if (index >= 0) BUILDINGS.splice(index, 1); }
  }
});

void test('synthetic fractional productivity preserves cumulative Materials rounding and fixed Power conversion', () => {
  const state = syntheticTown(); const city = state.cities[0]; assert.ok(city);
  city.wellbeing = 0.3; city.infrastructure = 0; city.damage = 0; city.focus = 'research';
  const tile = state.tiles.find(candidate => candidate.id === city.tileId); assert.ok(tile); tile.resource = 'food';
  resolveEconomy(state, []);
  const result = city.buildingOperations?.factory?.lastResult; assert.ok(result);
  assert.equal(result.produced.materials, 6.03); assert.notEqual(result.produced.materials, Math.round(12 * 0.503 * 100) / 100);
  assert.equal(result.localPower?.consumed, 3); assert.equal(city.localPower?.lastBeat?.generated, 8);
  assert.equal(city.localPower?.lastBeat?.operations[0]?.result.emissionsProduced, 4);
});

import { projectCapabilities } from '../core/capabilities.ts';
import { observe } from '../core/engine.ts';
void test('canonical observation and selected-town projection retain current and positive Power receipts without mutation', () => {
  const journey = localPowerJourney(); const before = structuredClone(journey.unused);
  const observation = observe(journey.unused, journey.seat, journey.time());
  const projection = projectCapabilities(journey.unused, journey.seat, journey.cityId, journey.time());
  assert.deepEqual(projection.localPower, journey.unused.cities.find(city => city.id === journey.cityId)?.localPower);
  assert.equal(observation.buildingRecipes?.find(recipe => recipe.buildingId === 'coal-plant')?.localPowerOutput, 8);
  assert.equal(observation.buildingRecipes?.find(recipe => recipe.buildingId === 'factory')?.localPowerInput, 3);
  assert.equal(projection.localPower?.lastBeat?.expired, 8); assert.equal(projection.localPower?.lastProductiveBeat?.consumed, 3);
  if (projection.localPower?.lastBeat) projection.localPower.lastBeat.expired = 999;
  assert.deepEqual(journey.unused, before);
});
