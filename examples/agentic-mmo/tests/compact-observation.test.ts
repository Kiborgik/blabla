import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, applyRelease, createWorld, observe } from '../core/engine.ts';
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


import { ECONOMY_RULES, RESOURCE_IDS, SETTLEMENT_SITE_OUTPUTS, TRADE_RECIPES } from '../core/content.ts';
import { siteProduction } from '../core/simulation/sites.ts';

import { observeCompactTrade, type TradeTownFact } from '../core/observation.ts';

await test('opt-in compact view preserves every ordered action and ordinary observation field for all six seats', () => {
  const state = released(true);
  const before = structuredClone(state);
  for (let seat = 0; seat < 6; seat++) {
    const full = observe(state, seat, epoch);
    const compact = observeCompactTrade(state, seat, epoch);
    assert.equal(compact.observationFormat, 'compact-trade-v1');
    assert.ok(compact.tradeFacts);
    assert.deepEqual(compact.legalActions.map(option => option.action), full.legalActions.map(option => option.action));
    assert.deepEqual(Object.fromEntries(Object.entries(compact).filter(([key]) => !['legalActions', 'observationFormat', 'tradeFacts'].includes(key))), Object.fromEntries(Object.entries(full).filter(([key]) => key !== 'legalActions')));
    assert.equal('observationFormat' in full, false);
    assert.equal('tradeFacts' in full, false);
  }
  assert.deepEqual(state, before);
});

await test('synthetic twenty-five-city view retains all one hundred exact pairs and materially reduces measured bytes', (context) => {
  const measurements = [];
  for (const count of [5, 25]) {
    const state = syntheticCities(count);
    const full = observe(state, 0, epoch);
    const compact = observeCompactTrade(state, 0, epoch);
    const proposals = compact.legalActions.filter(option => option.action.type === 'propose-trade');
    assert.equal(proposals.length, count / 5 * (count - count / 5));
    assert.deepEqual(compact.legalActions.map(option => option.action), full.legalActions.map(option => option.action));
    const fullBytes = Buffer.byteLength(JSON.stringify(full));
    const compactBytes = Buffer.byteLength(JSON.stringify(compact));
    if (count === 25) assert.ok(compactBytes < fullBytes * 0.7, `${compactBytes} versus ${fullBytes}`);
    measurements.push({ count, proposals: proposals.length, fullBytes, compactBytes });
  }
  context.diagnostic(JSON.stringify({ source: 'finite synthetic projection fixture, not live play or universal performance bound', measurements }));
});

await test('compact town facts expose canonical terrain, deposit and base vectors with unique resolving IDs', () => {
  const state = syntheticCities(25);
  const compact = observeCompactTrade(state, 0, epoch);
  assert.ok(compact.tradeFacts);
  const facts = compact.tradeFacts.cities;
  assert.equal(facts.length, 25);
  assert.equal(new Set(facts.map(fact => fact.cityId)).size, facts.length);
  for (const fact of facts) {
    const city = state.cities.find(candidate => candidate.id === fact.cityId);
    assert.ok(city);
    const site = state.tiles.find(tile => tile.id === city.tileId);
    assert.ok(site);
    assert.equal(fact.civId, city.civId);
    assert.equal(fact.name, city.name);
    assert.equal(fact.tileId, site.id);
    assert.equal(fact.terrain, site.terrain);
    assert.equal(fact.deposit, site.resource);
    assert.deepEqual(fact.terrainOutputs, SETTLEMENT_SITE_OUTPUTS[site.terrain] ?? {});
    const combined = siteProduction(state, site);
    for (const resource of RESOURCE_IDS) assert.equal((fact.terrainOutputs[resource] ?? 0) + (fact.depositOutputs[resource] ?? 0), combined[resource] ?? 0);
    assert.deepEqual(fact.baseOutputsBeforeFocusAndProductivity, Object.fromEntries(RESOURCE_IDS.map(resource => [resource, ECONOMY_RULES.baseProduction[resource] + (siteProduction(state, site)[resource] ?? 0)])));
  }
  for (const { action } of compact.legalActions) if (action.type === 'propose-trade') {
    assert.ok(facts.find(fact => fact.cityId === action.sourceCityId));
    assert.ok(facts.find(fact => fact.cityId === action.recipientCityId));
  }
});

await test('current proposal recipes expose all canonical obligation vectors once and exclude unreleased recipes', () => {
  const state = syntheticCities(10);
  const original = structuredClone(TRADE_RECIPES);
  const first = TRADE_RECIPES[0];
  assert.ok(first);
  TRADE_RECIPES.push({ ...structuredClone(first), id: 'second-test-recipe', terms: { ...structuredClone(first.terms), recipeId: 'second-test-recipe' } });
  TRADE_RECIPES.push({ ...structuredClone(first), id: 'unreleased-test-recipe', requiredFeatures: ['not-released'], terms: { ...structuredClone(first.terms), recipeId: 'unreleased-test-recipe' } });
  try {
    const compact = observeCompactTrade(state, 0, epoch);
    assert.ok(compact.tradeFacts);
    assert.equal(compact.tradeFacts.recipes.length, 2);
    for (const recipe of compact.tradeFacts.recipes) assert.deepEqual(recipe.terms, TRADE_RECIPES.find(candidate => candidate.id === recipe.id)?.terms);
    const proposals = compact.legalActions.filter(option => option.action.type === 'propose-trade');
    assert.equal(proposals.length, 32);
    assert.deepEqual(compact.legalActions.map(option => option.action), observe(state, 0, epoch).legalActions.map(option => option.action));
    assert.match(JSON.stringify(compact.tradeFacts.semantics), /civilization|shared/i);
    assert.match(JSON.stringify(compact.tradeFacts.semantics), /not.*path|not.*traversed/i);
    assert.match(JSON.stringify(compact.tradeFacts.semantics), /productivity/);
  } finally { TRADE_RECIPES.splice(0, TRADE_RECIPES.length, ...original); }
});

await test('pending and accepted consent snapshots remain authoritative after isolated catalogue tuning changes', () => {
  const state = syntheticCities(10);
  const proposed = applyCommand(state, { seat: 0, action: actionFor(state), expectedRevision: state.revision, timestamp: epoch });
  assert.equal(proposed.ok, true, proposed.error);
  const offer = proposed.state.tradeOffers?.find(candidate => candidate.status === 'pending');
  assert.ok(offer);
  const accepted = applyCommand(proposed.state, { seat: 1, action: { type: 'respond-trade', offerId: offer.id, accept: true }, expectedRevision: proposed.state.revision, timestamp: epoch });
  assert.equal(accepted.ok, true, accepted.error);
  const recipe = TRADE_RECIPES[0];
  assert.ok(recipe);
  const terms = structuredClone(recipe.terms);
  recipe.terms.proposerCargo.food = 999;
  try {
    const pendingView = observeCompactTrade(proposed.state, 1, later);
    const acceptedView = observeCompactTrade(accepted.state, 0, later);
    assert.ok(pendingView.tradeFacts && acceptedView.tradeFacts);
    assert.deepEqual(pendingView.tradeOffers?.find(candidate => candidate.id === offer.id)?.terms, terms);
    assert.deepEqual(acceptedView.routes.find(route => route.agreement?.offerId === offer.id)?.agreement?.terms, terms);
    assert.ok(pendingView.tradeFacts.cities.find(city => city.cityId === offer.from));
    assert.ok(pendingView.tradeFacts.cities.find(city => city.cityId === offer.to));
    assert.ok(acceptedView.tradeFacts.cities.find(city => city.cityId === offer.from));
    assert.ok(acceptedView.tradeFacts.cities.find(city => city.cityId === offer.to));
  } finally { recipe.terms = terms; }
});

await test('compact facts are detached from world and catalogue and repeat identically after JSON restart', () => {
  const state = syntheticCities(10);
  const before = structuredClone(state);
  const catalogue = structuredClone(TRADE_RECIPES);
  const compact = observeCompactTrade(state, 0, epoch);
  assert.ok(compact.tradeFacts);
  const restarted: unknown = JSON.parse(JSON.stringify(state));
  assert.ok(isWorldState(restarted));
  assert.deepEqual(observeCompactTrade(restarted, 0, epoch), compact);
  const town = compact.tradeFacts.cities[0];
  const recipe = compact.tradeFacts.recipes[0];
  assert.ok(town && recipe);
  town.baseOutputsBeforeFocusAndProductivity.food = 987;
  recipe.terms.constructionCost.materials = 987;
  assert.deepEqual(state, before);
  assert.deepEqual(TRADE_RECIPES, catalogue);
  assert.notDeepEqual(observeCompactTrade(state, 0, epoch), compact);
});

await test('two-item trade intention retains exact context and derived invalidation without formatting-driven execution', () => {
  const state = syntheticCities(10);
  const action = actionFor(state);
  const command = { seat: 0, action: { type: 'wait' as const }, expectedRevision: state.revision, timestamp: epoch, plan: [{ action: { type: 'wait' as const }, reason: 'Review before offering' }, { action, reason: 'Propose this exact pair next' }] };
  const held = applyCommand(state, command);
  assert.equal(held.ok, true, held.error);
  const fixture = structuredClone(held.state);
  fixture.cities = fixture.cities.filter(city => city.id !== action.sourceCityId);
  const before = structuredClone(fixture);
  const compact = observeCompactTrade(fixture, 0, later);
  assert.ok(compact.tradeFacts);
  assert.deepEqual(compact.actionPlan, observe(fixture, 0, later).actionPlan);
  assert.equal(compact.actionPlan?.items.length, 2);
  assert.equal(compact.actionPlan?.items[0]?.status, 'completed');
  assert.equal(compact.actionPlan?.items[1]?.status, 'invalidated');
  assert.equal(compact.tradeFacts.cities.some(city => city.cityId === action.sourceCityId), false);
  assert.deepEqual(fixture, before);
});

await test('historical unpaired proposals keep exact actions and derive gated first-city site facts without retroactive terrain output', () => {
  const initial = createWorld(17, epoch);
  const upgraded = applyRelease(initial, { expectedRevision: initial.revision, expectedFromReleaseId: initial.releaseId, targetReleaseId: 'settlement-foundations-2', timestamp: epoch });
  assert.equal(upgraded.ok, true, upgraded.error);
  const traded = applyRelease(upgraded.state, { expectedRevision: upgraded.state.revision, expectedFromReleaseId: upgraded.state.releaseId, targetReleaseId: 'settlement-trade-1', timestamp: epoch });
  assert.equal(traded.ok, true, traded.error);
  const state = traded.state;
  assert.equal(state.unlockedFeatures.includes('terrain-production'), false);
  const full = observe(state, 0, epoch);
  const compact = observeCompactTrade(state, 0, epoch);
  assert.ok(compact.tradeFacts);
  assert.deepEqual(compact.legalActions.map(option => option.action), full.legalActions.map(option => option.action));
  const proposals = compact.legalActions.filter(option => option.action.type === 'propose-trade');
  assert.equal(proposals.length, 4);
  assert.ok(proposals.every(option => !('sourceCityId' in option.action) && !('recipientCityId' in option.action)));
  assert.equal(compact.tradeFacts.cities.length, 5);
  for (const fact of compact.tradeFacts.cities) {
    assert.deepEqual(fact.terrainOutputs, {});
    const site = state.tiles.find(tile => tile.id === fact.tileId);
    assert.ok(site);
    assert.deepEqual(fact.baseOutputsBeforeFocusAndProductivity, Object.fromEntries(RESOURCE_IDS.map(resource => [resource, ECONOMY_RULES.baseProduction[resource] + (siteProduction(state, site)[resource] ?? 0)])));
  }
});

await test('no visible trade references produces empty fact tables rather than a map or unreleased catalogue dump', () => {
  const state = createWorld(17, epoch);
  const compact = observeCompactTrade(state, 1, epoch);
  assert.ok(compact.tradeFacts);
  assert.deepEqual(compact.tradeFacts.cities, []);
  assert.deepEqual(compact.tradeFacts.recipes, []);
  assert.deepEqual(compact.legalActions, observe(state, 1, epoch).legalActions);
});


await test('isolated site breakdown reconciles exactly with canonical production for every deposit resource and terrain gate', () => {
  for (const terrainEnabled of [false, true]) {
    const state = released(true);
    if (!terrainEnabled) state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== 'terrain-production');
    const town = state.cities[0];
    assert.ok(town);
    const site = state.tiles.find(tile => tile.id === town.tileId);
    assert.ok(site);
    for (const resource of [null, ...RESOURCE_IDS]) {
      site.resource = resource;
      for (const terrain of ['grassland', 'forest', 'desert', 'tundra'] as const) {
        site.terrain = terrain;
        const fact: TradeTownFact | undefined = observeCompactTrade(state, 0, epoch).tradeFacts.cities.find(candidate => candidate.cityId === town.id);
        assert.ok(fact);
        const canonical = siteProduction(state, site);
        assert.deepEqual(fact.terrainOutputs, terrainEnabled ? SETTLEMENT_SITE_OUTPUTS[terrain] ?? {} : {});
        for (const output of RESOURCE_IDS) {
          assert.equal((fact.terrainOutputs[output] ?? 0) + (fact.depositOutputs[output] ?? 0), canonical[output] ?? 0);
          assert.equal(fact.baseOutputsBeforeFocusAndProductivity[output], ECONOMY_RULES.baseProduction[output] + (canonical[output] ?? 0));
        }
      }
    }
  }
});
