import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { observeCompactTrade } from '../core/observation.ts';
import type { GameAction, TradeAgreement, TradeOffer, WorldState } from '../core/types.ts';
import { createLandTransportPlanner, isLandTransportQuote, landTransportBlock, landTransportTopologyBlock } from '../core/simulation/transport.ts';
import { resolveTrade } from '../core/simulation/trade.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { isWorldState } from '../core/validation.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();

function endpointsWorld(): WorldState {
  let state = createWorld(1701, epoch, 'settlement-endpoints-1');
  return state;
}

function proposal(state: WorldState, seat: number, partner: number): GameAction {
  const from = state.cities.find(city => city.civId === seat);
  const to = state.cities.find(city => city.civId === partner);
  assert.ok(from && to);
  return { type: 'propose-trade', partner, recipeId: 'harvest-for-materials', sourceCityId: from.id, recipientCityId: to.id };
}

function act(state: WorldState, seat: number, action: GameAction, timestamp = epoch): WorldState {
  const before = structuredClone(state);
  const command = { seat, action, expectedRevision: state.revision, timestamp };
  const result = applyCommand(state, command);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(state, before);
  assert.deepEqual(applyCommand(structuredClone(state), command), result);
  return result.state;
}

function pending(state: WorldState): TradeOffer {
  const offer = state.tradeOffers?.find(candidate => candidate.status === 'pending');
  assert.ok(offer);
  return offer;
}

await test('prospective synthetic feature probe requires actual quoted geography before consent', () => {
  const fixture = endpointsWorld();
  fixture.unlockedFeatures.push('land-transport');
  const state = act(fixture, 2, proposal(fixture, 2, 3));
  const offer = pending(state);
  assert.ok('transport' in offer.terms && offer.terms.transport !== undefined, 'Land proposal must snapshot its actual ordered path');
  assert.ok(offer.terms.cadenceRounds > 4, 'The known ten-edge Ember to Pelagos path requires five beats');
});

await test('legal near and far agreements expose different cadence and deliver only after their accepted interval', (context) => {
  let state = createWorld(1701, epoch, 'settlement-land-transport-1');
  state = act(state, 1, proposal(state, 1, 4));
  const near = pending(state);
  state = act(state, 4, { type: 'respond-trade', offerId: near.id, accept: true });
  state = act(state, 2, proposal(state, 2, 3));
  const far = pending(state);
  state = act(state, 3, { type: 'respond-trade', offerId: far.id, accept: true });
  assert.ok(far.terms.cadenceRounds > near.terms.cadenceRounds);
  const startRound = state.round;
  for (let beat = 1; beat <= 20; beat++) {
    const before = structuredClone(state);
    const result = catchUpStrategy(state, at(beat * 60));
    assert.equal(result.ok, true, result.error);
    const restored: unknown = JSON.parse(JSON.stringify(state));
    assert.ok(isWorldState(restored));
    assert.deepEqual(catchUpStrategy(restored, at(beat * 60)), result);
    assert.deepEqual(state, before);
    state = result.state;
    assert.ok(isWorldState(state));
    for (const offer of [near, far]) {
      const agreement = state.routes.find(route => route.agreement?.offerId === offer.id)?.agreement;
      assert.ok(agreement);
      assert.equal(agreement.acceptedRound, startRound);
      if (beat < offer.terms.cadenceRounds) assert.equal(agreement.deliveryCount, 0);
      assert.equal((agreement.nextDeliveryRound - startRound) % offer.terms.cadenceRounds, 0);
    }
  }
  const counts = state.routes.map(route => ({ offerId: route.agreement?.offerId, cadence: route.agreement?.terms.cadenceRounds, delivered: route.agreement?.deliveryCount }));
  assert.ok(counts.every(row => (row.delivered ?? 0) > 0));
  context.diagnostic(JSON.stringify({ source: 'legal twenty-beat equal-time engine journey, not live play or balance proof', counts }));
  assert.ok((counts.find(row => row.offerId === near.id)?.delivered ?? 0) > (counts.find(row => row.offerId === far.id)?.delivered ?? 0));
  const compact = observeCompactTrade(state, 1, at(1200));
  assert.deepEqual(compact.routes, state.routes.filter(route => route.owner === 1 || route.partner === 1));
  assert.match(compact.tradeFacts.semantics.distance, /land|path/i);
});

await test('legal acceptance off the old global boundary waits its complete quoted interval', () => {
  let state = createWorld(1701, epoch, 'settlement-land-transport-1');
  const advanced = catchUpStrategy(state, at(120));
  assert.equal(advanced.ok, true, advanced.error);
  state = advanced.state;
  assert.equal(state.round, 2);
  state = act(state, 2, proposal(state, 2, 3), at(120));
  const offer = pending(state);
  const quoted = structuredClone(offer.terms);
  state = act(state, 3, { type: 'respond-trade', offerId: offer.id, accept: true }, at(120));
  const route = state.routes.find(candidate => candidate.agreement?.offerId === offer.id);
  assert.ok(route?.agreement);
  assert.deepEqual(route.agreement.terms, quoted);
  assert.equal(route.agreement.nextDeliveryRound, 7);
  assert.ok(isWorldState(state));
  for (let round = 3; round <= 12; round++) {
    const result = catchUpStrategy(state, at(round * 60));
    assert.equal(result.ok, true, result.error);
    state = result.state;
    const agreement: TradeAgreement | undefined = state.routes.find(candidate => candidate.id === route.id)?.agreement;
    assert.ok(agreement);
    assert.equal(agreement.deliveryCount, round < 7 ? 0 : round < 12 ? 1 : 2);
    assert.ok(isWorldState(state));
  }
});

await test('historical pending and accepted abstract agreements keep original terms and globally aligned scheduling', () => {
  let state = endpointsWorld();
  const advance = catchUpStrategy(state, at(120));
  assert.equal(advance.ok, true, advance.error);
  state = advance.state;
  state = act(state, 1, proposal(state, 1, 4), at(120));
  const first = pending(state);
  state = act(state, 4, { type: 'respond-trade', offerId: first.id, accept: true }, at(120));
  state = act(state, 2, proposal(state, 2, 3), at(120));
  const oldOffer = structuredClone(pending(state));
  const oldRoute = structuredClone(state.routes[0]);
  assert.equal(oldOffer.terms.transport, undefined);
  state = act(state, 3, { type: 'respond-trade', offerId: oldOffer.id, accept: true }, at(120));
  assert.deepEqual(state.routes[0], oldRoute);
  const accepted = state.routes.find(route => route.agreement?.offerId === oldOffer.id)?.agreement;
  assert.ok(accepted);
  assert.deepEqual(accepted.terms, oldOffer.terms);
  assert.equal(accepted.nextDeliveryRound, 4);
  assert.ok(isWorldState(state));
});

await test('synthetic quoted-path disruption refuses consent without charging or silently rerouting', () => {
  let state = createWorld(1701, epoch, 'settlement-land-transport-1');
  state = act(state, 2, proposal(state, 2, 3));
  const offer = pending(state);
  const transport = offer.terms.transport;
  assert.ok(transport?.mode === 'land');
  const tile = state.tiles.find(candidate => candidate.id === transport.tileIds[Math.floor(transport.tileIds.length / 2)]);
  assert.ok(tile);
  tile.terrain = 'mountain';
  const from = state.cities.find(city => city.id === offer.from);
  const to = state.cities.find(city => city.id === offer.to);
  assert.ok(from && to);
  assert.ok(createLandTransportPlanner(state).quote(from.tileId, to.tileId), 'An alternate route exists but cannot replace this offered path');
  assert.equal(landTransportTopologyBlock(state, transport, from.tileId, to.tileId), null);
  assert.match(landTransportBlock(state, transport, from.tileId, to.tileId) ?? '', new RegExp(String(tile.id)));
  assert.ok(isWorldState(state), 'Later impassable terrain does not erase historical quote validity');
  const before = structuredClone(state);
  const result = applyCommand(state, { seat: 3, action: { type: 'respond-trade', offerId: offer.id, accept: true }, expectedRevision: state.revision, timestamp: epoch });
  assert.equal(result.ok, false);
  assert.deepEqual(result.state, before);
  assert.deepEqual(state, before);
  assert.equal(legalActions(state, 3, epoch).some(({ action }) => action.type === 'respond-trade' && action.offerId === offer.id && action.accept), false);
});

await test('synthetic future blocked terrain causes zero-payment due attempts and retains the exact path and cadence', () => {
  let state = createWorld(1701, epoch, 'settlement-land-transport-1');
  state = act(state, 2, proposal(state, 2, 3));
  const offer = pending(state);
  state = act(state, 3, { type: 'respond-trade', offerId: offer.id, accept: true });
  const route = state.routes.find(candidate => candidate.agreement?.offerId === offer.id);
  assert.ok(route?.agreement?.terms.transport);
  const agreement = route.agreement;
  const originalTerms = structuredClone(agreement.terms);
  const tile = state.tiles.find(candidate => candidate.id === agreement.terms.transport?.tileIds[2]);
  assert.ok(tile);
  tile.terrain = 'ocean';
  state.round = agreement.nextDeliveryRound;
  const resources = structuredClone(state.civilizations.map(civilization => civilization.resources));
  const events: Parameters<typeof resolveTrade>[1] = [];
  resolveTrade(state, events);
  assert.deepEqual(state.civilizations.map(civilization => civilization.resources), resources);
  assert.deepEqual(agreement.terms, originalTerms);
  assert.equal(agreement.deliveryCount, 0);
  assert.equal(agreement.nextDeliveryRound, state.round + agreement.terms.cadenceRounds);
  assert.equal(route.active, false);
  assert.match(agreement.blockedReason ?? '', new RegExp(String(tile.id)));
  assert.equal(events.some(event => event.type === 'trade-blocked'), true);
});

await test('synthetic disconnected endpoints expose no payable proposal and refuse the exact action atomically', () => {
  const state = createWorld(1701, epoch, 'settlement-land-transport-1');
  const action = proposal(state, 2, 3);
  const destination = state.cities.find(city => city.civId === 3);
  const endpoint = state.tiles.find(tile => tile.id === destination?.tileId);
  assert.ok(endpoint);
  for (const tile of state.tiles) if (hexDistance(endpoint, tile) === 1) tile.terrain = 'mountain';
  const before = structuredClone(state);
  assert.equal(legalActions(state, 2, epoch).some(option => JSON.stringify(option.action) === JSON.stringify(action)), false);
  const result = applyCommand(state, { seat: 2, action, expectedRevision: state.revision, timestamp: epoch });
  assert.equal(result.ok, false);
  assert.deepEqual(result.state, before);
});

await test('shared planner deterministically reuses one bounded tree per source across recipients and recipes', () => {
  const state = endpointsWorld();
  const planner = createLandTransportPlanner(state);
  const reverse = createLandTransportPlanner({ tiles: state.tiles.toReversed() });
  for (const from of state.cities) for (const to of state.cities) {
    if (from === to) continue;
    const quote = planner.quote(from.tileId, to.tileId);
    assert.ok(quote);
    assert.deepEqual(quote, reverse.quote(from.tileId, to.tileId));
    assert.deepEqual(quote, planner.quote(from.tileId, to.tileId));
    assert.equal(isLandTransportQuote(quote, state.tiles.length), true);
    assert.equal(landTransportBlock(state, quote, from.tileId, to.tileId), null);
    quote.tileIds.reverse();
    assert.notDeepEqual(quote, planner.quote(from.tileId, to.tileId));
  }
  assert.equal(planner.work.trees, state.cities.length);
  assert.ok(planner.work.visitedTiles <= state.cities.length * state.tiles.length);
});

await test('quote shape and topology reject malformed, repeated, absent, reversed and nonadjacent tile paths', () => {
  const state = endpointsWorld();
  const from = state.cities[2];
  const to = state.cities[3];
  assert.ok(from && to);
  const quote = createLandTransportPlanner(state).quote(from.tileId, to.tileId);
  assert.ok(quote);
  const sparse: number[] = [];
  sparse.length = 3;
  for (const invalid of [null, {}, { ...quote, mode: 'sea' }, { ...quote, ruleVersion: 2 }, { ...quote, edges: NaN }, { ...quote, extra: true }, { ...quote, tileIds: [from.tileId, from.tileId], edges: 1 }, { ...quote, tileIds: [from.tileId, -1], edges: 1 }, { ...quote, tileIds: sparse, edges: 2 }]) assert.equal(isLandTransportQuote(invalid, state.tiles.length), false);
  assert.notEqual(landTransportTopologyBlock(state, { ...quote, tileIds: quote.tileIds.toReversed() }, from.tileId, to.tileId), null);
  assert.notEqual(landTransportTopologyBlock(state, { ...quote, tileIds: [from.tileId, to.tileId], edges: 1 }, from.tileId, to.tileId), null);
  const absent = structuredClone(quote);
  absent.tileIds[1] = 999999;
  assert.notEqual(landTransportTopologyBlock(state, absent, from.tileId, to.tileId), null);
});

await test('compact land choices retain canonical path and timing facts with finite twenty-five-city payload measurement', (context) => {
  const state = createWorld(1701, epoch, 'settlement-land-transport-1');
  const originals = structuredClone(state.cities);
  const occupied = new Set(state.cities.map(city => city.tileId));
  const sites = state.tiles.filter(tile => !occupied.has(tile.id) && tile.owner === null && tile.terrain !== 'mountain' && tile.terrain !== 'ocean');
  for (let index = 5; index < 25; index++) {
    const template = originals[index % 5];
    const site = sites[index - 5];
    assert.ok(template && site);
    site.owner = template.civId;
    state.cities.push({ ...structuredClone(template), id: `land-fixture-${index}`, name: `Land fixture ${index}`, tileId: site.id, population: 3 });
  }
  const before = structuredClone(state);
  const full = legalActions(state, 0, epoch);
  const compact = observeCompactTrade(state, 0, epoch);
  assert.deepEqual(compact.legalActions.map(option => option.action), full.map(option => option.action));
  const proposals = full.filter(({ action }) => action.type === 'propose-trade');
  assert.equal(proposals.length, 100);
  for (const option of proposals) {
    assert.match(option.reason, /Land path .*edges; exchange every/);
    assert.match(option.reason, /rounds after acceptance/);
    const projected = compact.legalActions.find(candidate => JSON.stringify(candidate.action) === JSON.stringify(option.action));
    assert.ok(option.tradeQuote);
    assert.deepEqual(projected?.tradeQuote, option.tradeQuote);
    assert.doesNotMatch(projected?.reason ?? '', /Terrain:/);
    assert.match(projected?.reason ?? '', /tradeFacts/);
  }
  assert.deepEqual(state, before);
  context.diagnostic(JSON.stringify({ source: 'synthetic finite 25-city land-choice fixture', proposals: proposals.length, totalChoices: full.length, compactBytes: Buffer.byteLength(JSON.stringify(compact)), choiceBytes: Buffer.byteLength(JSON.stringify(full)) }));
});

await test('structured proposal and consent quotes are detached from world, sibling options and compact consumers', () => {
  let state = createWorld(1701, epoch, 'settlement-land-transport-1');
  const before = structuredClone(state);
  const options = legalActions(state, 2, epoch).filter(option => option.action.type === 'propose-trade');
  const first = options[0];
  const second = options[1];
  assert.ok(first?.tradeQuote && second?.tradeQuote);
  const sibling = structuredClone(second);
  first.tradeQuote.transport.tileIds[0] = 99999;
  first.tradeQuote.cadenceRounds = 999;
  assert.deepEqual(second, sibling);
  assert.deepEqual(state, before);
  state = act(state, 2, proposal(state, 2, 3));
  const offer = pending(state);
  const saved = structuredClone(state);
  const acceptance = legalActions(state, 3, epoch).find(({ action }) => action.type === 'respond-trade' && action.offerId === offer.id && action.accept);
  assert.ok(acceptance?.tradeQuote);
  assert.deepEqual(acceptance.tradeQuote.transport, offer.terms.transport);
  acceptance.tradeQuote.transport.tileIds.reverse();
  assert.deepEqual(state, saved);
  const compact = observeCompactTrade(state, 3, epoch);
  const compactAcceptance = compact.legalActions.find(({ action }) => action.type === 'respond-trade' && action.offerId === offer.id && action.accept);
  assert.ok(compactAcceptance?.tradeQuote);
  compactAcceptance.tradeQuote.transport.tileIds[0] = 99999;
  assert.deepEqual(state, saved);
  assert.notDeepEqual(observeCompactTrade(state, 3, epoch), compact);
});
