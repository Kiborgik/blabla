import { borderReturnReservations } from './border-incidents.ts';
import { FOOD_BUDGET_RULES } from '../food-security-content.ts';
import { allocatedCityFoodProduction, householdFoodUpkeep } from './food-security.ts';
import { cityGrowthFacts } from './growth.ts';
import { ECONOMY_RULES, LOCAL_GROWTH_RULES, RESOURCE_IDS } from '../content.ts';
import { cityResourceProduction } from '../learning-patronage.ts';
import type { City, GameEvent, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { civilizationById, clamp } from './world.ts';
import { hasFeatures } from './history.ts';

function quantize(value: number): number {
  return Math.round(value * 100) / 100;
}

export function produceCity(
  state: WorldState,
  city: City,
): { food: number; science: number; culture: number } {
  const civilization = civilizationById(state, city.civId);
  const produced = { food: 0, science: 0, culture: 0 };
  for (const resource of RESOURCE_IDS) {
    if (resource === 'food' && hasFeatures(state, [FOOD_BUDGET_RULES.featureId])) {
      const output = allocatedCityFoodProduction(state, city);
      for (const contribution of output.buildings) {
        const result = city.buildingOperations?.[contribution.buildingId]?.lastResult;
        if (result?.status === 'operated' && contribution.food > 0) result.produced.food = contribution.food;
      }
      for (const contribution of output.improvements) {
        const result = city.improvements?.[String(contribution.tileId)]?.operation.lastResult;
        if (result?.status === 'operated' && contribution.food > 0) result.produced.food = contribution.food;
      }
      civilization.resources.food = quantize(clamp(civilization.resources.food + output.total, 0));
      produced.food = output.total;
      continue;
    }
    const output = cityResourceProduction(state, city, resource);
    for (const contribution of output.buildings) {
      const result = city.buildingOperations?.[contribution.buildingId]?.lastResult;
      if (result?.status === 'operated' && contribution.amount > 0) result.produced[resource] = contribution.amount;
      if (result?.status === 'operated' && contribution.policyContribution) result.policyContribution = contribution.policyContribution;
    }
    for (const contribution of output.improvements) {
      const result = city.improvements?.[String(contribution.tileId)]?.operation.lastResult;
      if (result && contribution.amount > 0) result.produced[resource] = contribution.amount;
    }
    const amount = output.total;
    civilization.resources[resource] = quantize(
      clamp(civilization.resources[resource] + amount, 0),
    );
    if (resource === 'food' || resource === 'science' || resource === 'culture')
      produced[resource] = amount;
  }
  return produced;
}

export function supplyCity(state: WorldState, city: City, events: GameEvent[], produced: number, foodBefore: number): boolean {
  const civilization = civilizationById(state, city.civId);
  const growth = cityGrowthFacts(state, city);
  const upkeep = householdFoodUpkeep(state, city.population);
  const supplied = civilization.resources.food >= upkeep;
  const receipt = hasFeatures(state, [FOOD_BUDGET_RULES.featureId]) ? {
    ruleVersion: FOOD_BUDGET_RULES.ruleVersion, foodRule: FOOD_BUDGET_RULES.ruleId, round: state.round,
    population: city.population, produced, required: upkeep, paid: Math.min(civilization.resources.food, upkeep), growthPaid: 0,
    supplied, foodBefore, foodAfter: 0,
  } : undefined;
  if (supplied) {
    civilization.resources.food = quantize(civilization.resources.food - upkeep);
    city.wellbeing = clamp(city.wellbeing + ECONOMY_RULES.suppliedWellbeingGain, 0, 100);
    if (
      city.population + borderReturnReservations(state, city.id) < growth.capacity &&
      city.wellbeing >= ECONOMY_RULES.growth.wellbeing &&
      civilization.resources.food >=
        ECONOMY_RULES.growth.foodReserve + growth.nextGrowthFoodCost
    ) {
      civilization.resources.food = quantize(
        civilization.resources.food - growth.nextGrowthFoodCost,
      );
      if (receipt) receipt.growthPaid = growth.nextGrowthFoodCost;
      city.population += ECONOMY_RULES.growth.populationGain;
      const event = emitEvent(state, events, {
        type: 'population-growth',
        title: `${city.name} grows`,
        detail: 'A supplied settlement invested its food reserve in new households',
        actor: city.civId,
        target: city.civId,
        tileId: city.tileId,
        cause: `Wellbeing ${city.wellbeing} and a food surplus met growth requirements`,
        effects: [
          `Population +${ECONOMY_RULES.growth.populationGain}`,
          `Food -${growth.nextGrowthFoodCost}`,
        ],
        importance: 2,
      });
      if (hasFeatures(state, [LOCAL_GROWTH_RULES.featureId])) event.populationGrowth = {
        ruleVersion: LOCAL_GROWTH_RULES.ruleVersion, cityId: city.id, civId: city.civId, round: state.round, eventId: event.id,
        populationBefore: growth.population, populationAfter: city.population, capacity: growth.capacity, foodPaid: growth.nextGrowthFoodCost,
      };
    }
    if (receipt) city.lastFoodSupply = { ...receipt, foodAfter: civilization.resources.food };
    return true;
  }
  civilization.resources.food = 0;
  if (receipt) city.lastFoodSupply = receipt;
  city.wellbeing = clamp(city.wellbeing - ECONOMY_RULES.shortageWellbeingLoss, 0, 100);
  civilization.legitimacy = clamp(
    civilization.legitimacy - ECONOMY_RULES.shortageLegitimacyLoss,
    0,
    100,
  );
  const lostPopulation =
    city.wellbeing <= ECONOMY_RULES.starvationWellbeing && city.population > 1
      ? Math.min(city.population - 1, ECONOMY_RULES.starvationPopulationLoss)
      : 0;
  city.population -= lostPopulation;
  emitEvent(state, events, {
    type: 'supply-shortage',
    title: `${city.name} faces a food shortage`,
    detail: 'Available food did not cover settlement upkeep',
    actor: city.civId,
    target: city.civId,
    tileId: city.tileId,
    cause: `${upkeep} food was required by the settlement population`,
    effects: [
      `Wellbeing -${ECONOMY_RULES.shortageWellbeingLoss}`,
      `Legitimacy -${ECONOMY_RULES.shortageLegitimacyLoss}`,
      `Population -${lostPopulation}`,
    ],
    importance: 3,
  });
  return false;
}

