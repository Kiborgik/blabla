import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forestProductionOperationJourney } from './fixtures/forest-production-journey.ts';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import { projectWorld } from '../web/live-world.ts';
import { capabilityTreeNodes } from '../web/capability-tree.ts';
import { improvementParts, improvementLastLabel, IMPROVEMENT_PART_BUDGETS } from '../visuals/improvement-visuals.ts';

const legal = forestProductionOperationJourney();
await test('exact Lumber mill foundation and installed saw shelter remain distinct within every existing part cap', () => {
  const active = projectWorld(legal.started).improvements?.find(site => site.improvementId === 'lumber-mill');
  const built = projectWorld(legal.completed).improvements?.find(site => site.improvementId === 'lumber-mill'); assert.ok(active && built);
  assert.equal(active.tileId, legal.tileId); assert.equal(built.tileId, legal.tileId);
  const before = structuredClone([active, built]);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const foundation = improvementParts(active, detail); const completed = improvementParts(built, detail);
    assert.ok(foundation.some(part => part.id.includes('lumber-survey')));
    assert.ok(foundation.every(part => !part.id.includes('lumber-roof')));
    assert.ok(completed.some(part => part.id.includes('lumber-roof'))); assert.ok(completed.some(part => part.id.includes('lumber-saw')));
    assert.ok(completed.every(part => !part.id.includes('portal') && !part.id.includes('pasture')));
    assert.ok(foundation.length <= IMPROVEMENT_PART_BUDGETS[detail]); assert.ok(completed.length <= IMPROVEMENT_PART_BUDGETS[detail]);
  }
  assert.deepEqual([active, built], before);
});
await test('completed forest work keeps forest terrain and no operating receipt until the later actual season', () => {
  const complete = projectWorld(legal.completed).improvements?.find(site => site.improvementId === 'lumber-mill');
  const operated = projectWorld(legal.operated).improvements?.find(site => site.improvementId === 'lumber-mill'); assert.ok(complete && operated);
  assert.equal(complete.operation?.lastResult, null);
  assert.equal(legal.completed.tiles.find(tile => tile.id === legal.tileId)?.terrain, 'forest');
  assert.equal(operated.operation?.lastResult?.produced.materials, 7.8); assert.equal(operated.operation?.lastResult?.residents.allocated, 1);
  assert.equal(improvementLastLabel(operated.operation?.lastResult ?? null), 'Materials made');
});
await test('canonical forest branch exposes exact site, prerequisites and historical output in the existing connected tree', () => {
  const input = { runId: 'legal-forest', catalogue: capabilityCatalogue(), projection: projectCapabilities(legal.operated, 0, legal.cityId, legal.journey.time()), civilizationName: 'Aster', towns: legal.operated.cities.map(city => ({ id: city.id, name: city.name })) };
  const rows = capabilityTreeNodes(input); const mill = rows.find(row => row.id === 'improvement:lumber-mill'); assert.ok(mill);
  assert.ok(mill.facts.some(fact => fact.label === `Built site ${legal.tileId}`));
  assert.ok(mill.facts.some(fact => /7.8 Materials/.test(fact.value) && /Assigned 1/.test(fact.value)));
  assert.ok(rows.some(row => row.id === 'technology:archery')); assert.ok(rows.some(row => row.id === 'technology:machinery'));
});
