import { exchangePromisedResources, knowledgeCommitmentHorizon } from './behavior-knowledge.ts';
import { IMPROVEMENTS, IMPROVEMENT_RULES, RESOURCE_IDS, STRATEGIC_RESOURCE_IDS } from './content.ts';
import { allocatedCityFoodProduction, civilizationFoodUpkeep } from './simulation/food-security.ts';
import { hasFeatures } from './simulation/history.ts';
import { improvementSiteBlock } from './simulation/improvements.ts';
import { projectOperationAllocation } from './simulation/operations.ts';
import type { GameAction, ImprovementDefinition, WorldState } from './types.ts';

export function paidFoodSite(definition: ImprovementDefinition): boolean {
  return definition.id === 'shore-fishery' || definition.id === 'hill-commons';
}

function exchangeReserve(state: WorldState, civId: number): ReturnType<typeof exchangePromisedResources> {
  const horizon = Math.max(knowledgeCommitmentHorizon(state, civId),
    ...(state.publicProjects ?? []).flatMap(project => project.status === 'committed' && (project.proposer === civId || project.recipient === civId) ? [project.dueRound - state.round] : []),
    ...state.routes.flatMap(route => route.agreement?.enabled && (route.owner === civId || route.partner === civId) ? [route.agreement.nextDeliveryRound - state.round] : []));
  return exchangePromisedResources(state, civId, horizon);
}

export function selectedInstitutionsFunded(state: WorldState, civId: number): boolean {
  return (state.knowledge?.active ?? []).every(compact => {
    if (compact.status !== 'accepted' || compact.terms.teacherId !== civId && compact.terms.learnerId !== civId) return true;
    const teacher = compact.terms.teacherId === civId;
    const cityId = teacher ? compact.terms.teacherCityId : compact.terms.learnerCityId;
    const buildingId = teacher ? compact.terms.teacherInstitutionId : compact.terms.learnerInstitutionId;
    return state.cities.find(city => city.id === cityId)?.buildingOperations?.[buildingId]?.lastResult?.status === 'operated';
  });
}

export function foodAllocation(state: WorldState, civId: number): { total: number; producers: Set<string> } {
  let total = 0;
  const producers = new Set<string>();
  for (const city of state.cities.filter(candidate => candidate.civId === civId)) {
    const output = allocatedCityFoodProduction(state, city);
    total += output.total;
    for (const building of output.buildings) if (building.food > 0) producers.add(`${city.id}/building/${building.buildingId}`);
    for (const improvement of output.improvements) if (improvement.food > 0) producers.add(`${city.id}/site/${improvement.tileId}`);
  }
  return { total: Math.round(total * 100) / 100, producers };
}

export function createPaidFoodSiteAffordability(state: WorldState, civId: number): (action: Extract<GameAction, { type: 'improve' }>) => boolean {
  let opening: WorldState | undefined;
  let baseline: ReturnType<typeof foodAllocation> | undefined;
  let promised: ReturnType<typeof exchangeReserve> | undefined;
  const actor = state.civilizations.find(candidate => candidate.id === civId);
  const upkeep = civilizationFoodUpkeep(state, civId);
  return action => {
    const definition = IMPROVEMENTS.find(candidate => candidate.id === action.improvementId);
    const city = state.cities.find(candidate => candidate.id === action.cityId && candidate.civId === civId);
    if (!actor || !definition || !paidFoodSite(definition) || !city || city.construction?.active
      || !hasFeatures(state, definition.requiredFeatures) || actor.era < definition.minEra || definition.requires.some(id => !actor.technologies.includes(id))
      || improvementSiteBlock(state, city, definition, action.tileId) || RESOURCE_IDS.some(resource => actor.resources[resource] < (definition.cost[resource] ?? 0))) return false;
    opening ??= projectOperationAllocation(state);
    baseline ??= foodAllocation(opening, civId);
    if (baseline.total >= upkeep && actor.resources.food >= upkeep * 4) return false;
    promised ??= exchangeReserve(state, civId);
    const remaining = opening.civilizations.find(candidate => candidate.id === civId)!;
    if (RESOURCE_IDS.some(resource => remaining.resources[resource] < (definition.cost[resource] ?? 0) + (definition.operatingInputs?.[resource] ?? 0) + promised!.ordinary[resource])
      || STRATEGIC_RESOURCE_IDS.some(resource => (remaining.strategicResources?.[resource] ?? 0) < (promised!.strategic[resource] ?? 0))) return false;
    const projected = projectOperationAllocation(state, candidate => {
      const payer = candidate.civilizations.find(candidate => candidate.id === civId)!;
      const town = candidate.cities.find(candidate => candidate.id === city.id)!;
      for (const resource of RESOURCE_IDS) payer.resources[resource] -= (definition.cost[resource] ?? 0) + promised!.ordinary[resource];
      for (const resource of STRATEGIC_RESOURCE_IDS) if ((promised!.strategic[resource] ?? 0) > 0) {
        payer.strategicResources ??= {};
        payer.strategicResources[resource] = (payer.strategicResources[resource] ?? 0) - promised!.strategic[resource]!;
      }
      town.improvements ??= {};
      town.improvements[String(action.tileId)] = {
        improvementId: definition.id, tileId: action.tileId,
        completion: { kind: 'improvement', orderId: 'opening-affordability-quote', cityId: city.id, improvementId: definition.id, tileId: action.tileId, startedRound: state.round, completedRound: state.round, paid: { ...definition.cost }, workRequired: definition.requiredWork, eventId: 'opening-affordability-quote' },
        operation: { enabled: true, lastResult: null },
      };
    });
    const funded = foodAllocation(projected, civId);
    return selectedInstitutionsFunded(projected, civId) && funded.producers.has(`${city.id}/site/${action.tileId}`) && [...baseline.producers].every(producer => funded.producers.has(producer));
  };
}

export function fundedPaidFoodSites(state: WorldState, civId: number, desiredBuildings: ReadonlySet<string>, desiredImprovements: ReadonlySet<string>): ReadonlySet<string> {
  if (!hasFeatures(state, [IMPROVEMENT_RULES.featureId])) return new Set();
  const promised = exchangeReserve(state, civId);
  const projected = projectOperationAllocation(state, opening => {
    const actor = opening.civilizations.find(candidate => candidate.id === civId)!;
    for (const resource of RESOURCE_IDS) actor.resources[resource] -= promised.ordinary[resource];
    for (const resource of STRATEGIC_RESOURCE_IDS) if ((promised.strategic[resource] ?? 0) > 0) {
      actor.strategicResources ??= {};
      actor.strategicResources[resource] = (actor.strategicResources[resource] ?? 0) - promised.strategic[resource]!;
    }
    for (const city of opening.cities.filter(candidate => candidate.civId === civId)) {
      for (const [buildingId, operation] of Object.entries(city.buildingOperations ?? {})) operation.enabled = desiredBuildings.has(`${city.id}/${buildingId}`);
      for (const improvement of Object.values(city.improvements ?? {})) improvement.operation.enabled = desiredImprovements.has(`${city.id}/${improvement.tileId}`);
    }
  });
  if (!selectedInstitutionsFunded(projected, civId)) return new Set();
  return new Set(projected.cities.filter(city => city.civId === civId).flatMap(city => Object.values(city.improvements ?? {}).flatMap(improvement => {
    const definition = IMPROVEMENTS.find(candidate => candidate.id === improvement.improvementId);
    return definition && paidFoodSite(definition) && improvement.operation.lastResult?.status === 'operated' ? [`${city.id}/${improvement.tileId}`] : [];
  })));
}
