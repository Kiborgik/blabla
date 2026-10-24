import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createDepositMeshes } from '../web/settlement-three.ts';
import { conditionDrainage } from '../core/drainage.ts';
import type { HexTile } from '../core/types.ts';
import { createWorld } from '../core/engine.ts';
import { depositLabel, depositParts, extractionFacts, projectRevealedDeposits } from '../visuals/strategic-resource-visuals.ts';
import { transformedVertices, flatSceneFaces } from '../web/settlement-parts.ts';
import { hexPosition } from '../visuals/landscape.ts';
import { visualDetail } from '../visuals/visual-language.ts';

function syntheticWorld() {
  const state = createWorld(73);
  state.width = 9; state.height = 5;
  state.tiles = Array.from({ length: 45 }, (_, id) => ({ id, q: id % 9, r: Math.floor(id / 9), terrain: 'grassland' as const, elevation: 65 + id % 8, owner: null, resource: null }));
  state.unlockedFeatures.push('finite-metals');
  state.strategicDeposits = { ruleVersion: 1, placementId: 'regional-iron-1', seed: state.seed, tileIds: [11, 12, 20, 16],
    deposits: Object.fromEntries([11, 12, 20, 16].map(tileId => [String(tileId), { tileId, resource: 'iron' as const, initialReserve: 240, remaining: 240 }])) };
  for (const civilization of state.civilizations) civilization.technologies = [];
  state.civilizations[0]!.technologies.push('bronze-working');
  return state;
}

await test('regional outcrops project only revealed retained membership and exact axial adjacency without mutation', () => {
  const state = syntheticWorld(); const before = structuredClone(state);
  const views = projectRevealedDeposits(state);
  assert.deepEqual(views.map(view => view.tileId), [11, 12, 16, 20]);
  assert.deepEqual(views.map(view => [view.tileId, view.regionalIron?.neighbors.map(neighbor => neighbor.tileId)]), [[11, [12, 20]], [12, [11, 20]], [16, []], [20, [11, 12]]]);
  assert.ok(views.every(view => view.id === `deposit:iron:${view.tileId}` && view.revealedTo.length === 1));
  assert.deepEqual(state, before);
  state.strategicDeposits!.deposits['13'] = { tileId: 13, resource: 'iron', initialReserve: 240, remaining: 240 };
  assert.deepEqual(projectRevealedDeposits(state).map(view => view.tileId), [11, 12, 16, 20]);
  state.civilizations[0]!.technologies = [];
  assert.deepEqual(projectRevealedDeposits(state), []);
  state.civilizations[1]!.technologies.push('bronze-working');
  assert.deepEqual(projectRevealedDeposits(state).map(view => view.revealedTo.map(civ => civ.id)), [[1], [1], [1], [1]]);
});

await test('84px regional Iron is bounded low rust-dark broken strata with persistent inert depletion geometry', () => {
  const state = syntheticWorld(); const views = projectRevealedDeposits(state); const before = structuredClone(views);
  assert.equal(visualDetail(84), 'close');
  for (const view of views) for (const [detail, maximum] of [['far', 5], ['mid', 8], ['close', 12]] as const) {
    const parts = depositParts(view, detail);
    assert.ok(parts.length >= 3 && parts.length <= maximum + 2);
    assert.ok(parts.every(part => part.shape !== 'cone'));
    assert.ok(parts.some(part => part.material === 'roof'));
    assert.ok(parts.some(part => part.material === 'timber'));
    assert.ok(parts.every(part => part.id.startsWith(view.id)));
    assert.equal(new Set(parts.map(part => part.id)).size, parts.length);
    assert.ok(transformedVertices(parts[0]!).every(point => point.every(Number.isFinite)));
    assert.ok(Math.max(...parts.flatMap(transformedVertices).map(point => point[1])) <= .24);
    const local = parts.filter(part => !part.id.includes(':join-')).flatMap(transformedVertices);
    assert.ok(local.every(point => Math.abs(point[0]) <= .55 && Math.abs(point[2]) <= .45));
    assert.ok(flatSceneFaces(parts, .72).length > 0);
    const depleted = depositParts({ ...view, remaining: 0 }, detail);
    assert.ok(depleted.length >= 2 && depleted.every(part => part.material !== 'roof'));
    assert.deepEqual(depleted, parts.filter(part => !part.id.includes(':vein-')));
    assert.notDeepEqual(depositParts({ ...view, remaining: 120 }, detail), parts);
    assert.deepEqual(depositParts(view, detail), parts);
  }
  assert.deepEqual(views, before);
  const a = depositParts(views[0]!, 'close').filter(part => !part.id.includes(':join-')).map(({ id: _id, ...part }) => part);
  const b = depositParts(views[1]!, 'close').filter(part => !part.id.includes(':join-')).map(({ id: _id, ...part }) => part);
  assert.notDeepEqual(a, b);
});

await test('regional joining halves meet the same actual shared ground edge and never point across the nonmember gap', () => {
  const views = projectRevealedDeposits(syntheticWorld());
  for (const view of views) {
    const joins = depositParts(view, 'close').filter(part => part.id.includes(':join-'));
    assert.equal(joins.length, view.regionalIron?.neighbors.length);
    for (const neighbor of view.regionalIron!.neighbors) {
      const target = views.find(candidate => candidate.tileId === neighbor.tileId)!;
      const part = joins.find(candidate => candidate.id.endsWith(`:join-${neighbor.tileId}`))!;
      const other = depositParts(target, 'close').find(candidate => candidate.id.endsWith(`:join-${view.tileId}`))!;
      const origin = hexPosition(view.q, view.r); const end = hexPosition(target.q, target.r);
      const midpoint = [(origin.x + end.x) / 2, (origin.z + end.z) / 2];
      const vertex = transformedVertices(part).find(point => Math.abs((point[0] + origin.x - midpoint[0]!) * (end.x - origin.x) + (point[2] + origin.z - midpoint[1]!) * (end.z - origin.z)) < 1e-8);
      assert.ok(vertex);
      assert.ok(Math.abs(Math.sin(part.rotation - other.rotation)) > Math.sin(Math.PI / 15));
      assert.ok(transformedVertices(other).some(point => Math.hypot(point[0] + end.x - vertex[0] - origin.x,
        point[1] + target.height - vertex[1] - view.height, point[2] + end.z - vertex[2] - origin.z) < 1e-10));
      for (const point of transformedVertices(part)) for (let direction = 0; direction < 6; direction++) {
        assert.ok(point[0] * Math.cos(direction * Math.PI / 3) + point[2] * Math.sin(direction * Math.PI / 3) <= Math.sqrt(3) / 2 + 1e-10);
      }
      assert.ok(Math.abs(view.height + part.position[1] + part.scale[1] / 2 - target.height - other.position[1] - other.scale[1] / 2) < 1e-10);
    }
  }
  assert.equal(depositParts(views.find(view => view.tileId === 16)!, 'close').filter(part => part.id.includes(':join-')).length, 0);
  const widths = views.flatMap(view => depositParts(view, 'close').filter(part => part.id.includes(':join-')).map(part => part.scale[2]));
  assert.ok(new Set(widths).size > 2);
});

await test('old registered Iron and Coal keep their original parts and accessible reserve labels', () => {
  for (const resource of ['iron', 'coal'] as const) {
    const view = { id: `deposit:${resource}:11`, tileId: 11, resource, initialReserve: 240, remaining: 238, q: 0, r: 0, height: .4, revealedTo: [] };
    for (const [detail, count] of [['far', 2], ['mid', 3], ['close', 4]] as const) {
      const parts = depositParts(view, detail);
      assert.equal(parts.length, count);
      assert.ok(parts.every(part => part.shape === 'cone' && part.material === 'metal'));
    }
    assert.equal(depositLabel(view), `${resource === 'iron' ? 'Iron' : 'Coal'} · Tile 11 · 238 / 240 left`);
  }
  const state = syntheticWorld(); state.strategicDeposits!.placementId = 'iron-placement-1';
  assert.ok(projectRevealedDeposits(state).every(view => view.regionalIron === undefined));
});

await test('reserve geometry never invents production and exact historical extraction keeps storage-full distinct', () => {
  const view = projectRevealedDeposits(syntheticWorld())[0]!;
  const before = structuredClone(view);
  const result = { ruleVersion: 1 as const, tileId: view.tileId, round: 4, resource: 'iron' as const, quantity: 2, reserveBefore: 240, reserveAfter: 238, stockBefore: 0, stockAfter: 2, capacity: 80, status: 'extracted' as const };
  assert.match(extractionFacts(result).join(' '), /Extracted 2 Iron.*240 → 238.*Historical extraction/);
  assert.match(extractionFacts({ ...result, status: 'storage-full', quantity: 0, reserveAfter: 240, stockBefore: 80, stockAfter: 80 }).join(' '), /No Iron extracted · Storage full.*240 → 240/);
  assert.ok(depositParts(view, 'close').every(part => !/work|output|operat|glow/.test(part.id)));
  assert.deepEqual(view, before);
});

await test('actual retained drainage cuts remain open beneath regional outcrops and suppress water-crossing joins', () => {
  const state = syntheticWorld(); state.width = 11; state.height = 19;
  const tiles: HexTile[] = Array.from({ length: 209 }, (_, id) => {
    const q = id % 11; const r = Math.floor(id / 11);
    return { id, q, r, terrain: q === 10 ? 'ocean' : 'grassland', elevation: q === 10 ? 5 : 70 - q + Math.abs(r - 9) * 2, owner: null, resource: null };
  });
  const retained = conditionDrainage(tiles, 11, 19); assert.ok(retained);
  state.tiles = retained.tiles; state.drainage = retained.drainage;
  state.strategicDeposits!.tileIds = [101, 102, 103];
  state.strategicDeposits!.deposits = Object.fromEntries([101, 102, 103].map(tileId => [String(tileId), { tileId, resource: 'iron' as const, initialReserve: 240, remaining: 240 }]));
  const before = structuredClone(state); const views = projectRevealedDeposits(state);
  for (const view of views) {
    assert.ok(view.regionalIron!.surface.faces.some(face => face.kind === 'channel'));
    assert.ok(view.regionalIron!.neighbors.every(neighbor => neighbor.join === null));
    const parts = depositParts(view, 'close');
    assert.ok(parts.length > 0 && parts.every(part => !part.id.includes(':join-')));
    const origin = hexPosition(view.q, view.r);
    for (const part of parts) {
      const vertices = transformedVertices(part);
      const center = { x: origin.x + part.position[0], z: origin.z + part.position[2] };
      assert.ok(Math.abs(center.z) > .1);
      assert.ok(vertices.every(point => Math.abs(point[2] + origin.z) > .075));
    }
  }
  assert.deepEqual(state, before);
});

await test('flat faces and Three batches consume the same bounded regional recipes at normal84px without changing identities', () => {
  const views = projectRevealedDeposits(syntheticWorld());
  const materials: THREE.MeshBasicMaterial[] = [];
  const renderer = createDepositMeshes({ tiles: [], cities: [], routes: [], deposits: views }, color => {
    const material = new THREE.MeshBasicMaterial({ color }); materials.push(material); return material;
  });
  try {
    assert.equal(renderer.update(84), 'close');
    const parts = views.flatMap(view => depositParts(view, 'close'));
    assert.equal(renderer.group.children.reduce((sum, mesh) => sum + (mesh as THREE.InstancedMesh).count, 0), parts.length);
    assert.ok(renderer.group.children.every(mesh => mesh instanceof THREE.InstancedMesh));
    assert.ok(flatSceneFaces(parts, .72).every(face => Number.isFinite(face.depth)));
    assert.deepEqual(views.map(view => view.id), ['deposit:iron:11', 'deposit:iron:12', 'deposit:iron:16', 'deposit:iron:20']);
  } finally { renderer.dispose(); for (const material of materials) material.dispose(); }
});
