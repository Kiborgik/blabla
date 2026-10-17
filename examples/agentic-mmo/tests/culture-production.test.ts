import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, CONSTRUCTION_RULES, TECHNOLOGIES } from '../core/content.ts';
import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import { projectCapabilities } from '../core/capabilities.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { buildingBaseProduction, districtAdjacencyFacts, districtSiteBlock } from '../core/simulation/districts.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, replayCoastalStep } from './fixtures/coastal-prefix.ts';
import { cultureProductionJourney, cultureProductionOperationJourney, cultureProductionPrefix } from './fixtures/culture-production-journey.ts';
import { waterLandTown } from './fixtures/water-land-journey.ts';
import type { WorldState } from '../core/types.ts';

function stocks(state: WorldState) { const civilization = state.civilizations[0]; assert.ok(civilization); return civilization.resources; }

await test('culture actual legacy prefix has completed wonder and era two but refuses unreleased commitments', () => {
  const journey = cultureProductionPrefix(); const state = journey.state;
  assert.equal(state.releaseId, 'settlement-territory-1'); assert.equal(state.civilizations[0]?.era, 2);
  assert.equal(state.wonders?.['great-library']?.completion.tileId, journey.wonderTileId);
  assert.ok(state.calendarMilestones.includes('connected-world'));
  for (const action of [{ type: 'research', technology: 'construction' }, { type: 'research', technology: 'printing' }, { type: 'build', project: 'theater-square', cityId: journey.cityId, tileId: journey.theaterTileId }, { type: 'build', project: 'printing-house', cityId: journey.cityId }] as const) {
    const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: journey.time(), action });
    assert.equal(result.ok, false); assert.deepEqual(result.state, state); assert.deepEqual(result.events, []);
  }
});

await test('culture accepted data binds exact prerequisite costs work and useful paid output', () => {
  const construction = TECHNOLOGIES.find(item => item.id === 'construction'); assert.ok(construction, 'Construction must be implemented');
  assert.equal(construction.cost, 150); assert.deepEqual(construction.requires, ['engineering']);
  const printing = TECHNOLOGIES.find(item => item.id === 'printing'); assert.ok(printing);
  assert.equal(printing.cost, 330); assert.deepEqual(printing.requires.toSorted(), ['education', 'machinery']);
  const theater = BUILDINGS.find(item => item.id === 'theater-square'); assert.ok(theater?.district);
  assert.equal(theater.minEra, 1); assert.deepEqual(theater.cost, { materials: 20, credits: 10 }); assert.deepEqual(theater.production, { culture: 2 });
  const house = BUILDINGS.find(item => item.id === 'printing-house'); assert.ok(house);
  assert.equal(house.minEra, 2); assert.deepEqual(house.cost, { materials: 30, credits: 16 }); assert.deepEqual(house.requiresBuildings, ['theater-square']);
  assert.deepEqual(house.operatingInputs, { materials: 1 }); assert.deepEqual(house.production, { culture: 6 });
  const work: Readonly<Record<string, number>> = CONSTRUCTION_RULES.requiredWork;
  assert.equal(work['theater-square'], 10); assert.equal(work['printing-house'], 14);
});

await test('culture compatible adoption preserves prior assets and real research opens paid exact sites', () => {
  const { journey, beforeRelease, adopted } = cultureProductionJourney();
  assert.deepEqual(adopted.tiles, beforeRelease.tiles); assert.deepEqual(adopted.cities, beforeRelease.cities); assert.deepEqual(adopted.civilizations, beforeRelease.civilizations); assert.deepEqual(adopted.wonders, beforeRelease.wonders);
  journey.research('construction'); const before = structuredClone(journey.state);
  journey.act({ type: 'build', project: 'theater-square', cityId: journey.cityId, tileId: journey.theaterTileId });
  const order = waterLandTown(journey.state, journey.cityId).construction?.active; assert.ok(order && !('kind' in order));
  assert.equal(order.tileId, journey.theaterTileId); assert.deepEqual(order.paid, { materials: 20, credits: 10 }); assert.equal(order.workRequired, 10);
  assert.equal(stocks(before).materials - stocks(journey.state).materials, 20);
  assert.equal(stocks(before).credits - stocks(journey.state).credits, 10);
});

await test('culture only actual completed wonder contributes adjacency and later theater production', () => {
  const path = cultureProductionOperationJourney(); const { journey, theaterCompleted, theaterCompletionStep } = path;
  const definition = BUILDINGS.find(item => item.id === 'theater-square'); assert.ok(definition);
  const active = structuredClone(journey.wonderActive); active.unlockedFeatures = [...path.adopted.unlockedFeatures];
  assert.equal(districtAdjacencyFacts(active, definition, journey.theaterTileId)?.bonus, 0);
  const facts = districtAdjacencyFacts(theaterCompleted, definition, journey.theaterTileId); assert.ok(facts);
  assert.equal(facts.source, 'wonder'); assert.deepEqual(facts.tileIds, [journey.wonderTileId]); assert.equal(facts.bonus, 2);
  assert.deepEqual(buildingBaseProduction(theaterCompleted, waterLandTown(theaterCompleted, journey.cityId), definition), { culture: 4 });
  const withoutInstallation = structuredClone(theaterCompleted); const town = waterLandTown(withoutInstallation, journey.cityId);
  town.buildings = town.buildings.filter(id => id !== definition.id); delete town.districtSites?.[definition.id];
  const due = coastalPrefixTime(((theaterCompleted.independentTurns?.strategyTicks ?? 0) + 1) * 60);
  const actual = catchUpStrategy(theaterCompleted, due); const control = catchUpStrategy(withoutInstallation, due); assert.ok(actual.ok && control.ok);
  const expected = Math.round(4 * cityProductivity(waterLandTown(theaterCompleted, journey.cityId)) * 100) / 100;
  assert.ok(Math.abs(stocks(actual.state).culture - stocks(control.state).culture - expected) < 0.011);
  assert.ok(!waterLandTown(theaterCompletionStep.before, journey.cityId).buildings.includes(definition.id));
  const withoutCompletion = structuredClone(theaterCompletionStep.before); const lane = waterLandTown(withoutCompletion, journey.cityId).construction; assert.ok(lane); lane.active = null;
  const completionControl = replayCoastalStep(withoutCompletion, theaterCompletionStep.input); assert.ok(completionControl.ok);
  assert.equal(stocks(completionControl.state).culture, stocks(theaterCompleted).culture);
});

await test('culture same-town paid Printing house operates only after completion and legal pause releases residents', () => {
  const { journey, printingReady, printingActive, printingCompleted, operated } = cultureProductionOperationJourney();
  const order = waterLandTown(printingActive, journey.cityId).construction?.active; assert.ok(order && !('kind' in order));
  assert.deepEqual(order.paid, { materials: 30, credits: 16 }); assert.equal(order.workRequired, 14);
  assert.equal(waterLandTown(printingCompleted, journey.cityId).buildingOperations?.['printing-house']?.lastResult, null);
  const receipt = waterLandTown(operated, journey.cityId).buildingOperations?.['printing-house']?.lastResult; assert.ok(receipt);
  assert.equal(receipt.status, 'operated'); assert.deepEqual(receipt.paid, { materials: 1 }); assert.equal(receipt.residents?.allocated, 3); assert.equal(receipt.produced.culture, Math.round(6 * cityProductivity(waterLandTown(printingCompleted, journey.cityId)) * 100) / 100);
  const wrong = printingReady.cities.find(city => city.civId === 0 && city.id !== journey.cityId); assert.ok(wrong);
  const refused = applyCommand(printingReady, { seat: 0, expectedRevision: printingReady.revision, timestamp: coastalPrefixTime((printingReady.independentTurns?.strategyTicks ?? 0) * 60 + 50), action: { type: 'build', project: 'printing-house', cityId: wrong.id } });
  assert.equal(refused.ok, false); assert.deepEqual(refused.state, printingReady);
  const eraControl = structuredClone(printingReady); const civilization = eraControl.civilizations[0]; assert.ok(civilization); civilization.era = 1;
  const eraRefusal = applyCommand(eraControl, { seat: 0, expectedRevision: eraControl.revision, timestamp: coastalPrefixTime((eraControl.independentTurns?.strategyTicks ?? 0) * 60 + 50), action: { type: 'build', project: 'printing-house', cityId: journey.cityId } });
  assert.equal(eraRefusal.ok, false); assert.deepEqual(eraRefusal.state, eraControl);
  journey.act({ type: 'set-building-operation', cityId: journey.cityId, buildingId: 'printing-house', enabled: false }); journey.beat();
  const paused = waterLandTown(journey.state, journey.cityId).buildingOperations?.['printing-house']?.lastResult; assert.ok(paused);
  assert.equal(paused.status, 'paused'); assert.deepEqual(paused.paid, {}); assert.deepEqual(paused.produced, {}); assert.equal(paused.residents?.allocated, 0);
});

await test('culture exact occupied foreign and missing sites refuse with no payment or retargeting', () => {
  const { journey } = cultureProductionJourney(); journey.research('construction');
  for (const tileId of [journey.wonderTileId, waterLandTown(journey.state, journey.cityId).tileId, 48, -1]) {
    const before = structuredClone(journey.state); const result = applyCommand(journey.state, { seat: 0, expectedRevision: journey.state.revision, timestamp: journey.time(), action: { type: 'build', project: 'theater-square', cityId: journey.cityId, tileId } });
    assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(result.events, []);
  }
});

await test('culture purchased-site beneficiary and district cap remain canonical start conditions', () => {
  const { journey } = cultureProductionJourney(); journey.research('construction');
  journey.act({ type: 'acquire-tile', cityId: 'city-2-263', tileId: 181 }, 2);
  const definition = BUILDINGS.find(item => item.id === 'theater-square'); assert.ok(definition);
  assert.equal(districtSiteBlock(journey.state, waterLandTown(journey.state, 'city-2-263'), definition, 181), null);
  assert.match(districtSiteBlock(journey.state, waterLandTown(journey.state, 'city-2'), definition, 181) ?? '', /another|different|bound/i);
  const crowded = structuredClone(journey.state); waterLandTown(crowded, journey.cityId).population = 3;
  const refused = applyCommand(crowded, { seat: 0, expectedRevision: crowded.revision, timestamp: journey.time(), action: { type: 'build', project: definition.id, cityId: journey.cityId, tileId: journey.theaterTileId } });
  assert.equal(refused.ok, false); assert.deepEqual(refused.state, crowded);
});

await test('culture complete legal release research site and operation history replays exactly', () => {
  const { journey } = cultureProductionOperationJourney(); let replay = structuredClone(journey.initial);
  for (const step of journey.steps) { assert.deepEqual(replay, step.before); const result = replayCoastalStep(replay, step.input); assert.deepEqual(result, step.result); assert.ok(isWorldState(result.state)); replay = result.state; }
  assert.deepEqual(replay, journey.state);
});

await test('culture synthetic completed-wonder saturation caps adjacency without counting duplicate tiles', () => {
  const { journey } = cultureProductionOperationJourney(); const state = structuredClone(journey.state);
  const definition = BUILDINGS.find(item => item.id === 'theater-square'); assert.ok(definition);
  const original = state.wonders?.['great-library']; assert.ok(original && state.wonders);
  const site = state.tiles.find(tile => tile.id === journey.theaterTileId); assert.ok(site);
  const neighbors = state.tiles.filter(tile => hexDistance(site, tile) === 1).slice(0, 3); assert.equal(neighbors.length, 3);
  state.wonders = Object.fromEntries(neighbors.map((tile, index) => [`synthetic-${index}`, { ...structuredClone(original), completion: { ...original.completion, tileId: tile.id } }]));
  const duplicate = state.wonders['synthetic-0']; assert.ok(duplicate); state.wonders['synthetic-duplicate'] = structuredClone(duplicate);
  const before = structuredClone(state); const facts = districtAdjacencyFacts(state, definition, site.id); assert.ok(facts);
  assert.deepEqual(facts.tileIds, neighbors.map(tile => tile.id).toSorted((a, b) => a - b)); assert.equal(facts.bonus, 4);
  assert.deepEqual(buildingBaseProduction(state, waterLandTown(state, journey.cityId), definition), { culture: 6 }); assert.deepEqual(state, before);
});

await test('culture synthetic opening material or resident shortage pays and produces nothing while legal resume operates', () => {
  const { journey, operated } = cultureProductionOperationJourney();
  for (const shortage of ['materials', 'residents'] as const) {
    const state = structuredClone(operated);
    if (shortage === 'materials') stocks(state).materials = 0;
    else waterLandTown(state, journey.cityId).population = 3;
    const result = catchUpStrategy(state, coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60)); assert.ok(result.ok);
    const receipt = waterLandTown(result.state, journey.cityId).buildingOperations?.['printing-house']?.lastResult; assert.ok(receipt);
    assert.equal(receipt.status, 'blocked'); assert.deepEqual(receipt.paid, {}); assert.deepEqual(receipt.produced, {}); assert.equal(receipt.residents?.allocated, 0);
    if (shortage === 'materials') assert.ok(receipt.shortages.some(item => item.resource === 'materials'));
    else assert.equal(receipt.shortages.length, 0);
  }
  journey.act({ type: 'set-building-operation', cityId: journey.cityId, buildingId: 'printing-house', enabled: false }); journey.beat();
  journey.act({ type: 'set-building-operation', cityId: journey.cityId, buildingId: 'printing-house', enabled: true }); journey.beat();
  const resumed = waterLandTown(journey.state, journey.cityId).buildingOperations?.['printing-house']?.lastResult; assert.ok(resumed);
  assert.equal(resumed.status, 'operated'); assert.deepEqual(resumed.paid, { materials: 1 }); assert.equal(resumed.residents?.allocated, 3);
});

await test('culture projection exposes detached exact completed-wonder source and same-town operation facts', () => {
  const { journey, operated } = cultureProductionOperationJourney();
  const before = structuredClone(operated); const projection = projectCapabilities(operated, 0, journey.cityId, journey.time());
  const row = projection.buildings.find(item => item.nodeId === 'building:theater-square'); assert.ok(row?.district);
  assert.deepEqual(row.district.siteAdjacency?.tileIds, [journey.wonderTileId]); assert.equal(row.district.siteAdjacency?.source, 'wonder');
  assert.deepEqual(row.district.siteBaseProduction, { culture: 4 });
  row.district.siteAdjacency?.tileIds.push(-1); assert.deepEqual(operated, before);
});
