import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { ImprovementOperationResult } from '../core/types.ts';
import type { DrainageEdgeView, DrainageView } from '../visuals/drainage-visuals.ts';
import { hexPosition, projectTerrainSurface } from '../visuals/landscape.ts';
import type { LandscapeTile, TerrainPoint, TerrainSurface } from '../visuals/landscape.ts';
import { RIVER_INTAKE_MARK_PATH, riverIntakeParts, riverIntakeWorking } from '../visuals/river-intake-visuals.ts';
import { CHARCOAL_MARK_PATH, IMPROVEMENT_PART_BUDGETS, improvementMark, improvementParts } from '../visuals/improvement-visuals.ts';
import type { ImprovementView } from '../visuals/improvement-visuals.ts';
import { HILLSIDE_COMMONWORKS_MARK_PATH } from '../visuals/hillside-commonworks-visuals.ts';
import { SHORE_FISHERY_MARK_PATH } from '../visuals/shore-fishery-visuals.ts';
import { SITE_MARK_PATHS } from '../visuals/strategic-resource-visuals.ts';
import { workedLandCompositionV1 } from '../visuals/worked-land-composition.ts';
import { VISUAL_PALETTE } from '../visuals/world-visuals.ts';
import type { DetailLevel, VisualPart } from '../visuals/world-visuals.ts';
import type { AtlasWorld } from '../web/atlas.ts';
import { createImprovementMeshes } from '../web/settlement-three.ts';
import { flatMapPoint, flatSceneFaces, shapeTriangles, transformedVertices } from '../web/settlement-parts.ts';

const details: readonly DetailLevel[] = ['far', 'mid', 'close'];
const steps = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;

function fixture(direction = 0, mouth = false, junction = false, tileId = 70): { view: ImprovementView; world: AtlasWorld } {
  const source: LandscapeTile = { id: tileId, q: 2.5, r: -1.5, owner: 0, terrain: 'grassland', height: .41 };
  const tiles: LandscapeTile[] = [source, ...steps.flatMap(([dq, dr], index): LandscapeTile[] => mouth && index === direction ? [] : [{
    id: tileId + index + 1, q: source.q + dq, r: source.r + dr, owner: 0, terrain: 'grassland',
    height: index === direction ? .29 : .44 + index * .005,
  }])];
  const center = hexPosition(source.q, source.r); const step = steps[direction]!;
  const downstream = hexPosition(source.q + step[0], source.r + step[1]);
  const edge: DrainageEdgeView = { id: `drainage:1:${tileId}:${tileId + direction + 1}`, fromTileId: tileId,
    toTileId: tileId + direction + 1, outletTileId: 1000, contributingLandTiles: 40, mouth,
    points: [[center.x, source.height, center.z], mouth ? [(center.x + downstream.x) / 2, 0, (center.z + downstream.z) / 2] : [downstream.x, .29, downstream.z]] };
  const incoming: DrainageEdgeView[] = junction ? tiles.filter(tile => tile.id !== source.id && tile.id !== edge.toTileId).map(tile => {
    const point = hexPosition(tile.q, tile.r);
    return { id: `drainage:1:${tile.id}:${source.id}`, fromTileId: tile.id!, toTileId: source.id!, outletTileId: edge.outletTileId,
      contributingLandTiles: 8, mouth: false, points: [[point.x, tile.height, point.z], [center.x, source.height, center.z]] };
  }) : [];
  const drainage: DrainageView = { kind: 'retained', reason: null, edges: [edge, ...incoming] };
  const surface = projectTerrainSurface(tiles, drainage).find(surface => surface.key === `${source.q},${source.r}`)!;
  const view: ImprovementView = { id: 'conditional:river-town:intake', cityId: 'river-town', townName: 'River town', civId: 0,
    improvementId: 'river-intake', name: 'River intake', tileId, worldSeed: 1701, q: source.q, r: source.r, height: source.height,
    color: '#8eaa53', status: 'built', construction: null,
    completion: { kind: 'improvement', orderId: `conditional:intake:${tileId}`, cityId: 'river-town', improvementId: 'river-intake', tileId,
      startedRound: 2, completedRound: 5, paid: { materials: 8, credits: 4 }, workRequired: 4, eventId: 'conditional:5' },
    operation: { enabled: true, lastResult: null }, baseProduction: { food: 3 }, residentsRequired: 1,
    riverIntake: { surface, edge, round: 6, terminal: false, eligible: true, receiptCurrent: true } };
  return { view, world: { tiles, cities: [], routes: [], improvements: [view], drainage } };
}

function result(view: ImprovementView): ImprovementOperationResult {
  return { round: 6, status: 'operated', paid: { materials: 1 }, produced: { food: 2.8 },
    residents: { ruleVersion: 1, openingPopulation: 12, communityReserve: 3, required: 1, available: 3, allocated: 1 },
    inputs: [{ resource: 'materials', required: 1, available: 2 }], shortages: [], blockedReason: null,
    river: { ruleVersion: 1, ruleId: 'uniform-runoff-1', tileId: view.tileId, downstreamTileId: view.riverIntake!.edge.toTileId,
      outletTileId: 1000, required: 8, availableBefore: 12, withdrawn: 8, remainingAfter: 4, supportBuildingId: 'irrigation', supportAllocationRound: 6 } };
}

function part(parts: readonly VisualPart[], suffix: string): VisualPart {
  const found = parts.find(part => part.id.endsWith(`:intake-${suffix}`)); assert.ok(found, suffix); return found;
}

function freeze(value: object): void {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
}

function surfaceAt(surface: TerrainSurface, x: number, z: number): Array<{ height: number; kind: string | undefined; edgeId: string | undefined }> {
  return surface.faces.flatMap(face => face.points.slice(1, -1).flatMap((_, index) => {
    const a = face.points[0]!; const b = face.points[index + 1]!; const c = face.points[index + 2]!;
    const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(denominator) < 1e-12) return [];
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
    return u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9 ? [{ height: a[1] * u + b[1] * v + c[1] * (1 - u - v), kind: face.kind, edgeId: face.drainageEdgeId }] : [];
  }));
}

function footprintSamples(view: ImprovementView, part: VisualPart, divisions = 4): TerrainPoint[] {
  const origin = hexPosition(view.q, view.r); const cosine = Math.cos(part.rotation); const sine = Math.sin(part.rotation);
  return Array.from({ length: divisions + 1 }, (_, i) => i / divisions - .5).flatMap(x =>
    Array.from({ length: divisions + 1 }, (_, i) => i / divisions - .5).map(z => [
      origin.x + part.position[0] + x * part.scale[0] * cosine + z * part.scale[2] * sine,
      view.height + part.position[1], origin.z + part.position[2] - x * part.scale[0] * sine + z * part.scale[2] * cosine,
    ] as const));
}

await test('all six nonflat banks, sea mouths and confluences keep timber gates attached and local dry furrows on exact ground', () => {
  assert.deepEqual(IMPROVEMENT_PART_BUDGETS, { far: 10, mid: 15, close: 20 });
  for (let direction = 0; direction < 6; direction++) for (const [mouth, junction] of [[false, false], [true, false], [false, true]] as const) {
    const { view, world } = fixture(direction, mouth, junction); const before = structuredClone(world); freeze(world);
    const surface = view.riverIntake!.surface;
    assert.ok(new Set(surface.rim.map(point => point[1])).size > 1);
    for (const detail of details) {
      const parts = improvementParts(view, detail);
      assert.equal(parts.length, detail === 'far' ? 9 : detail === 'mid' ? 13 : 17, `${direction}/${mouth}/${junction}/${detail}`);
      assert.equal(parts.filter(part => /^.*:intake-furrow-\d$/.test(part.id)).length, 4);
      const tray = part(parts, 'bank-tray');
      assert.ok(footprintSamples(view, tray, 12).some(([x, , z]) => surfaceAt(surface, x, z).some(face => face.kind === 'channel' && face.edgeId === view.riverIntake!.edge.id)));
      assert.ok(tray.scale[0] <= .14 && tray.scale[2] <= .15);
      assert.ok(parts.every(part => part.material !== 'water' && part.material !== 'crop' && part.material !== 'identity'));
      for (const body of parts.filter(part => /:intake-(gate-post-\d|sluice-gate|bank-tray|furrow-\d)$/.test(part.id))) {
        for (const [x, , z] of footprintSamples(view, body)) {
          const points = surfaceAt(surface, x, z); assert.ok(points.length > 0, body.id);
          const floor = view.height + body.position[1] - body.scale[1] / 2;
          const ceiling = view.height + body.position[1] + body.scale[1] / 2;
          assert.ok(points.every(point => floor <= point.height + 1e-9 && ceiling >= point.height - 1e-9), body.id);
          if (body.id.includes(':intake-furrow-')) assert.ok(points.some(point => point.kind === 'ground') && points.every(point => point.kind !== 'channel'), body.id);
        }
      }
      for (const entry of parts) {
        assert.ok([...entry.position, ...entry.scale, entry.rotation].every(Number.isFinite));
        assert.ok(entry.scale.every(value => value > 0));
        for (const [x, , z] of transformedVertices(entry)) for (const [dq, dr] of steps) {
          const normal = hexPosition(dq, dr); const length = Math.hypot(normal.x, normal.z);
          assert.ok(x * normal.x / length + z * normal.z / length <= Math.sqrt(3) / 2 + 1e-9, entry.id);
        }
      }
      assert.equal(new Set(parts.map(part => part.id)).size, parts.length);
      assert.ok(parts.length <= IMPROVEMENT_PART_BUDGETS[detail]);
    }
    assert.deepEqual(world, before);
  }
});

await test('construction has only supported stakes and a small gate frame, never completed plots or earned production', () => {
  const { view } = fixture(4, false, true);
  const pending: ImprovementView = { ...view, status: 'building', completion: null,
    construction: { kind: 'improvement', id: 'conditional:intake:70', cityId: view.cityId, improvementId: view.improvementId,
      tileId: view.tileId, ruleVersion: 1, startedRound: 2, paid: { materials: 8, credits: 4 }, workRequired: 4, workDone: 1 },
    operation: { enabled: true, lastResult: result(view) } };
  for (const detail of details) {
    const parts = improvementParts(pending, detail);
    assert.equal(parts.length, 7);
    assert.ok(parts.every(part => part.material === 'timber' && /:intake-(frame|plot-stake)/.test(part.id)));
    assert.deepEqual(parts, improvementParts({ ...pending, construction: { ...pending.construction!, workDone: 3 } }, detail));
    for (const entry of parts.filter(part => !part.id.endsWith('frame-beam'))) {
      for (const [x, , z] of footprintSamples(pending, entry)) {
        const points = surfaceAt(pending.riverIntake!.surface, x, z); assert.ok(points.length > 0);
        assert.ok(points.every(point => pending.height + entry.position[1] - entry.scale[1] / 2 <= point.height + 1e-9));
      }
    }
  }
  assert.equal(riverIntakeWorking(pending), false);
});

await test('only an enabled eligible nonterminal current full paid receipt with positive actual Food shows green plots and static water', () => {
  const { view } = fixture(); const receipt = result(view);
  const operated: ImprovementView = { ...view, operation: { enabled: true, lastResult: receipt } };
  assert.equal(riverIntakeWorking(operated), true);
  const variants: Array<(view: ImprovementView) => void> = [
    value => { value.operation = null; }, value => { value.operation!.lastResult = null; }, value => { value.operation!.enabled = false; },
    value => { value.operation!.lastResult!.status = 'blocked'; }, value => { value.operation!.lastResult!.status = 'paused'; },
    value => { value.operation!.lastResult!.blockedReason = 'flow-shortage'; }, value => { value.riverIntake!.eligible = false; },
    value => { value.riverIntake!.terminal = true; }, value => { value.riverIntake!.receiptCurrent = false; },
    value => { value.riverIntake!.round++; }, value => { value.operation!.lastResult!.round--; },
    value => { value.completion = null; }, value => { value.completion!.completedRound = 6; },
    value => { value.completion!.tileId++; }, value => { value.completion!.cityId = 'another-town'; },
    value => { value.operation!.lastResult!.paid = {}; }, value => { value.operation!.lastResult!.residents.allocated = 0; },
    value => { delete value.operation!.lastResult!.river; }, value => { value.operation!.lastResult!.river!.tileId++; },
    value => { value.operation!.lastResult!.river!.downstreamTileId++; }, value => { value.operation!.lastResult!.river!.outletTileId++; },
    value => { value.operation!.lastResult!.river!.supportAllocationRound = 5; }, value => { value.operation!.lastResult!.river!.supportAllocationRound = null; },
    value => { value.operation!.lastResult!.river!.withdrawn = 0; }, value => { value.operation!.lastResult!.river!.remainingAfter++; },
    value => { value.operation!.lastResult!.river!.availableBefore = 7; }, value => { value.operation!.lastResult!.river!.required = 7; },
    ...[0, -1, NaN, Infinity].map(food => (value: ImprovementView) => { value.operation!.lastResult!.produced = { food }; }),
    value => { value.operation!.lastResult!.produced = { materials: 99 }; },
  ];
  for (const detail of details) {
    const dry = improvementParts(view, detail); const wet = improvementParts(operated, detail);
    assert.equal(wet.length, dry.length + 1);
    assert.equal(wet.filter(part => part.material === 'crop').length, 4);
    assert.equal(wet.filter(part => part.material === 'water').length, 1);
    assert.deepEqual(wet.filter(part => !part.id.endsWith('recorded-water')).map(part => part.material === 'crop' ? { ...part, material: 'soil' } : part), dry);
    for (const mutate of variants) {
      const inactive = structuredClone(operated); mutate(inactive); inactive.baseProduction = { food: 9999 };
      assert.equal(riverIntakeWorking(inactive), false);
      assert.deepEqual(improvementParts(inactive, detail), dry);
    }
  }
});

await test('missing, mismatched or malformed exact channel facts refuse geometry rather than inventing a centered intake', () => {
  const { view } = fixture();
  const variants: Array<(view: ImprovementView) => void> = [
    value => { delete value.riverIntake; }, value => { value.riverIntake = null; }, value => { value.tileId++; },
    value => { value.q++; }, value => { value.r++; }, value => { value.height += .01; },
    value => { value.riverIntake!.edge.fromTileId++; }, value => { value.riverIntake!.edge.toTileId++; },
    value => { value.riverIntake!.edge.id = 'invented-channel'; }, value => { value.riverIntake!.edge.contributingLandTiles = 7; },
    value => { value.riverIntake!.edge.points = [[0, 0, 0], value.riverIntake!.edge.points[1]]; },
    value => { value.riverIntake!.surface.faces = value.riverIntake!.surface.faces.filter(face => face.kind !== 'channel'); },
    value => { value.riverIntake!.surface.faces = value.riverIntake!.surface.faces.filter(face => face.kind !== 'bank'); },
    value => { value.riverIntake!.surface.faces = value.riverIntake!.surface.faces.filter(face => face.kind !== 'ground'); },
    value => { value.riverIntake!.surface.faces[0]!.points[0] = [NaN, 0, 0]; },
  ];
  for (const mutate of variants) {
    const malformed = structuredClone(view); mutate(malformed);
    for (const detail of details) assert.deepEqual(improvementParts(malformed, detail), []);
  }
});

await test('seed and authoritative tile provide stable bounded variety, while city identity never reflects the actual channel attachment', t => {
  const random = t.mock.method(Math, 'random', () => { throw new Error('No runtime random visuals'); });
  const layouts = new Set<string>(); let genericReflectionWouldChange = false;
  for (const seed of [0, 1, 1701, 90421]) for (const tileId of [70, 90]) {
    const { view } = fixture(2, false, false, tileId); view.worldSeed = seed;
    const raw = riverIntakeParts(view, 'close'); layouts.add(JSON.stringify(raw));
    for (const cityId of ['river-town', 'city-0', 'city-1', 'city-2']) {
      const renamed = { ...view, cityId, townName: 'Changed name', name: 'Changed caption', color: '#ffffff', civId: 4,
        completion: { ...view.completion!, cityId }, baseProduction: { food: 999 } };
      assert.deepEqual(improvementParts(renamed, 'close'), raw);
      genericReflectionWouldChange ||= JSON.stringify(workedLandCompositionV1(renamed, raw)) !== JSON.stringify(raw);
    }
    const withoutSeed = { ...view }; delete withoutSeed.worldSeed;
    assert.deepEqual(improvementParts(withoutSeed, 'close'), improvementParts({ ...view, worldSeed: 0 }, 'close'));
    const before = structuredClone(view); freeze(view);
    raw[0]!.position = [99, 99, 99];
    assert.ok(improvementParts(view, 'close').every(part => part.position[0] !== 99));
    assert.deepEqual(view, before);
  }
  assert.ok(layouts.size >= 4); assert.ok(genericReflectionWouldChange); assert.equal(random.mock.callCount(), 0);
});

await test('LOD revisits only add stable details and the sluice marker is not a mine, fishery, commonworks or charcoal mark', () => {
  assert.equal(improvementMark({ improvementId: 'river-intake' }), 'intake');
  for (const path of [SITE_MARK_PATHS.mine, SHORE_FISHERY_MARK_PATH, HILLSIDE_COMMONWORKS_MARK_PATH, CHARCOAL_MARK_PATH]) assert.notEqual(RIVER_INTAKE_MARK_PATH, path);
  for (const working of [false, true]) {
    const { view } = fixture(); if (working) view.operation!.lastResult = result(view);
    const close = improvementParts(view, 'close');
    for (const detail of ['far', 'mid', 'far', 'mid', 'close', 'far', 'close'] as const) {
      const parts = improvementParts(view, detail);
      assert.deepEqual(parts, improvementParts(view, detail));
      for (const part of parts) assert.deepEqual(part, close.find(candidate => candidate.id === part.id));
      assert.ok(parts.length <= IMPROVEMENT_PART_BUDGETS[detail]);
    }
    for (const improvementId of ['mine', 'pasture', 'lumber-mill', 'shore-fishery', 'hill-commons', 'charcoal-clearing']) {
      const other = { ...view, improvementId }; const withoutFacts = { ...other }; delete withoutFacts.riverIntake;
      for (const detail of details) assert.deepEqual(improvementParts(other, detail), improvementParts(withoutFacts, detail));
    }
  }
});

await test('Three instance matrices and flat faces preserve the same actual bank-local geometry through all detail levels', () => {
  const { view, world } = fixture(5, true); view.operation!.lastResult = result(view); const before = structuredClone(world);
  const materials = new Map<string, THREE.MeshBasicMaterial>();
  const meshes = createImprovementMeshes(world, color => { const material = materials.get(color) ?? new THREE.MeshBasicMaterial({ color }); materials.set(color, material); return material; });
  const key = (values: ArrayLike<number>): string => Array.from(values, value => Math.fround(value).toFixed(7)).join(',');
  const origin = hexPosition(view.q, view.r);
  try {
    for (const [diameter, detail] of [[10, 'far'], [60, 'mid'], [100, 'close'], [10, 'far']] as const) {
      assert.equal(meshes.update(diameter), detail);
      const actual = meshes.group.children.flatMap(mesh => {
        assert.ok(mesh instanceof THREE.InstancedMesh && mesh.material instanceof THREE.MeshBasicMaterial);
        const color = mesh.material.color.getHexString();
        return Array.from({ length: mesh.count }, (_, index) => {
          const matrix = new THREE.Matrix4(); mesh.getMatrixAt(index, matrix);
          return `${color}:${key(mesh.geometry.getAttribute('position').array)}:${key(matrix.elements)}`;
        });
      });
      const parts = improvementParts(view, detail);
      const expected = parts.map(part => {
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(origin.x + part.position[0], view.height + part.position[1], origin.z + part.position[2]),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), part.rotation), new THREE.Vector3(...part.scale));
        const color = part.material === 'identity' ? view.color : VISUAL_PALETTE[part.material];
        return `${color.slice(1)}:${key(shapeTriangles(part.shape))}:${key(matrix.elements)}`;
      });
      assert.deepEqual(actual.sort(), expected.sort());
      const faces = flatSceneFaces(parts, .72); assert.ok(faces.length > parts.length);
      for (const face of faces) {
        const possible = transformedVertices(face.part).map(([x, y, z]) => flatMapPoint(x, z, y)).map(point => `${point.x.toFixed(3)},${point.z.toFixed(3)}`);
        assert.ok(face.points.split(' ').every(point => possible.includes(point)));
      }
    }
    assert.deepEqual(world, before);
  } finally { meshes.dispose(); for (const material of materials.values()) material.dispose(); }
});
