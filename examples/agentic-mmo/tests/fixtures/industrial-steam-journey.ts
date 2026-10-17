import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { TECHNOLOGIES } from '../../core/content.ts';
import { legalActions } from '../../core/engine.ts';
import type { GameAction, WorldState } from '../../core/types.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';
import { civicBootstrapJourney } from './civic-bootstrap-journey.ts';

let prefix: ReturnType<typeof civicBootstrapJourney> | undefined;
export function industrialSteamPrefix() {
  prefix ??= civicBootstrapJourney(); let state = structuredClone(prefix.state);
  const initial = prefix.initial; const steps: CoastalPrefixStep[] = [...prefix.steps]; const seat = prefix.seat;
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state); const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before);
    steps.push({ before, input, result }); state = result.state;
  };
  const act = (action: GameAction, actor = seat): void => {
    assert.ok(legalActions(state, actor, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify({ actor, action }));
    commit({ kind: 'action', command: { seat: actor, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean, label: string, limit = 160): void => { for (let count = 0; count < limit && !condition(); count++) beat(); assert.ok(condition(), label); };
  const research = (technology: string, actor = seat): void => { if (state.civilizations[actor]?.technologies.includes(technology)) return; const definition = TECHNOLOGIES.find(item => item.id === technology); assert.ok(definition); for (const prerequisite of definition.requires) research(prerequisite, actor); act({ type: 'research', technology }, actor); until(() => !!state.civilizations[actor]?.technologies.includes(technology), `Productive completion ${technology}`); };
  const beforeRelease = structuredClone(state);
  commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-industrial-steam-1', timestamp: time() } });
  const adopted = structuredClone(state);
  return { initial, steps, seat, beforeRelease, adopted, get state(): WorldState { return state; }, time, act, beat, until, research, commit };
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
  return { initial: journey.initial, steps: journey.steps, seat: journey.seat, beforeRelease: journey.beforeRelease, adopted: journey.adopted, researched, coalReady, twoFoundries, beforeOffer, proposed, accepted, state: journey.state, mineTileId, mineCityId, offerId: pending.id };
}
