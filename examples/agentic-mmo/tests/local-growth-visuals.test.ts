import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import { localGrowthOperationJourney } from './fixtures/local-growth-journey.ts';
import { townDevelopmentFacts } from '../visuals/wonder-visuals.ts';
import { eventLogEntries } from '../web/event-log.ts';

await test('older worlds retain their old population presentation without invented housing or growth receipts', () => {
  const state = createWorld(1701); const city = state.cities[0]; assert.ok(city);
  const facts = townDevelopmentFacts(state, city.id); assert.equal(facts.growth, null); assert.equal(facts.lastGrowth, null);
});
const legal = localGrowthOperationJourney();
await test('legal housing completion, later food-funded growth and subsequent staffing remain distinct', () => {
  const before = structuredClone(legal.growth);
  const built = townDevelopmentFacts(legal.completed, legal.journey.cityId);
  const grown = townDevelopmentFacts(legal.growth, legal.journey.cityId);
  assert.equal(built.growth?.population, 20); assert.equal(built.growth?.capacity, 24);
  assert.equal(grown.growth?.population, 21); assert.equal(grown.lastGrowth?.populationBefore, 20); assert.equal(grown.lastGrowth?.populationAfter, 21); assert.ok((grown.lastGrowth?.foodPaid ?? 0) > 0);
  assert.equal(grown.lastGrowth?.round, legal.growth.round); assert.deepEqual(legal.growth, before);
  assert.notEqual(grown.growth?.sources, built.growth?.sources);
});
await test('latest exact-town growth receipt survives a later current-state change without inferring payment from stock', () => {
  const state = structuredClone(legal.growth); const city = state.cities.find(item => item.id === legal.journey.cityId); assert.ok(city);
  const receipt = townDevelopmentFacts(state, city.id).lastGrowth; assert.ok(receipt);
  city.population = 18; const facts = townDevelopmentFacts(state, city.id);
  assert.equal(facts.growth?.population, 18); assert.deepEqual(facts.lastGrowth, receipt);
  assert.equal(townDevelopmentFacts(state, 'missing-town').growth, null);
});
await test('named population event exposes actual before-after and paid food at first glance', () => {
  const event = legal.growthStep.result.events.find(item => item.populationGrowth?.cityId === legal.journey.cityId); assert.ok(event?.populationGrowth);
  const entry = eventLogEntries([event], { civilizations: legal.growth.civilizations })[0]; assert.ok(entry);
  assert.match(entry.summary, /20 → 21/); assert.match(entry.summary, /Food/); assert.match(entry.summary, /Paid/);
});

class ElementRecord {
  tag: string; textContent = ''; className = ''; type = ''; value = ''; dataset: Record<string, string> = {}; children: ElementRecord[] = []; parent: ElementRecord | null = null;
  constructor(tag: string) { this.tag = tag; }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  append(...children: ElementRecord[]): void { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
  prepend(...children: ElementRecord[]): void { this.children.unshift(...children); }
  replaceChildren(...children: ElementRecord[]): void { this.children = []; this.append(...children); }
  setAttribute(_name: string, _value: string): void {}
  addEventListener(_name: string, _listener: () => void): void {}
  querySelector(selector: string): ElementRecord | null { return this.all().find(child => child.tag === selector) ?? null; }
  all(): ElementRecord[] { return [this, ...this.children.flatMap(child => child.all())]; }
  content(): string { return [this.textContent, ...this.children.map(child => child.content())].join(' '); }
}
await test('Town presents current housing next to population while its disclosure retains the exact past food payment', async () => {
  const { renderSettlementInspection } = await import('../web/settlement-inspection.ts');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'); const previousElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementRecord });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag: string) => new ElementRecord(tag), createElementNS: (_namespace: string, tag: string) => new ElementRecord(tag), createTextNode: (value: string) => { const node = new ElementRecord('text'); node.textContent = value; return node; } } });
  try {
    const host = new ElementRecord('div');
    assert.ok(host instanceof HTMLElement);
    renderSettlementInspection(host, legal.growth.cities, legal.journey.cityId, () => {}, undefined, '', townDevelopmentFacts(legal.growth, legal.journey.cityId));
    assert.match(host.content(), /21 \/ 24 housing/); assert.match(host.content(), /Paid 11 Food/); assert.match(host.content(), /20 → 21 residents/); assert.match(host.content(), /Granary/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
    if (previousElement) Object.defineProperty(globalThis, 'HTMLElement', previousElement); else Reflect.deleteProperty(globalThis, 'HTMLElement');
  }
});
