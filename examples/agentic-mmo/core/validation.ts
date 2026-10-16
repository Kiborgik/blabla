import {
  BUILDINGS,
  ERAS,
  DIRECTOR_EVENTS,
  FEATURES,
  FOCUS_IDS,
  HISTORICAL_MILESTONES,
  RESOURCE_IDS,
  TECHNOLOGIES,
  TRADE_RULES,
  TURN_RULES,
} from './content.ts';
import { parseUtcTimestamp } from './simulation/clock.ts';
import {
  CIV_COUNT,
  DIRECTOR_SEAT,
  GAME_VERSION,
  SCHEMA_VERSION,
  type City,
  type Civilization,
  type GameEvent,
  type EventKind,
  type HexTile,
  type Outcome,
  type Route,
  type Treaty,
  type TradeAgreement,
  type TradeOffer,
  type TradeTerms,
  type WorldState,
} from './types.ts';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function finite(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

function unique(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

function knownStrings(value: unknown, allowed: readonly string[]): value is string[] {
  return strings(value) && unique(value) && value.every((id) => allowed.includes(id));
}

export function isDirectorEvent(value: unknown): value is EventKind {
  return DIRECTOR_EVENTS.some((definition) => definition.id === value);
}

function historyAdvances(value: unknown, revision: number, year: number, features: string[]): boolean {
  if (!record(value)) return false;
  const revisions: number[] = [];
  for (const [key, receipt] of Object.entries(value)) {
    if (!record(receipt) || !record(receipt.cause)) return false;
    const cause = receipt.cause;
    if ((cause.kind !== 'feature' && cause.kind !== 'event') || !text(cause.id)
      || cause.id.trim().length === 0 || cause.id.length > 128 || key !== `${cause.kind}:${cause.id}`
      || (cause.kind === 'feature' && !features.includes(cause.id))
      || !text(receipt.reason) || receipt.reason.trim().length === 0 || receipt.reason.length > 1000
      || !integer(receipt.deltaYears) || !integer(receipt.revision, 1, revision)
      || !integer(receipt.yearBefore, -Number.MAX_SAFE_INTEGER)
      || !integer(receipt.yearAfter, -Number.MAX_SAFE_INTEGER, year)
      || !Number.isSafeInteger(receipt.yearBefore + receipt.deltaYears)
      || receipt.yearAfter !== receipt.yearBefore + receipt.deltaYears
      || typeof receipt.timestamp !== 'string' || parseUtcTimestamp(receipt.timestamp) === null
      || !strings(receipt.evidence) || receipt.evidence.length === 0
      || !receipt.evidence.every((item) => item.trim().length > 0)) return false;
    revisions.push(receipt.revision);
  }
  return unique(revisions);
}

function civilization(value: unknown): value is Civilization {
  if (!record(value) || !record(value.resources)) return false;
  const resources = value.resources;
  const technologies = TECHNOLOGIES.map((item) => item.id);
  return (
    integer(value.id, 0, CIV_COUNT - 1) &&
    ['name', 'color', 'adjective', 'objective'].every((field) => text(value[field])) &&
    integer(value.era, 0, ERAS.length - 1) &&
    RESOURCE_IDS.every((resource) => finite(resources[resource])) &&
    knownStrings(value.technologies, technologies) &&
    typeof value.researchTarget === 'string' &&
    (value.researchTarget === '' || technologies.includes(value.researchTarget)) &&
    ['researchProgress', 'influence', 'marsProgress', 'score'].every((field) =>
      finite(value[field]),
    ) &&
    ['marsPopulation', 'marsSupplyStreak', 'federationStreak'].every((field) =>
      integer(value[field]),
    ) &&
    finite(value.legitimacy, 0, 100)
  );
}

function city(value: unknown): value is City {
  return (
    record(value) &&
    text(value.id) &&
    text(value.name) &&
    integer(value.civId, 0, CIV_COUNT - 1) &&
    integer(value.tileId) &&
    integer(value.population, 1) &&
    finite(value.wellbeing, 0, 100) &&
    finite(value.infrastructure) &&
    finite(value.damage, 0, 100) &&
    typeof value.focus === 'string' &&
    FOCUS_IDS.some((focus) => focus === value.focus) &&
    knownStrings(
      value.buildings,
      BUILDINGS.map((building) => building.id),
    )
  );
}

function tile(value: unknown): value is HexTile {
  return (
    record(value) &&
    integer(value.id) &&
    integer(value.q) &&
    integer(value.r) &&
    typeof value.terrain === 'string' &&
    ['ocean', 'grassland', 'forest', 'desert', 'mountain', 'tundra'].includes(value.terrain) &&
    finite(value.elevation) &&
    (value.owner === null || integer(value.owner, 0, CIV_COUNT - 1)) &&
    (value.resource === null || RESOURCE_IDS.some((resource) => resource === value.resource))
  );
}

function route(value: unknown): value is Route {
  return (
    record(value) &&
    text(value.id) &&
    text(value.from) &&
    text(value.to) &&
    integer(value.owner, 0, CIV_COUNT - 1) &&
    integer(value.partner, 0, CIV_COUNT - 1) &&
    value.owner !== value.partner &&
    typeof value.active === 'boolean' &&
    finite(value.damage, 0, 100) &&
    finite(value.volume) &&
    (!('agreement' in value) || tradeAgreement(value.agreement))
  );
}

const tradeResourceFields = ['constructionCost', 'proposerCargo', 'recipientCargo', 'proposerUpkeep', 'recipientUpkeep', 'proposerYield', 'recipientYield'] as const;

function tradeTerms(value: unknown): value is TradeTerms {
  return record(value) && text(value.recipeId) && integer(value.recipeVersion, 1)
    && integer(value.cadenceRounds, 1) && finite(value.damageDisableAt, Number.MIN_VALUE, 100)
    && tradeResourceFields.every((field) => {
      const amounts = value[field];
      return record(amounts) && Object.entries(amounts).every(([resource, amount]) => RESOURCE_IDS.some((known) => known === resource) && finite(amount));
    });
}

function tradeAgreement(value: unknown): value is TradeAgreement {
  return record(value) && text(value.offerId) && tradeTerms(value.terms)
    && typeof value.enabled === 'boolean' && integer(value.acceptedRound)
    && integer(value.nextDeliveryRound) && integer(value.deliveryCount)
    && (value.lastAttemptRound === null || integer(value.lastAttemptRound))
    && (value.lastDeliveryRound === null || integer(value.lastDeliveryRound))
    && (value.closedRound === null || integer(value.closedRound))
    && (value.blockedBy === null || integer(value.blockedBy, 0, CIV_COUNT - 1))
    && (value.blockedReason === null || text(value.blockedReason));
}

function tradeOffer(value: unknown): value is TradeOffer {
  return record(value) && text(value.id) && integer(value.proposer, 0, CIV_COUNT - 1)
    && integer(value.recipient, 0, CIV_COUNT - 1) && value.proposer !== value.recipient
    && text(value.from) && text(value.to) && tradeTerms(value.terms)
    && integer(value.createdRound) && integer(value.expiresRound)
    && value.expiresRound > value.createdRound
    && typeof value.status === 'string' && ['pending', 'accepted', 'declined', 'withdrawn', 'expired'].includes(value.status)
    && (value.routeId === null || text(value.routeId));
}

function sameTradeTerms(first: TradeTerms, second: TradeTerms): boolean {
  return first.recipeId === second.recipeId && first.recipeVersion === second.recipeVersion
    && first.cadenceRounds === second.cadenceRounds && first.damageDisableAt === second.damageDisableAt
    && tradeResourceFields.every((field) => RESOURCE_IDS.every((resource) => first[field][resource] === second[field][resource]));
}

function tradePair(first: number, second: number): string {
  return `${Math.min(first, second)}:${Math.max(first, second)}`;
}

function tradeState(value: unknown, routes: Route[], cities: City[], round: number): boolean {
  if (!Array.isArray(value) || !value.every(tradeOffer) || !unique(value.map((offer) => offer.id))) return false;
  const pendingPairs = new Map<string, number>();
  const enabledPairs = new Map<string, number>();
  for (const offer of value) {
    if (offer.createdRound > round || !cities.some((settlement) => settlement.id === offer.from && settlement.civId === offer.proposer)
      || !cities.some((settlement) => settlement.id === offer.to && settlement.civId === offer.recipient)) return false;
    if (offer.status === 'accepted') {
      const accepted = routes.find((connection) => connection.id === offer.routeId);
      if (!accepted?.agreement || accepted.agreement.offerId !== offer.id) return false;
    } else if (offer.routeId !== null) return false;
    if (offer.status === 'pending' && round < offer.expiresRound) {
      const key = tradePair(offer.proposer, offer.recipient);
      const count = (pendingPairs.get(key) ?? 0) + 1;
      if (count > TRADE_RULES.maxPendingPerPair) return false;
      pendingPairs.set(key, count);
    }
  }
  for (const connection of routes) {
    const agreement = connection.agreement;
    if (!agreement) continue;
    const offer = value.find((candidate) => candidate.id === agreement.offerId);
    if (!offer || offer.status !== 'accepted' || offer.routeId !== connection.id
      || offer.proposer !== connection.owner || offer.recipient !== connection.partner
      || offer.from !== connection.from || offer.to !== connection.to || !sameTradeTerms(offer.terms, agreement.terms)
      || agreement.acceptedRound < offer.createdRound || agreement.acceptedRound >= offer.expiresRound
      || agreement.acceptedRound > round || agreement.nextDeliveryRound <= agreement.acceptedRound
      || agreement.nextDeliveryRound % agreement.terms.cadenceRounds !== 0
      || (agreement.enabled && agreement.nextDeliveryRound <= round)
      || (agreement.lastAttemptRound !== null && (agreement.lastAttemptRound <= agreement.acceptedRound || agreement.lastAttemptRound > round || agreement.lastAttemptRound % agreement.terms.cadenceRounds !== 0))
      || (agreement.lastDeliveryRound !== null && (agreement.lastAttemptRound === null || agreement.lastDeliveryRound > agreement.lastAttemptRound || agreement.lastDeliveryRound <= agreement.acceptedRound || agreement.lastDeliveryRound % agreement.terms.cadenceRounds !== 0))
      || ((agreement.deliveryCount === 0) !== (agreement.lastDeliveryRound === null))
      || (agreement.blockedBy !== null && (agreement.blockedBy !== connection.owner && agreement.blockedBy !== connection.partner || agreement.blockedReason === null))
      || (agreement.enabled ? agreement.closedRound !== null : agreement.closedRound === null || agreement.closedRound < agreement.acceptedRound || agreement.closedRound > round || agreement.blockedBy !== null || agreement.blockedReason !== null || connection.active || connection.volume !== 0)) return false;
    if (agreement.enabled) {
      const key = tradePair(connection.owner, connection.partner);
      const count = (enabledPairs.get(key) ?? 0) + 1;
      if (count > TRADE_RULES.maxActivePerPair) return false;
      enabledPairs.set(key, count);
    }
  }
  return true;
}

function treaty(value: unknown): value is Treaty {
  return (
    record(value) &&
    text(value.id) &&
    integer(value.a, 0, CIV_COUNT - 1) &&
    integer(value.b, 0, CIV_COUNT - 1) &&
    value.a !== value.b &&
    (value.kind === 'trade' || value.kind === 'federation' || value.kind === 'peace') &&
    integer(value.since)
  );
}

function event(value: unknown): value is GameEvent {
  return (
    record(value) &&
    ['id', 'type', 'title', 'cause'].every((field) => text(value[field])) &&
    typeof value.detail === 'string' &&
    integer(value.round) &&
    (value.actor === null || integer(value.actor, 0, DIRECTOR_SEAT)) &&
    (value.target === null || integer(value.target, 0, CIV_COUNT - 1)) &&
    (value.tileId === null || integer(value.tileId)) &&
    strings(value.effects) &&
    value.effects.length > 0 &&
    finite(value.importance)
  );
}

function outcome(value: unknown): value is Outcome | null {
  return (
    value === null ||
    (record(value) &&
      typeof value.kind === 'string' &&
      ['mars', 'federation', 'cultural', 'economic', 'military'].includes(value.kind) &&
      Array.isArray(value.winners) &&
      value.winners.length > 0 &&
      value.winners.every((winner: unknown) => integer(winner, 0, CIV_COUNT - 1)) &&
      unique(value.winners) &&
      integer(value.round) &&
      text(value.reason))
  );
}

function independentTurns(value: unknown, round: number): boolean {
  if (!record(value) || typeof value.epoch !== 'string') return false;
  const epoch = parseUtcTimestamp(value.epoch);
  if (epoch === null || !integer(value.strategyTicks, 0, round)
    || !Number.isFinite(new Date(epoch + (value.strategyTicks + 1) * TURN_RULES.strategyIntervalMs).getTime())
    || !Array.isArray(value.lastActionWindow) || value.lastActionWindow.length !== DIRECTOR_SEAT + 1
    || !Array.isArray(value.actionsInWindow) || value.actionsInWindow.length !== DIRECTOR_SEAT + 1) return false;
  const counts = value.actionsInWindow;
  const nextBoundary = epoch + (value.strategyTicks + 1) * TURN_RULES.strategyIntervalMs;
  return value.lastActionWindow.every((window: unknown, seat: number) => integer(window, -1)
    && Number.isFinite(new Date(epoch + (window + 1) * TURN_RULES.tacticalWindowMs).getTime())
    && epoch + window * TURN_RULES.tacticalWindowMs < nextBoundary
    && integer(counts[seat], 0, TURN_RULES.actionsPerWindow)
    && (window === -1 ? counts[seat] === 0 : counts[seat] > 0));
}

export function isWorldState(
  value: unknown,
  options: { allowLegacyClock?: boolean } = {},
): value is WorldState {
  if (
    !record(value) ||
    value.schemaVersion !== SCHEMA_VERSION ||
    value.gameVersion !== GAME_VERSION ||
    !text(value.releaseId) ||
    !knownStrings(
      value.unlockedFeatures,
      FEATURES.map((feature) => feature.id),
    ) ||
    !knownStrings(
      value.calendarMilestones,
      HISTORICAL_MILESTONES.map((milestone) => milestone.id),
    ) ||
    !integer(value.seed, 0, 0xffffffff) ||
    !integer(value.rng, 0, 0xffffffff) ||
    !integer(value.revision) ||
    !integer(value.round) ||
    !integer(value.phase, 0, DIRECTOR_SEAT) ||
    !integer(value.year, -Number.MAX_SAFE_INTEGER) ||
    !integer(value.width, 1) ||
    !integer(value.height, 1) ||
    !finite(value.climate, -Number.MAX_SAFE_INTEGER) ||
    !integer(value.directorCooldown) ||
    !record(value.eventCounts) ||
    !Object.values(value.eventCounts).every((count) => integer(count)) ||
    !record(value.directorIntervals) ||
    !Object.entries(value.directorIntervals).every(
      ([key, timestamp]) =>
        /^(clock|event|review):.+/.test(key) &&
        typeof timestamp === 'string' &&
        parseUtcTimestamp(timestamp) !== null,
    ) ||
    ('historyAdvances' in value && !historyAdvances(value.historyAdvances, value.revision, value.year, value.unlockedFeatures)) ||
    (value.unlockedFeatures.includes('independent-actions') !== ('independentTurns' in value)) ||
    ('independentTurns' in value && !independentTurns(value.independentTurns, value.round)) ||
    !outcome(value.outcome)
  )
    return false;
  const legacyClock =
    options.allowLegacyClock === true &&
    value.clockEpoch === undefined &&
    value.clockTicks === undefined &&
    Object.keys(value.directorIntervals).length === 0;
  if (
    !legacyClock &&
    (!integer(value.clockTicks) ||
      (value.clockEpoch !== null &&
        (typeof value.clockEpoch !== 'string' || parseUtcTimestamp(value.clockEpoch) === null)) ||
      (value.clockEpoch === null && value.clockTicks !== 0))
  )
    return false;
  if (
    !Array.isArray(value.civilizations) ||
    !value.civilizations.every(civilization) ||
    value.civilizations.length !== CIV_COUNT ||
    !unique(value.civilizations.map((item) => item.id)) ||
    !Array.isArray(value.cities) ||
    !value.cities.every(city) ||
    !unique(value.cities.map((item) => item.id)) ||
    !Array.isArray(value.tiles) ||
    !value.tiles.every(tile) ||
    !unique(value.tiles.map((item) => item.id)) ||
    !Array.isArray(value.routes) ||
    !value.routes.every(route) ||
    !unique(value.routes.map((item) => item.id)) ||
    !Array.isArray(value.treaties) ||
    !value.treaties.every(treaty) ||
    !unique(value.treaties.map((item) => item.id)) ||
    !Array.isArray(value.events) ||
    !value.events.every(event) ||
    !unique(value.events.map((item) => item.id))
  )
    return false;
  const width = value.width;
  const height = value.height;
  const tiles = value.tiles;
  const cities = value.cities;
  const round = value.round;
  const counts = value.eventCounts;
  if (
    tiles.length !== width * height ||
    !tiles.every(
      (item) => item.q < width && item.r < height && item.id === item.r * width + item.q,
    ) ||
    !cities.every((item) =>
      tiles.some((site) => site.id === item.tileId && site.owner === item.civId),
    ) ||
    !unique(cities.map((item) => item.tileId)) ||
    !value.civilizations.every((item) =>
      cities.some((settlement) => settlement.civId === item.id),
    ) ||
    !value.routes.every(
      (item) =>
        cities.some((endpoint) => endpoint.id === item.from && endpoint.civId === item.owner) &&
        cities.some((endpoint) => endpoint.id === item.to && endpoint.civId === item.partner),
    ) ||
    !tradeState('tradeOffers' in value ? value.tradeOffers : [], value.routes, cities, round) ||
    !value.treaties.every((item) => item.since <= round) ||
    !value.events.every(
      (item) =>
        item.round <= round &&
        (item.tileId === null || tiles.some((site) => site.id === item.tileId)) &&
        integer(counts[item.type], 1),
    ) ||
    (value.outcome !== null && value.outcome.round > round)
  )
    return false;
  return true;
}
