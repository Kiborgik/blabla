import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { IMPROVEMENTS, WONDERS, INDUSTRIAL_RULES } from '../../core/content.ts';
import { legalActions } from '../../core/engine.ts';
import { constructionWork, requiredConstructionWork } from '../../core/simulation/construction.ts';
import type { GameAction, WorldState } from '../../core/types.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';
import { localPowerJourney } from './local-power-journey.ts';

let previous: ReturnType<typeof localPowerJourney> | undefined;

export function secondGovernmentJourney() {
  previous ??= localPowerJourney();
  const initial = previous.initial; const steps: CoastalPrefixStep[] = [...previous.steps]; const seat = previous.seat; const cityId = `city-${seat}`;
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
  const until = (condition: () => boolean, label: string, limit = 120): void => { for (let count = 0; count < limit && !condition(); count++) beat(); assert.ok(condition(), label); };
  const beforeRelease = structuredClone(state);
  commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-second-government-1', timestamp: time() } });
  const adopted = structuredClone(state);
  const civicFrames: Array<{ civicId: string; before: WorldState; selected: WorldState; completed: WorldState }> = [];
  for (const civicId of ['craftsmanship', 'foreign-trade', 'early-empire', 'state-workforce', 'political-philosophy']) {
    const before = structuredClone(state); act({ type: 'choose-civic', civicId }); const selected = structuredClone(state);
    until(() => !!state.civilizations.find(actor => actor.id === seat)?.civics?.completedCivicIds.includes(civicId), `Actual productive Culture completes ${civicId}`);
    civicFrames.push({ civicId, before, selected, completed: structuredClone(state) });
  }
  const completed = structuredClone(state);
  act({ type: 'adopt-government', governmentId: 'autocracy', assignments: [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }] });
  const accepted = structuredClone(state);
  beat(); const firstTransitionBeat = structuredClone(state);
  beat(); const transitionCompleted = structuredClone(state);
  assert.equal(state.civilizations.find(actor => actor.id === seat)?.government?.active?.governmentId, 'autocracy');
  const requiredWork = (action: GameAction): number => action.type === 'build' ? requiredConstructionWork(action.project) : action.type === 'improve' ? IMPROVEMENTS.find(item => item.id === action.improvementId)?.requiredWork ?? 0 : action.type === 'build-wonder' ? WONDERS.find(item => item.id === action.wonderId)?.requiredWork ?? 0 : action.type === 'build-rail' ? INDUSTRIAL_RULES.railWork : 0;
  const capitalChoice = (): GameAction | undefined => {
    const city = state.cities.find(town => town.id === cityId && town.civId === seat); assert.ok(city);
    return legalActions(state, seat, time()).find(option => 'cityId' in option.action && option.action.cityId === cityId && requiredWork(option.action) > constructionWork(state, city))?.action;
  };
  for (let count = 0; count < 12 && !capitalChoice(); count++) {
    const purchase = legalActions(state, seat, time()).find(option => option.action.type === 'acquire-tile' && option.action.cityId === cityId);
    assert.ok(purchase, 'A real offered capital project or owned-site purchase must be available'); act(purchase.action);
  }
  const action = capitalChoice(); assert.ok(action, 'A paid capital commitment must retain at least one uncapped work beat');
  const beforeConstruction = structuredClone(state); act(action); const constructionStarted = structuredClone(state);
  const order = constructionStarted.cities.find(city => city.id === cityId)?.construction?.active; assert.ok(order);
  beat(); const firstWorkBeat = structuredClone(state);
  assert.equal(firstWorkBeat.cities.find(city => city.id === cityId)?.construction?.active?.workDone, constructionWork(constructionStarted, must(constructionStarted.cities.find(city => city.id === cityId))));
  until(() => state.cities.find(city => city.id === cityId)?.construction?.lastCompleted?.orderId === order.id, 'The actual paid capital project completes under Autocracy');
  const built = structuredClone(state);
  until(() => state.round >= must(state.civilizations.find(actor => actor.id === seat)?.government?.active).policyLockUntilRound, 'The original policy commitment expires');
  const beforeReslot = structuredClone(state);
  act({ type: 'adopt-government', governmentId: 'autocracy', assignments: [{ slotType: 'wildcard', slotIndex: 0, policyId: 'urban-planning' }] });
  const reslotted = structuredClone(state);
  until(() => state.round >= must(state.civilizations.find(actor => actor.id === seat)?.government?.active).policyLockUntilRound, 'The paid reslot commitment expires');
  const beforeReturn = structuredClone(state);
  act({ type: 'adopt-government', governmentId: 'chiefdom', assignments: [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }] });
  const returnAccepted = structuredClone(state);
  beat(); const returnFirstBeat = structuredClone(state);
  beat(); const returned = structuredClone(state);
  return { initial, steps, seat, cityId, beforeRelease, adopted, civicFrames, completed, accepted, firstTransitionBeat, transitionCompleted, beforeConstruction, constructionStarted, firstWorkBeat, built, beforeReslot, reslotted, beforeReturn, returnAccepted, returnFirstBeat, returned, get state(): WorldState { return state; }, time, act, beat, until, commit };
}

function must<T>(value: T | null | undefined): T { if (value === null || value === undefined) throw new RangeError('Required government journey fact is missing'); return value; }
