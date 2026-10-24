import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import type { GameEvent, WorldState } from '../core/types.ts';
import { borderClashCues, borderPartyAnchor, borderPartyParts, borderPartyWorldParts, borderTargetOutline, projectBorderIncidents, projectBorderParties } from '../visuals/border-visuals.ts';
import { hexPosition } from '../visuals/landscape.ts';
import { createBorderPartyMeshes, createBorderTargetMeshes } from '../web/renderer.ts';
import { borderAction, borderBeat, dispatchBorder, syntheticBorderCorridor } from './fixtures/border-current.ts';

function departed(people: 2 | 3 = 3): WorldState {
  const state = syntheticBorderCorridor();
  dispatchBorder(state, people);
  return state;
}

function resolved(response: 'defend' | 'yield'): { state: WorldState; events: GameEvent[] } {
  const state = departed(); const id = state.border!.active[0]!.id;
  borderAction(state, 1, response === 'defend' ? { type: 'respond-border', incidentId: id, response, sourceCityId: 'city-1', people: 2 } : { type: 'respond-border', incidentId: id, response });
  const events: GameEvent[] = [];
  while (!state.border!.active[0]?.resolution && state.round < 8) events.push(...borderBeat(state));
  assert.ok(state.border!.active[0]?.resolution);
  return { state, events };
}

await test('border departure projects only the authoritative committed tile, detached receipts and no inferred travel', () => {
  const state = departed(); const before = structuredClone(state);
  const views = projectBorderIncidents(state); const marker = projectBorderParties(views)[0]!;
  const source = state.tiles.find(tile => tile.id === marker.party.departure.sourceTileId)!;
  assert.equal(marker.point.tileId, source.id);
  assert.equal(marker.point.q, source.q - (state.width - 1) / 2);
  assert.equal(marker.point.r, source.r - (state.height - 1) / 2);
  assert.equal(marker.party.steps.length, 0);
  assert.deepEqual(marker.displayOffset, { x: 0, z: 0 });
  assert.deepEqual(borderPartyAnchor(marker), { ...hexPosition(marker.point.q, marker.point.r), height: marker.point.height });
  views[0]!.incident.initiator.departure.pathTileIds.push(999999);
  views[0]!.purchase!.paid.credits = -1;
  assert.deepEqual(state, before);
});

await test('a committed step moves the projection once and holding retains the actual residents', () => {
  const state = departed(); const first = projectBorderParties(projectBorderIncidents(state))[0]!;
  borderBeat(state);
  const moved = projectBorderParties(projectBorderIncidents(state))[0]!;
  assert.notEqual(moved.point.tileId, first.point.tileId);
  assert.equal(moved.point.tileId, moved.party.steps.at(-1)!.toTileId);
  assert.deepEqual(projectBorderParties(projectBorderIncidents(state)), projectBorderParties(projectBorderIncidents(state)));
  while (state.border!.active[0]!.initiator.phase !== 'holding' && state.round < 4) borderBeat(state);
  const held = projectBorderParties(projectBorderIncidents(state))[0]!;
  assert.equal(held.party.phase, 'holding');
  assert.equal(borderPartyParts(held, 'mid').filter(part => part.id.endsWith(':head')).length, held.party.people);
});

await test('each actual resident has an identity tunic and neutral head within strict shared detail budgets', () => {
  for (const people of [2, 3] as const) {
    const party = projectBorderParties(projectBorderIncidents(departed(people)))[0]!;
    assert.deepEqual(borderPartyParts(party, 'far'), []);
    for (const detail of ['mid', 'close'] as const) {
      const parts = borderPartyParts(party, detail);
      assert.ok(parts.length <= (detail === 'mid' ? 8 : 12));
      assert.equal(parts.filter(part => part.id.endsWith(':head') && part.material === 'neutral').length, people);
      assert.equal(parts.filter(part => part.id.endsWith(':tunic') && part.material === 'identity').length, people);
      assert.equal(parts.filter(part => part.id.endsWith(':standard-pole')).length, 1);
      assert.equal(parts.filter(part => part.id.endsWith(':standard-cloth')).length, 1);
      assert.ok(parts.every(part => part.position.every(Number.isFinite) && part.scale.every(value => value > 0)));
    }
  }
});

await test('synthetic crowded projection is deterministic and symmetric without changing authoritative tiles; it is not admission evidence', () => {
  const base = projectBorderIncidents(departed())[0]!;
  for (const count of [2, 3, 5]) {
    const views = Array.from({ length: count }, (_, index) => {
      const view = structuredClone(base); view.incident.id = `synthetic-crowd:${index}`;
      for (const party of view.parties) { party.incidentId = view.incident.id; party.party.id = `${view.incident.id}:initiator`; }
      return view;
    });
    const before = structuredClone(views); const markers = projectBorderParties(views);
    assert.deepEqual(markers, projectBorderParties(views.toReversed()));
    assert.equal(new Set(markers.map(marker => JSON.stringify(marker.displayOffset))).size, count);
    for (const axis of ['x', 'z'] as const) assert.ok(Math.abs(markers.reduce((sum, marker) => sum + marker.displayOffset[axis], 0)) < 1e-12);
    for (const marker of markers) {
      assert.deepEqual(marker.point, base.parties[0]!.point);
      assert.ok(Math.hypot(marker.displayOffset.x, marker.displayOffset.z) <= .361);
      for (const part of borderPartyParts(marker, 'close')) assert.ok(Math.hypot(marker.displayOffset.x + part.position[0], marker.displayOffset.z + part.position[2]) + Math.hypot(part.scale[0], part.scale[2]) / 2 < .87);
    }
    assert.deepEqual(views, before);
  }
});

await test('active rows win duplicate historical entries, use stable ordering and omit missing geometry rather than guess', () => {
  const state = departed(); const incident = state.border!.active[0]!;
  state.border!.lastResults.push({ incident: { ...structuredClone(incident), openedRound: 100 }, completedRound: 100, eventId: 'synthetic:duplicate' });
  const other = structuredClone(incident); other.id = 'synthetic:older'; other.openedRound--;
  state.border!.active.push(other);
  assert.deepEqual(projectBorderIncidents(state).map(row => row.incident.id), [incident.id, other.id]);
  state.border!.active.reverse();
  assert.deepEqual(projectBorderIncidents(state).map(row => row.incident.id), [incident.id, other.id]);
  state.tiles = state.tiles.filter(tile => tile.id !== incident.initiator.positionTileId);
  assert.equal(projectBorderParties(projectBorderIncidents(state)).length, 0);
  assert.equal(projectBorderIncidents(state)[0]!.parties[0]!.point, null);
});

await test('current control and immutable paid acquisition remain separate after a real yielded resolution', () => {
  const { state } = resolved('yield'); const view = projectBorderIncidents(state)[0]!;
  assert.equal(view.currentController?.id, 0);
  assert.equal(view.purchase?.civId, 1);
  assert.deepEqual(view.purchase, state.tileAcquisitions![String(view.incident.tileId)]);
  assert.deepEqual(view.currentControlReceipt, state.border!.controls[String(view.incident.tileId)]);
  assert.deepEqual(borderTargetOutline(view), []);
  state.tiles = state.tiles.filter(tile => tile.id !== view.incident.tileId);
  state.civilizations = state.civilizations.filter(civ => civ.id !== 0);
  const unknown = projectBorderIncidents(state)[0]!;
  assert.equal(unknown.currentControllerKnown, false);
  assert.equal(unknown.currentControlReceipt, null);
  assert.equal(unknown.target, null);
  assert.equal(unknown.initiator.name, 'Civilization 0');
  assert.equal(unknown.purchase?.civId, 1);
});

await test('actual casualty reduces the silhouettes and exact returns remove field markers', () => {
  const { state } = resolved('defend');
  const views = projectBorderIncidents(state);
  assert.equal(views[0]!.incident.resolution?.clash?.casualties, 1);
  for (const party of projectBorderParties(views)) assert.equal(borderPartyParts(party, 'mid').filter(part => part.id.endsWith(':head')).length, party.party.people);
  while (state.border!.active.length && state.round < 12) borderBeat(state);
  assert.equal(state.border!.active.length, 0);
  assert.equal(projectBorderIncidents(state)[0]!.active, false);
  assert.deepEqual(projectBorderParties(projectBorderIncidents(state)), []);
  const synthetic = structuredClone(views); synthetic[0]!.parties[0]!.party.people = 0;
  assert.ok(projectBorderParties(synthetic).every(marker => marker.party.people > 0));
  assert.deepEqual(borderPartyParts(synthetic[0]!.parties[0]!, 'close'), []);
});

await test('a clash cue requires the exact actual resolution receipt and never generic proposals or repeated copies', () => {
  const { state, events } = resolved('defend'); const actual = events.find(event => event.border?.kind === 'resolution')!;
  const cue = borderClashCues(state, [...events, actual]);
  assert.equal(cue.length, 1);
  assert.equal(cue[0]!.eventId, actual.id);
  assert.equal(cue[0]!.tileId, actual.tileId);
  assert.equal(cue[0]!.deltas[0]!.value, -1);
  for (const field of ['id', 'tileId', 'round', 'actor', 'target'] as const) {
    const fake = structuredClone(actual);
    if (field === 'id') fake.id = 'synthetic:unlinked'; else fake[field] = -1;
    assert.deepEqual(borderClashCues(state, [fake]), []);
  }
  const changed = structuredClone(actual); assert.equal(changed.border?.kind, 'resolution');
  if (changed.border?.kind === 'resolution') changed.border.resolution.clash!.roll += .001;
  assert.deepEqual(borderClashCues(state, [changed]), []);
  assert.deepEqual(borderClashCues(state, [{ ...actual, type: 'border-departure' }]), []);
  const yielded = resolved('yield'); assert.deepEqual(borderClashCues(yielded.state, yielded.events), []);
});

await test('Three CPU meshes consume the exact shared resident recipe and disputed outline, not independent assets', () => {
  const views = projectBorderIncidents(departed()); const markers = projectBorderParties(views);
  const materials: THREE.Material[] = [];
  const meshes = createBorderPartyMeshes(views, color => { const material = new THREE.MeshBasicMaterial({ color }); materials.push(material); return material; });
  assert.equal(meshes.update(40), 'mid');
  const instances = meshes.group.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
  const expected = borderPartyWorldParts(markers, 'mid');
  assert.equal(instances.reduce((sum, child) => sum + child.count, 0), expected.length);
  const actualPositions = instances.flatMap(mesh => Array.from({ length: mesh.count }, (_, index) => {
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(index, matrix);
    return [matrix.elements[12], matrix.elements[13], matrix.elements[14]].map(value => Number(value!.toFixed(5))).join(',');
  })).sort();
  assert.deepEqual(actualPositions, expected.map(row => row.part.position.map(value => Number(value.toFixed(5))).join(',')).sort());
  assert.equal(meshes.update(10), 'far'); assert.equal(meshes.group.children.length, 0);
  meshes.dispose(); for (const material of materials) material.dispose();
  const targets = createBorderTargetMeshes(views); assert.equal(targets.children.length, 1);
  for (const target of targets.children) { assert.equal(target.userData['borderTarget'], views[0]!.incident.id); }
});
