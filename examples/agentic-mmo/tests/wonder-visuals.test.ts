import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createWorld } from '../core/engine.ts';
import type { WonderConstructionOrder, WonderCompletion } from '../core/types.ts';
import { projectWorld } from '../web/live-world.ts';
import { createWonderMeshes } from '../web/settlement-three.ts';
import { projectWonderSites, townDevelopmentFacts, wonderWorkRows } from '../visuals/wonder-visuals.ts';
import { greatLibraryVisual, WONDER_PART_BUDGETS } from '../visuals/wonder-landmark.ts';

function fixture() {
  const state = createWorld(1701); const city = state.cities[0]; assert.ok(city);
  state.unlockedFeatures.push('unique-wonders');
  const order: WonderConstructionOrder = { kind: 'wonder', ruleVersion: 1, id: 'synthetic-contender', wonderId: 'great-library', cityId: city.id, tileId: 40, startedRound: 1, paid: { materials: 50, credits: 25 }, workDone: 0, workRequired: 24 };
  city.construction = { active: order, lastCompleted: null };
  return { state, city, order };
}
function finish() {
  const sample = fixture();
  const completion: WonderCompletion = { kind: 'wonder', ruleVersion: 1, wonderId: sample.order.wonderId, orderId: sample.order.id, civId: sample.city.civId, cityId: sample.city.id, tileId: 40, startedRound: 1, completedRound: 9, paid: { ...sample.order.paid }, workRequired: 24, eventId: 'synthetic-completion' };
  sample.city.construction = { active: null, lastCompleted: completion };
  sample.state.wonders = { 'great-library': { ruleVersion: 1, completion, losses: [], boostLimit: 2, boostPercent: 20, boosts: [] } };
  return { ...sample, completion };
}
await test('exact retained contender site is detached and 100% work still has no completed crown', () => {
  const { state, order } = fixture(); order.workDone = order.workRequired; const before = structuredClone(state);
  const site = projectWonderSites(state)[0]; assert.ok(site);
  assert.equal(site.tileId, 40); assert.equal(site.status, 'building'); assert.equal(site.record.orderId, order.id);
  assert.equal(greatLibraryVisual(site.record, 'far').stage, 'finishing');
  assert.deepEqual(state, before);
  if (site.record.status === 'building') site.record.workDone = 0;
  assert.equal(order.workDone, 24);
});
await test('explicit winner alone creates the completed world landmark and losing history stays off the map', () => {
  const { state, city, completion } = finish(); const rival = state.cities[1]; assert.ok(rival);
  state.wonders?.['great-library']?.losses.push({ ruleVersion: 1, wonderId: 'great-library', orderId: 'synthetic-loser', civId: rival.civId, cityId: rival.id, tileId: 31, startedRound: 1, paid: { materials: 50, credits: 25 }, workRequired: 24, workDone: 23.1, refund: { materials: 25 }, resolvedRound: 9, winnerOrderId: completion.orderId, eventId: 'synthetic-loss' });
  const sites = projectWorld(state).wonders ?? []; assert.equal(sites.length, 1); const site = sites[0]; assert.ok(site);
  assert.equal(site.cityId, city.id); assert.equal(site.tileId, 40); assert.equal(site.status, 'built');
  assert.equal(greatLibraryVisual(site.record, 'far').stage, 'complete');
  const loss = wonderWorkRows(townDevelopmentFacts(state, rival.id).wonders, rival.id)[0]; assert.ok(loss && loss.kind === 'lost'); assert.deepEqual(loss.receipt.refund, { materials: 25 });
});
await test('missing exact town or site is omitted rather than moved to a capital', () => {
  const { state, order } = fixture(); order.tileId = -1; assert.deepEqual(projectWonderSites(state), []);
  order.tileId = 40; order.cityId = 'missing-town'; assert.deepEqual(projectWonderSites(state), []);
});
await test('both render adapters share finite bounded winner parts at every LOD with lifecycle cleanup', () => {
  const { state } = finish(); const world = projectWorld(state); const site = world.wonders?.[0]; assert.ok(site);
  for (const detail of ['far', 'mid', 'close'] as const) { const visual = greatLibraryVisual(site.record, detail); assert.ok(visual.parts.length <= WONDER_PART_BUDGETS[detail]); assert.ok(visual.parts.every(part => [...part.position, ...part.scale, part.rotation].every(Number.isFinite))); }
  const materials: THREE.Material[] = []; const meshes = createWonderMeshes(world, color => { const material = new THREE.MeshBasicMaterial({ color }); materials.push(material); return material; });
  meshes.update(20); assert.ok(meshes.group.children.length > 0); meshes.update(80); meshes.dispose(); assert.equal(meshes.group.children.length, 0); for (const material of materials) material.dispose();
});
await test('winner Work keeps unused charges and actual boost receipts separate from current eligibility', () => {
  const { state, city } = finish(); const facts = townDevelopmentFacts(state, city.id); const row = wonderWorkRows(facts.wonders, city.id)[0]; assert.ok(row && row.kind === 'completed');
  assert.equal(row.facts.boost.remaining, 2); assert.equal(row.facts.completed?.boosts.length, 0); assert.equal(row.facts.boost.quote, null); assert.ok(row.facts.boost.blocker);
});
