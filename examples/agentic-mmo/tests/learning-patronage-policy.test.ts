import assert from 'node:assert/strict';
import test from 'node:test';
import { createPatronagePolicy } from '../core/behavior-patronage.ts';
import { BEHAVIOR_PROFILES } from '../core/behavior-profiles.ts';
import { assessCivilizationBehavior, chooseCivilizationBehavior, createBehaviorMemory } from '../core/behaviors.ts';
import { BUILDINGS, CIVICS } from '../core/content.ts';
import { applyCommand, catchUpStrategy, createWorld } from '../core/engine.ts';
import type { ActionOption, GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { availableGovernmentActions } from '../core/simulation/government.ts';
import { tradeAction } from './fixtures/knowledge-current.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';

const seat = 1;
const profile = BEHAVIOR_PROFILES[seat]!;
const epoch = '2026-10-24T00:00:00.000Z';
const action = (policyId: string): Extract<GameAction, { type: 'adopt-government' }> => ({ type: 'adopt-government', governmentId: 'chiefdom', assignments: [{ policyId, slotType: 'economic', slotIndex: 0 }] });
const options: ActionOption[] = ['learning-patronage', 'urban-planning'].map(id => ({ action: action(id), label: id, reason: 'Conditional current-world comparison, not natural play' }));
let base: WorldState | undefined;
function fixture(urgent = false, project = urgent ? 'farm' : 'granary') {
  if (!base) { const result = catchUpStrategy(createWorld(1701, epoch, 'settlement-learning-patronage-1'), new Date(Date.parse(epoch) + 240000).toISOString()); assert.ok(result.ok, result.error); base = result.state; }
  let state = structuredClone(base);
  let actor = state.civilizations[seat]!; let city = state.cities.find(city => city.civId === seat)!;
  city.population = 6; city.infrastructure = 0; city.wellbeing = 50; city.damage = 0; city.focus = 'growth';
  syntheticTechnologies(state, seat, ['writing', 'engineering']);
  actor.technologies = actor.technologies.filter(id => id !== 'engineering'); actor.era = 1; actor.researchTarget = 'engineering'; actor.researchProgress = 0;
  syntheticInstitution(state, city.id, 'campus'); syntheticInstitution(state, city.id, 'library');
  actor.resources = { food: urgent ? 30 : 100, materials: 0, energy: 100, credits: 100, science: 0, culture: 100 };
  actor.civics!.completedCivicIds = CIVICS.filter(civic => civic.id !== 'political-philosophy').map(civic => civic.id);
  actor.civics!.active = { civicId: 'political-philosophy', startedRound: state.round, progress: 0, requiredCulture: 48 };
  actor.civics!.lastCompleted = { civicId: 'state-workforce', completedRound: state.round, eventId: `${state.revision}:999` };
  actor.civics!.reformEntitlement = { civicId: 'state-workforce', completedRound: state.round, completionEventId: actor.civics!.lastCompleted.eventId };
  actor.government!.active = { governmentId: 'chiefdom', assignments: [], effectiveRound: 0, governmentLockUntilRound: 4, policyLockUntilRound: 4 };
  const building = BUILDINGS.find(item => item.id === project)!; syntheticTechnologies(state, seat, building.requires);
  actor.resources.materials = building.cost.materials ?? 0; actor.resources.credits += building.cost.credits ?? 0;
  const started = applyCommand(state, { seat, expectedRevision: state.revision, timestamp: new Date(Date.parse(epoch) + 260000).toISOString(), action: { type: 'build', cityId: city.id, project } });
  assert.ok(started.ok, started.error); state = started.state; actor = state.civilizations[seat]!; city = state.cities.find(city => city.civId === seat)!;
  assert.ok(isWorldState(state), 'Conditional fixture must remain a valid registered current world');
  return { state, actor, city };
}
function assessed(state: WorldState) {
  return assessCivilizationBehavior(state, seat, createBehaviorMemory(state, seat), options, profile).candidates;
}

void test('funded current learning outranks construction that cannot yet add productive output', () => {
  const { state } = fixture(); const before = structuredClone(state);
  const [learning, urban] = assessed(state);
  assert.ok(learning!.weight > 0);
  assert.ok(learning!.weight > urban!.weight);
  assert.deepEqual(state, before);
});

void test('urgent already-paid productive construction can outweigh the same operating Library', () => {
  const { state } = fixture(true); const before = structuredClone(state);
  const [learning, urban] = assessed(state);
  assert.ok(urban!.weight > 0);
  assert.ok(urban!.weight > learning!.weight);
  assert.deepEqual(state, before);
});

function quote(state: WorldState, policyId = 'learning-patronage') { return createPatronagePolicy(state, seat, profile.resources, profile.priorities)(action(policyId)); }

void test('exact funded Science is quoted without reading a stockpile or mutating current commitments', () => {
  const { state, actor } = fixture(); const before = structuredClone(state); const result = quote(state);
  assert.equal(result.supported, true); assert.equal(result.forecastBeats, 4); assert.equal(result.bonusScience, 3);
  assert.equal(result.marginalOutput.science, 3); assert.equal(result.paidCredits, 0); assert.ok(result.priorityGain > 0);
  assert.match(result.reason, /conditional/); assert.match(result.reason, /opening commitments/);
  assert.deepEqual(state, before);
  actor.resources.science = 100000; assert.deepEqual(quote(state), result);
  assert.deepEqual(quote(JSON.parse(JSON.stringify(state)) as WorldState), result);
});

void test('paused blocked and understaffed learning gives no policy preference even with stored Science', () => {
  for (const mutation of ['paused', 'credits', 'residents'] as const) {
    const { state, actor, city } = fixture(); actor.resources.science = 100000;
    if (mutation === 'paused') city.buildingOperations!.library!.enabled = false;
    if (mutation === 'credits') actor.resources.credits = 0;
    if (mutation === 'residents') city.population = 5;
    const before = structuredClone(state); const result = quote(state);
    assert.equal(result.bonusScience, 0, mutation); assert.equal(assessed(state)[0]!.weight, 0, mutation); assert.deepEqual(state, before);
  }
});

void test('no active research and research finishing from ordinary output do not pretend bonus stock is useful work', () => {
  for (const finish of [false, true]) {
    const { state, actor } = fixture();
    if (finish) actor.researchProgress = 143.9; else actor.researchTarget = '';
    const result = quote(state); assert.equal(result.bonusScience, 3); assert.equal(result.marginalOutput.science, 0);
    assert.equal(result.proposedValue, 0); assert.equal(assessed(state)[0]!.weight, 0);
  }
});

void test('government price and four opening operating recipes cannot borrow the next trade or ordinary income', () => {
  const { state, actor } = fixture(); actor.civics!.reformEntitlement = null; actor.government!.lastSpentReformCompletionEventId = actor.civics!.lastCompleted!.eventId;
  actor.resources.credits = 11.99;
  const before = structuredClone(state); const held = quote(state); assert.equal(held.supported, false); assert.match(held.reason, /opening credits/); assert.deepEqual(state, before);
  actor.resources.credits = 12; const funded = quote(state); assert.equal(funded.supported, true); assert.equal(funded.paidCredits, 8);
  actor.resources.food = 29.99; assert.equal(quote(state).supported, false); assert.match(quote(state).reason, /opening food/);
});

void test('accepted exchange cargo is retained before civic operating support', () => {
  const { state, actor, city } = fixture(); actor.resources.materials = 100;
  tradeAction(state, seat, { type: 'propose-trade', partner: 4, recipeId: 'harvest-for-materials', sourceCityId: city.id, recipientCityId: 'city-4' });
  tradeAction(state, 4, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true });
  actor.resources.food = 33.99; const before = structuredClone(state);
  assert.equal(quote(state).supported, false); assert.match(quote(state).reason, /opening food/); assert.deepEqual(state, before);
  actor.resources.food = 34; assert.equal(quote(state).supported, true);
});

void test('an already-paid institution cannot displace the existing Library residents', () => {
  const { state, actor, city } = fixture(false, 'university'); city.construction!.active!.workDone = 13;
  const before = structuredClone(state); assert.equal(quote(state).supported, false); assert.match(quote(state).reason, /residents/); assert.deepEqual(state, before);
  city.population = 9; actor.resources.food = 100; assert.equal(quote(state).supported, true);
});

void test('same seeded chooser admits opposite civic priorities without forcing either action or replacing paid work', () => {
  for (const urgent of [false, true]) {
    const { state } = fixture(urgent); const before = structuredClone(state); const expected = urgent ? 'urban-planning' : 'learning-patronage';
    const legal = availableGovernmentActions(state, seat); assert.ok(legal.some(option => option.action.type === 'adopt-government' && option.action.assignments.some(assignment => assignment.policyId === expected)));
    const choices = Array.from({ length: 12 }, (_, decisionCount) => {
      const memory = createBehaviorMemory(state, seat); memory.decisionCount = decisionCount; memory.focusLocks = [{ cityId: '*', focus: 'growth', untilRound: state.round + 6 }];
      return chooseCivilizationBehavior(state, seat, memory, new Date(Date.parse(epoch) + 270000).toISOString());
    });
    assert.ok(choices.some(choice => choice.action?.type === 'adopt-government' && choice.action.assignments.some(assignment => assignment.policyId === expected)), expected);
    for (const choice of choices.filter(choice => choice.action?.type === 'adopt-government')) assert.match(choice.explanation.reason, /conditional/);
    assert.deepEqual(state, before);
  }
});

void test('automatic growth and its later household meals are reserved without borrowing forecast harvests', () => {
  const { state, actor, city } = fixture(); city.wellbeing = 60; actor.resources.food = 30;
  const before = structuredClone(state); const held = quote(state); assert.equal(held.supported, false); assert.match(held.reason, /opening food/); assert.deepEqual(state, before);
  actor.resources.food = 100; assert.equal(quote(state).supported, true);
});

void test('policy locks and pending transitions remain hard admission boundaries', () => {
  const locked = fixture(); locked.actor.government!.active!.effectiveRound = locked.state.round; locked.actor.government!.active!.policyLockUntilRound = locked.state.round + 4;
  assert.equal(quote(locked.state).supported, false); assert.match(quote(locked.state).reason, /commitment/);
  const pending = fixture(); pending.actor.government!.pending = { targetGovernmentId: 'autocracy', targetAssignments: [], acceptedRound: pending.state.round, completionRound: pending.state.round + 2, paidCredits: 10, spentCompletionEventId: null };
  assert.equal(quote(pending.state).supported, false); assert.match(quote(pending.state).reason, /transition/);
});
