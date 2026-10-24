import assert from 'node:assert/strict';
import test from 'node:test';
import { conditionDrainage, drainageFacts, validateDrainage, type DrainageLayerV1, type DrainageFloodDiagnostics } from '../core/drainage.ts';
import type { HexTile } from '../core/types.ts';

const offsets = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

function fixture(width: number, height: number, elevation = 50): HexTile[] {
  return Array.from({ length: width * height }, (_, id) => ({ id, q: id % width, r: Math.floor(id / width), terrain: 'grassland', elevation, owner: null, resource: null }));
}

function ocean(tiles: HexTile[], ...ids: number[]): HexTile[] {
  for (const id of ids) Object.assign(tiles[id]!, { terrain: 'ocean', elevation: 10 });
  return tiles;
}

function neighbors(tiles: readonly HexTile[], tile: HexTile): HexTile[] {
  return tiles.filter(other => offsets.some(([dq, dr]) => other.q === tile.q + dq! && other.r === tile.r + dr!));
}

function assertRawGraph(layer: DrainageLayerV1, tiles: readonly HexTile[]): void {
  const byId = new Map(tiles.map(tile => [tile.id, tile]));
  const reachedOcean = new Set(tiles.filter(tile => tile.terrain === 'ocean' && (tile.q === 0 || tile.r === 0 || tile.q === layer.width - 1 || tile.r === layer.height - 1)).map(tile => tile.id));
  const queue = [...reachedOcean];
  for (const id of queue) for (const neighbor of neighbors(tiles, byId.get(id)!)) {
    if (neighbor.terrain !== 'ocean' || reachedOcean.has(neighbor.id)) continue;
    reachedOcean.add(neighbor.id);
    queue.push(neighbor.id);
  }
  assert.equal(reachedOcean.size, tiles.filter(tile => tile.terrain === 'ocean').length);
  const counts = Array<number>(tiles.length).fill(0);
  const outlets = new Map<number, number>();
  for (const tile of tiles) {
    assert.deepEqual(layer.terrainBasis[tile.id], [tile.terrain, tile.elevation * 4096]);
    assert.ok(Number.isSafeInteger(tile.elevation * 4096));
    if (tile.terrain === 'ocean') {
      assert.equal(layer.downstreamTileIds[tile.id], null);
      outlets.set(tile.id, tile.id);
      continue;
    }
    const chain = new Set<number>();
    let current = tile;
    while (true) {
      assert.ok(!chain.has(current.id));
      chain.add(current.id);
      counts[current.id]! += 1;
      if (current.terrain === 'ocean') {
        assert.ok(reachedOcean.has(current.id));
        outlets.set(tile.id, current.id);
        break;
      }
      const next = byId.get(layer.downstreamTileIds[current.id]!);
      assert.ok(next);
      const lower = neighbors(tiles, current).filter(other => other.elevation < current.elevation).sort((a, b) => a.elevation - b.elevation || a.id - b.id);
      assert.equal(next.id, lower[0]?.id);
      assert.ok(next.elevation < current.elevation);
      current = next;
    }
  }
  const facts = drainageFacts(layer, tiles);
  assert.deepEqual(facts.map(node => node.tileId), Array.from({ length: tiles.length }, (_, id) => id));
  for (const fact of facts) {
    assert.equal(fact.downstreamTileId, layer.downstreamTileIds[fact.tileId]);
    assert.equal(fact.outletTileId, outlets.get(fact.tileId));
    assert.equal(fact.contributingLandTiles, counts[fact.tileId]);
  }
}

void test('actual enclosed pit is filled through its one real lower spill route', () => {
  const tiles = ocean(fixture(5, 5, 80), 10);
  tiles[11]!.elevation = 40;
  tiles[12]!.elevation = 31;
  const before = JSON.stringify(tiles);
  const result = conditionDrainage(tiles, 5, 5);
  assert.ok(result);
  assert.equal(JSON.stringify(tiles), before);
  assert.equal(result.tiles[12]!.elevation, 40 + 1 / 4096);
  assert.equal(result.drainage.downstreamTileIds[12], 11);
  assert.equal(result.drainage.downstreamTileIds[11], 10);
  assert.equal(result.tiles[10]!.elevation, 10);
  assertRawGraph(result.drainage, result.tiles);
});

void test('equal-height plateau with two real exits has exact slopes and canonical numeric ties', () => {
  const tiles = ocean(fixture(5, 3), 5, 9);
  const result = conditionDrainage(tiles, 5, 3);
  assert.ok(result);
  assert.equal(result.tiles[7]!.elevation, 50 + 1 / 4096);
  assert.equal(result.drainage.downstreamTileIds[7], 6);
  assert.equal(result.drainage.downstreamTileIds[6], 5);
  assert.equal(result.drainage.downstreamTileIds[8], 9);
  assertRawGraph(result.drainage, result.tiles);
});

void test('confluences derive contributing land counts and exact ocean outlets without mutable totals', () => {
  const tiles = ocean(fixture(5, 5, 70), 10);
  tiles[11]!.elevation = 40;
  tiles[7]!.elevation = 50;
  tiles[12]!.elevation = 50;
  const result = conditionDrainage(tiles, 5, 5);
  assert.ok(result);
  assert.equal(result.drainage.downstreamTileIds[7], 11);
  assert.equal(result.drainage.downstreamTileIds[12], 11);
  assert.ok(drainageFacts(result.drainage, result.tiles)[11]!.contributingLandTiles >= 3);
  assertRawGraph(result.drainage, result.tiles);
});

void test('deep-frozen and permuted input yields the same detached ID-keyed drainage', () => {
  const tiles = ocean(fixture(5, 5), 0, 5, 10, 15, 20);
  const normal = conditionDrainage(tiles, 5, 5);
  assert.ok(normal);
  const frozen = Object.freeze(tiles.map(tile => Object.freeze({ ...tile })).reverse());
  const before = JSON.stringify(frozen);
  const reversed = conditionDrainage(frozen, 5, 5);
  assert.deepEqual(reversed, normal);
  assert.equal(JSON.stringify(frozen), before);
  assertRawGraph(normal.drainage, frozen.map(tile => normal.tiles[tile.id]!).reverse());
  normal.tiles[11]!.owner = 3;
  normal.tiles[11]!.resource = 'food';
  assert.equal(validateDrainage(normal.drainage, normal.tiles, 5, 5), true);
});

void test('bounded flood inserts and removes each tile once and visits at most six neighbors per tile', () => {
  const tiles = ocean(fixture(64, 64), ...Array.from({ length: 64 }, (_, row) => row * 64));
  const diagnostics: DrainageFloodDiagnostics = { heapPushes: -1, heapPops: -1, neighborVisits: -1 };
  const result = conditionDrainage(tiles, 64, 64, diagnostics);
  assert.ok(result);
  assert.equal(diagnostics.heapPushes, tiles.length);
  assert.equal(diagnostics.heapPops, tiles.length);
  assert.ok(diagnostics.neighborVisits <= 6 * tiles.length);
});

void test('interior oceans, malformed relief, unsupported dimensions and isolated final mountains reject', () => {
  const interior = ocean(fixture(5, 5), 0, 12);
  assert.equal(conditionDrainage(interior, 5, 5), null);
  for (const elevation of [-1, 101, NaN, Infinity, 50 + 1 / 8192]) {
    const tiles = ocean(fixture(5, 5), 0);
    tiles[12]!.elevation = elevation;
    assert.equal(conditionDrainage(tiles, 5, 5), null, String(elevation));
  }
  const overflow = ocean(fixture(5, 5, 100), 0);
  assert.equal(conditionDrainage(overflow, 5, 5), null);
  const peak = ocean(fixture(5, 5), 0);
  peak[12]!.elevation = 90;
  assert.equal(conditionDrainage(peak, 5, 5), null);
  const pair = ocean(fixture(5, 5), 0);
  pair[12]!.elevation = pair[13]!.elevation = 90;
  const classified = conditionDrainage(pair, 5, 5);
  assert.ok(classified);
  assert.equal(classified.tiles[12]!.terrain, 'mountain');
  assert.equal(classified.tiles[13]!.terrain, 'mountain');
  assert.equal(conditionDrainage(fixture(5, 5), 5, 5), null);
  for (const [width, height] of [[0, 5], [5, 0], [5.5, 5], [65, 65], [Infinity, 5]]) assert.equal(conditionDrainage([], width!, height!), null);
  const hole = ocean(fixture(5, 5), 0);
  delete hole[12];
  assert.equal(conditionDrainage(hole, 5, 5), null);
  const duplicate = ocean(fixture(5, 5), 0);
  duplicate[12] = { ...duplicate[11]! };
  assert.equal(conditionDrainage(duplicate, 5, 5), null);
});

void test('retained validation rejects disconnected, cyclic, missing, sparse and stale graph facts', () => {
  const result = conditionDrainage(ocean(fixture(5, 5), 0, 5, 10, 15, 20), 5, 5);
  assert.ok(result);
  assert.equal(validateDrainage(result.drainage, result.tiles, 5, 5), true);
  const mutations: Array<[string, (layer: DrainageLayerV1, tiles: HexTile[]) => void]> = [
    ['nonadjacent', layer => { layer.downstreamTileIds[12] = 0; }],
    ['noncanonical lower neighbor', layer => { layer.downstreamTileIds[6] = 10; }],
    ['cycle', layer => { layer.downstreamTileIds[11] = 12; layer.downstreamTileIds[12] = 11; }],
    ['missing land pointer', layer => { layer.downstreamTileIds[12] = null; }],
    ['ocean pointer', layer => { layer.downstreamTileIds[0] = 5; }],
    ['pointer hole', layer => { delete layer.downstreamTileIds[12]; }],
    ['short pointers', layer => { layer.downstreamTileIds.pop(); }],
    ['basis hole', layer => { delete layer.terrainBasis[12]; }],
    ['tuple hole', layer => { delete (layer.terrainBasis[12]! as Array<unknown>)[1]; }],
    ['stale elevation', (_layer, tiles) => { tiles[12]!.elevation += 1 / 4096; }],
    ['stale terrain', (_layer, tiles) => { tiles[12]!.terrain = 'forest'; }],
    ['nonquantized matching basis', (layer, tiles) => { tiles[12]!.elevation += 1 / 8192; layer.terrainBasis[12]![1] = tiles[12]!.elevation * 4096; }],
    ['coerced elevation', (_layer, tiles) => { tiles[0]!.elevation = '10' as unknown as number; }],
    ['nan matching basis', (layer, tiles) => { tiles[12]!.elevation = NaN; layer.terrainBasis[12]![1] = NaN; }],
    ['range matching basis', (layer, tiles) => { tiles[12]!.elevation = 101; layer.terrainBasis[12]![1] = 101 * 4096; }],
    ['dimensions', layer => { layer.width = 4; }],
    ['rule version', layer => { (layer as { ruleVersion: number }).ruleVersion = 2; }],
  ];
  for (const [name, mutate] of mutations) {
    const changed: { tiles: HexTile[]; drainage: DrainageLayerV1 } = structuredClone(result);
    mutate(changed.drainage, changed.tiles);
    assert.equal(validateDrainage(changed.drainage, changed.tiles, 5, 5), false, name);
  }
  for (const value of [undefined, null, {}, []]) assert.equal(validateDrainage(value, result.tiles, 5, 5), false);
  const interior = structuredClone(result);
  Object.assign(interior.tiles[12]!, { terrain: 'ocean', elevation: 10 });
  interior.drainage.terrainBasis[12] = ['ocean', 10 * 4096];
  interior.drainage.downstreamTileIds[12] = null;
  assert.equal(validateDrainage(interior.drainage, interior.tiles, 5, 5), false);
});
