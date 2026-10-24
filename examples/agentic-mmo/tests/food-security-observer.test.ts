import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import type { City, WorldState } from '../core/types.ts';
import { exactNumber } from '../web/number-format.ts';
import { renderSettlementInspection } from '../web/settlement-inspection.ts';
import { createTownProduction, townProductionRows } from '../web/town-production.ts';

const epoch = '2026-10-22T00:00:00.000Z';
const at = (round: number): string => new Date(Date.parse(epoch) + round * 60_000).toISOString();
const world = (budget = true): WorldState => createGeneratedWorld(73, epoch, budget ? 'settlement-food-budget-1' : 'settlement-regional-targets-1');

function beat(state: WorldState, round = 1): WorldState {
  const result = catchUpStrategy(state, at(round));
  assert.ok(result.ok, result.error);
  return result.state;
}

function suppliedWorld(): WorldState {
  const state = world();
  state.cities[0]!.focus = 'research';
  return beat(state);
}

function foundTown(state: WorldState): WorldState {
  const option = legalActions(state, 0, at(1)).find(candidate => candidate.action.type === 'settle' && candidate.action.sourceCityId === state.cities[0]!.id);
  assert.ok(option);
  const result = applyCommand(state, { seat: 0, action: option.action, expectedRevision: state.revision, timestamp: at(1) });
  assert.ok(result.ok, result.error);
  return result.state;
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
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].filter(Boolean).join(' '); }
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

function render(city: Pick<City, 'buildings' | 'buildingOperations' | 'lastFoodSupply'>, inspect = (_buildingId: string): void => undefined): ElementRecord | null {
  return withDocument(() => {
    const section = createTownProduction(city, inspect);
    assert.ok(section === null || section instanceof ElementRecord);
    return section;
  });
}

function foodDetails(section: ElementRecord | null): ElementRecord {
  const details = section?.all().find(node => node.dataset['townDisclosure'] === 'food-supply');
  assert.ok(details);
  assert.equal(details.tag, 'details');
  assert.equal(details.children[0]?.tag, 'summary');
  return details;
}

function foodLine(details: ElementRecord, label: string): string {
  const line = details.children.find(node => node.tag === 'p' && node.children[0]?.textContent === `${label}: `);
  assert.ok(line, label);
  assert.equal(line.children[0]?.tag, 'strong');
  return line.children.slice(1).map(child => child.content()).join(' ');
}

await test('old worlds and new towns without an economy receipt gain no invented Food ledger', () => {
  for (const state of [world(), beat(world(false))]) {
    const city = state.cities[0]!;
    assert.equal(city.lastFoodSupply, undefined);
    assert.equal(render(city), null);
    city.buildings.push('kiln');
    const section = render(city);
    assert.ok(section);
    assert.equal(section.all().some(node => node.dataset['townDisclosure'] === 'food-supply'), false);
    assert.match(section.content(), /No operating record yet/);
    assert.doesNotMatch(section.content(), /Household|Meals|Growth paid|shared stock/);
  }
});

await test('a real supplied growth receipt creates inspection even without paid-input buildings', () => {
  const state = suppliedWorld();
  const city = state.cities[0]!;
  assert.equal(townProductionRows(city).length, 0);
  assert.equal(city.population, 7);
  const section = render(city);
  const details = foodDetails(section);
  assert.equal(details.children[0]?.content(), 'Latest Earth household Food · Supplied · Round 1');
  assert.equal(foodLine(details, 'Opening population'), '6');
  assert.equal(foodLine(details, 'Produced'), '8.05 Food');
  assert.equal(foodLine(details, 'Household meals'), 'Required 7.5 Food · Paid 7.5 Food');
  assert.equal(foodLine(details, 'Growth paid'), '7 Food');
  assert.equal(foodLine(details, 'Civilization shared stock'), 'Before 30 Food → After 23.55 Food');
  assert.match(details.content(), /at this town’s resolution/);
  assert.match(details.content(), /Not the current total, a whole-round balance, or a forecast/);
  assert.equal(section?.all().some(node => ['button', 'input', 'select'].includes(node.tag)), false);
});

await test('a real underfunded receipt distinguishes required meals from actual paid Food', () => {
  const initial = world();
  initial.cities[0]!.population = 20;
  initial.cities[0]!.focus = 'research';
  initial.civilizations[0]!.resources.food = 1;
  const state = beat(initial);
  const city = state.cities[0]!;
  assert.equal(city.lastFoodSupply?.supplied, false);
  assert.equal(city.lastFoodSupply?.paid, 9.05);
  const details = foodDetails(render(city));
  assert.equal(details.children[0]?.content(), 'Latest Earth household Food · Shortage · Round 1');
  assert.equal(foodLine(details, 'Opening population'), '20');
  assert.equal(foodLine(details, 'Produced'), '8.05 Food');
  assert.equal(foodLine(details, 'Household meals'), 'Required 25 Food · Paid 9.05 Food');
  assert.equal(foodLine(details, 'Growth paid'), '0 Food');
  assert.equal(foodLine(details, 'Civilization shared stock'), 'Before 1 Food → After 0 Food');
});

await test('legal founding changes current population without rewriting the historical Food record', () => {
  const original = suppliedWorld();
  const receipt = structuredClone(original.cities[0]!.lastFoodSupply);
  const state = foundTown(original);
  const city = state.cities[0]!;
  assert.equal(city.population, 4);
  assert.deepEqual(city.lastFoodSupply, receipt);
  const details = foodDetails(render(city));
  assert.equal(details.children[0]?.content(), 'Latest Earth household Food · Supplied · Round 1');
  assert.equal(foodLine(details, 'Opening population'), '6');
  assert.equal(foodLine(details, 'Household meals'), 'Required 7.5 Food · Paid 7.5 Food');
  assert.equal(foodLine(details, 'Growth paid'), '7 Food');
  const founded = state.cities.find(candidate => candidate.civId === city.civId && candidate.id !== city.id);
  assert.ok(founded);
  assert.equal(founded.lastFoodSupply, undefined);
  assert.equal(render(founded), null);
});

await test('two towns retain their own resolution boundaries rather than the civilization final stock', () => {
  const state = beat(foundTown(suppliedWorld()), 2);
  const cities = state.cities.filter(city => city.civId === 0);
  assert.equal(cities.length, 2);
  const first = cities[0]!.lastFoodSupply;
  const second = cities[1]!.lastFoodSupply;
  assert.ok(first && second);
  assert.equal(first.foodAfter, second.foodBefore);
  assert.notEqual(first.foodAfter, state.civilizations[0]!.resources.food);
  for (const city of cities) {
    const receipt = city.lastFoodSupply!;
    const details = foodDetails(render(city));
    assert.equal(foodLine(details, 'Civilization shared stock'), `Before ${exactNumber(receipt.foodBefore)} Food → After ${exactNumber(receipt.foodAfter)} Food`);
    assert.match(details.content(), /at this town’s resolution/);
  }
});

await test('receipt inspection is detached, read-only and keeps one stable disclosure across new rounds', () => {
  const state = suppliedWorld();
  const before = structuredClone(state);
  const first = foodDetails(render(state.cities[0]!));
  for (const node of first.all()) assert.equal(node.listeners.size, 0);
  first.children[1]!.textContent = 'Changed DOM only';
  first.dataset['townDisclosure'] = 'changed-dom-only';
  assert.deepEqual(state, before);
  const next = beat(state, 2);
  const later = foodDetails(render(next.cities[0]!));
  assert.equal(later.dataset['townDisclosure'], 'food-supply');
  assert.match(later.children[0]?.content() ?? '', /Round 2$/);
  assert.equal(foodLine(later, 'Opening population'), '7');
  assert.equal(foodLine(later, 'Household meals'), 'Required 8.75 Food · Paid 8.75 Food');
  assert.deepEqual(state, before);
});

await test('Food details preserve paid-production ordering, stable disclosure and existing Work navigation', () => {
  const state = world();
  const city = state.cities[0]!;
  city.focus = 'research';
  city.buildings.push('kiln', 'irrigation', 'guild-workshop', 'university', 'bank');
  city.buildingOperations = Object.fromEntries(city.buildings.map(id => [id, { enabled: true, lastResult: null }]));
  const resolved = beat(state).cities[0]!;
  const receipt = resolved.buildingOperations?.kiln?.lastResult;
  assert.ok(receipt);
  const before = structuredClone(resolved);
  const inspected: string[] = [];
  const section = render(resolved, id => inspected.push(id));
  foodDetails(section);
  assert.equal(section?.children.filter(node => node.tag === 'button').length, 3);
  const more = section?.children.find(node => node.dataset['townDisclosure'] === 'production');
  assert.ok(more);
  assert.equal(more.children[0]?.content(), 'More town production (2)');
  const kiln = more.all().find(node => node.dataset['productionWork'] === 'kiln');
  assert.ok(kiln);
  assert.equal(kiln.type, 'button');
  kiln.listeners.get('click')?.();
  assert.deepEqual(inspected, ['kiln']);
  withDocument(() => {
    const host = document.createElement('section');
    assert.ok(host instanceof ElementRecord);
    let opened = 0;
    renderSettlementInspection(host, [resolved], resolved.id, () => undefined, undefined, '', undefined, undefined, undefined, () => { opened++; });
    foodDetails(host);
    const button = host.all().find(node => node.dataset['productionWork'] === 'kiln');
    assert.ok(button);
    button.listeners.get('click')?.();
    const picker = host.all().find(node => node.className === 'work-picker');
    assert.equal(opened, 1);
    assert.equal(host.dataset['selectedWork'], 'kiln');
    assert.equal(picker?.value, 'kiln');
    assert.equal(picker?.focused, true);
    assert.equal(host.all().filter(node => node.dataset['townDisclosure'] === 'food-supply').length, 1);
  });
  assert.deepEqual(resolved, before);
});
