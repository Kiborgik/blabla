import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CIVILIZATIONS, hexPosition } from './atlas.ts';
import type { AtlasTile, AtlasWorld } from './atlas.ts';
import type { ViewerPreferences } from './viewer-state.ts';

export interface AtlasRenderer {
  zoom: (factor: number) => void;
  reset: () => void;
  select: (id: number) => void;
  setLayer: (layer: 'borders' | 'routes', visible: boolean) => void;
  snapshot: () => Pick<ViewerPreferences, 'zoom' | 'x' | 'z'>;
  setMotion: (moving: boolean) => void;
}

const TERRAIN_COLORS = {
  grassland: '#8c9b6e',
  forest: '#637f5c',
  desert: '#c5ad7a',
  mountain: '#8f9785',
};
const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

export function createAtlasRenderer(
  container: HTMLElement,
  labels: HTMLElement,
  world: AtlasWorld,
  preferences: ViewerPreferences,
  onSelect: (id: number) => void,
): AtlasRenderer {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#204a51');
  scene.fog = new THREE.Fog('#204a51', 44, 95);
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
    'Illustrative three dimensional civilization atlas. Drag to pan. Pinch or use map buttons to zoom. Select a civilization in the list to inspect.',
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
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), material('#2c6269'));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.23;
  sea.receiveShadow = true;
  scene.add(sea);
  const tileGeometry = new THREE.CylinderGeometry(0.99, 0.99, 1, 6);
  const coastGeometry = new THREE.CylinderGeometry(1.07, 1.13, 0.13, 6);
  const treeGeometry = new THREE.ConeGeometry(0.23, 0.8, 5);
  const mountainGeometry = new THREE.ConeGeometry(0.84, 1, 5);
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
  const cityTiles = new Set(world.cities.map((city) => `${city.q},${city.r}`));
  const addTile = (tile: AtlasTile): void => {
    const { x, z } = hexPosition(tile.q, tile.r);
    const owner = CIVILIZATIONS[tile.owner];
    const tint = new THREE.Color(TERRAIN_COLORS[tile.terrain]).lerp(
      new THREE.Color(owner?.color ?? '#c7b681'),
      0.12,
    );
    addMesh(coastGeometry, '#518780', x, -0.12, z);
    addMesh(tileGeometry, `#${tint.getHexString()}`, x, tile.height / 2, z, [1, tile.height, 1]);
    if (!cityTiles.has(`${tile.q},${tile.r}`)) {
      if (tile.terrain === 'forest') {
        for (let i = 0; i < 4; i += 1) {
          const angle = i * 2.39 + tile.q;
          const offset = i === 0 ? 0 : 0.45;
          const height = 0.7 + Math.abs(Math.sin(tile.q * 3 + tile.r + i)) * 0.55;
          addMesh(
            treeGeometry,
            i % 2 ? '#345c47' : '#436d4d',
            x + Math.cos(angle) * offset,
            tile.height + height * 0.38,
            z + Math.sin(angle) * offset,
            [1, height, 1],
          );
        }
      }
      if (tile.terrain === 'mountain') {
        const height = 1.3 + Math.abs(Math.sin(tile.q + tile.r * 5)) * 1.4;
        const mountain = addMesh(mountainGeometry, '#8d9384', x, tile.height + height / 2, z, [
          1,
          height,
          1,
        ]);
        mountain.rotation.y = tile.q;
        addMesh(mountainGeometry, '#dfdfc6', x, tile.height + height * 0.83, z, [
          0.36,
          height * 0.34,
          0.36,
        ]);
      }
    }
    for (let i = 0; i < NEIGHBORS.length; i += 1) {
      const neighbor = NEIGHBORS[i];
      if (!neighbor) continue;
      const next = tileLookup.get(`${tile.q + neighbor[0]},${tile.r + neighbor[1]}`);
      if (next?.owner === tile.owner) continue;
      const middle = (Math.PI / 3) * i;
      const points = [middle - Math.PI / 6, middle + Math.PI / 6].map(
        (angle) =>
          new THREE.Vector3(
            x + Math.cos(angle),
            Math.max(tile.height, next?.height ?? 0) + 0.045,
            z + Math.sin(angle),
          ),
      );
      borders.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({
            color: owner?.color ?? '#e7bf69',
            transparent: true,
            opacity: next ? 0.85 : 0.44,
          }),
        ),
      );
    }
  };
  for (const tile of world.tiles) addTile(tile);
  borders.visible = preferences.borders;
  scene.add(borders);
  const cityLabels: Array<{ element: HTMLButtonElement; point: THREE.Vector3; id: number }> = [];
  for (const city of world.cities) {
    const { x, z } = hexPosition(city.q, city.r);
    const floor = tileLookup.get(`${city.q},${city.r}`)?.height ?? 0.4;
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
    const element = document.createElement('button');
    element.className = 'city-label';
    element.style.setProperty('--civ-color', city.color);
    element.innerHTML = `<span class="capital-star">✦</span><strong>${city.capital}</strong><small>${city.shortName}</small>`;
    element.setAttribute('aria-label', `Inspect ${city.name}, capital ${city.capital}`);
    element.addEventListener('click', () => onSelect(city.id));
    labels.append(element);
    cityLabels.push({ element, point: new THREE.Vector3(x, floor + 1.45, z), id: city.id });
  }
  const ships: Array<{ mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; offset: number }> = [];
  for (const [from, to] of world.routes) {
    const origin = world.cities[from];
    const destination = world.cities[to];
    if (!origin || !destination) continue;
    const a = hexPosition(origin.q, origin.r);
    const b = hexPosition(destination.q, destination.r);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(a.x, 0.68, a.z),
      new THREE.Vector3((a.x + b.x) / 2, 1.3, (a.z + b.z) / 2 + 1.2),
      new THREE.Vector3(b.x, 0.68, b.z),
    );
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(60)),
      new THREE.LineDashedMaterial({
        color: '#f5e5ad',
        dashSize: 0.14,
        gapSize: 0.18,
        transparent: true,
        opacity: 0.55,
      }),
    );
    line.computeLineDistances();
    routes.add(line);
    const ship = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.07),
      new THREE.MeshBasicMaterial({ color: '#fff2bf' }),
    );
    routes.add(ship);
    ships.push({ mesh: ship, curve, offset: from * 0.17 });
  }
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
  const select = (id: number): void => {
    const city = world.cities[id];
    if (!city) return;
    const point = hexPosition(city.q, city.r);
    ring.position.set(point.x, 0.58, point.z);
    for (const label of cityLabels) {
      label.element.classList.toggle('selected', label.id === id);
      label.element.setAttribute('aria-pressed', String(label.id === id));
    }
  };
  select(preferences.selected);
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
  let moving =
    !preferences.paused && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let elapsed = 0;
  let previousTime = 0;
  const animate = (time: number): void => {
    const delta = Math.min((time - previousTime) / 1000, 0.1);
    previousTime = time;
    if (moving) elapsed += delta;
    controls.update();
    for (const ship of ships)
      ship.mesh.position.copy(ship.curve.getPoint((elapsed * 0.035 + ship.offset) % 1));
    for (const label of cityLabels) {
      const projected = label.point.clone().project(camera);
      label.element.style.left = `${(projected.x * 0.5 + 0.5) * container.clientWidth}px`;
      label.element.style.top = `${(-projected.y * 0.5 + 0.5) * container.clientHeight}px`;
      label.element.hidden = projected.z > 1 || projected.z < -1;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
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
    setLayer: (layer, visible) => {
      (layer === 'borders' ? borders : routes).visible = visible;
    },
    snapshot: () => ({ zoom: camera.zoom, x: controls.target.x, z: controls.target.z }),
    setMotion: (value) => {
      moving = value;
    },
  };
}
