import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IMPROVEMENTS } from '../core/content.ts';
import { applyCommand, applyRelease, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { CURRENT_RELEASE, RELEASES } from '../core/release.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { availableImprovementSites, emitImprovements, installImprovement } from '../core/simulation/improvements.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import type { GameEvent, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';

const epoch = '2026-10-22T00:00:00.000Z';
const timestamp = '2026-10-22T00:01:00.000Z';
function oldWorld(): WorldState {
  let state = createWorld(1701, epoch);
  for (const release of RELEASES.slice(1)) {
    if (release.id === 'settlement-shore-fisheries-1') break;
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, timestamp: epoch });
    assert.ok(result.ok, result.error); state = result.state;
  }
  assert.equal(state.releaseId, 'settlement-food-budget-1'); return state;
}
function upgrade(state: WorldState): WorldState {
  const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-shore-fisheries-1', timestamp: epoch });
  assert.ok(result.ok, result.error); return result.state;
}

void test('the shore release is only an additive successor; native and generated defaults stay unchanged', () => {
  const food = RELEASES.find(item => item.id === 'settlement-food-budget-1')!; const shore = RELEASES.find(item => item.id === 'settlement-shore-fisheries-1'); assert.ok(shore);
  assert.deepEqual(shore.compatibleFrom, [food.id]); assert.deepEqual(shore.featureIds, [...food.featureIds, 'shore-fisheries']);
  assert.equal(CURRENT_RELEASE.id, 'settlement-foundations-1'); assert.equal(createWorld(1701, epoch).releaseId, 'settlement-foundations-1');
  const generated = createGeneratedWorld(73, epoch); assert.equal(generated.releaseId, 'settlement-living-partnerships-1'); assert.ok(!generated.unlockedFeatures.includes('shore-fisheries'));
});

void test('explicit upgrade retains every inherited map, town, stock, commitment and historical event without free fisheries', () => {
  const state = oldWorld(); const before = structuredClone(state); const upgraded = upgrade(state);
  assert.deepEqual(state, before); assert.ok(isWorldState(upgraded)); assert.equal(upgraded.revision, before.revision + 1); assert.equal(upgraded.round, before.round); assert.equal(upgraded.rng, before.rng);
  for (const key of ['tiles', 'cities', 'civilizations', 'routes', 'actionPlans', 'tileAcquisitions', 'spaceflight', 'origin', 'calendarMilestones', 'historyAdvances'] as const) assert.deepEqual(upgraded[key], before[key], key);
  assert.deepEqual(upgraded.events.slice(0, before.events.length), before.events); assert.ok(upgraded.cities.every(city => !Object.values(city.improvements ?? {}).some(item => item.improvementId === 'shore-fishery')));
  const duplicate = applyRelease(upgraded, { expectedRevision: upgraded.revision, expectedFromReleaseId: upgraded.releaseId, targetReleaseId: upgraded.releaseId, timestamp: epoch });
  assert.equal(duplicate.ok, false); assert.deepEqual(duplicate.state, upgraded); assert.deepEqual(duplicate.events, []);
  const skipped = applyRelease(createWorld(1701, epoch), { expectedRevision: 0, expectedFromReleaseId: 'settlement-foundations-1', targetReleaseId: upgraded.releaseId, timestamp: epoch });
  assert.equal(skipped.ok, false);
});

void test('old releases expose no shore action and reject it with no random draw, charge or state mutation', () => {
  const state = oldWorld(); const before = JSON.stringify(state);
  for (const seat of [0, 1, 2, 3, 4]) assert.ok(!legalActions(state, seat, epoch).some(option => option.action.type === 'improve' && option.action.improvementId === 'shore-fishery'));
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: epoch, action: { type: 'improve', cityId: 'city-0', tileId: 56, improvementId: 'shore-fishery' } });
  assert.equal(result.ok, false); assert.equal(JSON.stringify(result.state), before); assert.equal(JSON.stringify(state), before); assert.deepEqual(result.events, []);
  const first = catchUpStrategy(state, timestamp); const replayed = catchUpStrategy(JSON.parse(before) as WorldState, timestamp);
  assert.ok(first.ok, first.error); assert.deepEqual(replayed, first); assert.deepEqual(catchUpStrategy(first.state, timestamp).state, first.state);
});

void test('unchanged legacy Mine receipts and emitted events remain byte-identical after the additive release', () => {
  const old = oldWorld(); const upgraded = upgrade(old); const definition = IMPROVEMENTS.find(item => item.id === 'mine')!;
  assert.equal(Object.hasOwn(definition, 'operatingInputs'), false);
  const records: string[] = []; const emitted: string[] = [];
  for (const state of [old, upgraded]) {
    state.revision = 100; state.round = 1; const city = state.cities[0]!; city.population = 4;
    const tileId = availableImprovementSites(state, city, definition)[0]; assert.notEqual(tileId, undefined);
    city.construction = { active: null, lastCompleted: null };
    installImprovement(state, city, { kind: 'improvement', id: 'construction-99', cityId: city.id, improvementId: 'mine', tileId: tileId!, ruleVersion: 1, startedRound: 0, paid: { materials: 6, credits: 3 }, workRequired: 4, workDone: 4 }, []);
    state.round++; allocateOperations(state); const result = city.improvements![String(tileId)]!.operation.lastResult!;
    assert.deepEqual(result, { round: 2, status: 'operated', paid: {}, produced: {}, blockedReason: null, residents: { ruleVersion: 1, openingPopulation: 4, communityReserve: 3, required: 1, available: 1, allocated: 1 } });
    records.push(JSON.stringify(result)); const events: GameEvent[] = []; emitImprovements(state, city, events); emitted.push(JSON.stringify(events));
    assert.equal(Object.hasOwn(result, 'inputs'), false); assert.equal(Object.hasOwn(result, 'shortages'), false);
  }
  assert.equal(records[0], records[1]); assert.equal(emitted[0], emitted[1]);
});

void test('the new release does not loosen old Mine receipt validation to accept paid or input-shortage shapes', () => {
  const state = upgrade(oldWorld()); const caught = catchUpStrategy(state, timestamp); assert.ok(caught.ok, caught.error); const valid = caught.state;
  const city = valid.cities[0]!; const definition = IMPROVEMENTS.find(item => item.id === 'mine')!; const tileId = availableImprovementSites(valid, city, definition)[0]!;
  valid.revision++; city.construction = { active: null, lastCompleted: null }; const events: GameEvent[] = [];
  installImprovement(valid, city, { kind: 'improvement', id: `construction-${valid.revision - 1}`, cityId: city.id, improvementId: 'mine', tileId, ruleVersion: 1, startedRound: 0, paid: { materials: 6, credits: 3 }, workRequired: 4, workDone: 4 }, events); commitEvents(valid, events);
  const operated = catchUpStrategy(valid, '2026-10-22T00:02:00.000Z'); assert.ok(operated.ok, operated.error); assert.ok(isWorldState(operated.state));
  for (const mutation of ['paid', 'inputs', 'shortages', 'blocked'] as const) {
    const corrupt = structuredClone(operated.state); const result = corrupt.cities[0]!.improvements![String(tileId)]!.operation.lastResult!;
    if (mutation === 'paid') result.paid.materials = 1;
    if (mutation === 'inputs') result.inputs = [{ resource: 'materials', required: 1, available: 1 }];
    if (mutation === 'shortages') result.shortages = [];
    if (mutation === 'blocked') { result.status = 'blocked'; result.blockedReason = 'input-shortage'; result.residents.allocated = 0; result.produced = {}; }
    assert.equal(isWorldState(corrupt), false, mutation);
  }
});
