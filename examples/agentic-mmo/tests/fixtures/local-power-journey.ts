import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { legalActions } from '../../core/engine.ts';
import type { GameAction, WorldState } from '../../core/types.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';
import { industrialSteamJourney } from './industrial-steam-journey.ts';

let industrial: ReturnType<typeof industrialSteamJourney> | undefined;

export function localPowerJourney() {
  industrial ??= industrialSteamJourney();
  const initial = industrial.initial; const steps: CoastalPrefixStep[] = [...industrial.steps]; const seat = industrial.seat;
  let state = structuredClone(industrial.state);
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state); const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before);
    steps.push({ before, input, result }); state = result.state;
  };
  const act = (action: GameAction, actor = seat): void => {
    if (Date.parse(time()) >= Date.parse(coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60))) beat();
    assert.ok(legalActions(state, actor, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify({ actor, action }));
    commit({ kind: 'action', command: { seat: actor, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean, label: string, limit = 160): void => { for (let count = 0; count < limit && !condition(); count++) beat(); assert.ok(condition(), label); };
  const beforeRelease = structuredClone(state);
  commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-local-power-1', timestamp: time() } });
  const adopted = structuredClone(state);
  const selected = state.cities.filter(city => city.civId === seat && city.buildings.includes('industrial-zone')).toSorted((left, right) => right.population - left.population || left.id.localeCompare(right.id))[0];
  assert.ok(selected); const cityId = selected.id;
  for (const buildingId of Object.keys(selected.buildingOperations ?? {}).toSorted()) {
    if (state.cities.find(city => city.id === cityId)?.buildingOperations?.[buildingId]?.enabled)
      act({ type: 'set-building-operation', cityId, buildingId, enabled: false });
  }
  const beforePlant = structuredClone(state);
  act({ type: 'build', cityId, project: 'coal-plant' });
  const plantStarted = structuredClone(state);
  until(() => !!state.cities.find(city => city.id === cityId)?.buildings.includes('coal-plant'), 'The paid Coal plant completes through real work');
  const plantCompleted = structuredClone(state);
  act({ type: 'build', cityId, project: 'factory' });
  const factoryStarted = structuredClone(state);
  until(() => !!state.cities.find(city => city.id === cityId)?.buildings.includes('factory'), 'The paid Factory completes through real work');
  const factoryCompleted = structuredClone(state);
  until(() => !!state.cities.find(city => city.id === cityId)?.localPower?.lastProductiveBeat, 'Actual opening Coal and residents fund the same-town positive Factory consumer');
  const productive = structuredClone(state);
  act({ type: 'set-building-operation', cityId, buildingId: 'factory', enabled: false });
  const paused = structuredClone(state);
  beat(); const unused = structuredClone(state);
  return { initial, steps, seat, cityId, beforeRelease, adopted, beforePlant, plantStarted, plantCompleted, factoryStarted, factoryCompleted, productive, paused, unused, get state(): WorldState { return state; }, time, act, beat, until, commit };
}
