import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createWorld } from '../core/engine.ts';
import { SPACEFLIGHT_RULES } from '../core/content.ts';
import { initializeSpaceflight } from '../core/simulation/spaceflight.ts';
import { marsBodyScene, projectMarsBody } from '../visuals/mars-body.ts';
import type { MarsBodyObservation } from '../visuals/mars-body.ts';
import { createMarsBodyRenderer, createMarsSceneMeshes } from '../web/mars-body-renderer.ts';
import { renderMarsBodyInspection } from '../web/mars-body-inspection.ts';
import { DEFAULT_PREFERENCES, MAP_ZOOM } from '../web/viewer-state.ts';
import { flatMapPoint, transformedVertices } from '../web/settlement-parts.ts';
import { mapContentWindow } from '../visuals/map-hierarchy.ts';
import { mapHierarchyObstacles } from '../web/map-labels.ts';

function fixture(): MarsBodyObservation {
  const state = createWorld(41); state.unlockedFeatures.push(SPACEFLIGHT_RULES.featureId); initializeSpaceflight(state);
  state.civilizations[0]!.marsProgress = SPACEFLIGHT_RULES.habitat.requiredWork; state.civilizations[0]!.marsPopulation = 3;
  state.spaceflight!.civilizations[0]!.colony = { establishedRound: 8, shortageRounds: 0, stock: { food: 4, materials: 3, energy: 6, credits: 0, science: 0, culture: 0 } };
  const ledger = state.spaceflight!.civilizations[0]!;
  ledger.lastArrival = { ruleVersion: 1, missionId: 'mars-0-1', civId: 0, sourceCityId: 'city-0', round: 8, eventId: 'arrival', settlers: 3,
    cargo: { ...SPACEFLIGHT_RULES.settle.cargo }, populationBefore: 0, populationAfter: 3, stockBefore: { ...ledger.colony!.stock }, stockAfter: { ...ledger.colony!.stock } };
  ledger.lastHabitatWork = { ruleVersion: 1, civId: 0, round: 8, eventId: 'work', paid: { ...SPACEFLIGHT_RULES.habitat.costPerBeat }, progressBefore: 75, progressAfter: SPACEFLIGHT_RULES.habitat.requiredWork };
  return projectMarsBody(state);
}
class NodeRecord {
  tag: string; textContent = ''; className = ''; id = ''; hidden = false; clientWidth = 1180; clientHeight = 680; left = 0; top = 0; tabIndex = -1; type = ''; title = '';
  dataset: Record<string, string> = {}; style: Record<string, string> = {}; attributes = new Map<string, string>(); children: NodeRecord[] = []; parent: NodeRecord | null = null;
  listeners = new Map<string, Set<EventListener>>(); captured = new Set<number>();
  classList = { add: (name: string): void => { this.className += ` ${name}`; } };
  constructor(tag: string) { this.tag = tag; }
  get parentElement(): NodeRecord | null { return this.parent; }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } { return { left: this.left, top: this.top, width: this.clientWidth, height: this.clientHeight }; }
  closest(selector: string): NodeRecord | null { return selector === `#${this.id}` ? this : this.parent?.closest(selector) ?? null; }
  querySelectorAll(selector: string): NodeRecord[] {
    const classes = selector.split(',').map(entry => entry.trim().slice(1));
    return this.children.flatMap(child => [...(classes.some(name => child.className.split(' ').includes(name)) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  append(...nodes: NodeRecord[]): void { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  replaceChildren(...nodes: NodeRecord[]): void { for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes); }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  addEventListener(name: string, handler: EventListener): void { const entries = this.listeners.get(name) ?? new Set<EventListener>(); entries.add(handler); this.listeners.set(name, entries); }
  removeEventListener(name: string, handler: EventListener): void { this.listeners.get(name)?.delete(handler); }
  emit(name: string, values: Record<string, unknown> = {}): void {
    const event = { preventDefault: () => {}, ...values } as unknown as Event;
    for (const handler of this.listeners.get(name) ?? []) handler(event);
  }
  setPointerCapture(id: number): void { this.captured.add(id); }
  hasPointerCapture(id: number): boolean { return this.captured.has(id); }
  releasePointerCapture(id: number): void { this.captured.delete(id); }
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].join(' '); }
}
function recordingDom(): { nodes: NodeRecord[]; resize: (node?: NodeRecord) => void; disconnected: () => boolean; restore: () => void } {
  const names = ['document', 'ResizeObserver'] as const;
  const old = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const nodes: NodeRecord[] = []; let callback: (() => void) | undefined; let disconnected = false; const observed = new Set<NodeRecord>();
  const make = (tag: string): NodeRecord => { const node = new NodeRecord(tag); nodes.push(node); return node; };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: make,
    createElementNS: (_namespace: string, tag: string) => make(tag), createTextNode: (text: string) => { const node = make('#text'); node.textContent = text; return node; } } });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
    constructor(fn: () => void) { callback = fn; }
    observe(node: NodeRecord): void { observed.add(node); }
    disconnect(): void { disconnected = true; observed.clear(); }
  } });
  return { nodes, resize: node => { if (!node || observed.has(node)) callback?.(); }, disconnected: () => disconnected,
    restore: () => { for (const [name, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } } };
}
function host(): HTMLElement { return document.createElement('div'); }

void test('flat DOM adapter consumes the same scene parts as Three object adapter without claiming pixel equivalence', () => {
  const dom = recordingDom();
  try {
    const observation = fixture(); const before = structuredClone(observation); const scene = marsBodyScene(observation);
    const container = host(); const labels = host(); const renderer = createMarsBodyRenderer(container, labels, observation, DEFAULT_PREFERENCES, () => {}, 'flat');
    const renderedIds = new Set(dom.nodes.flatMap(node => node.attributes.has('data-part') ? [node.attributes.get('data-part')] : []));
    assert.deepEqual(renderedIds, new Set(scene.parts.map(entry => entry.part.id)));
    const layers = dom.nodes.filter(node => node.attributes.has('data-layer'));
    assert.deepEqual(layers.map(node => node.attributes.get('data-layer')), ['ground', 'landmark', 'recorded']);
    assert.deepEqual(layers[0]!.parent!.children, layers);
    for (const layer of layers) for (const polygon of layer.children.filter(node => node.attributes.has('data-part'))) {
      assert.equal(scene.parts.find(entry => entry.part.id === polygon.attributes.get('data-part'))!.layer, layer.attributes.get('data-layer'));
    }
    assert.ok(layers[2]!.children.some(node => node.attributes.get('data-part') === 'mars:0-roof'));
    const meshes = createMarsSceneMeshes(scene);
    const instances = meshes.group.children.filter(child => child instanceof THREE.InstancedMesh);
    assert.equal(instances.reduce((sum, mesh) => sum + mesh.count, 0), scene.parts.length);
    assert.ok(instances.every(mesh => mesh.geometry.getAttribute('position').count > 0));
    assert.deepEqual(observation, before);
    let geometryDisposals = 0; let materialDisposals = 0;
    for (const geometry of new Set(instances.map(mesh => mesh.geometry))) geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
    for (const material of new Set(instances.flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]))) material.addEventListener('dispose', () => { materialDisposals += 1; });
    const expectedGeometries = new Set(instances.map(mesh => mesh.geometry)).size;
    const expectedMaterials = new Set(instances.map(mesh => mesh.material)).size;
    meshes.dispose(); meshes.dispose();
    assert.equal(geometryDisposals, expectedGeometries); assert.equal(materialDisposals, expectedMaterials); assert.equal(meshes.group.children.length, 0);
    renderer.dispose(); assert.equal((container as unknown as NodeRecord).children.length, 0); assert.equal((labels as unknown as NodeRecord).children.length, 0);
    assert.equal(dom.disconnected(), true);
    assert.ok(dom.nodes.every(node => [...node.listeners.values()].every(entries => entries.size === 0)));
  } finally { dom.restore(); }
});

void test('flat viewer supports bounded camera restore reset framing keyboard pan zoom and pointer cleanup', () => {
  const dom = recordingDom();
  try {
    const container = host(); const labels = host(); const renderer = createMarsBodyRenderer(container, labels, fixture(), DEFAULT_PREFERENCES, () => {}, 'flat');
    renderer.restoreCamera({ x: Infinity, z: -1000, zoom: 999 });
    assert.deepEqual(renderer.snapshot(), { x: 0, z: -20, zoom: MAP_ZOOM.maximum });
    renderer.zoom(.0001); assert.equal(renderer.snapshot().zoom, MAP_ZOOM.minimum);
    renderer.zoom(NaN); assert.equal(renderer.snapshot().zoom, MAP_ZOOM.minimum);
    renderer.reset(); assert.deepEqual(renderer.snapshot(), { x: 0, z: 0, zoom: 1 });
    const surface = dom.nodes.find(node => node.tag === 'svg')!;
    assert.equal(surface.tabIndex, 0); surface.emit('keydown', { key: 'ArrowRight' }); assert.equal(renderer.snapshot().x, 2);
    surface.emit('keydown', { key: '+' }); assert.equal(renderer.snapshot().zoom, 1.2);
    surface.emit('keydown', { key: 'Home' }); assert.deepEqual(renderer.snapshot(), { x: 0, z: 0, zoom: 1 });
    renderer.frameCity('mars:0', { x: .35, y: .48 });
    const marker = dom.nodes.find(node => node.dataset['selectionId'] === 'mars:0')!;
    assert.ok(Math.abs(parseFloat(marker.style['left']!) / 1180 - .35) < .0001);
    const site = marsBodyScene(fixture()).sites[0]!;
    const label = flatMapPoint(site.labelPosition[0], site.labelPosition[2], site.labelPosition[1]);
    const center = flatMapPoint(site.position[0], site.position[2], site.position[1]);
    const scale = Math.min((1180 - 16 - 24) / 32, (680 - 16 - 64) / 14);
    assert.ok(Math.abs(parseFloat(marker.style['top']!) - ((label.z - center.z) * scale + 680 * .48 - 48)) < .0001);
    const previous = renderer.snapshot(); renderer.frameCity('city-0', { x: .2, y: .2 }); assert.deepEqual(renderer.snapshot(), previous);
    surface.emit('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    surface.emit('pointermove', { pointerId: 1, clientX: 110, clientY: 115 }); assert.notDeepEqual(renderer.snapshot(), previous);
    surface.emit('pointerdown', { pointerId: 2, button: 0, clientX: 150, clientY: 100 });
    const zoom = renderer.snapshot().zoom; surface.emit('pointermove', { pointerId: 2, clientX: 180, clientY: 100 }); assert.ok(renderer.snapshot().zoom > zoom);
    renderer.dispose(); assert.equal(surface.captured.size, 0); dom.resize();
  } finally { dom.restore(); }
});

void test('narrow native buttons retain exact accessible facts and selection never dispatches world commands', () => {
  const dom = recordingDom();
  try {
    const observation = fixture(); const before = structuredClone(observation); const selected: string[] = [];
    const container = host(); (container as unknown as NodeRecord).clientWidth = 375;
    const renderer = createMarsBodyRenderer(container, host(), observation, DEFAULT_PREFERENCES, id => selected.push(id), 'flat');
    const marker = dom.nodes.find(node => node.dataset['selectionId'] === 'mars:0')!;
    assert.equal(marker.tag, 'button'); assert.equal(marker.type, 'button'); assert.match(marker.attributes.get('aria-label')!, /Aster.*Habitable.*3 people/);
    assert.equal(marker.style['minHeight'], '44px'); marker.emit('click'); assert.deepEqual(selected, ['mars:0']);
    assert.equal(marker.attributes.get('aria-pressed'), 'true'); assert.deepEqual(observation, before);
    renderer.selectRoute('route-0'); renderer.setLayer('routes', false); renderer.setMotion(true); renderer.showEvents([]); renderer.clearEvents();
    assert.deepEqual(observation, before); renderer.dispose(); marker.emit('click'); assert.deepEqual(selected, ['mars:0']);
  } finally { dom.restore(); }
});

void test('inspection is inert safe text with separate delivered reserves active cargo and terminal retained state', () => {
  const dom = recordingDom();
  try {
    const observation = fixture(); observation.terminal = true;
    observation.civilizations[0]!.name = '<img src=x onerror=alert(1)>';
    observation.civilizations[0]!.mission = { ruleVersion: 1, id: 'test-mission', eventId: 'test-departure', civId: 0, mission: 'resupply', sourceCityId: 'city-0', departureRound: 9, arrivalRound: 13,
      settlers: 1, launchCost: { credits: 36 }, cargo: { food: 24 }, totalCost: { food: 24, credits: 36 }, paid: { food: 24, credits: 36 }, sourcePopulationBefore: 10, sourcePopulationAfter: 9 };
    const before = structuredClone(observation); const container = host(); renderMarsBodyInspection(container, observation, 0);
    const text = (container as unknown as NodeRecord).content();
    assert.match(text, /Delivered reserves.*4 food.*3 materials.*6 energy/);
    assert.match(text, /In transit — not delivered.*test-mission/); assert.match(text, /Cargo in transit.*24 food/);
    assert.match(text, /In flight at world end; scheduled arrival round 13/); assert.match(text, /No local production is implied/);
    assert.ok(!dom.nodes.some(node => ['button', 'input', 'form', 'img'].includes(node.tag)));
    assert.deepEqual(observation, before);
    renderMarsBodyInspection(container, observation, 999); assert.match((container as unknown as NodeRecord).content(), /No observation/);
  } finally { dom.restore(); }
});

void test('empty and terminal scenes schedule no animation and do not fabricate a surface landing', () => {
  const dom = recordingDom();
  try {
    const state = createWorld(41); const observation = projectMarsBody(state); const renderer = createMarsBodyRenderer(host(), host(), observation, DEFAULT_PREFERENCES, () => {}, 'flat');
    assert.ok(!dom.nodes.some(node => node.className === 'mars-body-marker'));
    assert.match(dom.nodes.find(node => node.className === 'mars-body-state')!.textContent, /No colony has arrived/);
    assert.match(dom.nodes.find(node => node.className === 'mars-body-context')!.textContent, /not simulated geography/);
    renderer.dispose();
    observation.terminal = true;
    const terminalLabels = host(); const terminal = createMarsBodyRenderer(host(), terminalLabels, observation, DEFAULT_PREFERENCES, () => {}, 'flat');
    assert.ok(!(terminalLabels as unknown as NodeRecord).content().includes('World complete'));
    terminal.dispose();
  } finally { dom.restore(); }
});

void test('actual overlay bounds frame colonies and retained transit and late obstacle resizing is observed without changing the saved camera', () => {
  for (const size of [{ width: 1180, height: 680, headingWidth: 150, headingHeight: 195, chronicleTop: 390 },
    { width: 501, height: 680, headingWidth: 290, headingHeight: 160, chronicleTop: 472 },
    { width: 334, height: 420, headingWidth: 170, headingHeight: 120, chronicleTop: 310 }]) {
    const dom = recordingDom();
    try {
      const app = host() as unknown as NodeRecord; app.id = 'app';
      const container = host(); const map = container as unknown as NodeRecord; map.clientWidth = size.width; map.clientHeight = size.height;
      const labels = host(); app.append(map, labels as unknown as NodeRecord);
      const heading = host() as unknown as NodeRecord; heading.className = 'world-heading'; heading.left = 10; heading.top = 8;
      heading.clientWidth = size.headingWidth; heading.clientHeight = size.headingHeight;
      const chronicle = host() as unknown as NodeRecord; chronicle.className = 'chronicle'; chronicle.left = 10; chronicle.top = size.chronicleTop;
      chronicle.clientWidth = size.width < 600 ? size.width - 20 : 332; chronicle.clientHeight = size.height - size.chronicleTop - 70;
      const controls = host() as unknown as NodeRecord; controls.className = 'civilization-panel';
      controls.left = size.width < 600 ? 0 : 180; controls.top = size.width < 600 ? size.height - 64 : 12;
      controls.clientWidth = size.width < 600 ? size.width : 820; controls.clientHeight = 64;
      app.append(heading, chronicle, controls);
      const observation = fixture(); observation.terminal = true;
      observation.civilizations[1]!.mission = { ruleVersion: 1, id: 'held', eventId: 'departure', civId: 1, mission: 'settle', sourceCityId: 'city-1', departureRound: 9, arrivalRound: 13,
        settlers: 3, launchCost: { credits: 36 }, cargo: { food: 24 }, totalCost: { food: 24, credits: 36 }, paid: { food: 24, credits: 36 }, sourcePopulationBefore: 10, sourcePopulationAfter: 7 };
      const renderer = createMarsBodyRenderer(container, labels, observation, DEFAULT_PREFERENCES, () => {}, 'flat');
      const assertVisible = (): void => {
        const available = mapContentWindow(size.width, size.height, mapHierarchyObstacles(container))!;
        for (const marker of dom.nodes.filter(node => node.className === 'mars-body-marker')) {
          assert.equal(marker.hidden, false, `${size.width}px ${marker.dataset['kind']}`);
          const x = parseFloat(marker.style['left']!); const y = parseFloat(marker.style['top']!); const width = parseFloat(marker.style['width']!);
          assert.ok(x - width / 2 >= available.left && x + width / 2 <= available.left + available.width);
          assert.ok(y >= available.top && y + 44 <= available.top + available.height);
        }
        const transform = dom.nodes.find(node => node.attributes.get('transform')?.startsWith('translate('))!.attributes.get('transform')!;
        const values = transform.match(/-?\d+(?:\.\d+)?/g)!.map(Number); const [x, y, scale] = values;
        const scene = marsBodyScene(observation);
        for (const entry of scene.parts.filter(entry => ['habitat', 'resident', 'reserve'].includes(entry.kind))) for (const vertex of transformedVertices(entry.part)) {
          const point = flatMapPoint(vertex[0], vertex[2], vertex[1]);
          assert.ok(x! + point.x * scale! >= available.left && x! + point.x * scale! <= available.left + available.width, `${size.width}px ${entry.part.id} horizontal`);
          assert.ok(y! + point.z * scale! >= available.top && y! + point.z * scale! <= available.top + available.height, `${size.width}px ${entry.part.id} vertical`);
        }
      };
      assertVisible(); const camera = renderer.snapshot();
      const before = dom.nodes.find(node => node.dataset['kind'] === 'colony')!.style['top'];
      heading.clientHeight += 24; dom.resize(heading);
      assertVisible(); assert.deepEqual(renderer.snapshot(), camera);
      if (size.width < 600) assert.notEqual(dom.nodes.find(node => node.dataset['kind'] === 'colony')!.style['top'], before);
      renderer.restoreCamera(camera); assertVisible(); renderer.dispose();
    } finally { dom.restore(); }
  }
});
