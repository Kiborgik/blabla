import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createWorld } from '../core/engine.ts';
import type { CityImprovement, ImprovementConstructionOrder } from '../core/types.ts';
import { improvementLabel, improvementLastLabel, improvementMark, improvementParts, IMPROVEMENT_PART_BUDGETS, LUMBER_MARK_PATH } from '../visuals/improvement-visuals.ts';
import { shoreFisheryParts, SHORE_FISHERY_MARK_PATH } from '../visuals/shore-fishery-visuals.ts';
import { workedLandCompositionV1 } from '../visuals/worked-land-composition.ts';
import { PASTORAL_MARK_PATH } from '../visuals/pastoral-visuals.ts';
import { SITE_MARK_PATHS } from '../visuals/strategic-resource-visuals.ts';
import { VISUAL_PALETTE, visualDetail } from '../visuals/world-visuals.ts';
import type { DetailLevel, VisualPart } from '../visuals/world-visuals.ts';
import { hexPosition } from '../web/atlas.ts';
import { createFlatAtlasRenderer } from '../web/flat-renderer.ts';
import { projectWorld } from '../web/live-world.ts';
import { flatMapPoint, flatSceneFaces, shapeTriangles, transformedVertices } from '../web/settlement-parts.ts';
import { createImprovementMeshes } from '../web/settlement-three.ts';
import { DEFAULT_PREFERENCES } from '../web/viewer-state.ts';

function retainedStateFixture(status: 'building' | 'built' | 'paused' = 'built') {
  const state = createWorld(1701);
  const capital = state.cities[0]; assert.ok(capital);
  const city = { ...structuredClone(capital), id: 'conditional-shore-frontier', name: 'Conditional shore town', tileId: 58 };
  state.cities.push(city);
  const order: ImprovementConstructionOrder = { kind: 'improvement', id: 'conditional-shore-56', cityId: city.id, improvementId: 'shore-fishery',
    tileId: 56, ruleVersion: 1, startedRound: 2, paid: { materials: 8, credits: 4 }, workRequired: 4, workDone: 1 };
  const installed: CityImprovement = { improvementId: order.improvementId, tileId: order.tileId,
    completion: { kind: 'improvement', orderId: order.id, cityId: city.id, improvementId: order.improvementId, tileId: order.tileId,
      startedRound: 2, completedRound: 4, paid: { materials: 8, credits: 4 }, workRequired: 4, eventId: 'conditional:4' },
    operation: { enabled: status !== 'paused', lastResult: { round: 5, status: 'operated', paid: { materials: 1 }, produced: { food: 2.8 },
      inputs: [{ resource: 'materials', required: 1, available: 3 }], shortages: [],
      residents: { ruleVersion: 1, openingPopulation: 12, communityReserve: 3, required: 1, available: 3, allocated: 1 }, blockedReason: null } } };
  if (status === 'building') city.construction = { active: order, lastCompleted: null };
  else city.improvements = { '56': installed };
  const world = projectWorld(state);
  const view = world.improvements?.find(site => site.cityId === city.id); assert.ok(view);
  return { state, city, order, installed, world, view };
}

const cameraSteps = [[30, 'far'], [40, 'far'], [43, 'mid'], [37, 'mid'], [35, 'far'], [43, 'mid'], [80, 'mid'], [85, 'close'], [73, 'close'], [70, 'mid']] as const;

await test('conditional retained fishery records project exact town, site, paid construction and detached historical output', () => {
  for (const status of ['building', 'built', 'paused'] as const) {
    const { state, city, order, installed, view } = retainedStateFixture(status);
    const before = structuredClone(state);
    const tile = state.tiles.find(value => value.id === view.tileId); assert.ok(tile);
    assert.equal(view.cityId, city.id);
    assert.notEqual(view.cityId, state.cities[0]?.id);
    assert.equal(view.townName, city.name);
    assert.equal(view.name, 'Shore fishery');
    assert.equal(view.tileId, 56);
    assert.notEqual(view.tileId, city.tileId);
    assert.equal(view.q, tile.q - (state.width - 1) / 2);
    assert.equal(view.r, tile.r - (state.height - 1) / 2);
    assert.equal(view.status, status === 'building' ? 'building' : 'built');
    assert.deepEqual(view.baseProduction, { food: 3 });
    assert.equal(view.residentsRequired, 1);
    assert.equal(improvementLabel(view), `Shore fishery${status === 'building' ? ' · Building' : status === 'paused' ? ' · Paused' : ''}`);
    if (status === 'building') {
      assert.deepEqual(view.construction, order);
      assert.equal(view.completion, null);
      assert.equal(view.operation, null);
      assert.equal(city.improvements?.['56'], undefined);
      view.construction!.paid.materials = 999;
    } else {
      assert.deepEqual(view.completion, installed.completion);
      assert.deepEqual(view.operation, installed.operation);
      assert.equal(view.construction, null);
      assert.equal(improvementLastLabel(view.operation!.lastResult), 'Food made');
      assert.equal(view.operation!.lastResult!.produced.food, 2.8);
      assert.deepEqual(view.operation!.lastResult!.paid, { materials: 1 });
      view.operation!.lastResult!.produced.food = 999;
      view.completion!.paid.credits = 999;
    }
    view.baseProduction.food = 999;
    assert.deepEqual(state, before);
    assert.deepEqual(projectWorld(state).improvements?.[0]?.baseProduction, { food: 3 });
  }
});

await test('missing retained fishery sites are omitted rather than moved to a town or invented for old worlds', () => {
  const { state, city, installed } = retainedStateFixture();
  city.improvements = { '99999': { ...installed, tileId: 99999, completion: { ...installed.completion, tileId: 99999 } } };
  assert.deepEqual(projectWorld(state).improvements, []);
  delete city.improvements;
  assert.deepEqual(projectWorld(state).improvements, []);
});

await test('historical input shortage labels name only the recorded missing resources without inventing quantities', () => {
  const { installed } = retainedStateFixture();
  const previous = installed.operation.lastResult; assert.ok(previous);
  const result = { ...previous, status: 'blocked' as const, blockedReason: 'input-shortage' as const, paid: {}, produced: {},
    shortages: [{ resource: 'materials' as const, required: 1, available: 0 }] };
  const before = structuredClone(result);
  assert.equal(improvementLastLabel(result), 'Not enough Materials');
  assert.equal(improvementLastLabel({ ...result, shortages: [...result.shortages, { resource: 'food', required: 2, available: 1 }, ...result.shortages] }), 'Not enough Food and Materials');
  assert.equal(improvementLastLabel({ ...result, shortages: [] }), 'Not enough operating supplies');
  assert.equal(improvementLastLabel({ ...result, blockedReason: 'site-ineligible' }), 'Site could not operate');
  assert.equal(improvementLastLabel({ ...result, blockedReason: 'resident-shortage' }), 'Not enough local support');
  assert.equal(improvementLastLabel({ ...result, status: 'paused', blockedReason: null }), 'Paused that season');
  assert.equal(improvementLastLabel(previous), 'Food made');
  assert.deepEqual(result, before);
});

await test('literal compact net station uses seven, nine and thirteen parts with an open close net and only stakes during construction', () => {
  const { view } = retainedStateFixture();
  for (const [detail, count, cap] of [['far', 7, 8], ['mid', 9, 12], ['close', 13, 16]] as const) {
    const raw = shoreFisheryParts(view, detail);
    assert.equal(raw.length, count);
    const part = (id: string): VisualPart => { const value = raw.find(entry => entry.id === `${view.id}:${id}`); assert.ok(value, id); return value; };
    assert.deepEqual(part('fishery-ground'), { id: `${view.id}:fishery-ground`, shape: 'box', material: 'soil', position: [0, .025, 0], scale: [1.2, .05, .9], rotation: 0 });
    assert.deepEqual(part('fishery-identity').position, [-.6, .07, 0]);
    assert.deepEqual(part('fishery-identity').scale, [.05, .08, .8]);
    for (const x of [-.44, .44]) {
      assert.deepEqual(part(`fishery-post-${x}`).position, [x, .31, -.25]);
      assert.deepEqual(part(`fishery-post-${x}`).scale, [.065, .62, .065]);
    }
    assert.deepEqual(part('fishery-beam').position, [0, .62, -.25]);
    assert.deepEqual(part('fishery-beam').scale, [.95, .06, .065]);
    assert.equal(raw.some(entry => entry.id.endsWith(':fishery-net')), detail !== 'close');
    if (detail !== 'close') {
      assert.deepEqual(part('fishery-net').position, [0, .36, -.25]);
      assert.deepEqual(part('fishery-net').scale, [.76, .38, .018]);
      assert.equal(part('fishery-net').material, 'canopy');
    }
    assert.equal(part('fishery-bottom-cord').position[1], .17);
    assert.equal(raw.some(entry => entry.id.endsWith(':fishery-bin')), detail !== 'far');
    assert.equal(raw.some(entry => entry.id.endsWith(':fishery-mat')), detail !== 'far');
    if (detail !== 'far') {
      assert.deepEqual(part('fishery-bin').position, [.31, .1, .23]);
      assert.deepEqual(part('fishery-bin').scale, [.26, .2, .23]);
      assert.deepEqual(part('fishery-mat').position, [-.18, .06, .22]);
      assert.deepEqual(part('fishery-mat').scale, [.38, .035, .3]);
    }
    const strands = raw.filter(entry => entry.id.includes('fishery-strand-'));
    assert.equal(strands.length, detail === 'close' ? 5 : 0);
    if (detail === 'close') {
      for (const x of [-.19, 0, .19]) {
        assert.deepEqual(part(`fishery-strand-vertical-${x}`).position, [x, .36, -.23]);
        assert.deepEqual(part(`fishery-strand-vertical-${x}`).scale, [.015, .38, .014]);
      }
      for (const y of [.27, .45]) {
        assert.deepEqual(part(`fishery-strand-horizontal-${y}`).position, [0, y, -.23]);
        assert.deepEqual(part(`fishery-strand-horizontal-${y}`).scale, [.76, .015, .014]);
      }
    }
    for (const strand of strands) {
      assert.equal(strand.material, 'grain');
      assert.equal(strand.position[2], -.23);
      assert.equal(strand.scale[2], .014);
      assert.ok(strand.position[2] - strand.scale[2] / 2 > -.25 + .018 / 2);
    }
    const active = improvementParts({ ...view, status: 'building', operation: null }, detail);
    assert.equal(active.length, 5);
    assert.equal(active.filter(entry => entry.id.includes('fishery-survey-')).length, 3);
    assert.ok(active.every(entry => !/fishery-(net|post|beam|bin|mat|strand|bottom-cord)/.test(entry.id)));
    for (const parts of [improvementParts(view, detail), active]) {
      assert.ok(parts.length <= cap && cap <= IMPROVEMENT_PART_BUDGETS[detail]);
      assert.equal(new Set(parts.map(entry => entry.id)).size, parts.length);
      assert.ok(parts.every(entry => entry.shape === 'box' && entry.rotation === 0));
      assert.ok(parts.flatMap(transformedVertices).every(([x, y, z]) => [x, y, z].every(Number.isFinite) && Math.abs(x) <= .65 && Math.abs(z) <= .5 && y >= 0 && y <= .72));
      assert.ok(parts.every(entry => !/boat|catch|glow|output|spoil|opening|roof/.test(entry.id)));
    }
  }
});

await test('fishery composes the existing identity reflection exactly once and ignores pause, output, name and round changes', () => {
  const { state, city, view } = retainedStateFixture();
  const before = structuredClone(state);
  const signs = new Set<number>();
  for (const tileId of [56, 57]) for (const detail of ['far', 'mid', 'close'] as const) {
    const site = { ...view, tileId };
    const built = improvementParts(site, detail);
    assert.deepEqual(built, workedLandCompositionV1(site, shoreFisheryParts(site, detail)));
    const identity = built.find(part => part.material === 'identity'); assert.ok(identity);
    signs.add(Math.sign(identity.position[0]));
    const pending = improvementParts({ ...site, status: 'building', operation: null }, detail);
    assert.deepEqual(pending.find(part => part.material === 'identity'), identity);
    assert.deepEqual(improvementParts({ ...site, townName: 'New town name', name: 'New display name', baseProduction: { food: 999 },
      operation: { enabled: false, lastResult: null } }, detail), built);
    const previous = site.operation?.lastResult; assert.ok(previous);
    assert.deepEqual(improvementParts({ ...site, operation: { enabled: true, lastResult: { ...previous, round: 99, status: 'blocked',
      paid: {}, produced: {}, blockedReason: 'input-shortage', shortages: [{ resource: 'materials', required: 1, available: 0 }] } } }, detail), built);
  }
  assert.equal(signs.size, 2);
  assert.deepEqual(state, before);
  state.round = 99;
  city.name = 'Later display name';
  city.improvements!['56']!.operation = { enabled: false, lastResult: null };
  const later = projectWorld(state).improvements?.[0]; assert.ok(later);
  for (const detail of ['far', 'mid', 'close'] as const) assert.deepEqual(improvementParts(later, detail), improvementParts(view, detail));
});

await test('fishery marker is an original fish outline and cannot fall back to mine, mill or pasture', () => {
  assert.equal(improvementMark({ improvementId: 'shore-fishery' }), 'fishery');
  assert.equal(improvementMark({ improvementId: 'mine' }), 'mine');
  assert.equal(improvementMark({ improvementId: 'lumber-mill' }), 'lumber');
  assert.equal(improvementMark({ improvementId: 'pasture' }), 'pasture');
  assert.equal(SHORE_FISHERY_MARK_PATH, 'M4 12L9 6L17 8L20 12L17 16L9 18ZM4 12L1 8V16ZM16 11h.01');
  assert.equal(new Set([SHORE_FISHERY_MARK_PATH, SITE_MARK_PATHS.mine, LUMBER_MARK_PATH, PASTORAL_MARK_PATH]).size, 4);
});

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
  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  getContext(): null { return null; }
  replaceWith(replacement: SvgElement): void {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index < 0) return;
    replacement.parentElement = parent; parent.children.splice(index, 1, replacement); this.parentElement = null;
  }
  querySelectorAll(selector: string): SvgElement[] {
    const classes = selector.split(',').map(value => value.trim().slice(1));
    return this.descendants().filter(element => (element.attributes['class'] ?? '').split(' ').some(value => classes.includes(value)));
  }
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

await test('actual flat renderer consumes fishery parts at unchanged town LOD with fish marks and exact mouse/keyboard Work targets', () => withSvg(() => {
  for (const status of ['building', 'built', 'paused'] as const) for (const width of [1000, 360]) {
    const { world, view } = retainedStateFixture(status);
    const before = structuredClone(world);
    const container = new SvgElement('div'); container.clientWidth = width;
    const selected: Array<[string, string | null | undefined]> = [];
    const origin = hexPosition(view.q, view.r);
    const point = flatMapPoint(origin.x, origin.z, view.height);
    const zoomBase = width < container.clientHeight ? 26 : 16;
    const renderer = createFlatAtlasRenderer(container as unknown as HTMLElement, world,
      { ...DEFAULT_PREFERENCES, selectedCity: view.cityId, x: point.x, z: point.z / .72, zoom: 30 * zoomBase / container.clientHeight },
      (id, workId) => selected.push([id, workId]), () => {});
    try {
      const svg = container.children.find(element => element.tag === 'svg'); assert.ok(svg);
      let generic: DetailLevel | undefined;
      for (const [diameter, detail] of cameraSteps) {
        renderer.restoreCamera({ x: point.x, z: point.z / .72, zoom: diameter * zoomBase / container.clientHeight });
        generic = visualDetail(diameter, generic);
        assert.equal(svg.dataset['townDetail'], detail);
        assert.equal(svg.dataset['detail'], generic);
        const site: SvgElement | undefined = svg.descendants().find(element => element.attributes['data-district-id'] === view.id); assert.ok(site);
        assert.equal(site.attributes['data-tile-id'], String(view.tileId));
        assert.equal(site.attributes['data-status'], view.status);
        assert.equal(site.attributes['aria-label'], `Inspect ${improvementLabel(view)} of ${view.townName}, tile ${view.tileId}. ${view.status === 'building' ? 'Under construction' : 'Built'} improvement`);
        assert.equal(site.attributes['transform'], `translate(${point.x} ${point.z})`);
        const parts = improvementParts(view, detail);
        const polygons: SvgElement[] = site.descendants().filter(element => element.attributes['data-part']);
        assert.deepEqual(polygons.map(element => [element.attributes['data-part'], element.attributes['points']]), flatSceneFaces(parts, .72).map(face => [face.part.id, face.points]));
        assert.equal(new Set(polygons.map(element => element.attributes['data-part'])).size, parts.length);
        const marks: SvgElement[] = site.descendants().filter(element => element.tag === 'path');
        assert.deepEqual(marks.map(element => element.attributes['d']), [SHORE_FISHERY_MARK_PATH]);
        const hit: SvgElement | undefined = site.children.find(element => element.attributes['class'] === 'district-hit'); assert.ok(hit);
        assert.ok(Number(hit.attributes['r']) > 0);
        assert.equal(hit.style.pointerEvents, 'all');
        assert.equal(site.attributes['tabindex'], '0');
        let prevented = 0;
        for (const listener of site.listeners.click ?? []) listener({ key: '', preventDefault: () => {} });
        for (const key of ['Enter', ' ', 'Escape']) for (const listener of site.listeners.keydown ?? []) listener({ key, preventDefault: () => { prevented++; } });
        const workId = status === 'building' ? `active:${view.construction?.id}` : String(view.tileId);
        assert.deepEqual(selected.splice(0), Array.from({ length: 3 }, () => [view.cityId, workId]));
        assert.equal(prevented, 2);
      }
      assert.deepEqual(world, before);
    } finally { renderer.dispose(); }
    assert.deepEqual(container.children, []);
  }
}));

await test('shared Three consumer retains every fishery part, triangle, material and exact site transform across unchanged LOD', () => {
  for (const status of ['building', 'built', 'paused'] as const) {
    const { world, view } = retainedStateFixture(status);
    const before = structuredClone(world);
    const materials = new Map<string, THREE.MeshBasicMaterial>();
    const meshes = createImprovementMeshes(world, color => {
      const material = materials.get(color) ?? new THREE.MeshBasicMaterial({ color }); materials.set(color, material); return material;
    });
    const key = (values: ArrayLike<number>): string => Array.from(values, Math.fround).join(',');
    const origin = hexPosition(view.q, view.r);
    try {
      for (const [diameter, detail] of cameraSteps) {
        assert.equal(meshes.update(diameter), detail);
        const actual = meshes.group.children.flatMap(mesh => {
          assert.ok(mesh instanceof THREE.InstancedMesh && mesh.material instanceof THREE.MeshBasicMaterial);
          assert.ok(mesh.boundingSphere);
          const color = mesh.material.color.getHexString();
          return Array.from({ length: mesh.count }, (_, index) => {
            const matrix = new THREE.Matrix4(); mesh.getMatrixAt(index, matrix);
            return `${color}:${key(mesh.geometry.getAttribute('position').array)}:${key(matrix.elements)}`;
          });
        });
        const expected = improvementParts(view, detail).map(part => {
          const color = part.material === 'identity' ? view.color : VISUAL_PALETTE[part.material];
          const matrix = new THREE.Matrix4().compose(new THREE.Vector3(origin.x + part.position[0], view.height + part.position[1], origin.z + part.position[2]),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), part.rotation), new THREE.Vector3(...part.scale));
          return `${color.slice(1)}:${key(shapeTriangles(part.shape))}:${key(matrix.elements)}`;
        });
        assert.deepEqual(actual.sort(), expected.sort());
      }
      assert.deepEqual(world, before);
    } finally { meshes.dispose(); for (const material of materials.values()) material.dispose(); }
    assert.equal(meshes.group.children.length, 0);
  }
});
