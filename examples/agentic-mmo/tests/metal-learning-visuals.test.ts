import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import { projectWorld } from '../web/live-world.ts';
import { districtLabel, districtParts, DISTRICT_PART_BUDGETS } from '../visuals/district-visuals.ts';

await test('a Commercial hub retains its own exact site and active Market separately from Campus', () => {
  const state = createWorld(1701);
  const city = state.cities[0]; assert.ok(city);
  city.buildings = ['campus', 'library', 'commercial-hub'];
  city.districtSites = { campus: 39, 'commercial-hub': 56 };
  city.construction = { active: { id: 'market-fixture', cityId: city.id, buildingId: 'market', ruleVersion: 1, startedRound: 3, paid: { materials: 18, credits: 10 }, workDone: 2, workRequired: 10 }, lastCompleted: null };
  const before = structuredClone(state);
  const views = projectWorld(state).districts;
  assert.equal(views?.length, 2);
  const hub = views?.find(view => view.tileId === 56); assert.ok(hub);
  assert.equal(hub.cityId, city.id);
  assert.equal(hub.status, 'built');
  assert.match(districtLabel(hub), /Commercial hub.*Market building/);
  assert.equal(hub.baseProduction.credits, 2);
  assert.ok(hub.construction && 'buildingId' in hub.construction);
  assert.equal(hub.construction.buildingId, 'market');
  assert.deepEqual(state, before);
});

await test('University and Bank have distinct installed parts at their retained parent districts within every cap', () => {
  const state = createWorld(1701);
  const city = state.cities[0]; assert.ok(city);
  city.buildings = ['campus', 'library', 'university', 'commercial-hub', 'market', 'bank'];
  city.districtSites = { campus: 39, 'commercial-hub': 56 };
  const views = projectWorld(state).districts;
  const campus = views?.find(view => view.tileId === 39); const hub = views?.find(view => view.tileId === 56);
  assert.ok(campus && hub);
  assert.match(districtLabel(campus), /University/);
  assert.match(districtLabel(hub), /Market.*Bank/);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const learning = districtParts(campus, detail); const commerce = districtParts(hub, detail);
    assert.ok(learning.some(part => part.id.includes('university')));
    assert.ok(commerce.some(part => part.id.includes('market')));
    assert.ok(commerce.some(part => part.id.includes('bank')));
    for (const parts of [learning, commerce]) {
      assert.ok(parts.length <= DISTRICT_PART_BUDGETS[detail]);
      assert.equal(new Set(parts.map(part => part.id)).size, parts.length);
    }
  }
});

await test('a reserved Commercial hub is unfinished and never invented at the town center', () => {
  const state = createWorld(1701);
  const city = state.cities[0]; assert.ok(city);
  city.construction = { active: { id: 'hub-fixture', cityId: city.id, buildingId: 'commercial-hub', tileId: 56, ruleVersion: 1, startedRound: 3, paid: { materials: 20, credits: 10 }, workDone: 2, workRequired: 10 }, lastCompleted: null };
  const view = projectWorld(state).districts?.[0]; assert.ok(view);
  assert.equal(view.status, 'building'); assert.equal(view.tileId, 56);
  const parts = districtParts(view, 'close');
  assert.ok(parts.some(part => part.id.includes('foundation')));
  assert.ok(parts.every(part => !/market|bank|awning/.test(part.id)));
  assert.ok(city.construction.active);
  city.construction.active.tileId = 99999;
  assert.deepEqual(projectWorld(state).districts, []);
});

await test('the original commerce silhouette includes every installed core before decoration', () => {
  const view = { id: 'hub-fixture', cityId: 'frontier', townName: 'Far Hearth', civId: 1, tileId: 56, q: 1, r: 1, height: .4, color: '#dfac60', status: 'built' as const, library: 'absent' as const, construction: null, baseProduction: { credits: 2 }, buildingId: 'commercial-hub', name: 'Commercial hub', attachments: [{ buildingId: 'market', name: 'Market', status: 'built' as const }, { buildingId: 'bank', name: 'Bank', status: 'built' as const }] };
  for (const detail of ['far', 'mid', 'close'] as const) {
    const parts = districtParts(view, detail);
    assert.ok(parts.some(part => part.id.includes('market')));
    assert.ok(parts.some(part => part.id.includes('bank')));
    assert.ok(parts.every(part => !part.id.includes('hall-roof')));
    assert.ok(parts.length <= DISTRICT_PART_BUDGETS[detail]);
  }
});

await test('prepared deposits stay absent from the map until canonical discovery reveals them', () => {
  const state = createWorld(1701);
  state.unlockedFeatures.push('finite-metals');
  state.strategicDeposits = { ruleVersion: 1, placementId: 'iron-placement-1', seed: state.seed, tileIds: [56], deposits: { '56': { tileId: 56, resource: 'iron', initialReserve: 240, remaining: 238 } } };
  const city = state.cities[0]; const civilization = state.civilizations[0]; assert.ok(city && civilization);
  const before = structuredClone(state);
  assert.deepEqual(projectWorld(state).deposits, []);
  civilization.technologies.push('bronze-working');
  const deposits = projectWorld(state).deposits;
  assert.ok(deposits); assert.equal(deposits.length, 1);
  assert.ok(deposits[0]);
  assert.equal(deposits[0].tileId, 56); assert.equal(deposits[0].remaining, 238);
  assert.deepEqual(deposits[0].revealedTo, [{ id: civilization.id, name: civilization.name }]);
  civilization.technologies.pop(); assert.deepEqual(state, before);
});

await test('screen-space site marks preserve selected-town priority, town targets and a bounded 44px hit area', async () => {
  const { placeSiteMarks } = await import('../visuals/strategic-resource-visuals.ts');
  const anchors = Array.from({ length: 20 }, (_, index) => ({ id: `site-${index}`, cityId: index === 19 ? 'selected' : 'other', x: 90 + index * 9, y: 180 }));
  const blocked = [{ x: 90, y: 160, width: 80, height: 60 }];
  const placed = placeSiteMarks(anchors, blocked, 360, 507, 'selected');
  assert.equal(placed[0]?.id, 'site-19');
  assert.ok(placed.length <= 12);
  assert.ok(placed.length > 0);
  for (const mark of placed) {
    assert.equal(mark.width, 44); assert.equal(mark.height, 44);
    assert.ok(mark.x >= 22 && mark.x <= 338);
    assert.ok(mark.y >= 22 && mark.y <= 485);
    assert.ok(Math.abs(mark.x - (anchors.find(item => item.id === mark.id)?.x ?? 0)) <= 60);
    assert.ok(mark.x + 22 <= 50 || mark.x - 22 >= 130 || mark.y + 22 <= 160 || mark.y - 22 >= 220);
  }
  assert.deepEqual(placeSiteMarks(anchors, blocked, 360, 507, 'selected'), placed);
});

await test('recorded Mine output names ordinary materials and finite Iron separately', async () => {
  const { eventLogEntries } = await import('../web/event-log.ts');
  const event = { id: '85:2', round: 55, type: 'improvement-operation', title: 'Dawnwell: mine operated', detail: 'city-0/58/mine at strategic round 55', actor: 0, target: 0, tileId: 58, cause: 'opening allocation', effects: ['Produced 3.3 materials'], importance: 1,
    strategicExtraction: { ruleVersion: 1 as const, tileId: 58, round: 55, resource: 'iron' as const, quantity: 2, reserveBefore: 240, reserveAfter: 238, stockBefore: 0, stockAfter: 2, capacity: 80, status: 'extracted' as const } };
  const row = eventLogEntries([event], { civilizations: [{ id: 0, name: 'Aster', color: '#abcd12' }] })[0]; assert.ok(row);
  assert.equal(row.title, 'Dawnwell · Mine');
  assert.ok(row.deltas.some(delta => delta.label === 'Iron' && delta.value === 2));
  assert.ok(row.deltas.some(delta => delta.label === 'Materials' && delta.value === 3.3));
  assert.match(row.summary, /240 → 238/);
  assert.equal(row.routine, true);
});

await test('exhausted or full deposits retain geometry and never claim positive extraction', async () => {
  const { extractionFacts, depositParts } = await import('../visuals/strategic-resource-visuals.ts');
  const receipt = { ruleVersion: 1 as const, tileId: 58, round: 56, resource: 'iron' as const, quantity: 0, reserveBefore: 238, reserveAfter: 238, stockBefore: 80, stockAfter: 80, capacity: 80, status: 'storage-full' as const };
  assert.match(extractionFacts(receipt).join(' '), /Storage full.*238 → 238.*80 → 80/);
  assert.equal(extractionFacts({ ...receipt, status: 'unrevealed' }).some(fact => /238/.test(fact)), false);
  const deposit = { id: 'iron-58', tileId: 58, resource: 'iron' as const, initialReserve: 240, remaining: 0, q: 1, r: 2, height: .4, revealedTo: [] };
  for (const detail of ['far', 'mid', 'close'] as const) assert.ok(depositParts(deposit, detail).length >= 2 && depositParts(deposit, detail).length <= 4);
});

await test('the complete connected learning and commerce tree names exact parents and strategic stock', async () => {
  const { capabilityCatalogue, projectCapabilities } = await import('../core/capabilities.ts');
  const { capabilityTreeNodes } = await import('../web/capability-tree.ts');
  const state = createWorld(1701); const city = state.cities[0]; const civilization = state.civilizations[0]; assert.ok(city && civilization);
  state.unlockedFeatures.push('finite-metals', 'learning-commerce', 'district-planning');
  civilization.strategicResources = { iron: 2 }; civilization.technologies.push('bronze-working');
  city.buildings = ['campus', 'commercial-hub', 'market', 'university', 'bank']; city.districtSites = { campus: 39, 'commercial-hub': 40 };
  const nodes = capabilityTreeNodes({ runId: 'synthetic', civilizationName: civilization.name, towns: [{ id: city.id, name: city.name }], catalogue: capabilityCatalogue(), projection: projectCapabilities(state, civilization.id, city.id, '2026-10-16T00:00:00.000Z') });
  const university = nodes.find(node => node.id === 'building:university'); const bank = nodes.find(node => node.id === 'building:bank'); assert.ok(university && bank);
  assert.ok(university.requires.includes('building:campus'));
  assert.ok(bank.requires.includes('building:commercial-hub'));
  assert.match(JSON.stringify(bank.facts), /Commercial hub.*40/);
  assert.match(JSON.stringify(nodes.find(node => node.id === 'technology:bronze-working')?.facts), /2.*40/);
});
