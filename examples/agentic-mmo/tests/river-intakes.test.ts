import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILDINGS, IMPROVEMENTS, RESIDENT_CAPACITY_RULES } from '../core/content.ts';
import { conditionDrainage, drainageFacts } from '../core/drainage.ts';
import { applyCommand, catchUpStrategy, createWorld } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { RIVER_INTAKE_RULES } from '../core/river-intake-content.ts';
import type { RiverFlowPlan } from '../core/river-intake-types.ts';
import { openingConstructionWork, resolveConstruction } from '../core/simulation/construction.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { availableImprovementSites, executeImprovementAction, improvementSiteBlock } from '../core/simulation/improvements.ts';
import { allocateOperations, projectOperationAllocation } from '../core/simulation/operations.ts';
import type { City, CityImprovement, GameEvent, HexTile, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const definition = () => { const value = IMPROVEMENTS.find(item => item.id === 'river-intake'); assert.ok(value); return value; };
const town = (state: WorldState, id = 'z-upstream'): City => { const value = state.cities.find(city => city.id === id); assert.ok(value); return value; };
const site = (state: WorldState, id = 'z-upstream'): CityImprovement => { const value = Object.values(town(state, id).improvements ?? {}).find(item => item.improvementId === 'river-intake'); assert.ok(value); return value; };

function install(city: City, tileId: number): void {
  city.improvements = { [tileId]: { improvementId: 'river-intake', tileId, completion: { kind: 'improvement', orderId: `paid-${city.id}`, cityId: city.id, improvementId: 'river-intake', tileId, startedRound: 0, completedRound: 1, paid: { materials: 8, credits: 4 }, workRequired: 4, eventId: `completion-${city.id}` }, operation: { enabled: true, lastResult: null } } };
}

function handBasin(lastLand = 8): WorldState {
  const state = createWorld(1701, epoch, 'settlement-productive-frontiers-1');
  state.unlockedFeatures.push('river-intakes'); state.riverFlow = { ruleVersion: 1, ruleId: 'uniform-runoff-1', lastBeat: null };
  state.round = 2; state.width = lastLand + 2; state.height = 1;
  state.tiles = Array.from({ length: state.width }, (_, id): HexTile => ({ id, q: id, r: 0, terrain: id > lastLand ? 'ocean' : 'grassland', elevation: id > lastLand ? 10 : 80 - id * 2, resource: null, owner: null }));
  const drainage = conditionDrainage(state.tiles, state.width, state.height); assert.ok(drainage);
  state.tiles = drainage.tiles; state.drainage = drainage.drainage;
  state.cities = state.cities.slice(0, 2); state.civilizations = state.civilizations.slice(0, 2); state.routes = [];
  for (const [index, city] of state.cities.entries()) {
    city.id = index === 0 ? 'z-upstream' : 'a-downstream'; city.tileId = index === 0 ? 6 : lastLand === 8 ? 5 : lastLand - 1;
    city.population = RESIDENT_CAPACITY_RULES.communityReserve + 4; city.wellbeing = 50; city.infrastructure = 0; city.damage = 0; city.focus = 'research';
    city.buildings = ['irrigation']; city.buildingOperations = { irrigation: { enabled: true, lastResult: null } };
    city.improvements = {}; city.districtSites = {}; city.construction = { active: null, lastCompleted: null };
    state.tiles[city.tileId]!.owner = city.civId;
    const actor = state.civilizations.find(actor => actor.id === city.civId)!;
    actor.technologies = ['agriculture', 'water-management']; actor.resources.materials = 2;
    const tileId = index === 0 ? 7 : lastLand; state.tiles[tileId]!.owner = city.civId; install(city, tileId);
  }
  return state;
}

function rawBalance(state: WorldState, plan: RiverFlowPlan): void {
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const withdrawals = new Map(plan.withdrawals.map(item => [item.tileId, item.quantity]));
  const incoming = new Map<number, number>();
  const basinSources = new Map<number, number>();
  const basinTaken = new Map<number, number>();
  for (const start of state.tiles.filter(tile => tile.terrain !== 'ocean')) {
    let id = start.id; const visited = new Set<number>();
    while (tiles.get(id)!.terrain !== 'ocean') {
      assert.ok(!visited.has(id)); visited.add(id);
      const next = state.drainage!.downstreamTileIds[id]; assert.ok(next !== null && next !== undefined);
      assert.ok(tiles.get(next)!.elevation < tiles.get(id)!.elevation); id = next;
    }
    basinSources.set(id, (basinSources.get(id) ?? 0) + 1);
    basinTaken.set(id, (basinTaken.get(id) ?? 0) + (withdrawals.get(start.id) ?? 0));
  }
  for (const tile of state.tiles.toSorted((a, b) => b.elevation - a.elevation || a.id - b.id)) {
    const available = (incoming.get(tile.id) ?? 0) + (tile.terrain === 'ocean' ? 0 : 1);
    const taken = withdrawals.get(tile.id) ?? 0; assert.ok(taken <= available);
    const result = state.cities.flatMap(city => Object.values(city.improvements ?? {})).find(item => item.tileId === tile.id)?.operation.lastResult;
    if (result?.river) {
      assert.equal(result.river.availableBefore, available); assert.equal(result.river.withdrawn, taken); assert.equal(result.river.remainingAfter, available - taken);
    }
    const next = state.drainage!.downstreamTileIds[tile.id];
    if (next !== null && next !== undefined) incoming.set(next, (incoming.get(next) ?? 0) + available - taken);
    else assert.equal(plan.outlets.find(outlet => outlet.tileId === tile.id)?.quantity, available);
  }
  assert.equal(plan.sourceUnits, state.tiles.filter(tile => tile.terrain !== 'ocean').length);
  assert.equal(plan.sourceUnits, plan.withdrawals.reduce((sum, item) => sum + item.quantity, 0) + plan.outlets.reduce((sum, item) => sum + item.quantity, 0));
  for (const outlet of plan.outlets) assert.equal(basinSources.get(outlet.tileId) ?? 0, (basinTaken.get(outlet.tileId) ?? 0) + outlet.quantity);
}

function freshEngineFixture() {
  const state = createGeneratedWorld(1701, epoch, RIVER_INTAKE_RULES.releaseId);
  const facts = drainageFacts(state.drainage!, state.tiles);
  const pair = state.cities.flatMap(city => state.tiles.filter(tile => tile.id !== city.tileId && !state.cities.some(other => other.tileId === tile.id) && tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && facts[tile.id]!.contributingLandTiles >= 8 && hexDistance(tile, state.tiles.find(value => value.id === city.tileId)!) <= 3).map(tile => ({ city, tile }))).at(0);
  assert.ok(pair); pair.tile.owner = pair.city.civId;
  syntheticTechnologies(state, pair.city.civId, ['water-management']); syntheticInstitution(state, pair.city.id, 'irrigation');
  pair.city.population = RESIDENT_CAPACITY_RULES.communityReserve + RESIDENT_CAPACITY_RULES.perPaidRecipe + RIVER_INTAKE_RULES.residentsPerOperation; pair.city.wellbeing = 50; pair.city.infrastructure = 0; pair.city.focus = 'research';
  const actor = state.civilizations.find(actor => actor.id === pair.city.civId)!; actor.resources.materials = 100; actor.resources.credits = 100; actor.resources.food = 100;
  assert.ok(isWorldState(state));
  return { state, cityId: pair.city.id, tileId: pair.tile.id, civId: pair.city.civId };
}

void test('hand basin pays upstream eight first; downstream gets one, then nine after pause or unfunded support', () => {
  const initial = handBasin();
  const state = structuredClone(initial); const plan = allocateOperations(state); assert.ok(plan); rawBalance(state, plan);
  assert.deepEqual(plan.withdrawals, [{ cityId: 'z-upstream', civId: 0, tileId: 7, orderId: 'paid-z-upstream', quantity: 8 }]);
  assert.equal(site(state).operation.lastResult!.status, 'operated'); assert.deepEqual(site(state).operation.lastResult!.paid, { materials: 1 });
  assert.equal(site(state, 'a-downstream').operation.lastResult!.blockedReason, 'flow-shortage');
  assert.deepEqual(site(state, 'a-downstream').operation.lastResult!.paid, {}); assert.equal(site(state, 'a-downstream').operation.lastResult!.residents.allocated, 0);
  assert.equal(state.civilizations[1]!.resources.materials, 1);
  for (const pauseSupport of [false, true]) {
    const recovered = structuredClone(initial);
    if (pauseSupport) town(recovered).buildingOperations!.irrigation!.enabled = false;
    else site(recovered).operation.enabled = false;
    const next = allocateOperations(recovered); assert.ok(next); rawBalance(recovered, next);
    const result = site(recovered, 'a-downstream').operation.lastResult!;
    assert.equal(result.status, 'operated'); assert.equal(result.river!.availableBefore, 9); assert.equal(result.river!.remainingAfter, 1);
    assert.equal(site(recovered).operation.lastResult!.river!.withdrawn, 0);
    assert.equal(site(recovered).operation.lastResult!.status, pauseSupport ? 'blocked' : 'paused');
    assert.equal(site(recovered).operation.lastResult!.blockedReason, pauseSupport ? 'support-unfunded' : null);
  }
});

void test('raw confluence and independent outlets conserve every source once, without cross-basin borrowing', () => {
  const state = handBasin(); state.width = 5; state.height = 5;
  const tiles = Array.from({ length: 25 }, (_, id): HexTile => ({ id, q: id % 5, r: Math.floor(id / 5), terrain: id === 10 || id === 24 ? 'ocean' : 'grassland', elevation: id === 10 || id === 24 ? 10 : id === 11 ? 40 : id === 7 || id === 12 ? 50 : 70, owner: null, resource: null }));
  const graph = conditionDrainage(tiles, 5, 5); assert.ok(graph); state.tiles = graph.tiles; state.drainage = graph.drainage;
  assert.equal(state.drainage.downstreamTileIds[7], 11); assert.equal(state.drainage.downstreamTileIds[12], 11);
  for (const city of state.cities) city.improvements = {};
  const plan = allocateOperations(state); assert.ok(plan); rawBalance(state, plan);
  assert.equal(plan.sourceUnits, 23); assert.equal(plan.outlets.length, 2); assert.ok(plan.outlets.every(outlet => outlet.quantity > 0));
  const isolated = handBasin(14); isolated.width = 31;
  const branches = Array.from({ length: 31 }, (_, id): HexTile => ({ id, q: id, r: 0, terrain: id === 15 || id === 16 ? 'ocean' : 'grassland', elevation: id === 15 || id === 16 ? 10 : id < 15 ? 80 - id * 2 : 40 + (id - 17) * 2, owner: id === 6 || id === 7 ? 0 : 1, resource: null }));
  const separate = conditionDrainage(branches, 31, 1); assert.ok(separate); isolated.tiles = separate.tiles; isolated.drainage = separate.drainage;
  const third = structuredClone(town(isolated, 'a-downstream')); third.id = 'b-other-basin'; third.tileId = 19; install(third, 18); isolated.cities.push(third);
  isolated.civilizations[1]!.resources.materials = 3;
  const separatedPlan = allocateOperations(isolated); assert.ok(separatedPlan); rawBalance(isolated, separatedPlan);
  assert.equal(site(isolated, 'a-downstream').operation.lastResult!.river!.availableBefore, 7); assert.equal(site(isolated, 'a-downstream').operation.lastResult!.blockedReason, 'flow-shortage');
  assert.equal(site(isolated, 'b-other-basin').operation.lastResult!.river!.availableBefore, 13); assert.equal(site(isolated, 'b-other-basin').operation.lastResult!.status, 'operated');
});

void test('flow and shared Materials follow elevation then numeric tile ID, never array or city ID order', () => {
  const state = handBasin(); state.width = 21; state.height = 1;
  const tiles = Array.from({ length: 21 }, (_, id): HexTile => ({ id, q: id, r: 0, terrain: id === 9 || id === 10 ? 'ocean' : 'grassland', elevation: id === 9 || id === 10 ? 10 : id < 9 ? 80 - id * 5 : 40 + (id - 11) * 5, owner: 0, resource: null }));
  const graph = conditionDrainage(tiles, 21, 1); assert.ok(graph); state.tiles = graph.tiles; state.drainage = graph.drainage;
  town(state, 'a-downstream').civId = 0; town(state, 'a-downstream').tileId = 13; install(town(state, 'a-downstream'), 12);
  state.civilizations[0]!.resources.materials = 3;
  const normal = structuredClone(state); const normalPlan = allocateOperations(normal); assert.ok(normalPlan); rawBalance(normal, normalPlan);
  assert.equal(normalPlan.withdrawals.length, 1); assert.equal(normalPlan.withdrawals[0]!.tileId, 7);
  assert.equal(site(normal, 'a-downstream').operation.lastResult!.blockedReason, 'input-shortage');
  const reversed = structuredClone(state); reversed.cities.reverse(); reversed.civilizations.reverse(); reversed.tiles.reverse();
  const reversedPlan = allocateOperations(reversed); assert.deepEqual(reversedPlan, normalPlan);
  for (const city of normal.cities) assert.deepEqual(town(reversed, city.id).improvements, city.improvements);
  for (const actor of normal.civilizations) assert.deepEqual(reversed.civilizations.find(value => value.id === actor.id)!.resources, actor.resources);
});

void test('paused, eligibility, support, Material, resident and seven-flow refusals debit nothing and preserve precedence', () => {
  const cases: Array<[string, (state: WorldState) => void, string | null]> = [
    ['paused', state => { site(state).operation.enabled = false; state.civilizations[0]!.resources.materials = 0; }, null],
    ['ownership', state => { state.tiles[7]!.owner = 1; }, 'site-ineligible'],
    ['support town', state => { state.tiles[6]!.owner = 1; }, 'site-ineligible'],
    ['support missing', state => { town(state).buildings = []; town(state).buildingOperations = {}; }, 'site-ineligible'],
    ['release', state => { state.unlockedFeatures = state.unlockedFeatures.filter(id => id !== 'river-intakes'); }, 'site-ineligible'],
    ['technology', state => { state.civilizations[0]!.technologies = ['agriculture']; }, 'site-ineligible'],
    ['unfunded support', state => { town(state).buildingOperations!.irrigation!.enabled = false; }, 'support-unfunded'],
    ['Material', state => { state.civilizations[0]!.resources.materials = 1; }, 'input-shortage'],
    ['residents', state => { town(state).population -= 1; }, 'resident-shortage'],
  ];
  for (const [label, mutate, reason] of cases) {
    const state = handBasin(); mutate(state); allocateOperations(state);
    const result = site(state).operation.lastResult!;
    assert.equal(result.status, label === 'paused' ? 'paused' : 'blocked', label); assert.equal(result.blockedReason, reason, label);
    assert.deepEqual(result.paid, {}, label); assert.deepEqual(result.produced, {}, label); assert.equal(result.residents.allocated, 0, label); assert.equal(result.river?.withdrawn ?? 0, 0, label);
  }
  for (const [lastLand, available, status] of [[14, 7, 'blocked'], [15, 8, 'operated']] as const) {
    const state = handBasin(lastLand); const plan = allocateOperations(state); assert.ok(plan); rawBalance(state, plan);
    const result = site(state, 'a-downstream').operation.lastResult!; assert.equal(result.river!.availableBefore, available); assert.equal(result.status, status);
    assert.equal(result.residents.allocated, available === 7 ? 0 : 1); assert.deepEqual(result.paid, available === 7 ? {} : { materials: 1 });
  }
});

void test('all ordinary buildings and sites get opening stock and residents before any intake; later output cannot fund it', () => {
  const state = handBasin(); town(state, 'a-downstream').civId = 0; state.tiles[5]!.owner = 0; state.tiles[8]!.owner = 0;
  state.civilizations[0]!.resources.materials = 2;
  allocateOperations(state);
  assert.equal(town(state).buildingOperations!.irrigation!.lastResult!.status, 'operated');
  assert.equal(town(state, 'a-downstream').buildingOperations!.irrigation!.lastResult!.status, 'operated');
  assert.equal(site(state).operation.lastResult!.blockedReason, 'input-shortage');
  const next = handBasin(); const up = town(next); up.population = RESIDENT_CAPACITY_RULES.communityReserve + RESIDENT_CAPACITY_RULES.perPaidRecipe + RIVER_INTAKE_RULES.residentsPerOperation;
  up.improvements!['4'] = { ...structuredClone(site(next)), improvementId: 'hill-commons', tileId: 4, completion: { ...structuredClone(site(next).completion), improvementId: 'hill-commons', tileId: 4 } };
  next.tiles[4]!.owner = 0; next.tiles[4]!.elevation = 72; next.drainage!.terrainBasis[4]![1] = 72 * 4096;
  next.civilizations[0]!.resources.materials = 3;
  allocateOperations(next);
  assert.equal(up.improvements!['4']!.operation.lastResult!.status, 'operated'); assert.equal(site(next).operation.lastResult!.blockedReason, 'resident-shortage');
  const unfunded = handBasin(); unfunded.civilizations[0]!.resources.materials = 1; resolveEconomy(unfunded, []);
  assert.equal(site(unfunded).operation.lastResult!.blockedReason, 'input-shortage'); assert.equal(site(unfunded).operation.lastResult!.river!.withdrawn, 0);
});

void test('missing or stale drainage never manufactures flow; forecasts cannot mutate retained ledger or create events', () => {
  for (const stale of [false, true]) {
    const state = handBasin(); if (stale) state.tiles[0]!.elevation += 1; else delete state.drainage;
    const plan = allocateOperations(state); assert.equal(plan, null); assert.equal(site(state).operation.lastResult!.blockedReason, 'site-ineligible'); assert.equal(site(state).operation.lastResult!.river, undefined);
  }
  const state = handBasin(); const events: GameEvent[] = []; resolveEconomy(state, events); state.events.push(...events);
  assert.equal(events.filter(event => event.type === 'river-flow').length, 1); assert.equal(state.riverFlow!.lastBeat!.round, state.round);
  assert.equal(state.riverFlow!.lastBeat!.eventId, events.find(event => event.type === 'river-flow')!.id);
  const before = structuredClone(state);
  const freeze = (value: unknown): void => { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } };
  freeze(state); const projected = projectOperationAllocation(state);
  assert.deepEqual(state, before); assert.deepEqual(projected.riverFlow, before.riverFlow); assert.deepEqual(projected.events, before.events);
  assert.equal(site(projected).operation.lastResult!.round, before.round + 1);
});

void test('a fully paid but damaged intake retains real withdrawals without claiming Food', () => {
  const state = handBasin(); town(state).damage = 100; resolveEconomy(state, []);
  const result = site(state).operation.lastResult!;
  assert.equal(result.status, 'operated'); assert.deepEqual(result.paid, { materials: 1 }); assert.equal(result.residents.allocated, 1);
  assert.equal(result.river!.withdrawn, 8); assert.deepEqual(result.produced, {}); assert.equal(state.riverFlow!.lastBeat!.withdrawals[0]!.quantity, 8);
});

void test('exact owned supported river sites reject all occupancy and binding collisions and one intake per town', () => {
  const base = handBasin(); town(base).improvements = {};
  assert.equal(improvementSiteBlock(base, town(base), definition(), 7), null);
  assert.deepEqual(availableImprovementSites(base, town(base), definition()), [7]);
  for (const mutate of [
    (state: WorldState) => { town(state).districtSites = { campus: 7 }; },
    (state: WorldState) => { town(state).construction!.active = { kind: 'improvement', id: 'another-order', cityId: town(state).id, improvementId: 'hill-commons', tileId: 7, startedRound: 0, paid: { materials: 12, credits: 6 }, workRequired: 6, workDone: 0, ruleVersion: 1 }; },
    (state: WorldState) => { install(town(state), 4); },
    (state: WorldState) => { state.tiles[7]!.terrain = 'mountain'; },
    (state: WorldState) => { state.tiles[7]!.terrain = 'ocean'; },
    (state: WorldState) => { town(state).tileId = 0; },
    (state: WorldState) => { state.tileAcquisitions!['7'] = { ruleVersion: 1, id: 'territory-7', cityId: 'another-town', civId: 0, cityTileId: 6, tileId: 7, pathTileIds: [6, 7], distance: 1, priorCivilizationPurchases: 0, acquiredRound: 0, paid: { credits: 8 }, eventId: 'binding' }; },
  ]) {
    const state = structuredClone(base); mutate(state); const before = structuredClone(state);
    assert.notEqual(improvementSiteBlock(state, town(state), definition(), 7), null); assert.deepEqual(state, before);
  }
  assert.notEqual(improvementSiteBlock(base, town(base), definition(), 6), null);
});

void test('paid construction stalls on lost support/site, resumes same payment and cannot operate on completion beat', () => {
  const state = handBasin(); const city = town(state); city.improvements = {}; state.civilizations[0]!.resources.materials = 20;
  const events: GameEvent[] = []; executeImprovementAction(state, 0, { type: 'improve', cityId: city.id, improvementId: 'river-intake', tileId: 7 }, events);
  const order = structuredClone(city.construction!.active); assert.ok(order); assert.deepEqual(order.paid, { materials: 8, credits: 4 });
  const resources = structuredClone(state.civilizations[0]!.resources);
  for (const supportLost of [true, false]) {
    state.round += 1;
    if (supportLost) city.buildings = []; else state.tiles[7]!.owner = 1;
    resolveConstruction(state, new Map([[city.id, 4]]), events); assert.deepEqual(city.construction!.active, order); assert.deepEqual(state.civilizations[0]!.resources, resources);
    city.buildings = ['irrigation']; state.tiles[7]!.owner = 0;
  }
  state.round += 1; resolveConstruction(state, new Map([[city.id, 4]]), events);
  assert.equal(city.construction!.active, null); assert.deepEqual(site(state).completion.paid, order.paid); assert.equal(site(state).completion.orderId, order.id);
  allocateOperations(state); assert.equal(site(state).operation.lastResult, null);
  state.round += 1; allocateOperations(state); assert.equal(site(state).operation.lastResult!.status, 'operated');
  const actual = handBasin(); town(actual).improvements = {}; actual.civilizations[0]!.resources.materials = 20;
  executeImprovementAction(actual, 0, { type: 'improve', cityId: town(actual).id, improvementId: 'river-intake', tileId: 7 }, []);
  for (let count = 0; count < 12 && town(actual).construction!.active; count++) { actual.round += 1; assert.ok(openingConstructionWork(actual).has(town(actual).id)); resolveEconomy(actual, []); }
  assert.equal(town(actual).construction!.active, null);
  assert.equal(site(actual).operation.lastResult, null); assert.equal(actual.riverFlow!.lastBeat!.withdrawals.some(item => item.cityId === town(actual).id), false);
});

void test('unchanged Irrigation, Water mill and Aqueduct recipes remain usable without any river intake', () => {
  assert.deepEqual(BUILDINGS.find(item => item.id === 'irrigation')!.operatingInputs, { materials: 1 });
  assert.deepEqual(BUILDINGS.find(item => item.id === 'irrigation')!.production, { food: 5 });
  assert.deepEqual(BUILDINGS.find(item => item.id === 'water-mill')!.production, { food: 1, materials: 2 });
  assert.equal(BUILDINGS.find(item => item.id === 'aqueduct')!.siteRequirement, 'mountain-catchment');
  assert.deepEqual(definition().cost, { materials: 8, credits: 4 }); assert.equal(definition().requiredWork, 4); assert.deepEqual(definition().production, { food: 3 });
  const withFlow = handBasin(); for (const city of withFlow.cities) city.improvements = {};
  const withoutFlow = structuredClone(withFlow); withoutFlow.unlockedFeatures = withoutFlow.unlockedFeatures.filter(id => id !== 'river-intakes'); delete withoutFlow.riverFlow;
  resolveEconomy(withFlow, []); resolveEconomy(withoutFlow, []);
  assert.deepEqual(withFlow.cities, withoutFlow.cities); assert.deepEqual(withFlow.civilizations, withoutFlow.civilizations);
});

void test('current engine refuses foreign, unsupported, unaffordable, occupied and unbound intake starts atomically', () => {
  const { state: initial, cityId, tileId, civId } = freshEngineFixture();
  const cases: Array<[string, (state: WorldState) => void]> = [
    ['support', state => { const city = town(state, cityId); city.buildings = city.buildings.filter(id => id !== 'irrigation'); delete city.buildingOperations!.irrigation; }],
    ['technology', state => { state.civilizations[civId]!.technologies = state.civilizations[civId]!.technologies.filter(id => id !== 'water-management'); }],
    ['Materials', state => { state.civilizations[civId]!.resources.materials = 7; }],
    ['Credits', state => { state.civilizations[civId]!.resources.credits = 3; }],
    ['ownership', state => { state.tiles.find(tile => tile.id === tileId)!.owner = (civId + 1) % 5; }],
    ['occupied', state => { town(state, cityId).districtSites = { campus: tileId }; }],
    ['purchase binding', state => { state.tileAcquisitions![String(tileId)] = { ruleVersion: 1, id: 'territory-7', cityId: 'another-town', civId, cityTileId: town(state, cityId).tileId, tileId, pathTileIds: [town(state, cityId).tileId, tileId], distance: 1, priorCivilizationPurchases: 0, acquiredRound: 0, paid: { credits: 8 }, eventId: 'binding' }; }],
    ['control binding', state => { state.border!.controls[String(tileId)] = { ruleVersion: 1, incidentId: 'border-1', purchaseId: 'territory-1', tileId, previousCivId: (civId + 1) % 5, previousCityId: 'previous-town', cityId: 'another-town', civId, round: 0, eventId: 'control' }; }],
  ];
  for (const [label, mutate] of cases) {
    const state = structuredClone(initial); mutate(state); const before = structuredClone(state);
    const result = applyCommand(state, { seat: civId, expectedRevision: state.revision, timestamp: at(20), action: { type: 'improve', cityId, improvementId: 'river-intake', tileId } });
    assert.equal(result.ok, false, label); assert.deepEqual(result.state, before, label); assert.deepEqual(result.events, [], label); assert.deepEqual(state, before, label);
  }
  const foreign = applyCommand(initial, { seat: (civId + 1) % 5, expectedRevision: initial.revision, timestamp: at(20), action: { type: 'improve', cityId, improvementId: 'river-intake', tileId } });
  assert.equal(foreign.ok, false); assert.deepEqual(foreign.state, initial); assert.deepEqual(foreign.events, []);
});

void test('fresh current-engine paid intake construction and completed flow replay exactly after same-version JSON restart', () => {
  const fixture = freshEngineFixture(); let state = fixture.state; const { cityId, tileId, civId } = fixture;
  const command = { seat: civId, expectedRevision: state.revision, timestamp: at(20), action: { type: 'improve' as const, cityId, improvementId: 'river-intake', tileId } };
  const first = applyCommand(state, command); assert.ok(first.ok, first.error); assert.equal(first.state.civilizations.find(value => value.id === civId)!.resources.materials, 92);
  const duplicate = applyCommand(first.state, command); assert.equal(duplicate.ok, false); assert.deepEqual(duplicate.state, first.state); state = first.state;
  let operated = false;
  for (let count = 0; count < 8 && !operated; count++) {
    const before = structuredClone(state); const restored: unknown = JSON.parse(JSON.stringify(state)); assert.ok(isWorldState(restored));
    const timestamp = at(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60);
    const next = catchUpStrategy(state, timestamp); assert.ok(next.ok, next.error); assert.ok(isWorldState(next.state)); assert.deepEqual(state, before); assert.deepEqual(catchUpStrategy(restored, timestamp), next);
    state = next.state; const result = state.cities.find(city => city.id === cityId)!.improvements?.[String(tileId)]?.operation.lastResult;
    operated = result?.status === 'operated';
    if (operated) { assert.equal(result!.river!.withdrawn, 8); assert.ok((result!.produced.food ?? 0) > 0); assert.equal(state.riverFlow!.lastBeat!.withdrawals.length, 1); }
  }
  assert.ok(operated);
});
