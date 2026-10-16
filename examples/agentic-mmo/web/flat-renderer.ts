import { depositParts, depositLabel, SITE_MARK_PATHS, placeSiteMarks } from '../visuals/strategic-resource-visuals.ts';
import { visibleRoutePaths } from '../visuals/route-paths.ts';
import { routeLabelKey, routeLabelPlacement, routeTitle, routeVisual, routeMapLabel } from '../visuals/route-visuals.ts';
import { damageMapLabel } from '../visuals/damage-visuals.ts';
import { cityKey, selectedCity } from './city-selection.ts';
import { projectLandscape, landscapeSurface, LANDSCAPE_COLORS } from '../visuals/landscape.ts';
import { hexPosition, routeMapPositions, routeMapAnchor } from './atlas.ts';
import type { RouteView } from '../visuals/route-visuals.ts';
import type { AtlasWorld } from './atlas.ts';
import type { AtlasRenderer } from './renderer.ts';
import type { ViewerPreferences } from './viewer-state.ts';
import { resolveAppearance } from './viewer-appearance.ts';
import { cameraShiftForAnchor } from './inspection-camera.ts';
import { settlementVisual, VISUAL_PALETTE, visualDetail } from '../visuals/world-visuals.ts';
import type { DetailLevel } from '../visuals/world-visuals.ts';
import { flatSceneFaces, mapOverlayBounds } from './settlement-parts.ts';
import { createWorldCues } from './world-cues.ts';
import { mapLabelVisibility } from './map-labels.ts';
import { improvementLabel, improvementParts } from '../visuals/improvement-visuals.ts';
import { districtCaptionPlacement, districtAdjacencySummary, districtLabel, districtParts } from '../visuals/district-visuals.ts';

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

export function createFlatAtlasRenderer(
  container: HTMLElement,
  world: AtlasWorld,
  preferences: ViewerPreferences,
  onSelect: (id: string) => void,
  onRoute: (id: string) => void,
): AtlasRenderer {
  const svg = node('svg', { class: 'flat-atlas', role: 'group', 'aria-label': `${world.illustrative ? 'Sample' : 'Committed world'} two dimensional map. Select a city to inspect.` });
  const coast = node('g', { 'pointer-events': 'none' });
  const land = node('g', {});
  const terrain = node('g', { 'pointer-events': 'none', class: 'landscape-parts' });
  const borders = node('g', { 'pointer-events': 'none' });
  const routes = node('g', { class: 'flat-routes' });
  let selectedRoute: string | null = null;
  let routeLabel: { element: SVGGElement; x: number; z: number; id: string } | null = null;
  const cities = node('g', {});
  const districts = node('g', { class: 'flat-districts' });
  const deposits = node('g', { class: 'flat-deposits', 'pointer-events': 'none' });
  const depositNodes: Array<{ parts: SVGGElement; mark: SVGGElement; index: number }> = [];
  const sites = [
    ...(world.districts ?? []).map(site => ({ ...site, kind: 'district', mark: site.buildingId === 'industrial-zone' ? 'industry' as const : site.buildingId === 'commercial-hub' ? 'commerce' as const : 'campus' as const, caption: site.name ?? 'Campus', label: districtLabel(site), parts: (level: DetailLevel) => districtParts(site, level) })),
    ...(world.improvements ?? []).map(site => ({ ...site, kind: 'improvement', mark: 'mine' as const, caption: site.name, label: improvementLabel(site), parts: (level: DetailLevel) => improvementParts(site, level) })),
  ];
  const districtNodes: Array<{ element: SVGGElement; parts: SVGGElement; hit: SVGCircleElement; label: SVGTextElement; leader: SVGLineElement; mark: SVGGElement; markLeader: SVGLineElement; index: number; placed: boolean }> = [];
  const settlements: Array<{ element: SVGGElement; index: number }> = [];
  let detail: DetailLevel | undefined;
  const cityNodes: Array<{ id: string; element: SVGGElement; hit: SVGCircleElement; ring: SVGCircleElement; marker: SVGTextElement; label: SVGTextElement }> = [];
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
  for (const edge of landscape.borders) {
    const owner = world.cities.find(city => city.id === edge.owner);
    if (owner) borders.append(node('path', { d: `M${edge.from.join(' ')}L${edge.to.join(' ')}`, fill: 'none', stroke: owner.color, 'stroke-opacity': '.9', 'stroke-width': '.09', 'stroke-linecap': 'round' }));
  }
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
        const background = node('rect', { x: '-90', y: '-22', width: '180', height: '44', rx: '5', fill: '#193a3c', stroke: visual.color });
        const title = node('text', { 'text-anchor': 'middle', y: '4', fill: '#fff5d8', 'font-size': '12', 'font-family': 'Arial, sans-serif' });
        title.textContent = routeMapLabel(route);
        label.append(background, title);
        group.append(label);
        routeLabel = { element: label, x: anchor.x, z: anchor.z, id: routeLabelKey(route.id) };
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
    mark.append(node('circle', { r: '12', fill: '#173a3c', stroke: district.color, 'stroke-width': '2', 'stroke-dasharray': district.status === 'building' ? '3 2' : 'none' }), node('path', { d: SITE_MARK_PATHS[district.mark], transform: 'translate(-9 -9) scale(.75)', fill: 'none', stroke: '#fff3c6', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    if ('adjacency' in district && district.adjacency?.source === 'improvement') {
      const bonus = node('text', { x: '0', y: '25', 'text-anchor': 'middle', 'font-size': '11', 'font-family': 'Arial, sans-serif', fill: '#fff3c6', stroke: '#173a3c', 'stroke-width': '3', 'paint-order': 'stroke' });
      bonus.textContent = `+${district.adjacency.bonus} base`;
      mark.append(bonus);
    }
    const markLeader = node('line', { stroke: district.color, 'stroke-width': '1.5', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
    group.append(leader, parts, markLeader, hit, mark, label);
    group.addEventListener('click', () => onSelect(district.cityId));
    group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(district.cityId); } });
    districts.append(group);
    districtNodes.push({ element: group, parts, hit, label, leader, mark, markLeader, index, placed: false });
  }
  for (const [index, deposit] of (world.deposits ?? []).entries()) {
    const point = hexPosition(deposit.q, deposit.r);
    const group = node('g', { transform: `translate(${point.x} ${point.z})`, 'data-deposit-id': deposit.id, role: 'img', 'aria-label': depositLabel(deposit) });
    const parts = node('g', {}); const mark = node('g', {});
    mark.append(node('circle', { r: '7', fill: '#edf1e6', stroke: '#293c43', 'stroke-width': '1.5' }), node('path', { d: SITE_MARK_PATHS.iron, transform: 'translate(-6 -6) scale(.5)', fill: 'none', stroke: '#293c43', 'stroke-width': '2' }));
    group.append(parts, mark); deposits.append(group); depositNodes.push({ parts, mark, index });
  }
  for (const [index, city] of world.cities.entries()) {
    const point = hexPosition(city.q, city.r);
    const group = node('g', { class: 'flat-city', 'data-city-id': cityKey(city), transform: `translate(${point.x} ${point.z})`, role: 'button', tabindex: '0', 'aria-label': `Inspect ${damageMapLabel(city.capital, city.settlement?.damage ?? 0)}, ${city.name}` });
    const hit = node('circle', { class: 'city-hit', r: '2.2' });
    const ring = node('circle', { class: 'city-marker', r: '0.85', fill: '#193a3c', stroke: city.color, 'stroke-width': '0.15' });
    const settlement = node('g', { class: 'settlement-parts' });
    settlements.push({ element: settlement, index });
    group.append(settlement, hit, ring);
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
    cityNodes.push({ id: cityKey(city), element: group, hit, ring, marker, label });
  }
  borders.style.display = preferences.borders ? '' : 'none';
  routes.style.display = preferences.routes ? '' : 'none';
  svg.append(coast, land, borders, terrain, routes, deposits, districts, cities);
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
    const metrics = cityScreenMetrics(pixelsPerUnit);
    const nextDetail = visualDetail(pixelsPerUnit * 2, detail);
    if (nextDetail !== detail) {
      detail = nextDetail;
      svg.dataset['detail'] = detail;
      paintParts(terrain, projectLandscape(world.tiles, [...world.cities, ...(world.districts ?? []), ...(world.improvements ?? [])], detail).parts, VISUAL_PALETTE.stone);
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
    for (const city of cityNodes) {
      city.hit.setAttribute('r', String(metrics.targetRadius));
      const markerY = -Math.max(1.2, 17 / pixelsPerUnit);
      city.ring.setAttribute('r', String(metrics.markerRadius));
      city.ring.setAttribute('cy', String(markerY));
      city.marker.setAttribute('font-size', String(metrics.markerFont));
      city.marker.setAttribute('y', String(markerY + metrics.markerFont * 0.34));
      city.label.setAttribute('font-size', String(metrics.labelFont));
      city.label.setAttribute('y', String(metrics.labelY));
    }
    for (const entry of depositNodes) entry.mark.setAttribute('transform', `translate(0 ${-14 / pixelsPerUnit}) scale(${1 / pixelsPerUnit})`);
    const box = svg.viewBox.baseVal;
    const labelPositions = world.cities.map((city) => {
      const point = hexPosition(city.q, city.r);
      return { id: cityKey(city), x: (point.x - box.x) * pixelsPerUnit, y: (point.z - box.y + metrics.labelY) * pixelsPerUnit, width: Math.max(44, damageMapLabel(city.capital, city.settlement?.damage ?? 0).length * 6.5), height: 14 };
    });
    const targetTop = Math.max(metrics.targetRadius * pixelsPerUnit, Math.max(1.2 * pixelsPerUnit, 17) + metrics.markerRadius * pixelsPerUnit);
    const targetBottom = Math.max(metrics.targetRadius * pixelsPerUnit, metrics.labelY * pixelsPerUnit + 6);
    const townTargets = labelPositions.map((label) => ({ x: label.x, y: label.y - metrics.labelY * pixelsPerUnit - targetTop, width: Math.max(label.width, metrics.targetRadius * pixelsPerUnit * 2), height: targetTop + targetBottom }));
    const marks = placeSiteMarks(sites.map(site => { const point = hexPosition(site.q, site.r); return { id: site.id, cityId: site.cityId, family: site.mark, x: (point.x - box.x) * pixelsPerUnit, y: (point.z - box.y) * pixelsPerUnit }; }), [...townTargets, ...mapOverlayBounds(container)], container.clientWidth, container.clientHeight, selected);
    for (const entry of districtNodes) {
      const district = sites[entry.index];
      if (!district) continue;
      const point = hexPosition(district.q, district.r);
      const mark = marks.find(candidate => candidate.id === district.id);
      const dx = mark ? (mark.x / pixelsPerUnit + box.x - point.x) : 0;
      const dy = mark ? (mark.y / pixelsPerUnit + box.y - point.z) : 0;
      entry.mark.setAttribute('transform', `translate(${dx} ${dy}) scale(${1 / pixelsPerUnit})`);
      entry.mark.style.visibility = mark ? 'visible' : 'hidden'; entry.markLeader.style.visibility = mark ? 'visible' : 'hidden';
      entry.markLeader.setAttribute('x2', String(dx)); entry.markLeader.setAttribute('y2', String(dy));
      entry.hit.setAttribute('cx', String(dx)); entry.hit.setAttribute('cy', String(dy));
      entry.hit.setAttribute('r', String(22 / pixelsPerUnit));
      entry.label.setAttribute('font-size', String(12 / pixelsPerUnit));
      const anchor = { x: (point.x - box.x) * pixelsPerUnit, y: (point.z - box.y) * pixelsPerUnit };
      const placement = districtCaptionPlacement(anchor, [...townTargets, ...mapOverlayBounds(container)], container.clientWidth, container.clientHeight, Math.max(44, district.caption.length * 7));
      entry.placed = placement !== null;
      if (placement) {
        entry.label.setAttribute('x', String((placement.x - anchor.x) / pixelsPerUnit));
        entry.label.setAttribute('y', String((placement.y + 12 - anchor.y) / pixelsPerUnit));
        entry.leader.setAttribute('x2', String((placement.x - anchor.x) / pixelsPerUnit));
        entry.leader.setAttribute('y2', String((placement.y + 16 - anchor.y) / pixelsPerUnit));
      }
      labelPositions.push({ id: district.id, ...(placement ?? { x: -1000, y: -1000, width: 44, height: 16 }) });
    }
    const placedRouteLabel = routeLabel && routes.style.display !== 'none'
      ? routeLabelPlacement({ x: (routeLabel.x - box.x) * pixelsPerUnit, y: (routeLabel.z - box.y) * pixelsPerUnit }, townTargets, container.clientWidth, container.clientHeight) : null;
    if (routeLabel && placedRouteLabel) {
      routeLabel.element.setAttribute('transform', `translate(${box.x + placedRouteLabel.x / pixelsPerUnit} ${box.y + (placedRouteLabel.y + 22) / pixelsPerUnit}) scale(${1 / pixelsPerUnit})`);
      labelPositions.unshift({ id: routeLabel.id, ...placedRouteLabel });
    }
    const selectedDistricts = new Set(sites.filter(district => district.cityId === selected).map(district => district.id));
    const prioritized = labelPositions.toSorted((a, b) => Number(selectedDistricts.has(b.id)) - Number(selectedDistricts.has(a.id)));
    const shown = mapLabelVisibility(prioritized, selected, nextDetail, container.clientWidth, container.clientHeight);
    const visibilityById = new Map(prioritized.map((label, index) => [label.id, shown[index]]));
    const visibility = labelPositions.map(label => visibilityById.get(label.id));
    const routeLabelOffset = placedRouteLabel ? 1 : 0;
    if (routeLabel) routeLabel.element.style.visibility = routeLabelOffset && visibility[0] ? 'visible' : 'hidden';
    cityNodes.forEach((city, index) => { city.label.style.visibility = visibility[index + routeLabelOffset] ? 'visible' : 'hidden'; });
    districtNodes.forEach((district, index) => { const visible = district.placed && visibility[world.cities.length + index + routeLabelOffset]; district.label.style.visibility = visible ? 'visible' : 'hidden'; district.leader.style.visibility = visible ? 'visible' : 'hidden'; });
    cues.update();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  const select = (id: string): void => {
    selected = id;
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
    zoom: (factor) => { zoom = Math.min(2.2, Math.max(0.65, zoom * factor)); resize(); },
    reset: () => { zoom = 1; x = 0; z = 0; resize(); },
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
