import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { BUILDINGS } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import type { BuildingOperation, City } from '../core/types.ts';
import { settlementDevelopment, currentBuildingOperation } from '../visuals/settlement-development.ts';
import { DETAIL_BUDGETS, settlementVisual, projectWorldVisuals, SETTLEMENT_RENDER_SCALE } from '../visuals/world-visuals.ts';
import type { SettlementFacts } from '../visuals/world-visuals.ts';
import { flatSceneFaces, transformedVertices } from '../web/settlement-parts.ts';
import { createSettlementMeshes } from '../web/settlement-three.ts';
import { projectWorld } from '../web/live-world.ts';
import { hexPosition } from '../web/atlas.ts';

const city: SettlementFacts = { id: 'local', civId: 0, tileId: 4, name: 'Local', population: 7, wellbeing: 65, damage: 0, buildings: [] };
const operated: BuildingOperation = { enabled: true, lastResult: { round: 8, status: 'operated', paid: { energy: 2 }, produced: { materials: 4 }, shortages: [] } };
const order = (buildingId: string): NonNullable<City['construction']> => ({ active: { id: `order-${buildingId}`, cityId: city.id, buildingId, ruleVersion: 1, startedRound: 5, paid: { materials: 12, credits: 8 }, workRequired: 24, workDone: 6 }, lastCompleted: null });

await test('towns in one global era keep materially different locally earned forms', () => {
  const state = createWorld(1701);
  for (const civ of state.civilizations) civ.era = 5;
  const stages = [[], ['academy', 'aqueduct'], ['industrial-zone', 'factory', 'coal-plant'], ['launchpad']];
  state.cities = stages.map((buildings, index) => ({ ...state.cities[0]!, id: `town-${index}`, population: 7, buildings }));
  const before = structuredClone(state);
  const visuals = projectWorldVisuals(state, 'close');
  assert.deepEqual(visuals.map(value => value.development.stage), ['primitive', 'civic', 'industrial', 'launch']);
  assert.equal(new Set(visuals.map(value => JSON.stringify(value.parts))).size, 4);
  assert.ok(visuals[0]?.parts.some(part => part.id === 'home-hearth' && part.material === 'stone'));
  assert.ok(visuals[0]?.parts.some(part => part.id === 'home-0-roof' && part.shape === 'cone'));
  assert.ok(visuals[1]?.parts.some(part => part.id === 'home-0-wall' && part.material === 'plaster'));
  assert.ok(visuals[2]?.parts.some(part => part.id === 'home-0-roof' && part.material === 'identity'));
  assert.ok(visuals[3]?.parts.some(part => part.id === 'launchpad-gantry'));
  assert.ok(visuals.every(value => !value.parts.some(part => /rocket|plume/.test(part.id))));
  assert.deepEqual(state, before);
});

await test('population adds bounded density, never free stone, factories, power or a launch complex', () => {
  for (const population of [1, 7, 28, 10000]) {
    const visual = settlementVisual({ ...city, population }, 'close');
    assert.equal(visual.development.stage, 'primitive');
    assert.equal(visual.population, population);
    assert.ok(visual.parts.filter(part => /home-\d+-wall/.test(part.id)).every(part => part.material === 'timber'));
    assert.ok(visual.parts.filter(part => /home-\d+-roof/.test(part.id)).every(part => part.shape === 'cone'));
    assert.ok(!visual.parts.some(part => /launchpad|factory|coal-plant|research-lab|operation:/.test(part.id)));
  }
  assert.ok(settlementVisual({ ...city, population: 40 }, 'close').houses > settlementVisual({ ...city, population: 1 }, 'close').houses);
  assert.notDeepEqual(settlementVisual({ ...city, population: 7 }, 'far').parts, settlementVisual({ ...city, population: 40 }, 'far').parts);
});

await test('paid active city construction remains a frame until the building is actually installed', () => {
  const construction = order('launchpad');
  const input = { ...city, construction };
  const before = structuredClone(input);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const active = settlementVisual(input, detail);
    assert.equal(active.development.stage, 'primitive');
    assert.equal(active.construction?.buildingId, 'launchpad');
    assert.equal(active.construction?.workDone, 6);
    assert.deepEqual(active.construction?.paid, { materials: 12, credits: 8 });
    assert.ok(active.parts.some(part => part.id.startsWith('construction:order-launchpad:')));
    assert.ok(!active.parts.some(part => part.id.startsWith('launchpad-')));
    const completed = settlementVisual({ ...city, buildings: ['launchpad'], construction: { ...construction, active: null } }, detail);
    assert.equal(completed.construction, null);
    assert.equal(completed.development.stage, 'launch');
    assert.ok(completed.parts.some(part => part.id === 'launchpad-gantry'));
    assert.ok(!completed.parts.some(part => part.id.startsWith('construction:')));
  }
  const stillActive = order('launchpad');
  if (stillActive.active) stillActive.active.workDone = stillActive.active.workRequired;
  assert.equal(settlementVisual({ ...city, construction: stillActive }, 'close').development.stage, 'primitive');
  assert.ok(!settlementVisual({ ...city, construction: stillActive }, 'close').parts.some(part => part.id.startsWith('launchpad-')));
  const historicalOnly: NonNullable<City['construction']> = { active: null, lastCompleted: { orderId: 'old-pad', cityId: city.id, buildingId: 'launchpad', startedRound: 1, completedRound: 3, paid: { materials: 72 }, workRequired: 24, eventId: 'complete-pad' } };
  assert.equal(settlementVisual({ ...city, construction: historicalOnly }, 'close').development.stage, 'primitive');
  assert.ok(!settlementVisual({ ...city, construction: historicalOnly }, 'close').parts.some(part => part.id.startsWith('launchpad-')));
  const unpaid = order('launchpad');
  if (unpaid.active) unpaid.active.paid = {};
  assert.equal(settlementVisual({ ...city, construction: unpaid }, 'close').construction, null);
  const district = settlementVisual({ ...city, construction: order('factory') }, 'close');
  assert.equal(district.construction, null);
  assert.ok(!district.parts.some(part => part.id.includes('factory')));
  assert.deepEqual(input, before);
});

await test('only fresh enabled productive operation earns town smoke; paused, shortage, stale and terminal stay still', () => {
  const active = { ...city, buildings: ['kiln'], round: 8, buildingOperations: { kiln: operated } };
  assert.ok(settlementVisual(active, 'close').parts.some(part => part.id === 'operation:kiln:smoke'));
  const result = operated.lastResult!;
  const states: SettlementFacts[] = [
    { ...active, round: 9 }, { ...active, terminal: true },
    { ...city, buildings: ['kiln'], buildingOperations: { kiln: operated } },
    { ...active, buildingOperations: { kiln: { ...operated, enabled: false } } },
    { ...active, buildingOperations: { kiln: { ...operated, lastResult: { ...result, status: 'paused' } } } },
    { ...active, buildingOperations: { kiln: { ...operated, lastResult: { ...result, status: 'blocked', produced: {}, shortages: [{ resource: 'energy', required: 2, available: 0 }] } } } },
    { ...active, buildingOperations: { kiln: { ...operated, lastResult: { ...result, produced: {} } } } },
    { ...active, buildings: [] },
  ];
  for (const input of states) assert.ok(!settlementVisual(input, 'close').parts.some(part => part.id.startsWith('operation:')));
  assert.equal(currentBuildingOperation({ ...active, round: Number.NaN }, 'kiln'), null);
});

await test('representative standalone landmarks and complete exact inventory survive finite full-building budgets', () => {
  const buildings = BUILDINGS.map(building => building.id);
  const input = { ...city, population: 10000, damage: 35, buildings };
  const before = structuredClone(input);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const visual = settlementVisual(input, detail);
    assert.ok(visual.parts.length <= DETAIL_BUDGETS[detail].parts);
    assert.ok(visual.houses >= 1 && visual.houses <= DETAIL_BUDGETS[detail].houses);
    assert.equal(visual.population, input.population);
    assert.equal(visual.buildings.length, BUILDINGS.length);
    assert.ok(visual.buildings.every(entry => entry.value === 1));
    assert.equal(visual.landmarks.length, detail === 'far' ? 1 : detail === 'mid' ? 2 : 3);
    assert.equal(visual.summarizedBuildings.length + visual.landmarks.length, BUILDINGS.length);
    assert.ok(visual.parts.some(part => part.id === 'launchpad-gantry'));
    assert.ok(visual.parts.some(part => part.id === 'launchpad-service-arm'));
    assert.ok(!visual.parts.some(part => /^(factory|coal-plant|research-lab|campus|foundry|observatory)-/.test(part.id)));
    assert.equal(new Set(visual.parts.map(part => part.id)).size, visual.parts.length);
    assert.ok(visual.parts.every(part => [...part.position, ...part.scale, part.rotation].every(Number.isFinite)));
    assert.deepEqual(settlementVisual({ ...input, buildings: buildings.toReversed() }, detail), visual);
    assert.deepEqual(settlementVisual({ ...input, buildings: [...buildings, ...buildings, 'unknown'] }, detail), visual);
  }
  assert.deepEqual(input, before);
  assert.equal(settlementDevelopment({ ...city, buildings: ['unknown'] }).stage, 'primitive');
});

await test('flat faces and actual WebGL instance matrices consume the identical canonical settlement parts', () => {
  const state = createWorld(1701);
  state.cities = [{ ...state.cities[0]!, population: 14, buildings: ['aqueduct', 'granary', 'launchpad'] }];
  const world = projectWorld(state);
  const town = world.cities[0]!;
  const material = new THREE.MeshBasicMaterial();
  const meshes = createSettlementMeshes(world, () => material);
  const origin = hexPosition(town.q, town.r);
  const floor = world.tiles.find(tile => tile.q === town.q && tile.r === town.r)?.height ?? .4;
  for (const [pixels, detail] of [[24, 'far'], [60, 'mid'], [110, 'close']] as const) {
    meshes.update(pixels);
    const parts = settlementVisual(town.settlement!, detail).parts;
    const faces = flatSceneFaces(parts);
    assert.ok(faces.length > parts.length);
    assert.ok(parts.every(part => faces.some(face => face.part.id === part.id)));
    assert.ok(parts.every(part => transformedVertices(part).every(vertex => vertex.every(Number.isFinite))));
    const actual: number[][] = [];
    for (const child of meshes.group.children) if (child instanceof THREE.InstancedMesh) {
      for (let index = 0; index < child.count; index++) {
        const matrix = new THREE.Matrix4(); child.getMatrixAt(index, matrix); actual.push([...matrix.elements]);
      }
    }
    const expected = parts.map(part => new THREE.Matrix4().compose(
      new THREE.Vector3(origin.x + part.position[0] * SETTLEMENT_RENDER_SCALE, floor + part.position[1] * SETTLEMENT_RENDER_SCALE, origin.z + part.position[2] * SETTLEMENT_RENDER_SCALE),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), part.rotation),
      new THREE.Vector3(...part.scale.map(value => value * SETTLEMENT_RENDER_SCALE) as [number, number, number]),
    ).elements);
    assert.equal(actual.length, expected.length);
    for (const matrix of expected) {
      const index = actual.findIndex(candidate => candidate.every((value, offset) => Math.abs(value - matrix[offset]!) < .00001));
      assert.ok(index >= 0);
      actual.splice(index, 1);
    }
  }
  meshes.dispose(); material.dispose();
});

await test('full installed towns can reserve paid work without overflowing or hiding the new frame', () => {
  for (const buildingId of ['granary', 'launchpad', 'water-mill', 'aqueduct', 'farm', 'workshop', 'irrigation', 'kiln', 'academy', 'monument', 'boat-yard', 'fuel-yard']) {
    const input = { ...city, population: 10000, damage: 100, buildings: BUILDINGS.filter(building => building.id !== buildingId).map(building => building.id), construction: order(buildingId) };
    for (const detail of ['far', 'mid', 'close'] as const) {
      const visual = settlementVisual(input, detail);
      assert.ok(visual.parts.length <= DETAIL_BUDGETS[detail].parts, `${detail}: ${buildingId}`);
      assert.ok(visual.houses >= 1);
      assert.equal(visual.buildings.length, BUILDINGS.length - 1);
      assert.equal(visual.construction?.buildingId, buildingId);
      assert.ok(visual.parts.some(part => part.id === `construction:order-${buildingId}:foundation`));
      assert.ok(!visual.parts.some(part => part.id.startsWith(`${buildingId}-`)));
    }
  }
});

await test('reserved construction does not move installed centers, annexes or existing home anchors', () => {
  for (const worldSeed of [0, 1, 1701, 999]) {
    const installed = { ...city, worldSeed, population: 40, buildings: ['academy', 'granary', 'kiln'] };
    const baseline = settlementVisual(installed, 'close');
    for (const detail of ['far', 'mid', 'close'] as const) {
      const active = settlementVisual({ ...installed, construction: order('launchpad') }, detail);
      for (const part of active.parts.filter(part => !part.id.startsWith('construction:'))) {
        const previous = baseline.parts.find(value => value.id === part.id);
        assert.ok(previous, part.id);
        assert.deepEqual(part, previous, `${worldSeed}/${detail}: ${part.id}`);
      }
      assert.ok(active.parts.some(part => part.id === 'construction:order-launchpad:foundation'));
      assert.ok(!active.parts.some(part => part.id.startsWith('launchpad-')));
    }
  }
});
