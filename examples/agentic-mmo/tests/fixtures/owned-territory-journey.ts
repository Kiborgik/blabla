import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { legalActions } from '../../core/engine.ts';
import { isGameAction } from '../../core/planning.ts';
import type { GameAction, WorldState, TileAcquisitionReceipt } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';
import { ownedTerritoryPrefix } from './owned-territory-prefix.ts';
import { waterLandTown } from './water-land-journey.ts';

export function acquisitionReceipts(state: WorldState): Record<string, TileAcquisitionReceipt> | undefined {
  return state.tileAcquisitions;
}

export function acquireTileAction(cityId: string, tileId: number): GameAction {
  const action = { type: 'acquire-tile', cityId, tileId };
  assert.ok(isGameAction(action), 'Exact acquire-tile action must be recognized by canonical grammar');
  return action;
}

export function ownedTerritoryJourney() {
  const previous = ownedTerritoryPrefix(); let state = structuredClone(previous.state);
  const steps: CoastalPrefixStep[] = [...previous.steps];
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state); const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state), `Canonical territory frame ${result.state.revision}`);
    steps.push({ before, input, result }); state = result.state;
  };
  const act = (action: GameAction, seat = previous.seat): void => {
    if (Date.parse(time()) >= Date.parse(coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60))) beat();
    assert.ok(legalActions(state, seat, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify({ seat, action }));
    commit({ kind: 'action', command: { seat, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean): void => { for (let count = 0; count < 160 && !condition(); count++) beat(); assert.ok(condition(), 'Bounded actual territory outcome was not reached'); };
  const research = (technology: string, seat = previous.seat): void => { if (state.civilizations[seat]?.technologies.includes(technology)) return; act({ type: 'research', technology }, seat); until(() => !!state.civilizations[seat]?.technologies.includes(technology)); };
  const prepared = structuredClone(state);
  return { previous, initial: previous.initial, steps, prepared, provenance: previous.provenance, get state() { return state; }, time, act, beat, until, research };
}

export function ownedTerritoryPastureJourney() {
  const journey = ownedTerritoryJourney(); const { cityId, seat } = journey.previous;
  journey.act(acquireTileAction(cityId, 181)); const firstPurchased = structuredClone(journey.state);
  journey.act(acquireTileAction(cityId, 164)); const purchased = structuredClone(journey.state);
  journey.act({ type: 'improve', cityId, tileId: 164, improvementId: 'pasture' }); const started = structuredClone(journey.state);
  journey.until(() => !!waterLandTown(journey.state, cityId).improvements?.['164']);
  const completed = structuredClone(journey.state); const completionStep = journey.steps.at(-1); assert.ok(completionStep);
  journey.beat(); const operated = structuredClone(journey.state);
  return { journey, seat, cityId, firstPurchased, purchased, started, completed, completionStep, operated };
}

export function ownedTerritoryForestJourney() {
  const pasture = ownedTerritoryPastureJourney(); const journey = pasture.journey; const seat = pasture.seat;
  for (const technology of ['kiln-firing', 'mining', 'masonry', 'wheel', 'engineering', 'archery', 'machinery']) journey.research(technology);
  journey.until(() => waterLandTown(journey.state, 'city-2').population >= 6);
  journey.act({ type: 'settle', sourceCityId: 'city-2', tileId: 218 }); const founded = structuredClone(journey.state);
  const city = journey.state.cities.find(candidate => candidate.tileId === 218 && candidate.civId === seat); assert.ok(city);
  journey.act(acquireTileAction(city.id, 219)); journey.act(acquireTileAction(city.id, 237)); const purchased = structuredClone(journey.state);
  journey.act({ type: 'improve', cityId: city.id, tileId: 237, improvementId: 'lumber-mill' }); const started = structuredClone(journey.state);
  journey.until(() => !!waterLandTown(journey.state, city.id).improvements?.['237']); const completed = structuredClone(journey.state);
  journey.until(() => waterLandTown(journey.state, city.id).population > 3); journey.beat(); const operated = structuredClone(journey.state);
  return { pasture, journey, seat, cityId: city.id, founded, purchased, started, completed, operated };
}
