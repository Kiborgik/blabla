import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { atomicWrite, type GameStore, type LocalCampaign } from '../../cli/store.ts';
import { BUILDINGS } from '../../core/content.ts';
import { createWorld } from '../../core/engine.ts';
import { GAME_VERSION, SCHEMA_VERSION, type WorldState } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import { COASTAL_PREFIX_EPOCH, syntheticInstitution, syntheticTechnologies } from './coastal-prefix.ts';

export function syntheticCurrentWorld(registeredRulesId: string, prerequisites: { technologies?: readonly string[]; buildings?: readonly string[]; population?: number } = {}): WorldState {
  const state = createWorld(1701, COASTAL_PREFIX_EPOCH, registeredRulesId);
  const city = state.cities[0];
  assert.ok(city);
  syntheticTechnologies(state, 0, prerequisites.technologies ?? []);
  for (const id of prerequisites.buildings ?? []) {
    const building = BUILDINGS.find(candidate => candidate.id === id);
    assert.ok(building, `Unknown synthetic prerequisite building ${id}`);
    syntheticTechnologies(state, 0, building.requires);
    syntheticInstitution(state, city.id, id);
  }
  if (prerequisites.population !== undefined) city.population = prerequisites.population;
  assert.ok(isWorldState(state), 'Synthetic prerequisites must form a valid fresh world');
  return state;
}

export function seedLocalWorld(store: GameStore, state: WorldState): void {
  assert.equal(existsSync(store.path), false, 'Fresh test seeding requires an unused local store');
  assert.ok(isWorldState(state), 'Fresh test seeding requires a valid world');
  assert.equal(state.revision, 0, 'Fresh test seeding cannot import accepted transitions');
  assert.equal(state.round, 0);
  assert.equal(state.clockTicks, 0);
  assert.equal(state.events.some(event => event.type === 'release-applied'), false);
  atomicWrite(store.path, {
    schemaVersion: SCHEMA_VERSION,
    gameVersion: GAME_VERSION,
    initial: structuredClone(state),
    state: structuredClone(state),
    commands: [],
    frames: [],
    provenance: [],
    timeline: [],
    lastValid: true,
  } satisfies LocalCampaign);
}

export function seedHostedWorld(database: Pick<DatabaseSync, 'prepare'>, state: WorldState): void {
  assert.ok(isWorldState(state), 'Fresh test seeding requires a valid world');
  assert.equal(state.revision, 0, 'Fresh test seeding cannot import accepted transitions');
  assert.equal(state.round, 0);
  assert.equal(state.clockTicks, 0);
  assert.equal(state.events.some(event => event.type === 'release-applied'), false);
  const initial = JSON.stringify(state);
  database.prepare('INSERT INTO world_state (world_id, revision, initial_json, state_json, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('main', 0, initial, initial, state.clockEpoch);
}
