import { selectedAcquiredLand } from '../visuals/territory-visuals.ts';
import { allocateMapHierarchy, fitMapOverview, mapContentWindow } from '../visuals/map-hierarchy.ts';
import { MAP_ZOOM } from './viewer-state.ts';
import { PASTORAL_MARK_PATH, CATCHMENT_MARK_PATH, pastoralSiteLabel } from '../visuals/pastoral-visuals.ts';
import { wonderSiteLabel } from '../visuals/wonder-visuals.ts';
import { greatLibraryVisual, WONDER_MARK_PATH } from '../visuals/wonder-landmark.ts';
import { depositParts, depositLabel, SITE_MARK_PATHS } from '../visuals/strategic-resource-visuals.ts';
import { visibleRoutePaths } from '../visuals/route-paths.ts';
import { routeLabelKey, routeTitle, routeVisual, routeMapLabel } from '../visuals/route-visuals.ts';
import { damageMapLabel } from '../visuals/damage-visuals.ts';
import { cityKey, selectedCity } from './city-selection.ts';
import { projectLandscape, landscapeSurface, LANDSCAPE_COLORS, TERRITORY_STYLE } from '../visuals/landscape.ts';
import { hexPosition, routeMapPositions, routeMapAnchor } from './atlas.ts';
import type { RouteView } from '../visuals/route-visuals.ts';
import type { AtlasWorld } from './atlas.ts';
import type { AtlasRenderer } from './renderer.ts';
import type { ViewerPreferences } from './viewer-state.ts';
import { resolveAppearance } from './viewer-appearance.ts';
import { cameraShiftForAnchor } from './inspection-camera.ts';
import { settlementVisual, VISUAL_PALETTE, visualDetail } from '../visuals/world-visuals.ts';
import type { DetailLevel } from '../visuals/world-visuals.ts';
import { flatSceneFaces } from './settlement-parts.ts';
import { createWorldCues } from './world-cues.ts';
import { mapHierarchyAnchors, mapHierarchyObstacles } from './map-labels.ts';
import { LUMBER_MARK_PATH, improvementLabel, improvementParts } from '../visuals/improvement-visuals.ts';
import { districtAdjacencySummary, districtMark, districtLabel, districtParts } from '../visuals/district-visuals.ts';

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

export function flatRoutePoints(route: RouteView): string { return routeMapPositions(route).map(point => `${point.x},${point.z}`).join(' '); }

const SVG_NS = 'http://www.w3.org/2000/svg';

function node<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

export function createFlatTerritoryLayer(world: Pick<AtlasWorld, 'tiles' | 'cities'>): SVGGElement {
  const group = node('g', { 'pointer-events': 'none', class: 'territory-layer' });
  const landscape = projectLandscape(world.tiles, [], 'far');
  for (const territory of landscape.territories) {
    const owner = world.cities.find(city => city.id === territory.owner);
    if (owner) group.append(node('polygon', { points: territory.points.map(point => point.join(',')).join(' '),
      fill: owner.color, 'fill-opacity': String(TERRITORY_STYLE.washOpacity), 'data-territory': territory.key, 'data-owner': String(territory.owner) }));
  }
  for (const edge of landscape.borders) {
    const owner = world.cities.find(city => city.id === edge.owner);
    if (owner) group.append(node('path', { d: `M${edge.from.join(' ')}L${edge.to.join(' ')}`, fill: 'none', stroke: owner.color,
      'stroke-opacity': String(TERRITORY_STYLE.borderOpacity), 'stroke-width': String(TERRITORY_STYLE.borderWidth), 'stroke-linecap': 'round', 'data-boundary': edge.key }));
  }
  return group;
}

export function createFlatAtlasRenderer(
  container: HTMLElement,
  world: AtlasWorld,
  preferences: ViewerPreferences,
  onSelect: (id: string, workId?: string) => void,
  onRoute: (id: string) => void,
): AtlasRenderer {
  const svg = node('svg', { class: 'flat-atlas', role: 'group', 'aria-label': `${world.illustrative ? 'Sample' : 'Committed world'} two dimensional map. Select a city to inspect.` });
  const coast = node('g', { 'pointer-events': 'none' });
  const land = node('g', {});
  const terrain = node('g', { 'pointer-events': 'none', class: 'landscape-parts' });
  const borders = createFlatTerritoryLayer(world);
  const acquired = node('g', { class: 'acquired-land', 'pointer-events': 'none' });
  const routes = node('g', { class: 'flat-routes' });
  let selectedRoute: string | null = null;
  let routeLabel: { element: SVGGElement; title: SVGTextElement; x: number; z: number; id: string } | null = null;
  const cities = node('g', {});
  const settlementShapes = node('g', { class: 'flat-settlement-shapes', 'pointer-events': 'none' });
  const districts = node('g', { class: 'flat-districts' });
  const deposits = node('g', { class: 'flat-deposits', 'pointer-events': 'none' });
  const pastoralNodes: Array<{ element: SVGGElement; mark: SVGGElement; label: SVGTextElement; id: string; q: number; r: number; revealedTo: number[] }> = [];
  const depositNodes: Array<{ parts: SVGGElement; mark: SVGGElement; label: SVGTextElement; index: number }> = [];
  const sites = [
    ...(world.catchments ?? []).map(site => ({ ...site, kind: 'catchment', mark: 'catchment' as const, caption: 'Aqueduct source', label: `Aqueduct mountain source${site.status === 'building' ? ' · Building' : ''}`, parts: (_level: DetailLevel) => [] })),
    ...(world.districts ?? []).map(site => ({ ...site, kind: 'district', mark: districtMark(site), caption: site.name ?? 'Campus', label: districtLabel(site), parts: (level: DetailLevel) => districtParts(site, level) })),
    ...(world.improvements ?? []).map(site => ({ ...site, kind: 'improvement', mark: site.improvementId === 'pasture' ? 'pasture' as const : site.improvementId === 'lumber-mill' ? 'lumber' as const : 'mine' as const, workId: site.status === 'building' ? `active:${site.construction?.id ?? ''}` : String(site.tileId), caption: site.name, label: improvementLabel(site), parts: (level: DetailLevel) => improvementParts(site, level) })),
    ...(world.wonders ?? []).map(site => ({ ...site, kind: 'wonder', mark: 'wonder' as const, caption: site.name, label: wonderSiteLabel(site), parts: (level: DetailLevel) => greatLibraryVisual(site.record, level).parts })),
  ];
  const districtNodes: Array<{ element: SVGGElement; parts: SVGGElement; hit: SVGCircleElement; label: SVGTextElement; leader: SVGLineElement; mark: SVGGElement; markLeader: SVGLineElement; index: number; placed: boolean }> = [];
  const settlements: Array<{ element: SVGGElement; index: number }> = [];
  let detail: DetailLevel | undefined;
  const cityNodes: Array<{ id: string; element: SVGGElement; hit: SVGCircleElement; ring: SVGCircleElement; marker: SVGTextElement; label: SVGTextElement; leader: SVGLineElement }> = [];
  const initialCity = selectedCity(world, preferences);
  let selected = initialCity ? cityKey(initialCity) : '';
  let zoom = preferences.zoom;
  let x = preferences.x;
  let z = preferences.z;
  for (const tile of world.tiles) {
    const point = hexPosition(tile.q, tile.r);
    const points = Array.from({ length: 6 }, (_, index) => {
      const angle = Math.PI / 3 * index + Math.PI / 6;
      return `${point.x + Math.cos(angle)},${point.z + Math.sin(angle)}`;
    }).join(' ');
    land.append(node('polygon', { points, fill: landscapeSurface(tile), stroke: landscapeSurface(tile), 'stroke-width': '0.025' }));
  }
  const landscape = projectLandscape(world.tiles, world.cities, 'far');
  const coastPath = landscape.coast.map(edge => `M${edge.from.join(' ')}L${edge.to.join(' ')}`).join(' ');
  coast.append(node('path', { d: coastPath, fill: 'none', stroke: LANDSCAPE_COLORS.shallow, 'stroke-width': '.42', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  coast.append(node('path', { d: coastPath, fill: 'none', stroke: LANDSCAPE_COLORS.shore, 'stroke-width': '.14', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  borders.append(acquired);
  const paintParts = (host: SVGGElement, parts: Parameters<typeof flatSceneFaces>[0], identity: string): void => {
    host.replaceChildren();
    for (const face of flatSceneFaces(parts)) {
      const color = face.part.material === 'identity' ? identity : VISUAL_PALETTE[face.part.material];
      host.append(node('polygon', { 'data-part': face.part.id, points: face.points, fill: color }));
      if (face.shade) host.append(node('polygon', { points: face.points, fill: '#18382e', 'fill-opacity': String(face.shade) }));
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
      const line = { points: flatRoutePoints(route), fill: 'none', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' };
      const group = node('g', { class: 'flat-route', 'data-route-id': route.id, role: 'button', tabindex: '0', 'aria-label': `Inspect ${routeTitle(route)}. ${visual.label}`, 'aria-pressed': String(route.id === selectedRoute) });
      const choose = (): void => onRoute(route.id);
      group.addEventListener('click', choose);
      group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
      group.append(node('polyline', { ...line, stroke: '#173a3c', 'stroke-width': route.id === selectedRoute ? '7' : '5', 'pointer-events': 'none' }));
      group.append(node('polyline', { ...line, stroke: visual.color, 'stroke-width': route.id === selectedRoute ? '3' : '2', 'stroke-dasharray': visual.dash.length ? visual.dash.join(' ') : 'none', 'pointer-events': 'none' }));
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
    const point = hexPosition(district.q, district.r);
    const group = node('g', { class: `flat-district flat-${district.kind}`, 'data-district-id': district.id, 'data-tile-id': String(district.tileId), 'data-status': district.status,
      transform: `translate(${point.x} ${point.z})`, role: 'button', tabindex: '0', 'aria-label': `Inspect ${district.label} of ${district.townName}, tile ${district.tileId}${'adjacency' in district && district.adjacency ? `. ${districtAdjacencySummary(district.adjacency)}` : ''}` });
    const parts = node('g', { 'pointer-events': 'none' });
    const hit = node('circle', { class: 'district-hit', fill: 'transparent', r: '1' });
    const label = node('text', { 'text-anchor': 'middle', fill: '#fff5d8', 'font-family': 'Arial, sans-serif', stroke: '#173a3c', 'stroke-width': '.09', 'paint-order': 'stroke', 'pointer-events': 'none' });
    const leader = node('line', { x1: '0', y1: '0', stroke: district.color, 'stroke-width': '1', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
    label.textContent = district.caption;
    const mark = node('g', { 'pointer-events': 'none', 'aria-hidden': 'true' });
    mark.append(node('circle', { r: '12', fill: '#173a3c', stroke: district.color, 'stroke-width': '2', 'stroke-dasharray': district.status === 'building' ? '3 2' : 'none' }), node('path', { d: district.mark === 'wonder' ? WONDER_MARK_PATH : district.mark === 'pasture' ? PASTORAL_MARK_PATH : district.mark === 'lumber' ? LUMBER_MARK_PATH : district.mark === 'catchment' ? CATCHMENT_MARK_PATH : SITE_MARK_PATHS[district.mark], transform: 'translate(-9 -9) scale(.75)', fill: 'none', stroke: '#fff3c6', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    if ('adjacency' in district && district.adjacency?.source === 'improvement') {
      const bonus = node('text', { x: '0', y: '25', 'text-anchor': 'middle', 'font-size': '11', 'font-family': 'Arial, sans-serif', fill: '#fff3c6', stroke: '#173a3c', 'stroke-width': '3', 'paint-order': 'stroke' });
      bonus.textContent = `+${district.adjacency.bonus} base`;
      mark.append(bonus);
    }
    const markLeader = node('line', { stroke: district.color, 'stroke-width': '1.5', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
    group.append(leader, parts, markLeader, hit, mark, label);
    group.addEventListener('click', () => onSelect(district.cityId, 'workId' in district ? district.workId : undefined));
    group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(district.cityId, 'workId' in district ? district.workId : undefined); } });
    districts.append(group);
    districtNodes.push({ element: group, parts, hit, label, leader, mark, markLeader, index, placed: false });
  }
  for (const [index, deposit] of (world.deposits ?? []).entries()) {
    const point = hexPosition(deposit.q, deposit.r);
    const group = node('g', { transform: `translate(${point.x} ${point.z})`, 'data-deposit-id': deposit.id, role: 'img', 'aria-label': depositLabel(deposit) });
    const parts = node('g', {}); const mark = node('g', {});
    mark.append(node('circle', { r: '7', fill: '#edf1e6', stroke: '#293c43', 'stroke-width': '1.5' }), node('path', { d: SITE_MARK_PATHS.iron, transform: 'translate(-6 -6) scale(.5)', fill: 'none', stroke: '#293c43', 'stroke-width': '2' }));
    const label = node('text', { 'text-anchor': 'middle', fill: '#fff5d8', stroke: '#173a3c', 'paint-order': 'stroke', 'font-family': 'Arial, sans-serif' });
    group.append(parts, mark, label); deposits.append(group); depositNodes.push({ parts, mark, label, index });
  }
  for (const site of world.pastoralSites ?? []) {
    const point = hexPosition(site.q, site.r);
    const group = node('g', { transform: `translate(${point.x} ${point.z})`, 'data-horse-site': String(site.tileId), role: 'img', 'aria-label': pastoralSiteLabel(site.tileId) });
    const mark = node('g', {});
    mark.append(node('circle', { r: '9', fill: '#e6d7a5', stroke: '#294b33', 'stroke-width': '1.5' }), node('path', { d: PASTORAL_MARK_PATH, transform: 'translate(-8 -8) scale(.67)', fill: 'none', stroke: '#294b33', 'stroke-width': '2' }));
    const label = node('text', { 'text-anchor': 'middle', fill: '#fff5d8', stroke: '#173a3c', 'paint-order': 'stroke', 'font-family': 'Arial, sans-serif' });
    group.append(mark, label); deposits.append(group); pastoralNodes.push({ element: group, mark, label, id: site.id, q: site.q, r: site.r, revealedTo: site.revealedTo });
  }
  for (const [index, city] of world.cities.entries()) {
    const point = hexPosition(city.q, city.r);
    const group = node('g', { class: 'flat-city', 'data-city-id': cityKey(city), transform: `translate(${point.x} ${point.z})`, role: 'button', tabindex: '0', 'aria-label': `Inspect ${damageMapLabel(city.capital, city.settlement?.damage ?? 0)}, ${city.name}` });
    const hit = node('circle', { class: 'city-hit', r: '2.2' });
    const ring = node('circle', { class: 'city-marker', r: '0.85', fill: '#193a3c', stroke: city.color, 'stroke-width': '0.15' });
    const settlement = node('g', { class: 'settlement-parts', transform: `translate(${point.x} ${point.z})` });
    settlements.push({ element: settlement, index });
    settlementShapes.append(settlement);
    const leader = node('line', { stroke: city.color, 'stroke-width': '1', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
    group.append(leader, hit, ring);
    const marker = node('text', { 'text-anchor': 'middle', y: '0.24', fill: '#fff5d8', 'font-size': '0.7', 'font-family': 'Arial, sans-serif' });
    marker.textContent = city.name.slice(0, 1);
    group.append(marker);
    const label = node('text', { 'text-anchor': 'middle', y: '1.45', fill: '#fff5d8', 'font-size': '0.55', 'font-family': 'Arial, sans-serif', stroke: '#173a3c', 'stroke-width': '0.11', 'paint-order': 'stroke' });
    label.textContent = damageMapLabel(city.capital, city.settlement?.damage ?? 0);
    group.append(label);
    const choose = (): void => onSelect(cityKey(city));
    group.addEventListener('click', choose);
    group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
    cities.append(group);
    cityNodes.push({ id: cityKey(city), element: group, hit, ring, marker, label, leader });
  }
  borders.style.display = preferences.borders ? '' : 'none';
  routes.style.display = preferences.routes ? '' : 'none';
  svg.append(coast, land, borders, terrain, routes, deposits, settlementShapes, districts, cities);
  container.prepend(svg);
  const cues = createWorldCues(container, world, (px, pz) => {
    const box = svg.viewBox.baseVal;
    return { x: (px - box.x) / box.width * container.clientWidth, y: (pz - box.y) / box.height * container.clientHeight };
  });
  cues.setMotion(resolveAppearance(preferences, false, window.matchMedia('(prefers-reduced-motion: reduce)').matches).motion);
  const resize = (): void => {
    const aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    const halfHeight = (aspect < 1 ? 26 : 16) / zoom;
    svg.setAttribute('viewBox', `${x - halfHeight * aspect} ${z - halfHeight} ${halfHeight * aspect * 2} ${halfHeight * 2}`);
    const pixelsPerUnit = container.clientHeight / (halfHeight * 2);
    const nextDetail = visualDetail(pixelsPerUnit * 2, detail);
    if (nextDetail !== detail) {
      detail = nextDetail;
      svg.dataset['detail'] = detail;
      paintParts(terrain, projectLandscape(world.tiles, [...world.cities, ...(world.districts ?? []), ...(world.improvements ?? []), ...(world.wonders ?? [])], detail).parts, VISUAL_PALETTE.stone);
      for (const entry of depositNodes) { const deposit = world.deposits?.[entry.index]; if (deposit) paintParts(entry.parts, depositParts(deposit, detail), VISUAL_PALETTE.metal); }
      for (const entry of districtNodes) {
        const district = sites[entry.index];
        if (district) paintParts(entry.parts, district.parts(detail), district.color);
      }
      for (const entry of settlements) {
        const city = world.cities[entry.index];
        if (!city?.settlement) continue;
        const visual = settlementVisual(city.settlement, detail);
        entry.element.replaceChildren();
        entry.element.dataset['houses'] = String(visual.houses);
        entry.element.dataset['buildings'] = city.settlement.buildings.join(' ');
        paintParts(entry.element, visual.parts, city.color);
      }
    }
    const box = svg.viewBox.baseVal;
    const project = (q: number, r: number): { x: number; y: number } => {
      const point = hexPosition(q, r);
      return { x: (point.x - box.x) * pixelsPerUnit, y: (point.z - box.y) * pixelsPerUnit };
    };
    const allocation = allocateMapHierarchy(mapHierarchyAnchors(world, selected, routes.style.display === 'none' ? null : selectedRoute, project), {
      width: container.clientWidth, height: container.clientHeight, tileDiameter: pixelsPerUnit * 2,
      previousDetail: detail, blocked: mapHierarchyObstacles(container),
    });
    svg.dataset['mapMarks'] = String(allocation.items.filter(item => item.mark).length);
    const placements = new Map(allocation.items.map(item => [item.id, item]));
    for (const city of cityNodes) {
      const placement = placements.get(city.id);
      const mark = placement?.mark;
      city.element.style.visibility = mark ? 'visible' : 'hidden';
      city.element.setAttribute('tabindex', mark ? '0' : '-1');
      if (!mark) city.label.style.visibility = 'hidden';
      if (!placement || !mark) continue;
      const dx = (mark.left + mark.width / 2 - placement.anchor.x) / pixelsPerUnit;
      const dy = (mark.top + mark.height / 2 - placement.anchor.y) / pixelsPerUnit;
      city.hit.setAttribute('r', String(22 / pixelsPerUnit));
      city.hit.setAttribute('cx', String(dx)); city.hit.setAttribute('cy', String(dy));
      city.ring.setAttribute('r', String(placement.symbolSize / 2 / pixelsPerUnit));
      city.ring.setAttribute('cx', String(dx)); city.ring.setAttribute('cy', String(dy));
      city.ring.setAttribute('stroke-width', String(2 / pixelsPerUnit));
      city.marker.setAttribute('font-size', String(12 / pixelsPerUnit));
      city.marker.setAttribute('x', String(dx)); city.marker.setAttribute('y', String(dy + 4 / pixelsPerUnit));
      city.leader.setAttribute('x2', String(dx)); city.leader.setAttribute('y2', String(dy));
      city.label.style.visibility = placement.label ? 'visible' : 'hidden';
      if (placement.label) {
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
      entry.mark.style.visibility = mark ? 'visible' : 'hidden'; entry.markLeader.style.visibility = mark ? 'visible' : 'hidden';
      entry.hit.style.pointerEvents = mark ? 'all' : 'none'; entry.element.setAttribute('tabindex', mark ? '0' : '-1');
      entry.element.setAttribute('aria-hidden', String(!mark));
      entry.label.style.visibility = placement?.label ? 'visible' : 'hidden'; entry.leader.style.visibility = 'hidden';
      if (!placement || !mark) continue;
      const dx = (mark.left + mark.width / 2 - placement.anchor.x) / pixelsPerUnit;
      const dy = (mark.top + mark.height / 2 - placement.anchor.y) / pixelsPerUnit;
      entry.mark.setAttribute('transform', `translate(${dx} ${dy}) scale(${placement.symbolSize / 24 / pixelsPerUnit})`);
      entry.markLeader.setAttribute('x2', String(dx)); entry.markLeader.setAttribute('y2', String(dy));
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
    cues.update();
  };
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
        return `${center.x + Math.cos(angle) * .88},${center.z + Math.sin(angle) * .88}`;
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
    if (event.target instanceof Element && event.target.closest('.flat-city, .flat-route, .flat-district')) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, originX: x, originZ: z };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const scale = svg.viewBox.baseVal.height / Math.max(container.clientHeight, 1);
    x = Math.max(-100, Math.min(100, pointer.originX - (event.clientX - pointer.x) * scale));
    z = Math.max(-100, Math.min(100, pointer.originZ - (event.clientY - pointer.y) * scale));
    resize();
  });
  svg.addEventListener('pointerup', () => { pointer = null; });
  svg.addEventListener('pointercancel', () => { pointer = null; });
  return {
    zoom: (factor) => { zoom = Math.min(MAP_ZOOM.maximum, Math.max(MAP_ZOOM.minimum, zoom * factor)); resize(); },
    reset: () => {
      const viewport = { width: container.clientWidth, height: container.clientHeight };
      const window = mapContentWindow(viewport.width, viewport.height, mapHierarchyObstacles(container));
      const fit = window && fitMapOverview(world.tiles.map(tile => hexPosition(tile.q, tile.r)), viewport, window);
      if (fit) { x = fit.x; z = fit.z; zoom = Math.min(MAP_ZOOM.maximum, Math.max(MAP_ZOOM.minimum, (viewport.width < viewport.height ? 26 : 16) / fit.halfHeight)); }
      resize();
    },
    select,
    selectRoute: (id) => { if (id !== selectedRoute) { selectedRoute = id; drawRoutes(); resize(); } },
    frameCity: (id, anchor) => {
      const city = world.cities.find((candidate) => cityKey(candidate) === id);
      if (!city) return;
      const point = hexPosition(city.q, city.r);
      const box = svg.viewBox.baseVal;
      const shift = cameraShiftForAnchor(
        { x: (point.x - box.x) / box.width, y: (point.z - box.y) / box.height },
        anchor, { x: 1 / box.width, y: 0 }, { x: 0, y: 1 / box.height },
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
    dispose: () => { observer.disconnect(); cues.dispose(); svg.remove(); },
  };
}
