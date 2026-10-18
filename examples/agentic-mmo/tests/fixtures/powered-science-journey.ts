import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { legalActions } from '../../core/engine.ts';
import type { GameAction, WorldState } from '../../core/types.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';
import { secondGovernmentJourney } from './second-government-journey.ts';

let previous: ReturnType<typeof secondGovernmentJourney> | undefined;

export function poweredScienceJourney() {
  previous ??= secondGovernmentJourney();
  const initial = previous.initial; const steps: CoastalPrefixStep[] = [...previous.steps]; const seat = previous.seat;
  let state = structuredClone(previous.state);
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state); const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before);
    steps.push({ before, input, result }); state = result.state;
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const act = (action: GameAction, actor = seat): void => {
    if (Date.parse(time()) >= Date.parse(coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60))) beat();
    assert.ok(legalActions(state, actor, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify({ actor, action }));
    commit({ kind: 'action', command: { seat: actor, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const until = (condition: () => boolean, label: string, limit = 160): void => { for (let count = 0; count < limit && !condition(); count++) beat(); assert.ok(condition(), label); };
  const beforeRelease = structuredClone(state);
  commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-powered-science-1', timestamp: time() } });
  const adopted = structuredClone(state);
  act({ type: 'research', technology: 'sanitation' }); const sanitationSelected = structuredClone(state);
  until(() => !!state.civilizations[seat]?.technologies.includes('sanitation'), 'Actual productive Science completes Sanitation');
  const sanitationCompleted = structuredClone(state);
  act({ type: 'research', technology: 'chemistry' }); const chemistrySelected = structuredClone(state);
  until(() => !!state.civilizations[seat]?.technologies.includes('chemistry'), 'Actual productive Science completes Chemistry');
  const chemistryCompleted = structuredClone(state);
  const selected = state.cities.find(city => city.civId === seat && city.buildings.includes('coal-plant') && city.buildings.includes('factory') && city.buildings.includes('campus'));
  assert.ok(selected, 'The earned prefix must retain a real Campus town with its paid plant and Factory'); const cityId = selected.id;
  if (!selected.buildingOperations?.factory?.enabled) act({ type: 'set-building-operation', cityId, buildingId: 'factory', enabled: true });
  const beforeLab = structuredClone(state);
  act({ type: 'build', cityId, project: 'research-lab' }); const labStarted = structuredClone(state);
  until(() => !!state.cities.find(city => city.id === cityId)?.buildings.includes('research-lab'), 'Real paid Laboratory work completes');
  const labCompleted = structuredClone(state);
  assert.ok(!state.civilizations[seat]?.technologies.includes('banking'), 'Keep the genuinely uncompleted Banking target from the unchanged prefix');
  act({ type: 'research', technology: 'banking' }); const researchSelected = structuredClone(state);
  until(() => (state.cities.find(city => city.id === cityId)?.buildingOperations?.['research-lab']?.lastResult?.produced.science ?? 0) > 0 && state.cities.find(city => city.id === cityId)?.buildingOperations?.factory?.lastResult?.status === 'operated', 'Earned opening fuel funds both Factory and positive Laboratory Science');
  const productive = structuredClone(state); const researchInvested = structuredClone(state);
  act({ type: 'set-building-operation', cityId, buildingId: 'research-lab', enabled: false });
  act({ type: 'set-building-operation', cityId, buildingId: 'factory', enabled: false });
  beat(); const nonproductive = structuredClone(state);
  until(() => !state.events.some(event => event.id === productive.cities.find(city => city.id === cityId)?.localPower?.lastProductiveBeat?.eventId), 'Natural pruning removes the Lab event while its positive snapshot remains', 12);
  const pruned = structuredClone(state);
  act({ type: 'set-building-operation', cityId, buildingId: 'factory', enabled: true });
  until(() => (state.cities.find(city => city.id === cityId)?.buildingOperations?.factory?.lastResult?.produced.materials ?? 0) > 0, 'A later genuine Factory-only productive beat replaces the town snapshot');
  const replacedByFactory = structuredClone(state);
  return { initial, steps, seat, cityId, beforeRelease, adopted, sanitationSelected, sanitationCompleted, chemistrySelected, chemistryCompleted, beforeLab, labStarted, labCompleted, productive, researchSelected, researchInvested, nonproductive, pruned, replacedByFactory, get state(): WorldState { return state; }, time, act, beat, until, commit };
}
