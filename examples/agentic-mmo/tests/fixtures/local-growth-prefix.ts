import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { legalActions } from '../../core/engine.ts';
import type { GameAction } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import { greatLibraryPrefix } from './great-library-prefix.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';

export function localGrowthPrefix() {
  const prefix = greatLibraryPrefix();
  let state = prefix.state;
  const steps: CoastalPrefixStep[] = [...prefix.steps];
  const cityId = 'city-0';
  const time = (): string => coastalPrefixTime(Math.max(
    (state.independentTurns?.strategyTicks ?? 0) * 60 + 20,
    ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10),
  ));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state);
    const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state));
    steps.push({ input, before, result }); state = result.state;
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean): void => {
    for (let count = 0; count < 48 && !condition(); count++) beat();
    assert.ok(condition(), 'Bounded legal predecessor did not reach its existing capability');
  };
  const act = (action: GameAction): void => {
    assert.ok(legalActions(state, 0, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify(action));
    commit({ kind: 'action', command: { seat: 0, expectedRevision: state.revision, timestamp: time(), action } });
  };
  commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-manufacturing-1', timestamp: time() } });
  for (const technology of ['kiln-firing', 'fuel-management', 'currency', 'mathematics', 'education']) {
    if (state.civilizations[0]?.technologies.includes(technology)) continue;
    act({ type: 'research', technology });
    until(() => !!state.civilizations[0]?.technologies.includes(technology));
  }
  for (const project of ['academy', 'fuel-yard', 'irrigation', 'kiln']) {
    act({ type: 'build', project, cityId });
    until(() => !!state.cities.find(city => city.id === cityId)?.buildings.includes(project));
  }
  until(() => state.cities.find(city => city.id === cityId)?.population === 20);
  const institutionReady = structuredClone(state);
  act({ type: 'build', project: 'university', cityId });
  until(() => !!state.cities.find(city => city.id === cityId)?.buildings.includes('university'));
  const universityCompleted = structuredClone(state);
  beat();
  const blockedBeat = steps.at(-1); assert.ok(blockedBeat?.input.kind === 'strategy');
  return structuredClone({ initial: prefix.initial, state, steps, timestamp: time(), cityId, institutionReady, universityCompleted, blockedBeat });
}
