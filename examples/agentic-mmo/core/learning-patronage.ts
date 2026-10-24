import { CIVIC_RULES, ECONOMY_RULES, IMPROVEMENTS, IMPROVEMENT_RULES, POLICIES, RESIDENT_CAPACITY_RULES, RESOURCE_IDS } from './content.ts';
import { FOOD_BUDGET_RULES } from './food-security-content.ts';
import { buildingBaseProduction } from './simulation/districts.ts';
import { allocatedCityFoodProduction } from './simulation/food-security.ts';
import { governmentModifiers } from './simulation/government.ts';
import { hasFeatures } from './simulation/history.ts';
import { orderedImprovements } from './simulation/improvements.ts';
import { paidRecipe, productiveBuildings } from './simulation/operations.ts';
import { siteProduction } from './simulation/sites.ts';
import { cityProductivity, civilizationById } from './simulation/world.ts';
import { wonderBaseProduction } from './simulation/wonders.ts';
import type { BuildingDefinition, City, InstitutionalScienceContribution, Resource, Resources, WorldState } from './types.ts';

export interface CityResourceProduction {
  total: number;
  buildings: Array<{ buildingId: string; amount: number; policyContribution?: InstitutionalScienceContribution }>;
  improvements: Array<{ tileId: number; amount: number }>;
}

function quantize(value: number): number {
  return Math.round(value * 100) / 100;
}

function institutionalContribution(state: WorldState, city: City, building: BuildingDefinition, unboostedScience: number): InstitutionalScienceContribution | undefined {
  if (unboostedScience <= 0 || !hasFeatures(state, [CIVIC_RULES.featureId, 'building-operations', 'resident-capacity'])) return undefined;
  const operation = city.buildingOperations?.[building.id]; const result = operation?.lastResult;
  if (!operation?.enabled || result?.status !== 'operated' || result.round !== state.round || result.shortages.length || result.strategicShortages?.length
    || !RESOURCE_IDS.every(resource => (result.paid[resource] ?? 0) === (building.operatingInputs?.[resource] ?? 0))
    || !result.residents || result.residents.ruleVersion !== RESIDENT_CAPACITY_RULES.ruleVersion || result.residents.communityReserve !== RESIDENT_CAPACITY_RULES.communityReserve
    || result.residents.required !== RESIDENT_CAPACITY_RULES.perPaidRecipe || result.residents.allocated !== RESIDENT_CAPACITY_RULES.perPaidRecipe
    || result.residents.available < result.residents.required || result.residents.available > result.residents.openingPopulation - result.residents.communityReserve) return undefined;
  const civilization = civilizationById(state, city.civId);
  const completed = civilization.civics?.completedCivicIds ?? [];
  const policy = civilization.government?.active?.assignments.flatMap(assignment => {
    const definition = POLICIES.find(candidate => candidate.id === assignment.policyId);
    return definition && hasFeatures(state, definition.requiredFeatures) && definition.requires.every(id => completed.includes(id))
      && definition.institutionalSciencePercent?.buildingIds.includes(building.id) ? [definition] : [];
  }).at(0);
  const percent = policy?.institutionalSciencePercent?.percent;
  if (!policy || percent === undefined) return undefined;
  const bonusScience = quantize(unboostedScience * percent / 100);
  return bonusScience > 0 ? { policyId: policy.id, percent, unboostedScience, bonusScience } : undefined;
}

export function cityResourceProduction(state: WorldState, city: City, resource: Resource): CityResourceProduction {
  if (resource === 'food' && hasFeatures(state, [FOOD_BUDGET_RULES.featureId])) {
    const output = allocatedCityFoodProduction(state, city);
    return { total: output.total, buildings: output.buildings.map(building => ({ buildingId: building.buildingId, amount: building.food })), improvements: output.improvements.map(improvement => ({ tileId: improvement.tileId, amount: improvement.food })) };
  }
  const government = governmentModifiers(state, city.civId);
  const focus: Partial<Resources> = ECONOMY_RULES.focusProduction[city.focus];
  const productivity = cityProductivity(city);
  const site = state.tiles.find(tile => tile.id === city.tileId);
  const buildings = productiveBuildings(state, city);
  const freeOutputs = [...buildings.filter(building => !paidRecipe(building)).map(building => buildingBaseProduction(state, city, building)), wonderBaseProduction(state, city)];
  const result: CityResourceProduction = { total: 0, buildings: [], improvements: [] };
  let raw = (ECONOMY_RULES.baseProduction[resource] ?? 0) + (government.baseProduction[resource] ?? 0) + (focus[resource] ?? 0)
    + freeOutputs.reduce((total, output) => total + (output[resource] ?? 0), 0) + (site ? siteProduction(state, site)[resource] ?? 0 : 0);
  let amount = quantize(raw * productivity * government.ordinaryOutputMultiplier);
  let policyBonus = 0;
  for (const building of buildings.filter(paidRecipe)) {
    raw += building.production[resource] ?? 0;
    const next = quantize(raw * productivity * government.ordinaryOutputMultiplier);
    const unboosted = quantize(next - amount);
    const policyContribution = resource === 'science' ? institutionalContribution(state, city, building, unboosted) : undefined;
    policyBonus = quantize(policyBonus + (policyContribution?.bonusScience ?? 0));
    result.buildings.push({ buildingId: building.id, amount: quantize(unboosted + (policyContribution?.bonusScience ?? 0)), ...(policyContribution ? { policyContribution } : {}) });
    amount = next;
  }
  const improvements = hasFeatures(state, [IMPROVEMENT_RULES.featureId]) ? orderedImprovements(city).filter(improvement => improvement.operation.lastResult?.status === 'operated') : [];
  for (const improvement of improvements) {
    const definition = IMPROVEMENTS.find(candidate => candidate.id === improvement.improvementId);
    raw += definition?.production[resource] ?? 0;
    const next = quantize(raw * productivity * government.ordinaryOutputMultiplier);
    result.improvements.push({ tileId: improvement.tileId, amount: quantize(next - amount) });
    amount = next;
  }
  result.total = quantize(amount + policyBonus);
  return result;
}
