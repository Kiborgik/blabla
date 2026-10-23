import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { improvementLabel, improvementParts, IMPROVEMENT_PART_BUDGETS } from '../visuals/improvement-visuals.ts';
import type { ImprovementView } from '../visuals/improvement-visuals.ts';
import { districtParts } from '../visuals/district-visuals.ts';
import { depositParts } from '../visuals/strategic-resource-visuals.ts';
import { greatLibraryVisual } from '../visuals/wonder-landmark.ts';
import { settlementVisual, SETTLEMENT_RENDER_SCALE, VISUAL_PALETTE, visualDetail } from '../visuals/world-visuals.ts';
import type { DetailLevel, VisualPart } from '../visuals/world-visuals.ts';
import { CIVILIZATIONS, hexPosition } from '../web/atlas.ts';
import type { AtlasWorld } from '../web/atlas.ts';
import { createFlatAtlasRenderer } from '../web/flat-renderer.ts';
import { createSettlementMeshes, createDistrictMeshes, createImprovementMeshes, createDepositMeshes, createWonderMeshes } from '../web/settlement-three.ts';
import { DEFAULT_PREFERENCES } from '../web/viewer-state.ts';
import { flatMapPoint, flatSceneFaces, shapeTriangles, transformedVertices } from '../web/settlement-parts.ts';

function site(improvementId: 'mine' | 'lumber-mill'): ImprovementView {
  return { id: `site:${improvementId}:56`, cityId: 'frontier', townName: 'Frontier', civId: 0, improvementId,
    name: improvementId === 'mine' ? 'Mine' : 'Lumber mill', tileId: 56, q: 2, r: -3, height: .4, color: '#659ac7',
    status: 'built', construction: null, completion: null, operation: { enabled: true, lastResult: null },
    baseProduction: { materials: 2.4 }, residentsRequired: 1 };
}

await test('MID and FAR Mines read as compact low soil cuts rather than gold slabs and tall portals', () => {
  const view = site('mine');
  for (const detail of ['far', 'mid'] as const) {
    const parts = improvementParts(view, detail);
    const ground = parts.find(part => part.id.endsWith(':worked-ground')); assert.ok(ground);
    const opening = parts.find(part => part.id.endsWith(':opening')); assert.ok(opening);
    const spoil = parts.find(part => part.id.endsWith(':spoil')); assert.ok(spoil);
    assert.equal(ground.material, 'soil');
    assert.equal(opening.material, 'soil');
    assert.equal(spoil.material, 'stone');
    assert.ok(ground.scale[0] * ground.scale[2] <= 1.5);
    assert.ok(spoil.scale[0] * spoil.scale[2] <= .25);
    assert.ok(parts.every(part => part.material !== 'grain' && !part.id.includes(':portal-')));
    assert.ok(Math.max(...parts.flatMap(transformedVertices).map(point => point[1])) <= .4);
    const footprint = (material: string): number => parts.filter(part => part.material === material).reduce((area, part) => area + part.scale[0] * part.scale[2], 0);
    assert.ok(footprint('soil') > footprint('stone') + footprint('rock') + footprint('timber'));
  }
});

await test('MID and FAR Lumber mills keep a low open shelter and visible log work instead of a tall red house', () => {
  const view = site('lumber-mill');
  for (const detail of ['far', 'mid'] as const) {
    const parts = improvementParts(view, detail);
    const roof = parts.find(part => part.id.endsWith(':lumber-roof')); assert.ok(roof);
    const saw = parts.find(part => part.id.endsWith(':lumber-saw')); assert.ok(saw);
    const logs = parts.filter(part => part.id.includes(':lumber-stack-'));
    assert.ok(roof.scale[0] * roof.scale[2] <= .45);
    assert.ok(roof.position[1] + roof.scale[1] / 2 <= .5);
    assert.equal(roof.material, 'timber');
    assert.equal(saw.material, 'metal');
    assert.ok(logs.length >= 2 && logs.every(part => part.material === 'timber'));
    assert.ok(logs.every(part => part.position[2] - part.scale[2] / 2 > roof.position[2] + roof.scale[2] / 2));
    assert.ok(parts.some(part => part.id.includes(':lumber-log-ends') && part.material === 'grain'));
    assert.ok(!parts.some(part => part.id.endsWith(':lumber-wall')));
    assert.ok(Math.max(...parts.flatMap(transformedVertices).map(point => point[1])) <= .5);
  }
});

await test('CLOSE resource sites retain their recognizable portal, track, saw shelter and joinery details', () => {
  const mine = improvementParts(site('mine'), 'close');
  assert.ok(mine.some(part => part.id.endsWith(':portal-top')));
  assert.equal(mine.filter(part => part.id.includes(':track-')).length, 2);
  assert.equal(mine.filter(part => part.id.includes(':sleeper-')).length, 3);
  const mill = improvementParts(site('lumber-mill'), 'close');
  assert.ok(mill.some(part => part.id.endsWith(':lumber-wall')));
  assert.ok(mill.some(part => part.id.endsWith(':lumber-roof') && part.material === 'roof'));
  assert.equal(mill.filter(part => part.id.includes(':lumber-joist-')).length, 3);
});

await test('every resource-site LOD preserves installed, paused and construction facts without inventing output', () => {
  for (const improvementId of ['mine', 'lumber-mill'] as const) {
    const installed = site(improvementId);
    const paused: ImprovementView = { ...installed, operation: { enabled: false, lastResult: null } };
    const construction: ImprovementView = { ...installed, status: 'building', operation: null,
      construction: { kind: 'improvement', id: 'reserved:56', cityId: installed.cityId, improvementId, tileId: 56, ruleVersion: 1, startedRound: 2, paid: { materials: 6, credits: 3 }, workRequired: 4, workDone: 1 } };
    const before = structuredClone([installed, paused, construction]);
    assert.notEqual(improvementLabel(installed), improvementLabel(paused));
    assert.notEqual(improvementLabel(installed), improvementLabel(construction));
    for (const detail of ['far', 'mid', 'close'] as const) {
      const built = improvementParts(installed, detail);
      const planned = improvementParts(construction, detail);
      assert.deepEqual(improvementParts(paused, detail), built);
      assert.notDeepEqual(planned, built);
      assert.ok(planned.some(part => part.id.includes('survey')));
      assert.ok(planned.every(part => !/:(opening|spoil|lumber-roof|lumber-saw|lumber-stack-)/.test(part.id)));
      for (const parts of [built, planned]) {
        assert.ok(parts.length <= IMPROVEMENT_PART_BUDGETS[detail]);
        assert.equal(new Set(parts.map(part => part.id)).size, parts.length);
        assert.ok(parts.every(part => part.id.startsWith(installed.id)));
        assert.ok(parts.flatMap(transformedVertices).every(point => point.every(Number.isFinite) && Math.abs(point[0]) <= .9 && Math.abs(point[2]) <= .9));
        assert.ok(flatSceneFaces(parts, .72).length > 0);
      }
      assert.deepEqual(improvementParts(installed, detail), built);
      assert.deepEqual(improvementParts({ ...installed, operation: { enabled: true, lastResult: { round: 8, status: 'operated', paid: {}, produced: { materials: 99 }, residents: { ruleVersion: 1, openingPopulation: 12, communityReserve: 3, required: 1, available: 9, allocated: 1 }, blockedReason: null } } }, detail), built);
    }
    assert.deepEqual([installed, paused, construction], before);
  }
});

const cameraSteps: ReadonlyArray<readonly [number, DetailLevel]> = [
  [30, 'far'], [40, 'far'], [43, 'mid'], [37, 'mid'], [35, 'far'], [41, 'far'],
  [43, 'mid'], [60, 'mid'], [80, 'mid'], [85, 'close'], [110, 'close'], [73, 'close'], [70, 'mid'], [35, 'far'],
];

function rendererWorld(): AtlasWorld {
  const mine = { ...site('mine'), q: -2, r: 1 };
  const mill = { ...site('lumber-mill'), id: 'site:lumber-mill:57', tileId: 57, q: 0, r: 1, operation: { enabled: false, lastResult: null } };
  const pasture: ImprovementView = { ...mine, id: 'active:pasture:58', improvementId: 'pasture', name: 'Pasture', tileId: 58, q: 2, r: 1,
    status: 'building', operation: null, construction: { kind: 'improvement', id: 'pasture:58', cityId: 'frontier', improvementId: 'pasture', tileId: 58, ruleVersion: 1, startedRound: 2, paid: { materials: 6 }, workRequired: 4, workDone: 1 } };
  return {
    routes: [], tiles: [-2, -1, 0, 1, 2].flatMap(q => [-1, 0, 1].map(r => ({ q, r, height: .4, owner: 0, terrain: 'grassland' as const }))),
    cities: [{ ...CIVILIZATIONS[0]!, cityId: 'frontier', capital: 'Frontier', q: 0, r: 0,
      settlement: { id: 'frontier', civId: 0, tileId: 55, name: 'Frontier', population: 24, wellbeing: 70, damage: 0, buildings: ['farm', 'workshop'] } }],
    improvements: [mine, mill, pasture],
    districts: [{ id: 'campus:59', cityId: 'frontier', townName: 'Frontier', civId: 0, tileId: 59, q: -2, r: -1, height: .4, color: mine.color,
      status: 'built', buildingId: 'campus', name: 'Campus', library: 'built', construction: null, baseProduction: { science: 2 } }],
    deposits: [{ id: 'deposit:60', tileId: 60, q: 0, r: -1, height: .4, resource: 'iron', remaining: 20, initialReserve: 30, revealedTo: [{ id: 0, name: 'Aster' }] }],
    wonders: [{ id: 'wonder:61', workId: 'wonder:61', wonderId: 'great-library', name: 'Great library', cityId: 'frontier', townName: 'Frontier', civId: 0,
      tileId: 61, q: 2, r: -1, height: .4, color: mine.color, status: 'built',
      record: { status: 'completed', orderId: 'wonder:61', cityId: 'frontier', civId: 0, tileId: 61, completionEventId: 'complete:61', completedRound: 4 } }],
  };
}

class SvgElement {
  tag: string;
  attributes: Record<string, string> = {};
  children: SvgElement[] = [];
  parentElement: SvgElement | null = null;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  classList = { toggle: (): boolean => false };
  viewBox = { baseVal: { x: 0, y: 0, width: 1, height: 1 } };
  clientWidth = 1000;
  clientHeight = 700;
  listeners: Record<string, Array<(event: { key: string; preventDefault: () => void }) => void>> = {};
  constructor(tag: string) { this.tag = tag; }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === 'viewBox') {
      const [x = 0, y = 0, width = 1, height = 1] = value.split(' ').map(Number);
      this.viewBox.baseVal = { x, y, width, height };
    }
  }
  append(...children: SvgElement[]): void { for (const child of children) child.parentElement = this; this.children.push(...children); }
  prepend(...children: SvgElement[]): void { for (const child of children) child.parentElement = this; this.children.unshift(...children); }
  replaceChildren(...children: SvgElement[]): void { this.children = []; this.append(...children); }
  addEventListener(name: string, listener: (event: { key: string; preventDefault: () => void }) => void): void { (this.listeners[name] ??= []).push(listener); }
  remove(): void { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  descendants(): SvgElement[] { return this.children.flatMap(child => [child, ...child.descendants()]); }
  closest(): null { return null; }
}

function withSvg(run: () => void): void {
  const globals = {
    document: { createElementNS: (_namespace: string, tag: string) => new SvgElement(tag), createElement: (tag: string) => new SvgElement(tag), querySelectorAll: () => [] },
    window: { matchMedia: () => ({ matches: false }) },
    ResizeObserver: class { observe(): void {} disconnect(): void {} },
  };
  const previous = new Map(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  try {
    for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, value });
    run();
  } finally {
    for (const [name, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
}

function assertFlatParts(host: SvgElement, parts: readonly VisualPart[]): void {
  const actual = host.descendants().filter(element => element.attributes['data-part']).map(element => [element.attributes['data-part'], element.attributes['points']]);
  const expected = flatSceneFaces(parts, .72).map(face => [face.part.id, face.points]);
  assert.deepEqual(actual, expected);
}

await test('actual flat consumer keeps all sites at town detail while generic layers and exact inspection stay unchanged', () => withSvg(() => {
  const world = rendererWorld();
  const before = structuredClone(world);
  const container = new SvgElement('div');
  const selected: Array<[string, string | undefined]> = [];
  const renderer = createFlatAtlasRenderer(container as unknown as HTMLElement, world,
    { ...DEFAULT_PREFERENCES, selectedCity: 'frontier', x: 0, z: 0, zoom: 30 * 16 / container.clientHeight }, (id, workId) => selected.push([id, workId]), () => {});
  try {
    const svg = container.children.find(element => element.tag === 'svg'); assert.ok(svg);
    let generic: DetailLevel | undefined;
    for (const [diameter, detail] of cameraSteps) {
      renderer.restoreCamera({ x: 0, z: 0, zoom: diameter * 16 / container.clientHeight });
      generic = visualDetail(diameter, generic);
      assert.equal(svg.dataset['townDetail'], detail);
      assert.equal(svg.dataset['detail'], generic);
      const all = svg.descendants();
      const sites = all.filter(element => element.attributes['class'] === 'flat-district flat-improvement');
      assert.equal(sites.length, world.improvements?.length);
      for (const view of world.improvements ?? []) {
        const group = sites.find(element => element.attributes['data-district-id'] === view.id); assert.ok(group);
        assert.equal(group.attributes['data-tile-id'], String(view.tileId));
        assert.equal(group.attributes['data-status'], view.status);
        assert.equal(group.attributes['aria-label'], `Inspect ${improvementLabel(view)} of ${view.townName}, tile ${view.tileId}`);
        const origin = hexPosition(view.q, view.r);
        const point = flatMapPoint(origin.x, origin.z, view.height);
        assert.equal(group.attributes['transform'], `translate(${point.x} ${point.z})`);
        assertFlatParts(group, improvementParts(view, detail));
        assert.ok(group.children.some(child => child.attributes['class'] === 'district-hit'));
        for (const event of ['click', 'keydown']) for (const listener of group.listeners[event] ?? []) listener({ key: 'Enter', preventDefault: () => {} });
        const workId = view.status === 'building' ? `active:${view.construction?.id}` : String(view.tileId);
        assert.deepEqual(selected.splice(0), [[view.cityId, workId], [view.cityId, workId]]);
      }
      const town = all.find(element => element.attributes['class'] === 'settlement-parts'); assert.ok(town);
      assertFlatParts(town, settlementVisual(world.cities[0]!.settlement!, detail).parts);
      assert.equal(town.dataset['buildings'], 'farm workshop');
      for (const district of world.districts ?? []) {
        const group = all.find(element => element.attributes['data-district-id'] === district.id); assert.ok(group);
        assertFlatParts(group, districtParts(district, detail));
      }
      for (const deposit of world.deposits ?? []) {
        const group = all.find(element => element.attributes['data-deposit-id'] === deposit.id); assert.ok(group);
        assertFlatParts(group, depositParts(deposit, generic));
      }
      for (const wonder of world.wonders ?? []) {
        const group = all.find(element => element.attributes['data-district-id'] === wonder.id); assert.ok(group);
        assertFlatParts(group, greatLibraryVisual(wonder.record, generic).parts);
      }
    }
    assert.deepEqual(world, before);
  } finally { renderer.dispose(); }
}));

function assertMeshParts(group: THREE.Group, expected: Array<{ part: VisualPart; color: string }>): void {
  const numberKey = (values: ArrayLike<number>): string => Array.from(values, Math.fround).join(',');
  const actual = group.children.flatMap(mesh => {
    assert.ok(mesh instanceof THREE.InstancedMesh && mesh.material instanceof THREE.MeshBasicMaterial);
    assert.ok(mesh.boundingSphere);
    const color = mesh.material.color.getHexString();
    return Array.from({ length: mesh.count }, (_, index) => {
      const matrix = new THREE.Matrix4(); mesh.getMatrixAt(index, matrix);
      return `${color}:${numberKey(mesh.geometry.getAttribute('position').array)}:${numberKey(matrix.elements)}`;
    });
  });
  const projected = expected.map(({ part, color }) => {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...part.position), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), part.rotation), new THREE.Vector3(...part.scale));
    return `${color.slice(1)}:${numberKey(shapeTriangles(part.shape))}:${numberKey(matrix.elements)}`;
  });
  assert.deepEqual(actual.sort(), projected.sort());
}

await test('actual Three site resolver shares settlement hysteresis and retains every colored mesh at its exact site', () => {
  const world = rendererWorld();
  const before = structuredClone(world);
  const materials = new Map<string, THREE.MeshBasicMaterial>();
  const material = (color: string): THREE.MeshBasicMaterial => {
    const value = materials.get(color) ?? new THREE.MeshBasicMaterial({ color }); materials.set(color, value); return value;
  };
  const improvements = createImprovementMeshes(world, material);
  const towns = createSettlementMeshes(world, material);
  const districts = createDistrictMeshes(world, material);
  const deposits = createDepositMeshes(world, material);
  const wonders = createWonderMeshes(world, material);
  const atSite = (parts: VisualPart[], site: { q: number; r: number; height: number; color: string }, scale = 1): Array<{ part: VisualPart; color: string }> => {
    const origin = hexPosition(site.q, site.r);
    return parts.map(part => ({ color: part.material === 'identity' ? site.color : VISUAL_PALETTE[part.material],
      part: { ...part, position: [origin.x + part.position[0] * scale, site.height + part.position[1] * scale, origin.z + part.position[2] * scale],
        scale: [part.scale[0] * scale, part.scale[1] * scale, part.scale[2] * scale] } }));
  };
  try {
    let generic: DetailLevel | undefined;
    for (const [diameter, detail] of cameraSteps) {
      assert.equal(improvements.update(diameter), detail);
      assert.equal(towns.update(diameter), detail);
      assert.equal(districts.update(diameter), detail);
      const genericDetail = visualDetail(diameter, generic);
      generic = genericDetail;
      assert.equal(deposits.update(diameter), genericDetail);
      assert.equal(wonders.update(diameter), genericDetail);
      assertMeshParts(improvements.group, (world.improvements ?? []).flatMap(site => atSite(improvementParts(site, detail), site)));
      assertMeshParts(districts.group, (world.districts ?? []).flatMap(site => atSite(districtParts(site, detail), site)));
      assertMeshParts(towns.group, world.cities.flatMap(city => atSite(settlementVisual(city.settlement!, detail).parts, { ...city, height: .4 }, SETTLEMENT_RENDER_SCALE)));
      assertMeshParts(deposits.group, (world.deposits ?? []).flatMap(site => atSite(depositParts(site, genericDetail), { ...site, color: VISUAL_PALETTE.metal })));
      assertMeshParts(wonders.group, (world.wonders ?? []).flatMap(site => atSite(greatLibraryVisual(site.record, genericDetail).parts, site)));
    }
    assert.deepEqual(world, before);
  } finally {
    for (const meshes of [improvements, towns, districts, deposits, wonders]) meshes.dispose();
    for (const value of materials.values()) value.dispose();
  }
});
