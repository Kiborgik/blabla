import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { FOOD_BUDGET_BEHAVIOR_POLICY_VERSION, behaviorPolicyVersion, createBehaviorMemory } from '../core/behaviors.ts';
import { ACTIVE_LOCAL_RELEASE_ID, ACTIVE_LOCAL_POLICY_VERSION, LOCAL_SIMULATION_STORAGE_KEY, createLocalSimulation, advanceLocalSimulation, parseLocalSimulation, parseActiveLocalSimulation } from '../web/local-simulation.ts';
import { processLocalSimulationRequest } from '../web/local-simulation-worker.ts';

void test('fresh current genesis retains current temperament policy with version-two checkpoint and memory envelopes', () => {
  const fresh = createLocalSimulation(1701);
  assert.equal(fresh.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.match(LOCAL_SIMULATION_STORAGE_KEY, /^civitas:procedural-observatory:/);
  assert.equal(fresh.version, 2);
  assert.equal(fresh.policyVersion, ACTIVE_LOCAL_POLICY_VERSION);
  assert.equal(behaviorPolicyVersion(fresh.state), fresh.policyVersion);
  assert.equal(fresh.state.origin?.initialReleaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.equal(fresh.state.origin?.namingVersion, 'cultural-toponyms-v1');
  assert.ok(fresh.state.unlockedFeatures.includes('food-budget'));
  assert.ok(fresh.state.unlockedFeatures.includes('knowledge-compacts'));
  assert.equal(fresh.state.origin?.temperamentVersion, 'strategic-temperaments-v1');
  assert.equal(createBehaviorMemory(fresh.state, 0).version, 2);
  assert.equal(createBehaviorMemory(fresh.state, 0).policyVersion, fresh.policyVersion);
  assert.deepEqual(parseActiveLocalSimulation(JSON.parse(JSON.stringify(fresh))), fresh);
});

void test('world checkpoint and every civilization or Director memory must agree on the original policy', () => {
  const run = createLocalSimulation(1701);
  const expected = ACTIVE_LOCAL_POLICY_VERSION;
  const other = FOOD_BUDGET_BEHAVIOR_POLICY_VERSION;
  run.memories = run.memories.map((_, seat) => createBehaviorMemory(run.state, seat));
  assert.equal(run.policyVersion, expected);
  assert.ok(parseLocalSimulation(run));
  for (let seat = 0; seat < run.memories.length; seat += 1) {
    const mismatched = structuredClone(run);
    mismatched.memories[seat]!.policyVersion = other;
    const bytes = JSON.stringify(mismatched);
    assert.equal(parseLocalSimulation(mismatched), null);
    assert.equal(parseActiveLocalSimulation(mismatched), null);
    assert.equal(processLocalSimulationRequest({ id: seat, run: mismatched, steps: 1 }).ok, false);
    assert.throws(() => advanceLocalSimulation(mismatched), /incompatible|corrupt/);
    assert.equal(JSON.stringify(mismatched), bytes);
  }
  assert.equal(parseLocalSimulation({ ...run, policyVersion: other }), null);
  const bothWrong = structuredClone(run);
  bothWrong.policyVersion = other;
  bothWrong.memories.forEach(memory => { if (memory) memory.policyVersion = other; });
  assert.equal(parseLocalSimulation(bothWrong), null);
});

void test('active parser and Worker refuse a checkpoint with a mismatched genesis identity', () => {
  const fresh = createLocalSimulation();
  const mismatched = structuredClone(fresh);
  mismatched.state.origin!.initialReleaseId = 'settlement-regional-targets-1';
  const bytes = JSON.stringify(mismatched);
  assert.equal(parseActiveLocalSimulation(mismatched), null);
  assert.equal(processLocalSimulationRequest({ id: 1, run: mismatched, steps: 1 }).ok, false);
  assert.equal(JSON.stringify(mismatched), bytes);
});

void test('current advancement and JSON restart agree with the Worker without changing input or policy', () => {
  const initial = createLocalSimulation(1701);
  const bytes = JSON.stringify(initial);
  const first = advanceLocalSimulation(initial, 2);
  const restored = parseActiveLocalSimulation(JSON.parse(JSON.stringify(first)));
  assert.ok(restored);
  const continuation = advanceLocalSimulation(restored, 2);
  assert.deepEqual(continuation, advanceLocalSimulation(initial, 4));
  const response = processLocalSimulationRequest({ id: 4, run: restored, steps: 2 });
  assert.ok(response.ok);
  assert.deepEqual(response.run, continuation);
  assert.ok(continuation.memories.every(memory => memory?.policyVersion === ACTIVE_LOCAL_POLICY_VERSION));
  assert.equal(JSON.stringify(initial), bytes);
  assert.equal(continuation.state.origin?.initialReleaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.equal(continuation.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
});

void test('terminal current checkpoints remain exact under bounded direct and Worker advancement', () => {
  const terminal = createLocalSimulation();
  terminal.state.outcome = { kind: 'cultural', winners: [0], round: terminal.state.round, reason: 'Terminal checkpoint fixture' };
  const bytes = JSON.stringify(terminal);
  assert.ok(parseActiveLocalSimulation(terminal));
  assert.equal(JSON.stringify(advanceLocalSimulation(terminal, 60)), bytes);
  const reply = processLocalSimulationRequest({ id: 9, run: JSON.parse(bytes), steps: 2 });
  assert.ok(reply.ok);
  assert.equal(JSON.stringify(reply.run), bytes);
  assert.equal(JSON.stringify(terminal), bytes);
});

void test('current observation resets captured cards across world identity and body changes', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  assert.match(main, /worldViewKey\(\{ source: worldSource, identity: snapshot\?\.identity \?\? '', body: worldBody \}\)/);
  const observe = main.slice(main.indexOf('function observeWorldIdentity'), main.indexOf('function renderInspection'));
  assert.match(observe, /if \(!view\.changed\) return;[\s\S]*clearObservedHistory\(\)/);
  const reset = main.slice(main.indexOf('function clearObservedHistory'), main.indexOf('function observeWorldIdentity'));
  assert.match(reset, /eventHistoryCaptured = false/);
  assert.match(reset, /journeyRevision = -1/);
  assert.match(reset, /observedRouteResults = \[\]/);
  const switchBody = main.slice(main.indexOf('function changeWorldSource'), main.indexOf('let reading = false'));
  assert.match(switchBody, /clearObservedHistory\(\)/);
  assert.match(main, /eventCues\.observe\(\{ identity: observedWorldKey\(\)/);
  assert.match(main, /mode !== 'local'[^\n]*localSimulation\.state\.outcome/);
});
