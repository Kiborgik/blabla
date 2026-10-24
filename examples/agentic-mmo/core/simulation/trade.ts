import { borderDealFailure } from './border-incidents.ts';
import type { ResolvedTradeDelivery } from '../knowledge-types.ts';
import { ACTION_FEATURES, INDUSTRIAL_RULES, METAL_RULES, RESOURCE_IDS, STRATEGIC_RESOURCE_IDS, TRADE_RECIPES, TRADE_RULES } from '../content.ts';
import type {
  ActionOption,
  City,
  GameAction,
  GameEvent,
  Resources,
  Route,
  SteamDeliveryReceipt,
  StrategicResources,
  TradeOffer,
  TradeTerms,
  WorldState,
} from '../types.ts';
import { emitEvent } from './events.ts';
import { describeSettlementSite } from './sites.ts';
import { hexDistance } from './geography.ts';
import { hasFeatures } from './history.ts';
import { createLandTransportPlanner, createSteamTransportPlanner, describeTransport, transportBlock, transportCadence } from './transport.ts';
import { canAfford, citiesOf, civilizationById, transferCost } from './world.ts';
import { strategicCapacity } from './metals.ts';

export type TradePresentation = 'full' | 'compact-trade-v1';

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

function offeredTransportBlock(state: WorldState, offer: TradeOffer): string | null {
  const quote = offer.terms.transport;
  if (!quote) return null;
  const from = state.cities.find(city => city.id === offer.from && city.civId === offer.proposer);
  const to = state.cities.find(city => city.id === offer.to && city.civId === offer.recipient);
  return from && to ? transportBlock(state, quote, from.tileId, to.tileId) : 'An exact endpoint is missing';
}

function nextBeat(round: number, cadence: number): number {
  return (Math.floor(round / cadence) + 1) * cadence;
}

function describeTradeEndpoints(state: WorldState, from: City, to: City): string {
  const origin = state.tiles.find((tile) => tile.id === from.tileId);
  const destination = state.tiles.find((tile) => tile.id === to.tileId);
  if (!origin || !destination) return 'An endpoint site is missing';
  return `${from.name} (${from.id}): ${describeSettlementSite(state, origin)}. ${to.name} (${to.id}): ${describeSettlementSite(state, destination)}. Straight-line hex distance ${hexDistance(origin, destination)}; not a traversed path or travel time. Supplies remain shared across each civilization.`;
}

function compactDistance(state: WorldState, from: City | undefined, to: City | undefined): string {
  const origin = from ? state.tiles.find(tile => tile.id === from.tileId) : undefined;
  const destination = to ? state.tiles.find(tile => tile.id === to.tileId) : undefined;
  return origin && destination ? `Straight-line hex distance ${hexDistance(origin, destination)}` : 'Exact endpoint site is missing';
}

function compactLandReason(quote: NonNullable<ActionOption['tradeQuote']>, authority: string): string {
  return `${quote.transport.mode === 'steam' ? 'Steam' : 'Land'} path in tradeQuote: ${quote.transport.edges} edges; exchange every ${quote.cadenceRounds} rounds, first due ${quote.cadenceRounds} rounds after acceptance. Town facts in tradeFacts; ${authority}`;
}

function compactProposalReason(state: WorldState, from: City | undefined, to: City | undefined, exact: boolean): string {
  return `${exact ? '' : `First-city endpoints ${from?.id ?? 'missing'} to ${to?.id ?? 'missing'}; `}${compactDistance(state, from, to)}; town and current recipe facts in tradeFacts`;
}

function strategicTermsDescription(terms: TradeTerms): string {
  if (!terms.strategicCargo) return '';
  const vector = (ordinary: Partial<Resources>, strategic: typeof terms.strategicCargo.proposer): string => [...RESOURCE_IDS.filter(resource => (ordinary[resource] ?? 0) > 0).map(resource => `${ordinary[resource]} ${resource}`), ...Object.entries(strategic).filter(([, amount]) => amount > 0).map(([resource, amount]) => `${amount} ${resource}`)].join(', ') || 'none';
  return ` Proposer cargo ${vector(terms.proposerCargo, terms.strategicCargo.proposer)}; recipient cargo ${vector(terms.recipientCargo, terms.strategicCargo.recipient)}. Both complete cargo and upkeep vectors and receiving strategic capacity must fit at the due beat; no partial exchange.`;
}

export function availableTradeActions(state: WorldState, seat: number, presentation: TradePresentation = 'full'): ActionOption[] {
  const choices: ActionOption[] = [];
  const civilization = civilizationById(state, seat);
  const land = hasFeatures(state, ['land-transport']);
  const planner = land ? createLandTransportPlanner(state) : null;
  if (hasFeatures(state, ACTION_FEATURES['propose-trade'])) {
    for (const partner of state.civilizations) {
      if (
        partner.id === seat || borderDealFailure(state, seat, partner.id) !== null ||
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
          (recipe.requiredTechnology !== undefined && !civilization.technologies.includes(recipe.requiredTechnology)) ||
          !canAfford(civilization.resources, recipe.terms.constructionCost)
        )
          continue;
        if (hasFeatures(state, ['exact-trade-endpoints'])) {
          for (const from of citiesOf(state, seat)) for (const to of citiesOf(state, partner.id)) {
            const transport = planner?.quote(from.tileId, to.tileId);
            if (land && !transport) continue;
            const tradeQuote = transport ? { transport, cadenceRounds: transportCadence(recipe.terms.cadenceRounds, transport) } : undefined;
            choices.push({
              action: { type: 'propose-trade', partner: partner.id, recipeId: recipe.id, sourceCityId: from.id, recipientCityId: to.id },
              ...(tradeQuote ? { tradeQuote } : {}),
              label: `Offer ${recipe.id}: ${from.name} to ${to.name}`,
              reason: presentation === 'compact-trade-v1'
                ? tradeQuote ? compactLandReason(tradeQuote, 'current recipe facts in tradeFacts') : compactProposalReason(state, from, to, true)
                : `Request consent to these exact towns and recurring terms; no recipient stock is spent by a proposal. ${transport ? `${describeTransport(transport, transportCadence(recipe.terms.cadenceRounds, transport))}. ` : ''}${describeTradeEndpoints(state, from, to)}${strategicTermsDescription(recipe.terms)}`,
            });
          }
        } else choices.push({
          action: { type: 'propose-trade', partner: partner.id, recipeId: recipe.id },
          label: `Offer ${recipe.id} to ${partner.name}`,
          reason: presentation === 'compact-trade-v1' && !land
            ? compactProposalReason(state, citiesOf(state, seat)[0], citiesOf(state, partner.id)[0], false)
            : 'Request consent to exact recurring terms; no recipient stock is spent by a proposal',
        });
      }
    }
  }
  if (hasFeatures(state, [INDUSTRIAL_RULES.featureId]) && civilization.technologies.includes(INDUSTRIAL_RULES.requiredTechnology)) {
    const steamPlanner = createSteamTransportPlanner(state);
    for (const option of [...choices]) {
      const action = option.action; if (action.type !== 'propose-trade') continue;
      const from = state.cities.find(city => city.id === action.sourceCityId); const to = state.cities.find(city => city.id === action.recipientCityId);
      const recipe = TRADE_RECIPES.find(candidate => candidate.id === action.recipeId); if (!from || !to || !recipe) continue;
      const transport = steamPlanner.quote(from.tileId, to.tileId, recipe.terms.cadenceRounds); if (!transport) continue;
      const cadenceRounds = transportCadence(recipe.terms.cadenceRounds, transport);
      choices.push({ action: { ...action, transportMode: 'steam' }, label: `Offer steam ${recipe.id}: ${from.name} to ${to.name}`, tradeQuote: { transport, cadenceRounds }, reason: `${describeTransport(transport, cadenceRounds)}. New recipient consent is required; existing terms are unchanged.` });
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
        offeredTransportBlock(state, offer) === null &&
        borderDealFailure(state, offer.proposer, offer.recipient) === null &&
        activeAgreements(state, offer.proposer, offer.recipient) < TRADE_RULES.maxActivePerPair &&
        canAfford(civilizationById(state, offer.proposer).resources, offer.terms.constructionCost)
      ) {
        const from = state.cities.find((city) => city.id === offer.from && city.civId === offer.proposer);
        const to = state.cities.find((city) => city.id === offer.to && city.civId === offer.recipient);
        const tradeQuote = offer.terms.transport ? { transport: structuredClone(offer.terms.transport), cadenceRounds: offer.terms.cadenceRounds } : undefined;
        choices.push({
          action: { type: 'respond-trade', offerId: offer.id, accept: true },
          ...(tradeQuote ? { tradeQuote } : {}),
          label: `Accept ${offer.id}`,
          reason: presentation === 'compact-trade-v1'
            ? tradeQuote ? compactLandReason(tradeQuote, `snapshotted ${offer.id} terms in tradeOffers`) : `Consent to ${offer.id} and its snapshotted tradeOffers terms every ${offer.terms.cadenceRounds} rounds; first shipment is on a later strategic beat. ${compactDistance(state, from, to)}; town facts in tradeFacts`
            : `Consent to deliveries every ${offer.terms.cadenceRounds} rounds; ${offer.terms.transport ? describeTransport(offer.terms.transport, offer.terms.cadenceRounds) : 'first shipment is on a later strategic beat'}${hasFeatures(state, ['exact-trade-endpoints']) && from && to ? `. ${describeTradeEndpoints(state, from, to)}` : ''}${strategicTermsDescription(offer.terms)}`,
        });
      }
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
    const border = borderDealFailure(state, seat, action.partner);
    if (border) throw new RangeError(border);
    const recipe = TRADE_RECIPES.find((candidate) => candidate.id === action.recipeId);
    const exact = hasFeatures(state, ['exact-trade-endpoints']);
    const from = exact ? citiesOf(state, seat).find((city) => city.id === action.sourceCityId) : citiesOf(state, seat)[0];
    const to = exact ? citiesOf(state, action.partner).find((city) => city.id === action.recipientCityId) : citiesOf(state, action.partner)[0];
    if (!recipe || !from || !to)
      throw new RangeError('Trade proposal requires a released recipe and two existing endpoints');
    const terms = structuredClone(recipe.terms);
    if (hasFeatures(state, ['land-transport'])) {
      if (action.transportMode === 'steam' && (!hasFeatures(state, [INDUSTRIAL_RULES.featureId]) || !actor.technologies.includes(INDUSTRIAL_RULES.requiredTechnology))) throw new RangeError('Steam proposal requires released Steam power');
      const quote = action.transportMode === 'steam' ? createSteamTransportPlanner(state).quote(from.tileId, to.tileId, terms.cadenceRounds) : createLandTransportPlanner(state).quote(from.tileId, to.tileId);
      if (!quote) throw new RangeError('The exact trade towns have no passable land path');
      terms.transport = quote;
      terms.cadenceRounds = transportCadence(terms.cadenceRounds, quote);
    }
    const offer: TradeOffer = {
      id: `offer-${state.revision}`,
      proposer: seat,
      recipient: action.partner,
      from: from.id,
      to: to.id,
      createdRound: state.round,
      expiresRound: state.round + TRADE_RULES.offerExpiryRounds,
      status: 'pending',
      terms,
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
  const border = borderDealFailure(state, offer.proposer, offer.recipient);
  if (border) throw new RangeError(border);
  const currentTransportBlock = offeredTransportBlock(state, offer);
  if (currentTransportBlock) throw new RangeError(currentTransportBlock);
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
      ...(offer.terms.transport?.mode === 'steam' ? { lastSteamDelivery: null } : {}),
      offerId: offer.id,
      terms: structuredClone(offer.terms),
      enabled: true,
      acceptedRound: state.round,
      nextDeliveryRound: offer.terms.transport ? state.round + offer.terms.cadenceRounds : nextBeat(state.round, offer.terms.cadenceRounds),
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

export function strategicObligations(terms: TradeTerms, side: 'proposer' | 'recipient'): StrategicResources {
  const result = { ...terms.strategicCargo?.[side] };
  if (side === 'proposer' && terms.transport?.mode === 'steam') result.coal = (result.coal ?? 0) + terms.transport.proposerFuel.coal;
  return result;
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
  if (terms.transport) {
    const from = state.cities.find(city => city.id === route.from);
    const to = state.cities.find(city => city.id === route.to);
    if (from && to) {
      const reason = transportBlock(state, terms.transport, from.tileId, to.tileId);
      if (reason) return { by: null, reason };
    }
  }
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
  for (const resource of STRATEGIC_RESOURCE_IDS) {
    for (const [id, side, opposite] of [[route.owner, 'proposer', 'recipient'], [route.partner, 'recipient', 'proposer']] as const) {
      const stock = civilizationById(state, id).strategicResources?.[resource] ?? 0;
      const outgoing = strategicObligations(terms, side)[resource] ?? 0;
      const incoming = terms.strategicCargo?.[opposite][resource] ?? 0;
      if (stock < outgoing) return { by: id, reason: `Strategic cargo${terms.transport?.mode === 'steam' ? ' and fuel' : ''} shortage: ${resource} ${stock}/${outgoing}` };
      const capacity = strategicCapacity(state, id, resource);
      if (incoming > 0 && stock - outgoing + incoming > capacity) return { by: id, reason: `Strategic storage full: ${resource} incoming ${incoming}, stock after outgoing ${stock - outgoing}, capacity ${capacity}` };
    }
  }
  return null;
}

export function resolveTrade(state: WorldState, events: GameEvent[]): ResolvedTradeDelivery[] {
  const deliveries: ResolvedTradeDelivery[] = [];
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
    agreement.nextDeliveryRound = agreement.terms.transport ? state.round + agreement.terms.cadenceRounds : nextBeat(state.round, agreement.terms.cadenceRounds);
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
    const proposerStrategicPaid = strategicObligations(terms, 'proposer');
    const recipientStrategicPaid = strategicObligations(terms, 'recipient');
    for (const resource of STRATEGIC_RESOURCE_IDS) {
      const proposerSent = terms.strategicCargo?.proposer[resource] ?? 0; const recipientSent = terms.strategicCargo?.recipient[resource] ?? 0;
      const proposerPaid = proposerStrategicPaid[resource] ?? 0; const recipientPaid = recipientStrategicPaid[resource] ?? 0;
      if (proposerPaid > 0 || recipientSent > 0) { owner.strategicResources ??= {}; owner.strategicResources[resource] = (owner.strategicResources[resource] ?? 0) - proposerPaid + recipientSent; }
      if (recipientPaid > 0 || proposerSent > 0) { partner.strategicResources ??= {}; partner.strategicResources[resource] = (partner.strategicResources[resource] ?? 0) - recipientPaid + proposerSent; }
    }
    route.volume = RESOURCE_IDS.reduce(
      (total, resource) =>
        total + (terms.proposerCargo[resource] ?? 0) + (terms.recipientCargo[resource] ?? 0),
      STRATEGIC_RESOURCE_IDS.reduce((total, resource) => total + (terms.strategicCargo?.proposer[resource] ?? 0) + (terms.strategicCargo?.recipient[resource] ?? 0), 0),
    );
    agreement.lastDeliveryRound = state.round;
    agreement.deliveryCount += 1;
    const event = emitEvent(state, events, {
      type: 'trade-delivered',
      ...(terms.strategicCargo ? { strategicShipment: { ruleVersion: METAL_RULES.ruleVersion, routeId: route.id, offerId: agreement.offerId, proposer: route.owner, recipient: route.partner, proposerSent: structuredClone(terms.strategicCargo.proposer), recipientSent: structuredClone(terms.strategicCargo.recipient) } } : {}),
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
    if (terms.transport?.mode === 'steam') {
      const receipt: SteamDeliveryReceipt = { ruleVersion: 1, routeId: route.id, offerId: agreement.offerId, proposer: route.owner, recipient: route.partner, acceptedRound: agreement.acceptedRound, round: state.round, eventId: event.id, terms: structuredClone(terms), proposerPaid: obligations(terms.proposerCargo, terms.proposerUpkeep), recipientPaid: obligations(terms.recipientCargo, terms.recipientUpkeep), proposerStrategicPaid, recipientStrategicPaid };
      event.steamDelivery = structuredClone(receipt); agreement.lastSteamDelivery = structuredClone(receipt);
      if (state.industrialEvidence && !state.industrialEvidence.steamDelivery && terms.cadenceRounds < terms.transport.unrailedCadence && terms.transport.railEdges.length > 0) state.industrialEvidence.steamDelivery = structuredClone(receipt);
    }
    if (hasFeatures(state, ['knowledge-compacts'])) {
      const from = state.cities.find(city => city.id === route.from)!; const to = state.cities.find(city => city.id === route.to)!;
      deliveries.push({ ruleVersion: 1, routeId: route.id, agreementOfferId: agreement.offerId, agreementAcceptedRound: agreement.acceptedRound,
        owner: route.owner, partner: route.partner, fromCityId: from.id, toCityId: to.id, fromTileId: from.tileId, toTileId: to.tileId,
        round: state.round, revision: state.revision, eventId: event.id, deliveryCount: agreement.deliveryCount, tradeTerms: structuredClone(terms),
        proposerPaid: obligations(terms.proposerCargo, terms.proposerUpkeep), recipientPaid: obligations(terms.recipientCargo, terms.recipientUpkeep),
        proposerStrategicPaid: structuredClone(proposerStrategicPaid), recipientStrategicPaid: structuredClone(recipientStrategicPaid) });
    }
  }
  return deliveries;
}
