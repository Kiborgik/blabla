import { BUILDINGS, ECONOMY_RULES, LOCAL_GROWTH_RULES } from '../content.ts';
import type { City, CityGrowthFacts, CityHousing, WorldState } from '../types.ts';
import { hasFeatures } from './history.ts';

export function initializeCityHousing(state: WorldState, city: City, origin: CityHousing['origin']): void {
  if (!hasFeatures(state, [LOCAL_GROWTH_RULES.featureId])) return;
  city.housing = {
    ruleVersion: LOCAL_GROWTH_RULES.ruleVersion,
    baseCapacity: origin === 'founded' ? LOCAL_GROWTH_RULES.foundedBaseCapacity : Math.max(LOCAL_GROWTH_RULES.legacyBaseCapacity, city.population),
    establishedRound: state.round,
    origin,
  };
}

export function cityGrowthFacts(state: WorldState, city: City): CityGrowthFacts {
  const released = hasFeatures(state, [LOCAL_GROWTH_RULES.featureId]);
  const housing = city.housing;
  if (released && !housing) throw new RangeError('Released local growth requires retained town housing');
  const baseCapacity = released && housing ? housing.baseCapacity : ECONOMY_RULES.growth.cityPopulationCap;
  const sources = released ? BUILDINGS.flatMap(building => city.buildings.includes(building.id) && hasFeatures(state, building.requiredFeatures) && building.housing !== undefined ? [{ buildingId: building.id, capacity: building.housing }] : []) : [];
  return {
    cityId: city.id, ruleVersion: LOCAL_GROWTH_RULES.ruleVersion, population: city.population, baseCapacity, sources,
    capacity: baseCapacity + sources.reduce((total, source) => total + source.capacity, 0),
    nextGrowthFoodCost: released ? LOCAL_GROWTH_RULES.baseFoodCost + Math.floor(city.population / LOCAL_GROWTH_RULES.populationPerFoodCost) : ECONOMY_RULES.growth.foodCost,
  };
}
