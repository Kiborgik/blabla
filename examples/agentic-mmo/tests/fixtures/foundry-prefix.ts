import assert from 'node:assert/strict';
import { legalActions } from '../../core/engine.ts';
import { strategicCapacity } from '../../core/simulation/metals.ts';
import { cultureProductionJourney } from './culture-production-journey.ts';
import { waterLandTown } from './water-land-journey.ts';

export function foundryPrefix() {
  const { journey } = cultureProductionJourney(); const seat = 1; const cityId = 'city-1'; const donorSeat = 0; const donorCityId = 'city-0'; const mineTileId = 58;
  journey.research('bronze-working');
  journey.act({ type: 'improve', cityId: donorCityId, tileId: mineTileId, improvementId: 'mine' });
  journey.until(() => !!waterLandTown(journey.state, donorCityId).improvements?.[String(mineTileId)]);
  journey.until(() => (journey.state.civilizations[donorSeat]?.strategicResources?.iron ?? 0) >= 2);
  journey.act({ type: 'propose-trade', partner: seat, recipeId: 'iron-for-food', sourceCityId: donorCityId, recipientCityId: cityId });
  const offer = journey.state.tradeOffers?.find(candidate => candidate.status === 'pending' && candidate.proposer === donorSeat && candidate.recipient === seat && candidate.terms.recipeId === 'iron-for-food'); assert.ok(offer);
  const proposed = structuredClone(journey.state);
  journey.act({ type: 'respond-trade', offerId: offer.id, accept: true }, seat);
  const route = journey.state.routes.find(candidate => candidate.agreement?.offerId === offer.id); assert.ok(route?.agreement); const routeId = route.id;
  const accepted = structuredClone(journey.state);
  for (const technology of ['currency', 'kiln-firing', 'mining', 'bronze-working', 'iron-working', 'apprenticeship', 'masonry', 'wheel', 'engineering', 'archery', 'machinery', 'construction']) {
    if (journey.state.civilizations[seat]?.technologies.includes(technology)) continue;
    journey.act({ type: 'research', technology }, seat);
    journey.until(() => !!journey.state.civilizations[seat]?.technologies.includes(technology));
  }
  const industrial = legalActions(journey.state, seat, journey.time()).find(option => option.action.type === 'build' && option.action.project === 'industrial-zone' && option.action.cityId === cityId);
  assert.ok(industrial?.action.type === 'build' && industrial.action.tileId !== undefined);
  const industrialTileId = industrial.action.tileId; journey.act(industrial.action, seat);
  journey.until(() => waterLandTown(journey.state, cityId).buildings.includes('industrial-zone'));
  journey.until(() => (journey.state.civilizations[seat]?.strategicResources?.iron ?? 0) === strategicCapacity(journey.state, seat));
  const full = structuredClone(journey.state);
  journey.until(() => (journey.state.routes.find(candidate => candidate.id === routeId)?.agreement?.lastAttemptRound ?? -1) > full.round);
  const blockedExchangeStep = journey.steps.at(-1); assert.ok(blockedExchangeStep);
  assert.match(journey.state.routes.find(candidate => candidate.id === routeId)?.agreement?.blockedReason ?? '', /storage full/i);
  return { initial: journey.initial, state: structuredClone(journey.state), steps: [...journey.steps], timestamp: journey.time(), seat, cityId, industrialTileId, donorSeat, donorCityId, mineTileId, routeId, proposed, accepted, full, beforeBlockedExchange: structuredClone(blockedExchangeStep.before), blockedExchangeStep };
}
