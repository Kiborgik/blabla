import assert from 'node:assert/strict';
import { test } from 'node:test';
import { borderReason, borderWeight, deriveBorderPlan } from '../core/behavior-border.ts';
import { createCharcoalClearingPolicy } from '../core/behavior-charcoal.ts';
import { createLandworkPlanner } from '../core/behavior-landwork.ts';
import { BEHAVIOR_PROFILES, FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION } from '../core/behavior-profiles.ts';
import { assessCivilizationBehavior, chooseCivilizationBehavior, createBehaviorMemory } from '../core/behaviors.ts';
import { IMPROVEMENTS, PUBLIC_PROJECT_RECIPES } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { decisionObligations } from '../core/simulation/decisions.ts';
import { availableActions } from '../core/simulation/choices.ts';
import { householdFoodUpkeep } from '../core/simulation/food-security.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { installImprovement, isHillSite } from '../core/simulation/improvements.ts';
import { createCoalDeposits, createStrategicDeposits } from '../core/simulation/metals.ts';
import { createPastoralSites } from '../core/simulation/pastoral.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import { executeReliefAction, reliefActionFailure } from '../core/simulation/relief-charters.ts';
import { createTerritoryPlanner } from '../core/simulation/territory.ts';
import { STRATEGIC_TEMPERAMENT_VERSION } from '../core/strategic-temperaments.ts';
import type { ActionOption, City, GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { borderBeat, borderEngineAction, borderTimestamp, dispatchBorder } from './fixtures/border-current.ts';
import { syntheticTechnologies } from './fixtures/coastal-prefix.ts';
import { acceptKnowledge, knowledgeEconomy, tradeAction, TEACHER, LEARNER } from './fixtures/knowledge-current.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const profile = { ...BEHAVIOR_PROFILES[0]!, resources: { food: 1, materials: 1, energy: 3, credits: 1, science: 4, culture: 1 } };
const actionFor = (city: City, tileId: number): Extract<GameAction, { type: 'improve' }> => ({ type: 'improve', cityId: city.id, tileId, improvementId: 'charcoal-clearing' });
function forests(state: WorldState, city: City) {
  const center = state.tiles.find(tile => tile.id === city.tileId)!;
  const reserved = new Set([...state.strategicDeposits!.tileIds, ...state.coalDeposits!.tileIds, ...state.pastoralSites!.tileIds, ...state.cities.map(town => town.tileId)]);
  const eligible = state.tiles.filter(tile => tile.owner === city.civId && !reserved.has(tile.id) && hexDistance(center, tile) <= 3).toSorted((a, b) => a.id - b.id);
  assert.ok(eligible.length >= 2);
  for (const tile of state.tiles) if (tile.owner === city.civId && tile.terrain === 'forest' && !reserved.has(tile.id)) tile.terrain = 'grassland';
  const first = eligible[0]!; const other = eligible[1]!;
  for (const tile of [first, other]) { tile.terrain = 'forest'; tile.elevation = 40; tile.resource = null; }
  return { first, other };
}
function fixture() {
  const state = createGeneratedWorld(73, epoch, 'settlement-charcoal-clearing-1', undefined, STRATEGIC_TEMPERAMENT_VERSION);
  const city = state.cities.find(town => town.civId === 0)!; const actor = state.civilizations[0]!;
  city.population = 7; city.infrastructure = 0; city.wellbeing = 50; city.damage = 0; city.focus = 'growth';
  city.buildings = ['kiln']; city.buildingOperations = { kiln: { enabled: true, lastResult: null } }; city.improvements = {}; city.districtSites = {}; city.construction = { active: null, lastCompleted: null };
  actor.technologies = ['agriculture', 'kiln-firing', 'mining']; actor.era = 0;
  actor.resources = { food: 1000, materials: 20, energy: 100, credits: 4, science: 0, culture: 100 };
  const center = state.tiles[city.tileId]!;
  const reserved = new Set([...state.strategicDeposits!.tileIds, ...state.coalDeposits!.tileIds, ...state.pastoralSites!.tileIds, ...state.cities.map(town => town.tileId)]);
  const eligible = state.tiles.filter(tile => tile.owner === 0 && tile.terrain === 'forest' && !isHillSite(tile) && !reserved.has(tile.id) && hexDistance(center, tile) <= 3).toSorted((a, b) => a.id - b.id);
  const first = eligible[0]; const other = eligible[1]; assert.ok(first && other);
  for (const tile of state.tiles) if (tile.owner === 0 && tile.terrain === 'forest' && tile.id !== first.id && tile.id !== other.id) tile.owner = 1;
  const grassland = state.tiles.filter(tile => tile.owner === null && tile.terrain === 'grassland' && !isHillSite(tile) && !reserved.has(tile.id) && hexDistance(center, tile) <= 3).toSorted((a, b) => hexDistance(center, a) - hexDistance(center, b) || a.id - b.id)[0]; assert.ok(grassland); grassland.owner = 0;
  return { state, city, actor, first, other, action: actionFor(city, first.id) };
}
function policy(state: WorldState, civId = 0, locks: Array<{ cityId: string; untilRound: number }> = []) {
  const actor = state.civilizations.find(actor => actor.id === civId)!;
  const weights = { ...profile.resources };
  if (actor.resources.materials < 12) weights.materials *= 2;
  if (actor.resources.energy < 4) weights.energy *= 2;
  if (actor.resources.credits < 12) weights.credits *= 2;
  return createCharcoalClearingPolicy(state, civId, weights, profile.priorities.construction, locks);
}
function install(state: WorldState, city: City, tileId: number, id = 'charcoal-clearing') {
  city.construction ??= { active: null, lastCompleted: null };
  const definition = IMPROVEMENTS.find(item => item.id === id)!;
  installImprovement(state, city, { kind: 'improvement', id: `fixture-${tileId}`, cityId: city.id, improvementId: id, tileId, ruleVersion: 1, startedRound: state.round, paid: { ...definition.cost }, workRequired: definition.requiredWork, workDone: definition.requiredWork }, []);
}
function charcoalQuote(state: WorldState, city: City, tileId: number) {
  return createLandworkPlanner(state, city.civId).quote(city.id, tileId).quotes.find(quote => quote.action.type === 'improve' && quote.action.improvementId === 'charcoal-clearing');
}

void test('funded owned charcoal adds useful marginal Energy when Artisan is unaffordable and industry would cost Food', () => {
  const { state, city, action } = fixture(); const before = structuredClone(state);
  assert.ok(isWorldState(state)); assert.equal(createBehaviorMemory(state, 0).policyVersion, FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION);
  assert.ok(availableActions(state, 0).some(option => JSON.stringify(option.action) === JSON.stringify(action)));
  const assessment = policy(state)(action); assert.ok(assessment); assert.equal(assessment.usefulEnergy, 1); assert.ok(assessment.weight > 0 && assessment.weight < 1);
  assert.equal(assessment.quote.protectedBudget.ordinary.materials, 10); assert.equal(assessment.quote.protectedBudget.ordinary.energy, assessment.quote.protectedHorizon * 2);
  const scored = assessCivilizationBehavior(state, 0, createBehaviorMemory(state, 0), [{ action, label: 'Charcoal clearing', reason: '' }], profile).candidates[0]!;
  assert.equal(scored.weight, assessment.weight); assert.equal(scored.urgent, false);
  assert.equal(city.focus, 'growth'); assert.deepEqual(state, before);
});

void test('passive sufficient Energy, affordable Artisan and genuinely superior industry each suppress new charcoal', () => {
  const passive = fixture(); passive.city.buildings.push('workshop'); assert.equal(policy(passive.state)(passive.action), null);
  const artisan = fixture(); artisan.actor.resources.credits = 8; assert.equal(policy(artisan.state)(artisan.action), null);
  const industry = fixture(); industry.city.focus = 'culture'; assert.equal(policy(industry.state)(industry.action), null);
  industry.city.focus = 'research'; assert.ok(policy(industry.state)(industry.action), 'Valuable Science specialization is not a free industry alternative');
  industry.city.focus = 'culture'; assert.ok(policy(industry.state, 0, [{ cityId: industry.city.id, untilRound: 6 }])(industry.action));
});

void test('existing Artisan and industry do not blanket-veto useful supplemental Energy', () => {
  const { state, city, actor, action } = fixture(); city.focus = 'industry'; city.buildings.push('workshop', 'guild-workshop');
  city.buildingOperations!['guild-workshop'] = { enabled: true, lastResult: null }; city.population = 10; actor.resources.materials = 100;
  const assessment = policy(state)(action); assert.ok(assessment); assert.equal(assessment.usefulEnergy, 1);
  assert.equal(projectOperationAllocation(state).cities.find(town => town.id === city.id)!.buildingOperations!['guild-workshop']!.lastResult!.status, 'operated');
});

void test('build guard leaves another eligible same-town uncommitted forest rather than counting foreign, remote or occupied trees', () => {
  for (const mutation of ['sole', 'occupied', 'reserved', 'foreign', 'binding', 'remote'] as const) {
    const { state, city, first, other, action } = fixture();
    for (const tile of state.tiles) if (tile.id !== first.id && tile.id !== other.id && tile.terrain === 'forest') tile.terrain = 'grassland';
    if (mutation === 'sole') other.terrain = 'grassland';
    if (mutation === 'occupied') install(state, city, other.id, 'lumber-mill');
    if (mutation === 'reserved') state.cities[1]!.construction = { active: { kind: 'improvement', id: 'reserved-forest', cityId: state.cities[1]!.id, improvementId: 'lumber-mill', tileId: other.id, ruleVersion: 1, startedRound: 0, paid: {}, workRequired: 6, workDone: 0 }, lastCompleted: null };
    if (mutation === 'foreign') other.owner = 1;
    if (mutation === 'binding') state.tileAcquisitions![String(other.id)] = { ruleVersion: 1, id: 'other-town', civId: 0, cityId: 'other-town', cityTileId: city.tileId, tileId: other.id, pathTileIds: [city.tileId, other.id], distance: 1, priorCivilizationPurchases: 0, paid: { credits: 1 }, acquiredRound: 0, eventId: 'other-town' };
    if (mutation === 'remote') { other.q += 30; other.r += 30; }
    assert.equal(policy(state)(action), null, mutation);
  }
});

void test('opening inputs, residents, households and productive Food cannot be borrowed or displaced', () => {
  for (const mutation of ['inputs', 'residents', 'households', 'food-site', 'occupied-target'] as const) {
    const { state, city, actor, first, other, action } = fixture();
    if (mutation === 'inputs') actor.resources.materials = 9.99;
    if (mutation === 'residents') city.population = 6;
    if (mutation === 'households') actor.resources.food = charcoalQuote(state, city, first.id)!.protectedBudget.ordinary.food - 0.01;
    if (mutation === 'food-site') { other.terrain = 'grassland'; other.elevation = 75; install(state, city, other.id, 'hill-commons'); const extra = state.tiles.find(tile => tile.owner === 0 && tile.id !== city.tileId && tile.id !== first.id && tile.id !== other.id)!; extra.terrain = 'forest'; extra.elevation = 40; }
    if (mutation === 'occupied-target') install(state, city, first.id, 'lumber-mill');
    assert.equal(policy(state)(action), null, mutation);
  }
});

void test('neutral charcoal is never quoted while existing Mine, Hillside, Fishery and district paths remain unchanged', () => {
  const { state, city, actor, first } = fixture(); actor.resources = { food: 1000, materials: 1000, energy: 1000, credits: 1000, science: 0, culture: 1000 };
  actor.technologies.push('masonry', 'water-management', 'writing'); city.focus = 'industry'; first.owner = null; first.elevation = 75;
  const quotes = createLandworkPlanner(state, 0).quote(city.id, first.id).quotes;
  assert.equal(quotes.some(quote => quote.action.type === 'improve' && quote.action.improvementId === 'charcoal-clearing'), false);
  assert.ok(quotes.some(quote => quote.action.type === 'improve' && quote.action.improvementId === 'mine'));
  assert.ok(quotes.some(quote => quote.action.type === 'build' && quote.action.project === 'campus'));
  const without = structuredClone(state); without.unlockedFeatures = without.unlockedFeatures.filter(id => id !== 'charcoal-clearing');
  assert.deepEqual(quotes, createLandworkPlanner(without, 0).quote(city.id, first.id).quotes);
  first.terrain = 'grassland';
  assert.ok(createLandworkPlanner(state, 0).quote(city.id, first.id).quotes.some(quote => quote.action.type === 'improve' && quote.action.improvementId === 'hill-commons'));
  const center = state.tiles.find(tile => tile.id === city.tileId)!;
  const coast = state.tiles.find(tile => tile.id !== center.id && tile.id !== first.id && hexDistance(tile, center) === 1 && hexDistance(tile, first) === 1); assert.ok(coast); coast.terrain = 'ocean'; coast.owner = null;
  assert.ok(createLandworkPlanner(state, 0).quote(city.id, first.id).quotes.some(quote => quote.action.type === 'improve' && quote.action.improvementId === 'shore-fishery'));
});

void test('installed resume has no setup, forest-preservation or paid-lane wait charge and reserves exactly two operations', () => {
  const { state, city, actor, first, other } = fixture(); install(state, city, first.id); city.improvements![String(first.id)]!.operation.enabled = false;
  install(state, city, other.id, 'lumber-mill'); city.improvements![String(other.id)]!.operation.enabled = false;
  actor.resources.materials = 2; actor.resources.credits = 0;
  city.construction!.active = { id: 'paid-farm', cityId: city.id, buildingId: 'farm', ruleVersion: 1, startedRound: 0, paid: { materials: 8 }, workRequired: 20, workDone: 0 };
  const action: Extract<GameAction, { type: 'set-improvement-operation' }> = { type: 'set-improvement-operation', cityId: city.id, tileId: first.id, improvementId: 'charcoal-clearing', enabled: true };
  const before = structuredClone(state); const assessment = policy(state)(action); assert.ok(assessment);
  assert.deepEqual(assessment.quote.setupCost, {}); assert.equal(assessment.quote.workBeats, 0); assert.equal(assessment.quote.waitBeats, 0); assert.equal(assessment.quote.firstOperationBeat, 1);
  assert.equal(assessment.quote.protectedBudget.ordinary.materials, 2); assert.equal(assessment.quote.protectedBudget.ordinary.credits, 0);
  assert.deepEqual(state, before);
  city.improvements![String(first.id)]!.operation.enabled = true;
  assert.equal(createLandworkPlanner(state, 0).charcoalOperation(city.id, first.id)?.protectedBudget.ordinary.materials, 2);
  actor.resources.materials = 1.99; assert.equal(policy(state)(action), null);
});

void test('resume-enable guard survives progression weights without changing pause or paid construction', () => {
  const { state, city, first } = fixture(); install(state, city, first.id); city.improvements![String(first.id)]!.operation.enabled = false; city.buildings.push('workshop');
  const action: Extract<GameAction, { type: 'set-improvement-operation' }> = { type: 'set-improvement-operation', cityId: city.id, tileId: first.id, improvementId: 'charcoal-clearing', enabled: true };
  const paid = structuredClone(city.construction);
  const candidate = assessCivilizationBehavior(state, 0, createBehaviorMemory(state, 0), [{ action, label: '', reason: '' }], profile).candidates[0]!;
  assert.equal(candidate.weight, 0); assert.deepEqual(city.construction, paid);
});

function studiesFixture() {
  const state = createWorld(1701, epoch, 'settlement-charcoal-clearing-1');
  for (const id of [TEACHER, LEARNER]) {
    const city = state.cities.find(town => town.civId === id)!; const actor = state.civilizations[id]!;
    city.population = 10; city.wellbeing = 50; city.infrastructure = 0; city.damage = 0; city.focus = 'growth'; city.buildings = ['academy', 'kiln'];
    city.buildingOperations = { academy: { enabled: true, lastResult: null }, kiln: { enabled: true, lastResult: null } };
    actor.era = 1; actor.technologies = ['agriculture', 'civic-institutions', 'animal-husbandry', 'kiln-firing', 'wheel', 'mining', 'masonry', ...(id === TEACHER ? ['engineering'] : [])];
    actor.resources = { food: 1000, materials: 1000, energy: 1000, credits: 1000, science: 0, culture: 1000 };
  }
  state.civilizations[LEARNER]!.researchTarget = 'engineering';
  tradeAction(state, TEACHER, { type: 'propose-trade', partner: LEARNER, recipeId: 'harvest-for-materials', sourceCityId: 'city-1', recipientCityId: 'city-4' });
  tradeAction(state, LEARNER, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true });
  while (state.routes[0]!.agreement!.deliveryCount === 0) knowledgeEconomy(state);
  const city = state.cities.find(town => town.civId === TEACHER)!; const actor = state.civilizations[TEACHER]!; city.population = 10; city.infrastructure = 0; city.wellbeing = 50;
  const sites = forests(state, city); return { state, city, actor, ...sites };
}

void test('accepted Studies institutions and tuition remain funded beside actual trade reserves', () => {
  const { state, city, actor, first } = studiesFixture(); const compact = acceptKnowledge(state);
  const quote = charcoalQuote(state, city, first.id); assert.ok(quote); assert.ok(quote.retainedOperations.includes(`${city.id}/building/academy`));
  assert.ok(quote.protectedBudget.ordinary.culture >= quote.protectedHorizon * 2 + (compact.terms.teacherContribution.culture ?? 0));
  actor.resources.culture = quote.protectedBudget.ordinary.culture - 0.01; assert.equal(charcoalQuote(state, city, first.id), undefined);
  actor.resources.culture = 1000; city.buildingOperations!.academy!.enabled = false; assert.equal(charcoalQuote(state, city, first.id), undefined);
});

void test('actual trade, accepted relief and due public reserves cannot be spent on charcoal or financed by later output', () => {
  const { state, city, actor, first } = studiesFixture(); const quote = charcoalQuote(state, city, first.id); assert.ok(quote);
  actor.resources.food = quote.protectedBudget.ordinary.food - 0.01; assert.equal(charcoalQuote(state, city, first.id), undefined);
  const noTrade = structuredClone(state); noTrade.routes[0]!.agreement!.enabled = false; assert.ok(charcoalQuote(noTrade, noTrade.cities.find(town => town.id === city.id)!, first.id));
  actor.resources.food = 1000; state.cities.find(town => town.civId === LEARNER)!.population = 20; state.civilizations[LEARNER]!.resources.food = 0;
  const proposal: Extract<GameAction, { type: 'propose-relief' }> = { type: 'propose-relief', routeId: state.routes[0]!.id, sourceCityId: city.id, recipientCityId: 'city-4' };
  assert.equal(reliefActionFailure(state, TEACHER, proposal), null); executeReliefAction(state, TEACHER, proposal, []);
  const acceptance: Extract<GameAction, { type: 'respond-relief' }> = { type: 'respond-relief', charterId: state.relief!.active[0]!.id, accept: true };
  assert.equal(reliefActionFailure(state, LEARNER, acceptance), null); executeReliefAction(state, LEARNER, acceptance, []);
  const relieved = charcoalQuote(state, city, first.id); assert.ok(relieved); assert.ok(relieved.protectedBudget.ordinary.food > quote.protectedBudget.ordinary.food);
  const recipe = PUBLIC_PROJECT_RECIPES[0]!;
  state.publicProjects = [{ id: 'charcoal-public', routeId: state.routes[0]!.id, agreementOfferId: state.routes[0]!.agreement!.offerId, proposer: TEACHER, recipient: LEARNER, terms: { ...structuredClone(recipe.terms), proposerContribution: { materials: 20 } }, proposedRound: state.round, status: 'committed', acceptedRound: state.round, dueRound: state.round + 7 }];
  actor.resources.materials = 29.99; assert.equal(charcoalQuote(state, city, first.id), undefined);
});

void test('other-town paid orders keep their inputs without their already-paid setup or future outputs funding charcoal', () => {
  const { state, city, actor, first } = fixture(); const site = state.tiles.find(tile => tile.owner === 0 && tile.id !== city.tileId && tile.id !== first.id && tile.terrain !== 'forest')!; assert.ok(site);
  const second: City = { ...structuredClone(city), id: 'zz-paid-town', tileId: site.id, buildings: [], buildingOperations: {}, population: 6, construction: { active: { id: 'already-paid-kiln', cityId: 'zz-paid-town', buildingId: 'kiln', ruleVersion: 1, startedRound: 0, paid: { materials: 10, credits: 8 }, workRequired: 6, workDone: 0 }, lastCompleted: null } };
  state.cities.push(second); const quote = charcoalQuote(state, city, first.id); assert.ok(quote);
  assert.equal(quote.protectedBudget.ordinary.materials, 10); assert.equal(quote.protectedBudget.ordinary.credits, 4); assert.equal(quote.protectedBudget.ordinary.energy, quote.protectedHorizon * 4);
  assert.equal(quote.protectedBudget.ordinary.food, householdFoodUpkeep(state, 13) * quote.protectedHorizon);
  actor.resources.energy = quote.protectedBudget.ordinary.energy - 0.01; assert.equal(charcoalQuote(state, city, first.id), undefined);
});

void test('current restart and frozen source repeat exact policy assessments without changing funded-v5 or deterministic draws', () => {
  const { state, action } = fixture(); const restored = JSON.parse(JSON.stringify(state)) as WorldState; assert.ok(isWorldState(restored));
  const before = JSON.stringify(state); const freeze = (value: unknown): void => { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } }; freeze(state);
  assert.deepEqual(policy(state)(action), policy(restored)(action));
  assert.deepEqual(chooseCivilizationBehavior(state, 0, createBehaviorMemory(state, 0), epoch), chooseCivilizationBehavior(restored, 0, createBehaviorMemory(restored, 0), epoch));
  assert.equal(JSON.stringify(state), before); assert.equal(createBehaviorMemory(state, 0).policyVersion, FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION);
});

void test('Border return households and retained operation reserves are protected without counting away residents as clearing staff', () => {
  const state = createWorld(1701, epoch, 'settlement-charcoal-clearing-1');
  for (const tile of state.tiles) { tile.terrain = 'grassland'; tile.elevation = 20; tile.owner = null; tile.resource = null; }
  const positions = [[2, 3], [8, 3], [14, 3], [3, 12], [13, 12]];
  for (const town of state.cities) {
    const [q, r] = positions[town.civId]!; const center = state.tiles.find(tile => tile.q === q && tile.r === r)!; town.tileId = center.id; center.resource = 'food';
    for (const tile of state.tiles) if (hexDistance(tile, center) <= 1) tile.owner = town.civId;
    town.population = 9; town.wellbeing = 50; town.infrastructure = 0; town.damage = 0; town.focus = 'growth';
    const actor = state.civilizations[town.civId]!; actor.era = 1; actor.resources = { food: 1000, materials: 1000, energy: 1000, credits: 1000, science: 0, culture: 1000 };
    syntheticTechnologies(state, actor.id, ['civic-institutions', 'mining']);
  }
  state.tiles.find(tile => tile.q === 4 && tile.r === 3)!.owner = 0; state.tiles.find(tile => tile.q === 6 && tile.r === 3)!.owner = 1;
  const target = state.tiles.find(tile => tile.q === 5 && tile.r === 3)!; target.elevation = 70;
  state.strategicDeposits = createStrategicDeposits(state); state.coalDeposits = createCoalDeposits(state); state.pastoralSites = createPastoralSites(state);
  const city = state.cities.find(town => town.civId === 0)!; city.buildings = ['kiln']; city.buildingOperations = { kiln: { enabled: true, lastResult: null } };
  const { first } = forests(state, city); assert.ok(isWorldState(state));
  const promised = structuredClone(state);
  borderEngineAction(state, 1, { type: 'acquire-tile', cityId: 'city-1', tileId: target.id }); const incident = dispatchBorder(state);
  const quote = charcoalQuote(state, state.cities.find(town => town.id === city.id)!, first.id); assert.ok(quote);
  assert.equal(quote.protectedHorizon, incident.returnByRound - state.round);
  assert.equal(quote.protectedBudget.ordinary.food, householdFoodUpkeep(state, 9) * quote.protectedHorizon);
  assert.equal(quote.protectedBudget.ordinary.materials, 10); assert.equal(quote.protectedBudget.ordinary.energy, quote.protectedHorizon * 2);
  state.cities.find(town => town.id === city.id)!.population = 6; assert.equal(charcoalQuote(state, state.cities.find(town => town.id === city.id)!, first.id), undefined);
  promised.cities.find(town => town.id === city.id)!.buildings.push('workshop');
  borderEngineAction(promised, 0, actionFor(promised.cities.find(town => town.id === city.id)!, first.id));
  for (let beat = 0; beat < 6 && !promised.cities.find(town => town.id === city.id)!.improvements?.[String(first.id)]; beat++) borderBeat(promised);
  assert.ok(promised.cities.find(town => town.id === city.id)!.improvements?.[String(first.id)]); assert.ok(isWorldState(promised));
  borderEngineAction(promised, 1, { type: 'acquire-tile', cityId: 'city-1', tileId: target.id }); const retained = dispatchBorder(promised);
  const operation = createLandworkPlanner(promised, 0).charcoalOperation(city.id, first.id); assert.ok(operation); assert.equal(operation.requiredByBorder, true);
  assert.equal(operation.targetOperationBeats, Math.max(2, retained.returnByRound - promised.round));
  assert.equal(operation.protectedBudget.ordinary.materials, operation.targetOperationBeats); assert.ok(operation.retainedOperations.includes(`${city.id}/site/${first.id}`));
  const assessment = policy(promised)(operation.action); assert.ok(assessment); assert.equal(assessment.usefulEnergy, 0);
  promised.civilizations[0]!.resources.materials = operation.targetOperationBeats - 0.01; assert.equal(createLandworkPlanner(promised, 0).charcoalOperation(city.id, first.id), null);
});

void test('refused owned charcoal cannot suppress a funded ordinary land purchase', () => {
  const eligible = fixture(); const cached = policy(eligible.state); assert.ok(cached(eligible.action)); assert.equal(cached({ ...eligible.action, improvementId: 'mine' }), null);
  const { state, city, actor, first, other, action } = fixture(); city.focus = 'industry';
  actor.resources = { food: 1000, materials: 1000, energy: 1000, credits: 1000, science: 0, culture: 1000 };
  for (const tile of state.tiles) if (tile.owner === 0 && tile.id !== city.tileId) { tile.elevation = 40; if (tile.id !== first.id && tile.terrain === 'forest') tile.terrain = 'grassland'; }
  other.owner = null; other.terrain = 'grassland'; other.elevation = 75;
  assert.equal(policy(state)(action), null);
  const purchase = availableActions(state, 0).find(option => option.action.type === 'acquire-tile' && option.action.cityId === city.id && option.action.tileId === other.id); assert.ok(purchase);
  const quote = createLandworkPlanner(state, 0).quote(city.id, other.id).quotes.find(quote => quote.action.type === 'improve' && quote.action.improvementId === 'mine'); assert.ok(quote);
  const oldFeatureSet = structuredClone(state); oldFeatureSet.unlockedFeatures = oldFeatureSet.unlockedFeatures.filter(id => id !== 'charcoal-clearing');
  const expected = assessCivilizationBehavior(oldFeatureSet, 0, createBehaviorMemory(oldFeatureSet, 0), [purchase], profile).candidates[0]!.weight; assert.ok(expected > 0);
  const actual = assessCivilizationBehavior(state, 0, createBehaviorMemory(state, 0), [purchase], profile).candidates[0]!.weight;
  assert.equal(actual, expected);
});

void test('hypothetical Border targets and peaceful alternatives exclude charcoal while ordinary uses retain their value', () => {
  const state = createWorld(1701, epoch, 'settlement-charcoal-clearing-1');
  for (const tile of state.tiles) { tile.terrain = 'grassland'; tile.elevation = 20; tile.owner = null; tile.resource = null; }
  const positions = [[2, 3], [8, 3], [14, 3], [3, 12], [13, 12]];
  for (const town of state.cities) {
    const [q, r] = positions[town.civId]!; const center = state.tiles.find(tile => tile.q === q && tile.r === r)!; town.tileId = center.id; center.resource = 'food';
    for (const tile of state.tiles) if (hexDistance(tile, center) <= 1) tile.owner = town.civId;
    town.population = 8; town.wellbeing = 50; town.infrastructure = 0; town.damage = 0; town.focus = 'industry';
    const actor = state.civilizations[town.civId]!; actor.era = 1; actor.resources = { food: 1000, materials: 1000, energy: 1000, credits: 1000, science: 0, culture: 1000 };
    syntheticTechnologies(state, actor.id, ['civic-institutions', 'mining']);
  }
  state.tiles.find(tile => tile.q === 4 && tile.r === 3)!.owner = 0; state.tiles.find(tile => tile.q === 6 && tile.r === 3)!.owner = 1;
  const target = state.tiles.find(tile => tile.q === 5 && tile.r === 3)!; target.terrain = 'forest'; target.elevation = 40;
  state.strategicDeposits = createStrategicDeposits(state); state.coalDeposits = createCoalDeposits(state); state.pastoralSites = createPastoralSites(state);
  assert.ok(isWorldState(state)); borderEngineAction(state, 1, { type: 'acquire-tile', cityId: 'city-1', tileId: target.id });
  const option: ActionOption = { action: { type: 'dispatch-border', sourceCityId: 'city-0', tileId: target.id, people: 2 }, label: 'Conditional Border candidate', reason: '' };
  const assess = (world: WorldState, choices: ActionOption[] = [option], seat = 0) => deriveBorderPlan(world, world.civilizations[seat]!, profile, choices);
  const before = structuredClone(state); const forest = assess(state);
  assert.equal(borderWeight(option, 999, forest), 0); assert.match(borderReason(option, forest)!, /use unavailable/); assert.doesNotMatch(borderReason(option, forest)!, /Charcoal/); assert.deepEqual(state, before);
  state.tiles.find(tile => tile.id === target.id)!.elevation = 75;
  const ordinary = borderWeight(option, 0, assess(state)); assert.ok(ordinary > 0); assert.match(borderReason(option, assess(state))!, /Mine/);
  const city = state.cities.find(town => town.civId === 0)!; const planner = createTerritoryPlanner(state);
  const neutral = planner.nearby(city).find(tile => tile.owner === null && planner.assess(0, city.id, tile.id).quote && !planner.assess(0, city.id, tile.id).blocker); assert.ok(neutral);
  neutral.terrain = 'forest'; neutral.elevation = 40;
  assert.equal(borderWeight(option, 0, assess(state)), ordinary); assert.match(borderReason(option, assess(state))!, /No funded useful neutral site/);
  neutral.terrain = 'grassland'; neutral.elevation = 75;
  const competing = borderWeight(option, 0, assess(state)); assert.ok(competing > 0 && competing < ordinary);
  const prefeature = structuredClone(state); prefeature.unlockedFeatures = prefeature.unlockedFeatures.filter(id => id !== 'charcoal-clearing');
  assert.equal(borderWeight(option, 0, assess(prefeature)), competing);
  const incident = dispatchBorder(state);
  const defend: ActionOption = { action: { type: 'respond-border', incidentId: incident.id, response: 'defend', sourceCityId: 'city-1', people: 2 }, label: 'Conditional defense', reason: '' };
  const yieldOption: ActionOption = { action: { type: 'respond-border', incidentId: incident.id, response: 'yield' }, label: 'Conditional yield', reason: '' };
  const liveTarget = state.tiles.find(tile => tile.id === target.id)!; liveTarget.elevation = 40;
  const defense = assess(state, [defend, yieldOption], 1); assert.equal(borderWeight(defend, 999, defense), 0); assert.ok(borderWeight(yieldOption, 0, defense) > 0);
  liveTarget.elevation = 75; const ordinaryDefense = assess(state, [defend, yieldOption], 1); assert.ok(borderWeight(defend, 0, ordinaryDefense) > 0);
  const noCharcoal = structuredClone(state); noCharcoal.unlockedFeatures = noCharcoal.unlockedFeatures.filter(id => id !== 'charcoal-clearing');
  const unchangedDefense = assess(noCharcoal, [defend, yieldOption], 1);
  assert.equal(borderWeight(defend, 0, ordinaryDefense), borderWeight(defend, 0, unchangedDefense)); assert.equal(borderWeight(yieldOption, 0, ordinaryDefense), borderWeight(yieldOption, 0, unchangedDefense));
});

void test('actual required construction selection cannot revive refused charcoal and still chooses paid ordinary work', () => {
  for (const refusal of ['sole-forest', 'passive-energy', 'opening-inputs'] as const) {
    const { state, city, actor, first, other } = fixture(); city.buildings.push('farm');
    for (const tile of state.tiles) if (tile.owner === 0 && tile.id !== city.tileId && tile.id !== first.id && tile.id !== other.id) tile.owner = 1;
    if (refusal === 'sole-forest') other.owner = 1;
    if (refusal === 'passive-energy') { city.buildings.push('workshop'); city.focus = 'industry'; }
    if (refusal === 'opening-inputs') actor.resources.materials = 9.99;
    assert.ok(isWorldState(state)); borderEngineAction(state, 0, { type: 'research', technology: 'writing' });
    const civic = availableActions(state, 0, borderTimestamp(state, 0)).find(option => option.action.type === 'choose-civic'); assert.ok(civic); borderEngineAction(state, 0, civic.action);
    const current = state.cities.find(town => town.id === city.id)!;
    const memory = { ...createBehaviorMemory(state, 0), focusLocks: [{ cityId: current.id, focus: current.focus, untilRound: state.round + 6 }] };
    const lane = decisionObligations(state, 0).construction.find(lane => lane.cityId === current.id)!;
    assert.equal(lane.status, 'required'); assert.deepEqual(lane.availableIds, ['improvement:charcoal-clearing']);
    const options = availableActions(state, 0, borderTimestamp(state, 0));
    const refused = assessCivilizationBehavior(state, 0, memory, options).candidates.filter(candidate => candidate.option.action.type === 'improve' && candidate.option.action.improvementId === 'charcoal-clearing');
    assert.ok(refused.length > 0); assert.ok(refused.every(candidate => candidate.weight === 0));
    const before = structuredClone(state); const decision = chooseCivilizationBehavior(state, 0, memory, borderTimestamp(state, 0));
    assert.ok(decision.action?.type !== 'improve' || decision.action.improvementId !== 'charcoal-clearing', refusal); assert.deepEqual(state, before);
    const protectedTiles = new Set([...state.strategicDeposits!.tileIds, ...state.coalDeposits!.tileIds, ...state.pastoralSites!.tileIds]);
    const work = state.tiles.find(tile => tile.owner === 1 && !protectedTiles.has(tile.id) && isHillSite(tile) && hexDistance(tile, state.tiles[current.tileId]!) === 1); assert.ok(work); work.owner = 0;
    const chosen = chooseCivilizationBehavior(state, 0, memory, borderTimestamp(state, 0)); assert.deepEqual(chosen.action, { type: 'improve', cityId: current.id, tileId: work.id, improvementId: 'mine' }); assert.equal(chosen.explanation.required, true);
    const opening = state.civilizations[0]!.resources.materials; borderEngineAction(state, 0, chosen.action!);
    assert.equal(state.civilizations[0]!.resources.materials, opening - 6); assert.equal(state.cities.find(town => town.id === current.id)!.construction!.active!.paid.materials, 6);
  }
});
