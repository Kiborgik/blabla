import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld, legalActions } from '../core/engine.ts';
import { ECONOMY_RULES, HISTORICAL_MILESTONES, RESOURCE_IDS } from '../core/content.ts';
import type { City, GameAction, GameEvent, Route, WorldState } from '../core/types.ts';
import { executeAction } from '../core/simulation/commands.ts';
import { foundSettlement } from '../core/simulation/coastal.ts';
import { commitEvents, emitEvent } from '../core/simulation/events.ts';
import { milestoneEligible, resolveHistory } from '../core/simulation/history.ts';
import { selectLandIntegration } from '../core/simulation/land-integration.ts';
import { availableTradeActions, resolveTrade } from '../core/simulation/trade.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const connected = HISTORICAL_MILESTONES.find(milestone => milestone.id === 'connected-world')!;

function world(): WorldState {
  const state = createWorld(1701, epoch, 'settlement-land-transport-1');
  for (const feature of ['conserved-founding', 'earned-history', 'earned-land-integration']) if (!state.unlockedFeatures.includes(feature)) state.unlockedFeatures.push(feature);
  state.calendarMilestones = ['rise-of-states'];
  state.milestoneProofs = {};
  for (const tile of state.tiles) tile.terrain = 'grassland';
  for (const civilization of state.civilizations) for (const resource of RESOURCE_IDS) civilization.resources[resource] = 100;
  for (const city of state.cities) city.population = 12;
  return state;
}

function act(state: WorldState, seat: number, action: GameAction): GameEvent[] {
  state.revision += 1;
  const events: GameEvent[] = [];
  executeAction(state, seat, action, events);
  commitEvents(state, events);
  return events;
}

function found(state: WorldState, seat = 0): City {
  const action = legalActions(state, seat, epoch).find(option => option.action.type === 'settle')?.action;
  assert.ok(action?.type === 'settle');
  const events = act(state, seat, action);
  const city = state.cities.find(candidate => candidate.landFounding?.eventId === events[0]?.id);
  assert.ok(city);
  return city;
}

function agree(state: WorldState, from: City, to: City, recipeId = 'harvest-for-materials'): Route {
  const action: GameAction = { type: 'propose-trade', partner: to.civId, recipeId, sourceCityId: from.id, recipientCityId: to.id };
  assert.ok(availableTradeActions(state, from.civId).some(option => JSON.stringify(option.action) === JSON.stringify(action)));
  act(state, from.civId, action);
  const offer = state.tradeOffers!.at(-1)!;
  act(state, to.civId, { type: 'respond-trade', offerId: offer.id, accept: true });
  return state.routes.find(route => route.agreement?.offerId === offer.id)!;
}

function due(state: WorldState, route: Route): GameEvent[] {
  state.round = route.agreement!.nextDeliveryRound;
  state.revision += 1;
  const events: GameEvent[] = [];
  resolveTrade(state, events);
  return events;
}

function paidFixture() {
  const state = world();
  const city = found(state);
  const partner = state.cities.find(candidate => candidate.civId === 1)!;
  const route = agree(state, city, partner);
  const events = due(state, route);
  return { state, city, partner, route, events };
}

await test('ordinary authority records exact paid conserved birth, while projection and old feature do not', () => {
  const state = world();
  const source = state.cities[0]!;
  const before = structuredClone(source);
  const stocks = structuredClone(state.civilizations[0]!.resources);
  const city = found(state);
  const receipt = city.landFounding!;
  assert.deepEqual(receipt, { ruleVersion: 1, mode: 'ordinary', civId: 0, sourceCityId: source.id, foundedCityId: city.id, sourceTileId: source.tileId, destinationTileId: city.tileId, population: ECONOMY_RULES.settle.population, sourcePopulationBefore: before.population, sourcePopulationAfter: source.population, paid: ECONOMY_RULES.settle.cost, round: 0, revision: state.revision, eventId: `${state.revision}:0` });
  assert.equal(before.population - source.population, city.population);
  for (const resource of RESOURCE_IDS) assert.equal(stocks[resource] - state.civilizations[0]!.resources[resource], receipt.paid[resource] ?? 0);
  assert.deepEqual(state.events.at(-1)?.landFounding, receipt);
  assert.notStrictEqual(state.events.at(-1)?.landFounding, receipt);
  const projection = world();
  const action = legalActions(projection, 0, epoch).find(option => option.action.type === 'settle')!.action;
  assert.ok(action.type === 'settle');
  projection.revision += 1;
  const projected = foundSettlement(projection, 0, projection.tiles.find(tile => tile.id === action.tileId)!, projection.cities[0], true);
  assert.equal(projected.landFounding, undefined);
  const old = world(); old.unlockedFeatures = old.unlockedFeatures.filter(feature => feature !== 'earned-land-integration');
  const oldAction = legalActions(old, 0, epoch).find(option => option.action.type === 'settle')!.action;
  act(old, 0, oldAction);
  assert.equal(old.cities.at(-1)?.landFounding, undefined);
  assert.equal(old.events.at(-1)?.landFounding, undefined);
});

await test('current actual paid land exchange qualifies without Knowledge or Navigation and freezes one exact proof', () => {
  const { state, city, partner, route, events } = paidFixture();
  assert.equal(state.unlockedFeatures.includes('knowledge-compacts'), false);
  assert.equal(state.civilizations.some(civilization => civilization.technologies.includes('navigation')), false);
  const event = events.find(candidate => candidate.type === 'trade-delivered')!;
  assert.ok(event.paidTradeDelivery);
  assert.equal(event.paidTradeDelivery.deliveryCount, 1);
  assert.equal(event.paidTradeDelivery.fromCityId, city.id);
  const before = structuredClone(state);
  const witness = selectLandIntegration(state, events);
  assert.ok(witness);
  assert.equal(milestoneEligible(state, events, connected), true);
  assert.deepEqual(state, before);
  const year = state.year;
  resolveHistory(state, events);
  assert.equal(state.year, year);
  assert.equal(state.civilizations.every(civilization => civilization.era === 2), true);
  const proof = state.milestoneProofs!['connected-world']!;
  assert.deepEqual(proof.connection, witness);
  const milestoneEvent = events.find(candidate => candidate.type === 'history-milestone' && candidate.landIntegration)!;
  assert.deepEqual(milestoneEvent.landIntegration, witness);
  assert.equal(milestoneEvent.tileId, city.tileId);
  assert.ok(milestoneEvent.detail.includes(city.id) && milestoneEvent.detail.includes(partner.id));
  const frozen = structuredClone(proof);
  route.agreement!.terms.proposerCargo.food = 999;
  event.paidTradeDelivery!.proposerPaid.food = 999;
  city.landFounding!.sourcePopulationBefore = 999;
  assert.deepEqual(proof, frozen);
  resolveHistory(state, events);
  assert.equal(state.calendarMilestones.filter(id => id === 'connected-world').length, 1);
});

await test('paid payload is release gated independently of the unchanged Knowledge delivery return', () => {
  const { state, route } = paidFixture();
  state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== 'earned-land-integration');
  state.round = route.agreement!.nextDeliveryRound; state.revision += 1;
  const events: GameEvent[] = [];
  assert.deepEqual(resolveTrade(state, events), []);
  assert.equal(events.some(event => event.paidTradeDelivery), false);
  state.unlockedFeatures.push('knowledge-compacts');
  state.round = route.agreement!.nextDeliveryRound; state.revision += 1;
  const knowledgeEvents: GameEvent[] = [];
  const deliveries = resolveTrade(state, knowledgeEvents);
  assert.equal(deliveries.length, 1);
  assert.equal(knowledgeEvents.some(event => event.paidTradeDelivery), false);
  state.unlockedFeatures.push('earned-land-integration');
  state.round = route.agreement!.nextDeliveryRound; state.revision += 1;
  const sharedEvents: GameEvent[] = [];
  const sharedDeliveries = resolveTrade(state, sharedEvents);
  assert.deepEqual(sharedDeliveries[0], sharedEvents[0]!.paidTradeDelivery);
  assert.notStrictEqual(sharedDeliveries[0], sharedEvents[0]!.paidTradeDelivery);
});

await test('old delivered bodies, rewritten envelope IDs and counters cannot resurrect a later connection', () => {
  const { state, route, events } = paidFixture();
  state.calendarMilestones = [];
  resolveHistory(state, events);
  assert.equal(state.milestoneProofs!['connected-world'], undefined);
  commitEvents(state, events);
  state.calendarMilestones.push('rise-of-states'); state.revision += 1;
  assert.equal(milestoneEligible(state, [], connected), false);
  assert.equal(selectLandIntegration(state, state.events), null);
  const rewritten = structuredClone(events);
  rewritten[0]!.id = `${state.revision}:0`;
  assert.equal(selectLandIntegration(state, rewritten), null);
  const nextEvents = due(state, route);
  assert.equal(milestoneEligible(state, nextEvents, connected), true);
});

await test('unrelated capital trade and mismatched current receipt identities never supply founded-town evidence', () => {
  const unrelated = world(); found(unrelated);
  const capitalRoute = agree(unrelated, unrelated.cities[0]!, unrelated.cities[1]!);
  assert.equal(selectLandIntegration(unrelated, due(unrelated, capitalRoute)), null);
  for (const mutate of [
    ({ events }: ReturnType<typeof paidFixture>) => { events[0]!.paidTradeDelivery!.fromCityId = 'city-0'; },
    ({ events }: ReturnType<typeof paidFixture>) => { events[0]!.paidTradeDelivery!.deliveryCount += 1; },
    ({ events }: ReturnType<typeof paidFixture>) => { events[0]!.paidTradeDelivery!.proposerPaid.food = 0; },
    ({ events }: ReturnType<typeof paidFixture>) => { events[0]!.paidTradeDelivery!.tradeTerms.proposerCargo = {}; events[0]!.paidTradeDelivery!.tradeTerms.recipientCargo = {}; },
    ({ route }: ReturnType<typeof paidFixture>) => { route.agreement!.enabled = false; },
    ({ route }: ReturnType<typeof paidFixture>) => { route.damage = route.agreement!.terms.damageDisableAt; },
    ({ state, partner }: ReturnType<typeof paidFixture>) => { partner.civId = 0; state.tiles.find(tile => tile.id === partner.tileId)!.owner = 0; },
    ({ state, city }: ReturnType<typeof paidFixture>) => { state.cities[0]!.landFounding = structuredClone(city.landFounding!); delete city.landFounding; },
    ({ city }: ReturnType<typeof paidFixture>) => { city.landFounding!.mode = 'coast' as 'ordinary'; },
    ({ state }: ReturnType<typeof paidFixture>) => { state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== 'conserved-founding'); },
  ]) {
    const fixture = paidFixture(); mutate(fixture);
    assert.equal(selectLandIntegration(fixture.state, fixture.events), null);
  }
});

await test('coastal first tie and same-batch Rise use the same common-prerequisite selection', () => {
  const { state, events } = paidFixture();
  const extra = structuredClone(state.routes[0]!);
  extra.id = 'synthetic-active-a'; state.routes.push(extra, { ...structuredClone(extra), id: 'synthetic-active-b' });
  state.calendarMilestones = ['roads-between-peoples'];
  state.civilizations[0]!.technologies.push('civic-institutions');
  state.civilizations[1]!.technologies.push('civic-institutions');
  assert.equal(milestoneEligible(state, events, connected), false);
  resolveHistory(state, events);
  assert.ok(state.calendarMilestones.includes('rise-of-states'));
  assert.equal(state.milestoneProofs!['connected-world']!.connection?.kind, 'land');
  const tie = paidFixture();
  tie.state.routes.push({ ...structuredClone(tie.route), id: 'synthetic-active-a' }, { ...structuredClone(tie.route), id: 'synthetic-active-b' });
  tie.state.unlockedFeatures.push('navigation'); tie.state.civilizations[0]!.technologies.push('navigation'); tie.state.eventCounts['coastal-founded'] = 1;
  resolveHistory(tie.state, tie.events);
  assert.deepEqual(tie.state.milestoneProofs!['connected-world']!.connection, { kind: 'coastal' });
  assert.equal(tie.events.some(event => event.landIntegration), false);
});

await test('multiple current deliveries choose founding revision before current event numeric order', () => {
  const state = world();
  const early = found(state, 0);
  const late = found(state, 1);
  const earlyRoute = agree(state, early, state.cities.find(city => city.civId === 2)!);
  const lateRoute = agree(state, late, state.cities.find(city => city.civId === 3)!);
  state.routes.reverse();
  const earlyCadence = earlyRoute.agreement!.terms.cadenceRounds;
  const lateCadence = lateRoute.agreement!.terms.cadenceRounds;
  state.round = earlyCadence * lateCadence;
  state.revision += 1;
  const events: GameEvent[] = [];
  resolveTrade(state, events);
  assert.equal(events[0]!.paidTradeDelivery?.fromCityId, late.id);
  assert.equal(selectLandIntegration(state, events)?.founding.foundedCityId, early.id);
  assert.deepEqual(selectLandIntegration(state, events.toReversed()), selectLandIntegration(state, events));
});

await test('equivalent serialized object key order preserves exact terms while path order still matters', () => {
  const fixture = paidFixture();
  const state: WorldState = JSON.parse(JSON.stringify(fixture.state));
  const route = state.routes[0]!;
  const offer = state.tradeOffers!.find(candidate => candidate.id === route.agreement!.offerId)!;
  offer.terms = Object.fromEntries(Object.entries(offer.terms).reverse()) as typeof offer.terms;
  offer.terms.proposerCargo = Object.fromEntries(Object.entries(offer.terms.proposerCargo).reverse());
  const events = due(state, route);
  assert.ok(selectLandIntegration(state, events));
  offer.terms.transport!.tileIds.reverse();
  assert.equal(selectLandIntegration(state, events), null);
});

await test('one founding with multiple current exchanges orders event indices numerically rather than lexically', () => {
  const state = world();
  const city = found(state);
  const first = agree(state, city, state.cities.find(candidate => candidate.civId === 1)!);
  const second = agree(state, city, state.cities.find(candidate => candidate.civId === 2)!);
  state.round = first.agreement!.terms.cadenceRounds * second.agreement!.terms.cadenceRounds;
  state.revision += 1;
  const events: GameEvent[] = [];
  for (let index = 0; index < 9; index += 1) emitEvent(state, events, { type: 'hold-position', title: 'Synthetic current batch event', detail: '', actor: null, target: null, tileId: null, cause: 'Finite ordering control', effects: [], importance: 0 });
  resolveTrade(state, events);
  assert.equal(events[9]!.paidTradeDelivery?.routeId, first.id);
  assert.equal(events[10]!.paidTradeDelivery?.routeId, second.id);
  assert.equal(selectLandIntegration(state, events.toReversed())?.delivery.routeId, first.id);
});
