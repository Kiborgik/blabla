import assert from 'node:assert/strict';
import { test } from 'node:test';
import { behaviorDrawVersion, behaviorPolicyVersion, civilizationBehaviorProfile, FOOD_BUDGET_BEHAVIOR_POLICY_VERSION, FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION, TEMPERAMENT_BEHAVIOR_POLICY_VERSION } from '../core/behavior-profiles.ts';
import { chooseDirectorBehavior, createBehaviorMemory } from '../core/behaviors.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { isWorldState } from '../core/validation.ts';
import { ACTIVE_LOCAL_POLICY_VERSION, ACTIVE_LOCAL_RELEASE_ID, LOCAL_SIMULATION_STORAGE_KEY, advanceLocalSimulation, createLocalSimulation, parseLocalSimulation } from '../web/local-simulation.ts';
import { processLocalSimulationRequest } from '../web/local-simulation-worker.ts';

const epoch = '2000-01-01T00:00:00.000Z';

void test('fresh funded landwork genesis names its rule and policy without losing current content', () => {
  const run = createLocalSimulation(73);
  assert.equal(ACTIVE_LOCAL_RELEASE_ID, 'settlement-funded-landwork-1');
  assert.equal(ACTIVE_LOCAL_POLICY_VERSION, FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION);
  assert.equal(LOCAL_SIMULATION_STORAGE_KEY, 'civitas:procedural-observatory:funded-landwork-v1');
  assert.equal(run.policyVersion, 'weighted-civilizations-v5-funded-landwork');
  assert.equal(run.state.origin?.initialReleaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.equal(run.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.ok(isWorldState(run.state));
  for (const feature of ['food-budget', 'shore-fisheries', 'knowledge-compacts', 'hillside-commonworks', 'supplied-borders', 'funded-landwork-planning']) assert.ok(run.state.unlockedFeatures.includes(feature), feature);
  assert.deepEqual(run.state.events.map(event => event.type), ['world-founded']);
  assert.deepEqual(parseLocalSimulation(JSON.parse(JSON.stringify(run))), run);
  assert.equal(run.state.round, 0);
  assert.equal(run.state.revision, 0);
});

void test('funded policy keeps the same seeded temperament and draw domains', () => {
  for (const seed of [0, 73, 1701]) for (let seat = 0; seat < 5; seat += 1) {
    assert.deepEqual(civilizationBehaviorProfile(seed, seat, FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION), civilizationBehaviorProfile(seed, seat, TEMPERAMENT_BEHAVIOR_POLICY_VERSION));
  }
  assert.equal(behaviorDrawVersion(FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION), FOOD_BUDGET_BEHAVIOR_POLICY_VERSION);
  assert.equal(behaviorDrawVersion(TEMPERAMENT_BEHAVIOR_POLICY_VERSION), FOOD_BUDGET_BEHAVIOR_POLICY_VERSION);
  const current = createLocalSimulation(73).state;
  const prior = createGeneratedWorld(73, epoch, 'settlement-supplied-borders-1', 'cultural-toponyms-v1', 'strategic-temperaments-v1');
  const currentDecision = chooseDirectorBehavior(current, createBehaviorMemory(current, 5), epoch);
  const priorDecision = chooseDirectorBehavior(prior, createBehaviorMemory(prior, 5), epoch);
  assert.deepEqual(currentDecision.action, priorDecision.action);
  assert.equal(currentDecision.memory.decisionCount, priorDecision.memory.decisionCount);
});

void test('current worker and serialized restart preserve exact funded policy continuation', () => {
  const initial = createLocalSimulation(73);
  const before = JSON.stringify(initial);
  const prefix = advanceLocalSimulation(initial, 2);
  const restored = parseLocalSimulation(JSON.parse(JSON.stringify(prefix)));
  assert.ok(restored);
  const continuation = advanceLocalSimulation(restored, 2);
  assert.deepEqual(continuation, advanceLocalSimulation(initial, 4));
  const reply = processLocalSimulationRequest({ id: 56, run: restored, steps: 2 });
  assert.ok(reply.ok);
  assert.deepEqual(reply.run, continuation);
  assert.ok(continuation.memories.every(memory => memory?.policyVersion === ACTIVE_LOCAL_POLICY_VERSION));
  assert.equal(behaviorPolicyVersion(continuation.state), ACTIVE_LOCAL_POLICY_VERSION);
  assert.equal(JSON.stringify(initial), before);
});

void test('current checkpoints reject a mismatched policy or missing funded rule without rewriting input', () => {
  const initial = createLocalSimulation(73);
  initial.memories = initial.memories.map((_, seat) => createBehaviorMemory(initial.state, seat));
  for (const field of ['envelope', 'memory', 'feature', 'origin'] as const) {
    const invalid = structuredClone(initial);
    if (field === 'envelope') invalid.policyVersion = TEMPERAMENT_BEHAVIOR_POLICY_VERSION;
    if (field === 'memory') invalid.memories[0]!.policyVersion = TEMPERAMENT_BEHAVIOR_POLICY_VERSION;
    if (field === 'feature') invalid.state.unlockedFeatures = invalid.state.unlockedFeatures.filter(feature => feature !== 'funded-landwork-planning');
    if (field === 'origin') invalid.state.origin!.initialReleaseId = 'settlement-supplied-borders-1';
    const before = JSON.stringify(invalid);
    assert.equal(parseLocalSimulation(invalid), null, field);
    assert.equal(processLocalSimulationRequest({ id: 57, run: invalid, steps: 1 }).ok, false, field);
    assert.equal(JSON.stringify(invalid), before, field);
  }
});
