import { parseUtcTimestamp } from '../core/simulation/clock.ts';
import { type WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';

export class RequestFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: string, details: Record<string, unknown> = {}) { super(code); this.status = status; this.code = code; this.details = details; }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new RequestFailure(400, 'object_required');
  return value;
}

export function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function boundedInteger(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!safeInteger(value) || value < minimum || value > maximum) throw new RequestFailure(400, `invalid_${field}`);
  return value;
}

export function text(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) throw new RequestFailure(400, `invalid_${field}`);
  return value;
}

export function utc(value: unknown): string {
  if (typeof value !== 'string' || parseUtcTimestamp(value) === null) throw new RequestFailure(400, 'invalid_utc_timestamp');
  return value;
}

export function canonical(value: unknown, depth = 0): string {
  if (depth > 16) throw new RequestFailure(400, 'json_nesting_too_deep');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry: unknown) => canonical(entry, depth + 1)).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).toSorted((left, right) => left < right ? -1 : left > right ? 1 : 0).map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
  throw new RequestFailure(400, 'invalid_json_value');
}

export function assertWorld(value: unknown): asserts value is WorldState {
  if (!isWorldState(value)) throw new RequestFailure(503, 'corrupt_or_incompatible_world');
}

export function parseJson(value: string): unknown {
  try { const parsed: unknown = JSON.parse(value); return parsed; } catch { throw new RequestFailure(503, 'corrupt_persisted_json'); }
}
