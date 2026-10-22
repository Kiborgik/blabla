import assert from 'node:assert/strict';
import test from 'node:test';
import { DIRECTOR_EVENTS } from '../core/content.ts';
import { applyCommand, applyDirectorTick, applyRelease, createWorld, legalActions } from '../core/engine.ts';
import { HISTORICAL_DIRECTOR_EVENTS } from '../core/historical-event-content.ts';
import { RELEASES } from '../core/release.ts';
import { cityGrowthFacts } from '../core/simulation/growth.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { applyHistoricalEvent, historicalEventQuote, historicalEventWeight, isHistoricalEventId } from '../core/simulation/historical-events.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { executeTradeAction, resolveTrade } from '../core/simulation/trade.ts';
import { DIRECTOR_SEAT, type City, type GameEvent, type WorldState } from '../core/types.ts';

const epoch = '2026-10-16T00:00:00.000Z';
let baseline: WorldState | undefined;

function world(): WorldState {
  if (!baseline) {
    baseline = createWorld(1701, epoch);
    for (const release of RELEASES) {
      if (!release.compatibleFrom.includes(baseline.releaseId)) continue;
      const result = applyRelease(baseline, { expectedRevision: baseline.revision, expectedFromReleaseId: baseline.releaseId, targetReleaseId: release.id, timestamp: epoch });
      assert.equal(result.ok, true, result.error);
      baseline = result.state;
    }
    assert.ok(baseline.unlockedFeatures.includes('historical-pressures'));
  }
  return structuredClone(baseline);
}

function town(state: WorldState, id = 'city-0'): City {
  const city = state.cities.find(candidate => candidate.id === id);
  assert.ok(city);
  return city;
}

function actor(state: WorldState, target = 0) {
  const civilization = state.civilizations.find(candidate => candidate.id === target);
  assert.ok(civilization);
  return civilization;
}

function extraTown(state: WorldState, id: string): City {
  const city = structuredClone(town(state));
  const site = state.tiles.find(tile => tile.owner === 0 && tile.id !== city.tileId && !state.cities.some(item => item.tileId === tile.id));
  assert.ok(site);
  city.id = id; city.name = id; city.tileId = site.id; city.population = 2;
  city.housing = { ruleVersion: 1, baseCapacity: 6, establishedRound: state.round, origin: 'founded' };
  state.cities.push(city);
  return city;
}

function neighbor(state: WorldState, city = town(state)) {
  const site = state.tiles.find(tile => tile.id === city.tileId);
  assert.ok(site);
  const adjacent = state.tiles.find(tile => hexDistance(site, tile) === 1 && !state.cities.some(item => item.tileId === tile.id));
  assert.ok(adjacent);
  return adjacent;
}

function harvest(state: WorldState): void {
  town(state).buildings.push('farm');
  actor(state).technologies.push('agriculture');
}

function deliveredTrade(state: WorldState): void {
  const events: GameEvent[] = [];
  executeTradeAction(state, 0, { type: 'propose-trade', partner: 1, recipeId: 'harvest-for-materials', sourceCityId: 'city-0', recipientCityId: 'city-1' }, events);
  const offer = state.tradeOffers?.at(-1); assert.ok(offer);
  executeTradeAction(state, 1, { type: 'respond-trade', offerId: offer.id, accept: true }, events);
  const route = state.routes.at(-1); assert.ok(route?.agreement);
  state.round = route.agreement.nextDeliveryRound;
  resolveTrade(state, events);
  assert.ok(events.some(event => event.type === 'trade-delivered'));
  assert.ok(route.active && route.agreement.deliveryCount > 0);
}

void test('historical catalogue retains the six original definitions and gates every new identity', () => {
  assert.deepEqual(DIRECTOR_EVENTS.filter(event => !isHistoricalEventId(event.id)).map(event => event.id), ['drought', 'earthquake', 'resource-boom', 'crypto-boom', 'ufo-contact', 'calm']);
  assert.equal(HISTORICAL_DIRECTOR_EVENTS.length, 6);
  const state = createWorld(1701, epoch); state.phase = DIRECTOR_SEAT; harvest(state);
  for (const definition of HISTORICAL_DIRECTOR_EVENTS) {
    assert.ok(definition.requiredFeatures.includes('historical-pressures'));
    assert.equal(historicalEventQuote(state, definition.id, 0), null);
    assert.equal(historicalEventWeight(state, definition.id, 0), 0);
    assert.ok(!legalActions(state, DIRECTOR_SEAT, epoch).some(option => option.action.type === 'event' && option.action.event === definition.id));
    const result = applyCommand(state, { seat: DIRECTOR_SEAT, expectedRevision: state.revision, timestamp: epoch, action: { type: 'event', event: definition.id, target: 0 } });
    assert.equal(result.ok, false); assert.deepEqual(result.state, state); assert.deepEqual(result.events, []);
  }
});

void test('cultivated harvest requires a real farm on grassland and pays the full material cost', () => {
  const state = world();
  assert.equal(historicalEventQuote(state, 'cultivated-harvest', 0), null);
  harvest(state);
  const site = state.tiles.find(tile => tile.id === town(state).tileId); assert.ok(site);
  site.terrain = 'desert'; assert.equal(historicalEventQuote(state, 'cultivated-harvest', 0), null);
  site.terrain = 'grassland'; actor(state).resources.materials = 2;
  assert.equal(historicalEventQuote(state, 'cultivated-harvest', 0), null);
  actor(state).resources.materials = 3;
  const before = structuredClone(state); const quote = historicalEventQuote(state, 'cultivated-harvest', 0); assert.ok(quote);
  assert.deepEqual(quote.paid, { materials: 3 });
  const effects = applyHistoricalEvent(state, quote);
  assert.equal(actor(state).resources.materials, 0);
  assert.equal(actor(state).resources.food, actor(before).resources.food + 8);
  assert.match(effects.join('; '), /materials 3 → 0/);
  assert.deepEqual(state.cities, before.cities); assert.deepEqual(state.routes, before.routes);
  assert.deepEqual(state.civilizations.slice(1), before.civilizations.slice(1));
  const applied = structuredClone(state);
  assert.throws(() => applyHistoricalEvent(state, quote), /stale|eligible|quote/i);
  assert.deepEqual(state, applied);
});

void test('historical quote selection is deterministic and stale or edited quotes are atomic refusals', () => {
  const state = world(); harvest(state); extraTown(state, 'second-farm');
  const quote = historicalEventQuote(state, 'cultivated-harvest', 0); assert.ok(quote);
  const reordered = structuredClone(state); reordered.cities.reverse(); reordered.tiles.reverse();
  assert.deepEqual(historicalEventQuote(reordered, 'cultivated-harvest', 0), quote);
  const forged = structuredClone(quote); forged.effects.push({ kind: 'resource', resource: 'credits', amount: 1000 });
  const before = structuredClone(state); assert.throws(() => applyHistoricalEvent(state, forged), /quote/i); assert.deepEqual(state, before);
  actor(state).resources.materials -= 1;
  const changed = structuredClone(state); assert.throws(() => applyHistoricalEvent(state, quote), /quote/i); assert.deepEqual(state, changed);
});

void test('forest fire is local, finite, recoverable damage beside an actual forest', () => {
  const state = world();
  for (const tile of state.tiles) if (tile.terrain === 'forest') tile.terrain = 'grassland';
  assert.equal(historicalEventQuote(state, 'forest-fire', 0), null);
  const trees = neighbor(state); trees.terrain = 'forest';
  extraTown(state, 'unaffected-town'); town(state).damage = 95; actor(state).resources.materials = 2;
  const quote = historicalEventQuote(state, 'forest-fire', 0); assert.ok(quote); assert.equal(quote.cityId, 'city-0');
  const before = structuredClone(state); const effects = applyHistoricalEvent(state, quote);
  assert.equal(town(state).damage, 100); assert.equal(actor(state).resources.materials, 0);
  assert.equal(town(state).population, town(before).population); assert.deepEqual(town(state).buildings, town(before).buildings);
  assert.equal(town(state).infrastructure, town(before).infrastructure); assert.deepEqual(town(state, 'unaffected-town'), town(before, 'unaffected-town'));
  assert.deepEqual(state.tiles, before.tiles); assert.match(effects.join('; '), /damage 95 → 100/);
});

void test('coastal storm names one real coastal town and damages only its selected endpoint route', () => {
  const state = world(); deliveredTrade(state);
  for (const tile of state.tiles) if (tile.terrain === 'ocean') tile.terrain = 'grassland';
  assert.equal(historicalEventQuote(state, 'coastal-storm', 0), null);
  const inland = extraTown(state, 'other-route-town');
  const inlandSite = state.tiles.find(tile => tile.id > town(state).tileId + state.width * 3 && tile.terrain === 'grassland' && !state.cities.some(city => city.tileId === tile.id)); assert.ok(inlandSite);
  inland.tileId = inlandSite.id; inlandSite.owner = 0;
  neighbor(state).terrain = 'ocean';
  const route = state.routes[0]; assert.ok(route?.agreement); route.damage = 45;
  const unrelated = structuredClone(route); unrelated.id = 'unrelated-route'; unrelated.from = inland.id; unrelated.to = 'city-2'; unrelated.owner = 0; unrelated.partner = 2;
  state.routes.push(unrelated);
  const quote = historicalEventQuote(state, 'coastal-storm', 0); assert.ok(quote); assert.equal(quote.routeId, route.id);
  const before = structuredClone(state); const effects = applyHistoricalEvent(state, quote);
  assert.equal(route.damage, 65); assert.equal(route.active, false); assert.match(effects.join('; '), /active true → false/);
  assert.deepEqual(state.routes[1], before.routes[1]); assert.deepEqual(state.cities.slice(1), before.cities.slice(1));
  assert.equal(town(state).damage, 18); assert.deepEqual(state.civilizations, before.civilizations);
});

void test('trade fair spends local-civilization stock after actual delivery without inventing cargo', () => {
  const state = world(); assert.equal(historicalEventQuote(state, 'trade-fair', 0), null); deliveredTrade(state);
  const quote = historicalEventQuote(state, 'trade-fair', 0); assert.ok(quote); assert.deepEqual(quote.paid, { food: 4, materials: 2 });
  const before = structuredClone(state); applyHistoricalEvent(state, quote);
  assert.equal(actor(state).resources.food, actor(before).resources.food - 4);
  assert.equal(actor(state).resources.materials, actor(before).resources.materials - 2);
  assert.equal(actor(state).resources.credits, actor(before).resources.credits + 6);
  assert.equal(actor(state).resources.culture, actor(before).resources.culture + 4);
  assert.deepEqual(state.routes, before.routes); assert.deepEqual(state.cities, before.cities); assert.deepEqual(actor(state, 1), actor(before, 1));
  for (const invalid of ['unfunded', 'closed', 'blocked', 'never-delivered', 'stale'] as const) {
    const candidate = structuredClone(before); const route = candidate.routes[0]; assert.ok(route?.agreement);
    if (invalid === 'unfunded') actor(candidate).resources.food = 3;
    if (invalid === 'closed') route.agreement.closedRound = candidate.round;
    if (invalid === 'blocked') route.agreement.blockedReason = 'No supplies';
    if (invalid === 'never-delivered') route.agreement.deliveryCount = 0;
    if (invalid === 'stale') candidate.round += route.agreement.terms.cadenceRounds + 1;
    assert.equal(historicalEventQuote(candidate, 'trade-fair', 0), null, invalid);
  }
});

void test('industrial accident requires actual current paid operation, never an idle or stale factory', () => {
  const state = world(); const city = town(state); actor(state).era = 2;
  city.buildings.push('guild-workshop'); city.buildingOperations = { 'guild-workshop': { enabled: true, lastResult: null } };
  assert.equal(historicalEventQuote(state, 'industrial-accident', 0), null);
  resolveEconomy(state, []);
  const operation = city.buildingOperations['guild-workshop']; assert.ok(operation?.lastResult); assert.equal(operation.lastResult.status, 'operated');
  const quote = historicalEventQuote(state, 'industrial-accident', 0); assert.ok(quote); assert.match(quote.cause, /guild-workshop/);
  const before = structuredClone(state); applyHistoricalEvent(state, quote);
  assert.equal(city.damage, town(before).damage + 20); assert.equal(actor(state).resources.materials, actor(before).resources.materials - 4);
  assert.deepEqual(city.buildingOperations, town(before).buildingOperations); assert.deepEqual(state.cities.slice(1), before.cities.slice(1));
  for (const invalid of ['paused', 'blocked', 'stale', 'no-output'] as const) {
    const candidate = structuredClone(before); const record = town(candidate).buildingOperations?.['guild-workshop']; assert.ok(record?.lastResult);
    if (invalid === 'paused') record.enabled = false;
    if (invalid === 'blocked') record.lastResult.status = 'blocked';
    if (invalid === 'stale') candidate.round++;
    if (invalid === 'no-output') record.lastResult.produced = {};
    assert.equal(historicalEventQuote(candidate, 'industrial-accident', 0), null, invalid);
  }
});

void test('internal migration pays for real residents and conserves Earth population within canonical housing', () => {
  const state = world(); const source = town(state); const destination = extraTown(state, 'shelter-town'); source.damage = 40;
  const quote = historicalEventQuote(state, 'internal-migration', 0); assert.ok(quote); assert.equal(quote.cityId, source.id); assert.equal(quote.destinationCityId, destination.id);
  assert.deepEqual(quote.paid, { food: 4, credits: 2 });
  const before = structuredClone(state); const population = state.cities.reduce((sum, city) => sum + city.population, 0);
  const effects = applyHistoricalEvent(state, quote);
  assert.equal(source.population, town(before).population - 2); assert.equal(destination.population, town(before, destination.id).population + 2);
  assert.equal(state.cities.reduce((sum, city) => sum + city.population, 0), population);
  assert.ok(destination.population <= cityGrowthFacts(state, destination).capacity);
  assert.equal(actor(state).resources.food, actor(before).resources.food - 4); assert.equal(actor(state).resources.credits, actor(before).resources.credits - 2);
  assert.equal(state.cities.length, before.cities.length); assert.deepEqual(state.tiles, before.tiles); assert.deepEqual(state.routes, before.routes);
  assert.equal(actor(state).marsPopulation, actor(before).marsPopulation); assert.match(effects.join('; '), /population 6 → 4/);
  for (const invalid of ['healthy-source', 'unsafe-destination', 'full-housing', 'foreign', 'last-resident', 'unfunded'] as const) {
    const candidate = structuredClone(before); const from = town(candidate); const to = town(candidate, destination.id);
    if (invalid === 'healthy-source') from.damage = 0;
    if (invalid === 'unsafe-destination') to.wellbeing = 20;
    if (invalid === 'full-housing') to.population = cityGrowthFacts(candidate, to).capacity;
    if (invalid === 'foreign') to.civId = 1;
    if (invalid === 'last-resident') from.population = 1;
    if (invalid === 'unfunded') actor(candidate).resources.food = 0;
    assert.equal(historicalEventQuote(candidate, 'internal-migration', 0), null, invalid);
  }
});

void test('actual Director command records the qualified local cause and effects, while refusal has zero effects', () => {
  const state = world(); harvest(state); const before = structuredClone(state);
  const result = applyCommand(state, { seat: DIRECTOR_SEAT, expectedRevision: state.revision, timestamp: epoch, action: { type: 'event', event: 'cultivated-harvest', target: 0 } });
  assert.equal(result.ok, true, result.error); assert.deepEqual(state, before);
  const event = result.events.find(item => item.type === 'cultivated-harvest'); assert.ok(event);
  assert.equal(event.tileId, town(state).tileId); assert.match(event.cause, /farm|Terraced|cultivat/i); assert.match(event.effects.join('; '), /materials .* → /);
  assert.equal(actor(result.state).resources.food, actor(state).resources.food + 8);
  assert.equal(actor(result.state).resources.materials, actor(state).resources.materials - 3);
  const refused = applyCommand(result.state, { seat: DIRECTOR_SEAT, expectedRevision: result.state.revision, timestamp: epoch, action: { type: 'event', event: 'cultivated-harvest', target: 0 } });
  assert.equal(refused.ok, false); assert.deepEqual(refused.state, result.state); assert.deepEqual(refused.events, []);
});

void test('all six actual command transitions match their exact quoted local changes', () => {
  for (const definition of HISTORICAL_DIRECTOR_EVENTS) {
    const state = world();
    if (definition.id === 'cultivated-harvest') harvest(state);
    if (definition.id === 'forest-fire') neighbor(state).terrain = 'forest';
    if (definition.id === 'coastal-storm') neighbor(state).terrain = 'ocean';
    if (definition.id === 'trade-fair') deliveredTrade(state);
    if (definition.id === 'industrial-accident') {
      actor(state).era = 2; town(state).buildings.push('guild-workshop');
      town(state).buildingOperations = { 'guild-workshop': { enabled: true, lastResult: null } };
      resolveEconomy(state, []);
    }
    if (definition.id === 'internal-migration') { extraTown(state, 'safe-destination'); town(state).damage = 40; }
    const quote = historicalEventQuote(state, definition.id, 0); assert.ok(quote, definition.id);
    assert.ok(historicalEventWeight(state, definition.id, 0) > 0);
    const expected = structuredClone(state); const expectedEffects = applyHistoricalEvent(expected, quote);
    const input = structuredClone(state);
    const result = applyCommand(state, { seat: DIRECTOR_SEAT, expectedRevision: state.revision, timestamp: epoch, action: { type: 'event', event: definition.id, target: 0 } });
    assert.equal(result.ok, true, `${definition.id}: ${result.error}`); assert.deepEqual(state, input);
    assert.deepEqual(result.state.cities, expected.cities, definition.id); assert.deepEqual(result.state.routes, expected.routes, definition.id);
    for (const civilization of expected.civilizations) assert.deepEqual(actor(result.state, civilization.id).resources, civilization.resources, definition.id);
    const event = result.events.find(candidate => candidate.type === definition.id); assert.ok(event, definition.id);
    assert.deepEqual(event.effects, expectedEffects, definition.id); assert.match(event.cause, new RegExp(quote.cityId));
  }
});

void test('direct Director tick cannot bypass historical qualification or cooldown', () => {
  const state = world();
  const input = { expectedRevision: state.revision, kind: 'event' as const, intervalId: 'qualified-event-test', timestamp: epoch, event: 'cultivated-harvest' as const, target: 0 };
  const missing = applyDirectorTick(state, input); assert.equal(missing.ok, false); assert.deepEqual(missing.state, state); assert.deepEqual(missing.events, []);
  harvest(state); state.directorCooldown = 1;
  const cooling = applyDirectorTick(state, input); assert.equal(cooling.ok, false); assert.deepEqual(cooling.state, state); assert.deepEqual(cooling.events, []);
  state.directorCooldown = 0;
  const result = applyDirectorTick(state, input); assert.equal(result.ok, true, result.error);
  assert.equal(actor(result.state).resources.food, actor(state).resources.food + 8);
});

void test('calm cannot erase a historical cooldown through direct or tactical commands, while legacy reset remains unchanged', () => {
  const state = world(); harvest(state);
  const first = applyDirectorTick(state, { expectedRevision: state.revision, kind: 'event', intervalId: 'harvest-before-calm', timestamp: epoch, event: 'cultivated-harvest', target: 0 });
  assert.equal(first.ok, true, first.error); assert.equal(first.state.directorCooldown, 3);
  const direct = applyDirectorTick(first.state, { expectedRevision: first.state.revision, kind: 'event', intervalId: 'direct-calm', timestamp: epoch, event: 'calm', target: 0 });
  const review = applyDirectorTick(first.state, { expectedRevision: first.state.revision, kind: 'review', intervalId: 'review-calm', timestamp: epoch, event: 'calm', target: 0 });
  const tactical = applyCommand(first.state, { expectedRevision: first.state.revision, seat: DIRECTOR_SEAT, timestamp: epoch, action: { type: 'event', event: 'calm', target: 0 } });
  assert.equal(tactical.ok, false); assert.deepEqual(tactical.state, first.state); assert.deepEqual(tactical.events, []);
  for (const afterCalm of [direct, review]) {
    assert.equal(afterCalm.ok, true, afterCalm.error); assert.equal(afterCalm.state.directorCooldown, 3);
    const before = structuredClone(afterCalm.state);
    const repeated = applyDirectorTick(afterCalm.state, { expectedRevision: afterCalm.state.revision, kind: 'event', intervalId: 'harvest-after-calm', timestamp: epoch, event: 'cultivated-harvest', target: 0 });
    assert.equal(repeated.ok, false); assert.deepEqual(repeated.state, before); assert.deepEqual(repeated.events, []); assert.deepEqual(afterCalm.state, before);
  }
  const legacy = createWorld(1701, epoch); legacy.phase = DIRECTOR_SEAT; legacy.directorCooldown = 3;
  const legacyDirect = applyDirectorTick(legacy, { expectedRevision: legacy.revision, kind: 'event', intervalId: 'legacy-calm', timestamp: epoch, event: 'calm', target: 0 });
  const legacyTactical = applyCommand(legacy, { expectedRevision: legacy.revision, seat: DIRECTOR_SEAT, timestamp: epoch, action: { type: 'event', event: 'calm', target: 0 } });
  assert.equal(legacyDirect.ok, true, legacyDirect.error); assert.equal(legacyDirect.state.directorCooldown, 0);
  assert.equal(legacyTactical.ok, false); assert.deepEqual(legacyTactical.state, legacy); assert.deepEqual(legacyTactical.events, []);
});
