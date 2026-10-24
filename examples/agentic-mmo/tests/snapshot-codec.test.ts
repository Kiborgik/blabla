import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../core/engine.ts';
import { decodeHistorySnapshot, HISTORY_SNAPSHOT_LIMITS, HISTORY_SNAPSHOT_PREFIX } from '../server/snapshot-codec.ts';
import { RequestFailure } from '../server/validation.ts';

function envelope(bytes: Uint8Array, overrides: Record<string, unknown> = {}, compressed = gzipSync(bytes)): string {
  return HISTORY_SNAPSHOT_PREFIX + JSON.stringify({ version: 1, codec: 'gzip', utf8Bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), data: compressed.toString('base64'), ...overrides });
}
function failure(code: string) {
  return (error: unknown) => error instanceof RequestFailure && error.status === 503 && error.code === code;
}
function frame() {
  const state = createWorld(1701, '2026-10-16T00:00:00.000Z');
  const civilization = state.civilizations[0];
  assert.ok(civilization);
  civilization.objective = 'Dawnwell — 東京 🌾';
  return state;
}

await test('raw history retains whitespace, Unicode and acceptance beyond encoded-frame limits', async () => {
  const state = frame();
  assert.deepEqual(await decodeHistorySnapshot(` \n${JSON.stringify(state, null, 2)}\n`), state);
  const civilization = state.civilizations[0];
  assert.ok(civilization);
  civilization.objective = '中'.repeat(HISTORY_SNAPSHOT_LIMITS.envelopeBytes);
  const raw = JSON.stringify(state);
  assert.ok(Buffer.byteLength(raw) > HISTORY_SNAPSHOT_LIMITS.envelopeBytes);
  assert.deepEqual(await decodeHistorySnapshot(raw), state);
});

await test('gzip version one reads independent exact UTF-8 frames through the inclusive decoded boundary', async () => {
  const state = frame();
  const source = ` \n${JSON.stringify(state, null, 2)}\n`;
  assert.equal(Buffer.byteLength(HISTORY_SNAPSHOT_PREFIX), 16);
  assert.deepEqual(await decodeHistorySnapshot(envelope(Buffer.from(source))), state);
  const remaining = HISTORY_SNAPSHOT_LIMITS.utf8Bytes - Buffer.byteLength(JSON.stringify(state));
  const civilization = state.civilizations[0];
  assert.ok(civilization);
  civilization.objective += 'a'.repeat(remaining);
  const boundary = Buffer.from(JSON.stringify(state));
  assert.equal(boundary.length, HISTORY_SNAPSHOT_LIMITS.utf8Bytes);
  assert.deepEqual(await decodeHistorySnapshot(envelope(boundary)), state);
});

await test('only explicitly framed gzip version one is decoded and unknown formats never fall back', async () => {
  const bytes = Buffer.from(JSON.stringify(frame()));
  await assert.rejects(decodeHistorySnapshot(envelope(bytes).slice(HISTORY_SNAPSHOT_PREFIX.length)), failure('corrupt_or_incompatible_world'));
  for (const overrides of [{ version: 2 }, { codec: 'deflate' }, { codec: 'brotli' }])
    await assert.rejects(decodeHistorySnapshot(envelope(bytes, overrides)), failure('unsupported_snapshot_encoding'));
  await assert.rejects(decodeHistorySnapshot(`${HISTORY_SNAPSHOT_PREFIX}${JSON.stringify(frame())}`), failure('corrupt_history_snapshot'));
});

await test('encoded envelopes reject malformed fields, duplicate fields and noncanonical base64', async () => {
  const bytes = Buffer.from(JSON.stringify(frame()));
  for (const overrides of [{ version: null }, { codec: null }, { utf8Bytes: -1 }, { utf8Bytes: 1.5 }, { utf8Bytes: '12' }, { sha256: 'A'.repeat(64) }, { sha256: 'bad' }, { extra: true }, { data: null }, { data: 'AA== ' }, { data: 'A===' }, { data: 'AB==' }])
    await assert.rejects(decodeHistorySnapshot(envelope(bytes, overrides)), failure('corrupt_history_snapshot'));
  for (const text of ['', 'null', '[]', '{}', '{', ' ' + envelope(bytes).slice(HISTORY_SNAPSHOT_PREFIX.length), `{"version":2,${envelope(bytes).slice(HISTORY_SNAPSHOT_PREFIX.length + 1)}`])
    await assert.rejects(decodeHistorySnapshot(HISTORY_SNAPSHOT_PREFIX + text), failure('corrupt_history_snapshot'));
});

await test('encoded limits reject oversized envelope text before parsing and compressed bytes before decoding', async () => {
  for (const text of ['!'.repeat(HISTORY_SNAPSHOT_LIMITS.envelopeBytes + 1), '中'.repeat(HISTORY_SNAPSHOT_LIMITS.envelopeBytes / 2)])
    await assert.rejects(decodeHistorySnapshot(HISTORY_SNAPSHOT_PREFIX + text), failure('history_snapshot_envelope_limit'));
  const bytes = Buffer.from(JSON.stringify(frame()));
  await assert.rejects(decodeHistorySnapshot(envelope(bytes, { utf8Bytes: HISTORY_SNAPSHOT_LIMITS.utf8Bytes + 1 })), failure('history_snapshot_decoded_limit'));
  await assert.rejects(decodeHistorySnapshot(envelope(bytes, {}, Buffer.alloc(HISTORY_SNAPSHOT_LIMITS.compressedBytes + 1))), failure('history_snapshot_compressed_limit'));
});

await test('truncated, trailing, concatenated and damaged gzip data is explicitly unavailable', async () => {
  const bytes = Buffer.from(JSON.stringify(frame()));
  const compressed = gzipSync(bytes);
  for (const invalid of [compressed.subarray(0, -1), Buffer.concat([compressed, Buffer.of(1)]), Buffer.concat([compressed, Buffer.of(0)]), Buffer.concat([compressed, compressed]), Buffer.from('invalid'), Buffer.from(compressed.map((value, index) => index === compressed.length - 5 ? value ^ 0xff : value))])
    await assert.rejects(decodeHistorySnapshot(envelope(bytes, {}, invalid)), failure('corrupt_history_snapshot'));
});

await test('decoded bytes require exact length, SHA-256, valid UTF-8 and canonical world validation', async () => {
  const bytes = Buffer.from(JSON.stringify(frame()));
  await assert.rejects(decodeHistorySnapshot(envelope(bytes, { sha256: '0'.repeat(64) })), failure('corrupt_history_snapshot'));
  await assert.rejects(decodeHistorySnapshot(envelope(bytes, { utf8Bytes: bytes.length + 1 })), failure('corrupt_history_snapshot'));
  await assert.rejects(decodeHistorySnapshot(envelope(Buffer.of(0xff, 0xfe))), failure('corrupt_history_snapshot'));
  const invalid = frame();
  const city = invalid.cities[0];
  assert.ok(city);
  city.population = -1;
  for (const text of [JSON.stringify(invalid), envelope(Buffer.from(JSON.stringify(invalid)))])
    await assert.rejects(decodeHistorySnapshot(text), failure('corrupt_or_incompatible_world'));
  await assert.rejects(decodeHistorySnapshot(envelope(Buffer.from('{'))), failure('corrupt_persisted_json'));
});

await test('streamed expansion stops at the declared output bound before retaining a bomb', async () => {
  const bytes = Buffer.alloc(HISTORY_SNAPSHOT_LIMITS.utf8Bytes * 4, 65);
  await assert.rejects(decodeHistorySnapshot(envelope(bytes, { utf8Bytes: 32 })), failure('history_snapshot_decoded_limit'));
});
