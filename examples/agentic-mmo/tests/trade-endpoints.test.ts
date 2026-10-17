import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, applyRelease, createWorld, legalActions, observe } from '../core/engine.ts';
import { isGameAction, validateAttachedPlan } from '../core/planning.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { isWorldState } from '../core/validation.ts';
import type { GameAction, WorldState } from '../core/types.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const later = '2026-10-16T00:00:10.000Z';
type EndpointAction = Extract<GameAction, { type: 'propose-trade' }> & { sourceCityId: string; recipientCityId: string };

function released(endpoints: boolean): WorldState {
  let state = createWorld(17, epoch);
  const releases = ['settlement-foundations-2', 'settlement-independent-1', 'settlement-production-1', 'settlement-frontiers-1', 'settlement-specialization-1', 'settlement-recovery-1', 'settlement-civics-1', 'settlement-charters-1'];
  if (endpoints) releases.push('settlement-endpoints-1');
  for (const targetReleaseId of releases) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: epoch });
    assert.equal(result.ok, true, `${targetReleaseId}: ${result.error}`);
    state = result.state;
  }
  assert.ok(isWorldState(state));
  return state;
}

function syntheticCities(count: number, endpoints = true): WorldState {
  const state = released(endpoints);
  const capitals = structuredClone(state.cities);
  const occupied = new Set(state.cities.map((city) => city.tileId));
  const sites = state.tiles.filter((tile) => !occupied.has(tile.id) && tile.owner === null && tile.terrain !== 'ocean' && tile.terrain !== 'mountain');
  for (let n = 5; n < count; n++) {
    const city = capitals[n % 5];
    const site = sites[n - 5];
    assert.ok(city && site);
    site.owner = city.civId;
    state.cities.push({ ...structuredClone(city), id: `endpoint-city-${n}`, name: `Endpoint town ${n}`, tileId: site.id });
  }
  for (const city of state.cities) {
    city.population = 3;
    city.buildings = ['workshop'];
  }
  assert.ok(isWorldState(state));
  return state;
}

function actionFor(state: WorldState): EndpointAction {
  const source = state.cities.filter((city) => city.civId === 0).at(-1);
  const recipient = state.cities.filter((city) => city.civId === 1).at(-1);
  assert.ok(source && recipient);
  return { type: 'propose-trade', partner: 1, recipeId: 'harvest-for-materials', sourceCityId: source.id, recipientCityId: recipient.id };
}

await test('exact endpoint release is explicit and preserves existing assets and old release capability', () => {
  const state = released(false);
  assert.equal(state.unlockedFeatures.includes('exact-trade-endpoints'), false);
  const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-endpoints-1', timestamp: epoch });
  assert.equal(result.ok, true, result.error);
  assert.ok(result.state.unlockedFeatures.includes('exact-trade-endpoints'));
  for (const key of ['cities', 'civilizations', 'tiles', 'routes', 'tradeOffers', 'publicProjects', 'independentTurns'] as const) assert.deepEqual(result.state[key], state[key]);
});

await test('paired endpoint shape rejects missing, one-sided and extraneous fields while exact plan identity includes both cities', () => {
  const action: EndpointAction = { type: 'propose-trade', partner: 1, recipeId: 'harvest-for-materials', sourceCityId: 'source', recipientCityId: 'recipient' };
  assert.equal(isGameAction(action), true);
  assert.equal(isGameAction({ type: 'propose-trade', partner: 1, recipeId: 'harvest-for-materials' }), true);
  for (const invalid of [{ ...action, sourceCityId: '' }, { ...action, recipientCityId: null }, { ...action, extra: true }, { type: 'propose-trade', partner: 1, recipeId: action.recipeId, sourceCityId: action.sourceCityId }, { type: 'propose-trade', partner: 1, recipeId: action.recipeId, recipientCityId: action.recipientCityId }]) assert.equal(isGameAction(invalid), false);
  assert.equal(sameAction(action, { ...action }), true);
  assert.equal(sameAction(action, { ...action, sourceCityId: 'another-source' }), false);
  assert.equal(sameAction(action, { ...action, recipientCityId: 'another-recipient' }), false);
  const state = released(true);
  const command = { seat: 0, action, expectedRevision: state.revision };
  assert.equal(validateAttachedPlan(state, command, [{ action, reason: 'Use this exact pair' }]).ok, true);
  assert.equal(validateAttachedPlan(state, command, [{ action: { ...action, recipientCityId: 'another-recipient' }, reason: 'Different recipient city' }]).ok, false);
});

await test('synthetic multicity fixture chooses noncapital endpoints and consent preserves them after array reorder with exact replay', () => {
  const state = syntheticCities(10);
  const action = actionFor(state);
  const original = structuredClone(state);
  const command = { seat: 0, action, expectedRevision: state.revision, timestamp: epoch };
  const proposed = applyCommand(state, command);
  assert.equal(proposed.ok, true, proposed.error);
  assert.deepEqual(state, original);
  assert.deepEqual(applyCommand(structuredClone(state), command), proposed);
  const offer = proposed.state.tradeOffers?.find((candidate) => candidate.status === 'pending');
  assert.ok(offer);
  assert.equal(offer.from, action.sourceCityId);
  assert.equal(offer.to, action.recipientCityId);
  const reordered = structuredClone(proposed.state);
  reordered.cities.reverse();
  assert.ok(isWorldState(reordered));
  const response = { seat: 1, action: { type: 'respond-trade' as const, offerId: offer.id, accept: true }, expectedRevision: reordered.revision, timestamp: later };
  const accepted = applyCommand(reordered, response);
  assert.equal(accepted.ok, true, accepted.error);
  const route = accepted.state.routes.find((candidate) => candidate.agreement?.offerId === offer.id);
  assert.ok(route);
  assert.equal(route.from, action.sourceCityId);
  assert.equal(route.to, action.recipientCityId);
  assert.deepEqual(route.agreement?.terms, offer.terms);
  assert.equal(route.agreement?.deliveryCount, 0);
  assert.deepEqual(applyCommand(structuredClone(reordered), response), accepted);
  assert.ok(isWorldState(accepted.state));
});

await test('new release missing, one-sided, foreign and disappeared proposal targets refuse without retargeting or spending', () => {
  const state = syntheticCities(10);
  const action = actionFor(state);
  const invalid = [{ type: 'propose-trade', partner: 1, recipeId: action.recipeId }, { type: 'propose-trade', partner: 1, recipeId: action.recipeId, sourceCityId: action.sourceCityId }, { ...action, sourceCityId: 'missing' }, { ...action, recipientCityId: 'missing' }, { ...action, sourceCityId: action.recipientCityId }, { ...action, recipientCityId: action.sourceCityId }, { ...action, recipientCityId: 'city-2' }] as const;
  for (const candidate of invalid) {
    const before = structuredClone(state);
    const result = applyCommand(state, { seat: 0, action: candidate, expectedRevision: state.revision, timestamp: epoch });
    assert.equal(result.ok, false);
    assert.deepEqual(result.state, before);
    assert.deepEqual(state, before);
  }
  const removed = structuredClone(state);
  removed.cities = removed.cities.filter((city) => city.id !== action.sourceCityId);
  assert.ok(isWorldState(removed));
  const result = applyCommand(removed, { seat: 0, action, expectedRevision: removed.revision, timestamp: epoch });
  assert.equal(result.ok, false);
  assert.deepEqual(result.state, removed);
});

await test('isolated lost offered endpoint refuses acceptance even when another eligible city exists', () => {
  const state = syntheticCities(10);
  const action = actionFor(state);
  const proposed = applyCommand(state, { seat: 0, action, expectedRevision: state.revision, timestamp: epoch });
  assert.equal(proposed.ok, true, proposed.error);
  const offer = proposed.state.tradeOffers?.find((candidate) => candidate.status === 'pending');
  assert.ok(offer);
  const fixture = structuredClone(proposed.state);
  fixture.cities = fixture.cities.filter((city) => city.id !== offer.to);
  const before = structuredClone(fixture);
  const result = applyCommand(fixture, { seat: 1, action: { type: 'respond-trade', offerId: offer.id, accept: true }, expectedRevision: fixture.revision, timestamp: later });
  assert.equal(result.ok, false);
  assert.deepEqual(result.state, before);
  assert.deepEqual(fixture, before);
});

await test('older release untargeted proposal retains first-city semantics and exact replay', () => {
  const state = syntheticCities(10, false);
  state.cities.reverse();
  const command = { seat: 0, action: { type: 'propose-trade' as const, partner: 1, recipeId: 'harvest-for-materials' }, expectedRevision: state.revision, timestamp: epoch };
  const result = applyCommand(state, command);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(applyCommand(structuredClone(state), command), result);
  const offer = result.state.tradeOffers?.find((candidate) => candidate.status === 'pending');
  assert.equal(offer?.from, state.cities.find((city) => city.civId === 0)?.id);
  assert.equal(offer?.to, state.cities.find((city) => city.civId === 1)?.id);
  const explicit = applyCommand(state, { ...command, action: actionFor(state) });
  assert.equal(explicit.ok, false);
  assert.deepEqual(explicit.state, state);
});

await test('representative synthetic five and twenty-five city observations expose every endpoint pair and report actual payload growth', (context) => {
  const measured: Array<{ cities: number; proposalChoices: number; totalChoices: number; observationBytes: number; choiceBytes: number }> = [];
  for (const cities of [5, 25]) {
    const state = syntheticCities(cities);
    const before = structuredClone(state);
    const observation = observe(state, 0, epoch);
    const proposals = observation.legalActions.filter(({ action }) => action.type === 'propose-trade');
    assert.equal(proposals.length, cities / 5 * (cities - cities / 5));
    assert.equal(new Set(proposals.map(({ action }) => JSON.stringify(action))).size, proposals.length);
    for (const option of proposals) {
      assert.equal(isGameAction(option.action), true);
      assert.match(option.reason, /Terrain/);
      assert.match(option.reason, /straight.line hex distance/i);
      assert.match(option.reason, /not a traversed path or travel time/i);
      assert.match(option.reason, /civilization.*shared|shared.*civilization/i);
    }
    measured.push({ cities, proposalChoices: proposals.length, totalChoices: observation.legalActions.length, observationBytes: Buffer.byteLength(JSON.stringify(observation)), choiceBytes: Buffer.byteLength(JSON.stringify(observation.legalActions)) });
    assert.deepEqual(state, before);
    assert.deepEqual(legalActions(state, 0, epoch), observation.legalActions);
  }
  assert.ok((measured[1]?.observationBytes ?? 0) > (measured[0]?.observationBytes ?? 0));
  context.diagnostic(JSON.stringify({ source: 'synthetic finite endpoint-choice fixture, not live play or universal payload bound', measured }));
});

await test('actual conserved founding creates two noncapital towns that can consent to an exact endpoint exchange', () => {
  let state = released(true);
  const newCities: string[] = [];
  for (const seat of [0, 1]) {
    const option = legalActions(state, seat, epoch).find(({ action }) => action.type === 'settle');
    assert.ok(option);
    const command = { seat, action: option.action, expectedRevision: state.revision, timestamp: epoch };
    const before = structuredClone(state);
    const result = applyCommand(state, command);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(state, before);
    assert.deepEqual(applyCommand(structuredClone(state), command), result);
    state = result.state;
    assert.ok(isWorldState(state));
    const city = state.cities.filter((candidate) => candidate.civId === seat).at(-1);
    assert.ok(city);
    newCities.push(city.id);
  }
  const sourceCityId = newCities[0];
  const recipientCityId = newCities[1];
  assert.ok(sourceCityId && recipientCityId);
  const action: EndpointAction = { type: 'propose-trade', partner: 1, recipeId: 'harvest-for-materials', sourceCityId, recipientCityId };
  const command = { seat: 0, action, expectedRevision: state.revision, timestamp: later, plan: [{ action, reason: 'Connect these newly founded towns by exact consent' }] };
  const proposed = applyCommand(state, command);
  assert.equal(proposed.ok, true, proposed.error);
  assert.deepEqual(applyCommand(structuredClone(state), command), proposed);
  const offer = proposed.state.tradeOffers?.find((candidate) => candidate.status === 'pending');
  assert.ok(offer);
  assert.equal(offer.from, sourceCityId);
  assert.equal(offer.to, recipientCityId);
  const response = { seat: 1, action: { type: 'respond-trade' as const, offerId: offer.id, accept: true }, expectedRevision: proposed.state.revision, timestamp: later };
  const result = applyCommand(proposed.state, response);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(applyCommand(structuredClone(proposed.state), response), result);
  assert.ok(isWorldState(result.state));
  assert.equal(result.state.routes[0]?.from, sourceCityId);
  assert.equal(result.state.routes[0]?.to, recipientCityId);
});

await test('endpoint release preserves grandfathered accepted routes and pending offer endpoint consent', () => {
  let state = syntheticCities(10, false);
  for (const [seat, partner] of [[0, 1], [2, 3]] as const) {
    const proposed = applyCommand(state, { seat, action: { type: 'propose-trade', partner, recipeId: 'harvest-for-materials' }, expectedRevision: state.revision, timestamp: epoch });
    assert.equal(proposed.ok, true, proposed.error);
    state = proposed.state;
    if (seat === 0) {
      const offer = state.tradeOffers?.find((candidate) => candidate.proposer === seat);
      assert.ok(offer);
      const result = applyCommand(state, { seat: partner, action: { type: 'respond-trade', offerId: offer.id, accept: true }, expectedRevision: state.revision, timestamp: epoch });
      assert.equal(result.ok, true, result.error);
      state = result.state;
    }
  }
  const before = structuredClone(state);
  const upgraded = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-endpoints-1', timestamp: epoch });
  assert.equal(upgraded.ok, true, upgraded.error);
  assert.deepEqual(upgraded.state.routes, before.routes);
  assert.deepEqual(upgraded.state.tradeOffers, before.tradeOffers);
  const pending = upgraded.state.tradeOffers?.find((offer) => offer.status === 'pending');
  assert.ok(pending);
  upgraded.state.cities.reverse();
  const result = applyCommand(upgraded.state, { seat: 3, action: { type: 'respond-trade', offerId: pending.id, accept: true }, expectedRevision: upgraded.state.revision, timestamp: later });
  assert.equal(result.ok, true, result.error);
  const route = result.state.routes.find((candidate) => candidate.agreement?.offerId === pending.id);
  assert.equal(route?.from, pending.from);
  assert.equal(route?.to, pending.to);
  assert.deepEqual(route?.agreement?.terms, pending.terms);
  assert.deepEqual(result.state.routes[0], before.routes[0]);
});
