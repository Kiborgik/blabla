import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { legalActions } from '../../core/engine.ts';
import { RELEASES } from '../../core/release.ts';
import type { GameAction } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';
import { observatoryPrefix } from './observatory-prefix.ts';
import { waterLandTown } from './water-land-journey.ts';

export function observatoryLearningJourney() {
  const previous = observatoryPrefix(); let state = structuredClone(previous.state);
  const steps: CoastalPrefixStep[] = [...previous.steps]; const seat = previous.seat; const cityId = previous.cityId;
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state); const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state), `Canonical Observatory frame ${result.state.revision}`);
    steps.push({ before, input, result }); state = result.state;
  };
  const act = (action: GameAction, actor = seat): void => {
    assert.ok(legalActions(state, actor, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify({ actor, action }));
    commit({ kind: 'action', command: { seat: actor, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean): void => { for (let count = 0; count < 160 && !condition(); count++) beat(); assert.ok(condition(), 'Bounded actual Observatory outcome was not reached'); };
  const research = (technology: string): void => { if (state.civilizations[seat]?.technologies.includes(technology)) return; act({ type: 'research', technology }); until(() => !!state.civilizations[seat]?.technologies.includes(technology)); };
  const release = RELEASES.find(candidate => candidate.compatibleFrom.includes(state.releaseId) && candidate.featureIds.includes('observatory-learning'));
  assert.ok(release, 'Actual compatible Observatory release must enable mixed-ledger useful production');
  const beforeRelease = structuredClone(state);
  commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, timestamp: time() } });
  const adopted = structuredClone(state);
  return { previous, initial: previous.initial, steps, seat, cityId, beforeRelease, adopted, get state() { return state; }, time, act, beat, until, research };
}

export function observatoryLearningOperationJourney() {
  const journey = observatoryLearningJourney();
  for (const technology of ['sailing', 'celestial-navigation', 'astronomy']) journey.research(technology);
  const researched = structuredClone(journey.state);
  journey.act({ type: 'build', project: 'observatory', cityId: journey.cityId }); const started = structuredClone(journey.state);
  journey.until(() => waterLandTown(journey.state, journey.cityId).buildings.includes('observatory'));
  const completed = structuredClone(journey.state); const completionStep = journey.steps.at(-1); assert.ok(completionStep);
  journey.beat(); const operated = structuredClone(journey.state); const operationStep = journey.steps.at(-1); assert.ok(operationStep);
  return { journey, researched, started, completed, completionStep, operated, operationStep };
}
