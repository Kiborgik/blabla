import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { BUILDINGS } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import type { City } from '../core/types.ts';
import { settlementHomeParts } from '../visuals/settlement-homes.ts';
import { townPlanV1 } from '../visuals/town-plan.ts';
import { DETAIL_BUDGETS, projectWorldVisuals, settlementVisual } from '../visuals/world-visuals.ts';
import type { SettlementFacts, VisualPart } from '../visuals/world-visuals.ts';
import { flatSceneFaces, transformedVertices } from '../web/settlement-parts.ts';
import { createSettlementMeshes } from '../web/settlement-three.ts';
import { projectWorld } from '../web/live-world.ts';

const city: SettlementFacts = { id: 'earned-town', worldSeed: 1701, civId: 0, tileId: 4, name: 'Earned', population: 40, wellbeing: 65, damage: 0, buildings: [] };
const details = ['far', 'mid', 'close'] as const;
const populations = [1, 3, 4, 6, 7, 9, 10, 13, 14, 19, 20, 27, 28, 39, 40, 10000];
const steps = [1, 4, 7, 10, 14, 20, 28, 40];
const tierOf = (population: number): number => population >= 28 ? 3 : population >= 14 ? 2 : population >= 7 ? 1 : 0;
const homes = (parts: readonly VisualPart[]): VisualPart[] => parts.filter(part => /^home-\d+-(wall|roof)$/.test(part.id));
const closeTo = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const legacyFamilies = [
  ['plaster', 'identity', 'gable', .24, 0],
  ['timber', 'canopy', 'gable', .3, Math.PI / 2],
  ['stone', 'roof', 'gable', .32, 0],
  ['plaster', 'identity', 'box', .09, 0],
  ['rockLight', 'identity', 'cone', .33, 0],
] as const;
const earnedFamilies = [
  { industrial: ['box', 'plaster', 'gable', 'identity', .11], launch: ['box', 'plaster', 'box', 'identity', .075] },
  { industrial: ['box', 'stone', 'gable', 'canopy', .13], launch: ['box', 'rockLight', 'gable', 'canopy', .10] },
  { industrial: ['box', 'roof', 'box', 'metal', .075], launch: ['box', 'stone', 'box', 'roof', .075] },
  { industrial: ['box', 'plaster', 'box', 'identity', .075], launch: ['box', 'rockLight', 'box', 'identity', .075] },
  { industrial: ['cylinder', 'rockLight', 'cone', 'identity', .13], launch: ['cylinder', 'rockLight', 'cone', 'identity', .10] },
] as const;
const baseHeight = (stage: 'industrial' | 'launch', index: number, tier: number): number => index === 0
  ? stage === 'launch' ? .70 + tier * .07 : .54 + tier * .05
  : index === 1 ? stage === 'launch' ? .49 + tier * .045 : .44 + tier * .04 : .34 + tier * .035;
const order = (buildingId: string): NonNullable<City['construction']> => ({ active: { id: `order-${buildingId}`, cityId: city.id, buildingId, ruleVersion: 1, startedRound: 5, paid: { materials: 12 }, workRequired: 24, workDone: 24 }, lastCompleted: null });

await test('primitive earth roofs retain one identity accent while civic homes retain earned family values', () => {
  for (const worldSeed of [0, 1701, 200346405]) for (const [civId, family] of legacyFamilies.entries()) {
    for (const primitive of [true, false]) for (const population of populations) for (const detail of details) {
      const input = { ...city, worldSeed, civId, population, buildings: primitive ? [] : ['academy'] };
      const before = structuredClone(input);
      const visual = settlementVisual(input, detail);
      const tier = tierOf(population);
      const expected = townPlanV1(input).homeLots.slice(0, visual.houses).flatMap(({ x, z }, index) => {
        const height = (primitive ? .16 : .25) + tier * .035 + (index % 2) * .035;
        const width = .18 + tier * .01;
        const roofHeight = primitive ? .25 : family[3];
        return [
          { id: `home-${index}-wall`, shape: primitive ? 'cylinder' : 'box', material: primitive ? 'timber' : family[0], position: [x, height / 2, z], scale: [width, height, width], rotation: 0 },
          { id: `home-${index}-roof`, shape: primitive ? 'cone' : family[2], material: primitive ? index === 0 ? family[1] : index % 2 ? 'grain' : 'roof' : family[1], position: [x, height + roofHeight / 2, z], scale: [width + .055, roofHeight, width + .055], rotation: primitive ? 0 : family[4] },
        ];
      });
      assert.equal(visual.development.stage, primitive ? 'primitive' : 'civic');
      assert.equal(visual.houses, Math.min(detail === 'far' ? 3 : detail === 'mid' ? 4 : 6, steps.filter(step => population >= step).length));
      assert.deepEqual(homes(visual.parts), expected);
      assert.equal(JSON.stringify(homes(visual.parts)), JSON.stringify(expected));
      assert.deepEqual(input, before);
    }
  }
});

await test('earned homes follow literal family grammar, hierarchy, cap contact and rotated lot bounds', () => {
  for (const [civId, family] of earnedFamilies.entries()) for (const stage of ['industrial', 'launch'] as const) {
    for (const population of populations) for (const detail of details) {
      const input = { ...city, civId, population, buildings: [stage === 'launch' ? 'launchpad' : 'factory'] };
      const before = structuredClone(input);
      const visual = settlementVisual(input, detail);
      const plan = townPlanV1(input);
      const tier = tierOf(population);
      const roofHeight = family[stage][4];
      const walls: number[] = [];
      assert.equal(visual.development.stage, stage);
      assert.equal(homes(visual.parts).length, visual.houses * 2);
      assert.ok(visual.parts.length <= DETAIL_BUDGETS[detail].parts);
      for (const [index, lot] of plan.homeLots.slice(0, visual.houses).entries()) {
        const wall = visual.parts.find(part => part.id === `${lot.id}-wall`)!;
        const roof = visual.parts.find(part => part.id === `${lot.id}-roof`)!;
        assert.deepEqual([wall.shape, wall.material, roof.shape, roof.material, roof.scale[1]], family[stage]);
        const height = wall.scale[1];
        const variation = height - baseHeight(stage, index, tier);
        assert.ok(variation >= -.015 && variation <= .015);
        assert.equal(wall.rotation, 0);
        assert.equal(roof.rotation, civId === 1 ? Math.PI / 2 : 0);
        closeTo(wall.scale[0], .20 + tier * .01);
        closeTo(roof.scale[0], wall.scale[0] + .035);
        assert.equal(wall.scale[0], wall.scale[2]);
        assert.equal(roof.scale[0], roof.scale[2]);
        assert.ok(roof.scale[0] <= .265);
        assert.deepEqual([wall.position[0], wall.position[2]], [lot.x, lot.z]);
        assert.deepEqual([roof.position[0], roof.position[2]], [lot.x, lot.z]);
        closeTo(wall.position[1] - height / 2, 0);
        closeTo(roof.position[1] - roofHeight / 2, wall.position[1] + height / 2);
        assert.ok(height + roofHeight < 1.04);
        for (const part of [wall, roof]) for (const [x, y, z] of transformedVertices(part)) {
          assert.ok([x, y, z].every(Number.isFinite));
          assert.ok(Math.abs(x - lot.x) <= .145 && Math.abs(z - lot.z) <= .145);
        }
        walls.push(height);
      }
      assert.ok(walls.slice(1).every(height => height < walls[0]!));
      assert.ok(walls.slice(2).every(height => height < walls[1]!));
      assert.deepEqual(input, before);
      if (stage === 'launch') {
        const gantry = visual.parts.find(part => part.id === 'launchpad-gantry')!;
        assert.ok(homes(visual.parts).every(part => part.position[1] + part.scale[1] / 2 < gantry.position[1] + gantry.scale[1] / 2));
      }
      assert.ok(!homes(visual.parts).some(part => /rocket|antenna|chimney|window|smoke/.test(part.id)));
    }
  }
});

await test('versioned height noise is pinned to seed, city and lot, not detail, growth, names or clocks', () => {
  const variations = [-.008712013552431017, -.0033820755919441586, .008838906709570438, -.0008948176167905327, -.007259416014421731, .013070882256142793];
  const lots = townPlanV1(city).homeLots;
  const beforeLots = structuredClone(lots);
  for (const stage of ['industrial', 'launch'] as const) for (const population of [1, 4, 7, 14, 28, 40, 10000]) {
    const input = { ...city, population, buildings: ['academy', 'kiln', stage === 'launch' ? 'launchpad' : 'factory'] };
    const all = settlementHomeParts(input, stage, lots);
    for (const [index, variation] of variations.entries()) closeTo(all[index * 2]!.scale[1] - baseHeight(stage, index, tierOf(population)), variation);
    for (const detail of details) {
      const actual = homes(settlementVisual(input, detail).parts);
      assert.deepEqual(actual, all.slice(0, actual.length));
      const changed = { ...input, name: 'Renamed', round: 900, rng: 99, revision: 25, terminal: true, buildings: input.buildings.toReversed() };
      assert.deepEqual(homes(settlementVisual(changed, detail).parts), actual);
      const constructed = settlementVisual({ ...input, construction: order('aqueduct'), damage: 100 }, detail);
      assert.deepEqual(homes(constructed.parts), all.slice(0, constructed.houses * 2));
    }
  }
  const original = settlementHomeParts(city, 'industrial', lots);
  assert.notEqual(settlementHomeParts({ ...city, worldSeed: 1702 }, 'industrial', lots)[0]!.scale[1], original[0]!.scale[1]);
  assert.notEqual(settlementHomeParts({ ...city, id: 'another-town' }, 'industrial', lots)[0]!.scale[1], original[0]!.scale[1]);
  assert.notEqual(settlementHomeParts(city, 'industrial', [{ ...lots[0]!, id: 'another-lot' }])[0]!.scale[1], original[0]!.scale[1]);
  const seedless = { id: city.id, civId: city.civId, population: city.population };
  assert.deepEqual(settlementHomeParts(seedless, 'industrial', lots), settlementHomeParts({ ...city, worldSeed: 0 }, 'industrial', lots));
  for (const civId of [-1, 5, 9]) assert.deepEqual(settlementHomeParts({ ...city, civId }, 'launch', lots), settlementHomeParts({ ...city, civId: ((civId % 5) + 5) % 5 }, 'launch', lots));
  assert.deepEqual(lots, beforeLots);
});

await test('only installed local buildings earn the new skyline, independently of operation or remote progress', () => {
  const state = createWorld(1701);
  for (const civ of state.civilizations) civ.era = 5;
  state.cities = [
    { ...state.cities[0]!, id: city.id, population: 10000, buildings: [], construction: order('launchpad') },
    { ...state.cities[1]!, buildings: ['launchpad', 'factory'] },
  ];
  const before = structuredClone(state);
  for (const detail of details) {
    const projected = projectWorldVisuals(state, detail);
    assert.equal(projected[0]!.development.stage, 'primitive');
    assert.equal(projected[1]!.development.stage, 'launch');
    assert.equal(projected[0]!.parts.find(part => part.id === 'home-0-wall')!.material, 'timber');
    for (const industrial of ['foundry', 'coal-plant', 'factory', 'research-lab']) {
      const installed = { ...city, buildings: [industrial], buildingOperations: { [industrial]: { enabled: false, lastResult: null } } };
      const earned = settlementVisual(installed, detail);
      assert.equal(earned.development.stage, 'industrial');
      assert.deepEqual(homes(earned.parts), homes(settlementVisual({ ...city, buildings: ['factory'] }, detail).parts));
      assert.equal(settlementVisual({ ...city, construction: order(industrial) }, detail).development.stage, 'primitive');
    }
    assert.equal(settlementVisual({ ...city, buildings: ['industrial-zone', 'guild-workshop'] }, detail).development.stage, 'civic');
    assert.equal(settlementVisual({ ...city, buildings: ['launchpad', 'factory'] }, detail).development.stage, 'launch');
  }
  assert.deepEqual(state, before);
});

await test('full earned towns preserve house counts, damaged and paid-frame reservations and factual activity cues', () => {
  const buildings = BUILDINGS.filter(building => building.id !== 'aqueduct').map(building => building.id);
  const input = { ...city, population: 10000, buildings, construction: order('aqueduct'), damage: 100, round: 8,
    buildingOperations: { kiln: { enabled: true, lastResult: { round: 8, status: 'operated' as const, paid: { energy: 2 }, produced: { materials: 4 }, shortages: [] } } } };
  const before = structuredClone(input);
  for (let civId = 0; civId < 5; civId++) for (const detail of details) {
    const visual = settlementVisual({ ...input, civId }, detail);
    assert.ok(visual.parts.length <= DETAIL_BUDGETS[detail].parts);
    assert.equal(new Set(visual.parts.map(part => part.id)).size, visual.parts.length);
    assert.equal(homes(visual.parts).length, visual.houses * 2);
    assert.ok(visual.houses >= 1);
    assert.equal(visual.landmarks[0], 'launchpad');
    assert.equal(visual.buildings.length, buildings.length);
    assert.equal(visual.landmarks.length + visual.summarizedBuildings.length, buildings.length);
    assert.ok(visual.parts.some(part => part.id === 'construction:order-aqueduct:foundation'));
    assert.ok(visual.parts.some(part => part.id.startsWith('damage-')));
    assert.equal(visual.parts.some(part => part.id === 'operation:kiln:smoke'), detail !== 'far' && visual.landmarks.includes('kiln'));
    assert.deepEqual(settlementVisual({ ...input, civId, buildings: buildings.toReversed() }, detail), visual);
    assert.deepEqual(homes(visual.parts), homes(settlementVisual({ ...input, civId, terminal: true }, detail).parts).slice(0, visual.houses * 2));
  }
  for (const detail of details) {
    const active = { ...city, buildings: ['launchpad', 'kiln'], round: input.round, buildingOperations: input.buildingOperations };
    const visual = settlementVisual(active, detail);
    assert.equal(visual.parts.some(part => part.id === 'operation:kiln:smoke'), detail !== 'far');
    assert.ok(!settlementVisual({ ...active, terminal: true }, detail).parts.some(part => part.id.startsWith('operation:')));
  }
  assert.deepEqual(input, before);
});

await test('flat faces and Three instances share finite canonical parts for five families at every stage and LOD', () => {
  for (const buildings of [[], ['academy'], ['factory'], ['launchpad']]) {
    const state = createWorld(1701);
    state.cities = Array.from({ length: 5 }, (_, civId) => ({ ...state.cities[civId]!, population: 28, buildings: [...buildings] }));
    const world = projectWorld(state);
    const material = new THREE.MeshBasicMaterial();
    const meshes = createSettlementMeshes(world, () => material);
    for (const [pixels, detail] of [[24, 'far'], [60, 'mid'], [110, 'close']] as const) {
      assert.equal(meshes.update(pixels), detail);
      const visuals = world.cities.map(town => settlementVisual(town.settlement!, detail));
      for (const visual of visuals) {
        const faces = flatSceneFaces(visual.parts);
        assert.equal(new Set(faces.map(face => face.part.id)).size, visual.parts.length);
        assert.ok(visual.parts.every(part => transformedVertices(part).every(vertex => vertex.every(Number.isFinite))));
      }
      let count = 0;
      for (const child of meshes.group.children) if (child instanceof THREE.InstancedMesh) {
        count += child.count;
        for (let index = 0; index < child.count; index++) {
          const matrix = new THREE.Matrix4();
          child.getMatrixAt(index, matrix);
          assert.ok(matrix.elements.every(Number.isFinite));
        }
      }
      assert.equal(count, visuals.reduce((sum, visual) => sum + visual.parts.length, 0));
    }
    meshes.dispose();
    material.dispose();
  }
});
