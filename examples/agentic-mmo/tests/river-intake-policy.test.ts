import assert from 'node:assert/strict';
import test from 'node:test';
import { createRiverIntakePolicy, riverIntakeReason } from '../core/behavior-river-intakes.ts';
import { createLandworkPlanner } from '../core/behavior-landwork.ts';
import { BEHAVIOR_PROFILES } from '../core/behavior-profiles.ts';
import { assessCivilizationBehavior, createBehaviorMemory } from '../core/behaviors.ts';
import { createWorld } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { conditionDrainage, drainageFacts } from '../core/drainage.ts';
import { availableActions } from '../core/simulation/choices.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import type { City, GameAction, HexTile, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const weights = { food: 4, materials: 1, credits: 1, energy: 1, science: 1, culture: 1 };
const policy = (state: WorldState, id = 0) => createRiverIntakePolicy(state, id, weights, 1);
function fixture() {
  const state = createGeneratedWorld(1701, epoch, 'settlement-river-intakes-1');
  const facts = drainageFacts(state.drainage!, state.tiles);
  const pair = state.cities.flatMap(city => state.tiles.filter(tile => tile.id !== city.tileId && !state.cities.some(other => other.tileId === tile.id) && tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && facts[tile.id]!.contributingLandTiles >= 8 && hexDistance(tile, state.tiles.find(value => value.id === city.tileId)!) <= 3).map(tile => ({ city, tile }))).at(0)!;
  assert.ok(pair); const { city, tile } = pair; tile.owner = city.civId;
  syntheticTechnologies(state, city.civId, ['water-management']); syntheticInstitution(state, city.id, 'irrigation');
  city.population = 7; city.wellbeing = 50; city.infrastructure = 0; city.damage = 0; city.focus = 'research';
  const actor = state.civilizations.find(actor => actor.id === city.civId)!;
  actor.resources = { food: 1000, materials: 100, credits: 100, energy: 100, science: 0, culture: 100 };
  const action: Extract<GameAction, { type: 'improve' }> = { type: 'improve', cityId: city.id, tileId: tile.id, improvementId: 'river-intake' };
  assert.ok(isWorldState(state)); return { state, city, tile, actor, action };
}
function install(city: City, tileId: number, enabled = true) {
  city.improvements = { [tileId]: { improvementId: 'river-intake', tileId,
    completion: { kind: 'improvement', orderId: `paid-${city.id}`, cityId: city.id, improvementId: 'river-intake', tileId, startedRound: 0, completedRound: 1, paid: { materials: 8, credits: 4 }, workRequired: 4, eventId: 'synthetic-paid-completion' }, operation: { enabled, lastResult: null } } };
}
function chain(sameActor = false) {
  const state = createWorld(41, epoch, 'settlement-river-intakes-1'); state.round = 2; state.width = 10; state.height = 1;
  const tiles = Array.from({ length: 10 }, (_, id): HexTile => ({ id, q: id, r: 0, terrain: id === 9 ? 'ocean' : 'grassland', elevation: id === 9 ? 10 : 80 - id * 2, resource: null, owner: null }));
  const graph = conditionDrainage(tiles, 10, 1)!; assert.ok(graph); state.tiles = graph.tiles; state.drainage = graph.drainage;
  state.cities = state.cities.slice(0, 2); state.routes = [];
  for (const [i, city] of state.cities.entries()) {
    if (sameActor) city.civId = 0;
    city.tileId = i ? 5 : 6; city.population = 7; city.focus = 'research'; city.wellbeing = 50; city.infrastructure = 0; city.damage = 0;
    city.buildings = ['irrigation']; city.buildingOperations = { irrigation: { enabled: true, lastResult: null } }; city.improvements = {}; city.districtSites = {}; city.construction = { active: null, lastCompleted: null };
    state.tiles[city.tileId]!.owner = city.civId; state.tiles[i ? 8 : 7]!.owner = city.civId;
    const actor = state.civilizations.find(actor => actor.id === city.civId)!; actor.technologies = ['agriculture', 'water-management']; actor.resources = { food: 1000, materials: 100, credits: 100, energy: 100, science: 0, culture: 100 };
  }
  install(state.cities[1]!, 8);
  const city = state.cities[0]!;
  const action: Extract<GameAction, { type: 'improve' }> = { type: 'improve', cityId: city.id, tileId: 7, improvementId: 'river-intake' };
  return { state, city, action };
}

void test('owned intake quote protects opening costs exactly once and feeds actual legal weighted assessment', () => {
  const { state, city, actor, action } = fixture(); const before = structuredClone(state);
  const assessment = policy(state, actor.id)(action); assert.ok(assessment);
  assert.ok(assessment.marginalFood > 0); assert.ok(assessment.weight > 0);
  const quote = assessment.quote;
  assert.deepEqual(quote.setupCost, { materials: 8, credits: 4 }); assert.deepEqual(quote.acquisitionCost, {});
  assert.equal(quote.protectedBudget.ordinary.materials, 8 + quote.protectedHorizon + 2);
  assert.equal(quote.protectedBudget.ordinary.credits, 4);
  assert.ok(quote.retainedOperations.includes(`${city.id}/building/irrigation`));
  assert.ok(quote.allocations.some(item => item.key === `${city.id}/site/${action.tileId}` && item.allocated === 1));
  const options = availableActions(state, actor.id); assert.ok(options.some(option => JSON.stringify(option.action) === JSON.stringify(action)));
  const profile = { ...BEHAVIOR_PROFILES[0]!, resources: weights };
  const scored = assessCivilizationBehavior(state, actor.id, createBehaviorMemory(state, actor.id), options, profile).candidates.find(item => item.option.action.type === 'improve' && item.option.action.improvementId === 'river-intake' && item.option.action.tileId === action.tileId);
  assert.ok(scored); assert.ok(scored.weight > 0);
  assert.match(riverIntakeReason(assessment), /Conditionally fund/); assert.match(riverIntakeReason(assessment), /not a water right or guaranteed harvest/);
  assert.deepEqual(state, before);
});

void test('intake preference refuses missing support staffing opening budget and unowned future-income sites', () => {
  for (const mutation of ['residents', 'support', 'materials', 'food', 'foreign', 'unowned', 'unreleased', 'busy'] as const) {
    const { state, city, actor, tile, action } = fixture();
    if (mutation === 'residents') city.population = 6;
    if (mutation === 'support') city.buildingOperations!.irrigation!.enabled = false;
    if (mutation === 'materials') actor.resources.materials = 8;
    if (mutation === 'food') actor.resources.food = 0;
    if (mutation === 'foreign') tile.owner = (actor.id + 1) % 5;
    if (mutation === 'unowned') tile.owner = null;
    if (mutation === 'unreleased') state.unlockedFeatures = state.unlockedFeatures.filter(id => id !== 'river-intakes');
    if (mutation === 'busy') city.construction = { active: { id: 'paid-busy', cityId: city.id, buildingId: 'farm', tileId: city.tileId, ruleVersion: 1, startedRound: 0, paid: { materials: 8 }, workRequired: 4, workDone: 0 }, lastCompleted: null };
    const before = structuredClone(state); assert.equal(policy(state, actor.id)(action), null, mutation); assert.deepEqual(state, before);
  }
});

void test('whole-world counterfactual refuses foreign displacement without turning it into an engine water right', () => {
  const { state, city, action } = chain(); const before = structuredClone(state);
  const baseline = projectOperationAllocation(state); assert.equal(baseline.cities[1]!.improvements!['8']!.operation.lastResult!.status, 'operated');
  assert.equal(policy(state)(action), null);
  assert.match(createLandworkPlanner(state, 0).quote(city.id, 7).reason ?? '', /voluntary-downstream-protection/);
  install(city, 7);
  const physicallyAllocated = projectOperationAllocation(state);
  assert.equal(physicallyAllocated.cities[0]!.improvements!['7']!.operation.lastResult!.status, 'operated');
  assert.equal(physicallyAllocated.cities[1]!.improvements!['8']!.operation.lastResult!.blockedReason, 'flow-shortage');
  city.improvements = {}; assert.deepEqual(state, before);
});

void test('same-actor downstream displacement is not counted as new marginal Food and paused resume uses full flow counterfactual', () => {
  const own = chain(true); assert.equal(policy(own.state)(own.action), null);
  const foreign = chain(); install(foreign.city, 7, false);
  const resume: Extract<GameAction, { type: 'set-improvement-operation' }> = { type: 'set-improvement-operation', cityId: foreign.city.id, tileId: 7, improvementId: 'river-intake', enabled: true };
  assert.equal(policy(foreign.state)(resume), null);
  foreign.state.cities[1]!.improvements!['8']!.operation.enabled = false;
  const before = structuredClone(foreign.state); const allowed = policy(foreign.state)(resume); assert.ok(allowed); assert.ok(allowed.marginalFood > 0);
  assert.deepEqual(allowed.quote.setupCost, {}); assert.equal(allowed.quote.firstOperationBeat, 1);
  assert.deepEqual(foreign.state, before);
});
