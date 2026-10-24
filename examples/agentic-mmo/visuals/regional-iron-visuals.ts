import { regionalIronComponents } from '../core/regional-iron.ts';
import type { WorldState } from '../core/types.ts';
import { projectDrainage } from './drainage-visuals.ts';
import { hexPosition, projectTerrainSurface } from './landscape.ts';
import type { TerrainPoint, TerrainSurface } from './landscape.ts';
import { mapTileHeight } from './route-paths.ts';
import type { DepositView } from './strategic-resource-visuals.ts';
import type { DetailLevel, VisualPart } from './world-visuals.ts';

type Footprint = { x: number; z: number; width: number; depth: number; rotation: number };
type Contact = { low: number; high: number };
export interface RegionalIronNeighbor {
  tileId: number;
  dq: number;
  dr: number;
  join: (Footprint & { bottom: number; top: number }) | null;
}
export interface RegionalIronVisualFacts {
  seed: number;
  surface: TerrainSurface;
  neighbors: readonly RegionalIronNeighbor[];
}
export const REGIONAL_IRON_PART_BUDGETS = { far: 5, mid: 8, close: 12 } as const;

function groundContact(surface: TerrainSurface, footprint: Footprint, shape: 'box' | 'canopy' = 'box'): Contact | null {
  const cosine = Math.cos(footprint.rotation); const sine = Math.sin(footprint.rotation);
  const corners: Array<readonly [number, number]> = shape === 'canopy'
    ? Array.from({ length: 6 }, (_, index) => [Math.cos(index * Math.PI / 3) * footprint.width / 2, Math.sin(index * Math.PI / 3) * footprint.depth / 2])
    : [[-footprint.width / 2, -footprint.depth / 2], [footprint.width / 2, -footprint.depth / 2], [footprint.width / 2, footprint.depth / 2], [-footprint.width / 2, footprint.depth / 2]];
  const perimeter = corners.map(([x, z]) => [x * cosine + z * sine, -x * sine + z * cosine] as const);
  const planes = perimeter.map((point, index) => {
    const next = perimeter[(index + 1) % perimeter.length]!;
    const nx = next[1] - point[1]; const nz = point[0] - next[0];
    return [nx, nz, nx * point[0] + nz * point[1]] as const;
  });
  const expectedArea = Math.abs(perimeter.reduce((sum, point, index) => {
    const next = perimeter[(index + 1) % perimeter.length]!;
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
  let area = 0; let low = Infinity; let high = -Infinity;
  for (const face of surface.faces) {
    if (face.kind && face.kind !== 'ground') continue;
    for (let index = 1; index + 1 < face.points.length; index++) {
      let polygon: TerrainPoint[] = [face.points[0]!, face.points[index]!, face.points[index + 1]!];
      for (const [nx, nz, limit] of planes) {
        const input = polygon; polygon = [];
        for (const [pointIndex, a] of input.entries()) {
          const b = input[(pointIndex + 1) % input.length]!;
          const da = (a[0] - footprint.x) * nx + (a[2] - footprint.z) * nz - limit;
          const db = (b[0] - footprint.x) * nx + (b[2] - footprint.z) * nz - limit;
          if (da <= 0) polygon.push(a);
          if ((da <= 0) !== (db <= 0)) {
            const t = da / (da - db);
            polygon.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
          }
        }
      }
      const covered = Math.abs(polygon.reduce((sum, point, pointIndex) => {
        const next = polygon[(pointIndex + 1) % polygon.length]!;
        return sum + (point[0] - footprint.x) * (next[2] - footprint.z) - (next[0] - footprint.x) * (point[2] - footprint.z);
      }, 0)) / 2;
      if (covered < 1e-14) continue;
      area += covered;
      for (const point of polygon) { low = Math.min(low, point[1]); high = Math.max(high, point[1]); }
    }
  }
  return Number.isFinite(low) && Math.abs(area - expectedArea) < 1e-9 ? { low, high } : null;
}

function joinFootprint(from: DepositView, to: DepositView, seed: number): Footprint {
  const origin = hexPosition(from.q, from.r); const target = hexPosition(to.q, to.r);
  const dx = target.x - origin.x; const dz = target.z - origin.z; const length = Math.hypot(dx, dz);
  const order = from.tileId < to.tileId ? 1 : -1;
  const tangent = [-dz / length * order, dx / length * order] as const;
  const first = Math.min(from.tileId, to.tileId); const second = Math.max(from.tileId, to.tileId);
  const sign = sample(seed, first, second, 'edge-side') < .5 ? -1 : 1;
  const edgeOffset = sign * (.09 + sample(seed, first, second, 'edge-offset') * .04);
  const innerOffset = -sign * (.07 + sample(seed, from.tileId, to.tileId, 'inner-offset') * .06);
  const start = [origin.x + dx / length * .20 + tangent[0] * innerOffset, origin.z + dz / length * .20 + tangent[1] * innerOffset] as const;
  const end = [(origin.x + target.x) / 2 + tangent[0] * edgeOffset, (origin.z + target.z) / 2 + tangent[1] * edgeOffset] as const;
  return { x: (start[0] + end[0]) / 2, z: (start[1] + end[1]) / 2,
    width: Math.hypot(end[0] - start[0], end[1] - start[1]), depth: .25 + sample(seed, from.tileId, to.tileId, 'edge-width') * .08,
    rotation: -Math.atan2(end[1] - start[1], end[0] - start[0]) };
}

export function projectRegionalIron(state: WorldState, views: DepositView[]): DepositView[] {
  const layer = state.strategicDeposits;
  if (layer?.placementId !== 'regional-iron-1') return views;
  const visible = new Map(views.filter(view => view.resource === 'iron' && layer.tileIds.includes(view.tileId)).map(view => [view.tileId, view]));
  if (!visible.size) return views.filter(view => view.resource !== 'iron');
  const surfaces = new Map(projectTerrainSurface(state.tiles.flatMap(tile => tile.terrain === 'ocean' ? [] : [{ ...tile, terrain: tile.terrain,
    q: tile.q - (state.width - 1) / 2, r: tile.r - (state.height - 1) / 2, height: mapTileHeight(tile.elevation) }]), projectDrainage(state)).map(surface => [surface.key, surface]));
  const components = regionalIronComponents([...visible.keys()], state.width, state.height);
  return views.filter(view => view.resource !== 'iron' || visible.has(view.tileId)).map(view => {
    if (!visible.has(view.tileId)) return view;
    const surface = surfaces.get(`${view.q},${view.r}`);
    if (!surface) return view;
    const members = components.find(component => component.includes(view.tileId)) ?? [];
    const neighbors = members.flatMap((tileId): RegionalIronNeighbor[] => {
      const other = visible.get(tileId)!; const dq = other.q - view.q; const dr = other.r - view.r;
      if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) !== 1) return [];
      const targetSurface = surfaces.get(`${other.q},${other.r}`)!;
      const footprint = joinFootprint(view, other, layer.seed); const target = joinFootprint(other, view, layer.seed);
      const local = groundContact(surface, footprint, 'canopy'); const opposite = groundContact(targetSurface, target, 'canopy');
      return [{ tileId, dq, dr, join: local && opposite ? { ...footprint, bottom: Math.min(local.low, opposite.low) - .008, top: Math.max(local.high, opposite.high) + .07 } : null }];
    });
    return { ...view, regionalIron: { seed: layer.seed, surface, neighbors } };
  });
}

function sample(seed: number, tileId: number, index: number, channel: string): number {
  const text = JSON.stringify(['regional-iron-visuals-1', seed, tileId, index, channel]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0) / 4294967296;
}

export function regionalIronParts(view: DepositView, detail: DetailLevel): VisualPart[] {
  const facts = view.regionalIron;
  if (!facts || view.resource !== 'iron') return [];
  const origin = hexPosition(view.q, view.r); const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], plot: Footprint, bottom: number, top: number): void => {
    parts.push({ id: `${view.id}:${id}`, shape, material, position: [plot.x - origin.x, (bottom + top) / 2 - view.height, plot.z - origin.z],
      scale: [plot.width, top - bottom, plot.depth], rotation: plot.rotation });
  };
  for (const neighbor of facts.neighbors) if (neighbor.join) add(`join-${neighbor.tileId}`, 'canopy', 'timber', neighbor.join, neighbor.join.bottom, neighbor.join.top);
  const count = detail === 'far' ? 2 : detail === 'mid' ? 3 : 4;
  const ratio = Math.max(0, Math.min(1, view.remaining / Math.max(1, view.initialReserve)));
  const orientation = (sample(facts.seed, view.tileId, 0, 'orientation') - .5) * .6;
  for (let index = 0; index < count; index++) {
    const random = (channel: string): number => sample(facts.seed, view.tileId, index, channel);
    const center = [[-.1, -.15], [.11, .12], [-.16, .24], [.17, -.25]][index]!;
    const width = [.66, .55, .36, .32][index]! - random('length') * .06;
    const depth = .25 + random('depth') * .10;
    const rotation = orientation + (random('turn') - .5) * 1.4;
    let chosen: (Footprint & Contact) | null = null;
    for (const factor of [1, .7]) {
      for (const [x, z] of [center, [-.22, -.22], [.22, .22], [-.22, .22], [.22, -.22]]) {
        const plot = { x: origin.x + x!, z: origin.z + z!, width: width * factor, depth: depth * factor, rotation };
        const extentX = Math.abs(Math.cos(rotation)) * plot.width / 2 + Math.abs(Math.sin(rotation)) * plot.depth / 2;
        const extentZ = Math.abs(Math.sin(rotation)) * plot.width / 2 + Math.abs(Math.cos(rotation)) * plot.depth / 2;
        if (Math.abs(x!) + extentX > .55 || Math.abs(z!) + extentZ > .45) continue;
        const contact = groundContact(facts.surface, plot);
        if (contact) { chosen = { ...plot, ...contact }; break; }
      }
      if (chosen) break;
    }
    if (!chosen) continue;
    const top = chosen.high + .07 + random('height') * .07;
    add(`stratum-${index}`, 'canopy', index % 3 === 2 ? 'soil' : 'timber', chosen, chosen.low - .008, top);
    if (ratio > 0) add(`vein-${index}`, 'gable', 'roof', { ...chosen, width: chosen.width * .73 * ratio, depth: chosen.depth * .55 }, top - .035, top + .018);
  }
  const chips = detail === 'far' ? 0 : detail === 'mid' ? 1 : 3;
  for (let index = 0; index < chips; index++) {
    const x = [-.37, .34, -.3][index]!; const z = [.04, -.04, -.31][index]!;
    const plot = { x: origin.x + x, z: origin.z + z, width: .10 + sample(facts.seed, view.tileId, index, 'chip') * .04, depth: .08, rotation: orientation + index * .7 };
    const contact = groundContact(facts.surface, plot);
    if (contact) add(`chip-${index}`, 'gable', 'soil', plot, contact.low - .005, contact.high + .045);
  }
  return parts;
}
