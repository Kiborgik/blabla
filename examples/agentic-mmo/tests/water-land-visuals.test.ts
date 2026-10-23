import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import { BUILDINGS } from '../core/content.ts';
import { observedPastoralSites } from '../core/simulation/pastoral.ts';
import { waterLandOperationJourney } from './fixtures/water-land-journey.ts';
import { projectWorld } from '../web/live-world.ts';
import { capabilityTreeNodes } from '../web/capability-tree.ts';
import { improvementLastLabel, improvementParts, IMPROVEMENT_PART_BUDGETS } from '../visuals/improvement-visuals.ts';
import { buildingAppearance } from '../visuals/building-visuals.ts';
import { settlementVisual, DETAIL_BUDGETS } from '../visuals/world-visuals.ts';

const legal = waterLandOperationJourney();
await test('a real staffed Pasture receipt names Food rather than Materials, preserving current and historical state', () => {
  const site = projectWorld(legal.pasture.operated).improvements?.find(item => item.improvementId === 'pasture'); assert.ok(site?.operation?.lastResult);
  assert.equal(site.operation.lastResult.produced.food, 3.3); assert.equal(site.operation.lastResult.residents.allocated, 1);
  assert.equal(improvementLastLabel(site.operation.lastResult), 'Food made');
  const retained = structuredClone(site.operation.lastResult); site.operation.enabled = false;
  assert.deepEqual(site.operation.lastResult, retained); assert.equal(improvementLastLabel(retained), 'Food made');
});
await test('legal Pasture construction and completed paddock keep distinct bounded original cores', () => {
  const active = projectWorld(legal.pasture.started).improvements?.find(item => item.improvementId === 'pasture');
  const built = projectWorld(legal.pasture.completed).improvements?.find(item => item.improvementId === 'pasture'); assert.ok(active && built);
  assert.equal(active.tileId, legal.pasture.tileId); assert.equal(built.operation?.lastResult, null);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const before = improvementParts(active, detail); const after = improvementParts(built, detail);
    assert.ok(before.some(part => part.id.includes('pasture-survey'))); assert.ok(before.every(part => !part.id.includes('pasture-shelter-roof')));
    assert.ok(after.some(part => part.id.includes('pasture-fence'))); assert.ok(after.some(part => part.id.includes('pasture-shelter-roof')));
    assert.ok(after.length <= IMPROVEMENT_PART_BUDGETS[detail]); assert.ok(before.length <= IMPROVEMENT_PART_BUDGETS[detail]);
  }
});
await test('Mill and Aqueduct installed cores share existing city budgets and never invent construction completion', () => {
  const city = legal.grown.cities.find(item => item.id === legal.journey.previous.mill.cityId); assert.ok(city);
  for (const detail of ['far', 'mid', 'close'] as const) {
    assert.ok(buildingAppearance('water-mill', detail)?.parts.some(part => part.id === 'water-mill-wheel'));
    assert.ok(buildingAppearance('aqueduct', detail)?.parts.some(part => part.id === 'aqueduct-channel'));
    const syntheticAllBuilt = { ...city, damage: 35, buildings: BUILDINGS.map(item => item.id) };
    const visual = settlementVisual(syntheticAllBuilt, detail);
    assert.ok(visual.parts.length <= DETAIL_BUDGETS[detail].parts);
    assert.ok(visual.parts.some(part => part.id === 'water-mill-wheel')); assert.ok(visual.parts.some(part => part.id === 'aqueduct-channel'));
  }
  const unfinished = legal.aqueductStarted.cities.find(item => item.id === legal.journey.previous.aqueduct.cityId); assert.ok(unfinished);
  assert.ok(settlementVisual(unfinished, 'close').parts.every(part => !part.id.startsWith('aqueduct-')));
});
await test('tree shows canonical mountain and own-Irrigation requirements without deriving site eligibility', () => {
  const state = legal.aqueductReady; const cityId = legal.journey.previous.mill.cityId;
  const input = { runId: 'legal-water-land', catalogue: capabilityCatalogue(), projection: projectCapabilities(state, 0, cityId, legal.journey.time()), civilizationName: 'Aster', towns: state.cities.map(city => ({ id: city.id, name: city.name })) };
  const rows = capabilityTreeNodes(input);
  const aqueduct = rows.find(row => row.id === 'building:aqueduct'); assert.ok(aqueduct);
  assert.ok(aqueduct.blockers.some(line => /adjacent mountain/.test(line)));
  const mill = rows.find(row => row.id === 'building:water-mill'); assert.ok(mill);
  assert.ok(mill.facts.some(fact => /Irrigation/.test(fact.value)));
});
await test('horse map reveal follows canonical selected civilization, is detached and creates no inventory', async () => {
  const { projectPastoralSites, visiblePastoralSites } = await import('../visuals/pastoral-visuals.ts');
  const state = legal.pasture.revealed; const before = structuredClone(state); const views = projectPastoralSites(state);
  assert.deepEqual(projectPastoralSites(legal.journey.initial), []);
  assert.deepEqual(visiblePastoralSites(views, legal.pasture.seat).map(site => site.tileId), observedPastoralSites(state, legal.pasture.seat).revealedPastoralSites?.map(site => site.tileId));
  assert.deepEqual(visiblePastoralSites(views, 0), []);
  assert.ok(views.every(site => !('stock' in site) && !('remaining' in site)));
  if (views[0]) views[0].revealedTo.push(999);
  assert.deepEqual(state, before);
});
await test('Aqueduct map source retains the exact mountain through active and completed states, without occupying it', async () => {
  const { projectCatchmentSites } = await import('../visuals/pastoral-visuals.ts');
  const active = projectCatchmentSites(legal.aqueductStarted); const completed = projectCatchmentSites(legal.aqueductCompleted);
  assert.equal(active.length, 1); assert.equal(active[0]?.tileId, 5); assert.equal(active[0]?.status, 'building');
  assert.equal(completed[0]?.tileId, 5); assert.equal(completed[0]?.status, 'built');
  assert.equal(completed[0]?.cityId, legal.journey.previous.aqueduct.cityId);
  assert.ok(!legal.aqueductCompleted.cities.some(city => Object.values(city.districtSites ?? {}).includes(5)));
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

await test('focused Work keeps Pasture actual food, Water mill base and Aqueduct current housing/source distinct', async () => {
  const { renderSettlementInspection } = await import('../web/settlement-inspection.ts');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'); const previousElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementRecord });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag: string) => new ElementRecord(tag), createElementNS: (_namespace: string, tag: string) => new ElementRecord(tag), createTextNode: (value: string) => { const node = new ElementRecord('text'); node.textContent = value; return node; } } });
  try {
    const pasture = new ElementRecord('div'); assert.ok(pasture instanceof HTMLElement);
    renderSettlementInspection(pasture, legal.pasture.operated.cities, legal.pasture.cityId, () => {}, undefined, String(legal.pasture.tileId));
    assert.match(pasture.content(), /Food made/); assert.match(pasture.content(), /Made:\s+3.3 Food/); assert.match(pasture.content(), /Assigned:\s+1/);
    const mill = new ElementRecord('div'); assert.ok(mill instanceof HTMLElement);
    renderSettlementInspection(mill, legal.millCompleted.cities, legal.journey.previous.mill.cityId, () => {}, undefined, 'water-mill');
    assert.match(mill.content(), /Base each season/); assert.match(mill.content(), /1 Food/); assert.match(mill.content(), /2 Materials/); assert.match(mill.content(), /Own-town Irrigation/); assert.doesNotMatch(mill.content(), /Made 1 Food/);
    const aqueduct = new ElementRecord('div'); assert.ok(aqueduct instanceof HTMLElement);
    renderSettlementInspection(aqueduct, legal.aqueductCompleted.cities, legal.journey.previous.aqueduct.cityId, () => {}, undefined, 'aqueduct');
    assert.match(aqueduct.content(), /6 housing/); assert.match(aqueduct.content(), /Mountain source · Tile 5/); assert.doesNotMatch(aqueduct.content(), /Made/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
    if (previousElement) Object.defineProperty(globalThis, 'HTMLElement', previousElement); else Reflect.deleteProperty(globalThis, 'HTMLElement');
  }
});
await test('completed Aqueduct source and later food-funded growth retain separate canonical records', () => {
  const cityId = legal.journey.previous.aqueduct.cityId;
  const complete = projectCapabilities(legal.aqueductCompleted, 0, cityId, legal.journey.time());
  const grown = projectCapabilities(legal.grown, 0, cityId, legal.journey.time());
  assert.equal(complete.buildings.find(row => row.nodeId === 'building:aqueduct')?.catchment?.retainedTileId, 5);
  assert.ok(complete.growth?.sources.some(source => source.buildingId === 'aqueduct' && source.capacity === 6));
  assert.equal((grown.growth?.population ?? 0) - (complete.growth?.population ?? 0), 1);
  const event = legal.grown.events.findLast(candidate => candidate.populationGrowth?.cityId === cityId);
  assert.equal(complete.growth?.population, 8); assert.equal(complete.growth?.nextGrowthFoodCost, 8);
  assert.equal(event?.populationGrowth?.foodPaid, 8); assert.equal(event?.populationGrowth?.round, legal.grown.round);
});
