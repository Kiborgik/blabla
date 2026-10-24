import { RIVER_INTAKE_MARK_PATH } from '../visuals/river-intake-visuals.ts';
import { selectedAcquiredLand } from '../visuals/territory-visuals.ts';
import { allocateMapHierarchy, fitMapOverview, mapContentWindow, type ScreenBox } from '../visuals/map-hierarchy.ts';
import { MAP_ZOOM } from './viewer-state.ts';
import { PASTORAL_MARK_PATH, CATCHMENT_MARK_PATH, pastoralSiteLabel } from '../visuals/pastoral-visuals.ts';
import { greatLibraryVisual, WONDER_MARK_PATH } from '../visuals/wonder-landmark.ts';
import { depositParts, depositLabel, SITE_MARK_PATHS } from '../visuals/strategic-resource-visuals.ts';
import { visibleRoutePaths } from '../visuals/route-paths.ts';
import { routeLabelKey, routeTitle, routeVisual, routeMapLabel } from '../visuals/route-visuals.ts';
import { damageMapLabel } from '../visuals/damage-visuals.ts';
import { cityKey, selectedCity } from './city-selection.ts';
import { projectTerrainSurface, projectLandscape, LANDSCAPE_COLORS, DRAINAGE_STYLE, TERRITORY_STYLE } from '../visuals/landscape.ts';
import { hexPosition, routeMapPositions, routeMapAnchor } from './atlas.ts';
import type { RouteView } from '../visuals/route-visuals.ts';
import type { AtlasWorld } from './atlas.ts';
import type { AtlasRenderer } from './renderer.ts';
import type { ViewerPreferences } from './viewer-state.ts';
import { resolveAppearance } from './viewer-appearance.ts';
import { cameraShiftForAnchor, unobscuredInspectionAnchor } from './inspection-camera.ts';
import { settlementVisual, SETTLEMENT_RENDER_SCALE, VISUAL_PALETTE, visualDetail, settlementDetail } from '../visuals/world-visuals.ts';
import { civilizationIdentity } from '../visuals/visual-language.ts';
import type { DetailLevel } from '../visuals/world-visuals.ts';
import { flatMapPoint, flatSceneFaces } from './settlement-parts.ts';
import { createWorldCues } from './world-cues.ts';
import { createSiteOverlaySources, projectMapSiteGeometry, createMapCaptionMeasure, observeMapHierarchyObstacles, mapHierarchyAnchors, mapHierarchyObstacles } from './map-labels.ts';
import { CHARCOAL_MARK_PATH, LUMBER_MARK_PATH } from '../visuals/improvement-visuals.ts';
import { SHORE_FISHERY_MARK_PATH } from '../visuals/shore-fishery-visuals.ts';
import { HILLSIDE_COMMONWORKS_MARK_PATH } from '../visuals/hillside-commonworks-visuals.ts';
import { borderPartyAnchor, borderPartyBadgeOffsets, borderPartyLabel, borderPartyWorldParts, borderTargetOutline, projectBorderParties } from '../visuals/border-visuals.ts';
import type { BorderIncidentView } from '../visuals/border-visuals.ts';
import { bindSiteInspection, mapInspectionSites, handoffSiteOverlayFocus, siteInspectionName, type SiteInspectionSelect } from './site-overlay-selection.ts';

export function cityScreenMetrics(pixelsPerUnit: number): { targetRadius: number; markerRadius: number; markerFont: number; labelFont: number; labelY: number } {
  const scale = Math.max(0.01, pixelsPerUnit);
  return {
    targetRadius: Math.max(0.85, 22 / scale),
    markerRadius: Math.max(0.7, 10 / scale),
    markerFont: Math.max(0.7, 12 / scale),
    labelFont: Math.max(0.55, 12 / scale),
    labelY: Math.max(0.7, 10 / scale) + 15 / scale,
  };
}

export function flatRoutePoints(route: RouteView, projected = false): string { return routeMapPositions(route).map(point => { const flat = projected ? flatMapPoint(point.x, point.z, point.y) : point; return `${flat.x},${flat.z}`; }).join(' '); }

function flatHexPosition(q: number, r: number, height = 0): { x: number; z: number } {
  const point = hexPosition(q, r);
  return flatMapPoint(point.x, point.z, height);
}

function flatPoints(points: readonly (readonly [number, number, number])[]): string {
  return points.map(([x, height, z]) => { const point = flatMapPoint(x, z, height); return `${point.x},${point.z}`; }).join(' ');
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function node<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

export function createFlatTerrainLayer(tiles: Parameters<typeof projectTerrainSurface>[0], drainage?: Parameters<typeof projectTerrainSurface>[1]): SVGGElement {
  const land = node('g', { class: 'terrain-surfaces' });
  const surfaces = projectTerrainSurface(tiles, drainage);
  const tops = surfaces.flatMap(tile => tile.faces);
  const terrainByKey = new Map(tiles.map(tile => [`${tile.q},${tile.r}`, tile.terrain]));
  const coverage = [
    { kind: 'cliff', color: LANDSCAPE_COLORS.shore, faces: surfaces.flatMap(tile => tile.cliffs) },
    ...(['grassland', 'forest', 'desert', 'mountain', 'tundra'] as const).map(terrain => ({ kind: `ground:${terrain}`, color: LANDSCAPE_COLORS[terrain],
      faces: surfaces.filter(tile => terrainByKey.get(tile.key) === terrain).flatMap(tile => tile.faces.filter(face => !face.kind || face.kind === 'ground')) })),
    { kind: 'bank', color: DRAINAGE_STYLE.bank, faces: tops.filter(face => face.kind === 'bank') },
    { kind: 'channel', color: DRAINAGE_STYLE.water, faces: tops.filter(face => face.kind === 'channel') },
  ];
  for (const layer of coverage) {
    if (!layer.faces.length) continue;
    const d = layer.faces.map(face => {
      const points = face.points.map(([x, height, z]) => flatMapPoint(x, z, height));
      const area = points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]!; return sum + point.x * next.z - next.x * point.z; }, 0);
      return `M${(area < 0 ? points.toReversed() : points).map(point => `${point.x},${point.z}`).join('L')}Z`;
    }).join('');
    land.append(node('path', { d, fill: layer.color, 'fill-rule': 'nonzero', 'data-terrain-coverage': layer.kind }));
  }
  const faces = surfaces.flatMap(tile => [...tile.cliffs, ...tile.faces]).toSorted((a, b) => {
    const depth = (face: typeof a): number => face.points.reduce((sum, point) => sum + point[2] * .85 + point[1] * .72, 0) / face.points.length;
    return depth(a) - depth(b);
  });
  for (const face of faces) land.append(node('polygon', { points: flatPoints(face.points), fill: face.color, 'data-terrain-face': face.key,
    ...(face.kind ? { 'data-surface-kind': face.kind } : {}), ...(face.drainageEdgeId ? { 'data-drainage-edge': face.drainageEdgeId } : {}) }));
  return land;
}

export function createFlatTerritoryLayer(world: Pick<AtlasWorld, 'tiles' | 'cities' | 'drainage'>): SVGGElement {
  const group = node('g', { 'pointer-events': 'none', class: 'territory-layer' });
  const landscape = projectLandscape(world.tiles, [], 'far', world.drainage);
  const surface = new Map(projectTerrainSurface(world.tiles, world.drainage).map(tile => [tile.key, tile]));
  for (const territory of landscape.territories) {
    const owner = world.cities.find(city => city.id === territory.owner);
    if (owner) {
      const tile = surface.get(territory.key);
      const polygons = tile?.faces.some(face => face.kind === 'channel') ? tile.faces.filter(face => face.kind === 'ground').map(face => face.points) : [tile?.rim ?? []];
      for (const points of polygons) group.append(node('polygon', { points: flatPoints(points.map(([x, height, z]) => [x, height + .012, z])),
        fill: owner.color, 'fill-opacity': String(TERRITORY_STYLE.washOpacity), 'data-territory': territory.key, 'data-owner': String(territory.owner) }));
    }
  }
  for (const edge of landscape.borders) {
    const owner = world.cities.find(city => city.id === edge.owner);
    if (owner) group.append(node('path', { d: `M${flatPoints([[edge.from[0], edge.fromHeight ?? edge.height, edge.from[1]], [edge.to[0], edge.toHeight ?? edge.height, edge.to[1]]]).replace(' ', 'L')}`, fill: 'none', stroke: owner.color,
      'stroke-opacity': String(TERRITORY_STYLE.borderOpacity), 'stroke-width': String(TERRITORY_STYLE.borderWidth), 'stroke-linecap': 'round', 'data-boundary': edge.key }));
  }
  return group;
}

export function createFlatBorderLayer(views: readonly BorderIncidentView[], detail: DetailLevel, pixelsPerUnit = 24, onSelect?: (cityId: string) => void): SVGGElement {
  const group = node('g', { class: 'flat-border-parties' });
  const parties = projectBorderParties(views);
  const outlines = node('g', { class: 'border-targets', 'pointer-events': 'none' });
  for (const view of views) {
    const points = borderTargetOutline(view);
    if (!points.length) continue;
    const outline = node('polyline', { points: flatPoints(points), fill: 'none', stroke: view.currentController?.color ?? VISUAL_PALETTE.neutral,
      'stroke-width': '2', 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke', 'data-border-target': view.incident.id,
      role: 'img', 'aria-label': `Disputed plot ${view.incident.tileId}. Current control: ${view.currentController?.name ?? (view.currentControllerKnown ? 'unclaimed' : 'unavailable')}.` });
    outlines.append(outline);
  }
  const geometry = node('g', { class: 'border-resident-parts', 'pointer-events': 'none' });
  const recipe = borderPartyWorldParts(parties, detail);
  const colors = new Map(recipe.map(row => [row.part.id, row.color]));
  for (const face of flatSceneFaces(recipe.map(row => row.part), .72)) {
    const color = colors.get(face.part.id) ?? VISUAL_PALETTE.neutral;
    const shaded = `#${[1, 3, 5].map((offset, index) => Math.round(Number.parseInt(color.slice(offset, offset + 2), 16) * (1 - face.shade) + ([24, 56, 46][index] ?? 0) * face.shade).toString(16).padStart(2, '0')).join('')}`;
    geometry.append(node('polygon', { 'data-border-part': face.part.id, points: face.points, fill: shaded }));
  }
  group.append(outlines, geometry);
  const scale = Number.isFinite(pixelsPerUnit) ? Math.max(.01, pixelsPerUnit) : 24;
  const badgeOffsets = borderPartyBadgeOffsets(parties);
  for (const party of parties) {
    const anchor = borderPartyAnchor(party);
    const tile = hexPosition(party.point.q, party.point.r);
    const point = detail === 'far' ? flatMapPoint(tile.x, tile.z, party.point.height + .18) : flatMapPoint(anchor.x, anchor.z, anchor.height + .28);
    const offset = detail === 'far' ? badgeOffsets.get(party.party.id)! : { x: 0, y: 0 };
    const inspectable = !!onSelect && party.sourceCityName !== null;
    const marker = node('g', { class: 'flat-border-party', 'data-border-party': party.party.id, 'data-position-tile': String(party.party.positionTileId),
      'data-border-x': String(point.x), 'data-border-z': String(point.z),
      'data-screen-offset-x': String(offset.x), 'data-screen-offset-y': String(offset.y),
      transform: `translate(${point.x} ${point.z}) scale(${1 / scale})`, role: inspectable ? 'button' : 'img', tabindex: inspectable ? '0' : '-1', 'aria-label': borderPartyLabel(party) });
    const title = node('title', {}); title.textContent = borderPartyLabel(party); marker.append(title);
    if (offset.x || offset.y) marker.append(node('line', { x1: '0', y1: '0', x2: String(offset.x), y2: String(offset.y), stroke: party.identity.color, 'stroke-width': '1', 'pointer-events': 'none', 'aria-hidden': 'true' }),
      node('circle', { r: '1.5', fill: '#fff5d8', 'pointer-events': 'none', 'aria-hidden': 'true', 'data-border-tile-anchor': String(party.point.tileId) }));
    const badge = node('g', { class: 'border-count-badge', transform: `translate(${offset.x} ${offset.y})` });
    badge.append(node('circle', { r: detail === 'far' ? '10' : '16', fill: detail === 'far' ? '#173a3c' : 'transparent', stroke: detail === 'far' ? party.identity.color : 'none', 'stroke-width': '2' }));
    if (detail === 'far') {
      const count = node('text', { y: '4', fill: '#fff5d8', 'font-size': '12', 'font-family': 'Arial, sans-serif', 'text-anchor': 'middle' });
      count.textContent = String(party.party.people); badge.append(count);
    }
    marker.append(badge);
    if (inspectable) {
      marker.addEventListener('click', () => onSelect?.(party.sourceCityId));
      marker.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(party.sourceCityId); } });
    }
    group.append(marker);
  }
  return group;
}

export function createFlatAtlasRenderer(
  container: HTMLElement,
  world: AtlasWorld,
  preferences: ViewerPreferences,
  onSelect: SiteInspectionSelect,
  onRoute: (id: string) => void,
): AtlasRenderer {
  const svg = node('svg', { class: 'flat-atlas', role: 'group', 'aria-label': `${world.illustrative ? 'Sample' : 'Committed world'} two dimensional map. Select a city to inspect.` });
  const ocean = node('g', { 'pointer-events': 'none', class: 'atlas-ocean' });
  const definitions = node('defs', {});
  const waves = node('pattern', { id: 'atlas-wave-pattern', width: '4', height: '2.4', patternUnits: 'userSpaceOnUse' });
  waves.append(node('path', { d: 'M.3 .9 Q.8 .72 1.3 .9 M2.3 1.8 Q2.8 1.62 3.3 1.8', fill: 'none', stroke: '#87bcc0', 'stroke-opacity': '.09', 'stroke-width': '.025' }));
  definitions.append(waves);
  ocean.append(node('rect', { x: '-500', y: '-500', width: '1000', height: '1000', fill: LANDSCAPE_COLORS.water }), node('rect', { x: '-500', y: '-500', width: '1000', height: '1000', fill: 'url(#atlas-wave-pattern)' }));
  const coast = node('g', { 'pointer-events': 'none' });
  const land = createFlatTerrainLayer(world.tiles, world.drainage);
  const terrain = node('g', { 'pointer-events': 'none', class: 'landscape-parts' });
  const borders = createFlatTerritoryLayer(world);
  const acquired = node('g', { class: 'acquired-land', 'pointer-events': 'none' });
  const routes = node('g', { class: 'flat-routes' });
  let selectedRoute: string | null = null;
  let routeLabel: { element: SVGGElement; title: SVGTextElement; x: number; z: number; id: string } | null = null;
  const cities = node('g', {});
  const settlementShapes = node('g', { class: 'flat-settlement-shapes', 'pointer-events': 'none' });
  const districts = node('g', { class: 'flat-districts' });
  let borderParties = createFlatBorderLayer(world.borderIncidents ?? [], 'far', 24, onSelect);
  const deposits = node('g', { class: 'flat-deposits', 'pointer-events': 'none' });
  const pastoralNodes: Array<{ element: SVGGElement; mark: SVGGElement; label: SVGTextElement; id: string; q: number; r: number; revealedTo: number[] }> = [];
  const depositNodes: Array<{ parts: SVGGElement; mark: SVGGElement; label: SVGTextElement; index: number }> = [];
  const siteSources = createSiteOverlaySources(world);
  const sourceById = new Map(siteSources.map(source => [source.id, source]));
  const measureCaptions = createMapCaptionMeasure();
  const sites = mapInspectionSites(world).map(site => ({ ...site, caption: 'name' in site ? site.name ?? 'Campus' : 'Aqueduct source',
    parts: (level: DetailLevel) => site.kind === 'wonder' ? greatLibraryVisual(site.record, level).parts : sourceById.get(site.id)?.parts(level) ?? [] }));
  const districtNodes: Array<{ element: SVGGElement; parts: SVGGElement; hit: SVGCircleElement; label: SVGTextElement; leader: SVGLineElement; mark: SVGGElement; markLeader: SVGLineElement; anchorDot: SVGCircleElement; index: number }> = [];
  const settlements: Array<{ element: SVGGElement; index: number }> = [];
  let detail: DetailLevel | undefined;
  let townDetail: DetailLevel | undefined;
  const cityNodes: Array<{ id: string; element: SVGGElement; hit: SVGCircleElement; ring: SVGCircleElement; marker: SVGPathElement; label: SVGTextElement; banner: SVGRectElement; leader: SVGLineElement }> = [];
  const initialCity = selectedCity(world, preferences);
  let selected = initialCity ? cityKey(initialCity) : '';
  let zoom = preferences.zoom;
  let x = preferences.x;
  let z = preferences.z;
  const tileLookup = new Map(world.tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
  const landscape = projectLandscape(world.tiles, world.cities, 'far', world.drainage);
  const coastPath = landscape.coast.map(edge => `M${flatPoints([[edge.from[0], 0, edge.from[1]], [edge.to[0], 0, edge.to[1]]]).replace(' ', 'L')}`).join(' ');
  coast.append(node('path', { d: coastPath, fill: 'none', stroke: LANDSCAPE_COLORS.shallow, 'stroke-opacity': '.42', 'stroke-width': '.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  coast.append(node('path', { d: coastPath, fill: 'none', stroke: LANDSCAPE_COLORS.shallow, 'stroke-width': '.38', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  coast.append(node('path', { d: coastPath, fill: 'none', stroke: LANDSCAPE_COLORS.shore, 'stroke-width': '.08', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  borders.append(acquired);
  const paintParts = (host: SVGGElement, parts: Parameters<typeof flatSceneFaces>[0], identity: string): void => {
    host.replaceChildren();
    for (const part of parts) {
      if (part.shape !== 'canopy' && part.shape !== 'cone') continue;
      const base = flatMapPoint(part.position[0], part.position[2], part.position[1] - part.scale[1] / 2);
      host.append(node('ellipse', { cx: String(base.x + part.scale[1] * .16), cy: String(base.z + part.scale[1] * .12), rx: String(part.scale[0] * .47), ry: String(part.scale[2] * .24), fill: '#1b3529', 'fill-opacity': '.17', 'pointer-events': 'none' }));
    }
    for (const face of flatSceneFaces(parts, .72)) {
      const color = face.part.material === 'identity' ? identity : VISUAL_PALETTE[face.part.material];
      const shaded = `#${[1, 3, 5].map((offset, index) => Math.round(Number.parseInt(color.slice(offset, offset + 2), 16) * (1 - face.shade) + ([24, 56, 46][index] ?? 0) * face.shade).toString(16).padStart(2, '0')).join('')}`;
      host.append(node('polygon', { 'data-part': face.part.id, points: face.points, fill: shaded }));
    }
  };
  const drawRoutes = (): void => {
    routes.replaceChildren();
    routeLabel = null;
    for (const route of visibleRoutePaths(world.routes, selectedRoute).toReversed()) {
      if (!route.fromTown || !route.toTown) continue;
      const anchor = routeMapAnchor(route);
      if (!anchor) continue;
      const visual = routeVisual(route);
      const line = { points: flatRoutePoints(route, true), fill: 'none', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' };
      const group = node('g', { class: 'flat-route', 'data-route-id': route.id, role: 'button', tabindex: '0', 'aria-label': `Inspect ${routeTitle(route)}. ${visual.label}`, 'aria-pressed': String(route.id === selectedRoute) });
      const choose = (): void => onRoute(route.id);
      group.addEventListener('click', choose);
      group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
      group.append(node('polyline', { ...line, stroke: route.id === selectedRoute ? '#394538' : '#746b4d', 'stroke-width': route.id === selectedRoute ? '5' : '3', 'pointer-events': 'none' }));
      group.append(node('polyline', { ...line, stroke: route.id === selectedRoute || visual.status !== 'agreed' ? visual.color : '#c9b17b', 'stroke-width': route.id === selectedRoute ? '3' : '1.6', 'stroke-dasharray': visual.dash.length ? visual.dash.join(' ') : 'none', 'pointer-events': 'none' }));
      group.append(node('polyline', { ...line, stroke: 'transparent', 'stroke-width': '14', 'pointer-events': 'stroke' }));
      if (route.id === selectedRoute) {
        const label = node('g', { class: 'flat-route-label' });
        const background = node('rect', { x: '-22', y: '-22', width: '44', height: '44', rx: '5', fill: '#193a3c', stroke: visual.color });
        const title = node('text', { 'text-anchor': 'middle', y: '4', fill: '#fff5d8', 'font-size': '12', 'font-family': 'Arial, sans-serif' });
        title.textContent = routeMapLabel(route);
        const symbol = node('text', { 'text-anchor': 'middle', y: '5', fill: '#fff5d8', 'font-size': '18' }); symbol.textContent = '↔';
        label.append(background, symbol, title);
        group.append(label);
        routeLabel = { element: label, title, x: anchor.x, z: anchor.z, id: routeLabelKey(route.id) };
      }
      routes.append(group);
    }
  };
  drawRoutes();
  for (const [index, district] of sites.entries()) {
    const point = flatHexPosition(district.q, district.r, district.height);
    const group = node('g', { class: `flat-district flat-${district.kind}`, 'data-district-id': district.id, 'data-tile-id': String(district.tileId), 'data-status': district.status,
      transform: `translate(${point.x} ${point.z})`, role: 'button', tabindex: '0', 'data-site-id': district.id, 'aria-label': siteInspectionName(district) });
    const parts = node('g', { 'pointer-events': 'none' });
    const hit = node('circle', { class: 'district-hit', fill: 'transparent', r: '1' });
    const label = node('text', { 'text-anchor': 'middle', fill: '#fff5d8', 'font-family': 'Arial, sans-serif', stroke: '#173a3c', 'stroke-width': '.09', 'paint-order': 'stroke', 'pointer-events': 'none' });
    const leader = node('line', { x1: '0', y1: '0', stroke: district.color, 'stroke-width': '1', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
    label.textContent = district.caption;
    const mark = node('g', { 'pointer-events': 'none', 'aria-hidden': 'true' });
    mark.append(node('circle', { r: '11', fill: '#f4f0df', stroke: '#294348', 'stroke-width': '2', 'stroke-dasharray': district.status === 'building' ? '3 2' : 'none' }), node('path', { d: district.mark === 'wonder' ? WONDER_MARK_PATH : district.mark === 'intake' ? RIVER_INTAKE_MARK_PATH : district.mark === 'charcoal' ? CHARCOAL_MARK_PATH : district.mark === 'commons' ? HILLSIDE_COMMONWORKS_MARK_PATH : district.mark === 'fishery' ? SHORE_FISHERY_MARK_PATH : district.mark === 'pasture' ? PASTORAL_MARK_PATH : district.mark === 'lumber' ? LUMBER_MARK_PATH : district.mark === 'catchment' ? CATCHMENT_MARK_PATH : SITE_MARK_PATHS[district.mark], transform: 'translate(-9 -9) scale(.75)', fill: 'none', stroke: '#294348', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const markLeader = node('line', { stroke: '#d9dfcb', 'stroke-opacity': '.7', 'stroke-width': '1', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
    const anchorDot = node('circle', { r: '0', fill: '#d9dfcb', 'fill-opacity': '.7', 'pointer-events': 'none', 'aria-hidden': 'true' });
    group.append(leader, parts, markLeader, anchorDot, hit, mark, label);
    bindSiteInspection(group, district.cityId, 'workId' in district ? district.workId : undefined, onSelect);
    group.addEventListener('focus', () => resize());
    districts.append(group);
    districtNodes.push({ element: group, parts, hit, label, leader, mark, markLeader, anchorDot, index });
  }
  for (const [index, deposit] of (world.deposits ?? []).entries()) {
    const point = flatHexPosition(deposit.q, deposit.r, deposit.height);
    const group = node('g', { transform: `translate(${point.x} ${point.z})`, 'data-deposit-id': deposit.id, role: 'img', 'aria-label': depositLabel(deposit) });
    const parts = node('g', {}); const mark = node('g', {});
    mark.append(node('circle', { r: '7', fill: '#edf1e6', stroke: '#293c43', 'stroke-width': '1.5' }), node('path', { d: SITE_MARK_PATHS.iron, transform: 'translate(-6 -6) scale(.5)', fill: 'none', stroke: '#293c43', 'stroke-width': '2' }));
    const label = node('text', { 'text-anchor': 'middle', fill: '#fff5d8', stroke: '#173a3c', 'paint-order': 'stroke', 'font-family': 'Arial, sans-serif' });
    group.append(parts, mark, label); deposits.append(group); depositNodes.push({ parts, mark, label, index });
  }
  for (const site of world.pastoralSites ?? []) {
    const point = flatHexPosition(site.q, site.r, site.height);
    const group = node('g', { transform: `translate(${point.x} ${point.z})`, 'data-horse-site': String(site.tileId), role: 'img', 'aria-label': pastoralSiteLabel(site.tileId) });
    const mark = node('g', {});
    mark.append(node('circle', { r: '9', fill: '#e6d7a5', stroke: '#294b33', 'stroke-width': '1.5' }), node('path', { d: PASTORAL_MARK_PATH, transform: 'translate(-8 -8) scale(.67)', fill: 'none', stroke: '#294b33', 'stroke-width': '2' }));
    const label = node('text', { 'text-anchor': 'middle', fill: '#fff5d8', stroke: '#173a3c', 'paint-order': 'stroke', 'font-family': 'Arial, sans-serif' });
    group.append(mark, label); deposits.append(group); pastoralNodes.push({ element: group, mark, label, id: site.id, q: site.q, r: site.r, revealedTo: site.revealedTo });
  }
  for (const [index, city] of world.cities.entries()) {
    const point = flatHexPosition(city.q, city.r, tileLookup.get(`${city.q},${city.r}`)?.height ?? .4);
    const group = node('g', { class: 'flat-city', 'data-city-id': cityKey(city), transform: `translate(${point.x} ${point.z})`, role: 'button', tabindex: '0', 'aria-label': `Inspect ${damageMapLabel(city.capital, city.settlement?.damage ?? 0)}, ${city.name}` });
    const hit = node('circle', { class: 'city-hit', r: '2.2' });
    const ring = node('circle', { class: 'city-marker', r: '0.85', fill: '#193a3c', stroke: city.color, 'stroke-width': '0.15' });
    const settlement = node('g', { class: 'settlement-parts', transform: `translate(${point.x} ${point.z}) scale(${SETTLEMENT_RENDER_SCALE})` });
    settlements.push({ element: settlement, index });
    settlementShapes.append(settlement);
    const leader = node('line', { stroke: city.color, 'stroke-width': '1', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
    group.append(leader, hit, ring);
    const identity = civilizationIdentity(city.id);
    const marker = node('path', { d: identity.path, fill: 'none', stroke: '#fff5d8', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', 'data-crest': identity.crest });
    group.append(marker);
    const label = node('text', { 'text-anchor': 'middle', y: '1.45', fill: '#fff5d8', 'font-size': '0.55', 'font-family': 'Arial, sans-serif', stroke: '#173a3c', 'stroke-width': '0.11', 'paint-order': 'stroke' });
    label.textContent = damageMapLabel(city.capital, city.settlement?.damage ?? 0);
    const banner = node('rect', { fill: '#18383b', 'fill-opacity': '.94', stroke: city.color, 'pointer-events': 'none' });
    group.append(banner, label);
    const choose = (): void => onSelect(cityKey(city));
    group.addEventListener('click', choose);
    group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
    cities.append(group);
    cityNodes.push({ id: cityKey(city), element: group, hit, ring, marker, label, banner, leader });
  }
  borders.style.display = preferences.borders ? '' : 'none';
  routes.style.display = preferences.routes ? '' : 'none';
  svg.append(definitions, ocean, coast, land, borders, terrain, routes, deposits, settlementShapes, districts, borderParties, cities);
  container.prepend(svg);
  const cues = createWorldCues(container, world, (px, pz, height) => {
    const point = flatMapPoint(px, pz, height);
    const box = svg.viewBox.baseVal;
    return { x: (point.x - box.x) / box.width * container.clientWidth, y: (point.z - box.y) / box.height * container.clientHeight };
  });
  cues.setMotion(resolveAppearance(preferences, false, window.matchMedia('(prefers-reduced-motion: reduce)').matches).motion);
  const resize = (): void => {
    const aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    const halfHeight = (aspect < 1 ? 26 : 16) / zoom;
    svg.setAttribute('viewBox', `${x - halfHeight * aspect} ${z * .72 - halfHeight} ${halfHeight * aspect * 2} ${halfHeight * 2}`);
    const pixelsPerUnit = container.clientHeight / (halfHeight * 2);
    const nextDetail = visualDetail(pixelsPerUnit * 2, detail);
    const nextTownDetail = settlementDetail(pixelsPerUnit * 2, townDetail);
    if (nextDetail !== detail) {
      const focused = document.activeElement?.getAttribute('data-border-party');
      const nextBorderParties = createFlatBorderLayer(world.borderIncidents ?? [], nextDetail, pixelsPerUnit, onSelect);
      borderParties.replaceWith(nextBorderParties);
      borderParties = nextBorderParties;
      if (focused) for (const marker of borderParties.querySelectorAll<SVGGElement>('.flat-border-party')) if (marker.getAttribute('data-border-party') === focused) marker.focus();
    } else for (const marker of borderParties.querySelectorAll('.flat-border-party')) marker.setAttribute('transform', `translate(${marker.getAttribute('data-border-x')} ${marker.getAttribute('data-border-z')}) scale(${1 / pixelsPerUnit})`);
    if (nextDetail !== detail || nextTownDetail !== townDetail) {
      detail = nextDetail;
      townDetail = nextTownDetail;
      svg.dataset['townDetail'] = townDetail;
      svg.dataset['detail'] = detail;
      paintParts(terrain, projectLandscape(world.tiles, [...world.cities, ...(world.districts ?? []), ...(world.improvements ?? []), ...(world.wonders ?? [])], detail, world.drainage).parts, VISUAL_PALETTE.stone);
      for (const entry of depositNodes) { const deposit = world.deposits?.[entry.index]; if (deposit) paintParts(entry.parts, depositParts(deposit, detail), VISUAL_PALETTE.metal); }
      for (const entry of districtNodes) {
        const district = sites[entry.index];
        if (district) paintParts(entry.parts, district.parts(district.kind === 'district' || district.kind === 'improvement' ? townDetail : detail), district.color);
      }
      for (const entry of settlements) {
        const city = world.cities[entry.index];
        if (!city?.settlement) continue;
        const visual = settlementVisual(city.settlement, townDetail);
        entry.element.replaceChildren();
        entry.element.dataset['houses'] = String(visual.houses);
        entry.element.dataset['buildings'] = city.settlement.buildings.join(' ');
        entry.element.dataset['landmarks'] = visual.landmarks.join(' ');
        entry.element.dataset['summarizedBuildings'] = String(visual.summarizedBuildings.length);
        paintParts(entry.element, visual.parts, city.color);
      }
    }
    const box = svg.viewBox.baseVal;
    const project = (q: number, r: number, height: number): { x: number; y: number } => {
      const point = flatHexPosition(q, r, height);
      return { x: (point.x - box.x) * pixelsPerUnit, y: (point.z - box.y) * pixelsPerUnit };
    };
    const viewport = { width: container.clientWidth, height: container.clientHeight };
    const geometry = projectMapSiteGeometry(siteSources, townDetail ?? 'far', (px, py, pz) => {
      const point = flatMapPoint(px, pz, py); return { x: (point.x - box.x) * pixelsPerUnit, y: (point.z - box.y) * pixelsPerUnit };
    }, viewport);
    const borderOccupied: ScreenBox[] = [...borderParties.querySelectorAll<SVGGElement>('.flat-border-party')].map(marker => {
      const radius = detail === 'far' ? 12 : 16;
      return { left: (Number(marker.getAttribute('data-border-x')) - box.x) * pixelsPerUnit + Number(marker.getAttribute('data-screen-offset-x')) - radius,
        top: (Number(marker.getAttribute('data-border-z')) - box.y) * pixelsPerUnit + Number(marker.getAttribute('data-screen-offset-y')) - radius, width: radius * 2, height: radius * 2 };
    });
    const anchors = mapHierarchyAnchors(world, selected, routes.style.display === 'none' ? null : selectedRoute, project,
      { geometry, focusedId: document.activeElement?.getAttribute('data-site-id') ?? document.activeElement?.getAttribute('data-city-id') ?? null });
    const allocation = allocateMapHierarchy(measureCaptions(anchors, viewport.width), {
      ...viewport, tileDiameter: pixelsPerUnit * 2, previousDetail: detail, blocked: [...mapHierarchyObstacles(container), ...borderOccupied],
    });
    svg.dataset['mapMarks'] = String(allocation.items.filter(item => item.mark).length);
    const placements = new Map(allocation.items.map(item => [item.id, item]));
    for (const city of cityNodes) {
      const placement = placements.get(city.id);
      const mark = placement?.mark;
      if (!mark) handoffSiteOverlayFocus(city.element, container, city.id, undefined, onSelect);
      city.element.style.visibility = mark ? 'visible' : 'hidden';
      city.element.setAttribute('tabindex', mark ? '0' : '-1');
      if (!mark) { city.label.style.visibility = 'hidden'; city.banner.style.visibility = 'hidden'; }
      if (!placement || !mark) continue;
      const dx = (mark.left + mark.width / 2 - placement.anchor.x) / pixelsPerUnit;
      const dy = (mark.top + mark.height / 2 - placement.anchor.y) / pixelsPerUnit;
      city.hit.setAttribute('r', String(22 / pixelsPerUnit));
      city.hit.setAttribute('cx', String(dx)); city.hit.setAttribute('cy', String(dy));
      city.ring.setAttribute('r', String(placement.symbolSize / 2 / pixelsPerUnit));
      city.ring.setAttribute('cx', String(dx)); city.ring.setAttribute('cy', String(dy));
      city.ring.setAttribute('stroke-width', String(2 / pixelsPerUnit));
      const crestSize = placement.symbolSize * .66 / pixelsPerUnit;
      city.marker.setAttribute('transform', `translate(${dx - crestSize / 2} ${dy - crestSize / 2}) scale(${crestSize / 24})`);
      city.leader.style.visibility = placement.leader ? 'visible' : 'hidden';
      if (placement.leader) { city.leader.setAttribute('x2', String((placement.leader.to.x - placement.anchor.x) / pixelsPerUnit)); city.leader.setAttribute('y2', String((placement.leader.to.y - placement.anchor.y) / pixelsPerUnit)); }
      city.label.style.visibility = placement.label ? 'visible' : 'hidden';
      city.banner.style.visibility = placement.label ? 'visible' : 'hidden';
      if (placement.label) {
        city.banner.setAttribute('x', String((placement.label.left - placement.anchor.x) / pixelsPerUnit));
        city.banner.setAttribute('y', String((placement.label.top - placement.anchor.y) / pixelsPerUnit));
        city.banner.setAttribute('width', String(placement.label.width / pixelsPerUnit));
        city.banner.setAttribute('height', String(placement.label.height / pixelsPerUnit));
        city.banner.setAttribute('rx', String(3 / pixelsPerUnit));
        city.banner.setAttribute('stroke-width', String(1 / pixelsPerUnit));
        city.label.textContent = placement.caption;
        city.label.setAttribute('font-size', String(placement.fontSize / pixelsPerUnit));
        city.label.setAttribute('stroke-width', String(3 / pixelsPerUnit));
        city.label.setAttribute('x', String((placement.label.left + placement.label.width / 2 - placement.anchor.x) / pixelsPerUnit));
        city.label.setAttribute('y', String((placement.label.top + placement.fontSize + 3 - placement.anchor.y) / pixelsPerUnit));
      }
    }
    const resourceCaption = (label: SVGTextElement, id: string): void => {
      const placement = placements.get(id); label.style.visibility = placement?.label ? 'visible' : 'hidden';
      if (placement?.label) {
        label.textContent = placement.caption; label.setAttribute('font-size', String(placement.fontSize / pixelsPerUnit)); label.setAttribute('stroke-width', String(3 / pixelsPerUnit));
        label.setAttribute('x', String((placement.label.left + placement.label.width / 2 - placement.anchor.x) / pixelsPerUnit));
        label.setAttribute('y', String((placement.label.top + placement.fontSize + 3 - placement.anchor.y) / pixelsPerUnit));
      }
    };
    const selectedCivilization = world.cities.find(city => cityKey(city) === selected)?.id;
    for (const entry of pastoralNodes) {
      const placement = placements.get(entry.id); const mark = placement?.mark; resourceCaption(entry.label, entry.id);
      entry.element.style.display = selectedCivilization !== undefined && entry.revealedTo.includes(selectedCivilization) ? '' : 'none';
      entry.mark.style.visibility = mark ? 'visible' : 'hidden';
      if (placement && mark) entry.mark.setAttribute('transform', `translate(${(mark.left + mark.width / 2 - placement.anchor.x) / pixelsPerUnit} ${(mark.top + mark.height / 2 - placement.anchor.y) / pixelsPerUnit}) scale(${.8 / pixelsPerUnit})`);
    }
    for (const entry of depositNodes) {
      const deposit = world.deposits?.[entry.index]; const placement = deposit && placements.get(deposit.id); const mark = placement?.mark;
      if (deposit) resourceCaption(entry.label, deposit.id);
      entry.mark.style.visibility = mark ? 'visible' : 'hidden';
      entry.parts.style.visibility = deposit?.revealedTo.some(civ => civ.id === selectedCivilization) ? 'visible' : 'hidden';
      if (placement && mark) entry.mark.setAttribute('transform', `translate(${(mark.left + mark.width / 2 - placement.anchor.x) / pixelsPerUnit} ${(mark.top + mark.height / 2 - placement.anchor.y) / pixelsPerUnit}) scale(${1 / pixelsPerUnit})`);
    }
    for (const entry of districtNodes) {
      const site = sites[entry.index]; const placement = site && placements.get(site.id); const mark = placement?.mark;
      entry.mark.style.visibility = mark ? 'visible' : 'hidden'; entry.markLeader.style.visibility = placement?.leader ? 'visible' : 'hidden';
      entry.anchorDot.style.visibility = placement?.leader ? 'visible' : 'hidden';
      entry.element.dataset['placementMode'] = placement?.placementMode ?? 'omitted';
      entry.element.dataset['placementReason'] = placement?.fallbackReason ?? '';
      if (!mark && site) handoffSiteOverlayFocus(entry.element, container, site.cityId, 'workId' in site ? site.workId : undefined, onSelect);
      entry.hit.style.pointerEvents = mark ? 'all' : 'none'; entry.element.setAttribute('tabindex', mark ? '0' : '-1');
      entry.element.setAttribute('aria-hidden', String(!mark));
      entry.label.style.visibility = placement?.label ? 'visible' : 'hidden'; entry.leader.style.visibility = 'hidden';
      if (!placement || !mark) continue;
      const dx = (mark.left + mark.width / 2 - placement.anchor.x) / pixelsPerUnit;
      const dy = (mark.top + mark.height / 2 - placement.anchor.y) / pixelsPerUnit;
      entry.mark.setAttribute('transform', `translate(${dx} ${dy}) scale(${placement.symbolSize / 24 / pixelsPerUnit})`);
      if (placement.leader) {
        entry.markLeader.setAttribute('x1', String((placement.leader.from.x - placement.anchor.x) / pixelsPerUnit)); entry.markLeader.setAttribute('y1', String((placement.leader.from.y - placement.anchor.y) / pixelsPerUnit));
        entry.markLeader.setAttribute('x2', String((placement.leader.to.x - placement.anchor.x) / pixelsPerUnit)); entry.markLeader.setAttribute('y2', String((placement.leader.to.y - placement.anchor.y) / pixelsPerUnit));
      }
      entry.anchorDot.setAttribute('r', String(1.5 / pixelsPerUnit));
      entry.hit.setAttribute('cx', String(dx)); entry.hit.setAttribute('cy', String(dy)); entry.hit.setAttribute('r', String(22 / pixelsPerUnit));
      if (placement.label) {
        entry.label.textContent = placement.caption;
        entry.label.setAttribute('font-size', String(placement.fontSize / pixelsPerUnit)); entry.label.setAttribute('stroke-width', String(3 / pixelsPerUnit));
        entry.label.setAttribute('x', String((placement.label.left + placement.label.width / 2 - placement.anchor.x) / pixelsPerUnit));
        entry.label.setAttribute('y', String((placement.label.top + placement.fontSize + 3 - placement.anchor.y) / pixelsPerUnit));
      }
    }
    if (routeLabel) {
      const placement = placements.get(routeLabel.id); const mark = placement?.mark;
      routeLabel.element.style.visibility = mark ? 'visible' : 'hidden';
      if (!mark) routeLabel.title.style.visibility = 'hidden';
      if (placement && mark) {
        const mx = mark.left + mark.width / 2; const my = mark.top + mark.height / 2;
        routeLabel.element.setAttribute('transform', `translate(${box.x + mx / pixelsPerUnit} ${box.y + my / pixelsPerUnit}) scale(${1 / pixelsPerUnit})`);
        routeLabel.title.style.visibility = placement.label ? 'visible' : 'hidden';
        if (placement.label) {
          routeLabel.title.textContent = placement.caption; routeLabel.title.setAttribute('x', String(placement.label.left + placement.label.width / 2 - mx));
          routeLabel.title.setAttribute('y', String(placement.label.top + placement.fontSize + 3 - my));
          routeLabel.title.setAttribute('stroke', '#173a3c'); routeLabel.title.setAttribute('stroke-width', '3'); routeLabel.title.setAttribute('paint-order', 'stroke');
        }
      }
    }
    cues.update([...allocation.occupied, ...borderOccupied]);
  };
  const stopObstacles = observeMapHierarchyObstacles(container, resize);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  const drawAcquired = (): void => {
    acquired.replaceChildren();
    const color = world.cities.find(city => cityKey(city) === selected)?.color ?? '#e7bf69';
    for (const plot of selectedAcquiredLand(world.acquiredLand ?? [], selected)) {
      if (!plot.point) continue;
      const center = hexPosition(plot.point.q, plot.point.r);
      const points = Array.from({ length: 6 }, (_, index) => {
        const angle = Math.PI / 3 * index + Math.PI / 6;
        const point = flatMapPoint(center.x + Math.cos(angle) * .88, center.z + Math.sin(angle) * .88, plot.point?.height ?? 0);
        return `${point.x},${point.z}`;
      }).join(' ');
      acquired.append(node('polygon', { points, fill: 'none', stroke: '#173a3c', 'stroke-width': '5', 'vector-effect': 'non-scaling-stroke' }),
        node('polygon', { points, fill: 'none', stroke: color, 'stroke-width': '2.5', 'vector-effect': 'non-scaling-stroke', 'data-acquired-tile': String(plot.receipt.tileId) }));
    }
  };
  const select = (id: string): void => {
    selected = id;
    drawAcquired();
    for (const city of cityNodes) {
      city.element.classList.toggle('selected', city.id === id);
      city.element.setAttribute('aria-pressed', String(city.id === id));
    }
    resize();
  };
  select(selected);
  let pointer: { id: number; x: number; y: number; originX: number; originZ: number } | null = null;
  svg.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Element && event.target.closest('.flat-city, .flat-route, .flat-district, .flat-border-party')) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, originX: x, originZ: z };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const scale = svg.viewBox.baseVal.height / Math.max(container.clientHeight, 1);
    x = Math.max(-100, Math.min(100, pointer.originX - (event.clientX - pointer.x) * scale));
    z = Math.max(-100, Math.min(100, pointer.originZ - (event.clientY - pointer.y) * scale / .72));
    resize();
  });
  svg.addEventListener('pointerup', () => { pointer = null; });
  svg.addEventListener('pointercancel', () => { pointer = null; });
  return {
    zoom: (factor) => { zoom = Math.min(MAP_ZOOM.maximum, Math.max(MAP_ZOOM.minimum, zoom * factor)); resize(); },
    reset: () => {
      const viewport = { width: container.clientWidth, height: container.clientHeight };
      const window = mapContentWindow(viewport.width, viewport.height, mapHierarchyObstacles(container));
      const overview = viewport.width < 600 && world.cities.length ? world.cities.map(city => ({ ...city, height: tileLookup.get(`${city.q},${city.r}`)?.height ?? .4 })) : world.tiles;
      const fit = window && fitMapOverview(overview.map(tile => flatHexPosition(tile.q, tile.r, tile.height)), viewport, window);
      if (fit) { x = fit.x; z = fit.z / .72; zoom = Math.min(MAP_ZOOM.maximum, Math.max(MAP_ZOOM.minimum, (viewport.width < viewport.height ? 26 : 16) / fit.halfHeight)); }
      resize();
    },
    select,
    selectRoute: (id) => { if (id !== selectedRoute) { selectedRoute = id; drawRoutes(); resize(); } },
    frameCity: (id, anchor, policy) => {
      const city = world.cities.find((candidate) => cityKey(candidate) === id);
      if (!city) return;
      const point = flatHexPosition(city.q, city.r, tileLookup.get(`${city.q},${city.r}`)?.height ?? .4);
      const box = svg.viewBox.baseVal;
      const current = { x: (point.x - box.x) / box.width, y: (point.z - box.y) / box.height };
      const target = unobscuredInspectionAnchor(current, anchor, { width: container.clientWidth, height: container.clientHeight }, mapHierarchyObstacles(container), policy);
      const shift = cameraShiftForAnchor(
        current, target, { x: 1 / box.width, y: 0 }, { x: 0, y: .72 / box.height },
      );
      x += shift.x;
      z += shift.z;
      resize();
    },
    restoreCamera: (camera) => { x = camera.x; z = camera.z; zoom = camera.zoom; resize(); },
    setLayer: (layer, visible) => { (layer === 'borders' ? borders : routes).style.display = visible ? '' : 'none'; resize(); },
    snapshot: () => ({ zoom, x, z }),
    showEvents: cues.show,
    clearEvents: cues.clear,
    setMotion: cues.setMotion,
    dispose: () => { observer.disconnect(); stopObstacles(); cues.dispose(); svg.remove(); },
  };
}
