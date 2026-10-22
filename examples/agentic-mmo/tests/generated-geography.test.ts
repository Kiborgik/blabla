import assert from 'node:assert/strict';
import test from 'node:test';
import { generateGeography, GENERATED_GEOGRAPHY_VERSION } from '../core/generated-geography.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { isHillSite } from '../core/simulation/improvements.ts';
import { createLandTransportPlanner, landTransportBlock, landTransportCadence } from '../core/simulation/transport.ts';
import { isCoastalSite } from '../core/simulation/coastal.ts';

const seeds = [0, 1, 73, 1701, 90210, 0xffffffff];

void test('versioned geography is canonical, deterministic, detached and seed-sensitive', () => {
  const signatures = new Set<string>();
  const starts = new Set<string>();
  for (const seed of seeds) {
    const map = generateGeography(seed);
    assert.equal(map.version, 'coherent-geography-v1');
    assert.equal(map.version, GENERATED_GEOGRAPHY_VERSION);
    assert.equal(map.width, 18);
    assert.equal(map.height, 24);
    assert.equal(map.tiles.length, 432);
    assert.deepEqual(generateGeography(seed), map);
    assert.deepEqual(generateGeography(seed + 0x100000000), map);
    for (const [index, tile] of map.tiles.entries()) {
      assert.equal(tile.id, index);
      assert.equal(tile.id, tile.r * map.width + tile.q);
      assert.equal(tile.owner, null);
      assert.equal(tile.resource, null);
      assert.ok(Number.isInteger(tile.elevation) && tile.elevation >= 0 && tile.elevation <= 100);
      if (tile.terrain === 'ocean') assert.ok(tile.elevation < 30);
      if (tile.terrain === 'mountain') assert.ok(tile.elevation > 88);
    }
    assert.ok(Number.isSafeInteger(map.rng) && map.rng >= 0 && map.rng <= 0xffffffff);
    signatures.add(map.tiles.map(tile => tile.terrain[0]).join(''));
    starts.add(map.capitalTileIds.join(','));
    map.tiles[0]!.owner = 4;
    map.capitalTileIds[0] = -1;
    assert.equal(generateGeography(seed).tiles[0]!.owner, null);
    assert.notEqual(generateGeography(seed).capitalTileIds[0], -1);
  }
  assert.equal(signatures.size, seeds.length);
  assert.equal(starts.size, seeds.length);
  assert.deepEqual(generateGeography(-1), generateGeography(0xffffffff));
});

for (const seed of seeds) void test(`seed ${seed}: coherent continent, resource neighborhoods and separated viable asymmetric starts`, context => {
  const map = generateGeography(seed);
  const land = map.tiles.filter(tile => tile.terrain !== 'ocean');
  const passable = land.filter(tile => tile.terrain !== 'mountain');
  assert.ok(land.length >= map.tiles.length * .55 && land.length <= map.tiles.length * .8);
  const capitals = map.capitalTileIds.map(id => map.tiles[id]!);
  assert.equal(new Set(map.capitalTileIds).size, 5);
  assert.ok(Math.max(...capitals.map(tile => tile.r)) - Math.min(...capitals.map(tile => tile.r)) >= 12);
  const planner = createLandTransportPlanner(map);
  const connected = passable.filter(tile => tile.id === capitals[0]!.id || planner.quote(capitals[0]!.id, tile.id));
  assert.ok(connected.length >= passable.length * .7);
  const cadences = new Set<number>();
  const neighborhoods = new Set<string>();
  for (const capital of capitals) {
    assert.equal(capital.terrain, 'grassland');
    const nearby = passable.filter(tile => hexDistance(capital, tile) <= 3);
    assert.ok(nearby.length >= 12);
    assert.ok(nearby.filter(isHillSite).length >= 3);
    assert.ok(nearby.some(tile => tile.terrain === 'forest'));
    const composition = ['grassland', 'forest', 'desert', 'tundra', 'mountain', 'ocean'].map(terrain => map.tiles.filter(tile => hexDistance(capital, tile) <= 3 && tile.terrain === terrain).length);
    neighborhoods.add(composition.join(','));
    for (const other of capitals.filter(other => other.id !== capital.id)) {
      assert.ok(hexDistance(capital, other) >= 6);
      const quote = planner.quote(capital.id, other.id);
      assert.ok(quote);
      assert.equal(landTransportBlock(map, quote, capital.id, other.id), null);
      cadences.add(landTransportCadence(4, quote));
    }
  }
  assert.ok(neighborhoods.size >= 3);
  assert.ok(capitals.some(tile => isCoastalSite(map, tile.id)));
  assert.ok(capitals.some(tile => !isCoastalSite(map, tile.id)));
  assert.ok(Math.max(...cadences) > 4);
  assert.ok(cadences.size >= 2);
  const mountains = land.filter(tile => tile.terrain === 'mountain');
  assert.ok(mountains.length >= 4);
  for (const mountain of mountains) assert.ok(mountains.some(other => hexDistance(mountain, other) === 1));
  const hills = land.filter(isHillSite);
  assert.ok(hills.length >= 32);
  const sameNeighbor = land.filter(tile => map.tiles.some(other => other.terrain === tile.terrain && hexDistance(tile, other) === 1));
  assert.ok(sameNeighbor.length >= land.length * .85);
  context.diagnostic(JSON.stringify({ seed, land: land.length, connected: connected.length, mountains: mountains.length, hills: hills.length, capitals: map.capitalTileIds, cadences: [...cadences] }));
});

void test('generation bounds reject unsupported inputs rather than silently falling back', () => {
  for (const seed of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => generateGeography(seed), RangeError);
  for (const [width, height] of [[0, 24], [18, 0], [17, 24], [18, 23], [18.5, 24], [128, 128], [Infinity, 24]]) assert.throws(() => generateGeography(1701, width, height), RangeError);
  const larger = generateGeography(73, 24, 30);
  assert.equal(larger.tiles.length, 720);
  assert.deepEqual(generateGeography(73, 24, 30), larger);
});
