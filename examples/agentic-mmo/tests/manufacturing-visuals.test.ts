import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import { BUILDINGS } from '../core/content.ts';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import { districtAdjacencyFacts } from '../core/simulation/districts.ts';
import { projectWorld } from '../web/live-world.ts';
import { capabilityTreeNodes } from '../web/capability-tree.ts';
import { districtLabel, districtParts, DISTRICT_PART_BUDGETS } from '../visuals/district-visuals.ts';
import { placeSiteMarks, SITE_MARK_PATHS } from '../visuals/strategic-resource-visuals.ts';
import * as THREE from 'three';
import { createDistrictMeshes } from '../web/settlement-three.ts';
import { operationVisual } from '../visuals/operation-visuals.ts';

function fixture() {
  const state = createWorld(1701);
  state.unlockedFeatures.push('district-planning', 'worked-land', 'manufacturing');
  const city = state.cities[0]; assert.ok(city);
  city.buildings = ['campus', 'industrial-zone'];
  city.districtSites = { campus: 39, 'industrial-zone': 57 };
  city.improvements = { '58': { improvementId: 'mine', tileId: 58,
    completion: { orderId: 'fixture-mine', cityId: city.id, kind: 'improvement', improvementId: 'mine', tileId: 58, startedRound: 1, completedRound: 3, paid: { materials: 6, credits: 3 }, workRequired: 4, eventId: '3:1' },
    operation: { enabled: false, lastResult: null } } };
  return { state, city };
}

await test('Industrial zone keeps canonical completed Mine adjacency and exact site, including paused infrastructure', () => {
  const { state, city } = fixture(); const before = structuredClone(state);
  const definition = BUILDINGS.find(item => item.id === 'industrial-zone'); assert.ok(definition);
  const canonical = districtAdjacencyFacts(state, definition, 57); assert.ok(canonical);
  assert.deepEqual(canonical.tileIds, [58]);
  const district = projectWorld(state).districts?.find(item => item.buildingId === definition.id); assert.ok(district);
  assert.equal(district.tileId, 57); assert.equal(district.cityId, city.id);
  assert.deepEqual(district.adjacency, canonical);
  assert.equal(district.baseProduction.materials, 3);
  assert.deepEqual(state, before);
  district.adjacency?.tileIds.push(999);
  assert.deepEqual(districtAdjacencyFacts(state, definition, 57)?.tileIds, [58]);
});

await test('Industrial and Guild cores survive every LOD while unfinished foundations imply no installed roof', () => {
  const { state, city } = fixture(); city.buildings.push('guild-workshop');
  const district = projectWorld(state).districts?.find(item => item.buildingId === 'industrial-zone'); assert.ok(district);
  assert.match(districtLabel(district), /Industrial zone.*Guild workshop/);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const parts = districtParts(district, detail);
    assert.ok(parts.some(part => part.id.endsWith('industrial-chimney')));
    assert.ok(parts.some(part => part.id.endsWith('guild-roof')));
    assert.ok(parts.every(part => !/hall-roof|commerce-court/.test(part.id)));
    assert.ok(parts.length <= DISTRICT_PART_BUDGETS[detail]);
    assert.equal(new Set(parts.map(part => part.id)).size, parts.length);
    const foundation = districtParts({ ...district, status: 'building', attachments: [] }, detail);
    assert.ok(foundation.some(part => part.id.includes('foundation')));
    assert.ok(foundation.every(part => !/industrial-roof|guild-roof|chimney/.test(part.id)));
  }
});

await test('Guild construction attaches only to its own completed Industrial zone', () => {
  const { state, city } = fixture();
  city.construction = { active: { id: 'fixture-guild', cityId: city.id, buildingId: 'guild-workshop', ruleVersion: 1, startedRound: 4, paid: { materials: 26, credits: 12 }, workDone: 2, workRequired: 12 }, lastCompleted: null };
  const world = projectWorld(state); const district = world.districts?.find(item => item.buildingId === 'industrial-zone'); assert.ok(district);
  assert.equal(district.status, 'built'); assert.match(districtLabel(district), /Guild workshop building/);
  assert.ok(districtParts(district, 'far').some(part => part.id.endsWith('guild-foundation')));
  assert.ok(districtParts(district, 'close').every(part => !part.id.endsWith('guild-roof')));
  assert.ok(world.districts?.find(item => item.buildingId === 'campus')?.attachments?.every(item => item.buildingId !== 'guild-workshop'));
});

await test('the canonical tree labels completed Mine bonus as base potential instead of terrain or actual output', () => {
  const { state, city } = fixture();
  const nodes = capabilityTreeNodes({ runId: 'synthetic-manufacturing', civilizationName: 'Aster', towns: [{ id: city.id, name: city.name }], catalogue: capabilityCatalogue(), projection: projectCapabilities(state, 0, city.id, '2026-10-16T22:00:00Z') });
  const zone = nodes.find(item => item.id === 'building:industrial-zone'); assert.ok(zone);
  assert.ok(zone.facts.some(fact => /Completed nearby Mines/.test(fact.label) && /58/.test(fact.value)));
  assert.ok(zone.facts.some(fact => /Mine bonus/.test(fact.label) && /1 Materials/.test(fact.value)));
  assert.ok(zone.facts.some(fact => /Site base with nearby Mines/.test(fact.label) && /3 Materials/.test(fact.value)));
  assert.ok(zone.facts.every(fact => !/nearby terrain/.test(fact.label)));
  const guild = nodes.find(item => item.id === 'building:guild-workshop'); assert.ok(guild);
  assert.ok(guild.facts.some(fact => fact.label === 'Belongs to' && /Industrial zone.*57/.test(fact.value)));
});

await test('dense selected-town marks reserve distinct site families before repeated Mines within bounded targets', () => {
  const anchors = [
    { id: 'mine-1', cityId: 'selected', family: 'mine', x: 180, y: 220 },
    { id: 'mine-2', cityId: 'selected', family: 'mine', x: 180, y: 220 },
    { id: 'campus', cityId: 'selected', family: 'campus', x: 180, y: 220 },
    { id: 'commerce', cityId: 'selected', family: 'commerce', x: 180, y: 220 },
    { id: 'industry', cityId: 'selected', family: 'industry', x: 180, y: 220 },
  ];
  const blocked = [{ x: 180, y: 185, width: 100, height: 70 }];
  const placed = placeSiteMarks(anchors, blocked, 360, 507, 'selected');
  assert.deepEqual(placed.slice(0, 4).map(mark => mark.id), ['mine-1', 'campus', 'commerce', 'industry']);
  assert.ok(placed.length <= 12);
  for (const mark of placed) {
    assert.equal(mark.width, 44); assert.equal(mark.height, 44);
    assert.ok(mark.x >= 22 && mark.x <= 338 && mark.y >= 22 && mark.y <= 485);
    assert.ok(Math.abs(mark.x - 180) <= 120 && Math.abs(mark.y - 220) <= 120);
    for (const other of placed) if (other.id !== mark.id) assert.ok(Math.abs(mark.x - other.x) >= 44 || Math.abs(mark.y - other.y) >= 44);
  }
  assert.deepEqual(placeSiteMarks(anchors, blocked, 360, 507, 'selected'), placed);
  assert.ok('industry' in SITE_MARK_PATHS);
});

await test('Guild current pause never rewrites its paid and resident-supported historical output', () => {
  const receipt = { round: 8, status: 'operated' as const, paid: { energy: 2 }, produced: { materials: 7.8 }, shortages: [], residents: { ruleVersion: 1 as const, openingPopulation: 15, communityReserve: 3, required: 3, available: 6, allocated: 3 } };
  const view = operationVisual({ enabled: false, lastResult: receipt });
  assert.equal(view.current, 'Paused'); assert.equal(view.last?.residents?.allocated, 3);
  assert.deepEqual(view.last?.paid, [{ resource: 'energy', label: 'Energy', amount: 2 }]);
  assert.deepEqual(view.last?.produced, [{ resource: 'materials', label: 'Materials', amount: 7.8 }]);
  assert.equal(operationVisual({ enabled: true, lastResult: null }).last, null);
});

await test('Industrial geometry uses the shared instance lifecycle and absent Guild adds no ornamental annex', () => {
  const { state } = fixture(); const world = projectWorld(state);
  const district = world.districts?.find(item => item.buildingId === 'industrial-zone'); assert.ok(district);
  assert.ok(districtParts(district, 'close').every(part => !part.id.includes('guild')));
  const material = new THREE.MeshBasicMaterial();
  const layer = createDistrictMeshes(world, () => material);
  layer.update(60);
  const count = layer.group.children.reduce((sum, child) => sum + (child instanceof THREE.InstancedMesh ? child.count : 0), 0);
  assert.equal(count, world.districts?.reduce((sum, item) => sum + districtParts(item, 'close').length, 0));
  layer.dispose(); material.dispose(); assert.equal(layer.group.children.length, 0);
});
