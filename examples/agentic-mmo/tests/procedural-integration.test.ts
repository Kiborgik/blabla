import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVE_LOCAL_RELEASE_ID, LOCAL_SIMULATION_STORAGE_KEY, createLocalSimulation, createFreshLocalSimulation, advanceLocalSimulation, parseActiveLocalSimulation, parseLocalSimulation, localSimulationSnapshot } from '../web/local-simulation.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { isPublicProvenance } from '../server/public-protocol.ts';
import { processLocalSimulationRequest } from '../web/local-simulation-worker.ts';
import { advanceLocalSimulationAsync, disposeLocalSimulationWorker } from '../web/local-simulation-client.ts';

await test('local observatory earns development through deterministic legal turns and survives restart', () => {
  const initial = createLocalSimulation(1701);
  assert.equal(initial.source, 'local-procedural');
  assert.equal(initial.state.origin?.namingVersion, 'cultural-toponyms-v1');
  assert.deepEqual(initial.state, createGeneratedWorld(1701, initial.timestamp, ACTIVE_LOCAL_RELEASE_ID, 'cultural-toponyms-v1', 'strategic-temperaments-v1'));
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

await test('one current checkpoint parser refuses mismatched envelopes genesis policy and registered layers without mutation', () => {
  const initial = createFreshLocalSimulation(1701);
  const changes: Array<(run: typeof initial) => void> = [
    run => { Reflect.set(run, 'version', 1); },
    run => { run.policyVersion = 'weighted-civilizations-v3-food-budget'; },
    run => { delete run.state.origin!.namingVersion; },
    run => { delete run.state.origin!.temperamentVersion; },
    run => { run.state.origin!.initialReleaseId = 'settlement-food-budget-1'; },
    run => { run.state.releaseId = 'settlement-food-budget-1'; },
    run => { run.state.unlockedFeatures.push(run.state.unlockedFeatures[0]!); },
    run => { run.state.unlockedFeatures = run.state.unlockedFeatures.filter(feature => feature !== 'knowledge-compacts'); },
    run => { run.state.gameVersion = 'unavailable'; },
  ];
  for (const mutate of changes) {
    const invalid = structuredClone(initial);
    mutate(invalid);
    const bytes = JSON.stringify(invalid);
    assert.equal(parseLocalSimulation(invalid), null);
    assert.equal(parseActiveLocalSimulation(invalid), null);
    assert.equal(processLocalSimulationRequest({ id: 8, run: invalid, steps: 1 }).ok, false);
    assert.throws(() => advanceLocalSimulation(invalid), /incompatible|corrupt/);
    assert.equal(JSON.stringify(invalid), bytes);
  }
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

await test('current checkpoint names and identity survive same-version JSON restart without load-time changes', () => {
  const saved = createLocalSimulation(1701);
  assert.match(LOCAL_SIMULATION_STORAGE_KEY, /^civitas:procedural-observatory:/);
  assert.equal(saved.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  saved.state.cities[0]!.name = 'Dawnwe\u0301ll — saved current town';
  const bytes = JSON.stringify(saved);
  const restored = parseActiveLocalSimulation(JSON.parse(bytes));
  assert.ok(restored);
  assert.equal(JSON.stringify(restored), bytes);
  const identity = `local:coherent-geography-v1:1701:${saved.timestamp}:${ACTIVE_LOCAL_RELEASE_ID}:cultural-toponyms-v1:strategic-temperaments-v1`;
  assert.equal(localSimulationSnapshot(restored).identity, identity);
  const continued = advanceLocalSimulation(saved, 2);
  assert.deepEqual(advanceLocalSimulation(restored, 2), continued);
  assert.equal(continued.state.cities.find(city => city.id === 'city-0')?.name, 'Dawnwe\u0301ll — saved current town');
  assert.equal(localSimulationSnapshot(continued).identity, identity);
  assert.equal(JSON.stringify(saved), bytes);
  assert.equal(JSON.stringify(restored), bytes);
});

await test('background client refuses a mismatched Worker checkpoint and retains the last complete input', async () => {
  const initial = createLocalSimulation(73);
  const bytes = JSON.stringify(initial);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  let terminations = 0;
  class MismatchedWorker {
    handlers = new Map<string, (event: { data: unknown }) => void>();
    addEventListener(type: string, handler: (event: { data: unknown }) => void): void { this.handlers.set(type, handler); }
    terminate(): void { terminations += 1; }
    postMessage(request: { id: number }): void {
      const run = structuredClone(initial);
      delete run.state.origin!.temperamentVersion;
      queueMicrotask(() => this.handlers.get('message')?.({ data: { id: request.id, ok: true, run } }));
    }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: MismatchedWorker });
  try {
    await assert.rejects(advanceLocalSimulationAsync(initial), /invalid checkpoint/);
    assert.equal(terminations, 1);
    assert.equal(JSON.stringify(initial), bytes);
  } finally {
    disposeLocalSimulationWorker();
    if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});
