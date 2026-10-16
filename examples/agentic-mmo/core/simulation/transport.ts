import { LAND_TRANSPORT_RULES } from '../content.ts';
import type { HexTile, LandTransportQuote, WorldState } from '../types.ts';
import { hexDistance } from './geography.ts';

const neighbors = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;

export function isLandTransportQuote(value: unknown, maxTiles: number): value is LandTransportQuote {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const fields = Object.keys(value);
  if (fields.length !== 4 || !fields.every(key => ['mode', 'ruleVersion', 'tileIds', 'edges'].includes(key))) return false;
  if (!('mode' in value) || value.mode !== 'land' || !('ruleVersion' in value) || value.ruleVersion !== 1
    || !('tileIds' in value) || !Array.isArray(value.tileIds) || value.tileIds.length < 2 || value.tileIds.length > maxTiles
    || !('edges' in value) || value.edges !== value.tileIds.length - 1) return false;
  const ids: unknown[] = value.tileIds;
  for (let index = 0; index < ids.length; index++) if (!Object.hasOwn(ids, index) || !Number.isSafeInteger(ids[index]) || Number(ids[index]) < 0) return false;
  return new Set(ids).size === ids.length;
}

export function landTransportTopologyBlock(state: Pick<WorldState, 'tiles'>, quote: LandTransportQuote, fromTileId: number, toTileId: number): string | null {
  if (!isLandTransportQuote(quote, state.tiles.length)) return 'Land quote has malformed or unsupported path data';
  if (quote.tileIds[0] !== fromTileId || quote.tileIds.at(-1) !== toTileId) return 'Land quote does not match its exact endpoint tiles';
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  let previous: HexTile | undefined;
  for (const id of quote.tileIds) {
    const tile = tiles.get(id);
    if (!tile) return `Land quote tile ${id} is missing`;
    if (previous && hexDistance(previous, tile) !== 1) return `Land quote hop to tile ${id} is not adjacent`;
    previous = tile;
  }
  return null;
}

export function landTransportBlock(state: Pick<WorldState, 'tiles'>, quote: LandTransportQuote, fromTileId: number, toTileId: number): string | null {
  const topology = landTransportTopologyBlock(state, quote, fromTileId, toTileId);
  if (topology) return topology;
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  for (const id of quote.tileIds) {
    const tile = tiles.get(id);
    if (tile && !LAND_TRANSPORT_RULES.passable[tile.terrain]) return `Land quote tile ${id} is impassable ${tile.terrain}`;
  }
  return null;
}

export function createLandTransportPlanner(state: Pick<WorldState, 'tiles'>) {
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const coordinates = new Map(state.tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
  const trees = new Map<number, Map<number, number | null>>();
  const work = { trees: 0, visitedTiles: 0 };
  const quote = (fromTileId: number, toTileId: number): LandTransportQuote | null => {
    let tree = trees.get(fromTileId);
    if (!tree) {
      tree = new Map<number, number | null>();
      trees.set(fromTileId, tree);
      work.trees += 1;
      const origin = tiles.get(fromTileId);
      if (origin && LAND_TRANSPORT_RULES.passable[origin.terrain]) {
        const queue = [origin];
        tree.set(origin.id, null);
        for (let index = 0; index < queue.length; index++) {
          const current = queue[index];
          if (!current) continue;
          work.visitedTiles += 1;
          for (const [q, r] of neighbors) {
            const next = coordinates.get(`${current.q + q},${current.r + r}`);
            if (!next || tree.has(next.id) || !LAND_TRANSPORT_RULES.passable[next.terrain]) continue;
            tree.set(next.id, current.id);
            queue.push(next);
          }
        }
      }
    }
    if (fromTileId === toTileId || !tree.has(toTileId)) return null;
    const tileIds: number[] = [];
    let current: number | null | undefined = toTileId;
    while (current !== null && current !== undefined) {
      tileIds.push(current);
      current = tree.get(current);
    }
    tileIds.reverse();
    return { mode: 'land', ruleVersion: LAND_TRANSPORT_RULES.ruleVersion, tileIds, edges: tileIds.length - 1 };
  };
  return { quote, work };
}

export function landTransportCadence(baseCadence: number, quote: LandTransportQuote): number {
  return Math.max(baseCadence, Math.ceil(quote.edges / LAND_TRANSPORT_RULES.edgesPerBeat));
}

export function describeLandTransport(quote: LandTransportQuote, cadence: number): string {
  return `Land path ${quote.tileIds.join(' → ')}; ${quote.edges} edges; exchange every ${cadence} rounds, first due ${cadence} rounds after acceptance. Open-border civilian transit; no cargo is in transit before the due exchange`;
}
