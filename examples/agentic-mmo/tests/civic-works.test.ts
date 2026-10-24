import { civicWorksFixture as fixture, civicWorksTown as town, civicWorksAction as action, acceptCivicWorksFixture as accept, advanceCivicWorksFixture as economy } from './fixtures/civic-works.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, RESOURCE_IDS } from '../core/content.ts';
import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import { cityResourceProduction } from '../core/learning-patronage.ts';
import { availableCivicWorksActions, civicWorksBlock, civicWorksCommission, executeCivicWorksAction, projectCivicWorksProtection } from '../core/simulation/civic-works.ts';
import { constructionWork, constructionWorkMultiplier, openingConstructionWork } from '../core/simulation/construction.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { adoptGovernment } from '../core/simulation/government.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import { availableTradeActions, executeTradeAction } from '../core/simulation/trade.ts';
import type { GameEvent, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';

const q = (value: number): number => Math.round(value * 100) / 100;

function ordinary(state: WorldState): WorldState {
  const result = structuredClone(state); result.civicWorks!.active = []; result.civicWorks!.lastResults.fill(null); return result;
}

function assertOrdinaryFallback(state: WorldState): void {
  const baseline = ordinary(state);
  economy(state); economy(baseline);
  assert.deepEqual(state.civilizations, baseline.civilizations);
  assert.deepEqual(town(state).buildingOperations, town(baseline).buildingOperations);
  const construction = town(state).construction; const expected = structuredClone(town(baseline).construction);
  if (construction?.lastCompleted && expected?.lastCompleted) {
    assert.ok(state.events.some(event => event.id === construction.lastCompleted!.eventId && event.type === 'building-completed'));
    assert.ok(baseline.events.some(event => event.id === expected.lastCompleted!.eventId && event.type === 'building-completed'));
    expected.lastCompleted.eventId = construction.lastCompleted.eventId;
  }
  assert.deepEqual(construction, expected);
  const receipt = state.civicWorks!.lastResults[0]!;
  assert.notEqual(receipt.status, 'worked'); assert.deepEqual(receipt.paid, {}); assert.equal(receipt.residents, null); assert.equal(receipt.extraWork, 0);
}

void test('A scheduled funded Kiln commission substitutes real staff and output for paid exact-order work', () => {
  const state = fixture(); accept(state); const retained = ordinary(state);
  const ordinaryWork = constructionWork(state, town(state)); const extra = q(2 * constructionWorkMultiplier(state, town(state)));
  const allocation = projectOperationAllocation(retained);
  const baselineKiln = cityResourceProduction(allocation, town(allocation), 'materials').buildings.find(part => part.buildingId === 'kiln')!.amount;
  economy(state); economy(retained);
  const operation = town(state).buildingOperations!.kiln!.lastResult!;
  const receipt = state.civicWorks!.lastResults[0]!;
  assert.equal(operation.status, 'civic-works'); assert.equal(operation.civicWorksCommissionId, receipt.commissionId);
  assert.deepEqual(operation.paid, {}); assert.deepEqual(operation.produced, {}); assert.equal(operation.residents!.allocated, 3);
  assert.deepEqual(receipt.paid, { materials: 1, credits: 2 }); assert.equal(receipt.residents!.allocated, 3);
  assert.equal(receipt.ordinaryWork, ordinaryWork); assert.equal(receipt.extraWork, extra);
  assert.equal(town(state).construction!.active!.workDone, q(ordinaryWork + extra));
  assert.equal(q(state.civilizations[0]!.resources.materials - retained.civilizations[0]!.resources.materials), q(-1 - baselineKiln));
  assert.equal(q(state.civilizations[0]!.resources.energy - retained.civilizations[0]!.resources.energy), 2);
  assert.equal(q(state.civilizations[0]!.resources.credits - retained.civilizations[0]!.resources.credits), -2);
  assert.deepEqual(town(state).lastFoodSupply, town(retained).lastFoodSupply);
});

void test('No commission has no economy effects and no synthetic civic-work events', () => {
  const state = fixture(); const baseline = structuredClone(state); delete baseline.civicWorks;
  const events = economy(state); const retainedEvents = economy(baseline);
  assert.deepEqual(events, retainedEvents); delete state.civicWorks; assert.deepEqual(state, baseline);
});

void test('Exact ownership, original payment, civic prerequisite and one active commission are required without mutation', () => {
  const state = fixture(); const request = action(state); const before = structuredClone(state);
  assert.match(civicWorksBlock(state, 1, request)!, /owned|State workforce/);
  assert.match(civicWorksBlock(state, 0, { ...request, orderId: 'replacement' })!, /exact/);
  assert.equal(executeCivicWorksAction(state, 0, { ...request, orderId: 'replacement' }, []), false); assert.deepEqual(state, before);
  town(state).construction!.active!.paid.materials = 0;
  assert.match(civicWorksBlock(state, 0, request)!, /payment/);
  town(state).construction!.active!.paid.materials = before.cities.find(city => city.id === 'city-0')!.construction!.active!.paid.materials!;
  state.civilizations[0]!.civics!.completedCivicIds = [];
  assert.match(civicWorksBlock(state, 0, request)!, /State workforce/);
  state.civilizations[0]!.civics = structuredClone(before.civilizations[0]!.civics!);
  accept(state); assert.match(civicWorksBlock(state, 0, request)!, /one/);
  assert.deepEqual(availableCivicWorksActions(state, 0), []);
});

for (const [label, change] of [
  ['no Material', (state: WorldState) => { state.civilizations[0]!.resources.materials = 0; }],
  ['partial Material', (state: WorldState) => { state.civilizations[0]!.resources.materials = 0.99; }],
  ['partial Credits', (state: WorldState) => { state.civilizations[0]!.resources.credits = 1.99; }],
  ['unfunded ordinary donor', (state: WorldState) => { state.civilizations[0]!.resources.energy = 1.99; }],
  ['paused ordinary donor', (state: WorldState) => { town(state).buildingOperations!.kiln!.enabled = false; }],
  ['only two available staff', (state: WorldState) => { town(state).population = 5; }],
] as const) void test(`${label} preserves the exact ordinary allocation without commission payment or work`, () => {
  const state = fixture(); accept(state); change(state); assertOrdinaryFallback(state);
});

void test('Ordinary completion incurs no crew charge and retires only after actual completion', () => {
  const state = fixture(); accept(state);
  const order = town(state).construction!.active!; order.workDone = order.workRequired - 0.5;
  assertOrdinaryFallback(state);
  assert.equal(state.civicWorks!.lastResults[0]!.terminal, 'order-completed'); assert.deepEqual(state.civicWorks!.active, []);
  assert.equal(town(state).construction!.active, null); assert.ok(town(state).buildings.includes('fuel-yard'));
});

void test('Lost or replaced orders cannot transfer crew work and record a zero-work terminal receipt', () => {
  const state = fixture(); accept(state); town(state).construction!.active!.id += '-replacement';
  assertOrdinaryFallback(state); const receipt = state.civicWorks!.lastResults[0]!;
  assert.equal(receipt.terminal, 'order-lost'); assert.equal(receipt.workBefore, 0); assert.equal(receipt.workRequired, 0); assert.equal(receipt.ordinaryWork, 0); assert.deepEqual(state.civicWorks!.active, []);
});

void test('Two failed scheduled beats expire without sliding or changing enabled intent', () => {
  const state = fixture(); accept(state); const expiry = state.civicWorks!.active[0]!.expiresRound;
  town(state).buildingOperations!.kiln!.enabled = false;
  economy(state); assert.equal(state.civicWorks!.active[0]!.expiresRound, expiry);
  economy(state); assert.equal(state.round, expiry); assert.equal(state.civicWorks!.lastResults[0]!.terminal, 'expired'); assert.deepEqual(state.civicWorks!.active, []);
  assert.equal(town(state).buildingOperations!.kiln!.enabled, false);
  town(state).buildingOperations!.kiln!.enabled = true; economy(state); assert.equal(town(state).buildingOperations!.kiln!.lastResult!.status, 'operated');
});

void test('Later non-donor staffing displaced by the earlier paid target refuses the whole commission', () => {
  const state = fixture(); const city = town(state); city.population = 9;
  syntheticTechnologies(state, 0, ['writing']); syntheticInstitution(state, city.id, 'campus'); syntheticInstitution(state, city.id, 'library');
  const before = structuredClone(state);
  const quote = projectCivicWorksProtection(state, civicWorksCommission(state, 0, action(state)));
  assert.equal(quote.supported, false); assert.match(quote.reason, /library.*loses baseline-funded/); assert.deepEqual(state, before);
});

void test('Runtime recheck protects newly present ordinary commitments without stealing their Credits', () => {
  const state = fixture(); accept(state); const city = town(state);
  syntheticTechnologies(state, 0, ['writing']); syntheticInstitution(state, city.id, 'campus'); syntheticInstitution(state, city.id, 'library');
  state.civilizations[0]!.resources.credits = 1;
  assertOrdinaryFallback(state); assert.equal(city.buildingOperations!.library!.lastResult!.status, 'operated');
});

void test('Accepted trade due chronology is refused rather than paid early or financed from expected receipts', () => {
  const state = fixture();
  const offered = availableTradeActions(state, 0).find(option => option.action.type === 'propose-trade'); assert.ok(offered?.action.type === 'propose-trade');
  state.revision++; const proposed: GameEvent[] = []; executeTradeAction(state, 0, offered.action, proposed); commitEvents(state, proposed);
  const offer = state.tradeOffers!.at(-1)!; state.revision++; const accepted: GameEvent[] = [];
  executeTradeAction(state, offer.recipient, { type: 'respond-trade', offerId: offer.id, accept: true }, accepted); commitEvents(state, accepted);
  const before = structuredClone(state); assert.match(civicWorksBlock(state, 0, action(state))!, /Accepted trade/); assert.deepEqual(state, before);
});

void test('Opening projection uses actual substitution without mutating parent commission or resources', () => {
  const state = fixture(); accept(state); const before = structuredClone(state);
  const projected = projectOperationAllocation(state);
  assert.deepEqual(state, before); assert.equal(town(projected).buildingOperations!.kiln!.lastResult!.status, 'civic-works');
  assert.deepEqual(town(projected).buildingOperations!.kiln!.lastResult!.produced, {});
  assert.equal(projected.civicWorks!.lastResults[0]!.status, 'worked'); assert.equal(state.civicWorks!.lastResults[0], null);
  assert.equal(projected.civilizations[0]!.resources.materials, state.civilizations[0]!.resources.materials - 1);
});

void test('Industry focus and Urban planning base are not duplicated and Autocracy productivity applies once', () => {
  const state = fixture(); const city = town(state); city.focus = 'industry'; city.wellbeing = 47.3; city.infrastructure = 0.7; city.damage = 7.9;
  state.revision++; const events: GameEvent[] = []; adoptGovernment(state, 0, 'autocracy', [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }], events); commitEvents(state, events);
  const multiplier = constructionWorkMultiplier(state, city); const ordinary = openingConstructionWork(state).get(city.id)!;
  accept(state); const remaining = city.construction!.active!.workRequired; economy(state);
  const receipt = state.civicWorks!.lastResults[0]!;
  assert.equal(receipt.ordinaryWork, ordinary); assert.equal(receipt.extraWork, Math.min(q(2 * multiplier), q(remaining - ordinary)));
  assert.equal(q(receipt.ordinaryWork + receipt.extraWork), Math.min(remaining, q(ordinary + q(2 * multiplier))));
});

void test('A capped successful final contribution completes after production and preserves historical work', () => {
  const state = fixture(); const city = town(state); city.construction!.active!.workDone = 3.9;
  accept(state); const events = economy(state); const receipt = state.civicWorks!.lastResults[0]!;
  assert.equal(receipt.extraWork, 1.1); assert.equal(receipt.terminal, 'order-completed'); assert.equal(receipt.status, 'worked');
  assert.equal(city.buildingOperations!['fuel-yard']!.lastResult, null); assert.deepEqual(state.civicWorks!.active, []);
  const workIndex = events.findIndex(event => event.civicWorks?.commissionId === receipt.commissionId);
  const completionIndex = events.findIndex(event => event.type === 'building-completed' && event.detail === BUILDINGS.find(building => building.id === 'fuel-yard')!.description);
  assert.ok(workIndex >= 0 && completionIndex > workIndex);
  assert.deepEqual(events[workIndex]!.civicWorks, receipt);
  economy(state); assert.equal(city.buildingOperations!.kiln!.lastResult!.status, 'operated'); assert.equal(state.civicWorks!.lastResults[0]!.round, 1);
});

void test('Protection has a finite observed candidate cost, preserves source and exposes authoritative paired frames', () => {
  const state = fixture(); const before = structuredClone(state); const started = performance.now();
  const quote = projectCivicWorksProtection(state, civicWorksCommission(state, 0, action(state)));
  const elapsed = performance.now() - started;
  assert.ok(quote.supported, quote.reason); assert.ok(quote.retained.length > 2 && quote.retained.length <= 12); assert.equal(quote.proposed.length, quote.retained.length); assert.deepEqual(state, before);
  assert.equal(quote.proposed.filter(frame => frame.civicWorks!.lastResults[0]?.round === frame.round && frame.civicWorks!.lastResults[0]?.status === 'worked').length, 2);
  assert.ok(RESOURCE_IDS.every(resource => Number.isFinite(quote.proposed.at(-1)!.civilizations[0]!.resources[resource])));
  process.stdout.write(`civic-works candidate observation: ${quote.retained.length * 2} authoritative economy beats, ${elapsed.toFixed(3)} ms\n`);
});

void test('Same-version serialized command and scheduled beat replay preserve paid work exactly', () => {
  const state = fixture(); assert.ok(isWorldState(state), 'Valid synthetic prerequisites and actual paid order');
  const request = { seat: 0, expectedRevision: state.revision, timestamp: '2026-10-24T00:00:20.000Z', action: action(state) };
  const accepted = applyCommand(state, request); assert.ok(accepted.ok, accepted.error); assert.ok(isWorldState(accepted.state));
  assert.deepEqual(applyCommand(JSON.parse(JSON.stringify(state)), request), accepted);
  const advanced = catchUpStrategy(accepted.state, '2026-10-24T00:01:00.000Z'); assert.ok(advanced.ok, advanced.error); assert.ok(isWorldState(advanced.state));
  assert.deepEqual(catchUpStrategy(JSON.parse(JSON.stringify(accepted.state)), '2026-10-24T00:01:00.000Z'), advanced);
  assert.equal(advanced.state.civicWorks!.lastResults[0]!.status, 'worked');
});

for (const buildingId of ['campus', 'library']) void test(`Actual ${buildingId} work retains its exact remote district or parent attachment tile`, () => {
  const state = fixture(buildingId); const city = town(state); const order = city.construction!.active!;
  const expected = order.tileId ?? city.districtSites!.campus!;
  assert.notEqual(expected, city.tileId); accept(state); assert.equal(state.civicWorks!.active[0]!.targetTileId, expected);
  economy(state); const receipt = state.civicWorks!.lastResults[0]!;
  assert.equal(receipt.status, 'worked'); assert.equal(receipt.targetTileId, expected);
  assert.equal(state.events.find(event => event.id === receipt.eventId)!.tileId, expected);
});
