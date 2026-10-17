import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { legalActions } from '../../core/engine.ts';
import { RELEASES } from '../../core/release.ts';
import type { GameAction } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';
import { waterLandOperationJourney, waterLandTown } from './water-land-journey.ts';

export function forestProductionJourney() {
  const previous = waterLandOperationJourney(); let state = structuredClone(previous.grown);
  const steps: CoastalPrefixStep[] = [...previous.journey.steps];
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state); const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state), `Canonical forest frame ${result.state.revision}`);
    steps.push({ before, input, result }); state = result.state;
  };
  const act = (action: GameAction, seat = 0): void => {
    assert.ok(legalActions(state, seat, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify({ seat, action }));
    commit({ kind: 'action', command: { seat, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean): void => { for (let count = 0; count < 100 && !condition(); count++) beat(); assert.ok(condition(), 'Bounded legal forest outcome was not reached'); };
  const research = (technology: string, seat = 0): void => { if (state.civilizations[seat]?.technologies.includes(technology)) return; act({ type: 'research', technology }, seat); until(() => !!state.civilizations[seat]?.technologies.includes(technology)); };
  const release = RELEASES.find(candidate => candidate.compatibleFrom.includes(state.releaseId) && candidate.featureIds.includes('forest-production'));
  assert.ok(release, 'Compatible forest successor must expose Archery Machinery and an actual worked Lumber mill');
  const beforeRelease = structuredClone(state);
  commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, timestamp: time() } });
  const adopted = structuredClone(state);
  return { previous, initial: previous.journey.initial, steps, beforeRelease, adopted, get state() { return state; }, time, act, beat, until, research };
}

export function forestProductionOperationJourney() {
  const journey = forestProductionJourney(); const cityId = 'city-0'; const tileId = 56;
  journey.research('archery'); const archeryCompleted = structuredClone(journey.state);
  journey.research('machinery'); const ready = structuredClone(journey.state);
  journey.act({ type: 'improve', cityId, tileId, improvementId: 'lumber-mill' }); const started = structuredClone(journey.state);
  journey.until(() => !!waterLandTown(journey.state, cityId).improvements?.[String(tileId)]);
  const completed = structuredClone(journey.state); const completionStep = journey.steps.at(-1); assert.ok(completionStep);
  journey.beat(); const operated = structuredClone(journey.state);
  return { journey, cityId, tileId, archeryCompleted, ready, started, completed, completionStep, operated };
}
