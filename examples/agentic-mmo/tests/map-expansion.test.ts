import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, applyRelease, legalActions } from '../core/engine.ts';
import { RELEASES } from '../core/release.ts';
import { ECONOMY_RULES, RESOURCE_IDS } from '../core/content.ts';
import { createLandTransportPlanner, landTransportBlock } from '../core/simulation/transport.ts';
import type { Resources } from '../core/types.ts';
import { siteProduction } from '../core/simulation/sites.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import { isWorldState } from '../core/validation.ts';
import { appendMapCandidate, mapExpansionJourney, mapExpansionPrefix } from './fixtures/map-expansion-journey.ts';
import { coastalPrefixTime, replayCoastalStep } from './fixtures/coastal-prefix.ts';

const prefix = mapExpansionPrefix();

await test('map extent legal263 predecessor reaches preserved south frontier without new geography', () => {
  assert.equal(prefix.steps.length, 263); assert.equal(prefix.state.height, 12);
  assert.ok(prefix.state.cities.some(city => city.tileId === 199 && city.civId === 2));
  assert.equal(prefix.state.tiles[199]?.terrain, 'forest'); assert.ok(isWorldState(prefix.state));
  const result = applyCommand(prefix.state, { seat: 2, expectedRevision: prefix.state.revision, timestamp: prefix.timestamp, action: { type: 'settle', sourceCityId: 'city-2', tileId: 218 } });
  assert.equal(result.ok, false); assert.deepEqual(result.state, prefix.state);
});

await test('map extent labeled append candidate preserves every old tile and all nonextent fields', () => {
  const before = structuredClone(prefix.state); const candidate = appendMapCandidate(prefix.state);
  assert.deepEqual(prefix.state, before); assert.deepEqual(candidate.tiles.slice(0, 216), before.tiles);
  assert.equal(JSON.stringify(candidate.tiles.slice(0, 216)), JSON.stringify(before.tiles));
  const { tiles: oldTiles, height: oldHeight, ...oldFields } = before;
  const { tiles: newTiles, height: newHeight, ...newFields } = candidate;
  assert.equal(oldTiles.length, 216); assert.equal(newTiles.length, 432); assert.equal(oldHeight, 12); assert.equal(newHeight, 24);
  assert.deepEqual(newFields, oldFields); assert.ok(isWorldState(candidate));
  assert.deepEqual(appendMapCandidate(before), candidate);
  assert.ok(candidate.tiles.slice(216).every((tile, index) => tile.id === 216 + index && tile.id === tile.r * 18 + tile.q && tile.r >= 12 && tile.owner === null && tile.resource === null));
});

await test('map extent candidate supplies actual connected buildable frontier rather than ocean-only area', () => {
  const candidate = appendMapCandidate(prefix.state); const added = candidate.tiles.slice(216);
  assert.equal(added.filter(tile => !['ocean', 'mountain'].includes(tile.terrain)).length, 164);
  const planner = createLandTransportPlanner(candidate);
  const reachable = added.filter(tile => planner.quote(199, tile.id));
  assert.ok(reachable.length > 100); assert.ok(reachable.some(tile => tile.r === 22));
  const quote = planner.quote(199, 218); assert.ok(quote); assert.equal(landTransportBlock(candidate, quote, 199, 218), null);
  const options = legalActions(candidate, 2, prefix.timestamp).filter(option => option.action.type === 'settle' && option.action.tileId >= 216);
  assert.deepEqual(options.map(option => option.action.type === 'settle' ? option.action.tileId : null), [218, 234, 235]);
});

await test('map extent candidate-conditioned exact new-row founding pays and conserves residents', () => {
  const candidate = appendMapCandidate(prefix.state); const before = structuredClone(candidate);
  const result = applyCommand(candidate, { seat: 2, expectedRevision: candidate.revision, timestamp: prefix.timestamp, action: { type: 'settle', sourceCityId: 'city-2', tileId: 218 } });
  assert.ok(result.ok, result.error); assert.deepEqual(candidate, before); assert.ok(isWorldState(result.state));
  const founded = result.state.cities.find(city => city.tileId === 218); assert.ok(founded);
  assert.equal(founded.population, ECONOMY_RULES.settle.population); assert.equal(founded.housing?.baseCapacity, 8);
  assert.equal(result.state.cities.reduce((sum, city) => sum + city.population, 0), before.cities.reduce((sum, city) => sum + city.population, 0));
  const cost: Partial<Resources> = ECONOMY_RULES.settle.cost;
  for (const resource of RESOURCE_IDS) {
    assert.equal(result.state.civilizations[2]?.resources[resource], (before.civilizations[2]?.resources[resource] ?? 0) - (cost[resource] ?? 0));
  }
  assert.deepEqual(result.state.tiles.slice(0, 216), before.tiles.slice(0, 216));
});

await test('map extent legal predecessor replays exactly with no candidate insertion', () => {
  let state = structuredClone(prefix.initial);
  for (const step of prefix.steps) { const result = replayCoastalStep(state, step.input); assert.ok(result.ok, result.error); assert.deepEqual(result, step.result); state = result.state; }
  assert.deepEqual(state, prefix.state);
});

await test('map extent requires a registered compatible expansion capability rather than candidate-only geometry', () => {
  const release = RELEASES.find(candidate => candidate.id === 'settlement-world-expansion-1');
  assert.ok(release, 'Versioned playable extent successor is not implemented');
  assert.ok(release.compatibleFrom.includes('settlement-forest-production-1'));
  assert.ok(release.featureIds.includes('world-expansion'));
});

await test('map extent actual successor migration must expose playable appended rows', () => {
  const value = mapExpansionJourney(); assert.equal(value.adopted.height, 24); assert.equal(value.adopted.tiles.length, 432);
  assert.deepEqual(value.adopted.tiles.slice(0, 216), value.previous.state.tiles);
  assert.ok(value.founded.cities.some(city => city.tileId === 218)); assert.ok(isWorldState(value.operated));
});

await test('map extent actual successor and new-town history must replay without candidate injection', () => {
  const value = mapExpansionJourney(); let state = structuredClone(value.initial);
  for (const step of value.steps) { const result = replayCoastalStep(state, step.input); assert.ok(result.ok, result.error); assert.deepEqual(result, step.result); state = result.state; }
  assert.deepEqual(state, value.state);
});

await test('map extent real adoption preserves existing assets clocks and retained placement records', () => {
  const value = mapExpansionJourney(); const before = value.beforeExpansion; const after = value.adopted;
  for (const key of ['cities', 'civilizations', 'routes', 'treaties', 'tradeOffers', 'publicProjects', 'actionPlans', 'strategicDeposits', 'pastoralSites', 'wonders', 'rng', 'year', 'round', 'independentTurns', 'clockEpoch', 'clockTicks', 'calendarMilestones', 'historyAdvances', 'phase', 'climate', 'directorCooldown', 'directorIntervals'] as const) {
    assert.deepEqual(Reflect.get(after, key), Reflect.get(before, key), key);
  }
  assert.deepEqual(after.tiles, appendMapCandidate(before).tiles);
  assert.equal(after.revision, before.revision + 1);
});

await test('map extent overdue stale repeated and malformed-predecessor adoption refuse without effects', () => {
  const value = mapExpansionJourney(); const state = value.beforeExpansion;
  const command = { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: value.adopted.releaseId, timestamp: coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 30) };
  const malformed = structuredClone(state); malformed.height = 13;
  const cases = [
    [state, { ...command, timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) }],
    [state, { ...command, expectedRevision: state.revision - 1 }],
    [value.adopted, { ...command, expectedRevision: value.adopted.revision, expectedFromReleaseId: value.adopted.releaseId }],
    [malformed, command],
  ] as const;
  for (const [before, request] of cases) {
    const copy = structuredClone(before); const result = applyRelease(before, request);
    assert.equal(result.ok, false); assert.deepEqual(result.state, copy); assert.deepEqual(result.events, []); assert.deepEqual(before, copy);
  }
});

await test('map extent real new town owns only its center and produces later base materials', context => {
  const value = mapExpansionJourney(); const town = value.founded.cities.find(city => city.tileId === 218); assert.ok(town);
  assert.deepEqual(value.founded.tiles.slice(216).filter(tile => tile.owner !== null).map(tile => tile.id), [218]);
  assert.equal(value.founded.cities.reduce((total, city) => total + city.population, 0), value.adopted.cities.reduce((total, city) => total + city.population, 0));
  const cost: Partial<Resources> = ECONOMY_RULES.settle.cost;
  for (const resource of RESOURCE_IDS) assert.equal(value.founded.civilizations[2]?.resources[resource], (value.adopted.civilizations[2]?.resources[resource] ?? 0) - (cost[resource] ?? 0));
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
