import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import type { BuildingOperationResult, City, WorldState } from '../core/types.ts';
import { observedResidentCapacity } from '../core/simulation/operations.ts';
import { foundryProductionOperationJourney } from './fixtures/foundry-production-journey.ts';
import { operationVisual } from '../visuals/operation-visuals.ts';
import { districtLabel, districtParts, DISTRICT_PART_BUDGETS } from '../visuals/district-visuals.ts';
import { projectWorld } from '../web/live-world.ts';
import { capabilityTreeNodes } from '../web/capability-tree.ts';
import { renderSettlementInspection } from '../web/settlement-inspection.ts';

const legal = foundryProductionOperationJourney();
const town = (state: WorldState) => { const city = state.cities.find(item => item.id === legal.journey.cityId); assert.ok(city); return city; };
const zone = (state: WorldState) => { const site = projectWorld(state).districts?.find(item => item.cityId === legal.journey.cityId && item.buildingId === 'industrial-zone'); assert.ok(site); return site; };
const result = town(legal.operated).buildingOperations?.foundry?.lastResult; assert.ok(result);

await test('real Foundry operation retains detached Iron separately from Energy and Materials', () => {
  const before = structuredClone(result); const view = operationVisual({ enabled: true, lastResult: result });
  assert.deepEqual(view.last?.strategicPaid, [{ resource: 'iron', label: 'Iron', amount: 1 }]);
  assert.deepEqual(view.last?.paid, [{ resource: 'energy', label: 'Energy', amount: 2 }]);
  assert.deepEqual(view.last?.produced, [{ resource: 'materials', label: 'Materials', amount: 13.2 }]);
  assert.equal(view.last?.residents?.allocated, 3);
  view.last?.strategicPaid?.push({ resource: 'iron', label: 'Iron', amount: 999 });
  assert.deepEqual(result, before);
  const paused = operationVisual({ enabled: false, lastResult: result });
  assert.equal(paused.current, 'Paused'); assert.deepEqual(paused.last?.strategicPaid, [{ resource: 'iron', label: 'Iron', amount: 1 }]);
});

await test('synthetic combined support and strategic shortage keeps both exact recorded causes', () => {
  const blocked: BuildingOperationResult = { ...structuredClone(result), status: 'blocked', paid: {}, strategicPaid: {}, produced: {}, shortages: [], strategicShortages: [{ resource: 'iron', required: 1, available: 0 }], residents: { ruleVersion: 1, openingPopulation: 6, communityReserve: 3, required: 3, available: 0, allocated: 0 } };
  const view = operationVisual({ enabled: true, lastResult: blocked });
  assert.equal(view.last?.label, 'Not enough support or supplies');
  assert.deepEqual(view.last?.strategicShortages, blocked.strategicShortages);
  assert.notEqual(view.last?.strategicShortages?.[0], blocked.strategicShortages?.[0]);
  assert.deepEqual(view.last?.strategicPaid, []);
});

await test('Foundry recipe and exact Industrial town link come from canonical catalogue rows', () => {
  const city = town(legal.operated);
  const nodes = capabilityTreeNodes({ runId: 'legal-local-foundry', civilizationName: 'Verdant', towns: [{ id: city.id, name: city.name }], catalogue: capabilityCatalogue(), projection: projectCapabilities(legal.operated, city.civId, city.id, legal.journey.time()) });
  const row = nodes.find(item => item.id === 'building:foundry'); assert.ok(row);
  assert.ok(row.facts.some(fact => fact.label === 'Uses each operating season' && /1 Iron/.test(fact.value) && /2 Energy/.test(fact.value)));
  assert.ok(row.facts.some(fact => fact.label === 'Belongs to' && fact.value.includes(`Tile ${zone(legal.operated).tileId}`)));
  assert.ok(row.requires.includes('technology:metal-casting')); assert.ok(row.requires.includes('building:industrial-zone'));
  assert.ok(row.facts.some(fact => /Base production/.test(fact.label) && /8 Materials/.test(fact.value)));
});

await test('exact Foundry foundation becomes a distinct annex; synthetic Guild combination retains every core', () => {
  const active = zone(legal.started); const built = zone(legal.completed);
  assert.equal(active.tileId, built.tileId); assert.equal(active.cityId, legal.journey.cityId);
  assert.match(districtLabel(active), /Foundry building/); assert.match(districtLabel(built), /Foundry/);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const foundation = districtParts(active, detail); const parts = districtParts({ ...built, attachments: [...built.attachments ?? [], { buildingId: 'guild-workshop', name: 'Guild workshop', status: 'built' }] }, detail);
    assert.ok(foundation.some(part => part.id.endsWith('foundry-foundation'))); assert.ok(foundation.every(part => !part.id.endsWith('foundry-cap')));
    for (const suffix of ['industrial-chimney', 'guild-roof', 'foundry-body', 'foundry-cap']) assert.ok(parts.some(part => part.id.endsWith(suffix)), `${detail}: ${suffix}`);
    assert.ok(parts.length <= DISTRICT_PART_BUDGETS[detail]);
    assert.equal(new Set(parts.map(part => part.id)).size, parts.length);
  }
  assert.ok(projectWorld(legal.completed).districts?.filter(site => site.id !== built.id).every(site => !site.attachments?.some(item => item.buildingId === 'foundry')));
});

class ElementRecord {
  tag: string;
  textContent = '';
  className = '';
  type = '';
  dataset: Record<string, string> = {};
  children: ElementRecord[] = [];
  parent: ElementRecord | null = null;
  value = '';
  querySelector(selector: string): ElementRecord | null { return this.all().find(node => node.tag === selector) ?? null; }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
  attributes = new Map<string, string>();
  constructor(tag: string) { this.tag = tag; }
  append(...children: ElementRecord[]): void { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
  prepend(...children: ElementRecord[]): void { this.children.unshift(...children); }
  replaceChildren(...children: ElementRecord[]): void { this.children = []; this.append(...children); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  listeners = new Map<string, () => void>();
  addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].join(' '); }
  all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
}

function inspect(cities: City[], support = true, interact?: (host: ElementRecord) => void): ElementRecord {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementRecord });
  const createElement = (tag: string): ElementRecord => new ElementRecord(tag);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement, createElementNS: (_ns: string, tag: string) => createElement(tag), createTextNode: (value: string) => { const node = createElement('#text'); node.textContent = value; return node; } } });
  try {
    const host = document.createElement('section');
    assert.ok(host instanceof ElementRecord);
    renderSettlementInspection(host, cities, cities[0]?.id ?? null, () => undefined, support ? observedResidentCapacity(cities) : undefined);
    interact?.(host);
    return host;
  } finally {
    if (previousElement) Object.defineProperty(globalThis, 'HTMLElement', previousElement); else Reflect.deleteProperty(globalThis, 'HTMLElement');
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}


await test('focused first view and full receipt both show real Iron use while completion stays result-free', () => {
  const completed = inspect([town(legal.completed)], true, host => { const picker = host.all().find(node => node.tag === 'select' && node.className === 'work-picker'); assert.ok(picker); picker.value = 'foundry'; picker.listeners.get('change')?.(); });
  assert.match(completed.content(), /No operating result recorded yet/);
  const view = inspect([town(legal.operated)], true, host => { const picker = host.all().find(node => node.tag === 'select' && node.className === 'work-picker'); assert.ok(picker); picker.value = 'foundry'; picker.listeners.get('change')?.(); });
  const preview = view.all().find(node => node.className === 'work-preview'); assert.ok(preview);
  assert.match(preview.content(), /Used:.*1 Iron/); assert.match(preview.content(), /Used:.*2 Energy/); assert.match(preview.content(), /Made:.*13.2 Materials/);
  const paid = view.all().find(node => node.className === 'operation-receipt'); assert.ok(paid);
  assert.match(paid.content(), /Paid:.*1 Iron/); assert.match(paid.content(), /Paid:.*2 Energy/); assert.match(paid.content(), /Assigned: 3 residents/);
});

await test('synthetic shortage view exposes historical Iron need without changing current stock or implying payment', () => {
  const city = structuredClone(town(legal.operated)); const operation = city.buildingOperations?.foundry; assert.ok(operation);
  operation.lastResult = { ...structuredClone(result), status: 'blocked', paid: {}, strategicPaid: {}, produced: {}, shortages: [], strategicShortages: [{ resource: 'iron', required: 1, available: 0 }], ...(result.residents ? { residents: { ...result.residents, allocated: 0 } } : {}) };
  const before = structuredClone(city);
  const view = inspect([city], true, host => { const picker = host.all().find(node => node.tag === 'select' && node.className === 'work-picker'); assert.ok(picker); picker.value = 'foundry'; picker.listeners.get('change')?.(); });
  assert.match(view.content(), /Iron needed 1; 0 left in opening stock/);
  const preview = view.all().find(node => node.className === 'work-preview'); assert.ok(preview); assert.match(preview.content(), /Iron.*1.*0/);
  assert.match(view.content(), /Nothing was paid or made/); assert.deepEqual(city, before);
});

await test('legacy ordinary receipts stay unchanged and installed Foundry alone does not invent production', () => {
  const receipt: BuildingOperationResult = { round: 1, status: 'operated', paid: { energy: 2 }, produced: { materials: 4 }, shortages: [] };
  const view = operationVisual({ enabled: true, lastResult: receipt });
  assert.equal(view.last?.strategicPaid, undefined); assert.equal(view.last?.strategicShortages, undefined);
  assert.equal(operationVisual(town(legal.completed).buildingOperations?.foundry).last, null);
  assert.deepEqual(districtParts(zone(legal.completed), 'far'), districtParts(zone(legal.operated), 'far'));
});
