import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, applyRelease, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { createIndependentTurns } from '../core/simulation/turns.ts';
import { isWorldState } from '../core/validation.ts';
import type { Command, GameAction, WorldState } from '../core/types.ts';
import {
  completeAttachedPlan,
  isPersistedActionPlan,
  isGameAction,
  observeActionPlan,
  validateAttachedPlan,
  type ActionPlan,
  type ActionPlanItem,
} from '../core/planning.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const tenSeconds = '2026-10-16T00:00:10.000Z';
const head: GameAction = { type: 'focus', focus: 'industry' };
const followUp: GameAction = { type: 'build', project: 'farm' };

function fixture(): WorldState {
  const first = createWorld(17, epoch);
  const second = applyRelease(first, { expectedRevision: 0, expectedFromReleaseId: first.releaseId, targetReleaseId: 'settlement-foundations-2' }).state;
  const state = applyRelease(second, { expectedRevision: 1, expectedFromReleaseId: second.releaseId, targetReleaseId: 'settlement-independent-1', timestamp: epoch }).state;
  state.unlockedFeatures.push('bounded-plans');
  state.independentTurns = createIndependentTurns(epoch);
  const civ = state.civilizations[0];
  assert.ok(civ);
  civ.technologies.push('agriculture');
  return state;
}

function command(state: WorldState): Command {
  return { seat: 0, expectedRevision: state.revision, action: head, timestamp: epoch };
}

function input(): ActionPlanItem[] {
  return [{ action: head, reason: 'Make materials for construction' }, { action: followUp, reason: 'Feed the growing settlement' }];
}

function acceptedPlan(state: WorldState): { state: WorldState; plan: ActionPlan } {
  const checked = validateAttachedPlan(state, command(state), input());
  assert.equal(checked.ok, true);
  const accepted = applyCommand(state, command(state));
  assert.equal(accepted.ok, true, accepted.error);
  const plan = completeAttachedPlan(checked.plan, state.revision, accepted.state.revision);
  assert.ok(plan);
  return { state: accepted.state, plan };
}

await test('absent and empty attachments preserve direct actions on every release', () => {
  const state = createWorld(17, epoch);
  for (const attachment of [undefined, []]) {
    const result = validateAttachedPlan(state, command(state), attachment);
    assert.deepEqual(result, { ok: true, plan: [] });
    assert.equal(completeAttachedPlan([], 0, 1), null);
  }
});

await test('nonempty attachments require an explicitly released bounded-plans capability', () => {
  const state = fixture();
  state.unlockedFeatures = state.unlockedFeatures.filter((feature) => feature !== 'bounded-plans');
  const before = JSON.stringify(state);
  const result = validateAttachedPlan(state, command(state), input());
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Unreleased plan was admitted');
  assert.equal(result.code, 'plan_not_released');
  assert.ok(result.error.length > 0);
  assert.equal(JSON.stringify(state), before);
});

await test('plans have at most two strict bounded items and exact typed action shapes', () => {
  const state = fixture();
  const invalid: unknown[] = [null, {}, [input()[0], input()[1], input()[0]], [{ action: head, reason: '' }], [{ action: head, reason: ' ' }], [{ action: head, reason: 'x'.repeat(281) }], [{ action: head, reason: 'why', extra: true }], [{ action: { ...head, extra: 1 }, reason: 'why' }], [{ action: { type: 'unknown' }, reason: 'why' }], [{ action: { type: 'focus', focus: 'unknown' }, reason: 'why' }], [{ action: head, reason: 'why' }, { action: { type: 'respond-trade', offerId: 'offer', accept: 'yes' }, reason: 'why' }]];
  for (const attachment of invalid) {
    const result = validateAttachedPlan(state, command(state), attachment);
    assert.equal(result.ok, false, JSON.stringify(attachment));
    if (result.ok) throw new Error('Malformed plan was admitted');
    assert.equal(result.code, 'invalid_plan');
  }
});

await test('the attached head must exactly match the submitted real action', () => {
  const state = fixture();
  const result = validateAttachedPlan(state, command(state), [{ action: { type: 'wait' }, reason: 'Wait instead' }]);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Mismatched plan was admitted');
  assert.equal(result.code, 'plan_head_mismatch');
  assert.match(result.error, /head/i);
});

await test('original observation context is bounded and survives host revision rebasing', () => {
  const state = fixture();
  const rebased = { ...command(state), observedRevision: 0 };
  const checked = validateAttachedPlan(state, rebased, input());
  assert.equal(checked.ok, true);
  const plan = completeAttachedPlan(checked.plan, rebased.observedRevision, state.revision + 1);
  assert.equal(plan?.observedRevision, 0);
  assert.equal(plan?.committedRevision, state.revision + 1);
  for (const observedRevision of [-1, 0.5, state.revision + 1, Number.NaN]) {
    const invalid = validateAttachedPlan(state, { ...command(state), observedRevision }, input());
    assert.equal(invalid.ok, false);
    if (invalid.ok) throw new Error('Invalid context was admitted');
    assert.equal(invalid.code, 'invalid_plan_context');
  }
});

await test('accepted attachment retains only a detached completed head and needs-review successor', () => {
  const state = fixture();
  const original = input();
  const checked = validateAttachedPlan(state, command(state), original);
  assert.equal(checked.ok, true);
  const plan = completeAttachedPlan(checked.plan, state.revision, state.revision + 1);
  assert.ok(plan);
  assert.deepEqual(plan.items.map((item) => item.status), ['completed', 'needs-review']);
  assert.match(plan.items[0]?.result ?? '', /revision 3/);
  assert.match(plan.items[1]?.result ?? '', /review/i);
  const first = original[0];
  assert.ok(first);
  first.reason = 'Mutated input';
  assert.notEqual(plan.items[0]?.reason, first.reason);
  assert.notEqual(checked.plan[0]?.reason, first.reason);
  assert.equal(isPersistedActionPlan(plan, state.revision + 1), true);
});

await test('legal follow-up is blocked by real admission until the next tactical window', () => {
  const accepted = acceptedPlan(fixture());
  const snapshot = JSON.stringify(accepted);
  const now = observeActionPlan(accepted.state, 0, accepted.plan, epoch);
  assert.equal(now.items[0]?.status, 'completed');
  assert.equal(now.items[1]?.status, 'blocked');
  assert.match(now.items[1]?.result ?? '', /allowance|window/i);
  const later = observeActionPlan(accepted.state, 0, accepted.plan, tenSeconds);
  assert.equal(later.items[1]?.status, 'ready');
  assert.match(later.items[1]?.result ?? '', /explicit|submit/i);
  assert.equal(JSON.stringify(accepted), snapshot);
  assert.equal(accepted.state.cities[0]?.buildings.includes('farm'), false);
});

await test('missing observation time never claims an independent follow-up is ready', () => {
  const accepted = acceptedPlan(fixture());
  const view = observeActionPlan(accepted.state, 0, accepted.plan);
  assert.equal(view.items[1]?.status, 'needs-review');
  assert.match(view.items[1]?.result ?? '', /timestamp/i);
});

await test('due strategic beats block a follow-up until realized without performing it', () => {
  const accepted = acceptedPlan(fixture());
  const at = '2026-10-16T00:01:00.000Z';
  const view = observeActionPlan(accepted.state, 0, accepted.plan, at);
  assert.equal(view.items[1]?.status, 'blocked');
  assert.match(view.items[1]?.result ?? '', /strategy_catchup_required/);
  const caught = catchUpStrategy(accepted.state, at);
  assert.equal(caught.ok, true, caught.error);
  assert.equal(observeActionPlan(caught.state, 0, accepted.plan, at).items[1]?.status, 'ready');
  assert.equal(caught.state.cities[0]?.buildings.includes('farm'), false);
});

await test('missing resources and prerequisites block intentions with concrete reasons', () => {
  const accepted = acceptedPlan(fixture());
  const civ = accepted.state.civilizations[0];
  assert.ok(civ);
  civ.resources.materials = 0;
  let view = observeActionPlan(accepted.state, 0, accepted.plan, tenSeconds);
  assert.equal(view.items[1]?.status, 'blocked');
  assert.match(view.items[1]?.result ?? '', /materials/);
  civ.resources.materials = 20;
  civ.technologies = [];
  view = observeActionPlan(accepted.state, 0, accepted.plan, tenSeconds);
  assert.equal(view.items[1]?.status, 'blocked');
  assert.match(view.items[1]?.result ?? '', /agriculture/);
});

await test('achieved and disappeared targets invalidate follow-ups without rewriting completed facts', () => {
  const accepted = acceptedPlan(fixture());
  const city = accepted.state.cities[0];
  assert.ok(city);
  city.buildings.push('farm');
  let view = observeActionPlan(accepted.state, 0, accepted.plan, tenSeconds);
  assert.equal(view.items[1]?.status, 'invalidated');
  assert.match(view.items[1]?.result ?? '', /already/i);
  assert.deepEqual(view.items[0], accepted.plan.items[0]);
  const follow = accepted.plan.items[1];
  assert.ok(follow);
  follow.action = { type: 'respond-trade', offerId: 'gone-offer', accept: true };
  view = observeActionPlan(accepted.state, 0, accepted.plan, tenSeconds);
  assert.equal(view.items[1]?.status, 'invalidated');
  assert.match(view.items[1]?.result ?? '', /gone-offer/);
});

await test('unrelated revisions do not invalidate a still-legal plan', () => {
  const accepted = acceptedPlan(fixture());
  const changed = applyCommand(accepted.state, { seat: 2, expectedRevision: accepted.state.revision, action: { type: 'wait' }, timestamp: epoch });
  assert.equal(changed.ok, true, changed.error);
  const view = observeActionPlan(changed.state, 0, accepted.plan, tenSeconds);
  assert.equal(view.items[1]?.status, 'ready');
  assert.equal(view.observedRevision, accepted.plan.observedRevision);
  assert.equal(view.committedRevision, accepted.plan.committedRevision);
});

await test('a rejected real action preserves world and budgets while returning its concrete failure', () => {
  const accepted = acceptedPlan(fixture());
  const original = JSON.stringify(accepted);
  const attachment = [{ action: followUp, reason: 'Attempt the next step' }];
  const attempted = { ...command(accepted.state), action: followUp };
  assert.equal(validateAttachedPlan(accepted.state, attempted, attachment).ok, true);
  const refused = applyCommand(accepted.state, attempted);
  assert.equal(refused.ok, false);
  assert.equal(refused.state, accepted.state);
  assert.match(refused.error ?? '', /allowance|window/i);
  assert.equal(JSON.stringify(accepted), original);
});

await test('persisted plans reject malformed contexts, statuses, extra items and unbounded strings', () => {
  const accepted = acceptedPlan(fixture());
  const valid = accepted.plan;
  const headItem = valid.items[0];
  const successor = valid.items[1];
  assert.ok(headItem && successor);
  const invalid: unknown[] = [null, {}, { ...valid, observedRevision: -1 }, { ...valid, observedRevision: valid.committedRevision }, { ...valid, committedRevision: accepted.state.revision + 1 }, { ...valid, items: [] }, { ...valid, items: [headItem, successor, successor] }, { ...valid, extra: true }, { ...valid, items: [{ ...headItem, status: 'ready' }, successor] }, { ...valid, items: [headItem, { ...successor, status: 'ready' }] }, { ...valid, items: [{ ...headItem, result: '' }] }, { ...valid, items: [{ ...headItem, reason: 'x'.repeat(281) }] }];
  for (const value of invalid) assert.equal(isPersistedActionPlan(value, accepted.state.revision), false, JSON.stringify(value));
  assert.equal(isPersistedActionPlan(valid, accepted.state.revision), true);
  assert.throws(() => completeAttachedPlan(input(), 5, 5), /revision/i);
});

await test('JSON restart preserves identical lifecycle projections and terminal worlds invalidate remaining intent', () => {
  const accepted = acceptedPlan(fixture());
  const json: unknown = JSON.parse(JSON.stringify(accepted.plan));
  assert.ok(isPersistedActionPlan(json, accepted.state.revision));
  assert.deepEqual(observeActionPlan(accepted.state, 0, json, tenSeconds), observeActionPlan(accepted.state, 0, accepted.plan, tenSeconds));
  accepted.state.outcome = { kind: 'mars', winners: [0], round: accepted.state.round, reason: 'Fixture terminal state' };
  const view = observeActionPlan(accepted.state, 0, json, tenSeconds);
  assert.equal(view.items[0]?.status, 'completed');
  assert.equal(view.items[1]?.status, 'invalidated');
  assert.match(view.items[1]?.result ?? '', /ended|terminal/i);
});

await test('sparse plan arrays cannot hide unvalidated items before JSON persistence', () => {
  const state = fixture();
  const sparse: unknown[] = [input()[0]];
  sparse.length = 2;
  assert.equal(validateAttachedPlan(state, command(state), sparse).ok, false);
  const accepted = acceptedPlan(state);
  accepted.plan.items.length = 1;
  accepted.plan.items.length = 2;
  assert.equal(isPersistedActionPlan(accepted.plan, accepted.state.revision), false);
});

await test('attached operation plans validate exact shapes and revalidate explicit pause successors', () => {
  const initial = fixture();
  initial.unlockedFeatures = initial.unlockedFeatures.filter((feature) => feature !== 'bounded-plans');
  const released = applyRelease(initial, { expectedRevision: initial.revision, expectedFromReleaseId: initial.releaseId, targetReleaseId: 'settlement-production-1', timestamp: epoch });
  assert.equal(released.ok, true, released.error);
  const state = released.state;
  const city = state.cities[0];
  assert.ok(city);
  city.buildings.push('kiln');
  city.buildingOperations = { kiln: { enabled: true, lastResult: null } };
  const pause: GameAction = { type: 'set-building-operation', cityId: city.id, buildingId: 'kiln', enabled: false };
  const plan: ActionPlanItem[] = [{ action: head, reason: 'Prepare material reserves' }, { action: pause, reason: 'Preserve energy after reviewing the next beat' }];
  assert.equal(validateAttachedPlan(state, command(state), plan).ok, true);
  for (const malformed of [{ ...pause, enabled: 'false' }, { ...pause, cityId: '' }, { ...pause, extra: 1 }]) {
    assert.equal(validateAttachedPlan(state, command(state), [{ action: malformed, reason: 'Invalid shape' }]).ok, false);
  }
  const accepted = applyCommand(state, { ...command(state), plan });
  assert.equal(accepted.ok, true, accepted.error);
  const persisted = accepted.state.actionPlans?.[0];
  assert.ok(persisted);
  assert.equal(isPersistedActionPlan(persisted, accepted.state.revision), true);
  assert.equal(observeActionPlan(accepted.state, 0, persisted, tenSeconds).items[1]?.status, 'ready');
  const paused = applyCommand(accepted.state, { seat: 0, expectedRevision: accepted.state.revision, timestamp: tenSeconds, action: pause });
  assert.equal(paused.ok, true, paused.error);
  assert.equal(observeActionPlan(paused.state, 0, persisted, tenSeconds).items[1]?.status, 'invalidated');
  const missing = structuredClone(accepted.state);
  missing.cities = missing.cities.filter((candidate) => candidate.id !== city.id);
  assert.equal(observeActionPlan(missing, 0, persisted, tenSeconds).items[1]?.status, 'invalidated');
});

await test('frontier plans preserve historical parsing but require exact explicit source identities for new actions', () => {
  assert.equal(isGameAction({ type: 'settle', tileId: 12 }), true);
  assert.equal(isGameAction({ type: 'settle', tileId: 12, sourceCityId: 'city-0' }), true);
  for (const sourceCityId of ['', '   ', 4, undefined, null]) {
    assert.equal(isGameAction({ type: 'settle', tileId: 12, sourceCityId }), false);
  }
  assert.equal(isGameAction({ type: 'settle', tileId: 12, sourceCityId: 'city-0', extra: true }), false);
  let state = fixture();
  state.unlockedFeatures = state.unlockedFeatures.filter((feature) => feature !== 'bounded-plans');
  for (const targetReleaseId of ['settlement-production-1', 'settlement-frontiers-1']) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: epoch });
    assert.equal(result.ok, true, result.error);
    state = result.state;
  }
  const action = legalActions(state, 0, epoch).find(({ action: option }) => option.type === 'settle')?.action;
  assert.ok(action && action.type === 'settle' && action.sourceCityId);
  const withPlan: ActionPlanItem[] = [{ action: head, reason: 'Prepare supplies' }, { action, reason: 'Move three people from the named source after reviewing reserves' }];
  const accepted = applyCommand(state, { ...command(state), plan: withPlan });
  assert.equal(accepted.ok, true, accepted.error);
  const persisted = accepted.state.actionPlans?.[0];
  assert.ok(persisted);
  assert.equal(isPersistedActionPlan(persisted, accepted.state.revision), true);
  assert.equal(observeActionPlan(accepted.state, 0, persisted, tenSeconds).items[1]?.status, 'ready');
  const depleted = structuredClone(accepted.state);
  const source = depleted.cities.find((city) => city.id === action.sourceCityId);
  assert.ok(source);
  source.population = 5;
  const blocked = observeActionPlan(depleted, 0, persisted, tenSeconds).items[1];
  assert.equal(blocked?.status, 'blocked');
  assert.match(blocked?.result ?? '', /5 people; 6 are required/);
  const missing = structuredClone(depleted);
  missing.cities = missing.cities.filter((city) => city.id !== action.sourceCityId);
  assert.equal(observeActionPlan(missing, 0, persisted, tenSeconds).items[1]?.status, 'invalidated');
  const other = { ...action, sourceCityId: 'city-1' };
  assert.equal(validateAttachedPlan(state, { ...command(state), action }, [{ action: other, reason: 'Different source' }]).ok, false);
  const legacy = completeAttachedPlan([{ action: head, reason: 'Old head' }, { action: { type: 'settle', tileId: action.tileId }, reason: 'Historical source-less intention' }], state.revision, accepted.state.revision);
  assert.ok(legacy);
  assert.equal(isPersistedActionPlan(legacy, accepted.state.revision), true);
  assert.equal(observeActionPlan(accepted.state, 0, legacy, tenSeconds).items[1]?.status, 'invalidated');
});

await test('city-targeted plans preserve exact identity, reject malformed targets and never redirect completed or missing intentions', () => {
  for (const action of [{ type: 'focus', focus: 'culture' }, { type: 'build', project: 'farm' }]) {
    assert.equal(isGameAction(action), true);
    assert.equal(isGameAction({ ...action, cityId: 'city-0' }), true);
    for (const cityId of ['', ' ', undefined, null, 1, 'x'.repeat(129)]) assert.equal(isGameAction({ ...action, cityId }), false);
    assert.equal(isGameAction({ ...action, cityId: 'city-0', extra: true }), false);
  }
  let state = fixture();
  state.unlockedFeatures = state.unlockedFeatures.filter((feature) => feature !== 'bounded-plans');
  for (const targetReleaseId of ['settlement-production-1', 'settlement-frontiers-1', 'settlement-specialization-1']) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: epoch });
    assert.equal(result.ok, true, result.error);
    state = result.state;
  }
  const city = state.cities.find((candidate) => candidate.civId === 0);
  assert.ok(city);
  const focus: GameAction = { type: 'focus', focus: 'industry', cityId: city.id };
  const build: GameAction = { type: 'build', project: 'farm', cityId: city.id };
  const plan: ActionPlanItem[] = [{ action: focus, reason: 'Give this settlement a material emphasis' }, { action: build, reason: 'Review and build the food project in this exact settlement' }];
  const submitted = { ...command(state), action: focus, plan };
  assert.equal(validateAttachedPlan(state, submitted, plan).ok, true);
  assert.equal(validateAttachedPlan(state, submitted, [{ action: { ...focus, cityId: 'city-1' }, reason: 'Different city' }]).ok, false);
  const accepted = applyCommand(state, submitted);
  assert.equal(accepted.ok, true, accepted.error);
  const persisted = accepted.state.actionPlans?.[0];
  assert.ok(persisted);
  assert.equal(isPersistedActionPlan(persisted, accepted.state.revision), true);
  assert.equal(observeActionPlan(accepted.state, 0, persisted, tenSeconds).items[1]?.status, 'ready');
  const foreign = structuredClone(accepted.state);
  const foreignCity = foreign.cities.find((candidate) => candidate.civId === 1);
  assert.ok(foreignCity);
  foreignCity.buildings.push('farm');
  assert.equal(observeActionPlan(foreign, 0, persisted, tenSeconds).items[1]?.status, 'ready');
  const completed = structuredClone(accepted.state);
  const completedCity = completed.cities.find((candidate) => candidate.id === city.id);
  assert.ok(completedCity);
  completedCity.buildings.push('farm');
  assert.equal(observeActionPlan(completed, 0, persisted, tenSeconds).items[1]?.status, 'invalidated');
  const disappeared = structuredClone(accepted.state);
  disappeared.cities = disappeared.cities.filter((candidate) => candidate.id !== city.id);
  assert.equal(observeActionPlan(disappeared, 0, persisted, tenSeconds).items[1]?.status, 'invalidated');
  for (const legacy of [{ type: 'focus', focus: 'culture' }, { type: 'build', project: 'farm' }] satisfies GameAction[]) {
    const prior = completeAttachedPlan([{ action: focus, reason: 'Accepted head' }, { action: legacy, reason: 'Historical untargeted intent' }], state.revision, accepted.state.revision);
    assert.ok(prior);
    assert.equal(isPersistedActionPlan(prior, accepted.state.revision), true);
    assert.equal(observeActionPlan(accepted.state, 0, prior, tenSeconds).items[1]?.status, 'invalidated');
  }
  const replayState: unknown = JSON.parse(JSON.stringify(state));
  assert.ok(isWorldState(replayState));
  assert.deepEqual(applyCommand(replayState, structuredClone(submitted)), accepted);
});

await test('city repair plans bind an exact damaged owned target and recheck resources without execution', () => {
  assert.equal(isGameAction({ type: 'repair-city', cityId: 'city-0' }), true);
  for (const cityId of ['', ' ', undefined, null, 1, 'x'.repeat(129)]) assert.equal(isGameAction({ type: 'repair-city', cityId }), false);
  assert.equal(isGameAction({ type: 'repair-city', cityId: 'city-0', routeId: 'route-0' }), false);
  let state = fixture();
  state.unlockedFeatures = state.unlockedFeatures.filter((feature) => feature !== 'bounded-plans');
  for (const targetReleaseId of ['settlement-production-1', 'settlement-frontiers-1', 'settlement-specialization-1', 'settlement-recovery-1']) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: epoch });
    assert.equal(result.ok, true, result.error);
    state = result.state;
  }
  const city = state.cities.find((candidate) => candidate.civId === 0);
  assert.ok(city);
  city.damage = 35;
  const action: GameAction = { type: 'repair-city', cityId: city.id };
  const plan: ActionPlanItem[] = [{ action: { type: 'wait' }, reason: 'Review the damaged city' }, { action, reason: 'Pay for this exact city recovery' }];
  const submitted = { ...command(state), action: plan[0]?.action ?? action, plan };
  assert.equal(validateAttachedPlan(state, { ...submitted, action }, [{ action: { ...action, cityId: 'other' }, reason: 'Wrong target' }]).ok, false);
  const accepted = applyCommand(state, submitted);
  assert.equal(accepted.ok, true, accepted.error);
  const persisted = accepted.state.actionPlans?.[0];
  assert.ok(persisted);
  assert.equal(isPersistedActionPlan(persisted, accepted.state.revision), true);
  assert.equal(observeActionPlan(accepted.state, 0, persisted, tenSeconds).items[1]?.status, 'ready');
  for (const condition of ['healthy', 'foreign', 'missing', 'poor']) {
    const changed = structuredClone(accepted.state);
    const target = changed.cities.find((candidate) => candidate.id === city.id);
    const civ = changed.civilizations[0];
    assert.ok(target && civ);
    if (condition === 'healthy') target.damage = 0;
    if (condition === 'foreign') target.civId = 1;
    if (condition === 'missing') changed.cities = changed.cities.filter((candidate) => candidate.id !== city.id);
    if (condition === 'poor') civ.resources.energy = 0;
    const before = structuredClone(changed);
    const result: ActionPlan['items'][number] | undefined = observeActionPlan(changed, 0, persisted, tenSeconds).items[1];
    assert.equal(result?.status, condition === 'poor' ? 'blocked' : 'invalidated');
    if (condition === 'poor') assert.match(result?.result ?? '', /energy 0\/2/);
    assert.deepEqual(changed, before);
  }
});
