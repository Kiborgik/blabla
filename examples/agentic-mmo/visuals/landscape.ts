import type { DrainageEdgeView, DrainageView } from './drainage-visuals.ts';
import { populationFootprint, SETTLEMENT_RENDER_SCALE } from './world-visuals.ts';
import type { DetailLevel, VisualPart } from './world-visuals.ts';

export interface LandscapeTile { id?: number; q: number; r: number; owner: number | null; terrain: 'grassland' | 'forest' | 'desert' | 'mountain' | 'tundra'; height: number }
export interface LandscapeTown { q: number; r: number; population?: number; improvementId?: string; tileId?: number; worldSeed?: number }
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
export interface TerrainFace { key: string; points: TerrainPoint[]; color: string; kind?: 'ground' | 'bank' | 'channel'; drainageEdgeId?: string }
export interface TerrainSurface { key: string; center: TerrainPoint; rim: TerrainPoint[]; edgeRims: TerrainPoint[][]; faces: TerrainFace[]; cliffs: TerrainFace[] }

function shadeColor(color: string, amount: number): string {
  return `#${[1, 3, 5].map(offset => Math.max(0, Math.min(255, Math.round(Number.parseInt(color.slice(offset, offset + 2), 16) * amount))).toString(16).padStart(2, '0')).join('')}`;
}

export const DRAINAGE_STYLE = { depth: .055, minHalfWidth: .055, maxHalfWidth: .11, bankWidth: .045, forestSetback: .025, water: '#477e7c', bank: '#5a6551' } as const;

function drainageWidth(count: number): number {
  return Math.max(DRAINAGE_STYLE.minHalfWidth, Math.min(DRAINAGE_STYLE.maxHalfWidth, DRAINAGE_STYLE.minHalfWidth + Math.log2(Math.max(8, count) / 8) * .018));
}

function cutTerrainSurfaces(surfaces: TerrainSurface[], tiles: readonly LandscapeTile[], drainage: DrainageView | null | undefined): TerrainSurface[] {
  if (drainage?.kind !== 'retained' || !drainage.edges.length) return surfaces;
  const byKey = new Map(surfaces.map(surface => [surface.key, surface]));
  const byId = new Map(tiles.flatMap(tile => tile.id === undefined ? [] : [[tile.id, { tile, surface: byKey.get(key(tile))! }] as const]));
  type Cut = { edge: DrainageEdgeView; rim: TerrainPoint[]; width: number };
  const cuts = new Map<string, Map<number, Cut>>();
  const setCut = (surface: TerrainSurface, direction: number, cut: Cut): void => {
    const local = cuts.get(surface.key) ?? new Map<number, Cut>();
    local.set(direction, cut); cuts.set(surface.key, local); surface.edgeRims[direction] = cut.rim;
  };
  for (const edge of drainage.edges) {
    const source = byId.get(edge.fromTileId); const target = byId.get(edge.toTileId);
    if (!source || (!edge.mouth && !target)) continue;
    const [start, end] = edge.points;
    const direction = (Math.round(Math.atan2(end[2] - start[2], end[0] - start[0]) / (Math.PI / 3)) + 6) % 6;
    const a = source.surface.rim[(direction + 5) % 6]!; const b = source.surface.rim[direction]!;
    const width = drainageWidth(edge.contributingLandTiles);
    const height = edge.mouth ? 0 : (start[1] + end[1]) / 2 - DRAINAGE_STYLE.depth;
    const point = (t: number, y?: number): TerrainPoint => [a[0] + (b[0] - a[0]) * t, y ?? a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const rim = [a, point(.5 - width - DRAINAGE_STYLE.bankWidth), point(.5 - width, height), point(.5 + width, height), point(.5 + width + DRAINAGE_STYLE.bankWidth), b];
    setCut(source.surface, direction, { edge, rim, width });
    if (target) setCut(target.surface, (direction + 3) % 6, { edge, rim: rim.toReversed(), width });
  }
  for (const surface of surfaces) {
    const local = cuts.get(surface.key);
    if (!local?.size) continue;
    const [x, height, z] = surface.center;
    const radius = Math.max(...[...local.values()].map(cut => cut.width));
    const waterCenter: TerrainPoint = [x, height - DRAINAGE_STYLE.depth, z];
    const inner: TerrainPoint[] = surface.rim.map(point => [x + (point[0] - x) * radius, waterCenter[1], z + (point[2] - z) * radius]);
    const outer: TerrainPoint[] = surface.rim.map(point => [x + (point[0] - x) * (radius + DRAINAGE_STYLE.bankWidth), height, z + (point[2] - z) * (radius + DRAINAGE_STYLE.bankWidth)]);
    const original = surface.faces;
    surface.faces = [];
    const face = (id: string, points: TerrainPoint[], kind: NonNullable<TerrainFace['kind']>, color: string, edge?: DrainageEdgeView): void => {
      surface.faces.push({ key: `${surface.key}:${id}`, points, kind, color, ...(edge ? { drainageEdgeId: edge.id } : {}) });
    };
    for (let direction = 0; direction < 6; direction++) {
      const a = (direction + 5) % 6; const b = direction;
      const cut = local.get(direction);
      const color = original[a]!.color;
      face(`join:${direction}`, [waterCenter, inner[a]!, inner[b]!], 'channel', DRAINAGE_STYLE.water);
      if (cut) {
        const [, leftBank, leftWater, rightWater, rightBank] = cut.rim;
        face(`channel:${direction}`, [inner[a]!, leftWater!, rightWater!, inner[b]!], 'channel', DRAINAGE_STYLE.water, cut.edge);
        face(`bank:${direction}:left`, [inner[a]!, outer[a]!, leftBank!, leftWater!], 'bank', DRAINAGE_STYLE.bank, cut.edge);
        face(`bank:${direction}:right`, [inner[b]!, rightWater!, rightBank!, outer[b]!], 'bank', DRAINAGE_STYLE.bank, cut.edge);
        face(`land:${direction}:left`, [outer[a]!, surface.rim[a]!, leftBank!], 'ground', color);
        face(`land:${direction}:right`, [outer[b]!, rightBank!, surface.rim[b]!], 'ground', color);
      } else {
        face(`bank:${direction}`, [inner[a]!, outer[a]!, outer[b]!, inner[b]!], 'bank', DRAINAGE_STYLE.bank);
        face(`land:${direction}`, [outer[a]!, surface.rim[a]!, surface.rim[b]!, outer[b]!], 'ground', color);
      }
    }
    surface.cliffs = surface.cliffs.flatMap(cliff => {
      const direction = Number(cliff.key.split(':').at(-1));
      const rim = surface.edgeRims[direction]!;
      return rim.slice(0, -1).flatMap((a, index): TerrainFace[] => {
        const b = rim[index + 1]!;
        if (a[1] === 0 && b[1] === 0) return [];
        return [{ key: `${cliff.key}:cut:${index}`, points: [a, b, [b[0], 0, b[2]], [a[0], 0, a[2]]], color: cliff.color }];
      });
    });
  }
  return surfaces;
}

export function projectTerrainSurface(tiles: readonly LandscapeTile[], drainage?: DrainageView | null): TerrainSurface[] {
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
  const surfaces = ordered.map(tile => {
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
    return { key: key(tile), center, rim, edgeRims: NEIGHBORS.map((_, index) => [rim[(index + 5) % 6]!, rim[index]!]), faces, cliffs };
  });
  return cutTerrainSurfaces(surfaces, ordered, drainage);
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

function charcoalForestParts(tile: LandscapeTile, site: LandscapeTown, detail: DetailLevel): VisualPart[] {
  const text = JSON.stringify(['charcoal-forest-v1', site.worldSeed ?? 0, site.tileId ?? key(tile)]);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  const orientation = (hash >>> 0) / 4294967296 * Math.PI;
  const { x, z } = hexPosition(tile.q, tile.r);
  return [0, 1].flatMap((index): VisualPart[] => {
    const angle = orientation + index * Math.PI;
    const px = x + Math.cos(angle) * .73; const pz = z + Math.sin(angle) * .73;
    const height = .4 + noise(tile.q, tile.r, index + 11) * .1;
    const width = .27 + noise(tile.q, tile.r, index + 17) * .04;
    const parts: VisualPart[] = [{ id: `charcoal-forest:${key(tile)}:${index}`, shape: 'canopy', material: index ? 'canopyLight' : 'canopy',
      position: [px, tile.height + height / 2, pz], scale: [width, height, width * .9], rotation: angle }];
    if (detail !== 'far') parts.push({ id: `charcoal-forest:${key(tile)}:trunk:${index}`, shape: 'box', material: 'timber',
      position: [px, tile.height + .1, pz], scale: [.045, .2, .045], rotation: angle });
    return parts;
  });
}

function forestOutsideChannels(tile: LandscapeTile, parts: VisualPart[], surfaces: ReadonlyMap<string, TerrainSurface>): VisualPart[] {
  const corridor = [[0, 0], ...NEIGHBORS].flatMap(([dq, dr]) => surfaces.get(`${tile.q + dq!},${tile.r + dr!}`)?.faces.filter(face => face.kind === 'channel' || face.kind === 'bank') ?? []);
  if (!corridor.length) return parts;
  const clear = (x: number, z: number, radius: number): boolean => !corridor.some(face => {
    let inside = false;
    for (let index = 0, previous = face.points.length - 1; index < face.points.length; previous = index++) {
      const a = face.points[previous]!; const b = face.points[index]!;
      if ((a[2] > z) !== (b[2] > z) && x < (b[0] - a[0]) * (z - a[2]) / (b[2] - a[2]) + a[0]) inside = !inside;
      const dx = b[0] - a[0]; const dz = b[2] - a[2];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz) < radius) return true;
    }
    return inside;
  });
  const groups = new Map<string, VisualPart[]>();
  for (const part of parts) {
    const id = `${part.position[0]},${part.position[2]}`;
    const group = groups.get(id) ?? []; group.push(part); groups.set(id, group);
  }
  const center = hexPosition(tile.q, tile.r);
  return [...groups.values()].flatMap((group, index) => {
    const first = group[0]!;
    const radius = Math.max(...group.map(part => Math.max(part.scale[0], part.scale[2]) / 2)) + DRAINAGE_STYLE.forestSetback;
    if (clear(first.position[0], first.position[2], radius)) return group;
    const angle = noise(tile.q, tile.r, index + 31) * Math.PI * 2;
    const candidates = [.46, .58, .7, .82].flatMap(distance => Array.from({ length: 24 }, (_, step) => ({ x: center.x + Math.cos(angle + step * Math.PI / 12) * distance, z: center.z + Math.sin(angle + step * Math.PI / 12) * distance })))
      .sort((a, b) => Math.hypot(a.x - first.position[0], a.z - first.position[2]) - Math.hypot(b.x - first.position[0], b.z - first.position[2]));
    const target = candidates.find(point => NEIGHBORS.every((_, direction) => (point.x - center.x) * Math.cos(direction * Math.PI / 3) + (point.z - center.z) * Math.sin(direction * Math.PI / 3) + radius - DRAINAGE_STYLE.forestSetback <= Math.sqrt(3) / 2) && clear(point.x, point.z, radius));
    if (!target) return [];
    return group.map(part => ({ ...part, position: [target.x, part.position[1], target.z] as const }));
  });
}

export function projectLandscape(tiles: readonly LandscapeTile[], towns: readonly LandscapeTown[], detail: DetailLevel, drainage?: DrainageView | null): LandscapeProjection {
  const ordered = tiles.toSorted(order);
  const lookup = new Map(ordered.map(tile => [key(tile), tile]));
  const surfaces = new Map(projectTerrainSurface(ordered, drainage).map(tile => [tile.key, tile]));
  const townSites = new Set(towns.map(key));
  const charcoalSites = new Map(towns.filter(site => site.improvementId === 'charcoal-clearing').map(site => [key(site), site]));
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
      if (!neighbor) {
        const rim = surfaces.get(key(tile))?.edgeRims[index] ?? [];
        if (rim.length > 2) {
          for (const [part, from, to] of [[0, rim[0]!, rim[2]!], [1, rim[3]!, rim[5]!]] as const) coast.push({ ...edge,
            key: `${edge.key}:${part}`, from: [from[0], from[2]], to: [to[0], to[2]] });
        } else coast.push(edge);
      }
      if (tile.owner !== null && neighbor?.owner !== tile.owner) {
        const rim = surfaces.get(key(tile))?.edgeRims[index] ?? [];
        for (let part = 0; part < rim.length - 1; part++) {
          if (rim.length > 2 && part >= 1 && part <= 3) continue;
          const start = rim[part]!; const end = rim[part + 1]!;
          borders.push({ ...edge, key: rim.length === 2 ? edge.key : `${edge.key}:${part}`,
            from: [x + (start[0] - x) * .98, z + (start[2] - z) * .98], to: [x + (end[0] - x) * .98, z + (end[2] - z) * .98],
            fromHeight: start[1] * .98 + tile.height * .02 + .035, toHeight: end[1] * .98 + tile.height * .02 + .035 });
        }
      }
    }
  }
  const parts: VisualPart[] = towns.toSorted(order).flatMap((town): VisualPart[] => {
    const tile = lookup.get(key(town));
    if (!tile || town.improvementId === 'charcoal-clearing') return [];
    const { x, z } = hexPosition(town.q, town.r);
    const radius = populationFootprint(town.population ?? 1) * (town.population === undefined ? 1 : SETTLEMENT_RENDER_SCALE);
    return [{ id: `ground:${key(town)}`, shape: 'cylinder', material: 'settled', position: [x, tile.height + .016, z], scale: [radius * 2.3, .025, radius * 1.9], rotation: .15 }];
  }).slice(0, LANDSCAPE_BUDGETS[detail]);
  const groups = ordered.flatMap(tile => {
    const charcoal = charcoalSites.get(key(tile));
    const parts = charcoal && tile.terrain === 'forest' ? charcoalForestParts(tile, charcoal, detail) : !townSites.has(key(tile)) ? terrainParts(tile, detail) : [];
    return [tile.terrain === 'forest' ? forestOutsideChannels(tile, parts, surfaces) : parts];
  });
  for (let index = 0; index < 14 && parts.length < LANDSCAPE_BUDGETS[detail]; index++) {
    for (const group of groups) {
      const part = group[index];
      if (part && parts.length < LANDSCAPE_BUDGETS[detail]) parts.push(part);
    }
  }
  return { coast, borders, territories, parts };
}
