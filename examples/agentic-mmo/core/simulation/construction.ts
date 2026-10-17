import { initializeLocalPower } from './local-power.ts';
import { installRail, isRailOrder, railSiteBlock } from './rail.ts';
import { governmentModifiers } from './government.ts';
import { isWonderOrder, resolveWonderConstruction } from './wonders.ts';
import { installImprovement, isImprovementOrder } from './improvements.ts';
import { buildingBaseProduction, describeDistrictProduction } from './districts.ts';
import { BUILDINGS, CONSTRUCTION_RULES, RESOURCE_IDS } from '../content.ts';
import type { CampusHighGroundSite, BuildingDefinition, City, GameEvent, WorldState } from '../types.ts';
import { applyEffects } from './effects.ts';
import { emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';
import { paidRecipe } from './operations.ts';
import { cityProductivity } from './world.ts';

export function constructionWork(state: WorldState, city: City): number {
  return Math.round(((city.focus === 'industry' ? CONSTRUCTION_RULES.industryWork : CONSTRUCTION_RULES.baseWork) + governmentModifiers(state, city.civId).constructionWork) * cityProductivity(city) * 100) / 100;
}

export function requiredConstructionWork(buildingId: string): number {
  const specified = Object.entries(CONSTRUCTION_RULES.requiredWork).find(([id]) => id === buildingId);
  return specified?.[1] ?? CONSTRUCTION_RULES.defaultRequiredWork;
}

export function installBuilding(state: WorldState, city: City, definition: BuildingDefinition, events: GameEvent[], tileId?: number, catchmentTileId?: number, highGround?: CampusHighGroundSite): GameEvent {
  if (definition.siteRequirement === 'campus-high-ground') {
    if (highGround === undefined) throw new RangeError('Building completion requires its retained Campus high ground');
    city.buildingHighGround ??= {};
    city.buildingHighGround[definition.id] = structuredClone(highGround);
  }
  if (definition.siteRequirement === 'mountain-catchment') {
    if (catchmentTileId === undefined) throw new RangeError('Building completion requires its retained mountain catchment');
    city.buildingCatchments ??= {};
    city.buildingCatchments[definition.id] = catchmentTileId;
  }
  if (definition.district) {
    if (tileId === undefined) throw new RangeError('District completion requires its retained exact site');
    city.districtSites ??= {};
    city.districtSites[definition.id] = tileId;
  }
  city.buildings.push(definition.id);
  initializeLocalPower(state, city, definition);
  if (paidRecipe(definition)) {
    city.buildingOperations ??= {};
    city.buildingOperations[definition.id] = { enabled: true, lastResult: null };
  }
  const production = buildingBaseProduction(state, city, definition);
  const effects = applyEffects(state, city.civId, definition.effects, city.id);
  return emitEvent(state, events, {
    type: 'building-completed',
    title: `${city.name} builds ${definition.name}`,
    detail: definition.description,
    actor: city.civId,
    target: city.civId,
    tileId: tileId ?? city.tileId,
    cause: 'Known technology and a paid material investment enabled this construction',
    effects: [
      ...effects,
      ...(definition.district && tileId !== undefined ? [describeDistrictProduction(state, city, definition, tileId)] : []),
      ...(definition.capabilities ?? []).map(capability => `Completed capability ${capability}`),
      ...(definition.housing && hasFeatures(state, ['water-land']) ? [`Completed housing capacity +${definition.housing}`] : []),
      ...(catchmentTileId === undefined ? [] : [`Retained mountain catchment ${catchmentTileId}`]),
      ...(highGround === undefined ? [] : [`Retained Campus ${highGround.campusTileId} high ground ${highGround.sourceTileId}`]),
      ...RESOURCE_IDS.filter(resource => (definition.operatingInputs?.[resource] ?? 0) > 0).map(resource => `Operating input ${resource} ${definition.operatingInputs?.[resource]} per funded beat`),
      ...Object.entries(definition.strategicInputs ?? {}).filter(([, amount]) => amount > 0).map(([resource, amount]) => `Operating input ${resource} ${amount} per funded beat`),
      ...((definition.localPowerOutput ?? 0) > 0 ? [`Generates ${definition.localPowerOutput} same-town Power and records ${definition.emissionsPerOperation ?? 0} emissions when fully staffed and funded; unused Power expires`] : []),
      ...((definition.localPowerInput ?? 0) > 0 ? [`Operating input ${definition.localPowerInput} same-town Power per funded beat`] : []),
      ...RESOURCE_IDS.filter(resource => (production[resource] ?? 0) > 0).map(resource => `Seasonal ${resource} +${production[resource]}${paidRecipe(definition) ? ' when the complete operating recipe is funded' : ''}`),
    ],
    importance: 4,
  });
}

export function openingConstructionWork(state: WorldState): Map<string, number> {
  if (!hasFeatures(state, ['recurring-decisions'])) return new Map();
  return new Map(state.cities.filter(city => city.construction?.active).map(city => [city.id, constructionWork(state, city)]));
}

export function resolveConstruction(state: WorldState, opening: ReadonlyMap<string, number>, events: GameEvent[]): void {
  if (!opening.size) return;
  for (const city of state.cities.toSorted((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    const construction = city.construction;
    const order = construction?.active;
    const work = opening.get(city.id);
    if (!construction || !order || isWonderOrder(order) || work === undefined || state.round <= order.startedRound) continue;
    if (isRailOrder(order) && railSiteBlock(state, city, order.tileId, order.toTileId, order.id)) continue;
    order.workDone = Math.min(order.workRequired, Math.round((order.workDone + work) * 100) / 100);
    if (order.workDone < order.workRequired) continue;
    if (isRailOrder(order)) { installRail(state, city, order, events); construction.active = null; continue; }
    if (isImprovementOrder(order)) {
      installImprovement(state, city, order, events);
      construction.active = null;
      continue;
    }
    const definition = BUILDINGS.find(building => building.id === order.buildingId);
    if (!definition || city.buildings.includes(order.buildingId)) throw new RangeError('Construction completion requires its exact unbuilt definition');
    const event = installBuilding(state, city, definition, events, order.tileId, order.catchmentTileId, order.highGround);
    construction.lastCompleted = {
      orderId: order.id, cityId: city.id, buildingId: order.buildingId,
      startedRound: order.startedRound, completedRound: state.round,
      ...(order.tileId === undefined ? {} : { tileId: order.tileId }),
      ...(order.catchmentTileId === undefined ? {} : { catchmentTileId: order.catchmentTileId }),
      ...(order.highGround === undefined ? {} : { highGround: structuredClone(order.highGround) }),
      paid: structuredClone(order.paid), workRequired: order.workRequired, eventId: event.id,
    };
    construction.active = null;
  }
  resolveWonderConstruction(state, opening, events);
}
