import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { decodeHistorySnapshot } from '../server/snapshot-codec.ts';
import { secondGovernmentJourney } from './fixtures/second-government-journey.ts';

function required<T>(value: T | null | undefined): T { assert.ok(value !== null && value !== undefined); return value; }
let cached: ReturnType<typeof secondGovernmentJourney> | undefined;
function story() { cached ??= secondGovernmentJourney(); return cached; }
function actor(state: WorldState) { return required(state.civilizations.find(value => value.id === story().seat)); }
function corrupt(state: WorldState, change: (copy: WorldState) => void, label: string): void {
  const copy = structuredClone(state); change(copy); assert.equal(isWorldState(copy), false, label);
}

void test('second-government release, productive civic branch and every real transition frame remain valid', async () => {
  const path = story();
  for (const step of path.steps) assert.ok(isWorldState(step.result.state), `legal frame ${step.result.state.revision}`);
  for (const state of [path.beforeRelease, path.adopted, ...path.civicFrames.flatMap(frame => [frame.selected, frame.completed]), path.accepted, path.firstTransitionBeat, path.transitionCompleted, path.constructionStarted, path.firstWorkBeat, path.built, path.reslotted, path.returnAccepted, path.returnFirstBeat, path.returned])
    assert.deepEqual(await decodeHistorySnapshot(JSON.stringify(state)), state);
  assert.deepEqual(actor(path.adopted).civics, actor(path.beforeRelease).civics);
  assert.deepEqual(actor(path.adopted).government, actor(path.beforeRelease).government);
  assert.equal(path.returned.year, path.beforeRelease.year); assert.equal(path.returned.clockTicks, path.beforeRelease.clockTicks);
});

void test('completed civic order requires prerequisites before their dependent completion even after event pruning', () => {
  const state = structuredClone(story().completed); state.events = [];
  assert.ok(isWorldState(state));
  corrupt(state, copy => {
    required(actor(copy).civics).completedCivicIds = ['code-of-laws', 'state-workforce', 'foreign-trade', 'early-empire', 'craftsmanship', 'political-philosophy'];
  }, 'unordered completion list cannot move State workforce before its actual prerequisites');
});

void test('new civic progress and real Autocracy slots remain released, exact and caller-independent', () => {
  const path = story(); const selected = required(path.civicFrames.at(-1)).selected;
  corrupt(path.beforeRelease, copy => { actor(copy).civics = structuredClone(required(actor(selected).civics)); }, 'new civic cannot exist on old release');
  corrupt(selected, copy => { required(required(actor(copy).civics).active).progress = 48; }, 'active progress must remain below snapshotted cost');
  corrupt(selected, copy => { required(required(actor(copy).civics).active).startedRound = copy.round + 1; }, 'future civic selection');
  corrupt(selected, copy => { required(actor(copy).civics).completedCivicIds = required(actor(copy).civics).completedCivicIds.filter(id => id !== 'state-workforce'); }, 'actual prerequisites required');
  for (const change of [
    (copy: WorldState) => { required(required(actor(copy).government).active).assignments[0] = { slotType: 'diplomatic', slotIndex: 0, policyId: 'urban-planning' }; },
    (copy: WorldState) => { required(required(actor(copy).government).active).assignments[0] = { slotType: 'military', slotIndex: 0, policyId: 'urban-planning' }; },
    (copy: WorldState) => { required(required(actor(copy).government).active).assignments.push({ slotType: 'wildcard', slotIndex: 0, policyId: 'urban-planning' }); },
    (copy: WorldState) => { Object.assign(required(actor(copy).government), { capitalConstructionWorkPercent: 15 }); },
  ]) corrupt(path.transitionCompleted, change, 'invalid persisted arrangement or invented modifier');
  corrupt(path.built, copy => {
    const city = required(copy.cities.find(value => value.id === path.cityId));
    Object.assign(required(required(city.construction).lastCompleted), { governmentId: 'autocracy' });
  }, 'historical completion cannot gain invented government attribution');
});

void test('real pending government timing, reserved payment and target assignments survive only exact arithmetic', () => {
  const path = story();
  const changes: Array<(copy: WorldState) => void> = [
    copy => { required(required(actor(copy).government).pending).completionRound++; },
    copy => { required(required(actor(copy).government).pending).acceptedRound++; },
    copy => { required(required(actor(copy).government).pending).paidCredits = 10; },
    copy => { required(required(actor(copy).government).pending).spentCompletionEventId = null; },
    copy => { required(required(actor(copy).government).pending).targetGovernmentId = 'chiefdom'; },
    copy => { required(required(actor(copy).government).pending).targetAssignments[0] = { slotType: 'wildcard', slotIndex: 1, policyId: 'urban-planning' }; },
    copy => { required(required(actor(copy).government).active).governmentId = 'autocracy'; },
    copy => { required(required(actor(copy).government).active).policyLockUntilRound++; },
  ];
  for (const [index, change] of changes.entries()) corrupt(path.accepted, change, `invalid real pending ${index}`);
  corrupt(path.returnAccepted, copy => { required(required(actor(copy).government).pending).paidCredits = 0; }, 'paid return cannot become free');
  corrupt(path.returnAccepted, copy => { required(required(actor(copy).government).pending).spentCompletionEventId = required(actor(copy).government).lastSpentReformCompletionEventId; }, 'paid return cannot spend old completion');
});

void test('real latest reform replaces earlier entitlements and stays consumed through paid changes and pruning', () => {
  const path = story(); const earned = required(required(actor(path.completed).civics).reformEntitlement);
  const earlier = required(required(actor(required(path.civicFrames[3]).completed).civics).reformEntitlement);
  assert.notEqual(earned.completionEventId, earlier.completionEventId);
  corrupt(path.completed, copy => { required(actor(copy).civics).reformEntitlement = structuredClone(earlier); }, 'replaced entitlement cannot return');
  for (const source of [path.accepted, path.firstTransitionBeat, path.transitionCompleted, path.reslotted, path.returnAccepted, path.returned]) {
    const state = structuredClone(source); state.events = [];
    assert.ok(isWorldState(state));
    assert.equal(required(actor(state).government).lastSpentReformCompletionEventId, earned.completionEventId);
    corrupt(state, copy => { required(actor(copy).civics).reformEntitlement = structuredClone(earned); }, 'spent completion reinstatement after pruning');
    corrupt(state, copy => { required(actor(copy).government).lastSpentReformCompletionEventId = null; }, 'durable spent marker removed');
  }
  corrupt(path.completed, copy => { required(copy.events.find(event => event.id === earned.completionEventId)).actor = (path.seat + 1) % 5; }, 'retained completion actor differs');
});
