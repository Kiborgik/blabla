import { hexPosition, TERRAIN_COLORS } from './atlas.ts';
import type { AtlasWorld } from './atlas.ts';
import type { AtlasRenderer } from './renderer.ts';
import type { ViewerPreferences } from './viewer-state.ts';
import { cameraShiftForAnchor } from './inspection-camera.ts';
import { settlementVisual, VISUAL_PALETTE, visualDetail } from '../visuals/world-visuals.ts';
import type { DetailLevel } from '../visuals/world-visuals.ts';
import { flatPartFaces } from './settlement-parts.ts';
import { createWorldCues } from './world-cues.ts';
import { mapLabelVisibility } from './map-labels.ts';

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
  onSelect: (id: number) => void,
): AtlasRenderer {
  const svg = node('svg', { class: 'flat-atlas', role: 'group', 'aria-label': `${world.illustrative ? 'Sample' : 'Committed world'} two dimensional map. Select a city to inspect.` });
  const land = node('g', {});
  const borders = node('g', { 'pointer-events': 'none' });
  const routes = node('g', { 'pointer-events': 'none' });
  const cities = node('g', {});
  const settlements: Array<{ element: SVGGElement; index: number }> = [];
  let detail: DetailLevel | undefined;
  const cityNodes: Array<{ id: number; element: SVGGElement; hit: SVGCircleElement; ring: SVGCircleElement; marker: SVGTextElement; label: SVGTextElement }> = [];
  let selected = preferences.selected;
  let zoom = preferences.zoom;
  let x = preferences.x;
  let z = preferences.z;
  for (const tile of world.tiles) {
    const point = hexPosition(tile.q, tile.r);
    const points = Array.from({ length: 6 }, (_, index) => {
      const angle = Math.PI / 3 * index + Math.PI / 6;
      return `${point.x + Math.cos(angle)},${point.z + Math.sin(angle)}`;
    }).join(' ');
    land.append(node('polygon', { points, fill: TERRAIN_COLORS[tile.terrain], stroke: '#2c6269', 'stroke-width': '0.035' }));
    const owner = world.cities.find((city) => city.id === tile.owner);
    if (owner) borders.append(node('polygon', { points, fill: owner.color, 'fill-opacity': '0.12', stroke: owner.color, 'stroke-opacity': '0.6', 'stroke-width': '0.055' }));
  }
  for (const [from, to] of world.routes) {
    const origin = world.cities[from];
    const destination = world.cities[to];
    if (!origin || !destination) continue;
    const a = hexPosition(origin.q, origin.r);
    const b = hexPosition(destination.q, destination.r);
    routes.append(node('line', { x1: String(a.x), y1: String(a.z), x2: String(b.x), y2: String(b.z), stroke: '#fff0b9', 'stroke-width': '0.12', 'stroke-dasharray': '0.3 0.18' }));
  }
  for (const [index, city] of world.cities.entries()) {
    const point = hexPosition(city.q, city.r);
    const group = node('g', { class: 'flat-city', transform: `translate(${point.x} ${point.z})`, role: 'button', tabindex: '0', 'aria-label': `Inspect ${city.capital}, ${city.name}` });
    const hit = node('circle', { class: 'city-hit', r: '2.2' });
    const ring = node('circle', { class: 'city-marker', r: '0.85', fill: '#193a3c', stroke: city.color, 'stroke-width': '0.15' });
    const settlement = node('g', { class: 'settlement-parts' });
    settlements.push({ element: settlement, index });
    group.append(settlement, hit, ring);
    const marker = node('text', { 'text-anchor': 'middle', y: '0.24', fill: '#fff5d8', 'font-size': '0.7', 'font-family': 'Arial, sans-serif' });
    marker.textContent = city.name.slice(0, 1);
    group.append(marker);
    const label = node('text', { 'text-anchor': 'middle', y: '1.45', fill: '#fff5d8', 'font-size': '0.55', 'font-family': 'Arial, sans-serif', stroke: '#173a3c', 'stroke-width': '0.11', 'paint-order': 'stroke' });
    label.textContent = city.capital;
    group.append(label);
    const choose = (): void => onSelect(city.id);
    group.addEventListener('click', choose);
    group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
    cities.append(group);
    cityNodes.push({ id: city.id, element: group, hit, ring, marker, label });
  }
  borders.style.display = preferences.borders ? '' : 'none';
  routes.style.display = preferences.routes ? '' : 'none';
  svg.append(land, borders, routes, cities);
  container.prepend(svg);
  const cues = createWorldCues(container, world, (px, pz) => {
    const box = svg.viewBox.baseVal;
    return { x: (px - box.x) / box.width * container.clientWidth, y: (pz - box.y) / box.height * container.clientHeight };
  });
  cues.setMotion(!preferences.paused && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
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
      for (const entry of settlements) {
        const city = world.cities[entry.index];
        if (!city?.settlement) continue;
        const visual = settlementVisual(city.settlement, detail);
        entry.element.replaceChildren();
        entry.element.dataset['houses'] = String(visual.houses);
        entry.element.dataset['buildings'] = city.settlement.buildings.join(' ');
        for (const part of visual.parts) {
          const color = part.material === 'identity' ? city.color : VISUAL_PALETTE[part.material];
          const group = node('g', { 'data-part': part.id });
          for (const face of flatPartFaces(part)) {
            group.append(node('polygon', { points: face.points, fill: color, stroke: '#233e37', 'stroke-width': '0.025', 'stroke-linejoin': 'round' }));
            if (face.shade) group.append(node('polygon', { points: face.points, fill: '#172c30', 'fill-opacity': String(face.shade) }));
          }
          entry.element.append(group);
        }
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
    const box = svg.viewBox.baseVal;
    const visibility = mapLabelVisibility(world.cities.map((city) => {
      const point = hexPosition(city.q, city.r);
      return { id: city.id, x: (point.x - box.x) * pixelsPerUnit, y: (point.z - box.y + metrics.labelY) * pixelsPerUnit, width: Math.max(44, city.capital.length * 6.5), height: 14 };
    }), selected, nextDetail, container.clientWidth, container.clientHeight);
    cityNodes.forEach((city, index) => { city.label.style.visibility = visibility[index] ? 'visible' : 'hidden'; });
    cues.update();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  const select = (id: number): void => {
    selected = id;
    for (const city of cityNodes) {
      city.element.classList.toggle('selected', city.id === id);
      city.element.setAttribute('aria-pressed', String(city.id === id));
    }
    resize();
  };
  select(preferences.selected);
  let pointer: { id: number; x: number; y: number; originX: number; originZ: number } | null = null;
  svg.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Element && event.target.closest('.flat-city')) return;
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
    frameCity: (id, anchor) => {
      const city = world.cities.find((candidate) => candidate.id === id);
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
    setLayer: (layer, visible) => { (layer === 'borders' ? borders : routes).style.display = visible ? '' : 'none'; },
    snapshot: () => ({ zoom, x, z }),
    showEvents: cues.show,
    setMotion: cues.setMotion,
    dispose: () => { observer.disconnect(); cues.dispose(); svg.remove(); },
  };
}
