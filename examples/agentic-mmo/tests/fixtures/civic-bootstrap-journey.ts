import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { legalActions } from '../../core/engine.ts';
import { BUILDINGS } from '../../core/content.ts';
import { isWorldState } from '../../core/validation.ts';
import type { GameAction } from '../../core/types.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';
import { observatoryLearningOperationJourney } from './observatory-learning-journey.ts';

export function civicBootstrapJourney() {
  const previous = observatoryLearningOperationJourney(); let state = structuredClone(previous.journey.state);
  const steps: CoastalPrefixStep[] = [...previous.journey.steps]; const seat = previous.journey.seat;
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state); const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state), `Canonical civic frame ${result.state.revision}`);
    steps.push({ before, input, result }); state = result.state;
  };
  const act = (action: GameAction): void => {
    assert.ok(legalActions(state, seat, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify(action));
    commit({ kind: 'action', command: { seat, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean): void => { for (let count = 0; count < 40 && !condition(); count++) beat(); assert.ok(condition(), 'Bounded actual civic outcome was not reached'); };
  const beforeRelease = structuredClone(state);
  commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-civic-bootstrap-1', timestamp: time() } });
  const adopted = structuredClone(state);
  act({ type: 'choose-civic', civicId: 'code-of-laws' }); const selected = structuredClone(state);
  beat(); const invested = structuredClone(state);
  until(() => must(must(state.civilizations[seat]).civics).completedCivicIds.includes('code-of-laws'));
  const completed = structuredClone(state);
  act({ type: 'adopt-government', governmentId: 'chiefdom', assignments: [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }] }); const arranged = structuredClone(state);
  const build = legalActions(state, seat, time()).find(option => {
    const action = option.action;
    if (action.type !== 'build') return false;
    const definition = BUILDINGS.find(building => building.id === action.project);
    return definition && !definition.district && !definition.operatingInputs && Object.values(definition.production).some(amount => amount > 0);
  });
  assert.ok(build && build.action.type === 'build' && build.action.cityId, 'The legal civic journey must expose a real construction consumer');
  const cityId = build.action.cityId; const buildingId = build.action.project;
  act(build.action); const started = structuredClone(state);
  until(() => must(state.cities.find(city => city.id === cityId)).buildings.includes(buildingId));
  const built = structuredClone(state); const completionStep = must(steps.at(-1));
  beat(); const operated = structuredClone(state); const operationStep = must(steps.at(-1));
  return { initial: previous.journey.initial, steps, seat, cityId, buildingId, beforeRelease, adopted, selected, invested, completed, arranged, started, built, completionStep, operated, operationStep, get state() { return state; }, time, act, beat };
}

function must<T>(value: T | null | undefined): T { if (value === null || value === undefined) throw new RangeError("Required civic fact is missing"); return value; }
