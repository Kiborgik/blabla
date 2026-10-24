import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { legalActions } from '../../core/engine.ts';
import type { GameAction, WorldState } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';
import { waterLandPrefix } from './water-land-prefix.ts';

export function waterLandTown(state: WorldState, cityId: string) {
  const city = state.cities.find(candidate => candidate.id === cityId); assert.ok(city); return city;
}

export function waterLandJourney() {
  const previous = waterLandPrefix(); let state = structuredClone(previous.state);
  const steps: CoastalPrefixStep[] = [...previous.steps];
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state); const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state), `Canonical water-land frame ${result.state.revision}`);
    steps.push({ before, input, result }); state = result.state;
  };
  const act = (action: GameAction, seat = 0): void => {
    assert.ok(legalActions(state, seat, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify({ seat, action }));
    commit({ kind: 'action', command: { seat, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean): void => { for (let count = 0; count < 100 && !condition(); count++) beat(); assert.ok(condition(), 'Bounded legal water-land outcome was not reached'); };
  const research = (technology: string, seat = 0): void => { if (state.civilizations[seat]?.technologies.includes(technology)) return; act({ type: 'research', technology }, seat); until(() => !!state.civilizations[seat]?.technologies.includes(technology)); };
  const prepared = structuredClone(state);
  return { previous, initial: previous.initial, steps, prepared, provenance: previous.provenance, get state() { return state; }, time, act, beat, until, research };
}

export function waterLandPastureJourney() {
  const journey = waterLandJourney(); const { seat, cityId, tileId } = journey.previous.pasture;
  journey.research('animal-husbandry', seat); const revealed = structuredClone(journey.state);
  journey.act({ type: 'improve', cityId, tileId, improvementId: 'pasture' }, seat); const started = structuredClone(journey.state);
  journey.until(() => !!waterLandTown(journey.state, cityId).improvements?.[String(tileId)]);
  const completed = structuredClone(journey.state); const completionStep = journey.steps.at(-1); assert.ok(completionStep);
  journey.beat(); const operated = structuredClone(journey.state);
  return { journey, cityId, tileId, seat, revealed, started, completed, completionStep, operated };
}

export function waterLandOperationJourney() {
  const pasture = waterLandPastureJourney(); const journey = pasture.journey;
  journey.research('animal-husbandry'); journey.research('wheel');
  const millReady = structuredClone(journey.state);
  journey.act({ type: 'build', project: 'water-mill', cityId: journey.previous.mill.cityId });
  const millStarted = structuredClone(journey.state);
  journey.until(() => waterLandTown(journey.state, journey.previous.mill.cityId).buildings.includes('water-mill'));
  const millCompleted = structuredClone(journey.state); const millCompletionStep = journey.steps.at(-1); assert.ok(millCompletionStep);
  journey.beat(); const millOperated = structuredClone(journey.state);
  journey.research('engineering'); const aqueductReady = structuredClone(journey.state);
  journey.act({ type: 'build', project: 'aqueduct', cityId: journey.previous.aqueduct.cityId });
  const aqueductStarted = structuredClone(journey.state);
  journey.until(() => waterLandTown(journey.state, journey.previous.aqueduct.cityId).buildings.includes('aqueduct'));
  const aqueductCompleted = structuredClone(journey.state); const aqueductCompletionStep = journey.steps.at(-1); assert.ok(aqueductCompletionStep);
  journey.beat(); const grown = structuredClone(journey.state);
  return { pasture, journey, millReady, millStarted, millCompleted, millCompletionStep, millOperated, aqueductReady, aqueductStarted, aqueductCompleted, aqueductCompletionStep, grown };
}
