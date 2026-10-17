import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, deflateSync } from 'node:zlib';
import { test } from 'node:test';
import { decodeSnapshot, encodeSnapshot, measureSnapshotEncoding, SNAPSHOT_LIMITS } from '../benchmarks/snapshot-encoding.ts';
import { measureHostedStorage } from '../benchmarks/hosted-storage.ts';

function parsedEnvelope(text: string) {
  const value: unknown = JSON.parse(text);
  assert.ok(typeof value === 'object' && value !== null);
  assert.ok('version' in value && typeof value.version === 'number');
  assert.ok('codec' in value && typeof value.codec === 'string');
  assert.ok('utf8Bytes' in value && typeof value.utf8Bytes === 'number');
  assert.ok('sha256' in value && typeof value.sha256 === 'string');
  assert.ok('data' in value && typeof value.data === 'string');
  return { version: value.version, codec: value.codec, utf8Bytes: value.utf8Bytes, sha256: value.sha256, data: value.data };
}

function envelope(bytes: Uint8Array, codec: 'gzip' | 'deflate', declaredBytes = bytes.length): string {
  const payload = codec === 'gzip' ? gzipSync(bytes) : deflateSync(bytes);
  return JSON.stringify({ version: 1, codec, utf8Bytes: declaredBytes, sha256: createHash('sha256').update(bytes).digest('hex'), data: payload.toString('base64') });
}

for (const codec of ['gzip', 'deflate'] as const) {
  await test(`${codec} preserves exact UTF-8 bytes and accounts for envelope overhead`, async () => {
    const source = ' {"place":"Dawnwell — 東京 🌾","values":[1,2],"escape":"\\u00e9"}\n';
    const encoded = await encodeSnapshot(source, codec);
    const parsed = parsedEnvelope(encoded);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.codec, codec);
    assert.equal(parsed.utf8Bytes, Buffer.byteLength(source));
    assert.equal(parsed.sha256, createHash('sha256').update(source).digest('hex'));
    const decoded = await decodeSnapshot(encoded);
    assert.equal(decoded.text, source);
    assert.equal(decoded.utf8Bytes, Buffer.byteLength(source));
    assert.ok(decoded.maximumChunkBytes > 0);
    assert.deepEqual(Buffer.from(decoded.text), Buffer.from(source));
    assert.ok(Buffer.byteLength(encoded) > Buffer.from(parsed.data, 'base64').length);
    assert.equal((await decodeSnapshot(envelope(Buffer.from(source), codec))).text, source);
  });

  await test(`${codec} rejects malformed, truncated, trailing and corrupt compressed payloads`, async () => {
    const encoded = parsedEnvelope(await encodeSnapshot('{"city":"Dawnwell"}', codec));
    const data = Buffer.from(encoded.data, 'base64');
    for (const invalid of [data.subarray(0, -1), Buffer.concat([data, Buffer.of(1)]), Buffer.concat([data, Buffer.of(0)]), Buffer.concat([data, data]), Buffer.from('invalid'), Buffer.from(data.map((value, index) => index === data.length - 5 ? value ^ 0xff : value))]) {
      await assert.rejects(decodeSnapshot(JSON.stringify({ ...encoded, data: invalid.toString('base64') })));
    }
    await assert.rejects(decodeSnapshot(JSON.stringify({ ...encoded, sha256: '0'.repeat(64) })), /snapshot_checksum_mismatch/);
    await assert.rejects(decodeSnapshot(JSON.stringify({ ...encoded, utf8Bytes: encoded.utf8Bytes + 1 })), /snapshot_length_mismatch/);
    await assert.rejects(decodeSnapshot(envelope(Buffer.of(0xff, 0xfe), codec)), /snapshot_invalid_utf8/);
  });

  await test(`${codec} stops expanded output at the declared bound before retaining the full payload`, async () => {
    const expansion = Buffer.alloc(SNAPSHOT_LIMITS.utf8Bytes * 4, 65);
    await assert.rejects(decodeSnapshot(envelope(expansion, codec, 32)), /snapshot_decoded_limit/);
    await assert.rejects(decodeSnapshot(envelope(expansion, codec, SNAPSHOT_LIMITS.utf8Bytes + 1)), /snapshot_invalid_envelope/);
    const boundary = 'é'.repeat(SNAPSHOT_LIMITS.utf8Bytes / 2);
    assert.equal((await decodeSnapshot(await encodeSnapshot(boundary, codec))).text, boundary);
    await assert.rejects(encodeSnapshot(`${boundary}é`, codec), /snapshot_input_limit/);
    await assert.rejects(encodeSnapshot('\ud800', codec), /snapshot_invalid_utf8/);
  });
}

await test('lossless wrapping can expand small or poorly compressible inputs without losing bytes', async () => {
  for (const codec of ['gzip', 'deflate']) {
    const tiny = await encodeSnapshot('{}', codec);
    assert.ok(Buffer.byteLength(tiny) > 2);
    let seed = 1701;
    let text = '';
    for (let index = 0; index < SNAPSHOT_LIMITS.utf8Bytes; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      text += String.fromCharCode(32 + (seed >>> 0) % 95);
    }
    const encoded = await encodeSnapshot(text, codec);
    assert.ok(Buffer.byteLength(encoded) > Buffer.byteLength(text));
    assert.ok(Buffer.byteLength(encoded) <= SNAPSHOT_LIMITS.envelopeBytes);
    assert.equal((await decodeSnapshot(encoded)).text, text);
  }
});

await test('envelope is strictly versioned, bounded before JSON parsing and canonical', async () => {
  await assert.rejects(decodeSnapshot('!'.repeat(SNAPSHOT_LIMITS.envelopeBytes + 1)), /snapshot_envelope_limit/);
  await assert.rejects(decodeSnapshot('中'.repeat(SNAPSHOT_LIMITS.envelopeBytes / 2)), /snapshot_envelope_limit/);
  const valid = parsedEnvelope(await encodeSnapshot('{}', 'gzip'));
  for (const invalid of [null, [], {}, { ...valid, version: 2 }, { ...valid, codec: 'brotli' }, { ...valid, utf8Bytes: -1 }, { ...valid, utf8Bytes: 1.5 }, { ...valid, sha256: 'bad' }, { ...valid, extra: true }, { ...valid, data: `${valid.data} ` }, { ...valid, data: 'A===' }, { ...valid, data: 'AB==' }])
    await assert.rejects(decodeSnapshot(JSON.stringify(invalid)), /snapshot_invalid_envelope|snapshot_invalid_base64/);
  await assert.rejects(decodeSnapshot(`{"version":2,${JSON.stringify(valid).slice(1)}`), /snapshot_invalid_envelope/);
  await assert.rejects(decodeSnapshot(JSON.stringify({ ...valid, data: Buffer.alloc(SNAPSHOT_LIMITS.compressedBytes + 1).toString('base64') })), /snapshot_compressed_limit/);
  await assert.rejects(decodeSnapshot(17), /snapshot_invalid_envelope/);
});

await test('both encodings retain all representative frames and match real hosted storage controls', async () => {
  const result = await measureSnapshotEncoding();
  const control = await measureHostedStorage();
  assert.equal(result.frames, 1000);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.controls.length, control.samples.length);
  for (const sample of control.samples) {
    const matched = result.controls.find((candidate) => candidate.transitions === sample.transitions);
    assert.ok(matched);
    assert.equal(matched.rawBytes, sample.snapshotBytes);
    assert.equal(matched.finalSha256, sample.replay.finalSha256);
  }
  for (const candidate of result.candidates) {
    assert.equal(candidate.roundTrips, 1000);
    assert.equal(candidate.rawBytes, control.samples.at(-1)?.snapshotBytes);
    assert.equal(candidate.base64Bytes, candidate.compressedBytes + candidate.base64OverheadBytes);
    assert.equal(candidate.envelopeBytes, candidate.base64Bytes + candidate.metadataBytes);
    assert.ok(candidate.envelopeBytes < candidate.rawBytes);
    assert.ok(candidate.maximumFrameBytes <= SNAPSHOT_LIMITS.utf8Bytes);
    assert.ok(candidate.maximumEnvelopeBytes <= SNAPSHOT_LIMITS.envelopeBytes);
    assert.ok(candidate.maximumDecodeChunkBytes > 0);
    assert.equal(candidate.cpu.user >= 0 && candidate.cpu.system >= 0, true);
    assert.equal(candidate.encodeMs.p50 >= 0 && candidate.decodeMs.p50 >= 0, true);
  }
  assert.ok(result.memory.processPeakRssBytes >= result.memory.sampledRssBytes);
  assert.match(result.identity.sha256, /^[a-f0-9]{64}$/);
});

await test('encoding workloads are finite and reject unsupported codec requests', async () => {
  for (const limit of [0, -1, 1.2, 1001]) await assert.rejects(measureSnapshotEncoding(limit), RangeError);
  await assert.rejects(encodeSnapshot('{}', 'brotli'), /snapshot_unsupported_codec/);
  assert.equal((await decodeSnapshot(await encodeSnapshot('', 'gzip'))).text, '');
});
