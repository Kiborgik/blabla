import { civilizationIdentity } from '../visuals/visual-language.ts';
import { selectedAcquiredLand } from '../visuals/territory-visuals.ts';
import { allocateMapHierarchy, mapContentWindow } from '../visuals/map-hierarchy.ts';
import { MAP_ZOOM } from './viewer-state.ts';
import { PASTORAL_MARK_PATH, CATCHMENT_MARK_PATH, pastoralSiteLabel } from '../visuals/pastoral-visuals.ts';
import { wonderSiteLabel } from '../visuals/wonder-visuals.ts';
import { WONDER_MARK_PATH } from '../visuals/wonder-landmark.ts';
import { depositLabel, SITE_MARK_PATHS } from '../visuals/strategic-resource-visuals.ts';
import { visibleRoutePaths } from '../visuals/route-paths.ts';
import type { RouteView } from '../visuals/route-visuals.ts';
import { routeLabelKey, routeTitle, routeVisual, routeMapLabel } from '../visuals/route-visuals.ts';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { damageMapLabel } from '../visuals/damage-visuals.ts';
import { cityKey, selectedCity } from './city-selection.ts';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createLandscapeMeshes, createTerrainMeshes } from './landscape-three.ts';
import { projectTerrainSurface, projectLandscape, LANDSCAPE_COLORS, TERRITORY_STYLE, territoryEdgeTriangles } from '../visuals/landscape.ts';
import { hexPosition, routeMapPositions, routeMapAnchor } from './atlas.ts';
import type { AtlasCue, AtlasWorld } from './atlas.ts';
import type { ViewerPreferences } from './viewer-state.ts';
import { resolveAppearance } from './viewer-appearance.ts';
import { cameraShiftForAnchor, unobscuredInspectionAnchor } from './inspection-camera.ts';
import type { CameraView, ScreenPoint } from './inspection-camera.ts';
import { createSettlementMeshes, createDistrictMeshes, createImprovementMeshes, createDepositMeshes, createWonderMeshes } from './settlement-three.ts';
import { LUMBER_MARK_PATH, improvementLabel } from '../visuals/improvement-visuals.ts';
import { districtAdjacencySummary, districtMark, districtLabel } from '../visuals/district-visuals.ts';
import { createWorldCues } from './world-cues.ts';
import { mapHierarchyAnchors, mapHierarchyObstacles } from './map-labels.ts';

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
  const backing = new Line2(geometry, new LineMaterial({ color: selected ? '#394538' : '#746b4d', linewidth: selected ? 5 : 3, depthTest: false }));
  const line = new Line2(geometry, new LineMaterial({ color: selected || visual.status !== 'agreed' ? visual.color : '#c9b17b', linewidth: selected ? 3 : 1.6,
    dashed: visual.dash.length > 0, dashSize: visual.dash[0] ?? 1, gapSize: visual.dash[1] ?? 0, depthTest: false }));
  backing.renderOrder = selected ? 4 : 2;
  line.renderOrder = selected ? 5 : 3;
  line.computeLineDistances();
  line.userData['routeId'] = route.id;
  return [backing, line];
}

export function createTerritoryMeshes(world: Pick<AtlasWorld, 'tiles' | 'cities'>): THREE.Group {
  const group = new THREE.Group();
  const landscape = projectLandscape(world.tiles, [], 'far');
  const terrain = new Map(projectTerrainSurface(world.tiles).map(tile => [tile.key, tile]));
  for (const owner of new Map(world.cities.map(city => [city.id, city])).values()) {
    const territories = landscape.territories.filter(tile => tile.owner === owner.id);
    if (!territories.length) continue;
    const wash = new THREE.BufferGeometry();
    wash.setAttribute('position', new THREE.Float32BufferAttribute(territories.flatMap(tile => (terrain.get(tile.key)?.faces ?? []).flatMap(face =>
      face.points.flatMap(point => [point[0], point[1] + .018, point[2]]))), 3));
    const surface = new THREE.Mesh(wash, new THREE.MeshBasicMaterial({ color: owner.color, transparent: true,
      opacity: TERRITORY_STYLE.washOpacity, depthWrite: false, side: THREE.DoubleSide }));
    surface.userData['territories'] = territories.map(tile => tile.key);
    surface.userData['owner'] = owner.id;
    const edges = landscape.borders.filter(edge => edge.owner === owner.id);
    const outline = new THREE.BufferGeometry();
    outline.setAttribute('position', new THREE.Float32BufferAttribute(edges.flatMap(territoryEdgeTriangles), 3));
    const boundary = new THREE.Mesh(outline, new THREE.MeshBasicMaterial({ color: owner.color, transparent: true,
      opacity: TERRITORY_STYLE.borderOpacity, depthWrite: false, side: THREE.DoubleSide }));
    boundary.userData['boundaries'] = edges.map(edge => edge.key);
    boundary.userData['owner'] = owner.id;
    group.add(surface, boundary);
  }
  return group;
}

export function createAtlasRenderer(
  container: HTMLElement,
  labels: HTMLElement,
  world: AtlasWorld,
  preferences: ViewerPreferences,
  onSelect: (id: string, workId?: string) => void,
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
  renderer.toneMappingExposure = 1.08;
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
  controls.minZoom = MAP_ZOOM.minimum;
  controls.maxZoom = MAP_ZOOM.maximum;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.touches.ONE = THREE.TOUCH.PAN;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.target.set(preferences.x, 0, preferences.z);
  camera.position.add(new THREE.Vector3(preferences.x, 0, preferences.z));
  controls.update();
  scene.add(new THREE.HemisphereLight('#fff5d9', '#607875', 1.7));
  const sun = new THREE.DirectionalLight('#fff0ce', 2.5);
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
  sea.position.y = -.03;
  sea.receiveShadow = true;
  scene.add(sea);
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const roofGeometry = new THREE.ConeGeometry(0.74, 0.5, 4);
  const borders = createTerritoryMeshes(world);
  const acquired = new THREE.Group();
  const acquiredMaterials: LineMaterial[] = [];
  borders.add(acquired);
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
  const shorePositions = landscape.coast.flatMap(edge => {
    const dx = edge.to[0] - edge.from[0]; const dz = edge.to[1] - edge.from[1];
    const length = Math.hypot(dx, dz) || 1;
    const ox = dz / length * .32; const oz = -dx / length * .32;
    const a = [edge.from[0], .005, edge.from[1]]; const b = [edge.to[0], .005, edge.to[1]];
    const c = [edge.to[0] + ox, .005, edge.to[1] + oz]; const d = [edge.from[0] + ox, .005, edge.from[1] + oz];
    return [...a, ...b, ...c, ...a, ...c, ...d];
  });
  const shoreGeometry = new THREE.BufferGeometry();
  shoreGeometry.setAttribute('position', new THREE.Float32BufferAttribute(shorePositions, 3));
  const shore = new THREE.Mesh(shoreGeometry, new THREE.MeshBasicMaterial({ color: LANDSCAPE_COLORS.shallow, transparent: true, opacity: .8, side: THREE.DoubleSide }));
  scene.add(shore, createTerrainMeshes(world.tiles));
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
    element.className = 'city-label map-town-mark';
    element.dataset['cityId'] = cityKey(city);
    element.style.setProperty('--civ-color', city.color);
    const title = document.createElement('strong');
    title.textContent = city.capital;
    const badge = document.createElement('span'); badge.className = 'map-town-badge'; badge.setAttribute('aria-hidden', 'true');
    const identity = civilizationIdentity(city.id);
    const crest = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    crest.setAttribute('viewBox', '0 0 24 24'); crest.setAttribute('width', '16'); crest.setAttribute('height', '16');
    crest.style.width = '66%'; crest.style.height = '66%'; crest.dataset['crest'] = identity.crest;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', identity.path); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
    crest.append(path); badge.append(crest);
    title.className = 'map-caption';
    element.append(badge, title);
    element.setAttribute('aria-label', `Inspect ${city.name}, ${damageMapLabel(city.capital, city.settlement?.damage ?? 0)}`);
    element.addEventListener('click', () => onSelect(cityKey(city)));
    labels.append(element);
    cityLabels.push({ element, point: new THREE.Vector3(x, floor + 1.45, z), id: cityKey(city) });
  }
  const settlements = createSettlementMeshes(world, material);
  const districtMeshes = createDistrictMeshes(world, material);
  const improvementMeshes = createImprovementMeshes(world, material);
  const depositMeshes = createDepositMeshes(world, material);
  const wonderMeshes = createWonderMeshes(world, material);
  const sites = [
    ...(world.catchments ?? []).map(site => ({ ...site, mark: 'catchment' as const, label: `Aqueduct mountain source${site.status === 'building' ? ' · Building' : ''}` })),
    ...(world.districts ?? []).map(site => ({ ...site, mark: districtMark(site), label: districtLabel(site) })),
    ...(world.improvements ?? []).map(site => ({ ...site, mark: site.improvementId === 'pasture' ? 'pasture' as const : site.improvementId === 'lumber-mill' ? 'lumber' as const : 'mine' as const, workId: site.status === 'building' ? `active:${site.construction?.id ?? ''}` : String(site.tileId), label: improvementLabel(site) })),
    ...(world.wonders ?? []).map(site => ({ ...site, mark: 'wonder' as const, label: wonderSiteLabel(site) })),
  ];
  const districtLabels = sites.map(district => {
    const point = hexPosition(district.q, district.r);
    const element = document.createElement('span');
    element.className = 'map-caption district-label';
    element.setAttribute('aria-hidden', 'true');
    element.dataset['districtId'] = district.id; element.dataset['tileId'] = String(district.tileId);
    element.style.setProperty('--civ-color', district.color);
    element.textContent = district.label;
    element.setAttribute('aria-label', `Inspect ${district.label} of ${district.townName}, tile ${district.tileId}${'adjacency' in district && district.adjacency ? `. ${districtAdjacencySummary(district.adjacency)}` : ''}`);
    labels.append(element);
    return { element, point: new THREE.Vector3(point.x, district.height + .8, point.z), id: district.id };
  });
  const siteMarks = sites.map(site => {
    const point = hexPosition(site.q, site.r); const element = document.createElement('button');
    element.type = 'button'; element.className = 'site-map-mark';
    element.dataset['status'] = site.status; element.style.setProperty('--civ-color', site.color);
    element.setAttribute('aria-label', `Inspect ${site.label} of ${site.townName}, tile ${site.tileId}${'adjacency' in site && site.adjacency ? `. ${districtAdjacencySummary(site.adjacency)}` : ''}`);
    element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${site.mark === 'wonder' ? WONDER_MARK_PATH : site.mark === 'pasture' ? PASTORAL_MARK_PATH : site.mark === 'lumber' ? LUMBER_MARK_PATH : site.mark === 'catchment' ? CATCHMENT_MARK_PATH : SITE_MARK_PATHS[site.mark]}"/></svg>`;
    if ('adjacency' in site && site.adjacency?.source === 'improvement') {
      const bonus = document.createElement('span'); bonus.className = 'site-base-bonus'; bonus.textContent = `+${site.adjacency.bonus} base`; element.append(bonus);
    }
    element.addEventListener('click', () => onSelect(site.cityId, 'workId' in site ? site.workId : undefined)); labels.append(element);
    const leader = document.createElement('span'); leader.className = 'site-map-leader'; leader.setAttribute('aria-hidden', 'true'); leader.style.background = site.color; labels.append(leader);
    return { element, leader, id: site.id, cityId: site.cityId, family: site.mark, point: new THREE.Vector3(point.x, site.height + .4, point.z) };
  });
  const pastoralMarks = (world.pastoralSites ?? []).map(site => {
    const point = hexPosition(site.q, site.r); const element = document.createElement('span');
    element.className = 'deposit-map-mark pastoral-map-mark'; element.setAttribute('role', 'img'); element.setAttribute('aria-label', pastoralSiteLabel(site.tileId));
    element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PASTORAL_MARK_PATH}"/></svg>`;
    const caption = document.createElement('span'); caption.className = 'map-caption'; element.append(caption);
    labels.append(element); return { element, caption, id: site.id, revealedTo: site.revealedTo, point: new THREE.Vector3(point.x, site.height + .6, point.z) };
  });
  const depositMarks = (world.deposits ?? []).map(site => {
    const point = hexPosition(site.q, site.r); const element = document.createElement('span');
    element.className = 'deposit-map-mark'; element.setAttribute('role', 'img'); element.setAttribute('aria-label', depositLabel(site));
    element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SITE_MARK_PATHS.iron}"/></svg>`;
    const caption = document.createElement('span'); caption.className = 'map-caption'; element.append(caption);
    labels.append(element); return { element, caption, id: site.id, point: new THREE.Vector3(point.x, site.height + .6, point.z) };
  });
  const landscapeMeshes = createLandscapeMeshes(world, material);
  scene.add(landscapeMeshes.group, settlements.group, districtMeshes.group, improvementMeshes.group, depositMeshes.group, wonderMeshes.group);
  const cues = createWorldCues(container, world, (x, z, height) => {
    const point = new THREE.Vector3(x, height, z).project(camera);
    return { x: (point.x + 1) / 2 * container.clientWidth, y: (1 - point.y) / 2 * container.clientHeight };
  });
  const initialCity = selectedCity(world, preferences);
  let selected = initialCity ? cityKey(initialCity) : '';
  let selectedRoute: string | null = null;
  const routeLines: Line2[] = [];
  const routeLabel = document.createElement('button');
  routeLabel.type = 'button';
  routeLabel.className = 'route-map-label map-route-mark';
  const routeCaption = document.createElement('span'); routeCaption.className = 'map-caption';
  const routeSymbol = document.createElement('span'); routeSymbol.textContent = '↔'; routeSymbol.setAttribute('aria-hidden', 'true');
  routeLabel.append(routeSymbol, routeCaption);
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
        routeCaption.textContent = routeMapLabel(route);
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
  const drawAcquired = (): void => {
    for (const child of acquired.children) if (child instanceof Line2) { child.geometry.dispose(); child.material.dispose(); }
    acquired.clear(); acquiredMaterials.length = 0;
    const color = world.cities.find(city => cityKey(city) === selected)?.color ?? '#e7bf69';
    for (const plot of selectedAcquiredLand(world.acquiredLand ?? [], selected)) {
      if (!plot.point) continue;
      const center = hexPosition(plot.point.q, plot.point.r);
      const positions = Array.from({ length: 7 }, (_, index) => {
        const angle = Math.PI / 3 * index + Math.PI / 6;
        return [center.x + Math.cos(angle) * .88, plot.point ? plot.point.height + .09 : .5, center.z + Math.sin(angle) * .88];
      }).flat();
      for (const [lineColor, linewidth, order] of [['#173a3c', 5, 2], [color, 2.5, 3]] as const) {
        const geometry = new LineGeometry(); geometry.setPositions(positions);
        const appearance = new LineMaterial({ color: lineColor, linewidth, depthTest: false });
        appearance.resolution.set(container.clientWidth, container.clientHeight); acquiredMaterials.push(appearance);
        const outline = new Line2(geometry, appearance); outline.renderOrder = order; acquired.add(outline);
      }
    }
  };
  const select = (id: string): void => {
    const city = world.cities.find((candidate) => cityKey(candidate) === id);
    if (!city) return;
    selected = id;
    drawAcquired();
    const point = hexPosition(city.q, city.r);
    ring.position.set(point.x, (tileLookup.get(`${city.q},${city.r}`)?.height ?? .4) + .06, point.z);
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
    for (const appearance of acquiredMaterials) appearance.resolution.set(width, height);
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
    settlements.update(tilePixels);
    const detail = landscapeMeshes.update(tilePixels);
    districtMeshes.update(tilePixels);
    improvementMeshes.update(tilePixels);
    depositMeshes.update(tilePixels);
    wonderMeshes.update(tilePixels);
    const project = (q: number, r: number, height: number): { x: number; y: number } => {
      const ground = hexPosition(q, r); const point = new THREE.Vector3(ground.x, height, ground.z).project(camera);
      return { x: (point.x + 1) * container.clientWidth / 2, y: (1 - point.y) * container.clientHeight / 2 };
    };
    const allocation = allocateMapHierarchy(mapHierarchyAnchors(world, selected, routes.visible ? selectedRoute : null, project), {
      width: container.clientWidth, height: container.clientHeight, tileDiameter: tilePixels, previousDetail: detail, blocked: mapHierarchyObstacles(container),
    });
    const placements = new Map(allocation.items.map(item => [item.id, item]));
    labels.dataset['mapMarks'] = String(allocation.items.filter(item => item.mark).length);
    for (const city of cityLabels) {
      const placement = placements.get(city.id); const mark = placement?.mark;
      city.element.hidden = !mark;
      if (!placement || !mark) continue;
      city.element.style.left = `${mark.left}px`; city.element.style.top = `${mark.top}px`;
      city.element.style.setProperty('--symbol-size', `${placement.symbolSize}px`);
      const caption = city.element.querySelector<HTMLElement>('.map-caption');
      if (caption) {
        caption.hidden = !placement.label;
        if (placement.label) {
          caption.textContent = placement.caption; caption.style.fontSize = `${placement.fontSize}px`;
          caption.style.left = `${placement.label.left - mark.left}px`; caption.style.top = `${placement.label.top - mark.top}px`;
          caption.style.width = `${placement.label.width}px`; caption.style.height = `${placement.label.height}px`;
        }
      }
    }
    for (const mark of siteMarks) {
      const placement = placements.get(mark.id); const box = placement?.mark;
      mark.element.hidden = !box; mark.leader.hidden = !box;
      if (!placement || !box) continue;
      const x = box.left + box.width / 2; const y = box.top + box.height / 2;
      mark.element.style.left = `${x}px`; mark.element.style.top = `${y}px`;
      mark.element.style.setProperty('--symbol-size', `${placement.symbolSize}px`);
      mark.leader.style.left = `${placement.anchor.x}px`; mark.leader.style.top = `${placement.anchor.y}px`;
      mark.leader.style.width = `${Math.hypot(x - placement.anchor.x, y - placement.anchor.y)}px`;
      mark.leader.style.transform = `rotate(${Math.atan2(y - placement.anchor.y, x - placement.anchor.x)}rad)`;
    }
    for (const label of districtLabels) {
      const placement = placements.get(label.id); label.element.hidden = !placement?.label;
      if (placement?.label) {
        label.element.textContent = placement.caption; label.element.style.fontSize = `${placement.fontSize}px`;
        label.element.style.left = `${placement.label.left}px`; label.element.style.top = `${placement.label.top}px`;
        label.element.style.width = `${placement.label.width}px`; label.element.style.height = `${placement.label.height}px`;
      }
    }
    for (const mark of [...pastoralMarks, ...depositMarks]) {
      const placement = placements.get(mark.id); const box = placement?.mark; mark.element.hidden = !box;
      if (box) { mark.element.style.left = `${box.left + box.width / 2}px`; mark.element.style.top = `${box.top + box.height / 2}px`; }
      mark.caption.hidden = !placement?.label;
      if (placement?.label && box) {
        mark.caption.textContent = placement.caption; mark.caption.style.left = `${placement.label.left - box.left - box.width / 2 + 7.5}px`;
        mark.caption.style.top = `${placement.label.top - box.top - box.height / 2 + 7.5}px`; mark.caption.style.width = `${placement.label.width}px`; mark.caption.style.height = `${placement.label.height}px`;
      }
    }
    const routePlacement = selectedRoute ? placements.get(routeLabelKey(selectedRoute)) : undefined;
    routeLabel.hidden = !routePlacement || !routePlacement.mark;
    if (routePlacement?.mark) {
      routeLabel.style.left = `${routePlacement.mark.left}px`; routeLabel.style.top = `${routePlacement.mark.top}px`;
      routeCaption.hidden = !routePlacement.label;
      if (routePlacement.label) {
        routeCaption.textContent = routePlacement.caption;
        routeCaption.style.left = `${routePlacement.label.left - routePlacement.mark.left}px`; routeCaption.style.top = `${routePlacement.label.top - routePlacement.mark.top}px`;
        routeCaption.style.width = `${routePlacement.label.width}px`; routeCaption.style.height = `${routePlacement.label.height}px`;
      }
    }
    const pixelsPerUnit = Math.max(.01, tilePixels / 2);
    for (const line of routeLines) line.material.dashScale = pixelsPerUnit;
    cues.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate);
  return {
    zoom: (factor) => {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, MAP_ZOOM.minimum, MAP_ZOOM.maximum);
      camera.updateProjectionMatrix();
    },
    reset: () => {
      const damping = controls.enableDamping; controls.enableDamping = false; controls.update();
      controls.target.set(0, 0, 0); camera.position.set(19, 29, 31); camera.zoom = 1;
      camera.updateProjectionMatrix(); controls.update(); camera.updateMatrixWorld();
      const width = container.clientWidth; const height = container.clientHeight;
      const window = mapContentWindow(width, height, mapHierarchyObstacles(container));
      const overview = width < 600 && world.cities.length ? world.cities.map(city => ({ ...city, height: tileLookup.get(`${city.q},${city.r}`)?.height ?? .4 })) : world.tiles;
      const points = overview.map(tile => { const point = hexPosition(tile.q, tile.r); return new THREE.Vector3(point.x, tile.height, point.z).project(camera); });
      if (window && points.length) {
        const left = Math.min(...points.map(point => point.x)); const right = Math.max(...points.map(point => point.x));
        const top = Math.max(...points.map(point => point.y)); const bottom = Math.min(...points.map(point => point.y));
        const scale = Math.min(window.width / Math.max(1, (right - left) * width / 2 + 24), window.height / Math.max(1, (top - bottom) * height / 2 + 24));
        camera.zoom = THREE.MathUtils.clamp(scale, MAP_ZOOM.minimum, MAP_ZOOM.maximum); camera.updateProjectionMatrix();
        const origin = new THREE.Vector3().project(camera);
        const unitX = new THREE.Vector3(1, 0, 0).project(camera); const unitZ = new THREE.Vector3(0, 0, 1).project(camera);
        const shift = cameraShiftForAnchor({ x: (left + right) * camera.zoom / 4 + .5, y: .5 - (top + bottom) * camera.zoom / 4 },
          { x: (window.left + window.width / 2) / width, y: (window.top + window.height / 2) / height },
          { x: (unitX.x - origin.x) / 2, y: -(unitX.y - origin.y) / 2 }, { x: (unitZ.x - origin.x) / 2, y: -(unitZ.y - origin.y) / 2 });
        controls.target.add(new THREE.Vector3(shift.x, 0, shift.z)); camera.position.add(new THREE.Vector3(shift.x, 0, shift.z)); controls.update();
      }
      controls.enableDamping = damping;
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
      const target = unobscuredInspectionAnchor(current, anchor, { width: container.clientWidth, height: container.clientHeight }, mapHierarchyObstacles(container));
      const unitX = screen(city.point.clone().add(new THREE.Vector3(1, 0, 0)));
      const unitZ = screen(city.point.clone().add(new THREE.Vector3(0, 0, 1)));
      const shift = cameraShiftForAnchor(current, target,
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
      wonderMeshes.dispose();
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
