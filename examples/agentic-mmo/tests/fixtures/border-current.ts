import assert from 'node:assert/strict';
import type { BorderAction, BorderIncident } from '../../core/border-types.ts';
import { applyCommand, catchUpStrategy, createWorld } from '../../core/engine.ts';
import { availableBorderActions } from '../../core/simulation/border-incidents.ts';
import { hexDistance } from '../../core/simulation/geography.ts';
import { createCoalDeposits, createStrategicDeposits } from '../../core/simulation/metals.ts';
import { createPastoralSites } from '../../core/simulation/pastoral.ts';
import { turnAdmission } from '../../core/simulation/turns.ts';
import type { GameAction, GameEvent, WorldState } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import { syntheticTechnologies } from './coastal-prefix.ts';

export const INITIATOR = 0;
export const DEFENDER = 1;
export const BORDER_TEST_RULES = 'settlement-supplied-borders-1';
export const BORDER_EPOCH = '2026-10-23T00:00:00.000Z';

export function borderTimestamp(state: WorldState, actorId: number): string {
  const timestamp = turnAdmission(state, actorId).nextActionAt;
  assert.ok(timestamp);
  return timestamp;
}

export function borderEngineAction(state: WorldState, actorId: number, action: GameAction): GameEvent[] {
  const before = structuredClone(state);
  const result = applyCommand(state, { seat: actorId, expectedRevision: state.revision, timestamp: borderTimestamp(state, actorId), action });
  assert.ok(result.ok, result.error);
  assert.deepEqual(state, before, 'Engine admission must not mutate its input');
  assert.ok(isWorldState(result.state), `Actual ${action.type} frame ${result.state.revision} must validate`);
  Object.assign(state, result.state);
  return result.events;
}

export function borderAction(state: WorldState, actorId: number, action: BorderAction): GameEvent[] {
  return borderEngineAction(state, actorId, action);
}

export function borderBeat(state: WorldState): GameEvent[] {
  const timestamp = turnAdmission(state, INITIATOR).nextStrategyAt;
  assert.ok(timestamp);
  const before = structuredClone(state);
  const result = catchUpStrategy(state, timestamp);
  assert.ok(result.ok, result.error);
  assert.deepEqual(state, before, 'Ordinary strategic catchup must not mutate its input');
  assert.equal(result.state.round, state.round + 1);
  assert.ok(isWorldState(result.state), `Actual ordinary beat ${result.state.round} must validate`);
  Object.assign(state, result.state);
  return result.events;
}

export function borderTargetTileId(state: WorldState): number {
  const target = state.tiles.find(tile => tile.q === 5 && tile.r === 3);
  assert.ok(target);
  return target.id;
}

export function syntheticBorderCorridor(): WorldState {
  const state = createWorld(1701, BORDER_EPOCH, BORDER_TEST_RULES);
  for (const tile of state.tiles) { tile.terrain = 'grassland'; tile.elevation = 20; tile.owner = null; tile.resource = null; }
  const positions = [[2, 3], [8, 3], [14, 3], [3, 12], [13, 12]];
  for (const city of state.cities) {
    const position = positions[city.civId]!;
    const center = state.tiles.find(tile => tile.q === position[0] && tile.r === position[1]);
    assert.ok(center);
    city.tileId = center.id;
    center.resource = 'food';
    for (const tile of state.tiles) if (hexDistance(tile, center) <= 1) tile.owner = city.civId;
    city.population = 6;
    city.infrastructure = 10;
    city.wellbeing = 35;
    city.focus = 'industry';
    const civ = state.civilizations[city.civId]!;
    civ.era = 1;
    civ.resources = { food: 500, materials: 500, energy: 500, credits: 500, science: 0, culture: 500 };
    syntheticTechnologies(state, civ.id, ['civic-institutions', 'mining']);
  }
  state.tiles.find(tile => tile.q === 4 && tile.r === 3)!.owner = INITIATOR;
  state.tiles.find(tile => tile.q === 6 && tile.r === 3)!.owner = DEFENDER;
  state.tiles.find(tile => tile.id === borderTargetTileId(state))!.elevation = 70;
  state.strategicDeposits = createStrategicDeposits(state);
  state.pastoralSites = createPastoralSites(state);
  state.coalDeposits = createCoalDeposits(state);
  assert.ok(isWorldState(state), 'Explicit synthetic geography, technology, stocks and housing prerequisites must form a valid fresh current world');
  borderEngineAction(state, DEFENDER, { type: 'acquire-tile', cityId: 'city-1', tileId: borderTargetTileId(state) });
  return state;
}

export function dispatchBorder(state: WorldState, people: 2 | 3 = 2): BorderIncident {
  const option = availableBorderActions(state, INITIATOR).find(option => option.action.type === 'dispatch-border' && option.action.people === people && option.action.tileId === borderTargetTileId(state));
  assert.ok(option && option.action.type === 'dispatch-border', 'Synthetic prerequisites must expose a real quoted dispatch');
  borderAction(state, INITIATOR, option.action);
  const incident = state.border?.active.find(incident => incident.initiatorId === INITIATOR);
  assert.ok(incident);
  return incident;
}
