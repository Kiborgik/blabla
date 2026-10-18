import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, TECHNOLOGIES, CONSTRUCTION_RULES, validateContent } from '../core/content.ts';
import { RELEASES } from '../core/release.ts';
import { createWorld } from '../core/engine.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import type { WorldState } from '../core/types.ts';

function syntheticTown(population = 12): WorldState {
  const state = createWorld(41); state.unlockedFeatures.push('building-operations', 'resident-capacity', 'local-power', 'powered-science', 'productive-research');
  const city = state.cities[0]; const actor = state.civilizations[0]; assert.ok(city && actor);
  city.population = population; city.buildings = ['coal-plant', 'factory', 'research-lab']; city.improvements = {};
  city.buildingOperations = Object.fromEntries(city.buildings.map(id => [id, { enabled: true, lastResult: null }]));
  state.cities = [city]; actor.strategicResources = { coal: 2 }; actor.resources.credits = 2;
  return state;
}

void test('powered Science registers exact research, local Campus recipe and additive release', () => {
  const sanitation = TECHNOLOGIES.find(item => item.id === 'sanitation'); const chemistry = TECHNOLOGIES.find(item => item.id === 'chemistry'); const lab = BUILDINGS.find(item => item.id === 'research-lab');
  assert.ok(sanitation, 'The accepted Sanitation branch is missing'); assert.ok(chemistry); assert.ok(lab);
  assert.equal(sanitation.cost, 140); assert.deepEqual(sanitation.requires, ['construction', 'education']);
  assert.equal(chemistry.cost, 260); assert.deepEqual(chemistry.requires, ['scientific-method', 'sanitation']);
  for (const item of [sanitation, chemistry, lab]) assert.ok(item.requiredFeatures.includes('powered-science'));
  assert.deepEqual(lab.cost, { materials: 42, credits: 24 }); assert.equal(Reflect.get(CONSTRUCTION_RULES.requiredWork, lab.id), 18);
  assert.deepEqual(lab.requires, ['chemistry']); assert.deepEqual(lab.requiresBuildings, ['campus']); assert.equal(lab.minEra, 3);
  assert.deepEqual(lab.operatingInputs, { credits: 2 }); assert.equal(lab.localPowerInput, 3); assert.deepEqual(lab.production, { science: 12 });
  const release = RELEASES.find(item => item.id === 'settlement-powered-science-1'); assert.ok(release);
  assert.deepEqual(release.compatibleFrom, ['settlement-second-government-1']); assert.ok(release.featureIds.includes('powered-science'));
  assert.deepEqual(validateContent(), []);
});

void test('synthetic existing allocation funds Factory before Laboratory and closes eight-six-two', () => {
  const state = syntheticTown(); resolveEconomy(state, []); const city = state.cities[0]; assert.ok(city);
  const lab = city.buildingOperations?.['research-lab']?.lastResult; assert.ok(lab?.localPower);
  assert.equal(lab.status, 'operated'); assert.deepEqual(lab.paid, { credits: 2 }); assert.equal(lab.localPower?.availableBefore, 5); assert.equal(lab.localPower.consumed, 3);
  assert.equal(lab.residents?.allocated, 3); assert.ok((lab.produced.science ?? 0) > 0);
  assert.equal(city.localPower?.lastBeat?.generated, 8); assert.equal(city.localPower?.lastBeat?.consumed, 6); assert.equal(city.localPower?.lastBeat?.expired, 2);
});

import { poweredScienceJourney } from './fixtures/powered-science-journey.ts';
void test('a genuine government continuation earns Laboratory Science and funds explicitly chosen Banking', context => {
  const path = poweredScienceJourney(); const city = path.productive.cities.find(item => item.id === path.cityId); const receipt = city?.localPower?.lastProductiveBeat; assert.ok(receipt);
  const lab = receipt.operations.find(item => item.buildingId === 'research-lab'); assert.ok(lab); assert.ok((lab.result.produced.science ?? 0) > 0);
  assert.deepEqual([receipt.generated, receipt.consumed, receipt.expired], [8, 6, 2]);
  assert.equal(path.labCompleted.cities.find(item => item.id === path.cityId)?.buildingOperations?.['research-lab']?.lastResult, null);
  assert.equal(path.researchSelected.civilizations[path.seat]?.researchTarget, 'banking'); assert.ok((path.researchInvested.civilizations[path.seat]?.researchProgress ?? 0) > 0);
  assert.deepEqual(path.pruned.cities.find(item => item.id === path.cityId)?.localPower?.lastProductiveBeat, receipt);
  const replacement = path.replacedByFactory.cities.find(item => item.id === path.cityId)?.localPower?.lastProductiveBeat;
  assert.ok(replacement && replacement.round > receipt.round); assert.deepEqual(replacement.operations.find(item => item.buildingId === 'research-lab')?.result.produced, {});
  context.diagnostic(JSON.stringify({ frames: path.steps.length, cityId: path.cityId, round: receipt.round, output: lab.result.produced, research: path.researchInvested.civilizations[path.seat]?.researchProgress, retainedEventId: receipt.eventId }));
});

void test('synthetic Laboratory shortages and pause consume no partial Credits Power or residents', () => {
  for (const kind of ['credits', 'residents', 'power', 'paused']) {
    const state = syntheticTown(kind === 'residents' ? 9 : 12); const city = state.cities[0]; const actor = state.civilizations[0]; assert.ok(city?.buildingOperations && actor);
    if (kind === 'credits') actor.resources.credits = 1;
    const plant = city.buildingOperations['coal-plant']; const lab = city.buildingOperations['research-lab']; assert.ok(plant && lab);
    if (kind === 'power') plant.enabled = false;
    if (kind === 'paused') lab.enabled = false;
    const credits = actor.resources.credits; allocateOperations(state); const result = city.buildingOperations['research-lab']?.lastResult; assert.ok(result);
    assert.equal(result.status, kind === 'paused' ? 'paused' : 'blocked'); assert.deepEqual(result.paid, {}); assert.deepEqual(result.produced, {}); assert.equal(result.localPower?.consumed, 0); assert.equal(result.residents?.allocated, 0); assert.equal(actor.resources.credits, credits);
  }
});

void test('synthetic later ordinary Credits cannot rescue the earlier failed Laboratory reservation', () => {
  const state = syntheticTown(); const actor = state.civilizations[0]; assert.ok(actor); actor.resources.credits = 0;
  resolveEconomy(state, []); assert.ok(actor.resources.credits > 0);
  const result = state.cities[0]?.buildingOperations?.['research-lab']?.lastResult; assert.equal(result?.status, 'blocked'); assert.deepEqual(result?.paid, {}); assert.deepEqual(result?.produced, {});
});

void test('synthetic fractional Laboratory output preserves cumulative Science rounding and fixed conversion', () => {
  const state = syntheticTown(); const city = state.cities[0]; assert.ok(city?.buildingOperations); city.wellbeing = 0.3; city.infrastructure = 0; city.damage = 0; city.focus = 'research';
  const control = structuredClone(state); const controlLab = control.cities[0]?.buildingOperations?.['research-lab']; assert.ok(controlLab); controlLab.enabled = false;
  const before = state.civilizations[0]?.resources.science ?? 0; resolveEconomy(state, []); resolveEconomy(control, []);
  const result = city.buildingOperations['research-lab']?.lastResult; assert.ok(result);
  const difference = Math.round(((state.civilizations[0]?.resources.science ?? 0) - (control.civilizations[0]?.resources.science ?? 0)) * 100) / 100;
  assert.equal(result.produced.science, difference); assert.ok((state.civilizations[0]?.resources.science ?? 0) > before); assert.equal(result.localPower?.consumed, 3);
  assert.equal(city.localPower?.lastBeat?.generated, 8); assert.equal(city.localPower?.lastBeat?.operations[0]?.result.emissionsProduced, 4);
});
