import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createCoastalOpportunity } from '../core/behavior-coastal-opportunity.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { isCoastalSite } from '../core/simulation/coastal.ts';
import { isWorldState } from '../core/validation.ts';
import { createProductiveFrontierAssessment } from '../core/behavior-frontier.ts';
import { createFoundingProtection } from '../core/behavior-founding-protection.ts';
import { BUILDINGS, ECONOMY_RULES, IMPROVEMENTS, LOCAL_GROWTH_RULES, TECHNOLOGIES } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { availableActions } from '../core/simulation/choices.ts';
import type { City, GameEvent, WorldState } from '../core/types.ts';
import { exchangePromisedResources } from '../core/behavior-knowledge.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { executeReliefAction, reliefActionFailure } from '../core/simulation/relief-charters.ts';
import { acceptKnowledge, syntheticKnowledgeCorridor, TEACHER, LEARNER } from './fixtures/knowledge-current.ts';
import { syntheticTechnologies } from './fixtures/coastal-prefix.ts';

function fixture() {
  const state = createWorld(1701, '2026-10-24T00:00:00.000Z', 'settlement-charcoal-clearing-1');
  const actor = state.civilizations[0]!; const city = state.cities[0]!;
  actor.technologies = ['agriculture', 'mining', 'masonry', 'water-management'];
  actor.resources = { food: 2000, materials: 2000, energy: 2000, credits: 2000, science: 0, culture: 2000 };
  city.population = 9; city.focus = 'industry'; city.buildings = []; city.buildingOperations = {}; city.improvements = {}; city.construction = { active: null, lastCompleted: null };
  const action = availableActions(state, 0).find(option => option.action.type === 'settle' && option.action.sourceCityId === city.id)?.action;
  assert.ok(action?.type === 'settle');
  const destination: City = { id: 'conditional-frontier-prospective-town', name: 'Conditional frontier', civId: 0, tileId: action.tileId, ...ECONOMY_RULES.initialCity, population: ECONOMY_RULES.settle.population, focus: city.focus, buildings: [], housing: { ruleVersion: 1, origin: 'founded', baseCapacity: LOCAL_GROWTH_RULES.foundedBaseCapacity, establishedRound: state.round } };
  return { state, actor, city, action, destination };
}

void test('shared protection preserves the exact inland funding object without mutating its input', () => {
  const { state, city, action, destination } = fixture(); const before = structuredClone(state);
  const inland = createProductiveFrontierAssessment(state, 0).founding(action); assert.ok(inland.quote, inland.reason ?? '');
  const shared = createFoundingProtection(state, 0);
  const funding = shared.fund({ source: city, destination, horizon: inland.quote.protectedHorizon, foundingCost: ECONOMY_RULES.settle.cost, setupCost: BUILDINGS.find(building => building.id === 'farm')!.cost });
  assert.deepEqual(funding, { facts: { protectedBudget: inland.quote.protectedBudget, households: inland.quote.households, retainedOperations: inland.quote.retainedOperations, allocations: inland.quote.allocations }, reason: null });
  assert.deepEqual(state, before);
});

void test('current-town protection reserves only existing households and its actual setup payment', () => {
  const { state, city, destination } = fixture(); city.population = 6;
  const shared = createFoundingProtection(state, 0); const before = structuredClone(state);
  const founding = shared.fund({ source: city, destination, horizon: 8, foundingCost: ECONOMY_RULES.settle.cost, setupCost: {}, allocationMode: 'actual-payment', requireEnabledOperations: true });
  const preparation = shared.fund({ kind: 'current-towns', horizon: 8, setupCost: { materials: 14, credits: 10 }, allocationMode: 'actual-payment', requireEnabledOperations: true });
  assert.ok(founding.facts, founding.reason ?? ''); assert.ok(preparation.facts, preparation.reason ?? '');
  assert.equal(preparation.facts.households.find(home => home.cityId === city.id)!.openingPopulation, 6);
  assert.equal(preparation.facts.households.some(home => home.prospective), false);
  assert.equal(preparation.facts.households.length, state.cities.filter(home => home.civId === 0).length);
  assert.equal(preparation.facts.protectedBudget.ordinary.materials, 14); assert.equal(preparation.facts.protectedBudget.ordinary.credits, 10);
  assert.equal(founding.facts.households.find(home => home.cityId === city.id)!.openingPopulation, 3);
  assert.equal(founding.facts.households.find(home => home.prospective)!.capacity, 8);
  assert.deepEqual(state, before);
});

void test('shared allocation mode protects enabled recipes and rejects lost staff without future growth', () => {
  const { state, city, destination } = fixture(); city.population = 6;
  city.buildings = ['irrigation']; city.buildingOperations = { irrigation: { enabled: true, lastResult: null } };
  const result = createFoundingProtection(state, 0).fund({ source: city, destination, horizon: 8, foundingCost: ECONOMY_RULES.settle.cost, setupCost: {}, allocationMode: 'actual-payment', requireEnabledOperations: true });
  assert.equal(result.facts, null); assert.match(result.reason!, /protected-operation/);
});

void test('current-town preparation retains an accepted teaching institution and its exact promises without borrowing departure workers', () => {
  const state = syntheticKnowledgeCorridor(); const compact = acceptKnowledge(state); const actor = state.civilizations[TEACHER]!;
  actor.resources = { food: 2000, materials: 2000, energy: 2000, credits: 2000, science: 0, culture: 2000 };
  const city = state.cities.find(home => home.civId === TEACHER)!; city.population = 6;
  assert.ok(isWorldState(state)); const before = structuredClone(state);
  const shared = createFoundingProtection(state, TEACHER); const horizon = Math.max(8, shared.prepare().horizon);
  const funded = shared.fund({ kind: 'current-towns', horizon, setupCost: { materials: 14, credits: 10 }, allocationMode: 'actual-payment', requireEnabledOperations: true });
  assert.ok(funded.facts, funded.reason ?? ''); const promises = exchangePromisedResources(state, TEACHER, horizon);
  assert.ok(horizon >= compact.deadlineRound - state.round); assert.ok(funded.facts.retainedOperations.includes(`${city.id}/building/academy`));
  assert.equal(funded.facts.protectedBudget.ordinary.culture, promises.ordinary.culture + 2 * horizon);
  assert.equal(funded.facts.protectedBudget.ordinary.credits, 10 + promises.ordinary.credits + horizon);
  assert.equal(funded.facts.allocations.find(item => item.key === `${city.id}/building/academy`)!.openingPopulation, 6);
  assert.deepEqual(state, before);
  const action = availableActions(state, TEACHER).find(option => option.action.type === 'settle' && option.action.sourceCityId === city.id)!.action;
  assert.equal(action.type, 'settle'); if (action.type !== 'settle') throw new Error('Expected a legal inland source for the shared departure test');
  const destination: City = { id: 'test-teaching-departure', name: 'Conditional destination', civId: TEACHER, tileId: action.tileId, ...ECONOMY_RULES.initialCity, population: 3, focus: city.focus, buildings: [], housing: { ruleVersion: 1, origin: 'founded', baseCapacity: 8, establishedRound: state.round } };
  const departure = shared.fund({ source: city, destination, horizon, foundingCost: ECONOMY_RULES.settle.cost, setupCost: {}, allocationMode: 'actual-payment', requireEnabledOperations: true });
  assert.equal(departure.facts, null); assert.match(departure.reason!, /protected-operation/);
  city.buildingOperations!.academy!.enabled = false;
  const stopped = createFoundingProtection(state, TEACHER).fund({ kind: 'current-towns', horizon, setupCost: {}, allocationMode: 'actual-payment', requireEnabledOperations: true });
  assert.equal(stopped.facts, null); assert.match(stopped.reason!, /selected-institution-unfunded/);
});

void test('accepted relief remains a full current-town outgoing reserve despite future incoming cargo', () => {
  const state = syntheticKnowledgeCorridor(); const donor = state.civilizations[TEACHER]!; donor.resources.food = 2000;
  state.civilizations[LEARNER]!.resources.food = 0;
  const action = { type: 'propose-relief' as const, routeId: state.routes[0]!.id, sourceCityId: 'city-1', recipientCityId: 'city-4' };
  assert.equal(reliefActionFailure(state, TEACHER, action), null);
  state.revision++; let events: GameEvent[] = []; assert.ok(executeReliefAction(state, TEACHER, action, events)); commitEvents(state, events);
  const charterId = state.relief!.active[0]!.id; const accept = { type: 'respond-relief' as const, charterId, accept: true };
  assert.equal(reliefActionFailure(state, LEARNER, accept), null); state.revision++; events = []; assert.ok(executeReliefAction(state, LEARNER, accept, events)); commitEvents(state, events);
  const charter = state.relief!.active[0]!; assert.equal(charter.status, 'accepted'); assert.ok(isWorldState(state));
  const shared = createFoundingProtection(state, TEACHER); const horizon = Math.max(8, shared.prepare().horizon);
  const request = { kind: 'current-towns' as const, horizon, setupCost: { materials: 14, credits: 10 }, allocationMode: 'actual-payment' as const, requireEnabledOperations: true as const };
  const funded = shared.fund(request); assert.ok(funded.facts, funded.reason ?? '');
  const promises = exchangePromisedResources(state, TEACHER, horizon); assert.ok(promises.ordinary.food >= charter.terms.food); assert.ok(promises.ordinary.energy >= charter.terms.energy);
  assert.equal(funded.facts.protectedBudget.ordinary.food, Math.round((promises.ordinary.food + funded.facts.households.reduce((sum, home) => sum + home.householdFood + home.growthFood, 0)) * 100) / 100);
  assert.equal(funded.facts.protectedBudget.ordinary.energy, promises.ordinary.energy);
  donor.resources.food = funded.facts.protectedBudget.ordinary.food - 0.01; const before = structuredClone(state);
  const denied = createFoundingProtection(state, TEACHER).fund(request); assert.equal(denied.facts, null); assert.match(denied.reason!, /opening-budget/); assert.deepEqual(state, before);
});

void test('shared current-town and departure requests both reserve exact finite woodland stock for enabled and paid-pending sites', context => {
  for (const pending of [false, true]) {
    const state = createWorld(1701, '2026-10-24T00:00:00.000Z', 'settlement-renewing-worked-woodlands-1');
    syntheticTechnologies(state, 0, ['machinery']); const city = state.cities[0]!; city.population = 9; city.buildings = []; city.buildingOperations = {}; city.improvements = {}; city.construction = { active: null, lastCompleted: null };
    state.civilizations[0]!.resources = { food: 2000, materials: 2000, energy: 2000, credits: 2000, science: 0, culture: 2000 };
    const definition = IMPROVEMENTS.find(item => item.id === 'lumber-mill')!; const tileId = 56;
    assert.equal(state.tiles.find(tile => tile.id === tileId)!.terrain, 'forest'); assert.equal(state.tiles.find(tile => tile.id === tileId)!.owner, 0);
    const order = { kind: 'improvement' as const, id: 'unit-paid-woodland', cityId: city.id, improvementId: definition.id, tileId, ruleVersion: 1 as const, startedRound: state.round, paid: { ...definition.cost }, workRequired: definition.requiredWork, workDone: 0 };
    if (pending) city.construction.active = order;
    else city.improvements[String(tileId)] = { improvementId: definition.id, tileId, completion: { kind: 'improvement', orderId: order.id, cityId: city.id, improvementId: definition.id, tileId, startedRound: 0, completedRound: 0, paid: { ...definition.cost }, workRequired: definition.requiredWork, eventId: 'unit-completion' }, operation: { enabled: true, lastResult: null } };
    const destination: City = { id: 'unit-woodland-destination', name: 'Conditional destination', civId: 0, tileId: 0, ...ECONOMY_RULES.initialCity, population: 3, focus: city.focus, buildings: [], housing: { ruleVersion: 1, origin: 'founded', baseCapacity: 8, establishedRound: state.round } };
    const requests = [
      { kind: 'current-towns' as const, horizon: 8, setupCost: { materials: 14, credits: 10 }, allocationMode: 'actual-payment' as const, requireEnabledOperations: true as const },
      { source: city, destination, horizon: 8, foundingCost: ECONOMY_RULES.settle.cost, setupCost: {}, allocationMode: 'actual-payment' as const, requireEnabledOperations: true as const },
    ];
    for (const request of requests) {
      state.woodlands!.stands[String(tileId)]!.stock = 8; const before = structuredClone(state);
      const funded = createFoundingProtection(state, 0).fund(request); assert.ok(funded.facts, `${pending}: ${funded.reason}`); assert.ok(funded.facts.retainedOperations.includes(`${city.id}/site/${tileId}`)); assert.deepEqual(state, before);
      state.woodlands!.stands[String(tileId)]!.stock = 7; const denied = createFoundingProtection(state, 0).fund(request); assert.equal(denied.facts, null); assert.match(denied.reason!, /woodland-horizon/);
    }
  }
  context.diagnostic('Unit-level retained order/completion probes; no canonical historical receipt or natural woodland outcome is claimed. Opening eight versus seven lots is the independent bound; no recovery finances support.');
});

const oraclePath = process.env.FRONTIER_PARITY_ORACLE;
if (oraclePath) {
  const { createProductiveFrontierAssessment: legacy } = await import(pathToFileURL(oraclePath).href) as { createProductiveFrontierAssessment: typeof createProductiveFrontierAssessment };
  const cases: [string, (state: WorldState) => void][] = [
    ['funded', () => {}],
    ['six-to-three', state => { const city = state.cities[0]!; city.population = 6; city.buildings = ['irrigation']; city.buildingOperations = { irrigation: { enabled: true, lastResult: null } }; }],
    ['pending-housing', state => { const city = state.cities[0]!; city.population = 9; city.housing!.baseCapacity = 6; city.construction!.active = { id: 'paid', cityId: city.id, buildingId: 'granary', ruleVersion: 1, startedRound: state.round, paid: { materials: 14, credits: 6 }, workRequired: 8, workDone: 1 }; }],
    ['pending-recipe', state => { const city = state.cities[0]!; city.construction!.active = { id: 'paid', cityId: city.id, buildingId: 'irrigation', ruleVersion: 1, startedRound: state.round, paid: { materials: 12, credits: 8 }, workRequired: 4, workDone: 1 }; }],
    ['budget-refusal', state => { state.civilizations[0]!.resources.food = 12; }],
    ['missing-farm', state => { state.civilizations[0]!.technologies = []; }],
    ['unsafe-round', state => { state.round = Number.MAX_SAFE_INTEGER; }],
  ];
  for (const [name, mutate] of cases) void test(`full old/new inland parity: ${name}`, context => {
    context.diagnostic('Unit-level parity corpus includes synthetic and invalid-state refusal probes; not a validated historical-world or campaign claim.');
    const { state, action } = fixture(); mutate(state); const before = structuredClone(state);
    const oldResult = legacy(state, 0).founding(action); const newResult = createProductiveFrontierAssessment(state, 0).founding(action);
    assert.deepEqual(newResult, oldResult); assert.deepEqual(state, before);
    assert.deepEqual(createProductiveFrontierAssessment(state, 0).farm(state.cities[0]!.id), legacy(state, 0).farm(state.cities[0]!.id));
  });
}

void test('coastal closure unit probes refuse unsupported work without editing the retained snapshot', () => {
  const base = createGeneratedWorld(73, '2026-10-24T00:00:00.000Z', 'settlement-learning-patronage-1', 'cultural-toponyms-v1', 'strategic-temperaments-v1');
  const source = base.cities.find(city => isCoastalSite(base, city.tileId))!; assert.ok(source);
  const civId = source.civId; const actor = base.civilizations.find(actor => actor.id === civId)!;
  const grant = (id: string): void => { const definition = TECHNOLOGIES.find(technology => technology.id === id)!; for (const parent of definition.requires) grant(parent); if (!actor.technologies.includes(id)) actor.technologies.push(id); };
  grant('navigation'); grant('water-management');
  actor.resources = { food: 10000, materials: 10000, credits: 10000, energy: 10000, science: 0, culture: 10000 };
  source.buildings.push('boat-yard'); source.population = 9;
  for (const city of base.cities) city.construction ??= { active: null, lastCompleted: null };
  assert.ok(isWorldState(base));
  const option = availableActions(base, civId).find(option => option.action.type === 'settle-coast' && option.action.sourceCityId === source.id)!; assert.ok(option);
  assert.equal(createCoastalOpportunity(base, civId, [option]).assessment(option.action).hold, false);
  const probes: [string, (state: WorldState, city: City) => void, RegExp][] = [
    ['pending-government', state => { state.civilizations.find(actor => actor.id === civId)!.government!.pending = { targetGovernmentId: 'chiefdom', targetAssignments: [], acceptedRound: 0, completionRound: 2, paidCredits: 10, spentCompletionEventId: null }; }, /government-transition/],
    ['off-world-colony', state => { state.spaceflight!.civilizations[civId]!.colony = { establishedRound: 0, stock: { food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 }, shortageRounds: 0 }; }, /unsupported-off-world/],
    ['research-reveal', (state, city) => { state.civilizations.find(actor => actor.id === civId)!.researchTarget = 'bronze-working'; city.construction!.active = { kind: 'improvement', id: 'closure-probe', cityId: city.id, improvementId: 'mine', tileId: city.tileId, ruleVersion: 1, startedRound: 0, paid: {}, workRequired: 6, workDone: 0 }; }, /unsupported-research-reveal/],
    ['paid-wonder', (_state, city) => { city.construction!.active = { kind: 'wonder', id: 'closure-probe', cityId: city.id, wonderId: 'great-library', tileId: city.tileId, ruleVersion: 1, startedRound: 0, paid: {}, workRequired: 24, workDone: 0 }; }, /unsupported-order-closure/],
    ['paid-rail', (_state, city) => { city.construction!.active = { kind: 'rail', id: 'closure-probe', cityId: city.id, edgeId: '0:1', tileId: 0, toTileId: 1, ruleVersion: 1, startedRound: 0, paid: {}, strategicPaid: {}, workRequired: 4, workDone: 0 }; }, /unsupported-order-closure/],
    ['mixed-river', (state, city) => { for (const town of [city, state.cities.find(town => town.civId !== civId)!]) town.construction!.active = { kind: 'improvement', id: `closure-probe-${town.id}`, cityId: town.id, improvementId: 'river-intake', tileId: town.tileId, ruleVersion: 1, startedRound: 0, paid: {}, workRequired: 4, workDone: 0 }; }, /unsupported-river-competition/],
    ['pending-power', (_state, city) => { city.construction!.active = { id: 'closure-probe', cityId: city.id, buildingId: 'coal-plant', ruleVersion: 1, startedRound: 0, paid: {}, workRequired: 18, workDone: 0 }; }, /unsupported-order-effects/],
    ['unsafe-accounting', state => { state.civilizations.find(actor => actor.id === civId)!.resources.food = Infinity; }, /unsafe-accounting/],
  ];
  for (const [name, mutate, reason] of probes) {
    for (const mode of ['preparation', 'departure']) {
      const state = structuredClone(base); const town = state.cities.find(city => city.id === source.id)!;
      if (mode === 'preparation') town.buildings = town.buildings.filter(id => id !== 'boat-yard');
      const exact = mode === 'departure' ? option : availableActions(state, civId).find(choice => choice.action.type === 'build' && choice.action.project === 'boat-yard' && choice.action.cityId === town.id)!; assert.ok(exact);
      mutate(state, town); const before = structuredClone(state);
      const assessed = createCoastalOpportunity(state, civId, [exact]).assessment(exact.action);
      assert.equal(assessed.hold, true, `${name}/${mode}`); assert.equal(assessed.witness, null, name); assert.match(assessed.reason!, reason, name); assert.deepEqual(state, before, name);
    }
  }
});
