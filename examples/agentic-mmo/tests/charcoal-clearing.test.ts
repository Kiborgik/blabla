import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTENT, IMPROVEMENTS, TECHNOLOGIES, validateContent } from '../core/content.ts';
import { applyCommand, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { availableImprovementSites, improvementSiteBlock } from '../core/simulation/improvements.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import type { City, GameAction, ImprovementDefinition, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';

const rulesId = 'settlement-charcoal-clearing-1';
const epoch = '2026-10-24T00:00:00.000Z';
const provenance = 'Controlled fresh selected-rule prerequisites and owned forest sites; real paid commands, retained work, later operation and same-version restart, not natural policy selection';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const rounded = (value: number): number => Math.round(value * 100) / 100;
const cityOf = (state: WorldState): City => state.cities.find(city => city.id === 'city-0')!;
const definition = (id = 'charcoal-clearing'): ImprovementDefinition => { const value = IMPROVEMENTS.find(item => item.id === id); assert.ok(value); return value; };
const actionFor = (tileId: number, improvementId = 'charcoal-clearing'): Extract<GameAction, { type: 'improve' }> => ({ type: 'improve', cityId: 'city-0', tileId, improvementId });
const time = (state: WorldState): string => at(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ((state.independentTurns?.lastActionWindow[0] ?? -1) + 1) * 10));
function controlledTechnologies(state: WorldState, ids: string[]): void {
  for (const id of ids) {
    const technology = TECHNOLOGIES.find(item => item.id === id); assert.ok(technology);
    controlledTechnologies(state, technology.requires);
    if (!state.civilizations[0]!.technologies.includes(id)) state.civilizations[0]!.technologies.push(id);
  }
}
function fixture() {
  const state = createWorld(1701, epoch, rulesId); const city = cityOf(state);
  controlledTechnologies(state, ['kiln-firing']);
  city.focus = 'research'; city.wellbeing = 50; city.infrastructure = 0;
  const center = state.tiles.find(tile => tile.id === city.tileId)!;
  const sites = state.tiles.filter(tile => hexDistance(center, tile) === 1
    && !state.cities.some(town => town.tileId === tile.id) && !state.strategicDeposits?.deposits[String(tile.id)]
    && !state.coalDeposits?.deposits[String(tile.id)] && !state.pastoralSites?.sites[String(tile.id)])
    .toSorted((left, right) => left.id - right.id).slice(0, 2);
  assert.equal(sites.length, 2);
  for (const site of sites) { site.owner = 0; site.terrain = 'forest'; site.elevation = 50; }
  assert.ok(isWorldState(state), provenance);
  return { state, siteIds: sites.map(site => site.id) };
}
function act(state: WorldState, action: GameAction): WorldState {
  const before = structuredClone(state);
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: time(state), action });
  assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state));
  return result.state;
}
function nextBeat(state: WorldState): WorldState {
  const before = structuredClone(state);
  const timestamp = at(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60);
  const result = catchUpStrategy(state, timestamp);
  assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state));
  const restored: unknown = JSON.parse(JSON.stringify(before)); assert.ok(isWorldState(restored));
  assert.deepEqual(catchUpStrategy(restored, timestamp), result);
  return result.state;
}
function finishConstruction(started: WorldState): WorldState {
  let state = started;
  for (let count = 0; count < 12 && cityOf(state).construction?.active; count++) state = nextBeat(state);
  assert.equal(cityOf(state).construction?.active, null);
  return state;
}
let installed: ReturnType<typeof fixture> | undefined;
function completed() {
  if (!installed) {
    const base = fixture();
    installed = { ...base, state: finishConstruction(act(base.state, actionFor(base.siteIds[1]!))) };
  }
  const { state, siteIds } = structuredClone(installed); const city = cityOf(state); const tileId = siteIds[1]!;
  return { state, siteIds, city, tileId, actor: state.civilizations[0]!, improvement: city.improvements![String(tileId)]! };
}
function controlledKiln(city: City): void {
  city.buildings.push('kiln'); city.buildingOperations ??= {};
  city.buildingOperations.kiln = { enabled: true, lastResult: null };
}
function refuse(state: WorldState, action: GameAction, label: string): void {
  const before = structuredClone(state);
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: time(state), action });
  assert.equal(result.ok, false, label); assert.deepEqual(result.state, before, label);
  assert.deepEqual(state, before, label); assert.deepEqual(result.events, [], label);
}

void test('controlled forest prerequisites lead to one paid retained four-work order, later Energy and exact current restart', context => {
  const { state: initial, siteIds } = fixture(); const tileId = siteIds[1]!;
  let state = act(initial, actionFor(tileId)); const order = structuredClone(cityOf(state).construction!.active!);
  assert.ok('kind' in order && order.kind === 'improvement');
  assert.deepEqual(order.paid, { materials: 8, credits: 4 }); assert.equal(order.workRequired, 4); assert.equal(order.workDone, 0);
  assert.equal(state.civilizations[0]!.resources.materials, initial.civilizations[0]!.resources.materials - 8);
  assert.equal(state.civilizations[0]!.resources.credits, initial.civilizations[0]!.resources.credits - 4);
  assert.equal(state.civilizations[0]!.resources.energy, initial.civilizations[0]!.resources.energy);
  assert.equal(cityOf(state).improvements?.[String(tileId)], undefined);
  refuse(state, actionFor(siteIds[0]!), 'An active order cannot be replaced or charged again');
  let control = structuredClone(state); cityOf(control).construction!.active = null;
  let priorWork = 0; let beats = 0;
  for (; beats < 12 && cityOf(state).construction?.active; beats++) {
    state = nextBeat(state); control = nextBeat(control);
    assert.deepEqual(state.civilizations[0]!.resources, control.civilizations[0]!.resources, 'Construction has no repeat payment or completion output');
    const retained = cityOf(state).construction!.active;
    if (retained) {
      assert.equal(retained.id, order.id); assert.deepEqual(retained.paid, order.paid);
      assert.ok(retained.workDone > priorWork && retained.workDone < 4); priorWork = retained.workDone;
    }
  }
  assert.equal(cityOf(state).construction!.active, null); assert.ok(beats > 1 && beats < 12);
  const completion = cityOf(state).improvements![String(tileId)]!;
  assert.equal(completion.operation.lastResult, null); assert.equal(completion.completion.orderId, order.id);
  assert.deepEqual(completion.completion.paid, { materials: 8, credits: 4 }); assert.equal(completion.completion.workRequired, 4);
  assert.deepEqual(cityOf(state).housing, cityOf(initial).housing); assert.equal(cityOf(state).infrastructure, 0);
  assert.equal(cityOf(state).localPower, undefined); assert.equal(state.climate, initial.climate);
  assert.deepEqual(state.tiles, initial.tiles);
  const resumed = nextBeat(state); const baseline = nextBeat(control);
  const result = cityOf(resumed).improvements![String(tileId)]!.operation.lastResult!;
  assert.equal(result.status, 'operated'); assert.ok(result.round > completion.completion.completedRound);
  assert.deepEqual(result.paid, { materials: 1 }); assert.equal(result.residents.allocated, 1);
  assert.deepEqual(Object.keys(result.produced), ['energy']); assert.ok(result.produced.energy! > 0);
  assert.equal(result.produced.energy, rounded(resumed.civilizations[0]!.resources.energy - baseline.civilizations[0]!.resources.energy));
  assert.equal(rounded(baseline.civilizations[0]!.resources.materials - resumed.civilizations[0]!.resources.materials), 1);
  context.diagnostic(JSON.stringify({ provenance, tileId, order, beats, result }));
});

void test('exact owned forest, owned support town, range, purchase and border binding reject invalid starts atomically', () => {
  const { state: base, siteIds } = fixture(); const tileId = siteIds[1]!;
  assert.equal(improvementSiteBlock(base, cityOf(base), definition(), tileId), null);
  const mutations: Array<[string, (state: WorldState) => void]> = [
    ...(['grassland', 'desert', 'tundra', 'ocean', 'mountain'] as const).map(terrain => [terrain, (state: WorldState) => { state.tiles.find(tile => tile.id === tileId)!.terrain = terrain; }] as [string, (state: WorldState) => void]),
    ['unowned site', state => { state.tiles.find(tile => tile.id === tileId)!.owner = null; }],
    ['foreign site', state => { state.tiles.find(tile => tile.id === tileId)!.owner = 1; }],
    ['foreign support town', state => { state.tiles.find(tile => tile.id === cityOf(state).tileId)!.owner = 1; }],
    ['completed district', state => { cityOf(state).districtSites = { campus: tileId }; }],
    ['reserved district', state => { cityOf(state).construction = { active: { id: 'construction-0', cityId: 'city-0', buildingId: 'campus', tileId, ruleVersion: 1, startedRound: 0, paid: { materials: 12, credits: 6 }, workRequired: 8, workDone: 0 }, lastCompleted: null }; }],
    ['other town purchase', state => { state.tileAcquisitions![String(tileId)] = { ruleVersion: 1, id: 'territory-controlled', cityId: 'city-1', civId: 0, cityTileId: cityOf(state).tileId, tileId, pathTileIds: [cityOf(state).tileId, tileId], distance: 1, priorCivilizationPurchases: 0, acquiredRound: 0, paid: { credits: 16 }, eventId: 'controlled-purchase' }; }],
    ['other town border control', state => { state.border!.controls[String(tileId)] = { ruleVersion: 1, incidentId: 'controlled-border', purchaseId: 'territory-controlled', tileId, previousCivId: 1, previousCityId: 'city-1', civId: 0, cityId: 'city-1', round: 0, eventId: 'controlled-control' }; }],
  ];
  for (const [label, mutate] of mutations) {
    const state = structuredClone(base); mutate(state);
    assert.notEqual(improvementSiteBlock(state, cityOf(state), definition(), tileId), null, label);
    refuse(state, actionFor(tileId), label);
  }
  for (const radius of [3, 4]) {
    const state = structuredClone(base); const center = state.tiles.find(tile => tile.id === cityOf(state).tileId)!;
    const site = state.tiles.find(tile => hexDistance(center, tile) === radius && !state.cities.some(city => city.tileId === tile.id))!;
    site.owner = 0; site.terrain = 'forest';
    assert.equal(improvementSiteBlock(state, cityOf(state), definition(), site.id) === null, radius === 3);
    if (radius === 4) refuse(state, actionFor(site.id), 'Outside range three');
  }
  const center = structuredClone(base); center.tiles.find(tile => tile.id === cityOf(center).tileId)!.terrain = 'forest';
  refuse(center, actionFor(cityOf(center).tileId), 'Town center');
  refuse(base, actionFor(999999), 'Missing exact tile');
  refuse(base, { ...actionFor(tileId), cityId: 'city-1' }, 'Foreign exact town');
  const built = completed(); refuse(built.state, actionFor(built.tileId), 'Completed improvement remains occupied');
  const paused = act(built.state, { type: 'set-improvement-operation', cityId: 'city-0', tileId: built.tileId, improvementId: 'charcoal-clearing', enabled: false });
  refuse(paused, actionFor(built.tileId), 'Pausing does not release occupancy');
});

void test('fresh feature gates, Kiln firing and complete construction funds are required without partial effects', () => {
  const { state: base, siteIds } = fixture(); const tileId = siteIds[1]!;
  assert.ok(legalActions(base, 0, time(base)).some(option => option.action.type === 'improve' && option.action.improvementId === 'charcoal-clearing' && option.action.tileId === tileId));
  for (const feature of definition().requiredFeatures) {
    const state = structuredClone(base); state.unlockedFeatures = state.unlockedFeatures.filter(id => id !== feature);
    refuse(state, actionFor(tileId), `Missing ${feature}`);
  }
  for (const [label, mutate] of [
    ['missing Kiln firing', (state: WorldState) => { state.civilizations[0]!.technologies = ['agriculture']; }],
    ['seven Materials', (state: WorldState) => { state.civilizations[0]!.resources.materials = 7; }],
    ['three Credits', (state: WorldState) => { state.civilizations[0]!.resources.credits = 3; }],
  ] as const) { const state = structuredClone(base); mutate(state); refuse(state, actionFor(tileId), label); }
  const exact = structuredClone(base); exact.civilizations[0]!.resources.materials = 8; exact.civilizations[0]!.resources.credits = 4;
  const accepted = act(exact, actionFor(tileId)); assert.equal(accepted.civilizations[0]!.resources.materials, 0); assert.equal(accepted.civilizations[0]!.resources.credits, 0);
});

void test('pause, shortage and lost forest eligibility spend and produce nothing while paid completion survives', () => {
  for (const mode of ['materials', 'residents', 'forest', 'site-owner', 'town-owner', 'feature', 'paused'] as const) {
    const { state, city, actor, improvement, tileId } = completed(); city.population = 4; actor.resources.materials = 1;
    if (mode === 'materials') actor.resources.materials = 0;
    if (mode === 'residents') city.population = 3;
    if (mode === 'forest') state.tiles.find(tile => tile.id === tileId)!.terrain = 'grassland';
    if (mode === 'site-owner') state.tiles.find(tile => tile.id === tileId)!.owner = 1;
    if (mode === 'town-owner') state.tiles.find(tile => tile.id === city.tileId)!.owner = 1;
    if (mode === 'feature') state.unlockedFeatures = state.unlockedFeatures.filter(id => id !== 'charcoal-clearing');
    if (mode === 'paused') improvement.operation.enabled = false;
    const completion = structuredClone(improvement.completion); const opening = structuredClone(actor.resources); const population = city.population;
    state.round++; allocateOperations(state); const result = improvement.operation.lastResult!;
    assert.equal(result.status, mode === 'paused' ? 'paused' : 'blocked', mode);
    assert.equal(result.blockedReason, mode === 'paused' ? null : mode === 'materials' ? 'input-shortage' : mode === 'residents' ? 'resident-shortage' : 'site-ineligible', mode);
    assert.deepEqual(result.paid, {}, mode); assert.deepEqual(result.produced, {}, mode); assert.equal(result.residents.allocated, 0, mode);
    assert.deepEqual(result.shortages, mode === 'materials' ? [{ resource: 'materials', required: 1, available: 0 }] : [], mode);
    assert.deepEqual(actor.resources, opening, mode); assert.equal(city.population, population, mode); assert.deepEqual(improvement.completion, completion, mode);
    const control = structuredClone(state); cityOf(control).improvements![String(tileId)]!.operation.enabled = false;
    resolveEconomy(state, []); resolveEconomy(control, []);
    assert.deepEqual(actor.resources, control.civilizations[0]!.resources, mode); assert.deepEqual(improvement.operation.lastResult!.produced, {}, mode);
  }
  const { state, tileId } = completed(); const operated = nextBeat(state); const historical = structuredClone(cityOf(operated).improvements![String(tileId)]!.operation.lastResult);
  const paused = act(operated, { type: 'set-improvement-operation', cityId: 'city-0', tileId, improvementId: 'charcoal-clearing', enabled: false });
  assert.deepEqual(cityOf(paused).improvements![String(tileId)]!.operation.lastResult, historical);
  const off = nextBeat(paused); assert.equal(cityOf(off).improvements![String(tileId)]!.operation.lastResult!.status, 'paused');
  const resumed = act(off, { type: 'set-improvement-operation', cityId: 'city-0', tileId, improvementId: 'charcoal-clearing', enabled: true });
  assert.equal(cityOf(nextBeat(resumed)).improvements![String(tileId)]!.operation.lastResult!.status, 'operated');
});

void test('a funded Kiln leaves no clearing worker at population six and exactly one at seven', () => {
  for (const population of [6, 7]) {
    const { state, city, actor, improvement } = completed(); controlledKiln(city); city.population = population;
    actor.resources.energy = 2; actor.resources.materials = 1; state.round++; allocateOperations(state);
    const kiln = city.buildingOperations!.kiln!.lastResult!; const result = improvement.operation.lastResult!;
    assert.equal(kiln.status, 'operated'); assert.deepEqual(kiln.paid, { energy: 2 }); assert.equal(kiln.residents!.allocated, 3);
    assert.equal(result.residents.communityReserve, 3); assert.equal(result.residents.available, population - 6);
    assert.equal(result.status, population === 6 ? 'blocked' : 'operated');
    assert.equal(result.blockedReason, population === 6 ? 'resident-shortage' : null);
    assert.deepEqual(result.paid, population === 6 ? {} : { materials: 1 }); assert.equal(result.residents.allocated, population === 6 ? 0 : 1);
    assert.equal(actor.resources.energy, 0); assert.equal(actor.resources.materials, population === 6 ? 1 : 0); assert.equal(city.population, population);
  }
});

void test('same-beat clearing Energy cannot finance an earlier Kiln and same-beat Kiln Materials cannot finance a clearing', () => {
  for (const shortage of ['energy', 'materials'] as const) {
    const { state, city, actor, tileId } = completed(); controlledKiln(city);
    city.population = 7; city.wellbeing = 50; city.infrastructure = 0; city.focus = 'research';
    actor.resources.energy = shortage === 'energy' ? 0 : 2; actor.resources.materials = shortage === 'materials' ? 0 : 1;
    const first = nextBeat(state); const town = cityOf(first); const kiln = town.buildingOperations!.kiln!.lastResult!;
    const clearing = town.improvements![String(tileId)]!.operation.lastResult!;
    if (shortage === 'energy') {
      assert.equal(kiln.status, 'blocked'); assert.deepEqual(kiln.paid, {}); assert.deepEqual(kiln.produced, {});
      assert.deepEqual(kiln.shortages, [{ resource: 'energy', required: 2, available: 0 }]);
      assert.deepEqual(clearing.produced, { energy: 1 }); assert.equal(first.civilizations[0]!.resources.energy, 2);
    } else {
      assert.equal(kiln.status, 'operated'); assert.ok(kiln.produced.materials! > 0);
      assert.equal(clearing.blockedReason, 'input-shortage'); assert.deepEqual(clearing.paid, {}); assert.deepEqual(clearing.produced, {});
      assert.deepEqual(clearing.inputs, [{ resource: 'materials', required: 1, available: 0 }]);
    }
    const second = nextBeat(first);
    assert.equal(cityOf(second).improvements![String(tileId)]!.operation.lastResult!.status, 'operated');
    if (shortage === 'energy') assert.equal(cityOf(second).buildingOperations!.kiln!.lastResult!.status, 'operated');
  }
});

void test('actual clearing Energy uses ordinary marginal quantization including infrastructure, not the Food modifier or base label', () => {
  for (const [wellbeing, damage, infrastructure, focus, expected] of [
    [50, 0, 0, 'research', 1], [67, 13, 3, 'research', 1.33], [67, 13, 3, 'industry', 1.32],
    [50, 0, 9, 'research', 1.9], [100, 100, 9, 'research', 0],
  ] as const) {
    const { state, city, tileId } = completed(); city.population = 7; city.wellbeing = wellbeing; city.damage = damage; city.infrastructure = infrastructure; city.focus = focus;
    const off = structuredClone(state); cityOf(off).improvements![String(tileId)]!.operation.enabled = false;
    const on = nextBeat(state); const control = nextBeat(off); const receipt = cityOf(on).improvements![String(tileId)]!.operation.lastResult!;
    assert.equal(receipt.status, 'operated'); assert.deepEqual(receipt.paid, { materials: 1 });
    assert.deepEqual(receipt.produced, expected === 0 ? {} : { energy: expected });
    assert.equal(rounded(on.civilizations[0]!.resources.energy - control.civilizations[0]!.resources.energy), expected);
    assert.equal(rounded(control.civilizations[0]!.resources.materials - on.civilizations[0]!.resources.materials), 1);
    assert.deepEqual(on.tiles, state.tiles); assert.deepEqual(cityOf(on).housing, city.housing); assert.equal(cityOf(on).localPower, undefined);
  }
});

void test('two paid clearings retain numeric allocation after buildings and pausing frees only next-beat inputs and residents', () => {
  const base = completed(); const both = finishConstruction(act(base.state, actionFor(base.siteIds[0]!)));
  for (const mode of ['resident', 'material', 'paused', 'invalid'] as const) {
    const state = structuredClone(both); const city = cityOf(state); controlledKiln(city); city.population = mode === 'material' ? 8 : 7;
    state.civilizations[0]!.resources.energy = 2; state.civilizations[0]!.resources.materials = mode === 'resident' ? 2 : 1;
    const low = city.improvements![String(base.siteIds[0])]!; const high = city.improvements![String(base.siteIds[1])]!;
    if (mode === 'paused') low.operation.enabled = false;
    if (mode === 'invalid') state.tiles.find(tile => tile.id === low.tileId)!.owner = 1;
    state.round++; allocateOperations(state);
    assert.equal(city.buildingOperations!.kiln!.lastResult!.residents!.allocated, 3);
    assert.deepEqual([low.operation.lastResult!.residents.allocated, high.operation.lastResult!.residents.allocated], mode === 'paused' || mode === 'invalid' ? [0, 1] : [1, 0]);
    assert.equal((low.operation.lastResult!.paid.materials ?? 0) + (high.operation.lastResult!.paid.materials ?? 0), 1);
    if (mode === 'resident') assert.equal(high.operation.lastResult!.blockedReason, 'resident-shortage');
    if (mode === 'material') assert.equal(high.operation.lastResult!.blockedReason, 'input-shortage');
  }
});

void test('existing Lumber mill and charcoal identities keep numeric site priority and retained standing forest', () => {
  const base = completed(); controlledTechnologies(base.state, ['machinery']); base.actor.era = 1;
  const state = finishConstruction(act(base.state, actionFor(base.siteIds[0]!, 'lumber-mill')));
  const city = cityOf(state); city.population = 4; state.civilizations[0]!.resources.materials = 1; state.round++;
  allocateOperations(state);
  const lumber = city.improvements![String(base.siteIds[0])]!; const charcoal = city.improvements![String(base.siteIds[1])]!;
  assert.equal(lumber.improvementId, 'lumber-mill'); assert.equal(lumber.operation.lastResult!.status, 'operated');
  assert.deepEqual(lumber.operation.lastResult!.paid, {}); assert.equal(lumber.operation.lastResult!.residents.allocated, 1);
  assert.equal(charcoal.operation.lastResult!.blockedReason, 'resident-shortage'); assert.equal(state.civilizations[0]!.resources.materials, 1);
  lumber.operation.enabled = false; state.round++; allocateOperations(state);
  assert.equal(charcoal.operation.lastResult!.status, 'operated'); assert.deepEqual(charcoal.operation.lastResult!.paid, { materials: 1 });
  assert.ok(base.siteIds.every(id => state.tiles.find(tile => tile.id === id)!.terrain === 'forest'));
});

void test('strict current receipts reject invented charcoal payment, input, worker and foreign output without revalidating historical stocks', () => {
  const { state, tileId } = completed(); const valid = nextBeat(state); assert.ok(isWorldState(valid));
  const receipt = (world: WorldState) => cityOf(world).improvements![String(tileId)]!.operation.lastResult!;
  for (const [label, mutate] of [
    ['missing input', (value: ReturnType<typeof receipt>) => { delete value.inputs; }],
    ['wrong input', (value: ReturnType<typeof receipt>) => { value.inputs![0]!.resource = 'credits'; }],
    ['unfunded opening', (value: ReturnType<typeof receipt>) => { value.inputs![0]!.available = 0; }],
    ['missing payment', (value: ReturnType<typeof receipt>) => { value.paid = {}; }],
    ['extra payment', (value: ReturnType<typeof receipt>) => { value.paid.materials = 2; }],
    ['missing worker', (value: ReturnType<typeof receipt>) => { value.residents.allocated = 0; }],
    ['foreign output', (value: ReturnType<typeof receipt>) => { value.produced.materials = 1; }],
    ['subcent output', (value: ReturnType<typeof receipt>) => { value.produced.energy = 0.001; }],
    ['false shortage', (value: ReturnType<typeof receipt>) => { value.shortages = [{ resource: 'materials', required: 1, available: 0 }]; }],
  ] as const) { const corrupt = structuredClone(valid); mutate(receipt(corrupt)); assert.equal(isWorldState(corrupt), false, label); }
  const historical = structuredClone(valid); cityOf(historical).population = 3; historical.civilizations[0]!.resources.materials = 0;
  cityOf(historical).improvements![String(tileId)]!.operation.enabled = false;
  assert.ok(isWorldState(historical)); assert.deepEqual(receipt(historical), receipt(valid));
  for (const field of ['paid', 'workRequired'] as const) {
    const corrupt = structuredClone(valid); const completion = cityOf(corrupt).improvements![String(tileId)]!.completion;
    if (field === 'paid') completion.paid.materials = 7; else completion.workRequired = 5;
    assert.equal(isWorldState(corrupt), false, field);
  }
});

void test('paid forest content requires the exact charcoal identity and operation gates rather than permitting arbitrary paid sites', () => {
  assert.deepEqual(validateContent(), []);
  for (const mutate of [
    (value: ImprovementDefinition) => { value.id = 'counterfeit-clearing'; },
    ...['charcoal-clearing', 'building-operations', 'worked-land', 'resident-capacity', 'recurring-decisions'].map(feature => (value: ImprovementDefinition) => { value.requiredFeatures = value.requiredFeatures.filter(id => id !== feature); }),
    (value: ImprovementDefinition) => { value.siteRequirement = 'hill'; },
    (value: ImprovementDefinition) => { value.siteRange = 4; },
    (value: ImprovementDefinition) => { delete value.operatingInputs; },
    (value: ImprovementDefinition) => { value.operatingInputs = {}; },
    (value: ImprovementDefinition) => { value.operatingInputs = { materials: -1 }; },
  ]) {
    const content = structuredClone(CONTENT); mutate(content.improvements.find(item => item.id === 'charcoal-clearing')!);
    assert.ok(validateContent(content).some(error => error.startsWith('improvement ')));
  }
  const arbitrary = structuredClone(CONTENT); const mine = arbitrary.improvements.find(item => item.id === 'mine')!;
  mine.operatingInputs = { materials: 1 }; mine.requiredFeatures = [...mine.requiredFeatures, 'building-operations', 'charcoal-clearing'];
  assert.ok(validateContent(arbitrary).some(error => error.startsWith('improvement mine:')));
  const { state, siteIds } = fixture();
  for (const tile of state.tiles) if (tile.terrain === 'forest' && tile.id !== siteIds[1]) tile.terrain = 'grassland';
  assert.ok(availableImprovementSites(state, cityOf(state), definition()).includes(siteIds[1]!), 'The sole-forest reserve is policy-only, not an engine ban');
});
