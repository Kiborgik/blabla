import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import { RELEASES } from '../core/release.ts';
import { RELIEF_RULES } from '../core/relief-content.ts';
import { isReliefAction, isReliefResult, isReliefState, validReliefEvent } from '../core/relief-validation.ts';
import { createReliefState, executeReliefAction, resolveReliefCharters } from '../core/simulation/relief-charters.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { executeTradeAction, resolveTrade } from '../core/simulation/trade.ts';
import { isGameEvent, isWorldState } from '../core/validation.ts';
import type { GameEvent, WorldState } from '../core/types.ts';
import type { ReliefState } from '../core/relief-types.ts';

const epoch = '2026-10-22T00:00:00.000Z';
function syntheticAccepted(): WorldState {
  const target = RELEASES.find(release => release.featureIds.includes(RELIEF_RULES.featureId)); assert.ok(target);
  const state = createWorld(1701, epoch, target.id);
  const donor = state.cities.find(city => city.civId === 1)!; const recipient = state.cities.find(city => city.civId === 4)!;
  state.revision++; let events: GameEvent[] = [];
  executeTradeAction(state, 1, { type: 'propose-trade', partner: 4, recipeId: 'harvest-for-materials', sourceCityId: donor.id, recipientCityId: recipient.id }, events); commitEvents(state, events);
  state.revision++; events = []; executeTradeAction(state, 4, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true }, events); commitEvents(state, events);
  donor.population = 10; recipient.population = 30; state.civilizations[1]!.resources.food = 100; state.civilizations[1]!.resources.energy = 30; state.civilizations[4]!.resources.food = 0;
  assert.ok(isWorldState(state), 'synthetic stock/population fixture preserves all canonical persistence invariants');
  state.revision++; events = []; assert.ok(executeReliefAction(state, 1, { type: 'propose-relief', routeId: state.routes[0]!.id, sourceCityId: donor.id, recipientCityId: recipient.id }, events)); commitEvents(state, events);
  assert.ok(isWorldState(state));
  state.revision++; events = []; assert.ok(executeReliefAction(state, 4, { type: 'respond-relief', charterId: state.relief!.active[0]!.id, accept: true }, events)); commitEvents(state, events);
  assert.ok(isWorldState(state)); return state;
}
function beat(state: WorldState): GameEvent[] { state.round++; state.revision++; const events: GameEvent[] = []; resolveTrade(state, events); resolveReliefCharters(state, events); commitEvents(state, events); return events; }
function delivered(): WorldState { const state = syntheticAccepted(); while (state.relief!.active.length) beat(state); return state; }

void test('synthetic additive release initializes a bounded empty ledger without rewriting historical worlds', () => {
  const old = createWorld(1701); assert.ok(isWorldState(old)); assert.equal(Object.hasOwn(old, 'relief'), false);
  const wrong = structuredClone(old); wrong.relief = createReliefState(wrong); assert.equal(isWorldState(wrong), false);
  const state = syntheticAccepted(); const absent = structuredClone(state); delete absent.relief; assert.equal(isWorldState(absent), false);
  assert.equal(state.relief!.lastResults.length, state.civilizations.length); assert.ok(state.relief!.lastResults.every(value => value === null));
});

void test('synthetic mid-charter JSON restart yields byte-equivalent delivery, durable receipt and no repeat after event pruning', () => {
  const state = syntheticAccepted(); beat(state); const restored = JSON.parse(JSON.stringify(state)) as WorldState;
  for (let count = 0; count < 8; count++) { assert.deepEqual(beat(state), beat(restored)); assert.deepEqual(state, restored); assert.ok(isWorldState(state)); }
  const receipt = structuredClone(state.relief!.lastResults[1]); state.events = []; const pruned = JSON.parse(JSON.stringify(state)) as WorldState;
  assert.ok(isWorldState(pruned)); const before = structuredClone(pruned); const events: GameEvent[] = []; resolveReliefCharters(pruned, events); assert.deepEqual(pruned, before); assert.deepEqual(events, []); assert.deepEqual(pruned.relief!.lastResults[1], receipt);
});

void test('synthetic strict action schema rejects excess fields, sparse terms, false booleans and malformed identifiers', () => {
  assert.ok(isReliefAction({ type: 'propose-relief', routeId: 'route-1', sourceCityId: 'city-1', recipientCityId: 'city-4' }));
  assert.ok(isReliefAction({ type: 'respond-relief', charterId: 'relief-1-1', accept: false }));
  assert.ok(isReliefAction({ type: 'withdraw-relief', charterId: 'relief-1-1' }));
  for (const action of [null, [], { type: 'withdraw-relief', charterId: '' }, { type: 'respond-relief', charterId: 'relief-1-1', accept: 1 }, { type: 'propose-relief', routeId: 'route-1', sourceCityId: 'city-1', recipientCityId: 'city-4', food: 30 }, { type: 'withdraw-relief', charterId: 'relief-1-1', arbitrary: true }]) assert.equal(isReliefAction(action), false);
});

void test('synthetic strict active schema rejects unknown versions, sparse arrays, bad sequences, wrong paths, timing and quantity corruption', () => {
  const state = syntheticAccepted();
  const corruptions: Array<[string, (layer: ReliefState) => void]> = [
    ['version', layer => { (layer as { ruleVersion: number }).ruleVersion = 2; }],
    ['extra', layer => { Object.assign(layer, { ignored: true }); }],
    ['sparse results', layer => { delete layer.lastResults[0]; }],
    ['short results', layer => { layer.lastResults.pop(); }],
    ['sparse active', layer => { delete layer.active[0]; }],
    ['duplicate donor', layer => { layer.active.push(structuredClone(layer.active[0]!)); }],
    ['sequence', layer => { layer.active[0]!.sequence = 2; }],
    ['ID', layer => { layer.active[0]!.id = 'relief-1-999'; }],
    ['future proposal', layer => { layer.active[0]!.proposedRound = state.round + 1; }],
    ['due', layer => { const active = layer.active[0]!; if (active.status === 'accepted') active.dueRound++; }],
    ['status excess', layer => { Object.assign(layer.active[0]!, { expiresRound: 4 }); }],
    ['Food resize', layer => { layer.active[0]!.terms.food--; }],
    ['cost', layer => { (layer.active[0]!.terms as { energy: number }).energy = 0; }],
    ['proposal need', layer => { layer.active[0]!.terms.proposal.recipientFood = 30; }],
    ['path gap', layer => { layer.active[0]!.terms.path.tileIds[1] = 0; }],
    ['path sparse', layer => { delete layer.active[0]!.terms.path.tileIds[1]; }],
    ['unsafe', layer => { layer.active[0]!.terms.proposal.donorFood = Infinity; }],
  ];
  for (const [name, corrupt] of corruptions) { const candidate = structuredClone(state); corrupt(candidate.relief!); assert.equal(isReliefState(candidate.relief, candidate), false, name); assert.equal(isWorldState(candidate), false, name); }
});

void test('synthetic retained receipts reject corruption even after event history is pruned', () => {
  const state = delivered(); state.events = []; assert.ok(isWorldState(state));
  const corruptions: Array<[string, (layer: ReliefState) => void]> = [
    ['paid', layer => { layer.lastResults[1]!.paid.energy = 0; }],
    ['partial', layer => { layer.lastResults[1]!.deliveredFood--; }],
    ['mint', layer => { layer.lastResults[1]!.after.recipientFood++; }],
    ['no debit', layer => { layer.lastResults[1]!.after.donorFood++; }],
    ['wrong slot', layer => { layer.lastResults[0] = layer.lastResults[1]!; layer.lastResults[1] = null; }],
    ['future event', layer => { layer.lastResults[1]!.eventId = `${state.revision + 1}:0`; }],
    ['too early', layer => { layer.lastResults[1]!.resolvedRound = 0; }],
    ['outcome', layer => { layer.lastResults[1]!.outcome = 'failed'; }],
    ['actor', layer => { layer.lastResults[1]!.actor = 1; }],
    ['reason', layer => { layer.lastResults[1]!.reason = ''; }],
  ];
  for (const [name, corrupt] of corruptions) { const candidate = structuredClone(state); corrupt(candidate.relief!); assert.equal(isWorldState(candidate), false, name); }
});

void test('synthetic event validation binds exact result, actor, target, round and charter identity and catches retained-result equivocation', () => {
  const state = delivered(); const event = state.events.find(event => event.reliefResult)!;
  assert.ok(isReliefResult(event.reliefResult)); assert.ok(validReliefEvent(event)); assert.ok(isGameEvent(event));
  for (const patch of [{ type: 'relief-failed' }, { actor: 1 }, { target: 0 }, { round: event.round + 1 }, { detail: 'different-charter' }, { tileId: 0 }, { cause: 'not the retained reason' }]) {
    const changed = { ...structuredClone(event), ...patch }; assert.equal(validReliefEvent(changed), false); assert.equal(isGameEvent(changed), false);
  }
  const missing = structuredClone(event); delete missing.reliefResult; assert.equal(isGameEvent(missing), false);
  const equivocal = structuredClone(state); equivocal.relief!.lastResults[1]!.reason = 'Different supported-looking historical explanation'; assert.equal(isWorldState(equivocal), false);
});

void test('synthetic two-donor retained history rejects shared event identity even after complete event pruning', () => {
  const state = delivered();
  const source = state.cities.find(city => city.civId === 2)!; const recipient = state.cities.find(city => city.civId === 3)!;
  state.revision++; let events: GameEvent[] = [];
  executeTradeAction(state, 2, { type: 'propose-trade', partner: 3, recipeId: 'harvest-for-materials', sourceCityId: source.id, recipientCityId: recipient.id }, events); commitEvents(state, events);
  state.revision++; events = []; executeTradeAction(state, 3, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true }, events); commitEvents(state, events);
  source.population = 10; recipient.population = 30; state.civilizations[2]!.resources.food = 100; state.civilizations[2]!.resources.energy = 30; state.civilizations[3]!.resources.food = 0;
  assert.ok(isWorldState(state));
  state.revision++; events = []; assert.ok(executeReliefAction(state, 2, { type: 'propose-relief', routeId: state.routes.at(-1)!.id, sourceCityId: source.id, recipientCityId: recipient.id }, events)); commitEvents(state, events);
  state.revision++; events = []; assert.ok(executeReliefAction(state, 3, { type: 'respond-relief', charterId: state.relief!.active[0]!.id, accept: true }, events)); commitEvents(state, events);
  while (state.relief!.active.length) beat(state);
  assert.equal(state.relief!.lastResults[1]!.outcome, 'delivered'); assert.equal(state.relief!.lastResults[2]!.outcome, 'delivered');
  assert.notEqual(state.relief!.lastResults[1]!.eventId, state.relief!.lastResults[2]!.eventId);
  state.events = []; assert.ok(isWorldState(state));
  const corrupt = structuredClone(state); corrupt.relief!.lastResults[2]!.eventId = corrupt.relief!.lastResults[1]!.eventId;
  assert.equal(isReliefState(corrupt.relief, corrupt), false); assert.equal(isWorldState(corrupt), false);
});

void test('synthetic pruned receipt cannot claim a second charter before the minimum donor cooldown history', () => {
  const state = delivered(); state.events = [];
  const result = state.relief!.lastResults[1]!; result.charter.sequence = 2; result.charter.id = 'relief-1-2';
  assert.equal(isReliefResult(result), false); assert.equal(isReliefState(state.relief, state), false); assert.equal(isWorldState(state), false);
});

void test('synthetic retained earlier results constrain later proposal cooldown and terminal event revision', () => {
  const state = delivered(); const first = structuredClone(state.relief!.lastResults[1]!);
  while (state.round < first.resolvedRound + RELIEF_RULES.cooldownRounds) beat(state);
  state.civilizations[1]!.resources.food = 100; state.civilizations[1]!.resources.energy = 30; state.civilizations[4]!.resources.food = 0;
  const source = state.cities.find(city => city.civId === 1)!; const recipient = state.cities.find(city => city.civId === 4)!;
  state.revision++; let events: GameEvent[] = [];
  assert.ok(executeReliefAction(state, 1, { type: 'propose-relief', routeId: state.routes[0]!.id, sourceCityId: source.id, recipientCityId: recipient.id }, events)); commitEvents(state, events);
  state.revision++; events = []; assert.ok(executeReliefAction(state, 4, { type: 'respond-relief', charterId: state.relief!.active[0]!.id, accept: true }, events)); commitEvents(state, events);
  while (state.relief!.active.length) beat(state);
  state.events = state.events.filter(event => event.id === first.eventId); assert.ok(isWorldState(state));
  const early = structuredClone(state); const earlier = early.relief!.lastResults[1]!; assert.equal(earlier.charter.status, 'accepted');
  if (earlier.charter.status !== 'accepted') return;
  earlier.charter.proposedRound = RELIEF_RULES.cooldownRounds; earlier.charter.acceptedRound = RELIEF_RULES.cooldownRounds; earlier.charter.dueRound = RELIEF_RULES.cooldownRounds + earlier.charter.terms.travelRounds;
  assert.ok(isReliefResult(earlier)); assert.equal(isWorldState(early), false);
  const reordered = structuredClone(state); reordered.relief!.lastResults[1]!.eventId = `${first.eventId.split(':')[0]}:999`;
  assert.ok(isReliefResult(reordered.relief!.lastResults[1])); assert.equal(isWorldState(reordered), false);
});
