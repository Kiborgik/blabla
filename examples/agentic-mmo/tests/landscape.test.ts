import assert from 'node:assert/strict';
import test from 'node:test';
import { projectLandscape, LANDSCAPE_BUDGETS, TERRITORY_STYLE, territoryEdgeTriangles, landscapeSurface } from '../visuals/landscape.ts';
import type { LandscapeTile } from '../visuals/landscape.ts';
import { settlementVisual, DETAIL_BUDGETS } from '../visuals/world-visuals.ts';
import * as THREE from 'three';
import { createLandscapeMeshes } from '../web/landscape-three.ts';
import { projectWorld } from '../web/live-world.ts';
import { flatSceneFaces, shapeTriangles, flatPartFaces } from '../web/settlement-parts.ts';
import { createWorld } from '../core/engine.ts';
import { createTerritoryMeshes } from '../web/renderer.ts';
import { createFlatTerritoryLayer } from '../web/flat-renderer.ts';
import { createSettlementMeshes } from '../web/settlement-three.ts';

const tiles = [
  { q: 0, r: 0, owner: 0, terrain: 'forest', height: .3 },
  { q: 1, r: 0, owner: 0, terrain: 'mountain', height: .45 },
] as const satisfies readonly LandscapeTile[];

function containsPoint(x: number, y: number, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if (a && b && (a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

await test('coast follows actual outer adjacency and same-owner interiors have no border', () => {
  const value = projectLandscape(tiles, [], 'mid');
  assert.equal(value.coast.length, 10);
  assert.equal(value.borders.length, 10);
  assert.ok(value.coast.every(edge => edge.key !== '0,0:0' && edge.key !== '1,0:3'));
  const split = projectLandscape([tiles[0], { ...tiles[1], owner: 1 }], [], 'mid');
  assert.equal(split.borders.length, 12);
});

await test('terrain masses are deterministic, immutable and retain canonical type and town clearing', () => {
  const before = structuredClone(tiles);
  const value = projectLandscape(tiles, [], 'mid');
  assert.ok(value.parts.some(part => part.id.startsWith('forest:0,0:')));
  assert.ok(value.parts.some(part => part.id.startsWith('mountain:1,0:')));
  assert.deepEqual(value, projectLandscape(tiles.toReversed(), [], 'mid'));
  const town = projectLandscape(tiles, [{ q: 0, r: 0, population: 20 }], 'mid');
  assert.ok(town.parts.some(part => part.id.startsWith('ground:')));
  assert.ok(!town.parts.some(part => part.id.startsWith('forest:0,0:')));
  assert.deepEqual(tiles, before);
});

await test('terrain detail has explicit bounded whole-world allocation at every level', () => {
  const many = Array.from({ length: 1000 }, (_, q) => ({ ...tiles[0], q }));
  for (const detail of ['far', 'mid', 'close'] as const) {
    const value = projectLandscape(many, [{ q: 999, r: 0, population: 20 }], detail);
    assert.ok(value.parts.length > 0);
    assert.ok(value.parts.length <= LANDSCAPE_BUDGETS[detail]);
    assert.ok(value.parts.some(part => part.id === 'ground:999,0'));
    assert.equal(new Set(value.parts.map(part => part.id)).size, value.parts.length);
    assert.ok(value.parts.every(part => [...part.position, ...part.scale].every(Number.isFinite)));
  }
});

await test('population still changes a town silhouette after far-detail house count is capped', () => {
  const city = createWorld(1701).cities[0];
  assert.ok(city);
  const small = settlementVisual({ ...city, population: 7 }, 'far');
  const large = settlementVisual({ ...city, population: 40 }, 'far');
  assert.equal(small.houses, large.houses);
  assert.notDeepEqual(small.parts.filter(part => part.id.startsWith('home-')), large.parts.filter(part => part.id.startsWith('home-')));
  assert.ok(large.parts.some(part => part.material === 'roof'));
});

await test('SVG solids omit hidden back faces instead of painting them over the roof silhouette', () => {
  const part = { id: 'house', shape: 'box' as const, material: 'plaster' as const, position: [0, .2, 0] as const, scale: [.5, .4, .5] as const, rotation: 0 };
  assert.equal(flatPartFaces(part).length, 2);
});

await test('Three landscape uses the same active parts, batches geometry and releases instances', () => {
  const world = projectWorld(createWorld(1701));
  const material = new THREE.MeshBasicMaterial();
  const layer = createLandscapeMeshes(world, () => material);
  assert.equal(layer.update(60), 'close');
  const expected = projectLandscape(world.tiles, world.cities, 'close');
  const meshes = layer.group.children.filter(child => child instanceof THREE.InstancedMesh);
  assert.equal(meshes.reduce((sum, mesh) => sum + mesh.count, 0), expected.parts.length);
  assert.ok(meshes.length < 10);
  assert.ok(meshes.every(mesh => mesh.boundingSphere !== null));
  const geometries = new Set<THREE.BufferGeometry>();
  for (const mesh of meshes) { const geometry: unknown = mesh.geometry; if (geometry instanceof THREE.BufferGeometry) geometries.add(geometry); }
  layer.update(18);
  assert.ok(layer.group.children.every(child => child instanceof THREE.InstancedMesh && geometries.has(child.geometry)));
  layer.dispose();
  assert.equal(layer.group.children.length, 0);
  material.dispose();
});

await test('terrain solids remain outward-facing and SVG scene faces paint in shared depth order', () => {
  for (const shape of ['cone', 'canopy'] as const) {
    const triangles = shapeTriangles(shape);
    let volume = 0;
    for (let index = 0; index < triangles.length; index += 9) {
      const a = new THREE.Vector3().fromArray(triangles, index);
      const b = new THREE.Vector3().fromArray(triangles, index + 3);
      const c = new THREE.Vector3().fromArray(triangles, index + 6);
      volume += a.dot(b.cross(c)) / 6;
    }
    assert.ok(volume > 0, shape);
  }
  const parts = projectLandscape(tiles, [], 'mid').parts;
  const faces = flatSceneFaces(parts);
  assert.ok(faces.length > 0);
  assert.deepEqual(faces, flatSceneFaces(parts.toReversed()));
  assert.ok(faces.every((face, index) => index === 0 || face.depth >= (faces[index - 1]?.depth ?? 0)));
});

await test('larger population roofs leave all seven built families and current damage unoccluded at every LOD', () => {
  const buildings = ['farm', 'workshop', 'irrigation', 'kiln', 'academy', 'monument', 'fuel-yard'];
  const city = createWorld(1701).cities[0];
  assert.ok(city);
  for (const detail of ['far', 'mid', 'close'] as const) {
    for (const population of [4, 20, 40]) {
      const visual = settlementVisual({ ...city, population, buildings, damage: 35 }, detail);
      const faces = flatSceneFaces(visual.parts).map(face => ({
        id: face.part.id,
        polygon: face.points.split(' ').map(point => {
          const coordinates = point.split(',').map(Number);
          const x = coordinates[0];
          const y = coordinates[1];
          assert.ok(typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y));
          return { x, y };
        }),
      }));
      const exposed = new Set<string>();
      for (let py = 0; py < 80; py++) {
        for (let px = 0; px < 80; px++) {
          const face = faces.findLast(candidate => containsPoint(-1.8 + px / 80 * 3.6, -2 + py / 80 * 4, candidate.polygon));
          if (face) exposed.add(face.id);
        }
      }
      for (const family of [...buildings, 'damage', 'home']) {
        assert.ok([...exposed].some(id => id.startsWith(family)), `${detail}, population ${population}, ${family}`);
      }
    }
  }
});

await test('actual population tiers change residential massing without borrowing the field or workshop footprint', () => {
  const city = createWorld(1701).cities[0];
  assert.ok(city);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const samples: ReturnType<typeof settlementVisual>[] = [3, 18, 30].map(population => settlementVisual({ ...city, population, buildings: ['farm', 'workshop', 'aqueduct'] }, detail));
    const heights = samples.map(visual => Math.max(...visual.parts.filter(part => part.id.startsWith('home-')).map(part => part.position[1] + part.scale[1] / 2)));
    assert.ok(heights[0] !== undefined && heights[1] !== undefined && heights[2] !== undefined);
    assert.ok(heights[1] > heights[0] + .25);
    assert.ok(heights[2] > heights[1] + .1);
    const first = samples[0];
    assert.ok(first);
    for (const visual of samples) {
      assert.ok(visual.houses <= DETAIL_BUDGETS[detail].houses);
      assert.ok(visual.parts.length <= DETAIL_BUDGETS[detail].parts);
      assert.deepEqual(visual.parts.filter(part => !part.id.startsWith('home-')), first.parts.filter(part => !part.id.startsWith('home-')));
      assert.ok(visual.parts.filter(part => part.id.startsWith('home-')).every(part => Math.abs(part.position[0]) + part.scale[0] / 2 < .65));
    }
  }
});

await test('fields and workshop yards reflect installed structures, not active orders or operating permission', () => {
  const state = createWorld(1701);
  const city = state.cities[0];
  assert.ok(city);
  city.buildings = [];
  city.construction = { active: { id: 'synthetic-order', ruleVersion: 1, cityId: city.id, buildingId: 'farm', startedRound: 1,
    paid: { materials: 8, credits: 4 }, workRequired: 4, workDone: 3 }, lastCompleted: null };
  const before = structuredClone(state);
  const town = projectWorld(state).cities.find(candidate => candidate.cityId === city.id)?.settlement;
  assert.ok(town);
  assert.ok(settlementVisual(town, 'mid').parts.every(part => part.id.startsWith('home-')));
  assert.deepEqual(state, before);
  const installed = { ...city, buildings: ['farm', 'workshop'] };
  const visual = settlementVisual(installed, 'mid');
  const rows = visual.parts.filter(part => part.id.startsWith('farm-row'));
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(part => part.material)).size, 2);
  assert.ok(rows.every(part => part.scale[0] > .7));
  assert.ok(visual.parts.some(part => part.id === 'workshop-roof' && part.material === 'metal'));
  assert.ok(visual.parts.some(part => part.id === 'workshop-chimney'));
  assert.ok(visual.parts.some(part => part.id === 'workshop-yard'));
  assert.deepEqual(settlementVisual({ ...installed, buildingOperations: { workshop: { enabled: false, lastResult: null } } }, 'mid').parts, visual.parts);
});

await test('ownership surfaces cover only exact committed owned hexes and preserve terrain and coast', () => {
  const source = [...tiles, { q: 2, r: 0, owner: 1, terrain: 'grassland' as const, height: .2 }, { q: 3, r: 0, owner: null, terrain: 'desert' as const, height: .15 }];
  const before = structuredClone(source);
  const result = projectLandscape(source, [], 'mid');
  assert.deepEqual(result.territories.map(tile => [tile.key, tile.owner]), [['0,0', 0], ['1,0', 0], ['2,0', 1]]);
  assert.ok(result.territories.every(tile => tile.points.length === 6));
  assert.ok(!result.borders.some(edge => edge.key === '0,0:0' || edge.key === '1,0:3'));
  assert.ok(result.borders.some(edge => edge.key === '2,0:0'));
  const unowned = source.map(tile => ({ ...tile, owner: null }));
  const clear = projectLandscape(unowned, [], 'mid');
  assert.equal(clear.territories.length, 0);
  assert.equal(clear.borders.length, 0);
  assert.deepEqual(clear.parts, result.parts);
  assert.deepEqual(clear.coast.map(edge => [edge.key, edge.from, edge.to]), result.coast.map(edge => [edge.key, edge.from, edge.to]));
  assert.deepEqual(unowned.map(landscapeSurface), source.map(landscapeSurface));
  assert.deepEqual(result, projectLandscape(source.toReversed(), [], 'mid'));
  assert.deepEqual(source, before);
  assert.ok(TERRITORY_STYLE.washOpacity > 0 && TERRITORY_STYLE.washOpacity < .3);
});

class TerritoryElement {
  tag: string;
  attributes = new Map<string, string>();
  children: TerritoryElement[] = [];
  constructor(tag: string) { this.tag = tag; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  append(...children: TerritoryElement[]): void { this.children.push(...children); }
}

await test('SVG and Three territory layers share exact tiles, owners and boundaries without new interaction targets', () => {
  const world = projectWorld(createWorld(1701));
  world.tiles = [...tiles, { q: 2, r: 0, owner: 1, terrain: 'grassland', height: .2 }, { q: 3, r: 0, owner: null, terrain: 'forest', height: .3 }];
  const before = structuredClone(world);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElementNS: (_namespace: string, tag: string) => new TerritoryElement(tag) } });
  let flat: TerritoryElement;
  try { flat = createFlatTerritoryLayer(world) as unknown as TerritoryElement; }
  finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); }
  const layer = createTerritoryMeshes(world);
  const projected = projectLandscape(world.tiles, [], 'far');
  assert.equal(flat.attributes.get('pointer-events'), 'none');
  assert.ok(flat.children.every(element => ['polygon', 'path'].includes(element.tag) && !element.attributes.has('tabindex')));
  assert.deepEqual(flat.children.filter(element => element.tag === 'polygon').map(element => element.attributes.get('data-territory')), projected.territories.map(tile => tile.key));
  assert.deepEqual(layer.children.flatMap(child => child.userData['territories'] ?? []).sort(), projected.territories.map(tile => tile.key).sort());
  assert.deepEqual(layer.children.flatMap(child => child.userData['boundaries'] ?? []).sort(), projected.borders.map(edge => edge.key).sort());
  for (const child of layer.children) {
    assert.ok(child instanceof THREE.Mesh);
    assert.ok(child.material instanceof THREE.MeshBasicMaterial);
    const owner = world.cities.find(city => city.id === child.userData['owner']);
    assert.ok(owner);
    assert.equal(`#${child.material.color.getHexString()}`, owner.color.toLowerCase());
    assert.equal(child.material.depthWrite, false);
    const positions = child.geometry.getAttribute('position');
    assert.ok(positions.count > 0);
    assert.ok(Array.from(positions.array).every(Number.isFinite));
    if (child.userData['territories']) assert.equal(child.material.opacity, TERRITORY_STYLE.washOpacity);
    else assert.equal(positions.count, projected.borders.filter(edge => edge.owner === owner.id).length * 6);
    child.geometry.dispose();
    child.material.dispose();
  }
  assert.deepEqual(world, before);
});

await test('boundary ribbons retain canonical elevation and do not add width along an empty edge', () => {
  const edge = projectLandscape(tiles, [], 'mid').borders[0];
  assert.ok(edge);
  const points = territoryEdgeTriangles(edge);
  assert.equal(points.length, 18);
  assert.ok(points.filter((_, index) => index % 3 === 1).every(height => height === edge.height));
  assert.deepEqual(territoryEdgeTriangles({ ...edge, to: edge.from }), []);
});

await test('shared inhabited parts remain the exact Three instances at every detail tier', () => {
  const state = createWorld(1701);
  const city = state.cities[0];
  assert.ok(city);
  city.population = 30;
  city.buildings = ['farm', 'workshop', 'aqueduct'];
  const world = projectWorld(state);
  world.cities = world.cities.filter(town => town.cityId === city.id);
  const appearance = new THREE.MeshBasicMaterial();
  const meshes = createSettlementMeshes(world, () => appearance);
  for (const [pixels, detail] of [[18, 'far'], [36, 'mid'], [60, 'close']] as const) {
    assert.equal(meshes.update(pixels), detail);
    const instances = meshes.group.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
    assert.equal(instances.reduce((sum, mesh) => sum + mesh.count, 0), settlementVisual(city, detail).parts.length);
    assert.ok(instances.every(mesh => mesh.boundingSphere !== null));
  }
  meshes.dispose();
  assert.equal(meshes.group.children.length, 0);
  appearance.dispose();
});
