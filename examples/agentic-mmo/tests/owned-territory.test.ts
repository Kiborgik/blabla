import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, applyRelease, legalActions, observe } from '../core/engine.ts';
import { BUILDINGS, IMPROVEMENTS, WONDERS } from '../core/content.ts';
import { isGameAction } from '../core/planning.ts';
import { districtSiteBlock } from '../core/simulation/districts.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { improvementSiteBlock } from '../core/simulation/improvements.ts';
import { wonderSiteBlock } from '../core/simulation/wonders.ts';
import { projectCapabilities } from '../core/capabilities.ts';
import { createTerritoryPlanner } from '../core/simulation/territory.ts';
import { decisionObligations } from '../core/simulation/decisions.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, replayCoastalStep } from './fixtures/coastal-prefix.ts';
import { ownedTerritoryPrefix } from './fixtures/owned-territory-prefix.ts';
import { acquireTileAction, acquisitionReceipts, ownedTerritoryJourney, ownedTerritoryPastureJourney, ownedTerritoryForestJourney } from './fixtures/owned-territory-journey.ts';
import { waterLandTown } from './fixtures/water-land-journey.ts';

await test('territory legal old prefix reveals actual retained horse but owns only the founded center', () => {
  const value = ownedTerritoryPrefix(); assert.ok(isWorldState(value.state));
  assert.equal(value.state.tiles[199]?.owner, 2); assert.equal(value.state.tiles[181]?.owner, null); assert.equal(value.state.tiles[164]?.owner, null);
  assert.ok(waterLandTown(value.state, value.cityId).population > 3); assert.ok(value.state.civilizations[2]?.technologies.includes('animal-husbandry'));
  assert.equal(acquisitionReceipts(value.state), undefined);
  assert.ok(!legalActions(value.state, 2, value.timestamp).some(option => option.action.type === 'acquire-tile'));
  const action = acquireTileAction(value.cityId, 181);
  const refused = applyCommand(value.state, { seat: 2, expectedRevision: value.state.revision, timestamp: value.timestamp, action });
  assert.equal(refused.ok, false); assert.deepEqual(refused.state, value.state); assert.deepEqual(refused.events, []);
});

await test('territory exact action grammar rejects caller quote payment path and beneficiary overrides', () => {
  const action = { type: 'acquire-tile', cityId: 'city-2-263', tileId: 181 };
  assert.ok(isGameAction(action));
  for (const changed of [{ ...action, paid: { credits: 0 } }, { ...action, pathTileIds: [199, 181] }, { ...action, civId: 0 }, { ...action, tileId: 1.5 }, { ...action, cityId: '' }]) assert.equal(isGameAction(changed), false);
});

await test('territory actual compatible adoption initializes receipts without assigning land or altering old assets', () => {
  const value = ownedTerritoryJourney(); assert.deepEqual(acquisitionReceipts(value.adopted), {});
  assert.deepEqual(value.adopted.tiles, value.beforeRelease.tiles); assert.deepEqual(value.adopted.cities, value.beforeRelease.cities);
  assert.deepEqual(value.adopted.civilizations, value.beforeRelease.civilizations); assert.deepEqual(value.adopted.routes, value.beforeRelease.routes);
  assert.deepEqual(value.adopted.pastoralSites, value.beforeRelease.pastoralSites); assert.deepEqual(value.adopted.strategicDeposits, value.beforeRelease.strategicDeposits); assert.equal(value.adopted.rng, value.beforeRelease.rng);
  assert.equal(value.adopted.clockTicks, value.beforeRelease.clockTicks); assert.equal(value.adopted.year, value.beforeRelease.year);
});

await test('territory real two-purchase path pays12 then18 once and preserves exact beneficiary receipts', () => {
  const value = ownedTerritoryPastureJourney(); const first = acquisitionReceipts(value.firstPurchased)?.['181']; const second = acquisitionReceipts(value.purchased)?.['164']; assert.ok(first && second);
  assert.deepEqual(first.pathTileIds, [199, 181]); assert.deepEqual(second.pathTileIds, [199, 181, 164]);
  assert.deepEqual(first.paid, { credits: 12 }); assert.deepEqual(second.paid, { credits: 18 }); assert.equal(first.priorCivilizationPurchases, 0); assert.equal(second.priorCivilizationPurchases, 1);
  assert.equal(first.distance, 1); assert.equal(second.distance, 2); assert.equal(first.cityTileId, 199); assert.equal(second.cityId, value.cityId); assert.equal(second.civId, 2);
  assert.equal(first.id, `territory-${value.firstPurchased.revision}`); assert.equal(second.id, `territory-${value.purchased.revision}`);
  const before = value.journey.adopted.civilizations[2]; const after = value.purchased.civilizations[2]; assert.ok(before && after);
  assert.deepEqual(after.resources, { ...before.resources, credits: Math.round((before.resources.credits - 30) * 100) / 100 });
  assert.deepEqual(value.purchased.cities, value.journey.adopted.cities); assert.equal(value.purchased.tiles[181]?.owner, 2); assert.equal(value.purchased.tiles[164]?.owner, 2);
  assert.deepEqual(value.purchased.pastoralSites, value.journey.adopted.pastoralSites); assert.equal(value.purchased.rng, value.journey.adopted.rng);
  const event = value.purchased.events.find(candidate => candidate.id === second.eventId); assert.ok(event); assert.equal(event.type, 'territory-acquired'); assert.equal(event.actor, 2); assert.equal(event.tileId, 164);
  assert.deepEqual(event.territoryAcquisition, second);
});

await test('territory actual acquired horse site completes paid Pasture then staffs positive later food', context => {
  const value = ownedTerritoryPastureJourney(); const installed = waterLandTown(value.completed, value.cityId).improvements?.['164']; assert.ok(installed);
  assert.deepEqual(installed.completion.paid, { materials: 6, credits: 3 }); assert.equal(installed.operation.lastResult, null);
  const operation = waterLandTown(value.operated, value.cityId).improvements?.['164']?.operation.lastResult; assert.ok(operation);
  assert.equal(operation.status, 'operated'); assert.equal(operation.residents.allocated, 1); assert.ok((operation.produced.food ?? 0) > 0); assert.equal(operation.extraction, undefined);
  const control = structuredClone(value.completionStep.before); const town = waterLandTown(control, value.cityId); assert.ok(town.construction); town.construction.active = null;
  const noCompletion = replayCoastalStep(control, value.completionStep.input); assert.ok(noCompletion.ok);
  assert.deepEqual(noCompletion.state.civilizations[2]?.resources, value.completed.civilizations[2]?.resources);
  context.diagnostic(JSON.stringify({ transitions: value.journey.steps.length, cityId: value.cityId, operation, syntheticNoCompletionControl: true }));
});

await test('territory exact missing foreign owned disconnected and out-of-radius requests refuse without effects', () => {
  const value = ownedTerritoryJourney(); const state = value.state;
  assert.ok(legalActions(state, 2, value.time()).some(option => JSON.stringify(option.action) === JSON.stringify(acquireTileAction(value.previous.cityId, 181))));
  for (const [cityId, tileId] of [['missing', 181], ['city-1', 181], [value.previous.cityId, 199], [value.previous.cityId, 164], [value.previous.cityId, 48], [value.previous.cityId, 431], [value.previous.cityId, 9999]] as const) {
    const result = applyCommand(state, { seat: 2, expectedRevision: state.revision, timestamp: value.time(), action: acquireTileAction(cityId, tileId) });
    assert.equal(result.ok, false, `${cityId}/${tileId}`); assert.deepEqual(result.state, state); assert.deepEqual(result.events, []);
  }
  const poor = structuredClone(state); const civilization = poor.civilizations[2]; assert.ok(civilization); civilization.resources.credits = 11;
  const result = applyCommand(poor, { seat: 2, expectedRevision: poor.revision, timestamp: value.time(), action: acquireTileAction(value.previous.cityId, 181) });
  assert.equal(result.ok, false); assert.deepEqual(result.state, poor); assert.deepEqual(result.events, []);
});

await test('territory purchased beneficiary excludes another nearby own town while legacy owned sites remain usable', () => {
  const value = ownedTerritoryPastureJourney(); const state = value.purchased; const beneficiary = waterLandTown(state, value.cityId); const other = waterLandTown(state, 'city-2');
  const campus = BUILDINGS.find(definition => definition.id === 'campus'); const pasture = IMPROVEMENTS.find(definition => definition.id === 'pasture'); const wonder = WONDERS.find(definition => definition.id === 'great-library'); assert.ok(campus && pasture && wonder);
  assert.equal(districtSiteBlock(state, beneficiary, campus, 181), null); assert.notEqual(districtSiteBlock(state, other, campus, 181), null);
  assert.equal(wonderSiteBlock(state, beneficiary, wonder, 181), null); assert.notEqual(wonderSiteBlock(state, other, wonder, 181), null);
  assert.equal(improvementSiteBlock(state, beneficiary, pasture, 164), null); assert.notEqual(improvementSiteBlock(state, other, pasture, 164), null);
  const center = state.tiles[other.tileId]; assert.ok(center);
  const legacy = state.tiles.find(tile => tile.owner === 2 && !acquisitionReceipts(state)?.[String(tile.id)] && hexDistance(center, tile) <= 3 && districtSiteBlock(state, other, campus, tile.id) === null); assert.ok(legacy);
  assert.equal(districtSiteBlock(state, other, campus, legacy.id), null);
  const reused = applyCommand(state, { seat: 2, expectedRevision: state.revision, timestamp: coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 50), action: acquireTileAction('city-2', 181) });
  assert.equal(reused.ok, false); assert.deepEqual(reused.state, state);
});

await test('territory stale command and repeat acquisition cannot pay twice or rebind town', () => {
  const value = ownedTerritoryPastureJourney(); const state = value.purchased;
  for (const expectedRevision of [state.revision - 1, state.revision]) {
    const result = applyCommand(state, { seat: 2, expectedRevision, timestamp: coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 50), action: acquireTileAction(value.cityId, 164) });
    assert.equal(result.ok, false); assert.deepEqual(result.state, state); assert.deepEqual(result.events, []);
  }
});

await test('territory new appended-row town purchases actual forest and later staffs its own Lumber mill', context => {
  const value = ownedTerritoryForestJourney(); const city = waterLandTown(value.operated, value.cityId); const receipt = acquisitionReceipts(value.purchased)?.['237']; assert.ok(receipt);
  assert.equal(city.tileId, 218); assert.equal(receipt.cityId, city.id); assert.deepEqual(receipt.pathTileIds, [218, 219, 237]);
  assert.equal(value.purchased.tiles[237]?.terrain, 'forest'); assert.equal(value.purchased.tiles[237]?.owner, 2);
  const result = city.improvements?.['237']?.operation.lastResult; assert.ok(result); assert.equal(result.status, 'operated'); assert.equal(result.residents.allocated, 1); assert.ok((result.produced.materials ?? 0) > 0);
  assert.equal(city.improvements?.['237']?.improvementId, 'lumber-mill'); assert.equal(result.extraction, undefined);
  assert.deepEqual(value.operated.pastoralSites, value.journey.adopted.pastoralSites); assert.deepEqual(value.operated.strategicDeposits?.tileIds, value.journey.adopted.strategicDeposits?.tileIds);
  context.diagnostic(JSON.stringify({ transitions: value.journey.steps.length, cityId: city.id, population: city.population, result }));
});

await test('territory complete genuine acquisition-to-work journey replays every immutable canonical frame', () => {
  const value = ownedTerritoryForestJourney(); let state = structuredClone(value.journey.initial);
  for (const step of value.journey.steps) { assert.deepEqual(state, step.before); const before = structuredClone(state); const result = replayCoastalStep(state, step.input); assert.deepEqual(state, before); assert.deepEqual(result, step.result); assert.ok(isWorldState(result.state)); state = result.state; }
  assert.deepEqual(state, value.operated);
});

await test('territory bounded shared tree returns detached exact quotes and separate structural projection', () => {
  const value = ownedTerritoryJourney(); const state = value.state; const before = structuredClone(state); const city = waterLandTown(state, value.previous.cityId);
  const planner = createTerritoryPlanner(state); assert.ok(planner.nearby(city).length <= 37);
  for (let repeat = 0; repeat < 3; repeat++) for (const tile of planner.nearby(city)) planner.assess(2, city.id, tile.id);
  assert.equal(planner.work.trees, 1); assert.ok(planner.work.visitedTiles <= 37);
  const quote = planner.assess(2, city.id, 181).quote; assert.ok(quote); quote.pathTileIds[0] = 999;
  assert.deepEqual(planner.assess(2, city.id, 181).quote?.pathTileIds, [199, 181]);
  const options = legalActions(state, 2, value.time()); const option = options.find(candidate => candidate.action.type === 'acquire-tile' && candidate.action.cityId === city.id && candidate.action.tileId === 181); assert.ok(option?.territoryQuote);
  option.territoryQuote.pathTileIds.push(999); assert.deepEqual(state, before);
  const overdue = coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60);
  const projection = projectCapabilities(state, 2, city.id, overdue); assert.ok(projection.admission.reason); assert.equal(projection.choiceReferenceState, 'not-provided'); assert.deepEqual(projection.legalActions, []);
  const projected = projection.territory?.cities[0]?.available.find(candidate => candidate.tileId === 181); assert.ok(projected); assert.deepEqual(projected.pathTileIds, [199, 181]); projected.paid.credits = 0;
  assert.deepEqual(state, before); assert.equal(observe(state, 2, value.time()).territory?.cities.find(candidate => candidate.cityId === city.id)?.available.find(candidate => candidate.tileId === 181)?.paid.credits, 12);
});

await test('territory paid purchase coexists with active construction without satisfying or replacing obligations', () => {
  const value = ownedTerritoryJourney(); value.act({ type: 'build', project: 'farm', cityId: value.previous.cityId });
  const before = structuredClone(value.state); const decisions = decisionObligations(before, 2); value.act(acquireTileAction(value.previous.cityId, 181));
  assert.deepEqual(value.state.cities, before.cities); assert.deepEqual(decisionObligations(value.state, 2).research, decisions.research);
  assert.deepEqual(waterLandTown(value.state, value.previous.cityId).construction, waterLandTown(before, value.previous.cityId).construction);
});

await test('territory explicit two-item plan retains reasons and never automatically purchases its successor', () => {
  const value = ownedTerritoryJourney(); const first = acquireTileAction(value.previous.cityId, 181); const second = acquireTileAction(value.previous.cityId, 164);
  const result = applyCommand(value.state, { seat: 2, expectedRevision: value.state.revision, timestamp: value.time(), action: first, plan: [{ action: first, reason: 'Connect this town to its retained horse site' }, { action: second, reason: 'Review the exact pasture site after the approach is owned' }] });
  assert.ok(result.ok, result.error); assert.equal(result.state.tiles[164]?.owner, null); assert.equal(acquisitionReceipts(result.state)?.['164'], undefined);
  const view = observe(result.state, 2, coastalPrefixTime((result.state.independentTurns?.strategyTicks ?? 0) * 60 + 50));
  assert.equal(view.actionPlan?.items[0]?.status, 'completed'); assert.equal(view.actionPlan?.items[1]?.status, 'ready'); assert.equal(view.actionPlan?.items[1]?.reason, 'Review the exact pasture site after the approach is owned');
});

await test('territory actual ownership deliberately opens the existing founding frontier without founding automatically', () => {
  const value = ownedTerritoryJourney(); assert.ok(!legalActions(value.state, 2, value.time()).some(option => option.action.type === 'settle' && option.action.tileId === 76));
  const before = structuredClone(value.state); value.act(acquireTileAction('city-2', 112));
  assert.deepEqual(value.state.cities, before.cities); assert.equal(value.state.tiles[76]?.owner, null);
  assert.ok(legalActions(value.state, 2, value.time()).some(option => option.action.type === 'settle' && option.action.tileId === 76 && option.action.sourceCityId === 'city-2'));
});

await test('territory adoption requires caught-up strategy and retained purchases still count after synthetic town removal', () => {
  const value = ownedTerritoryPastureJourney(); const old = value.journey.beforeRelease;
  const result = applyRelease(old, { expectedRevision: old.revision, expectedFromReleaseId: old.releaseId, targetReleaseId: 'settlement-territory-1', timestamp: coastalPrefixTime(((old.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  assert.equal(result.ok, false); assert.deepEqual(result.state, old); assert.deepEqual(result.events, []);
  const removed = structuredClone(value.purchased); removed.cities = removed.cities.filter(city => city.id !== value.cityId);
  const quote = createTerritoryPlanner(removed).assess(2, 'city-2', 112).quote; assert.ok(quote); assert.equal(quote.priorCivilizationPurchases, 2); assert.deepEqual(quote.paid, { credits: 20 });
  assert.deepEqual(acquisitionReceipts(removed), acquisitionReceipts(value.purchased));
});

await test('territory synthetic terrain or occupied-site corruption blocks an otherwise exact positive purchase', () => {
  const value = ownedTerritoryJourney();
  for (const damage of ['ocean', 'mountain', 'occupied'] as const) {
    const state = structuredClone(value.state); const tile = state.tiles[181]; assert.ok(tile);
    if (damage === 'occupied') { const city = waterLandTown(state, 'city-0'); city.districtSites ??= {}; city.districtSites.campus = 181; }
    else tile.terrain = damage;
    const before = structuredClone(state); const result = applyCommand(state, { seat: 2, expectedRevision: state.revision, timestamp: value.time(), action: acquireTileAction(value.previous.cityId, 181) });
    assert.equal(result.ok, false, damage); assert.deepEqual(result.state, before); assert.deepEqual(result.events, []);
  }
});

await test('territory another town purchased site cannot become a connection anchor', () => {
  const value = ownedTerritoryPastureJourney(); const state = value.purchased;
  assert.equal(createTerritoryPlanner(state).assess(2, 'city-2', 163).quote, null);
  const legacyControl = structuredClone(state); assert.ok(legacyControl.tileAcquisitions); delete legacyControl.tileAcquisitions['164'];
  const quote = createTerritoryPlanner(legacyControl).assess(2, 'city-2', 163).quote; assert.ok(quote); assert.ok(quote.pathTileIds.includes(164));
  assert.deepEqual(state, value.purchased);
});
