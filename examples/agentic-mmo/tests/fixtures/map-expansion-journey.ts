import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { legalActions } from '../../core/engine.ts';
import { RELEASES } from '../../core/release.ts';
import { createMap } from '../../core/simulation/geography.ts';
import type { GameAction, WorldState } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';
import { waterLandOperationJourney } from './water-land-journey.ts';

export function appendMapCandidate(state: WorldState): WorldState {
  assert.equal(state.width, 18); assert.equal(state.height, 12); assert.equal(state.tiles.length, 216);
  const result = structuredClone(state);
  result.tiles.push(...createMap(state.seed, 18, 24).tiles.slice(216)); result.height = 24;
  return result;
}

export function mapExpansionPrefix() {
  const previous = waterLandOperationJourney();
  previous.journey.act({ type: 'settle', tileId: 199, sourceCityId: 'city-2' }, 2);
  return { initial: previous.journey.initial, state: previous.journey.state, steps: previous.journey.steps, timestamp: previous.journey.time(), seat: 2, sourceCityId: 'city-2', frontierTileId: 199, targetTileId: 218 };
}

export function mapExpansionJourney() {
  const previous = mapExpansionPrefix(); let state = structuredClone(previous.state);
  const steps: CoastalPrefixStep[] = [...previous.steps];
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state); const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state));
    steps.push({ before, input, result }); state = result.state;
  };
  let beforeExpansion: WorldState | undefined;
  for (const targetReleaseId of ['settlement-forest-production-1', 'settlement-world-expansion-1']) {
    assert.ok(RELEASES.some(release => release.id === targetReleaseId && release.compatibleFrom.includes(state.releaseId)), `Actual compatible release ${targetReleaseId} is required`);
    if (targetReleaseId === 'settlement-world-expansion-1') beforeExpansion = structuredClone(state);
    commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: time() } });
  }
  assert.ok(beforeExpansion);
  const adopted = structuredClone(state);
  const action: GameAction = { type: 'settle', sourceCityId: previous.sourceCityId, tileId: previous.targetTileId };
  assert.ok(legalActions(state, previous.seat, time()).some(option => isDeepStrictEqual(option.action, action)));
  commit({ kind: 'action', command: { seat: previous.seat, expectedRevision: state.revision, timestamp: time(), action } });
  const founded = structuredClone(state);
  commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const operationStep = steps.at(-1); assert.ok(operationStep);
  return { previous, initial: previous.initial, steps, beforeExpansion, adopted, founded, operated: state, operationStep, state, timestamp: time() };
}
