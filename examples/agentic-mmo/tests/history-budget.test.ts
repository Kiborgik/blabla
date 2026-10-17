import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HistoryOutputBudget, HISTORY_PAGE_BYTES, HISTORY_PAGE_FRAMING_BYTES, selectHistoryRows } from '../server/history-budget.ts';
import { RequestFailure } from '../server/validation.ts';

function metadata(end_revision: number, snapshot_bytes: number, detail_bytes = 0, encoded = 0) {
  return { end_revision, snapshot_bytes, detail_bytes, encoded };
}
function corrupt(error: unknown) { return error instanceof RequestFailure && error.status === 503; }

await test('input prefix admits the exact byte boundary and leaves the next revision for another page', () => {
  const rows = [metadata(3, 524_288), metadata(8, 524_288), metadata(11, 1)];
  assert.deepEqual(selectHistoryRows(rows, 0, 200), { revisions: [3, 8], hasMore: true });
  assert.deepEqual(selectHistoryRows(rows.slice(2), 8, 200), { revisions: [11], hasMore: false });
  assert.deepEqual(selectHistoryRows(rows, 0, 1), { revisions: [3], hasMore: true });
  assert.deepEqual(selectHistoryRows([], 11, 200), { revisions: [], hasMore: false });
});

await test('encoded charge reserves the larger stored or decoded limit and includes ancillary JSON', () => {
  assert.deepEqual(selectHistoryRows(Array.from({ length: 9 }, (_, i) => metadata(i + 1, 100, 1, 1)), 0, 200), { revisions: [1, 2, 3, 4, 5, 6, 7], hasMore: true });
  assert.deepEqual(selectHistoryRows(Array.from({ length: 7 }, (_, i) => metadata(i + 1, 200_000, 1, 1)), 0, 200), { revisions: [1, 2, 3, 4, 5], hasMore: true });
});

await test('an oversized first complete entry is a singleton in either format and a middle one is deferred', () => {
  for (const encoded of [0, 1]) {
    const rows = [metadata(1, 100, 0, encoded), metadata(2, 100, HISTORY_PAGE_BYTES + 1, encoded), metadata(3, 100, 0, encoded)];
    assert.deepEqual(selectHistoryRows(rows, 0, 200), { revisions: [1], hasMore: true });
    assert.deepEqual(selectHistoryRows(rows.slice(1), 1, 200), { revisions: [2], hasMore: true });
    assert.deepEqual(selectHistoryRows(rows.slice(2), 2, 200), { revisions: [3], hasMore: false });
  }
});

await test('malformed metadata and oversized encoded envelopes cannot reach payload hydration', () => {
  for (const rows of [[null], [metadata(0, 1)], [metadata(2, 1), metadata(1, 1)], [metadata(1, -1)], [metadata(1, 1.2)], [metadata(1, 1, -1)], [metadata(1, 1, 0, 2)], [metadata(1, Number.MAX_SAFE_INTEGER, 1)]])
    assert.throws(() => selectHistoryRows(rows, 0, 200), corrupt);
  assert.throws(() => selectHistoryRows([metadata(1, 200 * 1024 + 17, 0, 1)], 0, 200), (error: unknown) => corrupt(error) && error instanceof RequestFailure && error.code === 'history_snapshot_envelope_limit');
});

await test('output accounting includes UTF-8, commas and a conservative complete page wrapper', () => {
  const budget = new HistoryOutputBudget();
  const entries = [{ value: '東京 🌾' }, { value: 'é' }];
  assert.equal(budget.accept(entries[0]), true);
  assert.equal(budget.accept(entries[1]), true);
  const bytes = Buffer.byteLength(JSON.stringify(entries[0])) + Buffer.byteLength(JSON.stringify(entries[1])) + 1 + HISTORY_PAGE_FRAMING_BYTES;
  assert.equal(budget.bytes, bytes);
  for (const nextRevision of [null, 1, Number.MAX_SAFE_INTEGER])
    assert.ok(Buffer.byteLength(JSON.stringify({ entries, hasMore: nextRevision !== null, nextRevision })) <= budget.bytes);
});

await test('output exact boundary accepts the frame and refuses further entries without an empty page', () => {
  const budget = new HistoryOutputBudget();
  const value = 'a'.repeat(HISTORY_PAGE_BYTES - HISTORY_PAGE_FRAMING_BYTES - 2);
  assert.equal(budget.accept(value), true);
  assert.equal(budget.bytes, HISTORY_PAGE_BYTES);
  assert.equal(budget.full, true);
  assert.equal(budget.accept(''), false);
  const next = new HistoryOutputBudget();
  assert.equal(next.accept(''), true);
});

await test('output overflow leaves the pending entry untouched and a first oversized entry remains readable alone', () => {
  const budget = new HistoryOutputBudget();
  assert.equal(budget.accept('a'.repeat(600_000)), true);
  const before = budget.bytes;
  assert.equal(budget.accept('中'.repeat(200_000)), false);
  assert.equal(budget.bytes, before);
  const singleton = new HistoryOutputBudget();
  assert.equal(singleton.accept('中'.repeat(400_000)), true);
  assert.equal(singleton.full, true);
  assert.equal(singleton.accept({ small: true }), false);
});
