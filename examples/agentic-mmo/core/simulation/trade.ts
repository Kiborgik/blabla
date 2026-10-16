import { ACTION_FEATURES, RESOURCE_IDS, TRADE_RECIPES, TRADE_RULES } from '../content.ts';
import type {
  ActionOption,
  GameAction,
  GameEvent,
  Resources,
  Route,
  TradeOffer,
  TradeTerms,
  WorldState,
} from '../types.ts';
import { emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';
import { canAfford, citiesOf, civilizationById, transferCost } from './world.ts';

type TradeAction = Extract<
  GameAction,
  { type: 'propose-trade' | 'respond-trade' | 'withdraw-trade' | 'stop-trade' }
>;

function pairMatches(a: number, b: number, proposer: number, recipient: number): boolean {
  return (a === proposer && b === recipient) || (a === recipient && b === proposer);
}

function pending(state: WorldState, offer: TradeOffer): boolean {
  return offer.status === 'pending' && state.round < offer.expiresRound;
}

function activeAgreements(state: WorldState, a: number, b: number): number {
  return state.routes.filter(
    (route) => route.agreement?.enabled && pairMatches(a, b, route.owner, route.partner),
  ).length;
}

function endpointsExist(state: WorldState, offer: TradeOffer): boolean {
  return (
    state.cities.some((city) => city.id === offer.from && city.civId === offer.proposer) &&
    state.cities.some((city) => city.id === offer.to && city.civId === offer.recipient)
  );
}

function nextBeat(round: number, cadence: number): number {
  return (Math.floor(round / cadence) + 1) * cadence;
}

export function availableTradeActions(state: WorldState, seat: number): ActionOption[] {
  const choices: ActionOption[] = [];
  const civilization = civilizationById(state, seat);
  if (hasFeatures(state, ACTION_FEATURES['propose-trade'])) {
    for (const partner of state.civilizations) {
      if (
        partner.id === seat ||
        !citiesOf(state, seat).length ||
        !citiesOf(state, partner.id).length ||
        activeAgreements(state, seat, partner.id) >= TRADE_RULES.maxActivePerPair ||
        (state.tradeOffers ?? []).filter(
          (offer) =>
            pending(state, offer) && pairMatches(seat, partner.id, offer.proposer, offer.recipient),
        ).length >= TRADE_RULES.maxPendingPerPair
      )
        continue;
      for (const recipe of TRADE_RECIPES) {
        if (
          !hasFeatures(state, recipe.requiredFeatures) ||
          !canAfford(civilization.resources, recipe.terms.constructionCost)
        )
          continue;
        choices.push({
          action: { type: 'propose-trade', partner: partner.id, recipeId: recipe.id },
          label: `Offer ${recipe.id} to ${partner.name}`,
          reason:
            'Request consent to exact recurring terms; no recipient stock is spent by a proposal',
        });
      }
    }
  }
  for (const offer of state.tradeOffers ?? []) {
    if (!pending(state, offer)) continue;
    if (offer.recipient === seat && hasFeatures(state, ACTION_FEATURES['respond-trade'])) {
      choices.push({
        action: { type: 'respond-trade', offerId: offer.id, accept: false },
        label: `Decline ${offer.id}`,
        reason: 'Refuse the proposed recurring obligations without spending resources',
      });
      if (
        endpointsExist(state, offer) &&
        activeAgreements(state, offer.proposer, offer.recipient) < TRADE_RULES.maxActivePerPair &&
        canAfford(civilizationById(state, offer.proposer).resources, offer.terms.constructionCost)
      )
        choices.push({
          action: { type: 'respond-trade', offerId: offer.id, accept: true },
          label: `Accept ${offer.id}`,
          reason: `Consent to deliveries every ${offer.terms.cadenceRounds} rounds; first shipment is on a later strategic beat`,
        });
    }
    if (offer.proposer === seat && hasFeatures(state, ACTION_FEATURES['withdraw-trade']))
      choices.push({
        action: { type: 'withdraw-trade', offerId: offer.id },
        label: `Withdraw ${offer.id}`,
        reason: 'Remove the pending offer before its partner accepts',
      });
  }
  if (hasFeatures(state, ACTION_FEATURES['stop-trade'])) {
    for (const route of state.routes) {
      if (!route.agreement?.enabled || (route.owner !== seat && route.partner !== seat)) continue;
      choices.push({
        action: { type: 'stop-trade', routeId: route.id },
        label: `Stop ${route.id}`,
        reason: 'End future shipments and upkeep; completed deliveries remain in history',
      });
    }
  }
  return choices;
}

export function executeTradeAction(
  state: WorldState,
  seat: number,
  action: TradeAction,
  events: GameEvent[],
): void {
  const actor = civilizationById(state, seat);
  if (action.type === 'propose-trade') {
    const recipe = TRADE_RECIPES.find((candidate) => candidate.id === action.recipeId);
    const from = citiesOf(state, seat)[0];
    const to = citiesOf(state, action.partner)[0];
    if (!recipe || !from || !to)
      throw new RangeError('Trade proposal requires a released recipe and two existing endpoints');
    const offer: TradeOffer = {
      id: `offer-${state.revision}`,
      proposer: seat,
      recipient: action.partner,
      from: from.id,
      to: to.id,
      createdRound: state.round,
      expiresRound: state.round + TRADE_RULES.offerExpiryRounds,
      status: 'pending',
      terms: structuredClone(recipe.terms),
      routeId: null,
    };
    state.tradeOffers ??= [];
    state.tradeOffers.push(offer);
    emitEvent(state, events, {
      type: 'trade-proposed',
      title: `${actor.name} offers a standing exchange`,
      detail: offer.id,
      actor: seat,
      target: action.partner,
      tileId: from.tileId,
      cause: `Recipe ${recipe.id} version ${offer.terms.recipeVersion} was offered with an expiry at round ${offer.expiresRound}`,
      effects: [
        'No recipient payment or shipment occurred',
        `Delivery cadence if accepted: ${offer.terms.cadenceRounds} rounds`,
        `Offer ${offer.id} awaits recipient consent`,
      ],
      importance: 3,
    });
    return;
  }
  if (action.type === 'stop-trade') {
    const route = state.routes.find((candidate) => candidate.id === action.routeId);
    if (!route?.agreement) throw new RangeError('Stopping requires an agreed route');
    route.agreement.enabled = false;
    route.agreement.closedRound = state.round;
    route.agreement.blockedBy = null;
    route.agreement.blockedReason = null;
    route.active = false;
    route.volume = 0;
    emitEvent(state, events, {
      type: 'trade-stopped',
      title: `${actor.name} ends a standing exchange`,
      detail: route.id,
      actor: seat,
      target: route.owner === seat ? route.partner : route.owner,
      tileId: state.cities.find((city) => city.id === route.from)?.tileId ?? null,
      cause: 'An agreed participant withdrew consent for future shipments',
      effects: [
        'Future cargo and transport upkeep stopped',
        `${route.agreement.deliveryCount} completed deliveries remain recorded`,
      ],
      importance: 3,
    });
    return;
  }
  const offer = state.tradeOffers?.find((candidate) => candidate.id === action.offerId);
  if (!offer) throw new RangeError('Trade response requires an existing pending offer');
  if (action.type === 'withdraw-trade' || !action.accept) {
    offer.status = action.type === 'withdraw-trade' ? 'withdrawn' : 'declined';
    emitEvent(state, events, {
      type: `trade-${offer.status}`,
      title: `${actor.name} ${offer.status} an exchange offer`,
      detail: offer.id,
      actor: seat,
      target: offer.proposer === seat ? offer.recipient : offer.proposer,
      tileId: null,
      cause: 'The named actor refused or withdrew the pending agreement',
      effects: ['No construction payment or shipment occurred'],
      importance: 2,
    });
    return;
  }
  transferCost(civilizationById(state, offer.proposer).resources, offer.terms.constructionCost);
  const route: Route = {
    id: `route-${state.revision}`,
    from: offer.from,
    to: offer.to,
    owner: offer.proposer,
    partner: offer.recipient,
    active: false,
    damage: 0,
    volume: 0,
    agreement: {
      offerId: offer.id,
      terms: structuredClone(offer.terms),
      enabled: true,
      acceptedRound: state.round,
      nextDeliveryRound: nextBeat(state.round, offer.terms.cadenceRounds),
      lastAttemptRound: null,
      lastDeliveryRound: null,
      deliveryCount: 0,
      blockedBy: null,
      blockedReason: null,
      closedRound: null,
    },
  };
  state.routes.push(route);
  offer.status = 'accepted';
  offer.routeId = route.id;
  emitEvent(state, events, {
    type: 'trade-accepted',
    title: `${actor.name} accepts a standing exchange`,
    detail: route.id,
    actor: seat,
    target: offer.proposer,
    tileId: state.cities.find((city) => city.id === route.to)?.tileId ?? null,
    cause: `Recipient consent accepted immutable offer ${offer.id}`,
    effects: [
      'Proposer paid construction once',
      'No cargo was delivered by acceptance',
      `First due shipment: round ${route.agreement?.nextDeliveryRound}`,
    ],
    importance: 4,
  });
}

function obligations(cargo: Partial<Resources>, upkeep: Partial<Resources>): Partial<Resources> {
  return Object.fromEntries(
    RESOURCE_IDS.map((resource) => [resource, (cargo[resource] ?? 0) + (upkeep[resource] ?? 0)]),
  );
}

function shortages(resources: Resources, required: Partial<Resources>): string[] {
  return RESOURCE_IDS.filter((resource) => resources[resource] < (required[resource] ?? 0)).map(
    (resource) => `${resource} ${resources[resource]}/${required[resource] ?? 0}`,
  );
}

function shipmentBlock(
  state: WorldState,
  route: Route,
  terms: TradeTerms,
): { by: number | null; reason: string } | null {
  if (!state.cities.some((city) => city.id === route.from && city.civId === route.owner))
    return { by: route.owner, reason: 'The proposer endpoint no longer exists' };
  if (!state.cities.some((city) => city.id === route.to && city.civId === route.partner))
    return { by: route.partner, reason: 'The recipient endpoint no longer exists' };
  if (route.damage >= terms.damageDisableAt)
    return { by: null, reason: `Route damage ${route.damage} prevents transport` };
  for (const [id, cargo, upkeep] of [
    [route.owner, terms.proposerCargo, terms.proposerUpkeep],
    [route.partner, terms.recipientCargo, terms.recipientUpkeep],
  ] as const) {
    const missing = shortages(civilizationById(state, id).resources, obligations(cargo, upkeep));
    if (missing.length)
      return { by: id, reason: `Combined cargo and upkeep shortage: ${missing.join(', ')}` };
  }
  return null;
}

export function resolveTrade(state: WorldState, events: GameEvent[]): void {
  for (const offer of state.tradeOffers ?? []) {
    if (offer.status !== 'pending' || state.round < offer.expiresRound) continue;
    offer.status = 'expired';
    emitEvent(state, events, {
      type: 'trade-expired',
      title: 'An unanswered trade offer expires',
      detail: offer.id,
      actor: offer.proposer,
      target: offer.recipient,
      tileId: null,
      cause: `Round ${offer.expiresRound} ended the offer's consent window`,
      effects: ['No construction or shipment obligations were created'],
      importance: 2,
    });
  }
  for (const route of state.routes) {
    const agreement = route.agreement;
    if (!agreement?.enabled) {
      route.active = false;
      route.volume = 0;
      continue;
    }
    if (state.round < agreement.nextDeliveryRound || agreement.lastAttemptRound === state.round)
      continue;
    agreement.lastAttemptRound = state.round;
    agreement.nextDeliveryRound = nextBeat(state.round, agreement.terms.cadenceRounds);
    route.volume = 0;
    const blocked = shipmentBlock(state, route, agreement.terms);
    agreement.blockedBy = blocked?.by ?? null;
    agreement.blockedReason = blocked?.reason ?? null;
    route.active = blocked === null;
    if (blocked) {
      emitEvent(state, events, {
        type: 'trade-blocked',
        title: 'An agreed shipment cannot depart',
        detail: route.id,
        actor: route.owner,
        target: blocked.by ?? route.partner,
        tileId: state.cities.find((city) => city.id === route.to)?.tileId ?? null,
        cause: blocked.reason,
        effects: [
          'No cargo, upkeep or commerce income changed',
          `Next attempt: round ${agreement.nextDeliveryRound}`,
        ],
        importance: 3,
      });
      continue;
    }
    const owner = civilizationById(state, route.owner);
    const partner = civilizationById(state, route.partner);
    const terms = agreement.terms;
    transferCost(owner.resources, obligations(terms.proposerCargo, terms.proposerUpkeep));
    transferCost(partner.resources, obligations(terms.recipientCargo, terms.recipientUpkeep));
    transferCost(partner.resources, terms.proposerCargo, 1);
    transferCost(owner.resources, terms.recipientCargo, 1);
    transferCost(owner.resources, terms.proposerYield, 1);
    transferCost(partner.resources, terms.recipientYield, 1);
    route.volume = RESOURCE_IDS.reduce(
      (total, resource) =>
        total + (terms.proposerCargo[resource] ?? 0) + (terms.recipientCargo[resource] ?? 0),
      0,
    );
    agreement.lastDeliveryRound = state.round;
    agreement.deliveryCount += 1;
    emitEvent(state, events, {
      type: 'trade-delivered',
      title: `${owner.name} and ${partner.name} exchange agreed cargo`,
      detail: route.id,
      actor: route.owner,
      target: route.partner,
      tileId: state.cities.find((city) => city.id === route.to)?.tileId ?? null,
      cause: `Accepted offer ${agreement.offerId} reached strategic round ${state.round} with both combined obligations supplied`,
      effects: [
        `${route.volume} cargo exchanged atomically`,
        'Agreed upkeep consumed and commerce credited',
        `Next shipment: round ${agreement.nextDeliveryRound}`,
      ],
      importance: 3,
    });
  }
}
