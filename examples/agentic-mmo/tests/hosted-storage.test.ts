import assert from 'node:assert/strict';
import test from 'node:test';
import { measureHostedStorage } from '../benchmarks/hosted-storage.ts';

const measured = measureHostedStorage();

void test('hosted storage measurement uses finite real transitions and retains every receipt', async () => {
  const report = await measured;
  assert.equal(report.workload.source, 'synthetic-deterministic-driver');
  assert.deepEqual(report.samples.map((sample) => sample.transitions), [10, 100, 1000]);
  for (const [index, sample] of report.samples.entries()) {
    assert.equal(sample.revision, sample.transitions);
    assert.equal(sample.receipts, sample.transitions + 1 + index + 1);
    assert.equal(sample.noOpReceipts, index + 1);
    assert.equal(sample.replay.frames, sample.transitions);
    assert.equal(sample.retriesChecked, 3);
    assert.equal(sample.retryAddedRows, 0);
    assert.equal(sample.retryAddedTextBytes, 0);
    assert.equal(sample.retainedEvents <= 96, true);
    assert.equal(sample.replay.finalSha256.length, 64);
  }
});

void test('stored UTF-8 categories reconcile and local allocation stays distinct from payload', async () => {
  const { samples } = await measured;
  for (const sample of samples) {
    const total = Object.values(sample.columns).flatMap((fields) => Object.values(fields)).reduce((sum, bytes) => sum + bytes, 0);
    assert.equal(sample.totalTextBytes, total);
    assert.equal(sample.totalJsonBytes, sample.initialStateBytes + sample.currentStateBytes + sample.snapshotBytes + sample.commandBytes + sample.provenanceBytes + sample.eventBytes + sample.receiptRequestBytes + sample.receiptResponseBytes);
    assert.ok(sample.totalTextBytes > sample.totalJsonBytes);
    assert.ok(sample.utf8BytesBeyondCodepoints > 0);
    assert.equal(sample.localAllocationBytes, sample.localPageCount * sample.localPageSize);
    assert.ok(sample.localAllocationBytes >= sample.totalTextBytes);
  }
});

void test('finite storage growth exposes snapshot duplication without deleting any data', async () => {
  const { samples } = await measured;
  const first = samples[0];
  const middle = samples[1];
  const last = samples[2];
  assert.ok(first && middle && last);
  assert.ok(first.totalJsonBytes < middle.totalJsonBytes && middle.totalJsonBytes < last.totalJsonBytes);
  for (const sample of samples) {
    assert.ok(sample.currentStateBytes < 128 * 1024);
    assert.ok(sample.snapshotBytes < sample.transitions * 128 * 1024);
    assert.ok(sample.totalJsonBytes < (sample.transitions + 2) * 160 * 1024);
    assert.ok(sample.snapshotBytes > sample.commandBytes + sample.provenanceBytes + sample.eventBytes + sample.receiptRequestBytes + sample.receiptResponseBytes);
    assert.ok(sample.snapshotMapBytes > 0 && sample.snapshotRecentEventBytes > 0);
    assert.equal(sample.projection.interval, 50);
    assert.ok(sample.projection.retainedSnapshots < sample.transitions);
    assert.equal(sample.projection.projectedJsonBytes, sample.totalJsonBytes - sample.snapshotBytes + sample.projection.retainedSnapshotBytes);
    assert.equal(sample.projection.omittedSnapshotBytes, sample.totalJsonBytes - sample.projection.projectedJsonBytes);
  }
});

void test('the same synthetic prefix and recorded source produce identical byte measurements', async () => {
  const [first, second] = await Promise.all([measureHostedStorage([10]), measureHostedStorage([10])]);
  assert.deepEqual(first.samples, second.samples);
  assert.equal(first.identity.source.sha256, second.identity.source.sha256);
  assert.ok(first.identity.source.files.some((file) => file.path === 'server/repository.ts'));
  assert.ok(first.identity.source.files.some((file) => file.path === 'server/migrations/0000_world.sql'));
  assert.ok(first.identity.source.files.some((file) => file.path === 'benchmarks/hosted-storage.ts'));
});

void test('storage workloads reject unbounded or ambiguous transition budgets', async () => {
  for (const counts of [[], [0], [7], [-1], [10.5], [1001], [10, 10], [100, 10]])
    await assert.rejects(measureHostedStorage(counts), RangeError);
});
