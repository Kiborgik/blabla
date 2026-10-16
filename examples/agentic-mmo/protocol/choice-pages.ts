import { observeCompactTrade, type CompactTradeObservation } from '../core/observation.ts';
import { parseUtcTimestamp } from '../core/simulation/time.ts';
import type { ActionOption, GameAction, WorldState } from '../core/types.ts';

export const CHOICE_PAGE_FORMAT = 'compact-trade-pages-v1';
export const CHOICE_PAGE_LIMIT = 20;
const maximumCursorBytes = 2048;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export class ChoicePageError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: string, details: Record<string, unknown> = {}) { super(code); this.status = status; this.code = code; this.details = details; }
}

interface ChoiceCursor { v: 1; run: string; seat: number; revision: number; time: string | null; limit: 20; next: number; digest: string }
export interface ChoicePageRequest { seat: number | undefined; observedAt: string | null; mode: 'host' | 'cli'; cursor: ChoiceCursor | null }
export interface ChoicePageSource { initial: WorldState; state: WorldState; scope: string; lastValid?: boolean }
type IndexedOption = ActionOption & { choice: number };
type ChoiceContext = Omit<CompactTradeObservation, 'legalActions'> & { releaseId: string; unlockedFeatures: string[]; calendarMilestones: string[]; clockEpoch: string | null; clockTicks: number; serverTimestamp?: string; last_valid?: boolean };
export interface ChoicePage {
  observationFormat: typeof CHOICE_PAGE_FORMAT;
  page: { runFingerprint: string; revision: number; seat: number; observedAt: string | null; viewDigest: string; offset: number; limit: 20; total: number; nextCursor: string | null };
  context?: ChoiceContext;
  legalActions: Array<IndexedOption & { actionId: string }>;
}

function invalid(): ChoicePageError { return new ChoicePageError(400, 'invalid_choice_cursor'); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value); }
function hashString(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
function utc(value: unknown): value is string { return typeof value === 'string' && parseUtcTimestamp(value) !== null; }

function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new ChoicePageError(503, 'invalid_choice_page_value');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    const entries: string[] = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) throw new ChoicePageError(503, 'invalid_choice_page_value');
      entries.push(canonical(value[index], depth + 1));
    }
    return `[${entries.join(',')}]`;
  }
  if (record(value)) return `{${Object.keys(value).toSorted().map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
  throw new ChoicePageError(503, 'invalid_choice_page_value');
}

async function digest(value: unknown): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonical(value))));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function encodeCursor(value: ChoiceCursor): string {
  return btoa(String.fromCharCode(...encoder.encode(canonical(value)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeCursor(input: unknown): ChoiceCursor {
  if (typeof input !== 'string' || input.length === 0 || input.length > maximumCursorBytes || !/^[A-Za-z0-9_-]+$/.test(input)) throw invalid();
  let value: unknown;
  try {
    const binary = atob(input.replaceAll('-', '+').replaceAll('_', '/'));
    value = JSON.parse(decoder.decode(Uint8Array.from(binary, character => character.charCodeAt(0))));
  } catch { throw invalid(); }
  if (!record(value) || Object.keys(value).length !== 8 || value.v !== 1 || value.limit !== CHOICE_PAGE_LIMIT
    || !hashString(value.run) || !hashString(value.digest) || !integer(value.seat) || value.seat < 0 || value.seat > 5
    || !integer(value.revision) || value.revision < 0 || !integer(value.next) || value.next < CHOICE_PAGE_LIMIT || value.next % CHOICE_PAGE_LIMIT !== 0
    || !(value.time === null || utc(value.time))) throw invalid();
  const result: ChoiceCursor = { v: 1, run: value.run, seat: value.seat, revision: value.revision, time: value.time, limit: CHOICE_PAGE_LIMIT, next: value.next, digest: value.digest };
  if (encodeCursor(result) !== input) throw invalid();
  return result;
}

export function parseChoicePageRequest(input: Record<string, unknown>, mode: 'host' | 'cli', timestamp?: string): ChoicePageRequest {
  if (Object.keys(input).some(key => !['seat', 'choiceCursor', 'timestamp'].includes(key))) throw invalid();
  if (input.seat !== undefined && (!integer(input.seat) || input.seat < 0 || input.seat > 5)) throw new ChoicePageError(400, 'invalid_seat');
  const cursor = input.choiceCursor === undefined ? null : decodeCursor(input.choiceCursor);
  if (input.timestamp !== undefined && (mode === 'host' || cursor !== null)) throw invalid();
  if (mode === 'host' && !utc(timestamp)) throw new ChoicePageError(400, 'invalid_utc_timestamp');
  if (mode === 'cli' && input.timestamp !== undefined && !utc(input.timestamp)) throw new ChoicePageError(400, 'invalid_utc_timestamp');
  if (cursor && input.seat !== undefined && input.seat !== cursor.seat) throw invalid();
  if (cursor && mode === 'host' && (cursor.time === null || Date.parse(cursor.time) > Date.parse(timestamp ?? ''))) throw invalid();
  const observedAt = cursor ? cursor.time : mode === 'host' ? timestamp ?? null : typeof input.timestamp === 'string' ? input.timestamp : null;
  return { seat: input.seat === undefined ? cursor?.seat : input.seat, observedAt, mode, cursor };
}

export async function choiceActionId(action: GameAction): Promise<string> { return digest({ version: 1, action }); }

export async function createChoicePage(source: ChoicePageSource, request: ChoicePageRequest): Promise<ChoicePage> {
  const state = source.state;
  const seat = request.seat ?? state.phase;
  const runFingerprint = await digest({ scope: source.scope, initial: source.initial });
  const stale = (reason: string): ChoicePageError => new ChoicePageError(409, 'stale_choice_cursor', { revision: state.revision, reason });
  if (request.cursor?.run !== undefined && request.cursor.run !== runFingerprint) throw stale('run_changed');
  if (request.cursor && request.cursor.revision !== state.revision) throw stale('revision_changed');
  const observedAt = request.observedAt;
  const compact = observeCompactTrade(state, seat, observedAt ?? undefined);
  const indexed = compact.legalActions.map((option, choice) => ({ choice, ...option }));
  const view = {
    ...compact,
    releaseId: state.releaseId,
    unlockedFeatures: state.unlockedFeatures,
    calendarMilestones: state.calendarMilestones,
    clockEpoch: state.clockEpoch ?? null,
    clockTicks: state.clockTicks ?? 0,
    ...(request.mode === 'host' && observedAt !== null ? { serverTimestamp: observedAt } : {}),
    ...(request.mode === 'cli' && source.lastValid !== undefined ? { last_valid: source.lastValid } : {}),
    legalActions: indexed,
  };
  const viewDigest = await digest({ format: CHOICE_PAGE_FORMAT, orderVersion: 1, runFingerprint, seat, revision: state.revision, observedAt, view });
  if (request.cursor && request.cursor.digest !== viewDigest) throw stale('projection_changed');
  const offset = request.cursor?.next ?? 0;
  if (request.cursor && offset >= indexed.length) throw invalid();
  const end = Math.min(offset + CHOICE_PAGE_LIMIT, indexed.length);
  const nextCursor = end < indexed.length ? encodeCursor({ v: 1, run: runFingerprint, seat, revision: state.revision, time: observedAt, limit: CHOICE_PAGE_LIMIT, next: end, digest: viewDigest }) : null;
  const { legalActions, ...context } = view;
  const options = await Promise.all(legalActions.slice(offset, end).map(async option => ({ ...option, actionId: await choiceActionId(option.action) })));
  return structuredClone({
    observationFormat: CHOICE_PAGE_FORMAT,
    page: { runFingerprint, revision: state.revision, seat, observedAt, viewDigest, offset, limit: CHOICE_PAGE_LIMIT, total: indexed.length, nextCursor },
    ...(offset === 0 ? { context } : {}),
    legalActions: options,
  });
}
