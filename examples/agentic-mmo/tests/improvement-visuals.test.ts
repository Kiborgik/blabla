import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createImprovementMeshes } from '../web/settlement-three.ts';
import { createWorld } from '../core/engine.ts';
import { improvementParts, improvementLastLabel, IMPROVEMENT_PART_BUDGETS } from '../visuals/improvement-visuals.ts';
import { projectWorld } from '../web/live-world.ts';

function fixture() {
  const state = createWorld(1701);
  const city = state.cities[0];
  assert.ok(city);
  const completion = { kind: 'improvement' as const, orderId: 'mine-56', cityId: city.id, improvementId: 'mine', tileId: 56, startedRound: 2, completedRound: 4, paid: { materials: 6, credits: 3 }, workRequired: 4, eventId: 'fixture:4' };
  return { state, city, completion };
}

await test('an active Mine keeps its exact reserved site and paid work without installation or output', () => {
  const { state, city } = fixture();
  Object.assign(city, { construction: { active: { kind: 'improvement', id: 'mine-56', cityId: city.id, improvementId: 'mine', tileId: 56, ruleVersion: 1, startedRound: 2, paid: { materials: 6, credits: 3 }, workRequired: 4, workDone: 1 }, lastCompleted: null } });
  const before = structuredClone(state);
  const view = projectWorld(state).improvements?.[0];
  assert.ok(view);
  assert.equal(view.tileId, 56);
  assert.equal(view.cityId, city.id);
  assert.equal(view.status, 'building');
  assert.equal(view.operation, null);
  assert.equal(view.construction?.workDone, 1);
  assert.deepEqual(state, before);
});

await test('installed Mines retain numeric site order, exact town identity and detached receipts through pause', () => {
  const { state, city, completion } = fixture();
  const operation = { enabled: false, lastResult: { round: 5, status: 'operated', paid: {}, produced: { materials: 2.4 }, residents: { ruleVersion: 1, openingPopulation: 12, communityReserve: 3, required: 1, available: 3, allocated: 1 }, blockedReason: null } };
  Object.assign(city, { improvements: { '58': { improvementId: 'mine', tileId: 58, completion: { ...completion, tileId: 58, orderId: 'mine-58' }, operation: { enabled: true, lastResult: null } }, '56': { improvementId: 'mine', tileId: 56, completion, operation } } });
  const before = structuredClone(state);
  const views = projectWorld(state).improvements;
  assert.ok(views);
  assert.deepEqual(views.map(view => view.tileId), [56, 58]);
  assert.equal(new Set(views.map(view => view.id)).size, 2);
  const first = views[0]; assert.ok(first);
  assert.equal(first.status, 'built');
  assert.equal(first.operation?.enabled, false);
  assert.equal(first.operation?.lastResult?.produced.materials, 2.4);
  assert.equal(first.completion?.orderId, 'mine-56');
  assert.deepEqual(state, before);
  if (first.operation?.lastResult) first.operation.lastResult.produced.materials = 99;
  assert.deepEqual(state, before);
});

await test('missing retained tiles and older worlds never place a Mine at the town center', () => {
  const { state, city, completion } = fixture();
  assert.deepEqual(projectWorld(state).improvements, []);
  Object.assign(city, { improvements: { '9999': { improvementId: 'mine', tileId: 9999, completion: { ...completion, tileId: 9999 }, operation: { enabled: true, lastResult: null } } } });
  assert.deepEqual(projectWorld(state).improvements, []);
});

await test('Mine geometry keeps installed land through pause and distinguishes reservation at every bounded level', () => {
  const { state, city, completion } = fixture();
  Object.assign(city, { improvements: { '56': { improvementId: 'mine', tileId: 56, completion, operation: { enabled: true, lastResult: null } } } });
  const view = projectWorld(state).improvements?.[0]; assert.ok(view);
  const before = structuredClone(view);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const installed = improvementParts(view, detail);
    assert.ok(installed.some(part => part.id.endsWith(':opening')));
    assert.ok(installed.some(part => part.id.endsWith(':spoil')));
    assert.ok(installed.length <= IMPROVEMENT_PART_BUDGETS[detail]);
    assert.deepEqual(installed, improvementParts({ ...view, operation: { enabled: false, lastResult: null } }, detail));
    const active = improvementParts({ ...view, status: 'building', operation: null }, detail);
    assert.ok(active.some(part => part.id.includes('survey-frame')));
    assert.ok(active.every(part => !part.id.endsWith(':opening') && !part.id.endsWith(':spoil')));
  }
  assert.deepEqual(view, before);
});

await test('historical staffing, pause and zero output are named without claiming current production', () => {
  const base = { round: 5, status: 'blocked' as const, paid: {}, produced: {}, residents: { ruleVersion: 1 as const, openingPopulation: 3, communityReserve: 3, required: 1, available: 0, allocated: 0 }, blockedReason: 'resident-shortage' as const };
  assert.equal(improvementLastLabel(null), 'No operating record yet');
  assert.equal(improvementLastLabel(base), 'Not enough local support');
  assert.equal(improvementLastLabel({ ...base, status: 'paused', blockedReason: null }), 'Paused that season');
  assert.equal(improvementLastLabel({ ...base, status: 'operated', blockedReason: null }), 'Worked with no output');
  assert.equal(improvementLastLabel({ ...base, status: 'operated', blockedReason: null, produced: { materials: 2.4 } }), 'Materials made');
});

await test('frontier Mine instances batch at retained sites and never attach to the civilization capital', () => {
  const { state, city, completion } = fixture();
  const frontier = { ...structuredClone(city), id: 'frontier', name: 'Frontier', tileId: 58, improvements: { '56': { improvementId: 'mine', tileId: 56, completion: { ...completion, cityId: 'frontier' }, operation: { enabled: true, lastResult: null } } } };
  state.cities.push(frontier);
  const world = projectWorld(state);
  const view = world.improvements?.[0]; assert.ok(view);
  assert.equal(view.cityId, 'frontier');
  assert.equal(view.townName, 'Frontier');
  const tile = state.tiles.find(candidate => candidate.id === 56); assert.ok(tile);
  assert.equal(view.q, tile.q - (state.width - 1) / 2);
  assert.equal(view.r, tile.r - (state.height - 1) / 2);
  const before = structuredClone(world);
  const material = new THREE.MeshBasicMaterial();
  const meshes = createImprovementMeshes(world, () => material);
  meshes.update(60);
  const instances = meshes.group.children.filter(child => child instanceof THREE.InstancedMesh);
  assert.equal(instances.reduce((sum, mesh) => sum + mesh.count, 0), improvementParts(view, 'close').length);
  assert.ok(instances.every(mesh => mesh.boundingSphere !== null));
  assert.deepEqual(world, before);
  meshes.dispose(); material.dispose();
  assert.equal(meshes.group.children.length, 0);
});
