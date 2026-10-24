import { ECONOMY_RULES, HISTORICAL_MILESTONES, RESOURCE_IDS, TRADE_RECIPES } from './content.ts';
import type { ConnectionWitness, LandFoundingReceipt, LandIntegrationWitness } from './land-integration-types.ts';
import { CIV_COUNT } from './types.ts';
import type { ResolvedTradeDelivery, Resources, TradeTerms, WorldState } from './types.ts';
import { isLandTransportQuote, landTransportCadence, landTransportTopologyBlock } from './simulation/transport.ts';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean { return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)); }
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 128; }
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equal(value, right[index]));
  return record(left) && record(right) && Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
}
function eventId(value: unknown): value is string { return text(value) && /^[1-9]\d*:(0|[1-9]\d*)$/.test(value) && integer(Number(value.split(':')[0]), 1) && integer(Number(value.split(':')[1])); }
function eventRevision(value: string): number { return Number(value.split(':')[0]); }
function precedes(first: string, second: string): boolean { return eventRevision(first) < eventRevision(second) || eventRevision(first) === eventRevision(second) && Number(first.split(':')[1]) < Number(second.split(':')[1]); }
function identityRevision(value: unknown, prefix: 'route' | 'offer'): number | null {
  if (!text(value) || !new RegExp(`^${prefix}-[1-9]\\d*$`).test(value)) return null;
  const revision = Number(value.slice(prefix.length + 1));
  return integer(revision, 1) ? revision : null;
}
function cityRevision(value: unknown): number | null {
  if (!text(value) || !/^city-[0-4](?:-[1-9]\d*)?$/.test(value)) return null;
  const revision = Number(value.split('-')[2] ?? 0);
  return integer(revision) ? revision : null;
}
function vector(value: unknown): value is Partial<Resources> { return record(value) && Object.entries(value).every(([key, amount]) => RESOURCE_IDS.some(id => id === key) && typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= Number.MAX_SAFE_INTEGER); }

export function isLandFoundingReceipt(value: unknown): value is LandFoundingReceipt {
  if (!record(value) || !keys(value, ['ruleVersion', 'mode', 'civId', 'sourceCityId', 'foundedCityId', 'sourceTileId', 'destinationTileId', 'population', 'sourcePopulationBefore', 'sourcePopulationAfter', 'paid', 'round', 'revision', 'eventId'])
    || value.ruleVersion !== 1 || value.mode !== 'ordinary' || !integer(value.civId, 0, CIV_COUNT - 1) || !integer(value.round) || !integer(value.revision, 1)
    || !eventId(value.eventId) || eventRevision(value.eventId) !== value.revision || value.foundedCityId !== `city-${value.civId}-${value.revision}`
    || value.sourceCityId === value.foundedCityId || !integer(value.sourceTileId) || !integer(value.destinationTileId) || value.sourceTileId === value.destinationTileId
    || value.population !== ECONOMY_RULES.settle.population || !integer(value.sourcePopulationAfter, ECONOMY_RULES.settle.minimumSourcePopulation)
    || !integer(value.sourcePopulationBefore, ECONOMY_RULES.settle.population + ECONOMY_RULES.settle.minimumSourcePopulation)
    || value.sourcePopulationBefore - value.sourcePopulationAfter !== value.population || !equal(value.paid, ECONOMY_RULES.settle.cost)) return false;
  const sourceRevision = cityRevision(value.sourceCityId);
  return sourceRevision !== null && sourceRevision < value.revision && Number(String(value.sourceCityId).split('-')[1]) === value.civId;
}

function landTradeTerms(value: unknown): value is TradeTerms {
  const resources = ['constructionCost', 'proposerCargo', 'recipientCargo', 'proposerUpkeep', 'recipientUpkeep', 'proposerYield', 'recipientYield'] as const;
  if (!record(value) || !keys(value, ['recipeId', 'recipeVersion', ...resources, 'cadenceRounds', 'damageDisableAt', 'transport', ...(Object.hasOwn(value, 'strategicCargo') ? ['strategicCargo'] : [])])
    || !text(value.recipeId) || !integer(value.recipeVersion, 1) || !integer(value.cadenceRounds, 1)
    || !isLandTransportQuote(value.transport, Number.MAX_SAFE_INTEGER) || Object.keys(value.transport.tileIds).length !== value.transport.tileIds.length
    || !resources.every(field => vector(value[field]))) return false;
  const recipe = TRADE_RECIPES.find(item => item.id === value.recipeId && item.version === value.recipeVersion);
  return !!recipe && resources.every(field => equal(value[field], recipe.terms[field])) && value.damageDisableAt === recipe.terms.damageDisableAt
    && value.cadenceRounds === landTransportCadence(recipe.terms.cadenceRounds, value.transport)
    && Object.hasOwn(value, 'strategicCargo') === Object.hasOwn(recipe.terms, 'strategicCargo') && equal(value.strategicCargo, recipe.terms.strategicCargo);
}

export function isPaidLandDelivery(value: unknown): value is ResolvedTradeDelivery {
  if (!record(value) || !keys(value, ['ruleVersion', 'routeId', 'agreementOfferId', 'agreementAcceptedRound', 'owner', 'partner', 'fromCityId', 'toCityId', 'fromTileId', 'toTileId', 'round', 'revision', 'eventId', 'deliveryCount', 'tradeTerms', 'proposerPaid', 'recipientPaid', 'proposerStrategicPaid', 'recipientStrategicPaid'])
    || value.ruleVersion !== 1 || !integer(value.agreementAcceptedRound) || !integer(value.round, value.agreementAcceptedRound + 1)
    || !integer(value.revision, 1) || !eventId(value.eventId) || eventRevision(value.eventId) !== value.revision || !integer(value.deliveryCount, 1)
    || !integer(value.owner, 0, CIV_COUNT - 1) || !integer(value.partner, 0, CIV_COUNT - 1) || value.owner === value.partner
    || value.fromCityId === value.toCityId || !integer(value.fromTileId) || !integer(value.toTileId) || value.fromTileId === value.toTileId
    || !landTradeTerms(value.tradeTerms) || value.tradeTerms.transport!.tileIds[0] !== value.fromTileId || value.tradeTerms.transport!.tileIds.at(-1) !== value.toTileId
    || !record(value.proposerPaid) || !keys(value.proposerPaid, RESOURCE_IDS) || !record(value.recipientPaid) || !keys(value.recipientPaid, RESOURCE_IDS)) return false;
  const acceptedRevision = identityRevision(value.routeId, 'route'); const proposedRevision = identityRevision(value.agreementOfferId, 'offer');
  const fromRevision = cityRevision(value.fromCityId); const toRevision = cityRevision(value.toCityId);
  if (acceptedRevision === null || proposedRevision === null || fromRevision === null || toRevision === null
    || fromRevision >= proposedRevision || toRevision >= proposedRevision || proposedRevision >= acceptedRevision || acceptedRevision >= value.revision) return false;
  const terms = value.tradeTerms; const proposerPaid = value.proposerPaid; const recipientPaid = value.recipientPaid;
  return (value.round - value.agreementAcceptedRound) % terms.cadenceRounds === 0
    && value.deliveryCount <= Math.floor((value.round - value.agreementAcceptedRound) / terms.cadenceRounds)
    && RESOURCE_IDS.every(id => proposerPaid[id] === (terms.proposerCargo[id] ?? 0) + (terms.proposerUpkeep[id] ?? 0) && recipientPaid[id] === (terms.recipientCargo[id] ?? 0) + (terms.recipientUpkeep[id] ?? 0))
    && equal(value.proposerStrategicPaid, { ...terms.strategicCargo?.proposer }) && equal(value.recipientStrategicPaid, { ...terms.strategicCargo?.recipient })
    && [...Object.values(terms.proposerCargo), ...Object.values(terms.recipientCargo), ...Object.values(terms.strategicCargo?.proposer ?? {}), ...Object.values(terms.strategicCargo?.recipient ?? {})].some(amount => amount > 0);
}

export function isLandIntegrationWitness(value: unknown): value is LandIntegrationWitness {
  if (!record(value) || !keys(value, ['ruleVersion', 'kind', 'founding', 'delivery']) || value.ruleVersion !== 1 || value.kind !== 'land'
    || !isLandFoundingReceipt(value.founding) || !isPaidLandDelivery(value.delivery)) return false;
  const birth = value.founding; const delivery = value.delivery;
  return birth.revision < delivery.revision && birth.round <= delivery.agreementAcceptedRound
    && birth.sourceCityId !== delivery.fromCityId && birth.sourceCityId !== delivery.toCityId
    && (birth.foundedCityId === delivery.fromCityId && birth.destinationTileId === delivery.fromTileId && birth.civId === delivery.owner
      || birth.foundedCityId === delivery.toCityId && birth.destinationTileId === delivery.toTileId && birth.civId === delivery.partner);
}

function connection(value: unknown): value is ConnectionWitness { return record(value) && value.kind === 'coastal' && keys(value, ['kind']) || isLandIntegrationWitness(value); }
const payloads = ['landFounding', 'paidTradeDelivery', 'landIntegration'] as const;

export function validLandIntegrationEvent(value: unknown): boolean {
  if (!record(value)) return false;
  const present = payloads.filter(key => Object.hasOwn(value, key));
  if (present.length === 0) return true;
  if (present.length !== 1 || !eventId(value.id) || !integer(value.round)) return false;
  if (Object.hasOwn(value, 'landFounding')) {
    const receipt = value.landFounding;
    return isLandFoundingReceipt(receipt) && !Object.hasOwn(value, 'coastalFounding') && value.type === 'settlement-founded' && value.id === receipt.eventId && value.round === receipt.round
      && value.actor === receipt.civId && value.target === receipt.civId && value.tileId === receipt.destinationTileId;
  }
  if (Object.hasOwn(value, 'paidTradeDelivery')) {
    const receipt = value.paidTradeDelivery;
    return isPaidLandDelivery(receipt) && !Object.hasOwn(value, 'steamDelivery') && value.type === 'trade-delivered' && value.id === receipt.eventId && value.round === receipt.round
      && value.actor === receipt.owner && value.target === receipt.partner && value.tileId === receipt.toTileId && value.detail === receipt.routeId
      && (!Object.hasOwn(value, 'strategicShipment') || equal(value.strategicShipment, { ruleVersion: 1, routeId: receipt.routeId, offerId: receipt.agreementOfferId, proposer: receipt.owner, recipient: receipt.partner, proposerSent: receipt.tradeTerms.strategicCargo?.proposer, recipientSent: receipt.tradeTerms.strategicCargo?.recipient }));
  }
  const witness = value.landIntegration;
  return isLandIntegrationWitness(witness) && value.type === 'history-milestone' && value.actor === null && value.target === null && value.tileId === witness.founding.destinationTileId
    && value.round === witness.delivery.round && eventRevision(value.id) === witness.delivery.revision && precedes(witness.delivery.eventId, value.id);
}

function historicalFounding(receipt: LandFoundingReceipt, world: WorldState): boolean {
  if (!isLandFoundingReceipt(receipt) || receipt.round > world.round || receipt.revision > world.revision
    || !world.tiles.some(tile => tile.id === receipt.sourceTileId) || !world.tiles.some(tile => tile.id === receipt.destinationTileId)) return false;
  const source = world.cities.find(city => city.id === receipt.sourceCityId);
  const founded = world.cities.find(city => city.id === receipt.foundedCityId);
  if (source && (source.tileId !== receipt.sourceTileId || source.housing && source.housing.establishedRound > receipt.round)
    || founded && (founded.tileId !== receipt.destinationTileId || !equal(founded.landFounding, receipt) || Object.hasOwn(founded, 'coastalFounding')
      || founded.housing && (founded.housing.origin !== 'founded' || founded.housing.establishedRound !== receipt.round))) return false;
  const retained = world.events.find(event => event.id === receipt.eventId);
  return !retained || validLandIntegrationEvent(retained) && equal(retained.landFounding, receipt);
}

function historicalDelivery(receipt: ResolvedTradeDelivery, world: WorldState): boolean {
  if (!isPaidLandDelivery(receipt) || receipt.round > world.round || receipt.revision > world.revision
    || receipt.tradeTerms.transport?.mode !== 'land' || landTransportTopologyBlock(world, receipt.tradeTerms.transport, receipt.fromTileId, receipt.toTileId) !== null
    || !TRADE_RECIPES.find(recipe => recipe.id === receipt.tradeTerms.recipeId)!.requiredFeatures.every(feature => world.unlockedFeatures.includes(feature))) return false;
  const from = world.cities.find(city => city.id === receipt.fromCityId); const to = world.cities.find(city => city.id === receipt.toCityId);
  if (from && (from.tileId !== receipt.fromTileId || from.housing && from.housing.establishedRound > receipt.agreementAcceptedRound)
    || to && (to.tileId !== receipt.toTileId || to.housing && to.housing.establishedRound > receipt.agreementAcceptedRound)) return false;
  const route = world.routes.find(item => item.id === receipt.routeId);
  if (route) {
    const agreement = route.agreement;
    if (route.from !== receipt.fromCityId || route.to !== receipt.toCityId || route.owner !== receipt.owner || route.partner !== receipt.partner
      || !agreement || agreement.offerId !== receipt.agreementOfferId || agreement.acceptedRound !== receipt.agreementAcceptedRound || !equal(agreement.terms, receipt.tradeTerms)
      || agreement.deliveryCount < receipt.deliveryCount || agreement.lastDeliveryRound === null || agreement.lastDeliveryRound < receipt.round
      || (agreement.deliveryCount === receipt.deliveryCount) !== (agreement.lastDeliveryRound === receipt.round)) return false;
  }
  const offer = world.tradeOffers?.find(item => item.id === receipt.agreementOfferId);
  if (offer && (offer.from !== receipt.fromCityId || offer.to !== receipt.toCityId || offer.proposer !== receipt.owner || offer.recipient !== receipt.partner
    || offer.routeId !== receipt.routeId || offer.status !== 'accepted' || offer.createdRound > receipt.agreementAcceptedRound || offer.expiresRound <= receipt.agreementAcceptedRound
    || !equal(offer.terms, receipt.tradeTerms))) return false;
  const retained = world.events.find(event => event.id === receipt.eventId);
  return !retained || validLandIntegrationEvent(retained) && equal(retained.paidTradeDelivery, receipt);
}

export function earnedLandRecords(world: WorldState): boolean {
  const enabled = world.unlockedFeatures.includes('earned-land-integration');
  if (world.milestoneProofs !== undefined && !record(world.milestoneProofs)) return false;
  const proofs = Object.entries(world.milestoneProofs ?? {});
  if (proofs.some(([, proof]) => !record(proof))) return false;
  if (!enabled) return !world.cities.some(city => Object.hasOwn(city, 'landFounding')) && !world.events.some(event => payloads.some(key => Object.hasOwn(event, key)))
    && !proofs.some(([, proof]) => Object.hasOwn(proof, 'connection'));
  if (!['conserved-founding', 'settlement-expansion', 'exact-trade-endpoints', 'land-transport', 'trade-routes', 'earned-history'].every(feature => world.unlockedFeatures.includes(feature))) return false;
  const birthIds = new Set<string>();
  for (const city of world.cities) {
    if (!Object.hasOwn(city, 'landFounding')) {
      if ((city.housing?.origin === 'founded' || (cityRevision(city.id) ?? 0) > 0) && !Object.hasOwn(city, 'coastalFounding')) return false;
      continue;
    }
    const birth = city.landFounding;
    if (!birth || !historicalFounding(birth, world) || birth.foundedCityId !== city.id || birthIds.has(birth.eventId)) return false;
    birthIds.add(birth.eventId);
  }
  const connected = world.milestoneProofs?.['connected-world'];
  if (world.calendarMilestones.includes('connected-world') && !connected) return false;
  for (const [id, proof] of proofs) {
    if (!Object.hasOwn(proof, 'connection')) { if (id === 'connected-world') return false; continue; }
    if (id !== 'connected-world' || !connection(proof.connection)) return false;
    const milestone = HISTORICAL_MILESTONES.find(item => item.id === id)!;
    if (!world.calendarMilestones.includes(id) || !milestone.requiresMilestones.every(required => world.calendarMilestones.includes(required))) return false;
    if (proof.connection.kind === 'coastal') {
      if (!milestone.requiredFeatures.every(feature => world.unlockedFeatures.includes(feature))
        || !milestone.conditions.every(condition => condition.kind === 'technology' ? world.civilizations.filter(civ => civ.technologies.includes(condition.technology)).length >= condition.civilizations
          : condition.kind !== 'recorded-event-count' || (world.eventCounts[condition.eventType] ?? 0) >= condition.minimum)) return false;
      const retained = world.events.find(event => event.id === proof.eventId);
      if (retained && (retained.type !== 'history-milestone' || retained.round !== proof.round || retained.actor !== null || retained.target !== null || retained.tileId !== null || Object.hasOwn(retained, 'landIntegration'))) return false;
      continue;
    }
    const witness = proof.connection;
    if (!historicalFounding(witness.founding, world) || !historicalDelivery(witness.delivery, world)
      || proof.revision !== witness.delivery.revision || proof.round !== witness.delivery.round || !eventId(proof.eventId) || eventRevision(proof.eventId) !== proof.revision || !precedes(witness.delivery.eventId, proof.eventId)) return false;
    const retained = world.events.find(event => event.id === proof.eventId);
    if (retained && (!validLandIntegrationEvent(retained) || !equal(retained.landIntegration, witness))) return false;
    for (const required of milestone.requiresMilestones) {
      const earlier = world.milestoneProofs?.[required];
      if (earlier && (earlier.round > proof.round || !eventId(earlier.eventId) || !precedes(earlier.eventId, proof.eventId))) return false;
    }
  }
  const deliveryIds = new Map<string, string>();
  if (connected?.connection?.kind === 'land') {
    const receipt = connected.connection.delivery;
    deliveryIds.set(`${receipt.routeId}:${receipt.deliveryCount}`, receipt.eventId);
  }
  for (const event of world.events) {
    if (!validLandIntegrationEvent(event)) return false;
    if (Object.hasOwn(event, 'landFounding') && (!event.landFounding || !historicalFounding(event.landFounding, world))) return false;
    if (Object.hasOwn(event, 'paidTradeDelivery')) {
      const receipt = event.paidTradeDelivery;
      if (!receipt || !historicalDelivery(receipt, world)) return false;
      const identity = `${receipt.routeId}:${receipt.deliveryCount}`;
      if (deliveryIds.has(identity) && deliveryIds.get(identity) !== receipt.eventId) return false;
      deliveryIds.set(identity, receipt.eventId);
    }
    if (event.type === 'trade-delivered' && world.routes.find(route => route.id === event.detail)?.agreement?.terms.transport?.mode === 'land' && !Object.hasOwn(event, 'paidTradeDelivery')) return false;
    if (Object.hasOwn(event, 'landIntegration') && (!connected || connected.connection?.kind !== 'land' || connected.eventId !== event.id || !equal(connected.connection, event.landIntegration))) return false;
    if (event.type === 'settlement-founded' && !Object.hasOwn(event, 'landFounding')) return false;
  }
  return true;
}
