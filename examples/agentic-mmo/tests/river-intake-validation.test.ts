import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { atomicWrite } from '../cli/store.ts';
import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { isWorldState } from '../core/validation.ts';
import { turnAdmission } from '../core/simulation/turns.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import { isRiverFlowState, isRiverIntakeOperationResult, type RiverFlowValidationContext } from '../core/river-intake-validation.ts';
import type { RiverFlowState } from '../core/river-intake-types.ts';
import type { City, Civilization, HexTile, ImprovementOperationResult, WorldState } from '../core/types.ts';

const offsets = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;
const features = ['river-intakes', 'settlement-crafts', 'worked-land', 'resident-capacity', 'recurring-decisions', 'building-operations', 'food-budget', 'water-land'];

function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) frozen(child); }
  return value;
}

function result(tileId: number, availableBefore: number, outletTileId: number): ImprovementOperationResult {
  return {
    round: 3, status: 'operated', paid: { materials: 1 }, produced: { food: 3 }, blockedReason: null,
    inputs: [{ resource: 'materials', required: 1, available: 20 }], shortages: [],
    residents: { ruleVersion: 1, openingPopulation: 10, communityReserve: 3, required: 1, available: 4, allocated: 1 },
    river: { ruleVersion: 1, ruleId: 'uniform-runoff-1', tileId, downstreamTileId: tileId + 1, outletTileId, required: 8, availableBefore, withdrawn: 8, remainingAfter: availableBefore - 8, supportBuildingId: 'irrigation', supportAllocationRound: 3 },
  };
}

function fixture(): { state: RiverFlowValidationContext; flow: RiverFlowState } {
  const width = 11, height = 3;
  const tiles: HexTile[] = Array.from({ length: width * height }, (_, id) => {
    const q = id % width, r = Math.floor(id / width);
    return { id, q, r, terrain: q === 10 ? 'ocean' : 'grassland', elevation: q === 10 ? (r === 1 ? 11 : 10) : (r === 1 ? 80 : 50) - q, owner: 0, resource: null };
  });
  const links = tiles.map(tile => tile.terrain === 'ocean' ? null : tiles.filter(other => offsets.some(([q, r]) => other.q === tile.q + q && other.r === tile.r + r) && other.elevation < tile.elevation).sort((a, b) => a.elevation - b.elevation || a.id - b.id)[0]!.id);
  const cities: City[] = [[7, 5, 15, 10], [8, 17, 9, 10], [29, 28, 8, 32]].map(([tileId, cityTileId, available, outlet], index) => {
    const id = `town-${index}`;
    return { id, name: id, civId: 0, tileId: cityTileId!, population: 10, wellbeing: 50, infrastructure: 0, focus: 'growth', damage: 0, buildings: ['irrigation'],
      buildingOperations: { irrigation: { enabled: true, lastResult: { round: 3, status: 'operated', paid: { materials: 1 }, produced: { food: 5 }, shortages: [], residents: { ruleVersion: 1, openingPopulation: 10, communityReserve: 3, required: 3, available: 7, allocated: 3 } } } },
      improvements: { [String(tileId)]: { improvementId: 'river-intake', tileId: tileId!, completion: { kind: 'improvement', orderId: `construction-${index + 1}`, cityId: id, improvementId: 'river-intake', tileId: tileId!, startedRound: 0, completedRound: 1, paid: { materials: 8, credits: 4 }, workRequired: 4, eventId: `5:${index}` }, operation: { enabled: true, lastResult: result(tileId!, available!, outlet!) } } },
    };
  });
  cities[2]!.improvements!['29']!.operation.lastResult!.inputs![0]!.available = 19;
  cities[1]!.improvements!['8']!.operation.lastResult!.inputs![0]!.available = 18;
  const civilizations: Civilization[] = [{ id: 0, name: 'Test', color: '#000000', adjective: 'Test', objective: 'Test', era: 0, resources: { food: 100, materials: 100, credits: 100, energy: 100, science: 0, culture: 0 }, technologies: ['water-management'], researchTarget: '', researchProgress: 0, influence: 0, legitimacy: 50, marsProgress: 0, marsPopulation: 0, marsSupplyStreak: 0, federationStreak: 0, score: 0 }];
  const state: RiverFlowValidationContext = { unlockedFeatures: [...features], round: 3, revision: 9, width, height, tiles, drainage: { ruleVersion: 1, width, height, terrainBasis: tiles.map(tile => [tile.terrain, tile.elevation * 4096]), downstreamTileIds: links }, cities, civilizations, events: [{ id: '9:0', round: 3, type: 'river-flow', title: 'Flow', detail: 'uniform-runoff-1 at strategic round 3', actor: null, target: null, tileId: null, cause: 'Uniform runoff', effects: ['Land-source units 30', 'Withdrawn 24', 'Ocean outlet residual 6', 'town-0/7/construction-1: withdrew 8', 'town-2/29/construction-3: withdrew 8', 'town-1/8/construction-2: withdrew 8'], importance: 1 }] };
  const flow: RiverFlowState = { ruleVersion: 1, ruleId: 'uniform-runoff-1', lastBeat: { ruleVersion: 1, ruleId: 'uniform-runoff-1', round: 3, sourceUnits: 30, withdrawals: [cities[0]!, cities[2]!, cities[1]!].map(city => { const intake = Object.values(city.improvements!)[0]!; return { cityId: city.id, civId: city.civId, tileId: intake.tileId, orderId: intake.completion.orderId, quantity: 8 }; }), outlets: [{ tileId: 10, quantity: 4 }, { tileId: 21, quantity: 0 }, { tileId: 32, quantity: 2 }], eventId: '9:0' } };
  return { state, flow };
}

function intake(state: RiverFlowValidationContext, index = 0) { return Object.values(state.cities[index]!.improvements!)[0]!; }
function operation(state: RiverFlowValidationContext, index = 0) { return intake(state, index).operation.lastResult!; }

void test('independent raw links conserve two basins and confluence without allocator facts or mutating frozen input', () => {
  const { state, flow } = fixture();
  const before = structuredClone({ state, flow });
  const basinSources = new Map<number, number>();
  for (const tile of state.tiles) {
    if (tile.terrain === 'ocean') continue;
    let node = tile.id;
    while (state.drainage!.downstreamTileIds[node] !== null) node = state.drainage!.downstreamTileIds[node]!;
    basinSources.set(node, (basinSources.get(node) ?? 0) + 1);
  }
  assert.deepEqual([...basinSources].sort((a, b) => a[0] - b[0]), [[10, 20], [32, 10]]);
  assert.equal(flow.lastBeat!.sourceUnits, 30);
  for (const outlet of flow.lastBeat!.outlets) {
    const removed = flow.lastBeat!.withdrawals.filter(item => operation(state, state.cities.findIndex(city => city.id === item.cityId)).river!.outletTileId === outlet.tileId).reduce((sum, item) => sum + item.quantity, 0);
    assert.equal(removed + outlet.quantity, basinSources.get(outlet.tileId) ?? 0);
  }
  assert.ok(isRiverFlowState(frozen(flow), frozen(state)));
  assert.deepEqual({ state, flow }, before);
  const reordered = structuredClone(state); reordered.tiles.reverse(); reordered.cities.reverse(); reordered.civilizations.reverse();
  assert.ok(isRiverFlowState(flow, reordered));
});

void test('latest ledger rejects identity, ordering, duplicate, stale, budget, outlet and source forgeries', () => {
  const mutations: Array<(value: ReturnType<typeof fixture>) => void> = [
    ({ flow }) => { flow.ruleVersion = 2 as 1; },
    ({ flow }) => { flow.lastBeat = null; },
    ({ flow }) => { flow.lastBeat!.round--; },
    ({ flow }) => { flow.lastBeat!.sourceUnits++; },
    ({ flow }) => { flow.lastBeat!.withdrawals[0]!.quantity = 7; },
    ({ flow }) => { flow.lastBeat!.withdrawals[0]!.tileId = 8; },
    ({ flow }) => { flow.lastBeat!.withdrawals[0]!.cityId = 'town-1'; },
    ({ flow }) => { flow.lastBeat!.withdrawals[0]!.civId = 1; },
    ({ flow }) => { flow.lastBeat!.withdrawals[0]!.orderId = 'construction-99'; },
    ({ flow }) => { flow.lastBeat!.withdrawals.push({ ...flow.lastBeat!.withdrawals[0]! }); },
    ({ flow }) => { flow.lastBeat!.withdrawals.pop(); },
    ({ flow }) => { flow.lastBeat!.withdrawals.reverse(); },
    ({ flow }) => { flow.lastBeat!.outlets[0]!.quantity++; },
    ({ flow }) => { flow.lastBeat!.outlets[0]!.quantity--; flow.lastBeat!.outlets[2]!.quantity++; },
    ({ flow }) => { flow.lastBeat!.outlets.pop(); },
    ({ flow }) => { flow.lastBeat!.outlets.reverse(); },
    ({ flow }) => { flow.lastBeat!.outlets[0]!.tileId = 9; },
    ({ flow }) => { flow.lastBeat!.outlets.push({ ...flow.lastBeat!.outlets[0]! }); },
    ({ flow }) => { flow.lastBeat!.eventId = '8:0'; },
    ({ state }) => { state.events[0]!.actor = 0; },
    ({ state }) => { state.events[0]!.round--; },
    ({ state }) => { state.events[0]!.detail = 'different round'; },
    ({ state }) => { state.events[0]!.effects[1] = 'Withdrawn 16'; },
    ({ state }) => { state.events[0]!.effects[3] = 'town-0/7/construction-99: withdrew 8'; },
    ({ state }) => { operation(state).river!.availableBefore++; operation(state).river!.remainingAfter++; },
    ({ state }) => { operation(state).river!.outletTileId = 32; },
    ({ state }) => { operation(state).river!.downstreamTileId = 29; },
    ({ state }) => { operation(state).round--; },
    ({ state }) => { operation(state).river!.supportAllocationRound = 2; },
    ({ state }) => { operation(state).paid.materials = 0; },
    ({ state }) => { operation(state, 1).inputs![0]!.available = 20; },
    ({ state }) => { operation(state).residents.available++; },
    ({ state }) => { operation(state).residents.allocated = 0; },
    ({ state }) => { intake(state).completion.completedRound = 3; },
    ({ state }) => { intake(state).completion.paid.materials = 7; },
    ({ state }) => { intake(state).completion.cityId = 'town-1'; },
    ({ state }) => { state.cities[0]!.buildingOperations!.irrigation!.lastResult!.status = 'blocked'; },
    ({ state }) => { state.drainage!.downstreamTileIds[7] = 29; },
    ({ state }) => { state.tiles[7]!.elevation += 1 / 4096; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const value = fixture(); mutate(value); const before = structuredClone(value);
    assert.equal(isRiverFlowState(value.flow, value.state), false, `mutation ${index}`);
    assert.deepEqual(value, before, `mutation ${index} must not repair its input`);
  }
});

void test('a clipped event reference is admissible only before the retained window, never inside it', () => {
  const { state, flow } = fixture();
  const later = { ...state.events[0]!, id: '9:1', type: 'observer-safe-action', detail: 'Later same-round action' };
  state.events = [later];
  assert.ok(isRiverFlowState(flow, state));
  state.events = [{ ...later, id: '8:1' }];
  assert.equal(isRiverFlowState(flow, state), false);
  state.events = [];
  assert.equal(isRiverFlowState(flow, state), false);
  state.events = [{ ...later, id: '9:0' }];
  assert.equal(isRiverFlowState(flow, state), false);
});

void test('historical funding survives later same-round pause and lost control rather than trusting present readiness', () => {
  const { state, flow } = fixture();
  intake(state).operation.enabled = false;
  state.cities[0]!.buildingOperations!.irrigation!.enabled = false;
  state.tiles[7]!.owner = 1;
  state.cities[0]!.population = 2;
  assert.ok(isRiverFlowState(flow, state));
  operation(state).river!.supportAllocationRound = null;
  assert.equal(isRiverFlowState(flow, state), false);
});

void test('exact one completed or reserved intake per town and feature/drainage presence reject illegal state', () => {
  for (const mutate of [
    (state: RiverFlowValidationContext) => { state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== 'river-intakes'); },
    (state: RiverFlowValidationContext) => { delete state.drainage; },
    (state: RiverFlowValidationContext) => { state.cities[0]!.improvements!['8'] = structuredClone(intake(state, 1)); },
    (state: RiverFlowValidationContext) => { state.cities[0]!.construction = { active: { kind: 'improvement', id: 'construction-8', cityId: 'town-0', improvementId: 'river-intake', tileId: 6, ruleVersion: 1, startedRound: 2, paid: { materials: 8, credits: 4 }, workRequired: 4, workDone: 1 }, lastCompleted: null }; },
    (state: RiverFlowValidationContext) => { const other = structuredClone(intake(state)); other.improvementId = 'mine'; other.completion.improvementId = 'mine'; state.cities[0]!.improvements!['6'] = other; },
  ]) { const { state, flow } = fixture(); mutate(state); assert.equal(isRiverFlowState(flow, state), false); }
  const { state } = fixture(); state.cities.forEach(city => { city.improvements = {}; }); state.events = []; delete state.drainage;
  const empty: RiverFlowState = { ruleVersion: 1, ruleId: 'uniform-runoff-1', lastBeat: null };
  assert.ok(isRiverFlowState(empty, state));
  assert.equal(isRiverFlowState({ ...empty, inventory: 30 }, state), false);
});

void test('operation boundaries jointly require exact paid material, resident and eight flow with no failed spend', () => {
  const base = result(7, 8, 10);
  assert.ok(isRiverIntakeOperationResult(base, 1, 3));
  const cases: Array<[ImprovementOperationResult['blockedReason'], number, number, number, number | null]> = [
    ['site-ineligible', 20, 4, 8, 3], ['support-unfunded', 0, 0, 0, null], ['input-shortage', 0, 0, 0, 3], ['resident-shortage', 1, 0, 0, 3], ['flow-shortage', 1, 1, 7, 3],
  ];
  for (const [reason, materials, residents, flow, support] of cases) {
    const blocked = structuredClone(base); blocked.status = 'blocked'; blocked.blockedReason = reason; blocked.paid = {}; blocked.produced = {}; blocked.residents.allocated = 0; blocked.residents.available = residents; blocked.inputs![0]!.available = materials;
    blocked.shortages = reason === 'input-shortage' ? [{ ...blocked.inputs![0]! }] : [];
    Object.assign(blocked.river!, { availableBefore: flow, withdrawn: 0, remainingAfter: flow, supportAllocationRound: support });
    assert.ok(isRiverIntakeOperationResult(blocked, 1, 3), reason ?? 'none');
    for (const mutate of [(value: ImprovementOperationResult) => { value.paid.materials = 1; }, (value: ImprovementOperationResult) => { value.residents.allocated = 1; }, (value: ImprovementOperationResult) => { value.river!.withdrawn = 8; }, (value: ImprovementOperationResult) => { value.produced.food = 1; }]) {
      const invalid = structuredClone(blocked); mutate(invalid); assert.equal(isRiverIntakeOperationResult(invalid, 1, 3), false);
    }
  }
  const short = structuredClone(base); short.river!.availableBefore = 7; short.river!.remainingAfter = -1;
  assert.equal(isRiverIntakeOperationResult(short, 1, 3), false);
  const paused = structuredClone(base); paused.status = 'paused'; paused.paid = {}; paused.produced = {}; paused.residents.allocated = 0; paused.river!.withdrawn = 0; paused.river!.remainingAfter = 8;
  assert.ok(isRiverIntakeOperationResult(paused, 1, 3));
  for (const value of [null, undefined, [], {}, { ...base, extra: 1 }, { ...base, inputs: new Array(1) }, { ...base, river: { ...base.river, inventory: 20 } }]) assert.equal(isRiverIntakeOperationResult(value, 1, 3), false);
});


function nextBeat(state: WorldState): WorldState {
  const timestamp = turnAdmission(state, 0).nextStrategyAt;
  assert.ok(timestamp);
  const next = catchUpStrategy(state, timestamp);
  assert.ok(next.ok, next.error);
  assert.equal(next.state.round, state.round + 1);
  assert.ok(isWorldState(next.state), `Actual strategic beat ${next.state.round} must validate`);
  return next.state;
}

void test('fresh current genesis and actual paid intake survive atomic checkpoint restart without repair or renewed flow', () => {
  let state = createGeneratedWorld(73, '2000-01-01T00:00:00.000Z', 'settlement-river-intakes-1', 'cultural-toponyms-v1', 'strategic-temperaments-v1');
  assert.ok(isWorldState(state));
  assert.deepEqual(state.riverFlow, { ruleVersion: 1, ruleId: 'uniform-runoff-1', lastBeat: null });
  const area = new Map<number, number>();
  for (const tile of state.tiles) {
    if (tile.terrain === 'ocean') continue;
    let id: number | null = tile.id;
    while (id !== null) { area.set(id, (area.get(id) ?? 0) + 1); id = state.drainage!.downstreamTileIds[id]!; }
  }
  const candidate = state.cities.flatMap(city => state.tiles.filter(tile => {
    const center = state.tiles[city.tileId]!;
    return (tile.owner === null || tile.owner === city.civId) && tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && (area.get(tile.id) ?? 0) >= 8
      && !state.cities.some(other => other.tileId === tile.id)
      && Math.max(Math.abs(tile.q - center.q), Math.abs(tile.r - center.r), Math.abs(tile.q - center.q + tile.r - center.r)) <= 3;
  }).map(tile => ({ city, tile }))).sort((a, b) => Number(b.tile.owner === b.city.civId) - Number(a.tile.owner === a.city.civId) || a.city.civId - b.city.civId || a.tile.id - b.tile.id)[0];
  assert.ok(candidate, 'Current generated geography supplies a conditional nearby intake fixture');
  const { city, tile } = candidate;
  tile.owner = city.civId;
  city.population = 10; city.focus = 'industry'; city.wellbeing = 70; city.damage = 0;
  city.buildings.push('irrigation'); city.buildingOperations = { irrigation: { enabled: true, lastResult: null } };
  const actor = state.civilizations.find(item => item.id === city.civId)!;
  actor.technologies = ['agriculture', 'water-management']; actor.resources.materials = 100; actor.resources.credits = 100; actor.resources.food = 500;
  assert.ok(isWorldState(state), 'Small conditional prerequisites preserve the full current schema');
  const timestamp = turnAdmission(state, city.civId).nextActionAt;
  assert.ok(timestamp);
  const command = { seat: city.civId, expectedRevision: state.revision, timestamp, action: { type: 'improve' as const, cityId: city.id, tileId: tile.id, improvementId: 'river-intake' } };
  const opened = applyCommand(frozen(state), command);
  assert.ok(opened.ok, opened.error); assert.ok(isWorldState(opened.state)); state = opened.state;
  assert.equal(state.civilizations.find(item => item.id === city.civId)!.resources.materials, 92);
  assert.deepEqual(state.cities.find(item => item.id === city.id)!.construction!.active!.paid, { materials: 8, credits: 4 });
  const duplicate = applyCommand(frozen(state), command);
  assert.equal(duplicate.ok, false); assert.deepEqual(duplicate.state, state);
  for (let count = 0; count < 6 && !state.cities.find(item => item.id === city.id)!.improvements?.[String(tile.id)]; count++) state = nextBeat(state);
  let installed = state.cities.find(item => item.id === city.id)!.improvements?.[String(tile.id)];
  assert.ok(installed); assert.equal(installed.operation.lastResult, null);
  state = nextBeat(state);
  installed = state.cities.find(item => item.id === city.id)!.improvements![String(tile.id)]!;
  assert.equal(installed.operation.lastResult!.status, 'operated');
  assert.deepEqual(installed.operation.lastResult!.paid, { materials: 1 });
  assert.equal(installed.operation.lastResult!.river!.withdrawn, 8);
  assert.equal(state.riverFlow!.lastBeat!.withdrawals.length, 1);
  assert.ok(isWorldState(state));
  const before = structuredClone(state);
  const projected = projectOperationAllocation(frozen(state));
  assert.deepEqual(state, before); assert.deepEqual(projected.riverFlow, before.riverFlow); assert.deepEqual(projected.events, before.events);
  const directory = mkdtempSync(join(tmpdir(), 'river-intake-checkpoint-'));
  try {
    const path = join(directory, 'current-world.json'); atomicWrite(path, state);
    const loaded: unknown = JSON.parse(readFileSync(path, 'utf8'));
    assert.ok(isWorldState(loaded)); assert.deepEqual(loaded, state);
    const continued = nextBeat(frozen(loaded));
    assert.deepEqual(continued, nextBeat(frozen(state)));
    assert.equal(continued.riverFlow!.lastBeat!.round, state.round + 1);
    assert.notEqual(continued.riverFlow!.lastBeat!.eventId, state.riverFlow!.lastBeat!.eventId);
    const noOp = catchUpStrategy(continued, turnAdmission(state, 0).nextStrategyAt!);
    assert.ok(noOp.ok); assert.deepEqual(noOp.state, continued); assert.deepEqual(noOp.events, []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  for (const mutate of [
    (value: WorldState) => { value.riverFlow!.lastBeat!.withdrawals[0]!.orderId += '-forged'; },
    (value: WorldState) => { value.riverFlow!.lastBeat!.sourceUnits++; },
    (value: WorldState) => { value.riverFlow!.lastBeat = null; },
    (value: WorldState) => { delete value.riverFlow; },
    (value: WorldState) => { value.cities.find(item => item.id === city.id)!.improvements![String(tile.id)]!.operation.lastResult!.river!.availableBefore++; },
  ]) { const invalid = structuredClone(state); mutate(invalid); const original = structuredClone(invalid); assert.equal(isWorldState(invalid), false); assert.deepEqual(invalid, original); }
  const current = structuredClone(state);
  const pauseTime = turnAdmission(current, city.civId).nextActionAt!;
  const paused = applyCommand(current, { seat: city.civId, expectedRevision: current.revision, timestamp: pauseTime, action: { type: 'set-improvement-operation', cityId: city.id, tileId: tile.id, improvementId: 'river-intake', enabled: false } });
  assert.ok(paused.ok, paused.error); assert.ok(isWorldState(paused.state)); assert.deepEqual(paused.state.riverFlow, state.riverFlow);
});
