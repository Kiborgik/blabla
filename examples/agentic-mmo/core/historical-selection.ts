import { borderReturnReservations } from './simulation/border-incidents.ts';
import { BUILDINGS, RESOURCE_IDS } from './content.ts';
import { HISTORICAL_DIRECTOR_EVENTS, HISTORICAL_EVENT_RULES, type HistoricalEventId } from './historical-event-content.ts';
import type { City, Resources, Route, WorldState } from './types.ts';
import { isCoastalSite } from './simulation/coastal.ts';
import { hexDistance } from './simulation/geography.ts';
import { cityGrowthFacts } from './simulation/growth.ts';
import { hasFeatures } from './simulation/history.ts';
import { randomStep } from './simulation/random.ts';
import { canAfford } from './simulation/world.ts';

export interface HistoricalEventRouteTarget { routeId: string; agreementOfferId: string; fromCityId: string; toCityId: string }
type LocalSite = { cityId: string; tileId: number };
export type HistoricalEventLocalTarget = LocalSite & (
  { kind: 'cultivated-harvest' }
  | { kind: 'forest-fire'; forestTileId: number }
  | { kind: 'coastal-storm'; route: HistoricalEventRouteTarget | null }
  | { kind: 'trade-fair'; route: HistoricalEventRouteTarget }
  | { kind: 'industrial-accident'; buildingId: string }
  | { kind: 'internal-migration'; destinationCityId: string; destinationTileId: number }
);
export interface HistoricalEventSelection { ruleVersion: 1; instanceId: string; occurrence: number; local: HistoricalEventLocalTarget }
export interface HistoricalEventCityCandidates { cityId: string; tileId: number; locals: HistoricalEventLocalTarget[] }
export interface HistoricalEventFact { scope: 'civilization' | 'city' | 'route'; id: number | string; field: string; before: number | boolean; after: number | boolean }
export interface HistoricalEventReceipt {
  ruleVersion: 1;
  instanceId: string;
  occurrence: number;
  selection: HistoricalEventSelection;
  eventKind: HistoricalEventId;
  civId: number;
  eventId: string;
  revision: number;
  round: number;
  paid: Partial<Resources>;
  facts: HistoricalEventFact[];
}

function compareId(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

function workingEndpointRoutes(state: WorldState, city: City): Route[] {
  return state.routes.filter(route => {
    const agreement = route.agreement;
    if (!route.active || !agreement?.enabled || agreement.closedRound !== null || agreement.blockedReason !== null || route.damage >= agreement.terms.damageDisableAt) return false;
    const from = state.cities.find(candidate => candidate.id === route.from);
    const to = state.cities.find(candidate => candidate.id === route.to);
    return !!from && !!to && from.civId === route.owner && to.civId === route.partner && from.population > 0 && to.population > 0
      && ((route.from === city.id && route.owner === city.civId) || (route.to === city.id && route.partner === city.civId));
  }).toSorted((left, right) => compareId(left.id, right.id));
}

function routeTarget(route: Route): HistoricalEventRouteTarget {
  if (!route.agreement) throw new RangeError('Historical route requires an agreement');
  return { routeId: route.id, agreementOfferId: route.agreement.offerId, fromCityId: route.from, toCityId: route.to };
}

export function historicalEventCandidates(state: WorldState, eventId: string, target: number): HistoricalEventCityCandidates[] {
  const definition = HISTORICAL_DIRECTOR_EVENTS.find(event => event.id === eventId);
  const civilization = state.civilizations.find(candidate => candidate.id === target);
  if (!definition || !civilization || state.outcome || state.directorCooldown > 0 || civilization.era < definition.minEra || !hasFeatures(state, definition.requiredFeatures)) return [];
  const cost = eventId === 'cultivated-harvest' ? HISTORICAL_EVENT_RULES.harvestCost : eventId === 'trade-fair' ? HISTORICAL_EVENT_RULES.fairCost : eventId === 'internal-migration' ? HISTORICAL_EVENT_RULES.migrationCost : {};
  if (!canAfford(civilization.resources, cost)) return [];
  const cities = state.cities.filter(city => city.civId === target && city.population > 0 && state.tiles.some(tile => tile.id === city.tileId && tile.owner === target && tile.terrain !== 'ocean' && tile.terrain !== 'mountain'))
    .toSorted((left, right) => left.tileId - right.tileId || compareId(left.id, right.id));
  return cities.flatMap(city => {
    const site = { cityId: city.id, tileId: city.tileId };
    let locals: HistoricalEventLocalTarget[] = [];
    switch (eventId) {
      case 'cultivated-harvest':
        if (city.damage < 100 && city.buildings.includes('farm') && state.tiles.some(tile => tile.id === city.tileId && tile.terrain === 'grassland')) locals = [{ ...site, kind: eventId }];
        break;
      case 'forest-fire': {
        const tile = state.tiles.find(candidate => candidate.id === city.tileId);
        if (city.damage < 100 && tile) locals = state.tiles.filter(candidate => candidate.terrain === 'forest' && hexDistance(tile, candidate) === 1)
          .toSorted((left, right) => left.id - right.id).map(forest => ({ ...site, kind: eventId, forestTileId: forest.id }));
        break;
      }
      case 'coastal-storm': {
        if (city.damage >= 100 || !isCoastalSite(state, city.tileId)) break;
        const routes = workingEndpointRoutes(state, city);
        locals = routes.length ? routes.map(route => ({ ...site, kind: eventId, route: routeTarget(route) })) : [{ ...site, kind: eventId, route: null }];
        break;
      }
      case 'trade-fair':
        if (city.damage < 100) locals = workingEndpointRoutes(state, city).filter(route => {
          const agreement = route.agreement;
          return !!agreement && route.volume > 0 && agreement.deliveryCount > 0 && agreement.lastDeliveryRound !== null
            && agreement.lastDeliveryRound <= state.round && state.round - agreement.lastDeliveryRound <= agreement.terms.cadenceRounds;
        }).map(route => ({ ...site, kind: eventId, route: routeTarget(route) }));
        break;
      case 'industrial-accident':
        if (city.damage < 100) locals = [...HISTORICAL_EVENT_RULES.industries].toSorted(compareId).filter(id => {
          const building = BUILDINGS.find(candidate => candidate.id === id);
          const operation = city.buildingOperations?.[id];
          const result = operation?.lastResult;
          return !!building && city.buildings.includes(id) && hasFeatures(state, building.requiredFeatures) && operation?.enabled === true
            && result?.status === 'operated' && result.round === state.round
            && (RESOURCE_IDS.some(resource => (result.produced[resource] ?? 0) > 0) || (result.localPower?.generated ?? 0) > 0);
        }).map(buildingId => ({ ...site, kind: eventId, buildingId }));
        break;
      case 'internal-migration':
        if (city.population >= HISTORICAL_EVENT_RULES.migrants + 1 && (city.damage >= HISTORICAL_EVENT_RULES.migrationSourceDamage || city.wellbeing <= HISTORICAL_EVENT_RULES.migrationSourceWellbeing)) {
          locals = cities.filter(other => other.id !== city.id && other.housing !== undefined
            && other.damage <= HISTORICAL_EVENT_RULES.migrationDestinationDamage && other.wellbeing >= HISTORICAL_EVENT_RULES.migrationDestinationWellbeing
            && cityGrowthFacts(state, other).capacity - other.population - borderReturnReservations(state, other.id) >= HISTORICAL_EVENT_RULES.migrants)
            .map(destination => ({ ...site, kind: eventId, destinationCityId: destination.id, destinationTileId: destination.tileId }));
        }
        break;
    }
    return locals.length ? [{ ...site, locals }] : [];
  });
}

export function historicalEventInstanceId(seed: number, eventId: HistoricalEventId, civId: number, occurrence: number): string {
  return JSON.stringify(['regional-targets-v1', seed, eventId, civId, occurrence]);
}

function selectedIndex(instanceId: string, domain: readonly (string | number)[], size: number): number {
  let hash = 0x811c9dc5;
  for (const character of JSON.stringify(['regional-targets-v1', instanceId, ...domain])) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return Math.floor(randomStep(hash).value * size);
}

export function selectHistoricalEventTarget(state: WorldState, eventId: string, target: number): HistoricalEventSelection | null {
  if (!hasFeatures(state, ['procedural-regional-targets'])) return null;
  const count = state.eventCounts[eventId] ?? 0;
  if (!Number.isSafeInteger(count) || count < 0 || count >= Number.MAX_SAFE_INTEGER || !Number.isSafeInteger(state.seed) || state.seed < 0 || state.seed > 0xffffffff) return null;
  const candidates = historicalEventCandidates(state, eventId, target);
  if (!candidates.length) return null;
  const occurrence = count + 1;
  const instanceId = historicalEventInstanceId(state.seed, eventId as HistoricalEventId, target, occurrence);
  const city = candidates[selectedIndex(instanceId, ['city'], candidates.length)];
  if (!city) return null;
  const local = city.locals[selectedIndex(instanceId, ['attachment', city.cityId, city.tileId], city.locals.length)];
  return local ? { ruleVersion: 1, instanceId, occurrence, local } : null;
}
