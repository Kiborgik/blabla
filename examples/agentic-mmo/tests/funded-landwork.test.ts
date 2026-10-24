import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLandworkPlanner, type FundedLandworkQuote } from '../core/behavior-landwork.ts';
import { IMPROVEMENTS, PUBLIC_PROJECT_RECIPES } from '../core/content.ts';
import { applyCommand, catchUpStrategy, createWorld } from '../core/engine.ts';
import { availableActions, sameAction } from '../core/simulation/choices.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { executeAction } from '../core/simulation/commands.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { allocatedCityFoodProduction, civilizationFoodUpkeep, householdFoodUpkeep } from '../core/simulation/food-security.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { installImprovement } from '../core/simulation/improvements.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import { executeReliefAction, reliefActionFailure } from '../core/simulation/relief-charters.ts';
import { createTerritoryPlanner } from '../core/simulation/territory.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import { isWorldState } from '../core/validation.ts';
import type { City, GameAction, GameEvent, WorldState } from '../core/types.ts';
import { acceptKnowledge, syntheticKnowledgeCorridor, TEACHER } from './fixtures/knowledge-current.ts';
import { borderBeat, borderEngineAction, dispatchBorder, syntheticBorderCorridor } from './fixtures/border-current.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const cents = (value: number): number => Math.round(value * 100) / 100;
function fixture() {
  const state = createWorld(1701, epoch, 'settlement-supplied-borders-1');
  const city = state.cities[0]!; const actor = state.civilizations[0]!;
  city.population = 8; city.infrastructure = 0; city.wellbeing = 50; city.damage = 0; city.focus = 'industry'; city.buildings = []; city.buildingOperations = {}; city.improvements = {}; city.districtSites = {}; city.construction = { active: null, lastCompleted: null };
  actor.technologies = ['agriculture', 'mining', 'masonry', 'water-management']; actor.era = 0;
  actor.resources = { food: 1000, materials: 1000, energy: 1000, credits: 1000, science: 0, culture: 1000 };
  const planner = createTerritoryPlanner(state);
  const tile = planner.nearby(city).find(tile => planner.assess(0, city.id, tile.id).quote && !planner.assess(0, city.id, tile.id).blocker)!;
  assert.ok(tile); tile.terrain = 'grassland'; tile.elevation = 75; tile.resource = null;
  const owned = planner.nearby(city).find(tile => tile.owner === 0 && tile.id !== city.tileId && !state.cities.some(other => other.tileId === tile.id))!;
  assert.ok(owned); owned.terrain = 'grassland'; owned.elevation = 75; owned.resource = null;
  return { state, city, actor, tile, owned };
}
function findQuote(state: WorldState, city: City, tileId: number, id = 'mine'): FundedLandworkQuote | undefined {
  return createLandworkPlanner(state, city.civId).quote(city.id, tileId).quotes.find(quote => quote.action.type === 'improve' ? quote.action.improvementId === id : quote.action.project === id);
}
function requiredQuote(state: WorldState, city: City, tileId: number, id = 'mine'): FundedLandworkQuote {
  const quote = findQuote(state, city, tileId, id); assert.ok(quote, JSON.stringify(createLandworkPlanner(state, city.civId).quote(city.id, tileId))); return quote;
}
function install(state: WorldState, city: City, tileId: number, id = 'hill-commons') {
  city.construction ??= { active: null, lastCompleted: null };
  const definition = IMPROVEMENTS.find(item => item.id === id)!;
  installImprovement(state, city, { kind: 'improvement', id: `fixture-${city.id}-${tileId}`, cityId: city.id, improvementId: id, tileId, ruleVersion: 1, startedRound: state.round, paid: { ...definition.cost }, workRequired: definition.requiredWork, workDone: definition.requiredWork }, []);
}
function action(state: WorldState, city: City, action: GameAction): GameEvent[] {
  assert.ok(availableActions(state, city.civId).some(option => sameAction(option.action, action)), JSON.stringify(action));
  state.revision++; const events: GameEvent[] = []; executeAction(state, city.civId, action, events); commitEvents(state, events); return events;
}


void test('conditional exact landwork quote is deterministic, immutable, funded and has an identical owned alternative', () => {
  const { state, city, actor, tile, owned } = fixture(); const before = structuredClone(state);
  const planner = createLandworkPlanner(state, 0); const quote = requiredQuote(state, city, tile.id);
  assert.equal(quote.kind, 'conditional-landwork'); assert.equal(quote.revision, state.revision); assert.deepEqual(quote.action, { type: 'improve', cityId: city.id, tileId: tile.id, improvementId: 'mine' });
  assert.equal(quote.firstOperationBeat, 4); assert.equal(quote.protectedHorizon, 5); assert.equal(quote.waitBeats, 0); assert.equal(quote.acquisitionDelayBeats, 1); assert.equal(quote.startDelayBeats, 1);
  assert.deepEqual(quote.setupCost, { materials: 6, credits: 3 }); assert.equal(quote.marginalOutput.materials, 2);
  assert.equal(quote.protectedBudget.ordinary.food, civilizationFoodUpkeep(state, 0) * 5);
  assert.deepEqual(planner.quote(city.id, tile.id), createLandworkPlanner(structuredClone(state), 0).quote(city.id, tile.id));
  assert.strictEqual(planner.quote(city.id, tile.id), planner.quote(city.id, tile.id));
  const alternative = planner.owned(city.id).find(item => item.tileId === owned.id && item.action.type === 'improve' && item.action.improvementId === 'mine');
  assert.ok(alternative); assert.deepEqual(alternative.marginalOutput, quote.marginalOutput); assert.deepEqual(alternative.acquisitionCost, {});
  assert.ok(quote.protectedBudget.ordinary.credits < actor.resources.credits); assert.deepEqual(state, before);
});

void test('real engine acquisition then one payment, delayed completion and a later actual operation establish the quoted use', () => {
  const { state, city, tile } = fixture(); const cityId = city.id; const quote = requiredQuote(state, city, tile.id, 'hill-commons'); const before = { ...state.civilizations[0]!.resources };
  const town = () => state.cities.find(item => item.id === cityId)!;
  assert.ok(isWorldState(state), 'Controlled initial current world must validate before protocol transitions');
  const acquired = borderEngineAction(state, 0, { type: 'acquire-tile', cityId, tileId: tile.id });
  assert.equal(acquired.filter(event => event.type === 'territory-acquired').length, 1); assert.equal(state.civilizations[0]!.resources.materials, before.materials); assert.equal(town().improvements?.[String(tile.id)], undefined);
  const paid = borderEngineAction(state, 0, quote.action); assert.equal(paid.filter(event => event.type === 'construction-started').length, 1);
  assert.equal(state.civilizations[0]!.resources.materials, before.materials - 12); assert.equal(state.civilizations[0]!.resources.credits, before.credits - (quote.acquisitionCost.credits ?? 0) - 6);
  assert.equal(town().construction?.active?.workDone, 0); assert.equal(town().improvements?.[String(tile.id)], undefined);
  let completed = false;
  for (let count = 0; count < 7 && !completed; count++) {
    const events = borderBeat(state); completed = events.some(event => event.type === 'improvement-completed' && event.tileId === tile.id);
    if (!completed) assert.equal(town().improvements?.[String(tile.id)], undefined);
  }
  assert.ok(completed); assert.equal(town().improvements![String(tile.id)]!.operation.lastResult, null);
  assert.deepEqual(town().improvements![String(tile.id)]!.completion.paid, quote.setupCost);
  borderBeat(state); const installed = town().improvements![String(tile.id)]!;
  assert.equal(installed.operation.lastResult?.status, 'operated'); assert.deepEqual(installed.operation.lastResult?.paid, { materials: 1 }); assert.ok((installed.operation.lastResult?.produced.food ?? 0) > 0);
  assert.equal(state.events.filter(event => event.type === 'construction-started' && event.tileId === tile.id).length, 1); assert.ok(isWorldState(state));
});

void test('terrain alone, occupied sites, missing technology and exact town binding do not imply a use', () => {
  const { state, city, tile, owned, actor } = fixture(); actor.technologies = []; assert.equal(createLandworkPlanner(state, 0).quote(city.id, tile.id).quotes.length, 0);
  actor.technologies = ['mining']; tile.elevation = 20; tile.terrain = 'desert'; assert.equal(createLandworkPlanner(state, 0).quote(city.id, tile.id).quotes.length, 0);
  install(state, city, owned.id, 'mine'); assert.equal(createLandworkPlanner(state, 0).quote(city.id, owned.id).quotes.length, 0);
  assert.equal(createLandworkPlanner(state, 1).quote(city.id, tile.id).quotes.length, 0);
});

void test('one paid order may finish within two beats but cannot supply a new prerequisite or be charged twice', () => {
  const { state, city, actor, tile } = fixture(); action(state, city, { type: 'build', cityId: city.id, project: 'workshop' });
  const paidStock = { ...actor.resources }; const quote = requiredQuote(state, city, tile.id);
  assert.equal(quote.orderId, city.construction!.active!.id); assert.equal(quote.waitBeats, 2); assert.equal(quote.firstOperationBeat, 5);
  assert.equal(quote.protectedBudget.ordinary.materials, 6); assert.equal(quote.protectedBudget.ordinary.credits, (quote.acquisitionCost.credits ?? 0) + 3); assert.deepEqual(actor.resources, paidStock);
  city.construction!.active!.workRequired = 8; assert.match(createLandworkPlanner(state, 0).quote(city.id, tile.id).reason ?? '', /wait-horizon/);
});

void test('first operation, zero-work, unsafe horizon and pending government are named refusals', () => {
  const { state, city, tile, actor } = fixture(); city.focus = 'research'; city.wellbeing = 0; city.damage = 80;
  assert.match(createLandworkPlanner(state, 0).quote(city.id, tile.id).reason ?? '', /first-operation-horizon/);
  city.damage = 100; assert.match(createLandworkPlanner(state, 0).quote(city.id, tile.id).reason ?? '', /zero-construction-work/);
  const normal = fixture(); normal.state.round = Number.MAX_SAFE_INTEGER; assert.match(createLandworkPlanner(normal.state, 0).quote(normal.city.id, normal.tile.id).reason ?? '', /unsafe-accounting/);
  actor.government ??= { ruleVersion: 1, lastSpentReformCompletionEventId: null, active: null, pending: null }; actor.government.pending = { targetGovernmentId: 'chiefdom', targetAssignments: [], acceptedRound: 0, completionRound: 2, paidCredits: 0, spentCompletionEventId: null };
  assert.match(createLandworkPlanner(state, 0).quote(city.id, tile.id).reason ?? '', /government-transition/);
});

void test('future ordinary paid-order demand cannot steal a current producer or the apparent spare resident', () => {
  const { state, city, tile, owned } = fixture(); city.population = 6; install(state, city, owned.id, 'mine');
  action(state, city, { type: 'build', cityId: city.id, project: 'irrigation' }); city.construction!.active!.workRequired = 4;
  assert.equal(findQuote(state, city, tile.id), undefined); assert.match(createLandworkPlanner(state, 0).quote(city.id, tile.id).reason ?? '', /operation|resident/);
});

void test('current earlier paid buildings and later numeric sites remain allocated and paused sites stay paused', () => {
  const { state, city, tile, owned } = fixture(); city.population = 4; install(state, city, owned.id); const before = structuredClone(state);
  assert.equal(findQuote(state, city, tile.id), undefined); assert.deepEqual(state, before);
  city.improvements![String(owned.id)]!.operation.enabled = false;
  const quote = requiredQuote(state, city, tile.id); assert.ok(!quote.retainedOperations.includes(`${city.id}/site/${owned.id}`));
  assert.equal(city.improvements![String(owned.id)]!.operation.enabled, false);
  city.buildings = ['irrigation']; city.buildingOperations = { irrigation: { enabled: true, lastResult: null } }; city.population = 6;
  assert.equal(findQuote(state, city, tile.id), undefined);
});

void test('two candidate inputs and every retained operating beat are charged once against opening stock', () => {
  const { state, city, tile, owned, actor } = fixture(); install(state, city, owned.id); const initial = requiredQuote(state, city, tile.id, 'hill-commons');
  assert.equal(initial.protectedBudget.ordinary.materials, 12 + initial.protectedHorizon + 2);
  actor.resources.materials = initial.protectedBudget.ordinary.materials;
  assert.ok(findQuote(state, city, tile.id, 'hill-commons'));
  actor.resources.materials -= 0.01; assert.equal(findQuote(state, city, tile.id, 'hill-commons'), undefined);
});

void test('a later-ID second town shares input stocks and retains its Food operation', () => {
  const { state, city, tile, actor } = fixture();
  const path = createTerritoryPlanner(state).assess(0, city.id, tile.id).quote!.pathTileIds;
  const secondSite = state.tiles.find(item => item.owner === 0 && !path.includes(item.id) && !state.cities.some(town => town.tileId === item.id)); assert.ok(secondSite);
  const second: City = { ...structuredClone(city), id: 'zz-later-town', tileId: secondSite.id, population: 6, buildings: ['irrigation'], buildingOperations: { irrigation: { enabled: true, lastResult: null } }, improvements: {} };
  state.cities.push(second); const quote = requiredQuote(state, city, tile.id, 'hill-commons');
  assert.ok(quote.retainedOperations.includes(`${second.id}/building/irrigation`)); assert.equal(quote.protectedBudget.ordinary.materials, 12 + quote.protectedHorizon + 2);
  actor.resources.materials = 14; assert.equal(findQuote(state, city, tile.id, 'hill-commons'), undefined);
});

void test('district adjacency uses the exact site, current support and quantized actual output, not town-center yield', () => {
  const { state, city, tile, actor } = fixture(); actor.technologies.push('writing'); city.wellbeing = 63; city.damage = 17; city.infrastructure = 7;
  for (const nearby of state.tiles) if (hexDistance(tile, nearby) === 1 && nearby.id !== city.tileId) nearby.terrain = 'mountain';
  const quote = requiredQuote(state, city, tile.id, 'campus'); assert.equal(quote.action.type, 'build'); assert.ok(quote.marginalOutput.science > 3 * cityProductivity(city));
  city.districtSites = Object.fromEntries(['theater-square', 'commercial-hub', 'industrial-zone'].map((id, index) => [id, -10 - index]));
  assert.equal(findQuote(state, city, tile.id, 'campus'), undefined);
});

void test('Food and ordinary output use distinct real productivity and cumulative hundredth quantization', () => {
  const { state, city, tile } = fixture(); city.wellbeing = 67; city.damage = 13; city.infrastructure = 9;
  const food = requiredQuote(state, city, tile.id, 'hill-commons'); const materials = requiredQuote(state, city, tile.id);
  const baseline = projectOperationAllocation(state); const expectedBase = allocatedCityFoodProduction(baseline, baseline.cities[0]!).total;
  const projected = structuredClone(state); projected.tiles.find(item => item.id === tile.id)!.owner = city.civId; install(projected, projected.cities[0]!, tile.id); const allocation = projectOperationAllocation(projected);
  assert.equal(food.marginalOutput.food, cents(allocatedCityFoodProduction(allocation, allocation.cities[0]!).total - expectedBase));
  const actualMine = structuredClone(state); actualMine.tiles.find(item => item.id === tile.id)!.owner = city.civId; install(actualMine, actualMine.cities[0]!, tile.id, 'mine');
  const actualBaseline = structuredClone(state); actualMine.round++; actualBaseline.round++; resolveEconomy(actualMine, []); resolveEconomy(actualBaseline, []);
  assert.equal(materials.marginalOutput.materials, cents(actualMine.civilizations[0]!.resources.materials - actualBaseline.civilizations[0]!.resources.materials));
  assert.ok(materials.marginalOutput.materials > 2 * (0.5 + city.wellbeing / 100) * (1 - city.damage / 100));
});

void test('households and due public contributions cannot be financed from predicted output', () => {
  const { state, city, actor, tile } = fixture(); const quote = requiredQuote(state, city, tile.id);
  actor.resources.food = quote.protectedBudget.ordinary.food - 0.01; assert.equal(findQuote(state, city, tile.id), undefined);
  actor.resources.food = 1000; const recipe = PUBLIC_PROJECT_RECIPES[0]!;
  state.publicProjects = [{ id: 'funded-landwork-public', routeId: 'fixture-route', agreementOfferId: 'fixture-agreement', proposer: 0, recipient: 1, terms: { ...structuredClone(recipe.terms), proposerContribution: { materials: 20 } }, proposedRound: 0, status: 'committed', acceptedRound: 0, dueRound: 7 }];
  actor.resources.materials = 25; assert.equal(findQuote(state, city, tile.id), undefined);
  actor.resources.materials = 26; const funded = requiredQuote(state, city, tile.id); assert.equal(funded.protectedHorizon, 7); assert.equal(funded.protectedBudget.ordinary.materials, 26);
});

void test('accepted Studies preserves selected institutions, contribution and ordinary trade promises together', () => {
  const state = syntheticKnowledgeCorridor(); const compact = acceptKnowledge(state); const city = state.cities.find(item => item.civId === TEACHER)!; const actor = state.civilizations[TEACHER]!;
  city.population = 8; city.focus = 'industry'; city.infrastructure = 2; actor.resources.food = 1000;
  const tile = createTerritoryPlanner(state).nearby(city).find(item => createTerritoryPlanner(state).assess(TEACHER, city.id, item.id).quote)!; assert.ok(tile); tile.terrain = 'grassland'; tile.elevation = 75;
  const quote = requiredQuote(state, city, tile.id); assert.ok(quote.protectedHorizon >= compact.deadlineRound - state.round);
  assert.ok(quote.retainedOperations.includes(`${city.id}/building/academy`));
  assert.ok(quote.protectedBudget.ordinary.culture >= (compact.terms.teacherContribution.culture ?? 0) + quote.protectedHorizon * 2);
  city.buildingOperations!.academy!.enabled = false; assert.equal(findQuote(state, city, tile.id), undefined);
});

void test('Border returning residents remain household obligations, never spare workers, with no setup or operation double charge', () => {
  const state = syntheticBorderCorridor(); const incident = dispatchBorder(state); const city = state.cities.find(item => item.civId === 0)!;
  const tile = createTerritoryPlanner(state).nearby(city).find(item => createTerritoryPlanner(state).assess(0, city.id, item.id).quote)!; assert.ok(tile); tile.terrain = 'grassland'; tile.elevation = 75;
  const quote = requiredQuote(state, city, tile.id); assert.equal(quote.protectedHorizon, incident.returnByRound - state.round);
  assert.equal(quote.protectedBudget.ordinary.food, householdFoodUpkeep(state, city.population + 2) * quote.protectedHorizon);
  assert.equal(quote.protectedBudget.ordinary.materials, 6); assert.equal(quote.protectedBudget.ordinary.credits, (quote.acquisitionCost.credits ?? 0) + 3);
  const owned = createTerritoryPlanner(state).nearby(city).find(item => item.owner === 0 && item.id !== city.tileId)!; owned.elevation = 75; install(state, city, owned.id, 'mine');
  assert.equal(findQuote(state, city, tile.id), undefined);
});

void test('unknown and unsupported Wonder or Rail orders anywhere in the civilization refuse instead of disappearing', () => {
  for (const kind of ['wonder', 'rail'] as const) {
    const { state, city, tile } = fixture();
    city.construction!.active = kind === 'wonder' ? { kind, id: 'unsupported', cityId: city.id, wonderId: 'great-library', tileId: tile.id, ruleVersion: 1, startedRound: 0, paid: {}, workRequired: 2, workDone: 0 }
      : { kind, id: 'unsupported', cityId: city.id, edgeId: 'edge', tileId: city.tileId, toTileId: tile.id, ruleVersion: 1, startedRound: 0, paid: {}, strategicPaid: {}, workRequired: 2, workDone: 0 };
    assert.match(createLandworkPlanner(state, 0).quote(city.id, tile.id).reason ?? '', /unsupported-order/);
  }
  const { state, city, tile } = fixture(); city.construction!.active = { id: 'unknown', cityId: city.id, buildingId: 'unknown', ruleVersion: 1, startedRound: 0, paid: {}, workRequired: 2, workDone: 0 };
  assert.match(createLandworkPlanner(state, 0).quote(city.id, tile.id).reason ?? '', /unsupported-order/);
});

void test('frozen source and observations retain paused records and untouched nested order structures', () => {
  const { state, city, tile, owned } = fixture(); install(state, city, owned.id); city.improvements![String(owned.id)]!.operation.enabled = false;
  action(state, city, { type: 'build', cityId: city.id, project: 'workshop' });
  const lock = (value: unknown): void => { if (value && typeof value === 'object') { for (const item of Object.values(value)) lock(item); Object.freeze(value); } };
  const bytes = JSON.stringify(state); lock(state); const quote = requiredQuote(state, city, tile.id);
  assert.equal(JSON.stringify(state), bytes); assert.ok(Object.isFrozen(quote)); assert.ok(Object.isFrozen(quote.protectedBudget.ordinary)); assert.ok(Object.isFrozen(quote.allocations));
});

void test('actual consenting trade and relief reserves each defeat an otherwise funded purchase without incoming financing', () => {
  const state = syntheticKnowledgeCorridor(); const city = state.cities.find(item => item.civId === TEACHER)!; const actor = state.civilizations[TEACHER]!;
  city.population = 8; city.focus = 'industry'; city.infrastructure = 2; actor.resources.food = 1000;
  const planner = createTerritoryPlanner(state); const tile = planner.nearby(city).find(item => planner.assess(TEACHER, city.id, item.id).quote)!; assert.ok(tile); tile.terrain = 'grassland'; tile.elevation = 75;
  const traded = requiredQuote(state, city, tile.id); actor.resources.food = traded.protectedBudget.ordinary.food - 0.01; assert.equal(findQuote(state, city, tile.id), undefined);
  const noTrade = structuredClone(state); noTrade.routes[0]!.agreement!.enabled = false; assert.ok(findQuote(noTrade, noTrade.cities.find(item => item.id === city.id)!, tile.id));
  actor.resources.food = 1000; state.cities.find(item => item.civId === 4)!.population = 20; state.civilizations[4]!.resources.food = 0;
  const proposal: Extract<GameAction, { type: 'propose-relief' }> = { type: 'propose-relief', routeId: state.routes[0]!.id, sourceCityId: city.id, recipientCityId: 'city-4' };
  assert.equal(reliefActionFailure(state, TEACHER, proposal), null); executeReliefAction(state, TEACHER, proposal, []);
  const acceptance: Extract<GameAction, { type: 'respond-relief' }> = { type: 'respond-relief', charterId: state.relief!.active[0]!.id, accept: true };
  assert.equal(reliefActionFailure(state, 4, acceptance), null); executeReliefAction(state, 4, acceptance, []);
  const relieved = requiredQuote(state, city, tile.id); assert.equal(relieved.protectedBudget.ordinary.food - traded.protectedBudget.ordinary.food, state.relief!.active[0]!.terms.food);
  actor.resources.energy = relieved.protectedBudget.ordinary.energy - 1; assert.equal(findQuote(state, city, tile.id), undefined);
  const noRelief = structuredClone(state); noRelief.relief!.active = []; assert.ok(findQuote(noRelief, noRelief.cities.find(item => item.id === city.id)!, tile.id));
});

void test('retained support and unfinished local Power are not speculative future capacity', () => {
  const { state, city, tile } = fixture();
  city.construction!.active = { id: 'unsupported-observatory', cityId: city.id, buildingId: 'observatory', ruleVersion: 1, startedRound: 0, paid: {}, workRequired: 2, workDone: 0 };
  assert.match(createLandworkPlanner(state, 0).quote(city.id, tile.id).reason ?? '', /unsupported-order-support/);
  city.buildings = ['industrial-zone']; city.districtSites = { 'industrial-zone': -1 };
  city.construction!.active = { id: 'unfinished-power', cityId: city.id, buildingId: 'coal-plant', ruleVersion: 1, startedRound: 0, paid: {}, workRequired: 2, workDone: 0 };
  assert.match(createLandworkPlanner(state, 0).quote(city.id, tile.id).reason ?? '', /unsupported-order-effects/);
});

void test('a different town paid order and current strategic recipe protect future shared inputs without funding output', () => {
  const { state, city, tile, actor } = fixture();
  const path = createTerritoryPlanner(state).assess(0, city.id, tile.id).quote!.pathTileIds;
  const secondSite = state.tiles.find(item => item.owner === 0 && !path.includes(item.id) && !state.cities.some(town => town.tileId === item.id)); assert.ok(secondSite);
  const second: City = { ...structuredClone(city), id: 'zz-paid-town', tileId: secondSite.id, population: 6, construction: { active: { id: 'paid-kiln', cityId: 'zz-paid-town', buildingId: 'kiln', ruleVersion: 1, startedRound: 0, paid: { materials: 10, credits: 8 }, workRequired: 2, workDone: 0 }, lastCompleted: null } };
  state.cities.push(second); const quote = requiredQuote(state, city, tile.id); assert.equal(quote.protectedBudget.ordinary.materials, 6); assert.equal(quote.protectedBudget.ordinary.energy, quote.protectedHorizon * 2);
  assert.equal(quote.marginalOutput.materials, 2); assert.ok(quote.retainedOperations.includes(`${second.id}/building/kiln`));
  actor.resources.energy = quote.protectedBudget.ordinary.energy - 0.01; assert.equal(findQuote(state, city, tile.id), undefined);
  actor.resources.energy = 1000; second.construction!.active = null; city.buildings = ['foundry']; city.buildingOperations = { foundry: { enabled: true, lastResult: null } }; actor.strategicResources = { iron: 100 };
  const strategic = requiredQuote(state, city, tile.id); assert.equal(strategic.protectedBudget.strategic.iron, strategic.protectedHorizon);
  actor.strategicResources.iron = strategic.protectedHorizon - 1; assert.equal(findQuote(state, city, tile.id), undefined);
});

void test('late tactical acquisition funds the mandatory opening before actual follow-on payment and first operation', () => {
  const { state, city, tile, actor } = fixture(); const cityId = city.id; const quoted = requiredQuote(state, city, tile.id);
  assert.equal(quoted.waitBeats, 0); assert.equal(quoted.acquisitionDelayBeats, 1); assert.equal(quoted.startDelayBeats, 1); assert.equal(quoted.firstOperationBeat, 4); assert.equal(quoted.protectedHorizon, 5);
  actor.resources.food = civilizationFoodUpkeep(state, 0) * 4; assert.equal(findQuote(state, city, tile.id), undefined);
  actor.resources.food = quoted.protectedBudget.ordinary.food; assert.ok(findQuote(state, city, tile.id));
  const at = (seconds: number) => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
  const acquired = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: at(50), action: { type: 'acquire-tile', cityId, tileId: tile.id } });
  assert.ok(acquired.ok, acquired.error); Object.assign(state, acquired.state); assert.ok(isWorldState(state));
  const before = structuredClone(state); const denied = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: at(60), action: quoted.action });
  assert.equal(denied.ok, false); assert.match(denied.error ?? '', /strategy_catchup_required/); assert.deepEqual(state, before); assert.deepEqual(denied.state, before);
  const caught = catchUpStrategy(state, at(60)); assert.ok(caught.ok, caught.error); Object.assign(state, caught.state); assert.equal(state.round, 1);
  const started = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: at(60), action: quoted.action });
  assert.ok(started.ok, started.error); Object.assign(state, started.state); assert.equal(state.cities.find(item => item.id === cityId)!.construction!.active!.startedRound, 1);
  for (let round = 2; round <= quoted.protectedHorizon; round++) {
    const advanced = catchUpStrategy(state, at(round * 60)); assert.ok(advanced.ok, advanced.error); Object.assign(state, advanced.state); assert.ok(isWorldState(state));
    const operation = state.cities.find(item => item.id === cityId)!.improvements?.[String(tile.id)]?.operation.lastResult;
    if (round < quoted.firstOperationBeat) assert.equal(operation ?? null, null);
    else { assert.equal(operation?.status, 'operated'); assert.equal(operation?.round, round); }
  }
  assert.equal(state.events.filter(event => event.type === 'improvement-operation' && event.tileId === tile.id).length, 2);
});

void test('acquisition admission beat reserves retained inputs once while owned construction needs no such delay', () => {
  const { state, city, tile, owned, actor } = fixture(); city.buildings = ['irrigation']; city.buildingOperations = { irrigation: { enabled: true, lastResult: null } };
  const bought = requiredQuote(state, city, tile.id); const ownedUse = requiredQuote(state, city, owned.id);
  assert.equal(bought.acquisitionDelayBeats, 1); assert.equal(bought.startDelayBeats, 1); assert.equal(ownedUse.acquisitionDelayBeats, 0); assert.equal(ownedUse.startDelayBeats, 0);
  assert.equal(bought.firstOperationBeat, ownedUse.firstOperationBeat + 1); assert.equal(bought.protectedHorizon, ownedUse.protectedHorizon + 1);
  assert.equal(bought.protectedBudget.ordinary.materials, 6 + bought.protectedHorizon);
  actor.resources.materials = ownedUse.protectedBudget.ordinary.materials; assert.ok(findQuote(state, city, owned.id)); assert.equal(findQuote(state, city, tile.id), undefined);
  actor.resources.materials = bought.protectedBudget.ordinary.materials; assert.ok(findQuote(state, city, tile.id));
  const started = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: new Date(Date.parse(epoch) + 50_000).toISOString(), action: ownedUse.action });
  assert.ok(started.ok, started.error); assert.equal(started.state.cities.find(item => item.id === city.id)!.construction!.active!.startedRound, 0);
});

void test('retained paid-order waiting absorbs acquisition admission instead of charging a second waiting interval', () => {
  const { state, city, tile, owned } = fixture();
  action(state, city, { type: 'improve', cityId: city.id, tileId: owned.id, improvementId: 'mine' });
  const quoted = requiredQuote(state, city, tile.id); assert.equal(quoted.waitBeats, 2); assert.equal(quoted.acquisitionDelayBeats, 1); assert.equal(quoted.startDelayBeats, 2); assert.equal(quoted.firstOperationBeat, quoted.waitBeats + quoted.workBeats + 1);
  city.construction!.active!.workDone = 2; const oneBeat = requiredQuote(state, city, tile.id); assert.equal(oneBeat.waitBeats, 1); assert.equal(oneBeat.startDelayBeats, 1); assert.equal(oneBeat.firstOperationBeat, 4);
  city.construction!.active!.workDone = 0; const at = (seconds: number) => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
  const acquired = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: at(50), action: { type: 'acquire-tile', cityId: city.id, tileId: tile.id } });
  assert.ok(acquired.ok, acquired.error); Object.assign(state, acquired.state);
  const caught = catchUpStrategy(state, at(120)); assert.ok(caught.ok, caught.error); Object.assign(state, caught.state);
  assert.equal(state.cities.find(item => item.id === city.id)!.construction!.active, null);
  const started = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: at(120), action: quoted.action });
  assert.ok(started.ok, started.error); assert.equal(started.state.cities.find(item => item.id === city.id)!.construction!.active!.startedRound, quoted.startDelayBeats);
});
