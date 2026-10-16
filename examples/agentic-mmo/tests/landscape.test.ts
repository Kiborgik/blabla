import assert from 'node:assert/strict';
import test from 'node:test';
import { projectLandscape, LANDSCAPE_BUDGETS } from '../visuals/landscape.ts';
import type { LandscapeTile } from '../visuals/landscape.ts';
import { settlementVisual } from '../visuals/world-visuals.ts';
import * as THREE from 'three';
import { createLandscapeMeshes } from '../web/landscape-three.ts';
import { projectWorld } from '../web/live-world.ts';
import { flatSceneFaces, shapeTriangles, flatPartFaces } from '../web/settlement-parts.ts';
import { createWorld } from '../core/engine.ts';

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
