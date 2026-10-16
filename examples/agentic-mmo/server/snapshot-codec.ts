import type { WorldState } from '../core/types.ts';
import { assertWorld, isRecord, parseJson, RequestFailure } from './validation.ts';

export const HISTORY_SNAPSHOT_PREFIX = 'blabla-snapshot:';
export const HISTORY_SNAPSHOT_LIMITS = { utf8Bytes: 128 * 1024, compressedBytes: 144 * 1024, envelopeBytes: 200 * 1024 } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function corrupt(): RequestFailure { return new RequestFailure(503, 'corrupt_history_snapshot'); }

function envelope(serialized: string) {
  if (serialized.length - HISTORY_SNAPSHOT_PREFIX.length > HISTORY_SNAPSHOT_LIMITS.envelopeBytes) throw new RequestFailure(503, 'history_snapshot_envelope_limit');
  const text = serialized.slice(HISTORY_SNAPSHOT_PREFIX.length);
  if (encoder.encode(text).length > HISTORY_SNAPSHOT_LIMITS.envelopeBytes) throw new RequestFailure(503, 'history_snapshot_envelope_limit');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw corrupt(); }
  if (!isRecord(value) || Object.keys(value).length !== 5 || JSON.stringify(value) !== text
    || typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || typeof value.codec !== 'string'
    || typeof value.utf8Bytes !== 'number' || !Number.isSafeInteger(value.utf8Bytes) || value.utf8Bytes < 0
    || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256) || typeof value.data !== 'string') throw corrupt();
  if (value.version !== 1 || value.codec !== 'gzip') throw new RequestFailure(503, 'unsupported_snapshot_encoding');
  if (value.utf8Bytes > HISTORY_SNAPSHOT_LIMITS.utf8Bytes) throw new RequestFailure(503, 'history_snapshot_decoded_limit');
  return { utf8Bytes: value.utf8Bytes, sha256: value.sha256, data: value.data };
}

function compressedBytes(data: string): Uint8Array<ArrayBuffer> {
  if (data.length > 4 * Math.ceil(HISTORY_SNAPSHOT_LIMITS.compressedBytes / 3)) throw new RequestFailure(503, 'history_snapshot_compressed_limit');
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw corrupt();
  let binary: string;
  try { binary = atob(data); } catch { throw corrupt(); }
  if (binary.length > HISTORY_SNAPSHOT_LIMITS.compressedBytes) throw new RequestFailure(503, 'history_snapshot_compressed_limit');
  if (btoa(binary) !== data) throw corrupt();
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function inflate(bytes: Uint8Array<ArrayBuffer>, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  let offset = 0;
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (offset === bytes.length) { controller.close(); return; }
      const next = Math.min(offset + 1024, bytes.length);
      controller.enqueue(bytes.slice(offset, next));
      offset = next;
    },
  });
  const reader = input.pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > limit - length) throw new RequestFailure(503, 'history_snapshot_decoded_limit');
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
  return result;
}

async function decodeEnvelope(serialized: string): Promise<string> {
  const value = envelope(serialized);
  const compressed = compressedBytes(value.data);
  try {
    const bytes = await inflate(compressed, value.utf8Bytes);
    if (bytes.length !== value.utf8Bytes) throw corrupt();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== value.sha256) throw corrupt();
    return decoder.decode(bytes);
  } catch (failure) {
    if (failure instanceof RequestFailure) throw failure;
    throw corrupt();
  }
}

export async function decodeHistorySnapshot(serialized: string): Promise<WorldState> {
  const state = parseJson(serialized.startsWith(HISTORY_SNAPSHOT_PREFIX) ? await decodeEnvelope(serialized) : serialized);
  assertWorld(state);
  return state;
}
