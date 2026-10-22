import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalSimulation, advanceLocalSimulation, parseLocalSimulation, localSimulationSnapshot } from '../web/local-simulation.ts';
import { isPublicProvenance } from '../server/public-protocol.ts';
import { processLocalSimulationRequest } from '../web/local-simulation-worker.ts';
import { advanceLocalSimulationAsync } from '../web/local-simulation-client.ts';

await test('local observatory earns development through deterministic legal turns and survives restart', () => {
  const initial = createLocalSimulation(1701);
  assert.equal(initial.source, 'local-procedural');
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
    const before = JSON.stringify(historical);
    assert.deepEqual(parseLocalSimulation(JSON.parse(before)), historical);
    const response = processLocalSimulationRequest({ id: 19, run: historical, steps: 1 });
    assert.equal(response.ok, false);
    if (!response.ok) assert.match(response.error, /incompatible|read-only/);
    assert.equal(JSON.stringify(historical), before);
  }
});
