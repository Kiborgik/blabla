import * as THREE from 'three';
import type { AtlasRenderer } from './renderer.ts';
import type { ViewerPreferences } from './viewer-state.ts';
import { MAP_ZOOM } from './viewer-state.ts';
import type { CameraView, ScreenPoint } from './inspection-camera.ts';
import { marsBodyScene, marsSelectionId, marsStatusLabel } from '../visuals/mars-body.ts';
import type { MarsBodyObservation, MarsBodyScene, MarsBodySite } from '../visuals/mars-body.ts';
import { flatMapPoint, flatSceneFaces } from './settlement-parts.ts';
import { createPartMeshes } from './settlement-three.ts';
import { mapContentWindow } from '../visuals/map-hierarchy.ts';
import type { ScreenBox } from '../visuals/map-hierarchy.ts';
import { mapHierarchyObstacles } from './map-labels.ts';

const SKY = '#382e31';
const VERTICAL = Math.hypot(.72, .85);

export function createMarsSceneMeshes(scene: MarsBodyScene): { group: THREE.Group; dispose: () => void } {
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const meshes = createPartMeshes(() => scene.parts.map(entry => ({ part: entry.part, color: entry.color })), color => {
    let material = materials.get(color);
    if (!material) { material = new THREE.MeshStandardMaterial({ color, roughness: .91, metalness: .04 }); materials.set(color, material); }
    return material;
  });
  meshes.update(48);
  let disposed = false;
  return { group: meshes.group, dispose: () => {
    if (disposed) return;
    disposed = true; meshes.dispose(); for (const material of materials.values()) material.dispose(); materials.clear();
  } };
}

function bounded(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

export function createMarsBodyRenderer(
  container: HTMLElement,
  labels: HTMLElement,
  observation: MarsBodyObservation,
  preferences: ViewerPreferences,
  onSelect: (id: string) => void,
  mode: 'flat' | 'webgl',
): AtlasRenderer {
  const scene = marsBodyScene(observation);
  const overlay = document.createElement('div'); overlay.className = 'mars-body-labels';
  Object.assign(overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
  const context = document.createElement('p'); context.className = 'mars-body-context';
  context.textContent = observation.contextLabel;
  Object.assign(context.style, { position: 'absolute', transform: 'translateX(-50%)', margin: '0',
    textAlign: 'center', color: '#f3dfc5', fontSize: '10px', lineHeight: '1.4', textShadow: '0 1px 3px #261f23' });
  overlay.append(context);
  const stateText = scene.sites.length === 0 && !observation.terminal ? document.createElement('p') : null;
  if (stateText) {
    stateText.className = 'mars-body-state';
    stateText.textContent = scene.transits.length ? 'No colony has arrived · missions are still in transit' : 'No colony has arrived on Mars';
    Object.assign(stateText.style, { position: 'absolute', transform: 'translateX(-50%)', margin: '0',
      color: '#ffe8cc', fontSize: '12px', textAlign: 'center', textShadow: '0 1px 4px #261f23' });
    overlay.append(stateText);
  }
  let selected = preferences.selectedCity ?? marsSelectionId(preferences.selected);
  const listeners: Array<() => void> = [];
  const listen = (element: EventTarget, event: string, handler: EventListener, options?: AddEventListenerOptions): void => {
    element.addEventListener(event, handler, options); listeners.push(() => element.removeEventListener(event, handler, options));
  };
  const markers = [...scene.sites, ...scene.transits].map(site => {
    const civ = observation.civilizations.find(candidate => candidate.id === site.civilizationId)!;
    const transit = 'missionId' in site;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'mars-body-marker';
    button.dataset['selectionId'] = site.selectionId; button.dataset['kind'] = transit ? 'transit' : 'colony';
    button.setAttribute('aria-label', site.label); button.title = site.label;
    const name = document.createElement('strong'); const status = document.createElement('small'); button.append(name, status);
    Object.assign(button.style, { position: 'absolute', transform: 'translateX(-50%)', minHeight: '44px', minWidth: '44px', boxSizing: 'border-box',
      border: `1px solid ${civ.color}`, borderRadius: '4px', background: '#25323aeb', color: '#fff0d8',
      font: 'inherit', padding: '4px 7px', pointerEvents: 'auto', cursor: 'pointer', lineHeight: '1.25', maxWidth: '180px' });
    Object.assign(name.style, { display: 'block', fontSize: '12px', fontWeight: '500' });
    Object.assign(status.style, { display: 'block', fontSize: '9px', marginTop: '2px' });
    listen(button, 'click', () => { if (disposed) return; select(site.selectionId); onSelect(site.selectionId); });
    overlay.append(button);
    return { site, button, name, status, civ, transit };
  });
  const view: CameraView = { zoom: bounded(preferences.zoom, MAP_ZOOM.minimum, MAP_ZOOM.maximum, 1),
    x: bounded(preferences.x, -20, 20, 0), z: bounded(preferences.z, -20, 20, 0) };
  let disposed = false; let width = 1; let height = 1; let pixels = 1;
  let available: ScreenBox = { left: 0, top: 0, width: 1, height: 1 };
  let origin: ScreenPoint = { x: 0, y: 0 };
  let drawSurface: () => void;
  let disposeSurface: () => void;
  let surface: SVGSVGElement | HTMLCanvasElement;
  const screen = (position: readonly [number, number, number]): ScreenPoint => {
    const point = flatMapPoint(position[0] - view.x - 1, position[2] - view.z + 4, position[1]);
    return { x: origin.x + point.x * pixels, y: origin.y + point.z * pixels };
  };
  if (mode === 'flat') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); surface = svg;
    svg.classList.add('mars-body-surface'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Mars diorama. Illustrative red terrain with only recorded colonies and active missions.');
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const colors = new Map(scene.parts.map(entry => [entry.part.id, entry.color]));
    for (const layer of ['ground', 'landmark', 'recorded'] as const) {
      const shapes = document.createElementNS('http://www.w3.org/2000/svg', 'g'); shapes.setAttribute('data-layer', layer);
      for (const face of flatSceneFaces(scene.parts.filter(entry => entry.layer === layer).map(entry => entry.part), .72)) {
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', face.points); polygon.setAttribute('fill', colors.get(face.part.id)!);
        polygon.setAttribute('data-part', face.part.id); shapes.append(polygon);
        if (face.shade > 0) {
          const shade = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          shade.setAttribute('points', face.points); shade.setAttribute('fill', '#261719'); shade.setAttribute('opacity', String(face.shade)); shapes.append(shade);
        }
      }
      group.append(shapes);
    }
    svg.append(group);
    drawSurface = () => {
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      group.setAttribute('transform', `translate(${origin.x - (view.x + 1) * pixels} ${origin.y - (view.z - 4) * .72 * pixels}) scale(${pixels})`);
    };
    disposeSurface = () => svg.remove();
  } else {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); surface = renderer.domElement;
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.setClearColor(SKY); renderer.outputColorSpace = THREE.SRGBColorSpace;
    const world = new THREE.Scene(); const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, .1, 200);
    const meshes = createMarsSceneMeshes(scene); world.add(meshes.group);
    const ambient = new THREE.HemisphereLight('#fff0d9', '#6e3934', 2.2); world.add(ambient);
    const sun = new THREE.DirectionalLight('#ffecd1', 2.5); sun.position.set(-12, 25, 14); world.add(sun);
    surface.setAttribute('role', 'img'); surface.setAttribute('aria-label', 'Mars diorama. Illustrative red terrain with only recorded colonies and active missions.');
    drawSurface = () => {
      renderer.setSize(width, height, false);
      camera.left = -width / (2 * pixels); camera.right = width / (2 * pixels);
      camera.top = height / (2 * pixels * VERTICAL); camera.bottom = -camera.top;
      const x = view.x + 1 - (origin.x - width / 2) / pixels;
      const z = view.z - 4 - (origin.y - height / 2) / (.72 * pixels);
      camera.position.set(x, 36, z + 42.5); camera.lookAt(x, 0, z); camera.updateProjectionMatrix();
      renderer.render(world, camera);
    };
    disposeSurface = () => { meshes.dispose(); renderer.dispose(); renderer.forceContextLoss(); surface.remove(); };
  }
  Object.assign(surface.style, { display: 'block', width: '100%', height: '100%', background: SKY, touchAction: 'none', cursor: 'grab' });
  surface.tabIndex = 0; surface.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight + - Home');
  surface.setAttribute('aria-description', 'Arrow keys pan. Plus and minus zoom. Home resets. Colony and transit buttons open read-only facts.');
  container.append(surface); labels.append(overlay);
  function select(id: string): void {
    if (disposed) return;
    selected = id;
    for (const marker of markers) {
      const active = marker.site.selectionId === selected;
      marker.button.setAttribute('aria-pressed', String(active));
      marker.button.style.boxShadow = active ? '0 0 0 2px #f2d49b' : 'none';
      marker.button.style.zIndex = active ? '3' : '2';
    }
  }
  const measure = (): void => {
    width = Math.max(1, container.clientWidth); height = Math.max(1, container.clientHeight);
    available = mapContentWindow(width, height, mapHierarchyObstacles(container)) ?? { left: 8, top: 8, width: Math.max(1, width - 16), height: Math.max(1, height - 16) };
    origin = { x: available.left + available.width / 2, y: available.top + available.height / 2 };
  };
  const render = (): void => {
    if (disposed) return;
    pixels = Math.max(1, Math.min((available.width - 24) / 32, (available.height - 64) / 14)) * view.zoom;
    drawSurface();
    context.hidden = available.height < 220;
    Object.assign(context.style, { left: `${origin.x}px`, top: `${available.top + available.height - 30}px`, width: `${Math.min(440, available.width - 16)}px` });
    if (stateText) Object.assign(stateText.style, { left: `${origin.x}px`, top: `${origin.y}px`, width: `${Math.max(44, available.width - 20)}px` });
    for (const marker of markers) {
      const point = screen(marker.site.labelPosition); const narrow = width < 600;
      const top = point.y + (marker.transit ? 8 : -48);
      marker.button.hidden = point.x < available.left || point.x > available.left + available.width || top < available.top || top + 44 > available.top + available.height;
      marker.button.style.left = `${point.x}px`; marker.button.style.top = `${top}px`;
      marker.name.textContent = narrow ? marker.civ.name.slice(0, 1) : marker.civ.name;
      marker.status.textContent = marker.transit ? narrow ? 'In flight' : observation.terminal ? 'Transit held' : 'In transit'
        : narrow ? `${marker.civ.population} people` : marsStatusLabel(marker.civ);
      marker.button.style.width = narrow ? width < 380 ? '44px' : '56px' : '128px';
      marker.button.style.padding = narrow ? '4px 3px' : '4px 7px';
      marker.status.style.fontSize = narrow ? '8px' : '9px';
    }
    select(selected);
  };
  const camera = (next: CameraView): void => {
    view.x = bounded(next.x, -20, 20, 0); view.z = bounded(next.z, -20, 20, 0);
    view.zoom = bounded(next.zoom, MAP_ZOOM.minimum, MAP_ZOOM.maximum, 1); render();
  };
  const zoom = (factor: number): void => { if (Number.isFinite(factor) && factor > 0) camera({ ...view, zoom: view.zoom * factor }); };
  const reset = (): void => { measure(); camera({ x: 0, z: 0, zoom: 1 }); };
  const pointers = new Map<number, { x: number; y: number }>();
  const distance = (): number => { const values = [...pointers.values()]; return values.length >= 2 ? Math.hypot(values[0]!.x - values[1]!.x, values[0]!.y - values[1]!.y) : 0; };
  listen(surface, 'pointerdown', event => {
    const pointer = event as PointerEvent;
    if (pointer.button !== 0) return;
    pointers.set(pointer.pointerId, { x: pointer.clientX, y: pointer.clientY }); surface.setPointerCapture(pointer.pointerId);
  });
  listen(surface, 'pointermove', event => {
    const pointer = event as PointerEvent; const previous = pointers.get(pointer.pointerId);
    if (!previous) return;
    const before = distance(); pointers.set(pointer.pointerId, { x: pointer.clientX, y: pointer.clientY });
    if (pointers.size > 1) { const after = distance(); if (before > 0 && after > 0) zoom(after / before); }
    else camera({ ...view, x: view.x - (pointer.clientX - previous.x) / pixels, z: view.z - (pointer.clientY - previous.y) / (pixels * .72) });
  });
  const release = (event: Event): void => { const pointer = event as PointerEvent; pointers.delete(pointer.pointerId); if (surface.hasPointerCapture(pointer.pointerId)) surface.releasePointerCapture(pointer.pointerId); };
  listen(surface, 'pointerup', release); listen(surface, 'pointercancel', release); listen(surface, 'lostpointercapture', event => { pointers.delete((event as PointerEvent).pointerId); });
  listen(surface, 'wheel', event => { const wheel = event as WheelEvent; wheel.preventDefault(); zoom(Math.exp(-bounded(wheel.deltaY, -300, 300, 0) * .0015)); }, { passive: false });
  listen(surface, 'keydown', event => {
    const key = event as KeyboardEvent; const step = 2 / view.zoom;
    if (key.key === 'ArrowLeft') camera({ ...view, x: view.x - step });
    else if (key.key === 'ArrowRight') camera({ ...view, x: view.x + step });
    else if (key.key === 'ArrowUp') camera({ ...view, z: view.z - step });
    else if (key.key === 'ArrowDown') camera({ ...view, z: view.z + step });
    else if (key.key === '+' || key.key === '=') zoom(1.2);
    else if (key.key === '-') zoom(1 / 1.2);
    else if (key.key === 'Home') reset();
    else return;
    key.preventDefault();
  });
  const observer = new ResizeObserver(() => { if (disposed) return; measure(); render(); }); observer.observe(container);
  const shell = container.closest('#app') ?? container.parentElement;
  for (const obstacle of shell?.querySelectorAll('.civilization-panel, .inspection, .world-heading, .chronicle, .map-tools, .layer-controls, .connection-actions, .masthead, .footer, .era-pill') ?? []) observer.observe(obstacle);
  measure(); render();
  return {
    zoom, reset, select, snapshot: () => ({ ...view }), restoreCamera: next => { measure(); camera(next); },
    framePoint: (worldPoint, anchor) => {
      if (![worldPoint.x, worldPoint.y, worldPoint.z, anchor.x, anchor.y].every(Number.isFinite)) return;
      measure(); render();
      const point = flatMapPoint(worldPoint.x, worldPoint.z, worldPoint.y);
      camera({ ...view, x: point.x - 1 - (bounded(anchor.x, .05, .95, .5) * width - origin.x) / pixels,
        z: (point.z - (bounded(anchor.y, .05, .95, .5) * height - origin.y) / pixels) / .72 + 4 });
    },
    frameCity: (id, anchor) => {
      const site: MarsBodySite | undefined = scene.sites.find(candidate => candidate.selectionId === id) ?? scene.transits.find(candidate => candidate.selectionId === id);
      if (!site || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;
      measure(); render();
      const point = flatMapPoint(site.position[0], site.position[2], site.position[1]);
      camera({ ...view, x: point.x - 1 - (bounded(anchor.x, .05, .95, .5) * width - origin.x) / pixels,
        z: (point.z - (bounded(anchor.y, .05, .95, .5) * height - origin.y) / pixels) / .72 + 4 });
    },
    selectRoute: () => {}, setLayer: () => {}, showEvents: () => {}, clearEvents: () => {}, setMotion: () => {},
    dispose: () => {
      if (disposed) return;
      disposed = true; observer.disconnect();
      for (const pointerId of pointers.keys()) if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
      pointers.clear(); for (const remove of listeners) remove(); disposeSurface(); overlay.remove();
    },
  };
}
