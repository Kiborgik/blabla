import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEHAVIOR_POLICY_VERSION, FOOD_BUDGET_BEHAVIOR_POLICY_VERSION, behaviorPolicyVersion, civilizationBehaviorProfile } from '../core/behavior-profiles.ts';
import { deriveDiplomacyPlan, diplomacyWeight } from '../core/behavior-diplomacy.ts';
import { deriveProgressionPlan } from '../core/behavior-progression.ts';
import { chooseCivilizationBehavior, chooseDirectorBehavior, createBehaviorMemory, isBehaviorMemory, isLegacyBehaviorMemory } from '../core/behaviors.ts';
import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { FOOD_BUDGET_RULES } from '../core/food-security-content.ts';
import { civilizationFoodUpkeep, forecastCivilizationFoodProduction } from '../core/simulation/food-security.ts';
import type { ActionOption, WorldState } from '../core/types.ts';

const epoch = '2026-10-22T00:00:00.000Z';
const at = (round: number): string => new Date(Date.parse(epoch) + round * 60_000).toISOString();
function world(budget = true): WorldState { return createGeneratedWorld(73, epoch, budget ? 'settlement-food-budget-1' : 'settlement-regional-targets-1'); }
void test('feature-conditioned policy has a distinct identity and seed domain without silently adopting old memory', () => {
  const old = world(false); const budget = world();
  assert.equal(BEHAVIOR_POLICY_VERSION, 'weighted-civilizations-v2'); assert.equal(behaviorPolicyVersion(old), BEHAVIOR_POLICY_VERSION); assert.equal(behaviorPolicyVersion(budget), FOOD_BUDGET_BEHAVIOR_POLICY_VERSION);
  const oldMemory = createBehaviorMemory(old, 0); const newMemory = createBehaviorMemory(budget, 0);
  assert.ok(isBehaviorMemory(oldMemory)); assert.ok(isBehaviorMemory(newMemory)); assert.notEqual(oldMemory.policyVersion, newMemory.policyVersion);
  assert.throws(() => chooseCivilizationBehavior(budget, 0, oldMemory, epoch), /policy version/);
  assert.throws(() => chooseCivilizationBehavior(old, 0, newMemory, epoch), /policy version/);
  assert.throws(() => chooseDirectorBehavior(budget, createBehaviorMemory(old, 5), epoch), /policy version/);
  const legacy = { ...oldMemory, version: 1, policyVersion: 'weighted-civilizations-v1' }; assert.ok(isLegacyBehaviorMemory(legacy)); assert.equal(isBehaviorMemory(legacy), false);
  assert.equal(isBehaviorMemory({ ...newMemory, policyVersion: 'weighted-civilizations-v99' }), false);
  assert.deepEqual(chooseCivilizationBehavior(budget, 0, newMemory, epoch), chooseCivilizationBehavior(JSON.parse(JSON.stringify(budget)) as WorldState, 0, JSON.parse(JSON.stringify(newMemory)), epoch));
  assert.deepEqual(newMemory, createBehaviorMemory(budget, 0));
});

void test('source-derived opening deficit triggers an actual legal growth-focus response and positive next-beat Food', () => {
  let state = world(); state.cities[0]!.focus = 'research';
  const caught = catchUpStrategy(state, at(3)); assert.ok(caught.ok, caught.error); state = caught.state;
  assert.equal(state.civilizations[0]!.resources.food, 14.11); assert.equal(civilizationFoodUpkeep(state, 0), 10); assert.equal(forecastCivilizationFoodProduction(state, 0), 8.26);
  const before = structuredClone(state); const decision = chooseCivilizationBehavior(state, 0, undefined, at(3));
  assert.deepEqual(state, before); assert.equal(decision.explanation.phase, 'survival'); assert.deepEqual(decision.action, { type: 'focus', focus: 'growth', cityId: state.cities[0]!.id });
  assert.ok(decision.action); const acted = applyCommand(state, { seat: 0, action: decision.action, expectedRevision: state.revision, timestamp: at(3) }); assert.ok(acted.ok, acted.error);
  assert.equal(forecastCivilizationFoodProduction(acted.state, 0), 11.8);
  const supplied = catchUpStrategy(acted.state, at(4)); assert.ok(supplied.ok, supplied.error); assert.equal(supplied.state.civilizations[0]!.resources.food, 15.91); assert.equal(supplied.state.cities[0]!.lastFoodSupply?.paid, 10);
  assert.ok(!supplied.events.some(event => event.type === 'supply-shortage' && event.actor === 0));
});

void test('policy forecasts no longer mistake infrastructure for Food and progression reserves four actual meal beats', () => {
  const state = world(); const actor = state.civilizations[0]!; const city = state.cities[0]!;
  city.population = 20; city.infrastructure = 10; city.wellbeing = 100; city.focus = 'research'; actor.resources.food = 60;
  const profile = civilizationBehaviorProfile(state.seed, 0);
  assert.equal(civilizationFoodUpkeep(state, 0), 25); assert.equal(forecastCivilizationFoodProduction(state, 0), 10.5);
  const newPlan = deriveProgressionPlan(state, actor, profile, []); assert.equal(newPlan.shortages.food, 4);
  const old = structuredClone(state); old.unlockedFeatures = old.unlockedFeatures.filter(id => id !== FOOD_BUDGET_RULES.featureId);
  const oldPlan = deriveProgressionPlan(old, old.civilizations[0]!, profile, []); assert.equal(oldPlan.shortages.food, 1);
  const decision = chooseCivilizationBehavior(state, 0, undefined, epoch); assert.equal(decision.explanation.phase, 'survival'); assert.equal(decision.action?.type, 'focus');
});

void test('diplomacy protects two current meal beats rather than legacy half-Food estimates', () => {
  const state = world(); const actor = state.civilizations[2]!; state.cities.find(city => city.civId === 2)!.population = 20;
  actor.resources = { ...actor.resources, food: 40, materials: 100, credits: 100, energy: 100 };
  const option: ActionOption = { action: { type: 'propose-trade', partner: 0, recipeId: 'harvest-for-materials', sourceCityId: 'city-2', recipientCityId: 'city-0' }, label: 'Exact Food export for materials', reason: 'Synthetic budget comparison' };
  const profile = civilizationBehaviorProfile(state.seed, 2);
  const budget = deriveDiplomacyPlan(state, actor, profile, [option]); assert.equal(diplomacyWeight(option, 10, budget), 0);
  const old = structuredClone(state); old.unlockedFeatures = old.unlockedFeatures.filter(id => id !== FOOD_BUDGET_RULES.featureId);
  const legacy = deriveDiplomacyPlan(old, old.civilizations[2]!, profile, [option]); assert.ok(diplomacyWeight(option, 10, legacy) > 0);
});
