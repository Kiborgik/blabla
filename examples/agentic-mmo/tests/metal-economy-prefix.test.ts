import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, legalActions, observe } from '../core/engine.ts';
import { RESOURCE_IDS } from '../core/content.ts';
import { isWorldState } from '../core/validation.ts';
import type { CityImprovement } from '../core/types.ts';
import { replayCoastalStep } from './fixtures/coastal-prefix.ts';
import { metalEconomyPrefix } from './fixtures/metal-economy-prefix.ts';

await test('fresh metal rules retain two actually worked Mines and paid Writing history', context => {
  const prefix = metalEconomyPrefix(); const state = prefix.state;
  assert.equal(state.releaseId, 'settlement-metal-learning-1'); assert.equal(prefix.initial.releaseId, state.releaseId); assert.equal(prefix.initial.revision, 0);
  const civ = state.civilizations[0]; const city = state.cities.find(candidate => candidate.id === prefix.cityId); assert.ok(civ && city);
  for (const technology of ['agriculture', 'water-management', 'kiln-firing', 'writing', 'mining']) assert.ok(civ.technologies.includes(technology));
  assert.deepEqual(Object.keys(city.improvements ?? {}), ['56', '58']);
  for (const tileId of prefix.tileIds) {
    const mine: CityImprovement | undefined = city.improvements?.[String(tileId)]; assert.ok(mine);
    assert.equal(mine.operation.lastResult?.residents.allocated, 1);
    assert.ok((mine.operation.lastResult?.produced.materials ?? 0) > 0);
  }
  assert.ok(isWorldState(state));
  context.diagnostic(JSON.stringify({ basis: 'Fresh selected metal rules generate deposits; all research and worked Mine transitions are actual paid actions', revision: state.revision, round: state.round, transitions: prefix.steps.length, cityId: city.id, mines: city.improvements, resources: civ.resources }));
});

await test('every predecessor frame replays exactly from initial seed without mutating earlier input', () => {
  const prefix = metalEconomyPrefix(); let replay = structuredClone(prefix.initial);
  for (const step of prefix.steps) {
    assert.deepEqual(replay, step.before); const before = JSON.stringify(replay);
    const result = replayCoastalStep(replay, structuredClone(step.input));
    assert.deepEqual(result, step.result); assert.equal(JSON.stringify(replay), before); assert.ok(isWorldState(result.state)); replay = result.state;
  }
  assert.deepEqual(replay, prefix.state);
});

await test('worked hills retain original terrain and separate unrevealed finite deposits without invented stock', context => {
  const prefix = metalEconomyPrefix();
  const inventory = prefix.tileIds.map(tileId => {
    const tile = prefix.state.tiles.find(candidate => candidate.id === tileId); const initial = prefix.initial.tiles.find(candidate => candidate.id === tileId); assert.ok(tile && initial);
    assert.deepEqual(tile, initial); assert.equal(tile.owner, 0); assert.equal(tile.resource, null);
    return { tileId, elevation: tile.elevation, terrain: tile.terrain, owner: tile.owner, resource: tile.resource };
  });
  assert.equal(Object.hasOwn(prefix.state, 'deposits'), false);
  assert.deepEqual(prefix.state.civilizations[0]?.strategicResources, {});
  assert.ok(prefix.initial.strategicDeposits); assert.deepEqual(prefix.state.strategicDeposits, prefix.initial.strategicDeposits);
  assert.deepEqual(observe(prefix.state, 0, prefix.timestamp).revealedDeposits, []);
  assert.deepEqual(Object.keys(prefix.state.civilizations[0]?.resources ?? {}).toSorted(), [...RESOURCE_IDS].toSorted());
  context.diagnostic(JSON.stringify({ unchangedCandidateSites: inventory, placement: 'Selected fresh rules generate the separate finite layer; no Bronze reveal or extraction has occurred' }));
});

await test('fresh metal rules admit Bronze working and Currency while explicit fresh mining rules refuse atomically', () => {
  const current = metalEconomyPrefix(); const historical = metalEconomyPrefix('settlement-mining-1');
  for (const technology of ['bronze-working', 'currency']) {
    assert.ok(legalActions(current.state, 0, current.timestamp).some(option => option.action.type === 'research' && option.action.technology === technology));
    const currentBefore = structuredClone(current.state);
    const selected = applyCommand(current.state, { seat: 0, expectedRevision: current.state.revision, timestamp: current.timestamp, action: { type: 'research', technology } });
    assert.ok(selected.ok, selected.error); assert.equal(selected.state.civilizations[0]?.researchTarget, technology); assert.deepEqual(current.state, currentBefore);
    assert.equal(legalActions(historical.state, 0, historical.timestamp).some(option => option.action.type === 'research' && option.action.technology === technology), false);
    const before = structuredClone(historical.state);
    const refused = applyCommand(historical.state, { seat: 0, expectedRevision: historical.state.revision, timestamp: historical.timestamp, action: { type: 'research', technology } });
    assert.equal(refused.ok, false); assert.deepEqual(refused.events, []); assert.deepEqual(historical.state, before); assert.deepEqual(refused.state, before);
  }
});

await test('unlearned Currency blocks iron exchange while existing exact consensual trade remains available', context => {
  const prefix = metalEconomyPrefix(); const options = legalActions(prefix.state, 0, prefix.timestamp);
  const existing = options.find(option => option.action.type === 'propose-trade' && option.action.partner === 1 && option.action.recipeId === 'harvest-for-materials' && option.action.sourceCityId === prefix.cityId && option.action.recipientCityId === prefix.recipientCityId);
  assert.ok(existing?.tradeQuote);
  assert.equal(options.some(option => option.action.type === 'propose-trade' && option.action.recipeId === 'iron-for-food'), false);
  const before = JSON.stringify(prefix.state);
  const refused = applyCommand(prefix.state, { seat: 0, expectedRevision: prefix.state.revision, timestamp: prefix.timestamp, action: { type: 'propose-trade', partner: 1, recipeId: 'iron-for-food', sourceCityId: prefix.cityId, recipientCityId: prefix.recipientCityId } });
  assert.equal(refused.ok, false); assert.deepEqual(refused.events, []); assert.equal(JSON.stringify(refused.state), before);
  context.diagnostic(JSON.stringify({ existingExactAction: existing.action, existingQuote: existing.tradeQuote, futureIronShipment: 'Currency is not yet learned and no Iron has been extracted or offered' }));
});
