import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from '../core/engine.ts';
import { HISTORICAL_DIRECTOR_EVENTS, type HistoricalEventId } from '../core/historical-event-content.ts';
import { historicalEventCandidates, historicalEventInstanceId, selectHistoricalEventTarget, type HistoricalEventSelection } from '../core/historical-selection.ts';
import { assertHistoricalEventReceipt } from '../core/historical-selection-validation.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { applyHistoricalEvent, applyHistoricalEventWithReceipt, historicalEventQuote, historicalEventWeight } from '../core/simulation/historical-events.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { executeTradeAction, resolveTrade } from '../core/simulation/trade.ts';
import type { City, GameEvent, WorldState } from '../core/types.ts';

const epoch = '2026-10-16T00:00:00.000Z';
let baseline: WorldState | undefined;

function world(): WorldState {
  baseline ??= createWorld(1701, epoch, 'settlement-regional-targets-1');
  return structuredClone(baseline);
}

function town(state: WorldState, id = 'city-0'): City {
  const result = state.cities.find(city => city.id === id); assert.ok(result); return result;
}

function extraTown(state: WorldState, id: string): City {
  const city = structuredClone(town(state));
  const site = state.tiles.find(tile => tile.owner === 0 && !state.cities.some(other => other.tileId === tile.id)); assert.ok(site);
  site.terrain = 'grassland'; city.id = id; city.name = id; city.tileId = site.id; city.population = 2;
  city.housing = { ruleVersion: 1, baseCapacity: 6, establishedRound: state.round, origin: 'founded' };
  state.cities.push(city); return city;
}

function neighbors(state: WorldState, city = town(state)) {
  const site = state.tiles.find(tile => tile.id === city.tileId); assert.ok(site);
  return state.tiles.filter(tile => hexDistance(site, tile) === 1 && !state.cities.some(other => other.tileId === tile.id));
}

function deliveredTrade(state: WorldState): void {
  const events: GameEvent[] = [];
  executeTradeAction(state, 0, { type: 'propose-trade', partner: 1, recipeId: 'harvest-for-materials', sourceCityId: 'city-0', recipientCityId: 'city-1' }, events);
  const offer = state.tradeOffers?.at(-1); assert.ok(offer);
  executeTradeAction(state, 1, { type: 'respond-trade', offerId: offer.id, accept: true }, events);
  const route = state.routes.at(-1); assert.ok(route?.agreement);
  state.round = route.agreement.nextDeliveryRound; resolveTrade(state, events);
  assert.ok(route.agreement.deliveryCount > 0);
}

function eligible(event: HistoricalEventId): WorldState {
  const state = world();
  if (event === 'cultivated-harvest') town(state).buildings.push('farm');
  if (event === 'forest-fire') { const tile = neighbors(state)[0]; assert.ok(tile); tile.terrain = 'forest'; }
  if (event === 'coastal-storm') { const tile = neighbors(state)[0]; assert.ok(tile); tile.terrain = 'ocean'; }
  if (event === 'trade-fair') deliveredTrade(state);
  if (event === 'industrial-accident') {
    const civ = state.civilizations[0]; assert.ok(civ); civ.era = 2;
    town(state).buildings.push('guild-workshop'); town(state).buildingOperations = { 'guild-workshop': { enabled: true, lastResult: null } };
    resolveEconomy(state, []);
  }
  if (event === 'internal-migration') { extraTown(state, 'shelter'); town(state).damage = 40; }
  return state;
}

function selection(state: WorldState, event: HistoricalEventId): HistoricalEventSelection {
  const selected = selectHistoricalEventTarget(state, event, 0); assert.ok(selected, event); return selected;
}

void test('every regional family selects actual eligible locals and preserves its immediate effects', () => {
  for (const definition of HISTORICAL_DIRECTOR_EVENTS) {
    const event = definition.id as HistoricalEventId; const state = eligible(event); const before = structuredClone(state);
    const selected = selection(state, event); const quote = historicalEventQuote(state, event, 0, selected); assert.ok(quote);
    assert.equal(historicalEventQuote(state, event, 0), null);
    assert.equal(selected.local.kind, event);
    assert.equal(selected.instanceId, historicalEventInstanceId(state.seed, event, 0, 1));
    assert.deepEqual(state, before);
    const result = applyHistoricalEventWithReceipt(state, quote, `${state.revision}:0`); assert.ok(result.receipt);
    assertHistoricalEventReceipt(result.receipt);
    assert.deepEqual(result.receipt.selection, selected); assert.deepEqual(result.receipt.paid, quote.paid);
    assert.equal(result.receipt.eventId, `${state.revision}:0`); assert.equal(result.receipt.revision, quote.revision);
    assert.equal(result.receipt.round, quote.round); assert.equal(result.receipt.eventKind, event);
    for (const fact of result.receipt.facts) {
      const beforeObject = fact.scope === 'civilization' ? before.civilizations.find(civ => civ.id === fact.id)?.resources : fact.scope === 'city' ? before.cities.find(city => city.id === fact.id) : before.routes.find(route => route.id === fact.id);
      const afterObject = fact.scope === 'civilization' ? state.civilizations.find(civ => civ.id === fact.id)?.resources : fact.scope === 'city' ? state.cities.find(city => city.id === fact.id) : state.routes.find(route => route.id === fact.id);
      assert.ok(beforeObject && afterObject); assert.equal(Reflect.get(beforeObject, fact.field), fact.before); assert.equal(Reflect.get(afterObject, fact.field), fact.after);
    }
    assert.equal(state.rng, before.rng); assert.deepEqual(state.eventCounts, before.eventCounts);
    if (event === 'forest-fire' || event === 'industrial-accident') assert.deepEqual(result.receipt.paid, {});
    if (event === 'coastal-storm') { assert.equal(selected.local.kind, 'coastal-storm'); if (selected.local.kind === 'coastal-storm') assert.equal(selected.local.route, null); }
    if (event === 'internal-migration') {
      assert.equal(state.cities.reduce((sum, city) => sum + city.population, 0), before.cities.reduce((sum, city) => sum + city.population, 0));
      assert.deepEqual(result.receipt.facts.filter(fact => fact.field === 'population').map(fact => Number(fact.after) - Number(fact.before)), [-2, 2]);
    }
    const ineligible = structuredClone(before); ineligible.directorCooldown = 1;
    assert.deepEqual(historicalEventCandidates(ineligible, event, 0), []); assert.equal(selectHistoricalEventTarget(ineligible, event, 0), null);
    assert.equal(historicalEventQuote(ineligible, event, 0, selected), null);
    assert.deepEqual(state.tiles, before.tiles);
  }
});

void test('stateless city-first selection is reorder invariant and not weighted by local attachment count', () => {
  const state = eligible('forest-fire'); const second = extraTown(state, 'later');
  for (const tile of neighbors(state)) tile.terrain = 'forest';
  const other = neighbors(state, second)[0]; assert.ok(other); other.terrain = 'forest';
  const groups = historicalEventCandidates(state, 'forest-fire', 0); assert.equal(groups.length, 2);
  assert.ok(groups.every(group => group.locals.length > 0));
  const sparse = structuredClone(state); const firstGroup = groups[0]; assert.ok(firstGroup);
  const retainedForest = firstGroup.locals[0]; assert.ok(retainedForest && retainedForest.kind === 'forest-fire');
  for (const local of firstGroup.locals.slice(1)) {
    if (local.kind !== 'forest-fire') continue;
    if (groups[1]?.locals.some(otherLocal => otherLocal.kind === 'forest-fire' && otherLocal.forestTileId === local.forestTileId)) continue;
    const tile = sparse.tiles.find(candidate => candidate.id === local.forestTileId); assert.ok(tile); tile.terrain = 'grassland';
  }
  const cities = new Set<string>(); const attachments = new Set<number>();
  for (let occurrence = 0; occurrence < 48; occurrence++) {
    state.eventCounts['forest-fire'] = occurrence; sparse.eventCounts['forest-fire'] = occurrence;
    const selected = selection(state, 'forest-fire'); cities.add(selected.local.cityId);
    if (selected.local.kind === 'forest-fire') attachments.add(selected.local.forestTileId);
    assert.equal(selection(sparse, 'forest-fire').local.cityId, selected.local.cityId);
    const shuffled = structuredClone(state); shuffled.cities.reverse(); shuffled.tiles.reverse(); shuffled.routes.reverse();
    shuffled.revision += 10; shuffled.clockTicks += 12; shuffled.rng += 5;
    assert.deepEqual(selection(shuffled, 'forest-fire'), selected);
  }
  assert.equal(cities.size, 2); assert.ok(attachments.size > 1);
  const seeds = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) { state.seed = seed; seeds.add(selection(state, 'forest-fire').local.cityId); }
  assert.equal(seeds.size, 2);
});

void test('exact stale local bindings refuse rather than replacing city forest operation destination or agreement', () => {
  for (const event of ['cultivated-harvest', 'forest-fire', 'industrial-accident', 'internal-migration', 'trade-fair', 'coastal-storm'] as const) {
    const state = eligible(event);
    if (event === 'coastal-storm') deliveredTrade(state);
    const selected = selection(state, event); const quote = historicalEventQuote(state, event, 0, selected); assert.ok(quote);
    const local = selected.local;
    if (local.kind === 'cultivated-harvest') { town(state, local.cityId).population = 0; extraTown(state, 'replacement').buildings.push('farm'); }
    if (local.kind === 'forest-fire') { const tile = state.tiles.find(candidate => candidate.id === local.forestTileId); assert.ok(tile); tile.terrain = 'desert'; }
    if (local.kind === 'industrial-accident') { const operation = town(state, local.cityId).buildingOperations?.[local.buildingId]; assert.ok(operation); operation.enabled = false; }
    if (local.kind === 'internal-migration') town(state, local.destinationCityId).wellbeing = 0;
    if (local.kind === 'trade-fair' || local.kind === 'coastal-storm') { assert.ok(local.route); const route = state.routes.find(candidate => candidate.id === local.route?.routeId); assert.ok(route?.agreement); route.agreement.offerId += '-replacement'; }
    const before = structuredClone(state); assert.equal(historicalEventQuote(state, event, 0, selected), null);
    assert.throws(() => applyHistoricalEvent(state, quote), /stale|eligible/); assert.deepEqual(state, before);
  }
});

void test('selector identities reject overflow and mismatch and survive irrelevant revisions without consuming state', () => {
  const state = eligible('cultivated-harvest'); const selected = selection(state, 'cultivated-harvest');
  const before = structuredClone(state);
  for (const wrong of [ { ...selected, occurrence: 2 }, { ...selected, instanceId: selected.instanceId + 'x' }, { ...selected, local: { ...selected.local, tileId: selected.local.tileId + 1 } } ]) assert.equal(historicalEventQuote(state, 'cultivated-harvest', 0, wrong), null);
  assert.equal(historicalEventQuote(state, 'cultivated-harvest', 1, selected), null); assert.deepEqual(state, before);
  state.revision++; const refreshed = historicalEventQuote(state, 'cultivated-harvest', 0, selected); assert.ok(refreshed); assert.deepEqual(refreshed.selection, selected);
  for (const count of [Number.MAX_SAFE_INTEGER, -1, 0.5, Infinity]) { state.eventCounts['cultivated-harvest'] = count; assert.equal(selectHistoricalEventTarget(state, 'cultivated-harvest', 0), null); }
});

void test('legacy weights remain first-town based independently of the selected local town', () => {
  const state = eligible('cultivated-harvest'); const second = extraTown(state, 'second'); second.buildings.push('farm'); second.population = 1;
  const first = town(state); first.population = 20; const civ = state.civilizations[0]; assert.ok(civ); civ.resources.food = 15;
  const old = structuredClone(state); old.unlockedFeatures = old.unlockedFeatures.filter(feature => feature !== 'procedural-regional-targets');
  const oldQuote = historicalEventQuote(old, 'cultivated-harvest', 0); assert.ok(oldQuote); assert.equal(Object.hasOwn(oldQuote, 'selection'), false);
  assert.equal(selectHistoricalEventTarget(old, 'cultivated-harvest', 0), null);
  for (let occurrence = 0; occurrence < 24; occurrence++) {
    state.eventCounts['cultivated-harvest'] = occurrence;
    const selected = selection(state, 'cultivated-harvest');
    assert.equal(historicalEventWeight(state, 'cultivated-harvest', 0), historicalEventWeight(old, 'cultivated-harvest', 0));
    assert.equal(historicalEventQuote(old, 'cultivated-harvest', 0, selected), null);
  }
});

void test('route attachments bind full agreements and reorder without changing the selected result', () => {
  const state = eligible('trade-fair'); const route = state.routes.at(-1); assert.ok(route?.agreement);
  const second = structuredClone(route); second.id = 'route-extra'; assert.ok(second.agreement); second.agreement.offerId = 'offer-extra'; state.routes.push(second);
  const groups = historicalEventCandidates(state, 'trade-fair', 0); assert.equal(groups.length, 1); assert.equal(groups[0]?.locals.length, 2);
  const seen = new Set<string>();
  for (let occurrence = 0; occurrence < 24; occurrence++) {
    state.eventCounts['trade-fair'] = occurrence; const selected = selection(state, 'trade-fair'); assert.equal(selected.local.kind, 'trade-fair');
    if (selected.local.kind === 'trade-fair') seen.add(selected.local.route.routeId);
    const reversed = structuredClone(state); reversed.routes.reverse(); reversed.cities.reverse();
    assert.deepEqual(selection(reversed, 'trade-fair'), selected);
  }
  assert.equal(seen.size, 2);
  const coast = neighbors(state)[0]; assert.ok(coast); coast.terrain = 'ocean';
  const selected = selection(state, 'coastal-storm'); const quote = historicalEventQuote(state, 'coastal-storm', 0, selected); assert.ok(quote);
  const result = applyHistoricalEventWithReceipt(state, quote, `${state.revision}:0`); assert.ok(result.receipt); assertHistoricalEventReceipt(result.receipt);
  assert.equal(result.receipt.facts.filter(fact => fact.scope === 'route').length, 3);
  const receipt = result.receipt;
  assert.throws(() => assertHistoricalEventReceipt({ ...receipt, facts: receipt.facts.map(fact => fact.scope === 'route' && fact.field === 'active' ? { ...fact, after: false } : fact) }));
  assert.equal(state.routes.filter(candidate => candidate.damage > 0).length, 1);
});

void test('a selected exact eligible tuple survives changes to other candidates but cannot suppress a newly active storm route', () => {
  const state = eligible('cultivated-harvest'); const selected = selection(state, 'cultivated-harvest');
  extraTown(state, 'new-farm').buildings.push('farm');
  assert.ok(historicalEventQuote(state, 'cultivated-harvest', 0, selected));
  const storm = eligible('coastal-storm'); const withoutRoute = selection(storm, 'coastal-storm');
  deliveredTrade(storm); assert.equal(historicalEventQuote(storm, 'coastal-storm', 0, withoutRoute), null);
});

void test('industrial and migration attachment choices use current production and each actual destination', () => {
  const industry = eligible('industrial-accident'); const industrialTown = town(industry); const operation = industrialTown.buildingOperations?.['guild-workshop']; assert.ok(operation?.lastResult);
  industrialTown.buildings.push('factory'); industrialTown.buildingOperations = { ...industrialTown.buildingOperations, factory: structuredClone(operation) };
  const operations = new Set<string>();
  for (let occurrence = 0; occurrence < 24; occurrence++) {
    industry.eventCounts['industrial-accident'] = occurrence; const selected = selection(industry, 'industrial-accident');
    if (selected.local.kind === 'industrial-accident') operations.add(selected.local.buildingId);
    const reverse = structuredClone(industry); town(reverse).buildings.reverse(); assert.deepEqual(selection(reverse, 'industrial-accident'), selected);
  }
  assert.equal(operations.size, 2);
  const migration = eligible('internal-migration'); const destination = extraTown(migration, 'second-shelter'); destination.damage = 0; destination.wellbeing = 70;
  const destinations = new Set<string>();
  for (let occurrence = 0; occurrence < 24; occurrence++) {
    migration.eventCounts['internal-migration'] = occurrence; const selected = selection(migration, 'internal-migration');
    if (selected.local.kind === 'internal-migration') destinations.add(selected.local.destinationCityId);
    const reverse = structuredClone(migration); reverse.cities.reverse(); assert.deepEqual(selection(reverse, 'internal-migration'), selected);
  }
  assert.equal(destinations.size, 2);
});

void test('storm receipt freezes the exact route disable threshold and proves the active-state crossing', () => {
  const state = eligible('coastal-storm'); deliveredTrade(state); const route = state.routes.at(-1); assert.ok(route?.agreement);
  route.damage = route.agreement.terms.damageDisableAt - 10;
  const selected = selection(state, 'coastal-storm'); const quote = historicalEventQuote(state, 'coastal-storm', 0, selected); assert.ok(quote);
  const result = applyHistoricalEventWithReceipt(state, quote, `${state.revision}:0`); assert.ok(result.receipt); assertHistoricalEventReceipt(result.receipt);
  assert.equal(route.active, false);
  assert.deepEqual(result.receipt.facts.find(fact => fact.scope === 'route' && fact.field === 'damageDisableAt'), { scope: 'route', id: route.id, field: 'damageDisableAt', before: route.agreement.terms.damageDisableAt, after: route.agreement.terms.damageDisableAt });
  const incorrect = { ...result.receipt, facts: result.receipt.facts.map(fact => fact.scope === 'route' && fact.field === 'active' ? { ...fact, after: true } : fact) };
  assert.throws(() => assertHistoricalEventReceipt(incorrect));
  const changedThreshold = { ...result.receipt, facts: result.receipt.facts.map(fact => fact.scope === 'route' && fact.field === 'damageDisableAt' ? { ...fact, after: Number(fact.after) + 1 } : fact) };
  assert.throws(() => assertHistoricalEventReceipt(changedThreshold));
  route.agreement.terms.damageDisableAt = 100;
  assertHistoricalEventReceipt(result.receipt);
});
