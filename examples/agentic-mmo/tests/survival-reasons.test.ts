import assert from 'node:assert/strict';
import { test } from 'node:test';
import { civilizationBehaviorProfile, FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION } from '../core/behavior-profiles.ts';
import { assessCivilizationBehavior, chooseCivilizationBehavior, createBehaviorMemory, type BehaviorMemory } from '../core/behaviors.ts';
import { CIVICS } from '../core/content.ts';
import { legalActions } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { STRATEGIC_TEMPERAMENT_VERSION } from '../core/strategic-temperaments.ts';
import { civilizationFoodUpkeep, forecastCivilizationFoodProduction } from '../core/simulation/food-security.ts';
import { isWorldState } from '../core/validation.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const base = createGeneratedWorld(73, epoch, 'settlement-learning-patronage-1', undefined, STRATEGIC_TEMPERAMENT_VERSION);

function fixture(food: number, population = 8, phase: BehaviorMemory['phase'] = 'survival') {
  const state = structuredClone(base);
  const actor = state.civilizations[0]!;
  const city = state.cities.find(candidate => candidate.civId === actor.id)!;
  actor.resources = { food, materials: 0, credits: 0, energy: 0, science: 0, culture: 0 };
  actor.researchTarget = 'agriculture';
  actor.civics!.active = { civicId: 'code-of-laws', startedRound: state.round, progress: 0, requiredCulture: CIVICS.find(civic => civic.id === 'code-of-laws')!.cost };
  city.population = population;
  city.focus = 'growth';
  city.wellbeing = 100;
  const memory: BehaviorMemory = { ...createBehaviorMemory(state, actor.id), phase, focusLocks: [{ cityId: city.id, focus: city.focus, untilRound: 10 }] };
  return { state, memory, timestamp: epoch as string | undefined };
}

const immediate = fixture(1);
const retained = fixture(20);
const deficit = fixture(50, 20);
const upperBelow = fixture(39.99);
const upperAt = fixture(40);
const floorBelow = fixture(11.99, 2);
const floorAt = fixture(12, 2);
const nonSurvival = fixture(20, 8, 'development');
const requiredImmediate = fixture(1);
requiredImmediate.state.civilizations[0]!.civics!.active = null;
const requiredRetained = fixture(20);
requiredRetained.state.civilizations[0]!.civics!.active = null;
const urgent = fixture(1);
urgent.state.cities.find(city => city.civId === 0)!.focus = 'research';
const unavailable = fixture(20);
unavailable.timestamp = undefined;

export const survivalReasonCases = {
  immediate, retained, deficit, upperBelow, upperAt, floorBelow, floorAt, nonSurvival, requiredImmediate, requiredRetained, urgent, unavailable,
};

function inspect(sample: typeof immediate) {
  const { state, memory, timestamp } = sample;
  assert.ok(isWorldState(state), 'Controlled fixture uses valid current registered rules, not campaign evidence');
  assert.equal(memory.policyVersion, FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION);
  const before = structuredClone(sample);
  const options = legalActions(state, memory.seat, timestamp);
  const assessment = assessCivilizationBehavior(state, memory.seat, memory, options);
  const decision = chooseCivilizationBehavior(state, memory.seat, memory, timestamp);
  assert.deepEqual(sample, before);
  assert.ok(decision.explanation.reason.length <= 280);
  if (decision.action) assert.ok(options.some(option => JSON.stringify(option.action) === JSON.stringify(decision.action)));
  return { assessment, decision };
}

function ordinary(sample: typeof immediate, phase: BehaviorMemory['phase'], cause: string) {
  const { assessment, decision } = inspect(sample);
  assert.equal(assessment.phase, phase);
  assert.deepEqual(decision.action, { type: 'wait' });
  assert.equal(decision.explanation.required, false);
  assert.deepEqual(decision.memory, {
    ...sample.memory, decisionCount: 1, phase, lastDecisionRound: sample.state.round,
    phaseSinceRound: phase === sample.memory.phase ? sample.memory.phaseSinceRound : sample.state.round,
    lastActionKey: '{"type":"wait"}', urgentStreak: 0,
  });
  const profile = civilizationBehaviorProfile(sample.state.seed, 0, sample.memory.policyVersion);
  assert.equal(decision.explanation.reason, `${profile.name} prefer ${phase}: ${cause}. Weighted alternatives remain possible; viable phase commitment to round ${assessment.commitmentUntilRound}. Hold position.`);
  return { assessment, decision };
}

void test('ordinary Survival distinguishes immediate risk from retained safe-buffer recovery with unchanged wait and memory', () => {
  const paired = structuredClone(immediate);
  paired.state.civilizations[0]!.resources.food = 20;
  assert.deepEqual(paired, retained);
  const risky = ordinary(immediate, 'survival', 'current Food risk overrides ordinary preferences');
  const safe = ordinary(retained, 'survival', 'no current Food risk; retained Survival buffer 20/40 Food');
  assert.equal(risky.assessment.foodRisk, true);
  assert.equal(risky.assessment.severeFoodRisk, true);
  assert.equal(safe.assessment.foodRisk, false);
  assert.equal(safe.assessment.severeFoodRisk, false);
  assert.equal(civilizationFoodUpkeep(retained.state, 0), 10);
  assert.ok(forecastCivilizationFoodProduction(retained.state, 0) >= safe.assessment.upkeep);
  assert.deepEqual(risky.decision.action, safe.decision.action);
  assert.deepEqual(risky.decision.memory, safe.decision.memory);
  for (const result of [risky, safe]) assert.deepEqual(result.assessment.candidates.filter(candidate => candidate.weight > 0).map(candidate => ({ action: candidate.option.action, weight: candidate.ordinaryWeight })), [{ action: { type: 'wait' }, weight: 0.8 }]);
});

void test('current forecast deficit remains Food risk without severe opening-stock risk', () => {
  const { assessment } = ordinary(deficit, 'survival', 'current Food risk overrides ordinary preferences');
  assert.equal(assessment.foodRisk, true);
  assert.equal(assessment.severeFoodRisk, false);
  assert.equal(assessment.upkeep, 25);
  assert.ok(forecastCivilizationFoodProduction(deficit.state, 0) < assessment.upkeep);
});

void test('retained Survival text follows the strict four-upkeep buffer and twelve-Food floor', () => {
  for (const [sample, stock, buffer] of [[upperBelow, 39.99, 40], [floorBelow, 11.99, 12]] as const) {
    const { assessment } = ordinary(sample, 'survival', `no current Food risk; retained Survival buffer ${stock}/${buffer} Food`);
    assert.equal(assessment.foodRisk, false);
  }
  for (const sample of [upperAt, floorAt, nonSurvival]) {
    const { assessment, decision } = ordinary(sample, 'consolidation', 'consolidate useful operations and existing places');
    assert.equal(assessment.foodRisk, false);
    assert.doesNotMatch(decision.explanation.reason, /Food risk|Survival buffer/);
  }
});

void test('required civic reason overrides both current Food risk and retained Survival', () => {
  for (const sample of [requiredImmediate, requiredRetained]) {
    const { assessment, decision } = inspect(sample);
    assert.equal(assessment.phase, 'survival');
    assert.equal(assessment.foodRisk, sample === requiredImmediate);
    assert.deepEqual(decision.action, { type: 'choose-civic', civicId: 'code-of-laws' });
    assert.equal(decision.explanation.reason, 'Start the next required civic commitment. Develop Code of laws.');
    assert.equal(decision.explanation.required, true);
    assert.deepEqual(decision.memory, { ...sample.memory, decisionCount: 1, lastRequiredLane: 'civic', lastActionKey: '{"civicId":"code-of-laws","type":"choose-civic"}' });
  }
});

void test('urgent Food focus keeps its existing reason and focus-lock memory', () => {
  const { assessment, decision } = inspect(urgent);
  const city = urgent.state.cities.find(candidate => candidate.civId === 0)!;
  const profile = civilizationBehaviorProfile(urgent.state.seed, 0, urgent.memory.policyVersion);
  assert.equal(assessment.foodRisk, true);
  assert.deepEqual(decision.action, { type: 'focus', cityId: city.id, focus: 'growth' });
  assert.equal(decision.explanation.reason, `Food is low; protect the towns before expanding. ${city.name}: emphasize growth.`);
  assert.equal(decision.explanation.required, false);
  assert.deepEqual(decision.memory, { ...urgent.memory, decisionCount: 1, urgentStreak: 1,
    lastActionKey: JSON.stringify({ cityId: city.id, focus: 'growth', type: 'focus' }),
    focusLocks: [{ cityId: city.id, focus: 'growth', untilRound: urgent.state.round + profile.commitmentRounds }],
  });
});

void test('unavailable action admission keeps its existing diagnostic and cannot invent a selected Survival reason', () => {
  const before = structuredClone(unavailable);
  const decision = chooseCivilizationBehavior(unavailable.state, 0, unavailable.memory);
  assert.deepEqual(decision, { action: null, memory: unavailable.memory, explanation: {
    profileId: unavailable.memory.profileId, phase: unavailable.memory.phase, reason: 'An explicit action time is required.', required: false,
  } });
  assert.deepEqual(unavailable, before);
});
