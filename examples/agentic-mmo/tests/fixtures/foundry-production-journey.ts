import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { legalActions } from '../../core/engine.ts';
import type { GameAction } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';
import { foundryPrefix } from './foundry-prefix.ts';
import { waterLandTown } from './water-land-journey.ts';

export function foundryProductionJourney() {
  const previous = foundryPrefix(); let state = structuredClone(previous.state);
  const steps: CoastalPrefixStep[] = [...previous.steps]; const seat = previous.seat; const cityId = previous.cityId;
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state); const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state), `Canonical Foundry frame ${result.state.revision}`);
    steps.push({ before, input, result }); state = result.state;
  };
  const act = (action: GameAction, actor = seat): void => {
    assert.ok(legalActions(state, actor, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify({ actor, action }));
    commit({ kind: 'action', command: { seat: actor, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean): void => { for (let count = 0; count < 160 && !condition(); count++) beat(); assert.ok(condition(), 'Bounded actual Foundry outcome was not reached'); };
  const research = (technology: string): void => { if (state.civilizations[seat]?.technologies.includes(technology)) return; act({ type: 'research', technology }); until(() => !!state.civilizations[seat]?.technologies.includes(technology)); };
  const prepared = structuredClone(state);
  return { previous, initial: previous.initial, steps, seat, cityId, prepared, provenance: previous.provenance, get state() { return state; }, time, act, beat, until, research };
}

export function foundryProductionOperationJourney() {
  const journey = foundryProductionJourney();
  for (const technology of ['military-engineering', 'gunpowder', 'metal-casting']) journey.research(technology);
  const researched = structuredClone(journey.state);
  journey.act({ type: 'build', project: 'foundry', cityId: journey.cityId }); const started = structuredClone(journey.state);
  journey.until(() => waterLandTown(journey.state, journey.cityId).buildings.includes('foundry'));
  const completed = structuredClone(journey.state); const completionStep = journey.steps.at(-1); assert.ok(completionStep);
  journey.beat(); const operated = structuredClone(journey.state); const operationStep = journey.steps.at(-1); assert.ok(operationStep);
  return { journey, researched, started, completed, completionStep, operated, operationStep };
}
