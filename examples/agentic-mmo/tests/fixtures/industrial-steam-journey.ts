import assert from 'node:assert/strict';
import { legalActions } from '../../core/engine.ts';
import { freshFixtureJourney, syntheticInstitution, syntheticTechnologies } from './coastal-prefix.ts';

export function industrialSteamPrefix() {
  const journey = freshFixtureJourney('settlement-industrial-steam-1', state => {
    state.calendarMilestones = ['first-harvest', 'roads-between-peoples', 'rise-of-states', 'connected-world'];
    for (const seat of [0, 1]) {
      const actor = state.civilizations[seat]; const city = state.cities[seat]; assert.ok(actor && city);
      actor.era = 2; actor.resources = { food: 160, materials: 120, credits: 140, energy: 80, culture: 0, science: 0 }; city.population = 16;
      syntheticTechnologies(state, seat, ['printing', 'astronomy', 'metal-casting', 'apprenticeship']);
      actor.strategicResources = { iron: 12 };
      syntheticInstitution(state, city.id, 'campus', seat === 0 ? 39 : 30); syntheticInstitution(state, city.id, 'library');
    }
    syntheticInstitution(state, 'city-1', 'industrial-zone', 31); syntheticInstitution(state, 'city-1', 'foundry');
  }, 'Synthetic era, prerequisite learning, stocks including twelve Iron per actor, residents, Campus/Library and city-1 Foundry/Industrial site; industrial research, Coal extraction, second Foundry, rail, consent and delivery are real');
  return { ...journey, prepared: structuredClone(journey.state), get state() { return journey.state; } };
}

import { createSteamTransportPlanner } from '../../core/simulation/transport.ts';
import { railEdgeId } from '../../core/simulation/rail.ts';

export function industrialSteamJourney() {
  const journey = industrialSteamPrefix();
  for (const technology of ['scientific-method', 'shipbuilding', 'industrialization', 'steam-power']) journey.research(technology);
  const researched = structuredClone(journey.state);
  const mine = legalActions(journey.state, journey.seat, journey.time()).find(option => option.action.type === 'improve' && option.action.improvementId === 'mine' && journey.state.coalDeposits?.deposits[String(option.action.tileId)]);
  assert.ok(mine && mine.action.type === 'improve'); const mineTileId = mine.action.tileId; const mineCityId = mine.action.cityId;
  journey.act(mine.action);
  journey.until(() => !!journey.state.cities.find(city => city.id === mineCityId)?.improvements?.[String(mineTileId)], 'Paid Coal Mine completion');
  journey.until(() => (journey.state.civilizations[journey.seat]?.strategicResources?.coal ?? 0) >= 2, 'Allocated residents extract finite Coal');
  const coalReady = structuredClone(journey.state);
  for (const buildingId of ['industrial-zone', 'foundry']) {
    if (journey.state.cities.find(city => city.id === 'city-0')?.buildings.includes(buildingId)) continue;
    const action = legalActions(journey.state, journey.seat, journey.time()).find(option => option.action.type === 'build' && option.action.project === buildingId && option.action.cityId === 'city-0');
    assert.ok(action, `Legal ${buildingId} in city-0: ${JSON.stringify(journey.state.cities.find(city => city.id === 'city-0'))}`);
    journey.act(action.action); journey.until(() => !!journey.state.cities.find(city => city.id === 'city-0')?.buildings.includes(buildingId), `Paid ${buildingId} completion`);
  }
  journey.until(() => (journey.state.industrialEvidence?.foundryOperations.length ?? 0) === 2, 'Two distinct actual staffed and supplied Foundries operate');
  const twoFoundries = structuredClone(journey.state);
  const faster = () => legalActions(journey.state, journey.seat, journey.time()).find(option => option.action.type === 'propose-trade' && option.action.transportMode === 'steam' && option.action.recipeId === 'harvest-for-materials' && option.tradeQuote?.transport.mode === 'steam' && option.tradeQuote.cadenceRounds < option.tradeQuote.transport.unrailedCadence && option.tradeQuote.transport.railEdges.length > 0);
  for (let count = 0; count < 12 && !faster(); count++) {
    const actions = legalActions(journey.state, journey.seat, journey.time());
    const planner = createSteamTransportPlanner(journey.state);
    const paths = actions.flatMap(option => {
      const action = option.action;
      if (action.type !== 'propose-trade' || action.transportMode !== 'steam' || action.recipeId !== 'harvest-for-materials') return [];
      const from = journey.state.cities.find(city => city.id === action.sourceCityId); const to = journey.state.cities.find(city => city.id === action.recipientCityId);
      const quote = from && to ? planner.quote(from.tileId, to.tileId, 2) : null;
      return quote && quote.unrailedCadence > 2 ? [quote] : [];
    });
    const rail = actions.find(option => { const action = option.action; return action.type === 'build-rail' && paths.some(path => path.tileIds.some((tile, index) => index > 0 && railEdgeId(path.tileIds[index - 1] ?? -1, tile) === railEdgeId(action.fromTileId, action.toTileId))); });
    if (!rail) {
      const acquisition = actions.find(option => { const action = option.action; return action.type === 'acquire-tile' && paths.some(path => path.tileIds.includes(action.tileId)); });
      assert.ok(acquisition, 'A genuine offered land purchase must extend the owned rail path');
      journey.act(acquisition.action); continue;
    }
    assert.ok(rail.action.type === 'build-rail');
    const edgeId = railEdgeId(rail.action.fromTileId, rail.action.toTileId);
    journey.act(rail.action); journey.until(() => !!journey.state.railEdges?.[edgeId], 'Paid Rail completes on a later strategic beat');
  }
  const offer = faster(); assert.ok(offer && offer.action.type === 'propose-trade');
  const beforeOffer = structuredClone(journey.state);
  journey.act(offer.action); const proposed = structuredClone(journey.state);
  const pending = journey.state.tradeOffers?.findLast(candidate => candidate.status === 'pending' && candidate.proposer === journey.seat && candidate.terms.transport?.mode === 'steam'); assert.ok(pending);
  journey.act({ type: 'respond-trade', offerId: pending.id, accept: true }, pending.recipient);
  const accepted = structuredClone(journey.state);
  journey.until(() => !!journey.state.industrialEvidence?.steamDelivery, 'A genuinely faster due steam exchange pays complete cargo and Coal');
  assert.ok(journey.state.calendarMilestones.includes('industrial-world'));
  return { initial: journey.initial, steps: journey.steps, seat: journey.seat, prepared: journey.prepared, provenance: journey.provenance, researched, coalReady, twoFoundries, beforeOffer, proposed, accepted, state: journey.state, mineTileId, mineCityId, offerId: pending.id };
}
