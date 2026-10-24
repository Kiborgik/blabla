import assert from 'node:assert/strict';
import test from 'node:test';
import { woodlandContinuousCapacity, woodlandOperationAllowed, woodlandOperationCapacity, woodlandOperationDesired } from '../core/behavior-woodlands.ts';
import { BEHAVIOR_PROFILES } from '../core/behavior-profiles.ts';
import { deriveProgressionPlan, progressionWeight } from '../core/behavior-progression.ts';
import { assessCivilizationBehavior, chooseCivilizationBehavior, createBehaviorMemory } from '../core/behaviors.ts';
import { IMPROVEMENTS } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { borderPromisedResources } from '../core/simulation/border-incidents.ts';
import { createLandworkPlanner } from '../core/behavior-landwork.ts';
import type { ActionOption, GameAction, WorldState } from '../core/types.ts';
import type { BorderIncident } from '../core/border-types.ts';
import { syntheticTechnologies } from './fixtures/coastal-prefix.ts';
import { improvementSiteBlock } from '../core/simulation/improvements.ts';
import { improvementEligibility } from '../core/simulation/capabilities.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { acceptKnowledge, knowledgeEconomy, tradeAction, TEACHER, LEARNER } from './fixtures/knowledge-current.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const profile = BEHAVIOR_PROFILES[0]!;
const town = (state: WorldState) => state.cities.find(city => city.id === 'city-0')!;
const stand = (state: WorldState, tileId = 56) => state.woodlands!.stands[String(tileId)]!;
const site = (state: WorldState, tileId = 56) => town(state).improvements![String(tileId)]!;
const action = (enabled: boolean, improvementId = 'lumber-mill', tileId = 56): Extract<GameAction, { type: 'set-improvement-operation' }> => ({ type: 'set-improvement-operation', cityId: 'city-0', tileId, improvementId, enabled });
const option = (enabled: boolean): ActionOption => ({ action: action(enabled), label: enabled ? 'Resume exact Lumber mill' : 'Rest exact Lumber mill', reason: '' });

function opening(improvementId: 'lumber-mill' | 'charcoal-clearing' = 'lumber-mill'): WorldState {
  const state = createWorld(1701, epoch, 'settlement-renewing-worked-woodlands-1');
  syntheticTechnologies(state, 0, ['kiln-firing', 'machinery']);
  state.civilizations[0]!.era = 1;
  const city = town(state); city.population = 8; city.wellbeing = 50; city.infrastructure = 0; city.damage = 0; city.focus = 'growth';
  city.buildings = []; city.buildingOperations = {}; city.improvements = {}; city.construction = { active: null, lastCompleted: null };
  state.civilizations[0]!.resources = { food: 1000, materials: 20, energy: 1000, credits: 1000, science: 0, culture: 1000 };
  const definition = IMPROVEMENTS.find(item => item.id === improvementId)!;
  city.improvements['56'] = { improvementId, tileId: 56, completion: { kind: 'improvement', orderId: 'synthetic-paid-forest-56', cityId: city.id, improvementId, tileId: 56, startedRound: 0, completedRound: 0, paid: { ...definition.cost }, workRequired: definition.requiredWork, eventId: 'synthetic-completion-56' }, operation: { enabled: true, lastResult: null } };
  return state;
}

function borderPromise(state: WorldState, improvementId = 'lumber-mill', tileId = 56): BorderIncident {
  const incident = {
    id: 'synthetic-retained-border',
    initiator: { returned: null, departure: { actorId: 0, sourceCityId: 'city-0', returnByRound: state.round + 8, operationForecast: [{ kind: 'improvement', cityId: 'city-0', id: improvementId, tileId, round: state.round + 1, horizon: 8, inputs: improvementId === 'charcoal-clearing' ? { materials: 1 } : {}, strategicInputs: {}, residents: 1 }] } },
    defender: null,
  } as unknown as BorderIncident;
  state.border!.active = [incident];
  return incident;
}

void test('continuous woodland promises use only exact opening lots for eight versus seven lots and a nine-beat horizon', context => {
  const state = opening(); const before = structuredClone(state);
  assert.equal(woodlandOperationCapacity(state, 'lumber-mill', 56, 8), 8);
  assert.equal(woodlandContinuousCapacity(state, 'lumber-mill', 56, 8), true);
  assert.equal(woodlandOperationCapacity(state, 'lumber-mill', 56, 9), 8);
  assert.equal(woodlandContinuousCapacity(state, 'lumber-mill', 56, 9), false);
  assert.deepEqual(state, before);
  stand(state).stock = 7;
  assert.equal(woodlandOperationCapacity(state, 'lumber-mill', 56, 8), 7);
  assert.equal(woodlandContinuousCapacity(state, 'lumber-mill', 56, 8), false);
  assert.equal(woodlandContinuousCapacity(state, 'lumber-mill', 58, 8), true);
  stand(state).stock = 0;
  assert.equal(woodlandOperationCapacity(state, 'lumber-mill', 56, 8), 0);
  assert.equal(woodlandContinuousCapacity(state, 'lumber-mill', 56, 1), false);
  assert.equal(stand(state, 58).stock, 8);
  delete town(state).improvements!['56'];
  assert.equal(woodlandContinuousCapacity(state, 'lumber-mill', 56, 2), false);
  context.diagnostic('Synthetic opening stocks isolate pure conservative forecasts; no future idle/construction recovery or regional pooling finances these quotes.');
});

void test('unknown definitions, malformed exact forest state and unsafe horizons refuse without changing feature-off ordinary behavior', () => {
  for (const mutation of [
    (state: WorldState) => { delete state.woodlands; },
    (state: WorldState) => { state.woodlands!.profileId = 'unknown' as never; },
    (state: WorldState) => { state.woodlands!.ruleVersion = 2 as never; },
    (state: WorldState) => { delete state.woodlands!.stands['56']; },
    (state: WorldState) => { state.woodlands!.stands = null as never; },
    (state: WorldState) => { state.woodlands!.stands['56'] = null as never; },
    (state: WorldState) => { state.tiles.find(tile => tile.id === 56)!.terrain = 'grassland'; },
    ...[-1, 0.5, 8.01, 9, Number.NaN, Number.POSITIVE_INFINITY].map(stock => (state: WorldState) => { stand(state).stock = stock; }),
    (state: WorldState) => { stand(state).lastHarvestRound = state.round + 1; },
  ]) {
    const state = opening(); mutation(state); const before = structuredClone(state);
    assert.equal(woodlandOperationCapacity(state, 'lumber-mill', 56, 1), 0);
    assert.equal(woodlandContinuousCapacity(state, 'lumber-mill', 56, 1), false);
    assert.deepEqual(state, before);
  }
  const state = opening();
  for (const horizon of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) assert.equal(woodlandContinuousCapacity(state, 'lumber-mill', 56, horizon), false);
  assert.equal(woodlandContinuousCapacity(state, 'unknown-improvement', 56, 1), false);
  assert.equal(woodlandContinuousCapacity(state, 'lumber-mill', -1, 1), false);
  assert.equal(woodlandContinuousCapacity(state, 'mine', 56, 9), true);
  const exhaustedRounds = structuredClone(state); exhaustedRounds.round = Number.MAX_SAFE_INTEGER;
  assert.equal(woodlandContinuousCapacity(exhaustedRounds, 'lumber-mill', 56, 1), false);
  state.unlockedFeatures = state.unlockedFeatures.filter(id => id !== 'renewing-worked-woodlands'); delete state.woodlands;
  assert.equal(woodlandContinuousCapacity(state, 'lumber-mill', 56, 9), true);
  assert.equal(woodlandOperationCapacity(state, 'lumber-mill', 56, 9), 9);
  assert.equal(woodlandOperationAllowed(state, 0, action(true), false), true);
});

void test('operation economics distinguish useful harvest from rest and exhausted enabled sites do not toggle churn', () => {
  const state = opening(); stand(state).stock = 1; site(state).operation.enabled = false;
  assert.equal(woodlandOperationDesired(state, 0, 'city-0', 56, true), true);
  assert.equal(woodlandOperationDesired(state, 0, 'city-0', 56, false), false);
  assert.equal(woodlandOperationAllowed(state, 0, action(true), true), true);
  assert.equal(woodlandOperationAllowed(state, 0, action(true), false), false);
  site(state).operation.enabled = true;
  assert.equal(woodlandOperationAllowed(state, 0, action(false), false), true);
  stand(state).stock = 0;
  for (const desired of [false, true]) {
    assert.equal(woodlandOperationDesired(state, 0, 'city-0', 56, desired), true);
    assert.equal(woodlandOperationAllowed(state, 0, action(false), desired), false);
    site(state).operation.enabled = false;
    assert.equal(woodlandOperationDesired(state, 0, 'city-0', 56, desired), false);
    assert.equal(woodlandOperationAllowed(state, 0, action(true), desired), false);
    site(state).operation.enabled = true;
  }
  stand(state).stock = 1; site(state).completion.orderId = '';
  assert.equal(woodlandOperationAllowed(state, 0, action(true), true), false);
});

void test('exact active border obligations prevent voluntary rest without granting stock or rewriting paid orders', context => {
  for (const id of ['lumber-mill', 'charcoal-clearing'] as const) {
    const state = opening(id); const incident = borderPromise(state, id);
    town(state).construction!.active = { id: 'retained-paid-farm', cityId: 'city-0', buildingId: 'farm', ruleVersion: 1, startedRound: 0, paid: { materials: 8 }, workRequired: 20, workDone: 1 };
    const before = structuredClone(state);
    assert.equal(woodlandOperationDesired(state, 0, 'city-0', 56, false), true);
    assert.equal(woodlandOperationAllowed(state, 0, action(false, id), false), false);
    assert.deepEqual(state, before);
    incident.initiator.departure.operationForecast[0]!.tileId = 58;
    assert.equal(woodlandOperationDesired(state, 0, 'city-0', 56, false), false);
    incident.initiator.departure.operationForecast[0]!.tileId = 56;
    incident.initiator.departure.actorId = 1;
    assert.equal(woodlandOperationDesired(state, 0, 'city-0', 56, false), false);
    incident.initiator.departure.actorId = 0;
    incident.initiator.returned = {} as never;
    assert.equal(woodlandOperationDesired(state, 0, 'city-0', 56, false), false);
  }
  context.diagnostic('Synthetic retained-border identity fixture tests exact guard matching; no real dispatch, consent, or autonomous behavior is claimed by this fixture.');
});

void test('final progression and policy scoring choose useful Lumber harvest versus abundant-material rest without reviving refused resumes', context => {
  const useful = opening(); site(useful).operation.enabled = false; stand(useful).stock = 1;
  const resting = structuredClone(useful); resting.civilizations[0]!.resources.materials = 1000;
  const score = (state: WorldState, choice: ActionOption) => assessCivilizationBehavior(state, 0, createBehaviorMemory(state, 0), [choice], profile).candidates[0]!;
  assert.ok(score(useful, option(true)).weight > 0);
  assert.equal(score(resting, option(true)).weight, 0);
  site(resting).operation.enabled = true;
  assert.ok(score(resting, option(false)).weight > 0);
  const plan = deriveProgressionPlan(resting, resting.civilizations[0]!, profile, [option(true)]);
  assert.equal(plan.desiredImprovements.has('city-0/56'), false, 'Abundant partial-stock Lumber must release its planned worker while resting');
  (plan.desiredImprovements as Set<string>).add('city-0/56');
  assert.equal(progressionWeight(option(true), 0, resting, resting.civilizations[0]!, profile, plan), 70);
  site(resting).operation.enabled = false;
  assert.equal(score(resting, option(true)).weight, 0);
  const exhausted = opening(); stand(exhausted).stock = 0; site(exhausted).operation.enabled = false;
  assert.equal(score(exhausted, option(true)).weight, 0);
  site(exhausted).operation.enabled = true;
  assert.equal(score(exhausted, option(false)).weight, 0);
  const before = structuredClone(resting);
  for (const decisionCount of [0, 1, 2, 3]) {
    const memory = { ...createBehaviorMemory(resting, 0), decisionCount };
    const chosen = chooseCivilizationBehavior(resting, 0, memory, epoch).action;
    assert.notDeepEqual(chosen, action(true));
  }
  assert.deepEqual(resting, before);
  context.diagnostic('Paired finite synthetic availability/stock fixture uses the existing Materials scarcity threshold; explicit weighted choices are not a natural uptake campaign.');
});

void test('border continuous forecasts retain exact funded forest identity but refuse seven lots or nine beats', () => {
  for (const id of ['lumber-mill', 'charcoal-clearing'] as const) {
    const state = opening(id); const before = structuredClone(state);
    const full = borderPromisedResources(state, 0, 8);
    assert.equal(full.failure, null);
    assert.ok(full.operationForecast.some(item => item.kind === 'improvement' && item.cityId === 'city-0' && item.id === id && item.tileId === 56 && item.horizon === 8));
    assert.deepEqual(state, before);
    stand(state).stock = 7;
    const short = borderPromisedResources(state, 0, 8);
    assert.ok(short.failure);
    assert.ok(short.operationForecast.some(item => item.kind === 'improvement' && item.cityId === 'city-0' && item.id === id && item.tileId === 56));
    stand(state).stock = 8;
    assert.ok(borderPromisedResources(state, 0, 9).failure);
  }
});

void test('new woodland construction cannot borrow predicted idle recovery for its promised operation window', () => {
  const state = opening(); delete town(state).improvements!['56'];
  state.civilizations[0]!.resources.materials = 1000;
  const quote = () => createLandworkPlanner(state, 0).quote('city-0', 56).quotes.find(item => item.action.type === 'improve' && item.action.improvementId === 'lumber-mill');
  assert.ok(quote());
  stand(state).stock = 1;
  assert.equal(quote(), undefined);
  assert.equal(stand(state).stock, 1);
  assert.equal(stand(state, 58).stock, 8);
});

void test('actual accepted Studies enlarge the protected horizon and keep exact tuition, institutions and paid work intact', context => {
  const state = createWorld(1701, epoch, 'settlement-renewing-worked-woodlands-1');
  for (const id of [TEACHER, LEARNER]) {
    const city = state.cities.find(city => city.civId === id)!;
    const actor = state.civilizations[id]!; actor.era = 1;
    city.population = 10; city.wellbeing = 50; city.infrastructure = 0; city.damage = 0; city.focus = 'growth';
    city.buildings = ['academy']; city.buildingOperations = { academy: { enabled: true, lastResult: null } }; city.improvements = {};
    actor.resources = { food: 1000, materials: 1000, energy: 1000, credits: 1000, science: 0, culture: 1000 };
    syntheticTechnologies(state, id, ['agriculture', 'civic-institutions', 'animal-husbandry', 'kiln-firing', 'wheel', 'mining', 'masonry', ...(id === TEACHER ? ['engineering', 'machinery'] : [])]);
  }
  state.civilizations[LEARNER]!.researchTarget = 'engineering';
  tradeAction(state, TEACHER, { type: 'propose-trade', partner: LEARNER, recipeId: 'harvest-for-materials', sourceCityId: 'city-1', recipientCityId: 'city-4' });
  tradeAction(state, LEARNER, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true });
  for (let beat = 0; beat < 8 && state.routes[0]!.agreement!.deliveryCount === 0; beat++) knowledgeEconomy(state);
  assert.ok(state.routes[0]!.agreement!.deliveryCount > 0);
  const compact = acceptKnowledge(state);
  const city = state.cities.find(city => city.civId === TEACHER)!;
  const definition = IMPROVEMENTS.find(item => item.id === 'lumber-mill')!;
  const tile = state.tiles.find(tile => improvementSiteBlock(state, city, definition, tile.id) === null);
  assert.ok(tile, 'The synthetic teaching town needs a real eligible owned forest site');
  city.improvements![String(tile.id)] = { improvementId: definition.id, tileId: tile.id, completion: { kind: 'improvement', orderId: 'synthetic-paid-teacher-forest', cityId: city.id, improvementId: definition.id, tileId: tile.id, startedRound: state.round, completedRound: state.round, paid: { ...definition.cost }, workRequired: definition.requiredWork, eventId: 'synthetic-teacher-completion' }, operation: { enabled: true, lastResult: null } };
  city.construction = { active: { id: 'retained-paid-teacher-farm', cityId: city.id, buildingId: 'farm', ruleVersion: 1, startedRound: state.round, paid: { materials: 8 }, workRequired: 20, workDone: 1 }, lastCompleted: null };
  const horizon = compact.deadlineRound - state.round;
  assert.ok(horizon > 1 && horizon <= 8);
  state.woodlands!.stands[String(tile.id)]!.stock = horizon;
  const before = structuredClone(state);
  const full = borderPromisedResources(state, TEACHER, 1);
  assert.equal(full.failure, null); assert.equal(full.horizon, horizon);
  assert.ok(full.operationForecast.some(item => item.kind === 'building' && item.cityId === city.id && item.id === 'academy'));
  assert.ok(full.operationForecast.some(item => item.kind === 'improvement' && item.cityId === city.id && item.id === definition.id && item.tileId === tile.id));
  assert.ok((full.ordinary.culture ?? 0) >= (compact.terms.teacherContribution.culture ?? 0));
  assert.deepEqual(state, before);
  state.woodlands!.stands[String(tile.id)]!.stock = horizon - 1;
  const deficient = structuredClone(state);
  assert.ok(borderPromisedResources(state, TEACHER, 1).failure);
  assert.deepEqual(state, deficient);
  assert.deepEqual(city.construction, before.cities.find(item => item.id === city.id)!.construction);
  assert.deepEqual(state.knowledge, before.knowledge);
  context.diagnostic('Synthetic initial institutional prerequisites and later exact forest stocks surround real trade consent, delivery, and accepted Studies commands; this is a finite commitment-preservation fixture, not natural cooperation.');
});

void test('Lumber resume preserves higher-tile Food allocations and paid orders without requiring a second opening work-lot', context => {
  const state = opening(); const city = town(state);
  city.population = 5; site(state).operation.enabled = false; stand(state).stock = 1;
  syntheticTechnologies(state, 0, ['water-management', 'masonry']);
  const definition = IMPROVEMENTS.find(item => item.id === 'hill-commons')!;
  const center = state.tiles.find(tile => tile.id === city.tileId)!;
  const tile = state.tiles.find(tile => tile.id > 56 && tile.id !== city.tileId && tile.owner === 0 && tile.terrain !== 'forest' && hexDistance(center, tile) <= definition.siteRange);
  assert.ok(tile, 'A higher-tile owned nonforest site is needed for the synthetic Hillside commons');
  tile.terrain = 'grassland'; tile.elevation = 75;
  assert.deepEqual(improvementEligibility(state, 0, definition, city.id).blockers, []);
  assert.equal(improvementSiteBlock(state, city, definition, tile.id), null);
  city.improvements![String(tile.id)] = { improvementId: definition.id, tileId: tile.id, completion: { kind: 'improvement', orderId: 'synthetic-paid-food-site', cityId: city.id, improvementId: definition.id, tileId: tile.id, startedRound: 0, completedRound: 0, paid: { ...definition.cost }, workRequired: definition.requiredWork, eventId: 'synthetic-food-completion' }, operation: { enabled: true, lastResult: null } };
  const score = (world: WorldState) => assessCivilizationBehavior(world, 0, createBehaviorMemory(world, 0), [option(true)], profile).candidates[0]!.weight;
  const allocated = (world: WorldState, enable: boolean) => projectOperationAllocation(world, projected => { site(projected).operation.enabled = enable; });
  const foodResult = (world: WorldState) => town(world).improvements![String(tile.id)]!.operation.lastResult!;
  const positiveBefore = structuredClone(state);
  const positive = createLandworkPlanner(state, 0).lumberOperation(city.id, 56);
  assert.ok(positive); assert.equal(positive.targetOperationBeats, 1);
  assert.ok(positive.retainedOperations.includes(`${city.id}/site/${tile.id}`));
  assert.equal(foodResult(allocated(state, false)).status, 'operated');
  const positiveAllocation = allocated(state, true);
  assert.equal(foodResult(positiveAllocation).status, 'operated');
  assert.equal(site(positiveAllocation).operation.lastResult!.status, 'operated');
  assert.equal(site(positiveAllocation).operation.lastResult!.woodland!.harvested, 1);
  assert.ok(score(state) > 0);
  assert.deepEqual(state, positiveBefore);
  const crowded = structuredClone(state); town(crowded).population = 4;
  assert.deepEqual(crowded.civilizations[0]!.resources, state.civilizations[0]!.resources);
  assert.equal(stand(crowded).stock, stand(state).stock);
  assert.equal(foodResult(allocated(crowded, false)).status, 'operated');
  const displaced = allocated(crowded, true);
  assert.equal(site(displaced).operation.lastResult!.status, 'operated');
  assert.equal(foodResult(displaced).status, 'blocked');
  assert.equal(foodResult(displaced).blockedReason, 'resident-shortage');
  const crowdedBefore = structuredClone(crowded);
  assert.equal(createLandworkPlanner(crowded, 0).lumberOperation(city.id, 56), null);
  assert.equal(score(crowded), 0);
  assert.deepEqual(crowded, crowdedBefore);
  const pending = structuredClone(state);
  delete town(pending).improvements![String(tile.id)];
  town(pending).construction!.active = { kind: 'improvement', id: 'retained-paid-food-order', cityId: city.id, improvementId: definition.id, tileId: tile.id, ruleVersion: 1, startedRound: 0, paid: { ...definition.cost }, workRequired: definition.requiredWork, workDone: definition.requiredWork - 1 };
  const pendingBefore = structuredClone(pending);
  const retained = createLandworkPlanner(pending, 0).lumberOperation(city.id, 56);
  assert.ok(retained); assert.equal(retained.targetOperationBeats, 1);
  assert.ok(retained.retainedOperations.includes(`${city.id}/site/${tile.id}`));
  assert.ok(score(pending) > 0); assert.deepEqual(pending, pendingBefore);
  town(pending).population = 4;
  const unfundedBefore = structuredClone(pending);
  assert.equal(createLandworkPlanner(pending, 0).lumberOperation(city.id, 56), null);
  assert.equal(score(pending), 0); assert.deepEqual(pending, unfundedBefore);
  context.diagnostic('Synthetic paid site/order identities and exact eligible owned Hillside terrain isolate actual allocator and final-scorer protection. Paired population5 versus4 keeps resources and stock1 fixed; no campaign or natural uptake claim.');
});
