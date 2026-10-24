import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import type { DistrictView } from '../visuals/district-visuals.ts';
import type { ImprovementView } from '../visuals/improvement-visuals.ts';
import type { AtlasWorld } from '../web/atlas.ts';
import { districtInspectionWork, inspectionSectionForSiteWork, inspectionRequestNeedsRender, siteInspectionRequestKey, mapInspectionSites, retainSiteOverlayFocus, restoreSiteOverlayFocus, type SiteInspectionWork } from '../web/site-overlay-selection.ts';
import { createSiteOverlaySources, mapHierarchyAnchors, projectMapSiteGeometry } from '../web/map-labels.ts';
import { flatMapPoint, flatSceneFaces, transformedVertices } from '../web/settlement-parts.ts';
import { districtParts } from '../visuals/district-visuals.ts';
import { improvementParts } from '../visuals/improvement-visuals.ts';
import { hexPosition } from '../web/atlas.ts';
import { createSiteMapMarks } from '../web/renderer.ts';
import { createFlatAtlasRenderer } from '../web/flat-renderer.ts';
import { DEFAULT_PREFERENCES } from '../web/viewer-state.ts';
import { createWorldCues } from '../web/world-cues.ts';

const district: DistrictView = { id: 'district:harbor:commercial-hub', cityId: 'harbor', townName: 'Harbor', civId: 0, tileId: 7,
  q: 0, r: 0, height: .6, color: '#bbac78', status: 'built', buildingId: 'commercial-hub', name: 'Commercial hub',
  attachments: [{ buildingId: 'market', name: 'Market', status: 'built' }, { buildingId: 'bank', name: 'Bank', status: 'built' }],
  library: 'absent', construction: null, baseProduction: {} };
const improvement: ImprovementView = { id: 'improvement:ridge:8', cityId: 'ridge', townName: 'Ridge', civId: 0, tileId: 8,
  q: 3, r: 1, height: .4, color: '#bbac78', status: 'built', improvementId: 'lumber-mill', name: 'Lumber mill',
  construction: null, completion: null, operation: null, baseProduction: {}, residentsRequired: 1 };
const world: AtlasWorld = { tiles: [], cities: [], routes: [], districts: [district], improvements: [improvement] };

await test('district inspection identifies the parent district and exact active order, never an attachment or a guessed unknown campus', () => {
  assert.equal(districtInspectionWork(district), 'commercial-hub');
  assert.equal(districtInspectionWork({ ...district, status: 'building', construction: { id: 'order:7', cityId: 'harbor', tileId: 7, buildingId: 'commercial-hub' } as DistrictView['construction'] }), 'active:order:7');
  assert.equal(districtInspectionWork({ ...district, status: 'building' }), null);
  assert.equal(districtInspectionWork({ ...district, status: 'building', construction: { id: 'wrong-kind', cityId: 'harbor', tileId: 7, kind: 'improvement', improvementId: 'mine' } as DistrictView['construction'] }), null);
  assert.equal(districtInspectionWork({ ...district, buildingId: '', name: 'Unknown site' }), null);
  const { buildingId: _id, ...legacy } = district;
  assert.equal(districtInspectionWork({ ...legacy, name: 'Campus', library: 'built', attachments: [] }), 'campus');
  assert.equal(districtInspectionWork({ ...legacy, name: 'Unknown district' }), null);
});

await test('explicit overview and missing exact work requests do not expose the first unrelated work card', () => {
  assert.notEqual(siteInspectionRequestKey(null), siteInspectionRequestKey(undefined));
  assert.notEqual(siteInspectionRequestKey(null), siteInspectionRequestKey('null'));
  assert.equal(inspectionSectionForSiteWork(undefined, ['market', 'campus'], 'routes'), 'routes');
  assert.equal(inspectionSectionForSiteWork(null, ['market', 'campus'], 'work'), 'overview');
  assert.equal(inspectionSectionForSiteWork('commercial-hub', ['market', 'campus'], 'work'), 'overview');
  assert.equal(inspectionSectionForSiteWork('campus', ['market', 'campus'], 'overview'), 'work');
  assert.equal(inspectionSectionForSiteWork('active:order:7', ['active:order:8'], 'overview'), 'overview');
});

await test('repeated exact site requests bypass unchanged-world memoization after a manual picker change', () => {
  let cached = '';
  let pending: SiteInspectionWork | undefined;
  let selectedWork = '';
  let section = 'overview';
  const render = (request: SiteInspectionWork | undefined): boolean => {
    pending = request;
    const fingerprint = JSON.stringify(['paused-world', siteInspectionRequestKey(pending)]);
    if (!inspectionRequestNeedsRender(pending, fingerprint, cached)) return false;
    const workRequest = pending;
    selectedWork = workRequest === undefined ? selectedWork : workRequest ?? '';
    pending = undefined;
    cached = fingerprint;
    section = inspectionSectionForSiteWork(workRequest, ['commercial-hub', 'campus'], section);
    return true;
  };
  assert.equal(render('commercial-hub'), true);
  assert.equal(pending, undefined);
  selectedWork = 'campus';
  assert.equal(render('commercial-hub'), true);
  assert.equal(selectedWork, 'commercial-hub');
  assert.equal(section, 'work');
  assert.equal(pending, undefined);
  assert.equal(render(undefined), true);
  selectedWork = 'campus';
  assert.equal(render(undefined), false);
  assert.equal(selectedWork, 'campus');
  assert.equal(inspectionRequestNeedsRender(undefined, 'changed-world', cached), true);
  assert.equal(render('missing-work'), true);
  section = 'work';
  assert.equal(render('missing-work'), true);
  assert.equal(section, 'overview');
  assert.equal(pending, undefined);
});

await test('repeated explicit overview requests bypass cached null after manual Work selection', () => {
  let cached = '';
  let section = 'overview';
  let pending: SiteInspectionWork | undefined;
  const render = (request: SiteInspectionWork | undefined): boolean => {
    pending = request;
    const fingerprint = JSON.stringify(['paused-world', siteInspectionRequestKey(pending)]);
    if (!inspectionRequestNeedsRender(pending, fingerprint, cached)) return false;
    const workRequest = pending;
    pending = undefined;
    cached = fingerprint;
    section = inspectionSectionForSiteWork(workRequest, ['commercial-hub', 'campus'], section);
    return true;
  };
  assert.equal(render(null), true);
  section = 'work';
  assert.equal(render(null), true);
  assert.equal(section, 'overview');
  assert.equal(pending, undefined);
  section = 'routes';
  assert.equal(render(undefined), true);
  assert.equal(render(undefined), false);
  assert.equal(section, 'routes');
});

await test('shared anchors keep short captions separate from complete identity and attachment labels', () => {
  const anchors = mapHierarchyAnchors(world, 'harbor', null, () => ({ x: 500, y: 350 }));
  assert.equal(anchors[0]?.shortLabel, 'Commercial hub');
  assert.match(anchors[0]?.label ?? '', /Market.*Bank/);
  assert.equal(anchors[0]?.id, district.id);
  assert.equal(anchors[0]?.tileId, 7);
  assert.equal(anchors[1]?.shortLabel, 'Lumber mill');
  assert.equal(anchors[1]?.related, false);
});

await test('the adapters cache the exact published parts per site LOD and project their real vertices at 84px', () => {
  const sources = createSiteOverlaySources(world);
  for (const source of sources) for (const detail of ['far', 'mid', 'close'] as const) {
    const parts = source.parts(detail);
    assert.strictEqual(source.parts(detail), parts);
    assert.strictEqual(source.geometry(detail), source.geometry(detail));
    assert.deepEqual(parts, source.id === district.id ? districtParts(district, detail) : improvementParts(improvement, detail));
    const project = (x: number, y: number, z: number) => { const point = flatMapPoint(x, z, y); return { x: point.x * 42 + 500, y: point.z * 42 + 350 }; };
    const bounds = projectMapSiteGeometry([source], detail, project, { width: 1000, height: 700 }).get(source.id)?.bounds;
    assert.ok(bounds);
    const origin = hexPosition(source.q, source.r);
    for (const vertex of parts.flatMap(transformedVertices)) {
      const point = project(origin.x + vertex[0], source.height + vertex[1], origin.z + vertex[2]);
      assert.ok(point.x >= bounds.left && point.x <= bounds.left + bounds.width && point.y >= bounds.top && point.y <= bounds.top + bounds.height);
    }
  }
});

await test('orthographic Three projection uses the same cached recipe with current height and orientation', () => {
  const camera = new THREE.OrthographicCamera(-12, 12, 8.4, -8.4, .1, 160);
  camera.position.set(19, 29, 31); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const project = (x: number, y: number, z: number) => { const point = new THREE.Vector3(x, y, z).project(camera); return { x: (point.x + 1) * 500, y: (1 - point.y) * 350 }; };
  const sources = createSiteOverlaySources(world);
  const projected = projectMapSiteGeometry(sources, 'close', project, { width: 1000, height: 700 });
  for (const source of sources) {
    const bounds = projected.get(source.id)?.bounds; assert.ok(bounds);
    const origin = hexPosition(source.q, source.r);
    for (const [x, y, z] of source.parts('close').flatMap(transformedVertices)) {
      const point = project(origin.x + x, source.height + y, origin.z + z);
      assert.ok(point.x >= bounds.left && point.x <= bounds.left + bounds.width && point.y >= bounds.top && point.y <= bounds.top + bounds.height);
    }
  }
});

class OverlayElement {
  tag: string;
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: OverlayElement[] = [];
  parentElement: OverlayElement | null = null;
  style = { setProperty(name: string, value: string) { Reflect.set(this, name, value); } } as unknown as CSSStyleDeclaration;
  classList = { toggle: (): boolean => false };
  listeners = new Map<string, Array<(event: { key: string; preventDefault: () => void }) => void>>();
  clientWidth = 0;
  clientHeight = 0;
  bounds = { left: 0, top: 0, width: 0, height: 0 };
  viewBox = { baseVal: { x: 0, y: 0, width: 1, height: 1 } };
  hidden = false;
  tabIndex = 0;
  textContent = '';
  innerHTML = '';
  constructor(tag: string) { this.tag = tag; }
  get className(): string { return this.attributes['class'] ?? ''; }
  set className(value: string) { this.attributes['class'] = value; if (value.split(' ').includes('world-cue')) this.bounds = { left: 0, top: 0, width: 180, height: 44 }; }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
    if (name === 'viewBox') { const [x = 0, y = 0, width = 1, height = 1] = value.split(' ').map(Number); this.viewBox.baseVal = { x, y, width, height }; }
  }
  getAttribute(name: string): string | null {
    if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] ?? null;
    return name === 'hidden' ? this.hidden ? '' : null : this.attributes[name] ?? null;
  }
  hasAttribute(name: string): boolean { return this.getAttribute(name) !== null; }
  append(...children: OverlayElement[]): void { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  prepend(...children: OverlayElement[]): void { for (const child of children) child.parentElement = this; this.children.unshift(...children); }
  replaceChildren(...children: OverlayElement[]): void { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...children); }
  replaceWith(replacement: OverlayElement): void { const parent = this.parentElement; if (!parent) return; const index = parent.children.indexOf(this); parent.children.splice(index, 1, replacement); replacement.parentElement = parent; this.parentElement = null; }
  remove(): void { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  addEventListener(name: string, listener: (event: { key: string; preventDefault: () => void }) => void): void { const list = this.listeners.get(name) ?? []; list.push(listener); this.listeners.set(name, list); }
  fire(name: string, key = ''): number { let prevented = 0; for (const listener of this.listeners.get(name) ?? []) listener({ key, preventDefault: () => { prevented++; } }); return prevented; }
  all(): OverlayElement[] { return this.children.flatMap(child => [child, ...child.all()]); }
  matches(selector: string): boolean {
    return selector.split(',').some(part => {
      const value = part.trim();
      if (value.startsWith('.')) return this.className.split(' ').includes(value.slice(1));
      if (value.startsWith('#')) return this.attributes['id'] === value.slice(1);
      if (value.startsWith('[')) { const [name = '', expected] = value.slice(1, -1).split('='); return expected === undefined ? this.hasAttribute(name) : this.getAttribute(name) === expected.replaceAll('"', ''); }
      return this.tag === value;
    });
  }
  querySelectorAll(selector: string): OverlayElement[] { return this.all().filter(element => element.matches(selector)); }
  querySelector(selector: string): OverlayElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): OverlayElement | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  contains(element: OverlayElement): boolean { return this === element || this.all().includes(element); }
  getBoundingClientRect(): typeof this.bounds { return this.bounds; }
  getContext(): null { return null; }
  focus(): void { dom.activeElement = this; this.fire('focus'); }
  blur(): void { if (dom.activeElement === this) dom.activeElement = null; }
}

const dom = { activeElement: null as OverlayElement | null,
  createElementNS: (_namespace: string, tag: string) => new OverlayElement(tag), createElement: (tag: string) => new OverlayElement(tag),
  createTextNode: (value: string) => { const node = new OverlayElement('#text'); node.textContent = value; return node; }, querySelectorAll: () => [] };

async function withOverlayDom(run: (observations: { resized: Array<() => void>; mutations: Array<(records: Array<{ target: OverlayElement; type: string }>) => void> }) => void | Promise<void>): Promise<void> {
  const resized: Array<() => void> = [];
  const mutations: Array<(records: Array<{ target: OverlayElement; type: string }>) => void> = [];
  const globals = { document: dom, window: { matchMedia: () => ({ matches: false }) }, HTMLElement: OverlayElement, SVGElement: OverlayElement, Element: OverlayElement,
    ResizeObserver: class { constructor(callback: () => void) { resized.push(callback); } observe(): void {} disconnect(): void {} },
    MutationObserver: class { constructor(callback: (records: Array<{ target: OverlayElement; type: string }>) => void) { mutations.push(callback); } observe(): void {} disconnect(): void {} } };
  const previous = new Map(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  dom.activeElement = null;
  try { for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, value }); await run({ resized, mutations }); }
  finally { for (const [name, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); dom.activeElement = null; }
}

function overlayShell(width = 1000, height = 700) {
  const shell = new OverlayElement('div'); shell.setAttribute('id', 'app');
  const map = new OverlayElement('div'); map.clientWidth = width; map.clientHeight = height; map.bounds = { left: 0, top: 0, width, height };
  const inspection = new OverlayElement('section'); inspection.className = 'inspection'; inspection.dataset['inspectionView'] = 'work';
  const picker = new OverlayElement('select'); picker.className = 'work-picker';
  const overview = new OverlayElement('button'); overview.dataset['inspectionFocus'] = 'overview';
  inspection.append(picker, overview); shell.append(map, inspection);
  return { shell, map, inspection, picker, overview };
}

await test('real Three site mark factory preserves district versus sibling-town work IDs for click, Enter and Space', async () => withOverlayDom(() => {
  const sites = mapInspectionSites(world);
  const labels = new OverlayElement('div');
  const selected: Array<[string, string | null | undefined]> = [];
  const marks = createSiteMapMarks(sites, labels as unknown as HTMLElement, (city, work) => selected.push([city, work]));
  for (const [index, mark] of marks.entries()) {
    const element = mark.element as unknown as OverlayElement;
    assert.equal(element.dataset['siteId'], sites[index]?.id);
    assert.match(element.getAttribute('aria-label') ?? '', /tile \d+\. Built/);
    element.fire('click'); assert.equal(element.fire('keydown', 'Enter'), 1); assert.equal(element.fire('keydown', ' '), 1); assert.equal(element.fire('keydown', 'Escape'), 0);
    const expected = index === 0 ? ['harbor', 'commercial-hub'] : ['ridge', '8'];
    assert.deepEqual(selected.splice(0), [expected, expected, expected]);
  }
}));

await test('flat actual overlays preserve 84px architecture, short captions, exact work IDs and current site LOD through pan and zoom', async () => withOverlayDom(() => {
  const { map } = overlayShell();
  const state: AtlasWorld = { ...world, improvements: [], cities: [{ id: 0, cityId: 'harbor', name: 'League', shortName: 'League', capital: 'Harbor', color: district.color, symbol: '', character: '', ambition: '', q: -4, r: 0 }],
    tiles: [{ id: 7, q: 0, r: 0, height: .6, terrain: 'grassland', owner: 0 }] };
  const before = structuredClone(state);
  const selected: Array<[string, string | null | undefined]> = [];
  const renderer = createFlatAtlasRenderer(map as unknown as HTMLElement, state, { ...DEFAULT_PREFERENCES, selectedCity: 'harbor', x: 0, z: 0, zoom: 84 * 16 / 700 }, (city, work) => selected.push([city, work]), () => {});
  try {
    const site = map.querySelector('[data-site-id]'); assert.ok(site);
    assert.equal(site.dataset['placementMode'], 'exterior');
    const hit = site.querySelector('.district-hit'); assert.ok(hit);
    assert.ok(Math.abs(Number(hit.getAttribute('r')) * 42 - 22) < 1e-8);
    const geometry = projectMapSiteGeometry(createSiteOverlaySources(state), 'close', (x, y, z) => { const point = flatMapPoint(x, z, y); return { x: point.x * 42 + 500, y: point.z * 42 + 350 }; }, { width: 1000, height: 700 }).get(district.id)?.bounds;
    assert.ok(geometry);
    const center = { x: 500 + Number(hit.getAttribute('cx')) * 42, y: 350 - .6 * .85 * 42 + Number(hit.getAttribute('cy')) * 42 };
    assert.ok(center.x + 25 <= geometry.left - 6 || center.x - 25 >= geometry.left + geometry.width + 6 || center.y + 25 <= geometry.top - 6 || center.y - 25 >= geometry.top + geometry.height + 6);
    assert.ok(site.all().filter(element => element.tag === 'text' && element.style.visibility === 'visible').every(element => element.textContent === 'Commercial hub'));
    assert.match(site.getAttribute('aria-label') ?? '', /Market.*Bank/);
    for (const [diameter, detail] of [[30, 'far'], [40, 'far'], [42, 'mid'], [78, 'mid'], [84, 'close'], [75, 'close'], [70, 'mid'], [36, 'mid'], [35, 'far']] as const) {
      renderer.restoreCamera({ x: .25, z: -.1, zoom: diameter * 16 / 700 });
      const svg = map.querySelector('svg'); assert.equal(svg?.dataset['townDetail'], detail);
      assert.deepEqual(site.all().filter(element => element.dataset['part']).map(element => element.dataset['part']), flatSceneFaces(districtParts(district, detail), .72).map(face => face.part.id));
    }
    site.fire('click'); site.fire('keydown', 'Enter'); site.fire('keydown', ' ');
    assert.deepEqual(selected, Array.from({ length: 3 }, () => ['harbor', 'commercial-hub']));
    assert.deepEqual(state, before);
  } finally { renderer.dispose(); }
}));

await test('HUD-only visibility changes reallocate flat targets and transfer an unplaceable focused site to its exact inspection', async () => withOverlayDom(async ({ mutations }) => {
  const { map, inspection, picker } = overlayShell();
  const selected: Array<[string, string | null | undefined]> = [];
  const renderer = createFlatAtlasRenderer(map as unknown as HTMLElement, world, { ...DEFAULT_PREFERENCES, x: 0, z: 0, zoom: 84 * 16 / 700 }, (city, work) => selected.push([city, work]), () => {});
  try {
    const site = map.querySelector('[data-site-id]'); assert.ok(site); site.focus();
    assert.equal(site.getAttribute('tabindex'), '0');
    inspection.bounds = { left: 0, top: 0, width: 1000, height: 700 };
    for (const callback of mutations) callback([{ target: inspection, type: 'attributes' }]);
    assert.equal(site.getAttribute('tabindex'), '-1'); assert.equal(site.getAttribute('aria-hidden'), 'true'); assert.equal(dom.activeElement, map);
    await Promise.resolve();
    assert.equal(dom.activeElement, picker); assert.deepEqual(selected.at(-1), ['harbor', 'commercial-hub']);
    inspection.bounds = { left: 0, top: 0, width: 0, height: 0 };
    for (const callback of mutations) callback([{ target: inspection, type: 'attributes' }]);
    assert.equal(site.getAttribute('tabindex'), '0'); assert.equal(dom.activeElement, picker);
  } finally { renderer.dispose(); }
}));

await test('same-world renderer reconstruction restores only the exact site and respects manual focus release and changed worlds', async () => withOverlayDom(async () => {
  const { map, picker } = overlayShell(); map.dataset['siteFocusWorld'] = 'world:one';
  const old = new OverlayElement('button'); old.dataset['siteId'] = district.id; map.append(old); old.focus();
  const retained = retainSiteOverlayFocus(map as unknown as HTMLElement, 'world:one'); assert.ok(retained);
  old.remove(); const replacement = new OverlayElement('g'); replacement.dataset['siteId'] = district.id; replacement.setAttribute('tabindex', '0'); map.append(replacement);
  const selected: Array<[string, string | null | undefined]> = [];
  const choose = (city: string, work?: string | null): void => { selected.push([city, work]); };
  restoreSiteOverlayFocus(map as unknown as HTMLElement, retained, 'world:one', { cityId: district.cityId, workId: 'commercial-hub' }, choose);
  assert.equal(dom.activeElement, replacement);
  const retainedAgain = retainSiteOverlayFocus(map as unknown as HTMLElement, 'world:one'); assert.ok(retainedAgain); picker.focus();
  restoreSiteOverlayFocus(map as unknown as HTMLElement, retainedAgain, 'world:one', { cityId: district.cityId, workId: 'commercial-hub' }, choose);
  assert.equal(dom.activeElement, picker); assert.deepEqual(selected, []);
  map.focus(); restoreSiteOverlayFocus(map as unknown as HTMLElement, retainedAgain, 'world:two', { cityId: district.cityId, workId: 'commercial-hub' }, choose);
  assert.equal(dom.activeElement, map); assert.deepEqual(selected, []);
  replacement.setAttribute('tabindex', '-1');
  restoreSiteOverlayFocus(map as unknown as HTMLElement, retainedAgain, 'world:one', { cityId: district.cityId, workId: 'commercial-hub' }, choose);
  await Promise.resolve(); assert.equal(dom.activeElement, picker); assert.deepEqual(selected, [['harbor', 'commercial-hub']]);
}));

await test('event cue placement consumes reserved overlay rectangles even when the site is not discoverable through DOM queries', async () => withOverlayDom(() => {
  const { map } = overlayShell();
  const cues = createWorldCues(map as unknown as HTMLElement, { ...world, tiles: [{ id: 7, q: 0, r: 0, height: .6, terrain: 'grassland', owner: 0 }] }, () => ({ x: 500, y: 350 }));
  try {
    cues.update([{ left: 0, top: 0, width: 1000, height: 700 }]);
    cues.show([{ eventId: 'test:event', tileId: 7, actor: 0, target: null, cue: 'construction', icon: 'materials', label: 'Built', detail: 'Synthetic cue-placement fixture', deltas: [], durationMs: 10000, importance: 1 }]);
    const cue = map.all().find(element => element.dataset['event'] === 'test:event'); assert.ok(cue); assert.equal(cue.hidden, true);
    cues.update([]); assert.equal(cue.hidden, false);
  } finally { cues.dispose(); }
}));

await test('exact-site focus handoffs preserve an explicitly keyboard-reachable map', async () => withOverlayDom(async () => {
  const { map, picker } = overlayShell(); map.dataset['siteFocusWorld'] = 'world:keyboard'; map.setAttribute('tabindex', '0'); map.tabIndex = 0;
  assert.ok(map instanceof HTMLElement);
  const old = new OverlayElement('button'); old.dataset['siteId'] = district.id; map.append(old); old.focus();
  const retained = retainSiteOverlayFocus(map, 'world:keyboard'); assert.ok(retained);
  assert.equal(map.tabIndex, 0);
  old.remove();
  const chosen: string[] = [];
  restoreSiteOverlayFocus(map, retained, 'world:keyboard', { cityId: district.cityId, workId: 'commercial-hub' }, (city, work) => { chosen.push(`${city}:${work}`); });
  await Promise.resolve();
  assert.equal(map.tabIndex, 0);
  assert.equal(dom.activeElement, picker);
  assert.deepEqual(chosen, ['harbor:commercial-hub']);
}));
