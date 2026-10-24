import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IMPROVEMENTS, RESOURCE_IDS, SPACEFLIGHT_RULES, VICTORY_RULES } from '../core/content.ts';
import { applyCommand, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { FOOD_BUDGET_RULES } from '../core/food-security-content.ts';
import { cityFoodProductivity, civilizationFoodUpkeep, forecastCityFoodProduction, forecastCivilizationFoodProduction, householdFoodUpkeep } from '../core/simulation/food-security.ts';
import { applyDirectorEvent, executeAction } from '../core/simulation/commands.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { adoptGovernment } from '../core/simulation/government.ts';
import { availableImprovementSites, installImprovement } from '../core/simulation/improvements.ts';
import { allocateOperations, emitOperations } from '../core/simulation/operations.ts';
import { recordLocalPower } from '../core/simulation/local-power.ts';
import { initializeSpaceflight, launchMarsMission, quoteMarsMission, resolveSpaceflight } from '../core/simulation/spaceflight.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import { isWorldState } from '../core/validation.ts';
import type { City, GameEvent, Resources, WorldState } from '../core/types.ts';

const epoch = '2026-10-22T00:00:00.000Z';
const round2 = (value: number): number => Math.round(value * 100) / 100;
const world = (budget = true): WorldState => createGeneratedWorld(73, epoch, budget ? 'settlement-food-budget-1' : 'settlement-regional-targets-1');
function beat(state: WorldState): GameEvent[] { state.round++; state.revision++; const events: GameEvent[] = []; resolveEconomy(state, events); commitEvents(state, events); return events; }
function irrigation(city: City): void { city.buildings.push('irrigation'); city.buildingOperations ??= {}; city.buildingOperations.irrigation = { enabled: true, lastResult: null }; }
function pasture(state: WorldState, city: City): number {
  state.civilizations[city.civId]!.technologies.push('animal-husbandry');
  const definition = IMPROVEMENTS.find(item => item.id === 'pasture')!;
  const tileId = availableImprovementSites(state, city, definition)[0]; assert.notEqual(tileId, undefined);
  city.construction ??= { active: null, lastCompleted: null };
  installImprovement(state, city, { kind: 'improvement', id: 'synthetic-pasture', cityId: city.id, improvementId: 'pasture', tileId: tileId!, ruleVersion: 1, startedRound: state.round, paid: { ...definition.cost }, workRequired: definition.requiredWork, workDone: definition.requiredWork }, []);
  return tileId!;
}
function matureEmber(): WorldState {
  const state = world(); const capital = state.cities.find(city => city.civId === 2)!;
  capital.population = 24; capital.wellbeing = 100; capital.focus = 'industry'; capital.buildings = ['farm', 'granary', 'water-mill']; irrigation(capital);
  const site = state.tiles.find(tile => tile.id === capital.tileId)!; site.terrain = 'grassland'; site.resource = 'food';
  for (let index = 0; index < 2; index++) {
    const tile = state.tiles.find(tile => tile.owner === 2 && tile.id !== capital.tileId && !state.cities.some(city => city.tileId === tile.id))!;
    tile.terrain = 'forest'; tile.resource = 'food';
    state.cities.push({ ...structuredClone(capital), id: `synthetic-ember-${index}`, tileId: tile.id, population: 12, buildings: ['farm', 'granary'], buildingOperations: {}, housing: { ruleVersion: 1, baseCapacity: 8, establishedRound: 0, origin: 'founded' } });
  }
  state.civilizations[2]!.resources.materials = 100; state.civilizations[2]!.resources.energy = 100;
  return state;
}

void test('new generated non-growth capital has the source-derived safe three-beat start without free Food', () => {
  let state = world(); const capitalId = state.cities[0]!.id; state.cities[0]!.focus = 'research';
  assert.equal(state.civilizations[0]!.resources.food, 30);
  for (const [index, food, population, produced, required, growthPaid] of [[1, 23.55, 7, 8.05, 7.5, 7], [2, 15.92, 8, 8.12, 8.75, 7], [3, 14.11, 8, 8.19, 10, 0]]) {
    const result = catchUpStrategy(state, new Date(Date.parse(epoch) + index! * 60_000).toISOString()); assert.ok(result.ok, result.error); state = result.state;
    const city = state.cities.find(city => city.id === capitalId)!;
    assert.equal(state.civilizations[0]!.resources.food, food); assert.equal(city.population, population);
    assert.equal(city.lastFoodSupply?.produced, produced); assert.equal(city.lastFoodSupply?.required, required); assert.equal(city.lastFoodSupply?.paid, required); assert.equal(city.lastFoodSupply?.growthPaid, growthPaid);
    assert.ok(!result.events.some(event => event.type === 'supply-shortage' && event.actor === 0));
  }
});

void test('synthetic poor-site population3 pays real meals and retains0.85 without a Food grant', () => {
  const state = world(); const city = state.cities[0]!; city.population = 3; city.focus = 'research';
  const tile = state.tiles.find(tile => tile.id === city.tileId)!; tile.terrain = 'desert'; tile.resource = null;
  state.civilizations[0]!.resources.food = 0;
  assert.equal(forecastCityFoodProduction(state, city), 4.6); assert.equal(householdFoodUpkeep(state, 3), 3.75);
  beat(state); assert.equal(state.civilizations[0]!.resources.food, 0.85); assert.equal(city.population, 3); assert.equal(city.lastFoodSupply?.supplied, true);
});

void test('infrastructure amplification is removed only for Food; old release retains exact coefficients', () => {
  const budget = world(); const old = world(false);
  for (const state of [budget, old]) { const city = state.cities[0]!; city.population = 20; city.wellbeing = 63; city.damage = 17; city.infrastructure = 7; city.focus = 'research'; }
  const city = budget.cities[0]!;
  assert.equal(cityFoodProductivity(budget, city), (0.5 + 0.63) * (1 - 0.17));
  assert.equal(cityFoodProductivity(old, old.cities[0]!), cityProductivity(old.cities[0]!));
  assert.equal(householdFoodUpkeep(old, 20), 10); assert.equal(householdFoodUpkeep(budget, 20), 25);
  const beforeNew = structuredClone(budget.civilizations[0]!.resources); const beforeOld = structuredClone(old.civilizations[0]!.resources);
  beat(budget); beat(old);
  for (const resource of RESOURCE_IDS.filter(resource => resource !== 'food')) assert.equal(round2(budget.civilizations[0]!.resources[resource] - beforeNew[resource]), round2(old.civilizations[0]!.resources[resource] - beforeOld[resource]), resource);
  assert.equal(budget.cities[0]!.lastFoodSupply?.produced, round2(7 * 1.13 * 0.83));
  assert.equal(Object.hasOwn(old.cities[0]!, 'lastFoodSupply'), false);
});

void test('Food forecasts and cumulative paid Irrigation and staffed Pasture receipts agree at awkward hundredths', () => {
  const state = world(); const city = state.cities.find(city => city.civId === 1)!; city.population = 7; city.wellbeing = 67; city.damage = 13; city.infrastructure = 9; city.focus = 'research'; irrigation(city);
  const tileId = pasture(state, city); assert.equal(tileId, 65); state.civilizations[1]!.resources.materials = 1; state.civilizations[1]!.resources.food = 0;
  const before = structuredClone(state); const forecast = forecastCityFoodProduction(state, city); assert.deepEqual(state, before);
  const multiplier = 1.17 * 0.87; const base = round2(7 * multiplier); const paid = round2(12 * multiplier); const total = round2(14 * multiplier);
  assert.equal(forecast, total); beat(state);
  assert.equal(city.lastFoodSupply?.produced, total);
  assert.deepEqual(city.buildingOperations!.irrigation!.lastResult!.paid, { materials: 1 });
  assert.equal(city.buildingOperations!.irrigation!.lastResult!.residents?.allocated, 3);
  assert.equal(city.buildingOperations!.irrigation!.lastResult!.produced.food, round2(paid - base));
  assert.equal(city.improvements![String(tileId)]!.operation.lastResult!.residents.allocated, 1);
  assert.equal(city.improvements![String(tileId)]!.operation.lastResult!.produced.food, round2(total - paid));
});

void test('forecast rechecks actual inputs, local labor, and pauses rather than trusting an old operated Pasture receipt', () => {
  const state = world(); const city = state.cities.find(city => city.civId === 1)!; city.population = 7; city.focus = 'research'; irrigation(city); const tileId = pasture(state, city); assert.equal(tileId, 65);
  allocateOperations(state); assert.equal(city.improvements![String(tileId)]!.operation.lastResult!.status, 'operated');
  city.population = 6;
  assert.equal(forecastCityFoodProduction(state, city), 13.8);
  city.buildingOperations!.irrigation!.enabled = false;
  assert.equal(forecastCityFoodProduction(state, city), 10.35);
  city.buildingOperations!.irrigation!.enabled = true; state.civilizations[1]!.resources.materials = 0;
  assert.equal(forecastCityFoodProduction(state, city), 10.35);
  city.improvements![String(tileId)]!.operation.enabled = false;
  assert.equal(forecastCityFoodProduction(state, city), 8.05);
});

void test('shortages retain required and actually deducted household Food separately without another headline event', () => {
  const state = world(); const city = state.cities[0]!; city.population = 20; city.focus = 'research'; state.civilizations[0]!.resources.food = 1;
  const events = beat(state); const receipt = city.lastFoodSupply!;
  assert.equal(receipt.required, 25); assert.equal(receipt.paid, 9.05); assert.equal(receipt.foodBefore, 1); assert.equal(receipt.foodAfter, 0); assert.equal(receipt.growthPaid, 0); assert.equal(receipt.supplied, false);
  assert.equal(events.filter(event => event.type === 'settlement-production').length, 5);
  assert.ok(events.filter(event => event.type === 'settlement-production').every(event => event.importance === 1));
});

void test('ordinary quake35 produces the source-derived20.01 deficit and canonical repairs recover without Food minting', () => {
  const state = matureEmber(); const cities = state.cities.filter(city => city.civId === 2); const actor = state.civilizations[2]!;
  assert.equal(civilizationFoodUpkeep(state, 2), 60); assert.equal(forecastCivilizationFoodProduction(state, 2), 61.5);
  applyDirectorEvent(state, 'earthquake', 2, []); assert.ok(cities.every(city => city.damage === 35));
  assert.equal(forecastCivilizationFoodProduction(state, 2), 39.99);
  const opening = { ...actor.resources };
  for (const city of cities) executeAction(state, 2, { type: 'repair-city', cityId: city.id }, []);
  assert.equal(actor.resources.materials, opening.materials - 15); assert.equal(actor.resources.energy, opening.energy - 6); assert.equal(actor.resources.food, opening.food);
  assert.equal(forecastCivilizationFoodProduction(state, 2), 55.35);
  irrigation(cities[1]!); assert.equal(forecastCivilizationFoodProduction(state, 2), 62.1);
  const normal = matureEmber(); applyDirectorEvent(normal, 'earthquake', 2, []);
  for (let round = 0; round < 2; round++) for (const city of normal.cities.filter(city => city.civId === 2)) executeAction(normal, 2, { type: 'repair-city', cityId: city.id }, []);
  assert.equal(forecastCivilizationFoodProduction(normal, 2), 61.5);
});

void test('unchanged no-feature snapshots replay byte-equivalently and new receipt catchup is idempotent', () => {
  for (const budget of [false, true]) {
    const initial = world(budget); const restored = JSON.parse(JSON.stringify(initial)) as WorldState;
    const timestamp = new Date(Date.parse(epoch) + 180_000).toISOString();
    const first = catchUpStrategy(initial, timestamp); const replayed = catchUpStrategy(restored, timestamp);
    assert.ok(first.ok, first.error); assert.deepEqual(first, replayed); assert.deepEqual(catchUpStrategy(first.state, timestamp).state, first.state);
    assert.ok(first.state.cities.every(city => Object.hasOwn(city, 'lastFoodSupply') === budget));
  }
});

void test('Food-budget feature leaves actual prepaid Mars18/24 manifests and separate colony upkeep unchanged', () => {
  const old = createWorld(41); old.unlockedFeatures.push('interplanetary-logistics', 'local-power', 'building-operations', 'resident-capacity');
  const city = old.cities[0]!; const actor = old.civilizations[0]!;
  actor.era = 5; actor.technologies = ['spaceflight']; actor.strategicResources = { coal: 100 }; actor.resources = Object.fromEntries(RESOURCE_IDS.map(resource => [resource, 1000])) as Resources;
  city.population = 15; city.buildings = ['coal-plant', 'launchpad']; city.buildingOperations = Object.fromEntries(city.buildings.map(id => [id, { enabled: true, lastResult: null }]));
  initializeSpaceflight(old); old.revision++; const operationEvents: GameEvent[] = []; allocateOperations(old); emitOperations(old, city, operationEvents); recordLocalPower(old, city, operationEvents); commitEvents(old, operationEvents);
  const budget = structuredClone(old); budget.unlockedFeatures.push(FOOD_BUDGET_RULES.featureId);
  assert.deepEqual(quoteMarsMission(budget, 0, city.id, 'settle'), quoteMarsMission(old, 0, city.id, 'settle'));
  for (const state of [old, budget]) {
    const quote = quoteMarsMission(state, 0, city.id, 'settle'); assert.ok(quote); assert.equal(quote.totalCost.food, 18);
    state.revision++; launchMarsMission(state, 0, { type: 'expedition', cityId: city.id, mission: 'settle' }, []);
    state.round += SPACEFLIGHT_RULES.flightRounds; state.revision++; resolveSpaceflight(state, []);
    assert.deepEqual(state.spaceflight!.civilizations[0]!.lastUpkeep?.required, VICTORY_RULES.mars.upkeep);
    state.revision++; const events: GameEvent[] = []; allocateOperations(state); emitOperations(state, state.cities[0]!, events); recordLocalPower(state, state.cities[0]!, events);
    const resupply = quoteMarsMission(state, 0, city.id, 'resupply'); assert.ok(resupply); assert.equal(resupply.totalCost.food, 24);
    state.revision++; launchMarsMission(state, 0, { type: 'expedition', cityId: city.id, mission: 'resupply' }, []);
  }
  assert.deepEqual(budget.spaceflight, old.spaceflight); assert.deepEqual(budget.civilizations, old.civilizations);
});

void test('strict meal receipts reject false rule, amounts and subcent production while retaining historical population after legal founding', () => {
  const initial = world(); initial.cities[0]!.focus = 'research';
  const timestamp = new Date(Date.parse(epoch) + 60_000).toISOString();
  const caught = catchUpStrategy(initial, timestamp); assert.ok(caught.ok, caught.error); const state = caught.state;
  assert.ok(isWorldState(state)); const receipt = structuredClone(state.cities[0]!.lastFoodSupply!);
  assert.equal(receipt.population, 6); assert.equal(state.cities[0]!.population, 7);
  const mutations: Array<[string, (value: Record<string, unknown>) => void]> = [
    ['wrong rule identity', value => { value.foodRule = 'legacy-food-1'; }],
    ['unknown schema version', value => { value.ruleVersion = 2; }],
    ['wrong required meals', value => { value.required = Number(value.required) + 0.01; }],
    ['invented actual payment', value => { value.paid = Number(value.paid) + 0.01; }],
    ['false supplied status', value => { value.supplied = !value.supplied; }],
    ['wrong resulting stock', value => { value.foodAfter = Number(value.foodAfter) + 0.01; }],
    ['wrong growth cost', value => { value.growthPaid = Number(value.growthPaid) + 1; }],
    ['future receipt', value => { value.round = state.round + 1; }],
    ['unexpected field', value => { value.ignored = true; }],
    ['subcent production hidden in opening stock', value => { value.produced = Number(value.produced) + 0.001; value.foodBefore = Number(value.foodBefore) - 0.001; }],
  ];
  for (const [name, mutate] of mutations) {
    const invalid = structuredClone(state); mutate(invalid.cities[0]!.lastFoodSupply as unknown as Record<string, unknown>); assert.equal(isWorldState(invalid), false, name);
  }
  const founding = legalActions(state, 0, timestamp).find(option => option.action.type === 'settle' && option.action.sourceCityId === state.cities[0]!.id); assert.ok(founding);
  const settled = applyCommand(state, { seat: 0, action: founding.action, expectedRevision: state.revision, timestamp }); assert.ok(settled.ok, settled.error);
  assert.equal(settled.state.cities[0]!.population, 4); assert.deepEqual(settled.state.cities[0]!.lastFoodSupply, receipt); assert.ok(isWorldState(settled.state));
  const oldCaught = catchUpStrategy(world(false), timestamp); assert.ok(oldCaught.ok, oldCaught.error); assert.ok(isWorldState(oldCaught.state));
  oldCaught.state.cities[0]!.lastFoodSupply = receipt; assert.equal(isWorldState(oldCaught.state), false);
});

void test('next-opening forecast matches just-accepted, in-progress and completed government transitions without input mutation', () => {
  const state = world(); const city = state.cities[0]!; const actor = state.civilizations[0]!;
  city.focus = 'research'; actor.resources.credits = 100; actor.resources.food = 20;
  actor.civics!.completedCivicIds = ['code-of-laws', 'political-philosophy'];
  adoptGovernment(state, 0, 'chiefdom', [], []); state.round = 4;
  adoptGovernment(state, 0, 'autocracy', [], []);
  assert.equal(actor.government?.pending?.acceptedRound, 4); assert.equal(actor.government?.pending?.completionRound, 6);
  assert.equal(civilizationFoodUpkeep(state, 0), 7.5);
  assert.ok(actor.resources.food >= 7.5 * 1.5 && actor.resources.food < 7.5 * 4);
  for (const [phase, expected] of [['just accepted', 6.9], ['in progress', 6.96], ['completed', 8.19]] as const) {
    const before = structuredClone(state);
    assert.equal(forecastCityFoodProduction(state, city), expected, phase);
    assert.equal(forecastCivilizationFoodProduction(state, 0), expected, phase);
    assert.deepEqual(state, before, phase);
    beat(state); assert.equal(city.lastFoodSupply?.produced, expected, phase);
  }
  assert.equal(actor.government?.pending, null); assert.equal(actor.government?.active?.governmentId, 'autocracy');
});
