import assert from 'node:assert/strict';
import test from 'node:test';
import { IMPROVEMENTS } from '../core/content.ts';
import { applyCommand, catchUpStrategy, createWorld, legalActions, observe } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import { createWoodlands, prepareWoodlandBeat, reserveWoodlandHarvest, woodlandOperationReceipt } from '../core/simulation/woodlands.ts';
import type { City, CityImprovement, GameAction, GameEvent, WorldState } from '../core/types.ts';
import type { WoodlandState } from '../core/woodland-types.ts';
import { isWorldState } from '../core/validation.ts';
import { syntheticTechnologies } from './fixtures/coastal-prefix.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const rulesId = 'settlement-renewing-worked-woodlands-1';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const town = (state: WorldState): City => state.cities.find(city => city.id === 'city-0')!;
const stand = (state: WorldState, tileId = 56) => state.woodlands!.stands[String(tileId)]!;
const site = (state: WorldState, tileId = 56): CityImprovement => town(state).improvements![String(tileId)]!;

function syntheticOpening(improvementId: 'lumber-mill' | 'charcoal-clearing' = 'charcoal-clearing'): WorldState {
  const state = createWorld(1701, epoch, 'settlement-river-intakes-1');
  state.unlockedFeatures.push('renewing-worked-woodlands');
  state.woodlands = { ruleVersion: 1, profileId: 'worked-woodlands-1', stands: Object.fromEntries(state.tiles.filter(tile => tile.terrain === 'forest').map(tile => [String(tile.id), { stock: 8, lastHarvestRound: null }])), lastBeat: null } satisfies WoodlandState;
  syntheticTechnologies(state, 0, ['kiln-firing', 'machinery']);
  const city = town(state); city.population = 6; city.wellbeing = 50; city.infrastructure = 0;
  city.improvements = {}; city.construction = { active: null, lastCompleted: null };
  state.civilizations[0]!.resources.materials = 100;
  state.civilizations[0]!.resources.food = 0;
  const definition = IMPROVEMENTS.find(item => item.id === improvementId)!;
  city.improvements['56'] = { improvementId, tileId: 56, completion: { kind: 'improvement', orderId: 'synthetic-paid-forest-56', cityId: city.id, improvementId, tileId: 56, startedRound: 0, completedRound: 0, paid: { ...definition.cost }, workRequired: definition.requiredWork, eventId: 'synthetic-completion-56' }, operation: { enabled: true, lastResult: null } };
  state.round = 1;
  return state;
}

void test('eight full operations empty one stand, the ninth refuses and recovers, and only the tenth can work', context => {
  for (const improvementId of ['lumber-mill', 'charcoal-clearing'] as const) {
    const state = syntheticOpening(improvementId);
    state.civilizations[0]!.resources.food = 100;
    const terrain = structuredClone(state.tiles);
    for (let round = 1; round <= 10; round++) {
      state.round = round;
      const events: GameEvent[] = [];
      resolveEconomy(state, events);
      const result = site(state).operation.lastResult!;
      const worked = round !== 9;
      assert.equal(result.status, worked ? 'operated' : 'blocked', `${improvementId} round ${round}: ${result.blockedReason}`);
      assert.equal(result.blockedReason, worked ? null : 'woodland-shortage');
      assert.equal(result.residents.allocated, worked ? 1 : 0);
      assert.deepEqual(result.paid, worked && improvementId === 'charcoal-clearing' ? { materials: 1 } : {});
      assert.ok(result.woodland, 'Every forest operation needs an actual local-work receipt');
      assert.equal(result.woodland.harvested, worked ? 1 : 0);
      assert.equal(result.woodland!.recovered, worked ? 0 : 1);
      assert.equal(stand(state).stock, round <= 8 ? 8 - round : round === 9 ? 1 : 0);
      assert.equal(stand(state).lastHarvestRound, round === 9 ? 8 : round);
      if (!worked) assert.deepEqual(result.produced, {});
      else assert.ok((result.produced[improvementId === 'lumber-mill' ? 'materials' : 'energy'] ?? 0) > 0);
      const beat = state.woodlands!.lastBeat!;
      assert.equal(beat.round, round);
      assert.equal(events.filter(event => event.type === 'woodland-beat').length, 1);
      assert.equal(beat.eventId, events.find(event => event.type === 'woodland-beat')!.id);
      assert.deepEqual(beat.entries.find(entry => entry.tileId === 56)!.harvester, worked ? { cityId: 'city-0', civId: 0, improvementId, orderId: 'synthetic-paid-forest-56' } : null);
      assert.deepEqual(state.tiles, terrain);
    }
  }
  context.diagnostic('Synthetic paid completion, prerequisites and opening household Food100 isolate real allocator/economy transitions; real upkeep remains active, with no autonomous selection or balance claim.');
});

void test('paused, insufficient opening inputs, staffing, site and reservation refusals harvest and allocate nothing', () => {
  const cases: Array<[string, (state: WorldState) => void, string | null]> = [
    ['paused', state => { site(state).operation.enabled = false; }, null],
    ['missing Material', state => { state.civilizations[0]!.resources.materials = 0; }, 'input-shortage'],
    ['fractional Material', state => { state.civilizations[0]!.resources.materials = 0.99; }, 'input-shortage'],
    ['community reserves all residents', state => { town(state).population = 3; }, 'resident-shortage'],
    ['prior paid building reserves residents', state => { town(state).buildings = ['kiln']; town(state).buildingOperations = { kiln: { enabled: true, lastResult: null } }; }, 'resident-shortage'],
    ['foreign site', state => { state.tiles.find(tile => tile.id === 56)!.owner = 1; }, 'site-ineligible'],
    ['foreign support town', state => { state.tiles.find(tile => tile.id === town(state).tileId)!.owner = 1; }, 'site-ineligible'],
    ['reserved site', state => { town(state).construction!.active = { id: 'synthetic-reservation', cityId: 'city-0', buildingId: 'campus', tileId: 56, ruleVersion: 1, startedRound: 0, paid: { materials: 12, credits: 6 }, workRequired: 8, workDone: 0 }; }, 'site-ineligible'],
  ];
  for (const [label, mutate, reason] of cases) {
    const state = syntheticOpening(); stand(state).stock = 3; mutate(state);
    resolveEconomy(state, []);
    const result = site(state).operation.lastResult!;
    assert.equal(result.status, label === 'paused' ? 'paused' : 'blocked', label);
    assert.equal(result.blockedReason, reason, label);
    assert.deepEqual(result.paid, {}, label); assert.deepEqual(result.produced, {}, label);
    assert.equal(result.residents.allocated, 0, label);
    assert.deepEqual(result.woodland, { ruleVersion: 1, profileId: 'worked-woodlands-1', tileId: 56, required: 1, opening: 3, harvested: 0, recovered: 1, closing: 4 }, label);
    assert.deepEqual(stand(state), { stock: 4, lastHarvestRound: null }, label);
  }
});

void test('a funded zero-output operation consumes its complete work lot and unchanged ordinary recipe', () => {
  for (const improvementId of ['lumber-mill', 'charcoal-clearing'] as const) {
    const state = syntheticOpening(improvementId); town(state).damage = 100;
    resolveEconomy(state, []);
    const result = site(state).operation.lastResult!;
    assert.equal(result.status, 'operated'); assert.deepEqual(result.produced, {});
    assert.deepEqual(result.paid, improvementId === 'charcoal-clearing' ? { materials: 1 } : {});
    assert.equal(result.residents.allocated, 1); assert.equal(result.woodland!.harvested, 1);
    assert.deepEqual(stand(state), { stock: 7, lastHarvestRound: 1 });
  }
});

void test('local stands recover independently without pooling, while full idle stock is capped', () => {
  const state = syntheticOpening(); stand(state).stock = 0; stand(state, 58).stock = 3;
  resolveEconomy(state, []);
  assert.equal(site(state).operation.lastResult!.blockedReason, 'woodland-shortage');
  assert.equal(stand(state).stock, 1); assert.equal(stand(state, 58).stock, 4);
  const full = state.woodlands!.lastBeat!.entries.find(entry => entry.tileId !== 56 && entry.tileId !== 58)!;
  assert.deepEqual({ opening: full.opening, harvested: full.harvested, recovered: full.recovered, closing: full.closing }, { opening: 8, harvested: 0, recovered: 0, closing: 8 });
  const baseline = syntheticOpening(); stand(baseline).stock = 0; stand(baseline, 58).stock = 3; site(baseline).operation.enabled = false;
  resolveEconomy(baseline, []);
  assert.deepEqual(stand(state, 58), stand(baseline, 58));
});

void test('duplicate and skipped real economy rounds fail before any resource, operation, event or stock mutation', () => {
  const state = syntheticOpening(); resolveEconomy(state, []);
  for (const round of [1, 3]) {
    const candidate = structuredClone(state); candidate.round = round;
    const before = structuredClone(candidate); const events: GameEvent[] = [];
    assert.throws(() => resolveEconomy(candidate, events), /woodland.*round|round.*woodland/i);
    assert.deepEqual(candidate, before); assert.deepEqual(events, []);
  }
  const firstSkipped = syntheticOpening(); firstSkipped.round = 2;
  const before = structuredClone(firstSkipped);
  assert.throws(() => resolveEconomy(firstSkipped, []), /woodland.*round|round.*woodland/i);
  assert.deepEqual(firstSkipped, before);
});

void test('allocation quotes deeply clone woodland state and preserve source stocks, ledger and events', () => {
  const state = syntheticOpening(); resolveEconomy(state, []);
  const before = structuredClone(state);
  const freeze = (value: unknown): void => { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } };
  freeze(state);
  for (let index = 0; index < 2; index++) {
    const projected = projectOperationAllocation(state);
    assert.deepEqual(state, before);
    assert.notStrictEqual(projected.woodlands, state.woodlands);
    assert.notStrictEqual(stand(projected), stand(state));
    assert.deepEqual(projected.events, before.events);
    assert.equal(site(projected).operation.lastResult!.woodland!.opening, 7);
    assert.equal(site(projected).operation.lastResult!.woodland!.closing, 6);
  }
});

void test('fresh selected-rule standard and generated maps register every final forest exactly once without upgrading old rules', () => {
  for (const state of [createWorld(1701, epoch, rulesId), createGeneratedWorld(1701, epoch, rulesId)]) {
    assert.ok(isWorldState(state)); assert.ok(state.woodlands);
    assert.equal(state.woodlands.profileId, 'worked-woodlands-1'); assert.equal(state.woodlands.lastBeat, null);
    assert.deepEqual(Object.keys(state.woodlands.stands).map(Number).sort((a, b) => a - b), state.tiles.filter(tile => tile.terrain === 'forest').map(tile => tile.id).sort((a, b) => a - b));
    for (const value of Object.values(state.woodlands.stands)) assert.deepEqual(value, { stock: 8, lastHarvestRound: null });
    const missing = structuredClone(state); delete missing.woodlands; assert.equal(isWorldState(missing), false);
  }
  const previous = createWorld(1701, epoch, 'settlement-river-intakes-1');
  assert.equal(previous.woodlands, undefined);
  const terrain = structuredClone(previous.tiles); const layer = createWoodlands(previous.tiles);
  layer.stands['56']!.stock = 0; assert.deepEqual(previous.tiles, terrain); assert.equal(previous.woodlands, undefined);
});

void test('preparation and reservation remain detached, reject malformed opening stock and never reserve a current completion twice', () => {
  const state = syntheticOpening(); const before = structuredClone(state);
  const plan = prepareWoodlandBeat(state); assert.ok(plan); assert.deepEqual(state, before);
  const idle = woodlandOperationReceipt(plan, 56); idle.closing = 0;
  assert.equal(woodlandOperationReceipt(plan, 56).closing, 8);
  const worked = reserveWoodlandHarvest(plan, town(state), site(state));
  assert.deepEqual(worked, { ruleVersion: 1, profileId: 'worked-woodlands-1', tileId: 56, required: 1, opening: 8, harvested: 1, recovered: 0, closing: 7 });
  assert.deepEqual(state, before);
  const reserved = structuredClone(plan); assert.throws(() => reserveWoodlandHarvest(plan, town(state), site(state)), /unreserved/); assert.deepEqual(plan, reserved);
  const justCompleted = syntheticOpening(); site(justCompleted).completion.completedRound = 1;
  const freshPlan = prepareWoodlandBeat(justCompleted)!; const unopened = structuredClone(freshPlan);
  assert.throws(() => reserveWoodlandHarvest(freshPlan, town(justCompleted), site(justCompleted)), /previously completed/); assert.deepEqual(freshPlan, unopened);
  for (const stock of [-1, 0.5, 8.01, 9, Number.NaN, Number.POSITIVE_INFINITY]) {
    const malformed = syntheticOpening(); stand(malformed).stock = stock;
    const unchanged = structuredClone(malformed); assert.throws(() => prepareWoodlandBeat(malformed), /whole work-lots/); assert.deepEqual(malformed, unchanged);
  }
  const missing = syntheticOpening(); delete missing.woodlands;
  assert.throws(() => prepareWoodlandBeat(missing), /fresh registered inventory/);
});

function actualAction(state: WorldState, action: GameAction): WorldState {
  const before = structuredClone(state);
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: at(state.round * 60 + 20), action });
  assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state));
  return result.state;
}

function actualBeat(state: WorldState): WorldState {
  const before = structuredClone(state);
  const timestamp = at((state.round + 1) * 60);
  const result = catchUpStrategy(state, timestamp);
  assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state));
  const restored: unknown = JSON.parse(JSON.stringify(state)); assert.ok(isWorldState(restored));
  assert.deepEqual(catchUpStrategy(restored, timestamp), result);
  return result.state;
}

void test('real paid construction earns no completion harvest, then depletion, paused restart and bounded catchup retain exact work', context => {
  let state = createWorld(1701, epoch, rulesId);
  syntheticTechnologies(state, 0, ['kiln-firing']);
  town(state).infrastructure = 0; town(state).wellbeing = 50;
  assert.ok(isWorldState(state));
  const terrain = structuredClone(state.tiles);
  const openingResources = structuredClone(state.civilizations[0]!.resources);
  state = actualAction(state, { type: 'improve', cityId: 'city-0', improvementId: 'charcoal-clearing', tileId: 56 });
  const order = structuredClone(town(state).construction!.active!);
  assert.equal(state.civilizations[0]!.resources.materials, openingResources.materials - 8);
  assert.equal(state.civilizations[0]!.resources.credits, openingResources.credits - 4);
  assert.equal(stand(state).stock, 8); assert.equal(state.woodlands!.lastBeat, null);
  let baseline = structuredClone(state); town(baseline).construction!.active = null;
  for (let count = 0; count < 12 && town(state).construction?.active; count++) {
    state = actualBeat(state); baseline = actualBeat(baseline);
    assert.deepEqual(state.civilizations[0]!.resources, baseline.civilizations[0]!.resources);
    assert.equal(stand(state).stock, 8);
    assert.equal(state.woodlands!.lastBeat!.entries.find(entry => entry.tileId === 56)!.harvester, null);
  }
  assert.equal(town(state).construction!.active, null);
  assert.equal(site(state).completion.orderId, order.id);
  assert.deepEqual(site(state).completion.paid, { materials: 8, credits: 4 });
  assert.equal(site(state).operation.lastResult, null);
  assert.equal(stand(state).lastHarvestRound, null);
  for (let count = 1; count <= 8; count++) {
    state = actualBeat(state);
    assert.equal(site(state).operation.lastResult!.status, 'operated'); assert.equal(stand(state).stock, 8 - count);
  }
  const depletedRound = state.round;
  state = actualBeat(state);
  assert.equal(site(state).operation.lastResult!.blockedReason, 'woodland-shortage');
  assert.deepEqual(site(state).operation.lastResult!.paid, {}); assert.equal(site(state).operation.lastResult!.residents.allocated, 0);
  assert.deepEqual(stand(state), { stock: 1, lastHarvestRound: depletedRound });
  const sameTimestamp = catchUpStrategy(state, at(state.round * 60));
  assert.ok(sameTimestamp.ok); assert.deepEqual(sameTimestamp.state, state); assert.deepEqual(sameTimestamp.events, []);
  const beforePause = structuredClone(state.woodlands);
  state = actualAction(state, { type: 'set-improvement-operation', cityId: 'city-0', improvementId: 'charcoal-clearing', tileId: 56, enabled: false });
  assert.deepEqual(state.woodlands, beforePause);
  const paused = structuredClone(state);
  observe(state, 0, at(state.round * 60 + 20)); legalActions(state, 0, at(state.round * 60 + 20)); JSON.stringify(state);
  assert.deepEqual(state, paused);
  const restored: unknown = JSON.parse(JSON.stringify(state)); assert.ok(isWorldState(restored));
  const batched = catchUpStrategy(restored, at((state.round + 3) * 60)); assert.ok(batched.ok, batched.error);
  for (let count = 0; count < 3; count++) state = actualBeat(state);
  assert.deepEqual(batched.state, state); assert.deepEqual(stand(state), { stock: 4, lastHarvestRound: depletedRound });
  assert.equal(site(state).operation.lastResult!.status, 'paused'); assert.deepEqual(site(state).operation.lastResult!.produced, {});
  state = actualAction(state, { type: 'set-improvement-operation', cityId: 'city-0', improvementId: 'charcoal-clearing', tileId: 56, enabled: true });
  assert.equal(stand(state).stock, 4);
  state = actualBeat(state); assert.equal(stand(state).stock, 3); assert.equal(site(state).operation.lastResult!.status, 'operated');
  assert.deepEqual(state.tiles, terrain);
  context.diagnostic(JSON.stringify({ provenance: 'Fixed seed 1701, synthetic Kiln prerequisites and productivity only; construction/payment/completion/operation/pause/restart/catchup use the actual engine, not a natural controller campaign', orderId: order.id, depletedRound, finalRound: state.round, stock: stand(state).stock }));
});

void test('a currently completed forest site cannot operate before a later beat or replace the full recipe with fractional output', () => {
  const completed = syntheticOpening(); stand(completed).stock = 3;
  site(completed).completion.completedRound = completed.round;
  resolveEconomy(completed, []);
  assert.equal(site(completed).operation.lastResult, null);
  assert.deepEqual(stand(completed), { stock: 4, lastHarvestRound: null });
  assert.equal(completed.woodlands!.lastBeat!.entries.find(entry => entry.tileId === 56)!.harvester, null);
  for (const [improvementId, output, quantity] of [['lumber-mill', 'materials', 4], ['charcoal-clearing', 'energy', 1]] as const) {
    const state = syntheticOpening(improvementId); stand(state).stock = 1;
    const resting = structuredClone(state); site(resting).operation.enabled = false;
    resolveEconomy(state, []); resolveEconomy(resting, []);
    assert.deepEqual(site(state).operation.lastResult!.produced, { [output]: quantity });
    assert.equal(state.civilizations[0]!.resources[output] - resting.civilizations[0]!.resources[output], quantity);
    assert.equal(stand(state).stock, 0); assert.equal(stand(resting).stock, 2);
  }
});
