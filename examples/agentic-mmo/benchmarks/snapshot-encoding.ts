import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyCommand, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { TURN_RULES } from '../core/content.ts';
import { DIRECTOR_SEAT, type TransitionResult } from '../core/types.ts';

export const SNAPSHOT_LIMITS = { utf8Bytes: 128 * 1024, compressedBytes: 144 * 1024, envelopeBytes: 200 * 1024 } as const;
type Codec = 'gzip' | 'deflate';
type Envelope = { version: 1; codec: Codec; utf8Bytes: number; sha256: string; data: string };
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const root = fileURLToPath(new URL('../', import.meta.url));
const epoch = '2026-10-16T00:00:00.000Z';
const registeredRulesId = 'settlement-recovery-1';

function utf8(bytes: Uint8Array): string {
  try { return decoder.decode(bytes); } catch { throw new TypeError('snapshot_invalid_utf8'); }
}
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function compressedBytes(data: string): Uint8Array<ArrayBuffer> {
  if (data.length > 4 * Math.ceil(SNAPSHOT_LIMITS.compressedBytes / 3)) throw new RangeError('snapshot_compressed_limit');
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new TypeError('snapshot_invalid_base64');
  let binary: string;
  try { binary = atob(data); } catch { throw new TypeError('snapshot_invalid_base64'); }
  if (binary.length > SNAPSHOT_LIMITS.compressedBytes) throw new RangeError('snapshot_compressed_limit');
  if (btoa(binary) !== data) throw new TypeError('snapshot_invalid_base64');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function transform(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, limit: number, chunkBytes: number, error: string) {
  let offset = 0;
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (offset === bytes.length) { controller.close(); return; }
      const next = Math.min(offset + chunkBytes, bytes.length);
      controller.enqueue(bytes.slice(offset, next));
      offset = next;
    },
  });
  const reader = input.pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let maximumChunkBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > limit - length) throw new RangeError(error);
      maximumChunkBytes = Math.max(maximumChunkBytes, value.byteLength);
      chunks.push(value);
      length += value.byteLength;
    }
  } catch (failure) {
    await reader.cancel(failure).catch(() => undefined);
    throw failure;
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { result.set(chunk, position); position += chunk.byteLength; }
  return { bytes: result, maximumChunkBytes };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseEnvelope(encoded: unknown): Envelope {
  if (typeof encoded !== 'string') throw new TypeError('snapshot_invalid_envelope');
  if (encoded.length > SNAPSHOT_LIMITS.envelopeBytes || encoder.encode(encoded).length > SNAPSHOT_LIMITS.envelopeBytes) throw new RangeError('snapshot_envelope_limit');
  let parsed: unknown;
  try { parsed = JSON.parse(encoded); } catch { throw new TypeError('snapshot_invalid_envelope'); }
  if (!isRecord(parsed)) throw new TypeError('snapshot_invalid_envelope');
  const value = parsed;
  if (Object.keys(value).length !== 5 || value.version !== 1 || (value.codec !== 'gzip' && value.codec !== 'deflate')
    || typeof value.utf8Bytes !== 'number' || !Number.isSafeInteger(value.utf8Bytes) || value.utf8Bytes < 0 || value.utf8Bytes > SNAPSHOT_LIMITS.utf8Bytes
    || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256) || typeof value.data !== 'string'
    || JSON.stringify(value) !== encoded) throw new TypeError('snapshot_invalid_envelope');
  return { version: 1, codec: value.codec, utf8Bytes: value.utf8Bytes, sha256: value.sha256, data: value.data };
}

export async function encodeSnapshot(text: string, codec: string): Promise<string> {
  if (codec !== 'gzip' && codec !== 'deflate') throw new TypeError('snapshot_unsupported_codec');
  if (text.length > SNAPSHOT_LIMITS.utf8Bytes) throw new RangeError('snapshot_input_limit');
  const bytes = encoder.encode(text);
  if (bytes.length > SNAPSHOT_LIMITS.utf8Bytes) throw new RangeError('snapshot_input_limit');
  if (utf8(bytes) !== text) throw new TypeError('snapshot_invalid_utf8');
  const compressed = await transform(bytes, new CompressionStream(codec), SNAPSHOT_LIMITS.compressedBytes, 16 * 1024, 'snapshot_compressed_limit');
  const value: Envelope = { version: 1, codec, utf8Bytes: bytes.length, sha256: await digest(bytes), data: base64(compressed.bytes) };
  const result = JSON.stringify(value);
  if (encoder.encode(result).length > SNAPSHOT_LIMITS.envelopeBytes) throw new RangeError('snapshot_envelope_limit');
  return result;
}

export async function decodeSnapshot(encoded: unknown): Promise<{ text: string; utf8Bytes: number; maximumChunkBytes: number }> {
  const envelope = parseEnvelope(encoded);
  const compressed = compressedBytes(envelope.data);
  const result = await transform(compressed, new DecompressionStream(envelope.codec), envelope.utf8Bytes, 1024, 'snapshot_decoded_limit');
  if (result.bytes.length !== envelope.utf8Bytes) throw new Error('snapshot_length_mismatch');
  if (await digest(result.bytes) !== envelope.sha256) throw new Error('snapshot_checksum_mismatch');
  return { text: utf8(result.bytes), utf8Bytes: result.bytes.length, maximumChunkBytes: result.maximumChunkBytes };
}

function* frames(transitions: number) {
  let state = createWorld(1701, epoch, registeredRulesId);
  for (let number = 1; number <= transitions; number += 1) {
    let result: TransitionResult;
    {
      const actorCount = DIRECTOR_SEAT + 1;
      const step = number - 1;
      const seat = step % (actorCount + 1);
      const beat = Math.floor(step / (actorCount + 1));
      const timestamp = new Date(Date.parse(epoch) + (beat + (seat === actorCount ? 1 : 0)) * TURN_RULES.strategyIntervalMs).toISOString();
      if (seat === actorCount) result = catchUpStrategy(state, timestamp);
      else {
        const options = legalActions(state, seat, timestamp);
        const choice = options.find((option) => option.action.type === 'research' && option.action.technology === 'agriculture')
          ?? options.find((option) => option.action.type === 'build' && option.action.project === 'farm')
          ?? options.find((option) => option.action.type === 'focus' && option.action.focus === 'growth')
          ?? options.find((option) => option.action.type === 'wait');
        assert.ok(choice);
        result = applyCommand(state, { seat, expectedRevision: state.revision, action: choice.action, timestamp });
      }
    }
    assert.ok(result.ok, result.error);
    state = result.state;
    assert.equal(state.revision, number);
    yield JSON.stringify(state);
  }
}
function visit(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? visit(path) : /\.(ts|sql)$/.test(entry.name) ? [path] : [];
  });
}
function identity() {
  const files = [...visit(join(root, 'core')), ...visit(join(root, 'server')), fileURLToPath(import.meta.url), join(root, 'benchmarks/hosted-storage.ts'), join(root, 'tests/snapshot-encoding.test.ts'), join(root, 'package.json'), join(root, 'package-lock.json')].toSorted().map((path) => {
    const bytes = readFileSync(path);
    return { path: relative(root, path), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  return { sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}
function timing(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  return { p50: sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0, p95: sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0, maximum: sorted.at(-1) ?? 0, total: values.reduce((sum, value) => sum + value, 0) };
}
function candidate(codec: Codec) {
  return { codec, roundTrips: 0, rawBytes: 0, compressedBytes: 0, base64Bytes: 0, base64OverheadBytes: 0, metadataBytes: 0, envelopeBytes: 0, maximumFrameBytes: 0, maximumEnvelopeBytes: 0, maximumDecodeChunkBytes: 0, cpu: { user: 0, system: 0 }, encode: [] as number[], decode: [] as number[] };
}
export async function measureSnapshotEncoding(transitions = 1000) {
  if (!Number.isSafeInteger(transitions) || transitions < 1 || transitions > 1000) throw new RangeError('Choose 1 through 1000 transitions');
  const source = identity();
  const candidates = [candidate('gzip'), candidate('deflate')];
  const controls: { transitions: number; rawBytes: number; finalSha256: string }[] = [];
  const before = process.memoryUsage();
  let sampledRssBytes = before.rss;
  let sampledHeapBytes = before.heapUsed;
  let sampledArrayBufferBytes = before.arrayBuffers;
  let number = 0;
  let rawBytes = 0;
  for (const text of frames(transitions)) {
    number += 1;
    const length = Buffer.byteLength(text);
    rawBytes += length;
    for (const current of number % 2 ? candidates : candidates.toReversed()) {
      const cpu = process.cpuUsage();
      const start = performance.now();
      const encoded = await encodeSnapshot(text, current.codec);
      const middle = performance.now();
      const decoded = await decodeSnapshot(encoded);
      const end = performance.now();
      const used = process.cpuUsage(cpu);
      assert.equal(decoded.text, text);
      const envelope = parseEnvelope(encoded);
      const compressed = compressedBytes(envelope.data).length;
      const encodedBytes = Buffer.byteLength(encoded);
      current.roundTrips += 1;
      current.rawBytes += length;
      current.compressedBytes += compressed;
      current.base64Bytes += envelope.data.length;
      current.base64OverheadBytes += envelope.data.length - compressed;
      current.metadataBytes += encodedBytes - envelope.data.length;
      current.envelopeBytes += encodedBytes;
      current.maximumFrameBytes = Math.max(current.maximumFrameBytes, length);
      current.maximumEnvelopeBytes = Math.max(current.maximumEnvelopeBytes, encodedBytes);
      current.maximumDecodeChunkBytes = Math.max(current.maximumDecodeChunkBytes, decoded.maximumChunkBytes);
      current.cpu.user += used.user;
      current.cpu.system += used.system;
      current.encode.push(middle - start);
      current.decode.push(end - middle);
    }
    const memory = process.memoryUsage();
    sampledRssBytes = Math.max(sampledRssBytes, memory.rss);
    sampledHeapBytes = Math.max(sampledHeapBytes, memory.heapUsed);
    sampledArrayBufferBytes = Math.max(sampledArrayBufferBytes, memory.arrayBuffers);
    if ([10, 100, 1000].includes(number) || number === transitions) controls.push({ transitions: number, rawBytes, finalSha256: createHash('sha256').update(text).digest('hex') });
  }
  assert.equal(identity().sha256, source.sha256, 'Measured source must remain unchanged');
  return {
    measuredAt: new Date().toISOString(), identity: source,
    environment: { node: process.version, platform: platform(), arch: arch(), localConstrainedMemoryBytes: process.constrainedMemory() },
    workload: { provenance: 'synthetic-deterministic-driver', seed: 1701, epoch, registeredRulesId, description: 'Same fresh registered configuration and six-action/one-beat sequence as hosted-storage.ts; tests independently compare raw sample totals and state hashes against actual repository storage.' },
    frames: number, controls, limits: SNAPSHOT_LIMITS,
    candidates: candidates.map(({ encode, decode, ...current }) => ({ ...current, encodeMs: timing(encode), decodeMs: timing(decode) })),
    memory: { before, after: process.memoryUsage(), sampledRssBytes, sampledHeapBytes, sampledArrayBufferBytes, processPeakRssBytes: process.resourceUsage().maxRSS * 1024, sampling: 'After each frame; process-wide high water includes startup and prior work. Neither sampled deltas nor RSS establish a Worker peak or native codec allocation bound.' },
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.length > 2) throw new Error('Usage: node benchmarks/snapshot-encoding.ts');
  process.stdout.write(`${JSON.stringify(await measureSnapshotEncoding(), null, 2)}\n`);
}
