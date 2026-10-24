import assert from 'node:assert/strict';
import { test } from 'node:test';
import { civilizationBehaviorProfile } from '../core/behavior-profiles.ts';
import { deriveDiplomacyPlan, diplomacyPriority, diplomacyWeight } from '../core/behavior-diplomacy.ts';
import { deriveProgressionPlan, progressionWeight } from '../core/behavior-progression.ts';
import { chooseCivilizationBehavior, createBehaviorMemory } from '../core/behaviors.ts';
import { RESOURCE_IDS, TECHNOLOGIES } from '../core/content.ts';
import { applyCommand, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { createLandTransportPlanner, createSteamTransportPlanner } from '../core/simulation/transport.ts';
import type { ActionOption, GameAction, WorldState } from '../core/types.ts';

const epoch = '2000-01-01T00:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();

function released(old = false): WorldState {
  return createWorld(73, epoch, old ? 'settlement-interplanetary-1' : 'settlement-knowledge-compacts-1');
}

function syntheticPartnership(): WorldState {
  let state = released();
  assert.ok(state.unlockedFeatures.includes('partnership-stewardship'));
  for (const actor of state.civilizations) {
    actor.technologies = ['agriculture', 'civic-institutions']; actor.era = 1;
    actor.resources = { food: 100, materials: 100, energy: 100, credits: 100, science: 0, culture: 0 };
  }
  for (const city of state.cities) { city.focus = 'growth'; city.buildings = ['farm', 'monument']; }
  const option = legalActions(state, 0, epoch).find(option => option.action.type === 'propose-trade' && option.action.partner === 1 && option.action.recipeId === 'harvest-for-materials');
  assert.ok(option); state = act(state, 0, option.action, 0);
  const offer = state.tradeOffers?.find(offer => offer.status === 'pending'); assert.ok(offer);
  state = act(state, 1, { type: 'respond-trade', offerId: offer.id, accept: true }, 0);
  const route = state.routes[0]; assert.ok(route); route.damage = 25;
  return state;
}

function act(state: WorldState, seat: number, action: GameAction, seconds: number): WorldState {
  const result = applyCommand(state, { seat, expectedRevision: state.revision, timestamp: at(seconds), action });
  assert.ok(result.ok, result.error); return result.state;
}

function planning(state: WorldState, seat: number, seconds = 10) {
  const actor = state.civilizations[seat]; assert.ok(actor);
  const options = legalActions(state, seat, at(seconds));
  const plan = deriveDiplomacyPlan(state, actor, civilizationBehaviorProfile(state.seed, seat), options);
  const weight = (predicate: (option: ActionOption) => boolean, base = 10): number => {
    const option = options.find(predicate); assert.ok(option); return diplomacyWeight(option, base, plan);
  };
  return { options, plan, weight };
}

void test('fresh selected-rule choices, memories, seeds and explanations survive deterministic restart', () => {
  const state = released(true); const restored: WorldState = JSON.parse(JSON.stringify(state)); const before = structuredClone(state);
  for (let seat = 0; seat < 5; seat++) for (let cursor = 0; cursor < 12; cursor++) {
    const memory = createBehaviorMemory(state, seat); memory.decisionCount = cursor;
    const decision = chooseCivilizationBehavior(state, seat, memory, epoch);
    assert.deepEqual(decision, chooseCivilizationBehavior(restored, seat, structuredClone(memory), epoch));
    if (decision.action) assert.ok(legalActions(state, seat, epoch).some(option => sameAction(option.action, decision.action)));
  }
  assert.deepEqual(state, before); assert.deepEqual(restored, before);
});

void test('synthetic useful damaged partnership chooses fresh consent before required work and pays only at due repair', () => {
  let state = syntheticPartnership(); const before = structuredClone(state);
  const proposal = chooseCivilizationBehavior(state, 0, undefined, at(10));
  assert.equal(proposal.action?.type, 'propose-public-project'); assert.ok(proposal.action);
  state = act(state, 0, proposal.action, 10);
  assert.deepEqual(state.civilizations, before.civilizations); assert.deepEqual(state.routes, before.routes);
  const project = state.publicProjects?.[0]; assert.ok(project?.status === 'pending');
  const response = chooseCivilizationBehavior(state, 1, undefined, at(10));
  assert.deepEqual(response.action, { type: 'respond-public-project', projectId: project.id, accept: true }); assert.ok(response.action);
  assert.match(response.explanation.reason, /round|pledge|repair/i);
  state = act(state, 1, response.action, 10);
  assert.deepEqual(state.civilizations, before.civilizations); assert.deepEqual(state.routes, before.routes);
  assert.equal(state.publicProjects?.[0]?.status, 'committed');
  const restored: WorldState = JSON.parse(JSON.stringify(state));
  assert.deepEqual(chooseCivilizationBehavior(restored, 0, proposal.memory, at(20)), chooseCivilizationBehavior(state, 0, proposal.memory, at(20)));
  for (const seat of [0, 1]) {
    const p = planning(state, seat, 20);
    assert.equal(p.weight(option => option.action.type === 'repair'), 0);
  }
  const control = structuredClone(state); control.publicProjects = [];
  const result = catchUpStrategy(state, at(120)); const baseline = catchUpStrategy(control, at(120));
  assert.ok(result.ok && baseline.ok);
  const receipt = result.events.find(event => event.publicProjectResult)?.publicProjectResult;
  assert.equal(receipt?.outcome, 'completed'); assert.deepEqual(receipt.proposerPaid, { materials: 2, energy: 1 });
  assert.deepEqual(receipt.recipientPaid, { materials: 2, energy: 1 }); assert.equal(receipt.damageAfter, 0);
  for (const seat of [0, 1]) for (const resource of RESOURCE_IDS)
    assert.equal(result.state.civilizations[seat]!.resources[resource], baseline.state.civilizations[seat]!.resources[resource] - (resource === 'materials' ? 2 : resource === 'energy' ? 1 : 0));
  assert.equal(result.state.routes[0]?.agreement?.deliveryCount, baseline.state.routes[0]?.agreement?.deliveryCount);
  const later = catchUpStrategy(result.state, at(60 * (state.routes[0]?.agreement?.nextDeliveryRound ?? 8)));
  assert.ok(later.ok); assert.ok((later.state.routes[0]?.agreement?.deliveryCount ?? 0) > (result.state.routes[0]?.agreement?.deliveryCount ?? 0));
});

void test('synthetic missing contributor declines instead of pretending a pledge is funded; max-two fairness still starts required work', () => {
  let state = syntheticPartnership(); const route = state.routes[0]; assert.ok(route);
  state = act(state, 0, { type: 'propose-public-project', routeId: route.id, recipeId: 'joint-road-repair' }, 10);
  const actor = state.civilizations[1]; assert.ok(actor); actor.resources.energy = 0;
  const project = state.publicProjects?.[0]; assert.ok(project);
  const decision = chooseCivilizationBehavior(state, 1, undefined, at(10));
  assert.deepEqual(decision.action, { type: 'respond-public-project', projectId: project.id, accept: false });
  const memory = createBehaviorMemory(state, 1); memory.urgentStreak = 2;
  const required = chooseCivilizationBehavior(state, 1, memory, at(10)); assert.ok(required.explanation.required);
  assert.ok(required.action && legalActions(state, 1, at(10)).some(option => sameAction(option.action, required.action)));
});

void test('synthetic committed contribution survives later construction choices without escrow and shortage can cancel', () => {
  let state = syntheticPartnership(); const route = state.routes[0]; assert.ok(route);
  state = act(state, 0, { type: 'propose-public-project', routeId: route.id, recipeId: 'joint-road-repair' }, 10);
  const project = state.publicProjects?.[0]; assert.ok(project);
  state = act(state, 1, { type: 'respond-public-project', projectId: project.id, accept: true }, 10);
  const actor = state.civilizations[0]; assert.ok(actor); actor.resources.materials = 13;
  const p = planning(state, 0, 20);
  const expensive = p.options.find(option => option.action.type === 'build' && option.action.project === 'workshop'); assert.ok(expensive);
  assert.equal(diplomacyWeight(expensive, 1000, p.plan), 0);
  const original = structuredClone(state); deriveDiplomacyPlan(state, actor, civilizationBehaviorProfile(state.seed, 0), p.options); assert.deepEqual(state, original);
  actor.resources.energy = 0;
  const cancelled = chooseCivilizationBehavior(state, 0, undefined, at(20));
  assert.deepEqual(cancelled.action, { type: 'cancel-public-project', projectId: project.id });
  assert.ok(cancelled.action); const result = act(state, 0, cancelled.action, 20);
  assert.deepEqual(result.civilizations, state.civilizations); assert.equal(result.publicProjects?.length, 0);
});

void test('synthetic critical blocked food justifies actual paid solo recovery instead of waiting for consent', () => {
  const state = syntheticPartnership(); const route = state.routes[0]; const recipient = state.civilizations[1]; assert.ok(route && recipient);
  route.damage = 50; route.agreement!.nextDeliveryRound = state.round + 1; recipient.resources.food = 8;
  const p = planning(state, 1);
  const repair = p.options.find(option => option.action.type === 'repair'); assert.ok(repair);
  assert.ok(diplomacyWeight(repair, 1, p.plan) > 0); assert.ok(diplomacyPriority(repair, p.plan) > 0);
  const result = act(state, 1, repair.action, 10);
  assert.equal(result.routes[0]?.damage, 25); assert.equal(result.civilizations[1]?.resources.materials, recipient.resources.materials - 5);
  assert.equal(result.civilizations[1]?.resources.energy, recipient.resources.energy - 2);
});

void test('synthetic temporary or environmental blocks do not imply betrayal; persistent unpaid supply can end and prefer another partner', () => {
  const state = syntheticPartnership(); const route = state.routes[0]; assert.ok(route?.agreement);
  state.round = 30; route.damage = 0; route.agreement.acceptedRound = 0; route.agreement.lastAttemptRound = 30;
  route.agreement.lastDeliveryRound = 29; route.agreement.deliveryCount = 3; route.agreement.blockedBy = 1;
  state.civilizations[1]!.resources.materials = 0;
  assert.equal(planning(state, 0).weight(option => option.action.type === 'stop-trade'), 0);
  route.agreement.lastDeliveryRound = 1; route.agreement.blockedBy = null;
  assert.equal(planning(state, 0).weight(option => option.action.type === 'stop-trade'), 0);
  route.agreement.blockedBy = 1; route.agreement.blockedReason = 'Contributor cannot fund current materials';
  const p = planning(state, 0); assert.ok(p.weight(option => option.action.type === 'stop-trade') > 0);
  route.agreement.enabled = false; route.agreement.closedRound = state.round;
  const next = planning(state, 0);
  assert.equal(next.weight(option => option.action.type === 'propose-trade' && option.action.partner === 1), 0);
  assert.ok(next.options.some(option => option.action.type === 'propose-trade' && option.action.partner !== 1 && diplomacyWeight(option, 10, next.plan) > 0));
});

void test('synthetic changed needs can end a mature uneconomic exchange despite actual continuing funded shipments', () => {
  let state = released();
  for (const actor of state.civilizations) actor.resources = { food: 10000, materials: 10000, energy: 1000, credits: 10000, science: 0, culture: 0 };
  const verdant = state.civilizations[1]; assert.ok(verdant); verdant.resources.materials = 6; verdant.resources.credits = 8;
  const town = state.cities.find(city => city.civId === 1); assert.ok(town); town.population = 6;
  const initial = planning(state, 1, 0);
  const proposal = initial.options.find(option => option.action.type === 'propose-trade' && option.action.partner === 0 && option.action.recipeId === 'harvest-for-materials'); assert.ok(proposal);
  assert.ok(diplomacyWeight(proposal, 10, initial.plan) > 0);
  state = act(state, 1, proposal.action, 0);
  const offer = state.tradeOffers?.find(candidate => candidate.status === 'pending'); assert.ok(offer);
  state = act(state, 0, { type: 'respond-trade', offerId: offer.id, accept: true }, 0);
  const routeId = state.routes[0]?.id; const terms = structuredClone(state.routes[0]?.agreement?.terms); assert.ok(routeId && terms);
  const first = catchUpStrategy(state, at(terms.cadenceRounds * 60)); assert.ok(first.ok); state = first.state;
  assert.equal(state.routes[0]?.agreement?.deliveryCount, 1);
  state.civilizations[1]!.resources.materials = 10000; state.civilizations[1]!.resources.credits = 10000;
  assert.equal(planning(state, 1, state.round * 60 + 10).weight(option => option.action.type === 'stop-trade'), 0);
  const maturity = Math.max(8, terms.cadenceRounds * 3);
  const continued = catchUpStrategy(state, at(maturity * 60)); assert.ok(continued.ok); state = continued.state;
  const route = state.routes.find(candidate => candidate.id === routeId); assert.ok(route?.agreement);
  assert.ok(route.agreement.deliveryCount >= 3); assert.equal(route.agreement.lastDeliveryRound, state.round); assert.equal(route.agreement.blockedBy, null);
  const mature = planning(state, 1, maturity * 60 + 10);
  assert.equal(mature.plan.routes.get(routeId)?.funded, true);
  assert.ok(mature.weight(option => option.action.type === 'stop-trade') > 0);
  const decision = chooseCivilizationBehavior(state, 1, undefined, at(maturity * 60 + 10));
  assert.deepEqual(decision.action, { type: 'stop-trade', routeId }); assert.ok(decision.action);
  assert.match(decision.explanation.reason, /mature exchange currently/);
  state = act(state, 1, decision.action, maturity * 60 + 10);
  assert.equal(state.routes[0]?.agreement?.enabled, false); assert.deepEqual(state.routes[0]?.agreement?.terms, terms);
});

void test('synthetic steam proposals cannot revive the existing no-rail or no-cadence-gain progression exclusions', () => {
  for (const shortPaidRail of [false, true]) {
    const state = released(); const source = state.cities.find(city => city.civId === 1); const target = state.cities.find(city => city.civId === 0); assert.ok(source && target);
    state.cities = [source, target]; source.tileId = 73; target.tileId = shortPaidRail ? 74 : 86;
    for (const tile of state.tiles) { tile.terrain = 'grassland'; tile.owner = 1; }
    for (const actor of state.civilizations) {
      actor.technologies = TECHNOLOGIES.map(technology => technology.id); actor.era = 3;
      actor.resources = { food: 10000, materials: 10000, energy: 1000, credits: 10000, science: 0, culture: 0 };
      actor.strategicResources = { iron: 30, coal: 30 };
    }
    const actor = state.civilizations[1]; assert.ok(actor); actor.resources.materials = 6; actor.resources.credits = 8;
    state.railEdges = shortPaidRail ? { '73:74': { kind: 'rail', ruleVersion: 1, orderId: 'synthetic-short-rail', cityId: source.id, civId: 1, edgeId: '73:74', tileId: 73, toTileId: 74, startedRound: 0, completedRound: 0, paid: { materials: 4, credits: 2 }, strategicPaid: { iron: 1, coal: 1 }, workRequired: 2, eventId: `${state.revision}:1` } } : {};
    const p = planning(state, 1, 0);
    const option = p.options.find(candidate => candidate.action.type === 'propose-trade' && candidate.action.partner === 0 && candidate.action.recipeId === 'energy-for-materials' && candidate.action.transportMode === 'steam'); assert.ok(option);
    assert.equal(option.tradeQuote?.transport.mode, 'steam'); assert.ok(option.tradeQuote?.transport.mode === 'steam');
    assert.equal(option.tradeQuote.transport.railEdges.length, shortPaidRail ? 1 : 0);
    assert.equal(option.tradeQuote.cadenceRounds, option.tradeQuote.transport.unrailedCadence);
    const profile = civilizationBehaviorProfile(state.seed, 1); const progression = deriveProgressionPlan(state, actor, profile, p.options);
    const base = progressionWeight(option, 10, state, actor, profile, progression); assert.equal(base, 0);
    assert.equal(diplomacyWeight(option, base, p.plan), 0);
  }
});

void test('synthetic pending offers reserve nothing while simultaneous committed pledges are budgeted together', () => {
  let state = syntheticPartnership(); const firstRoute = state.routes[0]; assert.ok(firstRoute);
  state = act(state, 0, { type: 'propose-public-project', routeId: firstRoute.id, recipeId: 'joint-road-repair' }, 10);
  const first = state.publicProjects?.[0]; assert.ok(first);
  state.civilizations[0]!.resources.materials = 13;
  const pending = planning(state, 0, 20);
  assert.equal(pending.plan.promised.materials, 0);
  assert.equal(pending.weight(option => option.action.type === 'build' && option.action.project === 'workshop', 1000), 1000);
  state.civilizations[0]!.resources.materials = 100;
  state = act(state, 1, { type: 'respond-public-project', projectId: first.id, accept: true }, 10);
  const offerChoice = legalActions(state, 0, at(20)).find(option => option.action.type === 'propose-trade' && option.action.partner === 2 && option.action.recipeId === 'harvest-for-materials'); assert.ok(offerChoice);
  state = act(state, 0, offerChoice.action, 20);
  const offer = state.tradeOffers?.find(offer => offer.recipient === 2 && offer.status === 'pending'); assert.ok(offer);
  state = act(state, 2, { type: 'respond-trade', offerId: offer.id, accept: true }, 20);
  const otherRoute = state.routes.find(route => route.partner === 2); assert.ok(otherRoute); otherRoute.damage = 25;
  state = act(state, 0, { type: 'propose-public-project', routeId: otherRoute.id, recipeId: 'joint-road-repair' }, 30);
  const other = state.publicProjects?.find(project => project.routeId === otherRoute.id); assert.ok(other);
  state = act(state, 2, { type: 'respond-public-project', projectId: other.id, accept: true }, 30);
  state.civilizations[0]!.resources.energy = 1.5;
  const plan = planning(state, 0, 40); assert.equal(plan.plan.promised.materials, 4); assert.equal(plan.plan.promised.energy, 2);
  const decision = chooseCivilizationBehavior(state, 0, undefined, at(40)); assert.equal(decision.action?.type, 'cancel-public-project');
});

void test('synthetic paid rail fixture keeps a real faster steam reconsent path while refusing unfunded fuel', () => {
  let state = released(); const source = state.cities[0]; const target = state.cities[1]; assert.ok(source && target);
  state.cities = [source, target]; source.tileId = 73; target.tileId = 86;
  for (const tile of state.tiles) { tile.terrain = 'grassland'; tile.owner = 0; }
  for (const actor of state.civilizations) {
    actor.technologies = TECHNOLOGIES.map(technology => technology.id); actor.era = 3;
    actor.resources = { food: 1000, materials: 1000, energy: 1000, credits: 1000, science: 0, culture: 1000 };
    actor.strategicResources = { iron: 30, coal: 30 };
  }
  const land = legalActions(state, 0, epoch).find(option => option.action.type === 'propose-trade' && option.action.recipeId === 'harvest-for-materials' && option.action.partner === 1 && !option.action.transportMode); assert.ok(land);
  state = act(state, 0, land.action, 0);
  const offer = state.tradeOffers?.find(offer => offer.status === 'pending'); assert.ok(offer);
  state = act(state, 1, { type: 'respond-trade', offerId: offer.id, accept: true }, 0);
  const quote = createLandTransportPlanner(state).quote(source.tileId, target.tileId); assert.ok(quote);
  state.railEdges = {};
  for (let index = 1; index <= 2; index++) {
    const first = quote.tileIds[index - 1]; const second = quote.tileIds[index]; assert.ok(first !== undefined && second !== undefined);
    const edgeId = `${Math.min(first, second)}:${Math.max(first, second)}`;
    state.railEdges[edgeId] = { kind: 'rail', ruleVersion: 1, orderId: `synthetic-${edgeId}`, cityId: source.id, civId: 0, edgeId, tileId: Math.min(first, second), toTileId: Math.max(first, second), startedRound: 0, completedRound: 0, paid: { materials: 4, credits: 2 }, strategicPaid: { iron: 1, coal: 1 }, workRequired: 2, eventId: `${state.revision}:${index}` };
  }
  assert.ok(createSteamTransportPlanner(state).quote(source.tileId, target.tileId, 4));
  const stopped = chooseCivilizationBehavior(state, 0, undefined, at(10)); assert.equal(stopped.action?.type, 'stop-trade'); assert.ok(stopped.action);
  const oldTerms = structuredClone(state.routes[0]?.agreement?.terms);
  state = act(state, 0, stopped.action, 10);
  assert.deepEqual(state.routes[0]?.agreement?.terms, oldTerms); assert.equal(state.routes[0]?.agreement?.enabled, false);
  const proposed = chooseCivilizationBehavior(state, 0, stopped.memory, at(20)); assert.equal(proposed.action?.type, 'propose-trade');
  assert.ok(proposed.action?.type === 'propose-trade' && proposed.action.transportMode === 'steam');
  const emptyFuel = structuredClone(state); emptyFuel.civilizations[0]!.strategicResources!.coal = 0;
  const unfunded = planning(emptyFuel, 0, 20);
  assert.ok(unfunded.options.filter(option => option.action.type === 'propose-trade' && option.action.transportMode === 'steam').every(option => diplomacyWeight(option, 1000, unfunded.plan) === 0));
  const before = structuredClone(state.civilizations); state = act(state, 0, proposed.action, 20); assert.deepEqual(state.civilizations, before);
  const fresh = state.tradeOffers?.find(offer => offer.status === 'pending'); assert.ok(fresh?.terms.transport?.mode === 'steam');
  state = act(state, 1, { type: 'respond-trade', offerId: fresh.id, accept: true }, 20);
  assert.equal(state.routes.at(-1)?.agreement?.deliveryCount, 0);
  assert.equal(state.civilizations[0]?.strategicResources?.coal, before[0]?.strategicResources?.coal);
});
