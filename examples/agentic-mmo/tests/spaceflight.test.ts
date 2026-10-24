import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESOURCE_IDS, SPACEFLIGHT_RULES, VICTORY_RULES } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { allocateOperations, emitOperations } from '../core/simulation/operations.ts';
import { recordLocalPower } from '../core/simulation/local-power.ts';
import { availableSpaceMissions, initializeSpaceflight, launchMarsMission, quoteMarsMission, resolveSpaceflight, spaceflightActionBlock } from '../core/simulation/spaceflight.ts';
import type { GameAction, GameEvent, Resources, WorldState } from '../core/types.ts';

type Expedition = Extract<GameAction, { type: 'expedition' }>;
const settlement = (seat = 0): Expedition => ({ type: 'expedition', cityId: `city-${seat}`, mission: 'settle' });
const resupply = (seat = 0): Expedition => ({ type: 'expedition', cityId: `city-${seat}`, mission: 'resupply' });

function operate(state: WorldState): void {
  const events: GameEvent[] = [];
  state.revision += 1;
  allocateOperations(state);
  for (const city of state.cities) { emitOperations(state, city, events); recordLocalPower(state, city, events); }
  commitEvents(state, events);
}

function syntheticLaunchWorld(seats = [0]): WorldState {
  const state = createWorld(41);
  state.unlockedFeatures.push('interplanetary-logistics', 'local-power', 'building-operations', 'resident-capacity');
  for (const seat of seats) {
    const civ = state.civilizations[seat]; const city = state.cities.find(candidate => candidate.civId === seat);
    assert.ok(civ && city);
    civ.era = 5; civ.technologies = ['spaceflight']; civ.strategicResources = { coal: 100 };
    civ.resources = Object.fromEntries(RESOURCE_IDS.map(resource => [resource, 1000])) as Resources;
    city.population = 15; city.buildings = ['coal-plant', 'launchpad'];
    city.buildingOperations = Object.fromEntries(city.buildings.map(id => [id, { enabled: true, lastResult: null }]));
  }
  initializeSpaceflight(state); operate(state);
  return state;
}

function launch(state: WorldState, action = settlement(), seat = 0): GameEvent[] {
  state.revision += 1;
  const events: GameEvent[] = [];
  launchMarsMission(state, seat, action, events); commitEvents(state, events);
  return events;
}

function beat(state: WorldState): GameEvent[] {
  state.round += 1; state.revision += 1;
  const events: GameEvent[] = [];
  resolveSpaceflight(state, events); commitEvents(state, events);
  return events;
}

function people(state: WorldState): number {
  return state.cities.reduce((sum, city) => sum + city.population, 0)
    + state.civilizations.reduce((sum, civ) => sum + civ.marsPopulation, 0)
    + (state.spaceflight?.civilizations.reduce((sum, civ) => sum + (civ.activeMission?.settlers ?? 0), 0) ?? 0);
}

void test('synthetic preflight needs earned ground tools, not an already existing colony or calendar date', () => {
  const state = syntheticLaunchWorld();
  assert.equal(state.year, -10000);
  assert.equal(state.spaceflight?.civilizations[0]?.colony, null);
  const quote = quoteMarsMission(state, 0, 'city-0', 'settle'); assert.ok(quote);
  assert.equal(quote.arrivalRound - quote.departureRound, SPACEFLIGHT_RULES.flightRounds);
  assert.equal(quote.settlers, SPACEFLIGHT_RULES.settlers);
  assert.deepEqual(quote.cargo, SPACEFLIGHT_RULES.settle.cargo);
  assert.equal(availableSpaceMissions(state, 0).length, 1);
  assert.equal(quoteMarsMission(state, 0, 'city-0', 'resupply'), null);
});

void test('synthetic launch rejections have no payment, people, manifest or event side effects', () => {
  const cases: Array<[string, (state: WorldState) => void, Expedition, number]> = [
    ['unreleased', state => { state.unlockedFeatures = state.unlockedFeatures.filter(id => id !== SPACEFLIGHT_RULES.featureId); }, settlement(), 0],
    ['missing ledger', state => { delete state.spaceflight; }, settlement(), 0],
    ['wrong source', () => {}, settlement(1), 0],
    ['unknown actor', () => {}, settlement(), 99],
    ['early stage', state => { state.civilizations[0]!.era = 4; }, settlement(), 0],
    ['missing research', state => { state.civilizations[0]!.technologies = []; }, settlement(), 0],
    ['unfinished launch complex', state => { state.cities[0]!.buildings = ['coal-plant']; }, settlement(), 0],
    ['paused operation', state => { state.cities[0]!.buildingOperations!.launchpad!.enabled = false; }, settlement(), 0],
    ['stale powered receipt', state => { state.round += 1; }, settlement(), 0],
    ['insufficient local power', state => { state.cities[0]!.buildingOperations!.launchpad!.lastResult!.localPower!.consumed = 1; }, settlement(), 0],
    ['source population', state => { state.cities[0]!.population = SPACEFLIGHT_RULES.minimumSourcePopulation + SPACEFLIGHT_RULES.settlers - 1; }, settlement(), 0],
    ['unfunded complete payload', state => { state.civilizations[0]!.resources.materials = SPACEFLIGHT_RULES.settle.launchCost.materials + SPACEFLIGHT_RULES.settle.cargo.materials - 1; }, settlement(), 0],
    ['resupply before colony', () => {}, resupply(), 0],
    ['unsafe due round', state => { state.round = Number.MAX_SAFE_INTEGER; }, settlement(), 0],
    ['terminal world', state => { state.outcome = { kind: 'mars', winners: [1], round: 0, reason: 'Synthetic terminal fixture' }; }, settlement(), 0],
  ];
  for (const [label, mutate, action, seat] of cases) {
    const state = syntheticLaunchWorld(); mutate(state); const before = structuredClone(state); const events: GameEvent[] = [];
    assert.ok(spaceflightActionBlock(state, seat, action), label);
    assert.throws(() => launchMarsMission(state, seat, action, events), RangeError, label);
    assert.deepEqual(state, before, label); assert.deepEqual(events, [], label);
  }
});

void test('synthetic launch pays full immutable manifest once and removes only exact source settlers', () => {
  const state = syntheticLaunchWorld(); const before = structuredClone(state); const count = people(state);
  const quote = quoteMarsMission(state, 0, 'city-0', 'settle'); assert.ok(quote);
  const events = launch(state); const ledger = state.spaceflight!.civilizations[0]!; const mission = ledger.activeMission; assert.ok(mission);
  for (const resource of RESOURCE_IDS) assert.equal(state.civilizations[0]!.resources[resource], before.civilizations[0]!.resources[resource] - (quote.totalCost[resource] ?? 0));
  assert.equal(state.cities[0]!.population, before.cities[0]!.population - quote.settlers);
  assert.deepEqual(state.cities.slice(1), before.cities.slice(1));
  assert.equal(people(state), count); assert.equal(state.civilizations[0]!.marsPopulation, 0);
  assert.equal(state.civilizations[0]!.marsProgress, 0); assert.equal(state.outcome, null);
  assert.deepEqual(mission.paid, quote.totalCost); assert.deepEqual(events[0]?.marsDeparture, mission);
  assert.notEqual(mission.cargo, SPACEFLIGHT_RULES.settle.cargo); assert.notEqual(ledger.lastDeparture, mission);
  quote.cargo.food = 0; events[0]!.marsDeparture!.cargo.food = 0;
  assert.equal(mission.cargo.food, SPACEFLIGHT_RULES.settle.cargo.food);
  const launched = structuredClone(state); const rejected: GameEvent[] = [];
  assert.throws(() => launchMarsMission(state, 0, settlement(), rejected), RangeError);
  assert.deepEqual(state, launched); assert.deepEqual(rejected, []); assert.deepEqual(availableSpaceMissions(state, 0), []);
});

void test('synthetic finite flight lands once from retained cargo after source conditions change', () => {
  const state = syntheticLaunchWorld(); const count = people(state); launch(state);
  state.cities[0]!.buildings = []; state.civilizations[0]!.resources.food = 0;
  for (let index = 1; index < SPACEFLIGHT_RULES.flightRounds; index += 1) {
    beat(state); assert.equal(state.civilizations[0]!.marsPopulation, 0); assert.ok(state.spaceflight!.civilizations[0]!.activeMission); assert.equal(people(state), count);
  }
  const events = beat(state); const ledger = state.spaceflight!.civilizations[0]!;
  assert.equal(ledger.activeMission, null); assert.equal(state.civilizations[0]!.marsPopulation, 3); assert.equal(people(state), count);
  assert.deepEqual(ledger.lastArrival?.cargo, SPACEFLIGHT_RULES.settle.cargo);
  assert.deepEqual(ledger.lastArrival?.stockAfter, { food: 18, materials: 48, energy: 40, credits: 0, science: 0, culture: 0 });
  assert.deepEqual(events.map(event => event.type), ['mars-arrived', 'mars-upkeep', 'mars-habitat-work']);
  assert.equal(state.civilizations[0]!.marsProgress, 25); assert.equal(state.civilizations[0]!.marsSupplyStreak, 0);
  const before = structuredClone(state); resolveSpaceflight(state, []); assert.deepEqual(state, before);
});

void test('synthetic habitat work pays remote inputs after upkeep and habitability cannot count its completion beat', () => {
  const state = syntheticLaunchWorld(); launch(state);
  for (let round = 1; round <= 7; round += 1) beat(state);
  const ledger = state.spaceflight!.civilizations[0]!;
  assert.equal(state.civilizations[0]!.marsProgress, SPACEFLIGHT_RULES.habitat.requiredWork);
  assert.equal(state.civilizations[0]!.marsSupplyStreak, 0);
  assert.deepEqual(ledger.lastHabitatWork?.paid, SPACEFLIGHT_RULES.habitat.costPerBeat);
  assert.equal(ledger.lastHabitatWork?.round, 7); assert.deepEqual(ledger.colony?.stock, { food: 6, materials: 4, energy: 8, credits: 0, science: 0, culture: 0 });
  beat(state); assert.equal(state.civilizations[0]!.marsSupplyStreak, 1);
  beat(state); assert.equal(state.civilizations[0]!.marsSupplyStreak, 2);
  beat(state); assert.equal(state.civilizations[0]!.marsSupplyStreak, 0); assert.equal(state.outcome, null);
  assert.equal(ledger.lastUpkeep?.status, 'shortage'); assert.deepEqual(ledger.lastUpkeep?.paid, {});
});

void test('synthetic shortages never borrow Earth stock, partly pay upkeep, or construct unsupported habitat', () => {
  const state = syntheticLaunchWorld(); launch(state);
  for (let round = 1; round <= 4; round += 1) beat(state);
  const ledger = state.spaceflight!.civilizations[0]!; assert.ok(ledger.colony);
  ledger.colony.stock = { food: 100, materials: 0, energy: 100, credits: 0, science: 0, culture: 0 };
  const stock = structuredClone(ledger.colony.stock); const earth = structuredClone(state.civilizations[0]!.resources);
  beat(state); assert.deepEqual(ledger.colony.stock, stock); assert.deepEqual(state.civilizations[0]!.resources, earth);
  assert.equal(state.civilizations[0]!.marsProgress, 25); assert.equal(state.civilizations[0]!.marsPopulation, 3);
  assert.deepEqual(ledger.lastUpkeep?.missing, { materials: 1 });
  beat(state); assert.equal(state.civilizations[0]!.marsPopulation, 2);
  assert.equal(ledger.lastUpkeep?.populationBefore, 3); assert.equal(ledger.lastUpkeep?.populationAfter, 2);
  for (let round = 0; round < 8; round += 1) beat(state);
  assert.equal(state.civilizations[0]!.marsPopulation, 0); assert.equal(ledger.lastUpkeep?.status, 'uninhabited'); assert.equal(state.civilizations[0]!.marsSupplyStreak, 0);
  assert.ok(RESOURCE_IDS.every(resource => ledger.colony!.stock[resource] >= 0));
});

void test('synthetic paid resupply carries only missing settlers and restores an exhausted colony', () => {
  const state = syntheticLaunchWorld(); launch(state);
  for (let round = 1; round <= 12; round += 1) beat(state);
  const civ = state.civilizations[0]!; assert.equal(civ.marsPopulation, 2);
  operate(state); const quote = quoteMarsMission(state, 0, 'city-0', 'resupply'); assert.ok(quote);
  assert.equal(quote.settlers, 1); assert.deepEqual(quote.cargo, SPACEFLIGHT_RULES.resupply.cargo);
  const population = people(state); launch(state, resupply()); assert.equal(people(state), population);
  for (let round = 0; round < SPACEFLIGHT_RULES.flightRounds; round += 1) beat(state);
  const ledger = state.spaceflight!.civilizations[0]!;
  assert.equal(ledger.lastArrival?.settlers, 1); assert.equal(ledger.lastUpkeep?.status, 'supplied'); assert.equal(ledger.colony?.shortageRounds, 0);
  assert.equal(civ.marsSupplyStreak, 1); assert.equal(state.outcome, null);
  operate(state); const replacements = quoteMarsMission(state, 0, 'city-0', 'resupply'); assert.ok(replacements);
  assert.equal(replacements.settlers, 2); launch(state, resupply());
  for (let round = 0; round < SPACEFLIGHT_RULES.flightRounds; round += 1) beat(state);
  const readOutcome = (world: WorldState): WorldState['outcome'] => world.outcome;
  const outcome = readOutcome(state);
  assert.equal(civ.marsPopulation, 3); assert.equal(outcome?.kind, 'mars'); assert.deepEqual(outcome?.winners, [0]);
});

void test('synthetic timely paid resupply produces all same-beat Mars winners, never first-actor bias', () => {
  const state = syntheticLaunchWorld([0, 1]);
  launch(state, settlement(1), 1); launch(state);
  for (let round = 1; round <= 4; round += 1) beat(state);
  operate(state); launch(state, resupply(1), 1); launch(state, resupply());
  assert.equal(state.spaceflight!.civilizations[0]!.activeMission?.settlers, 0);
  for (let round = 5; round <= 9; round += 1) { beat(state); assert.equal(state.outcome, null); }
  const events = beat(state);
  assert.equal(state.outcome?.kind, 'mars'); assert.deepEqual(state.outcome?.winners, [0, 1]);
  assert.equal(events.filter(event => event.type === 'mars-victory').length, 1);
  for (const seat of [0, 1]) {
    const civ = state.civilizations[seat]!;
    assert.equal(civ.marsPopulation, VICTORY_RULES.mars.population); assert.equal(civ.marsSupplyStreak, VICTORY_RULES.mars.suppliedRounds);
    assert.equal(state.spaceflight!.civilizations[seat]!.lastUpkeep?.round, state.round);
  }
  const before = structuredClone(state); resolveSpaceflight(state, []); assert.deepEqual(state, before);
});

void test('synthetic feature initialization is gated, empty and idempotent without granting resources or counters', () => {
  const state = createWorld(41); const initial = structuredClone(state); initializeSpaceflight(state); assert.deepEqual(state, initial);
  state.unlockedFeatures.push(SPACEFLIGHT_RULES.featureId); const resources = state.civilizations.map(civ => structuredClone(civ.resources));
  initializeSpaceflight(state); assert.equal(state.spaceflight?.civilizations.length, state.civilizations.length);
  assert.deepEqual(state.civilizations.map(civ => civ.resources), resources);
  const before = structuredClone(state); initializeSpaceflight(state); assert.deepEqual(state, before);
});

void test('synthetic habitat cannot spend a partial recipe or reuse its upkeep payment', () => {
  const state = syntheticLaunchWorld(); launch(state);
  for (let round = 1; round <= SPACEFLIGHT_RULES.flightRounds; round += 1) beat(state);
  const ledger = state.spaceflight!.civilizations[0]!; assert.ok(ledger.colony);
  ledger.colony.stock = { food: 3, materials: 10, energy: 8, credits: 0, science: 0, culture: 0 };
  const previousWork = structuredClone(ledger.lastHabitatWork); const events = beat(state);
  assert.equal(ledger.lastUpkeep?.status, 'supplied'); assert.deepEqual(ledger.lastUpkeep?.paid, VICTORY_RULES.mars.upkeep);
  assert.deepEqual(ledger.colony.stock, { food: 0, materials: 9, energy: 4, credits: 0, science: 0, culture: 0 });
  assert.deepEqual(ledger.lastHabitatWork, previousWork); assert.equal(state.civilizations[0]!.marsProgress, 25);
  assert.equal(events.some(event => event.marsHabitat), false);
});
