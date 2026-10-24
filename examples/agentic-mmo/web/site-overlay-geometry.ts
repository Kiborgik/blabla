import type { VisualPart } from '../visuals/world-visuals.ts';
import type { ScreenBox } from '../visuals/map-hierarchy.ts';
import { transformedVertices, type Point3 } from './settlement-parts.ts';

export type { Point3 } from './settlement-parts.ts';
export interface SiteOverlayGeometry {
  readonly vertices: readonly Point3[];
  readonly radius: number;
  readonly reason: 'empty-geometry' | 'non-finite-geometry' | null;
}
export interface ProjectedSiteOverlay { bounds: ScreenBox | null; reason: string | null }

const projectedBounds = new WeakMap<SiteOverlayGeometry, Map<string, ScreenBox>>();

export function prepareSiteOverlayGeometry(parts: readonly VisualPart[]): SiteOverlayGeometry {
  const vertices = parts.flatMap(transformedVertices);
  const finite = vertices.every(vertex => vertex.every(Number.isFinite));
  return Object.freeze({ vertices: Object.freeze(finite ? vertices.map(vertex => Object.freeze(vertex)) : []),
    radius: finite ? vertices.reduce((radius, vertex) => Math.max(radius, ...vertex.map(Math.abs)), 0) : 0,
    reason: !finite ? 'non-finite-geometry' : vertices.length ? null : 'empty-geometry' });
}

export function projectSiteOverlayGeometry(geometry: SiteOverlayGeometry, project: (point: Point3) => { x: number; y: number }): ProjectedSiteOverlay {
  if (geometry.reason) return { bounds: null, reason: geometry.reason };
  const origin = project([0, 0, 0]);
  const axes = [project([1, 0, 0]), project([0, 1, 0]), project([0, 0, 1])];
  const basis = axes.flatMap(point => [point.x - origin.x, point.y - origin.y]);
  if (![origin.x, origin.y, ...basis].every(Number.isFinite)) return { bounds: null, reason: 'non-finite-projection' };
  const scale = Math.max(...basis.map(Math.abs));
  if (scale <= 0) return { bounds: null, reason: 'degenerate-projection' };
  const normalized = basis.map(value => Number((value / scale).toFixed(10)));
  const key = normalized.join(',');
  let cache = projectedBounds.get(geometry);
  if (!cache) { cache = new Map(); projectedBounds.set(geometry, cache); }
  let local = cache.get(key);
  if (!local) {
    let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
    for (const [x, y, z] of geometry.vertices) {
      const px = x * (normalized[0] ?? 0) + y * (normalized[2] ?? 0) + z * (normalized[4] ?? 0);
      const py = x * (normalized[1] ?? 0) + y * (normalized[3] ?? 0) + z * (normalized[5] ?? 0);
      left = Math.min(left, px); right = Math.max(right, px); top = Math.min(top, py); bottom = Math.max(bottom, py);
    }
    local = { left, top, width: right - left, height: bottom - top };
    if (cache.size >= 4) cache.delete(cache.keys().next().value ?? '');
    cache.set(key, local);
  }
  const padding = scale * (.001 + geometry.radius * 4e-10) + 1e-7;
  const bounds = { left: origin.x + local.left * scale - padding, top: origin.y + local.top * scale - padding,
    width: local.width * scale + padding * 2, height: local.height * scale + padding * 2 };
  return Object.values(bounds).every(Number.isFinite) ? { bounds, reason: null } : { bounds: null, reason: 'non-finite-projection' };
}
