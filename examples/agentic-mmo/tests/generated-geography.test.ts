import assert from 'node:assert/strict';
import test from 'node:test';
import { generateGeography, GENERATED_GEOGRAPHY_VERSION, generateGeographyWithCandidateForTest } from '../core/generated-geography.ts';
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
    assert.equal(map.version, 'drainage-geography-v2');
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
      assert.ok(Number.isSafeInteger(tile.elevation * 4096) && tile.elevation >= 0 && tile.elevation <= 100);
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

void test('drainage courses retain four consecutive land edges to a genuine mouth and a river-adjacent capital', () => {
  for (const [seed, width, height] of [...seeds.map(seed => [seed, 18, 24]), [73, 24, 30]]) {
    const map = generateGeography(seed!, width, height);
    const incoming = Array<number>(map.tiles.length).fill(0);
    const lengths = Array<number>(map.tiles.length).fill(0);
    const ocean = new Set(map.tiles.filter(tile => tile.terrain === 'ocean' && (tile.q === 0 || tile.r === 0 || tile.q === map.width - 1 || tile.r === map.height - 1)).map(tile => tile.id));
    const pending = [...ocean];
    for (const id of pending) for (const tile of map.tiles) if (tile.terrain === 'ocean' && !ocean.has(tile.id) && hexDistance(map.tiles[id]!, tile) === 1) { ocean.add(tile.id); pending.push(tile.id); }
    for (const tile of map.tiles) {
      assert.deepEqual(map.drainage.terrainBasis[tile.id], [tile.terrain, tile.elevation * 4096]);
      if (tile.terrain === 'ocean') { assert.equal(map.drainage.downstreamTileIds[tile.id], null); continue; }
      const seen = new Set<number>();
      let id = tile.id;
      while (map.tiles[id]!.terrain !== 'ocean') {
        assert.ok(!seen.has(id));
        seen.add(id);
        incoming[id]! += 1;
        const next = map.drainage.downstreamTileIds[id];
        assert.notEqual(next, null);
        const destination = map.tiles[next!]!;
        assert.equal(hexDistance(map.tiles[id]!, destination), 1);
        assert.ok(destination.elevation < map.tiles[id]!.elevation);
        const lower = map.tiles.filter(other => hexDistance(map.tiles[id]!, other) === 1 && other.elevation < map.tiles[id]!.elevation).sort((a, b) => a.elevation - b.elevation || a.id - b.id);
        assert.equal(next, lower[0]!.id);
        id = next!;
      }
      assert.ok(ocean.has(id));
    }
    for (const tile of map.tiles.toSorted((a, b) => a.elevation - b.elevation || a.id - b.id)) {
      const next = map.drainage.downstreamTileIds[tile.id];
      if (next !== null && incoming[tile.id]! >= 8) lengths[tile.id] = lengths[next!]! + 1;
    }
    assert.ok(Math.max(...lengths) >= 4, `seed ${seed} has a four-edge river course`);
    assert.ok(map.capitalTileIds.some(id => map.tiles.some(tile => tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && incoming[tile.id]! >= 8 && hexDistance(map.tiles[id]!, tile) === 1)));
  }
});

void test('test-only rejected candidate seam uses the real hard 96-attempt loop without fallback', () => {
  const seen = new Set<number>();
  let calls = 0;
  assert.throws(() => generateGeographyWithCandidateForTest(73, 18, 24, (seed, width, height) => {
    calls += 1;
    seen.add(seed);
    return Array.from({ length: width * height }, (_, id) => ({ id, q: id % width, r: Math.floor(id / width), terrain: 'grassland', elevation: 50, owner: null, resource: null }));
  }), /within 96 attempts/);
  assert.equal(calls, 96);
  assert.equal(seen.size, 96);
});
