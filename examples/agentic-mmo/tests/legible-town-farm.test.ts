import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import type { City } from '../core/types.ts';
import { allocateBuildingParts, buildingAppearance, placeBuildingParts } from '../visuals/building-visuals.ts';
import { allocateMapHierarchy } from '../visuals/map-hierarchy.ts';
import { settlementConstruction, settlementLandmarks, settlementOperationParts } from '../visuals/settlement-development.ts';
import { settlementHomeParts } from '../visuals/settlement-homes.ts';
import { townPlanV1 } from '../visuals/town-plan.ts';
import type { TownLot } from '../visuals/town-plan.ts';
import { DETAIL_BUDGETS, SETTLEMENT_RENDER_SCALE, settlementVisual } from '../visuals/world-visuals.ts';
import type { DetailLevel, SettlementFacts, VisualPart } from '../visuals/world-visuals.ts';
import { flatMapPoint, flatSceneFaces, transformedVertices } from '../web/settlement-parts.ts';

const city: SettlementFacts = { id: 'legible-farm', worldSeed: 73, civId: 1, tileId: 405, name: 'Town', population: 6, wellbeing: 65, damage: 0, buildings: [] };
const details: DetailLevel[] = ['far', 'mid', 'close'];
const beds = [
  { left: .55, right: .96, back: -.48, front: -.12 },
  { left: .51, right: .78, back: -.68, front: -.48 },
];
const paidOrder = (buildingId = 'farm'): NonNullable<City['construction']> => ({ active: {
  id: `paid-${buildingId}`, cityId: city.id, tileId: city.tileId, buildingId, ruleVersion: 1, startedRound: 3,
  paid: { materials: 8, credits: 4 }, workDone: 0, workRequired: 4,
}, lastCompleted: null });
const farmParts = (parts: readonly VisualPart[]): VisualPart[] => parts.filter(part => part.id.startsWith('farm-') || part.id.startsWith('construction:paid-farm:'));
const bounds = (part: VisualPart) => {
  const vertices = transformedVertices(part);
  return { left: Math.min(...vertices.map(vertex => vertex[0])), right: Math.max(...vertices.map(vertex => vertex[0])),
    back: Math.min(...vertices.map(vertex => vertex[2])), front: Math.max(...vertices.map(vertex => vertex[2])) };
};
const lotBounds = (lot: TownLot) => ({ left: lot.x - lot.width / 2, right: lot.x + lot.width / 2, back: lot.z - lot.depth / 2, front: lot.z + lot.depth / 2 });
const overlaps = (a: typeof beds[number], b: typeof beds[number]): boolean => a.left < b.right - 1e-10 && a.right > b.left + 1e-10 && a.back < b.front - 1e-10 && a.front > b.back + 1e-10;
const near = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

await test('installed Farm uses the exact two stepped beds and low broad crop bands at every LOD', () => {
  for (const detail of details) {
    const visual = settlementVisual({ ...city, buildings: ['farm'] }, detail);
    const parts = farmParts(visual.parts);
    assert.equal(parts.length, detail === 'far' ? 3 : 7);
    const soil = parts.filter(part => part.material === 'soil');
    assert.equal(soil.length, 2);
    for (const [index, part] of soil.entries()) {
      const footprint = bounds(part);
      for (const key of ['left', 'right', 'back', 'front'] as const) near(footprint[key], beds[index]![key]);
      near(part.position[1] - part.scale[1] / 2, 0);
    }
    const crops = parts.filter(part => part.material === 'crop' || part.material === 'grain');
    assert.equal(crops.length, detail === 'far' ? 1 : 3);
    assert.ok(crops.every(part => part.scale[0] >= .23 - 1e-10 && part.scale[2] >= .14 - 1e-10));
    assert.ok(crops.every(part => part.position[1] + part.scale[1] / 2 <= .12));
    assert.equal(parts.filter(part => part.material === 'stone').length, detail === 'far' ? 0 : 2);
    for (const part of parts) {
      const footprint = bounds(part);
      assert.ok(beds.some(bed => footprint.left >= bed.left - 1e-10 && footprint.right <= bed.right + 1e-10 && footprint.back >= bed.back - 1e-10 && footprint.front <= bed.front + 1e-10));
      assert.ok(transformedVertices(part).every(([x, , z]) => Math.abs(x) * SETTLEMENT_RENDER_SCALE <= Math.sqrt(3) / 2 && (Math.abs(z) + Math.abs(x) / Math.sqrt(3)) * SETTLEMENT_RENDER_SCALE <= 1));
    }
    assert.ok(flatSceneFaces(parts, .72).some(face => crops.includes(face.part)));
    assert.deepEqual(visual.landmarks, ['farm']);
  }
});

await test('Farm core allocation keeps both ground steps and a crop cue before optional detail', () => {
  for (const detail of details) {
    const appearance = buildingAppearance('farm', detail);
    assert.ok(appearance);
    const parts = allocateBuildingParts([appearance], 3);
    assert.equal(parts.length, 3);
    assert.equal(parts.filter(part => part.material === 'soil').length, 2);
    assert.equal(parts.filter(part => part.material === 'crop' || part.material === 'grain').length, 1);
    assert.deepEqual(new Set(parts.map(part => part.id)), new Set(appearance.corePartIds));
  }
});

await test('paid Farm beds remain unfinished through full recorded work and disappear without matching active paid facts', () => {
  for (const detail of details) for (const workDone of [0, 1, 3, 4, 8]) {
    const construction = paidOrder();
    assert.ok(construction.active);
    construction.active.workDone = workDone;
    const input = { ...city, construction };
    const before = structuredClone(input);
    const visual = settlementVisual(input, detail);
    const parts = farmParts(visual.parts);
    assert.equal(parts.length, detail === 'far' ? 3 : 5);
    assert.equal(parts.filter(part => part.material === 'soil').length, 2);
    for (const part of parts) {
      const footprint = bounds(part);
      assert.ok(beds.some(bed => footprint.left >= bed.left - 1e-10 && footprint.right <= bed.right + 1e-10 && footprint.back >= bed.back - 1e-10 && footprint.front <= bed.front + 1e-10));
      assert.ok(transformedVertices(part).every(([x, , z]) => Math.abs(x) * SETTLEMENT_RENDER_SCALE <= Math.sqrt(3) / 2 && (Math.abs(z) + Math.abs(x) / Math.sqrt(3)) * SETTLEMENT_RENDER_SCALE <= 1));
    }
    assert.ok(parts.some(part => part.material === 'timber'));
    assert.ok(parts.every(part => part.material !== 'crop' && part.material !== 'grain' && !part.id.startsWith('farm-')));
    assert.equal(visual.construction?.workDone, workDone);
    assert.equal(visual.construction?.workRequired, 4);
    assert.deepEqual(visual.construction?.paid, { materials: 8, credits: 4 });
    assert.deepEqual(input, before);
    const active = construction.active;
    for (const invalid of [{ ...active, cityId: 'elsewhere' }, { ...active, tileId: 99 }, { ...active, paid: {} }, { ...active, paid: { materials: 0 } }]) {
      const rejected = settlementVisual({ ...city, construction: { active: invalid, lastCompleted: null } }, detail);
      assert.equal(rejected.construction, null);
      assert.equal(farmParts(rejected.parts).length, 0);
    }
    const installed = settlementVisual({ ...input, buildings: ['farm'] }, detail);
    assert.equal(installed.construction, null);
    assert.ok(farmParts(installed.parts).some(part => part.material === 'grain'));
    assert.ok(installed.parts.every(part => !part.id.startsWith('construction:')));
  }
  const historical = { active: null, lastCompleted: { orderId: 'old-farm', cityId: city.id, buildingId: 'farm', startedRound: 1, completedRound: 3, paid: { materials: 8, credits: 4 }, workRequired: 4, eventId: 'farm-complete' } };
  assert.equal(farmParts(settlementVisual({ ...city, construction: historical }, 'close').parts).length, 0);
});

await test('finite town families keep homes, selected neighbors, original support sizes and budgets around paid or built fields', () => {
  const families = new Set<string>();
  const displacedKinds = new Set<string>();
  for (let worldSeed = 0; worldSeed < 12; worldSeed++) for (let civId = 0; civId < 5; civId++) for (const detail of details) {
    for (const input of [
      { ...city, worldSeed, civId, population: 10000, damage: 100, buildings: ['farm'] },
      { ...city, worldSeed, civId, population: 10000, damage: 100, buildings: ['farm', 'workshop', 'kiln'] },
      { ...city, worldSeed, civId, population: 10000, damage: 100, buildings: ['farm', 'academy', 'granary'] },
      { ...city, worldSeed, civId, population: 10000, damage: 100, buildings: ['farm', 'workshop', 'irrigation'], construction: paidOrder('kiln') },
      { ...city, worldSeed, civId, population: 10000, damage: 100, buildings: ['academy', 'granary', 'kiln'], construction: paidOrder() },
    ]) {
      const before = structuredClone(input);
      const plan = townPlanV1(input);
      families.add(plan.topology);
      const visual = settlementVisual(input, detail);
      const construction = settlementConstruction(input, detail);
      const appearances = settlementLandmarks(input, detail, construction.facts !== null);
      const sites = [plan.landmarkLot, ...plan.supportLots];
      const farmIndex = visual.landmarks.indexOf('farm');
      const activeFarm = visual.construction?.buildingId === 'farm';
      const occupied = farmIndex >= 0 || activeFarm;
      assert.deepEqual(visual.landmarks, appearances.map(appearance => appearance.id));
      assert.equal(visual.houses, detail === 'far' ? 3 : detail === 'mid' ? 4 : appearances.length > 2 || visual.construction ? 5 : 6);
      assert.ok(visual.parts.length <= DETAIL_BUDGETS[detail].parts);
      assert.equal(visual.buildings.length, input.buildings.length);
      assert.equal(new Set(visual.parts.map(part => part.id)).size, visual.parts.length);
      assert.ok(visual.parts.every(part => [...part.position, ...part.scale, part.rotation].every(Number.isFinite)));
      assert.equal(farmParts(visual.parts).length > 0, occupied);
      const expectedHomes = settlementHomeParts(input, visual.development.stage, plan.homeLots.slice(0, visual.houses));
      assert.deepEqual(visual.parts.filter(part => /^home-\d+-/.test(part.id)), expectedHomes);
      for (const part of farmParts(visual.parts)) {
        for (const lot of [...plan.homeLots, plan.approach, plan.constructionLot]) assert.ok(!overlaps(bounds(part), lotBounds(lot)), `${detail}/${part.id}/${lot.id}`);
      }
      for (const [index, appearance] of appearances.entries()) {
        if (appearance.id === 'farm') continue;
        const original = sites[index]!;
        const displaced = occupied && original.id.startsWith('support-') && original.x > 0;
        const free = farmIndex >= 0 ? sites[farmIndex]! : plan.supportLots.find(lot => lot.x < 0)!;
        const site = displaced ? { ...original, x: free.x, z: free.z } : original;
        if (displaced) displacedKinds.add(activeFarm ? 'active' : free.id === 'landmark' ? 'landmark' : 'support');
        const expected = placeBuildingParts(appearance.parts, buildingAppearance(appearance.id, 'close')!.parts, site);
        for (const part of visual.parts.filter(part => part.id.startsWith(`${appearance.id}-`))) {
          assert.deepEqual(part, expected.find(candidate => candidate.id === part.id));
          for (const bed of farmParts(visual.parts)) assert.ok(!overlaps(bounds(part), bounds(bed)), `${detail}/${appearance.id}/${bed.id}`);
        }
        for (const id of appearance.corePartIds) assert.ok(visual.parts.some(part => part.id === id));
      }
      for (const [index, lot] of plan.homeLots.entries()) for (const part of visual.parts.filter(part => part.id.startsWith(`home-${index}-`))) {
        for (const [x, , z] of transformedVertices(part)) assert.ok(x >= lot.x - lot.width / 2 - 1e-10 && x <= lot.x + lot.width / 2 + 1e-10 && z >= lot.z - lot.depth / 2 - 1e-10 && z <= lot.z + lot.depth / 2 + 1e-10);
      }
      assert.deepEqual(input, before);
    }
  }
  assert.deepEqual([...families].sort(), ['crescent', 'ridge-terrace', 'split-court']);
  assert.deepEqual([...displacedKinds].sort(), ['active', 'landmark', 'support']);
});

await test('84px flat and fixed Three source projections clear the selected crest and nominal caption without moving marks', () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 160);
  camera.position.set(19, 29, 31);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const a = new THREE.Vector3(-1, 0, 0).project(camera);
  const b = new THREE.Vector3(1, 0, 0).project(camera);
  const screenScale = 84 / Math.hypot(b.x - a.x, b.y - a.y);
  for (const detail of details) for (const source of [{ ...city, buildings: ['farm'] }, { ...city, construction: paidOrder() }]) {
    const vertices = farmParts(settlementVisual(source, detail).parts).flatMap(transformedVertices);
    const flat = vertices.map(([x, y, z]) => flatMapPoint(x * SETTLEMENT_RENDER_SCALE * 42, z * SETTLEMENT_RENDER_SCALE * 42, y * SETTLEMENT_RENDER_SCALE * 42));
    const three = vertices.map(vertex => new THREE.Vector3(...vertex).multiplyScalar(SETTLEMENT_RENDER_SCALE).project(camera));
    const flatLeft = Math.min(...flat.map(point => point.x));
    const threeLeft = Math.min(...three.map(point => point.x * screenScale));
    assert.ok(flatLeft - 14 >= 2, `${detail}: flat crest gap ${flatLeft - 14}`);
    assert.ok(threeLeft - 15 >= 2, `${detail}: Three badge gap ${threeLeft - 15}`);
    assert.ok(Math.max(...flat.map(point => point.z)) < 13);
    assert.ok(Math.max(...three.map(point => -point.y * screenScale)) < 13);
    for (const frame of [
      { width: 1280, height: 900, x: 640, y: 400, blocked: [{ left: 960, top: 80, width: 310, height: 700 }] },
      { width: 390, height: 844, x: 195, y: 260, blocked: [{ left: 0, top: 500, width: 390, height: 344 }] },
    ]) for (const selected of [false, true]) {
      const placement = allocateMapHierarchy([{ id: city.id, kind: 'town', label: city.name, x: frame.x, y: frame.y, selected }], { ...frame, tileDiameter: 84 }).items[0]!;
      assert.ok(placement.mark && placement.label);
      assert.equal(placement.mark.left + placement.mark.width / 2, frame.x);
      assert.equal(placement.mark.top + placement.mark.height / 2, frame.y - 14);
      assert.equal(placement.mark.width, 44);
      assert.ok(placement.label.top >= frame.y + 13);
    }
  }
});

await test('a displaced operating support keeps its smoke aligned at its original scale', () => {
  let moved = 0;
  for (let worldSeed = 0; worldSeed < 12; worldSeed++) {
    const input = { ...city, worldSeed, civId: 0, buildings: ['academy', 'kiln'], construction: paidOrder(), round: 8,
      buildingOperations: { kiln: { enabled: true, lastResult: { round: 8, status: 'operated' as const, paid: { energy: 2 }, produced: { materials: 4 }, shortages: [] } } } };
    const plan = townPlanV1(input);
    const original = plan.supportLots[0]!;
    const free = plan.supportLots.find(lot => lot.x < 0)!;
    const site = original.x > 0 ? { ...original, x: free.x, z: free.z } : original;
    if (original.x > 0) moved++;
    const visual = settlementVisual(input, 'close');
    const expected = placeBuildingParts(settlementOperationParts(input, 'close'), buildingAppearance('kiln', 'close')!.parts, site);
    assert.deepEqual(visual.parts.filter(part => part.id.startsWith('operation:')), expected);
    assert.equal(expected.length, 1);
  }
  assert.ok(moved > 0 && moved < 12);
});

await test('installed fields do not invent current operation or appear from summarized inventory', () => {
  const installed = { ...city, buildings: ['farm'], round: 8 };
  const expected = settlementVisual(installed, 'close');
  for (const operation of [
    { enabled: true, lastResult: null },
    { enabled: false, lastResult: null },
    { enabled: true, lastResult: { round: 7, status: 'operated' as const, paid: {}, produced: { food: 4 }, shortages: [] } },
    { enabled: true, lastResult: { round: 8, status: 'blocked' as const, paid: {}, produced: {}, shortages: [] } },
  ]) assert.deepEqual(settlementVisual({ ...installed, buildingOperations: { farm: operation } }, 'close'), expected);
  const hidden = settlementVisual({ ...city, civId: 0, buildings: ['launchpad', 'academy', 'aqueduct', 'farm'] }, 'close');
  assert.ok(!hidden.landmarks.includes('farm'));
  assert.equal(farmParts(hidden.parts).length, 0);
  assert.ok(hidden.buildings.some(badge => badge.icon === 'farm'));
  assert.ok(expected.parts.every(part => !part.id.startsWith('operation:')));
});
