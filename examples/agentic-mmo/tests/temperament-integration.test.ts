import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { civilizationBehaviorProfile, FOOD_BUDGET_BEHAVIOR_POLICY_VERSION, TEMPERAMENT_BEHAVIOR_POLICY_VERSION } from '../core/behavior-profiles.ts';
import { createBehaviorMemory } from '../core/behaviors.ts';
import { isWorldState } from '../core/validation.ts';
import type { StrategicTemperamentVersion } from '../core/types.ts';
import { createAutonomousState } from '../server/autonomous-runner.ts';
import { ACTIVE_LOCAL_RELEASE_ID, ACTIVE_LOCAL_POLICY_VERSION, LOCAL_SIMULATION_STORAGE_KEY, createLocalSimulation, createFreshLocalSimulation, advanceLocalSimulation, parseActiveLocalSimulation, localSimulationSnapshot } from '../web/local-simulation.ts';
import { createLocalWorldStorage } from '../web/local-world-storage.ts';
import { processLocalSimulationRequest } from '../web/local-simulation-worker.ts';

const epoch = '2000-01-01T00:00:00.000Z';

void test('explicit temperament genesis changes only its marker and allocated starting focus', () => {
  for (const seed of [0, 73, 1701, 0xffffffff]) {
    const prior = createGeneratedWorld(seed, epoch, ACTIVE_LOCAL_RELEASE_ID, 'cultural-toponyms-v1');
    const fresh = createFreshLocalSimulation(seed);
    assert.equal(prior.origin?.temperamentVersion, undefined);
    assert.equal(fresh.policyVersion, ACTIVE_LOCAL_POLICY_VERSION);
    assert.equal(fresh.state.origin?.temperamentVersion, 'strategic-temperaments-v1');
    assert.ok(isWorldState(fresh.state));
    const comparable = structuredClone(fresh.state);
    delete comparable.origin!.temperamentVersion;
    for (const city of comparable.cities) {
      assert.equal(city.focus, civilizationBehaviorProfile(seed, city.civId, TEMPERAMENT_BEHAVIOR_POLICY_VERSION).preferredFocus);
      city.focus = prior.cities.find(candidate => candidate.id === city.id)!.focus;
    }
    assert.deepEqual(comparable, prior);
    assert.equal(localSimulationSnapshot(fresh).identity, `local:coherent-geography-v1:${seed}:${epoch}:${ACTIVE_LOCAL_RELEASE_ID}:cultural-toponyms-v1:strategic-temperaments-v1`);
  }
});

void test('unsupported temperament versions and non-Food genesis are refused explicitly', () => {
  assert.throws(() => createGeneratedWorld(73, epoch, 'settlement-regional-targets-1', undefined, 'strategic-temperaments-v1'), /Food-budget genesis/);
  assert.throws(() => createGeneratedWorld(73, epoch, ACTIVE_LOCAL_RELEASE_ID, undefined, 'unknown' as StrategicTemperamentVersion), /supported version/);
  for (const mutate of [
    (value: Record<string, unknown>) => { value.temperamentVersion = 'unknown'; },
    (value: Record<string, unknown>) => { value.temperamentVersion = undefined; },
    (value: Record<string, unknown>) => { value.initialReleaseId = 'settlement-regional-targets-1'; },
    (value: Record<string, unknown>) => { value.extra = 'not part of the origin'; },
  ]) {
    const run = createFreshLocalSimulation(73);
    mutate(run.state.origin! as unknown as Record<string, unknown>);
    assert.equal(isWorldState(run.state), false);
    assert.equal(parseActiveLocalSimulation(run), null);
  }
});

void test('current strategy checkpoints retain deterministic Worker continuation', () => {
  const initial = createFreshLocalSimulation(73);
  {
    const original = JSON.stringify(initial);
    const first = advanceLocalSimulation(initial, 2);
    const bytes = JSON.stringify(first);
    const restored = parseActiveLocalSimulation(JSON.parse(bytes));
    assert.ok(restored);
    assert.equal(JSON.stringify(restored), bytes);
    assert.deepEqual(advanceLocalSimulation(restored, 2), advanceLocalSimulation(initial, 4));
    const reply = processLocalSimulationRequest({ id: 11, run: restored, steps: 2 });
    assert.ok(reply.ok);
    assert.deepEqual(reply.run, advanceLocalSimulation(restored, 2));
    assert.equal(reply.run.policyVersion, initial.policyVersion);
    assert.ok(reply.run.memories.every(memory => memory?.policyVersion === initial.policyVersion));
    assert.equal(JSON.stringify(initial), original);
  }
});

void test('origin envelope and every memory bind the same policy and exact seeded profile', () => {
  const valid = createFreshLocalSimulation(73);
  valid.memories = valid.memories.map((_, seat) => createBehaviorMemory(valid.state, seat));
  assert.ok(parseActiveLocalSimulation(valid));
  const wrongEnvelope = { ...valid, policyVersion: FOOD_BUDGET_BEHAVIOR_POLICY_VERSION };
  assert.equal(parseActiveLocalSimulation(wrongEnvelope), null);
  for (let seat = 0; seat < valid.memories.length; seat += 1) {
    for (const field of ['policyVersion', 'profileId'] as const) {
      const bad = structuredClone(valid);
      if (field === 'policyVersion') bad.memories[seat]!.policyVersion = FOOD_BUDGET_BEHAVIOR_POLICY_VERSION;
      else bad.memories[seat]!.profileId = 'wrong-profile';
      const bytes = JSON.stringify(bad);
      assert.equal(parseActiveLocalSimulation(bad), null);
      assert.equal(processLocalSimulationRequest({ id: seat, run: bad, steps: 1 }).ok, false);
      assert.equal(JSON.stringify(bad), bytes);
    }
  }
  const removed = structuredClone(valid);
  delete removed.state.origin!.temperamentVersion;
  assert.equal(parseActiveLocalSimulation(removed), null);
});

void test('current storage chooses one seeded strategy under lock and resumes its exact checkpoint', async () => {
  for (const previous of [null, createLocalSimulation(73)]) {
    const bytes = previous ? ` \n${JSON.stringify(previous)}\n` : null;
    const records = new Map<string, string>(bytes ? [[LOCAL_SIMULATION_STORAGE_KEY, bytes]] : []);
    let draws = 0;
    let writes = 0;
    let locked = false;
    const storage = createLocalWorldStorage({ read: key => records.get(key) ?? null,
      write: (key, value) => { assert.equal(locked, true); writes += 1; records.set(key, value); },
      withLock: async (_key, operation) => { locked = true; try { return operation(); } finally { locked = false; } },
      entropy: () => { assert.equal(locked, true); draws += 1; return 73; } });
    const first = await storage.restore();
    assert.ok(first.run);
    assert.equal(first.run.policyVersion, ACTIVE_LOCAL_POLICY_VERSION);
    assert.equal(draws, previous ? 0 : 1);
    assert.equal(writes, previous ? 0 : 1);
    assert.deepEqual((await storage.restore()).run, first.run);
    assert.equal(draws, previous ? 0 : 1);
    assert.equal(writes, previous ? 0 : 1);
    if (bytes) assert.equal(records.get(LOCAL_SIMULATION_STORAGE_KEY), bytes);
    else assert.deepEqual(JSON.parse(records.get(LOCAL_SIMULATION_STORAGE_KEY)!), first.run);
  }
});

void test('new local temperament policy does not activate unsupported hosted control or tick a terminal', () => {
  const run = createFreshLocalSimulation(73);
  const bytes = JSON.stringify(run);
  assert.throws(() => createAutonomousState(run.state, epoch, true, 'unsupported'), /unsupported_hosted_policy_version/);
  assert.equal(JSON.stringify(run), bytes);
  run.state.outcome = { kind: 'cultural', winners: [2], round: 0, reason: 'Terminal immutability fixture' };
  const terminal = JSON.stringify(run);
  assert.ok(parseActiveLocalSimulation(run));
  assert.equal(JSON.stringify(advanceLocalSimulation(run, 60)), terminal);
  const reply = processLocalSimulationRequest({ id: 8, run, steps: 60 });
  assert.ok(reply.ok);
  assert.equal(JSON.stringify(reply.run), terminal);
});
