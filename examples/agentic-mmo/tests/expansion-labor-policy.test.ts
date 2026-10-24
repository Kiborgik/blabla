import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCoastalFunding, createCoastalOpportunity } from '../core/behavior-coastal-opportunity.ts';
import { createExpansionLaborOpportunity, type ExpansionLaborContext } from '../core/behavior-expansion-labor.ts';
import { civilizationBehaviorProfile } from '../core/behavior-profiles.ts';
import { BUILDINGS, ECONOMY_RULES, RESOURCE_IDS } from '../core/content.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { cityResourceProduction } from '../core/learning-patronage.ts';
import { availableActions } from '../core/simulation/choices.ts';
import { foundSettlement, isCoastalSite } from '../core/simulation/coastal.ts';
import { householdFoodUpkeep } from '../core/simulation/food-security.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import { siteProduction } from '../core/simulation/sites.ts';
import type { ActionOption, GameAction, Resources, WorldState } from '../core/types.ts';
import { syntheticTechnologies } from './fixtures/coastal-prefix.ts';

function fixture() {
  const state = createGeneratedWorld(73, '2026-10-24T00:00:00.000Z', 'settlement-expansion-labor-1', 'cultural-toponyms-v1', 'strategic-temperaments-v1');
  const city = state.cities.find(city => isCoastalSite(state, city.tileId))!; assert.ok(city);
  const actor = state.civilizations.find(actor => actor.id === city.civId)!;
  syntheticTechnologies(state, actor.id, ['navigation', 'kiln-firing', 'currency', 'water-management']);
  actor.resources = { food: 10000, materials: 10000, energy: 10000, credits: 10000, science: 0, culture: 10000 };
  city.population = 6; city.buildings = ['boat-yard', 'kiln']; city.focus = 'growth'; city.infrastructure = 1; city.wellbeing = 65;
  city.buildingOperations = { kiln: { enabled: true, lastResult: null } }; city.improvements = {}; city.construction = { active: null, lastCompleted: null };
  const weights = civilizationBehaviorProfile(state.seed, actor.id).resources;
  const context = (options: readonly ActionOption[]): ExpansionLaborContext => ({
    weights, desiredBuildings: new Set([`${city.id}/kiln`]), coastalOpportunity: createCoastalOpportunity(state, actor.id, options), settlementGoal: 4,
    foodRisk: false, recovery: false, requiredPools: false, holds: () => false,
    foundingWeight: option => {
      if (option.action.type !== 'settle-coast') return 0;
      const site = state.tiles.find(tile => tile.id === (option.action as Extract<GameAction, { type: 'settle-coast' }>).tileId)!;
      return 8 + RESOURCE_IDS.reduce((sum, resource) => sum + (siteProduction(state, site)[resource] ?? 0) * weights[resource], 0);
    },
  });
  const evaluate = (changes: Partial<ExpansionLaborContext> = {}) => {
    const options = availableActions(state, actor.id);
    return createExpansionLaborOpportunity(state, actor.id, options, { ...context(options), ...changes });
  };
  return { state, actor, city, weights, context, evaluate };
}

function netFlow(state: WorldState, civId: number): Resources {
  const output: Resources = { food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 };
  for (const city of state.cities.filter(city => city.civId === civId)) {
    for (const resource of RESOURCE_IDS) output[resource] += cityResourceProduction(state, city, resource).total;
    output.food -= householdFoodUpkeep(state, city.population);
    for (const receipt of [...Object.values(city.buildingOperations ?? {}).map(operation => operation.lastResult), ...Object.values(city.improvements ?? {}).map(site => site.operation.lastResult)])
      if (receipt?.status === 'operated') for (const resource of RESOURCE_IDS) output[resource] -= receipt.paid[resource] ?? 0;
  }
  for (const resource of RESOURCE_IDS) output[resource] = Math.round(output[resource] * 100) / 100;
  return output;
}

void test('one cached legal pause compares native same-opening net flow, not future funding or capital payback', () => {
  const { state, actor, city, weights, evaluate } = fixture(); const before = structuredClone(state);
  const policy = evaluate(); const answer = policy.assessment(); assert.ok(answer.pause, answer.reason); assert.ok(answer.witness);
  assert.deepEqual(answer.pause, { type: 'set-building-operation', cityId: city.id, buildingId: 'kiln', enabled: false });
  assert.equal(answer.suppressedResume, null); assert.ok(answer.witness.netFlowValue > 0);
  const retained = projectOperationAllocation(state);
  const alternate = structuredClone(state); alternate.cities.find(town => town.id === city.id)!.buildingOperations!.kiln!.enabled = false;
  const founded = foundSettlement(alternate, actor.id, alternate.tiles.find(tile => tile.id === answer.witness!.tileId)!, alternate.cities.find(town => town.id === city.id), true);
  assert.equal(founded.population, 3); assert.equal(alternate.cities.find(town => town.id === city.id)!.population, 3);
  assert.deepEqual(answer.witness.retainedFlow, netFlow(retained, actor.id));
  assert.deepEqual(answer.witness.alternativeFlow, netFlow(projectOperationAllocation(alternate), actor.id));
  const value = RESOURCE_IDS.reduce((sum, resource) => sum + (answer.witness!.alternativeFlow[resource] - answer.witness!.retainedFlow[resource]) * weights[resource], 0);
  assert.ok(Math.abs(answer.witness.netFlowValue - value) < 1e-9);
  assert.deepEqual(answer.witness.foundingCost, ECONOMY_RULES.settle.cost);
  assert.equal(answer.witness.currentTowns.households.some(home => home.prospective), false);
  assert.equal(answer.witness.departure.households.find(home => home.prospective)!.openingPopulation, 3);
  const count = policy.work.allocationProjections; assert.equal(policy.assessment(), answer); assert.equal(policy.work.allocationProjections, count);
  assert.equal(policy.work.cacheHits, 1); assert.equal(policy.work.sources, 1); assert.equal(policy.work.destinations, 1); assert.equal(policy.work.eligibleRecipes, 1);
  assert.ok(count <= 1 + 7 * policy.work.eligibleRecipes); assert.ok(policy.work.inheritedCoastal.allocationProjections > 0);
  assert.deepEqual(state, before);
});

void test('finite numerical refusal boundary preserves unchanged resource preferences', context => {
  context.diagnostic('Infrastructure100 is an artificial finite boundary, not a plausible retained town or the meaningful opposite control; the independent lifecycle fixture owns that control.');
  const { city, evaluate, weights } = fixture(); const low = evaluate().assessment(); assert.ok(low.pause);
  const originalWeights = { ...weights }; city.infrastructure = 100;
  const high = evaluate().assessment(); assert.equal(high.pause, null); assert.match(high.reason, /net-flow/); assert.deepEqual(weights, originalWeights);
});

void test('continuation uses the exact legal resume and restores ordinary management when support changes', () => {
  const { state, city, actor, evaluate } = fixture(); assert.ok(evaluate().assessment().pause);
  city.buildingOperations!.kiln!.enabled = false; const before = structuredClone(state);
  const policy = evaluate(); const continued = policy.assessment(); assert.equal(continued.pause, null); assert.ok(continued.suppressedResume, continued.reason);
  assert.deepEqual(continued.suppressedResume, { type: 'set-building-operation', cityId: city.id, buildingId: 'kiln', enabled: true });
  assert.ok(availableActions(state, actor.id).some(option => JSON.stringify(option.action) === JSON.stringify(continued.suppressedResume)));
  assert.ok(policy.work.allocationProjections <= 1 + 7 * policy.work.eligibleRecipes); assert.deepEqual(state, before);
  actor.resources.food = 10; assert.equal(evaluate().assessment().suppressedResume, null);
});

void test('ambiguous desired resumptions and existing supported departure never trigger a second pause', () => {
  const { city, evaluate } = fixture(); city.buildings.push('market'); city.buildingOperations!.market = { enabled: false, lastResult: null };
  const desiredBuildings = new Set([`${city.id}/kiln`, `${city.id}/market`]);
  const unrelated = evaluate({ desiredBuildings }).assessment(); assert.equal(unrelated.pause, null); assert.equal(unrelated.suppressedResume, null);
  city.buildingOperations!.kiln!.enabled = false;
  const ambiguous = evaluate({ desiredBuildings }).assessment(); assert.equal(ambiguous.pause, null); assert.equal(ambiguous.suppressedResume, null); assert.match(ambiguous.reason, /ambiguous/);
  city.buildingOperations!.kiln!.enabled = true; city.buildingOperations!.market!.enabled = true; city.population = 12;
  const supported = evaluate({ desiredBuildings }).assessment(); assert.equal(supported.pause, null); assert.match(supported.reason, /already-supported/);
});

void test('Food producers, strategic recipes, Power and emergency or required work cannot become expansion preparation', () => {
  for (const buildingId of ['irrigation', 'foundry', 'coal-plant', 'research-lab']) {
    const { city, actor, evaluate } = fixture(); const definition = BUILDINGS.find(building => building.id === buildingId)!;
    city.buildings = ['boat-yard', buildingId]; city.buildingOperations = { [buildingId]: { enabled: true, lastResult: null } }; actor.strategicResources = { iron: 100, coal: 100 };
    const assessed = evaluate({ desiredBuildings: new Set([`${city.id}/${definition.id}`]) }).assessment(); assert.equal(assessed.pause, null, buildingId);
  }
  for (const changes of [{ foodRisk: true }, { recovery: true }, { requiredPools: true }, { settlementGoal: 1 }, { holds: () => true }]) {
    const { evaluate } = fixture(); assert.equal(evaluate(changes).assessment().pause, null);
  }
});

void test('current exact coastal funding seam preserves public departure facts and separate current-town protection', () => {
  const { state, actor, city } = fixture(); city.population = 9;
  const options = availableActions(state, actor.id); const option = options.find(option => option.action.type === 'settle-coast' && option.action.sourceCityId === city.id)!;
  assert.ok(option?.action.type === 'settle-coast'); if (option.action.type !== 'settle-coast') throw new Error('Expected exact coastal option');
  const coastal = createCoastalOpportunity(state, actor.id, options); const publicResult = coastal.assessment(option.action); assert.ok(publicResult.witness);
  const funding = createCoastalFunding(state, actor.id, coastal.closure);
  const exact = funding.fund(city, option.action.tileId, 'founding'); assert.ok(exact.assessment.facts);
  assert.deepEqual(exact.assessment.facts.protectedBudget, publicResult.witness.protectedBudget);
  assert.deepEqual(exact.assessment.facts.households, publicResult.witness.households);
  assert.deepEqual(exact.assessment.facts.allocations, publicResult.witness.allocations);
  assert.equal(exact.horizon, publicResult.witness.protectedHorizon);
  const current = funding.fund(city, option.action.tileId, 'preparation'); assert.ok(current.assessment.facts);
  assert.equal(current.assessment.facts.households.some(home => home.prospective), false);
  assert.equal(funding.work.allocationProjections, 3);
});

void test('active Learning recipient output keeps its real bonus and cannot be paused', () => {
  const { state, city, actor, evaluate } = fixture(); syntheticTechnologies(state, actor.id, ['civic-institutions']);
  city.buildings = ['boat-yard', 'academy']; city.buildingOperations = { academy: { enabled: true, lastResult: null } };
  actor.civics!.completedCivicIds = ['code-of-laws', 'craftsmanship', 'foreign-trade', 'early-empire', 'state-workforce'];
  actor.government!.active = { governmentId: 'chiefdom', assignments: [{ slotType: 'economic', slotIndex: 0, policyId: 'learning-patronage' }], effectiveRound: 0, governmentLockUntilRound: 0, policyLockUntilRound: 0 };
  const projected = projectOperationAllocation(state); const town = projected.cities.find(town => town.id === city.id)!;
  const output = cityResourceProduction(projected, town, 'science').buildings.find(building => building.buildingId === 'academy')!;
  assert.equal(output.policyContribution!.percent, 25); assert.ok(output.policyContribution!.bonusScience > 0);
  assert.equal(output.amount, Math.round((output.policyContribution!.unboostedScience + output.policyContribution!.bonusScience) * 100) / 100);
  const before = structuredClone(state); const answer = evaluate({ desiredBuildings: new Set([`${city.id}/academy`]) }).assessment();
  assert.equal(answer.pause, null); assert.match(answer.reason, /learning/); assert.deepEqual(state, before);
});

void test('one pause never substitutes a second flag or projected income for staffing, stock or geometry', () => {
  const { state, city, actor, evaluate } = fixture();
  city.buildings.push('market'); city.buildingOperations!.market = { enabled: true, lastResult: null };
  const before = structuredClone(state); const answer = evaluate({ desiredBuildings: new Set([`${city.id}/kiln`, `${city.id}/market`]) }).assessment();
  assert.equal(answer.pause, null); assert.match(answer.reason, /unfunded/); assert.deepEqual(state, before);
  city.buildings = ['boat-yard', 'kiln']; delete city.buildingOperations!.market;
  actor.resources.food = 100; assert.equal(evaluate().assessment().pause, null);
  actor.resources.food = 10000; city.buildings = ['kiln']; assert.equal(evaluate().assessment().pause, null);
  city.buildings = ['boat-yard', 'kiln']; actor.technologies = actor.technologies.filter(id => id !== 'navigation'); assert.equal(evaluate().assessment().pause, null);
});
