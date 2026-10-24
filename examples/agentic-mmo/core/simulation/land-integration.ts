import type { LandIntegrationWitness } from '../land-integration-types.ts';
import { isLandFoundingReceipt, isPaidLandDelivery } from '../land-integration-validation.ts';
import type { GameEvent, ResolvedTradeDelivery, WorldState } from '../types.ts';
import { landTransportBlock } from './transport.ts';

function sameTermsValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => sameTermsValue(value, right[index]));
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
  const leftFields = Object.entries(left); const rightFields = right as Record<string, unknown>;
  return leftFields.length === Object.keys(right).length && leftFields.every(([key, value]) => Object.hasOwn(right, key) && sameTermsValue(value, rightFields[key]));
}

function currentDelivery(state: WorldState, event: GameEvent): ResolvedTradeDelivery | null {
  const delivery = event.paidTradeDelivery;
  if (event.type !== 'trade-delivered' || !isPaidLandDelivery(delivery)
    || event.id !== delivery.eventId || event.round !== state.round || delivery.round !== state.round || delivery.revision !== state.revision
    || event.actor !== delivery.owner || event.target !== delivery.partner || event.detail !== delivery.routeId || event.tileId !== delivery.toTileId) return null;
  const route = state.routes.find(candidate => candidate.id === delivery.routeId);
  const agreement = route?.agreement;
  const offer = state.tradeOffers?.find(candidate => candidate.id === delivery.agreementOfferId);
  const from = state.cities.find(city => city.id === delivery.fromCityId);
  const to = state.cities.find(city => city.id === delivery.toCityId);
  if (!route || !agreement?.enabled || !route.active || agreement.closedRound !== null
    || route.from !== delivery.fromCityId || route.to !== delivery.toCityId || route.owner !== delivery.owner || route.partner !== delivery.partner
    || agreement.offerId !== delivery.agreementOfferId || agreement.acceptedRound !== delivery.agreementAcceptedRound
    || agreement.lastAttemptRound !== state.round || agreement.lastDeliveryRound !== state.round || agreement.deliveryCount !== delivery.deliveryCount
    || agreement.nextDeliveryRound !== state.round + delivery.tradeTerms.cadenceRounds || agreement.blockedBy !== null || agreement.blockedReason !== null
    || route.damage >= delivery.tradeTerms.damageDisableAt || route.volume <= 0
    || !sameTermsValue(agreement.terms, delivery.tradeTerms)
    || !offer || offer.status !== 'accepted' || offer.routeId !== route.id || offer.proposer !== delivery.owner || offer.recipient !== delivery.partner
    || offer.from !== delivery.fromCityId || offer.to !== delivery.toCityId || !sameTermsValue(offer.terms, delivery.tradeTerms)
    || agreement.acceptedRound < offer.createdRound || agreement.acceptedRound >= offer.expiresRound
    || !from || !to || from.civId !== delivery.owner || to.civId !== delivery.partner || from.tileId !== delivery.fromTileId || to.tileId !== delivery.toTileId
    || delivery.tradeTerms.transport?.mode !== 'land'
    || landTransportBlock(state, delivery.tradeTerms.transport, delivery.fromTileId, delivery.toTileId) !== null) return null;
  return delivery;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function selectLandIntegration(state: WorldState, events: readonly GameEvent[]): LandIntegrationWitness | null {
  if (!['earned-land-integration', 'conserved-founding', 'exact-trade-endpoints', 'land-transport', 'trade-routes', 'earned-history'].every(feature => state.unlockedFeatures.includes(feature))) return null;
  const candidates: LandIntegrationWitness[] = [];
  for (const event of events) {
    const delivery = currentDelivery(state, event);
    if (!delivery) continue;
    for (const city of state.cities) {
      const founding = city.landFounding;
      if (!isLandFoundingReceipt(founding) || city.coastalFounding || city.housing?.origin === 'initial-capital'
        || founding.foundedCityId !== city.id || founding.civId !== city.civId || founding.destinationTileId !== city.tileId
        || founding.revision >= delivery.revision || founding.round > delivery.agreementAcceptedRound
        || founding.sourceCityId === delivery.fromCityId || founding.sourceCityId === delivery.toCityId
        || !state.cities.some(source => source.id === founding.sourceCityId && source.tileId === founding.sourceTileId)
        || !((delivery.fromCityId === city.id && delivery.owner === city.civId && delivery.fromTileId === city.tileId)
          || (delivery.toCityId === city.id && delivery.partner === city.civId && delivery.toTileId === city.tileId))) continue;
      candidates.push({ ruleVersion: 1, kind: 'land', founding, delivery });
    }
  }
  candidates.sort((left, right) => left.founding.revision - right.founding.revision
    || compareText(left.founding.foundedCityId, right.founding.foundedCityId)
    || left.delivery.revision - right.delivery.revision
    || Number(left.delivery.eventId.split(':')[1]) - Number(right.delivery.eventId.split(':')[1])
    || compareText(left.delivery.routeId, right.delivery.routeId));
  return candidates[0] ? structuredClone(candidates[0]) : null;
}
