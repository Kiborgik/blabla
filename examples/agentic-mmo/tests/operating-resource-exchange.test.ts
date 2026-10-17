import assert from 'node:assert/strict';
import test from 'node:test';
import { RESOURCE_IDS, TRADE_RECIPES } from '../core/content.ts';
import { applyCommand, applyRelease, catchUpStrategy, createWorld, legalActions, observe } from '../core/engine.ts';
import { observeCompactTrade } from '../core/observation.ts';
import { resolveTrade } from '../core/simulation/trade.ts';
import { isWorldState } from '../core/validation.ts';
import type { BuildingOperationResult, GameAction, Resources, TradeOffer, WorldState } from '../core/types.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const timestamp = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const recipeId = 'energy-for-materials';
const releaseId = 'settlement-operating-exchange-1';

function landWorld(): WorldState {
  let state = createWorld(1701, epoch);
  for (const targetReleaseId of ['settlement-foundations-2', 'settlement-independent-1', 'settlement-production-1', 'settlement-frontiers-1', 'settlement-specialization-1', 'settlement-recovery-1', 'settlement-civics-1', 'settlement-charters-1', 'settlement-endpoints-1', 'settlement-land-transport-1']) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: epoch });
    assert.equal(result.ok, true, result.error);
    state = result.state;
  }
  return state;
}

function released(): WorldState {
  const state = landWorld();
  const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: releaseId, timestamp: epoch });
  assert.equal(result.ok, true, result.error);
  assert.ok(isWorldState(result.state));
  return result.state;
}

function action(state: WorldState, proposer = 1, recipient = 4, recipe = recipeId): GameAction {
  const from = state.cities.find(city => city.civId === proposer);
  const to = state.cities.find(city => city.civId === recipient);
  assert.ok(from && to);
  return { type: 'propose-trade', partner: recipient, recipeId: recipe, sourceCityId: from.id, recipientCityId: to.id };
}

function act(state: WorldState, seat: number, candidate: GameAction, seconds = 0): WorldState {
  const before = structuredClone(state);
  const command = { seat, action: candidate, expectedRevision: state.revision, timestamp: timestamp(seconds) };
  const restored: unknown = JSON.parse(JSON.stringify(state));
  assert.ok(isWorldState(restored));
  const result = applyCommand(state, command);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(applyCommand(restored, command), result);
  assert.deepEqual(state, before);
  assert.ok(isWorldState(result.state));
  return result.state;
}

function beat(state: WorldState, round: number): WorldState {
  const before = structuredClone(state);
  const restored: unknown = JSON.parse(JSON.stringify(state));
  assert.ok(isWorldState(restored));
  const result = catchUpStrategy(state, timestamp(round * 60));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(catchUpStrategy(restored, timestamp(round * 60)), result);
  assert.deepEqual(state, before);
  assert.ok(isWorldState(result.state));
  return result.state;
}

function pending(state: WorldState): TradeOffer {
  const offer = state.tradeOffers?.find(candidate => candidate.status === 'pending');
  assert.ok(offer);
  return offer;
}

function resources(state: WorldState, seat: number): Resources {
  const civilization = state.civilizations.find(candidate => candidate.id === seat);
  assert.ok(civilization);
  return civilization.resources;
}

await test('catalogue defines the approved conserved gross energy exchange and separate upkeep vectors', () => {
  const recipe = TRADE_RECIPES.find(candidate => candidate.id === recipeId);
  assert.ok(recipe, 'Energy exchange must be a real released catalogue recipe');
  assert.equal(recipe.version, 1);
  assert.ok(recipe.requiredFeatures.includes('operating-resource-exchange'));
  assert.deepEqual(recipe.terms.proposerCargo, { energy: 4 });
  assert.deepEqual(recipe.terms.recipientCargo, { materials: 3 });
  assert.deepEqual(recipe.terms.proposerUpkeep, { energy: 1 });
  assert.deepEqual(recipe.terms.recipientUpkeep, { energy: 1 });
  assert.deepEqual(recipe.terms.proposerYield, { credits: 2 });
  assert.deepEqual(recipe.terms.recipientYield, { credits: 2 });
  assert.deepEqual(recipe.terms.constructionCost, { materials: 6, credits: 8 });
  assert.equal(recipe.terms.cadenceRounds, 4);
  assert.equal(recipe.terms.damageDisableAt, 50);
});

await test('new content is absent from the prior release and explicit adoption preserves every prior world asset', () => {
  const old = landWorld();
  assert.equal(legalActions(old, 1, epoch).some(option => option.action.type === 'propose-trade' && option.action.recipeId === recipeId), false);
  assert.equal(observeCompactTrade(old, 1, epoch).tradeFacts.recipes.some(recipe => recipe.id === recipeId), false);
  const refused = applyCommand(old, { seat: 1, action: action(old), expectedRevision: old.revision, timestamp: epoch });
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.state, old);
  const state = released();
  assert.ok(state.unlockedFeatures.includes('operating-resource-exchange'));
  for (const key of ['civilizations', 'cities', 'tiles', 'routes', 'tradeOffers', 'calendarMilestones', 'clockTicks', 'year', 'round'] as const) assert.deepEqual(state[key], old[key]);
});

await test('legal consent snapshots the shown vectors and path, then due delivery changes exact resources against a legally stopped control', (context) => {
  let state = released();
  const proposedAction = action(state);
  const option = legalActions(state, 1, epoch).find(candidate => JSON.stringify(candidate.action) === JSON.stringify(proposedAction));
  assert.ok(option?.tradeQuote);
  const initial = structuredClone(state.civilizations.map(civilization => civilization.resources));
  state = act(state, 1, proposedAction);
  assert.deepEqual(state.civilizations.map(civilization => civilization.resources), initial);
  const offer = pending(state);
  assert.equal(offer.terms.recipeId, recipeId);
  assert.deepEqual(offer.terms.transport, option.tradeQuote.transport);
  assert.equal(offer.terms.cadenceRounds, option.tradeQuote.cadenceRounds);
  const importer = structuredClone(resources(state, 4));
  const exporter = structuredClone(resources(state, 1));
  state = act(state, 4, { type: 'respond-trade', offerId: offer.id, accept: true });
  assert.deepEqual(resources(state, 4), importer);
  for (const resource of RESOURCE_IDS) assert.equal(resources(state, 1)[resource], exporter[resource] - (offer.terms.constructionCost[resource] ?? 0));
  const route = state.routes.find(candidate => candidate.agreement?.offerId === offer.id);
  assert.ok(route?.agreement);
  assert.deepEqual(route.agreement.terms, offer.terms);
  assert.equal(route.agreement.deliveryCount, 0);
  const due = route.agreement.nextDeliveryRound;
  for (let round = 1; round < due; round++) {
    state = beat(state, round);
    assert.equal(state.routes.find(candidate => candidate.id === route.id)?.agreement?.deliveryCount, 0);
  }
  const stopped = act(state, 1, { type: 'stop-trade', routeId: route.id }, (due - 1) * 60 + 10);
  const delivered = beat(state, due);
  const control = beat(stopped, due);
  for (const seat of [1, 4]) for (const resource of RESOURCE_IDS) {
    const net: Partial<Resources> = seat === 1 ? { energy: -5, materials: 3, credits: 2 } : { energy: 3, materials: -3, credits: 2 };
    assert.ok(Math.abs(resources(delivered, seat)[resource] - resources(control, seat)[resource] - (net[resource] ?? 0)) < 0.000001);
  }
  assert.equal(delivered.routes.find(candidate => candidate.id === route.id)?.agreement?.deliveryCount, 1);
  assert.equal(control.routes.find(candidate => candidate.id === route.id)?.agreement?.deliveryCount, 0);
  assert.ok(delivered.events.some(event => event.type === 'trade-delivered' && event.detail === route.id));
  context.diagnostic(JSON.stringify({ source: 'legal release, proposal, consent, stopped-control and due transitions; no forged resources or progress', due, edges: offer.terms.transport?.edges, exporterNet: { energy: -5, materials: 3, credits: 2 }, importerNet: { energy: 3, materials: -3, credits: 2 } }));
});

function agreedWorld(): WorldState {
  let state = released();
  state = act(state, 1, action(state));
  const offer = pending(state);
  return act(state, 4, { type: 'respond-trade', offerId: offer.id, accept: true });
}

await test('isolated delivery scarcity requires exporter cargo plus upkeep and importer upkeep before incoming energy', () => {
  for (const scarce of ['exporter', 'importer'] as const) {
    const fixture = agreedWorld();
    const route = fixture.routes[0];
    assert.ok(route?.agreement);
    fixture.round = route.agreement.nextDeliveryRound;
    resources(fixture, 1).energy = scarce === 'exporter' ? 4 : 20;
    resources(fixture, 4).energy = scarce === 'importer' ? 0 : 1;
    resources(fixture, 4).materials = 20;
    const before = structuredClone(fixture.civilizations.map(civilization => civilization.resources));
    const events: Parameters<typeof resolveTrade>[1] = [];
    resolveTrade(fixture, events);
    assert.deepEqual(fixture.civilizations.map(civilization => civilization.resources), before);
    assert.equal(route.agreement.deliveryCount, 0);
    assert.equal(route.agreement.blockedBy, scarce === 'exporter' ? 1 : 4);
    assert.match(route.agreement.blockedReason ?? '', /Combined cargo and upkeep shortage.*energy/);
    assert.equal(events.some(event => event.type === 'trade-blocked'), true);
  }
});

function kilnAndAgreement(): WorldState {
  let state = released();
  for (const technology of ['agriculture', 'kiln-firing']) {
    state = act(state, 4, { type: 'research', technology }, state.round * 60);
    for (let remaining = 30; remaining > 0; remaining--) {
      if (state.civilizations.find(civilization => civilization.id === 4)?.technologies.includes(technology)) break;
      state = beat(state, state.round + 1);
    }
    assert.ok(state.civilizations.find(civilization => civilization.id === 4)?.technologies.includes(technology));
  }
  const city = state.cities.find(candidate => candidate.civId === 4);
  assert.ok(city);
  state = act(state, 4, { type: 'build', project: 'kiln', cityId: city.id }, state.round * 60);
  state = act(state, 1, action(state), state.round * 60);
  const offer = pending(state);
  state = act(state, 4, { type: 'respond-trade', offerId: offer.id, accept: true }, state.round * 60 + 10);
  const agreement = state.routes.find(route => route.agreement?.offerId === offer.id)?.agreement;
  assert.ok(agreement);
  while (state.round < agreement.nextDeliveryRound - 1) state = beat(state, state.round + 1);
  return state;
}

await test('isolated opening-stock shortage stays blocked on delivery beat, then imported fuel enables the next kiln operation', (context) => {
  const fixture = kilnAndAgreement();
  const city = fixture.cities.find(candidate => candidate.civId === 4);
  const route = fixture.routes[0];
  assert.ok(city && route?.agreement);
  resources(fixture, 4).energy = 1;
  city.damage = 50;
  assert.ok(isWorldState(fixture));
  const stopped = act(fixture, 1, { type: 'stop-trade', routeId: route.id }, fixture.round * 60 + 10);
  const due = route.agreement.nextDeliveryRound;
  const delivered = beat(fixture, due);
  const control = beat(stopped, due);
  for (const state of [delivered, control]) {
    const result: BuildingOperationResult | null | undefined = state.cities.find(candidate => candidate.id === city.id)?.buildingOperations?.kiln?.lastResult;
    assert.equal(result?.status, 'blocked');
    assert.deepEqual(result.paid, {});
    assert.deepEqual(result.produced, {});
    assert.ok(result.shortages.some(shortage => shortage.resource === 'energy' && shortage.available === 1 && shortage.required === 2));
  }
  assert.equal(delivered.routes[0]?.agreement?.deliveryCount, 1);
  assert.ok(resources(control, 4).energy < 2, 'Natural production alone does not fund the next opening stock in this labeled scarcity fixture');
  assert.ok(resources(delivered, 4).energy >= 2);
  assert.ok(Math.abs(resources(delivered, 4).energy - resources(control, 4).energy - 3) < 0.000001);
  const next = beat(delivered, due + 1);
  const noImport = beat(control, due + 1);
  const receipt = next.cities.find(candidate => candidate.id === city.id)?.buildingOperations?.kiln?.lastResult;
  assert.equal(receipt?.status, 'operated');
  assert.deepEqual(receipt.paid, { energy: 2 });
  assert.ok((receipt.produced.materials ?? 0) > 0);
  assert.equal(noImport.cities.find(candidate => candidate.id === city.id)?.buildingOperations?.kiln?.lastResult?.status, 'blocked');
  context.diagnostic(JSON.stringify({ source: 'synthetic scarce energy1 and damage50 applied after legal research/build/consent; not a legal depletion journey', due, deliveredOpeningNext: resources(delivered, 4).energy, stoppedOpeningNext: resources(control, 4).energy, actualNextKiln: receipt }));
});

await test('release preserves old pending and accepted food terms and switching requires explicit stop and fresh consent', () => {
  let state = landWorld();
  state = act(state, 2, action(state, 2, 3, 'harvest-for-materials'));
  const first = pending(state);
  state = act(state, 3, { type: 'respond-trade', offerId: first.id, accept: true });
  state = act(state, 1, action(state, 1, 4, 'harvest-for-materials'));
  const oldOffer = structuredClone(pending(state));
  const oldRoutes = structuredClone(state.routes);
  const upgraded = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: releaseId, timestamp: epoch });
  assert.equal(upgraded.ok, true, upgraded.error);
  assert.deepEqual(upgraded.state.routes, oldRoutes);
  assert.deepEqual(upgraded.state.tradeOffers, state.tradeOffers);
  state = act(upgraded.state, 4, { type: 'respond-trade', offerId: oldOffer.id, accept: true });
  const foodRoute = state.routes.find(route => route.agreement?.offerId === oldOffer.id);
  assert.ok(foodRoute?.agreement);
  assert.deepEqual(foodRoute.agreement.terms, oldOffer.terms);
  const invalid = applyCommand(state, { seat: 1, action: action(state), expectedRevision: state.revision, timestamp: timestamp(10) });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.state, state);
  state = act(state, 1, { type: 'stop-trade', routeId: foodRoute.id }, 10);
  const paidBefore = structuredClone(resources(state, 1));
  state = act(state, 1, action(state), 20);
  const energyOffer = pending(state);
  assert.equal(energyOffer.terms.recipeId, recipeId);
  state = act(state, 4, { type: 'respond-trade', offerId: energyOffer.id, accept: true }, 20);
  assert.equal(resources(state, 1).materials, paidBefore.materials - 6);
  assert.equal(resources(state, 1).credits, paidBefore.credits - 8);
  assert.deepEqual(state.routes.find(route => route.id === foodRoute.id)?.agreement?.terms, oldOffer.terms);
  assert.equal(state.routes.find(route => route.id === foodRoute.id)?.agreement?.enabled, false);
});

await test('current recipe tuning cannot rewrite stored gross vectors, path or due schedule', () => {
  let state = released();
  state = act(state, 1, action(state));
  const offered = structuredClone(pending(state));
  const recipe = TRADE_RECIPES.find(candidate => candidate.id === recipeId);
  assert.ok(recipe);
  const original = structuredClone(recipe.terms);
  try {
    recipe.terms.proposerCargo.energy = 40;
    recipe.terms.recipientCargo.materials = 30;
    recipe.terms.cadenceRounds = 99;
    state = act(state, 4, { type: 'respond-trade', offerId: offered.id, accept: true });
    const route = state.routes.find(candidate => candidate.agreement?.offerId === offered.id);
    assert.deepEqual(route?.agreement?.terms, offered.terms);
    assert.equal(route?.agreement?.nextDeliveryRound, state.round + offered.terms.cadenceRounds);
    assert.ok(isWorldState(state));
    assert.deepEqual(observeCompactTrade(state, 4, epoch).routes.find(candidate => candidate.id === route?.id)?.agreement?.terms, offered.terms);
  } finally { recipe.terms = original; }
});

await test('ordinary and compact observations retain two recipes and every exact town pair without truncation', (context) => {
  const state = released();
  const capitals = structuredClone(state.cities);
  const occupied = new Set(state.cities.map(city => city.tileId));
  const sites = state.tiles.filter(tile => !occupied.has(tile.id) && tile.owner === null && tile.terrain !== 'mountain' && tile.terrain !== 'ocean');
  for (let index = 5; index < 25; index++) {
    const template = capitals[index % 5];
    const site = sites[index - 5];
    assert.ok(template && site);
    site.owner = template.civId;
    state.cities.push({ ...structuredClone(template), id: `exchange-fixture-${index}`, name: `Exchange fixture ${index}`, tileId: site.id, population: 3 });
  }
  assert.ok(isWorldState(state));
  const before = structuredClone(state);
  const full = observe(state, 0, epoch);
  const compact = observeCompactTrade(state, 0, epoch);
  const proposals = full.legalActions.filter(option => option.action.type === 'propose-trade');
  assert.equal(proposals.length, 200);
  assert.equal(new Set(proposals.map(option => JSON.stringify(option.action))).size, 200);
  assert.equal(proposals.filter(option => option.action.type === 'propose-trade' && option.action.recipeId === recipeId).length, 100);
  assert.deepEqual(compact.legalActions.map(option => option.action), full.legalActions.map(option => option.action));
  assert.deepEqual(compact.legalActions.map(option => option.tradeQuote), full.legalActions.map(option => option.tradeQuote));
  assert.deepEqual(compact.tradeFacts.recipes.map(recipe => recipe.id), ['energy-for-materials', 'harvest-for-materials']);
  const energyFacts = compact.tradeFacts.recipes.find(recipe => recipe.id === recipeId);
  assert.deepEqual(energyFacts?.terms.proposerCargo, { energy: 4 });
  assert.deepEqual(energyFacts?.terms.recipientCargo, { materials: 3 });
  assert.deepEqual(energyFacts?.terms.proposerUpkeep, { energy: 1 });
  assert.deepEqual(energyFacts?.terms.recipientUpkeep, { energy: 1 });
  assert.deepEqual(state, before);
  context.diagnostic(JSON.stringify({ source: 'finite synthetic 25-city two-recipe observation', proposals: proposals.length, choices: full.legalActions.length, fullBytes: Buffer.byteLength(JSON.stringify(full)), compactBytes: Buffer.byteLength(JSON.stringify(compact)) }));
});
