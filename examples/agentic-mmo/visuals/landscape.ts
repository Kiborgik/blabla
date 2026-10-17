import { populationFootprint } from './world-visuals.ts';
import type { DetailLevel, VisualPart } from './world-visuals.ts';

export interface LandscapeTile { q: number; r: number; owner: number | null; terrain: 'grassland' | 'forest' | 'desert' | 'mountain' | 'tundra'; height: number }
export interface LandscapeTown { q: number; r: number; population?: number }
export interface LandscapeEdge { key: string; owner: number | null; from: readonly [number, number]; to: readonly [number, number]; height: number }
export interface LandscapeProjection { coast: LandscapeEdge[]; borders: LandscapeEdge[]; parts: VisualPart[] }
export const LANDSCAPE_BUDGETS = { far: 384, mid: 768, close: 1152 } as const;
export const LANDSCAPE_COLORS = { grassland: '#94a773', forest: '#7e9863', desert: '#d3b077', mountain: '#9b9b84', tundra: '#b8bcb0', water: '#133f58', shallow: '#387c87', shore: '#c5be8a' } as const;
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

function terrainParts(tile: LandscapeTile, detail: DetailLevel): VisualPart[] {
  const { x, z } = hexPosition(tile.q, tile.r);
  const count = tile.terrain === 'forest' ? detail === 'far' ? 2 : detail === 'mid' ? 3 : 5 : tile.terrain === 'mountain' ? detail === 'far' ? 1 : 2 : 0;
  return Array.from({ length: count }, (_, index) => {
    const angle = index * 2.4 + noise(tile.q, tile.r, 0) * 3;
    const offset = index === 0 ? .1 : .42;
    const forest = tile.terrain === 'forest';
    const height = forest ? .54 + noise(tile.q, tile.r, index) * .3 : .8 + tile.height * 2 + noise(tile.q, tile.r, index) * .25;
    const width = forest ? .65 + noise(tile.q, tile.r, index + 1) * .18 : index === 0 ? 1.45 : .9;
    return { id: `${tile.terrain}:${key(tile)}:${index}`, shape: forest ? 'canopy' : 'cone',
      material: forest ? index % 2 ? 'canopyLight' : 'canopy' : index % 2 ? 'rockLight' : 'rock',
      position: [x + Math.cos(angle) * offset, tile.height + height / 2, z + Math.sin(angle) * offset],
      scale: [width, height, width], rotation: noise(tile.q, tile.r, index) * Math.PI };
  });
}

export function projectLandscape(tiles: readonly LandscapeTile[], towns: readonly LandscapeTown[], detail: DetailLevel): LandscapeProjection {
  const ordered = tiles.toSorted(order);
  const lookup = new Map(ordered.map(tile => [key(tile), tile]));
  const townSites = new Set(towns.map(key));
  const coast: LandscapeEdge[] = [];
  const borders: LandscapeEdge[] = [];
  for (const tile of ordered) {
    const { x, z } = hexPosition(tile.q, tile.r);
    for (const [index, [dq, dr]] of NEIGHBORS.entries()) {
      const neighbor = lookup.get(`${tile.q + dq},${tile.r + dr}`);
      const a = index * Math.PI / 3 - Math.PI / 6;
      const b = a + Math.PI / 3;
      const edge: LandscapeEdge = { key: `${key(tile)}:${index}`, owner: tile.owner,
        from: [x + Math.cos(a), z + Math.sin(a)], to: [x + Math.cos(b), z + Math.sin(b)], height: Math.max(tile.height, neighbor?.height ?? 0) + .035 };
      if (!neighbor) coast.push(edge);
      if (tile.owner !== null && neighbor?.owner !== tile.owner) borders.push({ ...edge,
        from: [x + Math.cos(a) * .95, z + Math.sin(a) * .95], to: [x + Math.cos(b) * .95, z + Math.sin(b) * .95] });
    }
  }
  const parts: VisualPart[] = towns.toSorted(order).flatMap((town): VisualPart[] => {
    const tile = lookup.get(key(town));
    if (!tile) return [];
    const { x, z } = hexPosition(town.q, town.r);
    const radius = populationFootprint(town.population ?? 1);
    return [{ id: `ground:${key(town)}`, shape: 'cylinder', material: 'settled', position: [x, tile.height + .016, z], scale: [radius * 2.3, .025, radius * 1.9], rotation: .15 }];
  }).slice(0, LANDSCAPE_BUDGETS[detail]);
  const groups = ordered.filter(tile => !townSites.has(key(tile))).map(tile => terrainParts(tile, detail));
  for (let index = 0; index < 5 && parts.length < LANDSCAPE_BUDGETS[detail]; index++) {
    for (const group of groups) {
      const part = group[index];
      if (part && parts.length < LANDSCAPE_BUDGETS[detail]) parts.push(part);
    }
  }
  return { coast, borders, parts };
}
