import { populationFootprint, SETTLEMENT_RENDER_SCALE } from './world-visuals.ts';
import type { DetailLevel, VisualPart } from './world-visuals.ts';

export interface LandscapeTile { q: number; r: number; owner: number | null; terrain: 'grassland' | 'forest' | 'desert' | 'mountain' | 'tundra'; height: number }
export interface LandscapeTown { q: number; r: number; population?: number }
export interface LandscapeEdge { key: string; owner: number | null; from: readonly [number, number]; to: readonly [number, number]; height: number; fromHeight?: number; toHeight?: number }
export interface LandscapeTerritory { key: string; owner: number; height: number; points: Array<readonly [number, number]> }
export interface LandscapeProjection { coast: LandscapeEdge[]; borders: LandscapeEdge[]; territories: LandscapeTerritory[]; parts: VisualPart[] }
export const LANDSCAPE_BUDGETS = { far: 384, mid: 768, close: 1152 } as const;
export const TERRITORY_STYLE = { washOpacity: .13, borderWidth: .09, borderOpacity: .95 } as const;
export const LANDSCAPE_COLORS = { grassland: '#86a35c', forest: '#6e8e50', desert: '#cfb47d', mountain: '#929783', tundra: '#b7beb0', water: '#193f50', shallow: '#3e8386', shore: '#d4c393' } as const;
const NEIGHBORS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;
const key = (tile: { q: number; r: number }): string => `${tile.q},${tile.r}`;
const order = (a: { q: number; r: number }, b: { q: number; r: number }): number => a.r - b.r || a.q - b.q;
const noise = (q: number, r: number, index: number): number => Math.abs(Math.sin(q * 17.1 + r * 43.7 + index * 11.3));

export function hexPosition(q: number, r: number): { x: number; z: number } {
  return { x: Math.sqrt(3) * (q + r / 2), z: 1.5 * r };
}

export function landscapeSurface(tile: LandscapeTile): string {
  const color = LANDSCAPE_COLORS[tile.terrain];
  const amount = (noise(tile.q, tile.r, 0) - .5) * .055;
  return `#${[1, 3, 5].map(offset => Math.round(Number.parseInt(color.slice(offset, offset + 2), 16) * (1 + amount)).toString(16).padStart(2, '0')).join('')}`;
}

export function territoryEdgeTriangles(edge: LandscapeEdge): number[] {
  const dx = edge.to[0] - edge.from[0];
  const dz = edge.to[1] - edge.from[1];
  const length = Math.hypot(dx, dz);
  if (!length) return [];
  const ox = -dz / length * TERRITORY_STYLE.borderWidth / 2;
  const oz = dx / length * TERRITORY_STYLE.borderWidth / 2;
  const a = [edge.from[0] + ox, edge.fromHeight ?? edge.height, edge.from[1] + oz];
  const b = [edge.to[0] + ox, edge.toHeight ?? edge.height, edge.to[1] + oz];
  const c = [edge.to[0] - ox, edge.toHeight ?? edge.height, edge.to[1] - oz];
  const d = [edge.from[0] - ox, edge.fromHeight ?? edge.height, edge.from[1] - oz];
  return [...a, ...b, ...c, ...a, ...c, ...d];
}

export type TerrainPoint = readonly [number, number, number];
export interface TerrainFace { key: string; points: TerrainPoint[]; color: string }
export interface TerrainSurface { key: string; center: TerrainPoint; rim: TerrainPoint[]; faces: TerrainFace[]; cliffs: TerrainFace[] }

function shadeColor(color: string, amount: number): string {
  return `#${[1, 3, 5].map(offset => Math.max(0, Math.min(255, Math.round(Number.parseInt(color.slice(offset, offset + 2), 16) * amount))).toString(16).padStart(2, '0')).join('')}`;
}

export function projectTerrainSurface(tiles: readonly LandscapeTile[]): TerrainSurface[] {
  const ordered = tiles.toSorted(order);
  const lookup = new Set(ordered.map(key));
  const corners = new Map<string, { x: number; z: number; heights: number[] }>();
  const cornerKey = (x: number, z: number): string => `${Math.round(x * 1e6)},${Math.round(z * 1e6)}`;
  for (const tile of ordered) {
    const { x, z } = hexPosition(tile.q, tile.r);
    for (let index = 0; index < 6; index++) {
      const angle = Math.PI / 6 + index * Math.PI / 3;
      const px = x + Math.cos(angle); const pz = z + Math.sin(angle);
      const id = cornerKey(px, pz);
      const corner = corners.get(id) ?? { x: px, z: pz, heights: [] };
      corner.heights.push(tile.height); corners.set(id, corner);
    }
  }
  return ordered.map(tile => {
    const { x, z } = hexPosition(tile.q, tile.r);
    const center: TerrainPoint = [x, tile.height, z];
    const rim: TerrainPoint[] = Array.from({ length: 6 }, (_, index) => {
      const angle = Math.PI / 6 + index * Math.PI / 3;
      const corner = corners.get(cornerKey(x + Math.cos(angle), z + Math.sin(angle)));
      return corner ? [corner.x, corner.heights.reduce((sum, height) => sum + height, 0) / corner.heights.length, corner.z] : center;
    });
    const color = landscapeSurface(tile);
    const faces = rim.map((point, index): TerrainFace => ({ key: `${key(tile)}:face:${index}`, points: [center, point, rim[(index + 1) % 6] ?? point],
      color: shadeColor(color, 1 + Math.cos(index * Math.PI / 3 + 2.4) * .012 + (noise(tile.q, tile.r, index + 4) - .5) * .008) }));
    const cliffs = NEIGHBORS.flatMap(([dq, dr], index): TerrainFace[] => {
      if (lookup.has(`${tile.q + dq},${tile.r + dr}`)) return [];
      const a = rim[(index + 5) % 6]; const b = rim[index];
      return a && b ? [{ key: `${key(tile)}:${index}`, points: [a, b, [b[0], 0, b[2]], [a[0], 0, a[2]]],
        color: shadeColor('#a6a17b', .82 + Math.cos(index * Math.PI / 3 + 2.4) * .13) }] : [];
    });
    return { key: key(tile), center, rim, faces, cliffs };
  });
}

function terrainParts(tile: LandscapeTile, detail: DetailLevel): VisualPart[] {
  const { x, z } = hexPosition(tile.q, tile.r);
  const count = tile.terrain === 'forest' ? detail === 'far' ? 3 : detail === 'mid' ? 5 : 7 : tile.terrain === 'mountain' ? detail === 'far' ? 2 : 3 : 0;
  const parts: VisualPart[] = [];
  for (let index = 0; index < count; index++) {
    const angle = index * 2.4 + noise(tile.q, tile.r, 0) * 3;
    const offset = index === 0 ? .08 : .22 + noise(tile.q, tile.r, index + 2) * .4;
    const forest = tile.terrain === 'forest';
    const desert = tile.terrain === 'desert';
    const height = forest ? .5 + noise(tile.q, tile.r, index) * .46 : desert ? .08 : .85 + tile.height * 1.7 + noise(tile.q, tile.r, index) * .45;
    const width = forest ? .48 + noise(tile.q, tile.r, index + 1) * .24 : desert ? 1.1 : index === 0 ? 1.6 : 1.05;
    const px = x + Math.cos(angle) * offset; const pz = z + Math.sin(angle) * offset;
    parts.push({ id: `${tile.terrain}:${key(tile)}:${index}`, shape: forest || desert ? 'canopy' : 'cone',
      material: forest ? index % 3 ? 'canopy' : 'canopyLight' : desert ? 'grain' : index % 2 ? 'rockLight' : 'rock',
      position: [px, tile.height + height / 2, pz], scale: [width, height, width * (forest ? .9 : .8)], rotation: noise(tile.q, tile.r, index) * Math.PI });
    if (forest && detail !== 'far') parts.push({ id: `forest:${key(tile)}:trunk:${index}`, shape: 'box', material: 'timber',
      position: [px, tile.height + .18, pz], scale: [.08, .36, .08], rotation: angle });
    if (!forest && !desert && index === 0) parts.push({ id: `mountain:${key(tile)}:summit`, shape: 'cone', material: 'neutral',
      position: [px, tile.height + height * .88, pz], scale: [width * .24, height * .24, width * .8 * .24], rotation: noise(tile.q, tile.r, index) * Math.PI });
  }
  return parts;
}

export function projectLandscape(tiles: readonly LandscapeTile[], towns: readonly LandscapeTown[], detail: DetailLevel): LandscapeProjection {
  const ordered = tiles.toSorted(order);
  const lookup = new Map(ordered.map(tile => [key(tile), tile]));
  const surfaces = new Map(projectTerrainSurface(ordered).map(tile => [tile.key, tile]));
  const townSites = new Set(towns.map(key));
  const coast: LandscapeEdge[] = [];
  const borders: LandscapeEdge[] = [];
  const territories: LandscapeTerritory[] = [];
  for (const tile of ordered) {
    const { x, z } = hexPosition(tile.q, tile.r);
    if (tile.owner !== null) territories.push({ key: key(tile), owner: tile.owner, height: tile.height + .012,
      points: Array.from({ length: 6 }, (_, index) => {
        const angle = index * Math.PI / 3 + Math.PI / 6;
        return [x + Math.cos(angle) * .99, z + Math.sin(angle) * .99] as const;
      }) });
    for (const [index, [dq, dr]] of NEIGHBORS.entries()) {
      const neighbor = lookup.get(`${tile.q + dq},${tile.r + dr}`);
      const a = index * Math.PI / 3 - Math.PI / 6;
      const b = a + Math.PI / 3;
      const edge: LandscapeEdge = { key: `${key(tile)}:${index}`, owner: tile.owner,
        from: [x + Math.cos(a), z + Math.sin(a)], to: [x + Math.cos(b), z + Math.sin(b)], height: Math.max(tile.height, neighbor?.height ?? 0) + .035 };
      if (!neighbor) coast.push(edge);
      if (tile.owner !== null && neighbor?.owner !== tile.owner) borders.push({ ...edge,
        from: [x + Math.cos(a) * .98, z + Math.sin(a) * .98], to: [x + Math.cos(b) * .98, z + Math.sin(b) * .98],
        fromHeight: (surfaces.get(key(tile))?.rim[(index + 5) % 6]?.[1] ?? tile.height) * .98 + tile.height * .02 + .035,
        toHeight: (surfaces.get(key(tile))?.rim[index]?.[1] ?? tile.height) * .98 + tile.height * .02 + .035 });
    }
  }
  const parts: VisualPart[] = towns.toSorted(order).flatMap((town): VisualPart[] => {
    const tile = lookup.get(key(town));
    if (!tile) return [];
    const { x, z } = hexPosition(town.q, town.r);
    const radius = populationFootprint(town.population ?? 1) * (town.population === undefined ? 1 : SETTLEMENT_RENDER_SCALE);
    return [{ id: `ground:${key(town)}`, shape: 'cylinder', material: 'settled', position: [x, tile.height + .016, z], scale: [radius * 2.3, .025, radius * 1.9], rotation: .15 }];
  }).slice(0, LANDSCAPE_BUDGETS[detail]);
  const groups = ordered.filter(tile => !townSites.has(key(tile))).map(tile => terrainParts(tile, detail));
  for (let index = 0; index < 14 && parts.length < LANDSCAPE_BUDGETS[detail]; index++) {
    for (const group of groups) {
      const part = group[index];
      if (part && parts.length < LANDSCAPE_BUDGETS[detail]) parts.push(part);
    }
  }
  return { coast, borders, territories, parts };
}
