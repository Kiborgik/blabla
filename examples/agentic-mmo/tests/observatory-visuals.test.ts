import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, ECONOMY_RULES } from '../core/content.ts';
import { buildingBaseProduction } from '../core/simulation/districts.ts';
import { siteProduction } from '../core/simulation/sites.ts';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import type { City, Resources, WorldState } from '../core/types.ts';
import { observedResidentCapacity } from '../core/simulation/operations.ts';
import { observatoryLearningOperationJourney } from './fixtures/observatory-learning-journey.ts';
import { districtParts, DISTRICT_PART_BUDGETS } from '../visuals/district-visuals.ts';
import { projectWorld } from '../web/live-world.ts';
import { capabilityTreeNodes, type CapabilityTreeInput } from '../web/capability-tree.ts';
import { renderSettlementInspection } from '../web/settlement-inspection.ts';

const legal = observatoryLearningOperationJourney();
const town = (state: WorldState) => { const city = state.cities.find(item => item.id === legal.journey.cityId); assert.ok(city); return city; };
const campus = (state: WorldState) => { const site = projectWorld(state).districts?.find(item => item.cityId === legal.journey.cityId && item.buildingId === 'campus'); assert.ok(site); return site; };
const input = (state: WorldState): CapabilityTreeInput => ({ runId: 'legal-local-observatory', civilizationName: 'Aster', towns: [{ id: town(state).id, name: town(state).name }], catalogue: capabilityCatalogue(), projection: projectCapabilities(state, town(state).civId, town(state).id, legal.journey.time()) });

await test('canonical high-ground blocker names the own Campus rather than inventing town-center eligibility', () => {
  const view = input(legal.researched); const row = view.projection.buildings.find(item => item.nodeId === 'building:observatory'); assert.ok(row);
  row.status = 'locked'; row.blockers = [{ kind: 'campus-high-ground', cityId: town(legal.researched).id }];
  const nodes = capabilityTreeNodes(view); const node = nodes.find(item => item.id === 'building:observatory'); assert.ok(node);
  assert.ok(node.blockers.some(value => /Campus/.test(value) && /hill or mountain/.test(value)));
});

await test('canonical current options and retained high ground remain separate exact facts', () => {
  for (const state of [legal.researched, legal.started, legal.completed]) {
    const view = input(state); const before = structuredClone(view); const node = capabilityTreeNodes(view).find(item => item.id === 'building:observatory'); assert.ok(node);
    if (state === legal.researched) assert.ok(node.facts.some(fact => fact.label === 'Current high-ground options' && /Campus Tile 39.*Source Tile 22/.test(fact.value)));
    else assert.ok(node.facts.some(fact => fact.label === 'Retained high ground' && /Campus Tile 39.*Source Tile 22/.test(fact.value)));
    assert.deepEqual(view, before);
  }
});

await test('shared own-Campus Observatory foundation and rounded crown preserve every built family within caps', () => {
  const active = campus(legal.started); const completed = campus(legal.completed);
  assert.equal(active.tileId, 39); assert.equal(completed.cityId, legal.journey.cityId);
  assert.equal(completed.library, 'built');
  for (const detail of ['far', 'mid', 'close'] as const) {
    const before = districtParts(active, detail); const after = districtParts(completed, detail);
    assert.ok(before.some(part => part.id.endsWith('observatory-foundation'))); assert.ok(before.every(part => !part.id.endsWith('observatory-crown')));
    assert.equal(after.some(part => part.id.endsWith('library-roof')), detail !== 'far');
    for (const suffix of ['hall-roof--0.43', 'observatory-body', 'observatory-crown']) assert.ok(after.some(part => part.id.endsWith(suffix)), detail + ': ' + suffix);
    assert.equal(town(legal.completed).buildings.includes('university'), false);
    assert.ok(after.every(part => !part.id.endsWith('university-roof')));
    for (const part of after.filter(part => /observatory-(body|crown)$/.test(part.id))) assert.equal(part.position[0], -.69 * .72);
    assert.ok(after.length <= DISTRICT_PART_BUDGETS[detail]); assert.equal(new Set(after.map(part => part.id)).size, after.length);
  }
  assert.ok(projectWorld(legal.completed).districts?.filter(site => site.cityId !== legal.journey.cityId).every(site => !site.attachments?.some(item => item.buildingId === 'observatory')));
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



await test('active Work exposes retained Campus/source and exact paid work without a completion claim', () => {
  const view = inspect([town(legal.started)], true, host => { const picker = host.all().find(node => node.tag === 'select' && node.className === 'work-picker'); assert.ok(picker); picker.value = 'active:' + town(legal.started).construction?.active?.id; picker.listeners.get('change')?.(); });
  assert.match(view.content(), /Retained high ground.*Campus Tile 39.*Source Tile 22/);
  assert.match(view.content(), /0 \/ 14 work.*Not built yet/); assert.match(view.content(), /30 Materials/); assert.match(view.content(), /16 Credits/);
});

await test('completion and later paid Science retain the source while current pause preserves immutable output', () => {
  const completed = inspect([town(legal.completed)], true, host => { const picker = host.all().find(node => node.tag === 'select' && node.className === 'work-picker'); assert.ok(picker); picker.value = 'observatory'; picker.listeners.get('change')?.(); });
  assert.match(completed.content(), /Retained high ground.*Campus Tile 39.*Source Tile 22/); assert.match(completed.content(), /No operating result recorded yet/);
  const opening = town(legal.operationStep.before); const state = legal.operationStep.before;
  assert.deepEqual(opening.buildings.toSorted(), ['campus', 'fuel-yard', 'library', 'observatory']);
  assert.equal(opening.buildingOperations?.['fuel-yard']?.enabled, false); assert.equal(opening.buildingOperations?.library?.enabled, true);
  assert.equal(town(legal.operated).buildingOperations?.library?.lastResult?.status, 'operated'); assert.deepEqual(state.wonders, {}); assert.equal(state.unlockedFeatures.includes('civic-bootstrap'), false);
  const tile = state.tiles.find(candidate => candidate.id === opening.tileId); const campusDefinition = BUILDINGS.find(building => building.id === 'campus'); assert.ok(tile && campusDefinition);
  const focus: Partial<Resources> = ECONOMY_RULES.focusProduction[opening.focus];
  const raw = ECONOMY_RULES.baseProduction.science + (focus.science ?? 0) + (siteProduction(state, tile).science ?? 0) + (buildingBaseProduction(state, opening, campusDefinition).science ?? 0) + 3;
  const productivity = (0.5 + opening.wellbeing / 100) * (1 - opening.damage / 100) * (1 + opening.infrastructure / 10);
  const rounded = (value: number): number => Math.round(value * 100) / 100;
  const science = rounded(rounded((raw + 7) * productivity) - rounded(raw * productivity));
  assert.equal(town(legal.operated).buildingOperations?.observatory?.lastResult?.produced.science, science);
  const paused = structuredClone(town(legal.operated)); const operation = paused.buildingOperations?.observatory; assert.ok(operation); operation.enabled = false;
  const before = structuredClone(paused);
  const view = inspect([paused], true, host => { const picker = host.all().find(node => node.tag === 'select' && node.className === 'work-picker'); assert.ok(picker); picker.value = 'observatory'; picker.listeners.get('change')?.(); });
  assert.match(view.content(), /Paused now/); assert.match(view.content(), new RegExp(`Made:.*${String(science).replaceAll('.', '\\.')} Science`)); assert.match(view.content(), /Used:.*2 Credits/); assert.match(view.content(), /Assigned: 3 residents/); assert.deepEqual(paused, before);
});

await test('old Campus adds no Observatory and completion alone cannot imply another operating beat', () => {
  assert.ok(districtParts(campus(legal.researched), 'close').every(part => !part.id.includes('observatory')));
  assert.equal(town(legal.completed).buildingOperations?.observatory?.lastResult, null);
  assert.deepEqual(districtParts(campus(legal.completed), 'far'), districtParts(campus(legal.operated), 'far'));
});
