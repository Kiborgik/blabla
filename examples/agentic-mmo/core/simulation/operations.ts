import { localPowerBuildingOrder, participatesInLocalPower } from './local-power.ts';
import { allocateImprovements } from './improvements.ts';
import { BUILDINGS, LOCAL_POWER_RULES, RESIDENT_CAPACITY_RULES, RESOURCE_IDS, STRATEGIC_RESOURCE_IDS } from '../content.ts';
import type { BuildingDefinition, City, GameEvent, Observation, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';
import { civilizationById } from './world.ts';

export function paidRecipe(building: BuildingDefinition): boolean {
  return RESOURCE_IDS.some((resource) => (building.operatingInputs?.[resource] ?? 0) > 0) || STRATEGIC_RESOURCE_IDS.some(resource => (building.strategicInputs?.[resource] ?? 0) > 0) || participatesInLocalPower(building);
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
  const powerEnabled = hasFeatures(state, [LOCAL_POWER_RULES.featureId]);
  const budgets = new Map(state.civilizations.map((civilization) => [civilization.id, { ...civilization.resources }]));
  const strategicBudgets = new Map(state.civilizations.map(civilization => [civilization.id, { ...civilization.strategicResources }]));
  for (const city of state.cities.toSorted((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    const budget = budgets.get(city.civId);
    const strategicBudget = strategicBudgets.get(city.civId);
    if (!budget || !strategicBudget) throw new RangeError('A production city requires an existing civilization');
    let available = Math.max(0, city.population - RESIDENT_CAPACITY_RULES.communityReserve);
    let power = 0;
    const buildings = orderedBuildings(city).filter(paidRecipe);
    if (powerEnabled) buildings.sort(localPowerBuildingOrder);
    for (const building of buildings) {
      const powerParticipant = powerEnabled && participatesInLocalPower(building);
      const operation = city.buildingOperations?.[building.id];
      if (!operation) throw new RangeError(`Missing operation record for ${city.id}/${building.id}`);
      const residents = residentEnabled ? { ruleVersion: RESIDENT_CAPACITY_RULES.ruleVersion, openingPopulation: city.population, communityReserve: RESIDENT_CAPACITY_RULES.communityReserve, required: RESIDENT_CAPACITY_RULES.perPaidRecipe, available, allocated: 0 } : undefined;
      const result: NonNullable<typeof operation.lastResult> = { round: state.round, status: 'paused', paid: {}, produced: {}, shortages: [], ...(building.strategicInputs || powerParticipant ? { strategicPaid: {}, strategicShortages: [] } : {}), ...(residents ? { residents } : {}), ...(powerParticipant ? { localPower: { ruleVersion: LOCAL_POWER_RULES.ruleVersion, required: building.localPowerInput ?? 0, availableBefore: power, consumed: 0, generated: 0, shortage: Math.max(0, (building.localPowerInput ?? 0) - power) }, emissionsProduced: 0 } : {}) };
      operation.lastResult = result;
      if (!operation.enabled) continue;
      const shortages = RESOURCE_IDS.flatMap((resource) => {
        const required = building.operatingInputs?.[resource] ?? 0;
        return budget[resource] < required ? [{ resource, required, available: budget[resource] }] : [];
      });
      const strategicShortages = STRATEGIC_RESOURCE_IDS.flatMap(resource => {
        const required = building.strategicInputs?.[resource] ?? 0;
        const remaining = strategicBudget[resource] ?? 0;
        return remaining < required ? [{ resource, required, available: remaining }] : [];
      });
      if (shortages.length || strategicShortages.length || (result.localPower?.shortage ?? 0) > 0 || (residents && residents.available < residents.required)) {
        operation.lastResult = { ...result, status: 'blocked', shortages, ...(building.strategicInputs || powerParticipant ? { strategicShortages } : {}) };
        continue;
      }
      const paid = { ...building.operatingInputs };
      const civilization = civilizationById(state, city.civId);
      for (const resource of RESOURCE_IDS) {
        const amount = paid[resource] ?? 0;
        budget[resource] -= amount;
        civilization.resources[resource] -= amount;
      }
      if (building.strategicInputs) {
        const strategicPaid = { ...building.strategicInputs };
        for (const resource of STRATEGIC_RESOURCE_IDS) {
          const amount = strategicPaid[resource] ?? 0;
          if (amount <= 0) continue;
          strategicBudget[resource] = (strategicBudget[resource] ?? 0) - amount;
          civilization.strategicResources ??= {};
          civilization.strategicResources[resource] = (civilization.strategicResources[resource] ?? 0) - amount;
        }
        result.strategicPaid = strategicPaid;
      }
      if (result.residents) {
        available -= result.residents.required;
        result.residents.allocated = result.residents.required;
      }
      if (result.localPower) {
        result.localPower.consumed = building.localPowerInput ?? 0;
        result.localPower.generated = building.localPowerOutput ?? 0;
        result.emissionsProduced = building.emissionsPerOperation ?? 0;
        power += result.localPower.generated - result.localPower.consumed;
      }
      operation.lastResult = { ...result, status: 'operated', paid };
    }
    allocateImprovements(state, city, available, budget);
  }
}

export function projectOperationAllocation(state: WorldState, prepare?: (projected: WorldState) => void): WorldState {
  const projected: WorldState = {
    ...state,
    round: state.round + 1,
    civilizations: state.civilizations.map(civilization => ({ ...civilization, resources: { ...civilization.resources }, ...(civilization.strategicResources ? { strategicResources: { ...civilization.strategicResources } } : {}) })),
    cities: state.cities.map(city => ({ ...city, ...(city.buildingOperations ? { buildingOperations: structuredClone(city.buildingOperations) } : {}), ...(city.improvements ? { improvements: structuredClone(city.improvements) } : {}) })),
  };
  prepare?.(projected);
  allocateOperations(projected);
  return projected;
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
    const event = emitEvent(state, events, {
      type: 'building-operation',
      title: `${city.name}: ${building.name} ${result.status}`,
      detail: `${city.id}/${building.id} at strategic round ${result.round}`,
      actor: city.civId,
      target: city.civId,
      tileId: city.tileId,
      cause: result.status !== 'paused' && hasFeatures(state, [LOCAL_POWER_RULES.featureId]) ? 'Generators reserve opening resources and local residents before stable-ID ordinary and powered consumers; each complete recipe is atomic' : result.status === 'paused' ? 'The civilization paused this recipe' : result.residents ? 'Complete resources and local residents are reserved jointly from opening stocks and population in city and building ID order; allocations reset each strategic beat' : 'The complete recipe was checked against remaining opening stocks in city and building ID order',
      effects: [...(result.status === 'operated'
        ? [...RESOURCE_IDS.filter((resource) => (result.paid[resource] ?? 0) > 0).map((resource) => `Paid ${result.paid[resource]} ${resource}`), ...RESOURCE_IDS.filter((resource) => (result.produced[resource] ?? 0) > 0).map((resource) => `Produced ${result.produced[resource]} ${resource}`)]
        : result.status === 'paused' ? ['No inputs consumed or outputs produced']
          : result.residents && result.shortages.length === 0 ? ['No inputs consumed or outputs produced']
            : result.shortages.map((shortage) => `${shortage.resource}: required ${shortage.required}, opening stock remaining ${shortage.available}; nothing consumed or produced`)), ...Object.entries(result.strategicPaid ?? {}).filter(([, amount]) => amount > 0).map(([resource, amount]) => `Paid ${amount} ${resource}`), ...(result.strategicShortages ?? []).map(shortage => `${shortage.resource}: required ${shortage.required}, opening stock remaining ${shortage.available}; nothing consumed or produced`), ...residentEffects, ...(result.localPower ? [`Local Power: required ${result.localPower.required}, available ${result.localPower.availableBefore}, consumed ${result.localPower.consumed}, generated ${result.localPower.generated}`, `Receipt-only emissions ${result.emissionsProduced}`] : [])],
      importance: result.status === 'blocked' ? 2 : 1,
    });
    if (result.localPower) result.operationEventId = event.id;
  }
}

export function observedRecipes(cities: City[]): NonNullable<Observation['buildingRecipes']> {
  const ids = new Set(cities.flatMap((city) => city.buildings));
  return BUILDINGS.filter((building) => ids.has(building.id) && paidRecipe(building))
    .toSorted((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((building) => ({ buildingId: building.id, inputs: { ...building.operatingInputs }, ...(building.strategicInputs ? { strategicInputs: { ...building.strategicInputs } } : {}), outputs: { ...building.production }, ...(participatesInLocalPower(building) ? { localPowerInput: building.localPowerInput ?? 0, localPowerOutput: building.localPowerOutput ?? 0, emissionsPerOperation: building.emissionsPerOperation ?? 0 } : {}) }));
}

export function observedResidentCapacity(cities: City[]): NonNullable<Observation['residentCapacity']> {
  return { ...RESIDENT_CAPACITY_RULES, cities: cities.map(city => ({ cityId: city.id, capacity: Math.max(0, city.population - RESIDENT_CAPACITY_RULES.communityReserve) })) };
}
