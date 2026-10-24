import { isCoastalSite } from './coastal.ts';
import { purchasedSiteBlock } from './site-binding.ts';
import { IMPROVEMENTS, IMPROVEMENT_RULES, RESIDENT_CAPACITY_RULES, RESOURCE_IDS } from '../content.ts';
import type { City, CityImprovement, ConstructionCompletion, ConstructionOrder, GameAction, GameEvent, HexTile, ImprovementConstructionOrder, ImprovementDefinition, Resources, WorldState } from '../types.ts';
import { districtSiteOccupied } from './districts.ts';
import { emitEvent } from './events.ts';
import { hexDistance } from './geography.ts';
import { hasFeatures } from './history.ts';
import { civilizationById, transferCost } from './world.ts';
import { revealedHorseSite } from './pastoral.ts';
import type { DrainageNode } from '../drainage.ts';
import { RIVER_INTAKE_RULES } from '../river-intake-content.ts';
import { riverDrainageNodes, riverIntakeSiteBlock } from './river-intakes.ts';

export function isImprovementOrder(order: ConstructionOrder): order is ImprovementConstructionOrder {
  return 'kind' in order && order.kind === 'improvement';
}

export function constructionTarget(order: ConstructionOrder | ConstructionCompletion): string {
  return 'kind' in order ? order.kind === 'wonder' ? `wonder:${order.wonderId}` : order.kind === 'rail' ? `rail:${order.edgeId}` : `improvement:${order.improvementId}` : order.buildingId;
}

export function isHillSite(tile: HexTile): boolean {
  return tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && tile.elevation >= IMPROVEMENT_RULES.hillElevation.minimum && tile.elevation <= IMPROVEMENT_RULES.hillElevation.maximum;
}

export function orderedImprovements(city: City): CityImprovement[] {
  return Object.values(city.improvements ?? {}).toSorted((left, right) => left.tileId - right.tileId);
}

function resolvedImprovementSiteBlock(state: WorldState, city: City, definition: ImprovementDefinition, tileId: number, site: HexTile | undefined, center: HexTile | undefined, installed = false, reservationOrderId?: string, riverNodes?: ReadonlyMap<number, DrainageNode> | null): string | null {
  if (!Number.isSafeInteger(tileId) || !site || !center) return 'The exact improvement site is missing';
  if (site.owner !== city.civId) return 'The improvement site must already belong to this civilization';
  const binding = purchasedSiteBlock(state, city, tileId); if (binding) return binding;
  if (definition.id === RIVER_INTAKE_RULES.improvementId) {
    const riverBlock = riverIntakeSiteBlock(state, city, tileId, riverNodes === undefined ? riverDrainageNodes(state) : riverNodes, installed, reservationOrderId);
    if (riverBlock) return riverBlock;
  }
  if (definition.siteRequirement === 'coastal-land' && (center.owner !== city.civId || !isCoastalSite(state, site.id) || !isCoastalSite(state, center.id))) return 'The improvement requires buildable coastal land and its exact coastal town';
  if (definition.siteRequirement === 'grassland-hill' && (center.owner !== city.civId || site.terrain !== 'grassland' || !isHillSite(site))) return 'The improvement requires an owned grassland hill and its exact owned town';
  if (definition.siteRequirement === 'hill' && !isHillSite(site)) return 'The improvement requires a buildable hill site';
  if (definition.siteRequirement === 'forest' && site.terrain !== 'forest') return 'The improvement requires a current forest site';
  if (definition.id === 'charcoal-clearing' && center.owner !== city.civId) return 'The Charcoal clearing requires its exact owned support town';
  if (definition.siteRequirement === 'revealed-horse-site' && (site.terrain !== 'grassland' || !revealedHorseSite(state, city.civId, tileId))) return 'The improvement requires this civilization’s revealed grassland horse site';
  if (hexDistance(center, site) > definition.siteRange) return `The improvement site must be within ${definition.siteRange} hexes of this town`;
  if (state.cities.some(candidate => candidate.tileId === tileId)) return 'A city center occupies this site';
  const active = city.construction?.active;
  const ownReservation = definition.id === RIVER_INTAKE_RULES.improvementId && active && active.id === reservationOrderId && active.tileId === tileId && 'kind' in active && active.kind === 'improvement' && active.improvementId === definition.id;
  const occupancyState = ownReservation ? { ...state, cities: state.cities.map(candidate => candidate.id === city.id ? { ...candidate, construction: { ...candidate.construction!, active: null } } : candidate) } : state;
  if (districtSiteOccupied(occupancyState, tileId, installed ? { cityId: city.id, tileId } : undefined)) return 'A completed or reserved district or improvement occupies this site';
  return null;
}

export function improvementSiteBlock(state: WorldState, city: City, definition: ImprovementDefinition, tileId: number, installed = false, reservationOrderId?: string, riverNodes?: ReadonlyMap<number, DrainageNode> | null): string | null {
  return resolvedImprovementSiteBlock(state, city, definition, tileId, state.tiles.find(tile => tile.id === tileId), state.tiles.find(tile => tile.id === city.tileId), installed, reservationOrderId, riverNodes);
}

export function availableImprovementSites(state: WorldState, city: City, definition: ImprovementDefinition): number[] {
  const center = state.tiles.find(tile => tile.id === city.tileId);
  const riverNodes = definition.id === RIVER_INTAKE_RULES.improvementId ? riverDrainageNodes(state) : undefined;
  return state.tiles.filter(tile => resolvedImprovementSiteBlock(state, city, definition, tile.id, tile, center, false, undefined, riverNodes) === null).map(tile => tile.id).toSorted((a, b) => a - b);
}

export function executeImprovementAction(state: WorldState, seat: number, action: Extract<GameAction, { type: 'improve' | 'set-improvement-operation' }>, events: GameEvent[]): void {
  const city = state.cities.find(candidate => candidate.id === action.cityId && candidate.civId === seat);
  const definition = IMPROVEMENTS.find(candidate => candidate.id === action.improvementId);
  if (!city || !definition) throw new RangeError('Improvement requires its exact owned town and definition');
  if (action.type === 'set-improvement-operation') {
    const improvement = city.improvements?.[String(action.tileId)];
    if (!improvement || improvement.improvementId !== action.improvementId) throw new RangeError('Improvement operation requires its exact installed instance');
    improvement.operation.enabled = action.enabled;
    emitEvent(state, events, {
      type: 'improvement-operation-changed', title: `${city.name} ${action.enabled ? 'resumes' : 'pauses'} ${definition.name}`,
      detail: `${city.id}/${action.tileId}/${definition.id}`, actor: seat, target: seat, tileId: action.tileId,
      cause: 'The civilization changed this exact installed site operation',
      effects: [definition.operatingInputs ? action.enabled ? 'Future strategic beats jointly reserve remaining local residents and complete opening inputs' : 'Future strategic beats spend no site inputs or residents; previous output is unchanged' : action.enabled ? 'Future strategic beats may assign remaining local residents' : 'Future strategic beats leave this site unstaffed; previous output is unchanged'], importance: 2,
    });
    return;
  }
  if (city.construction?.active) throw new RangeError('The town already has an active construction commitment');
  transferCost(civilizationById(state, seat).resources, definition.cost);
  city.construction ??= { active: null, lastCompleted: null };
  city.construction.active = {
    kind: 'improvement', id: `construction-${state.revision}`, cityId: city.id, improvementId: definition.id, tileId: action.tileId,
    ruleVersion: IMPROVEMENT_RULES.ruleVersion, startedRound: state.round, paid: structuredClone(definition.cost), workRequired: definition.requiredWork, workDone: 0,
  };
  emitEvent(state, events, {
    type: 'construction-started', title: `${city.name} starts ${definition.name}`, detail: city.construction.active.id,
    actor: seat, target: seat, tileId: action.tileId, cause: 'The exact owned site was reserved with one construction payment in the town lane',
    effects: [...RESOURCE_IDS.filter(resource => (definition.cost[resource] ?? 0) > 0).map(resource => `Paid ${definition.cost[resource]} ${resource}`), `Work 0/${definition.requiredWork}`, 'No resident allocation or output until a later beat after completion'], importance: 3,
  });
}

export function installImprovement(state: WorldState, city: City, order: ImprovementConstructionOrder, events: GameEvent[]): void {
  const definition = IMPROVEMENTS.find(candidate => candidate.id === order.improvementId);
  if (!definition || city.improvements?.[String(order.tileId)]) throw new RangeError('Improvement completion requires its exact uninstalled definition and site');
  const event = emitEvent(state, events, {
    type: 'improvement-completed', title: `${city.name} completes ${definition.name}`, detail: `${city.id}/${order.tileId}/${definition.id}`,
    actor: city.civId, target: city.civId, tileId: order.tileId, cause: 'The retained paid exact-site order completed its required strategic work',
    effects: [`Completed improvement ${definition.id} at site ${order.tileId}`, `Requires ${definition.residentsRequired} remaining local residents on later beats`, ...RESOURCE_IDS.filter(resource => (definition.operatingInputs?.[resource] ?? 0) > 0).map(resource => `Requires ${definition.operatingInputs?.[resource]} opening ${resource} per funded beat`), ...RESOURCE_IDS.filter(resource => (definition.production[resource] ?? 0) > 0).map(resource => `Base ${resource} ${definition.production[resource]} before town productivity when staffed`)], importance: 4,
  });
  const completion = { kind: 'improvement' as const, orderId: order.id, cityId: city.id, improvementId: order.improvementId, tileId: order.tileId, startedRound: order.startedRound, completedRound: state.round, paid: structuredClone(order.paid), workRequired: order.workRequired, eventId: event.id };
  city.improvements ??= {};
  city.improvements[String(order.tileId)] = { improvementId: order.improvementId, tileId: order.tileId, completion, operation: { enabled: true, lastResult: null } };
  if (!city.construction) throw new RangeError('Improvement completion requires its town lane');
  city.construction.lastCompleted = structuredClone(completion);
}

export function allocateImprovements(state: WorldState, city: City, available: number, budget: Resources): number {
  if (!hasFeatures(state, [IMPROVEMENT_RULES.featureId])) return available;
  for (const improvement of orderedImprovements(city)) {
    if (improvement.improvementId === RIVER_INTAKE_RULES.improvementId) continue;
    const definition = IMPROVEMENTS.find(candidate => candidate.id === improvement.improvementId);
    if (!definition) throw new RangeError('Installed improvement requires a known definition');
    const inputs = definition.operatingInputs ? RESOURCE_IDS.flatMap(resource => {
      const required = definition.operatingInputs?.[resource] ?? 0;
      return required > 0 ? [{ resource, required, available: budget[resource] }] : [];
    }) : undefined;
    const result: NonNullable<typeof improvement.operation.lastResult> = {
      round: state.round, status: 'paused', paid: {}, produced: {}, blockedReason: null, ...(inputs ? { inputs, shortages: [] } : {}),
      residents: { ruleVersion: RESIDENT_CAPACITY_RULES.ruleVersion, openingPopulation: city.population, communityReserve: RESIDENT_CAPACITY_RULES.communityReserve, required: definition.residentsRequired, available, allocated: 0 },
    };
    improvement.operation.lastResult = result;
    if (!improvement.operation.enabled) continue;
    if ((inputs && !hasFeatures(state, definition.requiredFeatures)) || improvementSiteBlock(state, city, definition, improvement.tileId, true)) {
      result.status = 'blocked'; result.blockedReason = 'site-ineligible'; continue;
    }
    if (inputs) {
      result.shortages = inputs.filter(input => input.available < input.required).map(input => ({ ...input }));
      if (result.shortages.length) { result.status = 'blocked'; result.blockedReason = 'input-shortage'; continue; }
    }
    if (available < definition.residentsRequired) {
      result.status = 'blocked'; result.blockedReason = 'resident-shortage'; continue;
    }
    if (inputs) {
      const civilization = civilizationById(state, city.civId);
      for (const input of inputs) {
        budget[input.resource] -= input.required;
        civilization.resources[input.resource] -= input.required;
        result.paid[input.resource] = input.required;
      }
    }
    available -= definition.residentsRequired;
    result.status = 'operated'; result.residents.allocated = definition.residentsRequired;
  }
  return available;
}

export function emitImprovements(state: WorldState, city: City, events: GameEvent[]): void {
  if (!hasFeatures(state, [IMPROVEMENT_RULES.featureId])) return;
  for (const improvement of orderedImprovements(city)) {
    const result = improvement.operation.lastResult;
    if (!result) continue;
    emitEvent(state, events, {
      type: 'improvement-operation', title: `${city.name}: ${improvement.improvementId} ${result.status}`, detail: `${city.id}/${improvement.tileId}/${improvement.improvementId} at strategic round ${result.round}`,
      ...(result.extraction ? { strategicExtraction: structuredClone(result.extraction) } : {}),
      actor: city.civId, target: city.civId, tileId: improvement.tileId,
      cause: result.blockedReason ?? (result.status === 'paused' ? 'The civilization paused this exact site' : result.river ? 'After all ordinary paid work, complete opening Material, remaining local residents and renewable flow were reserved jointly in physical upstream order' : result.inputs ? 'Complete opening inputs and remaining local residents were reserved jointly after paid buildings, in numeric site order' : 'Remaining opening residents were assigned after paid buildings, in numeric site order'),
      effects: [...(result.inputs ?? []).map(input => `${input.resource}: required ${input.required}, opening stock remaining ${input.available}, paid ${result.paid[input.resource] ?? 0}`), `Residents: required ${result.residents.required}, opening capacity remaining ${result.residents.available}, allocated ${result.residents.allocated}; population is not consumed`, ...RESOURCE_IDS.filter(resource => (result.produced[resource] ?? 0) > 0).map(resource => `Produced ${result.produced[resource]} ${resource}`), ...(RESOURCE_IDS.every(resource => !(result.produced[resource] ?? 0)) ? ['No output produced'] : []), ...(result.river ? [`River ${result.river.tileId} → ${result.river.downstreamTileId}, outlet ${result.river.outletTileId}: available ${result.river.availableBefore}, withdrawn ${result.river.withdrawn}, remaining ${result.river.remainingAfter}; no return flow`, `Irrigation funded round ${result.river.supportAllocationRound ?? 'none'}`] : []), ...(result.extraction ? [`Finite ${result.extraction.resource}: ${result.extraction.status}; credited ${result.extraction.quantity}, reserve ${result.extraction.reserveBefore} → ${result.extraction.reserveAfter}`] : [])], importance: result.status === 'blocked' ? 2 : 1,
    });
  }
}
