import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVE_LOCAL_RELEASE_ID, LOCAL_SIMULATION_STORAGE_KEY, createLocalSimulation, advanceLocalSimulation, parseActiveLocalSimulation, parseLocalSimulation, localSimulationSnapshot } from '../web/local-simulation.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { isPublicProvenance } from '../server/public-protocol.ts';
import { processLocalSimulationRequest } from '../web/local-simulation-worker.ts';
import { advanceLocalSimulationAsync } from '../web/local-simulation-client.ts';

await test('local observatory earns development through deterministic legal turns and survives restart', () => {
  const initial = createLocalSimulation(1701);
  assert.equal(initial.source, 'local-procedural');
  assert.equal(initial.state.origin?.namingVersion, 'cultural-toponyms-v1');
  assert.deepEqual(initial.state, createGeneratedWorld(1701, initial.timestamp, ACTIVE_LOCAL_RELEASE_ID, 'cultural-toponyms-v1'));
  assert.equal(initial.state.cities.length, 5);
  assert.ok(initial.state.civilizations.every(civ => civ.technologies.length === 0));
  assert.ok(initial.state.cities.every(city => city.buildings.length === 0));
  const first = advanceLocalSimulation(initial, 30);
  const restored = parseLocalSimulation(JSON.parse(JSON.stringify(first)));
  assert.ok(restored);
  const continuation = advanceLocalSimulation(first, 30);
  assert.deepEqual(continuation, advanceLocalSimulation(restored, 30));
  assert.deepEqual(continuation, advanceLocalSimulation(initial, 60));
  assert.equal(initial.steps, 0);
  assert.ok(continuation.state.civilizations.some(civ => civ.technologies.length > 0));
  assert.ok(continuation.state.cities.some(city => city.buildings.length > 0));
  assert.ok(continuation.memories.every(memory => memory !== null && memory.decisionCount > 0));
  assert.match(localSimulationSnapshot(continuation).identity, /^local:/);
});

await test('corrupt local saves and unbounded work refuse without silently replacing progress', () => {
  const initial = createLocalSimulation();
  assert.equal(parseLocalSimulation({ ...initial, policyVersion: 'unknown-future-policy' }), null);
  assert.equal(parseLocalSimulation({ ...initial, steps: 100 }), null);
  assert.equal(parseLocalSimulation({ ...initial, memories: [] }), null);
  assert.equal(parseLocalSimulation({ ...initial, source: 'authoritative-shared-world' }), null);
  assert.throws(() => advanceLocalSimulation(initial, 0), RangeError);
  assert.throws(() => advanceLocalSimulation(initial, 61), RangeError);
});

await test('background simulation protocol returns only a complete checkpoint and preserves refused input', async () => {
  const initial = createLocalSimulation();
  const before = JSON.stringify(initial);
  const reply = processLocalSimulationRequest({ id: 7, run: initial, steps: 1 });
  assert.equal(reply.id, 7);
  assert.ok(reply.ok);
  assert.equal(reply.run.steps, 1);
  assert.equal(JSON.stringify(initial), before);
  const refused = processLocalSimulationRequest({ id: 8, run: initial, steps: 61 });
  assert.equal(refused.id, 8);
  assert.equal(refused.ok, false);
  assert.equal(processLocalSimulationRequest(null).ok, false);
  assert.equal(JSON.stringify(initial), before);
  await assert.rejects(advanceLocalSimulationAsync(initial), /background local simulation/);
});

await test('procedural provenance stays distinct while historical agent and clock records remain valid', () => {
  const common = { seat: 0, commandId: 'record-1', recordedAt: '2026-10-22T00:00:00.000Z' };
  assert.ok(isPublicProvenance({ ...common, kind: 'development-agent', model: 'historical-model' }));
  assert.ok(isPublicProvenance({ ...common, kind: 'clock-service', model: null }));
  const procedural = { ...common, kind: 'procedural-policy', model: null, policy: { version: 'weighted-civilizations-v1', profileId: 'scholar', phase: 'develop', reason: 'Choose available research', decision: 1, seed: 1701 } };
  assert.ok(isPublicProvenance(procedural));
  assert.equal(isPublicProvenance({ ...procedural, model: 'pretend-model' }), false);
  assert.equal(isPublicProvenance({ ...procedural, policy: undefined }), false);
  assert.equal(isPublicProvenance({ ...procedural, policy: { ...procedural.policy, decision: 0 } }), false);
  assert.equal(isPublicProvenance({ ...procedural, kind: 'development-agent' }), false);
});

await test('Worker refuses historical generated releases without changing their read-only checkpoint bytes', () => {
  for (const release of ['settlement-interplanetary-1', 'settlement-living-partnerships-1', 'settlement-relief-charters-1'] as const) {
    const historical = createLocalSimulation(1701, release);
    assert.equal(Object.hasOwn(historical.state.origin!, 'namingVersion'), false);
    const before = JSON.stringify(historical);
    assert.deepEqual(parseLocalSimulation(JSON.parse(before)), historical);
    const response = processLocalSimulationRequest({ id: 19, run: historical, steps: 1 });
    assert.equal(response.ok, false);
    if (!response.ok) assert.match(response.error, /incompatible|read-only/);
    assert.equal(JSON.stringify(historical), before);
  }
});

await test('legacy generated checkpoint names identity and replay remain byte-exact without storage-key rotation or load-time opt-in', () => {
  const epoch = '2000-01-01T00:00:00.000Z';
  assert.equal(LOCAL_SIMULATION_STORAGE_KEY, 'civitas:procedural-observatory:living-world-v1');
  assert.equal(ACTIVE_LOCAL_RELEASE_ID, 'settlement-regional-targets-1');
  for (const release of ['settlement-interplanetary-1', 'settlement-living-partnerships-1', 'settlement-relief-charters-1', ACTIVE_LOCAL_RELEASE_ID] as const) {
    const state = createGeneratedWorld(1701, epoch, release);
    assert.deepEqual(state.cities.map(city => city.name), ['Dawnwell', 'Willowmere', 'Cinderhold', 'Tidehaven', 'Lumen']);
    state.cities[0]!.name = 'Dawnwe\u0301ll — saved history';
    const saved = { ...createLocalSimulation(1701, release), state };
    const bytes = JSON.stringify(saved);
    const restored = parseLocalSimulation(JSON.parse(bytes));
    assert.ok(restored);
    assert.equal(JSON.stringify(restored), bytes);
    assert.equal(Object.hasOwn(restored.state.origin!, 'namingVersion'), false);
    const identity = `local:coherent-geography-v1:1701:${epoch}${release === 'settlement-interplanetary-1' ? '' : `:${release}`}`;
    assert.equal(localSimulationSnapshot(restored).identity, identity);
    if (release === ACTIVE_LOCAL_RELEASE_ID) {
      assert.equal(JSON.stringify(parseActiveLocalSimulation(JSON.parse(bytes))), bytes);
      const continued = advanceLocalSimulation(saved, 2);
      assert.deepEqual(advanceLocalSimulation(restored, 2), continued);
      assert.equal(continued.state.cities.find(city => city.id === 'city-0')?.name, 'Dawnwe\u0301ll — saved history');
      assert.equal(Object.hasOwn(continued.state.origin!, 'namingVersion'), false);
      assert.equal(localSimulationSnapshot(continued).identity, identity);
      const fresh = createLocalSimulation(1701);
      assert.equal(localSimulationSnapshot(fresh).identity, `${identity}:cultural-toponyms-v1`);
      assert.notEqual(localSimulationSnapshot(fresh).identity, identity);
    }
    assert.equal(JSON.stringify(saved), bytes);
  }
});
