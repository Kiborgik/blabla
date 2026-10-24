import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { createFoundingProtection } from '../core/behavior-founding-protection.ts';
import { borderReturnReservations } from '../core/simulation/border-incidents.ts';
import { cityGrowthFacts } from '../core/simulation/growth.ts';
import { createCoastalOpportunity } from '../core/behavior-coastal-opportunity.ts';
import { civilizationBehaviorProfile, behaviorPolicyVersion } from '../core/behavior-profiles.ts';
import { assessCivilizationBehavior, chooseCivilizationBehavior, createBehaviorMemory, type BehaviorMemory } from '../core/behaviors.ts';
import { BUILDINGS, CIVICS, ECONOMY_RULES, RESOURCE_IDS, TECHNOLOGIES } from '../core/content.ts';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { cityResourceProduction } from '../core/learning-patronage.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { createCoastalPlanner, coastalPathBlock, foundSettlement, foundingSiteEligible, isCoastalSite } from '../core/simulation/coastal.ts';
import { decisionObligations } from '../core/simulation/decisions.ts';
import { commitEvents, emitEvent } from '../core/simulation/events.ts';
import { availableKnowledgeActions } from '../core/simulation/knowledge-compacts.ts';
import { availableTradeActions } from '../core/simulation/trade.ts';
import { availableCivicWorksActions } from '../core/simulation/civic-works.ts';
import { applyEffects } from '../core/simulation/effects.ts';
import { householdFoodUpkeep } from '../core/simulation/food-security.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { isHillSite } from '../core/simulation/improvements.ts';
import { availableCampusHighGround } from '../core/simulation/observatory.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import { createLandTransportPlanner } from '../core/simulation/transport.ts';
import { turnAdmission } from '../core/simulation/turns.ts';
import type { City, Focus, GameAction, GameEvent, Resources, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const release = 'settlement-expansion-labor-1';
const seed = 73;
const sourceId = 'synthetic-labor-source';
const cursors = Array.from({ length: 128 }, (_, index) => index);
const cents = (value: number): number => Math.round(value * 100) / 100;
type Toggle = Extract<GameAction, { type: 'set-building-operation' }>;

function timestamp(state: WorldState, seat: number): string {
  const at = turnAdmission(state, seat).nextActionAt;
  assert.ok(at);
  return at;
}

function options(state: WorldState, seat: number) {
  return legalActions(state, seat, timestamp(state, seat));
}

function action(state: WorldState, seat: number, action: GameAction) {
  const at = timestamp(state, seat);
  assert.ok(legalActions(state, seat, at).some(option => sameAction(option.action, action)), JSON.stringify(action));
  const before = structuredClone(state);
  const result = applyCommand(state, { seat, expectedRevision: state.revision, timestamp: at, action });
  assert.ok(result.ok, result.error);
  assert.deepEqual(state, before);
  assert.ok(isWorldState(result.state), `Actual ${action.type} revision ${result.state.revision}`);
  return result;
}

function source(state: WorldState): City {
  const city = state.cities.find(city => city.id === sourceId);
  assert.ok(city);
  return city;
}

function install(state: WorldState, city: City, id: string, tileId?: number): void {
  const definition = BUILDINGS.find(building => building.id === id);
  assert.ok(definition);
  const actor = state.civilizations[city.civId]!;
  syntheticTechnologies(state, actor.id, definition.requires);
  actor.era = Math.max(actor.era, definition.minEra);
  syntheticInstitution(state, city.id, id, tileId);
  applyEffects(state, actor.id, definition.effects, city.id);
}

function fixture(spec: { recipe?: string; scholars?: boolean; focus?: Focus; wellbeing?: number; developed?: boolean; pending?: string } = {}) {
  let state = createGeneratedWorld(seed, epoch, release, 'cultural-toponyms-v1', 'strategic-temperaments-v1');
  const seat = spec.scholars ? state.civilizations.find(actor => civilizationBehaviorProfile(seed, actor.id, behaviorPolicyVersion(state)).id.includes('/scholars/'))!.id : 0;
  for (const actor of state.civilizations) actor.resources = { food: 10000, materials: 10000, energy: 10000, credits: 10000, science: 0, culture: 10000 };
  const planner = createCoastalPlanner(state);
  const homeTiles = state.tiles.filter(tile => tile.owner === seat);
  const coast = state.tiles.filter(tile => foundingSiteEligible(state, tile) && isCoastalSite(state, tile.id)).toSorted((a, b) => a.id - b.id);
  const campusSite = (site: typeof coast[number]) => state.tiles.find(tile => tile.owner === null && tile.id !== site.id && tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && hexDistance(site, tile) <= 3 && !state.cities.some(city => city.tileId === tile.id) && !state.strategicDeposits?.deposits[String(tile.id)] && !state.coalDeposits?.deposits[String(tile.id)] && !state.pastoralSites?.sites[String(tile.id)] && state.tiles.some(high => hexDistance(tile, high) === 1 && (high.terrain === 'mountain' || isHillSite(high))));
  const tile = coast.find(site => (!spec.scholars || campusSite(site)) && coast.some(destination => hexDistance(site, destination) > 3 && homeTiles.every(home => hexDistance(home, destination) > 2) && planner.quote(site.id, destination.id)));
  assert.ok(tile, 'Fixed fresh geography needs a coastal source with a distant legal path and any declared Campus high ground');
  const town: City = { id: sourceId, name: 'Explicit finite labor prerequisite', civId: seat, tileId: tile.id, ...ECONOMY_RULES.initialCity, focus: spec.focus ?? 'growth', buildings: [], housing: { ruleVersion: 1, origin: 'founded', establishedRound: 0, baseCapacity: 8 }, construction: { active: null, lastCompleted: null } };
  tile.owner = seat;
  state.cities.push(town);
  install(state, town, 'boat-yard');
  install(state, town, 'farm');
  if (!spec.scholars && spec.recipe !== 'irrigation') {
    install(state, town, 'granary');
    install(state, town, 'irrigation');
    town.population = 9;
  }
  if (spec.developed) { install(state, town, 'workshop'); install(state, town, 'monument'); }
  if (spec.scholars) {
    const site = campusSite(tile);
    assert.ok(site);
    site.owner = seat;
    install(state, town, 'campus', site.id);
    const highGround = availableCampusHighGround(state, town)[0];
    assert.ok(highGround);
    if (spec.recipe === 'observatory') town.buildingHighGround = { observatory: highGround };
  }
  install(state, town, spec.recipe ?? 'kiln');
  if (spec.wellbeing !== undefined) town.wellbeing = spec.wellbeing;
  const actor = state.civilizations[seat]!;
  syntheticTechnologies(state, seat, ['navigation']);
  const research = TECHNOLOGIES.find(technology => technology.id === 'education')!;
  syntheticTechnologies(state, seat, research.requires);
  assert.ok(!actor.technologies.includes(research.id));
  actor.researchTarget = research.id;
  actor.researchProgress = 0;
  actor.civics!.active = { civicId: 'code-of-laws', startedRound: 0, progress: 0, requiredCulture: CIVICS.find(civic => civic.id === 'code-of-laws')!.cost };
  assert.ok(isWorldState(state), 'Fresh selected current rules and explicit synthetic prerequisites, never a saved checkpoint');
  for (const city of state.cities.filter(city => city.civId === seat)) {
    const project = city.id === sourceId && spec.pending ? spec.pending : city.buildings.includes('workshop') ? 'granary' : 'workshop';
    const definition = BUILDINGS.find(building => building.id === project)!;
    syntheticTechnologies(state, seat, definition.requires);
    state.civilizations[seat]!.era = Math.max(state.civilizations[seat]!.era, definition.minEra);
    state = action(state, seat, { type: 'build', cityId: city.id, project }).state;
  }
  const obligations = decisionObligations(state, seat);
  assert.equal(obligations.research.status, 'active');
  assert.equal(obligations.civic?.status, 'active');
  assert.ok(obligations.construction.every(lane => lane.status === 'active'));
  assert.ok(options(state, seat).some(option => option.action.type === 'settle-coast' && option.action.sourceCityId === sourceId));
  return { state, seat };
}

function assess(state: WorldState, seat: number, memory = createBehaviorMemory(state, seat)) {
  const stateBefore = structuredClone(state);
  const memoryBefore = structuredClone(memory);
  const result = assessCivilizationBehavior(state, seat, memory, options(state, seat));
  assert.deepEqual(state, stateBefore);
  assert.deepEqual(memory, memoryBefore);
  assert.ok(result.expansionLabor);
  return result;
}

function labor(state: WorldState, seat: number) {
  return assess(state, seat).expansionLabor!;
}

function positive(state: WorldState, seat: number) {
  const result = labor(state, seat);
  assert.ok(result.assessment.pause, result.assessment.reason);
  assert.ok(result.assessment.witness, result.assessment.reason);
  assert.ok(result.assessment.witness.netFlowValue > 0);
  return result;
}

function toggle(buildingId: string, enabled: boolean): Toggle {
  return { type: 'set-building-operation', cityId: sourceId, buildingId, enabled };
}

function netFlow(state: WorldState, seat: number): Resources {
  const opening = projectOperationAllocation(state);
  const flow: Resources = { food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 };
  for (const city of opening.cities.filter(city => city.civId === seat)) {
    for (const resource of RESOURCE_IDS) flow[resource] = cents(flow[resource] + cityResourceProduction(opening, city, resource).total);
    flow.food = cents(flow.food - householdFoodUpkeep(opening, city.population));
  }
  for (const resource of RESOURCE_IDS) flow[resource] = cents(flow[resource] - state.civilizations[seat]!.resources[resource] + opening.civilizations[seat]!.resources[resource]);
  return flow;
}

function conditionalFounding(state: WorldState, seat: number, buildingId: string, tileId: number): WorldState {
  const projected = structuredClone(state);
  source(projected).buildingOperations![buildingId]!.enabled = false;
  const tile = projected.tiles.find(tile => tile.id === tileId)!;
  foundSettlement(projected, seat, tile, source(projected), true);
  return projected;
}

function completeCivics(state: WorldState, seat: number): void {
  const actor = state.civilizations[seat]!;
  state.revision++;
  const events: GameEvent[] = [];
  const civicId = CIVICS.at(-1)!.id;
  const event = emitEvent(state, events, { type: 'civic-completed', title: 'Explicit finite civic prerequisite', detail: 'Synthetic setup, not natural progression', actor: seat, target: seat, tileId: null, cause: 'Declared prerequisite', effects: [`Completed civic ${civicId}`], importance: 1 });
  actor.civics = { ruleVersion: 1, completedCivicIds: CIVICS.map(civic => civic.id), active: null, lastCompleted: { civicId, completedRound: state.round, eventId: event.id }, reformEntitlement: { civicId, completedRound: state.round, completionEventId: event.id } };
  commitEvents(state, events);
  assert.ok(isWorldState(state));
}

function beat(state: WorldState) {
  const at = turnAdmission(state, 0).nextStrategyAt;
  assert.ok(at);
  const before = structuredClone(state);
  const result = catchUpStrategy(state, at);
  assert.ok(result.ok, result.error);
  assert.equal(result.state.round, state.round + 1);
  assert.deepEqual(state, before);
  assert.ok(isWorldState(result.state));
  return result;
}

void test('L1 one real staffed Kiln offers exactly its positive ordinary flow difference without altering commitments or funding from income', context => {
  const { state, seat } = fixture();
  const before = structuredClone(state);
  const started = performance.now();
  const result = positive(state, seat);
  const elapsedMs = performance.now() - started;
  const witness = result.assessment.witness!;
  assert.deepEqual(result.assessment.pause, toggle('kiln', false));
  assert.equal(source(state).housing!.origin, 'founded');
  assert.equal(source(state).housing!.baseCapacity, 8);
  assert.equal(cityGrowthFacts(state, source(state)).capacity, 12);
  const opening = projectOperationAllocation(state);
  const receipt = source(opening).buildingOperations!.kiln!.lastResult!;
  assert.equal(receipt.status, 'operated');
  assert.equal(receipt.residents!.allocated, 3);
  assert.deepEqual(receipt.paid, { energy: 2 });
  assert.deepEqual(receipt.produced, {});
  assert.deepEqual(witness.retainedFlow, netFlow(state, seat));
  const alternative = conditionalFounding(state, seat, 'kiln', witness.tileId);
  assert.deepEqual(witness.alternativeFlow, netFlow(alternative, seat));
  assert.deepEqual(witness.flowDelta, Object.fromEntries(RESOURCE_IDS.map(resource => [resource, cents(witness.alternativeFlow[resource] - witness.retainedFlow[resource])])));
  const profile = civilizationBehaviorProfile(seed, seat, behaviorPolicyVersion(state));
  assert.ok(Math.abs(witness.netFlowValue - RESOURCE_IDS.reduce((sum, resource) => sum + witness.flowDelta[resource] * profile.resources[resource], 0)) < 1e-9);
  assert.equal(witness.lostOutput.materials, cityResourceProduction(opening, source(opening), 'materials').buildings.find(building => building.buildingId === 'kiln')!.amount);
  assert.equal(witness.savedInputs.energy, 2);
  assert.deepEqual(witness.foundingCost, { food: 10, materials: 12, credits: 8 });
  assert.equal(state.cities.reduce((sum, city) => sum + city.population, 0), alternative.cities.reduce((sum, city) => sum + city.population, 0));
  assert.equal(state.cities.filter(city => city.civId === seat).reduce((sum, city) => sum + householdFoodUpkeep(state, city.population), 0), alternative.cities.filter(city => city.civId === seat).reduce((sum, city) => sum + householdFoodUpkeep(alternative, city.population), 0));
  assert.ok(witness.currentTowns.households.every(home => !home.prospective));
  assert.equal(witness.departure.households.filter(home => home.prospective).length, 1);
  assert.ok(witness.currentTowns.protectedBudget.ordinary.food > 0);
  assert.ok(witness.departure.protectedBudget.ordinary.food > witness.currentTowns.protectedBudget.ordinary.food);
  const candidate = assess(state, seat).candidates.find(candidate => sameAction(candidate.option.action, result.assessment.pause))!;
  assert.equal(candidate.weight, witness.netFlowValue);
  assert.equal(candidate.urgent, false);
  assert.equal(candidate.lane, null);
  assert.equal(result.work.sources, 1);
  assert.equal(result.work.destinations, 1);
  assert.equal(result.work.eligibleRecipes, 1);
  assert.equal(result.work.allocationProjections, 6);
  assert.ok(result.work.allocationProjections <= 1 + 7 * result.work.eligibleRecipes);
  assert.ok(result.work.cacheHits > 0);
  assert.ok(result.work.inheritedCoastal);
  assert.deepEqual(state, before);
  context.diagnostic(JSON.stringify({ seed, seat, sourceId, release, conditionalOnly: true, witness, work: result.work, elapsedMs }));
});

void test('L2 actual Observatory productivity reverses the decision at identical generated preferences, flags and destination', context => {
  const { state, seat } = fixture({ recipe: 'observatory', scholars: true, focus: 'culture', wellbeing: 40, developed: true });
  assert.equal(source(state).infrastructure, 4);
  const low = positive(state, seat);
  const high = structuredClone(state);
  source(high).wellbeing = 100;
  assert.ok(isWorldState(high));
  assert.deepEqual(civilizationBehaviorProfile(seed, seat, behaviorPolicyVersion(high)), civilizationBehaviorProfile(seed, seat, behaviorPolicyVersion(state)));
  assert.deepEqual(options(high, seat), options(state, seat));
  const lowOpening = projectOperationAllocation(state);
  const highOpening = projectOperationAllocation(high);
  const amount = (world: WorldState) => cityResourceProduction(world, source(world), 'science').buildings.find(building => building.buildingId === 'observatory')!.amount;
  assert.equal(amount(lowOpening), 8.82);
  assert.equal(amount(highOpening), 14.7);
  const witness = low.assessment.witness!;
  const highAlternative = conditionalFounding(high, seat, 'observatory', witness.tileId);
  const highFlow = netFlow(high, seat);
  const highAlternativeFlow = netFlow(highAlternative, seat);
  const profile = civilizationBehaviorProfile(seed, seat, behaviorPolicyVersion(state));
  const highValue = RESOURCE_IDS.reduce((sum, resource) => sum + cents(highAlternativeFlow[resource] - highFlow[resource]) * profile.resources[resource], 0);
  assert.ok(highValue <= 0, `Declared real-property opposite failed: ${highValue}`);
  const rejection = labor(high, seat);
  assert.equal(rejection.assessment.pause, null);
  assert.equal(rejection.assessment.suppressedResume, null);
  assert.match(rejection.assessment.reason, /positive|value|flow/i);
  assert.equal(rejection.work.destinations, 1);
  context.diagnostic(JSON.stringify({ profileId: profile.id, weights: profile.resources, sourceInfrastructure: 4, lowWellbeing: 40, highWellbeing: 100, lowOutput: amount(lowOpening), highOutput: amount(highOpening), tileId: witness.tileId, lowValue: witness.netFlowValue, highValue, reason: rejection.assessment.reason, unchangedPreferences: true }));
});

void test('L3 Food and an active Learning recipient remain ineligible despite legal toggles and stocked certificates', () => {
  const food = fixture({ recipe: 'irrigation' });
  assert.ok(options(food.state, food.seat).some(option => sameAction(option.action, toggle('irrigation', false))));
  const foodOpening = projectOperationAllocation(food.state);
  assert.ok(cityResourceProduction(foodOpening, source(foodOpening), 'food').buildings.find(building => building.buildingId === 'irrigation')!.amount > 0);
  assert.equal(labor(food.state, food.seat).assessment.pause, null);
  const learning = fixture({ recipe: 'academy' });
  completeCivics(learning.state, learning.seat);
  const arrangement = action(learning.state, learning.seat, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [{ slotType: 'economic', slotIndex: 0, policyId: 'learning-patronage' }] });
  const state = arrangement.state;
  const opening = projectOperationAllocation(state);
  const output = cityResourceProduction(opening, source(opening), 'science').buildings.find(building => building.buildingId === 'academy')!;
  assert.ok(output.policyContribution);
  assert.equal(output.policyContribution.percent, 25);
  assert.equal(output.policyContribution.bonusScience, cents(output.policyContribution.unboostedScience * 0.25));
  assert.equal(output.amount, cents(output.policyContribution.unboostedScience + output.policyContribution.bonusScience));
  assert.equal(labor(state, learning.seat).assessment.pause, null);
  assert.ok(options(state, learning.seat).some(option => sameAction(option.action, toggle('academy', false))));
});

void test('L4 one-cent growing-household budget and one-pause staffing boundaries retain exact refusals', context => {
  const { state, seat } = fixture();
  const witness = positive(state, seat).assessment.witness!;
  const minimumFood = Math.max(witness.currentTowns.protectedBudget.ordinary.food, witness.departure.protectedBudget.ordinary.food);
  const exact = structuredClone(state);
  exact.civilizations[seat]!.resources.food = minimumFood;
  assert.ok(isWorldState(exact));
  positive(exact, seat);
  const short = structuredClone(exact);
  short.civilizations[seat]!.resources.food = cents(minimumFood - 0.01);
  const refused = labor(short, seat);
  assert.equal(refused.assessment.pause, null);
  const shortOff = structuredClone(short);
  source(shortOff).buildingOperations!.kiln!.enabled = false;
  const shortFunding = createCoastalOpportunity(shortOff, seat, options(shortOff, seat)).assessment({ type: 'settle-coast', sourceCityId: sourceId, tileId: witness.tileId });
  assert.match(shortFunding.reason!, /opening-budget/);
  const insufficient = structuredClone(state);
  install(insufficient, source(insufficient), 'academy');
  assert.ok(isWorldState(insufficient));
  const tooMany = labor(insufficient, seat);
  assert.equal(tooMany.assessment.pause, null);
  assert.equal(source(insufficient).buildingOperations!.kiln!.enabled, true);
  assert.equal(source(insufficient).buildingOperations!.irrigation!.enabled, true);
  context.diagnostic(JSON.stringify({ minimumFood, shortFood: short.civilizations[seat]!.resources.food, budgetReason: refused.assessment.reason, staffingReason: tooMany.assessment.reason }));
});

void test('L4 capability, target, reached goal and exhausted action admission cannot create an expansion pause', () => {
  const { state, seat } = fixture();
  const noYard = structuredClone(state);
  source(noYard).buildings = source(noYard).buildings.filter(id => id !== 'boat-yard');
  const noNavigation = structuredClone(state);
  noNavigation.civilizations[seat]!.technologies = noNavigation.civilizations[seat]!.technologies.filter(id => id !== 'navigation');
  const noTarget = structuredClone(state);
  for (const option of options(noTarget, seat)) {
    const proposed = option.action;
    if (proposed.type === 'settle-coast') noTarget.tiles.find(tile => tile.id === proposed.tileId)!.owner = (seat + 1) % state.civilizations.length;
  }
  for (const variant of [noYard, noNavigation, noTarget]) {
    assert.ok(isWorldState(variant));
    assert.equal(labor(variant, seat).assessment.pause, null);
    assert.equal(labor(variant, seat).assessment.suppressedResume, null);
  }
  const reached = structuredClone(state);
  const goal = civilizationBehaviorProfile(seed, seat, behaviorPolicyVersion(state)).settlementGoal;
  while (reached.cities.filter(city => city.civId === seat).length < goal) {
    const tile = reached.tiles.find(tile => foundingSiteEligible(reached, tile));
    assert.ok(tile);
    const city: City = { id: `synthetic-goal-${reached.cities.length}`, name: 'Explicit reached-goal town', civId: seat, tileId: tile.id, ...ECONOMY_RULES.initialCity, focus: 'growth', buildings: [], housing: { ruleVersion: 1, origin: 'founded', establishedRound: 0, baseCapacity: 8 }, construction: { active: null, lastCompleted: null } };
    reached.cities.push(city); tile.owner = seat;
  }
  assert.ok(isWorldState(reached));
  assert.equal(labor(reached, seat).assessment.pause, null);
  const pause = positive(state, seat).assessment.pause!;
  const at = timestamp(state, seat);
  const paid = action(state, seat, pause);
  assert.deepEqual(legalActions(paid.state, seat, at), []);
  const noAdmission = assessCivilizationBehavior(paid.state, seat, createBehaviorMemory(paid.state, seat), []);
  assert.equal(noAdmission.expansionLabor?.assessment.pause ?? null, null);
  assert.equal(noAdmission.expansionLabor?.assessment.suppressedResume ?? null, null);
  assert.equal(chooseCivilizationBehavior(paid.state, seat, createBehaviorMemory(paid.state, seat), at).action, null);
});

void test('L5 currently legal resume is paired statelessly without cascade, unrelated suppression or mutation', () => {
  const { state, seat } = fixture();
  const proposal = positive(state, seat).assessment.pause!;
  const paused = action(state, seat, proposal).state;
  const current = labor(paused, seat);
  assert.equal(current.assessment.pause, null);
  assert.deepEqual(current.assessment.suppressedResume, toggle('kiln', true));
  assert.equal(current.work.allocationProjections, 8);
  assert.ok(options(paused, seat).some(option => sameAction(option.action, toggle('kiln', true))));
  assert.ok(!options(paused, seat).some(option => sameAction(option.action, toggle('kiln', false))));
  const memory = createBehaviorMemory(paused, seat);
  const before = structuredClone(paused);
  const memories = structuredClone(state.civilizations.map(actor => createBehaviorMemory(paused, actor.id)));
  const assessed = assess(paused, seat, memory);
  assert.equal(assessed.candidates.find(candidate => sameAction(candidate.option.action, toggle('kiln', true)))!.weight, 0);
  assert.deepEqual(labor(JSON.parse(JSON.stringify(paused)) as WorldState, seat).assessment, current.assessment);
  assert.deepEqual(paused, before);
  assert.deepEqual(state.civilizations.map(actor => createBehaviorMemory(paused, actor.id)), memories);
  const stock = structuredClone(paused);
  stock.civilizations[seat]!.resources.food = 0;
  const target = structuredClone(paused);
  for (const option of options(target, seat)) {
    const proposed = option.action;
    if (proposed.type === 'settle-coast') target.tiles.find(tile => tile.id === proposed.tileId)!.owner = (seat + 1) % state.civilizations.length;
  }
  const obligation = structuredClone(paused);
  install(obligation, source(obligation), 'academy');
  for (const invalid of [stock, target, obligation]) {
    assert.ok(isWorldState(invalid));
    assert.equal(labor(invalid, seat).assessment.suppressedResume, null);
  }
  const ambiguity = structuredClone(state);
  source(ambiguity).population = 12;
  install(ambiguity, source(ambiguity), 'academy');
  source(ambiguity).buildingOperations!.academy!.enabled = false;
  source(ambiguity).buildingOperations!.kiln!.enabled = false;
  assert.ok(isWorldState(ambiguity));
  const ambiguous = labor(ambiguity, seat);
  assert.equal(ambiguous.assessment.pause, null);
  assert.equal(ambiguous.assessment.suppressedResume, null);
  assert.match(ambiguous.assessment.reason, /ambig|multiple|resume/i);
  const required = structuredClone(state);
  required.civilizations[seat]!.researchTarget = '';
  const requiredAssessment = assess(required, seat);
  assert.equal(requiredAssessment.expansionLabor!.assessment.pause, null);
  const choice = chooseCivilizationBehavior(required, seat, createBehaviorMemory(required, seat), timestamp(required, seat));
  assert.ok(choice.explanation.required);
  assert.equal(choice.action?.type, 'research');
});

function consentingRoute(state: WorldState, seat: number, exactSource = false) {
  const option = availableTradeActions(state, seat).filter(option => option.action.type === 'propose-trade' && option.action.recipeId === 'harvest-for-materials' && (!exactSource || option.action.sourceCityId === sourceId) && option.tradeQuote?.transport.mode === 'land' && option.tradeQuote.transport.edges <= 12).toSorted((a, b) => a.tradeQuote!.transport.edges - b.tradeQuote!.transport.edges || JSON.stringify(a.action).localeCompare(JSON.stringify(b.action)))[0];
  assert.ok(option?.action.type === 'propose-trade', 'Fixed geography needs an exact current consenting land corridor');
  const proposed = action(state, seat, option.action).state;
  const offer = proposed.tradeOffers!.at(-1)!;
  const accepted = action(proposed, option.action.partner, { type: 'respond-trade', offerId: offer.id, accept: true }).state;
  const route = accepted.routes.find(route => route.agreement?.offerId === offer.id)!;
  assert.ok(route.agreement!.enabled);
  return { state: accepted, routeId: route.id, partner: option.action.partner, recipientCityId: option.action.recipientCityId! };
}

void test('L3 a real accepted route protects its opening obligations at the exact one-cent boundary', context => {
  const initial = fixture();
  const free = positive(initial.state, initial.seat).assessment.witness!;
  const routed = consentingRoute(initial.state, initial.seat);
  const before = structuredClone(routed.state.routes);
  const witness = positive(routed.state, initial.seat).assessment.witness!;
  assert.ok(witness.departure.protectedBudget.ordinary.food > free.departure.protectedBudget.ordinary.food || witness.departure.protectedBudget.ordinary.energy > free.departure.protectedBudget.ordinary.energy);
  const minimum = Math.max(witness.departure.protectedBudget.ordinary.food, witness.currentTowns.protectedBudget.ordinary.food);
  const exact = structuredClone(routed.state);
  exact.civilizations[initial.seat]!.resources.food = minimum;
  positive(exact, initial.seat);
  const short = structuredClone(exact);
  short.civilizations[initial.seat]!.resources.food = cents(minimum - 0.01);
  assert.equal(labor(short, initial.seat).assessment.pause, null);
  const hypothetical = structuredClone(short);
  source(hypothetical).buildingOperations!.kiln!.enabled = false;
  const founding = { type: 'settle-coast', sourceCityId: sourceId, tileId: witness.tileId } as const;
  const funding = createCoastalOpportunity(hypothetical, initial.seat, options(hypothetical, initial.seat)).assessment(founding);
  assert.equal(funding.hold, true);
  assert.match(funding.reason!, /opening-budget/);
  assert.deepEqual(routed.state.routes, before);
  context.diagnostic(JSON.stringify({ routeId: routed.routeId, minimumFood: minimum, ordinaryBudget: witness.departure.protectedBudget.ordinary, shortReason: funding.reason }));
});

void test('L3 actually accepted exact teaching institution cannot become labor despite current legal pause', context => {
  const initial = fixture({ recipe: 'academy', wellbeing: 50 });
  let state = initial.state;
  const seat = initial.seat;
  syntheticTechnologies(state, seat, ['engineering']);
  completeCivics(state, seat);
  const center = state.tiles.find(tile => tile.id === source(state).tileId)!;
  const land = createLandTransportPlanner(state);
  const teachingSite = state.tiles.find(tile => foundingSiteEligible(state, tile) && hexDistance(center, tile) === 2 && (land.quote(center.id, tile.id)?.edges ?? Infinity) <= 12);
  assert.ok(teachingSite, 'The fixed natural source must support an explicitly neighboring teaching town');
  const neighboringLearner: City = { id: 'synthetic-labor-learner', name: 'Explicit neighboring teaching prerequisite', civId: (seat + 1) % state.civilizations.length, tileId: teachingSite.id, ...ECONOMY_RULES.initialCity, focus: 'research', buildings: [], housing: { ruleVersion: 1, origin: 'founded', establishedRound: 0, baseCapacity: 8 }, construction: { active: null, lastCompleted: null } };
  teachingSite.owner = neighboringLearner.civId;
  state.cities.push(neighboringLearner);
  assert.ok(isWorldState(state));
  const routed = consentingRoute(state, seat, true);
  assert.equal(routed.recipientCityId, neighboringLearner.id);
  state = routed.state;
  const learner = state.civilizations[routed.partner]!;
  const learnerTown = state.cities.find(city => city.id === routed.recipientCityId)!;
  learnerTown.population = 6;
  learnerTown.wellbeing = 50;
  install(state, learnerTown, 'academy');
  const target = TECHNOLOGIES.find(technology => technology.id === 'engineering')!;
  syntheticTechnologies(state, learner.id, target.requires);
  assert.ok(!learner.technologies.includes(target.id));
  learner.researchTarget = target.id;
  learner.researchProgress = 0;
  assert.ok(isWorldState(state));
  for (let count = 0; count < 6 && state.routes.find(route => route.id === routed.routeId)!.agreement!.deliveryCount === 0; count++) state = beat(state).state;
  assert.equal(state.routes.find(route => route.id === routed.routeId)!.agreement!.deliveryCount, 1);
  const proposal = availableKnowledgeActions(state, seat).find(option => option.action.type === 'propose-knowledge' && option.action.routeId === routed.routeId && option.action.teacherCityId === sourceId && option.action.teacherInstitutionId === 'academy' && option.action.learnerInstitutionId === 'academy' && option.action.technologyId === 'engineering');
  assert.ok(proposal?.action.type === 'propose-knowledge', 'Real prior trade shipment and paid institution output must admit exact teaching');
  state = action(state, seat, proposal.action).state;
  const compact = state.knowledge!.active.find(compact => compact.terms.teacherId === seat)!;
  state = action(state, routed.partner, { type: 'respond-knowledge', compactId: compact.id, accept: true }).state;
  assert.equal(state.knowledge!.active.find(item => item.id === compact.id)!.status, 'accepted');
  for (const city of state.cities.filter(city => city.civId === seat && !city.construction?.active)) {
    syntheticTechnologies(state, seat, ['masonry']);
    state = action(state, seat, { type: 'build', cityId: city.id, project: city.buildings.includes('granary') ? 'monument' : 'granary' }).state;
  }
  const before = structuredClone(state);
  const opening = projectOperationAllocation(state);
  assert.equal(source(opening).buildingOperations!.academy!.lastResult!.status, 'operated');
  assert.ok(options(state, seat).some(option => sameAction(option.action, toggle('academy', false))));
  const result = labor(state, seat);
  assert.equal(result.assessment.pause, null);
  assert.equal(result.assessment.suppressedResume, null);
  assert.match(result.assessment.reason, /ineligible|institution|protected|obstruction/i);
  assert.deepEqual(state, before);
  context.diagnostic(JSON.stringify({ compactId: compact.id, routeId: routed.routeId, sourceInstitution: `${sourceId}/academy`, accepted: true, actualPriorDelivery: state.routes.find(route => route.id === routed.routeId)!.agreement!.deliveryCount, reason: result.assessment.reason }));
});

void test('L3 accepted civic crew and already-paid additional recipe cannot be discarded to manufacture departure', () => {
  const initial = fixture();
  completeCivics(initial.state, initial.seat);
  const commission = availableCivicWorksActions(initial.state, initial.seat).find(option => option.action.type === 'commission-civic-works' && option.action.cityId === sourceId);
  assert.ok(commission, 'The real paid non-housing Workshop should admit its exact civic commission');
  const commissioned = action(initial.state, initial.seat, commission.action).state;
  const before = structuredClone(commissioned);
  assert.equal(labor(commissioned, initial.seat).assessment.pause, null);
  assert.deepEqual(commissioned, before);
  const pending = fixture({ pending: 'academy' });
  const order = structuredClone(source(pending.state).construction!.active!);
  assert.ok(!('kind' in order));
  assert.equal(order.buildingId, 'academy');
  assert.deepEqual(order.paid, BUILDINGS.find(building => building.id === 'academy')!.cost);
  const refusal = labor(pending.state, pending.seat);
  assert.equal(refusal.assessment.pause, null);
  assert.deepEqual(source(pending.state).construction!.active, order);
  assert.equal(source(pending.state).buildingOperations!.kiln!.enabled, true);
});

void test('L6 full-menu ordinary chooser pauses, then separately chooses and pays a freshly admitted conserved coastal founding', context => {
  const { state, seat } = fixture();
  const evidence = positive(state, seat).assessment;
  const before = structuredClone(state);
  const outcomes: Array<{ cursor: number; first: string | undefined; second?: string | undefined }> = [];
  const selected: Array<{ cursor: number; paused: WorldState; founded: WorldState; firstMemory: BehaviorMemory; secondMemory: BehaviorMemory; pauseReason: string; foundingReason: string; events: GameEvent[]; tileId: number; path: number[] }> = [];
  for (const cursor of cursors) {
    const memory = { ...createBehaviorMemory(state, seat), decisionCount: cursor };
    const memoryBefore = structuredClone(memory);
    const first = chooseCivilizationBehavior(state, seat, memory, timestamp(state, seat));
    assert.deepEqual(memory, memoryBefore);
    assert.ok(first.action);
    assert.ok(options(state, seat).some(option => sameAction(option.action, first.action)));
    if (cursor % 16 === 0) process.stdout.write(`# L6 fixed cursor ${cursor}/127\n`);
    const outcome: typeof outcomes[number] = { cursor, first: first.action.type };
    outcomes.push(outcome);
    if (!sameAction(first.action, evidence.pause)) continue;
    assert.equal(first.explanation.required, false);
    assert.match(first.explanation.reason, /conditional|separate/i);
    const pausedResult = action(state, seat, first.action);
    const paused = pausedResult.state;
    assert.equal(paused.cities.length, state.cities.length);
    assert.deepEqual(paused.civilizations.map(actor => actor.resources), state.civilizations.map(actor => actor.resources));
    assert.deepEqual(paused.cities.map(city => city.population), state.cities.map(city => city.population));
    assert.deepEqual(paused.cities.map(city => city.construction), state.cities.map(city => city.construction));
    assert.deepEqual(paused.cities.map(city => city.lastFoodSupply), state.cities.map(city => city.lastFoodSupply));
    const expectedCities = structuredClone(state.cities);
    expectedCities.find(city => city.id === sourceId)!.buildingOperations!.kiln!.enabled = false;
    assert.deepEqual(paused.cities, expectedCities);
    assert.ok(pausedResult.events.every(event => event.type !== 'coastal-founded' && event.type !== 'building-operation' && event.type !== 'settlement-production'));
    assert.ok(Date.parse(timestamp(paused, seat)) > Date.parse(timestamp(state, seat)));
    assert.equal(labor(paused, seat).assessment.pause, null);
    assert.deepEqual(labor(paused, seat).assessment.suppressedResume, toggle('kiln', true));
    const secondMemoryBefore = structuredClone(first.memory);
    const second = chooseCivilizationBehavior(paused, seat, first.memory, timestamp(paused, seat));
    assert.deepEqual(first.memory, secondMemoryBefore);
    outcome.second = second.action?.type;
    if (second.action?.type !== 'settle-coast' || second.action.sourceCityId !== sourceId) continue;
    assert.equal(second.explanation.required, false);
    const exact = options(paused, seat).find(option => sameAction(option.action, second.action));
    assert.ok(exact?.coastalQuote);
    assert.equal(coastalPathBlock(paused, exact.coastalQuote, source(paused).tileId, second.action.tileId), null);
    const funding = createCoastalOpportunity(paused, seat, options(paused, seat)).assessment(second.action);
    assert.equal(funding.hold, false, funding.reason ?? '');
    assert.ok(funding.witness?.mode === 'founding');
    const paid = action(paused, seat, second.action);
    const founded = paid.state;
    const foundedTileId = second.action.tileId;
    const city = founded.cities.find(city => city.tileId === foundedTileId)!;
    assert.equal(founded.cities.length, paused.cities.length + 1);
    assert.equal(source(founded).population, source(paused).population - 3);
    assert.equal(city.population, 3);
    assert.equal(founded.cities.reduce((sum, city) => sum + city.population, 0), paused.cities.reduce((sum, city) => sum + city.population, 0));
    for (const resource of RESOURCE_IDS) assert.equal(founded.civilizations[seat]!.resources[resource], paused.civilizations[seat]!.resources[resource] - (ECONOMY_RULES.settle.cost[resource as keyof typeof ECONOMY_RULES.settle.cost] ?? 0));
    assert.deepEqual(city.coastalFounding!.paid, { food: 10, materials: 12, credits: 8 });
    assert.deepEqual(city.coastalFounding!.pathTileIds, exact.coastalQuote.tileIds);
    const event = paid.events.find(event => event.type === 'coastal-founded');
    assert.ok(event);
    assert.equal(event.id, city.coastalFounding!.eventId);
    assert.deepEqual(event.coastalFounding, city.coastalFounding);
    assert.deepEqual(city.buildings, []);
    assert.equal(city.lastFoodSupply, undefined);
    assert.deepEqual(source(founded).construction, source(paused).construction);
    selected.push({ cursor, paused, founded, firstMemory: first.memory, secondMemory: second.memory, pauseReason: first.explanation.reason, foundingReason: second.explanation.reason, events: paid.events, tileId: city.tileId, path: exact.coastalQuote.tileIds });
  }
  assert.deepEqual(state, before);
  assert.ok(outcomes.some(outcome => outcome.first === 'set-building-operation'), 'Fixed finite corpus must actually choose the optional pause');
  assert.ok(selected.length > 0, `Fixed full-menu two-choice corpus falsified follow-on founding: ${JSON.stringify(outcomes)}`);
  const witness = selected[0]!;
  const opened = projectOperationAllocation(witness.founded);
  const foundedCity = witness.founded.cities.find(city => city.tileId === witness.tileId)!;
  const retainedIrrigation = source(opened).buildingOperations!.irrigation!.lastResult!;
  const expectedIrrigation = cityResourceProduction(opened, source(opened), 'food').buildings.find(building => building.buildingId === 'irrigation')!.amount;
  assert.equal(retainedIrrigation.status, 'operated');
  const expectedFood = cityResourceProduction(opened, opened.cities.find(city => city.id === foundedCity.id)!, 'food').total;
  const next = beat(witness.founded);
  const supplied = next.state.cities.find(city => city.id === foundedCity.id)!;
  assert.equal(supplied.lastFoodSupply!.population, 3);
  assert.equal(supplied.lastFoodSupply!.required, 3.75);
  assert.equal(supplied.lastFoodSupply!.paid, 3.75);
  assert.equal(supplied.lastFoodSupply!.produced, expectedFood);
  assert.equal(supplied.lastFoodSupply!.supplied, true);
  assert.equal(source(next.state).buildingOperations!.kiln!.lastResult!.status, 'paused');
  assert.deepEqual(source(next.state).buildingOperations!.kiln!.lastResult!.paid, {});
  assert.deepEqual(source(next.state).buildingOperations!.kiln!.lastResult!.produced, {});
  assert.equal(source(next.state).buildingOperations!.kiln!.lastResult!.residents!.allocated, 0);
  assert.ok(next.events.some(event => event.type === 'building-operation' && event.detail === `${sourceId}/kiln at strategic round ${next.state.round}`));
  const irrigation = source(next.state).buildingOperations!.irrigation!.lastResult!;
  assert.equal(irrigation.status, 'operated');
  assert.equal(irrigation.residents!.allocated, 3);
  assert.deepEqual(irrigation.paid, { materials: 1 });
  assert.deepEqual(irrigation.produced, { food: expectedIrrigation });
  assert.ok(next.events.some(event => event.type === 'building-operation' && event.detail === `${sourceId}/irrigation at strategic round ${next.state.round}`));
  assert.ok(next.events.some(event => event.type === 'settlement-production' && event.actor === seat));
  context.diagnostic(JSON.stringify({ seed, seat, release, declaredCursors: cursors, allOutcomes: outcomes, pauseCursors: outcomes.filter(outcome => outcome.second !== undefined).map(outcome => outcome.cursor), pairedCursors: selected.map(item => item.cursor), selectedCursor: witness.cursor, beforeRevision: state.revision, pausedRevision: witness.paused.revision, foundedRevision: witness.founded.revision, nextRound: next.state.round, hypotheticalTileId: evidence.witness!.tileId, actualChosenTileId: witness.tileId, path: witness.path, founderReceipt: foundedCity.coastalFounding, laterMealReceipt: supplied.lastFoodSupply, laterPausedOperationReceipt: source(next.state).buildingOperations!.kiln!.lastResult, laterRetainedOperationReceipt: irrigation, pauseReason: witness.pauseReason, foundingReason: witness.foundingReason, naturalCampaign: false, automaticFollowOn: false }));
});

void test('L4 exact slow paid Observatory closure exceeds eighteen beats without relaxing its retained order', () => {
  const { state, seat } = fixture({ recipe: 'kiln', scholars: true, wellbeing: 0, pending: 'observatory' });
  const order = source(state).construction!.active!;
  assert.ok(!('kind' in order));
  assert.equal(order.buildingId, 'observatory');
  assert.equal(order.workRequired, 14);
  assert.ok(order.highGround);
  const before = structuredClone(state);
  const coast = options(state, seat).find(option => option.action.type === 'settle-coast' && option.action.sourceCityId === sourceId)!;
  const funding = createCoastalOpportunity(state, seat, options(state, seat)).assessment(coast.action);
  assert.equal(funding.hold, true);
  assert.match(funding.reason!, /unsupported-horizon/);
  assert.equal(labor(state, seat).assessment.pause, null);
  assert.deepEqual(state, before);
});

void test('L3 actual dispatched residents and exact border operation promises cannot be borrowed by a labor pause', context => {
  const initial = fixture();
  let state = initial.state;
  const seat = initial.seat;
  source(state).population = 11;
  const center = state.tiles.find(tile => tile.id === source(state).tileId)!;
  let pair: { targetId: number; rivalId: number } | undefined;
  for (const target of state.tiles) {
    if (target.owner !== null || target.terrain === 'ocean' || target.terrain === 'mountain' || hexDistance(center, target) !== 1) continue;
    const rival = state.tiles.find(tile => foundingSiteEligible(state, tile) && hexDistance(center, tile) === 2 && hexDistance(target, tile) === 1);
    if (rival) { pair = { targetId: target.id, rivalId: rival.id }; break; }
  }
  assert.ok(pair, 'Fixed source geography needs an actual adjacent purchased border plot');
  const rivalId = (seat + 1) % state.civilizations.length;
  const rival: City = { id: 'synthetic-labor-rival', name: 'Explicit neighboring prerequisite', civId: rivalId, tileId: pair.rivalId, ...ECONOMY_RULES.initialCity, focus: 'industry', buildings: [], housing: { ruleVersion: 1, origin: 'founded', establishedRound: 0, baseCapacity: 8 }, construction: { active: null, lastCompleted: null } };
  state.tiles.find(tile => tile.id === pair!.rivalId)!.owner = rivalId;
  state.cities.push(rival);
  assert.ok(isWorldState(state));
  state = action(state, rivalId, { type: 'acquire-tile', cityId: rival.id, tileId: pair.targetId }).state;
  state = action(state, seat, { type: 'dispatch-border', sourceCityId: sourceId, tileId: pair.targetId, people: 2 }).state;
  assert.equal(source(state).population, 9);
  assert.equal(borderReturnReservations(state, sourceId), 2);
  const incident = state.border!.active.find(incident => incident.initiatorId === seat)!;
  assert.ok(incident.initiator.departure.operationForecast.some(operation => operation.cityId === sourceId && operation.id === 'kiln' && operation.residents === 3));
  const before = structuredClone(state);
  const result = labor(state, seat);
  assert.equal(result.assessment.pause, null);
  assert.equal(result.assessment.suppressedResume, null);
  const off = structuredClone(state);
  source(off).buildingOperations!.kiln!.enabled = false;
  assert.match(createFoundingProtection(off, seat).prepare().failure!, /border-operation-unfunded/);
  const supported = createFoundingProtection(state, seat).fund({ kind: 'current-towns', horizon: 8, setupCost: {}, allocationMode: 'actual-payment', requireEnabledOperations: true });
  assert.ok(supported.facts, supported.reason ?? '');
  const home = supported.facts.households.find(home => home.cityId === sourceId)!;
  assert.equal(home.reservedReturning, 2);
  assert.equal(home.openingPopulation, 11);
  assert.deepEqual(state, before);
  context.diagnostic(JSON.stringify({ incidentId: incident.id, actualHomePopulation: source(state).population, reservedReturning: home.reservedReturning, protectedOpeningPopulation: home.openingPopulation, reason: result.assessment.reason }));
});
