import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import type { City, ImprovementOperationResult } from '../core/types.ts';
import { riverIntakeFacts, riverIntakeReadiness } from '../web/river-intake-inspection.ts';
import { renderSettlementInspection } from '../web/settlement-inspection.ts';

function fixture(status: 'operated' | 'blocked' | 'paused' | 'none' = 'operated') {
  const state = createWorld(73, '2026-10-24T00:00:00.000Z', 'settlement-river-intakes-1');
  const city = state.cities[0]!; city.buildings = [];
  const result: ImprovementOperationResult = { round: 7, status: status === 'none' ? 'operated' : status,
    paid: status === 'operated' ? { materials: 1 } : {}, produced: status === 'operated' ? { food: 3.57 } : {},
    inputs: [{ resource: 'materials', required: 1, available: 6 }], shortages: [],
    residents: { ruleVersion: 1, openingPopulation: 7, communityReserve: 3, required: 1, available: 1, allocated: status === 'operated' ? 1 : 0 },
    blockedReason: status === 'blocked' ? 'flow-shortage' : null,
    river: { ruleVersion: 1, ruleId: 'uniform-runoff-1', tileId: 21, downstreamTileId: 22, outletTileId: 30, required: 8, availableBefore: status === 'blocked' ? 7 : 12, withdrawn: status === 'operated' ? 8 : 0, remainingAfter: status === 'blocked' ? 7 : status === 'operated' ? 4 : 12, supportBuildingId: 'irrigation', supportAllocationRound: status === 'paused' ? null : 7 } };
  city.improvements = { '21': { improvementId: 'river-intake', tileId: 21,
    completion: { kind: 'improvement', orderId: 'synthetic-paid-intake', cityId: city.id, improvementId: 'river-intake', tileId: 21, startedRound: 2, completedRound: 4, paid: { materials: 8, credits: 4 }, workRequired: 4, eventId: 'synthetic:completion' },
    operation: { enabled: true, lastResult: status === 'none' ? null : result } } };
  return { city, result };
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

await test('intake inspection separates renewable flow and funded support from paid stocks and actual Food', () => {
  const { city } = fixture(); const before = structuredClone(city); const view = inspect(city).content();
  assert.match(view, /River intake · Tile 21/); assert.match(view, /Built · Enabled now/);
  assert.match(view, /Paid once: 8 Materials 4 Credits/); assert.match(view, /Paid that season: 1 Materials/);
  assert.match(view, /Made: 3.57 Food/); assert.match(view, /River flow needed 8 · Available before 12 · Withdrawn 8 · Continuing downstream 4/);
  assert.match(view, /Irrigation support funded in recorded round 7/); assert.match(view, /Tile 21 → Tile 22 · Ocean outlet Tile 30/);
  assert.match(view, /Renewable flow for that season, not a stored or tradable resource/);
  assert.doesNotMatch(view, /Water stock|guaranteed|water right/); assert.deepEqual(city, before);
});

await test('blocked paused and absent intake records show no invented withdrawal or successful operation', () => {
  for (const status of ['blocked', 'paused', 'none'] as const) {
    const { city, result } = fixture(status); const before = structuredClone(city); const view = inspect(city).content();
    assert.match(view, /Built · Enabled now/);
    if (status === 'none') { assert.match(view, /No operating result/); assert.doesNotMatch(view, /Withdrawn|support funded in recorded/); }
    else { assert.match(view, /Paid that season: None/); assert.match(view, /Made: None/); assert.match(view, /Withdrawn 0/);
      if (status === 'blocked') assert.match(view, /Insufficient river flow in that season/);
      else assert.match(view, /No funded Irrigation support recorded for this attempt/);
    }
    assert.deepEqual(city, before); assert.ok(result);
  }
  const { result } = fixture('blocked'); result.blockedReason = 'support-unfunded'; result.river!.supportAllocationRound = null;
  assert.ok(riverIntakeFacts(result).some(value => value.includes('Irrigation was not funded')));
  delete result.river; assert.deepEqual(riverIntakeFacts(result), []);
});

await test('intake construction remains paid reserved work with no renewable flow or Food receipt', () => {
  const { city } = fixture('none'); city.improvements = {};
  city.construction = { active: { kind: 'improvement', id: 'synthetic-active', cityId: city.id, improvementId: 'river-intake', tileId: 21, ruleVersion: 1, startedRound: 2, paid: { materials: 8, credits: 4 }, workRequired: 4, workDone: 1 }, lastCompleted: null };
  const before = structuredClone(city); const view = inspect(city).content();
  assert.match(view, /Under construction/); assert.match(view, /1 \/ 4 work · Not built yet/); assert.match(view, /No resources produced yet/);
  assert.doesNotMatch(view, /Withdrawn|Made: 3/); assert.deepEqual(city, before);
});

await test('current eligibility is separate from historical payment and never promises next-season flow', () => {
  const { city } = fixture(); const site = city.improvements!['21']!; const before = structuredClone(site);
  assert.match(riverIntakeReadiness(site, { eligible: true, terminal: false }).join(' '), /eligible.*not an operating forecast.*eight river-flow/);
  assert.match(riverIntakeReadiness(site, { eligible: false, terminal: false }).join(' '), /support is unavailable/);
  assert.match(riverIntakeReadiness(site, { eligible: true, terminal: true }).join(' '), /Completed world/);
  assert.match(riverIntakeReadiness(site).join(' '), /unavailable in this view/);
  assert.deepEqual(site, before); site.operation.enabled = false;
  assert.match(riverIntakeReadiness(site, { eligible: true, terminal: false }).join(' '), /Currently paused/);
});
