import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ECONOMY_RULES } from '../core/content.ts';
import type { LandFoundingReceipt, LandIntegrationWitness } from '../core/land-integration-types.ts';
import { earnedLandRecords, isLandFoundingReceipt, isLandIntegrationWitness, isPaidLandDelivery, validLandIntegrationEvent } from '../core/land-integration-validation.ts';
import type { GameEvent, ResolvedTradeDelivery, WorldState } from '../core/types.ts';
import { isGameEvent, isWorldState } from '../core/validation.ts';
import { landBeat, landIntegrationFixture } from './fixtures/land-integration.ts';

type Mutation<T> = readonly [string, (value: T) => void];
let fixture: ReturnType<typeof landIntegrationFixture> | undefined;
function scenario(): ReturnType<typeof landIntegrationFixture> { fixture ??= landIntegrationFixture(); return structuredClone(fixture); }
function witness(state: WorldState): LandIntegrationWitness {
  const value = state.milestoneProofs?.['connected-world']?.connection;
  assert.ok(value?.kind === 'land');
  return value;
}
function foundingEvent(state: WorldState): GameEvent {
  const value = witness(state).founding;
  const event = state.events.find(item => item.id === value.eventId);
  assert.ok(event);
  return event;
}
function deliveryEvent(state: WorldState): GameEvent {
  const value = witness(state).delivery;
  const event = state.events.find(item => item.id === value.eventId);
  assert.ok(event);
  return event;
}
function milestoneEvent(state: WorldState): GameEvent {
  const event = state.events.find(item => item.id === state.milestoneProofs?.['connected-world']?.eventId);
  assert.ok(event);
  return event;
}
function extra(value: object): void { Object.assign(value, { invented: true }); }

const foundingMutations: Mutation<LandFoundingReceipt>[] = [
  ['rule version', value => { value.ruleVersion = 2 as 1; }],
  ['mode', value => { value.mode = 'coast' as 'ordinary'; }],
  ['founder seat', value => { value.civId = 5; }],
  ['initial capital identity', value => { value.foundedCityId = `city-${value.civId}`; }],
  ['source identity', value => { value.sourceCityId = value.foundedCityId; }],
  ['same tile', value => { value.sourceTileId = value.destinationTileId; }],
  ['fractional tile', value => { value.sourceTileId += 0.5; }],
  ['population minted', value => { value.population++; }],
  ['source conservation', value => { value.sourcePopulationAfter++; }],
  ['source minimum', value => { value.sourcePopulationBefore = 5; value.sourcePopulationAfter = 2; }],
  ['paid amount', value => { value.paid.food = 0; }],
  ['paid extra zero', value => { value.paid.energy = 0; }],
  ['missing payment', value => { delete value.paid.credits; }],
  ['negative round', value => { value.round = -1; }],
  ['revision', value => { value.revision++; }],
  ['event ID', value => { value.eventId = `${value.revision}:01`; }],
  ['extra field', extra],
];

const deliveryMutations: Mutation<ResolvedTradeDelivery>[] = [
  ['rule version', value => { value.ruleVersion = 2 as 1; }],
  ['same party', value => { value.partner = value.owner; }],
  ['same endpoint', value => { value.toCityId = value.fromCityId; }],
  ['same endpoint tile', value => { value.toTileId = value.fromTileId; }],
  ['before due', value => { value.round = value.agreementAcceptedRound; }],
  ['off-cadence round', value => { value.round++; }],
  ['unearned sequence', value => { value.deliveryCount += 100; }],
  ['zero sequence', value => { value.deliveryCount = 0; }],
  ['revision', value => { value.revision++; }],
  ['event ID', value => { value.eventId = `0:${value.eventId.split(':')[1]}`; }],
  ['unknown recipe', value => { value.tradeTerms.recipeId = 'free-cargo'; }],
  ['recipe version', value => { value.tradeTerms.recipeVersion++; }],
  ['altered upkeep', value => { value.tradeTerms.proposerUpkeep.energy = 0; }],
  ['altered yield', value => { value.tradeTerms.recipientYield.credits = 100; }],
  ['zero real cargo', value => { value.tradeTerms.proposerCargo = {}; value.tradeTerms.recipientCargo = {}; }],
  ['cadence', value => { value.tradeTerms.cadenceRounds++; }],
  ['transport mode', value => { value.tradeTerms.transport!.mode = 'steam'; }],
  ['transport endpoints', value => { value.tradeTerms.transport!.tileIds.reverse(); }],
  ['transport duplicate', value => { value.tradeTerms.transport!.tileIds[1] = value.tradeTerms.transport!.tileIds[0]!; }],
  ['transport extra field', value => { extra(value.tradeTerms.transport!); }],
  ['sparse transport', value => { delete value.tradeTerms.transport!.tileIds[1]; }],
  ['missing full payment', value => { delete value.proposerPaid.food; }],
  ['partial proposer payment', value => { value.proposerPaid.energy = 0; }],
  ['partial recipient payment', value => { value.recipientPaid.energy = 0; }],
  ['invented strategic payment', value => { value.proposerStrategicPaid.iron = 1; }],
  ['payment extra key', value => { extra(value.recipientPaid); }],
  ['terms extra key', value => { extra(value.tradeTerms); }],
  ['extra field', extra],
];

test('real earned land receipts are valid at founding, acceptance and a long paid land exchange', () => {
  const value = scenario();
  for (const state of [value.initial, value.founded, value.proposed, value.accepted, value.beforeDue, value.state]) {
    assert.equal(earnedLandRecords(state), true);
    assert.equal(isWorldState(state), true);
  }
  const proof = witness(value.state);
  assert.deepEqual(proof.founding.paid, ECONOMY_RULES.settle.cost);
  assert.equal(proof.founding.population, 3);
  assert.ok(proof.delivery.tradeTerms.transport!.edges > 12);
  assert.ok(proof.delivery.tradeTerms.cadenceRounds > 6);
  assert.equal(isLandFoundingReceipt(proof.founding), true);
  assert.equal(isPaidLandDelivery(proof.delivery), true);
  assert.equal(isLandIntegrationWitness(proof), true);
  const withoutKnowledge = structuredClone(value.state);
  withoutKnowledge.unlockedFeatures = withoutKnowledge.unlockedFeatures.filter(feature => feature !== 'knowledge-compacts');
  delete withoutKnowledge.knowledge;
  assert.equal(earnedLandRecords(withoutKnowledge), true);
});

test('founding shape enforces exact source conservation, cost, identity and chronology', () => {
  const original = witness(scenario().state).founding;
  for (const [name, mutate] of foundingMutations) {
    const value = structuredClone(original);
    mutate(value);
    assert.equal(isLandFoundingReceipt(value), false, name);
  }
  for (const value of [null, [], {}, { ...original, paid: null }]) assert.equal(isLandFoundingReceipt(value), false);
});

test('paid land delivery shape enforces authored recipe, full payment, exact path and cadence', () => {
  const original = witness(scenario().state).delivery;
  for (const [name, mutate] of deliveryMutations) {
    const value = structuredClone(original);
    mutate(value);
    assert.equal(isPaidLandDelivery(value), false, name);
  }
  const deferred = structuredClone(original);
  deferred.round += deferred.tradeTerms.cadenceRounds;
  assert.equal(isPaidLandDelivery(deferred), true, 'blocked earlier attempts do not fabricate a delivery sequence');
  for (const value of [null, [], {}, { ...original, proposerPaid: null }]) assert.equal(isPaidLandDelivery(value), false);
});

test('land witness must identify the genuinely founded exact foreign endpoint after its birth', () => {
  const original = witness(scenario().state);
  const cases: Mutation<LandIntegrationWitness>[] = [
    ['unknown branch', value => { value.kind = 'river' as 'land'; }],
    ['extra branch field', extra],
    ['unrelated town', value => { value.delivery.fromCityId = value.founding.sourceCityId; }],
    ['founder is not endpoint owner', value => { value.delivery.owner = (value.delivery.owner + 2) % 5; }],
    ['birth not before payment', value => { value.delivery.revision = value.founding.revision; value.delivery.eventId = `${value.founding.revision}:1`; }],
    ['birth after acceptance', value => { value.founding.round = value.delivery.agreementAcceptedRound + 1; }],
  ];
  for (const [name, mutate] of cases) { const value = structuredClone(original); mutate(value); assert.equal(isLandIntegrationWitness(value), false, name); }
});

test('standalone game events reject malformed births, payments and milestone witnesses', () => {
  const value = scenario();
  const state = value.state;
  state.events.unshift(structuredClone(value.founded.events.find(event => event.landFounding)!));
  for (const original of [foundingEvent(state), deliveryEvent(state), milestoneEvent(state)]) {
    assert.equal(validLandIntegrationEvent(original), true);
    assert.equal(isGameEvent(original), true);
    for (const [name, mutate] of [
      ['wrong type', (event: GameEvent) => { event.type = 'calm'; }],
      ['wrong actor', (event: GameEvent) => { event.actor = 5; }],
      ['wrong target', (event: GameEvent) => { event.target = event.target === 4 ? 3 : 4; }],
      ['wrong tile', (event: GameEvent) => { event.tileId = 9999; }],
      ['wrong round', (event: GameEvent) => { event.round++; }],
      ['wrong event revision', (event: GameEvent) => { event.id = `999999:${event.id.split(':')[1]}`; }],
    ] satisfies Mutation<GameEvent>[]) {
      const event = structuredClone(original); mutate(event);
      assert.equal(isGameEvent(event), false, `${original.type}: ${name}`);
    }
  }
  for (const [name, mutate] of foundingMutations) { const event = foundingEvent(structuredClone(state)); mutate(event.landFounding!); assert.equal(isGameEvent(event), false, `birth ${name}`); }
  for (const [name, mutate] of deliveryMutations) { const event = deliveryEvent(structuredClone(state)); mutate(event.paidTradeDelivery!); assert.equal(isGameEvent(event), false, `delivery ${name}`); }
  const duplicate = foundingEvent(structuredClone(state)); duplicate.paidTradeDelivery = witness(state).delivery;
  assert.equal(isGameEvent(duplicate), false);
});

test('world validation rejects city, proof, retained-event and immutable agreement tampering', () => {
  const base = scenario();
  base.state.events = [structuredClone(base.founded.events.find(event => event.landFounding)!), ...base.state.events.filter(event => event.id !== witness(base.state).founding.eventId).slice(-95)];
  const cases: Mutation<WorldState>[] = [
    ['missing feature', state => { state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== 'earned-land-integration'); }],
    ['missing birth', state => { delete state.cities.find(city => city.id === base.foundedCityId)!.landFounding; }],
    ['initial capital fake birth', state => { state.cities.find(city => city.id === base.sourceCityId)!.landFounding = structuredClone(witness(state).founding); }],
    ['coastal fake birth', state => { state.cities.find(city => city.id === base.foundedCityId)!.coastalFounding = {} as never; }],
    ['altered city birth', state => { state.cities.find(city => city.id === base.foundedCityId)!.landFounding!.sourcePopulationBefore++; }],
    ['retained birth missing payload', state => { delete foundingEvent(state).landFounding; }],
    ['retained payment missing payload', state => { delete deliveryEvent(state).paidTradeDelivery; }],
    ['retained milestone missing witness', state => { delete milestoneEvent(state).landIntegration; }],
    ['missing entire proof', state => { delete state.milestoneProofs!['connected-world']; }],
    ['null proof', state => { state.milestoneProofs!['connected-world'] = null as never; }],
    ['missing connection', state => { delete state.milestoneProofs!['connected-world']!.connection; }],
    ['unknown connection', state => { state.milestoneProofs!['connected-world']!.connection = { kind: 'unknown' } as never; }],
    ['forged coastal branch after pruning', state => { state.events = []; state.milestoneProofs!['connected-world']!.connection = { kind: 'coastal' }; }],
    ['coastal connection extra field', state => { state.milestoneProofs!['connected-world']!.connection = { kind: 'coastal', ruleVersion: 1 } as never; }],
    ['land on different milestone', state => { state.milestoneProofs!['rise-of-states'] = { ...structuredClone(state.milestoneProofs!['connected-world']!), milestoneId: 'rise-of-states' }; }],
    ['historical source tile', state => { state.cities.find(city => city.id === base.sourceCityId)!.tileId = 9999; }],
    ['historical endpoint tile', state => { state.cities.find(city => city.id === base.foreignCityId)!.tileId = 9999; }],
    ['route endpoint', state => { state.routes.find(route => route.id === base.routeId)!.from = base.sourceCityId; }],
    ['route terms', state => { state.routes.find(route => route.id === base.routeId)!.agreement!.terms.proposerCargo = {}; }],
    ['route count', state => { state.routes.find(route => route.id === base.routeId)!.agreement!.deliveryCount = 0; }],
    ['offer endpoint', state => { state.tradeOffers!.find(offer => offer.id === base.offerId)!.from = base.sourceCityId; }],
    ['offer acceptance identity', state => { state.tradeOffers!.find(offer => offer.id === base.offerId)!.routeId = 'route-9999'; }],
    ['future founding', state => { witness(state).founding.round = state.round + 1; }],
    ['future payment', state => { witness(state).delivery.round = state.round + 1; }],
    ['non-current award delivery', state => { state.milestoneProofs!['connected-world']!.revision++; }],
  ];
  for (const [name, mutate] of cases) {
    const state = structuredClone(base.state); mutate(state);
    assert.equal(earnedLandRecords(state), false, name);
    assert.equal(isWorldState(state), false, name);
  }
});

test('frozen history survives synthetic pruning of old receipt bodies and changed populations without resampling old payment', () => {
  const base = scenario();
  const state = landBeat(base.state).state;
  const frozen = witness(state);
  const oldReceiptEvents = new Set([frozen.founding.eventId, frozen.delivery.eventId, state.milestoneProofs!['connected-world']!.eventId]);
  state.events = state.events.filter(event => !oldReceiptEvents.has(event.id));
  assert.ok(state.events.length > 0);
  assert.equal(state.events.some(event => oldReceiptEvents.has(event.id)), false);
  const source = state.cities.find(city => city.id === base.sourceCityId)!;
  const founded = state.cities.find(city => city.id === base.foundedCityId)!;
  source.population = 3;
  founded.population = 2;
  assert.equal(earnedLandRecords(state), true);
  assert.equal(isWorldState(state), true);
  assert.deepEqual(witness(state), witness(base.state));
  assert.equal(isWorldState(JSON.parse(JSON.stringify(state))), true);
});

test('historical checks do not require current ownership, active consent or terrain passability', () => {
  const base = scenario();
  const state = structuredClone(base.state);
  const route = state.routes.find(value => value.id === base.routeId)!;
  route.active = false;
  route.damage = 100;
  route.volume = 0;
  route.agreement!.enabled = false;
  route.agreement!.closedRound = state.round;
  route.agreement!.blockedBy = null;
  route.agreement!.blockedReason = null;
  assert.equal(earnedLandRecords(state), true);
  assert.equal(isWorldState(state), true);
  const founded = state.cities.find(city => city.id === base.foundedCityId)!;
  founded.civId = (founded.civId + 2) % 5;
  state.tiles.find(tile => tile.id === founded.tileId)!.owner = founded.civId;
  const path = witness(state).delivery.tradeTerms.transport!.tileIds;
  state.tiles.find(tile => tile.id === path[1])!.terrain = 'ocean';
  assert.equal(earnedLandRecords(state), true);
});

test('recopied paid events cannot mint a second history identity for one delivery', () => {
  const state = scenario().state;
  const copy = structuredClone(deliveryEvent(state));
  copy.id = `${state.revision}:999`;
  copy.paidTradeDelivery!.eventId = copy.id;
  state.events.push(copy);
  assert.equal(isGameEvent(copy), true);
  assert.equal(earnedLandRecords(state), false);
  assert.equal(isWorldState(state), false);
  state.events = state.events.filter(event => event.id !== witness(state).delivery.eventId);
  assert.equal(earnedLandRecords(state), false, 'the frozen proof retains the original delivery identity after its event is absent');
});

test('pruned founding rejects a foreign source even when frozen birth copies agree', () => {
  const base = scenario();
  const state = landBeat(base.state).state;
  const frozen = witness(state);
  const oldReceiptEvents = new Set([frozen.founding.eventId, frozen.delivery.eventId, state.milestoneProofs!['connected-world']!.eventId]);
  state.events = state.events.filter(event => !oldReceiptEvents.has(event.id));
  assert.ok(state.events.length > 0);
  assert.equal(isWorldState(state), true);
  const foreign = state.cities.find(city => city.id === `city-${city.civId}` && city.civId !== frozen.founding.civId
    && city.id !== frozen.delivery.fromCityId && city.id !== frozen.delivery.toCityId);
  assert.ok(foreign);
  frozen.founding.sourceCityId = foreign.id;
  frozen.founding.sourceTileId = foreign.tileId;
  state.cities.find(city => city.id === frozen.founding.foundedCityId)!.landFounding = structuredClone(frozen.founding);
  assert.equal(isWorldState(state), false);
});
