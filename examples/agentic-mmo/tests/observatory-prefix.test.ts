import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { isHillSite } from '../core/simulation/improvements.ts';
import { isWorldState } from '../core/validation.ts';
import { replayCoastalStep } from './fixtures/coastal-prefix.ts';
import { observatoryPrefix } from './fixtures/observatory-prefix.ts';

const prefix = observatoryPrefix();

await test('fresh Observatory rules declare synthetic Campus and discoveries before actual Mine work', () => {
  const { state, seat, cityId, campusTileId } = prefix;
  const city = state.cities.find(candidate => candidate.id === cityId); const civ = state.civilizations[seat]; assert.ok(city && civ);
  assert.equal(state.releaseId, 'settlement-observatory-1'); assert.equal(prefix.initial.revision, 0); assert.equal(city.civId, seat); assert.equal(city.tileId, 57);
  assert.equal(city.districtSites?.campus, campusTileId); assert.equal(campusTileId, 39); assert.ok(city.buildings.includes('campus'));
  assert.equal(city.construction?.active ?? null, null); assert.ok(civ.era >= 2);
  for (const id of ['water-management', 'writing', 'mathematics']) assert.ok(civ.technologies.includes(id));
  assert.ok(civ.resources.materials >= 30 && civ.resources.credits >= 18); assert.ok(isWorldState(state));
});

await test('actual high ground is measured from Campus39 rather than the town center', () => {
  const { state } = prefix; const campus = state.tiles.find(tile => tile.id === prefix.campusTileId); const center = state.tiles.find(tile => tile.id === 57);
  const mountain = state.tiles.find(tile => tile.id === 22); const wrongOrigin = state.tiles.find(tile => tile.id === 58);
  assert.ok(campus && center && mountain && wrongOrigin); assert.equal(mountain.terrain, 'mountain');
  assert.equal(hexDistance(campus, mountain), 1); assert.equal(hexDistance(center, mountain), 2);
  assert.ok(isHillSite(wrongOrigin)); assert.equal(hexDistance(center, wrongOrigin), 1); assert.equal(hexDistance(campus, wrongOrigin), 2);
  assert.deepEqual(prefix.highGroundTileIds, [22, 56]);
  assert.deepEqual(state.tiles, prefix.beforePause.tiles); assert.equal(state.rng, prefix.beforePause.rng);
});

await test('legal Fuel yard pause frees three residents at the next opening while the real Mine remains staffed', () => {
  const before = prefix.beforePause.cities.find(city => city.id === prefix.cityId); const after = prefix.state.cities.find(city => city.id === prefix.cityId); assert.ok(before && after);
  const paidResidents = (city: typeof before): number => Object.values(city.buildingOperations ?? {}).reduce((sum, operation) => sum + (operation.lastResult?.residents?.allocated ?? 0), 0);
  assert.equal(prefix.initial.cities.find(city => city.id === prefix.cityId)?.population, 12);
  assert.equal(paidResidents(before), 6); assert.equal(paidResidents(after), 3);
  assert.equal(prefix.staffedStep.input.kind, 'strategy');
  if (prefix.staffedStep.input.kind !== 'strategy') return;
  const unpaused = catchUpStrategy(prefix.beforePause, prefix.staffedStep.input.timestamp); assert.ok(unpaused.ok, unpaused.error);
  assert.equal(unpaused.state.cities.find(city => city.id === prefix.cityId)?.population, after.population);
  assert.equal(before.buildingOperations?.['fuel-yard']?.lastResult?.status, 'operated');
  assert.equal(after.buildingOperations?.['fuel-yard']?.lastResult?.status, 'paused');
  assert.deepEqual(after.buildingOperations?.['fuel-yard']?.lastResult?.paid, {});
  assert.equal(after.improvements?.['58']?.operation.lastResult?.residents.allocated, 1);
  assert.equal(after.improvements?.['58']?.operation.lastResult?.status, 'operated');
  const mineResidents = after.improvements?.['58']?.operation.lastResult?.residents; assert.ok(mineResidents);
  assert.equal(mineResidents.available, mineResidents.openingPopulation - 3 - paidResidents(after)); assert.equal(mineResidents.allocated, 1);
  assert.equal(prefix.pauseStep.input.kind, 'action'); assert.equal(prefix.staffedStep.input.kind, 'strategy');
});

await test('fresh Observatory rules permit Sailing but reject unmet later discovery and building prerequisites', () => {
  const { state, seat, cityId, timestamp } = prefix; const before = structuredClone(state);
  assert.ok(legalActions(state, seat, timestamp).some(option => option.action.type === 'research' && option.action.technology === 'sailing'));
  for (const action of [{ type: 'research', technology: 'celestial-navigation' }, { type: 'research', technology: 'astronomy' }, { type: 'build', project: 'observatory', cityId }] as const) {
    assert.equal(legalActions(state, seat, timestamp).some(option => JSON.stringify(option.action) === JSON.stringify(action)), false);
    const result = applyCommand(state, { seat, expectedRevision: state.revision, timestamp, action });
    assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(result.events, []); assert.deepEqual(state, before);
  }
});

await test('actual Mine and pause prefix replays every retained transition from declared synthetic prerequisites', () => {
  let state = structuredClone(prefix.initial);
  for (const step of prefix.steps) {
    assert.deepEqual(state, step.before); const before = structuredClone(state); const result = replayCoastalStep(state, step.input);
    assert.ok(result.ok, result.error); assert.deepEqual(result, step.result); assert.deepEqual(state, before); assert.ok(isWorldState(result.state)); state = result.state;
  }
  assert.deepEqual(state, prefix.state); assert.ok(prefix.steps.some(step => step.input.kind === 'action' && step.input.command.action.type === 'improve' && step.input.command.action.tileId === 58));
  const detached = structuredClone(prefix.state); const city = detached.cities[0]; assert.ok(city); city.population = 1; assert.notEqual(prefix.state.cities[0]?.population, 1);
});
