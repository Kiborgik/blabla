import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createWorld } from '../core/engine.ts';
import { TECHNOLOGIES } from '../core/content.ts';
import { civilizationRibbonSummary, renderCivilizationRibbonContent, organizeSpectatorInspection } from '../web/spectator-shell.ts';

void test('ribbon facts use owned towns, active canonical research and exact matching unfinished orders', () => {
  const state = createWorld(1701, '2026-10-16T00:00:00Z');
  const city = state.cities[0]; const civ = state.civilizations[0]; const technology = TECHNOLOGIES.find(entry => entry.id === 'writing');
  assert.ok(city && civ && technology);
  city.population = 12; civ.researchTarget = technology.id; civ.researchProgress = 7.5; civ.resources.science = 999;
  city.construction = { active: { ruleVersion: 1, id: 'one', cityId: city.id, buildingId: 'workshop', startedRound: 1, paid: {}, workDone: 2.5, workRequired: 6 }, lastCompleted: null };
  const order = city.construction.active; assert.ok(order);
  state.cities.push({ ...city, id: 'second', population: 4, construction: { active: { ...order, id: 'two', cityId: 'second', workDone: 3, workRequired: 8 }, lastCompleted: null } });
  const before = structuredClone(state);
  assert.deepEqual(civilizationRibbonSummary(state, civ.id), {
    summary: '2 towns · 16 people',
    research: { name: technology.name, done: 7.5, required: technology.cost },
    construction: { towns: 2, done: 5.5, required: 14 },
  });
  assert.deepEqual(state, before);
  order.cityId = 'not-this-town';
  assert.deepEqual(civilizationRibbonSummary(state, civ.id).construction, { towns: 1, done: 3, required: 8 });
  civ.technologies.push(technology.id);
  assert.equal(civilizationRibbonSummary(state, civ.id).research, null);
  assert.deepEqual(civilizationRibbonSummary(state, 99), { summary: '0 towns · 0 people', research: null, construction: null });
});

void test('ribbon rendering keeps text inert, exposes exact work and supplies no world-changing control', () => {
  class ElementRecord {
    tag: string; textContent = ''; className = ''; title = ''; max = 0; value = 0;
    children: ElementRecord[] = []; attributes = new Map<string, string>();
    constructor(tag: string) { this.tag = tag; }
    set innerHTML(_value: string) { throw new Error('Text must remain inert'); }
    append(...children: ElementRecord[]): void { this.children.push(...children); }
    setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
    all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementRecord });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag: string) => new ElementRecord(tag), createElementNS: (_ns: string, tag: string) => new ElementRecord(tag) } });
  try {
    const host = new ElementRecord('span'); assert.ok(host instanceof HTMLElement);
    renderCivilizationRibbonContent(host, { summary: '2 towns · 16 people', research: { name: '<img src=x>', done: 7.5, required: 24 }, construction: { towns: 2, done: 5.5, required: 14 } });
    assert.ok(host.all().some(node => node.textContent === '2 towns · 16 people'));
    assert.ok(host.all().some(node => node.textContent === '<img src=x>'));
    const meters = host.all().filter(node => node.tag === 'progress');
    assert.deepEqual(meters.map(node => [node.value, node.max]), [[7.5, 24], [5.5, 14]]);
    assert.match(meters[0]?.attributes.get('aria-label') ?? '', /7.5 \/ 24 Science work/);
    assert.match(meters[1]?.attributes.get('aria-label') ?? '', /2 towns.*5.5 \/ 14/);
    assert.equal(host.all().some(node => ['button', 'form', 'input', 'img'].includes(node.tag)), false);
    const idle = new ElementRecord('span'); assert.ok(idle instanceof HTMLElement); renderCivilizationRibbonContent(idle, { summary: '1 town · 12 people', research: null, construction: null });
    assert.equal(idle.all().some(node => node.tag === 'progress'), false);
    assert.ok(idle.all().some(node => node.textContent === 'No active research'));
    assert.ok(idle.all().some(node => node.textContent === 'No construction'));
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document');
    if (originalElement) Object.defineProperty(globalThis, 'HTMLElement', originalElement); else Reflect.deleteProperty(globalThis, 'HTMLElement');
  }
});

void test('summary organization moves existing fact and control nodes without resetting Work or disclosure state', () => {
  class Node {
    className: string; dataset: Record<string, string> = {}; children: Node[] = []; parent: Node | null = null;
    constructor(className: string) { this.className = className; }
    append(...nodes: Node[]): void { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
    remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
    matches(selector: string): boolean { return selector.split(',').some(part => this.className.split(' ').includes(part.trim().slice(1))); }
    querySelector(selector: string): Node | null { return this.children.flatMap(node => [node, ...node.descendants()]).find(node => node.matches(selector)) ?? null; }
    descendants(): Node[] { return this.children.flatMap(node => [node, ...node.descendants()]); }
    insertBefore(node: Node, before: Node | null): void { node.remove(); node.parent = this; const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index < 0 ? this.children.length : index, 0, node); }
  }
  const panel = new Node('inspection'); const nav = new Node('inspection-sections'); const stores = new Node('resources'); const commitments = new Node('ongoing-commitments'); const overview = new Node('town-overview'); const work = new Node('city-details');
  work.dataset['selectedWork'] = 'site:exact-7';
  const facts = new Node('settlement-facts'); const picker = new Node('town-picker-label'); const details = new Node('town-receipt'); details.dataset['townDisclosure'] = 'housing';
  overview.append(facts, picker, details); panel.append(nav, commitments, stores, overview, work);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: Node });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new Node('') } });
  try {
    assert.ok(panel instanceof HTMLElement);
    organizeSpectatorInspection(panel);
    const summary = panel.querySelector('.town-at-a-glance'); assert.ok(summary);
    assert.deepEqual(summary.children, [facts, picker]);
    assert.deepEqual(panel.children.slice(0, 4), [nav, summary, commitments, stores]);
    assert.deepEqual(overview.children, [details]);
    assert.equal(work.dataset['selectedWork'], 'site:exact-7');
    assert.equal(details.dataset['townDisclosure'], 'housing');
    organizeSpectatorInspection(panel);
    assert.equal(panel.children.filter(node => node.className === 'town-at-a-glance').length, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document');
    if (originalElement) Object.defineProperty(globalThis, 'HTMLElement', originalElement); else Reflect.deleteProperty(globalThis, 'HTMLElement');
  }
});

void test('the canonical shell preserves stats, responsive map space, resolved palettes and target sizes', () => {
  const css = readFileSync(new URL('../web/spectator-hud.css', import.meta.url), 'utf8');
  const base = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(base, /\.live-observatory\s+\.(?:civilization-panel|inspection|chronicle|world-heading|map-tools|layer-controls)\b/);
  assert.match(css, /:root\[data-theme='light'\]/);
  assert.match(css, /:root\[data-theme='dark'\]/);
  assert.match(css, /\.civilization-panel[^}]*height: 72px/s);
  assert.match(css, /\.civ-ribbon-facts[^}]*font-size: 11px/s);
  assert.match(css, /\.inspection[^}]*width: 352px/s);
  assert.match(css, /max-height: min\(45dvh/);
  assert.match(css, /\.footer[^}]*height: 44px/s);
  assert.match(css, /\.inspection[^}]*overflow: auto/s);
  assert.doesNotMatch(css, /\.civilization-row small\s*\{\s*display: none/);
});
