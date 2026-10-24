import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, catchUpStrategy, createWorld } from '../core/engine.ts';
import { validInstitutionalScienceOperation, validInstitutionalScienceReceipt, validPolicyExclusivity } from '../core/learning-patronage-validation.ts';
import { isWorldState } from '../core/validation.ts';
import type { BuildingOperationResult, GameAction, PolicyAssignment, WorldState } from '../core/types.ts';
import { decodeHistorySnapshot } from '../server/snapshot-codec.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';

const features = ['learning-patronage', 'civic-bootstrap', 'second-government', 'statecraft', 'building-operations', 'resident-capacity', 'district-planning', 'writing', 'learning-commerce'];
const epoch = '2026-10-24T00:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const raw = (value: object): Record<string, unknown> => value as unknown as Record<string, unknown>;
const assignment = (policyId: string, slotType: 'economic' | 'wildcard' = 'economic'): PolicyAssignment => ({ slotType, slotIndex: 0, policyId });

function operation(buildingId = 'library'): BuildingOperationResult {
  return {
    round: 7, status: 'operated', paid: buildingId === 'academy' ? { culture: 2, credits: 1 } : { credits: buildingId === 'university' ? 2 : 1 },
    produced: { science: buildingId === 'university' ? 6.26 : 3.76 }, shortages: [],
    residents: { ruleVersion: 1, openingPopulation: 9, communityReserve: 3, required: 3, available: 6, allocated: 3 },
    policyContribution: { policyId: 'learning-patronage', percent: 25, unboostedScience: buildingId === 'university' ? 5.01 : 3.01, bonusScience: buildingId === 'university' ? 1.25 : 0.75 },
  };
}

function contribution(value: BuildingOperationResult) { assert.ok(value.policyContribution); return value.policyContribution; }

function rejects(cases: Array<[string, (value: BuildingOperationResult) => void]>): void {
  for (const [label, mutate] of cases) {
    const value = operation(); mutate(value);
    assert.equal(validInstitutionalScienceOperation(value, 'library', features), false, label);
  }
}

void test('independent raw receipts validate exact three-institution arithmetic without a production oracle', () => {
  for (const buildingId of ['library', 'academy', 'university']) {
    const value = operation(buildingId); const before = structuredClone(value);
    assert.equal(validInstitutionalScienceOperation(value, buildingId, features), true, buildingId);
    assert.deepEqual(value, before);
  }
  const rounding = operation();
  Object.assign(contribution(rounding), { unboostedScience: 2.02, bonusScience: 0.51 }); rounding.produced.science = 2.53;
  assert.equal(validInstitutionalScienceOperation(rounding, 'library', features), true);
  const ordinary = operation(); delete ordinary.policyContribution;
  assert.equal(validInstitutionalScienceOperation(ordinary, 'library', features), true);
  assert.equal(validInstitutionalScienceOperation(ordinary, 'observatory', features), true);
});

void test('raw policy receipts reject malformed identity, extra fields and nonfinite or unquantized amounts', () => {
  rejects([
    ['null contribution', value => { raw(value).policyContribution = null; }],
    ['undefined contribution', value => { raw(value).policyContribution = undefined; }],
    ['array contribution', value => { raw(value).policyContribution = []; }],
    ['missing identity', value => { delete raw(contribution(value)).policyId; }],
    ['unknown identity', value => { contribution(value).policyId = 'invented-policy'; }],
    ['wrong identity', value => { contribution(value).policyId = 'urban-planning'; }],
    ['extra receipt field', value => { raw(contribution(value)).forecast = true; }],
    ['impossible genesis production', value => { value.round = 0; }],
    ['fractional production round', value => { value.round = 7.5; }],
    ['wrong percent', value => { contribution(value).percent = 50; }],
    ['string percent', value => { raw(contribution(value)).percent = '25'; }],
    ['missing base', value => { delete raw(contribution(value)).unboostedScience; }],
    ['negative base', value => { contribution(value).unboostedScience = -3.01; }],
    ['infinite base', value => { contribution(value).unboostedScience = Infinity; }],
    ['NaN base', value => { contribution(value).unboostedScience = NaN; }],
    ['unquantized base', value => { contribution(value).unboostedScience = 3.011; }],
    ['negative bonus', value => { contribution(value).bonusScience = -0.75; }],
    ['infinite bonus', value => { contribution(value).bonusScience = Infinity; }],
    ['unquantized bonus', value => { contribution(value).bonusScience = 0.751; }],
    ['zero earned bonus', value => { contribution(value).bonusScience = 0; value.produced.science = 3.01; }],
    ['zero base and bonus', value => { Object.assign(contribution(value), { unboostedScience: 0, bonusScience: 0 }); value.produced = {}; }],
  ]);
});

void test('raw output and atomic payment or staffing mutations cannot claim an earned bonus', () => {
  rejects([
    ['bonus arithmetic', value => { contribution(value).bonusScience = 0.76; value.produced.science = 3.77; }],
    ['base arithmetic', value => { contribution(value).unboostedScience = 3.03; }],
    ['output sum', value => { value.produced.science = 3.75; }],
    ['unquantized output', value => { value.produced.science = 3.761; }],
    ['missing output', value => { value.produced = {}; }],
    ['bonus as a different resource', value => { value.produced = { culture: 3.76 }; }],
    ['extra non-Science output', value => { value.produced.culture = 1; }],
    ['zero-valued alien output', value => { value.produced.food = 0; }],
    ['no payment', value => { value.paid = {}; }],
    ['partial payment', value => { value.paid.credits = 0.99; }],
    ['double payment', value => { value.paid.credits = 2; }],
    ['extra payment', value => { value.paid.culture = 2; }],
    ['blocked recipe', value => { value.status = 'blocked'; }],
    ['paused recipe', value => { value.status = 'paused'; }],
    ['unpaid shortage', value => { value.shortages = [{ resource: 'credits', required: 1, available: 0 }]; }],
    ['sparse shortages', value => { value.shortages = new Array(1); }],
    ['extra shortage property', value => { raw(value.shortages).hidden = true; }],
    ['missing resident proof', value => { delete value.residents; }],
    ['resident version', value => { raw(value.residents!).ruleVersion = 2; }],
    ['resident reserve', value => { value.residents!.communityReserve = 0; }],
    ['resident requirement', value => { value.residents!.required = 1; value.residents!.allocated = 1; }],
    ['unallocated residents', value => { value.residents!.allocated = 0; }],
    ['partial staffing', value => { value.residents!.allocated = 2; }],
    ['unavailable residents', value => { value.residents!.available = 2; }],
    ['invented resident capacity', value => { value.residents!.available = 7; }],
    ['fractional population', value => { value.residents!.openingPopulation = 9.5; }],
    ['extra resident field', value => { raw(value.residents!).policyWorkers = 3; }],
  ]);
});

void test('receipt eligibility excludes other Science paths and requires released paid resident work', () => {
  for (const buildingId of ['campus', 'research-lab', 'observatory', 'great-library', 'teaching-grant', 'passive', 'raw-stock', 'unknown'])
    assert.equal(validInstitutionalScienceOperation(operation(), buildingId, features), false, buildingId);
  for (const feature of ['learning-patronage', 'civic-bootstrap', 'building-operations', 'resident-capacity', 'district-planning', 'writing'])
    assert.equal(validInstitutionalScienceOperation(operation(), 'library', features.filter(id => id !== feature)), false, feature);
  const academy = operation('academy'); academy.paid = { credits: 1 };
  assert.equal(validInstitutionalScienceOperation(academy, 'academy', features), false, 'House of learning must also pay Culture');
});

void test('historical receipt shape does not assert world feature authority', () => {
  for (const buildingId of ['library', 'academy', 'university']) {
    const value = operation(buildingId);
    assert.equal(validInstitutionalScienceReceipt(value, buildingId), true, 'Standalone historical arithmetic needs no invented current-world context');
    assert.equal(validInstitutionalScienceOperation(value, buildingId, features), true);
    assert.equal(validInstitutionalScienceOperation(value, buildingId, []), false, 'A valid receipt shape cannot authorize unreleased world features');
    for (const feature of ['learning-patronage', 'civic-bootstrap', 'building-operations', 'resident-capacity'])
      assert.equal(validInstitutionalScienceOperation(value, buildingId, features.filter(id => id !== feature)), false, feature);
    contribution(value).bonusScience += 1;
    assert.equal(validInstitutionalScienceReceipt(value, buildingId), false);
    assert.equal(validInstitutionalScienceOperation(value, buildingId, features), false);
  }
  assert.equal(validInstitutionalScienceReceipt(operation(), 'observatory'), false, 'Standalone proof cannot expand recipe eligibility');
});

void test('economic-priority exclusivity is independent of the economic or wildcard slot position', () => {
  assert.equal(validPolicyExclusivity([]), true);
  for (const id of ['learning-patronage', 'urban-planning']) for (const slot of ['economic', 'wildcard'] as const)
    assert.equal(validPolicyExclusivity([assignment(id, slot)]), true);
  for (const [economic, wildcard] of [['learning-patronage', 'urban-planning'], ['urban-planning', 'learning-patronage'], ['learning-patronage', 'learning-patronage']])
    assert.equal(validPolicyExclusivity([assignment(economic!), assignment(wildcard!, 'wildcard')]), false);
  for (const value of [null, {}, [null], [assignment('unknown')], new Array(1)]) assert.equal(validPolicyExclusivity(value), false);
  const extra = [assignment('learning-patronage')]; raw(extra).hidden = assignment('urban-planning');
  assert.equal(validPolicyExclusivity(extra), false);
});

function prepared(): WorldState {
  const state = createWorld(1701, epoch, 'settlement-learning-patronage-1');
  const actor = state.civilizations[0]!; const city = state.cities[0]!;
  actor.era = 1; actor.resources = { food: 1000, materials: 100, credits: 100, energy: 30, culture: 100, science: 0 };
  city.population = 6; city.wellbeing = 50; city.infrastructure = 0; city.damage = 0;
  state.calendarMilestones = ['first-harvest', 'roads-between-peoples', 'rise-of-states'];
  syntheticTechnologies(state, 0, ['civic-institutions']); syntheticInstitution(state, city.id, 'academy');
  state.revision = 1;
  actor.civics = {
    ruleVersion: 1, completedCivicIds: ['code-of-laws', 'craftsmanship', 'foreign-trade', 'early-empire', 'state-workforce', 'political-philosophy'], active: null,
    lastCompleted: { civicId: 'political-philosophy', completedRound: 0, eventId: '1:0' },
    reformEntitlement: { civicId: 'political-philosophy', completedRound: 0, completionEventId: '1:0' },
  };
  state.events.push({ id: '1:0', round: 0, type: 'civic-completed', title: 'Synthetic completed prerequisite', detail: 'Conditional fixture only', actor: 0, target: 0, tileId: null, cause: 'Explicit synthetic civic prerequisites; subsequent arrangements and operations use the actual engine', effects: ['Completed civic political-philosophy'], importance: 4 });
  state.eventCounts['civic-completed'] = 1;
  assert.equal(isWorldState(state), true, 'Fresh current-release conditional fixture is fully valid');
  return state;
}

function act(state: WorldState, seconds: number, action: GameAction): WorldState {
  const before = structuredClone(state); const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: at(seconds), action });
  assert.equal(result.ok, true, result.error); assert.deepEqual(state, before); assert.equal(isWorldState(result.state), true);
  return result.state;
}

function beat(state: WorldState, seconds: number): WorldState {
  const before = structuredClone(state); const result = catchUpStrategy(state, at(seconds));
  assert.equal(result.ok, true, result.error); assert.deepEqual(state, before); assert.equal(isWorldState(result.state), true);
  return result.state;
}

function academyResult(state: WorldState): BuildingOperationResult {
  const value = state.cities[0]!.buildingOperations?.academy?.lastResult; assert.ok(value); return value;
}

void test('current engine receipts remain historical after legal reslot, transition completion and exact restart', async () => {
  const initial = prepared();
  let state = act(initial, 10, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [assignment('learning-patronage')] });
  const first = beat(state, 60);
  assert.deepEqual(contribution(academyResult(first)), { policyId: 'learning-patronage', percent: 25, unboostedScience: 3, bonusScience: 0.75 });
  assert.deepEqual(academyResult(first).paid, { culture: 2, credits: 1 }); assert.equal(academyResult(first).produced.science, 3.75);
  state = first;
  for (const seconds of [120, 180, 240]) state = beat(state, seconds);
  const earned = structuredClone(academyResult(state));
  const reslotted = act(state, 250, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [assignment('urban-planning')] });
  assert.deepEqual(academyResult(reslotted), earned);
  assert.equal(reslotted.civilizations[0]!.resources.credits, Math.round((state.civilizations[0]!.resources.credits - 8) * 100) / 100);
  const paused = act(reslotted, 260, { type: 'set-building-operation', cityId: 'city-0', buildingId: 'academy', enabled: false });
  assert.deepEqual(academyResult(paused), earned, 'A later pause also leaves the past earned receipt factual');
  const pending = act(state, 250, { type: 'adopt-government', governmentId: 'autocracy', assignments: [assignment('urban-planning', 'wildcard')] });
  assert.equal(pending.civilizations[0]!.resources.credits, Math.round((state.civilizations[0]!.resources.credits - 10) * 100) / 100);
  const firstTransition = beat(pending, 300); const completed = beat(firstTransition, 360);
  assert.equal(completed.civilizations[0]!.government!.active!.governmentId, 'autocracy');
  assert.equal(completed.civilizations[0]!.government!.active!.assignments[0]!.policyId, 'urban-planning');
  assert.ok(contribution(academyResult(completed)).bonusScience > 0, 'The last old-arrangement transition beat earned its bonus before the target became active');
  for (const frame of [first, state, reslotted, paused, pending, firstTransition, completed]) {
    const decoded = await decodeHistorySnapshot(JSON.stringify(frame)); assert.deepEqual(decoded, frame);
    const next = (frame.round + 1) * 60;
    assert.deepEqual(catchUpStrategy(decoded, at(next)), catchUpStrategy(frame, at(next)), 'Current-version restart preserves exact following operation, balances and receipts');
  }
  assert.equal(academyResult(beat(completed, 420)).policyContribution, undefined, 'New opening under Urban planning earns no learning bonus');
});

void test('world validation rejects forged latest contributions and simultaneous active or pending groups', async () => {
  let state = act(prepared(), 10, { type: 'adopt-government', governmentId: 'autocracy', assignments: [assignment('learning-patronage', 'wildcard')] });
  for (const seconds of [60, 120, 180, 240]) state = beat(state, seconds);
  const mutations: Array<[string, (copy: WorldState) => void]> = [
    ['forged bonus', copy => { contribution(academyResult(copy)).bonusScience += 1; }],
    ['missing payment', copy => { academyResult(copy).paid = {}; }],
    ['unstaffed bonus', copy => { academyResult(copy).residents!.allocated = 0; }],
    ['economic alongside wildcard', copy => { copy.civilizations[0]!.government!.active!.assignments.unshift(assignment('urban-planning')); }],
  ];
  for (const [label, mutate] of mutations) {
    const copy = structuredClone(state); mutate(copy); assert.equal(isWorldState(copy), false, label);
    await assert.rejects(decodeHistorySnapshot(JSON.stringify(copy)), /corrupt_or_incompatible_world/, label);
  }
  const pending = act(state, 250, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [assignment('learning-patronage')] });
  const reverse = structuredClone(pending);
  reverse.civilizations[0]!.government!.active!.governmentId = 'chiefdom';
  reverse.civilizations[0]!.government!.active!.assignments = [assignment('learning-patronage')];
  reverse.civilizations[0]!.government!.pending!.targetGovernmentId = 'autocracy';
  reverse.civilizations[0]!.government!.pending!.targetAssignments = [assignment('learning-patronage', 'wildcard')];
  assert.equal(isWorldState(reverse), true, 'The independent single-priority pending control is otherwise valid');
  reverse.civilizations[0]!.government!.pending!.targetAssignments = [assignment('urban-planning'), assignment('learning-patronage', 'wildcard')];
  assert.equal(isWorldState(reverse), false, 'Pending targets cannot bypass exclusivity');
});
