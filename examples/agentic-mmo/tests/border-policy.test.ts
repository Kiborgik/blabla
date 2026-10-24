import assert from 'node:assert/strict';
import { test } from 'node:test';
import { borderPriority, borderProtects, borderReason, borderWeight, deriveBorderPlan } from '../core/behavior-border.ts';
import { BEHAVIOR_PROFILES, type BehaviorProfile } from '../core/behavior-profiles.ts';
import { BORDER_RULES } from '../core/border-content.ts';
import { assessCivilizationBehavior, chooseCivilizationBehavior, createBehaviorMemory } from '../core/behaviors.ts';
import { availableBorderActions, quoteBorderDeparture } from '../core/simulation/border-incidents.ts';
import { createTerritoryPlanner } from '../core/simulation/territory.ts';
import type { ActionOption, GameAction, WorldState } from '../core/types.ts';
import { borderAction, borderBeat, borderEngineAction, borderTargetTileId, borderTimestamp, DEFENDER, dispatchBorder, INITIATOR, syntheticBorderCorridor } from './fixtures/border-current.ts';
import { syntheticTechnologies } from './fixtures/coastal-prefix.ts';

function option(action: GameAction): ActionOption { return { action, label: 'Explicit conditional policy candidate', reason: 'Not evidence of natural selection' }; }
function departure(state: WorldState, people: 2 | 3 = 2): ActionOption { return option({ type: 'dispatch-border', sourceCityId: 'city-0', tileId: borderTargetTileId(state), people }); }
function plan(state: WorldState, options: ActionOption[], actorId = INITIATOR, profile: BehaviorProfile = BEHAVIOR_PROFILES[2]!) { return deriveBorderPlan(state, state.civilizations[actorId]!, profile, options); }
function weight(state: WorldState, selected: ActionOption, profile: BehaviorProfile = BEHAVIOR_PROFILES[2]!): number { return borderWeight(selected, 17, plan(state, [selected], INITIATOR, profile)); }

void test('border weighting re-quotes actual resident departures and never consumes world RNG or balances', () => {
  const state = syntheticBorderCorridor();
  const options = [departure(state), departure(state, 3)];
  const before = structuredClone(state);
  const assessed = plan(state, options);
  for (const selected of options) {
    assert.ok(borderWeight(selected, 0, assessed) > 0);
    assert.equal(borderPriority(selected, assessed), 0);
    assert.equal(borderProtects(selected, assessed), false);
    assert.match(borderReason(selected, assessed)!, /Food|Materials/);
  }
  const quoted = availableBorderActions(state, INITIATOR).find(candidate => candidate.action.type === 'dispatch-border' && candidate.action.people === 2)!;
  const forged = structuredClone(quoted);
  assert.ok(forged.borderQuote);
  forged.borderQuote.totalCost.food = 0;
  forged.borderQuote.totalCost.materials = 0;
  assert.equal(weight(state, forged), weight(state, quoted));
  assert.deepEqual(state, before);
  const restored = JSON.parse(JSON.stringify(state)) as WorldState;
  assert.equal(weight(restored, options[0]!), weight(state, options[0]!));
  assert.deepEqual(state, before);
});

void test('unfunded or understaffed departure is protected even under the strongest outward preference', () => {
  const profile = { ...BEHAVIOR_PROFILES[2]!, priorities: { ...BEHAVIOR_PROFILES[2]!.priorities, expansion: 100 } };
  for (const change of [(state: WorldState) => { state.cities[0]!.population = 4; }, (state: WorldState) => { state.civilizations[0]!.resources.food = 0; }, (state: WorldState) => { state.civilizations[0]!.legitimacy = 0; }]) {
    const state = syntheticBorderCorridor(); change(state);
    const selected = departure(state);
    const assessed = plan(state, [selected], INITIATOR, profile);
    assert.equal(borderWeight(selected, 1000, assessed), 0);
    assert.equal(borderProtects(selected, assessed), true);
    assert.ok(borderReason(selected, assessed));
  }
});

void test('owned land alone is not production and only an actual eligible paid use gives border value', () => {
  const state = syntheticBorderCorridor();
  const selected = departure(state);
  assert.ok(weight(state, selected) > 0);
  state.tiles.find(tile => tile.id === borderTargetTileId(state))!.elevation = 20;
  assert.equal(weight(state, selected), 0);
  syntheticTechnologies(state, INITIATOR, ['writing']);
  assert.ok(weight(state, selected) > 0);
  state.civilizations[0]!.resources.materials = 6;
  assert.equal(quoteBorderDeparture(state, INITIATOR, selected.action as Extract<GameAction, { type: 'dispatch-border' }>).ok, true);
  assert.equal(weight(state, selected), 0);
});

void test('peaceful acquisition is compared by exact price, useful site and distance rather than a neutral-land veto', () => {
  const state = syntheticBorderCorridor();
  const selected = departure(state);
  const initial = weight(state, selected);
  const city = state.cities[0]!;
  const planner = createTerritoryPlanner(state);
  const neutral = planner.nearby(city).find(tile => tile.owner === null && !planner.assess(INITIATOR, city.id, tile.id).blocker)!;
  assert.ok(neutral);
  assert.ok(initial > 0);
  neutral.elevation = 70;
  const competing = weight(state, selected);
  assert.ok(competing > 0 && competing < initial);
  const oldPrice = createTerritoryPlanner(state).assess(INITIATOR, city.id, neutral.id).quote!.paid.credits;
  const unrelated = planner.nearby(city).find(tile => tile.id !== neutral.id && tile.owner === null && !planner.assess(INITIATOR, city.id, tile.id).blocker)!;
  assert.ok(unrelated);
  borderEngineAction(state, INITIATOR, { type: 'acquire-tile', cityId: city.id, tileId: unrelated.id });
  assert.ok(createTerritoryPlanner(state).assess(INITIATOR, city.id, neutral.id).quote!.paid.credits > oldPrice);
  assert.ok(weight(state, selected) > competing);
  state.tiles.find(tile => tile.id === neutral.id)!.elevation = 20;
  assert.equal(weight(state, selected), initial);
});

void test('weighing a border does not replace or refund an existing paid town construction lane', () => {
  const state = syntheticBorderCorridor();
  const city = state.cities[0]!;
  const site = state.tiles.find(tile => tile.owner === INITIATOR && tile.id !== city.tileId)!;
  site.elevation = 70;
  borderEngineAction(state, INITIATOR, { type: 'improve', cityId: city.id, tileId: site.id, improvementId: 'mine' });
  assert.ok(state.cities[0]!.construction?.active);
  const before = structuredClone(state);
  assert.equal(weight(state, departure(state)), 0);
  assert.deepEqual(state, before);
});

void test('funded values and profile preferences differentiate weights without changing admission', () => {
  const state = syntheticBorderCorridor();
  const selected = departure(state);
  const compact = { ...BEHAVIOR_PROFILES[2]!, priorities: { ...BEHAVIOR_PROFILES[2]!.priorities, expansion: 0.8, recovery: 1.5 } };
  const outward = { ...compact, priorities: { ...compact.priorities, expansion: 1.5, recovery: 1 } };
  assert.ok(weight(state, selected, outward) > weight(state, selected, compact));
  const lowMaterials = { ...outward, resources: { ...outward.resources, materials: 0.1 } };
  assert.ok(weight(state, selected, outward) > weight(state, selected, lowMaterials));
  state.border!.pairProtectionUntil['0:1'] = state.round + 12;
  assert.equal(weight(state, selected, outward), 0);
  assert.equal(weight(state, selected, compact), 0);
});

void test('an original purchaser can value a legal recapture without rewriting its original purchase receipt', () => {
  const state = syntheticBorderCorridor();
  const tileId = borderTargetTileId(state);
  const purchase = structuredClone(state.tileAcquisitions![String(tileId)]);
  const incident = dispatchBorder(state);
  borderAction(state, DEFENDER, { type: 'respond-border', incidentId: incident.id, response: 'yield' });
  for (let beat = 0; beat < BORDER_RULES.resolutionDelay + BORDER_RULES.protectionBeats; beat++) borderBeat(state);
  assert.equal(state.border!.active.length, 0);
  assert.equal(state.border!.controls[String(tileId)]!.civId, INITIATOR);
  assert.deepEqual(state.tileAcquisitions![String(tileId)], purchase);
  const recapture = option({ type: 'dispatch-border', sourceCityId: 'city-1', tileId, people: 2 });
  assert.ok(availableBorderActions(state, DEFENDER).some(candidate => JSON.stringify(candidate.action) === JSON.stringify(recapture.action)));
  const before = structuredClone(state);
  const assessed = plan(state, [recapture], DEFENDER);
  assert.ok(borderWeight(recapture, 0, assessed) > 0);
  assert.deepEqual(state, before);
});

void test('a pending defender weighs funded defense against yield and yields when actual funding is absent', () => {
  const state = syntheticBorderCorridor();
  const incident = dispatchBorder(state);
  const defend = option({ type: 'respond-border', incidentId: incident.id, response: 'defend', sourceCityId: 'city-1', people: 2 });
  const yieldOption = option({ type: 'respond-border', incidentId: incident.id, response: 'yield' });
  const assessed = plan(state, [defend, yieldOption], DEFENDER);
  assert.ok(borderWeight(defend, 0, assessed) > 0);
  assert.ok(borderWeight(yieldOption, 0, assessed) > 0);
  assert.ok(borderPriority(defend, assessed) > 0);
  state.civilizations[DEFENDER]!.resources.food = 0;
  const unfunded = plan(state, [defend, yieldOption], DEFENDER);
  assert.equal(borderWeight(defend, 100, unfunded), 0);
  assert.equal(borderProtects(defend, unfunded), true);
  assert.ok(borderWeight(yieldOption, 0, unfunded) > 0);
  assert.ok(borderPriority(yieldOption, unfunded) > 0);
});

void test('withdrawal stays optional for a supplied home but becomes urgent for an actual home Food shortage', () => {
  const state = syntheticBorderCorridor();
  const incident = dispatchBorder(state);
  const withdraw = option({ type: 'withdraw-border', incidentId: incident.id });
  const supplied = plan(state, [withdraw]);
  assert.ok(borderWeight(withdraw, 0, supplied) > 0);
  assert.equal(borderPriority(withdraw, supplied), 0);
  state.civilizations[INITIATOR]!.resources.food = 0;
  const hungry = plan(state, [withdraw]);
  assert.ok(borderPriority(withdraw, hungry) > 0);
  assert.ok(borderWeight(withdraw, 0, hungry) > borderWeight(withdraw, 0, supplied));
});

void test('existing consenting trade remains intact and its promises cannot be spent on departure', () => {
  const state = syntheticBorderCorridor();
  borderEngineAction(state, INITIATOR, { type: 'propose-trade', partner: DEFENDER, recipeId: 'harvest-for-materials', sourceCityId: 'city-0', recipientCityId: 'city-1' });
  borderEngineAction(state, DEFENDER, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true });
  const selected = departure(state);
  assert.equal(selected.action.type, 'dispatch-border');
  if (selected.action.type !== 'dispatch-border') throw new Error('Expected dispatch');
  const quoted = quoteBorderDeparture(state, INITIATOR, selected.action);
  assert.ok(quoted.ok);
  assert.ok((quoted.quote.promised.food ?? 0) > 0);
  state.civilizations[INITIATOR]!.resources.food = quoted.quote.totalCost.food + quoted.quote.householdReserve.food;
  const before = structuredClone(state);
  assert.equal(weight(state, selected), 0);
  assert.deepEqual(state, before);
});

void test('incident protections bar new bilateral promises without suppressing existing stop or withdrawal choices', () => {
  const state = syntheticBorderCorridor();
  dispatchBorder(state);
  const propose = option({ type: 'propose-trade', partner: DEFENDER, recipeId: 'harvest-for-materials', sourceCityId: 'city-0', recipientCityId: 'city-1' });
  const federate = option({ type: 'federate', partner: DEFENDER });
  const stop = option({ type: 'stop-trade', routeId: 'unchanged-existing-route' });
  const assessed = plan(state, [propose, federate, stop]);
  for (const selected of [propose, federate]) {
    assert.equal(borderWeight(selected, 99, assessed), 0);
    assert.equal(borderProtects(selected, assessed), true);
  }
  assert.equal(borderWeight(stop, 7, assessed), 7);
  assert.equal(borderProtects(stop, assessed), false);
});

void test('integrated assessment and same-version decisions preserve state and refuse stale illegal border candidates', () => {
  const state = syntheticBorderCorridor();
  const memory = createBehaviorMemory(state, INITIATOR);
  const selected = departure(state);
  state.border!.initiationCooldownUntil[INITIATOR] = state.round + BORDER_RULES.initiationCooldownAfterReturn;
  const before = structuredClone(state);
  const assessed = assessCivilizationBehavior(state, INITIATOR, memory, [selected]);
  assert.equal(assessed.candidates[0]!.weight, 0);
  assert.equal(assessed.candidates[0]!.protected, true);
  assert.deepEqual(chooseCivilizationBehavior(state, INITIATOR, memory, borderTimestamp(state, INITIATOR)), chooseCivilizationBehavior(JSON.parse(JSON.stringify(state)), INITIATOR, JSON.parse(JSON.stringify(memory)), borderTimestamp(state, INITIATOR)));
  assert.deepEqual(state, before);
});
