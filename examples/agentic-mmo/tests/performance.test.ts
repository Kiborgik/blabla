import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

await test('finite headless measurements reproduce deterministic worlds and expose real bounds', async () => {
  assert.ok(existsSync(new URL('../benchmarks/runtime.ts', import.meta.url)));
  const { measureRuntime } = await import('../benchmarks/runtime.ts');
  const options = {
    seeds: [17, 1701],
    actionCounts: [120],
    historyAdvanceCounts: [0, 4, 8],
    clockDueTicks: 480,
  };
  const left = measureRuntime(options);
  const right = measureRuntime(options);
  assert.equal(left.identity.actionSource, 'builtin-policies');
  assert.equal(left.workloads.length, 2);
  assert.deepEqual(
    left.workloads.map((workload) => workload.deterministic),
    right.workloads.map((workload) => workload.deterministic),
  );
  for (const workload of left.workloads) {
    assert.equal(workload.deterministic.actions, 120);
    assert.equal(workload.deterministic.rounds, 20);
    assert.equal(workload.deterministic.civilizations, 5);
    assert.equal(workload.deterministic.retainedRecentEvents, 96);
    assert.ok(workload.deterministic.observationBytes.maximum > 0);
    assert.ok(
      workload.deterministic.stateBytes.maximum >= workload.deterministic.stateBytes.minimum,
    );
    assert.ok(
      workload.deterministic.totalRecordedEvents > workload.deterministic.retainedRecentEvents,
    );
    assert.equal(workload.timings.transitionMs.count, 120);
  }
  assert.deepEqual(
    left.clock.batches.map((batch) => batch.processedTicks),
    [240, 240],
  );
  assert.deepEqual(
    left.clock.batches.map((batch) => batch.remainingTicks),
    [240, 0],
  );
  assert.equal(left.clock.finalTicks, 480);
  assert.equal(left.clock.advancedYears, 4800);
  assert.equal(left.clock.retainedRecentEvents, 96);
  assert.deepEqual(
    left.history.map((sample) => sample.receipts),
    [0, 4, 8],
  );
  assert.ok((left.history[2]?.ledgerBytes ?? 0) > (left.history[1]?.ledgerBytes ?? 0));
  assert.ok(left.history.every((sample) => sample.clockTicks === 0));
  assert.ok(left.unmeasured.includes('hosted D1 latency, CPU quotas and durable archive growth'));
});
