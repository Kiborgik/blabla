import { buildingBaseProduction, describeDistrictProduction } from './districts.ts';
import { BUILDINGS, CONSTRUCTION_RULES, RESOURCE_IDS } from '../content.ts';
import type { BuildingDefinition, City, GameEvent, WorldState } from '../types.ts';
import { applyEffects } from './effects.ts';
import { emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';
import { paidRecipe } from './operations.ts';
import { cityProductivity } from './world.ts';

export function constructionWork(city: City): number {
  return Math.round((city.focus === 'industry' ? CONSTRUCTION_RULES.industryWork : CONSTRUCTION_RULES.baseWork) * cityProductivity(city) * 100) / 100;
}

export function requiredConstructionWork(buildingId: string): number {
  const specified = Object.entries(CONSTRUCTION_RULES.requiredWork).find(([id]) => id === buildingId);
  return specified?.[1] ?? CONSTRUCTION_RULES.defaultRequiredWork;
}

export function installBuilding(state: WorldState, city: City, definition: BuildingDefinition, events: GameEvent[], tileId?: number): GameEvent {
  if (definition.district) {
    if (tileId === undefined) throw new RangeError('District completion requires its retained exact site');
    city.districtSites ??= {};
    city.districtSites[definition.id] = tileId;
  }
  city.buildings.push(definition.id);
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
      ...RESOURCE_IDS.filter(resource => (definition.operatingInputs?.[resource] ?? 0) > 0).map(resource => `Operating input ${resource} ${definition.operatingInputs?.[resource]} per funded beat`),
      ...RESOURCE_IDS.filter(resource => (production[resource] ?? 0) > 0).map(resource => `Seasonal ${resource} +${production[resource]}${paidRecipe(definition) ? ' when the complete operating recipe is funded' : ''}`),
    ],
    importance: 4,
  });
}

export function openingConstructionWork(state: WorldState): Map<string, number> {
  if (!hasFeatures(state, ['recurring-decisions'])) return new Map();
  return new Map(state.cities.filter(city => city.construction?.active).map(city => [city.id, constructionWork(city)]));
}

export function resolveConstruction(state: WorldState, opening: ReadonlyMap<string, number>, events: GameEvent[]): void {
  if (!opening.size) return;
  for (const city of state.cities.toSorted((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    const construction = city.construction;
    const order = construction?.active;
    const work = opening.get(city.id);
    if (!construction || !order || work === undefined || state.round <= order.startedRound) continue;
    order.workDone = Math.min(order.workRequired, Math.round((order.workDone + work) * 100) / 100);
    if (order.workDone < order.workRequired) continue;
    const definition = BUILDINGS.find(building => building.id === order.buildingId);
    if (!definition || city.buildings.includes(order.buildingId)) throw new RangeError('Construction completion requires its exact unbuilt definition');
    const event = installBuilding(state, city, definition, events, order.tileId);
    construction.lastCompleted = {
      orderId: order.id, cityId: city.id, buildingId: order.buildingId,
      startedRound: order.startedRound, completedRound: state.round,
      ...(order.tileId === undefined ? {} : { tileId: order.tileId }),
      paid: structuredClone(order.paid), workRequired: order.workRequired, eventId: event.id,
    };
    construction.active = null;
  }
}
