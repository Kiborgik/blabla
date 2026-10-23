import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, ECONOMY_RULES, TECHNOLOGIES } from '../core/content.ts';
import { buildingBaseProduction } from '../core/simulation/districts.ts';
import { siteProduction } from '../core/simulation/sites.ts';
import type { City, Resources, WorldState } from '../core/types.ts';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import { capabilityTreeNodes } from '../web/capability-tree.ts';
import { createLocalPowerInspection, localPowerPresentation, localPowerResultLines, renderSettlementInspection } from '../web/settlement-inspection.ts';
import { townProductionRows } from '../web/town-production.ts';
import { poweredScienceJourney } from './fixtures/powered-science-journey.ts';

const journey = poweredScienceJourney();

function cityAt(state: WorldState): City {
  const city = state.cities.find(item => item.id === journey.cityId); assert.ok(city); return city;
}

function productiveFacts() {
  const step = journey.steps.find(candidate => candidate.result.state.revision === journey.productive.revision); assert.ok(step?.input.kind === 'strategy');
  const opening = cityAt(step.before); const actor = step.before.civilizations[journey.seat]; assert.ok(actor);
  assert.deepEqual(opening.buildings.toSorted(), ['campus', 'coal-plant', 'factory', 'industrial-zone', 'library', 'research-lab']);
  assert.equal(opening.buildingOperations?.library?.enabled, false); assert.deepEqual(step.before.wonders, {}); assert.equal(actor.government?.active, null);
  assert.equal(step.before.cities.filter(city => city.civId === journey.seat).length, 1);
  const tile = step.before.tiles.find(candidate => candidate.id === opening.tileId); assert.ok(tile);
  const campus = BUILDINGS.find(building => building.id === 'campus'); const zone = BUILDINGS.find(building => building.id === 'industrial-zone'); assert.ok(campus && zone);
  const focus: Partial<Resources> = ECONOMY_RULES.focusProduction[opening.focus]; const site = siteProduction(step.before, tile);
  const rawScience = ECONOMY_RULES.baseProduction.science + (focus.science ?? 0) + (site.science ?? 0) + (buildingBaseProduction(step.before, opening, campus).science ?? 0);
  const rawMaterials = ECONOMY_RULES.baseProduction.materials + (focus.materials ?? 0) + (site.materials ?? 0) + (buildingBaseProduction(step.before, opening, zone).materials ?? 0);
  const productivity = (0.5 + opening.wellbeing / 100) * (1 - opening.damage / 100) * (1 + opening.infrastructure / 10);
  const rounded = (value: number): number => Math.round(value * 100) / 100;
  const totalScience = rounded((rawScience + 12) * productivity);
  const science = rounded(totalScience - rounded(rawScience * productivity));
  const materials = rounded(rounded((rawMaterials + 12) * productivity) - rounded(rawMaterials * productivity));
  const event = step.result.events.find(candidate => candidate.type === 'local-power-beat' && candidate.localPower?.cityId === journey.cityId); assert.ok(event?.localPower);
  const receipt = cityAt(journey.productive).localPower?.lastProductiveBeat; assert.ok(receipt); assert.deepEqual(receipt, event.localPower);
  assert.equal(receipt.round, step.before.round + 1); assert.equal(receipt.round, journey.productive.round);
  const lab = receipt.operations.find(operation => operation.buildingId === 'research-lab'); const factory = receipt.operations.find(operation => operation.buildingId === 'factory'); assert.ok(lab && factory);
  assert.equal(lab.result.produced.science, science); assert.equal(factory.result.produced.materials, materials);
  const operationEvent = step.result.events.find(candidate => candidate.id === lab.result.operationEventId); assert.ok(operationEvent); assert.equal(operationEvent.type, 'building-operation');
  assert.ok(operationEvent.effects.includes(`Produced ${science} science`));
  const banking = TECHNOLOGIES.find(technology => technology.id === 'banking'); assert.ok(banking); assert.equal(actor.researchTarget, banking.id);
  const progress = rounded(actor.researchProgress + Math.min(totalScience, actor.resources.science + totalScience, banking.cost - actor.researchProgress));
  assert.equal(journey.researchInvested.civilizations[journey.seat]?.researchProgress, progress); assert.ok(progress > science);
  return { round: receipt.round, eventId: lab.result.operationEventId, science, materials, progress, researchCost: banking.cost };
}

function nodesAt(state: WorldState, cityId = journey.cityId) {
  return capabilityTreeNodes({ runId: 'legal-powered-science-source', civilizationName: 'Aster', towns: state.cities.map(city => ({ id: city.id, name: city.name })), catalogue: capabilityCatalogue(), projection: projectCapabilities(state, journey.seat, cityId, journey.time()) });
}

function labAt(state: WorldState, cityId = journey.cityId) {
  const node = nodesAt(state, cityId).find(item => item.id === 'building:research-lab'); assert.ok(node); return node;
}

function fact(state: WorldState, label: string): string | undefined {
  return labAt(state).facts.find(item => item.label === label)?.value;
}

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


function workCard(city: City): ElementRecord {
  return withDocument(() => {
    const host = document.createElement('section'); assert.ok(host instanceof ElementRecord);
    renderSettlementInspection(host, [city], city.id, () => undefined, undefined, 'research-lab', undefined, undefined, undefined, undefined, undefined, city.localPower);
    const card = host.all().find(node => node.dataset['building'] === 'research-lab'); assert.ok(card); return card;
  });
}

await test('the fresh prerequisite scenario exposes connected research and same-town Campus gates', () => {
  const prepared = nodesAt(journey.prepared);
  const sanitation = prepared.find(node => node.id === 'technology:sanitation'); const chemistry = prepared.find(node => node.id === 'technology:chemistry'); assert.ok(sanitation && chemistry);
  assert.equal(sanitation.status, 'available'); assert.deepEqual(sanitation.requires, ['technology:construction', 'technology:education']);
  assert.equal(sanitation.facts.find(item => item.label === 'Research work')?.value, '140 Science');
  assert.equal(chemistry.status, 'locked'); assert.deepEqual(chemistry.requires, ['technology:sanitation', 'technology:scientific-method']);
  assert.equal(chemistry.facts.find(item => item.label === 'Research work')?.value, '260 Science');
  assert.deepEqual(chemistry.blockers, ['Learn Sanitation']);
  assert.equal(labAt(journey.prepared).status, 'locked'); assert.deepEqual(labAt(journey.prepared).blockers, ['Learn Chemistry']);
  const available = labAt(journey.beforeLab);
  assert.equal(available.status, 'available'); assert.deepEqual(available.requires, ['building:campus', 'technology:chemistry']);
  const syntheticOtherTown = structuredClone(journey.beforeLab);
  const other = syntheticOtherTown.cities.find(city => city.civId !== journey.seat && !city.buildings.includes('campus')); assert.ok(other); other.civId = journey.seat;
  const center = syntheticOtherTown.tiles.find(tile => tile.id === other.tileId); assert.ok(center); center.owner = journey.seat;
  assert.ok(cityAt(syntheticOtherTown).buildings.includes('campus'));
  const beforeProjection = structuredClone(syntheticOtherTown); const blocked = labAt(syntheticOtherTown, other.id); assert.equal(blocked.status, 'locked');
  assert.ok(blocked.blockers.includes(`Build Campus in ${other.name}`)); assert.deepEqual(syntheticOtherTown, beforeProjection);
});

await test('paid construction and installed Laboratory do not acquire an operating Science result', () => {
  const started = labAt(journey.labStarted);
  assert.equal(started.construction, 'Under construction · 0 / 18 work');
  assert.equal(fact(journey.labStarted, 'Already paid for this order'), '42 Materials · 24 Credits');
  assert.equal(fact(journey.labStarted, 'Actual latest attempt'), 'No local Power operation recorded yet');
  assert.equal(labAt(journey.labCompleted).status, 'done');
  assert.equal(fact(journey.labCompleted, 'Actual latest attempt'), 'No local Power operation recorded yet');
  assert.equal(fact(journey.labCompleted, 'Last positive powered output'), undefined);
  assert.match(workCard(cityAt(journey.labCompleted)).content(), /Built · On now.*No operating result recorded yet/);
  assert.equal(townProductionRows(cityAt(journey.labCompleted)).find(row => row.buildingId === 'research-lab')?.result, 'No operating record yet');
});

await test('actual Laboratory facts separate base Science from paid output and chosen research progress', () => {
  const expected = productiveFacts(); const node = labAt(journey.productive);
  assert.equal(node.status, 'done');
  assert.equal(fact(journey.productive, 'Ordinary and strategic inputs'), '2 Credits');
  assert.equal(fact(journey.productive, 'Base production before productivity'), '12 Science');
  assert.equal(fact(journey.productive, 'Same-town Power recipe'), '3 Power required · 0 Power generated · Unused Power expires that season');
  assert.equal(fact(journey.productive, 'Actual latest attempt'), `Round ${expected.round} · operated · Generated 0 Power · Used 3 · Paid 2 Credits · Made ${expected.science} Science · Emissions 0`);
  assert.equal(fact(journey.productive, 'Last positive powered output'), `Round ${expected.round} · Made ${expected.science} Science · Used 3 Power · Event ${expected.eventId}`);
  const banking = nodesAt(journey.researchInvested).find(item => item.id === 'technology:banking'); assert.ok(banking);
  assert.equal(journey.researchInvested.civilizations[journey.seat]?.researchTarget, 'banking');
  assert.equal(banking.research, `Researching · ${expected.progress} / ${expected.researchCost} science`);
  assert.ok(!(fact(journey.productive, 'Actual latest attempt') ?? '').includes(`Made ${expected.progress} Science`));
  const overview = townProductionRows(cityAt(journey.productive)).find(row => row.buildingId === 'research-lab'); assert.ok(overview);
  assert.equal(overview.result, `Made ${expected.science} Science`); assert.equal(overview.current, 'On');
  assert.deepEqual(overview.last?.paid, [{ resource: 'credits', label: 'Credits', amount: 2 }]); assert.equal(overview.last?.residents?.allocated, 3);
});

await test('actual town receipt renders Coal generation, both consumers and exact Laboratory residents', () => {
  const expected = productiveFacts(); const city = cityAt(journey.productive); const before = structuredClone(city);
  const view = localPowerPresentation(city); assert.ok(view?.latest);
  assert.equal(view.latest.balance, 'Generated 8 Power · Used 6 · Expired 2');
  const node = rendered(city); const latest = node.all().find(item => item.dataset['townDisclosure'] === 'local-power-latest'); assert.ok(latest);
  const lab = latest.all().find(item => item.className === 'local-power-operation' && item.children[0]?.textContent.startsWith('Research laboratory')); assert.ok(lab);
  assert.match(lab.content(), new RegExp(`Powered consumer.*Operated in round ${expected.round}.*Power needed 3 · Available before this attempt 5 · Shortfall 0`));
  assert.match(lab.content(), new RegExp(`Assigned 3 residents · Needed 3.*Ordinary supplies paid:.*2 Credits.*Actual ordinary output:.*${String(expected.science).replaceAll('.', '\\.')} Science`));
  assert.match(lab.content(), /Base ordinary output before modifiers:.*12 Science.*Requires 3 residents · Power input 3 · Power output 0/);
  assert.match(latest.content(), /Strategic supplies paid:.*2 Coal/);
  assert.match(latest.content(), /Emissions recorded for this operation · 4/);
  assert.match(node.content(), /not stored, traded or ordinary Energy.*no climate or calendar effect/);
  assert.ok(node.all().filter(item => item.tag === 'details').every(item => item.children[0]?.tag === 'summary'));
  assert.equal(node.all().some(item => ['button', 'input', 'select', 'form'].includes(item.tag)), false);
  assert.deepEqual(city, before);
});

await test('the exact Work card and overview preserve the Laboratory identity and operation values', () => {
  const expected = productiveFacts(); const card = workCard(cityAt(journey.productive));
  assert.match(card.content(), /Research laboratory.*At this town’s Campus · Tile 39.*Assigned 3 residents/);
  assert.match(card.content(), new RegExp(`Ordinary supplies paid:.*2 Credits.*Actual ordinary output:.*${String(expected.science).replaceAll('.', '\\.')} Science`));
  assert.ok(card.all().some(item => item.dataset['townDisclosure'] === 'power-positive:research-lab'));
  assert.doesNotMatch(card.content(), /No separate per-building output receipt/);
  withDocument(() => {
    const city = cityAt(journey.productive); const host = document.createElement('section'); assert.ok(host instanceof ElementRecord);
    renderSettlementInspection(host, [city], city.id, () => undefined, undefined, 'research-lab', undefined, undefined, undefined, undefined, undefined, city.localPower);
    const preview = host.all().find(item => item.className === 'work-preview'); assert.ok(preview);
    assert.match(preview.content(), new RegExp(`Operated in round ${expected.round}.*Used 3`));
    const picker = host.all().find(item => item.className === 'work-picker'); assert.ok(picker);
    assert.equal(picker.value, 'research-lab');
    picker.value = 'factory'; picker.listeners.get('change')?.();
    assert.match(host.all().find(item => item.className === 'work-preview')?.content() ?? '', new RegExp(`${String(expected.materials).replaceAll('.', '\\.')} Materials`));
  });
});

await test('a later real pause and event pruning retain the exact earlier positive Laboratory receipt', () => {
  const expected = productiveFacts(); const positive = cityAt(journey.productive).localPower?.lastProductiveBeat; assert.ok(positive);
  for (const state of [journey.nonproductive, journey.pruned]) {
    const city = cityAt(state); assert.deepEqual(city.localPower?.lastProductiveBeat, positive);
    assert.equal(fact(state, 'Operating now'), 'Paused');
    assert.match(fact(state, 'Actual latest attempt') ?? '', /paused.*Used 0 · Paid None · Made None/);
    assert.equal(fact(state, 'Last positive powered output'), fact(journey.productive, 'Last positive powered output'));
    const card = workCard(city); assert.match(card.content(), /Built · Paused now/);
    const history = card.all().find(item => item.dataset['townDisclosure'] === 'power-positive:research-lab'); assert.ok(history);
    assert.match(history.content(), new RegExp(`Round ${expected.round}.*${String(expected.science).replaceAll('.', '\\.')} Science`));
    const current = city.buildingOperations?.['research-lab']?.lastResult; assert.ok(current);
    assert.match(localPowerResultLines(current).join(' '), /Paused.*Used 0.*Assigned 0 residents/);
  }
  assert.equal(journey.pruned.events.some(event => event.id === positive.eventId), false);
});

await test('a later actual Factory-only snapshot never labels paused Laboratory output as positive', () => {
  const state = journey.replacedByFactory; const city = cityAt(state); const latest = city.localPower?.lastProductiveBeat; assert.ok(latest);
  assert.equal(latest.operations.find(item => item.buildingId === 'research-lab')?.result.status, 'paused');
  assert.equal(fact(state, 'Last positive powered output'), undefined);
  const factory = nodesAt(state).find(item => item.id === 'building:factory'); assert.ok(factory);
  assert.ok(factory.facts.some(item => item.label === 'Last positive powered output' && item.value.includes('Materials')));
  assert.match(fact(state, 'Actual latest attempt') ?? '', /paused.*Made None/);
});

await test('the bounded Work history drops a Laboratory positive disclosure when the town snapshot becomes Factory-only', () => {
  const city = cityAt(journey.replacedByFactory); const card = workCard(city);
  assert.equal(card.all().some(item => item.dataset['townDisclosure'] === 'power-positive:research-lab'), false);
  const retained = city.buildingOperations?.['research-lab']?.lastResult; assert.ok(retained); assert.equal(retained.round, journey.replacedByFactory.round);
  assert.match(card.content(), new RegExp(`Built · Paused now.*Paused in round ${retained.round}`));
  const overview = townProductionRows(city).find(item => item.buildingId === 'research-lab'); assert.ok(overview);
  assert.equal(overview.result, 'Paused in that season'); assert.equal(overview.current, 'Paused');
});
