import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createWorld } from '../core/engine.ts';
import type { WoodlandStand } from '../core/woodland-types.ts';
import { projectWorld } from '../web/live-world.ts';
import { createLandscapeMeshes } from '../web/landscape-three.ts';
import { flatSceneFaces, transformedVertices, flatMapPoint } from '../web/settlement-parts.ts';
import { improvementParts, improvementMark } from '../visuals/improvement-visuals.ts';
import type { ImprovementView } from '../visuals/improvement-visuals.ts';
import type { VisualPart } from '../visuals/world-visuals.ts';
import { projectLandscape, projectTerrainSurface, landscapeSurface, hexPosition, DRAINAGE_STYLE, LANDSCAPE_BUDGETS } from '../visuals/landscape.ts';
import type { LandscapeTile, TerrainPoint } from '../visuals/landscape.ts';
import type { DrainageView } from '../visuals/drainage-visuals.ts';
import type { WoodlandVisualFacts } from '../visuals/woodland-visuals.ts';

const forest = { id: 12, q: 0, r: 0, owner: 0, terrain: 'forest', height: .3 } as const satisfies LandscapeTile;
const facts = (stock: number, recovered = 0, current = true): WoodlandVisualFacts => ({ stock, capacity: 8, lastHarvestRound: 8, recovered, current });

await test('exact local woodland stock changes stand density and height but retains trees and harvest stumps', () => {
  const baseline = projectLandscape([forest], [], 'close');
  const full = projectLandscape([{ ...forest, woodland: facts(8) }], [], 'close');
  const empty = projectLandscape([{ ...forest, woodland: facts(0) }], [], 'close');
  const fullCanopies = full.parts.filter(part => part.shape === 'canopy');
  const emptyCanopies = empty.parts.filter(part => part.shape === 'canopy');
  assert.ok(emptyCanopies.length < fullCanopies.length);
  assert.ok(emptyCanopies.length > 0);
  assert.ok(empty.parts.some(part => part.id.includes(':stump:')));
  assert.ok(emptyCanopies.every(part => part.scale[1] < Math.max(...fullCanopies.map(canopy => canopy.scale[1]))));
  assert.deepEqual(full, baseline);
  assert.deepEqual(empty.coast, full.coast);
  assert.deepEqual(empty.borders, full.borders);
  assert.deepEqual(empty.territories, full.territories);
  assert.equal(landscapeSurface({ ...forest, woodland: facts(0) }), landscapeSurface(forest));
});

await test('unworked full forest and unrelated terrain preserve their original map presentation', () => {
  const neighbor = { ...forest, id: 13, q: 1 };
  for (const detail of ['far', 'mid', 'close'] as const) {
    const original = projectLandscape([forest, neighbor], [], detail);
    const untouched = projectLandscape([{ ...forest, woodland: { ...facts(8, 0, false), lastHarvestRound: null } }, neighbor], [], detail);
    assert.deepEqual(untouched, original);
    const worked = projectLandscape([{ ...forest, woodland: facts(2) }, neighbor], [], detail);
    assert.deepEqual(worked.parts.filter(part => part.id.startsWith('forest:1,0:')), original.parts.filter(part => part.id.startsWith('forest:1,0:')));
    for (const terrain of ['grassland', 'desert', 'mountain', 'tundra'] as const) {
      assert.deepEqual(projectLandscape([{ ...forest, terrain, woodland: facts(0) }], [], detail), projectLandscape([{ ...forest, terrain }], [], detail));
    }
  }
});

await test('low saplings require positive current recorded recovery rather than stock alone or the render clock', () => {
  const render = (stock: number, recovered: number, current: boolean, lastHarvestRound: number | null = 8) => projectLandscape([{ ...forest, woodland: { ...facts(stock, recovered, current), lastHarvestRound } }], [], 'close').parts;
  const recovering = render(1, 1, true);
  const saplings = recovering.filter(part => part.id.includes(':sapling:'));
  assert.ok(saplings.length > 0);
  assert.ok(saplings.every(part => part.shape === 'canopy' && part.scale[1] >= .16 && part.scale[1] <= .24));
  assert.ok(recovering.some(part => part.id.includes(':stump:')));
  for (const [stock, recovered, current, lastHarvest] of [[1, 0, true, 8], [1, 1, false, 8], [0, 0, true, 8], [8, 0, true, null]] as const) {
    assert.ok(render(stock, recovered, current, lastHarvest).every(part => !part.id.includes(':sapling:')));
  }
  assert.deepEqual(render(1, 1, true), recovering);
  assert.deepEqual(render(8, 1, true), render(8, 0, true));
});

await test('stock progression restores mature canopy coverage and height without shifting planted groups', () => {
  for (const detail of ['far', 'mid', 'close'] as const) {
    let previousArea = -1;
    let previousHeight = -1;
    const complete = projectLandscape([{ ...forest, woodland: facts(8) }], [], detail).parts;
    const positions = new Set(complete.map(part => `${part.position[0]},${part.position[2]}`));
    for (let stock = 0; stock <= 8; stock++) {
      const input = [{ ...forest, woodland: facts(stock) }]; const before = structuredClone(input);
      const parts = projectLandscape(input, [], detail).parts;
      const canopies = parts.filter(part => part.shape === 'canopy');
      const area = canopies.reduce((sum, part) => sum + part.scale[0] * part.scale[2], 0);
      const height = Math.max(...canopies.map(part => part.scale[1]));
      assert.ok(area >= previousArea && height >= previousHeight);
      assert.ok(parts.every(part => positions.has(`${part.position[0]},${part.position[2]}`)));
      assert.deepEqual(input, before);
      previousArea = area; previousHeight = height;
    }
  }
});

await test('lumber stands frame unchanged working ground while charcoal retains its existing full perimeter pair', () => {
  for (const improvementId of ['lumber-mill', 'charcoal-clearing']) {
    const site = { q: 0, r: 0, tileId: forest.id, worldSeed: 73, improvementId };
    for (const detail of ['far', 'mid', 'close'] as const) {
      const original = projectLandscape([forest], [site], detail);
      const full = projectLandscape([{ ...forest, woodland: facts(8) }], [site], detail);
      const empty = projectLandscape([{ ...forest, woodland: facts(0) }], [site], detail);
      const trees = full.parts.filter(part => part.shape === 'canopy');
      assert.ok(trees.length > 0);
      assert.ok(empty.parts.some(part => part.id.includes(':stump:')));
      assert.ok(empty.parts.some(part => part.shape === 'canopy'));
      assert.deepEqual(empty.parts.filter(part => part.id.startsWith('ground:')), original.parts.filter(part => part.id.startsWith('ground:')));
      if (improvementId === 'charcoal-clearing') {
        assert.deepEqual(full, original);
        assert.equal(trees.length, 2);
        assert.ok(trees.every(part => Math.hypot(part.position[0], part.position[2]) - Math.max(part.scale[0], part.scale[2]) / 2 > .5));
      } else {
        assert.equal(trees.length, detail === 'far' ? 3 : detail === 'mid' ? 4 : 6);
        assert.ok(trees.every(part => Math.abs(part.position[0]) >= .75 && part.position[2] <= .07 + 1e-10));
      }
    }
  }
  const mine = { q: 0, r: 0, improvementId: 'mine' };
  assert.deepEqual(projectLandscape([{ ...forest, woodland: facts(0) }], [mine], 'close'), projectLandscape([forest], [mine], 'close'));
});

const neighbors = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;

function overlaps(x: number, z: number, radius: number, polygon: TerrainPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous]!; const b = polygon[index]!;
    if ((a[2] > z) !== (b[2] > z) && x < (b[0] - a[0]) * (z - a[2]) / (b[2] - a[2]) + a[0]) inside = !inside;
    const dx = b[0] - a[0]; const dz = b[2] - a[2];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1)));
    if (Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t) < radius - 1e-10) return true;
  }
  return inside;
}

await test('mature trees, retained stumps and recovery saplings inherit exact river-bank clearance without entering equipment', () => {
  const tiles: LandscapeTile[] = [forest, ...neighbors.map(([q, r], index) => ({ ...forest, id: index + 20, q, r, terrain: 'grassland' as const }))];
  for (const direction of [0, 1, 2, 3, 4, 5]) {
    const target = tiles[direction + 1]!; const center = hexPosition(target.q, target.r);
    const drainage: DrainageView = { kind: 'retained', reason: null, edges: [{ id: `drainage:1:${forest.id}:${target.id}`, fromTileId: forest.id,
      toTileId: target.id!, outletTileId: target.id!, contributingLandTiles: 128, mouth: false,
      points: [[0, forest.height, 0], [center.x, target.height, center.z]] }] };
    const surfaces = projectTerrainSurface(tiles, drainage);
    const corridor = surfaces.flatMap(surface => surface.faces.filter(face => face.kind === 'channel' || face.kind === 'bank'));
    assert.ok(corridor.length > 0);
    for (const improvementId of [undefined, 'lumber-mill', 'charcoal-clearing']) {
      const sites = improvementId ? [{ q: 0, r: 0, tileId: forest.id, worldSeed: 73, improvementId }] : [];
      for (const detail of ['far', 'mid', 'close'] as const) {
        const mature = projectLandscape([{ ...forest, woodland: facts(8) }, ...tiles.slice(1)], sites, detail, drainage);
        const positions = new Set(mature.parts.filter(part => !part.id.startsWith('ground:')).map(part => `${part.position[0]},${part.position[2]}`));
        for (const woodland of [facts(8), facts(0), facts(1, 1)]) {
          const result = projectLandscape([{ ...forest, woodland }, ...tiles.slice(1)], sites, detail, drainage);
          const parts = result.parts.filter(part => !part.id.startsWith('ground:'));
          assert.ok(parts.length > 0);
          assert.ok(parts.some(part => part.shape === 'canopy'));
          for (const part of parts) {
            const radius = Math.max(part.scale[0], part.scale[2]) / 2;
            assert.ok(!corridor.some(face => overlaps(part.position[0], part.position[2], radius + DRAINAGE_STYLE.forestSetback, face.points)), `${improvementId ?? 'forest'} ${detail} ${direction} ${part.id}`);
            assert.ok(positions.has(`${part.position[0]},${part.position[2]}`));
            if (improvementId === 'lumber-mill') {
              assert.ok(Math.abs(part.position[0]) >= .75 && part.position[2] <= .07 + 1e-10);
              assert.ok(neighbors.every((_, index) => part.position[0] * Math.cos(index * Math.PI / 3) + part.position[2] * Math.sin(index * Math.PI / 3) + radius <= Math.sqrt(3) / 2 + 1e-10));
            }
          }
          assert.deepEqual(result.coast, mature.coast);
          assert.deepEqual(result.borders, mature.borders);
        }
      }
    }
  }
});

await test('worked woodland parts obey existing whole-map budgets and deterministic order with no source mutation', () => {
  const tiles = Array.from({ length: 500 }, (_, q) => ({ ...forest, id: q, q, woodland: facts(q % 9, q % 9 === 1 ? 1 : 0) }));
  const sites = tiles.map(tile => ({ q: tile.q, r: tile.r, tileId: tile.id, improvementId: tile.id % 2 ? 'lumber-mill' : 'charcoal-clearing', worldSeed: 73 }));
  const before = structuredClone({ tiles, sites });
  for (const detail of ['far', 'mid', 'close'] as const) {
    const result = projectLandscape(tiles, sites, detail);
    assert.ok(result.parts.length > 0 && result.parts.length <= LANDSCAPE_BUDGETS[detail]);
    assert.equal(new Set(result.parts.map(part => part.id)).size, result.parts.length);
    assert.ok(result.parts.every(part => [...part.position, ...part.scale, part.rotation].every(Number.isFinite)));
    assert.deepEqual(projectLandscape(tiles.toReversed(), sites.toReversed(), detail), result);
  }
  assert.deepEqual({ tiles, sites }, before);
});

await test('flat faces and Three instances use the same retained woodland geometry without a graphics-context claim', () => {
  const tiles = [{ ...forest, woodland: facts(1, 1) }];
  const world = { ...projectWorld(createWorld(73)), tiles, cities: [], districts: [], improvements: [], wonders: [], drainage: null };
  const material = new THREE.MeshBasicMaterial();
  const layer = createLandscapeMeshes(world, () => material);
  try {
    layer.update(60);
    const expected = projectLandscape(tiles, [], 'close').parts;
    assert.equal(layer.group.children.filter(child => child instanceof THREE.InstancedMesh).reduce((sum, mesh) => sum + mesh.count, 0), expected.length);
    const faces = flatSceneFaces(expected);
    assert.ok(faces.some(face => face.part.id.includes(':stump:')));
    assert.ok(faces.some(face => face.part.id.includes(':sapling:')));
    assert.deepEqual(new Set(faces.map(face => face.part.id)), new Set(expected.map(part => part.id)));
  } finally { layer.dispose(); material.dispose(); }
});

await test('fresh projected woodland carries exact local stand facts without inventing a harvest or recovery', () => {
  const state = createWorld(73, '2026-10-24T00:00:00.000Z', 'settlement-renewing-worked-woodlands-1'); const before = structuredClone(state);
  const world = projectWorld(state);
  assert.ok(state.woodlands);
  for (const tile of world.tiles) {
    const stand: WoodlandStand | undefined = state.woodlands.stands[String(tile.id)];
    if (!stand) { assert.ok(!tile.woodland); continue; }
    assert.equal(tile.woodland?.stock, stand.stock);
    assert.equal(tile.woodland?.capacity, 8);
    assert.equal(tile.woodland?.lastHarvestRound, stand.lastHarvestRound);
    assert.equal(tile.woodland?.recovered, 0);
    assert.equal(tile.woodland?.current, false);
  }
  assert.deepEqual(state, before);
});

function bounds(part: VisualPart): { min: number[]; max: number[] } {
  const vertices = transformedVertices(part);
  return { min: [0, 1, 2].map(index => Math.min(...vertices.map(point => point[index]!))), max: [0, 1, 2].map(index => Math.max(...vertices.map(point => point[index]!))) };
}

function overlapsBounds(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>): boolean {
  return [0, 1, 2].every(index => a.min[index]! < b.max[index]! - 1e-10 && a.max[index]! > b.min[index]! + 1e-10);
}

await test('woodland Lumber equipment changes only horizontal composition while flank stands clear every equipment solid', () => {
  const site: ImprovementView = { id: 'fixture-lumber', cityId: 'city-0', townName: 'Conditional woodland fixture', civId: 0,
    improvementId: 'lumber-mill', name: 'Lumber mill', tileId: 100, worldSeed: 1701, q: 0, r: 0, height: .3,
    color: '#78baff', status: 'built', construction: null, completion: null, operation: { enabled: false, lastResult: null },
    baseProduction: { materials: 4 }, residentsRequired: 1 };
  for (const tileId of [100, 101]) for (const detail of ['far', 'mid', 'close'] as const) {
    const original = { ...site, tileId }; const enabled = { ...original, woodland: { ...facts(8), eligible: false, productive: false, reason: null } };
    const baseline = improvementParts(original, detail); const compact = improvementParts(enabled, detail);
    assert.equal(compact.length, baseline.length);
    assert.equal(improvementMark(enabled), improvementMark(original));
    assert.deepEqual(compact.map(part => part.id), baseline.map(part => part.id));
    for (const [index, part] of compact.entries()) {
      const before = baseline[index]!;
      assert.deepEqual(part, { ...before, position: [before.position[0] * .9, before.position[1], before.position[2] * .9], scale: [before.scale[0] * .9, before.scale[1], before.scale[2] * .9] });
    }
    for (const woodland of [facts(8), facts(0), facts(1, 1), facts(4), facts(7)]) {
      const parts = projectLandscape([{ ...forest, id: tileId, woodland }], [enabled], detail).parts.filter(part => part.id.startsWith('lumber-forest:'));
      assert.ok(parts.length > 0 && parts.length <= (detail === 'far' ? 4 : detail === 'mid' ? 8 : 12));
      for (const part of parts) {
        const local: VisualPart = { ...part, position: [part.position[0], part.position[1] - forest.height, part.position[2]] };
        assert.ok(compact.every(equipment => !overlapsBounds(bounds(local), bounds(equipment))), `${tileId}/${detail}/${woodland.stock}/${part.id}`);
        for (const vertex of transformedVertices(local)) assert.ok(neighbors.every((_, direction) => vertex[0] * Math.cos(direction * Math.PI / 3) + vertex[2] * Math.sin(direction * Math.PI / 3) <= Math.sqrt(3) / 2 + 1e-10));
        if (part.id.includes(':stump:')) assert.ok(Math.abs(local.position[1] - local.scale[1] / 2) < 1e-10);
        if (part.id.includes(':sapling:')) {
          assert.ok(Math.abs(local.position[1] - local.scale[1] / 2 - .045) < 1e-10);
          const stem = parts.find(candidate => candidate.id === part.id.replace(':sapling:', ':stump:')); assert.ok(stem);
          assert.equal(stem.position[0], part.position[0]); assert.equal(stem.position[2], part.position[2]);
        }
      }
    }
  }
});

await test('Lumber flank silhouettes clear the measured normal-scale crest and caption without a camera change', () => {
  const site = { q: 0, r: 0, tileId: 100, improvementId: 'lumber-mill', worldSeed: 1701 };
  for (const [detail, pixelsPerUnit] of [['mid', 29], ['close', 74.75]] as const) {
    for (const woodland of [facts(8), facts(0), facts(1, 1)]) {
      const parts = projectLandscape([{ ...forest, woodland }], [site], detail).parts.filter(part => part.id.startsWith('lumber-forest:'));
      for (const part of parts) {
        const projected = transformedVertices({ ...part, position: [part.position[0], part.position[1] - forest.height, part.position[2]] }).map(([x, y, z]) => flatMapPoint(x * pixelsPerUnit, z * pixelsPerUnit, y * pixelsPerUnit));
        const left = Math.min(...projected.map(point => point.x)); const right = Math.max(...projected.map(point => point.x));
        const bottom = Math.max(...projected.map(point => point.z));
        assert.ok(right < -10 || left > 10, `Actual root DOM crest occupies x ±10 px: ${detail}/${part.id}`);
        assert.ok(right < -31.01 || left > 31.01 || bottom < 11, `Actual root DOM caption ink begins y +11 px and occupies x ±31.01 px: ${detail}/${part.id}`);
      }
    }
  }
});
