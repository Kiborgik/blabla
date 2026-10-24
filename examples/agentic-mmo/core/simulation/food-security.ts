import { ECONOMY_RULES, IMPROVEMENTS, IMPROVEMENT_RULES } from '../content.ts';
import { FOOD_BUDGET_RULES, type FoodRuleId } from '../food-security-content.ts';
import type { City, Resources, WorldState } from '../types.ts';
import { buildingBaseProduction } from './districts.ts';
import { governmentModifiers } from './government.ts';
import { hasFeatures } from './history.ts';
import { orderedImprovements } from './improvements.ts';
import { projectOperationAllocation, paidRecipe, productiveBuildings } from './operations.ts';
import { siteProduction } from './sites.ts';
import { wonderBaseProduction } from './wonders.ts';
import { cityProductivity } from './world.ts';

const quantize = (value: number): number => Math.round(value * 100) / 100;

export function foodRuleId(state: WorldState): FoodRuleId {
  return hasFeatures(state, [FOOD_BUDGET_RULES.featureId]) ? FOOD_BUDGET_RULES.ruleId : 'legacy-food-1';
}

export function foodUpkeepPerResident(rule: FoodRuleId): number {
  if (rule === FOOD_BUDGET_RULES.ruleId) return FOOD_BUDGET_RULES.populationFoodUpkeep;
  if (rule === 'legacy-food-1') return ECONOMY_RULES.populationFoodUpkeep;
  throw new RangeError('Unknown Food rule identity');
}

export function householdFoodUpkeep(state: WorldState, population: number): number {
  return quantize(population * foodUpkeepPerResident(foodRuleId(state)));
}

export function civilizationFoodUpkeep(state: WorldState, civId: number): number {
  return quantize(state.cities.filter(city => city.civId === civId).reduce((total, city) => total + householdFoodUpkeep(state, city.population), 0));
}

export function cityFoodProductivity(state: WorldState, city: City): number {
  return foodRuleId(state) === FOOD_BUDGET_RULES.ruleId ? (0.5 + city.wellbeing / 100) * (1 - city.damage / 100) : cityProductivity(city);
}

export interface AllocatedCityFoodProduction {
  total: number;
  buildings: Array<{ buildingId: string; food: number }>;
  improvements: Array<{ tileId: number; food: number }>;
}

export function allocatedCityFoodProduction(state: WorldState, city: City): AllocatedCityFoodProduction {
  const site = state.tiles.find(tile => tile.id === city.tileId);
  const government = governmentModifiers(state, city.civId);
  const buildings = productiveBuildings(state, city);
  const free = buildings.filter(building => !paidRecipe(building));
  const paid = buildings.filter(paidRecipe);
  const freeOutputs = [...free.map(building => buildingBaseProduction(state, city, building)), wonderBaseProduction(state, city)];
  let raw = ECONOMY_RULES.baseProduction.food + (government.baseProduction.food ?? 0) + ((ECONOMY_RULES.focusProduction[city.focus] as Partial<Resources>).food ?? 0)
    + freeOutputs.reduce((total, output) => total + (output.food ?? 0), 0) + (site ? siteProduction(state, site).food ?? 0 : 0);
  const productivity = cityFoodProductivity(state, city);
  let amount = quantize(raw * productivity * government.ordinaryOutputMultiplier);
  const buildingsProduced: AllocatedCityFoodProduction['buildings'] = [];
  const improvementsProduced: AllocatedCityFoodProduction['improvements'] = [];
  for (const building of paid) {
    raw += building.production.food ?? 0;
    const next = quantize(raw * productivity * government.ordinaryOutputMultiplier);
    buildingsProduced.push({ buildingId: building.id, food: quantize(next - amount) });
    amount = next;
  }
  if (hasFeatures(state, [IMPROVEMENT_RULES.featureId])) for (const improvement of orderedImprovements(city)) {
    if (improvement.operation.lastResult?.status !== 'operated') continue;
    raw += IMPROVEMENTS.find(candidate => candidate.id === improvement.improvementId)?.production.food ?? 0;
    const next = quantize(raw * productivity * government.ordinaryOutputMultiplier);
    improvementsProduced.push({ tileId: improvement.tileId, food: quantize(next - amount) });
    amount = next;
  }
  return { total: amount, buildings: buildingsProduced, improvements: improvementsProduced };
}


export function forecastCityFoodProduction(state: WorldState, city: City): number {
  const projected = projectOperationAllocation(state);
  const retained = projected.cities.find(candidate => candidate.id === city.id && candidate.civId === city.civId);
  if (!retained) throw new RangeError('Food forecast requires an exact existing town');
  return allocatedCityFoodProduction(projected, retained).total;
}

export function forecastCivilizationFoodProduction(state: WorldState, civId: number): number {
  const projected = projectOperationAllocation(state);
  return quantize(projected.cities.filter(city => city.civId === civId).reduce((total, city) => total + allocatedCityFoodProduction(projected, city).total, 0));
}
