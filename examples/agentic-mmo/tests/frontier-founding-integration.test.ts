import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProductiveFrontierAssessment } from '../core/behavior-frontier.ts';
import { FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION } from '../core/behavior-profiles.ts';
import { assessCivilizationBehavior, chooseCivilizationBehavior, createBehaviorMemory, type BehaviorMemory } from '../core/behaviors.ts';
import { BUILDINGS, ECONOMY_RULES, RESIDENT_CAPACITY_RULES, RESOURCE_IDS } from '../core/content.ts';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { decisionObligations } from '../core/simulation/decisions.ts';
import { allocatedCityFoodProduction } from '../core/simulation/food-security.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import { turnAdmission } from '../core/simulation/turns.ts';
import { STRATEGIC_TEMPERAMENT_VERSION } from '../core/strategic-temperaments.ts';
import type { ActionOption, City, GameAction, Resources, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const currentRelease = 'settlement-productive-frontiers-1';
const feature = 'productive-frontier-founding';
const cents = (value: number): number => Math.round(value * 100) / 100;
function fixture(release: typeof currentRelease | 'settlement-charcoal-clearing-1' = currentRelease): WorldState {
  const state = createGeneratedWorld(73, epoch, release, undefined, STRATEGIC_TEMPERAMENT_VERSION);
  for (const actor of state.civilizations) {
    actor.resources = { food: 1000, materials: 1000, energy: 1000, credits: 1000, science: 0, culture: 0 };
    actor.technologies = ['agriculture'];
  }
  for (const city of state.cities) { city.population = 9; city.focus = 'industry'; city.wellbeing = 50; }
  assert.ok(isWorldState(state), 'Controlled synthetic stocks, Cultivation, population and inherited industry focus must validate; this is not a natural campaign');
  return state;
}
function timestamp(state: WorldState, seat = 0): string {
  const value = turnAdmission(state, seat).nextActionAt; assert.ok(value); return value;
}
function options(state: WorldState, seat = 0): ActionOption[] { return legalActions(state, seat, timestamp(state, seat)); }
function assessment(state: WorldState, seat = 0, choices = options(state, seat)) {
  return assessCivilizationBehavior(state, seat, createBehaviorMemory(state, seat), choices);
}
function candidate(state: WorldState, action: GameAction) {
  const found = assessment(state).candidates.find(item => sameAction(item.option.action, action));
  assert.ok(found, JSON.stringify(action)); return found;
}
function withoutFrontier(state: WorldState): WorldState {
  const previous = structuredClone(state); previous.unlockedFeatures = previous.unlockedFeatures.filter(id => id !== feature); return previous;
}
function founding(state: WorldState, seat = 0): Extract<GameAction, { type: 'settle' }> {
  const action = options(state, seat).find(item => item.action.type === 'settle')?.action;
  assert.ok(action?.type === 'settle'); return action;
}
function commit(state: WorldState, seat: number, action: GameAction): WorldState {
  const result = applyCommand(state, { seat, action, timestamp: timestamp(state, seat), expectedRevision: state.revision });
  assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state)); return result.state;
}
function foundedFixture() {
  const initial = fixture(); const action = founding(initial); const state = commit(initial, 0, action);
  const town = state.cities.find(city => city.tileId === action.tileId); assert.ok(town);
  return { state, town, action };
}
function assertPaid(before: Resources, after: Resources, cost: Partial<Resources>) {
  for (const resource of RESOURCE_IDS) assert.equal(after[resource], cents(before[resource] - (cost[resource] ?? 0)), resource);
}

void test('fresh feature adds only a bounded funded ordinary founding multiplier and leaves explicit earlier component rules intact', () => {
  const state = fixture(); const previous = fixture('settlement-charcoal-clearing-1'); const before = structuredClone(state);
  assert.equal(createBehaviorMemory(state, 0).policyVersion, FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION);
  const choices = options(state); assert.deepEqual(choices, options(previous));
  const original = assessment(previous, 0, choices); const assessed = assessment(state, 0, choices);
  assert.equal(assessed.phase, original.phase);
  const planner = createProductiveFrontierAssessment(state, 0);
  let positiveFounding = 0;
  for (let index = 0; index < choices.length; index++) {
    const option = choices[index]!; const baseline = original.candidates[index]!; const current = assessed.candidates[index]!;
    assert.equal(current.lane, baseline.lane); assert.equal(current.protected, baseline.protected); assert.equal(current.urgent, baseline.urgent);
    if (option.action.type !== 'settle' || baseline.weight <= 0) { assert.equal(current.weight, baseline.weight); continue; }
    const quote = planner.founding(option.action).quote;
    assert.ok(quote); assert.ok(quote.locationMultiplier >= 1 && quote.locationMultiplier <= 1.5);
    assert.equal(current.weight, baseline.weight * quote.locationMultiplier); assert.equal(current.lane, null); positiveFounding++;
  }
  assert.ok(positiveFounding > 0); assert.deepEqual(state, before);
  previous.civilizations[0]!.technologies = [];
  const ungated = founding(previous); assert.ok(candidate(previous, ungated).weight > 0);
  const gated = structuredClone(previous); gated.unlockedFeatures.push(feature);
  assert.equal(candidate(gated, ungated).weight, 0);
});

void test('current-stock and six-to-three allocator refusals remove optional founding without changing authoritative legality or required lanes', () => {
  const state = fixture(); const action = founding(state); const quote = createProductiveFrontierAssessment(state, 0).founding(action).quote; assert.ok(quote);
  state.civilizations[0]!.resources.food = quote.protectedBudget.ordinary.food - 0.01;
  assert.ok(candidate(withoutFrontier(state), action).weight > 0);
  assert.equal(createProductiveFrontierAssessment(state, 0).founding(action).quote, null);
  assert.equal(candidate(state, action).weight, 0);
  const obligations = decisionObligations(state, 0); const decision = chooseCivilizationBehavior(state, 0, undefined, timestamp(state));
  assert.ok(decision.action && decision.action.type !== 'settle'); assert.equal(decision.explanation.required, true);
  assert.deepEqual(decisionObligations(withoutFrontier(state), 0), obligations);
  const supported = fixture(); const city = supported.cities.find(item => item.civId === 0)!;
  city.population = 6; city.buildings.push('kiln'); city.buildingOperations = { kiln: { enabled: true, lastResult: null } }; supported.civilizations[0]!.technologies.push('kiln-firing');
  assert.ok(isWorldState(supported));
  const working = projectOperationAllocation(supported).cities.find(item => item.id === city.id)!.buildingOperations!.kiln!.lastResult;
  assert.equal(working?.status, 'operated');
  const departure = founding(supported); assert.ok(candidate(withoutFrontier(supported), departure).weight > 0);
  assert.equal(createProductiveFrontierAssessment(supported, 0).founding(departure).quote, null);
  assert.equal(candidate(supported, departure).weight, 0);
  assert.equal(city.population, 6); assert.equal(city.buildingOperations!.kiln!.enabled, true);
});

void test('fresh empty-town Farm doubles only positive post-progression weight and a refused bonus leaves ordinary Farm and alternatives legal', () => {
  const { state, town } = foundedFixture();
  const farm: GameAction = { type: 'build', cityId: town.id, project: 'farm' };
  const workshop: GameAction = { type: 'build', cityId: town.id, project: 'workshop' };
  const quote = createProductiveFrontierAssessment(state, 0).farm(town.id).quote; assert.ok(quote);
  assert.deepEqual(quote.foundingCost, {}); assert.deepEqual(quote.setupCost, { materials: 8, credits: 4 });
  const base = candidate(withoutFrontier(state), farm); const bonus = candidate(state, farm);
  assert.ok(base.weight > 0); assert.equal(bonus.weight, base.weight * 2); assert.equal(bonus.lane, `construction:${town.id}`);
  assert.equal(candidate(state, workshop).weight, candidate(withoutFrontier(state), workshop).weight);
  state.civilizations[0]!.resources.food = quote.protectedBudget.ordinary.food - 0.01;
  assert.equal(createProductiveFrontierAssessment(state, 0).farm(town.id).quote, null);
  const refused = candidate(state, farm); const ordinary = candidate(withoutFrontier(state), farm);
  assert.ok(refused.weight > 0); assert.equal(refused.weight, ordinary.weight); assert.equal(refused.lane, ordinary.lane);
  assert.ok(options(state).some(option => sameAction(option.action, farm)));
  assert.ok(options(state).some(option => sameAction(option.action, workshop)));
  assert.equal(town.construction?.active ?? null, null); assert.deepEqual(town.buildings, []);
});

void test('bonus expires or disappears after another independent commitment without canceling ordinary Farm legality', () => {
  const { state, town } = foundedFixture();
  state.round = 9; state.independentTurns!.strategyTicks = 9;
  const farm: GameAction = { type: 'build', cityId: town.id, project: 'farm' };
  assert.equal(createProductiveFrontierAssessment(state, 0).farm(town.id).quote, null);
  assert.equal(candidate(state, farm).weight, candidate(withoutFrontier(state), farm).weight);
  const other = foundedFixture(); const built = commit(other.state, 0, { type: 'build', cityId: other.town.id, project: 'workshop' });
  const paid = structuredClone(built.cities.find(city => city.id === other.town.id)!.construction);
  assert.equal(createProductiveFrontierAssessment(built, 0).farm(other.town.id).quote, null);
  chooseCivilizationBehavior(built, 0, undefined, timestamp(built));
  assert.deepEqual(built.cities.find(city => city.id === other.town.id)!.construction, paid);
});

void test('current frontier assessment and chooser restart are immutable and stable with reversed supplied legal options', () => {
  const state = fixture(); const memory = createBehaviorMemory(state, 0); const choices = options(state); const before = structuredClone(state);
  const direct = assessCivilizationBehavior(state, 0, memory, choices); const reversed = assessCivilizationBehavior(state, 0, memory, choices.toReversed());
  assert.deepEqual(reversed.candidates.toReversed(), direct.candidates); assert.equal(reversed.phase, direct.phase);
  const decision = chooseCivilizationBehavior(state, 0, memory, timestamp(state));
  assert.deepEqual(chooseCivilizationBehavior(JSON.parse(JSON.stringify(state)) as WorldState, 0, JSON.parse(JSON.stringify(memory)) as BehaviorMemory, timestamp(state)), decision);
  assert.deepEqual(state, before); assert.deepEqual(memory, createBehaviorMemory(state, 0));
});

void test('controlled synthetic fixed-seed full-menu chooser pays founding, separately chooses Farm, completes it and only later produces Food', context => {
  let state = fixture(); const memories = state.civilizations.map(actor => createBehaviorMemory(state, actor.id));
  const foundingReceipts = new Map<string, { seat: number; round: number; revision: number }>();
  const farms = new Map<string, { seat: number; startedRound: number; firstOperationBeat: number }>();
  const trace: Array<{ seat: number; round: number; timestamp: string; action: GameAction; reason: string; required: boolean; legalAlternatives: number; paid: Partial<Resources> }> = [];
  const alternateFoundedBuildings: string[] = [];
  let beats = 0;
  const beat = () => {
    assert.ok(beats < 8, 'The approved finite fixture permits at most eight actual strategic beats');
    const at = turnAdmission(state, 0).nextStrategyAt; assert.ok(at); const result = catchUpStrategy(state, at);
    assert.ok(result.ok, result.error); assert.equal(result.state.round, state.round + 1); assert.ok(isWorldState(result.state)); state = result.state; beats++;
    return result.events;
  };
  for (let admission = 0; admission < 8; admission++) {
    if (Date.parse(timestamp(state)) >= Date.parse(turnAdmission(state, 0).nextStrategyAt!)) beat();
    for (let seat = 0; seat < state.civilizations.length; seat++) {
      const at = timestamp(state, seat); const legal = legalActions(state, seat, at); const before = structuredClone(state);
      const decision = chooseCivilizationBehavior(state, seat, memories[seat], at);
      assert.ok(decision.action, JSON.stringify({ seat, admission, reason: decision.explanation.reason }));
      assert.ok(legal.some(option => sameAction(option.action, decision.action)));
      assert.deepEqual(chooseCivilizationBehavior(JSON.parse(JSON.stringify(state)) as WorldState, seat, JSON.parse(JSON.stringify(memories[seat])) as BehaviorMemory, at), decision);
      assert.deepEqual(state, before);
      const action = decision.action; const resources = state.civilizations[seat]!.resources;
      const target = action.type === 'build' ? state.cities.find(city => city.id === action.cityId) : undefined;
      const farmQuote = action.type === 'build' && action.project === 'farm' && target && foundingReceipts.has(target.id)
        ? createProductiveFrontierAssessment(state, seat).farm(target.id).quote : null;
      const result = applyCommand(state, { seat, timestamp: at, action, expectedRevision: state.revision });
      assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state));
      const paid = Object.fromEntries(RESOURCE_IDS.map(id => [id, cents(resources[id] - result.state.civilizations[seat]!.resources[id])]).filter(([, amount]) => amount !== 0)) as Partial<Resources>;
      trace.push({ seat, round: state.round, timestamp: at, action, reason: decision.explanation.reason, required: decision.explanation.required, legalAlternatives: legal.length - 1, paid });
      if (action.type === 'settle') {
        const town = result.state.cities.find(city => city.tileId === action.tileId); assert.ok(town);
        const source = state.cities.find(city => city.id === action.sourceCityId); assert.ok(source);
        assert.equal(result.state.cities.find(city => city.id === source.id)!.population, source.population - 3);
        assert.equal(town.population, 3); assert.equal(town.population - RESIDENT_CAPACITY_RULES.communityReserve, 0);
        assert.equal(town.focus, source.focus); assert.deepEqual(town.buildings, []); assert.equal(town.construction?.active ?? null, null);
        assertPaid(resources, result.state.civilizations[seat]!.resources, ECONOMY_RULES.settle.cost);
        assert.match(decision.explanation.reason, /3 residents/); assert.match(decision.explanation.reason, /independently/); assert.match(decision.explanation.reason, /not.*consent/);
        assert.ok(legal.some(option => option.action.type !== 'settle'));
        foundingReceipts.set(town.id, { seat, round: state.round, revision: result.state.revision });
      }
      if (action.type === 'build' && target && foundingReceipts.has(target.id)) {
        const town = result.state.cities.find(city => city.id === target.id)!; const order = town.construction?.active; assert.ok(order);
        assert.ok(legal.some(option => option.action.type === 'build' && option.action.cityId === target.id && option.action.project !== action.project));
        assert.equal(order.workDone, 0); assert.deepEqual(town.buildings, []); assert.deepEqual(town.lastFoodSupply, target.lastFoodSupply);
        const definition = BUILDINGS.find(building => building.id === action.project)!; assertPaid(resources, result.state.civilizations[seat]!.resources, definition.cost);
        if (action.project === 'farm') {
          assert.ok(farmQuote); assert.ok(result.state.revision > foundingReceipts.get(target.id)!.revision);
          assert.match(decision.explanation.reason, /independently/); assert.match(decision.explanation.reason, /construction/);
          farms.set(target.id, { seat, startedRound: state.round, firstOperationBeat: farmQuote.firstOperationBeat });
        } else alternateFoundedBuildings.push(action.project);
      }
      state = result.state; memories[seat] = decision.memory;
    }
  }
  context.diagnostic(JSON.stringify({ provenance: 'controlled synthetic prerequisites and current stocks; not a natural campaign or balance proof', seed: 73, admissionLimitPerSeat: 8, selectedActions: trace, founded: [...foundingReceipts], paidFarms: [...farms], alternateFoundedBuildings }));
  assert.ok(foundingReceipts.size > 0, 'Fixed finite full-menu choices must actually accept paid founding');
  assert.ok(farms.size > 0, 'Fixed finite full-menu choices must separately accept a paid Farm, not merely expose its legal option');
  assert.ok(alternateFoundedBuildings.length > 0, 'Another building must actually win against the optional Farm preference');
  const produced = new Set<string>(); const completions = new Map<string, number>();
  while (beats < 8 && produced.size < farms.size) {
    const opening = structuredClone(state); const events = beat();
    for (const [cityId, farm] of farms) {
      const prior = opening.cities.find(city => city.id === cityId)!; const town = state.cities.find(city => city.id === cityId)!;
      if (events.some(event => event.type === 'building-completed' && event.tileId === town.tileId && town.buildings.includes('farm'))) completions.set(cityId, state.round);
      if (!prior.buildings.includes('farm')) {
        assert.equal(town.lastFoodSupply?.produced, allocatedCityFoodProduction(opening, prior).total);
        continue;
      }
      const withoutFarm: City = { ...prior, buildings: prior.buildings.filter(id => id !== 'farm') };
      const expected = allocatedCityFoodProduction(opening, prior).total;
      assert.ok(expected > allocatedCityFoodProduction(opening, withoutFarm).total);
      assert.equal(town.lastFoodSupply?.produced, expected); assert.ok(town.lastFoodSupply.produced > 0);
      assert.ok((town.construction?.lastCompleted?.completedRound ?? Infinity) < state.round);
      assert.ok(state.round - farm.startedRound <= farm.firstOperationBeat);
      assert.deepEqual(town.construction?.lastCompleted?.paid, { materials: 8, credits: 4 }); produced.add(cityId);
    }
  }
  assert.equal(produced.size, farms.size); assert.ok(completions.size > 0);
  context.diagnostic(JSON.stringify({ actualStrategicBeats: beats, completed: [...completions], laterFood: [...produced].map(cityId => ({ cityId, receipt: state.cities.find(city => city.id === cityId)!.lastFoodSupply })) }));
});
