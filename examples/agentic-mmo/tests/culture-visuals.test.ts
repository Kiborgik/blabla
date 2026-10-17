import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS } from '../core/content.ts';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import { districtAdjacencyFacts } from '../core/simulation/districts.ts';
import { projectWorld } from '../web/live-world.ts';
import { capabilityTreeNodes } from '../web/capability-tree.ts';
import { districtAdjacencySummary, districtMark, districtLabel, districtParts, DISTRICT_PART_BUDGETS } from '../visuals/district-visuals.ts';
import { SITE_MARK_PATHS } from '../visuals/strategic-resource-visuals.ts';
import { operationVisual } from '../visuals/operation-visuals.ts';
import { cultureProductionOperationJourney } from './fixtures/culture-production-journey.ts';
import type { WorldState } from '../core/types.ts';

const legal = cultureProductionOperationJourney();
const town = (state: WorldState) => { const value = state.cities.find(city => city.id === legal.journey.cityId); assert.ok(value); return value; };
const theater = (state: WorldState) => { const value = projectWorld(state).districts?.find(site => site.cityId === legal.journey.cityId && site.buildingId === 'theater-square'); assert.ok(value); return value; };
const tree = (state: WorldState) => capabilityTreeNodes({ runId: 'legal-local-culture', civilizationName: 'Aster', towns: [{ id: town(state).id, name: town(state).name }], catalogue: capabilityCatalogue(), projection: projectCapabilities(state, legal.journey.seat, legal.journey.cityId, legal.journey.time()) });

await test('exact Theater reservation and completion retain canonical completed-wonder adjacency without mutating state', () => {
  const definition = BUILDINGS.find(item => item.id === 'theater-square'); assert.ok(definition);
  for (const [state, status] of [[legal.theaterActive, 'building'], [legal.theaterCompleted, 'built']] as const) {
    const before = structuredClone(state); const site = theater(state); const canonical = districtAdjacencyFacts(state, definition, legal.journey.theaterTileId);
    assert.equal(site.status, status); assert.equal(site.tileId, 58); assert.equal(site.cityId, legal.journey.cityId);
    assert.deepEqual(site.adjacency, canonical); assert.equal(site.adjacency?.source, 'wonder'); assert.deepEqual(site.adjacency?.tileIds, [40]);
    assert.equal(site.baseProduction.culture, 4); assert.deepEqual(state, before);
    site.adjacency?.tileIds.push(999); assert.deepEqual(districtAdjacencyFacts(state, definition, 58)?.tileIds, [40]);
  }
});
await test('the original Theater court is distinct from Campus and only completion installs its stage', () => {
  const active = theater(legal.theaterActive); const built = theater(legal.theaterCompleted);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const parts = districtParts(built, detail); const foundation = districtParts(active, detail);
    assert.ok(parts.some(part => part.id.endsWith('theater-stage')));
    assert.ok(parts.some(part => part.id.endsWith('theater-seats-back')));
    assert.ok(parts.every(part => !/hall-roof|industrial-chimney|commerce-court|printing/.test(part.id)));
    assert.ok(foundation.some(part => part.id.includes('foundation'))); assert.ok(foundation.every(part => !/theater-stage|printing-roof/.test(part.id)));
    assert.ok(parts.length <= DISTRICT_PART_BUDGETS[detail]); assert.equal(new Set(parts.map(part => part.id)).size, parts.length);
  }
});
await test('the exact own-town Printing annex changes foundation to roof within every existing cap', () => {
  const active = theater(legal.printingActive); const built = theater(legal.printingCompleted);
  assert.match(districtLabel(active), /Theater square.*Printing house building/); assert.match(districtLabel(built), /Theater square.*Printing house/);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const underway = districtParts(active, detail); const completed = districtParts(built, detail);
    assert.ok(underway.some(part => part.id.endsWith('printing-foundation'))); assert.ok(underway.every(part => !part.id.endsWith('printing-roof')));
    assert.ok(completed.some(part => part.id.endsWith('printing-roof'))); assert.ok(completed.some(part => part.id.endsWith('theater-stage')));
    assert.ok(completed.length <= DISTRICT_PART_BUDGETS[detail]);
  }
  assert.ok(projectWorld(legal.printingCompleted).districts?.filter(site => site.buildingId !== 'theater-square').every(site => !site.attachments?.some(item => item.buildingId === 'printing-house')));
});
await test('canonical wonder-source wording names actual completed tiles and keeps site base separate from output', () => {
  const definition = BUILDINGS.find(item => item.id === 'theater-square'); assert.ok(definition);
  const facts = districtAdjacencyFacts(legal.theaterCompleted, definition, 58); assert.ok(facts);
  assert.match(districtAdjacencySummary(facts), /Completed nearby wonders: Tile 40/); assert.match(districtAdjacencySummary(facts), /2 Culture base/); assert.doesNotMatch(districtAdjacencySummary(facts), /Mine/);
  const nodes = tree(legal.printingCompleted); const site = nodes.find(node => node.id === 'building:theater-square'); assert.ok(site);
  assert.ok(site.facts.some(fact => fact.label === 'Completed nearby wonders' && /Tile 40/.test(fact.value)));
  assert.ok(site.facts.some(fact => /Site base with nearby wonders/.test(fact.label) && /4 Culture/.test(fact.value)));
  assert.ok(site.facts.every(fact => !/nearby terrain|Mine/.test(fact.label)));
  const printing = nodes.find(node => node.id === 'building:printing-house'); assert.ok(printing);
  assert.ok(printing.requires.includes('building:theater-square')); assert.ok(printing.requires.includes('technology:printing'));
  assert.ok(printing.facts.some(fact => fact.label === 'Belongs to' && /Theater square.*58/.test(fact.value)));
});
await test('culture has its own shared semantic site mark rather than a Campus fallback', () => {
  assert.equal(districtMark(theater(legal.theaterActive)), 'culture');
  assert.equal(districtMark(theater(legal.printingCompleted)), 'culture');
  assert.equal('culture' in SITE_MARK_PATHS, true);
  if ('culture' in SITE_MARK_PATHS) assert.notEqual(SITE_MARK_PATHS.culture, SITE_MARK_PATHS.campus);
});
await test('legal Printing completion and later work preserve actual inputs, residents and gross Culture', () => {
  const completed = operationVisual(town(legal.printingCompleted).buildingOperations?.['printing-house']); assert.equal(completed.last, null);
  const result = operationVisual(town(legal.operated).buildingOperations?.['printing-house']);
  assert.deepEqual(result.last?.paid, [{ resource: 'materials', label: 'Materials', amount: 1 }]);
  assert.deepEqual(result.last?.produced, [{ resource: 'culture', label: 'Culture', amount: 11.7 }]); assert.equal(result.last?.residents?.allocated, 3);
  legal.journey.act({ type: 'set-building-operation', cityId: legal.journey.cityId, buildingId: 'printing-house', enabled: false });
  const paused = operationVisual(town(legal.journey.state).buildingOperations?.['printing-house']); assert.equal(paused.current, 'Paused'); assert.deepEqual(paused.last, result.last);
});
