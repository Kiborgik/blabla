import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { legalActions } from '../../core/engine.ts';
import type { GameAction } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import { mapExpansionPrefix } from './map-expansion-journey.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';

export function ownedTerritoryPrefix() {
  const previous = mapExpansionPrefix(); let state = structuredClone(previous.state);
  const beforeResearch = structuredClone(state); const seat = 2;
  const city = state.cities.find(town => town.civId === seat && town.tileId === 199); assert.ok(city); const cityId = city.id;
  const steps: CoastalPrefixStep[] = [...previous.steps];
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(owner => ((state.independentTurns?.lastActionWindow[owner.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state); const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state));
    steps.push({ before, input, result }); state = result.state;
  };
  const act = (action: GameAction): void => {
    assert.ok(legalActions(state, seat, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify(action));
    commit({ kind: 'action', command: { seat, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean): void => { for (let count = 0; count < 100 && !condition(); count++) beat(); assert.ok(condition(), 'Bounded real territory predecessor was not reached'); };
  for (const technology of ['agriculture', 'animal-husbandry']) {
    if (state.civilizations[seat]?.technologies.includes(technology)) continue;
    act({ type: 'research', technology }); until(() => state.civilizations[seat]?.technologies.includes(technology) === true);
  }
  until(() => (state.cities.find(town => town.id === cityId)?.population ?? 0) > 3);
  return { initial: previous.initial, state, steps, beforeResearch, timestamp: time(), seat, cityId, pathTileIds: [199, 181, 164] };
}
