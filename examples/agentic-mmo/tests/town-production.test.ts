import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BuildingOperationResult, City } from '../core/types.ts';
import { operationVisual } from '../visuals/operation-visuals.ts';
import { createTownProduction, townProductionRows } from '../web/town-production.ts';
import { renderSettlementInspection } from '../web/settlement-inspection.ts';

const result: BuildingOperationResult = {
  round: 12, status: 'operated', paid: { energy: 2 }, produced: { materials: 13.25 }, shortages: [],
  residents: { ruleVersion: 1, openingPopulation: 12, communityReserve: 3, required: 3, available: 9, allocated: 3 },
};

function town(lastResult: BuildingOperationResult | null = result, enabled = true): Pick<City, 'buildings' | 'buildingOperations'> {
  return { buildings: ['kiln'], buildingOperations: { kiln: { enabled, lastResult: structuredClone(lastResult) } } };
}

await test('only completed paid-input buildings become production rows', () => {
  const city = town();
  city.buildings = ['granary', 'kiln', 'unknown-building'];
  city.buildingOperations = { ...city.buildingOperations, irrigation: { enabled: true, lastResult: result } };
  assert.deepEqual(townProductionRows(city).map(row => row.buildingId), ['kiln']);
});

await test('a current pause leaves the exact past output, payment and residents intact', () => {
  const city = town(result, false);
  const [row] = townProductionRows(city);
  assert.ok(row);
  assert.equal(row.name, 'Kiln');
  assert.equal(row.current, 'Paused');
  assert.equal(row.result, 'Made 13.25 Materials');
  assert.equal(row.recordedAt, 'Last recorded season · 12');
  assert.deepEqual(row.last, operationVisual(city.buildingOperations?.kiln).last);
  assert.equal(row.last?.residents?.allocated, 3);
});

await test('built but unoperated and unknown operation state never become recipe output', () => {
  const [ready] = townProductionRows(town(null));
  assert.equal(ready?.result, 'No operating record yet');
  assert.equal(ready?.recordedAt, null);
  assert.equal(ready?.current, 'On');
  const [unknown] = townProductionRows({ buildings: ['kiln'] });
  assert.equal(unknown?.current, 'Unknown');
  assert.equal(unknown?.last, null);
  assert.equal(unknown?.result, 'No operating record yet');
});

await test('a blocked record preserves the canonical support and supply reason', () => {
  const blocked: BuildingOperationResult = { ...result, status: 'blocked', produced: {}, paid: {}, shortages: [{ resource: 'energy', required: 2, available: 0 }], residents: { ruleVersion: 1, openingPopulation: 3, communityReserve: 3, required: 3, available: 0, allocated: 0 } };
  const [row] = townProductionRows(town(blocked));
  assert.equal(row?.result, 'Not enough support or supplies');
  assert.equal(row?.tone, 'negative');
  assert.deepEqual(row?.last?.paid, []);
  assert.deepEqual(row?.last?.produced, []);
});

await test('a historical pause is distinct from the current enabled choice', () => {
  const [row] = townProductionRows(town({ ...result, status: 'paused', paid: {}, produced: {} }));
  assert.equal(row?.current, 'On');
  assert.equal(row?.result, 'Paused in that season');
  assert.equal(row?.recordedAt, 'Last recorded season · 12');
});

await test('an operated zero-output record does not borrow catalogue production', () => {
  const [row] = townProductionRows(town({ ...result, produced: {} }));
  assert.equal(row?.result, 'No output');
  assert.equal(row?.last?.paid[0]?.amount, 2);
});

await test('projection is detached and cannot change the town receipt', () => {
  const city = town();
  const before = structuredClone(city);
  const [row] = townProductionRows(city);
  assert.ok(row?.last?.residents);
  row?.last?.produced.push({ resource: 'food', label: 'Food', amount: 999 });
  if (row?.last?.residents) row.last.residents.allocated = 999;
  assert.deepEqual(city, before);
});

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
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].join(' '); }
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

function render(city: Pick<City, 'buildings' | 'buildingOperations'>, inspect: (buildingId: string) => void): ElementRecord | null {
  return withDocument(() => {
    const result = createTownProduction(city, inspect);
    assert.ok(result === null || result instanceof ElementRecord);
    return result;
  });
}

await test('overview renders actual output and uses a native button for the exact existing work record', () => {
  const inspected: string[] = [];
  const section = render(town(result, false), buildingId => inspected.push(buildingId));
  assert.ok(section);
  assert.match(section.content(), /Town production/);
  assert.match(section.content(), /Paused now/);
  assert.match(section.content(), /Made 13.25 Materials/);
  assert.match(section.content(), /Used 2 Energy · Assigned 3 residents/);
  assert.match(section.content(), /Last recorded season · 12/);
  const button = section.all().find(node => node.tag === 'button');
  assert.ok(button);
  assert.equal(button.type, 'button');
  assert.equal(button.dataset['productionWork'], 'kiln');
  button.listeners.get('click')?.();
  assert.deepEqual(inspected, ['kiln']);
  assert.ok(section.all().some(node => node.tag === 'svg'));
});

await test('empty towns have no production strip and missing receipts retain explicit copy', () => {
  assert.equal(render({ buildings: ['granary'] }, () => undefined), null);
  const section = render({ buildings: ['kiln'] }, () => undefined);
  assert.ok(section);
  assert.match(section.content(), /State unavailable/);
  assert.match(section.content(), /No operating record yet/);
  assert.doesNotMatch(section.content(), /Made|Last recorded season/);
});

await test('installed order is reversed without mutation and only three rows precede the native disclosure', () => {
  const city = { buildings: ['kiln', 'irrigation', 'guild-workshop', 'university', 'bank'] };
  const original = [...city.buildings];
  const inspected: string[] = [];
  assert.deepEqual(townProductionRows(city).map(row => row.buildingId), [...original].reverse());
  const section = render(city, id => inspected.push(id));
  assert.ok(section);
  assert.equal(section.children.filter(node => node.tag === 'button').length, 3);
  const more = section.children.find(node => node.tag === 'details');
  assert.ok(more);
  assert.equal(more.children[0]?.textContent, 'More town production (2)');
  assert.equal(more.dataset['townDisclosure'], 'production');
  const hidden = more.all().find(node => node.dataset['productionWork'] === 'kiln');
  assert.ok(hidden);
  hidden.listeners.get('click')?.();
  assert.deepEqual(inspected, ['kiln']);
  assert.deepEqual(city.buildings, original);
});

await test('restored Foundry and Observatory receipts retain their distinct canonical inputs and actual yields', () => {
  const foundry: BuildingOperationResult = { ...result, strategicPaid: { iron: 1 }, produced: { materials: 18 } };
  const observatory: BuildingOperationResult = { ...result, paid: { credits: 2 }, produced: { science: 15.75 } };
  const rows = townProductionRows({ buildings: ['foundry', 'observatory'], buildingOperations: { foundry: { enabled: true, lastResult: foundry }, observatory: { enabled: true, lastResult: observatory } } });
  assert.equal(rows[0]?.result, 'Made 15.75 Science');
  assert.deepEqual(rows[0]?.last?.paid, [{ resource: 'credits', label: 'Credits', amount: 2 }]);
  assert.equal(rows[1]?.result, 'Made 18 Materials');
  assert.deepEqual(rows[1]?.last?.strategicPaid, [{ resource: 'iron', label: 'Iron', amount: 1 }]);
  assert.deepEqual(rows[1]?.last?.paid, [{ resource: 'energy', label: 'Energy', amount: 2 }]);
  assert.equal(rows[1]?.last?.residents?.allocated, 3);
  const section = render({ buildings: ['foundry'], buildingOperations: { foundry: { enabled: true, lastResult: foundry } } }, () => undefined);
  assert.match(section?.content() ?? '', /Used 2 Energy · 1 Iron · Assigned 3 residents/);
});

await test('the integrated Overview row selects the exact Work receipt before revealing and focusing it', () => {
  withDocument(() => {
    const city: City = { id: 'town-test', name: 'Test town', civId: 0, tileId: 1, population: 12, wellbeing: 80, infrastructure: 1, focus: 'research', damage: 0, ...town() };
    const host = document.createElement('section');
    assert.ok(host instanceof ElementRecord);
    let opened = 0;
    renderSettlementInspection(host, [city], city.id, () => undefined, undefined, '', undefined, undefined, undefined, () => {
      opened++;
      assert.equal(host.dataset['selectedWork'], 'kiln');
    });
    const overview = host.all().find(node => node.className === 'town-overview');
    assert.equal(overview?.children[0]?.className, 'town-production');
    const button = overview?.all().find(node => node.dataset['productionWork'] === 'kiln');
    assert.ok(button);
    button.listeners.get('click')?.();
    const picker = host.all().find(node => node.className === 'work-picker');
    assert.equal(opened, 1);
    assert.equal(picker?.value, 'kiln');
    assert.equal(picker?.focused, true);
    const preview = host.all().find(node => node.className === 'work-preview');
    assert.match(preview?.content() ?? '', /13.25 Materials/);
    button.listeners.get('click')?.();
    assert.equal(opened, 2);
    assert.equal(host.dataset['selectedWork'], 'kiln');
  });
});
