import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KnowledgeResult } from '../core/knowledge-types.ts';
import { isKnowledgeCompact, isKnowledgeResult, isKnowledgeState, validKnowledgeEvent } from '../core/knowledge-validation.ts';
import { availableActions, sameAction } from '../core/simulation/choices.ts';
import { executeAction } from '../core/simulation/commands.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { executeKnowledgeAction, knowledgeActionFailure, knowledgePromisedResources, quoteKnowledgeProposal, resolveKnowledgeCompacts } from '../core/simulation/knowledge-compacts.ts';
import type { GameEvent, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { knowledgeRouteMatches, knowledgeRouteRecords, knowledgeStory } from '../web/knowledge-inspection.ts';
import { acceptKnowledge, assertCurrentKnowledgeWorld, knowledgeAction, knowledgeEconomy, knowledgeProposal, LEARNER, proposeKnowledge, syntheticKnowledgeCorridor, TEACHER, tradeAction } from './fixtures/knowledge-current.ts';

function setAcademy(state: WorldState, enabled: boolean): void {
  const action = { type: 'set-building-operation', cityId: 'city-4', buildingId: 'academy', enabled } as const;
  assert.ok(availableActions(state, LEARNER).some(option => sameAction(option.action, action)));
  state.revision++;
  const events: GameEvent[] = [];
  executeAction(state, LEARNER, action, events);
  commitEvents(state, events);
}

function result(state: WorldState): KnowledgeResult {
  const value = state.knowledge!.lastResults[TEACHER];
  assert.ok(value);
  assert.ok(isKnowledgeResult(value));
  return value;
}

function units(value: number): number { return Math.round(value * 100); }

function noTeachingPayment(value: KnowledgeResult): void {
  assert.deepEqual(value.before, value.after);
  assert.deepEqual(value.learnerPaid, {});
  assert.deepEqual(value.teacherPaid, {});
  assert.deepEqual(value.transferred, {});
  assert.deepEqual(value.consumed, {});
  assert.equal(value.amount, 0);
  assert.equal(value.progressBefore, value.progressAfter);
  assert.equal(value.researchCompletionEventId, null);
}

function exactTeachingPayment(value: KnowledgeResult): void {
  assert.deepEqual(value.learnerPaid, { materials: 3, credits: 4 });
  assert.deepEqual(value.teacherPaid, { culture: 2 });
  assert.deepEqual(value.transferred, { credits: 3 });
  assert.deepEqual(value.consumed, { materials: 3, culture: 2, credits: 1 });
  assert.deepEqual(value.after.learner, { ...value.before.learner, materials: (units(value.before.learner.materials) - 300) / 100, credits: (units(value.before.learner.credits) - 400) / 100 });
  assert.deepEqual(value.after.teacher, { ...value.before.teacher, culture: (units(value.before.teacher.culture) - 200) / 100, credits: (units(value.before.teacher.credits) + 300) / 100 });
}

function oneStudy(): WorldState {
  const state = syntheticKnowledgeCorridor();
  acceptKnowledge(state);
  knowledgeEconomy(state);
  const compact = state.knowledge!.active[0]!;
  assert.equal(compact.status, 'accepted');
  assert.ok(compact.status === 'accepted' && compact.studies.length === 1);
  assert.equal(state.knowledge!.lastResults[TEACHER], null);
  assertCurrentKnowledgeWorld(state);
  return state;
}

function ordinaryControl(state: WorldState): WorldState {
  const control = structuredClone(state);
  knowledgeAction(control, LEARNER, { type: 'withdraw-knowledge', compactId: control.knowledge!.active[0]!.id });
  knowledgeEconomy(control);
  assertCurrentKnowledgeWorld(control);
  return control;
}

void test('reconstructed synthetic offer and explicit learner consent do not pay, grant work or count the earlier actual delivery', () => {
  const state = syntheticKnowledgeCorridor();
  const opening = structuredClone(state.civilizations);
  const proposed = proposeKnowledge(state);
  assert.ok(isKnowledgeCompact(proposed));
  assert.deepEqual(state.civilizations, opening);
  assert.deepEqual(knowledgePromisedResources(state, LEARNER), {});
  assert.match(knowledgeActionFailure(state, TEACHER, { type: 'respond-knowledge', compactId: proposed.id, accept: true })!, /named learner/);
  const beforeRefusal = structuredClone(state);
  const refusedEvents: GameEvent[] = [];
  assert.equal(executeKnowledgeAction(state, 0, { type: 'respond-knowledge', compactId: proposed.id, accept: true }, refusedEvents), false);
  assert.deepEqual(state, beforeRefusal);
  assert.deepEqual(refusedEvents, []);
  knowledgeAction(state, LEARNER, { type: 'respond-knowledge', compactId: proposed.id, accept: true });
  const accepted = state.knowledge!.active[0]!;
  assert.equal(accepted.status, 'accepted');
  assert.ok(accepted.status === 'accepted');
  assert.equal(accepted.lastAttemptRound, accepted.acceptedRound);
  assert.equal(accepted.deadlineRound, accepted.acceptedRound + 3);
  assert.deepEqual(accepted.studies, []);
  assert.equal(accepted.lastStudyAttempt, null);
  assert.deepEqual(state.civilizations, opening);
  assert.deepEqual(knowledgePromisedResources(state, LEARNER), { materials: 3, credits: 4 });
  assert.deepEqual(knowledgePromisedResources(state, TEACHER), { culture: 2 });
  assert.equal(state.knowledge!.grants[LEARNER]!.engineering, null);
  const control = ordinaryControl(state);
  knowledgeEconomy(state);
  assert.deepEqual(state.civilizations, control.civilizations, 'The first qualifying study charges neither teaching payment nor work');
  assert.deepEqual(state.routes, control.routes);
  assert.equal(state.knowledge!.lastResults[TEACHER], null);
  assertCurrentKnowledgeWorld(state);
});

void test('reconstructed two fresh full-economy studies settle exact price and at most 10 percent work, with no extra cargo or Science transfer', () => {
  const state = oneStudy();
  const control = ordinaryControl(state);
  const events = knowledgeEconomy(state);
  const completed = result(state);
  assert.equal(completed.outcome, 'completed');
  assert.equal(completed.reason, 'settled');
  assert.equal(completed.compact.terms.costBasis, 144);
  assert.equal(completed.nominalAmount, 14.4);
  assert.equal(completed.amount, 14.4);
  assert.equal(completed.unusedAmount, 0);
  exactTeachingPayment(completed);
  assert.deepEqual(completed.before, { teacher: control.civilizations[TEACHER]!.resources, learner: control.civilizations[LEARNER]!.resources });
  assert.equal(completed.progressBefore, control.civilizations[LEARNER]!.researchProgress);
  assert.equal(units(state.civilizations[LEARNER]!.researchProgress), units(control.civilizations[LEARNER]!.researchProgress) + 1440);
  assert.equal(state.civilizations[LEARNER]!.technologies.includes('engineering'), false);
  assert.equal(completed.researchCompletionEventId, null);
  assert.deepEqual(state.routes, control.routes);
  assert.equal(state.routes[0]!.agreement!.deliveryCount, 1);
  assert.equal(state.routes[0]!.volume, 7);
  assert.equal(completed.compact.status, 'accepted');
  assert.ok(completed.compact.status === 'accepted');
  const studies = completed.compact.studies;
  assert.equal(studies.length, 2);
  assert.deepEqual(studies.map(study => study.season.round), [completed.compact.acceptedRound + 1, completed.compact.acceptedRound + 2]);
  assert.ok(studies[0]!.season.round < studies[1]!.season.round);
  for (const proof of studies) {
    assert.ok(proof.season.round > completed.compact.acceptedRound);
    assert.ok(proof.season.revision > completed.compact.acceptedRevision);
    assert.equal(proof.season.agreementOfferId, state.routes[0]!.agreement!.offerId);
    for (const party of [proof.teacher, proof.learner]) {
      assert.equal(party.institutionId, 'academy');
      assert.equal(party.result.round, proof.season.round);
      assert.equal(party.result.status, 'operated');
      assert.deepEqual(party.result.paid, { culture: 2, credits: 1 });
      assert.ok(party.result.produced.science! > 0);
      assert.equal(party.result.residents!.allocated, 3);
      assert.equal(party.result.residents!.required, 3);
    }
    assert.ok(state.events.some(event => event.id === proof.teacher.operationEventId && event.type === 'building-operation'));
    assert.ok(state.events.some(event => event.id === proof.learner.operationEventId && event.type === 'building-operation'));
  }
  assert.deepEqual(state.knowledge!.grants[LEARNER]!.engineering, completed);
  assert.ok(events.filter(event => event.type.startsWith('knowledge-')).every(validKnowledgeEvent));
  const unchanged = structuredClone(state);
  const repeated: GameEvent[] = [];
  resolveKnowledgeCompacts(state, repeated);
  assert.deepEqual(state, unchanged);
  assert.deepEqual(repeated, []);
  for (let index = 0; index < 4; index++) knowledgeEconomy(state);
  const denied = quoteKnowledgeProposal(state, TEACHER, knowledgeProposal(state));
  assert.equal(denied.ok, false);
  assert.ok(!denied.ok && /one knowledge compact contribution/.test(denied.reason));
  assertCurrentKnowledgeWorld(state);
});

void test('reconstructed one-hundredth remaining work pays the full price and records separate real discovery completion', () => {
  const state = oneStudy();
  const control = ordinaryControl(state);
  const ordinaryWork = units(control.civilizations[LEARNER]!.researchProgress) - units(state.civilizations[LEARNER]!.researchProgress);
  state.civilizations[LEARNER]!.researchProgress = (14400 - ordinaryWork - 1) / 100;
  const events = knowledgeEconomy(state);
  const completed = result(state);
  assert.equal(completed.outcome, 'completed');
  assert.equal(completed.amount, 0.01);
  assert.equal(completed.nominalAmount, 14.4);
  assert.equal(completed.unusedAmount, 14.39);
  assert.equal(completed.progressBefore, 143.99);
  assert.equal(completed.progressAfter, 144);
  exactTeachingPayment(completed);
  const discovery = events.find(event => event.id === completed.researchCompletionEventId);
  assert.ok(discovery);
  assert.equal(discovery.type, 'research-completed');
  assert.ok(discovery.effects.includes('Technology engineering unlocked'));
  assert.ok(events.indexOf(discovery) < events.findIndex(event => event.id === completed.eventId));
  assert.equal(state.civilizations[LEARNER]!.researchTarget, '');
  assert.equal(state.civilizations[LEARNER]!.researchProgress, 0);
  assert.ok(state.civilizations[LEARNER]!.technologies.includes('engineering'));
  assertCurrentKnowledgeWorld(state);
});

void test('reconstructed decline, teacher pending withdrawal, both accepted withdrawals and consent expiry have zero teaching payment', () => {
  for (const mode of ['decline', 'teacher-pending', 'teacher-accepted', 'learner-accepted', 'expiry'] as const) {
    const state = syntheticKnowledgeCorridor();
    const compact = mode.endsWith('accepted') ? acceptKnowledge(state) : proposeKnowledge(state);
    const before = structuredClone(state.civilizations);
    if (mode === 'expiry') {
      assert.ok(compact.status === 'proposed');
      const control = structuredClone(state);
      knowledgeAction(control, TEACHER, { type: 'withdraw-knowledge', compactId: compact.id });
      while (state.round < compact.expiresRound) {
        const round = Math.min(compact.expiresRound, state.routes[0]!.agreement!.nextDeliveryRound);
        knowledgeEconomy(state, round);
        knowledgeEconomy(control, round);
      }
      assert.deepEqual(state.civilizations, control.civilizations, 'Expiry must preserve exactly the ordinary economy costs and work');
    } else knowledgeAction(state, mode === 'decline' || mode === 'learner-accepted' ? LEARNER : TEACHER,
      mode === 'decline' ? { type: 'respond-knowledge', compactId: compact.id, accept: false } : { type: 'withdraw-knowledge', compactId: compact.id });
    const ended = result(state);
    assert.equal(ended.outcome, mode === 'expiry' ? 'expired' : mode === 'decline' ? 'declined' : 'withdrawn', mode);
    noTeachingPayment(ended);
    if (mode !== 'expiry') assert.deepEqual(state.civilizations, before, mode);
    assert.equal(state.knowledge!.active.length, 0);
    assert.equal(state.knowledge!.grants[LEARNER]!.engineering, null);
    assertCurrentKnowledgeWorld(state);
  }
});

void test('reconstructed funding failure after two real paid studies keeps ordinary costs but charges no teaching payment', () => {
  const state = oneStudy();
  state.civilizations[TEACHER]!.resources.culture = 2;
  const events = knowledgeEconomy(state);
  const failed = result(state);
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.reason, 'teacher-contribution-shortfall');
  assert.ok(failed.compact.status === 'accepted' && failed.compact.studies.length === 2);
  noTeachingPayment(failed);
  assert.ok(failed.before.teacher.culture < 2);
  assert.deepEqual(state.cities.find(city => city.civId === TEACHER)!.buildingOperations!.academy!.lastResult!.paid, { culture: 2, credits: 1 });
  assert.equal(events.some(event => event.type === 'trade-delivered'), false);
  assert.equal(state.knowledge!.grants[LEARNER]!.engineering, null);
  assertCurrentKnowledgeWorld(state);
});

void test('reconstructed stale, actually paused, unfunded and understaffed institutions cannot qualify for supported study', () => {
  for (const mode of ['stale', 'paused', 'residents', 'inputs'] as const) {
    const state = syntheticKnowledgeCorridor();
    const accepted = acceptKnowledge(state);
    const city = state.cities.find(city => city.civId === LEARNER)!;
    let events: GameEvent[];
    if (mode === 'stale') {
      state.round++;
      state.revision++;
      events = [];
      resolveKnowledgeCompacts(state, events);
      commitEvents(state, events);
    } else {
      if (mode === 'paused') setAcademy(state, false);
      else if (mode === 'inputs') state.civilizations[LEARNER]!.resources.credits = 0;
      else city.population = 3;
      events = knowledgeEconomy(state);
    }
    const active = state.knowledge!.active[0]!;
    assert.ok(active.status === 'accepted');
    assert.equal(active.studies.length, 0, mode);
    assert.equal(active.lastAttemptRound, accepted.acceptedRound + 1);
    assert.ok(active.lastStudyAttempt!.blockers.length > 0);
    assert.match(active.lastStudyAttempt!.blockers.map(blocker => blocker.reason).join(' '), mode === 'stale' ? /same-round/ : mode === 'paused' ? /paused/ : /blocked/);
    assert.equal(events.some(event => event.type === 'trade-delivered'), false);
    assert.equal(state.knowledge!.lastResults[TEACHER], null);
    if (mode === 'paused') setAcademy(state, true);
    if (mode === 'inputs') state.civilizations[LEARNER]!.resources.credits = 100;
    city.population = 6;
    knowledgeEconomy(state);
    knowledgeEconomy(state);
    const completed = result(state);
    assert.equal(completed.outcome, 'completed');
    assert.equal(completed.resolvedRound, accepted.deadlineRound);
    assert.ok(completed.compact.status === 'accepted');
    assert.deepEqual(completed.compact.studies.map(proof => proof.season.round), [accepted.acceptedRound + 2, accepted.acceptedRound + 3]);
    assertCurrentKnowledgeWorld(state);
  }
});

void test('reconstructed inclusive study deadline fails without payment without two qualifying institution seasons', () => {
  const state = syntheticKnowledgeCorridor();
  const accepted = acceptKnowledge(state);
  state.cities.find(city => city.civId === LEARNER)!.buildingOperations!.academy!.enabled = false;
  for (let index = 0; index < 3; index++) knowledgeEconomy(state);
  const failed = result(state);
  assert.equal(failed.reason, 'study-window-ended');
  assert.equal(failed.resolvedRound, accepted.deadlineRound);
  noTeachingPayment(failed);
  assert.equal(state.routes[0]!.agreement!.deliveryCount, 1);
  assertCurrentKnowledgeWorld(state);
});

void test('reconstructed same-version JSON restart after one study reproduces receipts, balances and terminal world exactly', () => {
  const state = oneStudy();
  const restored = JSON.parse(JSON.stringify(state)) as WorldState;
  assertCurrentKnowledgeWorld(restored);
  assert.deepEqual(knowledgeEconomy(restored), knowledgeEconomy(state));
  assert.deepEqual(restored, state);
  assertCurrentKnowledgeWorld(restored);
  const terminal = JSON.parse(JSON.stringify(restored)) as WorldState;
  assert.deepEqual(terminal, restored);
  assertCurrentKnowledgeWorld(terminal);
});

void test('reconstructed current validators reject altered payment, stale proof, season identity and conflicting retained result', () => {
  const state = oneStudy();
  knowledgeEconomy(state);
  const corruptions: Array<(world: WorldState) => void> = [
    world => { world.knowledge!.lastResults[TEACHER]!.learnerPaid.credits = 3; },
    world => { const compact = world.knowledge!.lastResults[TEACHER]!.compact; assert.ok(compact.status === 'accepted'); compact.studies[0]!.teacher.result.round--; },
    world => { const compact = world.knowledge!.lastResults[TEACHER]!.compact; assert.ok(compact.status === 'accepted'); compact.studies[0]!.season.agreementOfferId = 'another-offer'; },
    world => { world.knowledge!.grants[LEARNER]!.engineering!.detail = 'Conflicting independently altered receipt'; },
    world => { world.events.find(event => event.knowledgeResult)!.target = 0; },
  ];
  assertCurrentKnowledgeWorld(state);
  for (const corrupt of corruptions) {
    const malformed = structuredClone(state);
    corrupt(malformed);
    assert.equal(isKnowledgeState(malformed.knowledge, malformed), false);
    assert.equal(isWorldState(malformed), false);
  }
});

void test('reconstructed route binding preserves exact identity and stopping actual trade terminates teaching without payment', () => {
  const state = syntheticKnowledgeCorridor();
  const accepted = acceptKnowledge(state);
  const route = state.routes[0]!;
  assert.ok(knowledgeRouteMatches(state, route, accepted.terms));
  for (const alter of [
    (world: WorldState) => { world.routes[0]!.agreement!.offerId = 'replacement-offer'; },
    (world: WorldState) => { world.routes[0]!.agreement!.acceptedRound++; },
    (world: WorldState) => { world.routes[0]!.owner = 0; },
    (world: WorldState) => { world.cities.find(city => city.id === 'city-4')!.tileId++; },
    (world: WorldState) => { world.routes[0]!.agreement!.terms.proposerCargo.food = 5; },
  ]) {
    const altered = structuredClone(state);
    alter(altered);
    assert.equal(knowledgeRouteMatches(altered, altered.routes[0]!, accepted.terms), false);
    assert.deepEqual(knowledgeRouteRecords(altered, route.id), []);
  }
  tradeAction(state, LEARNER, { type: 'stop-trade', routeId: route.id });
  state.revision++;
  const events: GameEvent[] = [];
  resolveKnowledgeCompacts(state, events);
  commitEvents(state, events);
  assert.equal(result(state).reason, 'route-consent-stopped');
  noTeachingPayment(result(state));
  assert.equal(knowledgeRouteRecords(state, route.id)[0]!.status.startsWith('Failed'), true);
  assertCurrentKnowledgeWorld(state);
});

void test('reconstructed observer records and stories distinguish offered, accepted, study and paid work without claiming free technology', () => {
  const state = syntheticKnowledgeCorridor();
  const proposed = proposeKnowledge(state);
  const offeredEvent = state.events.at(-1)!;
  const offered = knowledgeRouteRecords(state, state.routes[0]!.id);
  assert.equal(offered.length, 1);
  assert.equal(offered[0]!.kind, 'active');
  assert.match(offered[0]!.status, /Learner consent not recorded/);
  assert.match(knowledgeStory(offeredEvent)!.consequence, /No teaching payment or research work/);
  const acceptedEvent = knowledgeAction(state, LEARNER, { type: 'respond-knowledge', compactId: proposed.id, accept: true })[0]!;
  assert.match(knowledgeStory(acceptedEvent)!.consequence, /0 of 2 supported study seasons/);
  assert.match(knowledgeStory(acceptedEvent)!.consequence, /No teaching payment yet/);
  const first = knowledgeEconomy(state).find(event => event.type === 'knowledge-study')!;
  assert.match(knowledgeStory(first)!.consequence, /1 of 2 supported study seasons/);
  assert.match(knowledgeStory(first)!.consequence, /not extra cargo or a Science stock transfer/);
  const events = knowledgeEconomy(state);
  const completedEvent = events.find(event => event.type === 'knowledge-completed')!;
  const story = knowledgeStory(completedEvent)!;
  assert.match(story.title, /14.4 research work toward Engineering/);
  assert.match(story.consequence, /3 Materials, 4 Credits/);
  assert.match(story.consequence, /2 Culture/);
  assert.match(story.consequence, /3 Credits transferred/);
  assert.match(story.consequence, /3 Materials, 1 Credits, 2 Culture consumed/);
  assert.doesNotMatch(story.consequence, /Separate discovery completion receipt/);
  const history = knowledgeRouteRecords(state, state.routes[0]!.id);
  assert.equal(history.length, 1);
  assert.equal(history[0]!.kind, 'historical');
  assert.match(history[0]!.status, /Completed · Added 14.4 research work/);
  history[0]!.compact.terms.names.teacher = 'Observer clone mutation';
  assert.equal(result(state).compact.terms.names.teacher, 'Synthetic teachers');
  const invalid = structuredClone(completedEvent);
  invalid.knowledgeResult!.amount = 144;
  assert.equal(knowledgeStory(invalid), null);
  assert.equal(knowledgeStory(state.events[0]!), null);
});

void test('reconstructed unsuccessful observer stories explicitly preserve earlier ordinary trade and institution costs', () => {
  const state = oneStudy();
  const events = knowledgeAction(state, LEARNER, { type: 'withdraw-knowledge', compactId: state.knowledge!.active[0]!.id });
  const story = knowledgeStory(events[0]!)!;
  assert.match(story.title, /teaching withdrawn/);
  assert.equal(story.consequence, 'No teaching payment or research work. Earlier ordinary trade and institution costs remain unchanged.');
  assert.equal(state.routes[0]!.agreement!.deliveryCount, 1);
  noTeachingPayment(result(state));
  assertCurrentKnowledgeWorld(state);
});
