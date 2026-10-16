import { depositLabel, SITE_MARK_PATHS, placeSiteMarks } from '../visuals/strategic-resource-visuals.ts';
import { visibleRoutePaths } from '../visuals/route-paths.ts';
import type { RouteView } from '../visuals/route-visuals.ts';
import { routeLabelKey, routeLabelPlacement, routeTitle, routeVisual, routeMapLabel } from '../visuals/route-visuals.ts';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { damageCondition, damageMapLabel } from '../visuals/damage-visuals.ts';
import { cityKey, selectedCity } from './city-selection.ts';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createLandscapeMeshes } from './landscape-three.ts';
import { projectLandscape, landscapeSurface, LANDSCAPE_COLORS } from '../visuals/landscape.ts';
import { hexPosition, routeMapPositions, routeMapAnchor } from './atlas.ts';
import type { AtlasCue, AtlasTile, AtlasWorld } from './atlas.ts';
import type { ViewerPreferences } from './viewer-state.ts';
import { resolveAppearance } from './viewer-appearance.ts';
import { cameraShiftForAnchor } from './inspection-camera.ts';
import type { CameraView, ScreenPoint } from './inspection-camera.ts';
import { createSettlementMeshes, createDistrictMeshes, createImprovementMeshes, createDepositMeshes } from './settlement-three.ts';
import { improvementLabel } from '../visuals/improvement-visuals.ts';
import { districtCaptionPlacement, districtLabel } from '../visuals/district-visuals.ts';
import { mapOverlayBounds } from './settlement-parts.ts';
import { createWorldCues, visualIcon } from './world-cues.ts';
import { mapLabelVisibility } from './map-labels.ts';

export interface AtlasRenderer {
  zoom: (factor: number) => void;
  reset: () => void;
  select: (id: string) => void;
  selectRoute: (id: string | null) => void;
  frameCity: (id: string, anchor: ScreenPoint) => void;
  restoreCamera: (camera: CameraView) => void;
  setLayer: (layer: 'borders' | 'routes', visible: boolean) => void;
  snapshot: () => Pick<ViewerPreferences, 'zoom' | 'x' | 'z'>;
  setMotion: (moving: boolean) => void;
  showEvents: (events: readonly AtlasCue[]) => void;
  clearEvents: () => void;
  dispose: () => void;
}

export function routeLineMeshes(route: RouteView, selected: boolean): readonly [Line2, Line2] | null {
  if (!route.fromTown || !route.toTown) return null;
  const points = routeMapPositions(route);
  if (points.length < 2) return null;
  const visual = routeVisual(route);
  const geometry = new LineGeometry().setPositions(points.flatMap(point => [point.x, point.y, point.z]));
  const backing = new Line2(geometry, new LineMaterial({ color: '#173a3c', linewidth: selected ? 7 : 5, depthTest: false }));
  const line = new Line2(geometry, new LineMaterial({ color: visual.color, linewidth: selected ? 3 : 2,
    dashed: visual.dash.length > 0, dashSize: visual.dash[0] ?? 1, gapSize: visual.dash[1] ?? 0, depthTest: false }));
  backing.renderOrder = selected ? 4 : 2;
  line.renderOrder = selected ? 5 : 3;
  line.computeLineDistances();
  line.userData['routeId'] = route.id;
  return [backing, line];
}

export function createAtlasRenderer(
  container: HTMLElement,
  labels: HTMLElement,
  world: AtlasWorld,
  preferences: ViewerPreferences,
  onSelect: (id: string) => void,
  onRoute: (id: string) => void,
): AtlasRenderer {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LANDSCAPE_COLORS.water);
  scene.fog = new THREE.Fog(LANDSCAPE_COLORS.water, 44, 95);
  const camera = new THREE.OrthographicCamera(-24, 24, 18, -18, 0.1, 160);
  camera.position.set(19, 29, 31);
  camera.zoom = preferences.zoom;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.domElement.setAttribute(
    'aria-label',
    `${world.illustrative ? 'Sample' : 'Committed world'} three dimensional atlas. Drag to pan. Pinch or use map buttons to zoom. Select a city to inspect.`,
  );
  renderer.domElement.setAttribute('role', 'img');
  container.prepend(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableRotate = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = false;
  controls.minZoom = 0.65;
  controls.maxZoom = 2.2;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.touches.ONE = THREE.TOUCH.PAN;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.target.set(preferences.x, 0, preferences.z);
  camera.position.add(new THREE.Vector3(preferences.x, 0, preferences.z));
  controls.update();
  scene.add(new THREE.HemisphereLight('#fff5d9', '#607875', 2.3));
  const sun = new THREE.DirectionalLight('#fff0ce', 3.8);
  sun.position.set(-15, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.normalBias = 0.06;
  scene.add(sun);
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const material = (color: string): THREE.MeshStandardMaterial => {
    const cached = materials.get(color);
    if (cached) return cached;
    const created = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
    materials.set(color, created);
    return created;
  };
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), material(LANDSCAPE_COLORS.water));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.23;
  sea.receiveShadow = true;
  scene.add(sea);
  const tileGeometry = new THREE.CylinderGeometry(0.99, 0.99, 1, 6);
  const coastGeometry = new THREE.CylinderGeometry(1.07, 1.13, 0.13, 6);
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const roofGeometry = new THREE.ConeGeometry(0.74, 0.5, 4);
  const borders = new THREE.Group();
  const routes = new THREE.Group();
  const tileLookup = new Map(world.tiles.map((tile) => [`${tile.q},${tile.r}`, tile]));
  const addMesh = (
    geometry: THREE.BufferGeometry,
    color: string,
    x: number,
    y: number,
    z: number,
    scale: readonly [number, number, number] = [1, 1, 1],
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  const landscape = projectLandscape(world.tiles, world.cities, 'far');
  const coastalTiles = new Set(landscape.coast.map(edge => edge.key.slice(0, edge.key.lastIndexOf(':'))));
  const addTile = (tile: AtlasTile): void => {
    const { x, z } = hexPosition(tile.q, tile.r);
    if (coastalTiles.has(`${tile.q},${tile.r}`)) addMesh(coastGeometry, LANDSCAPE_COLORS.shallow, x, -.12, z);
    addMesh(tileGeometry, landscapeSurface(tile), x, tile.height / 2, z, [1, tile.height, 1]);
  };
  const boundaryPositions = new Map<number, number[]>();
  for (const edge of landscape.borders) {
    if (edge.owner === null) continue;
    const positions = boundaryPositions.get(edge.owner) ?? [];
    positions.push(edge.from[0], edge.height, edge.from[1], edge.to[0], edge.height, edge.to[1]);
    boundaryPositions.set(edge.owner, positions);
  }
  for (const [ownerId, positions] of boundaryPositions) {
    const owner = world.cities.find(city => city.id === ownerId);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    borders.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: owner?.color ?? '#e7bf69', transparent: true, opacity: .85 })));
  }
  for (const tile of world.tiles) addTile(tile);
  borders.visible = preferences.borders;
  scene.add(borders);
  const cityLabels: Array<{ element: HTMLButtonElement; point: THREE.Vector3; id: string }> = [];
  for (const city of world.cities) {
    const { x, z } = hexPosition(city.q, city.r);
    const floor = tileLookup.get(`${city.q},${city.r}`)?.height ?? 0.4;
    if (!city.settlement) {
    const base = addMesh(
      new THREE.CylinderGeometry(0.88, 1, 0.11, 6),
      '#c6bd9e',
      x,
      floor + 0.055,
      z,
    );
    base.userData['civilization'] = city.id;
    for (let i = 0; i < 7; i += 1) {
      const angle = i * 2.4;
      const bx = x + Math.cos(angle) * 0.55;
      const bz = z + Math.sin(angle) * 0.55;
      const height = 0.22 + (i % 3) * 0.13;
      addMesh(boxGeometry, '#e4d6ae', bx, floor + 0.1 + height / 2, bz, [0.26, height, 0.24]);
      const roof = addMesh(
        roofGeometry,
        city.color,
        bx,
        floor + height + 0.2,
        bz,
        [0.31, 0.55, 0.31],
      );
      roof.rotation.y = Math.PI / 4;
    }
    addMesh(boxGeometry, '#f1e4ba', x, floor + 0.46, z, [0.47, 0.7, 0.46]);
    addMesh(new THREE.CylinderGeometry(0.34, 0.42, 0.13, 6), city.color, x, floor + 0.88, z);
    addMesh(
      new THREE.ConeGeometry(0.29, 0.37, city.id === 2 ? 16 : 4),
      city.color,
      x,
      floor + 1.1,
      z,
    );
    addMesh(new THREE.CylinderGeometry(0.017, 0.017, 1.45, 5), '#d4c18c', x + 0.38, floor + 0.8, z);
    const flag = addMesh(
      new THREE.PlaneGeometry(0.42, 0.26),
      city.color,
      x + 0.58,
      floor + 1.34,
      z,
    );
    flag.material = new THREE.MeshBasicMaterial({ color: city.color, side: THREE.DoubleSide });
    for (const [index, building] of (city.buildings ?? []).entries()) {
      const bx = x + 0.9 + (index % 2) * 0.35;
      const bz = z - 0.7 + Math.floor(index / 2) * 0.35;
      addMesh(boxGeometry, building === 'farm' ? '#d4bd6d' : '#94795c', bx, floor + 0.12, bz,
        building === 'farm' ? [0.28, 0.08, 0.55] : [0.3, 0.3, 0.3]);
    }
    }
    const element = document.createElement('button');
    element.className = 'city-label';
    element.dataset['cityId'] = cityKey(city);
    element.style.setProperty('--civ-color', city.color);
    const title = document.createElement('strong');
    title.textContent = city.capital;
    const subtitle = document.createElement('small');
    subtitle.textContent = `${city.shortName}${city.population === undefined ? '' : ` · ${city.population} people`}`;
    const condition = damageCondition(city.settlement?.damage ?? 0);
    if (condition) {
      subtitle.className = 'city-condition';
      subtitle.textContent = condition.text;
      subtitle.prepend(visualIcon(condition.icon));
    }
    element.append(title, subtitle);
    element.setAttribute('aria-label', `Inspect ${city.name}, ${damageMapLabel(city.capital, city.settlement?.damage ?? 0)}`);
    element.addEventListener('click', () => onSelect(cityKey(city)));
    labels.append(element);
    cityLabels.push({ element, point: new THREE.Vector3(x, floor + 1.45, z), id: cityKey(city) });
  }
  const settlements = createSettlementMeshes(world, material);
  const districtMeshes = createDistrictMeshes(world, material);
  const improvementMeshes = createImprovementMeshes(world, material);
  const depositMeshes = createDepositMeshes(world, material);
  const sites = [
    ...(world.districts ?? []).map(site => ({ ...site, mark: site.buildingId === 'commercial-hub' ? 'commerce' as const : 'campus' as const, label: districtLabel(site) })),
    ...(world.improvements ?? []).map(site => ({ ...site, mark: 'mine' as const, label: improvementLabel(site) })),
  ];
  const districtLabels = sites.map(district => {
    const point = hexPosition(district.q, district.r);
    const element = document.createElement('span');
    element.className = 'city-label district-label';
    element.setAttribute('aria-hidden', 'true');
    element.dataset['districtId'] = district.id; element.dataset['tileId'] = String(district.tileId);
    element.style.setProperty('--civ-color', district.color);
    element.textContent = district.label;
    element.setAttribute('aria-label', `Inspect ${district.label} of ${district.townName}, tile ${district.tileId}`);
    labels.append(element);
    return { element, point: new THREE.Vector3(point.x, district.height + .8, point.z), id: district.id };
  });
  const siteMarks = sites.map(site => {
    const point = hexPosition(site.q, site.r); const element = document.createElement('button');
    element.type = 'button'; element.className = 'site-map-mark';
    element.dataset['status'] = site.status; element.style.setProperty('--civ-color', site.color);
    element.setAttribute('aria-label', `Inspect ${site.label} of ${site.townName}, tile ${site.tileId}`);
    element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SITE_MARK_PATHS[site.mark]}"/></svg>`;
    element.addEventListener('click', () => onSelect(site.cityId)); labels.append(element);
    const leader = document.createElement('span'); leader.className = 'site-map-leader'; leader.setAttribute('aria-hidden', 'true'); leader.style.background = site.color; labels.append(leader);
    return { element, leader, id: site.id, cityId: site.cityId, point: new THREE.Vector3(point.x, site.height + .4, point.z) };
  });
  const depositMarks = (world.deposits ?? []).map(site => {
    const point = hexPosition(site.q, site.r); const element = document.createElement('span');
    element.className = 'deposit-map-mark'; element.setAttribute('role', 'img'); element.setAttribute('aria-label', depositLabel(site));
    element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SITE_MARK_PATHS.iron}"/></svg>`;
    labels.append(element); return { element, point: new THREE.Vector3(point.x, site.height + .6, point.z) };
  });
  const landscapeMeshes = createLandscapeMeshes(world, material);
  scene.add(landscapeMeshes.group, settlements.group, districtMeshes.group, improvementMeshes.group, depositMeshes.group);
  const cues = createWorldCues(container, world, (x, z, height) => {
    const point = new THREE.Vector3(x, height, z).project(camera);
    return { x: (point.x + 1) / 2 * container.clientWidth, y: (1 - point.y) / 2 * container.clientHeight };
  });
  const initialCity = selectedCity(world, preferences);
  let selected = initialCity ? cityKey(initialCity) : '';
  let selectedRoute: string | null = null;
  const routeLines: Line2[] = [];
  let routePoint: THREE.Vector3 | null = null;
  const routeLabel = document.createElement('button');
  routeLabel.type = 'button';
  routeLabel.className = 'route-map-label';
  routeLabel.hidden = true;
  routeLabel.addEventListener('click', () => { if (selectedRoute) onRoute(selectedRoute); });
  labels.append(routeLabel);
  const drawRoutes = (): void => {
    const geometries = new Set<THREE.BufferGeometry>();
    for (const child of routes.children) {
      if (child instanceof Line2) { geometries.add(child.geometry); child.material.dispose(); }
    }
    for (const geometry of geometries) geometry.dispose();
    routes.clear();
    routeLines.length = 0;
    routePoint = null;
    routeLabel.hidden = true;
    for (const route of visibleRoutePaths(world.routes, selectedRoute)) {
      const pair = routeLineMeshes(route, route.id === selectedRoute);
      if (!pair || !route.fromTown || !route.toTown) continue;
      const [backing, line] = pair;
      const anchor = routeMapAnchor(route);
      const visual = routeVisual(route);
      routes.add(backing, line);
      routeLines.push(line);
      if (route.id === selectedRoute && anchor) {
        routePoint = new THREE.Vector3(anchor.x, anchor.y, anchor.z);
        routeLabel.textContent = routeMapLabel(route);
        routeLabel.setAttribute('aria-label', `Inspect ${routeTitle(route)}. ${visual.label}`);
      }
    }
  };
  drawRoutes();
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line2 = { threshold: 12 };
  let routePointer: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (event) => { routePointer = { x: event.clientX, y: event.clientY }; });
  renderer.domElement.addEventListener('pointercancel', () => { routePointer = null; });
  renderer.domElement.addEventListener('pointerup', (event) => {
    const start = routePointer;
    routePointer = null;
    if (!start || !routes.visible || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 5) return;
    const box = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - box.left) / box.width * 2 - 1, 1 - (event.clientY - box.top) / box.height * 2), camera);
    const hits = raycaster.intersectObjects(routeLines, false);
    const hit = hits.find(entry => entry.object.userData['routeId'] === selectedRoute) ?? hits[0];
    const id: unknown = hit?.object.userData['routeId'];
    if (typeof id === 'string') onRoute(id);
  });
  routes.visible = preferences.routes;
  scene.add(routes);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 1.16, 48),
    new THREE.MeshBasicMaterial({
      color: '#ffedab',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  const select = (id: string): void => {
    const city = world.cities.find((candidate) => cityKey(candidate) === id);
    if (!city) return;
    selected = id;
    const point = hexPosition(city.q, city.r);
    ring.position.set(point.x, 0.58, point.z);
    for (const label of cityLabels) {
      label.element.classList.toggle('selected', label.id === id);
      label.element.setAttribute('aria-pressed', String(label.id === id));
    }
  };
  select(selected);
  const resize = (): void => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const halfHeight = width < 700 ? 24 : 17.3;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  const moving =
    resolveAppearance(preferences, false, window.matchMedia('(prefers-reduced-motion: reduce)').matches).motion;
  cues.setMotion(moving);
  let frame = 0;
  const animate = (): void => {
    if (document.hidden) { frame = requestAnimationFrame(animate); return; }
    controls.update();
    camera.updateMatrixWorld();
    const left = new THREE.Vector3(-1, 0, 0).project(camera);
    const right = new THREE.Vector3(1, 0, 0).project(camera);
    const tilePixels = Math.hypot((right.x - left.x) * container.clientWidth / 2, (right.y - left.y) * container.clientHeight / 2);
    const detail = settlements.update(tilePixels);
    landscapeMeshes.update(tilePixels);
    districtMeshes.update(tilePixels);
    improvementMeshes.update(tilePixels);
    depositMeshes.update(tilePixels);
    const mapLabels = [...cityLabels, ...districtLabels];
    const positions = mapLabels.map((label) => {
      const point = label.point.clone().project(camera);
      return { id: label.id, x: (point.x + 1) / 2 * container.clientWidth, y: (1 - point.y) / 2 * container.clientHeight, width: Math.max(76, label.element.offsetWidth), height: Math.max(44, label.element.offsetHeight) };
    });
    const projectedRoute = routePoint?.clone().project(camera);
    const townTargets = positions.slice(0, cityLabels.length).map((position) => ({ ...position, y: position.y - position.height * 1.1, height: position.height * 1.1 + 8 }));
    const overlayBounds = mapOverlayBounds(container);
    const anchors = siteMarks.map(mark => { const point = mark.point.clone().project(camera); return { id: mark.id, cityId: mark.cityId, x: (point.x + 1) / 2 * container.clientWidth, y: (1 - point.y) / 2 * container.clientHeight }; });
    const markPlacements = placeSiteMarks(anchors, [...townTargets, ...overlayBounds], container.clientWidth, container.clientHeight, selected);
    for (const mark of siteMarks) {
      const placed = markPlacements.find(candidate => candidate.id === mark.id); const anchor = anchors.find(candidate => candidate.id === mark.id);
      mark.element.hidden = !placed; mark.leader.hidden = !placed;
      if (placed && anchor) {
        mark.element.style.left = `${placed.x}px`; mark.element.style.top = `${placed.y}px`;
        mark.leader.style.left = `${anchor.x}px`; mark.leader.style.top = `${anchor.y}px`;
        mark.leader.style.width = `${Math.hypot(placed.x - anchor.x, placed.y - anchor.y)}px`;
        mark.leader.style.transform = `rotate(${Math.atan2(placed.y - anchor.y, placed.x - anchor.x)}rad)`;
      }
    }
    for (const mark of depositMarks) {
      const point = mark.point.clone().project(camera); mark.element.hidden = point.z < -1 || point.z > 1;
      mark.element.style.left = `${(point.x + 1) / 2 * container.clientWidth}px`; mark.element.style.top = `${(1 - point.y) / 2 * container.clientHeight}px`;
    }
    for (let index = cityLabels.length; index < positions.length; index++) {
      const position = positions[index];
      if (!position) continue;
      const placement = districtCaptionPlacement(position, [...townTargets, ...overlayBounds], container.clientWidth, container.clientHeight, position.width, position.height);
      positions[index] = { ...position, ...(placement ? { x: placement.x, y: placement.y + placement.height * 1.1 } : { x: -1000, y: -1000 }) };
    }
    const placedRouteLabel = projectedRoute && selectedRoute && routes.visible
      ? routeLabelPlacement({ x: (projectedRoute.x + 1) / 2 * container.clientWidth, y: (1 - projectedRoute.y) / 2 * container.clientHeight }, townTargets, container.clientWidth, container.clientHeight) : null;
    if (placedRouteLabel && selectedRoute) positions.unshift({ id: routeLabelKey(selectedRoute), ...placedRouteLabel });
    const selectedDistricts = new Set(sites.filter(district => district.cityId === selected).map(district => district.id));
    const prioritized = positions.toSorted((a, b) => Number(selectedDistricts.has(b.id)) - Number(selectedDistricts.has(a.id)));
    const shown = mapLabelVisibility(prioritized, selected, detail, container.clientWidth, container.clientHeight);
    const visibilityById = new Map(prioritized.map((label, index) => [label.id, shown[index]]));
    const visible = positions.map(label => visibilityById.get(label.id));
    const routeLabelOffset = placedRouteLabel ? 1 : 0;
    routeLabel.hidden = !routeLabelOffset || !projectedRoute || projectedRoute.z > 1 || projectedRoute.z < -1 || !visible[0];
    if (placedRouteLabel) {
      routeLabel.style.left = `${placedRouteLabel.x}px`;
      routeLabel.style.top = `${placedRouteLabel.y + 22}px`;
    }
    const pixelsPerUnit = Math.max(0.01, Math.hypot((right.x - left.x) * container.clientWidth / 2, (right.y - left.y) * container.clientHeight / 2) / 2);
    for (const line of routeLines) line.material.dashScale = pixelsPerUnit;
    for (const [index, label] of mapLabels.entries()) {
      const projected = label.point.clone().project(camera);
      const position = positions[index + routeLabelOffset];
      label.element.style.left = `${position?.x ?? -1000}px`;
      label.element.style.top = `${position?.y ?? -1000}px`;
      label.element.hidden = projected.z > 1 || projected.z < -1 || !visible[index + routeLabelOffset];
    }
    cues.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate);
  return {
    zoom: (factor) => {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, 0.65, 2.2);
      camera.updateProjectionMatrix();
    },
    reset: () => {
      controls.target.set(0, 0, 0);
      camera.position.set(19, 29, 31);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.update();
    },
    select,
    selectRoute: (id) => { if (id !== selectedRoute) { selectedRoute = id; drawRoutes(); } },
    frameCity: (id, anchor) => {
      const city = cityLabels.find((candidate) => candidate.id === id);
      if (!city) return;
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      camera.updateMatrixWorld();
      const screen = (point: THREE.Vector3): ScreenPoint => {
        const projected = point.clone().project(camera);
        return { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2 };
      };
      const current = screen(city.point);
      const unitX = screen(city.point.clone().add(new THREE.Vector3(1, 0, 0)));
      const unitZ = screen(city.point.clone().add(new THREE.Vector3(0, 0, 1)));
      const shift = cameraShiftForAnchor(current, anchor,
        { x: unitX.x - current.x, y: unitX.y - current.y },
        { x: unitZ.x - current.x, y: unitZ.y - current.y });
      const translation = new THREE.Vector3(shift.x, 0, shift.z);
      camera.position.add(translation);
      controls.target.add(translation);
      controls.update();
      controls.enableDamping = damping;
    },
    restoreCamera: (view) => {
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      controls.target.set(view.x, 0, view.z);
      camera.position.set(view.x + 19, 29, view.z + 31);
      camera.zoom = view.zoom;
      camera.updateProjectionMatrix();
      controls.update();
      controls.enableDamping = damping;
    },
    setLayer: (layer, visible) => {
      (layer === 'borders' ? borders : routes).visible = visible;
    },
    snapshot: () => ({ zoom: camera.zoom, x: controls.target.x, z: controls.target.z }),
    showEvents: cues.show,
    clearEvents: cues.clear,
    setMotion: (value) => {
      cues.setMotion(value);
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      settlements.dispose();
      districtMeshes.dispose();
      improvementMeshes.dispose();
      depositMeshes.dispose();
      landscapeMeshes.dispose();
      cues.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      const resources = new Set<THREE.Material>(materials.values());
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          const geometry: unknown = object.geometry;
          const entries: unknown = object.material;
          if (geometry instanceof THREE.BufferGeometry) geometries.add(geometry);
          if (entries instanceof THREE.Material) resources.add(entries);
          else if (Array.isArray(entries)) {
            for (const entry of entries) if (entry instanceof THREE.Material) resources.add(entry);
          }
        }
      });
      for (const geometry of geometries) geometry.dispose();
      for (const resource of resources) resource.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.replaceChildren();
    },
  };
}
