import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, TECHNOLOGIES } from '../core/content.ts';
import { applyCommand, createWorld, legalActions } from '../core/engine.ts';
import { projectCapabilities } from '../core/capabilities.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { availableCampusHighGround, selectedCampusHighGround } from '../core/simulation/observatory.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import { isWorldState } from '../core/validation.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { coastalPrefixTime, replayCoastalStep } from './fixtures/coastal-prefix.ts';
import { waterLandTown } from './fixtures/water-land-journey.ts';
import { observatoryLearningOperationJourney } from './fixtures/observatory-learning-journey.ts';

let cached: ReturnType<typeof observatoryLearningOperationJourney> | undefined;
function path() { cached ??= observatoryLearningOperationJourney(); return cached; }
function resources(state: WorldState) { const actor = state.civilizations[0]; assert.ok(actor); return actor.resources; }
function time(state: WorldState): string { return coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 50); }
function refuse(state: WorldState, action: GameAction, seat = 0): void {
  const before = structuredClone(state); const result = applyCommand(state, { seat, expectedRevision: state.revision, timestamp: time(state), action });
  assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(result.events, []); assert.deepEqual(state, before);
}

await test('observatory actual paid start retains deterministic own-Campus high ground', () => {
  const { journey, researched, started } = path(); const city = waterLandTown(started, journey.cityId); const order = city.construction?.active;
  assert.ok(order && !('kind' in order)); assert.deepEqual(order.highGround, { campusTileId: 39, sourceTileId: 22 });
  assert.equal(order.buildingId, 'observatory'); assert.equal(order.workRequired, 14); assert.deepEqual(order.paid, { materials: 30, credits: 16 });
  assert.equal(resources(researched).materials - resources(started).materials, 30);
  assert.equal(resources(researched).credits - resources(started).credits, 16);
  const option = legalActions(researched, 0, time(researched)).find(item => item.action.type === 'build' && item.action.project === 'observatory' && item.action.cityId === journey.cityId);
  assert.ok(option); assert.deepEqual(option.highGround, order.highGround); refuse(started, { type: 'build', project: 'observatory', cityId: journey.cityId });
});

await test('observatory connected cards preserve every prerequisite and fresh-rule gating', () => {
  const unavailable = createWorld(1701, coastalPrefixTime(0), 'settlement-foundry-1');
  const expected: Array<[string, number, string[]]> = [['sailing', 72, ['water-management']], ['celestial-navigation', 132, ['sailing', 'writing']], ['astronomy', 360, ['mathematics', 'celestial-navigation']]];
  for (const [id, cost, requires] of expected) { const definition = TECHNOLOGIES.find(item => item.id === id); assert.ok(definition); assert.equal(definition.cost, cost); assert.deepEqual(definition.requires.toSorted(), requires.toSorted()); refuse(unavailable, { type: 'research', technology: id }); }
  const definition = BUILDINGS.find(item => item.id === 'observatory'); assert.ok(definition); assert.equal(definition.minEra, 2); assert.deepEqual(definition.requires, ['astronomy']); assert.deepEqual(definition.requiresBuildings, ['campus']); assert.deepEqual(definition.operatingInputs, { credits: 2 }); assert.deepEqual(definition.production, { science: 7 });
  refuse(unavailable, { type: 'build', project: 'observatory', cityId: 'city-0' });
});

await test('observatory completion installs exact source and cannot operate in its completion beat', () => {
  const { journey, completed, completionStep } = path(); const city = waterLandTown(completed, journey.cityId); const completion = city.construction?.lastCompleted; assert.ok(completion && !('kind' in completion));
  assert.deepEqual(city.buildingHighGround?.observatory, { campusTileId: 39, sourceTileId: 22 }); assert.deepEqual(completion.highGround, city.buildingHighGround?.observatory);
  assert.equal(city.buildingOperations?.observatory?.lastResult, null); assert.ok(completed.events.find(event => event.id === completion.eventId)?.effects.includes('Retained Campus 39 high ground 22'));
  const control = structuredClone(completionStep.before); const lane = waterLandTown(control, journey.cityId).construction; assert.ok(lane); lane.active = null;
  const result = replayCoastalStep(control, completionStep.input); assert.ok(result.ok); assert.deepEqual(result.state.civilizations, completed.civilizations);
});

await test('observatory later paid operation produces actual Science while Mine staffing survives', () => {
  const { journey, completed, operated } = path(); const city = waterLandTown(operated, journey.cityId); const result = city.buildingOperations?.observatory?.lastResult; assert.ok(result);
  assert.equal(result.status, 'operated'); assert.deepEqual(result.paid, { credits: 2 }); assert.equal(result.residents?.allocated, 3);
  assert.equal(result.produced.science, Math.round(7 * cityProductivity(waterLandTown(completed, journey.cityId)) * 100) / 100);
  assert.equal(city.improvements?.['58']?.operation.lastResult?.residents.allocated, 1); assert.ok(isWorldState(operated));
});

await test('observatory missing foreign and synthetic wrong-origin or absent-Campus starts refuse exactly', () => {
  const { researched } = path(); for (const cityId of ['missing', 'city-1']) refuse(researched, { type: 'build', project: 'observatory', cityId });
  const absent = structuredClone(researched); const absentCity = waterLandTown(absent, 'city-0'); absentCity.buildings = absentCity.buildings.filter(id => id !== 'campus'); delete absentCity.districtSites?.campus; refuse(absent, { type: 'build', project: 'observatory', cityId: 'city-0' });
  const wrong = structuredClone(researched); for (const id of [22, 56]) { const tile = wrong.tiles.find(item => item.id === id); assert.ok(tile); tile.terrain = 'grassland'; tile.elevation = 40; }
  refuse(wrong, { type: 'build', project: 'observatory', cityId: 'city-0' });
  const row = projectCapabilities(wrong, 0, 'city-0', time(wrong)).buildings.find(item => item.nodeId === 'building:observatory'); assert.ok(row); assert.ok(row.blockers.some(blocker => blocker.kind === 'campus-high-ground'));
});

await test('observatory synthetic Credit or resident shortage spends nothing', () => {
  for (const missing of ['credits', 'residents']) {
    const state = structuredClone(path().completed); for (const city of state.cities) for (const [id, operation] of Object.entries(city.buildingOperations ?? {})) operation.enabled = city.id === 'city-0' && id === 'observatory';
    const city = waterLandTown(state, 'city-0'); if (missing === 'credits') resources(state).credits = 0; else city.population = 5;
    const before = structuredClone(resources(state)); allocateOperations(state); const result = city.buildingOperations?.observatory?.lastResult; assert.ok(result);
    assert.equal(result.status, 'blocked'); assert.deepEqual(result.paid, {}); assert.deepEqual(result.produced, {}); assert.equal(result.residents?.allocated, 0); assert.deepEqual(resources(state), before);
  }
});

await test('observatory canonical hill alternative and detached projection preserve exact historical source', () => {
  const { researched, started, completed } = path(); const state = structuredClone(researched);
  const mountain = state.tiles.find(tile => tile.id === 22); assert.ok(mountain); mountain.terrain = 'grassland'; mountain.elevation = 40;
  assert.deepEqual(selectedCampusHighGround(state, waterLandTown(state, 'city-0')), { campusTileId: 39, sourceTileId: 56 });
  assert.deepEqual(availableCampusHighGround(researched, waterLandTown(researched, 'city-0')), [{ campusTileId: 39, sourceTileId: 22 }, { campusTileId: 39, sourceTileId: 56 }]);
  for (const frame of [started, completed]) {
    const row = projectCapabilities(frame, 0, 'city-0', time(frame)).buildings.find(item => item.nodeId === 'building:observatory'); assert.ok(row?.highGround);
    assert.deepEqual(row.highGround.retained, { campusTileId: 39, sourceTileId: 22 });
    const source = row.highGround.retained; assert.ok(source); source.sourceTileId = 999;
    const current = projectCapabilities(frame, 0, 'city-0', time(frame)).buildings.find(item => item.nodeId === 'building:observatory'); assert.equal(current?.highGround?.retained?.sourceTileId, 22);
  }
});

await test('observatory synthetic later terrain loss cannot retarget an already paid source at completion', () => {
  const { completionStep } = path(); const state = structuredClone(completionStep.before);
  for (const id of [22, 56]) { const tile = state.tiles.find(item => item.id === id); assert.ok(tile); tile.terrain = 'grassland'; tile.elevation = 40; }
  assert.deepEqual(availableCampusHighGround(state, waterLandTown(state, 'city-0')), []);
  const result = replayCoastalStep(state, completionStep.input); assert.ok(result.ok, result.error);
  const city = waterLandTown(result.state, 'city-0'); assert.deepEqual(city.buildingHighGround?.observatory, { campusTileId: 39, sourceTileId: 22 });
  const completion = city.construction?.lastCompleted; assert.ok(completion && !('kind' in completion)); assert.deepEqual(completion.highGround, city.buildingHighGround?.observatory);
});

await test('observatory actual pause and resume preserve paid recipes and next-beat operation', () => {
  let state = structuredClone(path().operated);
  for (const enabled of [false, true]) {
    const action = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: time(state), action: { type: 'set-building-operation', cityId: 'city-0', buildingId: 'observatory', enabled } }); assert.ok(action.ok, action.error);
    const result = replayCoastalStep(action.state, { kind: 'strategy', timestamp: coastalPrefixTime(((action.state.independentTurns?.strategyTicks ?? 0) + 1) * 60) }); assert.ok(result.ok, result.error); state = result.state;
    const operation = waterLandTown(state, 'city-0').buildingOperations?.observatory?.lastResult; assert.ok(operation);
    assert.equal(operation.status, enabled ? 'operated' : 'paused'); assert.deepEqual(operation.paid, enabled ? { credits: 2 } : {}); assert.equal(operation.residents?.allocated, enabled ? 3 : 0);
    if (!enabled) assert.deepEqual(operation.produced, {});
  }
});

await test('observatory every real transition replays canonically from the original world', () => {
  const { journey } = path(); let state = structuredClone(journey.initial);
  for (const step of journey.steps) { assert.deepEqual(state, step.before); const before = structuredClone(state); const result = replayCoastalStep(state, step.input); assert.ok(result.ok, result.error); assert.deepEqual(result, step.result); assert.deepEqual(state, before); assert.ok(isWorldState(result.state)); state = result.state; }
  assert.deepEqual(state, journey.state);
});
