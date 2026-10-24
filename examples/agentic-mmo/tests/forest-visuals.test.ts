import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ECONOMY_RULES } from '../core/content.ts';
import { siteProduction } from '../core/simulation/sites.ts';
import type { Resources } from '../core/types.ts';
import { forestProductionOperationJourney } from './fixtures/forest-production-journey.ts';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import { projectWorld } from '../web/live-world.ts';
import { capabilityTreeNodes } from '../web/capability-tree.ts';
import { improvementParts, improvementLastLabel, IMPROVEMENT_PART_BUDGETS } from '../visuals/improvement-visuals.ts';

const legal = forestProductionOperationJourney();
function expectedLumberOutput(): number {
  const step = legal.journey.steps.find(candidate => candidate.result.state.revision === legal.operated.revision); assert.ok(step?.input.kind === 'strategy');
  const opening = step.before.cities.find(city => city.id === legal.cityId); assert.ok(opening);
  assert.deepEqual(opening.buildings.toSorted(), ['campus', 'library']); assert.deepEqual(Object.keys(opening.improvements ?? {}), [String(legal.tileId)]);
  assert.deepEqual(step.before.wonders, {}); assert.equal(step.before.unlockedFeatures.includes('civic-bootstrap'), false);
  const tile = step.before.tiles.find(candidate => candidate.id === opening.tileId); assert.ok(tile);
  const focus: Partial<Resources> = ECONOMY_RULES.focusProduction[opening.focus];
  const raw = ECONOMY_RULES.baseProduction.materials + (focus.materials ?? 0) + (siteProduction(step.before, tile).materials ?? 0);
  const productivity = (0.5 + opening.wellbeing / 100) * (1 - opening.damage / 100) * (1 + opening.infrastructure / 10);
  const rounded = (value: number): number => Math.round(value * 100) / 100;
  return rounded(rounded((raw + 4) * productivity) - rounded(raw * productivity));
}

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
  assert.deepEqual(operated.operation?.lastResult, legal.operated.cities.find(city => city.id === legal.cityId)?.improvements?.[String(legal.tileId)]?.operation.lastResult);
  assert.equal(operated.operation?.lastResult?.produced.materials, expectedLumberOutput()); assert.equal(operated.operation?.lastResult?.residents.allocated, 1);
  assert.equal(improvementLastLabel(operated.operation?.lastResult ?? null), 'Materials made');
});
await test('canonical forest branch exposes exact site, prerequisites and historical output in the existing connected tree', () => {
  const input = { runId: 'legal-forest', catalogue: capabilityCatalogue(), projection: projectCapabilities(legal.operated, 0, legal.cityId, legal.journey.time()), civilizationName: 'Aster', towns: legal.operated.cities.map(city => ({ id: city.id, name: city.name })) };
  const rows = capabilityTreeNodes(input); const mill = rows.find(row => row.id === 'improvement:lumber-mill'); assert.ok(mill);
  assert.ok(mill.facts.some(fact => fact.label === `Built site ${legal.tileId}`));
  assert.ok(mill.facts.some(fact => fact.value.includes(`${expectedLumberOutput()} Materials`) && /Assigned 1/.test(fact.value)));
  assert.ok(rows.some(row => row.id === 'technology:archery')); assert.ok(rows.some(row => row.id === 'technology:machinery'));
});
