import assert from 'node:assert/strict';
import test from 'node:test';
import { projectTerrainSurface, projectLandscape, territoryEdgeTriangles, LANDSCAPE_BUDGETS } from '../visuals/landscape.ts';
import type { LandscapeTile } from '../visuals/landscape.ts';
import { flatMapPoint, flatSceneFaces } from '../web/settlement-parts.ts';
import { allocateMapHierarchy } from '../visuals/map-hierarchy.ts';
import { settlementVisual, DETAIL_BUDGETS } from '../visuals/world-visuals.ts';
import { createTerrainMeshes } from '../web/landscape-three.ts';
import * as THREE from 'three';
import { createWorld } from '../core/engine.ts';
import { projectWorld } from '../web/live-world.ts';
import { createFlatAtlasRenderer, createFlatTerritoryLayer } from '../web/flat-renderer.ts';
import { createTerritoryMeshes } from '../web/renderer.ts';
import { DEFAULT_PREFERENCES } from '../web/viewer-state.ts';
import { mapHierarchyObstacles } from '../web/map-labels.ts';
import { hexPosition } from '../web/atlas.ts';

const tiles: LandscapeTile[] = [
  { q: 0, r: 0, height: .3, terrain: 'grassland', owner: 0 },
  { q: 1, r: 0, height: .6, terrain: 'forest', owner: 0 },
  { q: 0, r: 1, height: .45, terrain: 'mountain', owner: 1 },
];

void test('oblique fallback compresses the ground plane but preserves exact elevation and canonical inputs', () => {
  assert.deepEqual(flatMapPoint(3, 4, 0), { x: 3, z: 2.88 });
  assert.deepEqual(flatMapPoint(3, 4, 2), { x: 3, z: 1.18 });
  const part = { id: 'roof', shape: 'gable' as const, material: 'roof' as const, position: [1, .8, 2] as const, scale: [.5, .3, .5] as const, rotation: .2 };
  const before = structuredClone(part);
  assert.notDeepEqual(flatSceneFaces([part], .72), flatSceneFaces([part]));
  assert.deepEqual(part, before);
});

void test('terrain facets share exact corner heights, retain each tile center and expose only real coastline', () => {
  const before = structuredClone(tiles);
  const surface = projectTerrainSurface(tiles);
  assert.equal(surface.length, tiles.length);
  assert.deepEqual(projectTerrainSurface(tiles.toReversed()), surface);
  const corners = new Map<string, number>();
  for (const tile of surface) {
    const source = tiles.find(entry => `${entry.q},${entry.r}` === tile.key);
    assert.ok(source);
    assert.equal(tile.center[1], source.height);
    assert.equal(tile.faces.length, 6);
    for (const point of tile.rim) {
      const key = `${point[0].toFixed(6)},${point[2].toFixed(6)}`;
      if (corners.has(key)) assert.equal(corners.get(key), point[1]);
      corners.set(key, point[1]);
    }
    assert.ok(tile.faces.every(face => face.points.length === 3 && face.points.flat().every(Number.isFinite)));
  }
  const coast = projectLandscape(tiles, [], 'far').coast;
  assert.deepEqual(surface.flatMap(tile => tile.cliffs.map(face => face.key)).sort(), coast.map(edge => edge.key).sort());
  assert.deepEqual(tiles, before);
});

void test('Three terrain batches the same raised surfaces and shores without inventing geography', () => {
  const before = structuredClone(tiles);
  const group = createTerrainMeshes(tiles);
  assert.equal(group.children.length, 2);
  assert.ok(group.children.every(child => child instanceof THREE.Mesh));
  const surfaces = projectTerrainSurface(tiles);
  const top = group.children[0];
  assert.ok(top instanceof THREE.Mesh);
  assert.equal(top.geometry.getAttribute('position').count, surfaces.length * 18);
  assert.ok(Array.from(top.geometry.getAttribute('position').array).every(Number.isFinite));
  for (const child of group.children) if (child instanceof THREE.Mesh) { child.geometry.dispose(); if (child.material instanceof THREE.Material) child.material.dispose(); }
  assert.deepEqual(tiles, before);
});

void test('terrain silhouettes become richer with zoom under the existing world part budgets', () => {
  const source = [...tiles, { q: 2, r: 1, height: .35, terrain: 'desert' as const, owner: null }];
  const far = projectLandscape(source, [], 'far');
  const close = projectLandscape(source, [], 'close');
  assert.ok(close.parts.length > far.parts.length);
  assert.ok(close.parts.some(part => part.id.includes('trunk')));
  assert.ok(close.parts.some(part => part.id.includes('summit')));
  for (const detail of ['far', 'mid', 'close'] as const) assert.ok(projectLandscape(source, [], detail).parts.length <= LANDSCAPE_BUDGETS[detail]);
});

void test('far labels prioritize cities and completed landmarks instead of unrelated site captions', () => {
  const anchors = [
    { id: 'town', kind: 'town' as const, label: 'Dawnwell', x: 120, y: 160, selected: true },
    { id: 'campus', kind: 'site' as const, label: 'Campus', x: 300, y: 160 },
    { id: 'wonder', kind: 'wonder' as const, label: 'Great library', x: 500, y: 160, completed: true },
    { id: 'work', kind: 'site' as const, label: 'Mine', x: 700, y: 160, related: true },
  ];
  const far = allocateMapHierarchy(anchors, { width: 1000, height: 600, tileDiameter: 18 });
  assert.equal(far.items.find(item => item.id === 'campus')?.mark, null);
  assert.ok(far.items.find(item => item.id === 'town')?.label);
  assert.ok(far.items.find(item => item.id === 'wonder')?.label);
  assert.ok(far.items.find(item => item.id === 'work')?.mark);
  const close = allocateMapHierarchy(anchors, { width: 1000, height: 600, tileDiameter: 70 });
  assert.ok(close.items.find(item => item.id === 'campus')?.mark);
  assert.ok(close.items.filter(item => item.mark).every(item => item.mark && item.mark.width >= 44));
});

void test('residential variation follows civilization and population without pretending construction finished', () => {
  const city = { id: 'town', civId: 0, tileId: 1, name: 'Dawnwell', population: 20, wellbeing: 70, damage: 0, buildings: [] as string[] };
  for (const detail of ['far', 'mid', 'close'] as const) {
    const visual = settlementVisual(city, detail);
    const peer = settlementVisual({ ...city, civId: 1 }, detail);
    assert.notDeepEqual(visual.parts, peer.parts);
    assert.ok(visual.parts.every(part => part.id.startsWith('home-')));
    assert.equal(visual.buildings.length, 0);
    assert.ok(visual.parts.length <= DETAIL_BUDGETS[detail].parts);
    assert.ok(visual.houses <= DETAIL_BUDGETS[detail].houses);
  }
});

void test('local settlement display scale preserves every installed part instead of adding or removing buildings', async () => {
  const { createWorld } = await import('../core/engine.ts');
  const { projectWorld } = await import('../web/live-world.ts');
  const { createSettlementMeshes } = await import('../web/settlement-three.ts');
  const { SETTLEMENT_RENDER_SCALE } = await import('../visuals/world-visuals.ts');
  const state = createWorld(1701);
  const city = state.cities[0]; assert.ok(city);
  city.population = 24; city.buildings = ['farm', 'workshop', 'aqueduct'];
  const world = projectWorld(state); world.cities = world.cities.filter(town => town.cityId === city.id);
  const appearance = new THREE.MeshBasicMaterial();
  const meshes = createSettlementMeshes(world, () => appearance);
  meshes.update(60);
  const key = (values: readonly number[]): string => values.map(value => value.toFixed(5)).join(',');
  const actual = meshes.group.children.flatMap(child => {
    if (!(child instanceof THREE.InstancedMesh)) return [];
    return Array.from({ length: child.count }, (_, index) => { const matrix = new THREE.Matrix4(); child.getMatrixAt(index, matrix); return key(new THREE.Vector3().setFromMatrixScale(matrix).toArray()); });
  }).sort();
  const expected = settlementVisual(city, 'close').parts.map(part => key(part.scale.map(value => value * SETTLEMENT_RENDER_SCALE))).sort();
  assert.deepEqual(actual, expected);
  assert.ok(SETTLEMENT_RENDER_SCALE < 1 && SETTLEMENT_RENDER_SCALE > .5);
  meshes.dispose(); appearance.dispose();
});

class SvgFixtureElement {
  tag: string;
  attributes: Record<string, string> = {};
  children: SvgFixtureElement[] = [];
  parentElement: SvgFixtureElement | null = null;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  classList = { toggle: (): boolean => false };
  viewBox = { baseVal: { x: 0, y: 0, width: 1, height: 1 } };
  clientWidth = 1000;
  clientHeight = 700;
  bounds = { left: 0, top: 0, width: 1000, height: 700 };
  constructor(tag: string) { this.tag = tag; }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === 'viewBox') {
      const [x = 0, y = 0, width = 1, height = 1] = value.split(' ').map(Number);
      this.viewBox.baseVal = { x, y, width, height };
    }
  }
  append(...children: SvgFixtureElement[]): void { for (const child of children) child.parentElement = this; this.children.push(...children); }
  prepend(...children: SvgFixtureElement[]): void { for (const child of children) child.parentElement = this; this.children.unshift(...children); }
  replaceChildren(...children: SvgFixtureElement[]): void { this.children = []; this.append(...children); }
  replaceWith(replacement: SvgFixtureElement): void {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index < 0) return;
    replacement.remove();
    replacement.parentElement = parent;
    parent.children.splice(index, 1, replacement);
    this.parentElement = null;
  }
  addEventListener(): void {}
  remove(): void { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  getBoundingClientRect(): typeof this.bounds { return this.bounds; }
  descendants(): SvgFixtureElement[] { return this.children.flatMap(child => [child, ...child.descendants()]); }
  closest(selector: string): SvgFixtureElement | null { return selector === `#${this.attributes['id']}` ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector: string): SvgFixtureElement[] {
    const classes = selector.split(',').map(value => value.trim().slice(1));
    return this.descendants().filter(element => (element.attributes['class'] ?? '').split(' ').some(value => classes.includes(value)));
  }
}

function withSvgFixture(run: () => void): void {
  const globals = {
    document: { createElementNS: (_namespace: string, tag: string) => new SvgFixtureElement(tag), createElement: (tag: string) => new SvgFixtureElement(tag), querySelectorAll: () => [] },
    window: { matchMedia: () => ({ matches: false }) },
    ResizeObserver: class { observe(): void {} disconnect(): void {} },
  };
  const previous = new Map(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  try {
    for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, value });
    run();
  } finally {
    for (const [name, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
}

void test('retained fallback city banners hide and recover with their culled hierarchy allocation', () => withSvgFixture(() => {
  const container = new SvgFixtureElement('div');
  const world = projectWorld(createWorld(1701));
  const renderer = createFlatAtlasRenderer(container as unknown as HTMLElement, world, { ...DEFAULT_PREFERENCES }, () => {}, () => {});
  try {
    renderer.reset();
    const camera = renderer.snapshot();
    const city = container.descendants().find(element => element.attributes['class'] === 'flat-city' && element.children.some(child => child.tag === 'rect' && child.style['visibility'] === 'visible'));
    assert.ok(city);
    const banner = city.children.find(child => child.tag === 'rect');
    const label = city.children.at(-1);
    assert.ok(banner && label?.tag === 'text');
    assert.equal(label.style['visibility'], 'visible');
    renderer.restoreCamera({ x: 10_000, z: 10_000, zoom: 1 });
    assert.equal(city.style['visibility'], 'hidden');
    assert.equal(city.attributes['tabindex'], '-1');
    assert.equal(label.style['visibility'], 'hidden');
    assert.equal(banner.style['visibility'], 'hidden');
    renderer.restoreCamera(camera);
    assert.equal(city.style['visibility'], 'visible');
    assert.equal(label.style['visibility'], 'visible');
    assert.equal(banner.style['visibility'], 'visible');
  } finally { renderer.dispose(); }
}));

void test('political endpoints follow the unequal shared three-tile relief in SVG and Three', () => withSvgFixture(() => {
  const source: LandscapeTile[] = [
    { q: 0, r: 0, owner: 0, terrain: 'grassland', height: .1 },
    { q: 1, r: 0, owner: 1, terrain: 'grassland', height: .1 },
    { q: 0, r: 1, owner: 1, terrain: 'mountain', height: .9 },
  ];
  const landscape = projectLandscape(source, [], 'far');
  const edge = landscape.borders.find(candidate => candidate.key === '0,0:0');
  assert.ok(edge && edge.fromHeight !== undefined && edge.toHeight !== undefined);
  const fromHeight = .1 + .035;
  const toHeight = ((.1 + .1 + .9) / 3) * .98 + .1 * .02 + .035;
  assert.ok(Math.abs(edge.fromHeight - fromHeight) < 1e-10);
  assert.ok(Math.abs(edge.toHeight - toHeight) < 1e-10);
  assert.ok(edge.toHeight > edge.height + .2);
  assert.deepEqual(territoryEdgeTriangles(edge).filter((_, index) => index % 3 === 1), [edge.fromHeight, edge.toHeight, edge.toHeight, edge.fromHeight, edge.toHeight, edge.fromHeight]);
  const world = projectWorld(createWorld(1701)); world.tiles = source;
  const svg = createFlatTerritoryLayer(world) as unknown as SvgFixtureElement;
  const path = svg.children.find(element => element.attributes['data-boundary'] === edge.key)?.attributes['d'];
  const from = flatMapPoint(edge.from[0], edge.from[1], fromHeight);
  const to = flatMapPoint(edge.to[0], edge.to[1], toHeight);
  assert.equal(path, `M${from.x},${from.z}L${to.x},${to.z}`);
  const meshes = createTerritoryMeshes(world);
  try {
    const boundary = meshes.children.find(child => child.userData['owner'] === 0 && child.userData['boundaries']);
    assert.ok(boundary instanceof THREE.Mesh);
    const index = (boundary.userData['boundaries'] as string[]).indexOf(edge.key);
    const positions = boundary.geometry.getAttribute('position');
    assert.ok(Math.abs(positions.getY(index * 6) - fromHeight) < 1e-6);
    assert.ok(Math.abs(positions.getY(index * 6 + 1) - toHeight) < 1e-6);
  } finally {
    for (const child of meshes.children) if (child instanceof THREE.Mesh) { child.geometry.dispose(); if (child.material instanceof THREE.Material) child.material.dispose(); }
  }
}));

void test('full-viewport hierarchy includes sibling shell bars in local coordinates but not hidden overlays', () => {
  const app = new SvgFixtureElement('div'); app.setAttribute('id', 'app');
  const header = new SvgFixtureElement('header'); header.setAttribute('class', 'masthead'); header.bounds = { left: 100, top: 80, width: 900, height: 52 };
  const main = new SvgFixtureElement('main');
  const footer = new SvgFixtureElement('footer'); footer.setAttribute('class', 'footer'); footer.bounds = { left: 100, top: 636, width: 900, height: 44 };
  const container = new SvgFixtureElement('div'); container.bounds = { left: 100, top: 80, width: 900, height: 600 };
  const hidden = new SvgFixtureElement('aside'); hidden.setAttribute('class', 'inspection'); hidden.bounds = { left: 500, top: 100, width: 0, height: 0 };
  app.append(header, main, footer); main.append(container, hidden);
  assert.deepEqual(mapHierarchyObstacles(container as unknown as HTMLElement), [
    { left: 0, top: 0, width: 900, height: 52 },
    { left: 0, top: 556, width: 900, height: 44 },
  ]);
  app.attributes['id'] = 'embedded';
  assert.deepEqual(mapHierarchyObstacles(container as unknown as HTMLElement), []);
});

void test('actual fallback inspection separates minimal maintenance from centered focus at requested zoom', () => withSvgFixture(() => {
  const app = new SvgFixtureElement('div'); app.setAttribute('id', 'app');
  const container = new SvgFixtureElement('div'); container.clientWidth = 1180; container.clientHeight = 756; container.bounds = { left: 0, top: 0, width: 1180, height: 756 };
  const panel = new SvgFixtureElement('aside'); panel.setAttribute('class', 'inspection'); panel.bounds = { left: 842, top: 144, width: 320, height: 546 };
  const chronicle = new SvgFixtureElement('aside'); chronicle.setAttribute('class', 'chronicle'); chronicle.bounds = { left: 18, top: 441, width: 332, height: 255 };
  app.append(container, panel, chronicle);
  const world = projectWorld(createWorld(1701));
  const before = structuredClone(world);
  const city = world.cities[0]; assert.ok(city?.cityId);
  const tile = world.tiles.find(tile => tile.q === city.q && tile.r === city.r); assert.ok(tile);
  const position = hexPosition(city.q, city.r);
  const point = flatMapPoint(position.x, position.z, tile.height);
  const renderer = createFlatAtlasRenderer(container as unknown as HTMLElement, world, { ...DEFAULT_PREFERENCES }, () => {}, () => {});
  const scale = container.clientHeight / 32;
  const place = (x: number, y: number): void => renderer.restoreCamera({ x: point.x - (x - container.clientWidth / 2) / scale, z: (point.z - (y - container.clientHeight / 2) / scale) / .72, zoom: 1 });
  try {
    place(337, 250);
    const home = renderer.snapshot();
    renderer.frameCity(city.cityId, { x: 594 / 1180, y: 420 / 756 });
    assert.deepEqual(renderer.snapshot(), home);
    place(1020, 420);
    renderer.frameCity(city.cityId, { x: .5, y: .5 });
    const svg = container.children.find(element => element.tag === 'svg'); assert.ok(svg);
    const box = svg.viewBox.baseVal;
    assert.ok(Math.abs((point.x - box.x) / box.width * container.clientWidth - 792) < 1e-8);
    assert.ok(Math.abs((point.z - box.y) / box.height * container.clientHeight - 420) < 1e-8);
    assert.equal(renderer.snapshot().zoom, home.zoom);
    const retained = renderer.snapshot(); renderer.frameCity(city.cityId, { x: .5, y: .5 }); assert.deepEqual(renderer.snapshot(), retained);
    const preferred = { x: 594 / 1180, y: 420 / 756 };
    const assertFocused = (): void => {
      const box = svg.viewBox.baseVal;
      assert.ok(Math.abs((point.x - box.x) / box.width - preferred.x) < 1e-9);
      assert.ok(Math.abs((point.z - box.y) / box.height - preferred.y) < 1e-9);
    };
    renderer.frameCity(city.cityId, preferred, 'focus');
    assertFocused();
    assert.equal(renderer.snapshot().zoom, home.zoom);
    renderer.zoom(1.2);
    renderer.frameCity(city.cityId, preferred, 'focus');
    assertFocused();
    assert.equal(renderer.snapshot().zoom, home.zoom * 1.2);
    const focused = renderer.snapshot();
    renderer.frameCity(city.cityId, preferred, 'focus');
    assertFocused();
    assert.ok(Math.abs(renderer.snapshot().x - focused.x) < 1e-9);
    assert.ok(Math.abs(renderer.snapshot().z - focused.z) < 1e-9);
    renderer.frameCity(city.cityId, { x: .5, y: .5 }, 'maintain');
    assertFocused();
    renderer.zoom(1 / 1.2);
    renderer.frameCity(city.cityId, preferred, 'focus');
    assertFocused();
    assert.equal(renderer.snapshot().zoom, home.zoom);
    renderer.restoreCamera(home);
    assert.deepEqual(renderer.snapshot(), home);
    assert.deepEqual(world, before);
  } finally { renderer.dispose(); }
}));
