import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { legalActions } from '../../core/engine.ts';
import type { GameAction } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import { localGrowthPrefix } from './local-growth-prefix.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';

export function localGrowthJourney() {
  const previous = localGrowthPrefix();
  let state = structuredClone(previous.state);
  const steps: CoastalPrefixStep[] = [...previous.steps];
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state);
    const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before);
    assert.ok(isWorldState(result.state), `Canonical local-growth frame ${result.state.revision}`);
    steps.push({ input, before, result }); state = result.state;
  };
  const act = (action: GameAction, seat = 0): void => {
    assert.ok(legalActions(state, seat, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify({ seat, action }));
    commit({ kind: 'action', command: { seat, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean): void => { for (let count = 0; count < 80 && !condition(); count++) beat(); assert.ok(condition(), 'Bounded legal local-growth outcome was not reached'); };
  const prepared = structuredClone(state);
  return { previous, initial: previous.initial, cityId: previous.cityId, steps, prepared, provenance: previous.provenance, get state() { return state; }, time, act, beat, until };
}

export function localGrowthOperationJourney() {
  const journey = localGrowthJourney();
  if (!journey.state.civilizations[0]?.technologies.includes('mining')) {
    journey.act({ type: 'research', technology: 'mining' });
    journey.until(() => !!journey.state.civilizations[0]?.technologies.includes('mining'));
  }
  journey.act({ type: 'research', technology: 'masonry' });
  journey.until(() => !!journey.state.civilizations[0]?.technologies.includes('masonry'));
  const masonryReady = structuredClone(journey.state);
  journey.act({ type: 'build', project: 'granary', cityId: journey.cityId });
  const started = structuredClone(journey.state);
  journey.until(() => !!journey.state.cities.find(city => city.id === journey.cityId)?.buildings.includes('granary'));
  const completed = structuredClone(journey.state);
  const completionStep = journey.steps.at(-1); assert.ok(completionStep);
  journey.beat(); const growth = structuredClone(journey.state);
  const growthStep = journey.steps.at(-1); assert.ok(growthStep);
  journey.beat(); const operated = structuredClone(journey.state);
  const operationStep = journey.steps.at(-1); assert.ok(operationStep);
  return { journey, masonryReady, started, completed, completionStep, growth, growthStep, operated, operationStep };
}

export function localGrowthFoundingJourney(kind: 'settle' | 'settle-coast') {
  const journey = localGrowthJourney();
  if (kind === 'settle-coast') {
    journey.act({ type: 'research', technology: 'navigation' });
    journey.until(() => !!journey.state.civilizations[0]?.technologies.includes('navigation'));
    journey.act({ type: 'settle', sourceCityId: 'city-0', tileId: 23 });
    const departure = journey.state.cities.find(city => city.tileId === 23 && city.civId === 0); assert.ok(departure);
    journey.until(() => (journey.state.cities.find(city => city.id === departure.id)?.population ?? 0) >= 6);
    journey.act({ type: 'build', project: 'boat-yard', cityId: departure.id });
    journey.until(() => !!journey.state.cities.find(city => city.id === departure.id)?.buildings.includes('boat-yard'));
  }
  const option = legalActions(journey.state, 0, journey.time()).find(candidate => candidate.action.type === kind);
  assert.ok(option && (option.action.type === 'settle' || option.action.type === 'settle-coast'));
  const prepared = structuredClone(journey.state);
  journey.act(option.action);
  const founded = structuredClone(journey.state);
  const step = journey.steps.at(-1); assert.ok(step);
  return { journey, prepared, founded, step, action: option.action };
}
