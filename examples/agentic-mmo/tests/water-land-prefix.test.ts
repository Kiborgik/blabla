import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, legalActions } from '../core/engine.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { districtSiteOccupied } from '../core/simulation/districts.ts';
import { isWorldState } from '../core/validation.ts';
import type { GameAction } from '../core/types.ts';
import { replayCoastalStep } from './fixtures/coastal-prefix.ts';
import { waterLandPrefix } from './fixtures/water-land-prefix.ts';

await test('water land prefix has real owned free grassland and exact adjacent mountain geography without deposits', () => {
  const value = waterLandPrefix(); const { state, pasture, mill, aqueduct } = value;
  assert.ok(isWorldState(state)); assert.equal(state.revision, 217);
  const site = state.tiles.find(tile => tile.id === pasture.tileId); assert.ok(site);
  const city = state.cities.find(candidate => candidate.id === pasture.cityId); assert.ok(city);
  const center = state.tiles.find(tile => tile.id === city.tileId); assert.ok(center);
  assert.equal(site.id, 47); assert.equal(site.owner, pasture.seat); assert.equal(site.terrain, 'grassland');
  assert.ok(hexDistance(site, center) <= 3); assert.equal(districtSiteOccupied(state, site.id), false);
  assert.ok(!state.cities.some(candidate => candidate.tileId === site.id));
  assert.equal(site.resource, null);
  const irrigated = state.cities.find(candidate => candidate.id === mill.cityId); assert.ok(irrigated); assert.ok(irrigated.buildings.includes('irrigation'));
  assert.equal(irrigated.buildingOperations?.irrigation?.lastResult?.status, 'operated');
  const mountainTown = state.cities.find(candidate => candidate.id === aqueduct.cityId); assert.ok(mountainTown);
  const mountainCenter = state.tiles.find(tile => tile.id === mountainTown.tileId); assert.ok(mountainCenter);
  assert.deepEqual(aqueduct.mountainTileIds, [5, 22, 24]);
  for (const id of aqueduct.mountainTileIds) { const tile = state.tiles.find(candidate => candidate.id === id); assert.ok(tile); assert.equal(tile.terrain, 'mountain'); assert.equal(hexDistance(tile, mountainCenter), 1); }
  for (const seat of [pasture.seat, mill.seat, aqueduct.seat]) { const owner = state.civilizations.find(candidate => candidate.id === seat); assert.ok(owner); assert.ok(owner.resources.materials >= 44 && owner.resources.credits >= 17); }
});

await test('water land predecessor retains paid growth staffing and current free town lanes', () => {
  const value = waterLandPrefix(); const city = value.state.cities.find(candidate => candidate.id === value.mill.cityId); assert.ok(city);
  assert.equal(city.population, 22); assert.ok(city.buildings.includes('granary'));
  assert.equal(city.buildingOperations?.university?.lastResult?.status, 'operated');
  assert.deepEqual(city.buildingOperations?.university?.lastResult?.paid, { credits: 2 });
  for (const target of [value.pasture, value.mill, value.aqueduct]) assert.equal(value.state.cities.find(candidate => candidate.id === target.cityId)?.construction?.active ?? null, null);
});

await test('water land predecessor future branch choices are absent and exact attempts have zero effects', () => {
  const value = waterLandPrefix();
  const options = legalActions(value.state, value.pasture.seat, value.timestamp);
  for (const technology of ['animal-husbandry', 'wheel', 'engineering']) assert.ok(!options.some(option => option.action.type === 'research' && option.action.technology === technology));
  const attempts: { seat: number; action: GameAction }[] = [
    ...['animal-husbandry', 'wheel', 'engineering'].map(technology => ({ seat: value.pasture.seat, action: { type: 'research' as const, technology } })),
    { seat: value.mill.seat, action: { type: 'build', project: 'water-mill', cityId: value.mill.cityId } },
    { seat: value.aqueduct.seat, action: { type: 'build', project: 'aqueduct', cityId: value.aqueduct.cityId } },
    { seat: value.pasture.seat, action: { type: 'improve', improvementId: 'pasture', cityId: value.pasture.cityId, tileId: value.pasture.tileId } },
  ];
  for (const { seat, action } of attempts) { const before = structuredClone(value.state); const result = applyCommand(value.state, { seat, expectedRevision: value.state.revision, timestamp: value.timestamp, action }); assert.equal(result.ok, false, JSON.stringify(action)); assert.deepEqual(result.state, before); assert.deepEqual(result.events, []); assert.deepEqual(value.state, before); }
});

await test('water land full legal prefix replays exactly and returned snapshots are detached', () => {
  const value = waterLandPrefix(); let state = structuredClone(value.initial);
  for (const step of value.steps) { assert.deepEqual(state, step.before); const before = structuredClone(state); const result = replayCoastalStep(state, step.input); assert.deepEqual(state, before); assert.deepEqual(result, step.result); assert.ok(result.ok); assert.ok(isWorldState(result.state)); state = result.state; }
  assert.deepEqual(state, value.state); const second = waterLandPrefix(); assert.deepEqual(second, value);
  const firstCity = value.state.cities[0]; const secondCity = second.state.cities[0]; assert.ok(firstCity); assert.ok(secondCity); firstCity.population = 999; assert.notEqual(secondCity.population, 999);
});
