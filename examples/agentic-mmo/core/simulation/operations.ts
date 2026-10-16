import { BUILDINGS, RESIDENT_CAPACITY_RULES, RESOURCE_IDS } from '../content.ts';
import type { BuildingDefinition, City, GameEvent, Observation, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';
import { civilizationById } from './world.ts';

export function paidRecipe(building: BuildingDefinition): boolean {
  return RESOURCE_IDS.some((resource) => (building.operatingInputs?.[resource] ?? 0) > 0);
}

export function orderedBuildings(city: City): BuildingDefinition[] {
  return city.buildings.toSorted().flatMap((id) => {
    const definition = BUILDINGS.find((building) => building.id === id);
    return definition ? [definition] : [];
  });
}

export function allocateOperations(state: WorldState): void {
  if (!hasFeatures(state, ['building-operations'])) return;
  const residentEnabled = hasFeatures(state, ['resident-capacity']);
  const budgets = new Map(state.civilizations.map((civilization) => [civilization.id, { ...civilization.resources }]));
  for (const city of state.cities.toSorted((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    const budget = budgets.get(city.civId);
    if (!budget) throw new RangeError('A production city requires an existing civilization');
    let available = Math.max(0, city.population - RESIDENT_CAPACITY_RULES.communityReserve);
    for (const building of orderedBuildings(city).filter(paidRecipe)) {
      const operation = city.buildingOperations?.[building.id];
      if (!operation) throw new RangeError(`Missing operation record for ${city.id}/${building.id}`);
      const residents = residentEnabled ? { ruleVersion: RESIDENT_CAPACITY_RULES.ruleVersion, openingPopulation: city.population, communityReserve: RESIDENT_CAPACITY_RULES.communityReserve, required: RESIDENT_CAPACITY_RULES.perPaidRecipe, available, allocated: 0 } : undefined;
      const result: NonNullable<typeof operation.lastResult> = { round: state.round, status: 'paused', paid: {}, produced: {}, shortages: [], ...(residents ? { residents } : {}) };
      operation.lastResult = result;
      if (!operation.enabled) continue;
      const shortages = RESOURCE_IDS.flatMap((resource) => {
        const required = building.operatingInputs?.[resource] ?? 0;
        return budget[resource] < required ? [{ resource, required, available: budget[resource] }] : [];
      });
      if (shortages.length || (residents && residents.available < residents.required)) {
        operation.lastResult = { ...result, status: 'blocked', shortages };
        continue;
      }
      const paid = { ...building.operatingInputs };
      const civilization = civilizationById(state, city.civId);
      for (const resource of RESOURCE_IDS) {
        const amount = paid[resource] ?? 0;
        budget[resource] -= amount;
        civilization.resources[resource] -= amount;
      }
      if (result.residents) {
        available -= result.residents.required;
        result.residents.allocated = result.residents.required;
      }
      operation.lastResult = { ...result, status: 'operated', paid };
    }
  }
}

export function productiveBuildings(state: WorldState, city: City): BuildingDefinition[] {
  return orderedBuildings(city).filter((building) => !paidRecipe(building) || (
    hasFeatures(state, ['building-operations']) && city.buildingOperations?.[building.id]?.lastResult?.status === 'operated'
  ));
}

export function emitOperations(state: WorldState, city: City, events: GameEvent[]): void {
  if (!hasFeatures(state, ['building-operations'])) return;
  for (const building of orderedBuildings(city).filter(paidRecipe)) {
    const result = city.buildingOperations?.[building.id]?.lastResult;
    if (!result) continue;
    const residentEffects = result.residents ? [`Residents: required ${result.residents.required}, opening capacity remaining ${result.residents.available}, allocated ${result.residents.allocated}; population is not consumed`] : [];
    emitEvent(state, events, {
      type: 'building-operation',
      title: `${city.name}: ${building.name} ${result.status}`,
      detail: `${city.id}/${building.id} at strategic round ${result.round}`,
      actor: city.civId,
      target: city.civId,
      tileId: city.tileId,
      cause: result.status === 'paused' ? 'The civilization paused this recipe' : result.residents ? 'Complete resources and local residents are reserved jointly from opening stocks and population in city and building ID order; allocations reset each strategic beat' : 'The complete recipe was checked against remaining opening stocks in city and building ID order',
      effects: [...(result.status === 'operated'
        ? [...RESOURCE_IDS.filter((resource) => (result.paid[resource] ?? 0) > 0).map((resource) => `Paid ${result.paid[resource]} ${resource}`), ...RESOURCE_IDS.filter((resource) => (result.produced[resource] ?? 0) > 0).map((resource) => `Produced ${result.produced[resource]} ${resource}`)]
        : result.status === 'paused' ? ['No inputs consumed or outputs produced']
          : result.residents && result.shortages.length === 0 ? ['No inputs consumed or outputs produced']
            : result.shortages.map((shortage) => `${shortage.resource}: required ${shortage.required}, opening stock remaining ${shortage.available}; nothing consumed or produced`)), ...residentEffects],
      importance: result.status === 'blocked' ? 2 : 1,
    });
  }
}

export function observedRecipes(cities: City[]): NonNullable<Observation['buildingRecipes']> {
  const ids = new Set(cities.flatMap((city) => city.buildings));
  return BUILDINGS.filter((building) => ids.has(building.id) && paidRecipe(building))
    .toSorted((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((building) => ({ buildingId: building.id, inputs: { ...building.operatingInputs }, outputs: { ...building.production } }));
}

export function observedResidentCapacity(cities: City[]): NonNullable<Observation['residentCapacity']> {
  return { ...RESIDENT_CAPACITY_RULES, cities: cities.map(city => ({ cityId: city.id, capacity: Math.max(0, city.population - RESIDENT_CAPACITY_RULES.communityReserve) })) };
}
