import type { HexTile, Terrain } from './types.ts';

export interface DrainageLayerV1 {
  ruleVersion: 1;
  width: number;
  height: number;
  terrainBasis: Array<[Terrain, number]>;
  downstreamTileIds: Array<number | null>;
}

export interface DrainageNode {
  tileId: number;
  downstreamTileId: number | null;
  outletTileId: number;
  contributingLandTiles: number;
}

export interface DrainageFloodDiagnostics {
  heapPushes: number;
  heapPops: number;
  neighborVisits: number;
}

export const RIVER_MINIMUM_CONTRIBUTING_LAND_TILES = 8;
const ELEVATION_UNITS = 4096;
const OFFSETS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;
const TERRAINS: readonly Terrain[] = ['ocean', 'grassland', 'forest', 'desert', 'mountain', 'tundra'];

function indexedTiles(tiles: readonly HexTile[], width: number, height: number, final: boolean): HexTile[] | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 4096
    || !Array.isArray(tiles) || tiles.length !== width * height) return null;
  const indexed: HexTile[] = Array(tiles.length);
  for (const tile of tiles) {
    if (typeof tile !== 'object' || tile === null || !Number.isSafeInteger(tile.id) || tile.id < 0 || tile.id >= tiles.length || indexed[tile.id] !== undefined
      || !Number.isSafeInteger(tile.q) || !Number.isSafeInteger(tile.r) || tile.q < 0 || tile.q >= width || tile.r < 0 || tile.r >= height || tile.id !== tile.r * width + tile.q
      || !TERRAINS.includes(tile.terrain) || typeof tile.elevation !== 'number' || !Number.isSafeInteger(tile.elevation * ELEVATION_UNITS) || tile.elevation < 0 || tile.elevation > 100
      || (tile.terrain === 'ocean' ? tile.elevation >= 30 : tile.elevation < 30)
      || final && tile.terrain !== 'ocean' && (tile.terrain === 'mountain') !== (tile.elevation > 88)) return null;
    indexed[tile.id] = tile;
  }
  return indexed;
}

function adjacency(tiles: readonly HexTile[], width: number, height: number): number[][] {
  return tiles.map(tile => OFFSETS.flatMap(([dq, dr]) => {
    const q = tile.q + dq, r = tile.r + dr;
    return q >= 0 && q < width && r >= 0 && r < height ? [r * width + q] : [];
  }).sort((a, b) => a - b));
}

function connectedOcean(tiles: readonly HexTile[], adjacent: readonly number[][], width: number, height: number): number[] | null {
  const ocean = tiles.filter(tile => tile.terrain === 'ocean');
  const queue = ocean.filter(tile => tile.q === 0 || tile.r === 0 || tile.q === width - 1 || tile.r === height - 1).map(tile => tile.id);
  if (!queue.length) return null;
  const seen = new Set(queue);
  for (const id of queue) for (const next of adjacent[id]!) {
    if (tiles[next]!.terrain !== 'ocean' || seen.has(next)) continue;
    seen.add(next);
    queue.push(next);
  }
  return seen.size === ocean.length ? queue.sort((a, b) => a - b) : null;
}

function canonicalDownstream(tiles: readonly HexTile[], adjacent: readonly number[][]): Array<number | null> | null {
  const downstream: Array<number | null> = [];
  for (const tile of tiles) {
    let selected: HexTile | undefined;
    if (tile.terrain !== 'ocean') {
      for (const id of adjacent[tile.id]!) {
        const neighbor = tiles[id]!;
        if (neighbor.elevation < tile.elevation && (!selected || neighbor.elevation < selected.elevation || neighbor.elevation === selected.elevation && neighbor.id < selected.id)) selected = neighbor;
      }
      if (!selected) return null;
    }
    downstream.push(selected?.id ?? null);
  }
  return downstream;
}

function isolatedMountain(tiles: readonly HexTile[], adjacent: readonly number[][]): boolean {
  return tiles.some(tile => tile.terrain === 'mountain' && !adjacent[tile.id]!.some(id => tiles[id]!.terrain === 'mountain'));
}

export function conditionDrainage(input: readonly HexTile[], width: number, height: number, diagnostics?: DrainageFloodDiagnostics): { tiles: HexTile[]; drainage: DrainageLayerV1 } | null {
  if (diagnostics) { diagnostics.heapPushes = 0; diagnostics.heapPops = 0; diagnostics.neighborVisits = 0; }
  const indexed = indexedTiles(input, width, height, false);
  if (!indexed) return null;
  const tiles = indexed.map(tile => ({ ...tile }));
  const adjacent = adjacency(tiles, width, height);
  const ocean = connectedOcean(tiles, adjacent, width, height);
  if (!ocean) return null;
  const units = tiles.map(tile => tile.elevation * ELEVATION_UNITS);
  const visited = new Set(ocean);
  const heap: number[] = [];
  const less = (left: number, right: number): boolean => units[left]! < units[right]! || units[left] === units[right] && left < right;
  const push = (id: number): void => {
    if (diagnostics) diagnostics.heapPushes += 1;
    heap.push(id);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!less(id, heap[parent]!)) break;
      heap[index] = heap[parent]!;
      index = parent;
    }
    heap[index] = id;
  };
  const pop = (): number => {
    if (diagnostics) diagnostics.heapPops += 1;
    const id = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        const left = index * 2 + 1, right = left + 1;
        const child = right < heap.length && less(heap[right]!, heap[left]!) ? right : left;
        if (!less(heap[child]!, last)) break;
        heap[index] = heap[child]!;
        index = child;
      }
      heap[index] = last;
    }
    return id;
  };
  for (const id of ocean) push(id);
  while (heap.length) {
    const id = pop();
    for (const next of adjacent[id]!) {
      if (diagnostics) diagnostics.neighborVisits += 1;
      if (visited.has(next)) continue;
      visited.add(next);
      const raised = Math.max(units[next]!, units[id]! + 1);
      if (!Number.isSafeInteger(raised) || raised > 100 * ELEVATION_UNITS) return null;
      units[next] = raised;
      tiles[next]!.elevation = raised / ELEVATION_UNITS;
      if (tiles[next]!.elevation > 88) tiles[next]!.terrain = 'mountain';
      push(next);
    }
  }
  if (visited.size !== tiles.length || isolatedMountain(tiles, adjacent)) return null;
  const downstreamTileIds = canonicalDownstream(tiles, adjacent);
  if (!downstreamTileIds || !indexedTiles(tiles, width, height, true)) return null;
  return { tiles, drainage: { ruleVersion: 1, width, height, terrainBasis: tiles.map(tile => [tile.terrain, tile.elevation * ELEVATION_UNITS]), downstreamTileIds } };
}

export function validateDrainage(value: unknown, input: readonly HexTile[], width: number, height: number): value is DrainageLayerV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const layer = value as Record<string, unknown>;
  const keys = Object.keys(layer);
  if (keys.length !== 5 || !['ruleVersion', 'width', 'height', 'terrainBasis', 'downstreamTileIds'].every(key => Object.hasOwn(layer, key))
    || layer.ruleVersion !== 1 || layer.width !== width || layer.height !== height || !Array.isArray(layer.terrainBasis) || !Array.isArray(layer.downstreamTileIds)) return false;
  const tiles = indexedTiles(input, width, height, true);
  if (!tiles || layer.terrainBasis.length !== tiles.length || layer.downstreamTileIds.length !== tiles.length) return false;
  for (const tile of tiles) {
    const basis: unknown = layer.terrainBasis[tile.id];
    if (!Object.hasOwn(layer.terrainBasis, tile.id) || !Object.hasOwn(layer.downstreamTileIds, tile.id)
      || !Array.isArray(basis) || basis.length !== 2 || !Object.hasOwn(basis, 0) || !Object.hasOwn(basis, 1)
      || basis[0] !== tile.terrain || basis[1] !== tile.elevation * ELEVATION_UNITS) return false;
  }
  const adjacent = adjacency(tiles, width, height);
  if (!connectedOcean(tiles, adjacent, width, height) || isolatedMountain(tiles, adjacent)) return false;
  const expected = canonicalDownstream(tiles, adjacent);
  const downstream = layer.downstreamTileIds;
  return expected !== null && expected.every((id, index) => downstream[index] === id);
}

export function drainageFacts(layer: DrainageLayerV1, input: readonly HexTile[]): DrainageNode[] {
  if (!validateDrainage(layer, input, layer.width, layer.height)) throw new RangeError('Drainage facts require a valid retained terrain basis and canonical outlet-connected graph');
  const tiles = input.toSorted((a, b) => a.id - b.id);
  const facts: DrainageNode[] = tiles.map(tile => ({ tileId: tile.id, downstreamTileId: layer.downstreamTileIds[tile.id]!, outletTileId: tile.id, contributingLandTiles: tile.terrain === 'ocean' ? 0 : 1 }));
  const ascending = tiles.toSorted((a, b) => a.elevation - b.elevation || a.id - b.id);
  for (const tile of ascending) {
    const fact = facts[tile.id]!;
    if (fact.downstreamTileId !== null) fact.outletTileId = facts[fact.downstreamTileId]!.outletTileId;
  }
  for (let index = ascending.length - 1; index >= 0; index--) {
    const fact = facts[ascending[index]!.id]!;
    if (fact.downstreamTileId !== null) facts[fact.downstreamTileId]!.contributingLandTiles += fact.contributingLandTiles;
  }
  return facts;
}
