import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { BUILDINGS, RESOURCE_IDS } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import type { BuildingOperationResult, GameEvent } from '../core/types.ts';
import { DISTRICT_PART_BUDGETS, districtLandmarks, districtParts } from '../visuals/district-visuals.ts';
import type { DistrictView } from '../visuals/district-visuals.ts';
import { VISUAL_PALETTE } from '../visuals/world-visuals.ts';
import type { DetailLevel, VisualPart } from '../visuals/world-visuals.ts';
import { hexPosition } from '../web/atlas.ts';
import { projectWorld } from '../web/live-world.ts';
import { flatSceneFaces, shapeTriangles } from '../web/settlement-parts.ts';
import { createDistrictMeshes } from '../web/settlement-three.ts';

const cases = [
  { buildingId: 'guild-workshop', parent: 'industrial-zone', input: 'energy', output: 'materials', landmark: 'guild-roof', tileId: 56 },
  { buildingId: 'university', parent: 'campus', input: 'credits', output: 'science', landmark: 'university-roof', tileId: 39 },
] as const;
const details: DetailLevel[] = ['far', 'mid', 'close'];
type ActivityCase = typeof cases[number];

function fixture(spec: ActivityCase, mode: 'funded' | 'paused' | 'supply-blocked' | 'resident-blocked' = 'funded') {
  const state = createWorld(1701);
  state.round = 8;
  state.unlockedFeatures = [...new Set([...state.unlockedFeatures, 'district-planning', 'writing', 'manufacturing', 'learning-commerce', 'building-operations', 'resident-capacity'])];
  for (const city of state.cities) {
    city.buildings = [];
    city.buildingOperations = {};
    city.construction = { active: null, lastCompleted: null };
  }
  const city = state.cities[0]!;
  const civ = state.civilizations.find(item => item.id === city.civId)!;
  city.population = mode === 'resident-blocked' ? 5 : 12;
  city.wellbeing = 100;
  city.damage = 0;
  city.buildings = [spec.parent, spec.buildingId];
  city.districtSites = { [spec.parent]: spec.tileId };
  city.buildingOperations = { [spec.buildingId]: { enabled: mode !== 'paused', lastResult: null } };
  for (const resource of RESOURCE_IDS) civ.resources[resource] = 100;
  if (mode === 'supply-blocked') civ.resources[spec.input] = 0;
  const events: GameEvent[] = [];
  resolveEconomy(state, events);
  const world = projectWorld(state);
  const district = world.districts?.find(item => item.cityId === city.id && item.buildingId === spec.parent);
  assert.ok(district);
  const result = city.buildingOperations[spec.buildingId]?.lastResult;
  assert.ok(result);
  return { state, city, civ, world, district, result, events };
}

function withResult(district: DistrictView, buildingId: string, result: BuildingOperationResult | null, enabled = true): DistrictView {
  return { ...district, buildingOperations: { ...district.buildingOperations, [buildingId]: { enabled, lastResult: result } } };
}

function activity(parts: readonly VisualPart[], buildingId: string): VisualPart[] {
  return parts.filter(part => part.id.includes(`:operation:${buildingId}:`));
}

function withoutActivity(parts: readonly VisualPart[], buildingId: string): VisualPart[] {
  return parts.filter(part => !part.id.includes(`:operation:${buildingId}:`));
}

function assertBounded(parts: readonly VisualPart[], detail: DetailLevel): void {
  assert.ok(parts.length <= DISTRICT_PART_BUDGETS[detail]);
  assert.equal(new Set(parts.map(part => part.id)).size, parts.length);
  for (const part of parts) {
    assert.ok([...part.position, ...part.scale, part.rotation].every(Number.isFinite));
    assert.ok(part.scale.every(value => value > 0));
  }
}

await test('actual paid and staffed middle-era operation results project onto their exact installed district at every LOD', () => {
  assert.deepEqual(DISTRICT_PART_BUDGETS, { far: 12, mid: 18, close: 24 });
  for (const spec of cases) {
    const { state, city, district, result, events } = fixture(spec);
    assert.equal(result.status, 'operated');
    assert.equal(result.paid[spec.input], 2);
    assert.ok((result.produced[spec.output] ?? 0) > 0);
    assert.equal(result.residents?.required, 3);
    assert.equal(result.residents?.allocated, 3);
    assert.ok(events.some(event => event.type === 'building-operation' && event.detail.includes(`${city.id}/${spec.buildingId}`)));
    assert.equal(district.tileId, spec.tileId);
    assert.equal(district.cityId, city.id);
    assert.deepEqual(district.buildingOperations?.[spec.buildingId]?.lastResult, result);
    const before = structuredClone({ state, district });
    for (const detail of details) {
      const parts = districtParts(district, detail);
      assert.equal(activity(parts, spec.buildingId).length, spec.buildingId === 'guild-workshop' && detail !== 'far' ? 3 : 2);
      assert.ok(parts.some(part => part.id.endsWith(`:${spec.landmark}`)));
      assert.ok(parts.some(part => part.id.endsWith(':identity')));
      assertBounded(parts, detail);
      assert.deepEqual(parts, districtParts(district, detail));
    }
    assert.deepEqual({ state, district }, before);
    district.buildingOperations![spec.buildingId]!.lastResult!.paid[spec.input] = 999;
    assert.equal(city.buildingOperations![spec.buildingId]!.lastResult!.paid[spec.input], 2);
  }
});

await test('current actual paused, supply-blocked and resident-blocked receipts retain the inactive installed architecture', () => {
  for (const spec of cases) for (const mode of ['paused', 'supply-blocked', 'resident-blocked'] as const) {
    const { district, result } = fixture(spec, mode);
    assert.equal(result.status, mode === 'paused' ? 'paused' : 'blocked');
    assert.deepEqual(result.paid, {});
    assert.deepEqual(result.produced, {});
    assert.equal(result.residents?.allocated, 0);
    if (mode === 'supply-blocked') assert.ok(result.shortages.some(item => item.resource === spec.input));
    if (mode === 'resident-blocked') assert.ok(result.residents && result.residents.available < result.residents.required);
    const before = structuredClone(district);
    for (const detail of details) {
      const parts = districtParts(district, detail);
      assert.deepEqual(activity(parts, spec.buildingId), []);
      assert.deepEqual(parts, districtParts(withResult(district, spec.buildingId, null), detail));
      assert.ok(parts.some(part => part.id.endsWith(`:${spec.landmark}`)));
      assertBounded(parts, detail);
    }
    assert.deepEqual(district, before);
  }
});

await test('no result, stale, terminal, contradictory, unpaid, unstaffed and zero-output records cannot fabricate activity', () => {
  for (const spec of cases) {
    const { district, result } = fixture(spec);
    const residents = result.residents!;
    const noResidents = structuredClone(result);
    delete noResidents.residents;
    const noRound = structuredClone(district);
    delete noRound.round;
    const rejected: Array<[string, DistrictView]> = [
      ['no result', withResult(district, spec.buildingId, null)],
      ['no operation', { ...district, buildingOperations: {} }],
      ['disabled', withResult(district, spec.buildingId, result, false)],
      ['paused receipt', withResult(district, spec.buildingId, { ...result, status: 'paused' })],
      ['blocked receipt', withResult(district, spec.buildingId, { ...result, status: 'blocked' })],
      ['stale', { ...district, round: result.round + 1 }],
      ['future', { ...district, round: result.round - 1 }],
      ['unknown round', noRound],
      ['fractional round', { ...district, round: result.round + .5 }],
      ['terminal', { ...district, terminal: true }],
      ['supply contradiction', withResult(district, spec.buildingId, { ...result, shortages: [{ resource: spec.input, required: 2, available: 0 }] })],
      ['strategic contradiction', withResult(district, spec.buildingId, { ...result, strategicShortages: [{ resource: 'iron', required: 1, available: 0 }] })],
      ['power contradiction', withResult(district, spec.buildingId, { ...result, localPower: { ruleVersion: 1, required: 1, availableBefore: 0, consumed: 0, generated: 0, shortage: 1 } })],
      ['no payment', withResult(district, spec.buildingId, { ...result, paid: {} })],
      ['partial payment', withResult(district, spec.buildingId, { ...result, paid: { [spec.input]: 1 } })],
      ['nonfinite payment', withResult(district, spec.buildingId, { ...result, paid: { [spec.input]: Infinity } })],
      ['no staffing', withResult(district, spec.buildingId, noResidents)],
      ['no allocation', withResult(district, spec.buildingId, { ...result, residents: { ...residents, allocated: 0 } })],
      ['partial allocation', withResult(district, spec.buildingId, { ...result, residents: { ...residents, allocated: 2 } })],
      ['excess allocation', withResult(district, spec.buildingId, { ...result, residents: { ...residents, allocated: 4 } })],
      ['zero requirement', withResult(district, spec.buildingId, { ...result, residents: { ...residents, required: 0, allocated: 0 } })],
      ['nonfinite requirement', withResult(district, spec.buildingId, { ...result, residents: { ...residents, required: Infinity, allocated: Infinity } })],
      ['fractional allocation', withResult(district, spec.buildingId, { ...result, residents: { ...residents, required: 2.5, allocated: 2.5 } })],
      ['insufficient available residents', withResult(district, spec.buildingId, { ...result, residents: { ...residents, available: 2 } })],
      ['missing output', withResult(district, spec.buildingId, { ...result, produced: {} })],
      ['zero output', withResult(district, spec.buildingId, { ...result, produced: { [spec.output]: 0 } })],
      ['negative output', withResult(district, spec.buildingId, { ...result, produced: { [spec.output]: -1 } })],
      ['nonfinite output', withResult(district, spec.buildingId, { ...result, produced: { [spec.output]: Infinity } })],
      ['wrong output', withResult(district, spec.buildingId, { ...result, produced: { food: 5 } })],
      ['power is not middle-era output', withResult(district, spec.buildingId, { ...result, produced: {}, localPower: { ruleVersion: 1, required: 0, availableBefore: 0, consumed: 0, generated: 8, shortage: 0 } })],
    ];
    for (const detail of details) {
      const inactive = districtParts(withResult(district, spec.buildingId, null), detail);
      for (const [label, input] of rejected) {
        const before = structuredClone(input);
        const parts = districtParts(input, detail);
        assert.deepEqual(parts, inactive, `${spec.buildingId}/${detail}/${label}`);
        assert.deepEqual(input, before);
      }
    }
  }
});

await test('missing, unfinished, unselected or wrong-parent attachments never borrow a successful operation', () => {
  for (const spec of cases) {
    const { state, city, district, result } = fixture(spec);
    const built = { buildingId: spec.buildingId, name: spec.buildingId, status: 'built' as const };
    for (const input of [
      { ...district, attachments: [] },
      { ...district, attachments: [{ ...built, status: 'building' as const }] },
      { ...district, status: 'building' as const },
      { ...district, buildingId: spec.parent === 'campus' ? 'industrial-zone' : 'campus' },
    ]) for (const detail of details) {
      assert.deepEqual(activity(districtParts(input, detail), spec.buildingId), []);
      assertBounded(districtParts(input, detail), detail);
    }
    const higher = spec.parent === 'campus' ? ['observatory', 'research-lab'] : ['factory', 'coal-plant'];
    const crowded = { ...district, attachments: [built, ...higher.map(buildingId => ({ buildingId, name: buildingId, status: 'built' as const }))] };
    for (const detail of ['far', 'mid'] as const) {
      assert.ok(!districtLandmarks(crowded, detail).includes(spec.buildingId));
      assert.deepEqual(activity(districtParts(crowded, detail), spec.buildingId), []);
    }
    assert.ok(activity(districtParts(crowded, 'close'), spec.buildingId).length >= 2);
    city.buildings = [spec.parent];
    city.construction = { active: { id: `pending-${spec.buildingId}`, cityId: city.id, buildingId: spec.buildingId, ruleVersion: 1, startedRound: state.round, paid: { materials: 30, credits: 14 }, workRequired: 14, workDone: 13 }, lastCompleted: null };
    const projected = projectWorld(state).districts!.find(item => item.cityId === city.id && item.buildingId === spec.parent)!;
    assert.equal(projected.attachments?.find(item => item.buildingId === spec.buildingId)?.status, 'building');
    assert.deepEqual(projected.buildingOperations?.[spec.buildingId]?.lastResult, result);
    for (const detail of details) assert.deepEqual(activity(districtParts(projected, detail), spec.buildingId), []);
    city.construction.active = null;
    const missing = projectWorld(state).districts!.find(item => item.cityId === city.id && item.buildingId === spec.parent)!;
    for (const detail of details) assert.deepEqual(activity(districtParts(missing, detail), spec.buildingId), []);
  }
});

await test('warm Guild work and cool University study facades remain compact, distinct and stable across identity-seeded variations', () => {
  for (const spec of cases) {
    const { district, result } = fixture(spec);
    const variants = new Set<string>();
    for (let identity = 0; identity < 12; identity++) for (const detail of details) {
      const input = { ...district, id: `district:fixture-${identity}:${spec.parent}`, cityId: `fixture-${identity}`, civId: identity % 5, tileId: district.tileId + identity };
      const before = structuredClone(input);
      const parts = districtParts(input, detail);
      const active = activity(parts, spec.buildingId);
      assert.ok(active.length >= 2);
      assert.ok(active.every(part => part.shape !== 'canopy' && part.shape !== 'cone'));
      assert.ok(active.every(part => part.position[1] < .86 && part.scale[0] <= .34 && part.scale[2] <= .3));
      assert.ok(active.every(part => Math.abs(part.position[0]) < .6 && Math.abs(part.position[2]) < .55));
      assert.ok(active.some(part => part.material === (spec.buildingId === 'guild-workshop' ? 'grain' : 'studyLight')));
      assert.ok(active.some(part => part.shape === (spec.buildingId === 'guild-workshop' ? 'cylinder' : 'box')));
      assert.deepEqual(parts, districtParts({ ...input, attachments: input.attachments?.toReversed() ?? [] }, detail));
      const nextBeat = withResult({ ...input, round: result.round + 1 }, spec.buildingId, { ...result, round: result.round + 1 });
      assert.deepEqual(parts, districtParts(nextBeat, detail));
      assert.deepEqual(withoutActivity(parts, spec.buildingId), districtParts(withResult(input, spec.buildingId, null), detail));
      variants.add(JSON.stringify(active.map(({ position, rotation }) => ({ position, rotation }))));
      assertBounded(parts, detail);
      assert.deepEqual(input, before);
    }
    assert.ok(variants.size > 3);
  }
});

await test('full mixed inventories preserve every selected inactive part and existing paid-operation cue within exact budgets', () => {
  for (const spec of cases) {
    const { district, result } = fixture(spec);
    const ids = spec.parent === 'campus' ? ['library', 'university', 'observatory', 'research-lab'] : ['guild-workshop', 'foundry', 'coal-plant', 'factory'];
    const buildingOperations = Object.fromEntries(ids.map(id => [id, { enabled: true, lastResult: {
      ...result, paid: { ...BUILDINGS.find(building => building.id === id)?.operatingInputs },
      produced: { ...BUILDINGS.find(building => building.id === id)?.production },
      ...(id === 'factory' || id === 'research-lab' ? { localPower: { ruleVersion: 1 as const, required: 3, availableBefore: 8, consumed: 3, generated: 0, shortage: 0 } } : {}),
      ...(id === 'coal-plant' ? { localPower: { ruleVersion: 1 as const, required: 0, availableBefore: 0, consumed: 0, generated: 8, shortage: 0 } } : {}),
    } }]));
    const input: DistrictView = { ...district, library: spec.parent === 'campus' ? 'built' : 'absent', attachments: ids.map(buildingId => ({ buildingId, name: buildingId, status: 'built' })), buildingOperations };
    for (const detail of details) {
      const parts = districtParts(input, detail);
      const inactive = districtParts(withResult(input, spec.buildingId, null), detail);
      assert.deepEqual(withoutActivity(parts, spec.buildingId), inactive);
      assertBounded(parts, detail);
      assert.equal(activity(parts, spec.buildingId).length > 0, districtLandmarks(input, detail).includes(spec.buildingId));
      const expected = spec.parent === 'campus' ? ['operation:research-lab:power'] : ['operation:factory:power', 'operation:coal-plant:smoke', ...(detail === 'close' ? ['operation:foundry:smoke'] : [])];
      if (detail !== 'far') for (const suffix of expected) assert.ok(parts.some(part => part.id.endsWith(`:${suffix}`)), `${detail}/${suffix}`);
    }
  }
});

await test('stale and terminal actual world projections remove only new activity without moving installed architecture', () => {
  for (const spec of cases) {
    const { state, district } = fixture(spec);
    const active = details.map(detail => withoutActivity(districtParts(district, detail), spec.buildingId));
    state.round += 1;
    for (const terminal of [false, true]) {
      state.outcome = terminal ? { kind: 'mars', winners: [0], round: state.round, reason: 'Synthetic terminal presentation fixture' } : null;
      const before = structuredClone(state);
      const projected = projectWorld(state).districts!.find(item => item.id === district.id)!;
      for (const [index, detail] of details.entries()) assert.deepEqual(districtParts(projected, detail), active[index]);
      assert.deepEqual(state, before);
    }
  }
});

await test('flat faces and Three CPU instances consume the identical active and inactive shared parts at every LOD', () => {
  for (const spec of cases) for (const enabled of [false, true]) {
    const { world, district, result } = fixture(spec);
    world.districts = [withResult(district, spec.buildingId, result, enabled)];
    const before = structuredClone(world);
    const materials: THREE.MeshBasicMaterial[] = [];
    const layer = createDistrictMeshes(world, color => {
      const material = new THREE.MeshBasicMaterial({ color });
      material.userData.sourceColor = color;
      materials.push(material);
      return material;
    });
    for (const [detail, pixels] of [['far', 20], ['mid', 60], ['close', 110]] as const) {
      const parts = districtParts(world.districts[0]!, detail);
      const faces = flatSceneFaces(parts, .72);
      assert.equal(new Set(faces.map(face => face.part.id)).size, parts.length);
      assert.ok(faces.every(face => !/NaN|Infinity/.test(face.points) && Number.isFinite(face.depth)));
      assert.equal(layer.update(pixels), detail);
      const origin = hexPosition(district.q, district.r);
      const expected = new Map<string, { shape: VisualPart['shape']; matrices: number[][] }>();
      for (const part of parts) {
        const color = part.material === 'identity' ? district.color : VISUAL_PALETTE[part.material];
        const key = `${part.shape}:${color}`;
        const batch = expected.get(key) ?? { shape: part.shape, matrices: [] };
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(origin.x + part.position[0], district.height + part.position[1], origin.z + part.position[2]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), part.rotation), new THREE.Vector3(...part.scale));
        batch.matrices.push(matrix.toArray());
        expected.set(key, batch);
      }
      const meshes = layer.group.children.filter(child => child instanceof THREE.InstancedMesh);
      assert.equal(meshes.length, expected.size);
      assert.equal(meshes.reduce((sum, mesh) => sum + mesh.count, 0), parts.length);
      for (const [index, batch] of [...expected.values()].entries()) {
        const mesh = meshes[index]!;
        assert.ok(mesh.boundingSphere && Number.isFinite(mesh.boundingSphere.radius));
        assert.deepEqual(Array.from(mesh.geometry.getAttribute('position').array), Array.from(new Float32Array(shapeTriangles(batch.shape))));
        assert.equal(mesh.count, batch.matrices.length);
        assert.equal((mesh.material as THREE.MeshBasicMaterial).userData.sourceColor, [...expected.keys()][index]!.slice(batch.shape.length + 1));
        for (const [instance, matrix] of batch.matrices.entries()) {
          const actual = new THREE.Matrix4();
          mesh.getMatrixAt(instance, actual);
          for (const [component, value] of actual.toArray().entries()) assert.ok(Math.abs(value - matrix[component]!) < 1e-5);
        }
      }
      assert.deepEqual(world, before);
    }
    layer.dispose();
    for (const material of materials) material.dispose();
    assert.equal(layer.group.children.length, 0);
  }
});

await test('normal 84px activity clears the measured crest and caption while the study window stays on the original facade below its roof', () => {
  const screenBounds = (parts: readonly VisualPart[]) => {
    const points = flatSceneFaces(parts, .72).flatMap(face => face.points.split(' ').map(point => point.split(',').map(Number)));
    return { left: Math.min(...points.map(point => point[0]!)) * 42, right: Math.max(...points.map(point => point[0]!)) * 42,
      top: Math.min(...points.map(point => point[1]!)) * 42, bottom: Math.max(...points.map(point => point[1]!)) * 42 };
  };
  const crest = { left: -10 - 5 / 6, right: 10 + 5 / 6, top: -30 - 5 / 6, bottom: -10 + 5 / 6 };
  const baseCaptionTop = -7.167;
  assert.equal(VISUAL_PALETTE.studyLight, '#93cbd6');
  for (const spec of cases) {
    const { district } = fixture(spec);
    for (let identity = 0; identity < 12; identity++) for (const detail of details) {
      const input = { ...district, id: `district:clearance-${identity}:${spec.parent}`, cityId: `clearance-${identity}`, civId: identity % 5, tileId: district.tileId + identity };
      const parts = districtParts(input, detail);
      const cues = activity(parts, spec.buildingId);
      if (spec.buildingId === 'guild-workshop') {
        const press = cues.find(part => part.id.endsWith(':press'))!;
        const bounds = screenBounds([press]);
        assert.ok(bounds.left > crest.right + 2.8);
        assert.ok(bounds.top < baseCaptionTop - 12);
        assert.ok(press.position[0] - press.scale[0] / 2 > .30 * .72);
        assert.ok(press.position[2] - press.scale[2] / 2 > -.16 * .72);
        assert.ok(press.position[2] + press.scale[2] / 2 < .15 * .72);
        if (detail !== 'far') {
          const beam = cues.find(part => part.id.endsWith(':press-beam'))!;
          const beamBounds = screenBounds([beam]);
          assert.ok(beamBounds.left > crest.right + 1);
          assert.ok(beamBounds.bottom < baseCaptionTop - 6.4);
          assert.ok(beamBounds.right - beamBounds.left >= 9.6);
        }
      } else {
        const window = cues.find(part => part.id.endsWith(':study-window'))!;
        const ledge = cues.find(part => part.id.endsWith(':study-ledge'))!;
        const roof = parts.find(part => part.id.endsWith(':university-roof'))!;
        const bounds = screenBounds([window]);
        const roofBounds = screenBounds([roof]);
        assert.ok(bounds.right - bounds.left >= 12);
        assert.ok(bounds.bottom - bounds.top >= 2.9);
        assert.ok(bounds.top > roofBounds.bottom + .55);
        assert.ok(screenBounds(cues).bottom < crest.top - .6);
        for (const part of cues) {
          assert.ok(Math.abs(part.position[0]) + part.scale[0] / 2 <= .23 * .72);
          assert.ok(part.position[1] + part.scale[1] / 2 < .86);
          assert.ok(Math.abs(part.position[2] - part.scale[2] / 2 + .27 * .72) < 1e-10);
          assert.equal(part.rotation, 0);
        }
        assert.equal(window.material, 'studyLight');
        assert.equal(ledge.material, 'metal');
        const withLibrary = { ...input, library: 'built' as const, attachments: [...input.attachments!, { buildingId: 'library', name: 'Library', status: 'built' as const }] };
        const libraryParts = districtParts(withLibrary, detail);
        assert.deepEqual(activity(libraryParts, spec.buildingId), cues);
        for (const part of libraryParts.filter(part => part.id.includes(':library-'))) assert.ok(screenBounds([part]).top > screenBounds(cues).bottom + 10);
      }
      assertBounded(parts, detail);
    }
  }
});
