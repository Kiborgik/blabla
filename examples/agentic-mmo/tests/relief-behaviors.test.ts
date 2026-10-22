import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { BEHAVIOR_PROFILES, civilizationBehaviorProfile, type BehaviorPriority, type BehaviorProfile } from '../core/behavior-profiles.ts';
import { deriveDiplomacyPlan, diplomacyWeight } from '../core/behavior-diplomacy.ts';
import { deriveReliefPlan, reliefPriority, reliefProtects, reliefReason, reliefWeight } from '../core/behavior-relief.ts';
import { chooseCivilizationBehavior, createBehaviorMemory, isBehaviorMemory } from '../core/behaviors.ts';
import { ECONOMY_RULES } from '../core/content.ts';
import { applyCommand, applyRelease, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { RELEASES } from '../core/release.ts';
import { RELIEF_RULES } from '../core/relief-content.ts';
import type { ReliefAction, ReliefCharter } from '../core/relief-types.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { availableReliefActions, executeReliefAction, quoteReliefProposal, reliefActionFailure, resolveReliefCharters } from '../core/simulation/relief-charters.ts';
import { executePublicProjectAction } from '../core/simulation/public-projects.ts';
import { executeTradeAction } from '../core/simulation/trade.ts';
import { isWorldState } from '../core/validation.ts';
import type { ActionOption, GameAction, GameEvent, WorldState } from '../core/types.ts';

const epoch = '2000-01-01T00:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
function released(seed = 1701, until = 'settlement-relief-charters-1'): WorldState {
  let state = createWorld(seed, epoch);
  for (const release of RELEASES.slice(1)) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, timestamp: epoch });
    assert.ok(result.ok, result.error); state = result.state;
    if (release.id === until) break;
  }
  assert.equal(state.releaseId, until); return state;
}
function syntheticCorridor(): WorldState {
  const state = released();
  for (const city of state.cities) { city.focus = 'growth'; city.buildings = ['farm', 'monument']; }
  const source = state.cities.find(city => city.civId === 1)!; const destination = state.cities.find(city => city.civId === 4)!;
  state.revision++; let events: GameEvent[] = [];
  executeTradeAction(state, 1, { type: 'propose-trade', partner: 4, recipeId: 'harvest-for-materials', sourceCityId: source.id, recipientCityId: destination.id }, events); commitEvents(state, events);
  const offer = state.tradeOffers!.at(-1)!;
  state.revision++; events = [];
  executeTradeAction(state, 4, { type: 'respond-trade', offerId: offer.id, accept: true }, events); commitEvents(state, events);
  source.population = 10; destination.population = 30;
  state.civilizations[1]!.resources.food = 100; state.civilizations[1]!.resources.energy = 30;
  state.civilizations[4]!.resources.food = 0; state.civilizations[4]!.resources.materials = 0;
  assert.ok(isWorldState(state)); return state;
}
function proposal(state: WorldState): Extract<ReliefAction, { type: 'propose-relief' }> {
  const route = state.routes[0]!; return { type: 'propose-relief', routeId: route.id, sourceCityId: route.from, recipientCityId: route.to };
}
function direct(state: WorldState, seat: number, action: ReliefAction): ReliefCharter | undefined {
  state.revision++; const events: GameEvent[] = [];
  assert.ok(executeReliefAction(state, seat, action, events)); commitEvents(state, events);
  return state.relief!.active[0];
}
function pending(state: WorldState): ReliefCharter { return direct(state, 1, proposal(state))!; }
function accepted(state: WorldState): ReliefCharter {
  const charter = pending(state); return direct(state, 4, { type: 'respond-relief', charterId: charter.id, accept: true })!;
}
function planning(state: WorldState, seat: number, options = availableReliefActions(state, seat), profile = civilizationBehaviorProfile(state.seed, seat)) {
  const actor = state.civilizations[seat]!;
  const plan = deriveReliefPlan(state, actor, profile, options);
  const weight = (predicate: (action: GameAction) => boolean): number => {
    const option = options.find(option => predicate(option.action)); assert.ok(option); return reliefWeight(option, 10, plan);
  };
  return { options, plan, weight };
}
function command(state: WorldState, seat: number, action: GameAction, seconds = 0): WorldState {
  const result = applyCommand(state, { seat, expectedRevision: state.revision, timestamp: at(seconds), action });
  assert.ok(result.ok, result.error); return result.state;
}

void test('old-release v2 decisions, explanations, candidate order and memory retain the pinned digest', () => {
  const state = released(73, 'settlement-interplanetary-1'); const decisions = [];
  for (let seat = 0; seat < 5; seat++) for (let cursor = 0; cursor < 12; cursor++) {
    const memory = createBehaviorMemory(state, seat); memory.decisionCount = cursor;
    decisions.push(chooseCivilizationBehavior(state, seat, memory, epoch));
  }
  assert.equal(createHash('sha256').update(JSON.stringify(decisions)).digest('hex'), 'ca0f486fcc9eaf513cb7f89be9c08886720643d0643dea32f46d174e255c429b');
  const options = legalActions(state, 1, epoch); const p = planning(state, 1, options);
  assert.equal(p.plan.assessments.size, 0); assert.deepEqual(availableReliefActions(state, 1), []);
  for (const option of options) { assert.equal(reliefWeight(option, 17, p.plan), 17); assert.equal(reliefPriority(option, p.plan), 0); assert.equal(reliefProtects(option, p.plan), false); }
});

void test('synthetic paid corridor produces actual autonomous proposal, explicit acceptance and one conserved due transfer', () => {
  let state = syntheticCorridor(); const original = structuredClone(state);
  const probe = Array.from({ length: 32 }, (_, cursor) => {
    const memory = createBehaviorMemory(state, 1); memory.decisionCount = cursor;
    return { memory, decision: chooseCivilizationBehavior(state, 1, memory, epoch) };
  }).find(probe => probe.decision.action?.type === 'propose-relief'); assert.ok(probe);
  const { memory, decision: proposalDecision } = probe;
  assert.deepEqual(proposalDecision.action, proposal(state)); assert.deepEqual(state, original);
  assert.equal(memory.decisionCount + 1, proposalDecision.memory.decisionCount);
  assert.match(proposalDecision.explanation.reason, /Food.*relief|relief.*Food/);
  assert.ok(proposalDecision.action); state = command(state, 1, proposalDecision.action);
  const charter = structuredClone(state.relief!.active[0]!); assert.equal(charter.terms.food, 30);
  const response = chooseCivilizationBehavior(state, 4, undefined, epoch);
  assert.deepEqual(response.action, { type: 'respond-relief', charterId: charter.id, accept: true }); assert.ok(response.action);
  state = command(state, 4, response.action); const committed = state.relief!.active[0]!; assert.equal(committed.status, 'accepted');
  if (committed.status !== 'accepted') return;
  const caught = catchUpStrategy(state, at(committed.dueRound * 60)); assert.ok(caught.ok, caught.error); state = caught.state;
  const result = state.relief!.lastResults[1]!; assert.equal(result.outcome, 'delivered'); assert.deepEqual(result.charter.terms, charter.terms);
  assert.equal(result.before.donorFood - result.after.donorFood, 30); assert.equal(result.after.recipientFood - result.before.recipientFood, 30);
  assert.equal(result.before.donorEnergy - result.after.donorEnergy, 1);
  const repeated = catchUpStrategy(state, at(committed.dueRound * 60)); assert.ok(repeated.ok); assert.deepEqual(repeated.state, state);
  assert.ok(isBehaviorMemory(JSON.parse(JSON.stringify(proposalDecision.memory))));
});

void test('synthetic proposal weights use canonical need and unpromised surplus with soft positive priorities rather than identity classes', () => {
  const state = syntheticCorridor(); const options = availableReliefActions(state, 1); const option = options.find(option => option.action.type === 'propose-relief')!;
  const original = structuredClone(state); const weights = [];
  for (let seat = 0; seat < 5; seat++) {
    const profile = civilizationBehaviorProfile(state.seed, seat); const plan = planning(state, 1, options, profile).plan;
    weights.push(reliefWeight(option, 0, plan)); assert.ok(reliefWeight(option, 0, plan) > 0); assert.ok(reliefPriority(option, plan) > 0);
  }
  assert.ok(new Set(weights).size > 1); assert.deepEqual(state, original);
  const profile = civilizationBehaviorProfile(state.seed, 1); const renamed: BehaviorProfile = { ...profile, id: 'not-an-altruist-class', name: 'Synthetic profile' };
  assert.equal(reliefWeight(option, 0, planning(state, 1, options, profile).plan), reliefWeight(option, 0, planning(state, 1, options, renamed).plan));
  const quote = quoteReliefProposal(state, 1, proposal(state)); assert.ok(quote.ok);
  state.civilizations[1]!.resources.food = quote.terms.proposal.promisedFood + 10 * ECONOMY_RULES.populationFoodUpkeep * 4 + 5;
  assert.equal(reliefWeight(option, 1000, planning(state, 1, [option]).plan), 0);
  assert.equal(availableReliefActions(state, 1).filter(option => option.action.type === 'propose-relief').length, 0);
});

void test('synthetic recipient accepts immutable cargo with any useful reserve need but explicitly declines a recovered pending offer', () => {
  const state = syntheticCorridor(); const charter = pending(state); const terms = structuredClone(charter.terms);
  state.civilizations[4]!.resources.food = 29;
  let plan = planning(state, 4); assert.ok(plan.weight(action => action.type === 'respond-relief' && action.accept) > 0);
  assert.equal(plan.weight(action => action.type === 'respond-relief' && !action.accept), 0); assert.deepEqual(state.relief!.active[0]!.terms, terms);
  state.civilizations[4]!.resources.food = 30; plan = planning(state, 4);
  assert.equal(plan.weight(action => action.type === 'respond-relief' && action.accept), 0);
  assert.ok(plan.weight(action => action.type === 'respond-relief' && !action.accept) > 0);
  const decision = chooseCivilizationBehavior(state, 4, undefined, epoch);
  assert.deepEqual(decision.action, { type: 'respond-relief', charterId: charter.id, accept: false });
});

void test('synthetic accepted recipient recovery is a hysteretic voluntary choice, never a hard due deficit gate', () => {
  const state = syntheticCorridor(); const charter = accepted(state); assert.equal(charter.status, 'accepted'); if (charter.status !== 'accepted') return;
  const terms = structuredClone(charter.terms); state.civilizations[4]!.resources.food = 37.5;
  assert.equal(planning(state, 4).weight(action => action.type === 'withdraw-relief'), 0);
  state.civilizations[4]!.resources.food = 45;
  assert.ok(planning(state, 4).weight(action => action.type === 'withdraw-relief') > 0);
  assert.deepEqual(chooseCivilizationBehavior(state, 4, undefined, epoch).action, { type: 'withdraw-relief', charterId: charter.id });
  const due = structuredClone(state); due.round = charter.dueRound; due.revision++; const events: GameEvent[] = [];
  resolveReliefCharters(due, events); commitEvents(due, events);
  assert.equal(due.relief!.lastResults[1]!.outcome, 'delivered'); assert.deepEqual(due.relief!.lastResults[1]!.charter.terms, terms);
});

void test('synthetic donor risk prompts explicit withdrawal without reducing cargo or labeling shortage betrayal', () => {
  const state = syntheticCorridor(); const charter = accepted(state); const terms = structuredClone(charter.terms);
  state.civilizations[1]!.resources.food = charter.terms.food + 1;
  const plan = planning(state, 1); const option = plan.options.find(option => option.action.type === 'withdraw-relief')!;
  assert.ok(reliefWeight(option, 0, plan.plan) > 0); assert.ok(reliefPriority(option, plan.plan) > 0);
  assert.match(reliefReason(option, plan.plan)!, /reserve|supplies/); assert.doesNotMatch(reliefReason(option, plan.plan)!, /betray|punish|defect/i);
  const decision = chooseCivilizationBehavior(state, 1, undefined, epoch); assert.deepEqual(decision.action, option.action); assert.ok(decision.action);
  const after = command(state, 1, decision.action); assert.deepEqual(after.civilizations, state.civilizations);
  assert.equal(after.relief!.lastResults[1]!.outcome, 'withdrawn'); assert.deepEqual(after.relief!.lastResults[1]!.charter.terms, terms);
});

void test('synthetic current promises protect donor spending and exact route consent but incoming relief never becomes spendable stock', () => {
  const state = syntheticCorridor(); const charter = accepted(state);
  const settle: ActionOption = { action: { type: 'settle', tileId: 0 }, label: 'Synthetic cost probe', reason: 'Budget only' };
  const stop: ActionOption = { action: { type: 'stop-trade', routeId: charter.terms.routeId }, label: 'Stop exact consent', reason: 'Budget only' };
  state.civilizations[1]!.resources.food = charter.terms.food + ECONOMY_RULES.settle.cost.food - 1;
  const donor = planning(state, 1, [settle, stop]); assert.deepEqual(donor.plan.promised, { food: charter.terms.food, energy: 1 });
  assert.equal(reliefWeight(settle, 1000, donor.plan), 0); assert.equal(reliefProtects(settle, donor.plan), true);
  const recipient = planning(state, 4, [settle]); assert.deepEqual(recipient.plan.promised, {}); assert.equal(reliefWeight(settle, 17, recipient.plan), 17);
  state.civilizations[1]!.resources.food = 100;
  const stable = planning(state, 1, [stop]); assert.equal(reliefWeight(stop, 1000, stable.plan), 0);
  assert.equal(planning(state, 1).weight(action => action.type === 'withdraw-relief'), 0);
  assert.equal(planning(state, 4).weight(action => action.type === 'withdraw-relief'), 0);
});

void test('synthetic unfunded incoming promise neither removes recipient need nor prevents actual funded withdrawal by its donor', () => {
  const state = syntheticCorridor(); const charter = pending(state); const before = structuredClone(state);
  const recipient = planning(state, 4); assert.ok(recipient.weight(action => action.type === 'respond-relief' && action.accept) > 0);
  assert.deepEqual(state, before); state.civilizations[1]!.resources.energy = 0;
  const accept: ActionOption = { action: { type: 'respond-relief', charterId: charter.id, accept: true }, label: 'Old acceptance', reason: 'Stale choice' };
  assert.notEqual(reliefActionFailure(state, 4, accept.action), null);
  assert.equal(reliefWeight(accept, 1000, planning(state, 4, [accept]).plan), 0);
  assert.ok(planning(state, 4).weight(action => action.type === 'respond-relief' && !action.accept) > 0);
  assert.ok(planning(state, 1).weight(action => action.type === 'withdraw-relief') > 0);
});

void test('synthetic repeated opportunities preserve the two-urgent budget and rotate required lanes without replacing commitments', () => {
  const state = syntheticCorridor(); const memory = createBehaviorMemory(state, 1); memory.urgentStreak = 2;
  const first = chooseCivilizationBehavior(state, 1, memory, epoch);
  assert.equal(first.explanation.required, true); assert.equal(first.memory.urgentStreak, 0);
  assert.notEqual(first.action?.type, 'propose-relief'); assert.ok(first.memory.lastRequiredLane);
  const nextMemory = structuredClone(first.memory); nextMemory.urgentStreak = 2;
  const second = chooseCivilizationBehavior(state, 1, nextMemory, epoch);
  assert.equal(second.explanation.required, true); assert.notEqual(second.memory.lastRequiredLane, first.memory.lastRequiredLane);
  assert.ok(second.action && legalActions(state, 1, epoch).some(option => sameAction(option.action, second.action)));
});

void test('synthetic restart preserves legal seeded relief choices and an unchanged promise is never churned away', () => {
  const state = syntheticCorridor(); const charter = accepted(state); const memory = createBehaviorMemory(state, 1);
  const restored = JSON.parse(JSON.stringify(state)) as WorldState; const restoredMemory = JSON.parse(JSON.stringify(memory)) as typeof memory;
  const first = chooseCivilizationBehavior(state, 1, memory, epoch);
  assert.deepEqual(first, chooseCivilizationBehavior(restored, 1, restoredMemory, epoch));
  assert.notDeepEqual(first.action, { type: 'withdraw-relief', charterId: charter.id });
  assert.notDeepEqual(first.action, { type: 'stop-trade', routeId: charter.terms.routeId });
  assert.deepEqual(state.relief, restored.relief); assert.equal(first.memory.version, 2); assert.equal(first.memory.policyVersion, 'weighted-civilizations-v2');
  assert.ok(first.action && legalActions(state, 1, epoch).some(option => sameAction(option.action, first.action)));
});

void test('synthetic canonical cooldown is temporary, with no policy grudge after environmental failure', () => {
  const state = syntheticCorridor(); const charter = accepted(state); state.routes[0]!.damage = 100;
  state.revision++; const events: GameEvent[] = []; resolveReliefCharters(state, events); commitEvents(state, events);
  assert.equal(state.relief!.lastResults[1]!.outcome, 'failed'); state.routes[0]!.damage = 0;
  assert.equal(availableReliefActions(state, 1).filter(option => option.action.type === 'propose-relief').length, 0);
  state.round += RELIEF_RULES.cooldownRounds;
  const plan = planning(state, 1); assert.ok(plan.weight(action => action.type === 'propose-relief') > 0);
  assert.equal(state.relief!.lastResults[1]!.charter.id, charter.id);
});

function addTrade(state: WorldState, proposer: number, recipient: number, consent = false) {
  const option = legalActions(state, proposer, epoch).find(option => option.action.type === 'propose-trade' && option.action.partner === recipient && option.action.recipeId === 'harvest-for-materials'); assert.ok(option); assert.ok(option.action.type === 'propose-trade');
  state.revision++; let events: GameEvent[] = []; executeTradeAction(state, proposer, option.action, events); commitEvents(state, events);
  const offer = state.tradeOffers!.find(offer => offer.proposer === proposer && offer.recipient === recipient && offer.status === 'pending')!; assert.ok(offer);
  if (consent) {
    state.revision++; events = []; executeTradeAction(state, recipient, { type: 'respond-trade', offerId: offer.id, accept: true }, events); commitEvents(state, events);
  }
  return offer;
}

void test('synthetic otherwise useful trade offer is explicitly declined when consent would consume the existing relief pledge', () => {
  const state = syntheticCorridor(); const charter = pending(state); const offer = addTrade(state, 2, 1);
  const actor = state.civilizations[1]!; actor.resources.energy = charter.terms.energy + charter.terms.proposal.promisedEnergy;
  const options = legalActions(state, 1, epoch); const profile = civilizationBehaviorProfile(state.seed, 1);
  const yes = options.find(option => option.action.type === 'respond-trade' && option.action.offerId === offer.id && option.action.accept)!;
  const no = options.find(option => option.action.type === 'respond-trade' && option.action.offerId === offer.id && !option.action.accept)!;
  assert.ok(yes && no); const diplomacy = deriveDiplomacyPlan(state, actor, profile, options);
  assert.ok(diplomacyWeight(yes, 0, diplomacy) > 0); assert.equal(diplomacyWeight(no, 0, diplomacy), 0);
  const relief = deriveReliefPlan(state, actor, profile, options);
  assert.equal(reliefWeight(yes, diplomacyWeight(yes, 0, diplomacy), relief), 0);
  assert.ok(reliefWeight(no, diplomacyWeight(no, 0, diplomacy), relief) > 0);
  assert.equal(planning(state, 1).weight(action => action.type === 'withdraw-relief'), 0);
  const decision = chooseCivilizationBehavior(state, 1, undefined, epoch); assert.deepEqual(decision.action, no.action); assert.ok(decision.action);
  const after = command(state, 1, decision.action); assert.equal(after.tradeOffers!.find(candidate => candidate.id === offer.id)!.status, 'declined');
  assert.deepEqual(after.relief, state.relief); assert.deepEqual(after.civilizations, state.civilizations);
});

void test('synthetic otherwise useful shared repair is explicitly declined when its contribution would spend promised relief Energy', () => {
  const state = syntheticCorridor(); const offer = addTrade(state, 2, 1, true);
  for (const id of [1, 2]) { state.civilizations[id]!.technologies = ['agriculture', 'civic-institutions']; state.civilizations[id]!.era = 1; }
  const charter = pending(state); const route = state.routes.find(route => route.agreement?.offerId === offer.id)!; route.damage = 25;
  state.revision++; const events: GameEvent[] = [];
  executePublicProjectAction(state, 2, { type: 'propose-public-project', routeId: route.id, recipeId: 'joint-road-repair' }, events); commitEvents(state, events);
  const project = state.publicProjects!.find(project => project.routeId === route.id)!;
  const actor = state.civilizations[1]!; actor.resources.energy = charter.terms.energy + charter.terms.proposal.promisedEnergy;
  const options = legalActions(state, 1, epoch); const profile = civilizationBehaviorProfile(state.seed, 1);
  const yes = options.find(option => option.action.type === 'respond-public-project' && option.action.projectId === project.id && option.action.accept)!;
  const no = options.find(option => option.action.type === 'respond-public-project' && option.action.projectId === project.id && !option.action.accept)!;
  assert.ok(yes && no); const diplomacy = deriveDiplomacyPlan(state, actor, profile, options);
  assert.ok(diplomacyWeight(yes, 0, diplomacy) > 0); assert.equal(diplomacyWeight(no, 0, diplomacy), 0);
  const relief = deriveReliefPlan(state, actor, profile, options);
  assert.equal(reliefWeight(yes, diplomacyWeight(yes, 0, diplomacy), relief), 0);
  assert.ok(reliefWeight(no, diplomacyWeight(no, 0, diplomacy), relief) > 0);
  const decision = chooseCivilizationBehavior(state, 1, undefined, epoch); assert.deepEqual(decision.action, no.action); assert.ok(decision.action);
  const after = command(state, 1, decision.action); assert.ok(!after.publicProjects!.some(candidate => candidate.id === project.id));
  assert.ok(after.events.some(event => event.type === 'public-project-declined')); assert.deepEqual(after.relief, state.relief); assert.deepEqual(after.civilizations, state.civilizations);
});

void test('synthetic fixed world and seeded draws change actual relief propensity when only soft profile priorities change', () => {
  const state = syntheticCorridor(); const original = structuredClone(state);
  const priorities = BEHAVIOR_PROFILES[1]!.priorities as Record<BehaviorPriority, number>; const before = { ...priorities };
  const choices = (priority: number) => {
    priorities.recovery = priority;
    return Array.from({ length: 64 }, (_, cursor) => {
      const memory = createBehaviorMemory(state, 1); memory.decisionCount = cursor;
      const decision = chooseCivilizationBehavior(state, 1, memory, epoch);
      assert.ok(decision.action && legalActions(state, 1, epoch).some(option => sameAction(option.action, decision.action)));
      if (decision.action.type !== 'propose-relief') { assert.ok(decision.explanation.required); assert.equal(decision.memory.urgentStreak, 0); }
      return decision;
    });
  };
  try {
    const low = choices(0.05); const high = choices(50);
    const lowAid = low.filter(decision => decision.action?.type === 'propose-relief').length;
    const highAid = high.filter(decision => decision.action?.type === 'propose-relief').length;
    assert.ok(lowAid < highAid, `Low ${lowAid}, high ${highAid}`); assert.ok(lowAid < 64); assert.ok(highAid > 0);
    assert.ok(low.some((decision, cursor) => decision.action?.type !== high[cursor]!.action?.type));
    assert.deepEqual(high, choices(50)); assert.deepEqual(state, original);
  } finally { Object.assign(priorities, before); }
});

void test('synthetic safe donor reserve cannot be spent into automatic withdrawal by an otherwise available founding choice', () => {
  let state = syntheticCorridor(); const actor = state.civilizations[1]!; actor.resources.materials = 100; actor.resources.credits = 100; actor.resources.culture = 100;
  let memory = createBehaviorMemory(state, 1); let seconds = 0;
  for (let step = 0; step < 4; step++) {
    memory.urgentStreak = 2;
    const decision = chooseCivilizationBehavior(state, 1, memory, at(seconds));
    if (!decision.explanation.required) break;
    assert.ok(decision.action); state = command(state, 1, decision.action, seconds); memory = decision.memory; seconds += 10;
  }
  assert.ok(seconds <= 40);
  const charter = pending(state); const held = charter.terms.food + charter.terms.proposal.promisedFood;
  const reserve = state.cities.filter(city => city.civId === 1).reduce((sum, city) => sum + city.population * ECONOMY_RULES.populationFoodUpkeep * 2, 0);
  state.civilizations[1]!.resources.food = held + reserve;
  const options = legalActions(state, 1, at(seconds)); const settle = options.find(option => option.action.type === 'settle'); assert.ok(settle);
  const relief = planning(state, 1, options).plan; assert.equal(reliefProtects(settle, relief), true);
  assert.equal(planning(state, 1).weight(action => action.type === 'withdraw-relief'), 0);
  const withoutPromise = structuredClone(state); withoutPromise.relief!.active = [];
  let possibleFounding = false;
  const decisions = Array.from({ length: 64 }, (_, cursor) => {
    const input = createBehaviorMemory(state, 1); input.decisionCount = cursor;
    possibleFounding ||= chooseCivilizationBehavior(withoutPromise, 1, input, at(seconds)).action?.type === 'settle';
    const decision = chooseCivilizationBehavior(state, 1, input, at(seconds));
    assert.notEqual(decision.action?.type, 'settle'); assert.notEqual(decision.action?.type, 'settle-coast'); assert.notEqual(decision.action?.type, 'withdraw-relief'); return decision;
  });
  assert.ok(possibleFounding, 'The same ordinary decision pool can actually choose founding without the prior promise');
  const chosen = decisions.find(decision => decision.action && !['propose-trade', 'propose-public-project'].includes(decision.action.type)); assert.ok(chosen?.action);
  const after = command(state, 1, chosen.action, seconds);
  assert.ok(after.civilizations[1]!.resources.food >= held + reserve); assert.deepEqual(after.relief, state.relief);
  assert.equal(planning(after, 1).weight(action => action.type === 'withdraw-relief'), 0);
});
