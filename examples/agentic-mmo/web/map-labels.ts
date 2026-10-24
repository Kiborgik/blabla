import { spectatorObstacles, SPECTATOR_OBSTACLES } from './spectator-layout.ts';
import { hierarchyCaption, type HierarchyAnchor, type ScreenBox } from '../visuals/map-hierarchy.ts';
import { districtParts, districtLabel } from '../visuals/district-visuals.ts';
import { damageMapLabel } from '../visuals/damage-visuals.ts';
import { routeLabelKey, routeMapLabel } from '../visuals/route-visuals.ts';
import { hexPosition, routeMapAnchor, type AtlasWorld } from './atlas.ts';
import { cityKey } from './city-selection.ts';
import { settlementVisual, settlementDetail, SETTLEMENT_RENDER_SCALE, DETAIL_BUDGETS } from '../visuals/world-visuals.ts';
import type { DetailLevel, VisualPart, SettlementFacts } from '../visuals/world-visuals.ts';
import { improvementParts } from '../visuals/improvement-visuals.ts';
import { prepareSiteOverlayGeometry, projectSiteOverlayGeometry, type SiteOverlayGeometry, type ProjectedSiteOverlay } from './site-overlay-geometry.ts';

export interface MapLabel { id: string | number; x: number; y: number; width: number; height: number }

export function mapLabelVisibility(labels: readonly MapLabel[], selected: string | number, detail: DetailLevel, width: number, height: number): boolean[] {
  const visible = labels.map(() => false);
  const chosen = labels.findIndex((label) => label.id === selected);
  const order = labels.map((_, index) => index).toSorted((a, b) => Number(b === chosen) - Number(a === chosen));
  const occupied: MapLabel[] = [];
  for (const index of order) {
    const label = labels[index];
    if (!label || occupied.length >= DETAIL_BUDGETS[detail].labels) continue;
    if (label.x + label.width / 2 < 0 || label.x - label.width / 2 > width || label.y + label.height < 0 || label.y > height) continue;
    if (index !== chosen && occupied.some((other) => Math.abs(label.x - other.x) < (label.width + other.width) / 2 + 6 && Math.abs(label.y - other.y) < Math.max(label.height, other.height) + 4)) continue;
    occupied.push(label);
    visible[index] = true;
  }
  return visible;
}

const townGeometry = new WeakMap<SettlementFacts, Map<DetailLevel, SiteOverlayGeometry>>();

function townArchitectureBounds(city: AtlasWorld['cities'][number], height: number, project: (q: number, r: number, height: number) => { x: number; y: number }): ProjectedSiteOverlay | null {
  const facts = city.settlement;
  if (!facts) return null;
  const origin = project(city.q, city.r, height);
  const diameter = project(city.q + 2 / Math.sqrt(3), city.r, height);
  const detail = settlementDetail(Math.hypot(diameter.x - origin.x, diameter.y - origin.y));
  let cache = townGeometry.get(facts);
  if (!cache) { cache = new Map(); townGeometry.set(facts, cache); }
  let geometry = cache.get(detail);
  if (!geometry) {
    const visual = settlementVisual(facts, detail);
    geometry = prepareSiteOverlayGeometry(visual.parts);
    cache.set(detail, geometry);
  }
  return projectSiteOverlayGeometry(geometry, ([x, y, z]) => project(
    city.q + (x / Math.sqrt(3) - z / 3) * SETTLEMENT_RENDER_SCALE,
    city.r + z / 1.5 * SETTLEMENT_RENDER_SCALE, height + y * SETTLEMENT_RENDER_SCALE));
}

export function mapHierarchyAnchors(world: AtlasWorld, selected: string, selectedRoute: string | null, project: (q: number, r: number, height: number) => { x: number; y: number }, context: { geometry?: ReadonlyMap<string, ProjectedSiteOverlay>; focusedId?: string | null } = {}): HierarchyAnchor[] {
  const civilization = world.cities.find(city => cityKey(city) === selected)?.id;
  const anchors: HierarchyAnchor[] = world.cities.map(city => {
    const tile = world.tiles.find(tile => tile.q === city.q && tile.r === city.r);
    const tileId = tile?.id;
    const geometry = townArchitectureBounds(city, tile?.height ?? .4, project);
    return { id: cityKey(city), kind: 'town', ...(geometry?.bounds ? { protectedBounds: geometry.bounds } : {}), label: damageMapLabel(city.capital, city.settlement?.damage ?? 0),
      ...project(city.q, city.r, tile?.height ?? .4), selected: cityKey(city) === selected, focused: context.focusedId === cityKey(city), importance: city.population ?? 0,
      ...(tileId === undefined ? {} : { tileId }) };
  });
  for (const site of [...world.catchments ?? [], ...world.districts ?? [], ...world.improvements ?? [], ...world.wonders ?? []]) {
    const wonder = 'record' in site;
    const label = 'library' in site ? districtLabel(site) : 'name' in site ? site.name ?? 'Campus' : 'Aqueduct source';
    const geometry = context.geometry?.get(site.id);
    anchors.push({ id: site.id, kind: wonder ? 'wonder' : 'site', shortLabel: 'library' in site ? site.name ?? 'Campus' : 'name' in site ? site.name : 'Aqueduct source',
      ...(geometry?.bounds ? { protectedBounds: geometry.bounds } : {}), ...(geometry?.reason ? { geometryReason: geometry.reason } : {}), focused: context.focusedId === site.id, label: `${label}${site.status === 'building' && !('library' in site) ? ' · Building' : ''}${site.cityId === selected && world.acquiredLand?.some(plot => plot.receipt.cityId === selected && plot.receipt.tileId === site.tileId) ? ` · Tile ${site.tileId}` : ''}`,
      ...project(site.q, site.r, site.height), tileId: site.tileId, related: site.cityId === selected, completed: wonder && site.status === 'built' });
  }
  for (const site of world.pastoralSites ?? []) anchors.push({ id: site.id, kind: 'resource', label: 'Horses', ...project(site.q, site.r, site.height), tileId: site.tileId,
    revealed: civilization !== undefined && site.revealedTo.includes(civilization) });
  for (const site of world.deposits ?? []) anchors.push({ id: site.id, kind: 'resource', label: `Iron · ${site.remaining} left`, ...project(site.q, site.r, site.height), tileId: site.tileId,
    revealed: civilization !== undefined && site.revealedTo.some(entry => entry.id === civilization) });
  const route = world.routes.find(entry => entry.id === selectedRoute);
  const point = route && routeMapAnchor(route);
  if (route && point) {
    const axial = { r: point.z / 1.5, q: point.x / Math.sqrt(3) - point.z / 3 };
    anchors.push({ id: routeLabelKey(route.id), kind: 'route', label: routeMapLabel(route), ...project(axial.q, axial.r, point.y), related: true });
  }
  return anchors;
}

export function mapHierarchyObstacles(container: HTMLElement): ScreenBox[] {
  return spectatorObstacles(container);
}

export interface SiteOverlaySource {
  id: string;
  kind: 'district' | 'improvement';
  q: number;
  r: number;
  height: number;
  color: string;
  parts: (detail: DetailLevel) => VisualPart[];
  geometry: (detail: DetailLevel) => SiteOverlayGeometry;
}

export function createSiteOverlaySources(world: AtlasWorld): SiteOverlaySource[] {
  const entries = [
    ...(world.districts ?? []).map(site => ({ site, kind: 'district' as const, recipe: (detail: DetailLevel) => districtParts(site, detail) })),
    ...(world.improvements ?? []).map(site => ({ site, kind: 'improvement' as const, recipe: (detail: DetailLevel) => improvementParts(site, detail) })),
  ];
  return entries.map(({ site, kind, recipe }) => {
    const cache = new Map<DetailLevel, { parts: VisualPart[]; geometry: SiteOverlayGeometry }>();
    const get = (detail: DetailLevel): { parts: VisualPart[]; geometry: SiteOverlayGeometry } => {
      let entry = cache.get(detail);
      if (!entry) { const parts = recipe(detail); entry = { parts, geometry: prepareSiteOverlayGeometry(parts) }; cache.set(detail, entry); }
      return entry;
    };
    return { id: site.id, kind, q: site.q, r: site.r, height: site.height, color: site.color,
      parts: detail => get(detail).parts, geometry: detail => get(detail).geometry };
  });
}

export function projectMapSiteGeometry(sources: readonly SiteOverlaySource[], detail: DetailLevel, project: (x: number, y: number, z: number) => { x: number; y: number }, viewport: { width: number; height: number }): Map<string, ProjectedSiteOverlay> {
  const zero = project(0, 0, 0);
  const axes = [project(1, 0, 0), project(0, 1, 0), project(0, 0, 1)].map(point => ({ x: point.x - zero.x, y: point.y - zero.y }));
  const affine = (x: number, y: number, z: number): { x: number; y: number } => ({
    x: zero.x + x * axes[0]!.x + y * axes[1]!.x + z * axes[2]!.x,
    y: zero.y + x * axes[0]!.y + y * axes[1]!.y + z * axes[2]!.y,
  });
  const spread = { x: axes.reduce((sum, point) => sum + Math.abs(point.x), 0), y: axes.reduce((sum, point) => sum + Math.abs(point.y), 0) };
  const result = new Map<string, ProjectedSiteOverlay>();
  for (const source of sources) {
    const geometry = source.geometry(detail);
    const origin = hexPosition(source.q, source.r);
    const point = affine(origin.x, source.height, origin.z);
    if (point.x + geometry.radius * spread.x < 0 || point.x - geometry.radius * spread.x > viewport.width
      || point.y + geometry.radius * spread.y < 0 || point.y - geometry.radius * spread.y > viewport.height) continue;
    result.set(source.id, projectSiteOverlayGeometry(geometry, ([x, y, z]) => affine(origin.x + x, source.height + y, origin.z + z)));
  }
  return result;
}

export function createMapCaptionMeasure(): (anchors: HierarchyAnchor[], width: number) => HierarchyAnchor[] {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext?.('2d');
  const widths = new Map<string, number>();
  return (anchors, width) => anchors.map(anchor => {
    if (!context) return anchor;
    const font = `${anchor.selected && anchor.kind === 'town' ? 14 : 12}px Arial, sans-serif`;
    const caption = hierarchyCaption(anchor.shortLabel ?? anchor.label, anchor.kind, width);
    const key = `${font}:${caption}`;
    let measured = widths.get(key);
    if (measured === undefined) { context.font = font; measured = context.measureText(caption).width; widths.set(key, measured); }
    return { ...anchor, captionWidth: measured };
  });
}

export function observeMapHierarchyObstacles(container: HTMLElement, changed: () => void): () => void {
  const shell = container.closest('#app') ?? container.parentElement;
  if (!shell) return () => {};
  const selector = SPECTATOR_OBSTACLES;
  const resize = new ResizeObserver(changed);
  const refresh = (): void => { resize.disconnect(); for (const element of shell.querySelectorAll(selector)) resize.observe(element); };
  refresh();
  const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(records => {
    if (!records.some(record => !container.contains(record.target) && (record.type === 'childList'
      || record.target instanceof Element && (record.target.matches(selector) || record.target.matches('.observatory, #app'))))) return;
    refresh(); changed();
  });
  mutation?.observe(shell, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-inspection'] });
  return () => { resize.disconnect(); mutation?.disconnect(); };
}
