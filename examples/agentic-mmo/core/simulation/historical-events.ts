import { HISTORICAL_DIRECTOR_EVENTS, HISTORICAL_EVENT_RULES, type HistoricalEventId } from '../historical-event-content.ts';
import type { City, EffectDefinition, Resources, WorldState } from '../types.ts';
import { applyEffects } from './effects.ts';
import { cityGrowthFacts } from './growth.ts';
import { hasFeatures } from './history.ts';
import { clamp } from './world.ts';
import { historicalEventCandidates, historicalEventInstanceId, type HistoricalEventFact, type HistoricalEventLocalTarget, type HistoricalEventReceipt, type HistoricalEventSelection } from '../historical-selection.ts';
import { isHistoricalEventSelection } from '../historical-selection-validation.ts';
export type { HistoricalEventFact } from '../historical-selection.ts';

type LocalEffect = Extract<EffectDefinition, { kind: 'resource' | 'city' }>;

export interface HistoricalEventQuote {
  selection?: HistoricalEventSelection;
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

function localEventQuote(state: WorldState, eventId: HistoricalEventId, target: number, local: HistoricalEventLocalTarget, selection?: HistoricalEventSelection): HistoricalEventQuote | null {
  const definition = HISTORICAL_DIRECTOR_EVENTS.find(event => event.id === eventId);
  const city = state.cities.find(candidate => candidate.id === local.cityId);
  if (!definition || !city) return null;
  const destination = local.kind === 'internal-migration' ? state.cities.find(candidate => candidate.id === local.destinationCityId) : undefined;
  const route = (local.kind === 'trade-fair' || local.kind === 'coastal-storm') && local.route ? state.routes.find(candidate => candidate.id === local.route?.routeId) : undefined;
  const buildingId = local.kind === 'industrial-accident' ? local.buildingId : undefined;
  let cause = '';
  let paid: Partial<Resources> = {};
  const effects = definition.effects.filter((effect): effect is LocalEffect => effect.kind === 'resource' || effect.kind === 'city').map(effect => ({ ...effect }));
  const destinationEffects: LocalEffect[] = [];
  switch (local.kind) {
    case 'cultivated-harvest': {
      paid = { ...HISTORICAL_EVENT_RULES.harvestCost };
      cause = `${city.name} (${city.id}) has completed Terraced fields (farm) on owned grassland tile ${city.tileId}; three Materials fund the extra cultivated harvest`;
      break;
    }
    case 'forest-fire': {
      cause = `${city.name} (${city.id}), inhabited by ${city.population} residents, adjoins forest tile ${local.forestTileId}; the fire's repairable damage is confined to this town`;
      break;
    }
    case 'coastal-storm': {
      cause = `${city.name} (${city.id}) stands on ocean-adjacent tile ${city.tileId}; the storm strikes this town${route ? ` and its exact active endpoint route ${route.id}` : ', with no active endpoint route affected'}`;
      break;
    }
    case 'trade-fair': {
      if (!route?.agreement) return null;
      paid = { ...HISTORICAL_EVENT_RULES.fairCost };
      cause = `${city.name} (${city.id}) hosts a fair on working route ${route.id}, which actually delivered ${route.volume} cargo in round ${route.agreement.lastDeliveryRound}; four Food and two Materials fund the gathering, not another shipment`;
      break;
    }
    case 'industrial-accident': {
      cause = `${city.name} (${city.id}) has an enabled ${buildingId} with actual operated output in current round ${state.round}; the accident damages only this operating town`;
      break;
    }
    case 'internal-migration': {
      if (!destination) return null;
      paid = { ...HISTORICAL_EVENT_RULES.migrationCost };
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
    ...(selection ? { selection: structuredClone(selection) } : {}),
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

export function historicalEventQuote(state: WorldState, eventId: string, target: number, selection?: HistoricalEventSelection): HistoricalEventQuote | null {
  if (!isHistoricalEventId(eventId)) return null;
  const candidates = historicalEventCandidates(state, eventId, target);
  if (!hasFeatures(state, ['procedural-regional-targets'])) {
    const local = candidates[0]?.locals[0];
    return selection === undefined && local ? localEventQuote(state, eventId, target, local) : null;
  }
  if (!isHistoricalEventSelection(selection)) return null;
  const count = state.eventCounts[eventId] ?? 0;
  if (!Number.isSafeInteger(count) || count < 0 || count >= Number.MAX_SAFE_INTEGER || !Number.isSafeInteger(state.seed) || state.seed < 0 || state.seed > 0xffffffff
    || selection.occurrence !== count + 1 || selection.instanceId !== historicalEventInstanceId(state.seed, eventId, target, selection.occurrence)) return null;
  const local = candidates.find(city => city.cityId === selection.local.cityId && city.tileId === selection.local.tileId)?.locals.find(candidate => sameLocal(candidate, selection.local));
  return local ? localEventQuote(state, eventId, target, local, selection) : null;
}

function sameLocal(left: HistoricalEventLocalTarget, right: HistoricalEventLocalTarget): boolean {
  if (left.kind !== right.kind || left.cityId !== right.cityId || left.tileId !== right.tileId) return false;
  if (left.kind === 'forest-fire' && right.kind === 'forest-fire') return left.forestTileId === right.forestTileId;
  if (left.kind === 'industrial-accident' && right.kind === 'industrial-accident') return left.buildingId === right.buildingId;
  if (left.kind === 'internal-migration' && right.kind === 'internal-migration') return left.destinationCityId === right.destinationCityId && left.destinationTileId === right.destinationTileId;
  if ((left.kind === 'trade-fair' || left.kind === 'coastal-storm') && (right.kind === 'trade-fair' || right.kind === 'coastal-storm')) {
    return left.route === null || right.route === null ? left.route === right.route : left.route.routeId === right.route.routeId && left.route.agreementOfferId === right.route.agreementOfferId && left.route.fromCityId === right.route.fromCityId && left.route.toCityId === right.route.toCityId;
  }
  return true;
}

export function applyHistoricalEvent(state: WorldState, quote: HistoricalEventQuote): string[] {
  const current = historicalEventQuote(state, quote.eventId, quote.target, quote.selection);
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

function observedFact(state: WorldState, fact: HistoricalEventFact): number | boolean {
  if (fact.scope === 'route' && fact.field === 'damageDisableAt') {
    const threshold = state.routes.find(route => route.id === fact.id)?.agreement?.terms.damageDisableAt;
    if (threshold === undefined) throw new RangeError('Historical event route threshold is missing');
    return threshold;
  }
  const object = fact.scope === 'civilization' ? state.civilizations.find(civilization => civilization.id === fact.id)?.resources
    : fact.scope === 'city' ? state.cities.find(city => city.id === fact.id) : state.routes.find(route => route.id === fact.id);
  if (!object) throw new RangeError('Historical event fact object is missing');
  const value: unknown = Reflect.get(object, fact.field);
  if (typeof value !== 'number' && typeof value !== 'boolean') throw new RangeError('Historical event fact field is missing');
  return value;
}

export function applyHistoricalEventWithReceipt(state: WorldState, quote: HistoricalEventQuote, eventId: string): { effects: string[]; receipt?: HistoricalEventReceipt } {
  if (!quote.selection) return { effects: applyHistoricalEvent(state, quote) };
  if (!/^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(eventId) || !eventId.split(':').every(part => Number.isSafeInteger(Number(part))) || Number(eventId.split(':')[0]) !== state.revision) throw new RangeError('Historical event receipt requires its exact event ID');
  const facts = quote.facts.map(fact => ({ ...fact, before: observedFact(state, fact) }));
  if (quote.routeDamage && quote.routeId && !facts.some(fact => fact.scope === 'route' && fact.id === quote.routeId && fact.field === 'active')) {
    const active: HistoricalEventFact = { scope: 'route', id: quote.routeId, field: 'active', before: quote.routeDamage.activeBefore, after: quote.routeDamage.activeAfter };
    active.before = observedFact(state, active);
    facts.push(active);
  }
  if (quote.routeDamage && quote.routeId) {
    const threshold: HistoricalEventFact = { scope: 'route', id: quote.routeId, field: 'damageDisableAt', before: 0, after: 0 };
    threshold.before = observedFact(state, threshold);
    facts.push(threshold);
  }
  const effects = applyHistoricalEvent(state, quote);
  for (const fact of facts) fact.after = observedFact(state, fact);
  const selection = structuredClone(quote.selection);
  return { effects, receipt: {
    ruleVersion: 1, instanceId: selection.instanceId, occurrence: selection.occurrence, selection,
    eventKind: quote.eventId, civId: quote.target, eventId, revision: quote.revision, round: quote.round,
    paid: { ...quote.paid }, facts,
  } };
}

export function historicalEventWeight(state: WorldState, eventId: string, target: number): number {
  if (!isHistoricalEventId(eventId)) return 0;
  const local = historicalEventCandidates(state, eventId, target)[0]?.locals[0];
  const quote = local ? localEventQuote(state, eventId, target, local) : null;
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
