import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCoastalOpportunity, type CoastalOpportunityWitness } from '../core/behavior-coastal-opportunity.ts';
import { exchangePromisedResources } from '../core/behavior-knowledge.ts';
import { ECONOMY_RULES, PUBLIC_PROJECT_RECIPES, RESOURCE_IDS, TECHNOLOGIES, TRADE_RECIPES } from '../core/content.ts';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { cityResourceProduction } from '../core/learning-patronage.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { borderReturnReservations } from '../core/simulation/border-incidents.ts';
import { coastalPathBlock, createCoastalPlanner, foundingSiteEligible, isCoastalSite } from '../core/simulation/coastal.ts';
import { householdFoodUpkeep } from '../core/simulation/food-security.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { cityGrowthFacts, initializeCityHousing } from '../core/simulation/growth.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import { turnAdmission } from '../core/simulation/turns.ts';
import type { ActionOption, City, GameAction, GameEvent, Resources, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const release = 'settlement-learning-patronage-1';
const cents = (value: number): number => Math.round(value * 100) / 100;
type Coast = Extract<GameAction, { type: 'settle-coast' }>;
type Build = Extract<GameAction, { type: 'build' }>;

function technologies(state: WorldState, ids: readonly string[], seat = 0): void {
  const actor = state.civilizations.find(actor => actor.id === seat)!;
  for (const id of ids) {
    const definition = TECHNOLOGIES.find(technology => technology.id === id); assert.ok(definition);
    assert.ok(definition.requiredFeatures.every(feature => state.unlockedFeatures.includes(feature)));
    technologies(state, definition.requires, seat);
    if (!actor.technologies.includes(id)) actor.technologies.push(id);
  }
}

function fixture() {
  const state = createGeneratedWorld(73, epoch, release, 'cultural-toponyms-v1', 'strategic-temperaments-v1');
  const terrain = structuredClone(state.tiles.map(({ id, terrain, elevation }) => ({ id, terrain, elevation })));
  const drainage = structuredClone(state.drainage);
  for (const actor of state.civilizations) actor.resources = { food: 10000, materials: 10000, energy: 10000, credits: 10000, science: 0, culture: 10000 };
  technologies(state, ['water-management', 'civic-institutions']);
  const planner = createCoastalPlanner(state);
  const owned = state.tiles.filter(tile => tile.owner === 0);
  let selected: { sourceTileId: number; tileId: number } | undefined;
  for (const source of state.tiles) {
    if (!foundingSiteEligible(state, source) || !isCoastalSite(state, source.id)) continue;
    const destination = state.tiles.find(tile => foundingSiteEligible(state, tile) && hexDistance(source, tile) > 2
      && owned.every(land => hexDistance(land, tile) > 2) && planner.quote(source.id, tile.id));
    if (destination) { selected = { sourceTileId: source.id, tileId: destination.id }; break; }
  }
  assert.ok(selected, 'The single fixed generated world must contain an unowned coastal source and genuinely new reachable shore');
  const source: City = { id: 'synthetic-coastal-source', name: 'Controlled coastal prerequisite', civId: 0, tileId: selected.sourceTileId,
    ...ECONOMY_RULES.initialCity, population: 8, wellbeing: 50, focus: 'industry', buildings: [], construction: { active: null, lastCompleted: null } };
  initializeCityHousing(state, source, 'founded');
  state.tiles.find(tile => tile.id === source.tileId)!.owner = 0; state.cities.push(source);
  assert.deepEqual(state.tiles.map(({ id, terrain, elevation }) => ({ id, terrain, elevation })), terrain);
  assert.deepEqual(state.drainage, drainage);
  assert.ok(isWorldState(state), 'Controlled stocks, technologies and one synthetic town on untouched generated geography must validate; no natural-history claim');
  const action: Coast = { type: 'settle-coast', sourceCityId: source.id, tileId: selected.tileId };
  const yard: Build = { type: 'build', cityId: source.id, project: 'boat-yard' };
  return { state, source, actor: state.civilizations[0]!, action, yard };
}

function timestamp(state: WorldState, seat = 0): string {
  const value = turnAdmission(state, seat).nextActionAt; assert.ok(value); return value;
}
function options(state: WorldState, seat = 0): ActionOption[] { return legalActions(state, seat, timestamp(state, seat)); }
function assessment(state: WorldState, action: GameAction, seat = 0) { return createCoastalOpportunity(state, seat, options(state, seat)).assessment(action); }
function witness(state: WorldState, action: GameAction): CoastalOpportunityWitness {
  const result = assessment(state, action); assert.ok(result.witness, result.reason ?? 'Expected exact funded coastal witness'); assert.equal(result.hold, false); return result.witness;
}
function readyFixture() {
  const prepared = fixture(); technologies(prepared.state, ['navigation']); prepared.source.buildings.push('boat-yard');
  assert.ok(isWorldState(prepared.state), 'Explicit completed Navigation and Yard prerequisites must validate'); return prepared;
}
function commit(state: WorldState, action: GameAction, seat = 0): WorldState {
  const before = structuredClone(state); const at = timestamp(state, seat);
  assert.ok(options(state, seat).some(option => sameAction(option.action, action)), JSON.stringify(action));
  const command = { seat, timestamp: at, action, expectedRevision: state.revision };
  const result = applyCommand(state, command); assert.ok(result.ok, result.error);
  assert.deepEqual(state, before); assert.ok(isWorldState(result.state), `Actual ${action.type} at revision ${result.state.revision} must validate`);
  assert.deepEqual(applyCommand(JSON.parse(JSON.stringify(state)) as WorldState, command), result);
  return result.state;
}
function beat(state: WorldState, emitted?: GameEvent[]): WorldState {
  const at = turnAdmission(state, 0).nextStrategyAt; assert.ok(at); const before = structuredClone(state);
  const result = catchUpStrategy(state, at); assert.ok(result.ok, result.error); assert.equal(result.state.round, state.round + 1);
  assert.deepEqual(state, before); assert.ok(isWorldState(result.state), `Actual strategic beat ${result.state.round} must validate`);
  assert.deepEqual(catchUpStrategy(JSON.parse(JSON.stringify(state)) as WorldState, at), result); emitted?.push(...result.events); return result.state;
}
function assertPaid(before: Resources, after: Resources, cost: Partial<Resources>): void {
  for (const resource of RESOURCE_IDS) assert.equal(after[resource], cents(before[resource] - (cost[resource] ?? 0)), resource);
}
function acceptedTrade(state: WorldState, cadence = 4): void {
  const source = state.cities.find(city => city.civId === 0)!; const destination = state.cities.find(city => city.civId === 1)!;
  const terms = { ...structuredClone(TRADE_RECIPES.find(recipe => recipe.id === 'harvest-for-materials')!.terms), cadenceRounds: cadence };
  state.tradeOffers ??= [];
  state.tradeOffers.push({ id: 'synthetic-accepted-trade', proposer: 0, recipient: 1, from: source.id, to: destination.id, createdRound: state.round, expiresRound: state.round + 8, status: 'accepted', terms: structuredClone(terms), routeId: 'synthetic-accepted-route' });
  state.routes.push({ id: 'synthetic-accepted-route', from: source.id, to: destination.id, owner: 0, partner: 1, active: true, damage: 0, volume: 0,
    agreement: { offerId: 'synthetic-accepted-trade', terms, enabled: true, acceptedRound: state.round, nextDeliveryRound: state.round + cadence, lastAttemptRound: null, lastDeliveryRound: null, deliveryCount: 0, blockedBy: null, blockedReason: null, closedRound: null } });
  assert.ok(isWorldState(state), 'Controlled accepted legacy-route promise must satisfy current validation');
}

void test('fixed generated geography discovers exact funded missing prerequisites without already-legal sea actions or Science purchase', context => {
  const { state, source, actor, action, yard } = fixture(); const before = structuredClone(state); const choices = options(state);
  assert.equal(choices.some(option => option.action.type === 'settle-coast'), false);
  assert.ok(choices.some(option => sameAction(option.action, yard))); assert.equal(actor.resources.science, 0);
  const planner = createCoastalOpportunity(state, 0, choices); assert.equal(planner.navigationGoal, true);
  const assessed = planner.assessment(yard); const quote = assessed.witness; assert.ok(quote, assessed.reason ?? '');
  assert.equal(assessed.hold, false); assert.equal(quote.kind, 'local-coastal-opportunity'); assert.equal(quote.mode, 'preparation');
  assert.equal(quote.yard, 'missing'); assert.equal(quote.navigation, 'missing'); assert.equal(quote.sourceCityId, source.id); assert.equal(quote.sourceTileId, source.tileId);
  assert.equal(quote.pathTileIds[0], source.tileId); assert.equal(quote.pathTileIds.at(-1), quote.tileId);
  assert.equal(coastalPathBlock(state, { mode: 'coast', ruleVersion: 1, tileIds: [...quote.pathTileIds], edges: quote.pathTileIds.length - 1 }, source.tileId, quote.tileId), null);
  assert.equal(choices.some(option => option.action.type === 'settle' && option.action.tileId === quote.tileId), false);
  assert.equal(quote.protectedHorizon, 8); assert.deepEqual(quote.foundingCost, { food: 10, materials: 12, credits: 8 });
  assert.deepEqual(quote.setupCost, { materials: 14, credits: 10 }); assert.equal(quote.protectedBudget.ordinary.materials, 26); assert.equal(quote.protectedBudget.ordinary.credits, 18); assert.equal(quote.protectedBudget.ordinary.science, 0);
  assert.equal(planner.assessment({ type: 'research', technology: 'navigation' }).hold, false);
  assert.strictEqual(planner.assessment(yard), assessed); assert.ok(Object.isFrozen(quote)); assert.ok(Object.isFrozen(quote.protectedBudget.ordinary)); assert.ok(Object.isFrozen(quote.pathTileIds));
  assert.ok(planner.work.endpointQuotes <= planner.work.sources * state.tiles.length); assert.ok(planner.work.trees <= planner.work.sources); assert.ok(planner.work.visitedTiles <= planner.work.sources * state.tiles.length);
  assert.deepEqual(createCoastalOpportunity(JSON.parse(JSON.stringify(state)) as WorldState, 0, choices.toReversed()).assessment(yard), assessed);
  assert.deepEqual(state, before); assert.equal(assessment(state, action).hold, true);
  context.diagnostic(JSON.stringify({ provenance: 'single seed73 current generated map; synthetic source, stocks and prerequisite technologies; no terrain edits or natural campaign', sourceCityId: source.id, sourceTileId: source.tileId, witness: quote, work: planner.work }));
});

void test('controlled legal engine actions pay Yard once, produce Navigation, separately found three residents and replay exact receipts', context => {
  const initial = fixture(); let state = initial.state; const trace: Array<{ origin: string; revision: number; round: number; action: GameAction }> = [];
  const act = (action: GameAction) => { trace.push({ origin: 'controlled legal engine action, not chooser-selected', revision: state.revision, round: state.round, action }); state = commit(state, action); };
  const opening = structuredClone(state); act(initial.yard);
  assertPaid(opening.civilizations[0]!.resources, state.civilizations[0]!.resources, { materials: 14, credits: 10 });
  const paidOrder = state.cities.find(city => city.id === initial.source.id)!.construction!.active; assert.ok(paidOrder && !('kind' in paidOrder));
  assert.equal(paidOrder.workRequired, 6); assert.equal(paidOrder.workDone, 0); assert.deepEqual(paidOrder.paid, { materials: 14, credits: 10 });
  assert.equal(state.cities.find(city => city.id === initial.source.id)!.buildings.includes('boat-yard'), false);
  assert.equal(options(state).some(option => sameAction(option.action, initial.action)), false);
  const active = witness(state, { type: 'research', technology: 'navigation' }); assert.equal(active.yard, 'active'); assert.deepEqual(active.setupCost, {});
  assert.equal(active.protectedBudget.ordinary.materials, 12); assert.equal(active.protectedBudget.ordinary.credits, 8);
  const beforeResearch = structuredClone(state); act({ type: 'research', technology: 'navigation' });
  assertPaid(beforeResearch.civilizations[0]!.resources, state.civilizations[0]!.resources, {}); assert.equal(state.civilizations[0]!.resources.science, 0);
  assert.equal(state.civilizations[0]!.researchProgress, 0); assert.equal(state.civilizations[0]!.researchTarget, 'navigation');
  assert.deepEqual(state.cities.find(city => city.id === initial.source.id)!.construction!.active, paidOrder);
  const activeResearchSnapshot = structuredClone(state); const busy = createCoastalOpportunity(state, 0, options(state));
  assert.equal(busy.navigationGoal, false); assert.equal(busy.assessment({ type: 'research', technology: 'navigation' }).hold, false); assert.match(busy.assessment({ type: 'research', technology: 'navigation' }).reason!, /active navigation/); assert.deepEqual(state, activeResearchSnapshot);
  let beats = 0; let work = 0; const emitted: GameEvent[] = [];
  while (beats < 18 && (!state.civilizations[0]!.technologies.includes('navigation') || !state.cities.find(city => city.id === initial.source.id)!.buildings.includes('boat-yard'))) {
    const before = structuredClone(state); const produced = before.cities.filter(city => city.civId === 0).reduce((sum, city) => sum + cityResourceProduction(before, city, 'science').total, 0);
    state = beat(state, emitted); beats++;
    if (!before.civilizations[0]!.technologies.includes('navigation')) {
      const remaining = 42 - before.civilizations[0]!.researchProgress; work = cents(work + Math.min(remaining, produced));
      if (!state.civilizations[0]!.technologies.includes('navigation')) assert.equal(state.civilizations[0]!.researchProgress, cents(before.civilizations[0]!.researchProgress + produced));
    }
  }
  assert.ok(state.civilizations[0]!.technologies.includes('navigation'), 'Bounded controlled continuation must produce all42 Science; no upfront bank or ETA'); assert.equal(work, 42);
  const source = state.cities.find(city => city.id === initial.source.id)!; assert.ok(source.buildings.includes('boat-yard'));
  assert.deepEqual(source.construction!.lastCompleted!.paid, { materials: 14, credits: 10 }); assert.equal(source.construction!.lastCompleted!.workRequired, 6);
  const quoted = witness(state, initial.action); assert.equal(quoted.mode, 'founding'); assert.equal(quoted.yard, 'completed'); assert.equal(quoted.navigation, 'completed'); assert.deepEqual(quoted.setupCost, {});
  const beforeFounding = structuredClone(state); const command = { seat: 0, timestamp: timestamp(state), expectedRevision: state.revision, action: initial.action };
  act(initial.action); const founded = state.cities.find(city => city.tileId === initial.action.tileId)!; assert.ok(founded);
  assert.equal(state.cities.reduce((sum, city) => sum + city.population, 0), beforeFounding.cities.reduce((sum, city) => sum + city.population, 0));
  assert.equal(state.cities.find(city => city.id === source.id)!.population, source.population - 3); assert.ok(source.population - 3 >= 3); assert.equal(founded.population, 3);
  assertPaid(beforeFounding.civilizations[0]!.resources, state.civilizations[0]!.resources, { food: 10, materials: 12, credits: 8 });
  assert.deepEqual(founded.coastalFounding, { ruleVersion: 1, sourceCityId: source.id, sourceTileId: source.tileId, destinationTileId: founded.tileId, pathTileIds: [...quoted.pathTileIds], population: 3, paid: { food: 10, materials: 12, credits: 8 }, foundedRound: beforeFounding.round, eventId: founded.coastalFounding!.eventId });
  assert.deepEqual(state.events.find(event => event.id === founded.coastalFounding!.eventId)!.coastalFounding, founded.coastalFounding);
  assert.deepEqual(founded.buildings, []); assert.equal(founded.construction?.active ?? null, null);
  const duplicate = applyCommand(state, command); assert.equal(duplicate.ok, false); assert.deepEqual(duplicate.state, state); assert.deepEqual(duplicate.events, []);
  const completed = emitted.filter(event => event.type === 'building-completed' && event.tileId === source.tileId && event.effects.includes('Completed capability coastal-departure'));
  assert.equal(completed.length, 1); assert.equal(completed[0]!.id, source.construction!.lastCompleted!.eventId);
  context.diagnostic(JSON.stringify({ seed: 73, provenance: 'controlled synthetic prerequisites followed by actual paid engine transitions; no natural uptake claim', actualStrategicBeats: beats, trace, paidYard: source.construction!.lastCompleted, yardCompletionEvents: completed, productiveScience: work, foundingReceipt: founded.coastalFounding }));
});

void test('six-to-three departure cannot sacrifice a currently staffed paid source operation even with abundant future growth and stocks', () => {
  const { state, source, action } = readyFixture(); technologies(state, ['kiln-firing']); source.population = 6; source.buildings.push('kiln'); source.buildingOperations = { kiln: { enabled: true, lastResult: null } };
  assert.ok(isWorldState(state)); assert.equal(projectOperationAllocation(state).cities.find(city => city.id === source.id)!.buildingOperations!.kiln!.lastResult!.status, 'operated');
  const before = structuredClone(state); const denied = assessment(state, action);
  assert.ok(options(state).some(option => sameAction(option.action, action))); assert.equal(denied.hold, true); assert.equal(denied.witness, null); assert.match(denied.reason!, /protected-operation/); assert.deepEqual(state, before);
  source.population = 9; const funded = witness(state, action); assert.deepEqual(funded.retainedOperations, [`${source.id}/building/kiln`]);
  assert.equal(funded.protectedBudget.ordinary.energy, 2 * funded.protectedHorizon);
  assert.ok(funded.allocations.some(allocation => allocation.openingPopulation === 6 && allocation.allocated === 3));
});

void test('combined Yard and founding stocks are reserved together, and funded ready or active Yard is never charged again', () => {
  const prepared = fixture(); prepared.actor.resources.materials = 25; prepared.actor.resources.credits = 18;
  assert.ok(options(prepared.state).some(option => sameAction(option.action, prepared.yard)));
  assert.equal(assessment(prepared.state, prepared.yard).hold, true); assert.match(assessment(prepared.state, prepared.yard).reason!, /opening-budget/);
  prepared.actor.resources.materials = 26; assert.equal(witness(prepared.state, prepared.yard).protectedBudget.ordinary.materials, 26);
  const paid = commit(prepared.state, prepared.yard); const active = witness(paid, { type: 'research', technology: 'navigation' });
  assert.deepEqual(active.setupCost, {}); assert.equal(paid.civilizations[0]!.resources.materials, 12); assert.equal(active.protectedBudget.ordinary.materials, 12);
  const ready = readyFixture(); ready.actor.resources.materials = 12; ready.actor.resources.credits = 8;
  assert.equal(witness(ready.state, ready.action).protectedBudget.ordinary.materials, 12); assert.deepEqual(witness(ready.state, ready.action).setupCost, {});
  ready.actor.resources.credits = 7.99; assert.equal(assessment(ready.state, ready.action).hold, true);
});

void test('accepted promises are charged once and necessary current horizons18 versus19 are supported versus refused', () => {
  const { state, action, actor } = readyFixture(); acceptedTrade(state, 18);
  const terms = { ...structuredClone(PUBLIC_PROJECT_RECIPES[0]!.terms), completionDelayRounds: 18 };
  state.publicProjects!.push({ id: 'synthetic-committed-public', routeId: state.routes[0]!.id, agreementOfferId: state.routes[0]!.agreement!.offerId, proposer: 0, recipient: 1, terms, proposedRound: 0, status: 'committed', acceptedRound: 0, dueRound: 18 });
  assert.ok(isWorldState(state), 'Explicit synthetic accepted long-dated promises must be canonical retained records');
  const funded = witness(state, action); const promises = exchangePromisedResources(state, 0, 18);
  assert.equal(funded.protectedHorizon, 18); assert.equal(funded.protectedBudget.ordinary.materials, 12 + promises.ordinary.materials); assert.equal(funded.protectedBudget.ordinary.energy, promises.ordinary.energy);
  assert.equal(funded.protectedBudget.ordinary.food, cents(10 + promises.ordinary.food + funded.households.reduce((sum, home) => sum + home.householdFood + home.growthFood, 0)));
  actor.resources = { ...funded.protectedBudget.ordinary }; assert.ok(witness(state, action)); actor.resources.materials -= 0.01; assert.equal(assessment(state, action).hold, true);
  actor.resources = { food: 10000, materials: 10000, energy: 10000, credits: 10000, science: 0, culture: 10000 };
  const project = state.publicProjects![0]!; assert.equal(project.status, 'committed'); if (project.status === 'committed') { project.terms.completionDelayRounds = 19; project.dueRound = 19; }
  assert.ok(isWorldState(state)); const refused = assessment(state, action); assert.equal(refused.hold, true); assert.match(refused.reason!, /horizon/);
});

void test('base-town aftermath reserves reopened source housing, future newborn households and already-paid housing without a Farm adapter', () => {
  const { state, source, action, actor } = readyFixture(); source.population = 8;
  const funded = witness(state, action); const home = funded.households.find(item => item.cityId === source.id)!; const arriving = funded.households.find(item => item.prospective)!;
  assert.equal(funded.protectedHorizon, 8); assert.equal(home.openingPopulation, 5); assert.equal(home.capacity, 8); assert.equal(home.growthCount, 3);
  assert.equal(arriving.openingPopulation, 3); assert.equal(arriving.capacity, 8); assert.equal(arriving.growthCount, 5);
  assert.equal(arriving.householdFood, [3, 4, 5, 6, 7, 8, 8, 8].reduce((sum, population) => sum + householdFoodUpkeep(state, population), 0));
  assert.equal(arriving.growthFood, 6 + 7 + 7 + 7 + 7); assert.deepEqual(funded.setupCost, {});
  actor.resources.food = funded.protectedBudget.ordinary.food - 0.01; assert.equal(assessment(state, action).hold, true); actor.resources.food = 10000;
  technologies(state, ['masonry']); const housingBefore = cityGrowthFacts(state, source).capacity;
  const paid = commit(state, { type: 'build', cityId: source.id, project: 'granary' }); const paidOrder = structuredClone(paid.cities.find(city => city.id === source.id)!.construction!.active);
  const pending = witness(paid, action); const protectedHome = pending.households.find(item => item.cityId === source.id)!;
  assert.equal(protectedHome.capacity, housingBefore + 4); assert.equal(protectedHome.growthCount, 7); assert.equal(pending.protectedBudget.ordinary.materials, 12); assert.equal(pending.protectedBudget.ordinary.credits, 8);
  assert.deepEqual(paid.cities.find(city => city.id === source.id)!.construction!.active, paidOrder);
});

void test('current destination claims and a valid naturally inland source invalidate the exact old departure without rewriting generated terrain', () => {
  const { state, action } = readyFixture(); assert.ok(witness(state, action));
  const claimed = structuredClone(state); claimed.tiles.find(tile => tile.id === action.tileId)!.owner = 1; assert.ok(isWorldState(claimed));
  assert.equal(assessment(claimed, action).hold, true); assert.equal(options(claimed).some(option => sameAction(option.action, action)), false);
  const inland = structuredClone(state); const town = inland.cities.find(city => !isCoastalSite(inland, city.tileId));
  assert.ok(town, 'The fixed generated world must retain a naturally inland owned capital'); town.buildings.push('boat-yard');
  technologies(inland, ['navigation'], town.civId);
  const inlandAction: Coast = { ...action, sourceCityId: town.id };
  assert.ok(isWorldState(inland), 'An explicit synthetic completed Yard at the natural inland source does not invent an ocean path');
  assert.deepEqual(inland.drainage, state.drainage); assert.equal(createCoastalPlanner(inland).quote(town.tileId, action.tileId), null);
  const before = structuredClone(inland); assert.equal(assessment(inland, inlandAction, town.civId).hold, true); assert.deepEqual(inland, before);
  const planner = createCoastalOpportunity(state, 0, options(state)); assert.ok(planner.assessment(action).witness);
  state.revision++; assert.equal(planner.assessment(action).hold, true); assert.match(planner.assessment(action).reason!, /stale/);
});

void test('actual dispatched residents are reserved in source households once and never lent to post-founding paid staffing', () => {
  const prepared = readyFixture(); let state = prepared.state; const center = state.tiles.find(tile => tile.id === prepared.source.tileId)!;
  let pair: { targetId: number; rivalId: number } | undefined;
  for (const target of state.tiles) {
    if (target.owner !== null || target.terrain === 'ocean' || target.terrain === 'mountain' || hexDistance(center, target) !== 1) continue;
    const rival = state.tiles.find(tile => foundingSiteEligible(state, tile) && hexDistance(center, tile) === 2 && hexDistance(target, tile) === 1);
    if (rival) { pair = { targetId: target.id, rivalId: rival.id }; break; }
  }
  assert.ok(pair, 'The fixed generated source must have a natural adjacent purchasable rival plot and nonadjacent town site');
  const rival: City = { id: 'synthetic-border-neighbor', name: 'Controlled border prerequisite', civId: 1, tileId: pair.rivalId,
    ...ECONOMY_RULES.initialCity, focus: 'industry', buildings: [], construction: { active: null, lastCompleted: null } };
  initializeCityHousing(state, rival, 'founded'); state.tiles.find(tile => tile.id === rival.tileId)!.owner = 1; state.cities.push(rival);
  assert.ok(isWorldState(state), 'Controlled rival town retains generated terrain, drainage and all current validators');
  state = commit(state, { type: 'acquire-tile', cityId: rival.id, tileId: pair.targetId }, 1);
  state = commit(state, { type: 'dispatch-border', sourceCityId: prepared.source.id, tileId: pair.targetId, people: 2 });
  const source = state.cities.find(city => city.id === prepared.source.id)!; assert.equal(source.population, 6); assert.equal(borderReturnReservations(state, source.id), 2);
  const funded = witness(state, prepared.action); const home = funded.households.find(item => item.cityId === source.id)!;
  assert.equal(home.openingPopulation, 5); assert.equal(home.reservedReturning, 2); assert.equal(home.capacity, 8); assert.equal(home.growthCount, 3);
  assert.equal(home.householdFood, [5, 6, 7, 8, 8, 8, 8, 8].reduce((sum, population) => sum + householdFoodUpkeep(state, population), 0));
  assert.equal(home.growthFood, 7 + 7 + 7); assert.equal(funded.protectedHorizon, 8);
  technologies(state, ['kiln-firing']); source.buildings.push('kiln'); source.buildingOperations = { kiln: { enabled: true, lastResult: null } };
  assert.ok(isWorldState(state)); assert.equal(projectOperationAllocation(state).cities.find(city => city.id === source.id)!.buildingOperations!.kiln!.lastResult!.status, 'operated');
  const before = structuredClone(state); const refused = assessment(state, prepared.action); assert.equal(refused.hold, true); assert.match(refused.reason!, /protected-operation/); assert.deepEqual(state, before);
});

void test('unrelated active Banking and already-paid Yard stay byte-for-byte unchanged under repeated assessment and restart', () => {
  const { state, yard } = fixture(); technologies(state, ['education']);
  const banking = commit(state, { type: 'research', technology: 'banking' }); const paid = commit(banking, yard); const before = structuredClone(paid);
  const current = createCoastalOpportunity(paid, 0, options(paid));
  for (const action of [yard, { type: 'research' as const, technology: 'navigation' }, { type: 'research' as const, technology: 'banking' }]) {
    const assessed = current.assessment(action); assert.deepEqual(createCoastalOpportunity(JSON.parse(JSON.stringify(paid)) as WorldState, 0, options(paid)).assessment(action), assessed);
  }
  assert.equal(paid.civilizations[0]!.researchTarget, 'banking'); assert.equal(paid.civilizations[0]!.researchProgress, 0); assert.deepEqual(paid, before);
  assert.equal(options(paid).some(option => option.action.type === 'research' && option.action.technology === 'navigation'), false);
});

void test('productive outputs and incoming trade cargo cannot finance absent opening founding stocks', () => {
  const { state, source, action, actor } = readyFixture(); source.buildings.push('workshop'); acceptedTrade(state);
  const capital = state.cities.find(city => city.civId === 0 && city.id !== source.id)!;
  capital.buildings.push('irrigation'); capital.buildingOperations = { irrigation: { enabled: true, lastResult: null } };
  assert.ok(actor.technologies.includes('water-management')); assert.equal(capital.population, 6);
  assert.ok(isWorldState(state), 'Explicit synthetic enabled Irrigation has real current technology, inputs and three local staff');
  assert.equal(projectOperationAllocation(state).cities.find(city => city.id === capital.id)!.buildingOperations!.irrigation!.lastResult!.status, 'operated');
  assert.ok(cityResourceProduction(state, source, 'materials').total > 0);
  assert.equal(state.routes[0]!.agreement!.terms.recipientCargo.materials, 3);
  const funded = witness(state, action); assert.equal(funded.protectedBudget.ordinary.materials, 20); actor.resources.materials = 19.99;
  assert.ok(options(state).some(option => sameAction(option.action, action)), 'The actual12Material founding remains legal while the20Material protected budget is short');
  const before = structuredClone(state); const refused = assessment(state, action); assert.equal(refused.hold, true); assert.match(refused.reason!, /opening-budget/); assert.deepEqual(state, before);
});

void test('claiming every actual shore removes the local bonus and new Yard beneficiary without altering ordinary Navigation legality', () => {
  const { state, yard } = fixture(); const original = createCoastalOpportunity(state, 0, options(state)); assert.equal(original.navigationGoal, true);
  for (const tile of state.tiles) if (foundingSiteEligible(state, tile)) tile.owner = 1;
  assert.ok(isWorldState(state)); const before = structuredClone(state); const current = createCoastalOpportunity(state, 0, options(state));
  assert.equal(current.navigationGoal, false); assert.equal(current.assessment(yard).hold, true); assert.match(current.assessment(yard).reason!, /no-beneficiary/);
  const navigation: GameAction = { type: 'research', technology: 'navigation' };
  assert.ok(options(state).some(option => sameAction(option.action, navigation))); assert.equal(current.assessment(navigation).hold, false); assert.equal(current.assessment(navigation).witness, null);
  assert.deepEqual(state, before);
});

void test('slow new Yard and unsupported paid completion horizons refuse without cancelling sunk work', () => {
  const { state, source, yard } = fixture(); source.damage = 99; assert.ok(isWorldState(state));
  const slow = assessment(state, yard); assert.equal(slow.hold, true); assert.match(slow.reason!, /yard-work-horizon/);
  const normal = fixture(); const paid = commit(normal.state, normal.yard); const town = paid.cities.find(city => city.id === normal.source.id)!; town.damage = 99;
  assert.ok(isWorldState(paid)); const before = structuredClone(paid); const current = createCoastalOpportunity(paid, 0, options(paid));
  assert.equal(current.navigationGoal, false); assert.equal(current.assessment({ type: 'research', technology: 'navigation' }).hold, false); assert.deepEqual(paid, before);
  assert.deepEqual(paid.cities.find(city => city.id === normal.source.id)!.construction!.active, before.cities.find(city => city.id === normal.source.id)!.construction!.active);
  const ready = readyFixture(); technologies(ready.state, ['masonry']);
  const retainedHousing = commit(ready.state, { type: 'build', cityId: ready.source.id, project: 'granary' });
  retainedHousing.cities.find(city => city.id === ready.source.id)!.damage = 99;
  assert.ok(isWorldState(retainedHousing)); assert.ok(options(retainedHousing).some(option => sameAction(option.action, ready.action)));
  const housingBefore = structuredClone(retainedHousing); const unsupported = assessment(retainedHousing, ready.action);
  assert.equal(unsupported.hold, true); assert.match(unsupported.reason!, /unsupported-horizon/); assert.deepEqual(retainedHousing, housingBefore);
});
