import assert from 'node:assert/strict';
import test from 'node:test';
import { exchangePromisedResources } from '../core/behavior-knowledge.ts';
import { createPatronagePolicy } from '../core/behavior-patronage.ts';
import { BEHAVIOR_PROFILES } from '../core/behavior-profiles.ts';
import { BUILDINGS, CIVICS, CIVIC_RULES, IMPROVEMENTS, RESOURCE_IDS } from '../core/content.ts';
import { applyCommand, createWorld } from '../core/engine.ts';
import { conditionDrainage } from '../core/drainage.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { createCoalDeposits, createStrategicDeposits } from '../core/simulation/metals.ts';
import { createPastoralSites } from '../core/simulation/pastoral.ts';
import { borderEngineAction, borderTargetTileId, dispatchBorder } from './fixtures/border-current.ts';
import { createWoodlands } from '../core/simulation/woodlands.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { adoptGovernment, governmentActionBlock, governmentModifiers } from '../core/simulation/government.ts';
import type { City, GameAction, GameEvent, HexTile, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';
import { acceptKnowledge, knowledgeEconomy, tradeAction } from './fixtures/knowledge-current.ts';

const seat = 1;
const epoch = '2026-10-24T00:00:00.000Z';
const profile = BEHAVIOR_PROFILES[seat]!;
const action = (policyId = 'learning-patronage', governmentId = 'chiefdom'): Extract<GameAction, { type: 'adopt-government' }> => ({ type: 'adopt-government', governmentId, assignments: policyId ? [{ policyId, slotType: 'economic', slotIndex: 0 }] : [] });
const q = (amount: number) => Math.round(amount * 100) / 100;
function fixture() {
  const state = createWorld(1701, epoch, 'settlement-learning-patronage-1');
  const actor = state.civilizations[seat]!; actor.era = 1; const city = state.cities.find(city => city.civId === seat)!;
  actor.resources = { food: 20, materials: 100, energy: 100, credits: 100, science: 0, culture: 100 };
  actor.civics!.completedCivicIds = CIVICS.map(civic => civic.id); actor.civics!.active = null;
  actor.civics!.lastCompleted = { civicId: 'state-workforce', completedRound: 0, eventId: 'conditional:reform' };
  actor.civics!.reformEntitlement = { civicId: 'state-workforce', completedRound: 0, completionEventId: 'conditional:reform' };
  actor.government!.active = { governmentId: 'chiefdom', assignments: [], effectiveRound: 0, governmentLockUntilRound: 0, policyLockUntilRound: 0 };
  city.population = 6; city.housing!.baseCapacity = 6; city.wellbeing = 50; city.infrastructure = 0; city.damage = 0; city.focus = 'growth'; city.construction = { active: null, lastCompleted: null };
  syntheticTechnologies(state, seat, ['writing', 'wheel', 'masonry']); syntheticInstitution(state, city.id, 'campus'); syntheticInstitution(state, city.id, 'library');
  actor.researchTarget = 'engineering'; actor.researchProgress = 0;
  return { state, actor, city };
}
const policy = (state: WorldState) => createPatronagePolicy(state, seat, profile.resources, profile.priorities);
function beat(state: WorldState) { state.round++; state.revision++; const events: GameEvent[] = []; resolveEconomy(state, events); return events; }
function paidOrder(state: WorldState, project: string, workDone = 0) {
  const city = state.cities.find(city => city.civId === seat)!;
  const definition = BUILDINGS.find(building => building.id === project)!; syntheticTechnologies(state, seat, definition.requires);
  const result = applyCommand(state, { seat, expectedRevision: state.revision, timestamp: new Date(Date.parse(epoch) + 20000).toISOString(), action: { type: 'build', cityId: city.id, project } });
  assert.ok(result.ok, result.error); assert.equal(result.state.civilizations[seat]!.resources.credits, q(state.civilizations[seat]!.resources.credits - (definition.cost.credits ?? 0)));
  result.state.cities.find(city => city.civId === seat)!.construction!.active!.workDone = workDone;
  return result.state;
}

void test('F1 identity is a zero-price diagnostic, not an admitted identical action', () => {
  const { state } = fixture(); const evaluate = policy(state); const before = structuredClone(state);
  const identity = evaluate.compareUnchanged(); assert.equal(identity.supported, true); assert.equal(identity.diagnosticOnly, true);
  assert.equal(identity.netArrangementGain, 0); assert.equal(identity.paidCredits, 0); assert.ok(RESOURCE_IDS.every(id => identity.netResourceDelta[id] === 0));
  assert.equal(evaluate(action('')).supported, false); assert.match(governmentActionBlock(state, seat, 'chiefdom', [])!, /already active/); assert.deepEqual(state, before);
});

void test('F2 free invariant learning uses later own production rather than four prepaid meals', () => {
  const { state, actor } = fixture(); actor.resources.food = 0; actor.resources.credits = 1;
  const result = policy(state)(action()); assert.equal(result.supported, true, result.reason); assert.ok(result.netArrangementGain > 0);
  assert.equal(result.paidCredits, 0); assert.equal(result.spentReformCompletionEventId, 'conditional:reform');
  assert.ok(result.proposedBeats.every(beat => beat.households.every(town => town.shortfall === 0)));
  assert.ok(result.proposedBeats.every(beat => beat.operations.find(operation => operation.key === 'city-1/building/library')?.status === 'operated'));
});

void test('F3 empty paid transitions charge exactly once and retain two real reduced-output beats', () => {
  const { state, actor } = fixture(); actor.civics!.reformEntitlement = null;
  const result = policy(state)(action('', 'autocracy')); assert.equal(result.supported, true, result.reason); assert.equal(result.paidCredits, 10);
  assert.equal(result.forecastBeats, 6); assert.ok(result.netArrangementGain < 0);
  const actual = structuredClone(state); adoptGovernment(actual, seat, 'autocracy', [], []);
  for (let index = 0; index < result.forecastBeats; index++) {
    actual.round++; assert.equal(governmentModifiers(actual, seat).ordinaryOutputMultiplier, index < 2 ? 0.75 : 1); actual.round--;
    beat(actual); assert.deepEqual(result.proposedBeats[index]!.households.map(town => [town.cityId, town.required, town.paid, town.growthPaid]), actual.cities.filter(city => city.civId === seat).map(city => [city.id, city.lastFoodSupply!.required, city.lastFoodSupply!.paid, city.lastFoodSupply!.growthPaid]));
  }
  assert.equal(result.targetEffectiveRound, 2); assert.equal(result.policyLockUntilRound, 6); assert.equal(result.governmentLockUntilRound, 6);
  const reslot = policy(state)(action()); assert.equal(reslot.supported, true, reslot.reason); assert.equal(reslot.paidCredits, 8);
  actor.civics!.reformEntitlement = { civicId: 'state-workforce', completedRound: 0, completionEventId: 'conditional:reform' };
  const free = policy(state)(action('', 'autocracy')); assert.equal(free.supported, true, free.reason); assert.equal(free.paidCredits, 0);
});

void test('F4 removing retained patronage loses its actual capped useful output', () => {
  const { state, actor } = fixture(); actor.government!.active!.assignments = action().assignments;
  const result = policy(state)(action('')); assert.equal(result.supported, true, result.reason);
  assert.ok(result.netArrangementGain < 0); assert.ok(result.retainedValue > 0); assert.equal(result.proposedValue, 0); assert.ok(result.netResourceDelta.science < 0);
});

void test('F5 missing opening Credits are not funded by positive closing income', () => {
  const { state, actor } = fixture(); actor.civics!.reformEntitlement = null; actor.resources.credits = 8;
  const held = policy(state)(action()); assert.equal(held.supported, false); assert.equal(held.firstAdverseCheckpoint?.beat, 1); assert.match(held.reason, /opening.*library|library.*opening/);
  actor.resources.credits = 9; const funded = policy(state)(action()); assert.equal(funded.supported, true, funded.reason);
  assert.equal(funded.proposedBeats[0]!.operations.find(operation => operation.key.endsWith('/library'))!.status, 'operated');
});

void test('F5 a paid construction purchase is not charged twice and only operates after completion', () => {
  const initial = fixture(); initial.city.population = 9; initial.city.housing!.baseCapacity = 9;
  const state = paidOrder(initial.state, 'university', 13); const before = structuredClone(state); const result = policy(state)(action('urban-planning'));
  assert.equal(result.supported, true, result.reason); assert.ok(!result.proposedBeats[0]!.operations.some(operation => operation.key.endsWith('/university')));
  assert.equal(result.proposedBeats[1]!.operations.find(operation => operation.key.endsWith('/university'))!.paid.credits, 2);
  assert.equal(result.proposedBeats[0]!.netOutput.materials, result.retainedBeats[0]!.netOutput.materials); assert.deepEqual(state, before);
});

void test('F6 common household shortage does not condemn an invariant free learning change', () => {
  const { state, actor, city } = fixture(); actor.resources.food = 0; city.population = 20; city.housing!.baseCapacity = 20; city.wellbeing = 40; city.focus = 'research';
  const result = policy(state)(action()); assert.equal(result.supported, true, result.reason); assert.ok(result.retainedBeats.some(beat => beat.households.some(town => town.shortfall > 0)));
  assert.deepEqual(result.proposedBeats.map(beat => beat.households), result.retainedBeats.map(beat => beat.households));
});

void test('F6 actual growth meals and town order remain visible instead of frozen population', () => {
  const { state, actor, city } = fixture(); actor.resources.food = 100; city.housing!.baseCapacity = 9; city.wellbeing = 65;
  const result = policy(state)(action()); assert.equal(result.supported, true, result.reason); assert.equal(result.proposedBeats[0]!.households[0]!.growthPaid, 7);
  assert.equal(result.proposedBeats[1]!.households[0]!.required, 8.75); assert.equal(result.unpricedPopulationDelta, 0);
});

void test('F7 accepted trade cargo stays reserved and incoming cargo never finances the opening', () => {
  const { state, actor, city } = fixture();
  tradeAction(state, seat, { type: 'propose-trade', partner: 4, recipeId: 'harvest-for-materials', sourceCityId: city.id, recipientCityId: 'city-4' });
  tradeAction(state, 4, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true });
  actor.resources.food = 0; const held = policy(state)(action()); assert.equal(held.supported, false); assert.match(held.reason, /promis/);
  actor.resources.food = 100; const funded = policy(state)(action()); assert.equal(funded.supported, true, funded.reason); assert.ok(funded.reservedPromises.food > 0);
  const actual = structuredClone(state); adoptGovernment(actual, seat, 'chiefdom', action().assignments, []); beat(actual);
  assert.equal(funded.proposedBeats[0]!.closing.food, actual.civilizations[seat]!.resources.food, 'An unescrowed promise is not a first-opening physical debit');
  const snapshot = structuredClone(state); policy(state)(action()); assert.deepEqual(state, snapshot);
});

void test('F7 earlier operation cannot displace a baseline funded Library resident allocation', () => {
  const initial = fixture(); const state = paidOrder(initial.state, 'academy', 4);
  const result = policy(state)(action('urban-planning')); assert.equal(result.supported, false); assert.match(result.reason, /operation|residents|liabilit/);
});

void test('F8 Science is capped at the original current target while raw earned bonus stays attributed', () => {
  const { state, actor } = fixture(); actor.researchTarget = '';
  const noTarget = policy(state)(action()); assert.equal(noTarget.supported, true, noTarget.reason); assert.equal(noTarget.netResourceDelta.science, 0); assert.equal(noTarget.netArrangementGain, 0); assert.ok(noTarget.bonusScience > 0);
  actor.researchTarget = 'engineering'; actor.researchProgress = 143.9;
  const completed = policy(state)(action()); assert.equal(completed.supported, true, completed.reason); assert.equal(completed.netResourceDelta.science, 0); assert.equal(completed.netArrangementGain, 0);
});

void test('F8 liability-producing work outside the bounded protection tail is explicitly unsupported', () => {
  const initial = fixture(); initial.city.population = 9; initial.city.housing!.baseCapacity = 9; initial.actor.resources.food = 100; const state = paidOrder(initial.state, 'university');
  const result = policy(state)(action('urban-planning')); assert.equal(result.supported, false); assert.match(result.reason, /tail|liabilit/);
  assert.ok(result.protectedHorizon > result.forecastBeats); assert.ok(result.protectedHorizon <= result.projectionBeatLimit);
});

void test('F9 exact one-time price is outside discounted recurring resource payments', () => {
  const { state, actor } = fixture(); actor.civics!.reformEntitlement = null; actor.resources.food = 100;
  const result = policy(state)(action()); assert.equal(result.supported, true, result.reason);
  const recurring = result.proposedBeats.slice(0, result.forecastBeats).reduce((sum, beat, index) => sum + RESOURCE_IDS.reduce((value, id) => value + (beat.netOutput[id] - result.retainedBeats[index]!.netOutput[id]) * profile.resources[id] * (id === 'science' ? profile.priorities.research : profile.priorities.construction) / (index + 1), 0), 0);
  assert.ok(Math.abs(result.netArrangementGain - (recurring - 8 * profile.resources.credits)) < 1e-9);
  const before = structuredClone(state); const evaluate = policy(state); evaluate(action()); evaluate(action('urban-planning')); assert.deepEqual(state, before);
});

void test('F10 canonical repeated candidates reuse snapshot-local baseline and bounded projections', () => {
  const { state } = fixture(); const evaluate = policy(state); const first = evaluate(action()); const before = evaluate.diagnostics();
  assert.strictEqual(evaluate({ ...action(), assignments: [...action().assignments].reverse() }), first); const after = evaluate.diagnostics();
  assert.equal(after.projections, before.projections); assert.equal(after.cacheHits, before.cacheHits + 1);
  evaluate(action('urban-planning')); const next = evaluate.diagnostics(); assert.equal(next.baselineProjections, before.baselineProjections);
  assert.ok(next.projectedBeats <= next.projections * next.projectionBeatLimit); assert.equal(CIVIC_RULES.commitmentBeats, 4);
  state.revision++; const stale = evaluate(action()); assert.equal(stale.supported, false); assert.match(stale.reason, /snapshot/);
  assert.notStrictEqual(policy(state)(action()), first);
});

function improvement(city: City, id: string, tileId: number) {
  const definition = IMPROVEMENTS.find(item => item.id === id)!;
  city.improvements ??= {}; city.improvements[String(tileId)] = { improvementId: id, tileId, completion: { kind: 'improvement', orderId: `conditional-${city.id}-${tileId}`, cityId: city.id, improvementId: id, tileId, startedRound: 0, completedRound: 0, paid: { ...definition.cost }, workRequired: definition.requiredWork, eventId: 'conditional:paid-site' }, operation: { enabled: true, lastResult: null } };
}

void test('F7 finite woodland is exhausted and recovers instead of funding perpetual output', () => {
  const { state, actor, city } = fixture(); city.population = 7; city.housing!.baseCapacity = 7; actor.resources.food = 100;
  const tile = state.tiles.find(tile => tile.terrain === 'forest' && tile.owner === seat && !state.cities.some(city => city.tileId === tile.id)); assert.ok(tile);
  syntheticTechnologies(state, seat, ['kiln-firing']); improvement(city, 'charcoal-clearing', tile.id); state.woodlands!.stands[String(tile.id)]!.stock = 1;
  const result = policy(state)(action()); assert.equal(result.supported, true, result.reason);
  const statuses = result.proposedBeats.slice(0, 4).map(beat => beat.operations.find(operation => operation.key === `${city.id}/improvement/${tile.id}`)!);
  assert.deepEqual(statuses.map(operation => operation.status), ['operated', 'blocked', 'operated', 'blocked']);
  assert.deepEqual(statuses.map(operation => operation.woodland), [1, 0, 1, 0]);
  assert.deepEqual(statuses.map(operation => operation.paid.materials ?? 0), [1, 0, 1, 0]);
});

void test('F7 same-owner river withdrawals cannot reuse exhausted downstream flow', () => {
  const { state, actor, city } = fixture(); state.width = 10; state.height = 1;
  const tiles = Array.from({ length: 10 }, (_, id): HexTile => ({ id, q: id, r: 0, terrain: id === 9 ? 'ocean' : 'grassland', elevation: id === 9 ? 10 : 80 - id * 2, resource: null, owner: seat }));
  const drainage = conditionDrainage(tiles, 10, 1)!; state.tiles = drainage.tiles; state.drainage = drainage.drainage; state.woodlands = createWoodlands(state.tiles);
  syntheticTechnologies(state, seat, ['water-management']); actor.resources.food = 200;
  city.id = 'z-upstream'; city.tileId = 6; city.buildings = ['irrigation']; city.buildingOperations = { irrigation: { enabled: true, lastResult: null } }; city.districtSites = {}; city.population = 7; city.housing!.baseCapacity = 7;
  improvement(city, 'river-intake', 7); const downstream = structuredClone(city); downstream.id = 'a-downstream'; downstream.tileId = 5; downstream.improvements = {}; improvement(downstream, 'river-intake', 8);
  state.cities = [city, downstream];
  const result = policy(state)(action()); assert.equal(result.supported, true, result.reason);
  const first = result.proposedBeats[0]!.operations;
  assert.equal(first.find(operation => operation.key === 'z-upstream/improvement/7')!.river, 8);
  assert.equal(first.find(operation => operation.key === 'a-downstream/improvement/8')!.status, 'blocked');
  downstream.civId = 4; const unsupported = policy(state)(action()); assert.equal(unsupported.supported, false); assert.match(unsupported.reason, /mixed-owner river/);
});

void test('F7 local Power and resident allocations remain atomic and opening-funded', () => {
  const { state, actor, city } = fixture(); actor.resources.food = 200; actor.strategicResources = { coal: 2 }; city.population = 9; city.housing!.baseCapacity = 9;
  for (const id of ['coal-plant', 'factory']) { const definition = BUILDINGS.find(building => building.id === id)!; syntheticTechnologies(state, seat, definition.requires); syntheticInstitution(state, city.id, id); }
  const result = policy(state)(action()); assert.equal(result.supported, true, result.reason);
  assert.equal(result.proposedBeats[0]!.operations.find(operation => operation.key.endsWith('/coal-plant'))!.status, 'operated');
  assert.equal(result.proposedBeats[0]!.operations.find(operation => operation.key.endsWith('/factory'))!.power, 3);
  assert.equal(result.proposedBeats[0]!.operations.find(operation => operation.key.endsWith('/library'))!.status, 'blocked');
  assert.equal(result.proposedBeats[1]!.operations.find(operation => operation.key.endsWith('/coal-plant'))!.status, 'blocked');
});

void test('F6 households follow retained town array order rather than operation ID ordering', () => {
  const { state, actor, city } = fixture(); actor.resources.food = 0; city.population = 1; city.housing!.baseCapacity = 1; city.focus = 'research'; city.buildingOperations!.library!.enabled = false;
  const second = structuredClone(city); second.id = 'a-second'; second.population = 20; second.housing!.baseCapacity = 20; second.damage = 90;
  state.cities.push(second); const result = policy(state)(action()); assert.equal(result.supported, true, result.reason);
  assert.deepEqual(result.proposedBeats[0]!.households.map(town => town.cityId), ['city-1', 'a-second']);
  assert.equal(result.proposedBeats[0]!.households[0]!.shortfall, 0); assert.ok(result.proposedBeats[0]!.households[1]!.shortfall > 0);
});

void test('F8 a promise after the value horizon is retained and an excessive horizon is refused', () => {
  const { state, actor, city } = fixture();
  tradeAction(state, seat, { type: 'propose-trade', partner: 4, recipeId: 'harvest-for-materials', sourceCityId: city.id, recipientCityId: 'city-4' });
  tradeAction(state, 4, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true });
  const route = state.routes.find(route => route.agreement?.enabled)!; route.agreement!.nextDeliveryRound = state.round + 9; actor.resources.food = 100;
  const result = policy(state)(action()); assert.equal(result.supported, true, result.reason); assert.equal(result.forecastBeats, 4); assert.equal(result.protectedHorizon, 9); assert.ok(result.reservedPromises.food > 0);
  route.agreement!.nextDeliveryRound = state.round + 19; const unsupported = policy(state)(action()); assert.equal(unsupported.supported, false); assert.match(unsupported.reason, /deadline.*18|18.*bounded/);
});

void test('F3 ordinary transition loss does not multiply authoritative construction work', () => {
  const initial = fixture(); initial.actor.civics!.reformEntitlement = null;
  const state = paidOrder(initial.state, 'granary'); const result = policy(state)(action('', 'autocracy')); assert.equal(result.supported, true, result.reason);
  const actual = structuredClone(state); adoptGovernment(actual, seat, 'autocracy', [], []); beat(actual);
  assert.equal(actual.cities.find(city => city.civId === seat)!.construction!.active!.workDone, 1);
  assert.equal(result.proposedBeats[0]!.households[0]!.wellbeing, 51);
  assert.equal(result.proposedBeats[0]!.constructionWork['city-1'], 1);
  assert.ok(result.unpricedConstructionWorkDelta >= 0);
});

void test('F6 extra harvest cannot hide unresolved later growth beyond the tail', () => {
  const initial = fixture(); initial.city.housing!.baseCapacity = 20;
  const state = paidOrder(initial.state, 'farm'); const result = policy(state)(action('urban-planning'));
  assert.equal(result.supported, false); assert.match(result.reason, /growth.*tail|household.*tail/);
  assert.equal(result.firstAdverseCheckpoint?.stage, 'tail');
});

void test('F4 empty and occupied targets have the same exact price and retained transition costs', () => {
  const { state, actor } = fixture(); actor.civics!.reformEntitlement = null;
  const evaluate = policy(state); const empty = evaluate(action('', 'autocracy')); const occupied = evaluate(action('learning-patronage', 'autocracy'));
  assert.equal(empty.supported, true, empty.reason); assert.equal(occupied.supported, true, occupied.reason);
  assert.equal(empty.proposedBeats.slice(0, 2).length, 2); assert.equal(occupied.proposedBeats.slice(0, 2).length, 2);
  assert.equal(empty.paidCredits, 10); assert.equal(occupied.paidCredits, 10); assert.equal(empty.forecastBeats, occupied.forecastBeats);
  assert.deepEqual(empty.proposedBeats.slice(0, 2), occupied.proposedBeats.slice(0, 2));
});

void test('F9 total recurring value agrees with actual paid authoritative economy deltas', () => {
  const { state, actor } = fixture(); actor.civics!.reformEntitlement = null;
  const result = policy(state)(action()); assert.equal(result.supported, true, result.reason);
  const retained = structuredClone(state); const proposed = structuredClone(state); adoptGovernment(proposed, seat, 'chiefdom', action().assignments, []);
  let expected = -8 * profile.resources.credits;
  for (let index = 0; index < 4; index++) {
    const before = [retained, proposed].map(copy => ({ resources: { ...copy.civilizations[seat]!.resources }, research: copy.civilizations[seat]!.researchProgress }));
    beat(retained); beat(proposed);
    for (const id of RESOURCE_IDS) {
      const delta = [retained, proposed].map((copy, branch) => q(copy.civilizations[seat]!.resources[id] - before[branch]!.resources[id] + (id === 'science' ? copy.civilizations[seat]!.researchProgress - before[branch]!.research : 0)));
      expected += (delta[1]! - delta[0]!) * profile.resources[id] * (id === 'science' ? profile.priorities.research : profile.priorities.construction) / (index + 1);
    }
  }
  assert.ok(Math.abs(result.netArrangementGain - expected) < 1e-9);
});

void test('F7 accepted teaching reserves contributions and exact institutional operations', () => {
  const { state, actor } = fixture();
  for (const id of [seat, 4]) {
    const civ = state.civilizations[id]!; const city = state.cities.find(city => city.civId === id)!;
    civ.era = 1; civ.resources = { food: 300, materials: 300, energy: 300, credits: 300, science: 0, culture: 300 };
    syntheticTechnologies(state, id, ['wheel', 'masonry', 'civic-institutions']);
    city.population = 6; city.housing!.baseCapacity = 6; city.wellbeing = 40; city.focus = 'research';
    city.buildings = ['academy']; city.districtSites = {}; city.buildingOperations = { academy: { enabled: true, lastResult: null } };
  }
  syntheticTechnologies(state, seat, ['engineering']); actor.researchTarget = ''; state.civilizations[4]!.researchTarget = 'engineering';
  tradeAction(state, seat, { type: 'propose-trade', partner: 4, recipeId: 'harvest-for-materials', sourceCityId: 'city-1', recipientCityId: 'city-4' });
  tradeAction(state, 4, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true });
  for (let count = 0; count < 4; count++) knowledgeEconomy(state);
  const compact = acceptKnowledge(state); assert.equal(compact.status, 'accepted');
  const funded = policy(state)(action()); assert.equal(funded.supported, true, funded.reason); assert.ok(funded.reservedPromises.culture >= 2);
  assert.ok(funded.proposedBeats.every(beat => beat.institutionsFunded));
  actor.resources.credits = 0; const held = policy(state)(action()); assert.equal(held.supported, false); assert.match(held.reason, /institution.*opening|opening.*promis/);
});

void test('F7 actual paid field departure is held rather than inventing future returned residents', () => {
  const state = createWorld(1701, epoch, 'settlement-learning-patronage-1');
  for (const tile of state.tiles) { tile.terrain = tile.r === state.height - 1 ? 'ocean' : 'grassland'; tile.elevation = tile.terrain === 'ocean' ? 10 : 40; tile.owner = null; tile.resource = null; }
  const positions = [[2, 3], [8, 3], [14, 3], [3, 12], [13, 12]];
  for (const city of state.cities) {
    const position = positions[city.civId]!; const center = state.tiles.find(tile => tile.q === position[0] && tile.r === position[1])!;
    city.tileId = center.id; center.resource = 'food'; for (const tile of state.tiles) if (hexDistance(tile, center) <= 1) tile.owner = city.civId;
    city.population = 6; city.infrastructure = 10; city.wellbeing = 35; city.focus = 'industry';
    const civ = state.civilizations[city.civId]!; civ.era = 1; civ.resources = { food: 500, materials: 500, energy: 500, credits: 500, science: 0, culture: 500 };
    syntheticTechnologies(state, civ.id, ['civic-institutions', 'mining']);
  }
  state.tiles.find(tile => tile.q === 4 && tile.r === 3)!.owner = 0; state.tiles.find(tile => tile.q === 6 && tile.r === 3)!.owner = 1;
  state.tiles.find(tile => tile.id === borderTargetTileId(state))!.elevation = 70;
  const drainage = conditionDrainage(state.tiles, state.width, state.height); assert.ok(drainage, 'Synthetic border geography needs an actual canonical ocean outlet'); state.tiles = drainage.tiles;
  state.woodlands = createWoodlands(state.tiles); state.strategicDeposits = createStrategicDeposits(state); state.coalDeposits = createCoalDeposits(state); state.pastoralSites = createPastoralSites(state);
  assert.equal(state.releaseId, 'settlement-learning-patronage-1'); assert.equal(state.revision, 0); assert.equal(state.round, 0);
  assert.equal(state.origin, undefined); assert.equal(Object.hasOwn(state, 'drainage'), false);
  assert.ok(isWorldState(state), 'Fresh archetypal border prerequisites must validate without generated-world drainage metadata');
  borderEngineAction(state, 1, { type: 'acquire-tile', cityId: 'city-1', tileId: borderTargetTileId(state) });
  const incident = dispatchBorder(state); assert.equal(incident.initiator.returned, null);
  state.civilizations[seat]!.civics!.completedCivicIds = CIVICS.map(civic => civic.id);
  const before = structuredClone(state); const result = policy(state)(action()); assert.equal(result.supported, false); assert.match(result.reason, /border.*returning residents/); assert.deepEqual(state, before);
});

void test('F7 promised Food cannot suppress real unescrowed automatic growth', () => {
  const { state, actor, city } = fixture(); city.housing!.baseCapacity = 20; city.wellbeing = 60;
  tradeAction(state, seat, { type: 'propose-trade', partner: 4, recipeId: 'harvest-for-materials', sourceCityId: city.id, recipientCityId: 'city-4' });
  tradeAction(state, 4, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true }); actor.resources.food = 19;
  const reserve = exchangePromisedResources(state, seat, 8); assert.equal(reserve.ordinary.food, 8);
  const actual = structuredClone(state); adoptGovernment(actual, seat, 'chiefdom', action().assignments, []); beat(actual);
  assert.equal(actual.cities.find(candidate => candidate.id === city.id)!.population, 7);
  assert.equal(state.routes[0]!.agreement!.nextDeliveryRound, 4);
  const result = policy(state)(action()); assert.equal(result.supported, false); assert.match(result.reason, /Food.*unescrowed growth/);
  assert.deepEqual(actor.resources, state.civilizations[seat]!.resources);
});

void test('F7 incoming Food with unsaturated growth is unsupported rather than assumed physically inert', () => {
  const { state, city } = fixture(); city.housing!.baseCapacity = 20;
  tradeAction(state, 4, { type: 'propose-trade', partner: seat, recipeId: 'harvest-for-materials', sourceCityId: 'city-4', recipientCityId: city.id });
  tradeAction(state, seat, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true });
  assert.equal(exchangePromisedResources(state, seat, 8).ordinary.food, 0);
  const result = policy(state)(action()); assert.equal(result.supported, false); assert.match(result.reason, /incoming Food.*growth/);
});

void test('F7 strategic promises cannot free Mine storage before the actual shipment', () => {
  const { state, actor, city } = fixture(); city.population = 7; city.housing!.baseCapacity = 7; actor.resources.food = 100;
  syntheticTechnologies(state, seat, ['currency', 'bronze-working', 'mining']);
  const deposit = Object.values(state.strategicDeposits!.deposits).find(deposit => state.tiles.find(tile => tile.id === deposit.tileId)!.owner === seat); assert.ok(deposit);
  improvement(city, 'mine', deposit.tileId); actor.strategicResources = { iron: 40 };
  tradeAction(state, seat, { type: 'propose-trade', partner: 4, recipeId: 'iron-for-food', sourceCityId: city.id, recipientCityId: 'city-4' });
  tradeAction(state, 4, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true });
  assert.equal(exchangePromisedResources(state, seat, 8).strategic.iron, 4);
  const actual = structuredClone(state); adoptGovernment(actual, seat, 'chiefdom', action().assignments, []); beat(actual);
  assert.equal(actual.civilizations[seat]!.strategicResources!.iron, 40);
  assert.equal(actual.cities.find(candidate => candidate.id === city.id)!.improvements![String(deposit.tileId)]!.operation.lastResult!.extraction!.status, 'storage-full');
  const result = policy(state)(action()); assert.equal(result.supported, false); assert.match(result.reason, /strategic cargo.*Mine storage/);
  city.improvements![String(deposit.tileId)]!.operation.enabled = false;
  const invariant = policy(state)(action()); assert.equal(invariant.supported, true, invariant.reason);
});

void test('F7 promised Food remains unsupported when a standing paid Granary can open new growth capacity', () => {
  const initial = fixture(); const state = paidOrder(initial.state, 'granary'); const actor = state.civilizations[seat]!;
  tradeAction(state, seat, { type: 'propose-trade', partner: 4, recipeId: 'harvest-for-materials', sourceCityId: 'city-1', recipientCityId: 'city-4' });
  tradeAction(state, 4, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true }); actor.resources.food = 100;
  const result = policy(state)(action()); assert.equal(result.supported, false); assert.match(result.reason, /Food.*housing dependencies/);
});

void test('F7 incoming strategic cargo with a standing Mine is explicitly outside capacity closure', () => {
  const { state, actor, city } = fixture(); city.population = 7; city.housing!.baseCapacity = 7; actor.resources.food = 100; actor.strategicResources = { iron: 38 };
  syntheticTechnologies(state, seat, ['bronze-working', 'mining']); syntheticTechnologies(state, 4, ['currency']); state.civilizations[4]!.strategicResources = { iron: 10 };
  const deposit = Object.values(state.strategicDeposits!.deposits).find(deposit => state.tiles.find(tile => tile.id === deposit.tileId)!.owner === seat); assert.ok(deposit); improvement(city, 'mine', deposit.tileId);
  tradeAction(state, 4, { type: 'propose-trade', partner: seat, recipeId: 'iron-for-food', sourceCityId: 'city-4', recipientCityId: city.id });
  tradeAction(state, seat, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true });
  assert.equal(exchangePromisedResources(state, seat, 8).strategic.iron ?? 0, 0);
  const result = policy(state)(action()); assert.equal(result.supported, false); assert.match(result.reason, /incoming strategic cargo.*Mine storage/);
});
