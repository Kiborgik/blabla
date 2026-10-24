import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTENT, IMPROVEMENTS, validateContent } from '../core/content.ts';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { isCoastalSite } from '../core/simulation/coastal.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { forecastCityFoodProduction } from '../core/simulation/food-security.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { availableImprovementSites, improvementSiteBlock } from '../core/simulation/improvements.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import type { City, GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalDeparturePrefix, coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';

const definition = () => { const value = IMPROVEMENTS.find(item => item.id === 'shore-fishery'); assert.ok(value); return value; };
const rounded = (value: number): number => Math.round(value * 100) / 100;
const time = (state: WorldState): string => { assert.ok(state.independentTurns); return coastalPrefixTime(Math.max(state.independentTurns.strategyTicks * 60 + 20, ((state.independentTurns.lastActionWindow[0] ?? -1) + 1) * 10)); };
function nextBeat(state: WorldState): WorldState {
  assert.ok(state.independentTurns);
  const result = catchUpStrategy(state, coastalPrefixTime((state.independentTurns.strategyTicks + 1) * 60));
  assert.ok(result.ok, result.error); return result.state;
}

function journey() {
  const prefix = coastalDeparturePrefix('settlement-shore-fisheries-1'); let state = prefix.state;
  const steps: CoastalPrefixStep[] = [];
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state); const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state));
    steps.push({ input, before, result }); state = result.state;
  };
  const act = (action: GameAction): void => {
    assert.ok(legalActions(state, 0, time(state)).some(option => JSON.stringify(option.action) === JSON.stringify(action)), JSON.stringify(action));
    commit({ kind: 'action', command: { seat: 0, expectedRevision: state.revision, timestamp: time(state), action } });
  };
  const cityId = prefix.departureCityId;
  const city = () => { const value = state.cities.find(item => item.id === cityId); assert.ok(value); return value; };
  assert.ok(isCoastalSite(state, city().tileId));
  const acquire = (): void => {
    if (availableImprovementSites(state, city(), definition()).length) return;
    const option = legalActions(state, 0, time(state)).find(item => item.action.type === 'acquire-tile' && item.action.cityId === cityId && isCoastalSite(state, item.action.tileId));
    assert.ok(option, 'A genuine connected coastal purchase must be available'); act(option.action);
  };
  acquire();
  const ready = structuredClone(state);
  const start = (): number => { acquire(); const tileId = availableImprovementSites(state, city(), definition())[0]; assert.notEqual(tileId, undefined); act({ type: 'improve', cityId, tileId: tileId!, improvementId: 'shore-fishery' }); return tileId!; };
  const beat = (): void => { assert.ok(state.independentTurns); commit({ kind: 'strategy', timestamp: coastalPrefixTime((state.independentTurns.strategyTicks + 1) * 60) }); };
  const finish = (): void => { for (let index = 0; index < 20 && city().construction?.active; index++) beat(); assert.equal(city().construction?.active, null); };
  return { get state() { return state; }, cityId, ready, steps, act, start, finish, beat };
}

let installed: { state: WorldState; cityId: string; tileId: number } | undefined;
function completed() {
  if (!installed) { const run = journey(); const tileId = run.start(); run.finish(); installed = { state: run.state, cityId: run.cityId, tileId }; }
  const value = structuredClone(installed); const city = value.state.cities.find(item => item.id === value.cityId)!;
  return { ...value, city, improvement: city.improvements![String(value.tileId)]!, actor: value.state.civilizations[city.civId]! };
}

function irrigation(city: City): void {
  city.buildings.push('irrigation'); city.buildingOperations ??= {}; city.buildingOperations.irrigation = { enabled: true, lastResult: null };
}

void test('shore fishery is an early exact-land paid recipe, not a boat or free coastal bonus', () => {
  assert.deepEqual(validateContent(), []);
  assert.deepEqual(definition(), { id: 'shore-fishery', name: 'Shore fishery', description: 'Maintain an exact owned coastal land site near its coastal town. One remaining local resident and one opening Material jointly produce three base Food on later beats; paused, blocked or unfunded sites consume nothing. Boats and fish stocks are not simulated.', requiredFeatures: ['shore-fisheries', 'worked-land', 'resident-capacity', 'recurring-decisions', 'building-operations', 'food-budget'], requires: ['water-management'], minEra: 0, cost: { materials: 8, credits: 4 }, requiredWork: 4, siteRange: 3, siteRequirement: 'coastal-land', residentsRequired: 1, operatingInputs: { materials: 1 }, production: { food: 3 } });
});

void test('a wholly legal coastal purchase and construction pays once, completes without output, and operates only on a later beat', context => {
  const run = journey(); const before = structuredClone(run.state); const tileId = run.start();
  const city = run.state.cities.find(item => item.id === run.cityId)!; const order = city.construction!.active!;
  assert.ok('kind' in order && order.kind === 'improvement');
  assert.deepEqual(order.paid, { materials: 8, credits: 4 }); assert.equal(order.workRequired, 4); assert.equal(order.workDone, 0);
  assert.equal(run.state.civilizations[0]!.resources.materials, before.civilizations[0]!.resources.materials - 8);
  assert.equal(run.state.civilizations[0]!.resources.credits, before.civilizations[0]!.resources.credits - 4);
  assert.equal(city.improvements?.[String(tileId)], undefined);
  const repeated = applyCommand(run.state, { seat: 0, expectedRevision: before.revision, timestamp: time(run.state), action: { type: 'improve', cityId: run.cityId, tileId, improvementId: 'shore-fishery' } });
  assert.equal(repeated.ok, false); assert.deepEqual(repeated.state, run.state); assert.deepEqual(repeated.events, []);
  run.finish(); const completedCity = run.state.cities.find(item => item.id === run.cityId)!;
  const fishery = completedCity.improvements![String(tileId)]!;
  assert.equal(fishery.operation.lastResult, null); assert.deepEqual(fishery.completion.paid, order.paid); assert.equal(fishery.completion.orderId, order.id);
  const forecast = forecastCityFoodProduction(run.state, completedCity); run.beat();
  const after = run.state.cities.find(item => item.id === run.cityId)!; const result = after.improvements![String(tileId)]!.operation.lastResult!;
  assert.equal(result.status, 'operated'); assert.deepEqual(result.paid, { materials: 1 }); assert.deepEqual(result.shortages, []);
  assert.equal(result.residents.required, 1); assert.equal(result.residents.allocated, 1); assert.ok(result.produced.food! > 0);
  assert.equal(after.lastFoodSupply!.produced, forecast);
  assert.ok(run.state.events.some(event => event.type === 'improvement-operation' && event.tileId === tileId && event.effects.some(effect => effect.includes('paid 1'))));
  for (const step of run.steps) {
    const restored: unknown = JSON.parse(JSON.stringify(step.before)); assert.ok(isWorldState(restored));
    assert.deepEqual(replayCoastalStep(restored, structuredClone(step.input)), step.result);
  }
  context.diagnostic(JSON.stringify({ sourceFixtureOnly: true, cityId: run.cityId, tileId, transitions: run.steps.length, result }));
});

void test('coastal legality rejects ocean, mountain, inland town, distant, foreign, centered, reserved and other-town purchased sites without payment', () => {
  const run = journey(); const original = run.ready; const cityId = run.cityId;
  const siteId = availableImprovementSites(original, original.cities.find(item => item.id === cityId)!, definition())[0]!;
  const cases: Array<[string, (state: WorldState, city: City) => void]> = [
    ['ocean', state => { state.tiles.find(tile => tile.id === siteId)!.terrain = 'ocean'; }],
    ['mountain', state => { state.tiles.find(tile => tile.id === siteId)!.terrain = 'mountain'; }],
    ['foreign center', (state, city) => { state.tiles.find(tile => tile.id === city.tileId)!.owner = 1; }],
    ['foreign', state => { state.tiles.find(tile => tile.id === siteId)!.owner = 1; }],
    ['inland town', (state, city) => { const center = state.tiles.find(tile => tile.id === city.tileId)!; for (const tile of state.tiles) if (tile.terrain === 'ocean' && hexDistance(center, tile) === 1) tile.terrain = 'grassland'; }],
    ['distant town', (state, city) => { const center = state.tiles.find(tile => tile.id === city.tileId)!; center.q += 20; }],
    ['district occupation', (_state, city) => { city.districtSites = { campus: siteId }; }],
    ['reserved construction', (state, city) => { city.construction = { active: { kind: 'improvement', id: `construction-${state.revision}`, cityId, improvementId: 'shore-fishery', tileId: siteId, ruleVersion: 1, startedRound: state.round, paid: { materials: 8, credits: 4 }, workRequired: 4, workDone: 0 }, lastCompleted: null }; }],
    ['other-town binding', state => { const receipt = state.tileAcquisitions![String(siteId)]; assert.ok(receipt); receipt.cityId = 'city-0'; }],
  ];
  for (const [name, mutate] of cases) {
    const state = structuredClone(original); const city = state.cities.find(item => item.id === cityId)!; mutate(state, city);
    assert.notEqual(improvementSiteBlock(state, city, definition(), siteId), null, name);
    const before = JSON.stringify(state); const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: time(state), action: { type: 'improve', cityId, tileId: siteId, improvementId: 'shore-fishery' } });
    assert.equal(result.ok, false, name); assert.equal(JSON.stringify(result.state), before, name); assert.equal(JSON.stringify(state), before, name); assert.deepEqual(result.events, [], name);
  }
  const city = original.cities.find(item => item.id === cityId)!;
  assert.match(improvementSiteBlock(original, city, definition(), city.tileId)!, /center/);
  assert.notEqual(improvementSiteBlock(original, city, definition(), 999999), null);
});

void test('unaffordable construction and missing Water management refuse without partial payment or reservation', () => {
  const run = journey(); const original = run.ready; const city = original.cities.find(item => item.id === run.cityId)!;
  const tileId = availableImprovementSites(original, city, definition())[0]!;
  for (const mutate of [(state: WorldState) => { state.civilizations[0]!.resources.materials = 7; }, (state: WorldState) => { state.civilizations[0]!.resources.credits = 3; }, (state: WorldState) => { state.civilizations[0]!.technologies = state.civilizations[0]!.technologies.filter(item => item !== 'water-management'); }]) {
    const state = structuredClone(original); mutate(state); const before = structuredClone(state);
    const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: time(state), action: { type: 'improve', cityId: city.id, tileId, improvementId: 'shore-fishery' } });
    assert.equal(result.ok, false); assert.deepEqual(state, before); assert.deepEqual(result.state, before); assert.deepEqual(result.events, []);
  }
});

void test('input and resident shortages are all-or-nothing and retain exact opening snapshots', () => {
  for (const [population, materials, reason] of [[3, 1, 'resident-shortage'], [4, 0, 'input-shortage'], [3, 0, 'input-shortage']] as const) {
    const { state, city, actor, improvement } = completed(); city.population = population; actor.resources.materials = materials; state.round++;
    const opening = structuredClone(actor.resources); allocateOperations(state); const result = improvement.operation.lastResult!;
    assert.equal(result.status, 'blocked'); assert.equal(result.blockedReason, reason);
    assert.deepEqual(result.inputs, [{ resource: 'materials', required: 1, available: materials }]);
    assert.deepEqual(result.shortages, materials === 0 ? [{ resource: 'materials', required: 1, available: 0 }] : []);
    assert.deepEqual(result.paid, {}); assert.deepEqual(result.produced, {}); assert.equal(result.residents.allocated, 0); assert.equal(city.population, population);
    assert.deepEqual(actor.resources, opening);
  }
});

void test('same-beat Materials cannot fund a fishery; the following opening can', () => {
  const { state, city, actor, tileId } = completed(); city.population = 4; actor.resources.materials = 0;
  const after = nextBeat(state); const blocked = after.cities.find(item => item.id === city.id)!.improvements![String(tileId)]!.operation.lastResult!;
  assert.equal(blocked.blockedReason, 'input-shortage'); assert.deepEqual(blocked.paid, {}); assert.deepEqual(blocked.produced, {});
  assert.ok(after.civilizations[0]!.resources.materials > 0);
  const later = nextBeat(after); const operated = later.cities.find(item => item.id === city.id)!.improvements![String(tileId)]!.operation.lastResult!;
  assert.equal(operated.status, 'operated'); assert.deepEqual(operated.paid, { materials: 1 });
});

void test('paid buildings keep priority and share exactly the same remaining Material budget as fishery sites', () => {
  for (const materials of [1, 2]) {
    const { state, city, actor, improvement } = completed(); city.population = 7; irrigation(city); actor.resources.materials = materials; state.round++;
    allocateOperations(state); const building = city.buildingOperations!.irrigation!.lastResult!; const result = improvement.operation.lastResult!;
    assert.deepEqual(building.paid, { materials: 1 }); assert.equal(building.residents!.allocated, 3);
    assert.deepEqual(result.inputs, [{ resource: 'materials', required: 1, available: materials - 1 }]);
    assert.equal(result.residents.available, 1); assert.equal(result.status, materials === 1 ? 'blocked' : 'operated');
    assert.equal(result.residents.allocated, materials === 1 ? 0 : 1); assert.equal(actor.resources.materials, 0);
  }
});

void test('legal pause retains historical operation and releases next-beat Materials and residents', () => {
  const { state, city, tileId } = completed(); const operated = nextBeat(state); const historical = structuredClone(operated.cities.find(item => item.id === city.id)!.improvements![String(tileId)]!.operation.lastResult);
  const paused = applyCommand(operated, { seat: 0, expectedRevision: operated.revision, timestamp: time(operated), action: { type: 'set-improvement-operation', cityId: city.id, tileId, improvementId: 'shore-fishery', enabled: false } });
  assert.ok(paused.ok, paused.error); assert.deepEqual(paused.state.cities.find(item => item.id === city.id)!.improvements![String(tileId)]!.operation.lastResult, historical);
  const off = nextBeat(paused.state); const on = nextBeat(operated); const result = off.cities.find(item => item.id === city.id)!.improvements![String(tileId)]!.operation.lastResult!;
  assert.equal(result.status, 'paused'); assert.deepEqual(result.shortages, []); assert.deepEqual(result.paid, {}); assert.deepEqual(result.produced, {}); assert.equal(result.residents.allocated, 0);
  assert.equal(rounded(off.civilizations[0]!.resources.materials - on.civilizations[0]!.resources.materials), 1);
  const resumed = applyCommand(off, { seat: 0, expectedRevision: off.revision, timestamp: time(off), action: { type: 'set-improvement-operation', cityId: city.id, tileId, improvementId: 'shore-fishery', enabled: true } });
  assert.ok(resumed.ok, resumed.error); assert.deepEqual(resumed.state.cities.find(item => item.id === city.id)!.improvements![String(tileId)]!.operation.lastResult, result);
  assert.equal(nextBeat(resumed.state).cities.find(item => item.id === city.id)!.improvements![String(tileId)]!.operation.lastResult!.status, 'operated');
});

void test('paid work survives later site loss but invalid operation consumes neither supplies nor people', () => {
  const { state, city, actor, improvement, tileId } = completed(); state.tiles.find(tile => tile.id === tileId)!.owner = 1; city.population = 4; actor.resources.materials = 1; state.round++;
  const completion = structuredClone(improvement.completion); allocateOperations(state);
  const result = improvement.operation.lastResult!; assert.equal(result.blockedReason, 'site-ineligible'); assert.deepEqual(result.paid, {}); assert.deepEqual(result.shortages, []); assert.equal(result.residents.allocated, 0); assert.equal(actor.resources.materials, 1); assert.deepEqual(improvement.completion, completion);
});

void test('Food forecast and actual receipts use damage and wellbeing productivity, not the three-base label or infrastructure', () => {
  for (const [wellbeing, damage] of [[67, 13], [40, 55], [100, 100]]) {
    const { state, city, tileId } = completed(); city.population = 8; city.wellbeing = wellbeing!; city.damage = damage!; city.infrastructure = 9; city.focus = 'research';
    const off = structuredClone(state); off.cities.find(item => item.id === city.id)!.improvements![String(tileId)]!.operation.enabled = false;
    const before = structuredClone(state); const forecast = forecastCityFoodProduction(state, city); assert.deepEqual(state, before);
    const actual = nextBeat(state); const control = nextBeat(off); const actualCity = actual.cities.find(item => item.id === city.id)!; const controlCity = control.cities.find(item => item.id === city.id)!;
    const receipt = actualCity.improvements![String(tileId)]!.operation.lastResult!;
    assert.equal(actualCity.lastFoodSupply!.produced, forecast);
    assert.equal(receipt.produced.food ?? 0, rounded(actualCity.lastFoodSupply!.produced - controlCity.lastFoodSupply!.produced));
    assert.equal(rounded(control.civilizations[0]!.resources.materials - actual.civilizations[0]!.resources.materials), 1);
    assert.equal(receipt.status, 'operated'); assert.deepEqual(receipt.paid, { materials: 1 });
    if (damage === 100) assert.deepEqual(receipt.produced, {});
  }
});

void test('a conditional low-Food coastal household receives actual meals at a real Material opportunity cost', () => {
  const { state, city, actor, tileId } = completed(); state.cities = [city]; city.population = 8; city.wellbeing = 50; city.damage = 0; city.focus = 'research'; actor.resources.food = 0; actor.resources.materials = 1;
  const off = structuredClone(state); off.cities[0]!.improvements![String(tileId)]!.operation.enabled = false;
  const active = structuredClone(state); const paused = structuredClone(off); active.round++; paused.round++; resolveEconomy(active, []); resolveEconomy(paused, []); const supplied = active.cities[0]!.lastFoodSupply!; const control = paused.cities[0]!.lastFoodSupply!;
  assert.equal(supplied.required, 10); assert.ok(supplied.paid > control.paid); assert.equal(rounded(supplied.produced - control.produced), 3);
  assert.equal(rounded(paused.civilizations[0]!.resources.materials - active.civilizations[0]!.resources.materials), 1);
  assert.equal(active.cities[0]!.improvements![String(tileId)]!.operation.lastResult!.residents.allocated, 1);
});

void test('a synthetic second coastal site supports paid construction and numeric allocation after one wholly legal fishery', () => {
  const initial = completed(); const first = initial.tileId; const center = initial.state.tiles.find(tile => tile.id === initial.city.tileId)!;
  const additional = initial.state.tiles.find(tile => tile.id !== first && tile.terrain !== 'ocean' && tile.owner === null
    && hexDistance(center, tile) <= 3 && !initial.state.cities.some(city => city.tileId === tile.id)
    && initial.state.tiles.some(ocean => ocean.terrain === 'ocean' && hexDistance(tile, ocean) === 1));
  assert.ok(additional); additional.terrain = 'grassland'; additional.owner = initial.city.civId;
  const second = additional.id;
  assert.equal(improvementSiteBlock(initial.state, initial.city, definition(), second), null); assert.ok(isWorldState(initial.state));
  const started = applyCommand(initial.state, { seat: 0, expectedRevision: initial.state.revision, timestamp: time(initial.state), action: { type: 'improve', cityId: initial.city.id, tileId: second, improvementId: 'shore-fishery' } });
  assert.ok(started.ok, started.error); assert.equal(started.state.civilizations[0]!.resources.materials, initial.actor.resources.materials - 8);
  let base = started.state;
  for (let count = 0; count < 20 && base.cities.find(city => city.id === initial.city.id)!.construction!.active; count++) base = nextBeat(base);
  assert.ok(base.cities.find(city => city.id === initial.city.id)!.improvements![String(second)]); assert.ok(isWorldState(base));
  const sites = [first, second].toSorted((a, b) => a - b);
  for (const mode of ['scarce-input', 'scarce-resident', 'paused', 'invalid'] as const) {
    const state = structuredClone(base); const city = state.cities.find(item => item.id === initial.city.id)!; city.population = mode === 'scarce-input' ? 5 : 4;
    state.civilizations[0]!.resources.materials = mode === 'scarce-resident' ? 2 : 1; state.round++;
    const low = city.improvements![String(sites[0])]!; const high = city.improvements![String(sites[1])]!;
    if (mode === 'paused') low.operation.enabled = false;
    if (mode === 'invalid') state.tiles.find(tile => tile.id === sites[0])!.owner = 1;
    allocateOperations(state);
    const results = [low.operation.lastResult!, high.operation.lastResult!];
    assert.deepEqual(results.map(result => result.residents.allocated), mode === 'paused' || mode === 'invalid' ? [0, 1] : [1, 0]);
    assert.equal(results.reduce((total, result) => total + (result.paid.materials ?? 0), 0), 1);
    assert.equal(state.civilizations[0]!.resources.materials, mode === 'scarce-resident' ? 1 : 0);
    if (mode === 'scarce-input') { assert.equal(results[1]!.blockedReason, 'input-shortage'); assert.deepEqual(results[1]!.shortages, [{ resource: 'materials', required: 1, available: 0 }]); }
    if (mode === 'scarce-resident') assert.equal(results[1]!.blockedReason, 'resident-shortage');
  }
});

void test('synthetic two-town contention uses one civilization opening budget in stable town order', () => {
  const { state, city, actor, improvement } = completed();
  const second = structuredClone(city); second.id = 'zz-shore-town'; second.tileId = 500; second.population = 4;
  const other = structuredClone(improvement); other.tileId = 501; second.improvements = { '501': other }; second.construction = { active: null, lastCompleted: null };
  state.tiles.push({ id: 500, q: 100, r: 100, terrain: 'grassland', elevation: 50, owner: city.civId, resource: null }, { id: 501, q: 101, r: 100, terrain: 'grassland', elevation: 50, owner: city.civId, resource: null }, { id: 502, q: 100, r: 101, terrain: 'ocean', elevation: 0, owner: null, resource: null });
  city.population = 4; state.cities = [second, city]; actor.resources.materials = 1; state.round++;
  allocateOperations(state);
  assert.equal(improvement.operation.lastResult!.status, 'operated'); assert.deepEqual(improvement.operation.lastResult!.paid, { materials: 1 });
  assert.equal(other.operation.lastResult!.blockedReason, 'input-shortage'); assert.deepEqual(other.operation.lastResult!.inputs, [{ resource: 'materials', required: 1, available: 0 }]); assert.equal(other.operation.lastResult!.residents.allocated, 0);
  assert.equal(actor.resources.materials, 0);
});

void test('strict paid-site receipt validation rejects invented payment, shortages, inputs, residents and foreign outputs', () => {
  const { state, city, tileId } = completed(); const valid = nextBeat(state); assert.ok(isWorldState(valid));
  const receipt = (world: WorldState) => world.cities.find(item => item.id === city.id)!.improvements![String(tileId)]!.operation.lastResult!;
  const mutations: Array<[string, (value: ReturnType<typeof receipt>) => void]> = [
    ['missing required snapshot', value => { delete value.inputs; }],
    ['missing shortages', value => { delete value.shortages; }],
    ['wrong input identity', value => { value.inputs![0]!.resource = 'credits'; }],
    ['wrong recipe amount', value => { value.inputs![0]!.required = 2; }],
    ['negative opening stock', value => { value.inputs![0]!.available = -1; }],
    ['insufficient opening stock', value => { value.inputs![0]!.available = 0; }],
    ['duplicate input', value => { value.inputs!.push({ ...value.inputs![0]! }); }],
    ['unfunded payment', value => { value.paid = {}; }],
    ['wrong payment quantity', value => { value.paid.materials = 2; }],
    ['foreign payment', value => { value.paid.credits = 1; }],
    ['false operated shortage', value => { value.shortages = [{ resource: 'materials', required: 1, available: 0 }]; }],
    ['wrong resident requirement', value => { value.residents.required = 2; value.residents.allocated = 2; }],
    ['wrong community reserve', value => { value.residents.communityReserve = 2; }],
    ['missing worker', value => { value.residents.allocated = 0; }],
    ['foreign output', value => { value.produced.materials = 1; }],
    ['subcent output', value => { value.produced.food = 0.001; }],
    ['false status', value => { value.status = 'blocked'; value.blockedReason = 'input-shortage'; }],
    ['future receipt', value => { value.round = valid.round + 1; }],
  ];
  for (const [name, mutate] of mutations) { const corrupt = structuredClone(valid); mutate(receipt(corrupt)); assert.equal(isWorldState(corrupt), false, name); }
  for (const field of ['paid', 'workRequired'] as const) {
    const corrupt = structuredClone(valid); const fishery = corrupt.cities.find(item => item.id === city.id)!.improvements![String(tileId)]!;
    if (field === 'paid') fishery.completion.paid.materials = 7; else fishery.completion.workRequired = 5;
    assert.equal(isWorldState(corrupt), false, `false construction ${field}`);
  }
  const historical = structuredClone(valid); const town = historical.cities.find(item => item.id === city.id)!;
  town.population = 3; town.damage = 90; historical.civilizations[0]!.resources.materials = 0; town.improvements![String(tileId)]!.operation.enabled = false;
  assert.deepEqual(receipt(historical), receipt(valid)); assert.ok(isWorldState(historical), 'Historical opening inputs, workers and output must not be revalidated against later current state');
});

void test('blocked and paused paid-site receipts must have exact real shortages and zero payment or output', () => {
  const { state, city, actor, tileId } = completed(); city.population = 4; actor.resources.materials = 0;
  const valid = nextBeat(state); assert.ok(isWorldState(valid));
  const receipt = (world: WorldState) => world.cities.find(item => item.id === city.id)!.improvements![String(tileId)]!.operation.lastResult!;
  assert.equal(receipt(valid).blockedReason, 'input-shortage');
  for (const mutate of [(value: ReturnType<typeof receipt>) => { value.shortages = []; }, (value: ReturnType<typeof receipt>) => { value.shortages![0]!.required = 2; }, (value: ReturnType<typeof receipt>) => { value.shortages![0]!.available = 1; }, (value: ReturnType<typeof receipt>) => { value.shortages!.push({ ...value.shortages![0]! }); }, (value: ReturnType<typeof receipt>) => { value.paid.materials = 1; }, (value: ReturnType<typeof receipt>) => { value.produced.food = 1; }, (value: ReturnType<typeof receipt>) => { value.residents.allocated = 1; }, (value: ReturnType<typeof receipt>) => { value.blockedReason = 'resident-shortage'; }, (value: ReturnType<typeof receipt>) => { value.status = 'paused'; value.blockedReason = null; }]) {
    const corrupt = structuredClone(valid); mutate(receipt(corrupt)); assert.equal(isWorldState(corrupt), false);
  }
});

void test('paid coastal content needs its explicit gates and meaningful input recipe', () => {
  for (const mutate of [
    (value: ReturnType<typeof definition>) => { value.requiredFeatures = value.requiredFeatures.filter(feature => feature !== 'shore-fisheries'); },
    (value: ReturnType<typeof definition>) => { value.requiredFeatures = value.requiredFeatures.filter(feature => feature !== 'building-operations'); },
    (value: ReturnType<typeof definition>) => { value.operatingInputs = {}; },
    (value: ReturnType<typeof definition>) => { value.operatingInputs = { materials: -1 }; },
    (value: ReturnType<typeof definition>) => { value.siteRange = 4; },
  ]) {
    const content = structuredClone(CONTENT); mutate(content.improvements.find(item => item.id === 'shore-fishery')!);
    assert.ok(validateContent(content).some(error => error.startsWith('improvement shore-fishery:')));
  }
});
