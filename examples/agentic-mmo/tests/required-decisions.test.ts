import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILDINGS, CONSTRUCTION_RULES, TECHNOLOGIES } from '../core/content.ts';
import { applyCommand, catchUpStrategy, createWorld, legalActions, observe } from '../core/engine.ts';
import { isWorldState } from '../core/validation.ts';
import type { GameAction, TransitionResult, WorldState } from '../core/types.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const timestamp = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const targetRelease = 'settlement-decisions-1';

function record(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}

function city(state: WorldState, id = 'city-0') {
  const value = state.cities.find(candidate => candidate.id === id);
  assert.ok(value);
  return value;
}

function civilization(state: WorldState, id = 0) {
  const value = state.civilizations.find(candidate => candidate.id === id);
  assert.ok(value);
  return value;
}

function transition(state: WorldState, run: (value: WorldState) => TransitionResult): WorldState {
  const before = structuredClone(state);
  const restored: unknown = JSON.parse(JSON.stringify(state));
  assert.ok(isWorldState(restored));
  const outcome = run(state);
  assert.equal(outcome.ok, true, outcome.error);
  assert.deepEqual(run(restored), outcome);
  assert.deepEqual(state, before);
  return outcome.state;
}

function act(state: WorldState, action: GameAction, seconds: number, seat = 0): WorldState {
  return transition(state, value => applyCommand(value, { seat, action, expectedRevision: value.revision, timestamp: timestamp(seconds) }));
}

function beat(state: WorldState): WorldState {
  assert.ok(state.independentTurns);
  const seconds = (state.independentTurns.strategyTicks + 1) * 60;
  return transition(state, value => catchUpStrategy(value, timestamp(seconds)));
}

function now(state: WorldState, extra = 10): number {
  assert.ok(state.independentTurns);
  return state.independentTurns.strategyTicks * 60 + extra;
}

const cached = new Map<string, WorldState>();
function legalPrefix(rulesId = 'settlement-operating-exchange-1'): WorldState {
  const existing = cached.get(rulesId);
  if (existing) return structuredClone(existing);
  let state = createWorld(1701, epoch, rulesId);
  state = act(state, { type: 'research', technology: 'agriculture' }, 0);
  for (let count = 0; count < 10 && !civilization(state).technologies.includes('agriculture'); count++) state = beat(state);
  assert.ok(civilization(state).technologies.includes('agriculture'));
  assert.equal(civilization(state).researchTarget, '');
  cached.set(rulesId, state);
  return structuredClone(state);
}

function released(): WorldState {
  return legalPrefix(targetRelease);
}

function decisionWorld(): WorldState {
  return released();
}

function construction(state: WorldState, id = 'city-0') {
  return record(record(city(state, id)).construction);
}

function order(state: WorldState, id = 'city-0') {
  return record(construction(state, id).active);
}

function refused(state: WorldState, action: GameAction, seconds: number, reason?: RegExp): void {
  const before = structuredClone(state);
  const outcome = applyCommand(state, { seat: 0, action, expectedRevision: state.revision, timestamp: timestamp(seconds) });
  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.state, before);
  assert.deepEqual(state, before);
  assert.deepEqual(outcome.events, []);
  if (reason) assert.match(`${outcome.error} ${outcome.actionOutcome?.reason}`, reason);
}

await test('historical control keeps instant exact-city building and unrestricted Hold', () => {
  const state = legalPrefix();
  const built = act(state, { type: 'build', project: 'farm', cityId: 'city-0' }, now(state));
  assert.ok(city(built).buildings.includes('farm'));
  assert.equal(record(city(built)).construction, undefined);
  assert.equal(built.eventCounts['building-completed'], 1);
  assert.equal(civilization(built).resources.materials, civilization(state).resources.materials - 8);
  const held = act(built, { type: 'wait' }, now(built, 20));
  assert.equal(held.revision, built.revision + 1);
});

await test('historical control keeps research replacement and its original progress reset', () => {
  let state = legalPrefix();
  state = act(state, { type: 'research', technology: 'civic-institutions' }, now(state));
  state = beat(state);
  assert.ok(civilization(state).researchProgress > 0);
  const replaced = act(state, { type: 'research', technology: 'water-management' }, now(state));
  assert.equal(civilization(replaced).researchTarget, 'water-management');
  assert.equal(civilization(replaced).researchProgress, 0);
});

await test('released decision capability refuses Hold while released research and construction decisions remain', () => {
  const state = decisionWorld();
  assert.ok(legalActions(state, 0, timestamp(now(state))).some(option => option.action.type === 'research'));
  refused(state, { type: 'wait' }, now(state), /required|decision/i);
  assert.equal(legalActions(state, 0, timestamp(now(state))).some(option => option.action.type === 'wait'), false);
});

await test('released decision capability preserves active research target and invested progress on replacement refusal', () => {
  let state = decisionWorld();
  state = act(state, { type: 'research', technology: 'civic-institutions' }, now(state));
  state = beat(state);
  assert.ok(civilization(state).researchProgress > 0);
  refused(state, { type: 'research', technology: 'water-management' }, now(state), /active|underway|commitment/i);
  refused(state, { type: 'research', technology: 'civic-institutions' }, now(state));
});

await test('released decision capability pays once for a retained order without immediate building or effects', () => {
  const state = decisionWorld();
  const next = act(state, { type: 'build', project: 'farm', cityId: 'city-0' }, now(state));
  assert.equal(city(next).buildings.includes('farm'), false);
  assert.equal(city(next).infrastructure, city(state).infrastructure);
  assert.equal(city(next).wellbeing, city(state).wellbeing);
  const active = order(next);
  assert.equal(active.cityId, 'city-0');
  assert.equal(active.buildingId, 'farm');
  assert.equal(active.ruleVersion, 1);
  assert.equal(active.startedRound, state.round);
  assert.equal(active.workDone, 0);
  assert.equal(active.workRequired, 4);
  assert.deepEqual(active.paid, BUILDINGS.find(building => building.id === 'farm')?.cost);
  assert.equal(construction(next).lastCompleted, null);
  refused(next, { type: 'build', project: 'farm', cityId: 'city-0' }, now(next, 20));
  refused(next, { type: 'build', project: 'workshop', cityId: 'city-0' }, now(next, 20));
});

await test('legal construction journey retains payment, finishes once and first produces after completion', () => {
  let state = released();
  state = act(state, { type: 'research', technology: 'water-management' }, now(state));
  const before = structuredClone(state);
  state = act(state, { type: 'build', project: 'farm', cityId: 'city-0' }, now(state, 20));
  const active = order(state);
  let control = before;
  const paid = record(active.paid);
  let partial = false;
  for (let count = 0; count < 12; count++) {
    state = beat(state);
    control = beat(control);
    assert.equal(civilization(state).resources.food, civilization(control).resources.food);
    assert.equal(Math.round((civilization(control).resources.materials - civilization(state).resources.materials) * 100) / 100, paid.materials);
    assert.equal(Math.round((civilization(control).resources.credits - civilization(state).resources.credits) * 100) / 100, paid.credits);
    if (city(state).buildings.includes('farm')) break;
    partial = true;
    assert.ok(Number(order(state).workDone) > 0);
    assert.equal(city(state).infrastructure, city(control).infrastructure);
  }
  assert.ok(partial);
  assert.ok(city(state).buildings.includes('farm'));
  assert.equal(construction(state).active, null);
  const receipt = record(construction(state).lastCompleted);
  assert.equal(receipt.orderId, active.id);
  assert.equal(receipt.cityId, 'city-0');
  assert.equal(receipt.completedRound, state.round);
  assert.deepEqual(receipt.paid, active.paid);
  assert.equal(receipt.workRequired, active.workRequired);
  assert.ok(state.events.some(event => event.id === receipt.eventId && event.type === 'building-completed'));
  assert.equal(state.eventCounts['building-completed'], 1);
  assert.equal(city(state).infrastructure, city(control).infrastructure + 1);
  state = beat(state);
  control = beat(control);
  assert.ok(civilization(state).resources.food > civilization(control).resources.food);
  assert.equal(state.eventCounts['building-completed'], 1);
  assert.deepEqual(construction(state).lastCompleted, receipt);
});

await test('released research completion retains event identity and requires another genuine choice', () => {
  let state = decisionWorld();
  state = act(state, { type: 'research', technology: 'water-management' }, now(state));
  for (let count = 0; count < 12 && civilization(state).researchTarget; count++) state = beat(state);
  assert.ok(civilization(state).technologies.includes('water-management'));
  const completed = record(record(civilization(state)).lastResearchCompletion);
  assert.equal(completed.technologyId, 'water-management');
  assert.equal(completed.completedRound, state.round);
  assert.ok(state.events.some(event => event.id === completed.eventId && event.type === 'research-completed'));
  refused(state, { type: 'wait' }, now(state));
  state = act(state, { type: 'research', technology: 'kiln-firing' }, now(state));
  assert.equal(civilization(state).researchTarget, 'kiln-firing');
  assert.deepEqual(record(civilization(state)).lastResearchCompletion, completed);
});

await test('synthetic opening-state work uses opening wellbeing and industry accelerates the same commitment', () => {
  const initial = decisionWorld();
  city(initial).wellbeing = 0;
  city(initial).infrastructure = 0;
  city(initial).focus = 'culture';
  const normal = act(initial, { type: 'build', project: 'farm', cityId: 'city-0' }, now(initial));
  const focused = act(normal, { type: 'focus', focus: 'industry', cityId: 'city-0' }, now(normal, 20));
  const normalBeat = beat(normal);
  const industryBeat = beat(focused);
  assert.ok(city(normalBeat).wellbeing > 0);
  assert.equal(order(normalBeat).workDone, 0.5);
  assert.equal(order(industryBeat).workDone, 1);
  assert.equal(order(industryBeat).id, order(normal).id);
  let ordinary = normalBeat;
  let industry = industryBeat;
  for (let count = 0; count < 20 && city(ordinary).construction?.active; count++) ordinary = beat(ordinary);
  for (let count = 0; count < 20 && city(industry).construction?.active; count++) industry = beat(industry);
  assert.ok(city(ordinary).buildings.includes('farm') && city(industry).buildings.includes('farm'));
  assert.ok(Number(record(construction(industry).lastCompleted).completedRound) < Number(record(construction(ordinary).lastCompleted).completedRound));
});

await test('synthetic full damage preserves paid work until a tactical repair permits a later work beat', () => {
  const initial = decisionWorld();
  city(initial).damage = 100;
  let state = act(initial, { type: 'build', project: 'farm', cityId: 'city-0' }, now(initial));
  const active = order(state);
  state = beat(state);
  assert.equal(order(state).workDone, 0);
  assert.deepEqual(order(state).paid, active.paid);
  const lane = observe(state, 0, timestamp(now(state))).decisions?.construction.find(candidate => candidate.cityId === 'city-0');
  assert.equal(lane?.status, 'blocked');
  assert.equal(lane?.targetId, 'farm');
  assert.ok(lane?.blockers.some(blocker => blocker.reason.kind === 'zero-work'));
  state = act(state, { type: 'repair-city', cityId: 'city-0' }, now(state));
  assert.equal(order(state).workDone, 0);
  state = beat(state);
  assert.ok(Number(order(state).workDone) > 0);
  assert.deepEqual(order(state).paid, active.paid);
});

await test('absent actor obligations do not stop another actor or shared strategic production', () => {
  const initial = decisionWorld();
  refused(initial, { type: 'wait' }, now(initial));
  let state = act(initial, { type: 'research', technology: 'agriculture' }, now(initial), 1);
  state = beat(state);
  assert.equal(civilization(state).researchTarget, '');
  assert.equal(state.round, initial.round + 1);
  assert.ok(civilization(state, 1).researchProgress > 0 || civilization(state, 1).technologies.includes('agriculture'));
  assert.ok(civilization(state).resources.materials > civilization(initial).resources.materials);
  const observed = observe(state, 0, timestamp(now(state)));
  assert.equal(observed.civilization?.researchTarget, '');
});

await test('exact-town foreign and missing targets remain zero-effect refusals', () => {
  const state = decisionWorld();
  for (const cityId of ['missing-city', 'city-1']) refused(state, { type: 'build', project: 'farm', cityId }, now(state));
});

await test('required decisions remain visible through overdue admission and zero science does not block selection', () => {
  const state = decisionWorld();
  civilization(state).resources.science = 0;
  const at = timestamp(now(state));
  const view = observe(state, 0, at);
  assert.ok(view.decisions);
  assert.equal(view.decisions.research.status, 'required');
  assert.ok(view.decisions.research.availableIds.includes('water-management'));
  assert.ok(view.decisions.construction.some(lane => lane.cityId === 'city-0' && lane.status === 'required' && lane.availableIds.includes('farm')));
  const overdue = observe(state, 0, timestamp(now(state, 120)));
  assert.deepEqual(overdue.decisions, view.decisions);
  assert.deepEqual(overdue.legalActions, []);
  const selected = act(state, { type: 'research', technology: 'water-management' }, now(state));
  const active = observe(selected, 0, at).decisions;
  assert.ok(active);
  assert.equal(active.research.status, 'active');
  assert.equal(active.research.targetId, 'water-management');
  assert.deepEqual(active.research.progress, { done: 0, required: TECHNOLOGIES.find(technology => technology.id === 'water-management')?.cost });
  view.decisions.research.availableIds.length = 0;
  assert.ok(observe(state, 0, at).decisions?.research.availableIds.length);
});

await test('synthetic exhausted released research and unaffordable construction expose Blocked and permit Hold', () => {
  const state = decisionWorld();
  civilization(state).technologies = TECHNOLOGIES.filter(technology => technology.requiredFeatures.every(feature => state.unlockedFeatures.includes(feature))).map(technology => technology.id);
  civilization(state).resources.materials = 0;
  civilization(state).resources.credits = 0;
  const view = observe(state, 0, timestamp(now(state)));
  assert.ok(view.decisions);
  assert.equal(view.decisions.research.status, 'blocked');
  assert.deepEqual(view.decisions.research.availableIds, []);
  assert.ok(view.decisions.research.blockers.length > 0);
  const town = view.decisions.construction.find(lane => lane.cityId === 'city-0');
  assert.ok(town);
  assert.equal(town.status, 'blocked');
  assert.ok(town.blockers.some(blocker => blocker.reason.kind === 'resource'));
  const held = act(state, { type: 'wait' }, now(state));
  assert.equal(held.revision, state.revision + 1);
  assert.equal(civilization(held).researchTarget, '');
});

await test('a legal paid recipe gains no operation record before completion and cannot run on its completion beat', () => {
  let state = released();
  state = act(state, { type: 'research', technology: 'water-management' }, now(state));
  for (let count = 0; count < 12 && civilization(state).researchTarget; count++) state = beat(state);
  assert.ok(civilization(state).technologies.includes('water-management'));
  state = act(state, { type: 'build', project: 'irrigation', cityId: 'city-0' }, now(state));
  assert.equal(city(state).buildingOperations?.irrigation, undefined);
  assert.equal(order(state).workRequired, 6);
  for (let count = 0; count < 12 && !city(state).buildings.includes('irrigation'); count++) state = beat(state);
  assert.ok(city(state).buildings.includes('irrigation'));
  assert.deepEqual(city(state).buildingOperations?.irrigation, { enabled: true, lastResult: null });
  state = beat(state);
  assert.equal(city(state).buildingOperations?.irrigation?.lastResult?.status, 'operated');
});

await test('active research and town work permit Hold without automatic progress or an automatic successor plan', () => {
  let state = released();
  state = act(state, { type: 'research', technology: 'water-management' }, now(state));
  const action: GameAction = { type: 'build', project: 'farm', cityId: 'city-0' };
  state = transition(state, value => applyCommand(value, {
    seat: 0, action, expectedRevision: value.revision, timestamp: timestamp(now(value, 20)),
    plan: [{ action, reason: 'Commit this town to reliable harvests' }, { action: { type: 'build', project: 'workshop', cityId: 'city-0' }, reason: 'Review material capacity after completion' }],
  }));
  const observed = observe(state, 0, timestamp(now(state, 30)));
  assert.equal(observed.actionPlan?.items[0]?.status, 'completed');
  assert.equal(observed.actionPlan?.items[1]?.status, 'blocked');
  assert.match(observed.actionPlan?.items[1]?.result ?? '', /active construction/i);
  const prior = order(state);
  state = act(state, { type: 'wait' }, now(state, 30));
  assert.deepEqual(order(state), prior);
  assert.equal(city(state).buildings.length, 0);
});

await test('two legally founded towns retain independent exact orders and reversed city storage cannot redirect completion', () => {
  let state = released();
  for (let index = 0; index < 5; index++) state = beat(state);
  const founding = legalActions(state, 0, timestamp(now(state))).find(option => option.action.type === 'settle' && option.action.sourceCityId === 'city-0')?.action;
  assert.ok(founding);
  state = act(state, founding, now(state));
  const town = state.cities.find(candidate => candidate.civId === 0 && candidate.id !== 'city-0');
  assert.ok(town);
  state = act(state, { type: 'build', project: 'farm', cityId: 'city-0' }, now(state, 20));
  state = act(state, { type: 'build', project: 'workshop', cityId: town.id }, now(state, 30));
  assert.notEqual(order(state).id, order(state, town.id).id);
  const reordered = structuredClone(state);
  reordered.cities.reverse();
  for (let count = 0; count < 12 && state.cities.some(candidate => candidate.construction?.active); count++) state = beat(state);
  let other = reordered;
  while (other.round < state.round) other = beat(other);
  assert.deepEqual(city(other).construction, city(state).construction);
  assert.deepEqual(city(other, town.id).construction, city(state, town.id).construction);
  assert.deepEqual(city(other).buildings, city(state).buildings);
  assert.deepEqual(city(other, town.id).buildings, city(state, town.id).buildings);
  assert.deepEqual(city(state).buildings, ['farm']);
  assert.deepEqual(city(state, town.id).buildings, ['workshop']);
});

await test('existing construction retains its paid cost and work requirement after isolated current tuning changes', () => {
  let state = released();
  state = act(state, { type: 'build', project: 'farm', cityId: 'city-0' }, now(state));
  const active = order(state);
  const building = BUILDINGS.find(candidate => candidate.id === 'farm');
  assert.ok(building);
  const cost = structuredClone(building.cost);
  const required = CONSTRUCTION_RULES.requiredWork.farm;
  try {
    building.cost = { materials: 999, credits: 999 };
    Object.assign(CONSTRUCTION_RULES.requiredWork, { farm: 999 });
    for (let count = 0; count < 12 && city(state).construction?.active; count++) state = beat(state);
    assert.ok(city(state).buildings.includes('farm'));
    assert.deepEqual(construction(state).lastCompleted && record(construction(state).lastCompleted).paid, active.paid);
    assert.equal(record(construction(state).lastCompleted).workRequired, active.workRequired);
  } finally {
    building.cost = cost;
    Object.assign(CONSTRUCTION_RULES.requiredWork, { farm: required });
  }
});
