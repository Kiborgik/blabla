import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import type { City, CityImprovement, ImprovementOperationResult } from '../core/types.ts';
import { capabilityTreeNodes } from '../web/capability-tree.ts';
import { renderSettlementInspection } from '../web/settlement-inspection.ts';

const epoch = '2026-10-23T00:00:00.000Z';
function fixture(status: 'operated' | 'blocked' | 'paused' | 'none' = 'operated') {
  const state = createWorld(73, epoch);
  const city = state.cities[0]!;
  city.buildings = [];
  const result: ImprovementOperationResult = {
    round: 7, status: status === 'none' ? 'operated' : status,
    paid: status === 'operated' ? { materials: 1 } : {},
    produced: status === 'operated' ? { food: 3.57 } : {},
    inputs: [{ resource: 'materials', required: 1, available: status === 'blocked' ? 0.25 : 6 }],
    shortages: status === 'blocked' ? [{ resource: 'materials', required: 1, available: 0.25 }] : [],
    residents: { ruleVersion: 1, openingPopulation: 6, communityReserve: 3, required: 1, available: 3, allocated: status === 'operated' ? 1 : 0 },
    blockedReason: status === 'blocked' ? 'input-shortage' : null,
  };
  const site: CityImprovement = {
    improvementId: 'shore-fishery', tileId: 21,
    completion: { kind: 'improvement', orderId: 'fixture-fishery', cityId: city.id, improvementId: 'shore-fishery', tileId: 21, startedRound: 2, completedRound: 4, paid: { materials: 8, credits: 4 }, workRequired: 4, eventId: 'fixture:completion' },
    operation: { enabled: false, lastResult: status === 'none' ? null : result },
  };
  city.improvements = { '21': site };
  return { state, city, site };
}

class ElementRecord {
  tag: string;
  textContent = '';
  className = '';
  type = '';
  value = '';
  focused = false;
  dataset: Record<string, string> = {};
  children: ElementRecord[] = [];
  parent: ElementRecord | null = null;
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  constructor(tag: string) { this.tag = tag; }
  append(...children: ElementRecord[]): void { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
  prepend(...children: ElementRecord[]): void { for (const child of [...children].reverse()) { child.remove(); child.parent = this; this.children.unshift(child); } }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  replaceChildren(...children: ElementRecord[]): void { for (const child of [...this.children]) child.remove(); this.append(...children); }
  querySelector(selector: string): ElementRecord | null { return this.all().find(node => node.tag === selector) ?? null; }
  focus(): void { this.focused = true; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(); }
  all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
}

function withDocument<T>(run: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  const createElement = (tag: string): ElementRecord => new ElementRecord(tag);
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementRecord });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement, createElementNS: (_namespace: string, tag: string) => createElement(tag), createTextNode: (value: string) => { const node = createElement('#text'); node.textContent = value; return node; } } });
  try {
    return run();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
    if (previousElement) Object.defineProperty(globalThis, 'HTMLElement', previousElement);
    else Reflect.deleteProperty(globalThis, 'HTMLElement');
  }
}

function inspect(city: City): ElementRecord {
  return withDocument(() => {
    const host = new ElementRecord('section');
    renderSettlementInspection(host as unknown as HTMLElement, [city], city.id, () => undefined, undefined, '21');
    return host;
  });
}

await test('all active worked-site previews state that no resources are produced yet', () => {
  for (const improvementId of ['charcoal-clearing', 'shore-fishery', 'mine']) {
    const { city } = fixture('none');
    city.improvements = {};
    city.construction = { active: { kind: 'improvement', id: 'synthetic-current-order', cityId: city.id,
      improvementId, tileId: 21, ruleVersion: 1, startedRound: 2, paid: { materials: 8, credits: 4 }, workRequired: 4, workDone: 1 }, lastCompleted: null };
    const before = structuredClone(city);
    const view = inspect(city).content();
    assert.match(view, /Under construction/);
    assert.match(view, /1 \/ 4 work · Not built yet/);
    assert.match(view, /Reserved Tile 21 · No resources produced yet/);
    assert.doesNotMatch(view, /No food or materials made yet/);
    assert.deepEqual(city, before);
  }
});

await test('fishery full inspection separates paid construction, opening recipe and historical actual output', () => {
  const { city } = fixture(); const before = structuredClone(city);
  const view = inspect(city).content();
  assert.match(view, /Shore fishery · Tile 21/);
  assert.match(view, /Needs 1 local resident/);
  assert.match(view, /Opening supplies needed each operating season: 1 Materials/);
  assert.match(view, /All opening supplies and local support must be available/);
  assert.match(view, /Base before town productivity: 3 Food/);
  assert.match(view, /Paid once: 8 Materials 4 Credits/);
  assert.match(view, /Paid that season: 1 Materials/);
  assert.match(view, /Made: 3.57 Food/);
  assert.match(view, /Materials needed 1 · Available before that attempt 6/);
  assert.match(view, /Paused now/);
  assert.deepEqual(city, before);
});

await test('blocked and paused fishery records never imply payment or output; missing records gain no invented receipt', () => {
  for (const status of ['blocked', 'paused', 'none'] as const) {
    const { city } = fixture(status); const before = structuredClone(city);
    const view = inspect(city).content();
    assert.match(view, /Opening supplies needed each operating season: 1 Materials/);
    if (status === 'none') {
      assert.match(view, /No operating result has been recorded yet/);
      assert.doesNotMatch(view, /Available before that attempt|Paid that season/);
    } else {
      assert.match(view, /Paid that season: None/);
      assert.match(view, /Made: None/);
      assert.doesNotMatch(view, /Made: 3/);
      if (status === 'blocked') assert.match(view, /Materials needed 1 · Available then 0.25/);
      else assert.match(view, /Paused in that season/);
    }
    assert.deepEqual(city, before);
  }
});

await test('capability tree exposes maintained fishery recipe and exact recorded opening/paid facts separately', () => {
  for (const status of ['operated', 'blocked', 'paused', 'none'] as const) {
    const { state, city, site } = fixture(status);
    const input = { runId: 'fixture', civilizationName: 'Aster', towns: [{ id: city.id, name: city.name }], catalogue: capabilityCatalogue(), projection: projectCapabilities(state, city.civId, city.id, epoch) };
    input.projection.improvements = [{ nodeId: 'improvement:shore-fishery', status: 'done', support: 'applied', blockers: [], choiceRefs: [], availableSites: [], installed: [{ ...site, cityId: city.id }] }];
    const before = structuredClone(input);
    const node = capabilityTreeNodes(input).find(item => item.id === 'improvement:shore-fishery'); assert.ok(node);
    assert.ok(node.facts.some(f => f.label === 'Opening supplies each operating season' && f.value === '1 Materials'));
    assert.ok(node.facts.some(f => f.label === 'Operating requirement' && /All opening supplies and local support/.test(f.value)));
    const row = node.facts.find(f => f.label === 'Site 21 last record'); assert.ok(row);
    if (status === 'none') assert.equal(row.value, 'No operating record yet');
    else {
      assert.match(row.value, status === 'operated' ? /Paid 1 Materials · Made 3.57 Food/ : /Paid None · Made None/);
      const opening = node.facts.find(f => f.label === 'Site 21 recorded opening supplies'); assert.ok(opening);
      assert.match(opening.value, /Materials needed 1 · Available before that attempt/);
      if (status === 'blocked') assert.ok(node.facts.some(f => f.label === 'Site 21 recorded shortages' && /Materials needed 1 · Available then 0.25/.test(f.value)));
    }
    assert.deepEqual(input, before);
  }
});

await test('legacy input-free site records do not acquire fishery recipes or synthetic opening facts', () => {
  const { state, city, site } = fixture();
  site.improvementId = 'lumber-mill'; site.completion.improvementId = 'lumber-mill';
  site.completion.paid = { materials: 10, credits: 5 }; site.completion.workRequired = 6;
  assert.ok(site.operation.lastResult);
  delete site.operation.lastResult.inputs; delete site.operation.lastResult.shortages;
  site.operation.lastResult.paid = {}; site.operation.lastResult.produced = { materials: 2.4 };
  const view = inspect(city).content();
  assert.doesNotMatch(view, /Opening supplies needed|Available before that attempt/);
  assert.match(view, /Made: 2.4 Materials/);
  const input = { runId: 'legacy', civilizationName: 'Aster', towns: [{ id: city.id, name: city.name }], catalogue: capabilityCatalogue(), projection: projectCapabilities(state, city.civId, city.id, epoch) };
  input.projection.improvements = [{ nodeId: 'improvement:lumber-mill', status: 'done', support: 'applied', blockers: [], choiceRefs: [], availableSites: [], installed: [{ ...site, cityId: city.id }] }];
  const node = capabilityTreeNodes(input).find(item => item.id === 'improvement:lumber-mill'); assert.ok(node);
  assert.ok(!node.facts.some(f => /Opening supplies|recorded opening supplies|recorded shortages/.test(f.label)));
});
