import { RESOURCE_IDS } from '../core/content.ts';
import type { GameEvent, PublicProjectResult, Resources } from '../core/types.ts';
import type { RouteTown, RouteView } from './route-visuals.ts';

export interface RouteCueCursor { identity: string; revision: number; resumeBaseline?: true }
export interface RouteCueObservation extends RouteCueCursor { mode: 'live' | 'baseline' | 'history'; events: readonly GameEvent[]; routes: readonly RouteView[] }
interface RouteCueBase {
  eventId: string;
  round: number;
  routeId: string;
  agreementOfferId: string | null;
  endpoints: { fromCityId: string; toCityId: string; owner: number; partner: number } | null;
  mapAnchor: { from: RouteTown; to: RouteTown } | null;
  accent: 'delivery' | 'repair' | 'none';
  label: string;
}
interface DeliverySide { civilization: number; cargo: Partial<Resources>; paidUpkeep: Partial<Resources>; creditedCommerce: Partial<Resources> }
export type RouteResultCue = RouteCueBase & ({ kind: 'delivery'; aggregateCargo: number | null; factSource: 'event-aggregate' | 'bound-agreement'; exchange: { proposer: DeliverySide; recipient: DeliverySide } | null }
  | { kind: 'public-repair'; result: PublicProjectResult; damageReduction: number | null; currentDamage: number | null });
export interface RouteCueBatch { cursor: RouteCueCursor | null; cues: RouteResultCue[] }

function binding(route: RouteView | undefined): Pick<RouteCueBase, 'endpoints' | 'mapAnchor'> {
  if (!route) return { endpoints: null, mapAnchor: null };
  const { fromTown, toTown } = route;
  const mapAnchor = fromTown?.id === route.from && toTown?.id === route.to
    ? structuredClone({ from: fromTown, to: toTown }) : null;
  return { endpoints: { fromCityId: route.from, toCityId: route.to, owner: route.owner, partner: route.partner }, mapAnchor };
}

function aggregateCargo(event: GameEvent): number | null {
  const amounts = event.effects.flatMap((effect) => {
    const match = /^(\d+(?:\.\d+)?(?:e[+-]?\d+)?) cargo exchanged atomically$/.exec(effect);
    return match ? [Number(match[1])] : [];
  });
  const value = amounts[0];
  return amounts.length === 1 && value !== undefined && Number.isFinite(value) ? value : null;
}

function deliveryCue(event: GameEvent, routes: ReadonlyMap<string, RouteView>): RouteResultCue {
  const route = routes.get(event.detail);
  const agreement = route?.agreement;
  const aggregate = aggregateCargo(event);
  const total = agreement ? RESOURCE_IDS.reduce((sum, resource) => sum + (agreement.terms.proposerCargo[resource] ?? 0) + (agreement.terms.recipientCargo[resource] ?? 0), 0) : null;
  const matched = route && !route.illustrative && agreement && aggregate !== null && aggregate === total
    && event.actor === route.owner && event.target === route.partner && agreement.acceptedRound <= event.round
    && agreement.deliveryCount > 0 && agreement.lastDeliveryRound !== null && agreement.lastDeliveryRound >= event.round
    && (agreement.closedRound === null || agreement.closedRound >= event.round)
    && event.cause === `Accepted offer ${agreement.offerId} reached strategic round ${event.round} with both combined obligations supplied`;
  const location = binding(matched ? route : undefined);
  const exchange = matched ? structuredClone({
    proposer: { civilization: route.owner, cargo: agreement.terms.proposerCargo, paidUpkeep: agreement.terms.proposerUpkeep, creditedCommerce: agreement.terms.proposerYield },
    recipient: { civilization: route.partner, cargo: agreement.terms.recipientCargo, paidUpkeep: agreement.terms.recipientUpkeep, creditedCommerce: agreement.terms.recipientYield },
  }) : null;
  return { kind: 'delivery', eventId: event.id, round: event.round, routeId: event.detail,
    agreementOfferId: matched ? agreement.offerId : null, ...location,
    aggregateCargo: aggregate, exchange, factSource: matched ? 'bound-agreement' : 'event-aggregate',
    accent: location.mapAnchor && aggregate !== null && aggregate > 0 ? 'delivery' : 'none', label: 'Cargo delivered' };
}

const REPAIR_LABELS: Record<PublicProjectResult['outcome'], string> = {
  completed: 'Route repaired', declined: 'Repair declined', cancelled: 'Repair cancelled',
  expired: 'Repair offer expired', failed: 'Repair failed', 'no-work-needed': 'No repair needed',
};

function repairCue(event: GameEvent, routes: ReadonlyMap<string, RouteView>): RouteResultCue | null {
  const result = event.publicProjectResult;
  if (!result || event.type !== `public-project-${result.outcome}` || event.detail !== result.projectId) return null;
  const route = routes.get(result.routeId);
  const pairMatches = route && ((route.owner === result.proposer && route.partner === result.recipient)
    || (route.owner === result.recipient && route.partner === result.proposer));
  const matched = route && !route.illustrative && pairMatches && route.agreement?.offerId === result.agreementOfferId;
  const location = binding(matched ? route : undefined);
  const reduction = result.damageBefore !== null && result.damageAfter !== null ? result.damageBefore - result.damageAfter : null;
  return { kind: 'public-repair', eventId: event.id, round: event.round, routeId: result.routeId,
    agreementOfferId: result.agreementOfferId, ...location, result: structuredClone(result),
    damageReduction: reduction, currentDamage: matched ? route.damage : null,
    accent: result.outcome === 'completed' && reduction !== null && reduction > 0 && location.mapAnchor ? 'repair' : 'none',
    label: REPAIR_LABELS[result.outcome] };
}

function eventPosition(id: string): { revision: number; index: number } | null {
  const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(id);
  if (!match) return null;
  const revision = Number(match[1]);
  const index = Number(match[2]);
  return Number.isSafeInteger(revision) && Number.isSafeInteger(index) ? { revision, index } : null;
}

export function projectRouteCues(previous: RouteCueCursor | null, observation: RouteCueObservation, slots = 3): RouteCueBatch {
  if (!Number.isSafeInteger(observation.revision) || observation.revision < 0)
    return { cursor: previous ? { ...previous } : null, cues: [] };
  if (observation.mode === 'history') return { cursor: previous ? { ...previous, resumeBaseline: true } : null, cues: [] };
  if (previous?.identity === observation.identity && observation.revision < previous.revision)
    return { cursor: { ...previous }, cues: [] };
  const cursor = { identity: observation.identity, revision: observation.revision };
  if (!previous || previous.identity !== observation.identity || observation.mode === 'baseline' || previous.resumeBaseline || observation.revision === previous.revision) return { cursor, cues: [] };
  const limit = Number.isFinite(slots) ? Math.min(3, Math.max(0, Math.floor(slots))) : 0;
  if (limit === 0) return { cursor, cues: [] };
  const routes = new Map(observation.routes.map((route) => [route.id, route]));
  const seen = new Set<string>();
  const candidates = observation.events.slice(-96).flatMap((event) => {
    const position = eventPosition(event.id);
    if (!position || position.revision <= previous.revision || position.revision > observation.revision || seen.has(event.id)) return [];
    seen.add(event.id);
    const cue = event.type === 'trade-delivered' ? deliveryCue(event, routes) : repairCue(event, routes);
    return cue ? [{ cue, importance: event.importance, ...position }] : [];
  });
  return { cursor, cues: candidates.toSorted((a, b) => b.importance - a.importance || b.revision - a.revision || b.index - a.index)
    .slice(0, limit).map(({ cue }) => cue) };
}
