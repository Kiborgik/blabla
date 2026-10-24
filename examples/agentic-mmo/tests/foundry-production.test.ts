import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, CONSTRUCTION_RULES, TECHNOLOGIES } from '../core/content.ts';
import { applyCommand, createWorld, observe } from '../core/engine.ts';
import { foundryProductionOperationJourney } from './fixtures/foundry-production-journey.ts';
import { waterLandTown } from './fixtures/water-land-journey.ts';
import { coastalPrefixTime, replayCoastalStep } from './fixtures/coastal-prefix.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { extractCityMetals } from '../core/simulation/metals.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import { isWorldState } from '../core/validation.ts';
import type { WorldState } from '../core/types.ts';

function resources(state: WorldState, seat: number) { const actor = state.civilizations.find(item => item.id === seat); assert.ok(actor); return actor.resources; }
function iron(state: WorldState, seat: number): number { return state.civilizations.find(item => item.id === seat)?.strategicResources?.iron ?? 0; }

await test('fresh culture rules refuse unavailable Foundry discovery and construction without effects', () => {
  const state = createWorld(1701, coastalPrefixTime(0), 'settlement-culture-production-1');
  for (const action of [{ type: 'research', technology: 'military-engineering' }, { type: 'build', project: 'foundry', cityId: 'city-0' }] as const) {
    const before = structuredClone(state); const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: coastalPrefixTime(20), action });
    assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(state, before); assert.deepEqual(result.events, []);
  }
});

await test('foundry accepted connected cards retain every prerequisite and productive payment', () => {
  const expected: Array<[string, number, string[]]> = [['military-engineering', 240, ['construction', 'iron-working']], ['gunpowder', 390, ['military-engineering', 'apprenticeship']], ['metal-casting', 450, ['gunpowder', 'machinery']]];
  for (const [id, cost, prerequisites] of expected) {
    const technology = TECHNOLOGIES.find(item => item.id === id); assert.ok(technology, `Actual ${id} discovery must exist`);
    assert.equal(technology.cost, cost); assert.deepEqual(technology.requires.toSorted(), prerequisites.toSorted());
  }
  const definition = BUILDINGS.find(item => item.id === 'foundry'); assert.ok(definition, 'Foundry must have implemented paid production');
  assert.equal(definition.minEra, 2); assert.deepEqual(definition.requires, ['metal-casting']); assert.deepEqual(definition.requiresBuildings, ['industrial-zone']);
  assert.deepEqual(definition.cost, { materials: 32, credits: 16 }); assert.deepEqual(definition.operatingInputs, { energy: 2 }); assert.deepEqual(definition.strategicInputs, { iron: 1 }); assert.deepEqual(definition.production, { materials: 8 });
  const work: Readonly<Record<string, number>> = CONSTRUCTION_RULES.requiredWork; assert.equal(work.foundry, 14);
});

await test('foundry actual prerequisites lead to one exact paid order and no completion-beat operation', () => {
  const { journey, researched, started, completed, completionStep } = foundryProductionOperationJourney();
  const order = waterLandTown(started, journey.cityId).construction?.active; assert.ok(order && !('kind' in order));
  assert.equal(order.buildingId, 'foundry'); assert.deepEqual(order.paid, { materials: 32, credits: 16 }); assert.equal(order.workRequired, 14);
  assert.equal(resources(researched, journey.seat).materials - resources(started, journey.seat).materials, 32); assert.equal(resources(researched, journey.seat).credits - resources(started, journey.seat).credits, 16);
  assert.equal(iron(started, journey.seat), iron(researched, journey.seat));
  assert.equal(waterLandTown(completed, journey.cityId).buildingOperations?.foundry?.lastResult, null);
  const control = structuredClone(completionStep.before); const lane = waterLandTown(control, journey.cityId).construction; assert.ok(lane); lane.active = null;
  const result = replayCoastalStep(control, completionStep.input); assert.ok(result.ok);
  assert.deepEqual(result.state.civilizations, completed.civilizations);
  const duplicate = applyCommand(started, { seat: journey.seat, expectedRevision: started.revision, timestamp: coastalPrefixTime((started.independentTurns?.strategyTicks ?? 0) * 60 + 50), action: { type: 'build', project: 'foundry', cityId: journey.cityId } });
  assert.equal(duplicate.ok, false); assert.deepEqual(duplicate.state, started);
});

await test('foundry later actual operation consumes iron and energy jointly for useful quantified Materials', () => {
  const { journey, completed, operated } = foundryProductionOperationJourney();
  const result = waterLandTown(operated, journey.cityId).buildingOperations?.foundry?.lastResult; assert.ok(result);
  assert.equal(result.status, 'operated'); assert.deepEqual(result.paid, { energy: 2 }); assert.ok('strategicPaid' in result); assert.deepEqual(result.strategicPaid, { iron: 1 }); assert.equal(result.residents?.allocated, 3);
  assert.equal(result.produced.materials, Math.round(8 * cityProductivity(waterLandTown(completed, journey.cityId)) * 100) / 100);
  assert.ok(isWorldState(operated));
});

await test('foundry synthetic opening shortages never partially debit either ledger or residents', () => {
  const { journey, completed } = foundryProductionOperationJourney();
  const baseline = structuredClone(completed);
  for (const town of baseline.cities) for (const [id, operation] of Object.entries(town.buildingOperations ?? {})) operation.enabled = town.id === journey.cityId && id === 'foundry';
  const actor = baseline.civilizations.find(item => item.id === journey.seat); assert.ok(actor); actor.strategicResources = { iron: 1 }; actor.resources.energy = 2;
  waterLandTown(baseline, journey.cityId).population = 6;
  for (const missing of ['iron', 'energy', 'residents'] as const) {
    const state = structuredClone(baseline); const civilization = state.civilizations.find(item => item.id === journey.seat); assert.ok(civilization);
    if (missing === 'iron') civilization.strategicResources = { iron: 0 };
    if (missing === 'energy') civilization.resources.energy = 1;
    if (missing === 'residents') waterLandTown(state, journey.cityId).population = 5;
    const beforeIron = iron(state, journey.seat); const beforeEnergy = resources(state, journey.seat).energy;
    allocateOperations(state); const result = waterLandTown(state, journey.cityId).buildingOperations?.foundry?.lastResult; assert.ok(result);
    assert.equal(result.status, 'blocked'); assert.deepEqual(result.paid, {}); assert.ok('strategicPaid' in result); assert.deepEqual(result.strategicPaid, {}); assert.deepEqual(result.produced, {}); assert.equal(result.residents?.allocated, 0);
    assert.equal(iron(state, journey.seat), beforeIron); assert.equal(resources(state, journey.seat).energy, beforeEnergy);
  }
});

await test('foundry legal pause and resume preserve both-ledger receipts and consume only on resumed operation', () => {
  const { journey } = foundryProductionOperationJourney();
  journey.act({ type: 'set-building-operation', cityId: journey.cityId, buildingId: 'foundry', enabled: false }); journey.beat();
  const paused = waterLandTown(journey.state, journey.cityId).buildingOperations?.foundry?.lastResult; assert.ok(paused);
  assert.equal(paused.status, 'paused'); assert.deepEqual(paused.paid, {}); assert.ok('strategicPaid' in paused); assert.deepEqual(paused.strategicPaid, {}); assert.equal(paused.residents?.allocated, 0);
  journey.act({ type: 'set-building-operation', cityId: journey.cityId, buildingId: 'foundry', enabled: true }); journey.beat();
  const resumed = waterLandTown(journey.state, journey.cityId).buildingOperations?.foundry?.lastResult; assert.ok(resumed);
  assert.equal(resumed.status, 'operated'); assert.deepEqual(resumed.paid, { energy: 2 }); assert.ok('strategicPaid' in resumed); assert.deepEqual(resumed.strategicPaid, { iron: 1 });
});

await test('foundry actual consumption reopens the full-capacity accepted iron shipment without changing its terms', () => {
  const { journey, completed } = foundryProductionOperationJourney(); const routeId = journey.previous.routeId;
  const before = completed.routes.find(route => route.id === routeId); assert.ok(before?.agreement);
  assert.equal(iron(completed, journey.seat), 40);
  assert.match(journey.previous.blockedExchangeStep.result.state.routes.find(route => route.id === routeId)?.agreement?.blockedReason ?? '', /storage full/i);
  const deliveries = before.agreement.deliveryCount; journey.until(() => (journey.state.routes.find(route => route.id === routeId)?.agreement?.deliveryCount ?? 0) > deliveries);
  const after = journey.state.routes.find(route => route.id === routeId); assert.ok(after?.agreement);
  assert.deepEqual(after.agreement.terms, before.agreement.terms);
  const shipment = journey.steps.at(-1)?.result.events.find(event => event.strategicShipment?.routeId === routeId); assert.ok(shipment?.strategicShipment);
  assert.deepEqual(shipment.strategicShipment.proposerSent, { iron: 2 }); assert.ok(iron(journey.state, journey.seat) <= 40);
});

await test('foundry foreign missing and own-town absent Industrial zone refuse with no payments', () => {
  const { journey, researched } = foundryProductionOperationJourney();
  for (const cityId of ['missing', journey.previous.donorCityId]) {
    const result = applyCommand(researched, { seat: journey.seat, expectedRevision: researched.revision, timestamp: coastalPrefixTime((researched.independentTurns?.strategyTicks ?? 0) * 60 + 50), action: { type: 'build', cityId, project: 'foundry' } });
    assert.equal(result.ok, false); assert.deepEqual(result.state, researched); assert.deepEqual(result.events, []);
  }
  const detached = structuredClone(researched); const city = waterLandTown(detached, journey.cityId); city.buildings = city.buildings.filter(id => id !== 'industrial-zone'); delete city.districtSites?.['industrial-zone'];
  const result = applyCommand(detached, { seat: journey.seat, expectedRevision: detached.revision, timestamp: coastalPrefixTime((detached.independentTurns?.strategyTicks ?? 0) * 60 + 50), action: { type: 'build', cityId: journey.cityId, project: 'foundry' } });
  assert.equal(result.ok, false); assert.deepEqual(result.state, detached);
});

await test('foundry every real research construction consumption and retained shipment transition replays exactly', () => {
  const { journey, completed } = foundryProductionOperationJourney();
  const deliveries = completed.routes.find(route => route.id === journey.previous.routeId)?.agreement?.deliveryCount; assert.ok(deliveries !== undefined);
  journey.until(() => (journey.state.routes.find(route => route.id === journey.previous.routeId)?.agreement?.deliveryCount ?? 0) > deliveries);
  let state = structuredClone(journey.initial);
  for (const step of journey.steps) { assert.deepEqual(state, step.before); const result = replayCoastalStep(state, step.input); assert.deepEqual(result, step.result); assert.ok(isWorldState(result.state)); state = result.state; }
  assert.deepEqual(state, journey.state);
});

await test('foundry synthetic competing towns reserve one shared iron unit in stable city order', () => {
  const { journey, completed } = foundryProductionOperationJourney(); const state = structuredClone(completed);
  for (const city of state.cities) for (const operation of Object.values(city.buildingOperations ?? {})) operation.enabled = false;
  const first = waterLandTown(state, journey.cityId); const second = structuredClone(first); second.id = `${first.id}-synthetic-second`; second.improvements = {};
  for (const city of [first, second]) { city.population = 6; const operation = city.buildingOperations?.foundry; assert.ok(operation); operation.enabled = true; }
  state.cities.unshift(second);
  const actor = state.civilizations.find(item => item.id === journey.seat); assert.ok(actor); actor.strategicResources = { iron: 1 }; actor.resources.energy = 4;
  allocateOperations(state);
  const funded = first.buildingOperations?.foundry?.lastResult; const blocked = second.buildingOperations?.foundry?.lastResult; assert.ok(funded && blocked);
  assert.equal(funded.status, 'operated'); assert.equal(blocked.status, 'blocked'); assert.deepEqual(blocked.paid, {}); assert.equal(blocked.residents?.allocated, 0);
  assert.equal(iron(state, journey.seat), 0); assert.equal(actor.resources.energy, 2);
});

await test('foundry synthetic opening-zero control cannot borrow the real Mine extraction later in that beat', () => {
  const { journey, completed } = foundryProductionOperationJourney(); const state = structuredClone(completed);
  for (const city of state.cities) for (const operation of Object.values(city.buildingOperations ?? {})) operation.enabled = false;
  const source = waterLandTown(state, journey.cityId).buildingOperations?.foundry; assert.ok(source);
  const donor = waterLandTown(state, journey.previous.donorCityId); donor.buildings.push('foundry'); donor.buildingOperations ??= {}; donor.buildingOperations.foundry = { ...structuredClone(source), enabled: true }; donor.population = 7;
  const actor = state.civilizations.find(item => item.id === donor.civId); assert.ok(actor); actor.strategicResources = { iron: 0 }; actor.resources.energy = 2;
  allocateOperations(state); const blocked = donor.buildingOperations.foundry.lastResult; assert.ok(blocked);
  assert.equal(blocked.status, 'blocked'); assert.deepEqual(blocked.paid, {}); assert.equal(blocked.residents?.allocated, 0); assert.equal(actor.resources.energy, 2);
  extractCityMetals(state, donor);
  assert.equal(iron(state, donor.civId), 2); assert.equal(donor.buildingOperations.foundry.lastResult?.status, 'blocked');
  state.round += 1; allocateOperations(state);
  assert.equal(donor.buildingOperations.foundry.lastResult?.status, 'operated'); assert.equal(iron(state, donor.civId), 1); assert.equal(actor.resources.energy, 0);
});

await test('foundry detached recipe and exact events distinguish strategic payment from net stocks', () => {
  const { journey, completed, operated, operationStep, completionStep } = foundryProductionOperationJourney();
  const observation = observe(operated, journey.seat, journey.time());
  const recipe = observation.buildingRecipes?.find(item => item.buildingId === 'foundry'); assert.ok(recipe?.strategicInputs);
  assert.deepEqual(recipe.inputs, { energy: 2 }); assert.deepEqual(recipe.strategicInputs, { iron: 1 }); assert.deepEqual(recipe.outputs, { materials: 8 });
  recipe.strategicInputs.iron = 99;
  assert.deepEqual(BUILDINGS.find(item => item.id === 'foundry')?.strategicInputs, { iron: 1 });
  assert.deepEqual(observe(operated, journey.seat, journey.time()).buildingRecipes?.find(item => item.buildingId === 'foundry')?.strategicInputs, { iron: 1 });
  for (const item of observation.buildingRecipes ?? []) if (item.buildingId !== 'foundry') assert.equal('strategicInputs' in item, false);
  for (const city of completed.cities) for (const [id, operation] of Object.entries(city.buildingOperations ?? {})) if (id !== 'foundry' && operation.lastResult) {
    assert.equal('strategicPaid' in operation.lastResult, false); assert.equal('strategicShortages' in operation.lastResult, false);
  }
  assert.ok(completionStep.result.events.some(event => event.effects.includes('Operating input iron 1 per funded beat')));
  const event = operationStep.result.events.find(item => item.type === 'building-operation' && item.detail.startsWith(`${journey.cityId}/foundry `)); assert.ok(event);
  assert.ok(event.effects.includes('Paid 1 iron')); assert.ok(event.effects.includes('Paid 2 energy'));
});
