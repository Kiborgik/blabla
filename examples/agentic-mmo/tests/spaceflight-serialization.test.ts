import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESOURCE_IDS, SPACEFLIGHT_RULES, TECHNOLOGIES } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { allocateOperations, emitOperations } from '../core/simulation/operations.ts';
import { recordLocalPower } from '../core/simulation/local-power.ts';
import { initializeSpaceflight, launchMarsMission, resolveSpaceflight } from '../core/simulation/spaceflight.ts';
import { RELEASES } from '../core/release.ts';
import { isWorldState } from '../core/validation.ts';
import type { GameEvent, Resources, WorldState } from '../core/types.ts';

function syntheticDepartedWorld(): WorldState {
  const state = createWorld(1701);
  state.unlockedFeatures.push(SPACEFLIGHT_RULES.featureId, 'local-power', 'building-operations', 'resident-capacity');
  const civ = state.civilizations[0]!; const city = state.cities[0]!;
  civ.era = 5; civ.technologies = ['spaceflight']; civ.strategicResources = { coal: 10 };
  civ.resources = Object.fromEntries(RESOURCE_IDS.map(resource => [resource, 1000])) as Resources;
  city.population = 15; city.buildings = ['coal-plant', 'launchpad'];
  city.buildingOperations = Object.fromEntries(city.buildings.map(id => [id, { enabled: true, lastResult: null }]));
  initializeSpaceflight(state); state.revision += 1;
  const events: GameEvent[] = []; allocateOperations(state); emitOperations(state, city, events); recordLocalPower(state, city, events); commitEvents(state, events);
  state.revision += 1; const departure: GameEvent[] = []; launchMarsMission(state, 0, { type: 'expedition', cityId: city.id, mission: 'settle' }, departure); commitEvents(state, departure);
  return state;
}

function beat(state: WorldState): GameEvent[] {
  state.round += 1; state.revision += 1; const events: GameEvent[] = [];
  resolveSpaceflight(state, events); commitEvents(state, events); return events;
}

void test('synthetic JSON restart mid-flight reproduces identical arrival, remote payments and shortage receipts', () => {
  const original = syntheticDepartedWorld(); beat(original); beat(original);
  const restarted = JSON.parse(JSON.stringify(original)) as WorldState;
  for (let count = 0; count < 12; count += 1) {
    assert.deepEqual(beat(restarted), beat(original)); assert.deepEqual(restarted, original);
  }
  assert.equal(original.spaceflight!.civilizations[0]!.missionsLaunched, 1);
  assert.equal(original.spaceflight!.civilizations[0]!.activeMission, null);
  assert.equal(original.eventCounts['mars-arrived'], 1); assert.equal(original.eventCounts['mars-departed'], 1);
});

void test('synthetic durable arrival and once-per-round upkeep survive event-window pruning and restart', () => {
  const state = syntheticDepartedWorld();
  for (let count = 0; count < SPACEFLIGHT_RULES.flightRounds; count += 1) beat(state);
  const ledger = state.spaceflight!.civilizations[0]!; const arrival = structuredClone(ledger.lastArrival);
  state.events = []; const restarted = JSON.parse(JSON.stringify(state)) as WorldState;
  const before = structuredClone(restarted); const events: GameEvent[] = []; resolveSpaceflight(restarted, events);
  assert.deepEqual(restarted, before); assert.deepEqual(events, []);
  beat(restarted); assert.deepEqual(restarted.spaceflight!.civilizations[0]!.lastArrival, arrival);
  assert.equal(restarted.eventCounts['mars-arrived'], 1); assert.equal(restarted.spaceflight!.civilizations[0]!.lastUpkeep?.round, restarted.round);
});

void test('synthetic source-stock changes after restart cannot change prepaid off-world manifests', () => {
  const state = syntheticDepartedWorld(); const mission = structuredClone(state.spaceflight!.civilizations[0]!.activeMission); assert.ok(mission);
  const restarted = JSON.parse(JSON.stringify(state)) as WorldState;
  restarted.civilizations[0]!.resources = { food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 };
  for (let count = 0; count < SPACEFLIGHT_RULES.flightRounds; count += 1) beat(restarted);
  assert.deepEqual(restarted.spaceflight!.civilizations[0]!.lastDeparture, mission);
  assert.deepEqual(restarted.spaceflight!.civilizations[0]!.lastArrival?.cargo, mission.cargo);
  assert.deepEqual(restarted.civilizations[0]!.resources, { food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 });
});

function syntheticValidatedDeparture(): WorldState {
  const epoch = '2026-10-22T00:00:00.000Z';
  const target = RELEASES.find(release => release.featureIds.includes(SPACEFLIGHT_RULES.featureId)); assert.ok(target);
  const state = createWorld(1701, epoch, target.id);
  assert.equal(state.releaseId, target.id);
  const civilization = state.civilizations[0]!; const city = state.cities[0]!;
  civilization.era = 5;
  const completed: string[] = [];
  const complete = (id: string): void => {
    if (completed.includes(id)) return;
    const definition = TECHNOLOGIES.find(technology => technology.id === id); assert.ok(definition);
    for (const prerequisite of definition.requires) complete(prerequisite);
    completed.push(id);
  };
  complete('spaceflight'); civilization.technologies = completed;
  civilization.resources = Object.fromEntries(RESOURCE_IDS.map(resource => [resource, 1000])) as Resources;
  civilization.strategicResources = { coal: 10 }; city.population = 15;
  const site = state.tiles.find(tile => tile.owner === 0 && tile.id !== city.tileId && tile.terrain !== 'ocean' && tile.terrain !== 'mountain'); assert.ok(site);
  city.buildings = ['industrial-zone', 'coal-plant', 'launchpad']; city.districtSites = { 'industrial-zone': site.id };
  city.buildingOperations = Object.fromEntries(['coal-plant', 'launchpad'].map(id => [id, { enabled: true, lastResult: null }]));
  state.revision += 1; const operations: GameEvent[] = [];
  allocateOperations(state); emitOperations(state, city, operations); recordLocalPower(state, city, operations); commitEvents(state, operations);
  assert.ok(isWorldState(state), 'The explicitly synthetic preparation must otherwise be a valid durable state');
  state.revision += 1; const events: GameEvent[] = [];
  launchMarsMission(state, 0, { type: 'expedition', cityId: city.id, mission: 'settle' }, events); commitEvents(state, events);
  assert.ok(isWorldState(state), 'The paid departure must satisfy canonical persistence validation');
  return state;
}

void test('synthetic registered-release manifest and every finite lifecycle frame survive strict WorldState JSON validation', () => {
  const state = syntheticValidatedDeparture();
  for (let count = 0; count < 12; count += 1) {
    assert.ok(isWorldState(JSON.parse(JSON.stringify(state))), `Invalid saved round ${state.round}`);
    beat(state);
  }
});

void test('synthetic canonical validation rejects forged manifests, settlement counters and receipt linkage', () => {
  const state = syntheticValidatedDeparture();
  const mutations: Array<[string, (world: WorldState) => void]> = [
    ['missing layer', world => { delete world.spaceflight; }],
    ['wrong ledger version', world => { Reflect.set(world.spaceflight!, 'ruleVersion', 2); }],
    ['extra civilization', world => { world.spaceflight!.civilizations.push(structuredClone(world.spaceflight!.civilizations[0]!)); }],
    ['free cargo', world => { world.spaceflight!.civilizations[0]!.activeMission!.cargo.food! += 1; }],
    ['partial payment', world => { world.spaceflight!.civilizations[0]!.activeMission!.paid.materials! -= 1; }],
    ['instant arrival', world => { world.spaceflight!.civilizations[0]!.activeMission!.arrivalRound = world.round; }],
    ['extra settlers', world => { world.spaceflight!.civilizations[0]!.activeMission!.settlers += 1; }],
    ['foreign source', world => { world.spaceflight!.civilizations[0]!.activeMission!.sourceCityId = 'city-1'; }],
    ['changed mission identity', world => { world.spaceflight!.civilizations[0]!.activeMission!.id = 'mars-0-999'; }],
    ['unpaid population delta', world => { world.spaceflight!.civilizations[0]!.activeMission!.sourcePopulationAfter += 1; }],
    ['missing departure proof', world => { world.spaceflight!.civilizations[0]!.lastDeparture = null; }],
    ['missing in-transit payload', world => { world.spaceflight!.civilizations[0]!.activeMission = null; }],
    ['population without arrival', world => { world.civilizations[0]!.marsPopulation = 3; }],
    ['progress without paid work', world => { world.civilizations[0]!.marsProgress = 100; }],
    ['streak without upkeep', world => { world.civilizations[0]!.marsSupplyStreak = 3; }],
    ['equivocated event', world => { world.events.find(event => event.marsDeparture)!.marsDeparture!.cargo.energy! += 1; }],
    ['valid-shaped equivocated departure population', world => { const receipt = world.events.find(event => event.marsDeparture)!.marsDeparture!; receipt.sourcePopulationBefore += 1; receipt.sourcePopulationAfter += 1; }],
    ['unreleased layer', world => { world.unlockedFeatures = world.unlockedFeatures.filter(feature => feature !== SPACEFLIGHT_RULES.featureId); }],
  ];
  for (const [label, mutate] of mutations) { const altered = structuredClone(state); mutate(altered); assert.equal(isWorldState(altered), false, label); }
});

void test('synthetic canonical validation rejects negative reserves and fabricated remote payments or habitat progress', () => {
  const state = syntheticValidatedDeparture();
  for (let count = 0; count < SPACEFLIGHT_RULES.flightRounds; count += 1) beat(state);
  assert.ok(isWorldState(state));
  const mutations: Array<[string, (world: WorldState) => void]> = [
    ['negative reserves', world => { world.spaceflight!.civilizations[0]!.colony!.stock.food = -1; }],
    ['unearned reserve credit', world => { world.spaceflight!.civilizations[0]!.colony!.stock.materials += 1; }],
    ['unpaid upkeep', world => { world.spaceflight!.civilizations[0]!.lastUpkeep!.paid = {}; }],
    ['false habitat completion', world => { world.spaceflight!.civilizations[0]!.lastHabitatWork!.progressAfter = 100; }],
    ['free habitat work', world => { world.spaceflight!.civilizations[0]!.lastHabitatWork!.paid = {}; }],
    ['invented supply streak', world => { world.civilizations[0]!.marsSupplyStreak = 3; }],
    ['unearned terminal outcome', world => { world.outcome = { kind: 'mars', winners: [0], round: world.round, reason: 'Unpaid synthetic outcome' }; }],
  ];
  for (const [label, mutate] of mutations) { const altered = structuredClone(state); mutate(altered); assert.equal(isWorldState(altered), false, label); }
});

function mirrorMarsReceipts(state: WorldState): void {
  const ledger = state.spaceflight!.civilizations[0]!;
  for (const event of state.events) {
    if (event.id === ledger.lastArrival?.eventId) event.marsArrival = structuredClone(ledger.lastArrival);
    if (event.id === ledger.lastUpkeep?.eventId) event.marsUpkeep = structuredClone(ledger.lastUpkeep);
    if (event.id === ledger.lastHabitatWork?.eventId) event.marsHabitat = structuredClone(ledger.lastHabitatWork);
  }
}

void test('synthetic canonical validation links same-round arrival reserves and settlers to coherently mirrored upkeep', () => {
  const state = syntheticValidatedDeparture();
  for (let count = 0; count < SPACEFLIGHT_RULES.flightRounds; count += 1) beat(state);
  assert.ok(isWorldState(state));
  const mutations: Array<[string, (world: WorldState) => void]> = [
    ['undelivered food inserted between arrival and upkeep', world => {
      const ledger = world.spaceflight!.civilizations[0]!;
      ledger.colony!.stock.food += 100;
      ledger.lastUpkeep!.stockBefore.food += 100; ledger.lastUpkeep!.stockAfter.food += 100;
    }],
    ['arrived settler disappears before fully funded upkeep', world => {
      const ledger = world.spaceflight!.civilizations[0]!;
      world.civilizations[0]!.marsPopulation = 2;
      ledger.lastUpkeep!.populationBefore = 2; ledger.lastUpkeep!.populationAfter = 2;
    }],
    ['first support invents a previous supply beat', world => { world.spaceflight!.civilizations[0]!.lastUpkeep!.supplyStreakBefore = 1; }],
    ['first support invents a previous shortage', world => { world.spaceflight!.civilizations[0]!.lastUpkeep!.shortageRoundsBefore = 1; }],
  ];
  for (const [label, mutate] of mutations) {
    const altered = structuredClone(state); mutate(altered); mirrorMarsReceipts(altered);
    assert.equal(isWorldState(altered), false, label);
    altered.events = []; assert.equal(isWorldState(altered), false, `${label} after event pruning`);
  }
});

void test('synthetic canonical validation refuses preexisting first-settlement stock even when every later snapshot agrees', () => {
  const state = syntheticValidatedDeparture();
  for (let count = 0; count < SPACEFLIGHT_RULES.flightRounds; count += 1) beat(state);
  assert.ok(isWorldState(state));
  const ledger = state.spaceflight!.civilizations[0]!;
  for (const stock of [ledger.lastArrival!.stockBefore, ledger.lastArrival!.stockAfter, ledger.lastUpkeep!.stockBefore, ledger.lastUpkeep!.stockAfter, ledger.colony!.stock]) stock.food += 100;
  mirrorMarsReceipts(state);
  assert.equal(isWorldState(state), false);
  state.events = []; assert.equal(isWorldState(state), false);
});

void test('synthetic canonical validation rejects coherently mirrored early habitat and premature sustained outcome', () => {
  const landing = syntheticValidatedDeparture();
  for (let count = 0; count < SPACEFLIGHT_RULES.flightRounds; count += 1) beat(landing);
  assert.ok(isWorldState(landing));
  const earlyHabitat = structuredClone(landing); const ledger = earlyHabitat.spaceflight!.civilizations[0]!;
  ledger.lastHabitatWork!.progressBefore = 75; ledger.lastHabitatWork!.progressAfter = 100;
  earlyHabitat.civilizations[0]!.marsProgress = 100; mirrorMarsReceipts(earlyHabitat);
  assert.equal(isWorldState(earlyHabitat), false, 'Three earlier habitat recipes were never paid');
  earlyHabitat.events = []; assert.equal(isWorldState(earlyHabitat), false, 'Pruning cannot manufacture earlier paid habitat work');
  for (let count = 0; count < 4; count += 1) beat(landing);
  assert.equal(landing.round, 8); assert.equal(landing.civilizations[0]!.marsSupplyStreak, 1); assert.ok(isWorldState(landing));
  const contradictoryPrior = structuredClone(landing); beat(contradictoryPrior); assert.ok(isWorldState(contradictoryPrior));
  const prior = contradictoryPrior.spaceflight!.civilizations[0]!.lastUpkeep!;
  assert.equal(prior.supplyStreakBefore, 1); prior.shortageRoundsBefore = 1; mirrorMarsReceipts(contradictoryPrior);
  assert.equal(isWorldState(contradictoryPrior), false, 'A preceding supply streak and preceding shortage cannot coexist');
  contradictoryPrior.events = []; assert.equal(isWorldState(contradictoryPrior), false);
  const upkeep = landing.spaceflight!.civilizations[0]!.lastUpkeep!;
  upkeep.supplyStreakBefore = 2; upkeep.supplyStreakAfter = 3; landing.civilizations[0]!.marsSupplyStreak = 3;
  landing.outcome = { kind: 'mars', winners: [0], round: landing.round, reason: 'Forged early streak' };
  mirrorMarsReceipts(landing);
  assert.equal(isWorldState(landing), false, 'One habitable beat cannot stand in for three funded consecutive rounds');
  landing.events = []; assert.equal(isWorldState(landing), false, 'Pruning cannot accelerate the sustained outcome');
});

void test('synthetic strictly validated paid resupply restart reaches a real sustained outcome with bounded retained receipts', () => {
  const state = syntheticValidatedDeparture();
  for (let count = 0; count < SPACEFLIGHT_RULES.flightRounds; count += 1) beat(state);
  const city = state.cities[0]!; state.revision += 1; const operations: GameEvent[] = [];
  allocateOperations(state); emitOperations(state, city, operations); recordLocalPower(state, city, operations); commitEvents(state, operations);
  state.revision += 1; const events: GameEvent[] = [];
  launchMarsMission(state, 0, { type: 'expedition', cityId: city.id, mission: 'resupply' }, events); commitEvents(state, events);
  assert.ok(isWorldState(state));
  state.events = []; const restarted = JSON.parse(JSON.stringify(state)) as WorldState;
  for (let count = 0; count < 8 && !state.outcome; count += 1) {
    assert.ok(isWorldState(state)); assert.ok(isWorldState(restarted));
    assert.deepEqual(beat(restarted), beat(state)); assert.deepEqual(restarted, state);
  }
  assert.equal(state.outcome?.kind, 'mars'); assert.equal(state.outcome?.round, 10); assert.deepEqual(state.outcome?.winners, [0]);
  assert.ok(isWorldState(state)); assert.ok(isWorldState(restarted));
  assert.equal(state.spaceflight!.civilizations[0]!.missionsLaunched, 2);
  assert.equal(state.spaceflight!.civilizations[0]!.activeMission, null);
  assert.equal(state.civilizations[0]!.marsSupplyStreak, 3);
});
