import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { generateGeography, GENERATED_GEOGRAPHY_VERSION } from '../core/generated-geography.ts';
import { applyCommand, applyRelease, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { CIV_COUNT, type WorldState } from '../core/types.ts';
import { ECONOMY_RULES, IMPROVEMENTS, METAL_RULES, COAL_RULES, PASTORAL_RULES, RESOURCE_IDS } from '../core/content.ts';
import { RELEASES } from '../core/release.ts';
import { isWorldState } from '../core/validation.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { isHillSite, improvementSiteBlock } from '../core/simulation/improvements.ts';
import { createCoalDeposits, createStrategicDeposits } from '../core/simulation/metals.ts';
import { createPastoralSites } from '../core/simulation/pastoral.ts';
import { createCoastalPlanner, coastalPathBlock, foundingSiteEligible, isCoastalSite } from '../core/simulation/coastal.ts';
import { createLandTransportPlanner, createSteamTransportPlanner, landTransportCadence, transportCadence } from '../core/simulation/transport.ts';
import { railEdgeId, railSiteBlock } from '../core/simulation/rail.ts';

const EPOCH = '2000-01-01T00:00:00.000Z';
const seeds = [0, 1, 73, 1701, 90210, 0xffffffff];

function legacy(seed: number): WorldState {
  let state = createWorld(seed, EPOCH);
  for (const release of RELEASES.slice(1)) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, timestamp: EPOCH });
    assert.ok(result.ok, result.error);
    state = result.state;
  }
  return state;
}

for (const seed of seeds) void test(`seed ${seed}: fresh current-rules foundation preserves economy without fabricated migration history`, () => {
  const before = legacy(seed);
  const frozen = JSON.stringify(before);
  const state = createGeneratedWorld(seed, EPOCH);
  assert.ok(isWorldState(state));
  assert.deepEqual(createGeneratedWorld(seed, EPOCH), state);
  assert.equal(JSON.stringify(before), frozen);
  assert.equal(state.releaseId, RELEASES.at(-1)!.id);
  assert.deepEqual(state.unlockedFeatures, RELEASES.at(-1)!.featureIds);
  assert.equal(state.revision, 0);
  assert.equal(state.round, 0);
  assert.equal(state.year, ECONOMY_RULES.initialYear);
  assert.equal(state.clockEpoch, EPOCH);
  assert.equal(state.clockTicks, 0);
  assert.deepEqual(state.origin, { kind: 'generated', generatorVersion: GENERATED_GEOGRAPHY_VERSION, seed, clockEpoch: EPOCH });
  assert.deepEqual(state.independentTurns, before.independentTurns);
  assert.deepEqual(state.civilizations, before.civilizations);
  assert.equal(state.cities.length, CIV_COUNT);
  const geography = generateGeography(seed);
  assert.equal(state.rng, geography.rng);
  assert.deepEqual(state.cities.map(city => city.tileId), geography.capitalTileIds);
  for (const city of state.cities) {
    const previous = before.cities.find(candidate => candidate.id === city.id)!;
    assert.deepEqual({ ...city, tileId: previous.tileId }, previous);
    assert.equal(city.population, 6);
    assert.equal(city.housing?.baseCapacity, 20);
    assert.equal(city.housing?.establishedRound, 0);
    assert.deepEqual(city.buildings, []);
    assert.equal(state.tiles[city.tileId]!.resource, 'food');
    assert.equal(state.tiles[city.tileId]!.terrain, 'grassland');
    for (const tile of state.tiles.filter(tile => tile.owner === city.civId)) assert.ok(hexDistance(tile, state.tiles[city.tileId]!) <= 1);
    assert.ok(legalActions(state, city.civId, EPOCH).some(option => option.action.type === 'settle'));
  }
  for (const tile of state.tiles) {
    const owner = state.cities.find(city => tile.terrain !== 'ocean' && hexDistance(state.tiles[city.tileId]!, tile) <= 1)?.civId ?? null;
    assert.equal(tile.owner, owner);
  }
  assert.ok(state.tiles.filter(tile => tile.owner === null && tile.terrain !== 'ocean' && tile.terrain !== 'mountain').length > 160);
  assert.deepEqual(state.routes, []);
  assert.deepEqual(state.treaties, []);
  assert.deepEqual(state.railEdges, {});
  assert.deepEqual(state.tileAcquisitions, {});
  assert.deepEqual(state.wonders, {});
  assert.deepEqual(state.actionPlans, Array.from({ length: 6 }, () => null));
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0]!.type, 'world-founded');
  assert.match(state.events[0]!.cause, new RegExp(GENERATED_GEOGRAPHY_VERSION));
  assert.match(state.events[0]!.cause, new RegExp(String(seed)));
  assert.deepEqual(state.eventCounts, { 'world-founded': 1 });
  assert.equal(state.events.some(event => event.type === 'release-applied' || event.type === 'world-expanded'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

for (const seed of seeds) void test(`seed ${seed}: canonical finite deposits are rebuilt in dependency order and remain reachable`, () => {
  const state = createGeneratedWorld(seed, EPOCH);
  assert.deepEqual(state.strategicDeposits, createStrategicDeposits(state));
  assert.deepEqual(state.pastoralSites, createPastoralSites(state));
  assert.deepEqual(state.coalDeposits, createCoalDeposits(state));
  assert.equal(state.strategicDeposits!.tileIds.length, METAL_RULES.placement.maximumDeposits);
  assert.equal(state.pastoralSites!.tileIds.length, PASTORAL_RULES.placement.maximumSites);
  assert.equal(state.coalDeposits!.tileIds.length, COAL_RULES.placement.maximumDeposits);
  const ids = [...state.strategicDeposits!.tileIds, ...state.pastoralSites!.tileIds, ...state.coalDeposits!.tileIds];
  assert.equal(new Set(ids).size, ids.length);
  const planner = createLandTransportPlanner(state);
  const capital = state.cities[0]!.tileId;
  for (const layer of [state.strategicDeposits!, state.coalDeposits!]) {
    assert.ok(layer.tileIds.filter(id => planner.quote(capital, id)).length >= 6);
    for (const deposit of Object.values(layer.deposits)) {
      assert.ok(isHillSite(state.tiles[deposit.tileId]!));
      assert.equal(deposit.remaining, deposit.initialReserve);
      assert.equal(deposit.initialReserve, deposit.resource === 'iron' ? METAL_RULES.initialReserve : COAL_RULES.initialReserve);
      assert.ok(!state.cities.some(city => city.tileId === deposit.tileId));
    }
  }
  for (const id of state.pastoralSites!.tileIds) assert.equal(state.tiles[id]!.terrain, 'grassland');
  const mine = IMPROVEMENTS.find(definition => definition.id === 'mine')!;
  assert.ok(state.cities.some(city => state.strategicDeposits!.tileIds.some(id => improvementSiteBlock(state, city, mine, id) === null)));
});

for (const seed of seeds) void test(`seed ${seed}: actual paid initial founding conserves people and restarts exactly`, () => {
  for (let seat = 0; seat < CIV_COUNT; seat++) {
    const state = createGeneratedWorld(seed, EPOCH);
    const option = legalActions(state, seat, EPOCH).find(option => option.action.type === 'settle');
    assert.ok(option);
    const before = structuredClone(state);
    const command = { seat, expectedRevision: state.revision, timestamp: EPOCH, action: option.action };
    const result = applyCommand(state, command);
    assert.ok(result.ok, result.error);
    assert.deepEqual(state, before);
    assert.ok(isWorldState(result.state));
    assert.deepEqual(applyCommand(JSON.parse(JSON.stringify(state)), command), result);
    assert.equal(result.state.cities.reduce((sum, city) => sum + city.population, 0), before.cities.reduce((sum, city) => sum + city.population, 0));
    const founded = result.state.cities.at(-1)!;
    assert.equal(founded.housing?.baseCapacity, 8);
    for (const resource of RESOURCE_IDS) assert.equal(result.state.civilizations[seat]!.resources[resource], before.civilizations[seat]!.resources[resource] - (ECONOMY_RULES.settle.cost[resource as keyof typeof ECONOMY_RULES.settle.cost] ?? 0));
    const beat = catchUpStrategy(result.state, '2000-01-01T00:01:00.000Z');
    assert.ok(beat.ok, beat.error);
    assert.ok(isWorldState(beat.state));
    assert.deepEqual(catchUpStrategy(JSON.parse(JSON.stringify(result.state)), '2000-01-01T00:01:00.000Z'), beat);
  }
});

for (const seed of seeds) void test(`seed ${seed}: real shores offer paid ordinary founding and ocean-interior destinations`, () => {
  const state = createGeneratedWorld(seed, EPOCH);
  const planner = createCoastalPlanner(state);
  const coastalCapitals = state.cities.filter(city => isCoastalSite(state, city.tileId));
  assert.ok(coastalCapitals.length > 0 && coastalCapitals.length < CIV_COUNT);
  for (const city of coastalCapitals) {
    const destination = state.tiles.find(tile => foundingSiteEligible(state, tile) && hexDistance(state.tiles[city.tileId]!, tile) > 3 && planner.quote(city.tileId, tile.id));
    assert.ok(destination);
    const quote = planner.quote(city.tileId, destination.id)!;
    assert.equal(coastalPathBlock(state, quote, city.tileId, destination.id), null);
    assert.ok(quote.tileIds.slice(1, -1).every(id => state.tiles[id]!.terrain === 'ocean'));
    assert.equal(legalActions(state, city.civId, EPOCH).some(option => option.action.type === 'settle-coast'), false);
  }
  const route = state.cities.flatMap(city => legalActions(state, city.civId, EPOCH).flatMap(option => option.action.type === 'settle' && !isCoastalSite(state, city.tileId) && isCoastalSite(state, option.action.tileId) ? [{ seat: city.civId, action: option.action }] : []))[0];
  assert.ok(route, 'An inland capital can pay ordinary founding to reach a real coast');
  const result = applyCommand(state, { ...route, expectedRevision: state.revision, timestamp: EPOCH });
  assert.ok(result.ok, result.error);
  assert.ok(isWorldState(result.state));
  const founded = result.state.cities.at(-1)!;
  assert.ok(isCoastalSite(result.state, founded.tileId));
  assert.deepEqual(founded.buildings, []);
  assert.equal(result.state.civilizations[route.seat]!.technologies.length, 0);
});

void test('capability-enabled topology fixture has genuinely useful town-local rail, not a claimed paid campaign', () => {
  for (const seed of seeds) {
    const state = createGeneratedWorld(seed, EPOCH);
    const planner = createLandTransportPlanner(state);
    let useful = false;
    for (const from of state.cities) for (const to of state.cities.filter(city => city.id !== from.id)) {
      const land = planner.quote(from.tileId, to.tileId);
      if (!land || landTransportCadence(4, land) <= 4) continue;
      const fixture = structuredClone(state);
      for (let index = 1; index < land.tileIds.length; index++) {
        const first = land.tileIds[index - 1]!, second = land.tileIds[index]!;
        const city = fixture.cities.find(city => railSiteBlock(fixture, city, first, second) === null);
        if (!city) continue;
        const edgeId = railEdgeId(first, second);
        fixture.railEdges![edgeId] = { kind: 'rail', ruleVersion: 1, orderId: 'synthetic-topology-only', cityId: city.id, civId: city.civId, edgeId, tileId: Math.min(first, second), toTileId: Math.max(first, second), startedRound: 0, completedRound: 1, paid: { materials: 4, credits: 2 }, strategicPaid: { iron: 1, coal: 1 }, workRequired: 2, eventId: '1:0' };
      }
      const steam = createSteamTransportPlanner(fixture).quote(from.tileId, to.tileId, 4);
      if (steam && transportCadence(4, steam) < landTransportCadence(4, land)) useful = true;
    }
    assert.ok(useful, `seed ${seed} has a rail-shortenable real inter-civilization path`);
    assert.deepEqual(state.railEdges, {});
  }
});

void test('legacy maps and real legacy release replay are unchanged by generated factories', () => {
  const initial = createWorld(1701, EPOCH);
  const bytes = JSON.stringify(initial);
  assert.equal(initial.height, 12);
  assert.deepEqual(initial.cities.map(city => city.tileId), [57, 48, 148, 157, 98]);
  createGeneratedWorld(1701, EPOCH);
  assert.equal(JSON.stringify(createWorld(1701, EPOCH)), bytes);
  assert.equal(JSON.stringify(initial), bytes);
  const released = legacy(1701);
  assert.deepEqual(released.tiles.slice(0, 216), initial.tiles);
  assert.equal(released.height, 24);
  assert.deepEqual(legacy(1701), released);
  assert.notDeepEqual(createGeneratedWorld(1701, EPOCH).tiles, released.tiles);
});

void test('fresh factory rejects missing or malformed epochs and normalizes the seed', () => {
  for (const epoch of ['', 'yesterday', '2000-01-01', '2000-01-01T00:00:00+01:00']) assert.throws(() => createGeneratedWorld(1701, epoch), RangeError);
  assert.throws(() => createGeneratedWorld(1701, undefined as unknown as string), RangeError);
  assert.deepEqual(createGeneratedWorld(-1, EPOCH), createGeneratedWorld(0xffffffff, EPOCH));
  assert.deepEqual(createGeneratedWorld(undefined, EPOCH), createGeneratedWorld(1701, EPOCH));
});
