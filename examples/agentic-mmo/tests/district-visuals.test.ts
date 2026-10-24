import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import { projectWorld } from '../web/live-world.ts';
import { districtCaptionPlacement, districtParts, districtLabel, districtLandmarks, DISTRICT_PART_BUDGETS } from '../visuals/district-visuals.ts';
import type { DistrictView } from '../visuals/district-visuals.ts';
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
  assert.equal(layer.update(110), 'close');
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

await test('late industrial and scientific landmarks summarize exact installed attachments at their actual district', () => {
  const { state, city } = fixture();
  city.buildings = ['campus', 'library', 'university', 'observatory', 'research-lab', 'industrial-zone', 'guild-workshop', 'foundry', 'coal-plant', 'factory'];
  city.districtSites = { campus: 39, 'industrial-zone': 56 };
  const world = projectWorld(state);
  const industrial = world.districts?.find(district => district.buildingId === 'industrial-zone');
  const campus = world.districts?.find(district => district.buildingId === 'campus');
  assert.ok(industrial && campus);
  assert.equal(industrial.tileId, 56);
  assert.equal(campus.tileId, 39);
  const installedDistricts: readonly DistrictView[] = [industrial, campus];
  for (const detail of ['far', 'mid', 'close'] as const) {
    for (const districtView of installedDistricts) {
      const parts = districtParts(districtView, detail);
      assert.ok(parts.length <= DISTRICT_PART_BUDGETS[detail]);
      assert.equal(new Set(parts.map(part => part.id)).size, parts.length);
      assert.ok(parts.every(part => [...part.position, ...part.scale, part.rotation].every(Number.isFinite)));
      assert.deepEqual(districtParts({ ...districtView, attachments: districtView.attachments?.toReversed() ?? [] }, detail), parts);
    }
    for (const id of ['coal-plant-stack', 'factory-roof']) assert.ok(districtParts(industrial, detail).some(part => part.id.endsWith(`:${id}`)), `${detail}: ${id}`);
    assert.ok(districtParts(campus, detail).some(part => part.id.endsWith(':observatory-crown')));
    const represented = districtLandmarks(campus, detail);
    assert.equal(represented.length, detail === 'far' ? 1 : detail === 'mid' ? 2 : 4);
    for (const [building, part] of [['research-lab', 'research-lab-block'], ['library', 'library-roof'], ['university', 'university-roof']] as const) {
      assert.equal(districtParts(campus, detail).some(entry => entry.id.endsWith(`:${part}`)), represented.includes(building));
    }
  }
});

await test('paid power buildings under construction have open frames, never completed plant or laboratory silhouettes', () => {
  const { state, city } = fixture();
  city.buildings = ['campus', 'industrial-zone'];
  city.districtSites = { campus: 39, 'industrial-zone': 56 };
  for (const buildingId of ['coal-plant', 'factory', 'research-lab']) {
    city.construction = { active: { id: `build-${buildingId}`, cityId: city.id, buildingId, ruleVersion: 1, startedRound: 3, paid: { materials: 40 }, workDone: 5, workRequired: 18 }, lastCompleted: null };
    const district = projectWorld(state).districts?.find(value => value.attachments?.some(attachment => attachment.buildingId === buildingId));
    assert.ok(district);
    for (const detail of ['far', 'mid', 'close'] as const) {
      const parts = districtParts(district, detail);
      assert.ok(parts.some(part => part.id.endsWith(`${buildingId}-foundation`)));
      assert.ok(parts.some(part => part.id.endsWith(`${buildingId}-frame`)));
      assert.ok(!parts.some(part => part.id.endsWith('coal-plant-stack') || part.id.endsWith('factory-roof') || part.id.endsWith('research-lab-block')));
      assert.ok(parts.length <= DISTRICT_PART_BUDGETS[detail]);
    }
  }
});

await test('district smoke and powered work require fresh enabled successful receipts, not an old productive beat', () => {
  const { state, city } = fixture();
  city.buildings = ['industrial-zone', 'coal-plant', 'factory'];
  city.districtSites = { 'industrial-zone': 56 };
  const district = projectWorld(state).districts?.[0];
  assert.ok(district);
  const result = { round: 8, status: 'operated' as const, paid: {}, produced: {}, shortages: [], localPower: { ruleVersion: 1 as const, required: 0, availableBefore: 0, consumed: 0, generated: 8, shortage: 0 } };
  const active = { ...district, round: 8, terminal: false, buildingOperations: { 'coal-plant': { enabled: true, lastResult: result }, factory: { enabled: true, lastResult: { ...result, produced: { materials: 12 }, localPower: { ...result.localPower, generated: 0, consumed: 3, required: 3, availableBefore: 8 } } } } };
  const fresh = districtParts(active, 'close');
  assert.ok(fresh.some(part => part.id.endsWith('operation:coal-plant:smoke')));
  assert.ok(fresh.some(part => part.id.endsWith('operation:factory:power')));
  for (const context of [
    { ...active, round: 9 }, { ...active, terminal: true }, { ...district, buildingOperations: active.buildingOperations },
    { ...active, buildingOperations: { 'coal-plant': { enabled: false, lastResult: result } } },
    { ...active, buildingOperations: { 'coal-plant': { enabled: true, lastResult: { ...result, status: 'blocked' as const, strategicShortages: [{ resource: 'coal' as const, required: 2, available: 0 }] } } } },
  ]) assert.ok(!districtParts(context, 'close').some(part => part.id.includes('operation:')));
});
