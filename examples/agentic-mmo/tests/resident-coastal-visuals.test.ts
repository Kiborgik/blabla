import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import { applyCommand, createWorld, legalActions } from '../core/engine.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalDeparturePrefix } from './fixtures/coastal-prefix.ts';
import { observedResidentCapacity } from '../core/simulation/operations.ts';
import type { BuildingOperationResult, City } from '../core/types.ts';
import { buildingAppearances } from '../visuals/building-visuals.ts';
import { operationVisual } from '../visuals/operation-visuals.ts';
import { DETAIL_BUDGETS, settlementVisual, eventVisual } from '../visuals/world-visuals.ts';
import { capabilityTreeNodes } from '../web/capability-tree.ts';
import { renderSettlementInspection, residentSupportForWorld } from '../web/settlement-inspection.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const home = createWorld(1701, epoch).cities[0];
assert.ok(home);
const result: BuildingOperationResult = { round: 9, status: 'blocked', paid: {}, produced: {}, shortages: [], residents: { ruleVersion: 1, openingPopulation: 6, communityReserve: 3, required: 3, available: 0, allocated: 0 } };

await test('capacity, supplies and combined blocks retain separate immutable causes', () => {
  assert.ok(result.residents);
  const support = operationVisual({ enabled: true, lastResult: result });
  assert.equal(support.last?.label, 'Not enough local support');
  assert.deepEqual(support.last?.residents, result.residents);
  assert.notEqual(support.last?.residents, result.residents);
  const supplies = { ...result, shortages: [{ resource: 'energy' as const, required: 2, available: 1 }], residents: { ...result.residents, available: 3 } };
  assert.equal(operationVisual({ enabled: true, lastResult: supplies }).last?.label, 'Short of inputs');
  assert.equal(operationVisual({ enabled: true, lastResult: { ...supplies, residents: result.residents } }).last?.label, 'Not enough support or supplies');
  const paused = operationVisual({ enabled: false, lastResult: { ...result, status: 'paused' } });
  assert.equal(paused.summary, 'Paused now'); assert.equal(paused.last?.label, 'Paused');
  const zero = operationVisual({ enabled: true, lastResult: { ...result, status: 'operated', paid: { energy: 2 }, residents: { ...result.residents, available: 3, allocated: 3 } } });
  assert.equal(zero.last?.label, 'No output'); assert.equal(zero.tone, 'neutral');
  const old = { ...result }; delete old.residents;
  assert.equal(operationVisual({ enabled: true, lastResult: old }).last?.residents, undefined);
});

await test('all eight built families and damage fit every LOD without fabricated work', () => {
  const buildings = ['farm', 'workshop', 'irrigation', 'kiln', 'academy', 'monument', 'fuel-yard', 'boat-yard'];
  const city = { ...home, population: 100, damage: 35, buildings };
  const before = structuredClone(city);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const visual = settlementVisual(city, detail);
    assert.equal(visual.buildings.length, 8);
    assert.ok(visual.parts.length <= DETAIL_BUDGETS[detail].parts);
    assert.ok(visual.houses >= 1);
    for (const appearance of buildingAppearances(buildings, detail)) for (const id of appearance.corePartIds) assert.ok(visual.parts.some(part => part.id === id), `${detail}: ${id}`);
    assert.equal(visual.parts.filter(part => part.id.startsWith('damage-')).length, 3);
    assert.deepEqual(settlementVisual({ ...city, buildings: buildings.toReversed() }, detail), visual);
  }
  assert.deepEqual(city, before);
  assert.ok(!settlementVisual(home, 'close').parts.some(part => part.id.startsWith('boat-yard')));
});

await test('tree formats canonical coastal blocker and capability-only yard without production fiction', () => {
  const state = createWorld(1701, epoch);
  const projection = projectCapabilities(state, home.civId, home.id, epoch);
  const yard = projection.buildings.find(row => row.nodeId === 'building:boat-yard');
  assert.ok(yard);
  yard.status = 'locked'; yard.blockers = [{ kind: 'coastal-site', cityId: home.id }];
  const input = { runId: 'offline-test', civilizationName: 'Aster', towns: [{ id: home.id, name: home.name }], catalogue: capabilityCatalogue(), projection };
  const node = capabilityTreeNodes(input).find(entry => entry.id === yard.nodeId);
  assert.deepEqual(node?.blockers, ['Needs a coastal town']);
  assert.ok(node?.facts.some(fact => fact.label === 'Enables' && /Coastal departure/.test(fact.value)));
  assert.ok(!node?.facts.some(fact => /production|operating season/.test(fact.label)));
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

await test('inspection separates current capacity from immutable blocked allocation and old records', () => {
  const city = { ...home, population: 12, buildings: ['kiln'], buildingOperations: { kiln: { enabled: true, lastResult: structuredClone(result) } } };
  const before = structuredClone(city);
  const view = inspect([city]);
  assert.match(view.content(), /Local work capacity: 9 residents/);
  assert.match(view.content(), /Available then: 0/);
  assert.match(view.content(), /Population at start: 6/);
  assert.match(view.content(), /Assigned: 0 residents/);
  assert.match(view.content(), /Nothing was paid or made/);
  assert.ok(view.all().some(node => node.tag === 'details' && node.dataset['townDisclosure'] === 'support'));
  assert.deepEqual(city, before);
  assert.doesNotMatch(inspect([city], false).content(), /Local work capacity/);
  delete city.buildingOperations.kiln.lastResult.residents;
  assert.match(inspect([city]).content(), /Resident support was not recorded/);
});

await test('built yard is a departure capability and coastal founding retains exact endpoints and payment', () => {
  const source = { ...home, id: 'source-town', name: 'Old Shore', buildings: ['boat-yard'] };
  const destination = { ...home, id: 'new-town', name: 'New Shore', tileId: 26, population: 3, buildings: [], coastalFounding: { ruleVersion: 1 as const, sourceCityId: source.id, sourceTileId: 23, destinationTileId: 26, pathTileIds: [23, 6, 7, 8, 26], population: 3, paid: { food: 12, materials: 10 }, foundedRound: 37, eventId: '59:0' } };
  const built = inspect([source]);
  assert.match(built.content(), /Coastal departure/); assert.doesNotMatch(built.content(), /Ready for next season|Paid:|Made:/);
  const before = structuredClone(destination);
  const view = inspect([destination, source]);
  assert.match(view.content(), /3 residents arrived from Old Shore/);
  assert.match(view.content(), /Round 37/);
  assert.match(view.content(), /23 → 6 → 7 → 8 → 26/);
  assert.match(view.content(), /Recorded source tile: 23.*Recorded destination tile: 26/);
  assert.match(view.content(), /Paid once/);
  assert.match(view.content(), /Local work capacity: 0 residents/);
  assert.deepEqual(destination, before);
});

await test('unbound blocked map cue does not invent a resource shortage', () => {
  const event = { id: '9:0', round: 9, type: 'building-operation', title: 'Dawnwell: Kiln blocked', detail: 'city-0/kiln at strategic round 9', actor: 0, target: 0, tileId: home.tileId, cause: 'Recorded operation', effects: ['No inputs consumed or outputs produced'], importance: 2 };
  assert.equal(eventVisual(event)?.label, 'Building could not operate');
});

await test('current support uses the canonical projection only after the applied feature', () => {
  const state = createWorld(1701, epoch);
  assert.equal(residentSupportForWorld(state, state.cities), undefined);
  state.unlockedFeatures.push('resident-capacity');
  assert.deepEqual(residentSupportForWorld(state, state.cities), observedResidentCapacity(state.cities));
  assert.equal(residentSupportForWorld(null, state.cities), undefined);
});

await test('focused work selector exposes one exact-town card at a time and all other facts remain reachable', () => {
  const city = { ...home, buildings: ['farm', 'kiln'], buildingOperations: { kiln: { enabled: true, lastResult: structuredClone(result) } } };
  const view = inspect([city], true, rendered => {
    const picker = rendered.all().find(node => node.attributes.get('aria-label') === 'Inspect work or building'); assert.ok(picker);
    assert.equal(rendered.all().filter(node => node.className === 'building-card').length, 1);
    assert.ok(picker.children.some(node => node.value === 'kiln'));
    picker.value = 'kiln'; picker.listeners.get('change')?.();
    const preview = rendered.all().find(node => node.className === 'work-preview'); assert.ok(preview);
    assert.match(preview.content(), /Built · On now/);
    assert.match(preview.content(), /Made:.*None.*Used:.*None/);
    assert.match(preview.content(), /Could not operate in that season/);
  });
  assert.equal(view.all().filter(node => node.className === 'building-card').length, 1);
  assert.match(view.content(), /Available then: 0/);
  assert.match(view.content(), /Nothing was paid or made/);
});

await test('a legal ordinary Farm order enters Work with exact paid work facts and no invented district or completion', () => {
  const prefix = coastalDeparturePrefix();
  const option = legalActions(prefix.state, 0, prefix.timestamp).find(entry => entry.action.type === 'build' && entry.action.project === 'farm' && entry.action.cityId === prefix.departureCityId);
  assert.ok(option);
  const action = option.action;
  const started = applyCommand(prefix.state, { seat: 0, expectedRevision: prefix.state.revision, timestamp: prefix.timestamp, action });
  assert.ok(started.ok, started.error); assert.ok(isWorldState(started.state));
  const city = started.state.cities.find(entry => entry.id === prefix.departureCityId); assert.ok(city);
  const order = city.construction?.active; assert.ok(order && 'buildingId' in order && order.buildingId === 'farm');
  const before = structuredClone(city);
  const view = inspect([city]);
  const picker = view.all().find(node => node.attributes.get('aria-label') === 'Inspect work or building'); assert.ok(picker);
  assert.ok(picker.children.some(entry => /Terraced fields.*Under construction/.test(entry.textContent)));
  const preview = view.all().find(node => node.className === 'work-preview'); assert.ok(preview);
  assert.match(preview.content(), new RegExp(`${order.workDone} / ${order.workRequired} work`));
  assert.match(preview.content(), /Under construction/); assert.doesNotMatch(preview.content(), /Built|Made:/);
  assert.match(view.content(), /Paid once for this order/);
  for (const [resource, amount] of Object.entries(order.paid)) assert.match(view.content(), new RegExp(`${amount} ${resource[0]?.toUpperCase()}${resource.slice(1)}`));
  assert.doesNotMatch(view.content(), /Reserved site|Exact district site|At this town/);
  assert.deepEqual(city, before);
});
