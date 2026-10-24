import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { BUILDINGS, CIVICS, IMPROVEMENTS } from '../core/content.ts';
import { conditionDrainage } from '../core/drainage.ts';
import { createWorld } from '../core/engine.ts';
import { produceCity, supplyCity } from '../core/simulation/city-production-supply.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { adoptGovernment } from '../core/simulation/government.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { createWoodlands } from '../core/simulation/woodlands.ts';
import type { City, GameEvent, HexTile, PolicyAssignment, WorldState } from '../core/types.ts';
import { syntheticTechnologies } from './fixtures/coastal-prefix.ts';
import { acceptKnowledge, tradeAction } from './fixtures/knowledge-current.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const release = 'settlement-learning-patronage-1';
const publishedSha256 = '1bbc8939c09b669ab28d7af985588e550aba7f3aebfee17ffa34c6469ba56814';
type Resolver = typeof resolveEconomy;
interface Frame { state: WorldState; events: GameEvent[] }
interface Run { initial: WorldState; frames: Frame[] }
interface Scenario { name: string; run: (resolve: Resolver) => Run }
const cityOf = (state: WorldState, id = 'city-0'): City => { const city = state.cities.find(city => city.id === id); assert.ok(city); return city; };
const actorOf = (state: WorldState, id = 0) => { const actor = state.civilizations.find(actor => actor.id === id); assert.ok(actor); return actor; };

function fresh(rulesId = release): WorldState {
  const state = createWorld(1701, epoch, rulesId);
  for (const actor of state.civilizations) {
    actor.resources = { food: 300, materials: 100, energy: 100, credits: 100, culture: 100, science: 0 };
    actor.researchTarget = '';
  }
  for (const city of state.cities) {
    city.wellbeing = 50; city.damage = 0; city.infrastructure = 0;
    city.construction = { active: null, lastCompleted: null };
  }
  return state;
}

function paidBuilding(state: WorldState, city: City, id: string): void {
  const definition = BUILDINGS.find(building => building.id === id); assert.ok(definition);
  syntheticTechnologies(state, city.civId, definition.requires);
  if (!city.buildings.includes(id)) city.buildings.push(id);
  city.buildingOperations ??= {};
  city.buildingOperations[id] = { enabled: true, lastResult: null };
}

function arrange(state: WorldState, governmentId: string, assignments: PolicyAssignment[]): void {
  const actor = actorOf(state);
  actor.civics!.completedCivicIds = CIVICS.map(civic => civic.id);
  actor.civics!.active = null; actor.civics!.lastCompleted = null; actor.civics!.reformEntitlement = null;
  state.revision++;
  const events: GameEvent[] = [];
  adoptGovernment(state, actor.id, governmentId, assignments, events); commitEvents(state, events);
}

function timeline(state: WorldState, resolve: Resolver) {
  const initial = structuredClone(state); const frames: Frame[] = [];
  const beat = (): GameEvent[] => {
    state.round++; state.revision++;
    const events: GameEvent[] = [];
    resolve(state, events); commitEvents(state, events);
    assert.ok(events.some(event => event.type === 'settlement-production'));
    frames.push(structuredClone({ state, events }));
    return events;
  };
  return { beat, finish: (): Run => ({ initial, frames }) };
}

function improvement(city: City, improvementId: string, tileId: number): void {
  const definition = IMPROVEMENTS.find(item => item.id === improvementId); assert.ok(definition);
  city.improvements = { [tileId]: { improvementId, tileId, completion: { kind: 'improvement', orderId: `synthetic-paid-${city.id}-${tileId}`, cityId: city.id, improvementId, tileId, startedRound: 0, completedRound: 0, paid: { ...definition.cost }, workRequired: definition.requiredWork, eventId: `synthetic-completion-${city.id}-${tileId}` }, operation: { enabled: true, lastResult: null } } };
}

const scenarios: Scenario[] = [
  { name: 'current paid learning receipts and real household growth', run(resolve) {
    const state = fresh(); const city = cityOf(state); const actor = actorOf(state);
    city.population = 10; city.housing!.baseCapacity = 20; city.wellbeing = 80;
    city.infrastructure = 0.7; city.damage = 7.9; city.focus = 'research'; actor.era = 1;
    paidBuilding(state, city, 'academy'); paidBuilding(state, city, 'irrigation');
    arrange(state, 'chiefdom', [{ slotType: 'economic', slotIndex: 0, policyId: 'learning-patronage' }]);
    const run = timeline(state, resolve);
    for (let beat = 0; beat < 4; beat++) {
      const population = city.population; const events = run.beat();
      const learning = city.buildingOperations!.academy!.lastResult!;
      assert.equal(learning.status, 'operated'); assert.deepEqual(learning.paid, { culture: 2, credits: 1 });
      assert.equal(learning.residents!.allocated, 3); assert.ok(learning.policyContribution!.bonusScience > 0);
      assert.ok((learning.produced.science ?? 0) > learning.policyContribution!.bonusScience);
      assert.equal(city.lastFoodSupply!.population, population); assert.equal(city.lastFoodSupply!.required, population * 1.25);
      assert.equal(city.lastFoodSupply!.supplied, true); assert.ok(city.lastFoodSupply!.growthPaid > 0);
      assert.equal(city.population, population + 1); assert.ok(events.some(event => event.populationGrowth?.cityId === city.id));
    }
    return run.finish();
  } },
  { name: 'opening inputs cannot borrow later production and starvation is unchanged', run(resolve) {
    const state = fresh(); const city = cityOf(state); const actor = actorOf(state);
    city.population = 20; city.housing!.baseCapacity = 20; city.wellbeing = 5; city.damage = 50; city.focus = 'research';
    actor.resources.food = 1; actor.resources.materials = 0; paidBuilding(state, city, 'irrigation');
    const run = timeline(state, resolve); const events = run.beat();
    assert.equal(city.buildingOperations!.irrigation!.lastResult!.status, 'blocked');
    assert.equal(city.lastFoodSupply!.required, 25); assert.equal(city.lastFoodSupply!.supplied, false);
    assert.ok(city.lastFoodSupply!.paid < 25); assert.equal(actor.resources.food, 0); assert.equal(city.population, 19);
    assert.ok(events.some(event => event.type === 'supply-shortage' && event.actor === 0));
    assert.ok(actor.resources.materials > 0);
    run.beat(); assert.equal(city.lastFoodSupply!.population, 19);
    return run.finish();
  } },
  { name: 'two retained-policy transition beats precede target policy and lock', run(resolve) {
    const state = fresh(); const city = cityOf(state); const actor = actorOf(state);
    city.population = 9; city.housing!.baseCapacity = 9; actor.era = 1; paidBuilding(state, city, 'academy');
    arrange(state, 'chiefdom', [{ slotType: 'economic', slotIndex: 0, policyId: 'learning-patronage' }]);
    actor.government!.active!.governmentLockUntilRound = 0; actor.government!.active!.policyLockUntilRound = 0;
    const before = actor.resources.credits;
    arrange(state, 'autocracy', [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }]);
    assert.equal(actor.resources.credits, before - 10);
    const run = timeline(state, resolve);
    for (let beat = 1; beat <= 3; beat++) {
      const events = run.beat(); const receipt = city.buildingOperations!.academy!.lastResult!;
      assert.equal(receipt.status, 'operated');
      assert.equal(receipt.policyContribution !== undefined, beat <= 2);
      if (beat === 1) assert.equal(actor.government!.pending!.completionRound, 2);
      else { assert.equal(actor.government!.pending, null); assert.equal(actor.government!.active!.governmentId, 'autocracy'); assert.equal(actor.government!.active!.governmentLockUntilRound, 6); }
      assert.equal(events.some(event => event.type === 'transition-completed'), beat === 2);
    }
    return run.finish();
  } },
  { name: 'paid construction becomes an operation only after its completion beat', run(resolve) {
    const state = fresh(); const city = cityOf(state); city.population = 9; city.housing!.baseCapacity = 9;
    syntheticTechnologies(state, 0, ['water-management']);
    city.construction!.active = { id: 'synthetic-paid-irrigation', cityId: city.id, buildingId: 'irrigation', ruleVersion: 1, startedRound: 0, paid: { materials: 12, credits: 8 }, workRequired: 4, workDone: 3.99 };
    const run = timeline(state, resolve); const completion = run.beat();
    assert.ok(completion.some(event => event.type === 'building-completed' && event.actor === 0));
    assert.equal(city.buildingOperations!.irrigation!.lastResult, null);
    const food = city.lastFoodSupply!.produced;
    run.beat(); assert.equal(city.buildingOperations!.irrigation!.lastResult!.status, 'operated');
    assert.deepEqual(city.buildingOperations!.irrigation!.lastResult!.paid, { materials: 1 });
    assert.ok(city.lastFoodSupply!.produced > food); run.beat();
    return run.finish();
  } },
  { name: 'finite woodland harvest, refusal, recovery and resumed paid output', run(resolve) {
    const state = fresh(); const city = cityOf(state); city.population = 6; city.housing!.baseCapacity = 6;
    syntheticTechnologies(state, 0, ['kiln-firing']); improvement(city, 'charcoal-clearing', 56);
    assert.equal(state.tiles.find(tile => tile.id === 56)!.terrain, 'forest');
    const stand = state.woodlands!.stands['56']!; stand.stock = 2;
    const run = timeline(state, resolve);
    for (let beat = 1; beat <= 4; beat++) {
      run.beat(); const operation = city.improvements!['56']!.operation.lastResult!;
      assert.equal(operation.status, beat === 3 ? 'blocked' : 'operated');
      assert.equal(operation.blockedReason, beat === 3 ? 'woodland-shortage' : null);
      assert.deepEqual(operation.paid, beat === 3 ? {} : { materials: 1 });
      assert.equal(stand.stock, beat === 1 || beat === 3 ? 1 : 0);
      assert.equal(operation.woodland!.harvested, beat === 3 ? 0 : 1);
      if (beat !== 3) assert.ok((operation.produced.energy ?? 0) > 0);
    }
    return run.finish();
  } },
  { name: 'shared river withdrawal, pause and staffing preserve source conservation', run(resolve) {
    const state = fresh(); state.width = 10; state.height = 1;
    const tiles = Array.from({ length: 10 }, (_, id): HexTile => ({ id, q: id, r: 0, terrain: id === 9 ? 'ocean' : 'grassland', elevation: id === 9 ? 10 : 80 - id * 2, resource: null, owner: null }));
    const conditioned = conditionDrainage(tiles, 10, 1); assert.ok(conditioned);
    state.tiles = conditioned.tiles; state.drainage = conditioned.drainage; state.woodlands = createWoodlands(state.tiles);
    state.cities = state.cities.slice(0, 2); state.civilizations = state.civilizations.slice(0, 2); state.routes = [];
    for (const [index, city] of state.cities.entries()) {
      city.id = index === 0 ? 'z-upstream' : 'a-downstream'; city.tileId = index === 0 ? 6 : 5;
      city.population = 7; city.housing!.baseCapacity = 7; city.buildings = []; city.buildingOperations = {}; city.districtSites = {};
      city.focus = 'research'; state.tiles[city.tileId]!.owner = city.civId;
      paidBuilding(state, city, 'irrigation'); const tileId = index === 0 ? 7 : 8; state.tiles[tileId]!.owner = city.civId; improvement(city, 'river-intake', tileId);
      actorOf(state, city.civId).resources.materials = 10;
    }
    const upstream = cityOf(state, 'z-upstream'); const downstream = cityOf(state, 'a-downstream');
    const run = timeline(state, resolve);
    run.beat(); assert.equal(upstream.improvements!['7']!.operation.lastResult!.status, 'operated');
    assert.equal(downstream.improvements!['8']!.operation.lastResult!.blockedReason, 'flow-shortage');
    assert.equal(state.riverFlow!.lastBeat!.withdrawals[0]!.tileId, 7);
    upstream.improvements!['7']!.operation.enabled = false; run.beat();
    assert.equal(downstream.improvements!['8']!.operation.lastResult!.status, 'operated');
    assert.equal(downstream.improvements!['8']!.operation.lastResult!.river!.availableBefore, 9);
    assert.ok((downstream.improvements!['8']!.operation.lastResult!.produced.food ?? 0) > 0);
    downstream.population = 3; upstream.improvements!['7']!.operation.enabled = true; run.beat();
    assert.equal(downstream.improvements!['8']!.operation.lastResult!.blockedReason, 'support-unfunded');
    for (const frame of run.finish().frames) {
      const flow = frame.state.riverFlow!.lastBeat!;
      assert.equal(flow.sourceUnits, 9); assert.equal(flow.sourceUnits, flow.withdrawals.reduce((sum, item) => sum + item.quantity, 0) + flow.outlets.reduce((sum, item) => sum + item.quantity, 0));
    }
    return run.finish();
  } },
  { name: 'opening local residents and Power distinguish blocked from funded production', run(resolve) {
    const state = fresh(); const city = cityOf(state); city.population = 9; city.housing!.baseCapacity = 9;
    for (const id of ['coal-plant', 'academy', 'factory']) paidBuilding(state, city, id);
    actorOf(state).strategicResources = { coal: 6 };
    const run = timeline(state, resolve); run.beat();
    assert.equal(city.buildingOperations!['coal-plant']!.lastResult!.status, 'operated');
    assert.equal(city.buildingOperations!.academy!.lastResult!.status, 'operated');
    assert.equal(city.buildingOperations!.factory!.lastResult!.status, 'blocked');
    assert.equal(city.localPower!.lastBeat!.generated, 8); assert.equal(city.localPower!.lastBeat!.consumed, 0);
    city.buildingOperations!.academy!.enabled = false; run.beat();
    assert.equal(city.buildingOperations!.factory!.lastResult!.status, 'operated');
    assert.ok((city.buildingOperations!.factory!.lastResult!.produced.materials ?? 0) > 0);
    assert.equal(city.localPower!.lastBeat!.consumed, 3); assert.equal(actorOf(state).strategicResources!.coal, 2);
    return run.finish();
  } },
  { name: 'accepted teaching consumes actual same-round paid institution receipts', run(resolve) {
    const state = fresh();
    for (const id of [1, 4]) {
      const actor = actorOf(state, id); const city = cityOf(state, `city-${id}`);
      actor.era = 1; actor.resources = { food: 300, materials: 300, energy: 300, credits: 300, culture: 300, science: 0 };
      syntheticTechnologies(state, id, ['wheel', 'masonry', 'civic-institutions']);
      city.population = 6; city.housing!.baseCapacity = 6; city.wellbeing = 40; city.focus = 'research'; paidBuilding(state, city, 'academy');
    }
    syntheticTechnologies(state, 1, ['engineering']); actorOf(state, 4).researchTarget = 'engineering';
    tradeAction(state, 1, { type: 'propose-trade', partner: 4, recipeId: 'harvest-for-materials', sourceCityId: 'city-1', recipientCityId: 'city-4' });
    tradeAction(state, 4, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true });
    const run = timeline(state, resolve);
    for (let beat = 0; beat < 4; beat++) run.beat();
    assert.equal(state.routes[0]!.agreement!.deliveryCount, 1); const compact = acceptKnowledge(state);
    assert.equal(compact.status, 'accepted');
    const before = actorOf(state, 4).researchProgress;
    for (let beat = 0; beat < 4; beat++) run.beat();
    assert.ok(actorOf(state, 4).researchProgress > before);
    const events = run.finish().frames.flatMap(frame => frame.events);
    assert.equal(events.filter(event => event.knowledgeStudy?.attempt.blockers.length === 0).length, 2);
    const result = events.find(event => event.knowledgeResult?.outcome === 'completed')?.knowledgeResult; assert.ok(result && result.amount > 0);
    assert.deepEqual(result.learnerPaid, { materials: 3, credits: 4 }); assert.deepEqual(result.teacherPaid, { culture: 2 });
    assert.ok(events.some(event => event.type === 'trade-delivered'));
    return run.finish();
  } },
  { name: 'same civilization town meals preserve retained array order and treasury continuity', run(resolve) {
    const state = fresh(); const first = cityOf(state); const second = structuredClone(first);
    first.population = 1; first.housing!.baseCapacity = 1; first.focus = 'research';
    const secondSite = state.tiles.find(tile => tile.owner === 0 && !state.cities.some(city => city.tileId === tile.id)); assert.ok(secondSite); second.tileId = secondSite.id;
    second.id = 'a-second-in-array'; second.population = 20; second.housing!.baseCapacity = 20; second.focus = 'research'; second.damage = 90;
    state.cities.push(second); actorOf(state).resources.food = 0;
    const run = timeline(state, resolve); run.beat();
    assert.equal(first.lastFoodSupply!.foodBefore, 0); assert.equal(first.lastFoodSupply!.supplied, true);
    assert.equal(second.lastFoodSupply!.foodBefore, first.lastFoodSupply!.foodAfter); assert.equal(second.lastFoodSupply!.supplied, false);
    return run.finish();
  } },
  { name: 'fresh registered regional rules use their configured upkeep without Food receipts', run(resolve) {
    const state = fresh('settlement-regional-targets-1'); const city = cityOf(state); city.population = 6;
    const run = timeline(state, resolve); run.beat(); run.beat();
    assert.equal(Object.hasOwn(city, 'lastFoodSupply'), false);
    assert.ok(actorOf(state).resources.food > 0);
    return run.finish();
  } },
];

const observed = new Map<string, Run>();
for (const scenario of scenarios) void test(`extracted economy primitives: ${scenario.name}`, context => {
  observed.set(scenario.name, scenario.run(resolveEconomy));
  context.diagnostic('Explicit synthetic prerequisites, stocks and sites exercise bounded actual mechanics; no autonomous-selection or balance claim.');
});

void test('shared city functions deposit production before household payment without re-allocating opening inputs', () => {
  const state = fresh(); const city = cityOf(state); const actor = actorOf(state);
  city.population = 6; city.housing!.baseCapacity = 6; actor.resources.materials = 0; actor.resources.food = 0;
  paidBuilding(state, city, 'irrigation'); state.round++;
  allocateOperations(state); const operation = structuredClone(city.buildingOperations!.irrigation!.lastResult);
  assert.equal(operation!.status, 'blocked');
  const output = produceCity(state, city); assert.ok(output.food > 0); assert.ok(actor.resources.materials > 0);
  assert.equal(actor.resources.food, output.food); assert.deepEqual(city.buildingOperations!.irrigation!.lastResult, operation);
  const events: GameEvent[] = []; const enough = output.food >= 7.5;
  assert.equal(supplyCity(state, city, events, output.food, 0), enough);
  assert.equal(city.lastFoodSupply!.produced, output.food); assert.equal(city.lastFoodSupply!.required, 7.5);
  assert.equal(actor.resources.food, Math.round(Math.max(0, output.food - 7.5) * 100) / 100);
});

const oraclePath = process.env.GOVERNMENT_CASHFLOW_ORACLE;
void test('published 0a80c0d6 economy equals extracted economy at every controlled full-state/event boundary', { skip: !oraclePath }, async context => {
  const publishedPath = process.env.GOVERNMENT_CASHFLOW_PUBLISHED_SOURCE; assert.ok(publishedPath && oraclePath);
  const original = readFileSync(publishedPath, 'utf8');
  assert.equal(createHash('sha256').update(original).digest('hex'), publishedSha256, 'Oracle must be exact owner-staged published economy');
  const origin = new URL('../core/simulation/economy.ts', import.meta.url);
  const relocated = original.replace(/from '([^']+)'/g, (_, specifier: string) => `from '${new URL(specifier, origin).href}'`);
  assert.equal(readFileSync(oraclePath, 'utf8'), relocated, 'Only import relocation is allowed in the independent economy oracle');
  const oracle = await import(pathToFileURL(oraclePath).href) as { resolveEconomy: Resolver };
  assert.equal(typeof oracle.resolveEconomy, 'function'); assert.notEqual(oracle.resolveEconomy, resolveEconomy);
  let beats = 0;
  for (const scenario of scenarios) {
    const current = observed.get(scenario.name) ?? scenario.run(resolveEconomy);
    const published = scenario.run(oracle.resolveEconomy);
    assert.ok(current.frames.length > 0); assert.deepEqual(current.initial, published.initial, scenario.name);
    assert.equal(current.frames.length, published.frames.length, scenario.name);
    for (const [index, frame] of current.frames.entries()) assert.deepEqual(frame, published.frames[index], `${scenario.name}: beat ${index + 1}`);
    beats += current.frames.length;
  }
  context.diagnostic(`Exact published SHA256 ${publishedSha256}; ${scenarios.length} synthetic scenarios, ${beats} paired full-state/event beats. Dependencies are the same current pinned modules; this isolates the extraction, not all historical transitive source.`);
});
