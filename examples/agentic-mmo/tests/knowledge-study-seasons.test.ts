import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveKnowledgePlan, exchangePromisedResources, knowledgeCommitmentHorizon, knowledgeCompletionTiming } from '../core/behavior-knowledge.ts';
import { civilizationBehaviorProfile } from '../core/behavior-profiles.ts';
import { BUILDINGS, RESOURCE_IDS, TECHNOLOGIES } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { isKnowledgeState, knowledgeOperationEventMatches } from '../core/knowledge-validation.ts';
import { availableActions, sameAction } from '../core/simulation/choices.ts';
import { executeAction } from '../core/simulation/commands.ts';
import { availableDistrictSites, districtAdjacencyFacts } from '../core/simulation/districts.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { availableKnowledgeActions, knowledgeActionFailure, quoteKnowledgeProposal, resolveKnowledgeCompacts } from '../core/simulation/knowledge-compacts.ts';
import type { City, GameAction, GameEvent, WorldState } from '../core/types.ts';
import { acceptKnowledge, assertCurrentKnowledgeWorld, knowledgeAction, knowledgeEconomy, knowledgeProposal, KNOWLEDGE_TEST_RULES, LEARNER, proposeKnowledge, syntheticKnowledgeCorridor, TEACHER, tradeAction } from './fixtures/knowledge-current.ts';

const units = (value: number): number => Math.round(value * 100);
const active = (state: WorldState) => { const value = state.knowledge!.active[0]!; assert.ok(value.status === 'accepted'); return value; };

function paidAction(state: WorldState, actor: number, action: GameAction): GameEvent[] {
  assert.ok(availableActions(state, actor).some(option => sameAction(option.action, action)), `Actual prerequisite action must be available: ${JSON.stringify(action)}`);
  state.revision++;
  const events: GameEvent[] = [];
  executeAction(state, actor, action, events);
  commitEvents(state, events);
  return events;
}

function fundedEducationFixture(): { state: WorldState; receipts: GameEvent[]; learnerCities: string[] } {
  const state = createWorld(1701, '2026-10-23T00:00:00.000Z', KNOWLEDGE_TEST_RULES);
  const receipts: GameEvent[] = [];
  for (const actor of state.civilizations) actor.resources = { food: 10000, materials: 10000, energy: 10000, credits: 10000, science: 0, culture: 10000 };
  for (const id of [TEACHER, LEARNER]) {
    state.civilizations[id]!.era = 1;
    const city = state.cities.find(city => city.civId === id)!;
    city.population = 12; city.wellbeing = 100; city.infrastructure = 1; city.focus = 'research';
  }
  const template = state.cities.find(city => city.civId === LEARNER)!;
  const campus = BUILDINGS.find(building => building.id === 'campus')!;
  for (let index = 0; index < 2; index++) {
    const site = state.tiles.find(tile => tile.owner === null && tile.terrain === 'grassland' && tile.resource !== 'science'
      && state.cities.every(city => hexDistance(tile, state.tiles[city.tileId]!) >= 4)
      && state.tiles.some(neighbor => neighbor.owner === null && neighbor.terrain !== 'ocean' && neighbor.terrain !== 'mountain' && hexDistance(tile, neighbor) === 1 && districtAdjacencyFacts(state, campus, neighbor.id)?.bonus === 0));
    assert.ok(site, 'Declared synthetic opening needs an existing buildable town site, not changed production constants');
    site.owner = LEARNER;
    const city: City = { ...structuredClone(template), id: `study-town-${index}`, name: `Declared study town ${index + 1}`, tileId: site.id, housing: { ruleVersion: 1, baseCapacity: 8, establishedRound: 0, origin: 'founded' } };
    state.cities.push(city);
  }
  const learnerCities = state.cities.filter(city => city.civId === LEARNER).map(city => city.id);
  for (const city of state.cities.filter(city => city.civId === LEARNER)) {
    const center = state.tiles[city.tileId]!;
    const site = state.tiles.find(tile => (tile.owner === null || tile.owner === LEARNER) && tile.terrain !== 'ocean' && tile.terrain !== 'mountain'
      && !state.cities.some(candidate => candidate.tileId === tile.id) && hexDistance(center, tile) <= 3 && districtAdjacencyFacts(state, campus, tile.id)?.bonus === 0);
    assert.ok(site); site.owner = LEARNER;
  }
  assertCurrentKnowledgeWorld(state);
  const beat = (): void => { receipts.push(...knowledgeEconomy(state)); };
  const researchBoth = (technology: string): void => {
    for (const actor of [TEACHER, LEARNER]) receipts.push(...paidAction(state, actor, { type: 'research', technology }));
    for (let count = 0; count < 64 && [TEACHER, LEARNER].some(actor => !state.civilizations[actor]!.technologies.includes(technology)); count++) beat();
    for (const actor of [TEACHER, LEARNER]) assert.ok(state.civilizations[actor]!.technologies.includes(technology));
  };
  researchBoth('agriculture');
  researchBoth('civic-institutions');
  for (const project of ['farm', 'workshop', 'academy', 'campus', 'library']) {
    if (project === 'campus') researchBoth('writing');
    const towns = [...learnerCities, ...(project === 'academy' ? ['city-1'] : [])];
    for (const cityId of towns) {
      const city = state.cities.find(city => city.id === cityId)!;
      const before = structuredClone(state.civilizations[city.civId]!.resources);
      const definition = BUILDINGS.find(building => building.id === project)!;
      const tileId = project === 'campus' ? availableDistrictSites(state, city, definition).find(id => districtAdjacencyFacts(state, definition, id)?.bonus === 0) : undefined;
      if (project === 'campus') assert.notEqual(tileId, undefined);
      receipts.push(...paidAction(state, city.civId, { type: 'build', project, cityId, ...(tileId === undefined ? {} : { tileId }) }));
      assert.deepEqual(city.construction!.active!.paid, definition.cost);
      for (const resource of RESOURCE_IDS) assert.equal(units(state.civilizations[city.civId]!.resources[resource]), units(before[resource]) - units(definition.cost[resource] ?? 0));
    }
    for (let count = 0; count < 32 && towns.some(id => state.cities.find(city => city.id === id)!.construction?.active); count++) beat();
    for (const id of towns) assert.ok(state.cities.find(city => city.id === id)!.buildings.includes(project));
  }
  researchBoth('currency'); researchBoth('mathematics');
  receipts.push(...paidAction(state, TEACHER, { type: 'research', technology: 'education' }));
  for (let count = 0; count < 64 && !state.civilizations[TEACHER]!.technologies.includes('education'); count++) beat();
  assert.ok(state.civilizations[TEACHER]!.technologies.includes('education'));
  assert.equal(receipts.filter(event => event.type === 'construction-started').length, 16);
  assert.equal(receipts.filter(event => event.type === 'building-completed').length, 16);
  receipts.push(...tradeAction(state, TEACHER, { type: 'propose-trade', partner: LEARNER, recipeId: 'harvest-for-materials', sourceCityId: 'city-1', recipientCityId: 'city-4' }));
  receipts.push(...tradeAction(state, LEARNER, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true }));
  while (state.routes[0]!.agreement!.deliveryCount === 0) beat();
  receipts.push(...paidAction(state, LEARNER, { type: 'research', technology: 'education' }));
  assert.equal(state.civilizations[LEARNER]!.researchProgress, 0);
  for (const id of learnerCities) { const city = state.cities.find(city => city.id === id)!; assert.equal(city.infrastructure, 4); assert.equal(city.wellbeing, 100); }
  assertCurrentKnowledgeWorld(state);
  return { state, receipts, learnerCities };
}

void test('supported-study timing rejects positive work without earlier discovery and preserves the exact 64.8 boundary', () => {
  assert.deepEqual(knowledgeCompletionTiming(216, 54, 21.6, 2), { ordinaryDelay: 4, assistedDelay: 4, savedRounds: 0 });
  for (const science of [64.8, 69.3, 71.99]) assert.deepEqual(knowledgeCompletionTiming(216, science, 21.6, 2), { ordinaryDelay: 4, assistedDelay: 3, savedRounds: 1 });
  assert.equal(knowledgeCompletionTiming(216, 64.79, 21.6, 2).savedRounds, 0);
  assert.equal(knowledgeCompletionTiming(216, 72, 21.6, 2).savedRounds, 0);
  assert.equal(knowledgeCompletionTiming(216, 108, 21.6, 2).savedRounds, 0);
  assert.equal(knowledgeCompletionTiming(216, 0, 21.6, 2).savedRounds, 0);
});

void test('declared synthetic towns and stocks fund real prerequisites, then paid studies discover Education in three seasons versus four ordinary seasons', () => {
  const { state, receipts } = fundedEducationFixture();
  assert.equal(TECHNOLOGIES.find(technology => technology.id === 'education')!.cost, 216);
  assert.ok(receipts.some(event => event.type === 'research-completed' && event.actor === TEACHER && event.effects.includes('Technology education unlocked')));
  const option = availableKnowledgeActions(state, TEACHER).find(option => option.action.type === 'propose-knowledge' && option.action.technologyId === 'education' && option.action.teacherInstitutionId === 'academy' && option.action.learnerInstitutionId === 'academy');
  assert.ok(option); assert.equal(option.action.type, 'propose-knowledge');
  const profile = civilizationBehaviorProfile(state.seed, TEACHER);
  const estimate = deriveKnowledgePlan(state, state.civilizations[TEACHER]!, profile, [option]).assessments.get(option)!;
  assert.equal(estimate.estimate!.sciencePerRound, 69.3);
  assert.ok((estimate.weight ?? 0) > 0, estimate.reason);
  assert.equal(estimate.estimate!.savedRounds, 1);
  assert.equal(estimate.estimate!.ordinaryCompletionRound, state.round + 4);
  assert.equal(estimate.estimate!.assistedCompletionRound, state.round + 3);
  const poor = structuredClone(state); poor.civilizations[LEARNER]!.resources.food = 0;
  assert.match(deriveKnowledgePlan(poor, poor.civilizations[TEACHER]!, profile, [option]).assessments.get(option)!.reason, /Food reserves/);
  const cultureProfile = { ...profile, resources: { ...profile.resources, culture: 100 } };
  assert.match(deriveKnowledgePlan(state, state.civilizations[TEACHER]!, cultureProfile, [option]).assessments.get(option)!.reason, /Culture opportunity cost/);
  assert.ok(option.action.type === 'propose-knowledge');
  knowledgeAction(state, TEACHER, option.action);
  knowledgeAction(state, LEARNER, { type: 'respond-knowledge', compactId: state.knowledge!.active[0]!.id, accept: true });
  const acceptedRound = state.round;
  const control = structuredClone(state);
  knowledgeAction(control, LEARNER, { type: 'withdraw-knowledge', compactId: active(control).id });
  const first = knowledgeEconomy(state); knowledgeEconomy(control);
  assert.deepEqual(state.civilizations, control.civilizations);
  assert.equal(state.civilizations[LEARNER]!.researchProgress, 69.3);
  assert.equal(first.some(event => event.type === 'trade-delivered'), false);
  assert.equal(active(state).studies.length, 1);
  const restarted = JSON.parse(JSON.stringify(state)) as WorldState;
  const second = knowledgeEconomy(state);
  assert.deepEqual(knowledgeEconomy(restarted), second); assert.deepEqual(restarted, state);
  knowledgeEconomy(control);
  const result = state.knowledge!.lastResults[TEACHER]!;
  assert.equal(result.outcome, 'completed'); assert.equal(result.amount, 21.6);
  assert.equal(result.progressBefore, 138.6); assert.equal(result.progressAfter, 160.2);
  assert.deepEqual(result.learnerPaid, { materials: 3, credits: 4 }); assert.deepEqual(result.teacherPaid, { culture: 2 });
  assert.deepEqual(result.transferred, { credits: 3 }); assert.deepEqual(result.consumed, { materials: 3, credits: 1, culture: 2 });
  assert.equal(result.researchCompletionEventId, null);
  assert.equal(second.some(event => event.type === 'trade-delivered'), false);
  assert.equal(state.routes[0]!.agreement!.deliveryCount, 1); assert.deepEqual(state.routes, control.routes);
  assert.ok(result.compact.status === 'accepted');
  for (const proof of result.compact.studies) for (const party of [proof.teacher, proof.learner]) {
    const event = state.events.find(event => event.id === party.operationEventId); assert.ok(event);
    assert.ok(knowledgeOperationEventMatches(event, party)); assert.equal(proof.season.round > acceptedRound, true);
  }
  const third = knowledgeEconomy(state); knowledgeEconomy(control);
  assert.ok(third.some(event => event.type === 'research-completed' && event.actor === LEARNER && event.effects.includes('Technology education unlocked')));
  assert.equal(state.round, acceptedRound + 3); assert.ok(state.civilizations[LEARNER]!.technologies.includes('education'));
  assert.equal(control.civilizations[LEARNER]!.researchProgress, 207.9); assert.equal(control.civilizations[LEARNER]!.technologies.includes('education'), false);
  const fourth = knowledgeEconomy(control); knowledgeEconomy(state);
  assert.ok(fourth.some(event => event.type === 'research-completed' && event.actor === LEARNER && event.effects.includes('Technology education unlocked')));
  assert.deepEqual(state.routes, control.routes); assert.equal(state.routes[0]!.agreement!.deliveryCount, 2);
  assertCurrentKnowledgeWorld(state); assertCurrentKnowledgeWorld(control);
});

void test('new teaching requires the exact previously worked, active, unblocked and passable consenting corridor', () => {
  for (const change of [
    (state: WorldState) => { state.routes[0]!.agreement!.deliveryCount = 0; state.routes[0]!.agreement!.lastDeliveryRound = null; },
    (state: WorldState) => { state.routes[0]!.agreement!.blockedReason = 'Unresolved ordinary shortage'; },
    (state: WorldState) => { state.routes[0]!.agreement!.blockedBy = LEARNER; },
    (state: WorldState) => { state.routes[0]!.active = false; },
    (state: WorldState) => { state.routes[0]!.damage = 50; },
    (state: WorldState) => { state.tiles[state.routes[0]!.agreement!.terms.transport!.tileIds[1]!]!.terrain = 'ocean'; },
  ]) {
    const state = syntheticKnowledgeCorridor(); change(state);
    const before = structuredClone(state); assert.equal(quoteKnowledgeProposal(state, TEACHER, knowledgeProposal(state)).ok, false); assert.deepEqual(state, before);
  }
  const state = syntheticKnowledgeCorridor(); const proposed = proposeKnowledge(state); state.routes[0]!.agreement!.blockedReason = 'Known blockage';
  assert.match(knowledgeActionFailure(state, LEARNER, { type: 'respond-knowledge', compactId: proposed.id, accept: true })!, /blockage/);
  assert.equal(knowledgeActionFailure(state, LEARNER, { type: 'respond-knowledge', compactId: proposed.id, accept: false }), null);
});

void test('route damage suspends a study without tuition and actual repair leaves two successes through the inclusive third season', () => {
  const state = syntheticKnowledgeCorridor(); const accepted = acceptKnowledge(state); state.routes[0]!.damage = 50;
  knowledgeEconomy(state);
  assert.equal(active(state).studies.length, 0); assert.ok(active(state).lastStudyAttempt!.blockers.some(blocker => blocker.party === 'route'));
  assert.ok(active(state).lastStudyAttempt!.teacher); assert.ok(active(state).lastStudyAttempt!.learner);
  paidAction(state, TEACHER, { type: 'repair', routeId: state.routes[0]!.id });
  assert.equal(state.routes[0]!.damage, 25);
  knowledgeEconomy(state); knowledgeEconomy(state);
  const result = state.knowledge!.lastResults[TEACHER]!;
  assert.equal(result.outcome, 'completed'); assert.equal(result.resolvedRound, accepted.deadlineRound); assert.equal(result.amount, 14.4);
  assertCurrentKnowledgeWorld(state);
});

void test('preconsent, stale, invented-result-without-event and duplicate wakes cannot count supported study seasons', () => {
  const state = syntheticKnowledgeCorridor(); const accepted = acceptKnowledge(state);
  const before = structuredClone(state); const ignored: GameEvent[] = []; resolveKnowledgeCompacts(state, ignored);
  assert.deepEqual(state, before); assert.deepEqual(ignored, []);
  const first = knowledgeEconomy(state); const once = structuredClone(state);
  resolveKnowledgeCompacts(state, first); assert.deepEqual(state, once);
  for (const forged of [false, true]) {
    const missing = structuredClone(before); missing.round++; missing.revision++;
    if (forged) for (const city of missing.cities.filter(city => [TEACHER, LEARNER].includes(city.civId))) city.buildingOperations!.academy!.lastResult!.round = missing.round;
    const events: GameEvent[] = []; resolveKnowledgeCompacts(missing, events); commitEvents(missing, events);
    assert.equal(active(missing).studies.length, 0);
    assert.match(active(missing).lastStudyAttempt!.blockers.map(blocker => blocker.reason).join(' '), forged ? /operation event/ : /same-round/);
    assert.equal(missing.knowledge!.grants[LEARNER]!.engineering, null);
  }
  const stale = structuredClone(once); const proof = active(stale).studies[0]!;
  proof.season.round = accepted.acceptedRound; proof.teacher.result.round = accepted.acceptedRound; proof.learner.result.round = accepted.acceptedRound;
  assert.equal(isKnowledgeState(stale.knowledge, stale), false);
  const duplicate = structuredClone(once); active(duplicate).studies.push(structuredClone(active(duplicate).studies[0]!));
  assert.equal(isKnowledgeState(duplicate.knowledge, duplicate), false);
});

void test('retained current operation proof binds exact event identity, paid inputs and full residents', () => {
  const state = syntheticKnowledgeCorridor(); acceptKnowledge(state); knowledgeEconomy(state);
  for (const corrupt of [
    (world: WorldState) => { active(world).studies[0]!.teacher.operationEventId = active(world).studies[0]!.learner.operationEventId; },
    (world: WorldState) => { active(world).studies[0]!.teacher.operationEventId = `${world.revision}:99999`; },
    (world: WorldState) => { active(world).studies[0]!.teacher.result.paid.credits = 0; },
    (world: WorldState) => { active(world).studies[0]!.teacher.result.residents!.allocated = 2; },
    (world: WorldState) => { const id = active(world).studies[0]!.teacher.operationEventId; world.events.find(event => event.id === id)!.effects[0] = 'Paid 0 credits'; },
  ]) { const altered = structuredClone(state); corrupt(altered); assert.equal(isKnowledgeState(altered.knowledge, altered), false); }
  const noEvent = syntheticKnowledgeCorridor(); noEvent.events = noEvent.events.filter(event => event.type !== 'building-operation');
  assert.equal(quoteKnowledgeProposal(noEvent, TEACHER, knowledgeProposal(noEvent)).ok, false);
});

void test('ordinary target completion or an exact target change ends teaching without payment or future-tech banking', () => {
  for (const completed of [true, false]) {
    const state = syntheticKnowledgeCorridor(); acceptKnowledge(state); knowledgeEconomy(state);
    if (completed) state.civilizations[LEARNER]!.researchProgress = 143.99;
    else { state.civilizations[LEARNER]!.researchTarget = 'writing'; state.civilizations[LEARNER]!.researchProgress = 0; }
    const events = knowledgeEconomy(state); const result = state.knowledge!.lastResults[TEACHER]!;
    assert.equal(result.reason, completed ? 'target-already-completed' : 'target-changed'); assert.equal(result.amount, 0);
    assert.deepEqual(result.before, result.after); assert.equal(state.knowledge!.grants[LEARNER]!.engineering, null);
    assert.equal(events.some(event => event.type === 'knowledge-completed'), false); assertCurrentKnowledgeWorld(state);
  }
});

void test('same-phase incoming tuition cannot fund another compact learner contribution', () => {
  const state = syntheticKnowledgeCorridor(); const other = 2;
  for (const id of [TEACHER, other]) {
    const actor = state.civilizations[id]!;
    actor.technologies = [...new Set([...actor.technologies, 'agriculture', 'civic-institutions', 'writing', 'currency', 'mathematics', ...(id === other ? ['education'] : [])])]; actor.era = 1;
    actor.resources = { food: 1000, materials: 1000, energy: 1000, credits: 1000, science: 0, culture: 1000 };
    const city = state.cities.find(city => city.civId === id)!; city.population = 8; city.wellbeing = 40; city.infrastructure = 0; city.focus = 'research';
    city.buildings = ['academy']; city.buildingOperations = { academy: { enabled: true, lastResult: null } };
  }
  state.civilizations[TEACHER]!.researchTarget = 'education'; state.civilizations[TEACHER]!.researchProgress = 0;
  tradeAction(state, other, { type: 'propose-trade', partner: TEACHER, recipeId: 'harvest-for-materials', sourceCityId: 'city-2', recipientCityId: 'city-1' });
  tradeAction(state, TEACHER, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true });
  const route = state.routes.find(route => route.owner === other)!;
  while (route.agreement!.deliveryCount === 0) knowledgeEconomy(state);
  acceptKnowledge(state);
  const action: Extract<GameAction, { type: 'propose-knowledge' }> = { type: 'propose-knowledge', routeId: route.id, teacherCityId: 'city-2', learnerCityId: 'city-1', technologyId: 'education', teacherInstitutionId: 'academy', learnerInstitutionId: 'academy' };
  knowledgeAction(state, other, action);
  const compact = state.knowledge!.active.find(compact => compact.terms.teacherId === other)!;
  knowledgeAction(state, TEACHER, { type: 'respond-knowledge', compactId: compact.id, accept: true });
  knowledgeEconomy(state);
  state.civilizations[TEACHER]!.resources.credits = 1;
  knowledgeEconomy(state);
  const incoming = state.knowledge!.lastResults[TEACHER]!; const failed = state.knowledge!.lastResults[other]!;
  assert.equal(incoming.outcome, 'completed'); assert.equal(incoming.transferred.credits, 3);
  assert.equal(failed.reason, 'learner-contribution-shortfall'); assert.equal(failed.amount, 0);
  assert.ok(failed.before.learner.credits >= 4); assert.deepEqual(failed.before, failed.after);
  assertCurrentKnowledgeWorld(state);
});

void test('accepted teaching preserves the extracted hillside budget helper and ordinary not-due versus due cargo reserves', () => {
  const state = syntheticKnowledgeCorridor(); acceptKnowledge(state);
  assert.equal(knowledgeCommitmentHorizon(state, LEARNER), 2);
  assert.ok(state.routes[0]!.agreement!.nextDeliveryRound > state.round + 2);
  const early = exchangePromisedResources(state, LEARNER, 2); const due = exchangePromisedResources(state, LEARNER, state.routes[0]!.agreement!.nextDeliveryRound - state.round);
  assert.equal(early.ordinary.materials, 3); assert.equal(early.ordinary.credits, 4); assert.equal(early.ordinary.energy, 0);
  assert.equal(due.ordinary.materials, 6); assert.equal(due.ordinary.credits, 4); assert.equal(due.ordinary.energy, 1);
  assert.doesNotThrow(() => deriveKnowledgePlan(state, state.civilizations[LEARNER]!, civilizationBehaviorProfile(state.seed, LEARNER), []));
  assertCurrentKnowledgeWorld(state);
});
