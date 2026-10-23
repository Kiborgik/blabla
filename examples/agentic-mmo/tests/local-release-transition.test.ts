import assert from 'node:assert/strict';
import test from 'node:test';
import { FOOD_BUDGET_BEHAVIOR_POLICY_VERSION, TEMPERAMENT_BEHAVIOR_POLICY_VERSION, behaviorPolicyVersion } from '../core/behaviors.ts';
import { applyHistoryAdvance, applyRelease } from '../core/engine.ts';
import type { WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { SHORE_LOCAL_RELEASE_ID, transitionLocalRelease, type LocalReleaseSource } from '../web/local-release-transition.ts';
import { ACTIVE_LOCAL_RELEASE_ID, LOCAL_SIMULATION_STORAGE_KEY, advanceLocalSimulation, createFreshLocalSimulation, createLocalSimulation, localSimulationSnapshot, parseLocalSimulation, type LocalSimulation } from '../web/local-simulation.ts';

function freeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}

function populated(temperaments: boolean): LocalSimulation {
  const run = advanceLocalSimulation(temperaments ? createFreshLocalSimulation(1701) : createLocalSimulation(1701), 3);
  const history = applyHistoryAdvance(run.state, {
    expectedRevision: run.state.revision, cause: { kind: 'feature', id: 'food-budget' },
    reason: 'Retained explicit history fixture', deltaYears: 0, timestamp: run.timestamp,
  });
  assert.ok(history.ok, history.error);
  run.state = history.state;
  assert.ok(parseLocalSimulation(run));
  assert.ok(run.memories.every(memory => memory !== null && memory.decisionCount > 0));
  assert.ok(run.decisions.length > 0);
  assert.ok(run.state.civilizations.some(actor => actor.researchTarget !== null)
    || run.state.cities.some(city => city.construction?.active));
  return run;
}

function canonicalShore(run: LocalSimulation): LocalSimulation {
  const result = applyRelease(run.state, {
    expectedRevision: run.state.revision, expectedFromReleaseId: 'settlement-food-budget-1',
    targetReleaseId: SHORE_LOCAL_RELEASE_ID, timestamp: run.timestamp,
  });
  assert.ok(result.ok, result.error);
  return { ...structuredClone(run), state: result.state };
}

function unchangedWorld(state: WorldState): Omit<WorldState, 'revision' | 'releaseId' | 'unlockedFeatures' | 'eventCounts' | 'events'> {
  const { revision, releaseId, unlockedFeatures, eventCounts, events, ...unchanged } = state;
  void revision; void releaseId; void unlockedFeatures; void eventCounts; void events;
  return unchanged;
}

void test('fresh genesis and ordinary parsing remain Food under the existing local storage identity', () => {
  assert.equal(ACTIVE_LOCAL_RELEASE_ID, 'settlement-food-budget-1');
  assert.equal(LOCAL_SIMULATION_STORAGE_KEY, 'civitas:procedural-observatory:food-budget-v1');
  for (const run of [createLocalSimulation(1701), createFreshLocalSimulation(1701)]) {
    assert.equal(run.state.releaseId, 'settlement-food-budget-1');
    assert.equal(run.state.origin?.initialReleaseId, 'settlement-food-budget-1');
    assert.equal(run.state.unlockedFeatures.includes('shore-fisheries'), false);
    assert.deepEqual(parseLocalSimulation(JSON.parse(JSON.stringify(run))), run);
  }
});

for (const temperaments of [false, true]) {
  const policy = temperaments ? TEMPERAMENT_BEHAVIOR_POLICY_VERSION : FOOD_BUDGET_BEHAVIOR_POLICY_VERSION;
  void test(`${policy} keeps populated controller memory, paid commitments and original genesis through one pure release`, () => {
    const run = populated(temperaments);
    const before = structuredClone(run);
    const bytes = JSON.stringify(run);
    const identity = localSimulationSnapshot(run).identity;
    freeze(run);
    const result = transitionLocalRelease(run, 'active-local');
    assert.equal(result.status, 'changed');
    assert.notEqual(result.run, run);
    assert.notEqual(result.run.state, run.state);
    assert.equal(JSON.stringify(run), bytes);
    assert.deepEqual(result.run, canonicalShore(before));
    assert.deepEqual({ ...result.run, state: before.state }, before);
    assert.deepEqual(unchangedWorld(result.run.state), unchangedWorld(before.state));
    assert.deepEqual(result.run.state.origin, before.state.origin);
    assert.equal(result.run.policyVersion, policy);
    assert.deepEqual(result.run.memories, before.memories);
    assert.deepEqual(result.run.decisions, before.decisions);
    assert.equal(result.run.steps, before.steps);
    assert.equal(result.run.timestamp, before.timestamp);
    assert.equal(localSimulationSnapshot(result.run).identity, identity);
    assert.equal(result.run.state.revision, before.state.revision + 1);
    assert.equal(result.run.state.releaseId, SHORE_LOCAL_RELEASE_ID);
    assert.deepEqual(result.run.state.unlockedFeatures, [...before.state.unlockedFeatures, 'shore-fisheries']);
    assert.deepEqual(result.run.state.events.slice(0, -1), before.state.events);
    assert.deepEqual(result.run.state.events.at(-1), {
      id: `${before.state.revision + 1}:0`, round: before.state.round, type: 'release-applied',
      title: 'The world gains released capabilities', detail: `settlement-food-budget-1 → ${SHORE_LOCAL_RELEASE_ID}`,
      actor: 5, target: null, tileId: null,
      cause: `Registered compatible successor ${SHORE_LOCAL_RELEASE_ID} explicitly applied to settlement-food-budget-1`,
      effects: ['Released capabilities added: shore-fisheries', 'Existing world assets, history and clock accounting are preserved'], importance: 5,
    });
    assert.deepEqual(result.run.state.eventCounts, { ...before.state.eventCounts, 'release-applied': (before.state.eventCounts['release-applied'] ?? 0) + 1 });
    assert.ok(isWorldState(result.run.state));
    assert.deepEqual(parseLocalSimulation(JSON.parse(JSON.stringify(result.run))), result.run);
    assert.deepEqual(transitionLocalRelease(run, 'active-local'), result);
    freeze(result.run);
    const duplicate = transitionLocalRelease(result.run, 'active-local');
    assert.deepEqual(duplicate, { status: 'noop', reason: 'already-current', run: result.run });
    assert.equal(duplicate.run, result.run);
    assert.equal(duplicate.run.state.revision, before.state.revision + 1);
  });
}

void test('valid terminal Food and shore worlds are exact noops without releasing or advancing anything', () => {
  for (const run of [createLocalSimulation(1701), canonicalShore(createFreshLocalSimulation(1701))]) {
    run.state.outcome = { kind: 'federation', winners: [0, 1, 2], round: run.state.round, reason: 'Synthetic terminal preservation fixture' };
    assert.ok(parseLocalSimulation(run));
    const before = JSON.stringify(run);
    freeze(run);
    const result = transitionLocalRelease(run, 'active-local');
    assert.deepEqual(result, { status: 'noop', reason: 'terminal', run });
    assert.equal(result.run, run);
    assert.equal(JSON.stringify(run), before);
  }
});

void test('a full retained event window uses canonical append and eviction while preserving every surviving event byte', () => {
  const run = createFreshLocalSimulation(1701);
  const founded = run.state.events[0]!;
  run.state.revision = 95;
  run.state.events = [founded, ...Array.from({ length: 95 }, (_, index) => ({
    id: `${index + 1}:0`, round: 0, type: 'fixture-record', title: 'Retained history fixture',
    detail: `Existing record ${index + 1}`, actor: null, target: null, tileId: null,
    cause: 'Synthetic full retention-window fixture', effects: ['No world change'], importance: 1,
  }))];
  run.state.eventCounts['fixture-record'] = 95;
  assert.ok(parseLocalSimulation(run));
  const before = structuredClone(run);
  freeze(run);
  const result = transitionLocalRelease(run, 'active-local');
  assert.equal(result.status, 'changed');
  assert.equal(result.run.state.events.length, 96);
  assert.deepEqual(result.run.state.events.slice(0, -1), before.state.events.slice(1));
  assert.equal(result.run.state.events.at(-1)?.type, 'release-applied');
  assert.equal(result.run.state.events.at(-1)?.id, '96:0');
  assert.equal(result.run.state.eventCounts['world-founded'], 1);
  assert.equal(result.run.state.eventCounts['fixture-record'], 95);
  assert.equal(result.run.state.eventCounts['release-applied'], 1);
  assert.deepEqual(result.run, canonicalShore(before));
  assert.deepEqual(run, before);
});

void test('historical, shared, hosted, native and unknown callers cannot activate a local-looking save', () => {
  const run = createFreshLocalSimulation(1701);
  const before = JSON.stringify(run);
  freeze(run);
  for (const source of ['historical-local', 'shared', 'hosted', 'native', 'local', undefined] as const) {
    const result = transitionLocalRelease(run, source as LocalReleaseSource);
    assert.deepEqual(result, { status: 'refused', reason: 'inactive-source', run });
    assert.equal(result.run, run);
    assert.equal(JSON.stringify(run), before);
  }
});

void test('only the explicitly approved shore target is accepted, never latest or a different catalogue release', () => {
  const run = createFreshLocalSimulation(1701);
  const before = JSON.stringify(run);
  freeze(run);
  for (const target of ['unknown-future-release', 'latest', '', 'settlement-food-budget-1', 'settlement-living-partnerships-1']) {
    const result = transitionLocalRelease(run, 'active-local', target);
    assert.deepEqual(result, { status: 'refused', reason: 'unknown-target', run });
    assert.equal(result.run, run);
    assert.equal(JSON.stringify(run), before);
  }
});

void test('corrupt envelopes, memories, world data and policy mismatches refuse without repairing the input', () => {
  const valid = populated(true);
  const mutations: Array<[string, (run: LocalSimulation) => void]> = [
    ['envelope version', run => { Reflect.set(run, 'version', 1); }],
    ['envelope source', run => { Reflect.set(run, 'source', 'shared'); }],
    ['policy mismatch', run => { run.policyVersion = FOOD_BUDGET_BEHAVIOR_POLICY_VERSION; }],
    ['memory policy mismatch', run => { run.memories[0]!.policyVersion = FOOD_BUDGET_BEHAVIOR_POLICY_VERSION; }],
    ['memory seed mismatch', run => { run.memories[0]!.seed += 1; }],
    ['memory count corruption', run => { run.memories[0]!.decisionCount = run.steps + 1; }],
    ['decision revision corruption', run => { run.decisions[0]!.revision = run.state.revision + 1; }],
    ['world seed mismatch', run => { run.seed += 1; }],
    ['clock corruption', run => { run.timestamp = 'not-a-date'; }],
    ['world revision corruption', run => { run.state.revision = -1; }],
    ['missing registered feature', run => { run.state.unlockedFeatures = run.state.unlockedFeatures.filter(feature => feature !== 'history-advancement'); }],
    ['shore label without features', run => { run.state.releaseId = SHORE_LOCAL_RELEASE_ID; }],
    ['shore features under Food label', run => { run.state.unlockedFeatures.push('shore-fisheries'); }],
    ['unknown origin', run => { Reflect.set(run.state.origin!, 'initialReleaseId', 'unknown-genesis'); }],
  ];
  for (const [name, mutate] of mutations) {
    const run = structuredClone(valid);
    mutate(run);
    const before = JSON.stringify(run);
    freeze(run);
    const result = transitionLocalRelease(run, 'active-local');
    assert.equal(result.status, 'refused', name);
    assert.equal(result.run, run, name);
    assert.equal(JSON.stringify(run), before, name);
  }
});

void test('terminal and already-shore labels cannot bypass source, target, policy or feature validation', () => {
  const shore = canonicalShore(createFreshLocalSimulation(1701));
  shore.state.outcome = { kind: 'economic', winners: [0], round: 0, reason: 'Synthetic terminal validation fixture' };
  assert.ok(parseLocalSimulation(shore));
  const cases = [
    { run: shore, source: 'shared' as LocalReleaseSource, target: SHORE_LOCAL_RELEASE_ID, reason: 'inactive-source' },
    { run: shore, source: 'active-local' as LocalReleaseSource, target: 'unknown', reason: 'unknown-target' },
    { run: { ...shore, policyVersion: 'unknown-policy' }, source: 'active-local' as LocalReleaseSource, target: SHORE_LOCAL_RELEASE_ID, reason: 'invalid-run' },
    { run: { ...shore, state: { ...shore.state, unlockedFeatures: shore.state.unlockedFeatures.filter(feature => feature !== 'shore-fisheries') } }, source: 'active-local' as LocalReleaseSource, target: SHORE_LOCAL_RELEASE_ID, reason: 'invalid-run' },
  ];
  for (const fixture of cases) {
    const before = JSON.stringify(fixture.run);
    freeze(fixture.run);
    const result = transitionLocalRelease(fixture.run, fixture.source, fixture.target);
    assert.deepEqual(result, { status: 'refused', reason: fixture.reason, run: fixture.run });
    assert.equal(result.run, fixture.run);
    assert.equal(JSON.stringify(fixture.run), before);
  }
});

void test('older local genesis is never upgraded even after a canonical earlier release reaches Food', () => {
  for (const release of ['settlement-interplanetary-1', 'settlement-living-partnerships-1', 'settlement-relief-charters-1', 'settlement-regional-targets-1'] as const) {
    const run = createLocalSimulation(1701, release);
    assert.ok(parseLocalSimulation(run));
    const before = JSON.stringify(run);
    freeze(run);
    const result = transitionLocalRelease(run, 'active-local');
    assert.deepEqual(result, { status: 'refused', reason: 'incompatible-origin', run });
    assert.equal(result.run, run);
    assert.equal(JSON.stringify(run), before);
  }
  const older = createLocalSimulation(1701, 'settlement-regional-targets-1');
  const applied = applyRelease(older.state, { expectedRevision: older.state.revision, expectedFromReleaseId: older.state.releaseId, targetReleaseId: 'settlement-food-budget-1', timestamp: older.timestamp });
  assert.ok(applied.ok, applied.error);
  older.state = applied.state;
  older.policyVersion = behaviorPolicyVersion(older.state);
  assert.ok(parseLocalSimulation(older));
  const before = JSON.stringify(older);
  freeze(older);
  assert.deepEqual(transitionLocalRelease(older, 'active-local'), { status: 'refused', reason: 'incompatible-origin', run: older });
  assert.equal(JSON.stringify(older), before);
});

void test('Food genesis cannot authorize an unknown current release or an overflowing revision', () => {
  const unknown = createFreshLocalSimulation(1701);
  unknown.state.releaseId = 'unknown-current-release';
  const overflow = createFreshLocalSimulation(1701);
  overflow.state.revision = Number.MAX_SAFE_INTEGER;
  for (const run of [unknown, overflow]) {
    const before = JSON.stringify(run);
    freeze(run);
    const result = transitionLocalRelease(run, 'active-local');
    assert.equal(result.status, 'refused');
    assert.equal(result.run, run);
    assert.equal(JSON.stringify(run), before);
    if (result.status !== 'refused') throw new Error('Expected release refusal');
    assert.equal(result.reason, run === unknown ? 'incompatible-release' : 'release-refused');
    if (run === overflow) assert.match(result.error ?? '', /current revision/);
  }
});

void test('an invalid canonical result is refused rather than returned for persistence', () => {
  const run = createFreshLocalSimulation(1701);
  run.state.eventCounts['release-applied'] = Number.MAX_SAFE_INTEGER;
  assert.ok(parseLocalSimulation(run));
  const before = JSON.stringify(run);
  freeze(run);
  const result = transitionLocalRelease(run, 'active-local');
  assert.equal(result.status, 'refused');
  if (result.status !== 'refused') throw new Error('Expected invalid-result refusal');
  assert.equal(result.reason, 'release-refused');
  assert.match(result.error ?? '', /valid local/);
  assert.equal(result.run, run);
  assert.equal(JSON.stringify(run), before);
});
