import { BUILDINGS, LOCAL_POWER_RULES, RESIDENT_CAPACITY_RULES, RESOURCE_IDS } from '../content.ts';
import type { BuildingDefinition, City, GameEvent, LocalPowerOperationReceipt, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';

export function participatesInLocalPower(building: BuildingDefinition): boolean {
  return (building.localPowerInput ?? 0) > 0 || (building.localPowerOutput ?? 0) > 0;
}

export function localPowerBuildingOrder(left: BuildingDefinition, right: BuildingDefinition): number {
  const phase = Number((right.localPowerOutput ?? 0) > 0) - Number((left.localPowerOutput ?? 0) > 0);
  return phase || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export function initializeLocalPower(state: WorldState, city: City, building: BuildingDefinition): void {
  if (hasFeatures(state, [LOCAL_POWER_RULES.featureId]) && participatesInLocalPower(building))
    city.localPower ??= { ruleVersion: LOCAL_POWER_RULES.ruleVersion, lastBeat: null, lastProductiveBeat: null };
}

export function recordLocalPower(state: WorldState, city: City, events: GameEvent[]): void {
  if (!hasFeatures(state, [LOCAL_POWER_RULES.featureId])) return;
  const buildings = BUILDINGS.filter(building => city.buildings.includes(building.id) && participatesInLocalPower(building)).toSorted(localPowerBuildingOrder);
  if (!buildings.length) return;
  const operations: LocalPowerOperationReceipt[] = buildings.map(building => {
    const result = city.buildingOperations?.[building.id]?.lastResult;
    if (!result?.localPower || !result.residents || !result.strategicPaid || !result.strategicShortages || result.emissionsProduced === undefined || !result.operationEventId || result.round !== state.round)
      throw new RangeError('A local Power receipt requires its complete current operation and emitted event');
    return {
      buildingId: building.id, phase: (building.localPowerOutput ?? 0) > 0 ? 'generator' : 'consumer',
      recipe: { ruleVersion: LOCAL_POWER_RULES.ruleVersion, inputs: { ...building.operatingInputs }, strategicInputs: { ...building.strategicInputs }, baseOutputs: { ...building.production }, residentsRequired: RESIDENT_CAPACITY_RULES.perPaidRecipe, localPowerInput: building.localPowerInput ?? 0, localPowerOutput: building.localPowerOutput ?? 0, emissionsPerOperation: building.emissionsPerOperation ?? 0 },
      result: structuredClone({ ...result, localPower: result.localPower, residents: result.residents, strategicPaid: result.strategicPaid, strategicShortages: result.strategicShortages, emissionsProduced: result.emissionsProduced, operationEventId: result.operationEventId }),
    };
  });
  const first = operations[0]; if (!first) return;
  const generated = operations.reduce((sum, operation) => sum + operation.result.localPower.generated, 0);
  const consumed = operations.reduce((sum, operation) => sum + operation.result.localPower.consumed, 0);
  const expired = generated - consumed;
  const event = emitEvent(state, events, {
    type: 'local-power-beat', title: `${city.name} closes its local Power season`, detail: `${city.id} at strategic round ${state.round}`,
    actor: city.civId, target: city.civId, tileId: city.tileId,
    cause: 'Generators reserve opening fuel and residents before atomic same-town consumers; unused Power expires',
    effects: [`Generated ${generated} Power`, `Consumed ${consumed} Power`, `Expired ${expired} Power`, `Receipt-only emissions ${operations.reduce((sum, operation) => sum + operation.result.emissionsProduced, 0)}`, 'No Power carries into the next beat'], importance: 2,
  });
  const receipt = { ruleVersion: LOCAL_POWER_RULES.ruleVersion, cityId: city.id, civId: city.civId, round: state.round, eventId: event.id, openingPopulation: first.result.residents.openingPopulation, communityReserve: first.result.residents.communityReserve, operations, generated, consumed, expired };
  event.localPower = structuredClone(receipt);
  city.localPower ??= { ruleVersion: LOCAL_POWER_RULES.ruleVersion, lastBeat: null, lastProductiveBeat: null };
  city.localPower.lastBeat = structuredClone(receipt);
  if (operations.some(operation => operation.phase === 'consumer' && operation.result.status === 'operated' && operation.result.localPower.consumed > 0 && RESOURCE_IDS.some(resource => (operation.result.produced[resource] ?? 0) > 0)))
    city.localPower.lastProductiveBeat = structuredClone(receipt);
}
