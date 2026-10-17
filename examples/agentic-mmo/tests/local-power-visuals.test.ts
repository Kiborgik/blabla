import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { City, LocalPowerBeatReceipt, LocalPowerOperationReceipt } from '../core/types.ts';
import { createWorld } from '../core/engine.ts';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import { capabilityTreeNodes } from '../web/capability-tree.ts';
import { localPowerJourney } from './fixtures/local-power-journey.ts';
import { createLocalPowerInspection, localPowerPresentation, localPowerResultLines, renderSettlementInspection } from '../web/settlement-inspection.ts';

function syntheticBeat(): LocalPowerBeatReceipt {
  const generator: LocalPowerOperationReceipt = {
    buildingId: 'coal-plant', phase: 'generator', recipe: { ruleVersion: 1, inputs: {}, strategicInputs: { coal: 2 }, baseOutputs: {}, residentsRequired: 3, localPowerInput: 0, localPowerOutput: 8, emissionsPerOperation: 4 },
    result: { round: 8, status: 'operated', paid: {}, produced: {}, shortages: [], strategicPaid: { coal: 2 }, strategicShortages: [], residents: { ruleVersion: 1, openingPopulation: 15, communityReserve: 3, required: 3, available: 12, allocated: 3 }, localPower: { ruleVersion: 1, required: 0, availableBefore: 0, consumed: 0, generated: 8, shortage: 0 }, emissionsProduced: 4, operationEventId: '10:0' },
  };
  const consumer: LocalPowerOperationReceipt = {
    buildingId: 'factory', phase: 'consumer', recipe: { ruleVersion: 1, inputs: {}, strategicInputs: {}, baseOutputs: { materials: 12 }, residentsRequired: 3, localPowerInput: 3, localPowerOutput: 0, emissionsPerOperation: 0 },
    result: { round: 8, status: 'operated', paid: {}, produced: { materials: 27 }, shortages: [], strategicPaid: {}, strategicShortages: [], residents: { ruleVersion: 1, openingPopulation: 15, communityReserve: 3, required: 3, available: 9, allocated: 3 }, localPower: { ruleVersion: 1, required: 3, availableBefore: 8, consumed: 3, generated: 0, shortage: 0 }, emissionsProduced: 0, operationEventId: '10:1' },
  };
  return { ruleVersion: 1, cityId: 'home', civId: 0, round: 8, eventId: '10:2', openingPopulation: 15, communityReserve: 3, operations: [generator, consumer], generated: 8, consumed: 3, expired: 5 };
}

function syntheticCity(): City {
  const beat = syntheticBeat();
  return { id: 'home', name: 'Home', civId: 0, tileId: 1, population: 15, wellbeing: 100, infrastructure: 1, focus: 'industry', damage: 0, buildings: ['coal-plant', 'factory'], districtSites: { 'industrial-zone': 2 },
    buildingOperations: Object.fromEntries(beat.operations.map(entry => [entry.buildingId, { enabled: true, lastResult: structuredClone(entry.result) }])),
    localPower: { ruleVersion: 1, lastBeat: beat, lastProductiveBeat: structuredClone(beat) } };
}

function syntheticPausedCity(): City {
  const city = syntheticCity(); const beat = city.localPower?.lastBeat; assert.ok(beat);
  beat.round = 9; beat.eventId = '11:2'; beat.consumed = 0; beat.expired = 8;
  for (const [index, entry] of beat.operations.entries()) { entry.result.round = 9; entry.result.operationEventId = `11:${index}`; }
  const factory = beat.operations[1]; assert.ok(factory);
  Object.assign(factory.result, { status: 'paused', produced: {} }); factory.result.localPower.consumed = 0; factory.result.residents.allocated = 0;
  city.buildingOperations = Object.fromEntries(beat.operations.map(entry => [entry.buildingId, { enabled: entry.buildingId !== 'factory', lastResult: structuredClone(entry.result) }]));
  return city;
}

await test('legacy and newly installed synthetic towns never gain an invented Power attempt', () => {
  const city = syntheticCity(); delete city.localPower;
  assert.equal(localPowerPresentation(city), null);
  assert.equal(createLocalPowerInspection(city), null);
  city.localPower = { ruleVersion: 1, lastBeat: null, lastProductiveBeat: null };
  const view = localPowerPresentation(city); assert.ok(view);
  assert.equal(view.latest, null); assert.equal(view.productive, null);
});

await test('synthetic exact town balance and recorded owner remain historical and detached', () => {
  const city = syntheticCity(); city.civId = 4; city.population = 30;
  const before = structuredClone(city); const view = localPowerPresentation(city); assert.ok(view?.latest);
  assert.equal(view.latest.balance, 'Generated 8 Power · Used 3 · Expired 5');
  assert.match(view.latest.identity, /Town home · Recorded civilization 0 · Round 8 · Event 10:2/);
  assert.equal(view.latest.record.openingPopulation, 15);
  view.latest.record.generated = 999;
  assert.deepEqual(city, before);
});

await test('synthetic current pause does not relabel a prior positive powered result', () => {
  const city = syntheticPausedCity(); const view = localPowerPresentation(city); assert.ok(view?.latest && view.productive);
  assert.ok(view.current.includes('Factory · Paused now'));
  assert.equal(view.latest.record.round, 9); assert.equal(view.latest.record.expired, 8);
  assert.equal(view.productive.record.round, 8); assert.equal(view.productive.record.operations[1]?.result.produced.materials, 27);
  assert.match(localPowerResultLines(view.latest.record.operations[1]!.result).join(' '), /Paused in round 9.*Used 0/);
});

await test('synthetic Coal and Power shortages show exact zero allocations without using ordinary Energy', () => {
  const city = syntheticCity(); const beat = city.localPower?.lastBeat; assert.ok(beat);
  beat.generated = 0; beat.consumed = 0; beat.expired = 0;
  for (const entry of beat.operations) { entry.result.status = 'blocked'; entry.result.strategicPaid = {}; entry.result.produced = {}; entry.result.residents.allocated = 0; entry.result.localPower.generated = 0; entry.result.localPower.consumed = 0; entry.result.localPower.availableBefore = 0; entry.result.emissionsProduced = 0; }
  const plant = beat.operations[0]; const factory = beat.operations[1]; assert.ok(plant && factory);
  plant.result.strategicShortages = [{ resource: 'coal', required: 2, available: 1 }]; factory.result.localPower.shortage = 3;
  assert.match(localPowerResultLines(plant.result).join(' '), /Generated 0.*Assigned 0 residents.*Emissions recorded for this operation · 0.*Coal needed 2 · Available then 1/);
  assert.match(localPowerResultLines(factory.result).join(' '), /Power needed 3 · Available before this attempt 0 · Shortfall 3/);
  assert.doesNotMatch(localPowerResultLines(factory.result).join(' '), /Energy needed/);
});

await test('generation and paid zero output do not manufacture a last productive receipt', () => {
  const city = syntheticCity(); assert.ok(city.localPower?.lastBeat);
  city.localPower.lastProductiveBeat = null;
  const generatorOnly = structuredClone(city.localPower.lastBeat); generatorOnly.operations = generatorOnly.operations.slice(0, 1); generatorOnly.consumed = 0; generatorOnly.expired = 8;
  city.localPower.lastBeat = generatorOnly;
  assert.equal(localPowerPresentation(city)?.productive, null);
  city.localPower.lastBeat = syntheticBeat(); city.localPower.lastBeat.operations[1]!.result.produced = { materials: 0 };
  assert.equal(localPowerPresentation(city)?.productive, null);
});

await test('receipts from a different selected town are not shown as this town Power', () => {
  const city = syntheticCity(); city.id = 'other';
  const view = localPowerPresentation(city); assert.ok(view);
  assert.equal(view.latest, null); assert.equal(view.productive, null);
});

class ElementRecord {
  tag: string; textContent = ''; className = ''; type = ''; value = ''; focused = false; dataset: Record<string, string> = {}; children: ElementRecord[] = []; parent: ElementRecord | null = null; attributes = new Map<string, string>(); listeners = new Map<string, () => void>();
  classList = { add: (...names: string[]) => { this.className = [this.className, ...names].filter(Boolean).join(' '); } };
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
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'); const previousElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  const createElement = (tag: string): ElementRecord => new ElementRecord(tag);
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementRecord });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement, createElementNS: (_namespace: string, tag: string) => createElement(tag), createTextNode: (value: string) => { const node = createElement('#text'); node.textContent = value; return node; } } });
  try { return run(); } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
    if (previousElement) Object.defineProperty(globalThis, 'HTMLElement', previousElement); else Reflect.deleteProperty(globalThis, 'HTMLElement');
  }
}

function rendered(city: City): ElementRecord {
  return withDocument(() => { const node = createLocalPowerInspection(city); assert.ok(node instanceof ElementRecord); return node; });
}

await test('synthetic native Power details preserve paid Coal, exact output, recipe and emissions', () => {
  const city = syntheticCity(); const before = structuredClone(city); const node = rendered(city);
  assert.match(node.content(), /Generated 8 Power · Used 3 · Expired 5/);
  assert.match(node.content(), /Strategic supplies paid:.*2 Coal/);
  assert.match(node.content(), /Actual ordinary output:.*27 Materials/);
  assert.match(node.content(), /Base ordinary output before modifiers:.*12 Materials/);
  assert.match(node.content(), /Emissions recorded for this operation · 4/);
  assert.match(node.content(), /not stored, traded or ordinary Energy/);
  assert.equal(node.all().filter(item => item.tag === 'details').every(item => item.children[0]?.tag === 'summary'), true);
  assert.equal(node.all().some(item => ['button', 'input', 'select', 'form'].includes(item.tag)), false);
  assert.ok(node.all().some(item => item.dataset['townDisclosure'] === 'local-power-latest'));
  assert.ok(node.all().some(item => item.dataset['townDisclosure'] === 'local-power-productive'));
  assert.deepEqual(city, before);
});

await test('synthetic paused latest attempt and retained positive output have separate native records', () => {
  const node = rendered(syntheticPausedCity());
  const latest = node.all().find(item => item.dataset['townDisclosure'] === 'local-power-latest'); const positive = node.all().find(item => item.dataset['townDisclosure'] === 'local-power-productive');
  assert.ok(latest && positive);
  assert.match(latest.content(), /Latest town Power attempt · Round 9.*Expired 8.*Paused in round 9/);
  assert.match(positive.content(), /Last positive powered output · Round 8.*27 Materials/);
});

await test('synthetic installed-only and generator-only records make no productive Factory claim', () => {
  const city = syntheticCity(); city.localPower = { ruleVersion: 1, lastBeat: null, lastProductiveBeat: null };
  assert.match(rendered(city).content(), /No town Power attempt recorded yet.*No positive powered output recorded yet/);
  city.localPower.lastBeat = syntheticBeat(); city.localPower.lastBeat.operations = city.localPower.lastBeat.operations.slice(0, 1); city.localPower.lastBeat.consumed = 0; city.localPower.lastBeat.expired = 8;
  assert.match(rendered(city).content(), /Generated 8 Power · Used 0 · Expired 8.*Generation alone is not a productive Factory result/);
});

await test('synthetic receipt identifiers and unknown building names stay plain text', () => {
  const city = syntheticCity(); assert.ok(city.localPower?.lastBeat);
  city.localPower.lastBeat.operations[0]!.buildingId = '<button>Generate</button>';
  city.localPower.lastBeat.eventId = '<img src=x>';
  const node = rendered(city); assert.match(node.content(), /<button>Generate<\/button>/); assert.match(node.content(), /<img src=x>/);
  assert.equal(node.all().some(item => ['button', 'img'].includes(item.tag)), false);
});

await test('integrated synthetic Work inspection handles Power buildings as operations rather than passive output', () => {
  withDocument(() => {
    const city = syntheticPausedCity(); const host = document.createElement('section'); assert.ok(host instanceof ElementRecord);
    renderSettlementInspection(host, [city], city.id, () => undefined, undefined, 'factory', undefined, undefined, undefined, undefined, undefined, city.localPower);
    assert.ok(host.all().some(node => node.className === 'local-power-inspection'));
    const preview = host.all().find(node => node.className === 'work-preview'); assert.ok(preview);
    assert.match(preview.content(), /Built · Paused now.*Paused in round 9.*Used 0/);
    const card = host.all().find(node => node.dataset['building'] === 'factory'); assert.ok(card);
    assert.match(card.content(), /Last positive powered output · Round 8.*27 Materials/);
    assert.doesNotMatch(card.content(), /No separate per-building output receipt/);
    const picker = host.all().find(node => node.className === 'work-picker'); assert.ok(picker);
    picker.value = 'coal-plant'; picker.listeners.get('change')?.();
    assert.match(host.all().find(node => node.className === 'work-preview')?.content() ?? '', /Generated 8/);
  });
});

await test('synthetic capability facts distinguish canonical recipe, current attempt and retained positive output', () => {
  const time = '2026-10-17T00:00:00.000Z'; const state = createWorld(1701, time); const city = syntheticPausedCity();
  assert.ok(city.localPower); const operation = city.buildingOperations?.factory; assert.ok(operation);
  const projection = projectCapabilities(state, 0, 'city-0', time); projection.cityId = city.id; projection.localPower = city.localPower;
  const row = projection.buildings.find(entry => entry.nodeId === 'building:factory'); assert.ok(row); row.operation = operation;
  const nodes = capabilityTreeNodes({ runId: 'synthetic-power', civilizationName: 'Aster', towns: [{ id: 'city-0', name: 'Town' }], catalogue: capabilityCatalogue(), projection });
  const factory = nodes.find(node => node.id === 'building:factory'); assert.ok(factory);
  assert.ok(factory.facts.some(fact => fact.label === 'Same-town Power recipe' && fact.value.includes('3 Power required')));
  assert.ok(factory.facts.some(fact => fact.label === 'Actual latest attempt' && fact.value.includes('Round 9 · paused')));
  assert.ok(factory.facts.some(fact => fact.label === 'Last positive powered output' && fact.value.includes('Round 8 · Made 27 Materials')));
  assert.equal(factory.status, 'planned');
});

await test('capability inspection excludes retained positive Power from another town', () => {
  const time = '2026-10-17T00:00:00.000Z'; const state = createWorld(1701, time);
  const power = syntheticCity().localPower; assert.ok(power);
  const projection = projectCapabilities(state, 0, 'city-0', time); projection.localPower = power;
  const nodes = capabilityTreeNodes({ runId: 'synthetic-power', civilizationName: 'Aster', towns: [{ id: 'city-0', name: 'Town' }], catalogue: capabilityCatalogue(), projection });
  assert.equal(nodes.find(node => node.id === 'building:factory')?.facts.some(fact => fact.label === 'Last positive powered output'), false);
});

await test('legal typed journey exposes completed, productive and paused Power receipts without promoting construction', () => {
  const journey = localPowerJourney();
  assert.equal(journey.steps.length, 850);
  const installed = journey.plantCompleted.cities.find(city => city.id === journey.cityId); assert.ok(installed);
  assert.ok(installed.buildings.includes('coal-plant'));
  assert.equal(localPowerPresentation(installed)?.latest, null);
  assert.match(rendered(installed).content(), /No town Power attempt recorded yet.*No positive powered output recorded yet/);
  const productive = journey.productive.cities.find(city => city.id === journey.cityId); assert.ok(productive);
  const latest = localPowerPresentation(productive)?.latest; assert.ok(latest);
  assert.equal(latest.record.round, 709); assert.equal(latest.record.eventId, '848:10');
  assert.equal(latest.balance, 'Generated 8 Power · Used 3 · Expired 5');
  const plant = latest.record.operations.find(entry => entry.buildingId === 'coal-plant'); const factory = latest.record.operations.find(entry => entry.buildingId === 'factory'); assert.ok(plant && factory);
  assert.equal(plant.result.strategicPaid.coal, 2); assert.equal(plant.result.residents.allocated, 3); assert.equal(plant.result.emissionsProduced, 4);
  assert.equal(factory.result.localPower.consumed, 3); assert.equal(factory.result.residents.allocated, 3); assert.equal(factory.result.produced.materials, 23.4);
  assert.match(rendered(productive).content(), /Actual ordinary output:.*23.4 Materials/);
  const unused = journey.unused.cities.find(city => city.id === journey.cityId); assert.ok(unused);
  const view = localPowerPresentation(unused); assert.ok(view?.latest && view.productive);
  assert.equal(view.latest.record.round, 710); assert.equal(view.latest.record.expired, 8); assert.equal(view.productive.record.round, 709);
  const node = rendered(unused);
  assert.match(node.all().find(item => item.dataset['townDisclosure'] === 'local-power-latest')?.content() ?? '', /Round 710.*Expired 8.*Paused in round 710/);
  assert.match(node.all().find(item => item.dataset['townDisclosure'] === 'local-power-productive')?.content() ?? '', /Round 709.*23.4 Materials/);
  const projection = projectCapabilities(journey.unused, journey.seat, journey.cityId, journey.time());
  const nodes = capabilityTreeNodes({ runId: 'legal-source-power-journey', civilizationName: 'Aster', towns: [{ id: unused.id, name: unused.name }], catalogue: capabilityCatalogue(), projection });
  const capability = nodes.find(item => item.id === 'building:factory'); assert.ok(capability);
  assert.ok(capability.facts.some(fact => fact.label === 'Actual latest attempt' && fact.value.includes('Round 710 · paused')));
  assert.ok(capability.facts.some(fact => fact.label === 'Last positive powered output' && fact.value.includes('Round 709 · Made 23.4 Materials')));
});
