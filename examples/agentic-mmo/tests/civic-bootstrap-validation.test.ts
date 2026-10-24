import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CIVICS, GOVERNMENTS } from '../core/content.ts';
import { applyCommand, catchUpStrategy, createWorld } from '../core/engine.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const time = (seconds: number) => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
function released(target = 'settlement-civic-bootstrap-1'): WorldState {
  return createWorld(1701, epoch, target);
}
function act(state: WorldState, action: GameAction): WorldState {
  const seconds = Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ((state.independentTurns?.lastActionWindow[4] ?? -1) + 1) * 10);
  const result = applyCommand(state, { seat: 4, expectedRevision: state.revision, timestamp: time(seconds), action });
  assert.ok(result.ok, result.error); return result.state;
}
function beat(state: WorldState): WorldState {
  const result = catchUpStrategy(state, time(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60));
  assert.ok(result.ok, result.error); return result.state;
}
function completed(): WorldState {
  let state = act(released(), { type: 'choose-civic', civicId: 'code-of-laws' });
  for (let index = 0; index < 20 && state.civilizations[4]!.civics!.active; index++) state = beat(state);
  assert.equal(state.civilizations[4]!.civics!.active, null);
  assert.deepEqual(state.civilizations[4]!.civics!.completedCivicIds, ['code-of-laws']);
  return state;
}
function corrupt(state: WorldState, change: (copy: WorldState) => void, label: string): void {
  const copy = structuredClone(state); change(copy); assert.equal(isWorldState(copy), false, label);
}

test('civic records are absent without civic rules and required together in the civic configuration', () => {
  const legacy = released('settlement-observatory-1'); const current = released();
  assert.ok(isWorldState(legacy)); assert.ok(isWorldState(current));
  corrupt(legacy, copy => { copy.civilizations[0]!.civics = structuredClone(current.civilizations[0]!.civics!); }, 'old release cannot gain a civic lane');
  corrupt(current, copy => { delete copy.civilizations[0]!.civics; }, 'new lane missing');
  corrupt(current, copy => { delete copy.civilizations[0]!.government; }, 'new government missing');
  corrupt(current, copy => { Object.assign(copy.civilizations[0]!.civics!, { injected: true }); }, 'unknown lane field');
});

test('active civic state validates exact IDs, prerequisites, cost snapshot, progress and round', () => {
  const state = beat(act(released(), { type: 'choose-civic', civicId: 'code-of-laws' }));
  assert.ok(isWorldState(state)); assert.ok(state.civilizations[4]!.civics!.active!.progress > 0);
  for (const [key, value] of [['civicId', 'unknown'], ['startedRound', state.round + 1], ['progress', -1], ['progress', 16], ['requiredCulture', 0], ['requiredCulture', Infinity]] as const)
    corrupt(state, copy => { Object.assign(copy.civilizations[4]!.civics!.active!, { [key]: value }); }, String(key));
  corrupt(state, copy => { copy.civilizations[4]!.civics!.completedCivicIds.push('code-of-laws'); }, 'active cannot be completed');
  corrupt(state, copy => { Object.assign(copy.civilizations[4]!.civics!.active!, { paidCredits: 0 }); }, 'extra progress field');
  const definition = CIVICS[0]!; const original = definition.cost;
  try { definition.cost = original + 10; assert.ok(isWorldState(state), 'stored positive cost remains a snapshot'); } finally { definition.cost = original; }
});

test('completion and entitlement link exactly to the latest completed civic and retained event', () => {
  const state = completed(); assert.ok(isWorldState(state));
  for (const change of [
    (copy: WorldState) => { copy.civilizations[4]!.civics!.completedCivicIds.push('code-of-laws'); },
    (copy: WorldState) => { copy.civilizations[4]!.civics!.completedCivicIds = ['unknown']; },
    (copy: WorldState) => { copy.civilizations[4]!.civics!.lastCompleted = null; },
    (copy: WorldState) => { copy.civilizations[4]!.civics!.reformEntitlement!.completionEventId = `${copy.revision + 1}:0`; },
    (copy: WorldState) => { copy.civilizations[4]!.civics!.reformEntitlement!.completedRound--; },
    (copy: WorldState) => { copy.events.find(event => event.id === copy.civilizations[4]!.civics!.lastCompleted!.eventId)!.actor = 0; },
  ]) corrupt(state, change, 'malformed completion or entitlement');
  const pruned = structuredClone(state); pruned.events = []; assert.ok(isWorldState(pruned), 'durable completion survives event pruning');
});

test('government validation checks exact released slots, policies, prerequisites and commitment arithmetic', () => {
  const state = act(completed(), { type: 'adopt-government', governmentId: 'chiefdom', assignments: [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }] });
  assert.ok(isWorldState(state));
  for (const change of [
    (copy: WorldState) => { copy.civilizations[4]!.government!.active!.governmentId = 'unknown'; },
    (copy: WorldState) => { copy.civilizations[4]!.government!.active!.assignments[0]!.slotType = 'military'; },
    (copy: WorldState) => { copy.civilizations[4]!.government!.active!.assignments[0]!.slotIndex = 1; },
    (copy: WorldState) => { copy.civilizations[4]!.government!.active!.assignments.push({ ...copy.civilizations[4]!.government!.active!.assignments[0]! }); },
    (copy: WorldState) => { copy.civilizations[4]!.government!.active!.assignments[0]!.policyId = 'unknown'; },
    (copy: WorldState) => { copy.civilizations[4]!.government!.active!.policyLockUntilRound++; },
    (copy: WorldState) => { copy.civilizations[4]!.government!.active!.governmentLockUntilRound = copy.round + 5; },
    (copy: WorldState) => { copy.civilizations[4]!.government!.active!.effectiveRound = copy.round + 1; },
  ]) corrupt(state, change, 'invalid arrangement');
});

test('synthetic second government persists only exact two-beat pending transitions and payment', () => {
  GOVERNMENTS.push({ id: 'synthetic-council', name: 'Synthetic persistence fixture', requiredFeatures: ['civic-bootstrap'], requires: ['code-of-laws'], slots: { military: 0, economic: 1, diplomatic: 0, wildcard: 0 }, baseProduction: {} });
  try {
    let state = act(completed(), { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] });
    for (let index = 0; index < 4; index++) state = beat(state);
    state = act(state, { type: 'adopt-government', governmentId: 'synthetic-council', assignments: [] });
    assert.ok(isWorldState(state)); assert.ok(isWorldState(beat(state)));
    for (const change of [
      (copy: WorldState) => { copy.civilizations[4]!.government!.pending!.completionRound++; },
      (copy: WorldState) => { copy.civilizations[4]!.government!.pending!.acceptedRound++; },
      (copy: WorldState) => { copy.civilizations[4]!.government!.pending!.paidCredits = 9; },
      (copy: WorldState) => { copy.civilizations[4]!.government!.pending!.targetGovernmentId = 'chiefdom'; },
      (copy: WorldState) => { copy.civilizations[4]!.government!.pending!.spentCompletionEventId = copy.civilizations[4]!.civics!.lastCompleted!.eventId; },
      (copy: WorldState) => { copy.civilizations[4]!.government!.active = null; },
    ]) corrupt(state, change, 'invalid pending transition');
    const finished = beat(beat(state)); assert.ok(isWorldState(finished)); assert.equal(finished.civilizations[4]!.government!.pending, null);
  } finally { GOVERNMENTS.pop(); }
});

test('spent latest entitlement cannot be reinstated after completion and arrangement events are pruned', () => {
  const ready = completed(); const entitlement = structuredClone(ready.civilizations[4]!.civics!.reformEntitlement!);
  const state = act(ready, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] });
  assert.equal(state.civilizations[4]!.government!.lastSpentReformCompletionEventId, entitlement.completionEventId);
  state.events = []; assert.ok(isWorldState(state));
  corrupt(state, copy => { copy.civilizations[4]!.civics!.reformEntitlement = entitlement; }, 'pruned spent entitlement restored');
  corrupt(state, copy => { copy.civilizations[4]!.government!.lastSpentReformCompletionEventId = null; }, 'consumed marker removed with no unspent entitlement');
  corrupt(state, copy => { copy.civilizations[4]!.government!.lastSpentReformCompletionEventId = `${copy.revision + 1}:0`; }, 'future consumed receipt');
});

test('a later actual civic completion keeps a new entitlement distinct from the durable earlier spend', () => {
  CIVICS.push({ id: 'synthetic-second-civic', name: 'Synthetic completion fixture', requiredFeatures: ['civic-bootstrap'], requires: ['code-of-laws'], cost: 1, capability: 'Persistence control only' });
  try {
    const first = completed();
    let state = act(first, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] });
    const spent = state.civilizations[4]!.government!.lastSpentReformCompletionEventId;
    state = act(state, { type: 'choose-civic', civicId: 'synthetic-second-civic' }); state = beat(state);
    assert.ok(isWorldState(state)); assert.equal(state.civilizations[4]!.government!.lastSpentReformCompletionEventId, spent);
    assert.notEqual(state.civilizations[4]!.civics!.reformEntitlement!.completionEventId, spent);
    state.events = []; assert.ok(isWorldState(state));
    corrupt(state, copy => { copy.civilizations[4]!.civics!.reformEntitlement = null; }, 'new unspent entitlement cannot disappear behind an older spent marker');
  } finally { CIVICS.pop(); }
});
