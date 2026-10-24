import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, legalActions, observe } from '../core/engine.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { isWorldState } from '../core/validation.ts';
import { replayCoastalStep } from './fixtures/coastal-prefix.ts';
import { ownedTerritoryPrefix } from './fixtures/owned-territory-prefix.ts';

await test('territory prefix reaches actual funded researched center-only town and retained horse approach', context => {
  const value = ownedTerritoryPrefix(); const state = value.state;
  const city = state.cities.find(town => town.id === value.cityId); assert.ok(city);
  assert.equal(city.tileId, 199); assert.equal(city.civId, 2); assert.ok(city.population > 3);
  assert.equal(city.construction?.active ?? null, null);
  const owner = state.civilizations[2]; assert.ok(owner); assert.ok(owner.resources.credits >= 33 && owner.resources.materials >= 6);
  assert.ok(owner.technologies.includes('agriculture')); assert.ok(owner.technologies.includes('animal-husbandry'));
  const tiles = value.pathTileIds.map(id => { const tile = state.tiles.find(candidate => candidate.id === id); assert.ok(tile); return tile; });
  assert.deepEqual(value.pathTileIds, [199, 181, 164]);
  assert.equal(tiles[0]?.owner, 2);
  for (const tile of tiles.slice(1)) { assert.equal(tile.owner, null); assert.equal(tile.terrain, 'grassland'); }
  for (let index = 1; index < tiles.length; index++) { const old = tiles[index - 1]; const tile = tiles[index]; assert.ok(old && tile); assert.equal(hexDistance(old, tile), 1); }
  const center = tiles[0]; const target = tiles[2]; assert.ok(center && target); assert.equal(hexDistance(center, target), 2);
  assert.ok(observe(state, 2, value.timestamp).revealedPastoralSites?.some(site => site.tileId === 164));
  assert.ok(isWorldState(state));
  context.diagnostic(JSON.stringify({ transitions: value.steps.length, round: state.round, city: value.cityId, population: city.population, credits: owner.resources.credits, materials: owner.resources.materials }));
});

await test('fresh territory preparation retains its expanded geography and empty acquisition ledger', () => {
  const value = ownedTerritoryPrefix();
  assert.deepEqual(value.state.tiles, value.beforeResearch.tiles);
  assert.deepEqual(value.state.pastoralSites, value.beforeResearch.pastoralSites);
  assert.equal(value.state.rng, value.beforeResearch.rng);
  assert.equal(value.state.releaseId, value.beforeResearch.releaseId);
  assert.equal(value.initial.releaseId, 'settlement-territory-1'); assert.equal(value.initial.revision, 0);
  assert.ok(value.state.unlockedFeatures.includes('owned-territory'));
  assert.deepEqual(value.state.tileAcquisitions, {});
  assert.equal(value.state.width, 18); assert.equal(value.state.height, 24); assert.equal(value.state.tiles.length, 432);
  assert.deepEqual(value.state.tiles.map(({ owner: _owner, ...tile }) => tile), value.initial.tiles.map(({ owner: _owner, ...tile }) => tile));
});

await test('fresh territory pays for the connected first tile while disconnected acquisition and unowned Pasture refuse atomically', () => {
  const value = ownedTerritoryPrefix(); const before = structuredClone(value.state);
  for (const action of [{ type: 'acquire-tile', cityId: value.cityId, tileId: 164 }, { type: 'improve', cityId: value.cityId, tileId: 164, improvementId: 'pasture' }] as const) {
    const result = applyCommand(value.state, { seat: 2, expectedRevision: value.state.revision, timestamp: value.timestamp, action });
    assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(result.events, []); assert.deepEqual(value.state, before);
  }
  const action = { type: 'acquire-tile', cityId: value.cityId, tileId: 181 } as const;
  assert.ok(legalActions(value.state, 2, value.timestamp).some(option => option.action.type === 'acquire-tile' && option.action.cityId === value.cityId && option.action.tileId === 181));
  const acquired = applyCommand(value.state, { seat: 2, expectedRevision: value.state.revision, timestamp: value.timestamp, action });
  assert.ok(acquired.ok, acquired.error); assert.deepEqual(value.state, before);
  assert.equal(acquired.state.tiles.find(tile => tile.id === 181)?.owner, 2);
  assert.equal(acquired.state.civilizations[2]?.resources.credits, before.civilizations[2]!.resources.credits - 12);
  const receipt = acquired.state.tileAcquisitions?.['181']; assert.ok(receipt); assert.equal(receipt.paid.credits, 12);
  assert.deepEqual(acquired.events.find(event => event.id === receipt.eventId)?.territoryAcquisition, receipt);
  assert.ok(isWorldState(acquired.state));
});

await test('actual territory founding and research replay from declared synthetic prerequisites with detached histories', () => {
  const value = ownedTerritoryPrefix(); let state = structuredClone(value.initial);
  for (const step of value.steps) { assert.deepEqual(state, step.before); const before = structuredClone(state); const result = replayCoastalStep(state, structuredClone(step.input)); assert.deepEqual(state, before); assert.deepEqual(result, step.result); assert.ok(result.ok); assert.ok(isWorldState(result.state)); state = result.state; }
  assert.deepEqual(state, value.state);
  const second = ownedTerritoryPrefix(); assert.deepEqual(second.state, value.state);
  const tile = value.state.tiles[181]; assert.ok(tile); tile.owner = 2; assert.equal(second.state.tiles[181]?.owner, null);
});
