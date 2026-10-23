import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEHAVIOR_POLICY_VERSION, BEHAVIOR_PROFILES, FOOD_BUDGET_BEHAVIOR_POLICY_VERSION, TEMPERAMENT_BEHAVIOR_POLICY_VERSION, behaviorDrawVersion, behaviorPolicyVersion, behaviorSeed, civilizationBehaviorProfile, type BehaviorPriority, type BehaviorPolicyVersion, type BehaviorProfile } from '../core/behavior-profiles.ts';
import { deriveDiplomacyPlan, diplomacyWeight } from '../core/behavior-diplomacy.ts';
import { assessCivilizationBehavior, chooseCivilizationBehavior, chooseDirectorBehavior, createBehaviorMemory, type BehaviorMemory } from '../core/behaviors.ts';
import { applyStrategicPosture, ordinaryPhaseWeight, strategicTemperament, STRATEGIC_TEMPERAMENT_VERSION } from '../core/strategic-temperaments.ts';
import { ECONOMY_RULES, RESOURCE_IDS, TRADE_RECIPES } from '../core/content.ts';
import { applyCommand, legalActions } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { isCoastalSite } from '../core/simulation/coastal.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { civilizationFoodUpkeep, forecastCivilizationFoodProduction } from '../core/simulation/food-security.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { executeReliefAction, quoteReliefProposal } from '../core/simulation/relief-charters.ts';
import { executeTradeAction } from '../core/simulation/trade.ts';
import { isWorldState } from '../core/validation.ts';
import type { ActionOption, GameAction, GameEvent, TradeTerms, WorldState } from '../core/types.ts';

const epoch = '2026-10-22T00:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const world = (): WorldState => createGeneratedWorld(73, epoch, 'settlement-food-budget-1', undefined, STRATEGIC_TEMPERAMENT_VERSION);
function funded(): WorldState {
  const state = world();
  for (const actor of state.civilizations) actor.resources = { food: 500, materials: 200, energy: 200, credits: 200, science: 0, culture: 0 };
  assert.ok(isWorldState(state));
  return state;
}
function aged(state: WorldState, round = 7): WorldState {
  state.round = round; state.independentTurns!.strategyTicks = round;
  assert.ok(isWorldState(state));
  return state;
}
function memoryFor(state: WorldState, seat = 0, phase: BehaviorMemory['phase'] = 'development', since = state.round): BehaviorMemory {
  return { ...createBehaviorMemory(state, seat), phase, phaseSinceRound: since };
}
function act(state: WorldState, seat: number, action: GameAction, seconds: number): WorldState {
  const result = applyCommand(state, { seat, action, expectedRevision: state.revision, timestamp: at(seconds) });
  assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state)); return result.state;
}
function optionsAt(state: WorldState, seat = 0): ActionOption[] { return legalActions(state, seat, at(state.round * 60)); }
function assessed(state: WorldState, options: readonly ActionOption[], profile?: BehaviorProfile, phase: BehaviorMemory['phase'] = 'development', since = state.round, seat = 0) {
  return assessCivilizationBehavior(state, seat, memoryFor(state, seat, phase, since), options, profile);
}


function unposturedProfile(state: WorldState, seat: number): BehaviorProfile {
  const allocation = strategicTemperament(state.seed, seat);
  const template = BEHAVIOR_PROFILES[allocation.templateIndex]!;
  const priorities = { ...template.priorities };
  for (const field of Object.keys(priorities) as BehaviorPriority[])
    priorities[field] *= 0.9 + (behaviorSeed(`${STRATEGIC_TEMPERAMENT_VERSION}/jitter/${state.seed}/${seat}/${allocation.archetypeId}/priority/${field}`) % 201) / 1000;
  return { ...civilizationBehaviorProfile(state.seed, seat, TEMPERAMENT_BEHAVIOR_POLICY_VERSION), priorities,
    commitmentRounds: template.commitmentRounds, settlementGoal: template.settlementGoal };
}

void test('current fresh v2 and Food-v3 configurations produce legal deterministic decisions, Director results and paid transitions', () => {
  const configurations = [
    { release: 'settlement-regional-targets-1', policy: BEHAVIOR_POLICY_VERSION },
    { release: 'settlement-food-budget-1', policy: FOOD_BUDGET_BEHAVIOR_POLICY_VERSION },
  ] as const;
  for (const configuration of configurations) {
    const state = createGeneratedWorld(73, epoch, configuration.release);
    const repeated = createGeneratedWorld(73, epoch, configuration.release);
    const before = structuredClone(state);
    assert.deepEqual(state, repeated);
    assert.equal(behaviorPolicyVersion(state), configuration.policy);
    assert.equal(state.releaseId, configuration.release);
    assert.equal(state.revision, 0);
    assert.deepEqual(state.events.map(event => event.type), ['world-founded']);
    for (let seat = 0; seat <= 5; seat++) {
      const options = legalActions(state, seat, epoch);
      for (let cursor = 0; cursor < 4; cursor++) {
        const memory = { ...createBehaviorMemory(state, seat), decisionCount: cursor };
        const repeatedMemory = { ...createBehaviorMemory(repeated, seat), decisionCount: cursor };
        const memoryBefore = structuredClone(memory);
        assert.equal(memory.policyVersion, configuration.policy);
        const decision = chooseCivilizationBehavior(state, seat, memory, epoch);
        assert.ok(decision.action);
        assert.equal(decision.memory.policyVersion, configuration.policy);
        assert.equal(decision.memory.decisionCount, cursor + 1);
        assert.ok(options.some(option => sameAction(option.action, decision.action)));
        assert.deepEqual(chooseCivilizationBehavior(repeated, seat, repeatedMemory, epoch), decision);
        const command: import('../core/types.ts').Command = { seat, action: decision.action, expectedRevision: state.revision, timestamp: epoch };
        const result = applyCommand(state, command);
        assert.ok(result.ok, result.error);
        assert.ok(isWorldState(result.state));
        assert.equal(result.state.revision, state.revision + 1);
        assert.ok(result.events.length > 0);
        assert.deepEqual(applyCommand(repeated, command), result);
        if (cursor === 0) {
          const restarted = JSON.parse(JSON.stringify(result.state)) as WorldState;
          const restartedMemory = JSON.parse(JSON.stringify(decision.memory)) as BehaviorMemory;
          const continuation = chooseCivilizationBehavior(result.state, seat, decision.memory, at(10));
          assert.deepEqual(chooseCivilizationBehavior(restarted, seat, restartedMemory, at(10)), continuation);
          assert.ok(continuation.action);
          const next = { seat, action: continuation.action, expectedRevision: result.state.revision, timestamp: at(10) };
          const continued = applyCommand(result.state, next);
          assert.ok(continued.ok, continued.error);
          assert.deepEqual(applyCommand(restarted, next), continued);
        }
        assert.deepEqual(memory, memoryBefore);
        assert.deepEqual(repeatedMemory, memoryBefore);
      }
    }
    const damaged = structuredClone(state);
    damaged.civilizations[0]!.resources = { food: 500, materials: 200, energy: 200, credits: 200, science: 0, culture: 0 };
    damaged.cities[0]!.damage = 75;
    assert.ok(isWorldState(damaged));
    const damagedBefore = structuredClone(damaged);
    const repair = chooseCivilizationBehavior(damaged, 0, undefined, epoch);
    assert.deepEqual(repair.action, { type: 'repair-city', cityId: 'city-0' });
    assert.ok(repair.action);
    assert.equal(repair.memory.policyVersion, configuration.policy);
    const restoredDamage = JSON.parse(JSON.stringify(damaged)) as WorldState;
    assert.deepEqual(chooseCivilizationBehavior(restoredDamage, 0, undefined, epoch), repair);
    const repaired = act(damaged, 0, repair.action, 0);
    assert.deepEqual(act(restoredDamage, 0, repair.action, 0), repaired);
    assert.equal(repaired.cities[0]!.damage, 75 - ECONOMY_RULES.repair.damageReduction);
    for (const resource of RESOURCE_IDS) assert.equal(repaired.civilizations[0]!.resources[resource],
      damaged.civilizations[0]!.resources[resource] - (ECONOMY_RULES.repair.cost[resource as keyof typeof ECONOMY_RULES.repair.cost] ?? 0));
    assert.ok(repaired.events.some(event => event.type === 'city-repaired'));
    assert.deepEqual(damaged, damagedBefore);
    assert.deepEqual(restoredDamage, damagedBefore);
    assert.deepEqual(state, before);
    assert.deepEqual(repeated, before);
  }
});

void test('v4 records its own identity but inherits both Food-v3 draw families without reseeding the Director', () => {
  const baseline = createGeneratedWorld(73, epoch, 'settlement-food-budget-1');
  const temperament = structuredClone(baseline); temperament.origin!.temperamentVersion = STRATEGIC_TEMPERAMENT_VERSION;
  assert.equal(behaviorDrawVersion(TEMPERAMENT_BEHAVIOR_POLICY_VERSION), FOOD_BUDGET_BEHAVIOR_POLICY_VERSION);
  for (let cursor = 0; cursor < 32; cursor++) {
    const oldMemory = createBehaviorMemory(baseline, 5); oldMemory.decisionCount = cursor;
    const newMemory = createBehaviorMemory(temperament, 5); newMemory.decisionCount = cursor;
    const oldDecision = chooseDirectorBehavior(baseline, oldMemory, epoch);
    const newDecision = chooseDirectorBehavior(temperament, newMemory, epoch);
    assert.deepEqual({ ...newDecision, memory: { ...newDecision.memory, policyVersion: oldDecision.memory.policyVersion } }, oldDecision);
    assert.deepEqual(chooseDirectorBehavior(JSON.parse(JSON.stringify(temperament)) as WorldState, JSON.parse(JSON.stringify(newMemory)) as BehaviorMemory, epoch), newDecision);
  }
});

void test('same validated state exposes real funded expansion versus domestic posture and preserves switching hysteresis', () => {
  const state = aged(funded());
  const options = optionsAt(state).filter(option => ['settle', 'research', 'wait'].includes(option.action.type));
  assert.ok(options.some(option => option.action.type === 'settle'));
  assert.ok(options.some(option => option.action.type === 'research'));
  const profile = { ...BEHAVIOR_PROFILES[1]!, id: createBehaviorMemory(state, 0).profileId };
  const compact = applyStrategicPosture(profile, 'compact'); const outward = applyStrategicPosture(profile, 'outward');
  const original = structuredClone(state);
  const compactPlan = assessed(state, options, compact, 'development', 0);
  const outwardPlan = assessed(state, options, outward, 'development', 0);
  assert.equal(compactPlan.phase, 'development'); assert.equal(outwardPlan.phase, 'expansion');
  const founding = options.find(option => option.action.type === 'settle')!;
  const compactFounding = compactPlan.candidates.find(candidate => candidate.option === founding)!;
  const outwardFounding = outwardPlan.candidates.find(candidate => candidate.option === founding)!;
  assert.ok(outwardFounding.weight > compactFounding.weight);
  assert.equal(compactFounding.ordinaryWeight, compactFounding.weight * 0.85);
  assert.equal(outwardFounding.ordinaryWeight, outwardFounding.weight);
  const research = compactPlan.candidates.find(candidate => candidate.option.action.type === 'research')!;
  assert.equal(research.ordinaryWeight, research.weight * 1.15);
  assert.equal(assessed(state, options, outward, 'development', state.round).phase, 'development');
  assert.equal(assessed(state, options, outward, 'expansion', state.round).phase, 'expansion');
  assert.equal(assessed(state, options.filter(option => option.action.type !== 'settle'), outward, 'expansion', state.round).phase, 'development');
  assert.equal(assessed(state, [], compact, 'development', state.round).phase, 'consolidation');
  assert.equal(compactPlan.commitmentUntilRound, 7); assert.equal(outwardPlan.commitmentUntilRound, 12);
  assert.deepEqual(state, original);
});

void test('phase factors are weak, classified and zero-preserving, with no extra expansion multiplier or generic rail label', () => {
  const actions: GameAction[] = [
    { type: 'research', technology: 'agriculture' }, { type: 'build', cityId: 'city-0', project: 'farm' },
    { type: 'choose-civic', civicId: 'craftsmanship' }, { type: 'settle', tileId: 0 },
    { type: 'propose-trade', partner: 1, recipeId: 'harvest-for-materials' }, { type: 'respond-trade', offerId: 'offer', accept: true },
    { type: 'respond-trade', offerId: 'offer', accept: false }, { type: 'focus', cityId: 'city-0', focus: 'growth' },
    { type: 'repair-city', cityId: 'city-0' }, { type: 'set-building-operation', cityId: 'city-0', buildingId: 'farm', enabled: true },
    { type: 'build-rail', cityId: 'city-0', fromTileId: 0, toTileId: 1 }, { type: 'wait' },
  ];
  for (const phase of ['survival', 'recovery', 'development', 'expansion', 'trade', 'consolidation'] as const) for (const action of actions) {
    assert.equal(ordinaryPhaseWeight(action, 0, phase), 0);
    assert.ok([8.5, 10, 11.5].includes(ordinaryPhaseWeight(action, 10, phase)));
    if (['survival', 'recovery', 'expansion'].includes(phase) || ['build-rail', 'wait'].includes(action.type) || action.type === 'respond-trade' && !action.accept)
      assert.equal(ordinaryPhaseWeight(action, 10, phase), 10);
  }
  assert.equal(ordinaryPhaseWeight(actions[4]!, 10, 'trade'), 11.5);
  assert.equal(ordinaryPhaseWeight(actions[4]!, 10, 'development'), 8.5);
  assert.equal(ordinaryPhaseWeight(actions[3]!, 10, 'trade'), 8.5);
  assert.equal(ordinaryPhaseWeight(actions[7]!, 10, 'consolidation'), 11.5);
});

void test('each posture obeys actual next-beat Food danger, damage recovery and immediate loss of funding', () => {
  const state = funded(); const seat = 0; const actor = state.civilizations[seat]!;
  for (const posture of ['compact', 'measured', 'outward'] as const) {
    const profile = applyStrategicPosture(unposturedProfile(state, seat), posture);
    const risk = structuredClone(state); risk.civilizations[seat]!.resources.food = 0; risk.cities[seat]!.focus = 'research';
    const food = assessed(risk, optionsAt(risk), profile, 'expansion');
    assert.equal(food.phase, 'survival'); assert.equal(food.foodRisk, true);
    assert.ok(food.candidates.filter(candidate => ['settle', 'settle-coast'].includes(candidate.option.action.type)).every(candidate => candidate.weight === 0));
    const damage = structuredClone(state); damage.cities[seat]!.damage = 75;
    assert.equal(assessed(damage, optionsAt(damage), profile, 'expansion').phase, 'recovery');
    const unfunded = structuredClone(state); unfunded.civilizations[seat]!.resources.materials = ECONOMY_RULES.settle.cost.materials;
    const options = optionsAt(unfunded).filter(option => ['settle', 'wait'].includes(option.action.type));
    assert.ok(options.some(option => option.action.type === 'settle'));
    const plan = assessed(unfunded, options, profile, 'expansion');
    assert.equal(plan.phase, 'consolidation'); assert.ok(plan.candidates.filter(candidate => candidate.option.action.type === 'settle').every(candidate => candidate.weight === 0));
  }
  state.cities[seat]!.population = 20;
  actor.resources.food = civilizationFoodUpkeep(state, seat) * 3.5; state.cities[seat]!.focus = 'research';
  assert.ok(isWorldState(state));
  assert.ok(forecastCivilizationFoodProduction(state, seat) < civilizationFoodUpkeep(state, seat));
  const decision = chooseCivilizationBehavior(state, seat, undefined, epoch);
  assert.equal(decision.explanation.phase, 'survival'); assert.equal(decision.action?.type, 'focus');
});

void test('ordinary town goal suppresses discretionary founding but retains a funded earned coast opportunity', () => {
  let state = funded(); const seat = state.cities.find(city => !isCoastalSite(state, city.tileId))!.civId;
  state.cities.find(city => city.civId === seat)!.population = 18;
  for (let index = 0; index < 2; index++) {
    const option = legalActions(state, seat, at(index * 10)).find(option => option.action.type === 'settle' && !isCoastalSite(state, option.action.tileId));
    assert.ok(option); state = act(state, seat, option.action, index * 10);
  }
  assert.equal(state.cities.filter(city => city.civId === seat).length, 3);
  const profile = applyStrategicPosture(unposturedProfile(state, seat), 'compact');
  const options = legalActions(state, seat, at(20));
  const inland = options.find(option => option.action.type === 'settle' && !isCoastalSite(state, option.action.tileId)); assert.ok(inland);
  assert.equal(assessed(state, [inland], profile, 'development', state.round, seat).candidates[0]!.weight, 0);
  const coast = structuredClone(state);
  assert.equal(inland.action.type, 'settle'); if (inland.action.type !== 'settle') return;
  const site = coast.tiles[inland.action.tileId]!;
  const protectedTiles = new Set([...coast.cities.map(city => city.tileId), ...coast.strategicDeposits!.tileIds, ...coast.coalDeposits!.tileIds, ...coast.pastoralSites!.tileIds]);
  const adjacent = coast.tiles.find(tile => tile.owner === null && !protectedTiles.has(tile.id) && hexDistance(tile, site) === 1); assert.ok(adjacent);
  adjacent.terrain = 'ocean'; adjacent.resource = null;
  assert.ok(isWorldState(coast)); assert.ok(isCoastalSite(coast, site.id));
  const coastal = legalActions(coast, seat, at(20)).find(option => sameAction(option.action, inland.action)); assert.ok(coastal);
  const plan = assessed(coast, [coastal], profile, 'expansion', coast.round, seat);
  assert.equal(plan.phase, 'expansion'); assert.ok(plan.candidates[0]!.weight > 0);
});

function useful(state: WorldState, seat: number, terms: TradeTerms, proposer: boolean, policy: BehaviorPolicyVersion = TEMPERAMENT_BEHAVIOR_POLICY_VERSION): boolean {
  const actor = state.civilizations[seat]!; const profile = civilizationBehaviorProfile(state.seed, seat, policy);
  const incoming = proposer ? terms.recipientCargo : terms.proposerCargo;
  const yields = proposer ? terms.proposerYield : terms.recipientYield;
  const outgoing = proposer ? terms.proposerCargo : terms.recipientCargo;
  const upkeep = proposer ? terms.proposerUpkeep : terms.recipientUpkeep;
  const desired = { food: civilizationFoodUpkeep(state, seat) * 4, materials: 24, energy: 12, credits: 24, science: 0, culture: 0 };
  let gain = 0; let loss = 0; let stableGain = 0; let stableLoss = 0;
  for (const resource of RESOURCE_IDS) {
    const weight = profile.resources[resource]; const need = 1 + desired[resource] / Math.max(1, actor.resources[resource] + desired[resource]);
    const receives = ((incoming[resource] ?? 0) + (yields[resource] ?? 0)) * weight;
    const pays = ((outgoing[resource] ?? 0) + (upkeep[resource] ?? 0)) * weight;
    gain += receives * need; loss += pays * need; stableGain += receives; stableLoss += pays;
  }
  return gain >= loss * 0.85 || stableGain >= stableLoss * 0.85;
}

void test('self and partner diplomacy use the same exact seeded profiles, not the old seat allocations', () => {
  const state = funded(); let discriminating = 0; let usefulExchanges = 0;
  for (let seat = 0; seat < 5; seat++) {
    const options = optionsAt(state, seat).filter(option => option.action.type === 'propose-trade' && !option.action.transportMode);
    assert.ok(options.length > 0);
    const plan = deriveDiplomacyPlan(state, state.civilizations[seat]!, civilizationBehaviorProfile(state.seed, seat, TEMPERAMENT_BEHAVIOR_POLICY_VERSION), options);
    for (const option of options) {
      const action = option.action; assert.equal(action.type, 'propose-trade'); if (action.type !== 'propose-trade') continue;
      const terms = TRADE_RECIPES.find(recipe => recipe.id === action.recipeId)!.terms;
      const expected = useful(state, seat, terms, true) && useful(state, action.partner, terms, false);
      const old = useful(state, seat, terms, true, FOOD_BUDGET_BEHAVIOR_POLICY_VERSION) && useful(state, action.partner, terms, false, FOOD_BUDGET_BEHAVIOR_POLICY_VERSION);
      assert.equal(diplomacyWeight(option, 1, plan) > 0, expected);
      if (expected !== old) discriminating++;
      if (expected) usefulExchanges++;
    }
  }
  assert.ok(discriminating > 0); assert.ok(usefulExchanges > 0);
});

void test('useful funded exchanges support trade while refusals and unavailable cargo cannot trap its commitment', () => {
  const state = funded();
  const opportunities = state.civilizations.flatMap(actor => {
    const options = optionsAt(state, actor.id); const plan = assessed(state, options, undefined, 'trade', state.round, actor.id);
    return plan.candidates.filter(candidate => candidate.weight > 0 && candidate.option.action.type === 'propose-trade').map(candidate => ({ seat: actor.id, option: candidate.option }));
  });
  const exchange = opportunities[0]; assert.ok(exchange);
  const plan = assessed(state, [exchange.option], undefined, 'trade', state.round, exchange.seat);
  assert.equal(plan.phase, 'trade'); assert.equal(plan.candidates[0]!.ordinaryWeight, plan.candidates[0]!.weight * 1.15);
  const action = exchange.option.action; assert.equal(action.type, 'propose-trade'); if (action.type !== 'propose-trade') return;
  const proposed = act(state, exchange.seat, action, 0);
  const offer = proposed.tradeOffers!.find(candidate => candidate.status === 'pending')!;
  proposed.civilizations[exchange.seat]!.resources.energy = 0;
  const responses = legalActions(proposed, action.partner, epoch).filter(option => option.action.type === 'respond-trade' && option.action.offerId === offer.id);
  assert.ok(responses.some(option => option.action.type === 'respond-trade' && !option.action.accept));
  const refused = assessed(proposed, responses, undefined, 'trade', state.round, action.partner);
  assert.notEqual(refused.phase, 'trade');
  assert.ok(refused.candidates.some(candidate => candidate.option.action.type === 'respond-trade' && !candidate.option.action.accept && candidate.weight > 0));
  assert.ok(refused.candidates.filter(candidate => candidate.option.action.type === 'respond-trade' && candidate.option.action.accept).every(candidate => candidate.weight === 0));
});

void test('all allocated personalities preserve emergency preemption, urgent-budget fairness and paid required commitments', () => {
  let state = funded();
  for (const city of state.cities) city.focus = 'research';
  for (let seat = 0; seat < 5; seat++) {
    const low = structuredClone(state); low.civilizations[seat]!.resources.food = 0;
    const emergency = chooseCivilizationBehavior(low, seat, undefined, epoch);
    assert.equal(emergency.explanation.phase, 'survival'); assert.deepEqual(emergency.action, { type: 'focus', cityId: `city-${seat}`, focus: 'growth' });
    const bounded = memoryFor(low, seat, 'expansion'); bounded.urgentStreak = 2;
    const fair = chooseCivilizationBehavior(low, seat, bounded, epoch);
    assert.equal(fair.explanation.required, true); assert.equal(fair.memory.urgentStreak, 0);
  }
  state.civilizations[0]!.technologies = ['agriculture']; state.cities[0]!.damage = 75;
  let memory = memoryFor(state); memory.urgentStreak = 2;
  const lanes = new Set<string>();
  for (let index = 0; index < 3; index++) {
    memory.urgentStreak = 2;
    const decision = chooseCivilizationBehavior(state, 0, memory, at(index * 10));
    assert.ok(decision.action); assert.equal(decision.explanation.required, true);
    lanes.add(decision.memory.lastRequiredLane!);
    state = act(state, 0, decision.action, index * 10); memory = decision.memory;
  }
  assert.deepEqual([...lanes].sort(), ['civic', 'construction:city-0', 'research']);
  assert.ok(state.civilizations[0]!.researchTarget); assert.ok(state.cities[0]!.construction?.active);
  assert.equal(state.cities[0]!.damage, 75);
  const repair = chooseCivilizationBehavior(state, 0, memory, at(30)); assert.equal(repair.action?.type, 'repair-city'); assert.ok(repair.action);
  const old = structuredClone(state); state = act(state, 0, repair.action, 30);
  assert.equal(state.civilizations[0]!.resources.materials, old.civilizations[0]!.resources.materials - 5);
  assert.equal(state.civilizations[0]!.resources.energy, old.civilizations[0]!.resources.energy - 2);
});

void test('promised relief supplies stay protected under every posture and every ordinary phase', () => {
  const state = funded();
  const corridor = state.civilizations.flatMap(actor => optionsAt(state, actor.id).map(option => ({ seat: actor.id, option })))
    .find(({ option }) => option.action.type === 'propose-trade' && option.action.recipeId === 'energy-for-materials' && option.tradeQuote?.transport.mode === 'land' && option.tradeQuote.transport.edges <= 12);
  assert.ok(corridor); const trade = corridor.option.action; assert.equal(trade.type, 'propose-trade'); if (trade.type !== 'propose-trade') return;
  const donor = corridor.seat; const beneficiary = trade.partner;
  const source = state.cities.find(city => city.id === trade.sourceCityId)!; const recipient = state.cities.find(city => city.id === trade.recipientCityId)!;
  source.population = 10; recipient.population = 30;
  const events: GameEvent[] = [];
  state.revision++; executeTradeAction(state, donor, trade, events); commitEvents(state, events);
  const offer = state.tradeOffers!.at(-1)!; const acceptance: GameEvent[] = [];
  state.revision++; executeTradeAction(state, beneficiary, { type: 'respond-trade', offerId: offer.id, accept: true }, acceptance); commitEvents(state, acceptance);
  state.civilizations[beneficiary]!.resources.food = 0;
  const route = state.routes[0]!; const relief: GameEvent[] = [];
  const proposal = { type: 'propose-relief' as const, routeId: route.id, sourceCityId: source.id, recipientCityId: recipient.id };
  const quote = quoteReliefProposal(state, donor, proposal); assert.ok(quote.ok, quote.ok ? undefined : quote.reason);
  assert.ok(quote.terms.path.edges <= 12);
  state.revision++; assert.ok(executeReliefAction(state, donor, proposal, relief)); commitEvents(state, relief);
  const charter = state.relief!.active[0]!; const consent: GameEvent[] = [];
  state.revision++; assert.ok(executeReliefAction(state, beneficiary, { type: 'respond-relief', charterId: charter.id, accept: true }, consent)); commitEvents(state, consent);
  state.civilizations[donor]!.resources.food = charter.terms.food + civilizationFoodUpkeep(state, donor) * 2 + ECONOMY_RULES.settle.cost.food - 1;
  assert.ok(isWorldState(state)); const before = structuredClone(state);
  const options = optionsAt(state, donor); assert.ok(options.some(option => option.action.type === 'settle'));
  for (const posture of ['compact', 'measured', 'outward'] as const) for (const phase of ['development', 'expansion', 'trade', 'consolidation'] as const) {
    const profile = applyStrategicPosture(unposturedProfile(state, donor), posture);
    const plan = assessed(state, options, profile, phase, state.round, donor);
    const founding = plan.candidates.filter(candidate => candidate.option.action.type === 'settle'); assert.ok(founding.length > 0);
    assert.ok(founding.every(candidate => candidate.protected && candidate.weight === 0 && candidate.ordinaryWeight === 0));
  }
  assert.deepEqual(state, before);
});

void test('same-state 32-cursor discretionary choices respond to viable phases without altering required or emergency choices', () => {
  let state = funded();
  for (const actor of state.civilizations) actor.technologies = ['agriculture'];
  const seat = state.civilizations.find(actor => {
    const options = optionsAt(state, actor.id);
    return assessed(state, options, undefined, 'trade', 0, actor.id).candidates.some(candidate => candidate.option.action.type === 'propose-trade' && candidate.weight > 0);
  })!.id;
  const draw = (phase: BehaviorMemory['phase'], cursor: number, snapshot = state, seconds = 0) => {
    const memory = memoryFor(snapshot, seat, phase); memory.decisionCount = cursor;
    return chooseCivilizationBehavior(snapshot, seat, memory, at(seconds));
  };
  for (let cursor = 0; cursor < 32; cursor++) {
    const expansion = draw('expansion', cursor); const trade = draw('trade', cursor);
    assert.equal(expansion.explanation.required, true); assert.equal(trade.explanation.required, true);
    assert.deepEqual(expansion.action, trade.action);
  }
  for (const [index, type] of ['choose-civic', 'build', 'research'].entries()) {
    const option = legalActions(state, seat, at(index * 10)).find(option => option.action.type === type); assert.ok(option);
    state = act(state, seat, option.action, index * 10);
  }
  const options = legalActions(state, seat, at(30)); const original = structuredClone(state);
  const expansion = assessed(state, options, undefined, 'expansion', 0, seat);
  const trade = assessed(state, options, undefined, 'trade', 0, seat);
  assert.equal(expansion.phase, 'expansion'); assert.equal(trade.phase, 'trade');
  let differences = 0; const alternatives = new Set<string>();
  for (let cursor = 0; cursor < 32; cursor++) {
    const spreading = draw('expansion', cursor, state, 30); const exchanging = draw('trade', cursor, state, 30);
    assert.equal(spreading.explanation.required, false); assert.equal(exchanging.explanation.required, false);
    assert.ok(options.some(option => sameAction(option.action, spreading.action)));
    assert.ok(options.some(option => sameAction(option.action, exchanging.action)));
    if (!sameAction(spreading.action!, exchanging.action!)) differences++;
    alternatives.add(spreading.action!.type); alternatives.add(exchanging.action!.type);
    const danger = structuredClone(state); danger.civilizations[seat]!.resources.food = 0; danger.cities[seat]!.focus = 'research';
    assert.deepEqual(draw('expansion', cursor, danger, 30).action, draw('trade', cursor, danger, 30).action);
  }
  assert.ok(differences > 0); assert.ok(alternatives.size > 1); assert.deepEqual(state, original);
});
