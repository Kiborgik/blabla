import { BUILDINGS, RESOURCE_IDS } from '../content.ts';
import { HISTORICAL_DIRECTOR_EVENTS, HISTORICAL_EVENT_RULES, type HistoricalEventId } from '../historical-event-content.ts';
import type { City, EffectDefinition, Resources, Route, WorldState } from '../types.ts';
import { isCoastalSite } from './coastal.ts';
import { applyEffects } from './effects.ts';
import { hexDistance } from './geography.ts';
import { cityGrowthFacts } from './growth.ts';
import { hasFeatures } from './history.ts';
import { canAfford, clamp } from './world.ts';

type LocalEffect = Extract<EffectDefinition, { kind: 'resource' | 'city' }>;

export interface HistoricalEventFact {
  scope: 'civilization' | 'city' | 'route';
  id: number | string;
  field: string;
  before: number | boolean;
  after: number | boolean;
}

export interface HistoricalEventQuote {
  eventId: HistoricalEventId;
  target: number;
  revision: number;
  round: number;
  cityId: string;
  tileId: number;
  routeId?: string;
  destinationCityId?: string;
  buildingId?: string;
  cause: string;
  effects: LocalEffect[];
  destinationEffects: LocalEffect[];
  paid: Partial<Resources>;
  facts: HistoricalEventFact[];
  routeDamage?: { before: number; after: number; activeBefore: boolean; activeAfter: boolean };
}

export function isHistoricalEventId(id: string): id is HistoricalEventId {
  return HISTORICAL_DIRECTOR_EVENTS.some(event => event.id === id);
}

function orderedTowns(state: WorldState, target: number): City[] {
  return state.cities.filter(city => city.civId === target && city.population > 0 && state.tiles.some(tile => tile.id === city.tileId && tile.owner === target && tile.terrain !== 'ocean' && tile.terrain !== 'mountain'))
    .toSorted((left, right) => left.tileId - right.tileId || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function workingEndpointRoutes(state: WorldState, city: City): Route[] {
  return state.routes.filter(route => {
    const agreement = route.agreement;
    if (!route.active || !agreement?.enabled || agreement.closedRound !== null || agreement.blockedReason !== null || route.damage >= agreement.terms.damageDisableAt) return false;
    const from = state.cities.find(candidate => candidate.id === route.from);
    const to = state.cities.find(candidate => candidate.id === route.to);
    return !!from && !!to && from.civId === route.owner && to.civId === route.partner && from.population > 0 && to.population > 0
      && ((route.from === city.id && route.owner === city.civId) || (route.to === city.id && route.partner === city.civId));
  }).toSorted((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function effectFacts(state: WorldState, target: number, city: City, effects: LocalEffect[]): HistoricalEventFact[] {
  const civilization = state.civilizations.find(candidate => candidate.id === target);
  if (!civilization) throw new RangeError('Historical event requires an existing civilization');
  return effects.map(effect => {
    if (effect.kind === 'resource') {
      const before = civilization.resources[effect.resource];
      return { scope: 'civilization', id: target, field: effect.resource, before, after: clamp(before + effect.amount, 0) };
    }
    const before = city[effect.field];
    const minimum = effect.field === 'population' ? 1 : 0;
    const maximum = effect.field === 'damage' || effect.field === 'wellbeing' ? 100 : Number.MAX_SAFE_INTEGER;
    return { scope: 'city', id: city.id, field: effect.field, before, after: clamp(before + effect.amount, minimum, maximum) };
  });
}

export function historicalEventQuote(state: WorldState, eventId: string, target: number): HistoricalEventQuote | null {
  if (!isHistoricalEventId(eventId) || state.outcome || state.directorCooldown > 0) return null;
  const definition = HISTORICAL_DIRECTOR_EVENTS.find(event => event.id === eventId);
  const civilization = state.civilizations.find(candidate => candidate.id === target);
  if (!definition || !civilization || civilization.era < definition.minEra || !hasFeatures(state, definition.requiredFeatures)) return null;
  const cities = orderedTowns(state, target);
  let city: City | undefined;
  let destination: City | undefined;
  let route: Route | undefined;
  let buildingId: string | undefined;
  let cause = '';
  let paid: Partial<Resources> = {};
  const effects = definition.effects.filter((effect): effect is LocalEffect => effect.kind === 'resource' || effect.kind === 'city').map(effect => ({ ...effect }));
  const destinationEffects: LocalEffect[] = [];
  switch (eventId) {
    case 'cultivated-harvest': {
      paid = { ...HISTORICAL_EVENT_RULES.harvestCost };
      if (!canAfford(civilization.resources, paid)) return null;
      city = cities.find(candidate => candidate.damage < 100 && candidate.buildings.includes('farm') && state.tiles.some(tile => tile.id === candidate.tileId && tile.terrain === 'grassland'));
      if (!city) return null;
      cause = `${city.name} (${city.id}) has completed Terraced fields (farm) on owned grassland tile ${city.tileId}; three Materials fund the extra cultivated harvest`;
      break;
    }
    case 'forest-fire': {
      let forestTileId: number | undefined;
      city = cities.find(candidate => {
        if (candidate.damage >= 100) return false;
        const site = state.tiles.find(tile => tile.id === candidate.tileId);
        const forest = site && state.tiles.filter(tile => tile.terrain === 'forest' && hexDistance(site, tile) === 1).toSorted((left, right) => left.id - right.id)[0];
        if (!forest) return false;
        forestTileId = forest.id;
        return true;
      });
      if (!city || forestTileId === undefined) return null;
      cause = `${city.name} (${city.id}), inhabited by ${city.population} residents, adjoins forest tile ${forestTileId}; the fire's repairable damage is confined to this town`;
      break;
    }
    case 'coastal-storm': {
      city = cities.find(candidate => candidate.damage < 100 && isCoastalSite(state, candidate.tileId));
      if (!city) return null;
      route = workingEndpointRoutes(state, city)[0];
      cause = `${city.name} (${city.id}) stands on ocean-adjacent tile ${city.tileId}; the storm strikes this town${route ? ` and its exact active endpoint route ${route.id}` : ', with no active endpoint route affected'}`;
      break;
    }
    case 'trade-fair': {
      paid = { ...HISTORICAL_EVENT_RULES.fairCost };
      if (!canAfford(civilization.resources, paid)) return null;
      city = cities.find(candidate => {
        if (candidate.damage >= 100) return false;
        route = workingEndpointRoutes(state, candidate).find(item => {
          const agreement = item.agreement;
          return !!agreement && item.volume > 0 && agreement.deliveryCount > 0 && agreement.lastDeliveryRound !== null
            && agreement.lastDeliveryRound <= state.round && state.round - agreement.lastDeliveryRound <= agreement.terms.cadenceRounds;
        });
        return route !== undefined;
      });
      if (!city || !route?.agreement) return null;
      cause = `${city.name} (${city.id}) hosts a fair on working route ${route.id}, which actually delivered ${route.volume} cargo in round ${route.agreement.lastDeliveryRound}; four Food and two Materials fund the gathering, not another shipment`;
      break;
    }
    case 'industrial-accident': {
      city = cities.find(candidate => {
        if (candidate.damage >= 100) return false;
        buildingId = [...HISTORICAL_EVENT_RULES.industries].toSorted().find(id => {
          const building = BUILDINGS.find(item => item.id === id);
          const operation = candidate.buildingOperations?.[id];
          const result = operation?.lastResult;
          return !!building && candidate.buildings.includes(id) && hasFeatures(state, building.requiredFeatures) && operation?.enabled === true
            && result?.status === 'operated' && result.round === state.round
            && (RESOURCE_IDS.some(resource => (result.produced[resource] ?? 0) > 0) || (result.localPower?.generated ?? 0) > 0);
        });
        return buildingId !== undefined;
      });
      if (!city || !buildingId) return null;
      cause = `${city.name} (${city.id}) has an enabled ${buildingId} with actual operated output in current round ${state.round}; the accident damages only this operating town`;
      break;
    }
    case 'internal-migration': {
      paid = { ...HISTORICAL_EVENT_RULES.migrationCost };
      if (!canAfford(civilization.resources, paid)) return null;
      city = cities.find(candidate => {
        if (candidate.population < HISTORICAL_EVENT_RULES.migrants + 1 || (candidate.damage < HISTORICAL_EVENT_RULES.migrationSourceDamage && candidate.wellbeing > HISTORICAL_EVENT_RULES.migrationSourceWellbeing)) return false;
        destination = cities.find(other => other.id !== candidate.id && other.housing !== undefined
          && other.damage <= HISTORICAL_EVENT_RULES.migrationDestinationDamage && other.wellbeing >= HISTORICAL_EVENT_RULES.migrationDestinationWellbeing
          && cityGrowthFacts(state, other).capacity - other.population >= HISTORICAL_EVENT_RULES.migrants);
        return destination !== undefined;
      });
      if (!city || !destination) return null;
      effects.push({ kind: 'city', field: 'population', amount: -HISTORICAL_EVENT_RULES.migrants });
      destinationEffects.push({ kind: 'city', field: 'population', amount: HISTORICAL_EVENT_RULES.migrants });
      const capacity = cityGrowthFacts(state, destination).capacity;
      cause = `${city.name} (${city.id}) has Damage ${city.damage} and Wellbeing ${city.wellbeing}; two existing residents move to same-civilization ${destination.name} (${destination.id}), with Damage ${destination.damage}, Wellbeing ${destination.wellbeing} and housing ${destination.population}/${capacity}; four Food and two Credits fund the conserved move`;
      break;
    }
  }
  const facts = effectFacts(state, target, city, effects);
  if (destination) facts.push(...effectFacts(state, target, destination, destinationEffects));
  const quote: HistoricalEventQuote = {
    eventId, target, revision: state.revision, round: state.round, cityId: city.id, tileId: city.tileId,
    ...(route ? { routeId: route.id } : {}), ...(destination ? { destinationCityId: destination.id } : {}), ...(buildingId ? { buildingId } : {}),
    cause, effects, destinationEffects, paid, facts,
  };
  if (eventId === 'coastal-storm' && route?.agreement) {
    const after = clamp(route.damage + HISTORICAL_EVENT_RULES.stormRouteDamage, 0, 100);
    const activeAfter = route.active && after < route.agreement.terms.damageDisableAt;
    quote.routeDamage = { before: route.damage, after, activeBefore: route.active, activeAfter };
    facts.push({ scope: 'route', id: route.id, field: 'damage', before: route.damage, after });
    if (route.active !== activeAfter) facts.push({ scope: 'route', id: route.id, field: 'active', before: route.active, after: activeAfter });
  }
  return quote;
}

export function applyHistoricalEvent(state: WorldState, quote: HistoricalEventQuote): string[] {
  const current = historicalEventQuote(state, quote.eventId, quote.target);
  if (!current || JSON.stringify(current) !== JSON.stringify(quote)) throw new RangeError('Historical event quote is stale, edited or no longer eligible');
  const route = quote.routeDamage ? state.routes.find(candidate => candidate.id === quote.routeId) : undefined;
  if (quote.routeDamage && !route) throw new RangeError('Historical event quote route is missing');
  const changes = applyEffects(state, quote.target, quote.effects, quote.cityId);
  if (quote.destinationCityId) changes.push(...applyEffects(state, quote.target, quote.destinationEffects, quote.destinationCityId));
  if (quote.routeDamage && route) {
    route.damage = quote.routeDamage.after;
    route.active = quote.routeDamage.activeAfter;
    changes.push(`Route ${route.id} damage ${quote.routeDamage.before} → ${route.damage}`);
    if (quote.routeDamage.activeBefore !== route.active) changes.push(`Route ${route.id} active ${quote.routeDamage.activeBefore} → ${route.active}`);
  }
  return changes;
}

export function historicalEventWeight(state: WorldState, eventId: string, target: number): number {
  const quote = historicalEventQuote(state, eventId, target);
  if (!quote) return 0;
  const city = state.cities.find(candidate => candidate.id === quote.cityId);
  const civilization = state.civilizations.find(candidate => candidate.id === target);
  if (!city || !civilization) return 0;
  switch (quote.eventId) {
    case 'cultivated-harvest': return civilization.resources.food < city.population * 3 ? 8 : 4;
    case 'forest-fire': return 2;
    case 'coastal-storm': return quote.routeId ? 3 : 2;
    case 'trade-fair': return 5;
    case 'industrial-accident': return 3;
    case 'internal-migration': return 6 + Math.min(4, Math.floor(city.damage / 20));
  }
}
