import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { applyCommand, applyRelease, catchUpStrategy, createWorld, legalActions } from '../../core/engine.ts';
import type { Command, GameAction, ReleaseApplyCommand, TransitionResult, WorldState } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';

export type CoastalPrefixInput = { kind: 'action'; command: Command } | { kind: 'release'; command: ReleaseApplyCommand } | { kind: 'strategy'; timestamp: string };
export interface CoastalPrefixStep { input: CoastalPrefixInput; before: WorldState; result: TransitionResult }
export interface CoastalPrefix { initial: WorldState; state: WorldState; steps: CoastalPrefixStep[]; departureCityId: string; timestamp: string }
export const COASTAL_PREFIX_EPOCH = '2026-10-16T00:00:00.000Z';
export function coastalPrefixTime(seconds: number): string { return new Date(Date.parse(COASTAL_PREFIX_EPOCH) + seconds * 1000).toISOString(); }

export function replayCoastalStep(state: WorldState, input: CoastalPrefixInput): TransitionResult {
  if (input.kind === 'action') return applyCommand(state, input.command);
  if (input.kind === 'release') return applyRelease(state, input.command);
  return catchUpStrategy(state, input.timestamp);
}

export function coastalDeparturePrefix(): CoastalPrefix {
  const initial = createWorld(1701, COASTAL_PREFIX_EPOCH);
  let state = initial;
  let seconds = 0;
  const steps: CoastalPrefixStep[] = [];
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state);
    const result = replayCoastalStep(state, input);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(state, before);
    assert.ok(isWorldState(result.state));
    steps.push({ input, before, result });
    state = result.state;
  };
  const perform = (action: GameAction): void => {
    assert.ok(legalActions(state, 0, coastalPrefixTime(seconds)).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify(action));
    commit({ kind: 'action', command: { seat: 0, expectedRevision: state.revision, timestamp: coastalPrefixTime(seconds), action } });
    seconds += 10;
  };
  const beat = (): void => {
    assert.ok(state.independentTurns);
    seconds = (state.independentTurns.strategyTicks + 1) * 60;
    commit({ kind: 'strategy', timestamp: coastalPrefixTime(seconds) });
    seconds += 10;
  };
  for (const targetReleaseId of ['settlement-foundations-2', 'settlement-independent-1', 'settlement-production-1', 'settlement-frontiers-1', 'settlement-specialization-1', 'settlement-recovery-1', 'settlement-civics-1', 'settlement-charters-1', 'settlement-endpoints-1', 'settlement-land-transport-1', 'settlement-operating-exchange-1', 'settlement-decisions-1']) {
    commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: coastalPrefixTime(seconds) } });
  }
  perform({ type: 'focus', cityId: 'city-0', focus: 'growth' });
  perform({ type: 'settle', sourceCityId: 'city-0', tileId: 23 });
  const departure = state.cities.find(city => city.tileId === 23 && city.civId === 0);
  assert.ok(departure);
  for (const technology of ['agriculture', 'water-management']) {
    perform({ type: 'research', technology });
    for (let count = 0; count < 32; count += 1) {
      if (state.civilizations[0]?.technologies.includes(technology)) break;
      beat();
    }
    assert.ok(state.civilizations[0]?.technologies.includes(technology));
  }
  for (let count = 0; count < 32 && (state.cities.find(city => city.id === departure.id)?.population ?? 0) < 6; count += 1) beat();
  assert.ok((state.cities.find(city => city.id === departure.id)?.population ?? 0) >= 6);
  return structuredClone({ initial, state, steps, departureCityId: departure.id, timestamp: coastalPrefixTime(seconds) });
}
