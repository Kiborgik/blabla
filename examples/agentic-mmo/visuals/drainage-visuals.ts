import { drainageFacts, validateDrainage } from '../core/drainage.ts';
import type { WorldState } from '../core/types.ts';
import { hexPosition } from './landscape.ts';
import type { TerrainPoint } from './landscape.ts';
import { mapTileHeight } from './route-paths.ts';

export interface DrainageEdgeView {
  id: string;
  fromTileId: number;
  toTileId: number;
  outletTileId: number;
  contributingLandTiles: number;
  mouth: boolean;
  points: readonly [TerrainPoint, TerrainPoint];
}
export interface DrainageView { kind: 'retained' | 'unavailable'; reason: string | null; edges: DrainageEdgeView[] }

export function projectDrainage(state: Pick<WorldState, 'tiles' | 'width' | 'height' | 'drainage'>): DrainageView | null {
  if (state.drainage === undefined) return null;
  if (!validateDrainage(state.drainage, state.tiles, state.width, state.height)) return { kind: 'unavailable', reason: 'The retained drainage does not match this geography.', edges: [] };
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const centerQ = (state.width - 1) / 2; const centerR = (state.height - 1) / 2;
  const edges = drainageFacts(state.drainage, state.tiles).flatMap((node): DrainageEdgeView[] => {
    if (node.downstreamTileId === null || node.contributingLandTiles < 8) return [];
    const from = tiles.get(node.tileId)!; const to = tiles.get(node.downstreamTileId)!;
    const a = hexPosition(from.q - centerQ, from.r - centerR); const b = hexPosition(to.q - centerQ, to.r - centerR);
    const mouth = to.terrain === 'ocean';
    return [{ id: `drainage:1:${from.id}:${to.id}`, fromTileId: from.id, toTileId: to.id, outletTileId: node.outletTileId,
      contributingLandTiles: node.contributingLandTiles, mouth,
      points: [[a.x, mapTileHeight(from.elevation), a.z], mouth ? [(a.x + b.x) / 2, 0, (a.z + b.z) / 2] : [b.x, mapTileHeight(to.elevation), b.z]] }];
  }).sort((a, b) => a.fromTileId - b.fromTileId);
  return { kind: 'retained', reason: null, edges };
}
