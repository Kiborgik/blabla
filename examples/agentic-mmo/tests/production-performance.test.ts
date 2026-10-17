import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

await test('finite recipe workloads measure real transitions, depletion, pause and replay at five and twenty-five cities', async () => {
  assert.ok(existsSync(new URL('../benchmarks/production.ts', import.meta.url)), 'The production measurement harness must exist');
  const { measureProduction } = await import('../benchmarks/production.ts');
  const left = measureProduction();
  const right = measureProduction();
  assert.equal(left.identity.actionSource, 'contract-probes');
  assert.deepEqual(left.workloads.map((workload) => workload.deterministic), right.workloads.map((workload) => workload.deterministic));
  assert.deepEqual(left.workloads.map((workload) => workload.deterministic.cities), [5, 25]);
  for (const { deterministic: work, timings } of left.workloads) {
    assert.equal(work.beats, 10);
    assert.equal(work.actionCommands, 10);
    assert.equal(work.strategyCommands, 10);
    assert.equal(work.replayedTransitions, 20);
    assert.equal(work.immutableInputsChecked, 20);
    assert.equal(work.duplicateCatchupsChecked, 10);
    assert.equal(work.observations, 120);
    assert.equal(work.recipeReceipts, work.cities * 2 * work.beats);
    assert.equal(work.operationEvents, work.recipeReceipts);
    assert.equal(work.operationRecords, work.cities * 2);
    assert.equal(work.operated + work.blocked + work.paused, work.recipeReceipts);
    assert.ok(work.operated > 0 && work.blocked > 0 && work.paused > 0);
    assert.ok(work.firstBlockedBeat > work.firstOperatedBeat);
    assert.ok(work.retainedRecentEvents <= 96);
    assert.ok(work.maximumObservationRecentEvents <= 12);
    assert.equal(work.maximumObservedRecipeDefinitions, 2);
    assert.equal(timings.transitionMs.count, 20);
    assert.ok(Number.isFinite(timings.totalWorkloadMs) && timings.totalWorkloadMs >= 0);
  }
  assert.ok(left.unmeasured.includes('hosted CPU quotas, D1 costs and network latency'));
});

await test('saved baseline grounds deterministic work and UTF-8 payload envelopes without latency gates', async () => {
  assert.ok(existsSync(new URL('../benchmarks/production-baseline.json', import.meta.url)), 'The measured production baseline must exist');
  const { measureProduction } = await import('../benchmarks/production.ts');
  const { default: baseline } = await import('../benchmarks/production-baseline.json', { with: { type: 'json' } });
  const current = measureProduction();
  assert.deepEqual(current.workloads.map((workload) => workload.deterministic), baseline.workloads.map((workload) => workload.deterministic));
  for (const [index, workload] of current.workloads.entries()) {
    const saved = baseline.workloads[index];
    assert.ok(saved);
    for (const kind of ['stateBytes', 'observationBytes', 'resultBytes'] as const) {
      const measured: number = saved.deterministic[kind].maximum;
      const budget: number = saved.payloadEnvelope[kind];
      assert.equal(budget, Math.ceil(measured * 1.25 / 1024) * 1024);
      assert.ok(workload.deterministic[kind].maximum <= budget, `${kind} exceeded the measured fixture envelope`);
    }
  }
});

await test('production measurements reject unbounded or unsupported fixtures', async () => {
  assert.ok(existsSync(new URL('../benchmarks/production.ts', import.meta.url)));
  const { measureProduction } = await import('../benchmarks/production.ts');
  for (const options of [{ beats: 0 }, { beats: 10000 }, { cityCounts: [] }, { cityCounts: [100000] }, { cityCounts: [5, 5] }]) {
    assert.throws(() => measureProduction(options), /finite|bounded|fixture/);
  }
});
