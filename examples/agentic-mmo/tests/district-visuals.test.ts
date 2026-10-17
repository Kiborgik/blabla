import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import { projectWorld } from '../web/live-world.ts';
import { districtCaptionPlacement, districtParts, districtLabel, DISTRICT_PART_BUDGETS } from '../visuals/district-visuals.ts';
import { createDistrictMeshes } from '../web/settlement-three.ts';
import { createLandscapeMeshes } from '../web/landscape-three.ts';
import { projectLandscape } from '../visuals/landscape.ts';
import { flatSceneFaces } from '../web/settlement-parts.ts';
import * as THREE from 'three';

function fixture() {
  const state = createWorld(1701);
  state.unlockedFeatures.push('district-planning', 'writing');
  const city = state.cities[0];
  assert.ok(city);
  return { state, city };
}

await test('an active Campus retains its exact reserved site without an installed building or output', () => {
  const { state, city } = fixture();
  city.construction = { active: { id: 'fixture-order', cityId: city.id, buildingId: 'campus', tileId: 39, ruleVersion: 1, startedRound: 2, paid: { materials: 16, credits: 8 }, workDone: 2, workRequired: 8 }, lastCompleted: null };
  const before = structuredClone(state);
  const district = projectWorld(state).districts?.[0];
  assert.ok(district);
  assert.equal(district.cityId, city.id);
  assert.equal(district.tileId, 39);
  assert.equal(district.status, 'building');
  assert.equal(district.library, 'absent');
  assert.deepEqual(district.construction, city.construction.active);
  assert.equal(district.baseProduction.science, 2);
  assert.ok(!city.buildings.includes('campus'));
  assert.deepEqual(state, before);
});

await test('completed Campus and Library bind to their own town and exact site, never the capital', () => {
  const { state, city } = fixture();
  const second = { ...structuredClone(city), id: 'frontier-fixture', name: 'Frontier fixture', tileId: 56, buildings: ['campus', 'library'], districtSites: { campus: 39 } };
  city.buildings = ['campus']; city.districtSites = { campus: 56 };
  state.cities.push(second);
  const world = projectWorld(state);
  const district = world.districts?.find(entry => entry.cityId === second.id);
  assert.ok(district);
  assert.equal(district.status, 'built');
  assert.equal(district.library, 'built');
  assert.equal(world.districts?.find(entry => entry.cityId === city.id)?.library, 'absent');
  const site = state.tiles.find(tile => tile.id === 39);
  assert.ok(site);
  assert.equal(district.q, site.q - (state.width - 1) / 2);
  assert.equal(district.r, site.r - (state.height - 1) / 2);
  district.baseProduction.science = 999;
  assert.equal(projectWorld(state).districts?.find(entry => entry.cityId === second.id)?.baseProduction.science, 2);
});

await test('a Library order preserves the completed Campus while the Library is still unbuilt', () => {
  const { state, city } = fixture();
  city.buildings = ['campus']; city.districtSites = { campus: 39 };
  city.construction = { active: { id: 'library-order', cityId: city.id, buildingId: 'library', ruleVersion: 1, startedRound: 3, paid: { materials: 16, credits: 8 }, workDone: 0, workRequired: 8 }, lastCompleted: null };
  const district = projectWorld(state).districts?.[0];
  assert.ok(district);
  assert.equal(district.status, 'built');
  assert.equal(district.library, 'building');
  assert.ok(district.construction && 'buildingId' in district.construction);
  assert.equal(district.construction.buildingId, 'library');
});

await test('old worlds and missing retained sites do not invent districts at a town center', () => {
  const { state, city } = fixture();
  assert.deepEqual(projectWorld(state).districts, []);
  city.buildings = ['campus', 'library'];
  assert.deepEqual(projectWorld(state).districts, []);
  city.districtSites = { campus: 99999 };
  assert.deepEqual(projectWorld(state).districts, []);
});

await test('original district cores distinguish foundation, installed Campus and Library at every bounded LOD', () => {
  const { state, city } = fixture();
  city.buildings = ['campus']; city.districtSites = { campus: 39 };
  const district = projectWorld(state).districts?.[0];
  assert.ok(district);
  const before = structuredClone(district);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const building = districtParts({ ...district, status: 'building' }, detail);
    const built = districtParts(district, detail);
    const library = districtParts({ ...district, library: 'built' }, detail);
    assert.ok(building.some(part => part.id.includes('foundation')));
    assert.ok(building.every(part => !part.id.includes('hall-roof') && !part.id.includes('library')));
    assert.equal(built.filter(part => part.id.includes('hall-roof')).length, 2);
    assert.ok(built.every(part => !part.id.includes('library')));
    assert.ok(library.some(part => part.id.endsWith('library-roof')));
    for (const parts of [building, built, library]) {
      assert.ok(parts.length <= DISTRICT_PART_BUDGETS[detail]);
      assert.equal(new Set(parts.map(part => part.id)).size, parts.length);
      assert.ok(parts.every(part => [...part.position, ...part.scale].every(Number.isFinite)));
      assert.ok(flatSceneFaces(parts).length > 0);
    }
    assert.deepEqual(library, districtParts({ ...district, library: 'built' }, detail));
  }
  assert.equal(districtLabel({ ...district, library: 'building' }), 'Campus · Library building');
  assert.deepEqual(district, before);
});

await test('shared district geometry batches at its exact site and clears only cosmetic terrain', () => {
  const { state, city } = fixture();
  city.buildings = ['campus', 'library']; city.districtSites = { campus: 39 };
  const world = projectWorld(state);
  const before = structuredClone(world);
  const district = world.districts?.[0];
  assert.ok(district);
  const material = new THREE.MeshBasicMaterial();
  const layer = createDistrictMeshes(world, () => material);
  assert.equal(layer.update(60), 'close');
  const meshes = layer.group.children.filter(child => child instanceof THREE.InstancedMesh);
  assert.equal(meshes.reduce((sum, mesh) => sum + mesh.count, 0), districtParts(district, 'close').length);
  assert.ok(meshes.every(mesh => mesh.boundingSphere !== null));
  const landscape = createLandscapeMeshes(world, () => material);
  landscape.update(60);
  const expected = projectLandscape(world.tiles, [...world.cities, ...(world.districts ?? [])], 'close');
  assert.ok(!expected.parts.some(part => part.id.startsWith(`forest:${district.q},${district.r}:`)));
  assert.equal(landscape.group.children.filter(child => child instanceof THREE.InstancedMesh).reduce((sum, mesh) => sum + mesh.count, 0), expected.parts.length);
  assert.deepEqual(world, before);
  layer.dispose(); landscape.dispose(); material.dispose();
  assert.equal(layer.group.children.length, 0);
  assert.equal(landscape.group.children.length, 0);
});

await test('district captions avoid town markers and decline placement when the viewport is crowded', () => {
  const town = { x: 160, y: 90, width: 70, height: 70 };
  const placed = districtCaptionPlacement({ x: 130, y: 130 }, [town], 360, 507, 110);
  assert.ok(placed);
  assert.ok(Math.abs(placed.x - town.x) >= (placed.width + town.width) / 2 + 6 || placed.y >= town.y + town.height + 6 || placed.y + 22 <= town.y);
  assert.equal(districtCaptionPlacement({ x: 130, y: 130 }, [{ x: 180, y: 0, width: 360, height: 507 }], 360, 507, 110), null);
});

await test('worked-site captions use the narrow gap between a header and town without obscuring either', () => {
  const placed = districtCaptionPlacement({ x: 75, y: 205 }, [
    { x: 110, y: 61, width: 200, height: 67 },
    { x: 88, y: 178, width: 80, height: 70 },
    { x: 180, y: 260, width: 360, height: 247 },
  ], 360, 507, 44);
  assert.ok(placed);
  assert.equal(placed.y, 145);
});
