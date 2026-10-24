import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createCoastalOpportunity } from '../core/behavior-coastal-opportunity.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { isCoastalSite } from '../core/simulation/coastal.ts';
import { isWorldState } from '../core/validation.ts';
import { createProductiveFrontierAssessment } from '../core/behavior-frontier.ts';
import { createFoundingProtection } from '../core/behavior-founding-protection.ts';
import { BUILDINGS, ECONOMY_RULES, LOCAL_GROWTH_RULES, TECHNOLOGIES } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { availableActions } from '../core/simulation/choices.ts';
import type { City, WorldState } from '../core/types.ts';

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

void test('coastal support mode reserves waiting households but never pays unexecuted promises into its allocation view', () => {
  const { state, city, destination } = fixture(); city.population = 6;
  const shared = createFoundingProtection(state, 0);
  const request = { source: city, destination, horizon: 8, foundingCost: ECONOMY_RULES.settle.cost, setupCost: {}, allocationMode: 'actual-payment' as const };
  const founding = shared.fund(request); const waiting = shared.fund({ ...request, preserveWaitingHouseholds: true });
  assert.ok(founding.facts, founding.reason ?? ''); assert.ok(waiting.facts, waiting.reason ?? '');
  assert.ok(waiting.facts.protectedBudget.ordinary.food >= founding.facts.protectedBudget.ordinary.food);
  assert.equal(founding.facts.households.find(home => home.cityId === city.id)!.openingPopulation, 3);
  assert.equal(founding.facts.households.find(home => home.prospective)!.capacity, 8);
});

void test('shared allocation mode protects enabled recipes and rejects lost staff without future growth', () => {
  const { state, city, destination } = fixture(); city.population = 6;
  city.buildings = ['irrigation']; city.buildingOperations = { irrigation: { enabled: true, lastResult: null } };
  const result = createFoundingProtection(state, 0).fund({ source: city, destination, horizon: 8, foundingCost: ECONOMY_RULES.settle.cost, setupCost: {}, allocationMode: 'actual-payment', requireEnabledOperations: true });
  assert.equal(result.facts, null); assert.match(result.reason!, /protected-operation/);
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
  for (const [name, mutate] of cases) void test(`full old/new inland parity: ${name}`, () => {
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
    ['unsafe-accounting', state => { state.civilizations.find(actor => actor.id === civId)!.resources.food = Infinity; }, /unsafe-accounting/],
  ];
  for (const [name, mutate, reason] of probes) {
    const state = structuredClone(base); mutate(state, state.cities.find(city => city.id === source.id)!); const before = structuredClone(state);
    const assessed = createCoastalOpportunity(state, civId, [option]).assessment(option.action);
    assert.equal(assessed.hold, true, name); assert.equal(assessed.witness, null, name); assert.match(assessed.reason!, reason, name); assert.deepEqual(state, before, name);
  }
});
