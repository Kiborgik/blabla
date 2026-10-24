import assert from 'node:assert/strict';
import { test } from 'node:test';
import { civicWorksActionHold, createCivicWorksPolicy } from '../core/behavior-civic-works.ts';
import { createCharcoalClearingPolicy } from '../core/behavior-charcoal.ts';
import { borderProtects, borderReason, deriveBorderPlan } from '../core/behavior-border.ts';
import { deriveReliefPlan, reliefProtects, reliefReason } from '../core/behavior-relief.ts';
import { assessCivilizationBehavior, createBehaviorMemory } from '../core/behaviors.ts';
import { createFoundingProtection } from '../core/behavior-founding-protection.ts';
import { createGovernmentCashflowPolicy } from '../core/behavior-government-cashflow.ts';
import { createLandworkPlanner } from '../core/behavior-landwork.ts';
import { createPaidFoodSiteAffordability, fundedPaidFoodSites } from '../core/behavior-paid-food-sites.ts';
import { BEHAVIOR_PROFILES } from '../core/behavior-profiles.ts';
import { BUILDINGS, CIVICS, RESOURCE_IDS } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { availableCivicWorksActions, executeCivicWorksAction } from '../core/simulation/civic-works.ts';
import { executeAction } from '../core/simulation/commands.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { commitEvents, emitEvent } from '../core/simulation/events.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';
import type { CivicWorksAction } from '../core/civic-works-types.ts';
import type { ActionOption, GameAction, GameEvent, WorldState } from '../core/types.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const seat = 1;
const profile = BEHAVIOR_PROFILES[seat]!;
function guardedFixture() {
  const state = createWorld(1701, epoch, 'settlement-learning-patronage-1');
  const actor = state.civilizations[seat]!;
  const city = state.cities.find(city => city.civId === seat)!;
  actor.resources = { food: 100, materials: 100, energy: 100, credits: 100, science: 0, culture: 100 };
  actor.civics!.completedCivicIds = CIVICS.map(civic => civic.id); actor.civics!.active = null;
  actor.government!.active = { governmentId: 'chiefdom', assignments: [], effectiveRound: 0, governmentLockUntilRound: 0, policyLockUntilRound: 0 };
  city.population = 9; city.housing!.baseCapacity = 9; city.wellbeing = 50; city.infrastructure = 0; city.damage = 0; city.focus = 'industry';
  city.buildings = ['kiln']; city.buildingOperations = { kiln: { enabled: true, lastResult: null } }; city.construction = { active: null, lastCompleted: null };
  return { state, actor, city };
}
function active(state: WorldState, civId = seat) {
  const city = state.cities.find(city => city.civId === civId)!;
  state.civicWorks = { ruleVersion: 1, active: [{ id: 'controlled-commission', civId, cityId: city.id, orderId: 'controlled-order', buildingId: 'irrigation', targetTileId: city.tileId, donorBuildingId: 'kiln', acceptedRound: state.round, firstRound: state.round + 1, expiresRound: state.round + 2, acceptedEventId: 'controlled-acceptance' }], lastResults: [] };
}

void test('active commissioning is explicitly outside the government chronological forecast, not silently ordinary Kiln output', () => {
  const { state } = guardedFixture();
  assert.equal(createGovernmentCashflowPolicy(state, seat, profile.resources, profile.priorities).compareUnchanged().supported, true);
  active(state);
  const result = createGovernmentCashflowPolicy(state, seat, profile.resources, profile.priorities).compareUnchanged();
  assert.equal(result.supported, false); assert.match(result.reason, /civic.works/i); assert.deepEqual(result.proposedBeats, []);
});

void test('founding and landwork report their active commission closure rather than manufacturing later staffing or free fees', () => {
  const { state, city } = guardedFixture(); active(state);
  assert.match(createFoundingProtection(state, seat).prepare().failure!, /civic.works/i);
  const quote = createLandworkPlanner(state, seat).quote(city.id, city.tileId);
  assert.deepEqual(quote.quotes, []); assert.match(quote.reason!, /civic.works/i);
});

void test('unrelated civilizations retain the same government and founding forecasts', () => {
  const { state } = guardedFixture();
  const government = createGovernmentCashflowPolicy(state, seat, profile.resources, profile.priorities).compareUnchanged();
  const founding = createFoundingProtection(state, seat).prepare(); active(state, 0);
  assert.deepEqual(createGovernmentCashflowPolicy(state, seat, profile.resources, profile.priorities).compareUnchanged(), government);
  assert.deepEqual(createFoundingProtection(state, seat).prepare(), founding);
});

void test('active commissioning preserves enabled Food site intent without admitting new paid Food setup', () => {
  const { state, city } = guardedFixture(); active(state);
  const tile = state.tiles.find(tile => tile.owner === seat && tile.id !== city.tileId)!;
  city.improvements = { [String(tile.id)]: { improvementId: 'hill-commons', tileId: tile.id, completion: { kind: 'improvement', orderId: 'controlled-food-order', cityId: city.id, improvementId: 'hill-commons', tileId: tile.id, startedRound: 0, completedRound: 0, paid: { materials: 8, credits: 4 }, workRequired: 4, eventId: 'controlled-food-completion' }, operation: { enabled: true, lastResult: null } } };
  const key = `${city.id}/${tile.id}`;
  assert.deepEqual([...fundedPaidFoodSites(state, seat, new Set(['city-1/kiln']), new Set([key]))], [key]);
  assert.equal(createPaidFoodSiteAffordability(state, seat)({ type: 'improve', cityId: city.id, tileId: tile.id, improvementId: 'hill-commons' }), false);
  city.improvements[String(tile.id)]!.operation.enabled = false;
  assert.deepEqual([...fundedPaidFoodSites(state, seat, new Set(), new Set([key]))], []);
});

function economicFixture(civId = seat) {
  const state = createWorld(1701, epoch, 'settlement-civic-works-1');
  const actor = state.civilizations[civId]!; const city = state.cities.find(city => city.civId === civId)!;
  actor.resources = { food: 100, materials: 100, energy: 100, credits: 100, science: 0, culture: 100 };
  actor.researchTarget = ''; actor.era = 1;
  city.population = 9; city.housing!.baseCapacity = 9; city.wellbeing = 50; city.infrastructure = 0; city.damage = 0; city.focus = 'industry';
  syntheticTechnologies(state, civId, ['water-management', 'kiln-firing']); syntheticInstitution(state, city.id, 'kiln');
  state.revision++;
  const civicEvents: GameEvent[] = [];
  const event = emitEvent(state, civicEvents, { type: 'civic-completed', title: 'Controlled civic prerequisite', detail: 'Conditional policy fixture, not natural play', actor: civId, target: civId, tileId: null, cause: 'Synthetic completed prerequisites', effects: ['Completed civic state-workforce'], importance: 1 });
  actor.civics = { ruleVersion: 1, completedCivicIds: CIVICS.map(civic => civic.id), active: null, lastCompleted: { civicId: 'state-workforce', completedRound: state.round, eventId: event.id }, reformEntitlement: { civicId: 'state-workforce', completedRound: state.round, completionEventId: event.id } };
  commitEvents(state, civicEvents); state.revision++;
  const events: GameEvent[] = []; const before = { ...actor.resources };
  executeAction(state, civId, { type: 'build', cityId: city.id, project: 'irrigation' }, events); commitEvents(state, events);
  const definition = BUILDINGS.find(building => building.id === 'irrigation')!;
  for (const id of RESOURCE_IDS) assert.equal(actor.resources[id], before[id] - (definition.cost[id] ?? 0));
  const order = city.construction!.active!; order.workDone = order.workRequired - 3;
  const action: CivicWorksAction = { type: 'commission-civic-works', cityId: city.id, orderId: order.id, donorBuildingId: 'kiln' };
  return { state, actor, city, action };
}
function beat(state: WorldState) {
  state.round++; state.revision++; const events: GameEvent[] = []; resolveEconomy(state, events); commitEvents(state, events);
}

void test('real retained Materials and earlier paid Food production win under different existing civilization preferences', () => {
  const positive = economicFixture(1); const negative = economicFixture(2);
  const food = createCivicWorksPolicy(positive.state, 1, BEHAVIOR_PROFILES[1]!.resources)(positive.action);
  const materials = createCivicWorksPolicy(negative.state, 2, BEHAVIOR_PROFILES[2]!.resources)(negative.action);
  assert.equal(food.supported, true, food.reason); assert.ok(food.netValue > 0); assert.equal(food.weight, food.netValue);
  assert.equal(materials.supported, true, materials.reason); assert.ok(materials.netValue < 0); assert.equal(materials.weight, 0); assert.match(materials.reason, /Retain Kiln Materials/);
  assert.ok(food.netResourceDelta.food > 5); assert.equal(food.netResourceDelta.materials, -6); assert.equal(food.netResourceDelta.energy, 2); assert.equal(food.netResourceDelta.credits, -2);
  assert.equal(food.foregoneKilnMaterials, 4); assert.equal(food.commissionPaid.materials, 1); assert.equal(food.commissionPaid.credits, 2);
  assert.equal(food.extraWork, 1); assert.equal(food.successfulBeats.length, 1);
  assert.equal(food.proposedCompletionRound, 1); assert.equal(food.retainedCompletionRound, 2); assert.equal(food.firstEarlierProductionRound, 2); assert.equal(food.forecastBeats, 3);
});

void test('quoted economics match independent authoritative paid execution and never produce on the completion beat', () => {
  const { state, action } = economicFixture(); const before = structuredClone(state);
  const quote = createCivicWorksPolicy(state, seat, profile.resources)(action);
  assert.equal(quote.supported, true, quote.reason); assert.deepEqual(state, before);
  const proposed = structuredClone(state); const retained = structuredClone(state); const events: GameEvent[] = [];
  assert.ok(executeCivicWorksAction(proposed, seat, action, events)); commitEvents(proposed, events);
  assert.deepEqual(proposed.civilizations[seat]!.resources, state.civilizations[seat]!.resources);
  for (let index = 0; index < quote.forecastBeats; index++) {
    beat(proposed); beat(retained);
    const town = proposed.cities.find(city => city.civId === seat)!;
    if (index === 0) { assert.equal(town.buildingOperations!.irrigation!.lastResult, null); assert.equal(town.buildingOperations!.kiln!.lastResult!.status, 'civic-works'); }
    if (index === 1) { assert.equal(town.buildingOperations!.irrigation!.lastResult!.status, 'operated'); assert.equal(town.buildingOperations!.irrigation!.lastResult!.paid.materials, 1); assert.equal(town.buildingOperations!.irrigation!.lastResult!.residents!.allocated, 3); assert.equal(town.buildingOperations!.kiln!.lastResult!.residents!.allocated, 3); }
  }
  for (const id of RESOURCE_IDS) assert.equal(quote.netResourceDelta[id], Math.round((proposed.civilizations[seat]!.resources[id] - retained.civilizations[seat]!.resources[id]) * 100) / 100);
});

void test('policy is immutable, cached per exact action and refuses stale snapshots or changed order identity', () => {
  const { state, action } = economicFixture(); const before = structuredClone(state); const policy = createCivicWorksPolicy(state, seat, profile.resources);
  const first = policy(action); assert.equal(policy({ ...action }), first); assert.deepEqual(policy.diagnostics(), { projections: 1, cached: 1 });
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.netResourceDelta) && Object.isFrozen(first.successfulBeats)); assert.deepEqual(state, before);
  assert.equal(policy({ ...action, orderId: 'replacement' }).supported, false);
  state.revision++; assert.match(policy(action).reason, /snapshot changed/);
});

void test('no fee, unavailable staff, non-donor displacement and new household tails cannot buy a positive policy weight', () => {
  for (const mutation of ['materials', 'credits', 'staff', 'paused', 'baseline-completion', 'growth', 'non-donor'] as const) {
    const { state, actor, city, action } = economicFixture();
    if (mutation === 'materials') actor.resources.materials = 0.99;
    if (mutation === 'credits') actor.resources.credits = 1.99;
    if (mutation === 'staff') city.population = 5;
    if (mutation === 'paused') city.buildingOperations!.kiln!.enabled = false;
    if (mutation === 'baseline-completion') city.construction!.active!.workDone = city.construction!.active!.workRequired - 1;
    if (mutation === 'growth') city.housing!.baseCapacity = city.population + 1;
    if (mutation === 'non-donor') { syntheticTechnologies(state, seat, ['writing']); syntheticInstitution(state, city.id, 'campus'); syntheticInstitution(state, city.id, 'library'); }
    const result = createCivicWorksPolicy(state, seat, profile.resources)(action);
    assert.equal(result.supported, false, mutation); assert.equal(result.weight, 0, mutation);
  }
});

void test('commission valuation is optional and ordinary wait remains independently scored', () => {
  const { state, action } = economicFixture();
  const available = availableCivicWorksActions(state, seat).find(option => option.action.type === action.type)!; assert.ok(available);
  const options: ActionOption[] = [available, { action: { type: 'wait' }, label: 'Wait', reason: 'Retain ordinary production' }];
  const candidates = assessCivilizationBehavior(state, seat, createBehaviorMemory(state, seat), options).candidates;
  const commission = candidates.find(candidate => candidate.option.action.type === 'commission-civic-works')!;
  assert.ok(commission.weight > 0); assert.equal(commission.lane, null); assert.equal(commission.urgent, false);
  assert.ok(candidates.find(candidate => candidate.option.action.type === 'wait')!.weight > 0);
});

void test('active holds are narrow: research, civics, focus, repairs, ordinary paid work and cost-reducing pauses remain independent', () => {
  const { state, city } = economicFixture(); active(state);
  const ordinary: GameAction[] = [
    { type: 'research', technology: 'writing' }, { type: 'choose-civic', civicId: 'craftsmanship' }, { type: 'focus', cityId: city.id, focus: 'growth' },
    { type: 'repair-city', cityId: city.id }, { type: 'build', cityId: 'other-town', project: 'workshop' },
    { type: 'set-building-operation', cityId: city.id, buildingId: 'kiln', enabled: false }, { type: 'set-building-operation', cityId: city.id, buildingId: 'library', enabled: false },
    { type: 'set-improvement-operation', cityId: city.id, tileId: city.tileId, improvementId: 'lumber-mill', enabled: false },
    { type: 'respond-trade', offerId: 'offer', accept: false }, { type: 'withdraw-trade', offerId: 'offer' }, { type: 'withdraw-relief', charterId: 'charter' },
    { type: 'withdraw-knowledge', compactId: 'compact' }, { type: 'withdraw-border', incidentId: 'incident' }, { type: 'respond-border', incidentId: 'incident', response: 'yield' }, { type: 'wait' },
  ];
  for (const action of ordinary) assert.equal(civicWorksActionHold(state, seat, action), null, action.type);
  const unsupported: GameAction[] = [
    { type: 'set-building-operation', cityId: city.id, buildingId: 'library', enabled: true },
    { type: 'set-improvement-operation', cityId: city.id, tileId: city.tileId, improvementId: 'lumber-mill', enabled: true },
    { type: 'set-improvement-operation', cityId: city.id, tileId: city.tileId, improvementId: 'hill-commons', enabled: false },
    { type: 'propose-trade', partner: 0, recipeId: 'food-for-materials' }, { type: 'respond-public-project', projectId: 'project', accept: true },
  ];
  for (const action of unsupported) assert.match(civicWorksActionHold(state, seat, action)!, /civic.works/i);
});

void test('direct charcoal, border departure and new relief consumers refuse unsupported active funding explicitly', () => {
  const { state, actor, city } = economicFixture(); active(state);
  assert.equal(createCharcoalClearingPolicy(state, seat, profile.resources, profile.priorities.construction, [])({ type: 'improve', cityId: city.id, tileId: city.tileId, improvementId: 'charcoal-clearing' }), null);
  const departure: ActionOption = { action: { type: 'dispatch-border', sourceCityId: city.id, tileId: 0, people: 2 }, label: 'Controlled unsupported departure', reason: 'Forecast closure probe' };
  const border = deriveBorderPlan(state, actor, profile, [departure]); assert.equal(borderProtects(departure, border), true); assert.match(borderReason(departure, border)!, /civic.works/i);
  const offer: ActionOption = { action: { type: 'propose-relief', routeId: 'route', sourceCityId: city.id, recipientCityId: 'city-0' }, label: 'Controlled unsupported relief', reason: 'Forecast closure probe' };
  const relief = deriveReliefPlan(state, actor, profile, [offer]); assert.equal(reliefProtects(offer, relief), true); assert.match(reliefReason(offer, relief)!, /civic.works/i);
});
