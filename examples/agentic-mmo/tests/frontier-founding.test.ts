import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProductiveFrontierAssessment, type FundedFrontierQuote } from '../core/behavior-frontier.ts';
import { exchangePromisedResources } from '../core/behavior-knowledge.ts';
import { BUILDINGS, ECONOMY_RULES, PUBLIC_PROJECT_RECIPES, TRADE_RECIPES } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { availableActions } from '../core/simulation/choices.ts';
import { householdFoodUpkeep } from '../core/simulation/food-security.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { installImprovement } from '../core/simulation/improvements.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import type { City, GameAction, WorldState } from '../core/types.ts';
import { dispatchBorder, syntheticBorderCorridor } from './fixtures/border-current.ts';
import { acceptKnowledge, syntheticKnowledgeCorridor, TEACHER } from './fixtures/knowledge-current.ts';

const epoch = '2026-10-24T00:00:00.000Z';
type Founding = Extract<GameAction, { type: 'settle' }>;
function fixture() {
  const state = createWorld(1701, epoch, 'settlement-charcoal-clearing-1');
  const actor = state.civilizations[0]!; const city = state.cities[0]!;
  actor.technologies = ['agriculture', 'mining', 'masonry', 'water-management'];
  actor.resources = { food: 1000, materials: 1000, energy: 1000, credits: 1000, science: 0, culture: 1000 };
  city.population = 9; city.focus = 'industry'; city.buildings = []; city.buildingOperations = {}; city.improvements = {}; city.construction = { active: null, lastCompleted: null };
  const action = availableActions(state, 0).find(option => option.action.type === 'settle' && option.action.sourceCityId === city.id)?.action;
  assert.ok(action?.type === 'settle');
  return { state, actor, city, action, tile: state.tiles.find(tile => tile.id === action.tileId)! };
}
function quote(state: WorldState, action: Founding): FundedFrontierQuote {
  const result = createProductiveFrontierAssessment(state, state.cities.find(city => city.id === action.sourceCityId)!.civId).founding(action);
  assert.ok(result.quote, result.reason ?? 'Expected a funded founding'); return result.quote;
}
function foundTown(state: WorldState, source: City, tileId: number): City {
  const town: City = { id: 'fixture-founded', name: 'Fixture frontier', civId: source.civId, tileId, ...ECONOMY_RULES.initialCity, population: 3, focus: source.focus, buildings: [], housing: { ruleVersion: 1, origin: 'founded', establishedRound: state.round, baseCapacity: 8 }, construction: { active: null, lastCompleted: null } };
  source.population -= 3; state.tiles.find(tile => tile.id === tileId)!.owner = source.civId; state.cities.push(town); return town;
}

void test('pure current-stock founding quote is conditional, cached, frozen and RNG-neutral', () => {
  const { state, action, city } = fixture(); const before = structuredClone(state);
  const planner = createProductiveFrontierAssessment(state, 0); const result = planner.founding(action); const funded = result.quote;
  assert.ok(funded, result.reason ?? ''); assert.equal(funded.kind, 'conditional-frontier'); assert.equal(funded.mode, 'founding');
  assert.equal(funded.admissionAllowanceBeats, 1); assert.equal(funded.firstOperationBeat, 4); assert.equal(funded.protectedHorizon, 5);
  assert.deepEqual(funded.foundingCost, { food: 10, materials: 12, credits: 8 }); assert.deepEqual(funded.setupCost, { materials: 8, credits: 4 });
  assert.equal(funded.protectedBudget.ordinary.materials, 20); assert.equal(funded.protectedBudget.ordinary.credits, 12);
  assert.equal(funded.sourcePopulationBefore, city.population); assert.equal(funded.sourcePopulationAfter, city.population - 3); assert.equal(funded.arrivingPopulation, 3); assert.equal(funded.arrivingWorkforce, 0);
  assert.strictEqual(planner.founding(action), result); assert.ok(Object.isFrozen(funded.protectedBudget.ordinary));
  assert.deepEqual(state, before); assert.deepEqual(createProductiveFrontierAssessment(structuredClone(state), 0).founding(action), result);
});

void test('household envelope includes finite automatic growth at every town and never credits future output', () => {
  const { state, action, city, actor } = fixture(); city.population = 6; const funded = quote(state, action);
  const home = funded.households.find(item => item.cityId === city.id)!; const arrivals = funded.households.find(item => item.prospective)!;
  assert.equal(home.openingPopulation, 3); assert.equal(home.growthCount, 5); assert.equal(arrivals.openingPopulation, 3); assert.equal(arrivals.growthCount, 5);
  assert.equal(home.householdFood, [3, 4, 5, 6, 7].reduce((sum, population) => sum + householdFoodUpkeep(state, population), 0));
  assert.equal(home.growthFood, 6 + 7 + 7 + 7 + 7);
  assert.equal(funded.protectedBudget.ordinary.food, 10 + 2 * (home.householdFood + home.growthFood));
  actor.resources.food = funded.protectedBudget.ordinary.food - 0.01;
  assert.match(createProductiveFrontierAssessment(state, 0).founding(action).reason!, /opening-budget/);
  actor.resources.food = funded.protectedBudget.ordinary.food; assert.ok(quote(state, action));
  actor.resources.materials = 19; assert.equal(createProductiveFrontierAssessment(state, 0).founding(action).quote, null);
});

void test('current allocation rejects six-to-three paid-institution loss despite affordable food and future growth', () => {
  const { state, city, action } = fixture(); city.population = 6; city.buildings = ['irrigation']; city.buildingOperations = { irrigation: { enabled: true, lastResult: null } };
  assert.equal(projectOperationAllocation(state).cities[0]!.buildingOperations!.irrigation!.lastResult!.status, 'operated');
  assert.match(createProductiveFrontierAssessment(state, 0).founding(action).reason!, /protected-operation/);
  city.population = 9; const funded = quote(state, action); assert.deepEqual(funded.retainedOperations, [`${city.id}/building/irrigation`]);
  assert.equal(funded.protectedBudget.ordinary.materials, 20 + funded.protectedHorizon);
});

void test('accepted Studies institution and full deadline stay protected with one promise reserve', () => {
  const state = syntheticKnowledgeCorridor(); const compact = acceptKnowledge(state); const actor = state.civilizations[TEACHER]!;
  actor.resources = { food: 2000, materials: 2000, energy: 2000, credits: 2000, science: 0, culture: 2000 };
  const city = state.cities.find(item => item.civId === TEACHER)!;
  const action = availableActions(state, TEACHER).find(option => option.action.type === 'settle' && option.action.sourceCityId === city.id)!.action as Founding;
  assert.match(createProductiveFrontierAssessment(state, TEACHER).founding(action).reason!, /protected-operation|institution/);
  city.population = 9; const funded = quote(state, action); const promises = exchangePromisedResources(state, TEACHER, funded.protectedHorizon);
  assert.ok(funded.protectedHorizon >= compact.deadlineRound - state.round);
  assert.equal(funded.protectedBudget.ordinary.culture, promises.ordinary.culture + 2 * funded.protectedHorizon);
  assert.equal(funded.protectedBudget.ordinary.credits, 12 + promises.ordinary.credits + funded.protectedHorizon);
});

void test('already-paid pending recipes and housing reserve once without repaying or using new workers', () => {
  const { state, city, action } = fixture(); city.population = 9;
  city.construction!.active = { id: 'paid-irrigation', cityId: city.id, buildingId: 'irrigation', ruleVersion: 1, startedRound: state.round, paid: { materials: 12, credits: 8 }, workRequired: 4, workDone: 0 };
  const pending = quote(state, action); assert.equal(pending.protectedBudget.ordinary.materials, 20 + pending.protectedHorizon); assert.equal(pending.protectedBudget.ordinary.credits, 12);
  city.population = 6; assert.match(createProductiveFrontierAssessment(state, 0).founding(action).reason!, /protected-operation/);
  city.population = 9; city.housing!.baseCapacity = 6;
  city.construction!.active = { id: 'paid-granary', cityId: city.id, buildingId: 'granary', ruleVersion: 1, startedRound: state.round, paid: { materials: 14, credits: 6 }, workRequired: 4, workDone: 0 };
  const housing = quote(state, action); const home = housing.households.find(item => item.cityId === city.id)!;
  assert.equal(home.capacity, 10); assert.equal(home.growthCount, 4); assert.equal(housing.protectedBudget.ordinary.materials, 20);
});

void test('active border residents enter households once but never staffing and exact forecast cannot disappear', () => {
  const state = syntheticBorderCorridor(); const city = state.cities.find(item => item.civId === 0)!;
  city.population = 11; city.buildings = ['irrigation']; city.buildingOperations = { irrigation: { enabled: true, lastResult: null } };
  const incident = dispatchBorder(state, 2); const homeCity = state.cities.find(item => item.civId === 0)!; const actor = state.civilizations[0]!; actor.resources.food = 3000;
  const action = availableActions(state, 0).find(option => option.action.type === 'settle' && option.action.sourceCityId === city.id)!.action as Founding;
  const funded = quote(state, action); const home = funded.households.find(item => item.cityId === city.id)!;
  assert.equal(home.openingPopulation, homeCity.population - 3 + 2); assert.equal(home.reservedReturning, 2);
  assert.ok(funded.protectedHorizon >= incident.returnByRound - state.round);
  assert.equal(funded.protectedBudget.ordinary.materials, 20 + funded.protectedHorizon);
  homeCity.buildingOperations!.irrigation!.enabled = false;
  assert.match(createProductiveFrontierAssessment(state, 0).founding(action).reason!, /border-operation/);
});

void test('commitment horizon extends across public, relief and route dues without double financing', () => {
  const { state, actor, city, action } = fixture(); const recipe = TRADE_RECIPES.find(item => item.id === 'harvest-for-materials')!;
  state.routes = [{ id: 'reserved-route', from: city.id, to: state.cities[1]!.id, owner: 0, partner: 1, active: true, damage: 0, volume: 0, agreement: { offerId: 'accepted', terms: structuredClone(recipe.terms), enabled: true, acceptedRound: state.round, nextDeliveryRound: state.round + 9, lastAttemptRound: null, lastDeliveryRound: null, deliveryCount: 0, blockedBy: null, blockedReason: null, closedRound: null } }];
  const publicRecipe = PUBLIC_PROJECT_RECIPES[0]!;
  state.publicProjects = [{ id: 'public', routeId: 'reserved-route', agreementOfferId: 'accepted', proposer: 0, recipient: 1, terms: structuredClone(publicRecipe.terms), proposedRound: state.round, status: 'committed', acceptedRound: state.round, dueRound: state.round + 11 }];
  const funded = quote(state, action); const promised = exchangePromisedResources(state, 0, 11);
  assert.equal(funded.protectedHorizon, 11); assert.equal(funded.protectedBudget.ordinary.energy, promised.ordinary.energy);
  assert.equal(funded.protectedBudget.ordinary.materials, 20 + promised.ordinary.materials);
  actor.resources = { ...funded.protectedBudget.ordinary }; assert.ok(quote(state, action));
  state.routes[0]!.agreement!.terms.cadenceRounds = 0; assert.match(createProductiveFrontierAssessment(state, 0).founding(action).reason!, /unsafe/);
});

void test('unsafe horizons and unbounded pending effects refuse explicitly', () => {
  const { state, city, actor, action } = fixture();
  actor.government = { ruleVersion: 1, lastSpentReformCompletionEventId: null, active: null, pending: { targetGovernmentId: 'chiefdom', targetAssignments: [], acceptedRound: 0, completionRound: 1, paidCredits: 0, spentCompletionEventId: null } };
  assert.match(createProductiveFrontierAssessment(state, 0).founding(action).reason!, /government-transition/); actor.government.pending = null;
  city.construction!.active = { id: 'unsupported', cityId: city.id, buildingId: 'not-a-building', ruleVersion: 1, startedRound: 0, paid: {}, workRequired: 4, workDone: 0 };
  assert.match(createProductiveFrontierAssessment(state, 0).founding(action).reason!, /unsupported-order/);
  city.construction!.active.buildingId = 'coal-plant'; assert.match(createProductiveFrontierAssessment(state, 0).founding(action).reason!, /Power|unsupported-order/);
  city.construction!.active = null; state.round = Number.MAX_SAFE_INTEGER; assert.match(createProductiveFrontierAssessment(state, 0).founding(action).reason!, /unsafe/);
});

void test('fresh founded Farm preference eligibility is local, optional and uses only its new current budget', () => {
  const { state, city, actor, action } = fixture(); const town = foundTown(state, city, action.tileId); const planner = createProductiveFrontierAssessment(state, 0);
  const result = planner.farm(town.id); assert.ok(result.quote, result.reason ?? '');
  assert.equal(result.quote.mode, 'farm'); assert.deepEqual(result.quote.foundingCost, {}); assert.equal(result.quote.admissionAllowanceBeats, 0); assert.equal(result.quote.firstOperationBeat, 3);
  assert.equal(result.quote.protectedBudget.ordinary.materials, 8); assert.equal(result.quote.protectedBudget.ordinary.credits, 4);
  actor.resources.food = 0; assert.equal(createProductiveFrontierAssessment(state, 0).farm(town.id).quote, null);
  assert.ok(availableActions(state, 0).some(option => option.action.type === 'build' && option.action.project === 'farm' && option.action.cityId === town.id));
  actor.resources.food = 1000; state.round = 8; assert.ok(createProductiveFrontierAssessment(state, 0).farm(town.id).quote);
  state.round = 9; assert.match(createProductiveFrontierAssessment(state, 0).farm(town.id).reason!, /fresh-town/);
});

void test('fresh Farm refuses a busy, completed, coastal, foreign or too-slow town without touching it', () => {
  const { state, city, action } = fixture(); const town = foundTown(state, city, action.tileId);
  town.construction!.active = { id: 'busy', cityId: town.id, buildingId: 'workshop', ruleVersion: 1, startedRound: 0, paid: {}, workRequired: 4, workDone: 0 };
  assert.equal(createProductiveFrontierAssessment(state, 0).farm(town.id).quote, null); town.construction!.active = null;
  town.buildings = ['workshop']; assert.equal(createProductiveFrontierAssessment(state, 0).farm(town.id).quote, null); town.buildings = [];
  town.coastalFounding = { ruleVersion: 1, sourceCityId: city.id, sourceTileId: city.tileId, destinationTileId: town.tileId, pathTileIds: [], population: 3, paid: {}, foundedRound: 0, eventId: 'fixture' };
  assert.equal(createProductiveFrontierAssessment(state, 0).farm(town.id).quote, null); delete town.coastalFounding;
  assert.equal(createProductiveFrontierAssessment(state, 1).farm(town.id).quote, null);
  town.damage = 99; assert.match(createProductiveFrontierAssessment(state, 0).farm(town.id).reason!, /first-output/);
});

void test('geography stays bounded opportunity only and excludes existing coverage, occupied land and existing deals', () => {
  const { state, city, action, tile } = fixture(); const funded = quote(state, action);
  assert.ok(funded.landOpportunity >= 0 && funded.landOpportunity <= 1); assert.ok(funded.contactOpportunity >= 0 && funded.contactOpportunity <= 1);
  assert.equal(funded.locationMultiplier, 1 + 0.25 * funded.landOpportunity + 0.25 * funded.contactOpportunity);
  for (const site of state.tiles) if (hexDistance(tile, site) <= 3) site.owner = 0;
  tile.owner = null; assert.equal(quote(state, action).landOpportunity, 0);
  tile.owner = 1; assert.match(createProductiveFrontierAssessment(state, 0).founding(action).reason!, /founding-site/);
  tile.owner = null; state.cities[1]!.tileId = tile.id; assert.equal(createProductiveFrontierAssessment(state, 0).founding(action).quote, null);
  assert.equal(city.population, 9);
});

void test('reordered immutable inputs preserve stable quote facts and a changed revision refuses stale cache reuse', () => {
  const { state, action } = fixture(); const planner = createProductiveFrontierAssessment(state, 0); const expected = planner.founding(action);
  const reordered = structuredClone(state); reordered.cities.reverse(); reordered.tiles.reverse(); reordered.civilizations.reverse(); reordered.routes.reverse();
  assert.deepEqual(createProductiveFrontierAssessment(reordered, 0).founding(action), expected);
  state.revision++; assert.match(planner.founding(action).reason!, /stale/);
  const noCultivation = structuredClone(state); noCultivation.civilizations.find(actor => actor.id === 0)!.technologies = [];
  assert.match(createProductiveFrontierAssessment(noCultivation, 0).founding(action).reason!, /Farm/);
  assert.equal(BUILDINGS.find(building => building.id === 'farm')!.production.food, 4);
});

void test('contact cadence is a path opportunity, never a deal, incoming reserve or forced contact', () => {
  const { state, actor, city } = fixture();
  for (const tile of state.tiles) { tile.owner = null; tile.terrain = 'grassland'; }
  const at = (q: number, r: number) => state.tiles.find(tile => tile.q === q && tile.r === r)!;
  const positions = [[1, 2], [16, 2], [16, 4], [16, 6], [16, 8]];
  for (const town of state.cities) { const position = positions[town.civId]!; town.tileId = at(position[0]!, position[1]!).id; at(position[0]!, position[1]!).owner = town.civId; }
  at(2, 2).owner = 0; const action: Founding = { type: 'settle', sourceCityId: city.id, tileId: at(4, 2).id };
  const opening = structuredClone(actor.resources); const funded = quote(state, action); assert.ok(funded.contactOpportunity > 0);
  assert.deepEqual(actor.resources, opening); assert.equal((state.tradeOffers ?? []).length, 0); assert.equal(state.routes.length, 0);
  state.border!.dealCooldownUntil = Object.fromEntries(state.civilizations.filter(civ => civ.id !== 0).map(civ => [`0:${civ.id}`, state.round + 1]));
  assert.equal(quote(state, action).contactOpportunity, 0); state.border!.dealCooldownUntil = {};
  const recipe = TRADE_RECIPES.find(item => item.id === 'harvest-for-materials')!;
  state.tradeOffers = state.cities.filter(town => town.civId !== 0).map(town => ({ id: `pending-${town.id}`, proposer: 0, recipient: town.civId, from: city.id, to: town.id, createdRound: state.round, expiresRound: state.round + 4, status: 'pending', terms: structuredClone(recipe.terms), routeId: null }));
  assert.equal(quote(state, action).contactOpportunity, 0); state.tradeOffers = [];
  for (const tile of state.tiles) if (tile.q === 3) tile.terrain = 'ocean';
  assert.equal(quote(state, action).contactOpportunity, 0);
});

void test('known paid Rail and Wonder orders are untouched and no refund or output finances the Farm', () => {
  const { state, city, actor, action } = fixture();
  const center = state.tiles.find(tile => tile.id === city.tileId)!; const adjacent = state.tiles.find(tile => tile.owner === 0 && tile.terrain !== 'mountain' && tile.terrain !== 'ocean' && hexDistance(center, tile) === 1)!;
  assert.ok(adjacent);
  const edgeId = `${Math.min(center.id, adjacent.id)}:${Math.max(center.id, adjacent.id)}`;
  city.construction!.active = { kind: 'rail', ruleVersion: 1, id: 'paid-rail', cityId: city.id, edgeId, tileId: center.id, toTileId: adjacent.id, startedRound: state.round, paid: { materials: 4, credits: 2 }, strategicPaid: { iron: 1, coal: 1 }, workRequired: 4, workDone: 0 };
  const before = structuredClone(city.construction); assert.equal(quote(state, action).protectedBudget.ordinary.materials, 20); assert.deepEqual(city.construction, before);
  city.construction!.active = { kind: 'wonder', ruleVersion: 1, id: 'paid-wonder', cityId: city.id, wonderId: 'great-library', tileId: adjacent.id, startedRound: state.round, paid: { materials: 80 }, workRequired: 10, workDone: 0 };
  const known = createProductiveFrontierAssessment(state, 0).founding(action);
  assert.ok(known.quote, known.reason ?? ''); actor.resources.materials = 19; assert.equal(createProductiveFrontierAssessment(state, 0).founding(action).quote, null);
});

void test('unmodelled adverse completion is refused instead of financing future output', () => {
  const { state, city, action } = fixture(); const definition = BUILDINGS.find(building => building.id === 'workshop')!;
  city.construction!.active = { id: 'adverse', cityId: city.id, buildingId: definition.id, ruleVersion: 1, startedRound: 0, paid: { materials: 12, credits: 8 }, workRequired: 4, workDone: 0 };
  const effects = definition.effects; definition.effects = [...effects, { kind: 'resource', resource: 'food', amount: -1 }];
  try { assert.match(createProductiveFrontierAssessment(state, 0).founding(action).reason!, /unsupported-order-effects/); } finally { definition.effects = effects; }
});

void test('Charcoal clearing keeps its exact paid material and current resident protection cumulatively', () => {
  const { state, city, action } = fixture();
  const center = state.tiles.find(tile => tile.id === city.tileId)!;
  const site = state.tiles.find(tile => tile.owner === 0 && tile.id !== city.tileId && hexDistance(center, tile) <= 3 && !state.cities.some(town => town.tileId === tile.id))!;
  assert.ok(site); site.terrain = 'forest';
  const order = { kind: 'improvement' as const, id: 'paid-charcoal', cityId: city.id, improvementId: 'charcoal-clearing', tileId: site.id, ruleVersion: 1 as const, startedRound: state.round, paid: { materials: 8, credits: 4 }, workRequired: 4, workDone: 0 };
  city.construction!.active = order; const pending = quote(state, action);
  assert.equal(pending.protectedBudget.ordinary.materials, 20 + pending.protectedHorizon); assert.equal(pending.protectedBudget.ordinary.energy, 0);
  assert.ok(pending.retainedOperations.includes(`${city.id}/site/${site.id}`));
  city.construction!.active = null; installImprovement(state, city, order, []); const installed = quote(state, action);
  assert.equal(installed.protectedBudget.ordinary.materials, 20 + installed.protectedHorizon); assert.equal(site.terrain, 'forest');
  city.population = 6; assert.match(createProductiveFrontierAssessment(state, 0).founding(action).reason!, /protected-operation/);
});

void test('accepted relief extends its exact due horizon and promised Food is charged once', () => {
  const { state, city, action } = fixture(); const other = state.cities[1]!;
  const before = quote(state, action);
  state.relief!.active = [{ id: 'accepted-relief', sequence: 1, proposedRound: state.round, status: 'accepted', acceptedRound: state.round, dueRound: state.round + 12, terms: { ruleVersion: 1, routeId: 'fixture-route', agreementOfferId: 'fixture-acceptance', donorId: 0, recipientId: 1, sourceCityId: city.id, recipientCityId: other.id, sourceTileId: city.tileId, recipientTileId: other.tileId, path: { mode: 'land', ruleVersion: 1, tileIds: [city.tileId, other.tileId], edges: 1 }, damageDisableAt: 50, food: 17, energy: 1, travelRounds: 12, proposal: { donorPopulation: city.population, recipientPopulation: other.population, donorFood: 1000, donorEnergy: 1000, recipientFood: 0, promisedFood: 0, promisedEnergy: 0, horizonRounds: 12 } } }];
  const funded = quote(state, action);
  assert.equal(funded.protectedHorizon, 12); assert.ok(funded.protectedHorizon > before.protectedHorizon);
  assert.equal(funded.protectedBudget.ordinary.food, 10 + 17 + funded.households.reduce((sum, household) => sum + household.householdFood + household.growthFood, 0));
  assert.equal(funded.protectedBudget.ordinary.energy, 1);
});
