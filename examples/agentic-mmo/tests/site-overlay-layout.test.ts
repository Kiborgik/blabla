import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { districtParts, type DistrictView } from '../visuals/district-visuals.ts';
import { improvementParts, type ImprovementView } from '../visuals/improvement-visuals.ts';
import { hexPosition, projectTerrainSurface, type LandscapeTile } from '../visuals/landscape.ts';
import type { DrainageEdgeView } from '../visuals/drainage-visuals.ts';
import { settlementDetail, type DetailLevel } from '../visuals/visual-language.ts';
import type { VisualPart } from '../visuals/world-visuals.ts';
import { allocateMapHierarchy, type HierarchyAnchor, type ScreenBox } from '../visuals/map-hierarchy.ts';
import { flatMapPoint, flatSceneFaces, shapeTriangles, transformedVertices, type Point3 } from '../web/settlement-parts.ts';
import { prepareSiteOverlayGeometry, projectSiteOverlayGeometry } from '../web/site-overlay-geometry.ts';

const details: readonly DetailLevel[] = ['far', 'mid', 'close'];
const overlapping = (a: ScreenBox, b: ScreenBox): boolean => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
const contained = (box: ScreenBox, point: { x: number; y: number }): boolean => point.x >= box.left - 1e-8 && point.x <= box.left + box.width + 1e-8 && point.y >= box.top - 1e-8 && point.y <= box.top + box.height + 1e-8;
const flatProject = ([x, y, z]: Point3): { x: number; y: number } => {
  const point = flatMapPoint(x + 3, z - 2, y + .43);
  return { x: 180 + point.x * 42, y: 300 + point.z * 42 };
};

function district(buildingId: string): DistrictView {
  const attached = buildingId === 'industrial-zone' ? ['guild-workshop', 'foundry', 'factory', 'coal-plant']
    : buildingId === 'commercial-hub' ? ['market', 'bank'] : buildingId === 'theater-square' ? ['printing-house'] : ['university', 'observatory', 'research-lab'];
  return { id: `district:${buildingId}`, buildingId, name: buildingId, cityId: 'town-a', townName: 'Town A', civId: 2, tileId: 70,
    q: 0, r: 0, height: .43, color: '#abcdef', status: 'built', library: buildingId === 'campus' ? 'built' : 'absent',
    construction: null, baseProduction: {}, attachments: attached.map(id => ({ buildingId: id, name: id, status: 'built' })) };
}

function improvement(improvementId: string, tileId = 70): ImprovementView {
  return { id: `improvement:${improvementId}:${tileId}`, improvementId, name: improvementId, cityId: 'town-a', townName: 'Town A', civId: 2,
    tileId, worldSeed: 1701, q: 0, r: 0, height: .43, color: '#abcdef', status: 'built', construction: null, completion: null,
    baseProduction: {}, residentsRequired: 1, operation: { enabled: true, lastResult: { round: 8, status: 'operated', paid: { materials: 1 },
      produced: { food: 2, energy: 2 }, blockedReason: null, residents: { ruleVersion: 1, openingPopulation: 12, communityReserve: 3, required: 1, available: 3, allocated: 1 } } } };
}

function intake(direction: number): ImprovementView {
  const steps = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;
  const source: LandscapeTile = { id: 70, q: 2.5, r: -1.5, owner: 0, terrain: 'grassland', height: .41 };
  const tiles: LandscapeTile[] = [source, ...steps.map(([dq, dr], index): LandscapeTile => ({ id: 71 + index, q: source.q + dq, r: source.r + dr,
    owner: 0, terrain: 'grassland', height: index === direction ? .29 : .44 + index * .005 }))];
  const center = hexPosition(source.q, source.r); const step = steps[direction]; assert.ok(step);
  const downstream = hexPosition(source.q + step[0], source.r + step[1]);
  const edge: DrainageEdgeView = { id: `drainage:1:70:${71 + direction}`, fromTileId: 70, toTileId: 71 + direction, outletTileId: 1000,
    contributingLandTiles: 40, mouth: false, points: [[center.x, source.height, center.z], [downstream.x, .29, downstream.z]] };
  const surface = projectTerrainSurface(tiles, { kind: 'retained', reason: null, edges: [edge] }).find(entry => entry.key === `${source.q},${source.r}`);
  assert.ok(surface);
  return { ...improvement('river-intake'), q: source.q, r: source.r, height: source.height,
    riverIntake: { surface, edge, round: 8, terminal: false, eligible: true, receiptCurrent: true } };
}

function enclose(parts: readonly VisualPart[], project: (point: Point3) => { x: number; y: number }): ScreenBox {
  const geometry = prepareSiteOverlayGeometry(parts);
  const projected = projectSiteOverlayGeometry(geometry, project);
  assert.equal(projected.reason, null); assert.ok(projected.bounds);
  for (const part of parts) for (const point of transformedVertices(part)) assert.ok(contained(projected.bounds, project(point)), part.id);
  return projected.bounds;
}

function threeProjection(): (point: Point3) => { x: number; y: number } {
  const camera = new THREE.OrthographicCamera(-24, 24, 18, -18, .1, 160);
  camera.position.set(19, 29, 31); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const left = new THREE.Vector3(-1, 0, 0).project(camera); const right = new THREE.Vector3(1, 0, 0).project(camera);
  camera.zoom = 84 / Math.hypot((right.x - left.x) * 594, (right.y - left.y) * 380.5); camera.updateProjectionMatrix();
  return ([x, y, z]) => {
    const point = new THREE.Vector3(x + 3, y + .43, z - 2).project(camera);
    return { x: (point.x + 1) * 594, y: (1 - point.y) * 380.5 };
  };
}

void test('published district families enclose every returned part at actual site detail and construction/attachment states', () => {
  const three = threeProjection();
  for (const family of ['campus', 'commercial-hub', 'industrial-zone', 'theater-square']) for (const detail of details) {
    const view = district(family);
    for (const variant of [view, { ...view, status: 'building' as const }, { ...view, library: 'building' as const,
      attachments: (view.attachments ?? []).map(item => ({ ...item, status: 'building' as const })) }]) {
      const before = structuredClone(variant); const parts = districtParts(variant, detail);
      enclose(parts, flatProject); enclose(parts, three); assert.deepEqual(variant, before);
    }
  }
});

void test('all productive recipe families retain rotated/reflected/terrain-relative exact envelopes rather than tile rectangles', () => {
  for (const family of ['mine', 'pasture', 'lumber-mill', 'charcoal-clearing', 'hill-commons', 'shore-fishery']) for (const tileId of [70, 71, 72, 73]) {
    const view = improvement(family, tileId);
    for (const detail of details) for (const status of ['building', 'built'] as const) {
      const parts = improvementParts({ ...view, status }, detail);
      assert.ok(parts.length); enclose(parts, flatProject); enclose(parts, threeProjection());
    }
  }
  const normal = improvementParts(improvement('lumber-mill'), 'close');
  const woodland = improvementParts({ ...improvement('lumber-mill'), woodland: { stock: 8, capacity: 20, lastHarvestRound: 7,
    recovered: 1, current: true, eligible: true, productive: true, reason: null } }, 'close');
  assert.notDeepEqual(enclose(normal, flatProject), enclose(woodland, flatProject));
  for (let direction = 0; direction < 6; direction++) for (const detail of details) for (const status of ['building', 'built'] as const) {
    const view = { ...intake(direction), status }; const parts = improvementParts(view, detail);
    assert.ok(parts.length); assert.ok(parts.some(part => part.rotation !== 0)); enclose(parts, flatProject); enclose(parts, threeProjection());
  }
});

void test('active smoke and stale/paused operations use fresh actual geometry, without carrying a taller prior envelope', () => {
  const view = district('industrial-zone');
  const result = { round: 8, status: 'operated' as const, paid: {}, produced: {}, shortages: [],
    localPower: { ruleVersion: 1 as const, required: 0, availableBefore: 0, consumed: 0, generated: 8, shortage: 0 } };
  const active = { ...view, round: 8, buildingOperations: { 'coal-plant': { enabled: true, lastResult: result } } };
  const activeParts = districtParts(active, 'close');
  assert.ok(activeParts.some(part => part.id.includes('operation:coal-plant:smoke')));
  const tall = enclose(activeParts, flatProject);
  for (const inactive of [{ ...active, round: 9 }, { ...active, terminal: true }, { ...active, buildingOperations: { 'coal-plant': { enabled: false, lastResult: result } } }]) {
    const parts = districtParts(inactive, 'close'); const bounds = enclose(parts, flatProject);
    assert.ok(parts.every(part => !part.id.includes('operation:coal-plant:smoke'))); assert.ok(bounds.top > tall.top);
  }
  const charcoal = improvement('charcoal-clearing');
  assert.ok(improvementParts(charcoal, 'close').some(part => part.id.endsWith('recorded-smoke')));
  assert.ok(improvementParts({ ...charcoal, operation: { enabled: false, lastResult: charcoal.operation?.lastResult ?? null } }, 'close').every(part => !part.id.endsWith('recorded-smoke')));
});

void test('actual flat painted faces and Three instanced shape matrices fit the same pure projection envelopes', () => {
  const three = threeProjection();
  const parts = [...districtParts(district('industrial-zone'), 'close'), ...improvementParts(improvement('charcoal-clearing'), 'close')];
  const flatBounds = enclose(parts, flatProject); const threeBounds = enclose(parts, three);
  const origin = flatProject([0, 0, 0]);
  for (const face of flatSceneFaces(parts, .72)) for (const point of face.points.split(' ')) {
    const [x, y] = point.split(',').map(Number); assert.ok(x !== undefined && y !== undefined);
    assert.ok(contained(flatBounds, { x: origin.x + x * 42, y: origin.y + y * 42 }));
  }
  for (const part of parts) {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...part.position),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), part.rotation), new THREE.Vector3(...part.scale));
    const buffer = new THREE.Float32BufferAttribute(shapeTriangles(part.shape), 3);
    for (let index = 0; index < buffer.count; index++) {
      const vertex = new THREE.Vector3().fromBufferAttribute(buffer, index).applyMatrix4(matrix);
      assert.ok(contained(threeBounds, three([vertex.x, vertex.y, vertex.z])), part.id);
    }
  }
});

void test('immutable local snapshots and bounded view caches survive pan, scale, orientation and terrain-height changes', () => {
  const parts = improvementParts(improvement('charcoal-clearing'), 'close'); const geometry = prepareSiteOverlayGeometry(parts);
  assert.ok(Object.isFrozen(geometry) && Object.isFrozen(geometry.vertices) && Object.isFrozen(geometry.vertices[0]));
  for (const [scale, panX, panY, angle, height] of [[42, 180, 300, 0, .4], [84, 92, 210, 0, .4], [42, 180, 300, .7, .4], [42, 180, 300, .7, 1.9]]) {
    assert.ok(scale !== undefined && panX !== undefined && panY !== undefined && angle !== undefined && height !== undefined);
    let calls = 0;
    const project = ([x, y, z]: Point3): { x: number; y: number } => { calls += 1; return { x: panX + (x * Math.cos(angle) + z * Math.sin(angle)) * scale,
      y: panY + (z * Math.cos(angle) - x * Math.sin(angle)) * .72 * scale - (y + height) * .85 * scale }; };
    const projected = projectSiteOverlayGeometry(geometry, project); assert.equal(calls, 4); assert.ok(projected.bounds);
    for (const point of geometry.vertices) assert.ok(contained(projected.bounds, project(point)));
  }
  const oldBounds = projectSiteOverlayGeometry(geometry, flatProject);
  const first = parts[0]; assert.ok(first); parts[0] = { ...first, position: [20, 30, 40] };
  assert.deepEqual(projectSiteOverlayGeometry(geometry, flatProject), oldBounds);
  assert.notDeepEqual(projectSiteOverlayGeometry(prepareSiteOverlayGeometry(parts), flatProject), oldBounds);
});

void test('empty, unknown, terrain-stale and invalid geometry has an explicit generic-marker reason', () => {
  const invalid: VisualPart = { id: 'bad', shape: 'box', position: [NaN, 0, 0], scale: [1, 1, 1], rotation: 0, material: 'stone' };
  for (const [parts, reason] of [[[], 'empty-geometry'], [improvementParts(improvement('unknown-future-recipe'), 'close'), 'empty-geometry'],
    [improvementParts({ ...intake(0), height: 999 }, 'close'), 'empty-geometry'], [[invalid], 'non-finite-geometry']] as const) {
    const projected = projectSiteOverlayGeometry(prepareSiteOverlayGeometry(parts), flatProject);
    assert.equal(projected.bounds, null); assert.equal(projected.reason, reason);
    const item = allocateMapHierarchy([{ id: reason, kind: 'site', label: 'Site', x: 180, y: 220, geometryReason: reason }],
      { width: 360, height: 507, tileDiameter: 84 }).items[0];
    assert.ok(item?.mark); assert.equal(item.placementMode, 'generic'); assert.equal(item.fallbackReason, reason);
  }
  const geometry = prepareSiteOverlayGeometry(districtParts(district('campus'), 'close'));
  assert.equal(projectSiteOverlayGeometry(geometry, () => ({ x: Infinity, y: 0 })).reason, 'non-finite-projection');
  assert.equal(projectSiteOverlayGeometry(geometry, () => ({ x: 1, y: 1 })).reason, 'degenerate-projection');
});

void test('site detail follows its own two hysteresis directions rather than overlay thresholds', () => {
  assert.equal(settlementDetail(38), 'far'); assert.equal(settlementDetail(39), 'mid'); assert.equal(settlementDetail(77), 'mid'); assert.equal(settlementDetail(78), 'close');
  assert.equal(settlementDetail(41, 'far'), 'far'); assert.equal(settlementDetail(42, 'far'), 'mid');
  assert.equal(settlementDetail(83, 'mid'), 'mid'); assert.equal(settlementDetail(84, 'mid'), 'close');
  assert.equal(settlementDetail(71, 'close'), 'close'); assert.equal(settlementDetail(70, 'close'), 'mid');
  assert.equal(settlementDetail(36, 'mid'), 'mid'); assert.equal(settlementDetail(35, 'mid'), 'far');
  const view = district('campus');
  const mid = prepareSiteOverlayGeometry(districtParts(view, settlementDetail(83, 'mid')));
  const close = prepareSiteOverlayGeometry(districtParts(view, settlementDetail(84, 'mid')));
  assert.notDeepEqual(mid.vertices, close.vertices);
  assert.notDeepEqual(projectSiteOverlayGeometry(mid, flatProject), projectSiteOverlayGeometry(close, flatProject));
});

void test('isolated published sites at normal84 keep exterior20px glyphs and44px targets on desktop and narrow frames', () => {
  const recipes = [...['campus', 'commercial-hub', 'industrial-zone', 'theater-square'].map(id => districtParts(district(id), 'close')),
    ...['mine', 'pasture', 'lumber-mill', 'charcoal-clearing', 'hill-commons', 'shore-fishery'].map(id => improvementParts(improvement(id), 'close')),
    improvementParts(intake(0), 'close')];
  for (const width of [360, 1188]) for (const parts of recipes) for (const mode of ['flat', 'three']) {
    const x = width / 2; const y = 250;
    const three = threeProjection(); const origin = three([0, 0, 0]);
    const project = ([px, py, pz]: Point3): { x: number; y: number } => {
      if (mode === 'flat') return { x: x + px * 42, y: y + (pz * .72 - py * .85) * 42 };
      const point = three([px, py, pz]); return { x: x + point.x - origin.x, y: y + point.y - origin.y };
    };
    const bounds = enclose(parts, project);
    const item = allocateMapHierarchy([{ id: 'isolated', kind: 'site', label: 'Commercial hub + Market + Bank', shortLabel: 'Commercial hub',
      related: true, x, y, protectedBounds: bounds }], { width, height: 600, tileDiameter: 84 }).items[0];
    assert.ok(item?.mark && item.symbol); assert.equal(item.placementMode, 'exterior'); assert.equal(item.fallbackReason, null);
    assert.equal(item.mark.width, 44); assert.equal(item.mark.height, 44); assert.equal(item.symbol.width, 20); assert.equal(item.symbol.height, 20);
    assert.ok(!overlapping(bounds, item.mark)); if (item.label) assert.ok(!overlapping(bounds, item.label));
    if (item.leader) {
      assert.ok(contained(item.mark, item.leader.to)); assert.ok(!contained(item.symbol, item.leader.to));
      assert.ok(Math.hypot(item.leader.to.x - x, item.leader.to.y - y) <= 96);
    } else assert.ok(contained(item.mark, item.anchor));
  }
});

void test('dense targets, all architecture including omitted sites, HUD and focus paint remain disjoint and stable', () => {
  const anchors: HierarchyAnchor[] = Array.from({ length: 30 }, (_, index) => {
    const x = 55 + index % 6 * 65; const y = 130 + Math.floor(index / 6) * 65;
    return { id: `site-${String(index).padStart(2, '0')}`, kind: 'site', x, y, label: 'Mine', shortLabel: 'Mine', related: index < 6,
      protectedBounds: { left: x - 20, top: y - 30, width: 40, height: 40 }, tileId: index };
  });
  const blocked = [{ left: 0, top: 0, width: 440, height: 75 }, { left: 325, top: 400, width: 115, height: 200 }];
  const frame = { width: 440, height: 600, tileDiameter: 84, blocked };
  const result = allocateMapHierarchy(anchors, frame);
  assert.deepEqual(allocateMapHierarchy(anchors.toReversed(), frame), result);
  assert.ok(result.items.some(item => item.mark) && result.items.some(item => !item.mark));
  for (const [index, box] of result.occupied.entries()) {
    assert.ok(blocked.every(other => !overlapping(box, other)));
    assert.ok(result.occupied.slice(index + 1).every(other => !overlapping(box, other)));
  }
  for (const item of result.items) {
    if (!item.mark) { assert.equal(item.placementMode, 'omitted'); assert.ok(item.fallbackReason); continue; }
    for (const anchor of anchors) if (anchor.protectedBounds && (item.placementMode !== 'compact' || item.id !== anchor.id)) {
      assert.ok(!overlapping(item.mark, anchor.protectedBounds));
      if (item.label) assert.ok(!overlapping(item.label, anchor.protectedBounds));
    }
  }
});

void test('current river operation adds only its actual water vertices while stale receipts remove them', () => {
  const view = intake(3);
  view.completion = { kind: 'improvement', orderId: 'intake-order', cityId: view.cityId, improvementId: view.improvementId, tileId: view.tileId,
    startedRound: 2, completedRound: 5, paid: { materials: 8, credits: 4 }, workRequired: 4, eventId: 'conditional:5' };
  assert.ok(view.operation?.lastResult && view.riverIntake);
  view.operation.lastResult.river = { ruleVersion: 1, ruleId: 'uniform-runoff-1', tileId: view.tileId, downstreamTileId: view.riverIntake.edge.toTileId,
    outletTileId: 1000, required: 8, availableBefore: 12, withdrawn: 8, remainingAfter: 4, supportBuildingId: 'irrigation', supportAllocationRound: 8 };
  for (const detail of details) {
    const parts = improvementParts(view, detail); assert.ok(parts.some(part => part.id.endsWith('recorded-water')));
    enclose(parts, flatProject); enclose(parts, threeProjection());
    const stale = improvementParts({ ...view, riverIntake: { ...view.riverIntake, round: 9 } }, detail);
    assert.ok(stale.every(part => !part.id.endsWith('recorded-water'))); assert.equal(stale.length, parts.length - 1);
    enclose(stale, flatProject);
  }
});
