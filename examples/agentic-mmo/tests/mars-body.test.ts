import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import { SPACEFLIGHT_RULES } from '../core/content.ts';
import { initializeSpaceflight } from '../core/simulation/spaceflight.ts';
import type { MarsMission, Resources, WorldState } from '../core/types.ts';
import { marsBodyScene, marsSelectionId, projectMarsBody } from '../visuals/mars-body.ts';

function fixture(): WorldState {
  const state = createWorld(41);
  state.unlockedFeatures.push(SPACEFLIGHT_RULES.featureId);
  initializeSpaceflight(state);
  return state;
}
function manifest(): MarsMission {
  return { id: 'mars-0-1', eventId: 'departure-1', ruleVersion: 1, civId: 0, mission: 'settle', sourceCityId: 'city-0',
    departureRound: 4, arrivalRound: 4 + SPACEFLIGHT_RULES.flightRounds, settlers: SPACEFLIGHT_RULES.settlers,
    launchCost: { ...SPACEFLIGHT_RULES.settle.launchCost }, cargo: { ...SPACEFLIGHT_RULES.settle.cargo },
    totalCost: { food: 18, materials: 84, energy: 64, credits: 60 }, paid: { food: 18, materials: 84, energy: 64, credits: 60 }, sourcePopulationBefore: 8, sourcePopulationAfter: 5 };
}
function landed(state: WorldState, population = 3, progress: number = SPACEFLIGHT_RULES.habitat.workPerBeat): void {
  state.civilizations[0]!.marsPopulation = population;
  state.civilizations[0]!.marsProgress = progress;
  state.spaceflight!.civilizations[0]!.colony = { establishedRound: 8, shortageRounds: 0,
    stock: { food: 10, materials: 12, energy: 18, credits: 0, science: 0, culture: 0 } };
  const ledger = state.spaceflight!.civilizations[0]!;
  ledger.lastArrival = { ruleVersion: 1, missionId: 'mars-0-1', civId: 0, sourceCityId: 'city-0', round: 8, eventId: 'arrival', settlers: 3,
    cargo: { ...SPACEFLIGHT_RULES.settle.cargo }, populationBefore: 0, populationAfter: 3, stockBefore: { ...ledger.colony!.stock }, stockAfter: { ...ledger.colony!.stock } };
  ledger.lastHabitatWork = { ruleVersion: 1, civId: 0, round: 8, eventId: 'work', paid: { ...SPACEFLIGHT_RULES.habitat.costPerBeat }, progressBefore: 0, progressAfter: progress };
}

void test('an empty canonical world has no Mars sites people supplies or transport even when Earth is developed', () => {
  const state = fixture(); state.civilizations[0]!.era = 5; state.civilizations[0]!.technologies.push('spaceflight');
  state.civilizations[0]!.marsProgress = SPACEFLIGHT_RULES.habitat.requiredWork;
  const before = structuredClone(state); const observation = projectMarsBody(state); const scene = marsBodyScene(observation);
  assert.deepEqual(state, before); assert.equal(observation.civilizations[0]!.status, 'empty');
  assert.deepEqual(scene.sites, []); assert.deepEqual(scene.transits, []);
  assert.ok(scene.parts.length > 0); assert.ok(scene.parts.every(entry => entry.kind === 'context'));
  assert.match(observation.contextLabel, /illustrative.*not simulated geography/i);
  assert.equal(observation.habitatRequiredWork, SPACEFLIGHT_RULES.habitat.requiredWork);
});

void test('only a retained active manifest draws bounded transit and never landed cargo or colony', () => {
  const state = fixture(); state.round = 6; const mission = manifest();
  state.spaceflight!.civilizations[0]!.activeMission = mission;
  state.spaceflight!.civilizations[0]!.lastDeparture = structuredClone(mission);
  const observation = projectMarsBody(state); const scene = marsBodyScene(observation);
  assert.equal(observation.civilizations[0]!.status, 'in-transit');
  assert.equal(scene.transits.length, 1); assert.equal(scene.sites.length, 0);
  assert.equal(scene.transits[0]!.fraction, .5); assert.equal(scene.transits[0]!.selectionId, marsSelectionId(0));
  assert.match(scene.transits[0]!.label, /in transit.*not landed/i);
  assert.ok(scene.parts.filter(entry => entry.civilizationId === 0).every(entry => entry.kind === 'transit'));
  assert.equal(observation.civilizations[0]!.reserves, null);
  state.round = 999;
  assert.ok(marsBodyScene(projectMarsBody(state)).transits[0]!.fraction < 1);
  state.spaceflight!.civilizations[0]!.activeMission = null;
  assert.equal(marsBodyScene(projectMarsBody(state)).transits.length, 0);
});

void test('projection detaches every canonical receipt manifest and reserve from the world', () => {
  const state = fixture(); landed(state); const ledger = state.spaceflight!.civilizations[0]!;
  ledger.activeMission = manifest();
  ledger.lastArrival = { ruleVersion: 1, missionId: 'arrival', civId: 0, sourceCityId: 'city-0', round: 8, eventId: 'arrival-event',
    settlers: 3, cargo: { food: 18 }, populationBefore: 0, populationAfter: 3, stockBefore: { ...ledger.colony!.stock }, stockAfter: { ...ledger.colony!.stock } };
  const before = structuredClone(state); const observation = projectMarsBody(state); const civ = observation.civilizations[0]!;
  civ.reserves!.food = 999; civ.colony!.stock.materials = 999; civ.mission!.cargo.food = 999; civ.lastArrival!.cargo.food = 999;
  assert.deepEqual(state, before); assert.notEqual(civ.reserves, civ.colony!.stock);
});

void test('paid work inhabitants and delivered reserves drive distinct landed parts with no invented infrastructure', () => {
  const state = fixture(); landed(state); const initial = marsBodyScene(projectMarsBody(state));
  assert.equal(initial.sites.length, 1); assert.equal(initial.sites[0]!.status, 'building');
  assert.equal(initial.parts.filter(entry => entry.kind === 'resident').length, 6);
  assert.ok(initial.parts.some(entry => entry.kind === 'habitat' && entry.part.id.includes('shell')));
  assert.ok(!initial.parts.some(entry => entry.part.id.includes('roof')));
  const anchor = initial.sites[0]!.position;
  state.civilizations[0]!.marsProgress = SPACEFLIGHT_RULES.habitat.requiredWork;
  state.spaceflight!.civilizations[0]!.lastHabitatWork!.progressAfter = SPACEFLIGHT_RULES.habitat.requiredWork;
  const complete = marsBodyScene(projectMarsBody(state));
  assert.equal(complete.sites[0]!.status, 'habitable');
  assert.ok(complete.parts.some(entry => entry.kind === 'habitat' && entry.part.id.includes('roof')));
  assert.deepEqual(complete.sites[0]!.position, anchor);
  const habitatRight = Math.max(...complete.parts.filter(entry => entry.kind === 'habitat').map(entry => entry.part.position[0] + entry.part.scale[0] / 2));
  assert.ok(complete.parts.filter(entry => entry.kind === 'resident').every(entry => entry.part.position[0] - entry.part.scale[0] / 2 > habitatRight));
  assert.ok(complete.parts.filter(entry => entry.kind !== 'context').every(entry => entry.layer === 'recorded'));
  const ground = complete.parts.filter(entry => entry.layer === 'ground');
  assert.ok(ground.length > 5 && new Set(ground.map(entry => entry.color)).size > 3);
  assert.ok(ground.every(entry => entry.part.scale[0] < 18 && entry.part.position[1] + entry.part.scale[1] / 2 < 0));
  state.civilizations[0]!.marsPopulation = 0;
  state.spaceflight!.civilizations[0]!.colony!.stock = { food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 } satisfies Resources;
  const abandoned = marsBodyScene(projectMarsBody(state));
  assert.equal(abandoned.sites[0]!.status, 'uninhabited');
  assert.ok(!abandoned.parts.some(entry => entry.kind === 'resident' || entry.kind === 'reserve' || entry.kind === 'transit'));
  assert.deepEqual(abandoned.sites[0]!.position, anchor);
});

void test('last recorded shortage stays distinct from complete habitat and zero current inhabitants overrides stale support', () => {
  const state = fixture(); landed(state, 2, SPACEFLIGHT_RULES.habitat.requiredWork); const ledger = state.spaceflight!.civilizations[0]!;
  ledger.lastUpkeep = { ruleVersion: 1, civId: 0, round: 9, eventId: 'support-9', status: 'shortage', required: { food: 3 }, paid: {}, missing: { food: 3 },
    stockBefore: { ...ledger.colony!.stock }, stockAfter: { ...ledger.colony!.stock }, populationBefore: 3, populationAfter: 2,
    habitableBefore: true, supplyStreakBefore: 2, supplyStreakAfter: 0, shortageRoundsBefore: 1, shortageRoundsAfter: 2 };
  const observation = projectMarsBody(state);
  assert.equal(observation.civilizations[0]!.status, 'shortage'); assert.equal(observation.civilizations[0]!.habitable, true);
  assert.match(marsBodyScene(observation).sites[0]!.label, /shortage/i);
  state.civilizations[0]!.marsPopulation = 0;
  assert.equal(projectMarsBody(state).civilizations[0]!.status, 'uninhabited');
});

void test('terminal observation retains exact colony and unfinished transport without claiming arrival or future movement', () => {
  const state = fixture(); landed(state); state.round = 6; state.spaceflight!.civilizations[1]!.activeMission = { ...manifest(), civId: 1, id: 'mars-1-1' };
  state.outcome = { kind: 'mars', winners: [0], round: 6, reason: 'Synthetic terminal fixture' };
  const before = structuredClone(state); const observation = projectMarsBody(state); const scene = marsBodyScene(observation);
  assert.equal(observation.terminal, true); assert.match(scene.transits[0]!.label, /in flight at world end; scheduled arrival round.*not landed/i);
  assert.equal(scene.sites.length, 1); assert.equal(scene.transits.length, 1); assert.deepEqual(state, before);
  observation.outcome!.winners.push(2); assert.deepEqual(state.outcome.winners, [0]);
});

void test('scene identity survives reordered civilizations and is independent of Earth locations and ownership', () => {
  const state = fixture(); landed(state); const before = marsBodyScene(projectMarsBody(state));
  state.civilizations.reverse(); state.cities = []; state.tiles = [];
  const after = marsBodyScene(projectMarsBody(state));
  assert.deepEqual(after, before); assert.equal(marsSelectionId(4), 'mars:4');
  const changed = fixture(); landed(changed); changed.seed += 1;
  assert.notDeepEqual(marsBodyScene(projectMarsBody(changed)).sites[0]!.position, before.sites[0]!.position);
});

void test('legacy counters without paid work receipts do not produce a completed habitat', () => {
  const state = fixture(); landed(state, 3, SPACEFLIGHT_RULES.habitat.requiredWork);
  state.spaceflight!.civilizations[0]!.lastHabitatWork = null;
  const observation = projectMarsBody(state); const civ = observation.civilizations[0]!;
  assert.equal(civ.progress, SPACEFLIGHT_RULES.habitat.requiredWork); assert.equal(civ.paidProgress, null); assert.equal(civ.habitable, false);
  assert.ok(!marsBodyScene(observation).parts.some(entry => entry.kind === 'habitat'));
  assert.match(marsBodyScene(observation).sites[0]!.label, /record unavailable/);
});
