import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, createWorld, legalActions } from '../core/engine.ts';
import { RELEASES } from '../core/release.ts';
import { ECONOMY_RULES, RESOURCE_IDS } from '../core/content.ts';
import { createLandTransportPlanner, landTransportBlock } from '../core/simulation/transport.ts';
import type { Resources } from '../core/types.ts';
import { siteProduction } from '../core/simulation/sites.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import { isWorldState } from '../core/validation.ts';
import { mapExpansionJourney, mapExpansionPrefix } from './fixtures/map-expansion-journey.ts';
import { coastalPrefixTime, replayCoastalStep } from './fixtures/coastal-prefix.ts';

const prefix = mapExpansionPrefix();

await test('fresh extent rules construct the complete playable map before any commands', () => {
  const state = createWorld(1701, coastalPrefixTime(0), 'settlement-world-expansion-1');
  const rule = RELEASES.find(candidate => candidate.id === state.releaseId); assert.ok(rule);
  assert.ok(rule.featureIds.includes('world-expansion'));
  assert.equal(state.height, 24); assert.equal(state.tiles.length, 432); assert.equal(state.revision, 0);
  assert.ok(state.tiles.slice(216).every((tile, index) => tile.id === 216 + index && tile.id === tile.r * 18 + tile.q && tile.r >= 12 && tile.owner === null));
  assert.ok(!state.events.some(event => event.type === 'release-applied' || event.type === 'world-expanded'));
  assert.deepEqual(createWorld(1701, coastalPrefixTime(0), rule.id), state);
  assert.ok(isWorldState(state));
});

await test('fresh expanded geography supplies a connected buildable southern frontier', () => {
  const state = prefix.state; const added = state.tiles.slice(216);
  assert.ok(added.filter(tile => !['ocean', 'mountain'].includes(tile.terrain)).length > 100);
  const planner = createLandTransportPlanner(state);
  const reachable = added.filter(tile => planner.quote(199, tile.id));
  assert.ok(reachable.length > 100); assert.ok(reachable.some(tile => tile.r === 22));
  const quote = planner.quote(199, 218); assert.ok(quote); assert.equal(landTransportBlock(state, quote, 199, 218), null);
  assert.ok(legalActions(state, 2, prefix.timestamp).some(option => option.action.type === 'settle' && option.action.tileId === 218));
});

await test('fresh expanded-map missing source, stale revision and occupied destination refuse atomically', () => {
  const state = prefix.state;
  const commands = [
    { seat: 2, expectedRevision: state.revision - 1, timestamp: prefix.timestamp, action: { type: 'settle' as const, sourceCityId: 'city-2', tileId: 218 } },
    { seat: 2, expectedRevision: state.revision, timestamp: prefix.timestamp, action: { type: 'settle' as const, sourceCityId: 'missing', tileId: 218 } },
    { seat: 2, expectedRevision: state.revision, timestamp: prefix.timestamp, action: { type: 'settle' as const, sourceCityId: 'city-2', tileId: 199 } },
  ];
  for (const command of commands) {
    const before = structuredClone(state); const result = applyCommand(state, command);
    assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(result.events, []); assert.deepEqual(state, before);
  }
});

await test('fresh map frontier founding replays exactly from its explicit synthetic root', () => {
  let state = structuredClone(prefix.initial);
  for (const step of prefix.steps) { const result = replayCoastalStep(state, step.input); assert.ok(result.ok, result.error); assert.deepEqual(result, step.result); state = result.state; }
  assert.deepEqual(state, prefix.state);
});

await test('fresh expanded-map paid new-town history replays without geometry mutation', () => {
  const value = mapExpansionJourney(); let state = structuredClone(value.initial);
  for (const step of value.steps) { const result = replayCoastalStep(state, step.input); assert.ok(result.ok, result.error); assert.deepEqual(result, step.result); state = result.state; }
  assert.deepEqual(state, value.state);
});

await test('map extent real new town owns only its center and produces later base materials', context => {
  const value = mapExpansionJourney(); const town = value.founded.cities.find(city => city.tileId === 218); assert.ok(town);
  assert.deepEqual(value.founded.tiles.slice(216).filter(tile => tile.owner !== null).map(tile => tile.id), [218]);
  assert.equal(value.founded.cities.reduce((total, city) => total + city.population, 0), value.prepared.cities.reduce((total, city) => total + city.population, 0));
  const cost: Partial<Resources> = ECONOMY_RULES.settle.cost;
  for (const resource of RESOURCE_IDS) assert.equal(value.founded.civilizations[2]?.resources[resource], (value.prepared.civilizations[2]?.resources[resource] ?? 0) - (cost[resource] ?? 0));
  const withoutTown = structuredClone(value.founded); withoutTown.cities = withoutTown.cities.filter(city => city.id !== town.id);
  const control = replayCoastalStep(withoutTown, value.operationStep.input); assert.ok(control.ok, control.error);
  const tile = value.founded.tiles[218]; assert.ok(tile);
  const focus: Partial<Resources> = ECONOMY_RULES.focusProduction[town.focus];
  const raw = (ECONOMY_RULES.baseProduction.materials ?? 0) + (focus.materials ?? 0) + (siteProduction(value.founded, tile).materials ?? 0);
  const expected = Math.round(raw * cityProductivity(town) * 100) / 100;
  const actual = Math.round(((value.operated.civilizations[2]?.resources.materials ?? 0) - (control.state.civilizations[2]?.resources.materials ?? 0)) * 100) / 100;
  assert.equal(actual, expected); assert.ok(actual > 0);
  assert.ok(!legalActions(value.operated, 2, value.timestamp).some(option => option.action.type === 'improve' && option.action.tileId >= 216));
  context.diagnostic(JSON.stringify({ transitions: value.steps.length, round: value.operated.round, newTown: town.id, laterMaterials: actual, syntheticTownRemovalControl: true }));
});
