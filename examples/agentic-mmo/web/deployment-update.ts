import { parsePreferences, parseRelease } from './viewer-state.ts';
import type { Release, ViewerPreferences } from './viewer-state.ts';

export const UPDATE_RETRY_PARAM = 'civitas_update';
export const UPDATE_COOLDOWN_MS = 30_000;
export interface UpdateAttempt { schemaVersion: 1; from: string; to: string; count: 1 | 2; at: number; targetTime: number }
export interface PreferenceCarry { schemaVersion: 1; from: string; to: string; preferences: ViewerPreferences }
export interface UpdateRequest { current: Release; remote: unknown; url: string; now: number; preferences: unknown; stored?: unknown }
export interface UpdatePlan {
  status: 'current' | 'invalid' | 'stale-manifest' | 'cooldown' | 'exhausted' | 'reload';
  href: string | null; retryAt: number | null; attempt: UpdateAttempt | null; preferences: ViewerPreferences; carry: PreferenceCarry | null;
}
export interface UpdateStorage { read: () => string | null; write: (value: string) => void }
export interface PreparedUpdate { plan: UpdatePlan; storageRead: 'stored' | 'empty' | 'malformed' | 'failed'; storageWrite: 'saved' | 'skipped' | 'failed' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function buildId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
}

function parseAttempt(value: unknown, now: number): UpdateAttempt | null {
  const data = record(value);
  if (!data || data['schemaVersion'] !== 1 || !buildId(data['from']) || !buildId(data['to']) || data['from'] === data['to']
    || (data['count'] !== 1 && data['count'] !== 2) || typeof data['at'] !== 'number' || !Number.isSafeInteger(data['at']) || data['at'] < 0
    || typeof data['targetTime'] !== 'number' || !Number.isSafeInteger(data['targetTime']) || data['targetTime'] < 0) return null;
  return { schemaVersion: 1, from: data['from'], to: data['to'], count: data['count'], at: data['at'] > now ? 0 : data['at'], targetTime: data['targetTime'] };
}

function marker(url: URL, now: number): UpdateAttempt | null {
  const values = url.searchParams.getAll(UPDATE_RETRY_PARAM);
  const value = values[0];
  if (values.length !== 1 || !value || value.length > 2048) return null;
  try { return parseAttempt(JSON.parse(value) as unknown, now); } catch { return null; }
}

export function planDeploymentUpdate(input: UpdateRequest): UpdatePlan {
  const base: UpdatePlan = { status: 'invalid', href: null, retryAt: null, attempt: null, preferences: parsePreferences(input.preferences), carry: null };
  const current = parseRelease(input.current);
  const remote = parseRelease(input.remote);
  let url: URL;
  try { url = new URL(input.url); } catch { return base; }
  if (!['http:', 'https:'].includes(url.protocol) || !Number.isSafeInteger(input.now) || input.now < 0
    || !current || !remote || !buildId(current.buildId) || !buildId(remote.buildId)) return base;
  const fromUrl = marker(url, input.now);
  const fromStore = parseAttempt(input.stored, input.now);
  const targetTime = Date.parse(remote.publishedAt);
  if (remote.buildId === current.buildId || targetTime <= Date.parse(current.publishedAt)) {
    if (fromUrl?.to === current.buildId) { url.searchParams.delete(UPDATE_RETRY_PARAM); return { ...base, status: 'current', href: url.href }; }
    return { ...base, status: 'current' };
  }
  const previous = [fromUrl, fromStore].filter((attempt): attempt is UpdateAttempt => attempt !== null && attempt.from === current.buildId);
  if (previous.some((attempt) => attempt.to !== remote.buildId && attempt.targetTime >= targetTime)) return { ...base, status: 'stale-manifest' };
  const matching = previous.filter((attempt) => attempt.to === remote.buildId);
  if (Array.isArray(input.stored) && input.stored.slice(-20).includes(remote.buildId))
    matching.push({ schemaVersion: 1, from: current.buildId, to: remote.buildId, count: 1, at: 0, targetTime });
  const count = matching.reduce((maximum, attempt) => Math.max(maximum, attempt.count), 0);
  const at = matching.reduce((latest, attempt) => Math.max(latest, attempt.at), 0);
  const retained: UpdateAttempt | null = count ? { schemaVersion: 1, from: current.buildId, to: remote.buildId, count: count >= 2 ? 2 : 1, at, targetTime } : null;
  if (count >= 2) return { ...base, status: 'exhausted', attempt: retained };
  if (count && input.now < at + UPDATE_COOLDOWN_MS) return { ...base, status: 'cooldown', retryAt: at + UPDATE_COOLDOWN_MS, attempt: retained };
  const attempt: UpdateAttempt = { schemaVersion: 1, from: current.buildId, to: remote.buildId, count: count ? 2 : 1, at: input.now, targetTime };
  url.searchParams.set(UPDATE_RETRY_PARAM, JSON.stringify(attempt));
  return { ...base, status: 'reload', href: url.href, attempt, carry: { schemaVersion: 1, from: current.buildId, to: remote.buildId, preferences: { ...base.preferences } } };
}

export function prepareDeploymentUpdate(input: Omit<UpdateRequest, 'stored'>, storage: UpdateStorage): PreparedUpdate {
  let stored: unknown = null;
  let storageRead: PreparedUpdate['storageRead'] = 'empty';
  try {
    const value = storage.read();
    if (value !== null) {
      if (value.length > 16_384) storageRead = 'malformed';
      else try { stored = JSON.parse(value) as unknown; storageRead = 'stored'; } catch { storageRead = 'malformed'; }
    }
  } catch { storageRead = 'failed'; }
  const plan = planDeploymentUpdate({ ...input, stored });
  let storageWrite: PreparedUpdate['storageWrite'] = 'skipped';
  if (plan.status === 'reload' && plan.attempt) {
    try { storage.write(JSON.stringify(plan.attempt)); storageWrite = 'saved'; } catch { storageWrite = 'failed'; }
  }
  return { plan, storageRead, storageWrite };
}

export function restoreDeploymentPreferences(currentBuild: string, stored: unknown, carry: unknown): ViewerPreferences {
  const data = record(carry);
  const preferences = record(data?.['preferences']);
  return data?.['schemaVersion'] === 1 && buildId(data['from']) && buildId(data['to'])
    && (data['from'] === currentBuild || data['to'] === currentBuild) && preferences?.['schemaVersion'] === 1
    ? parsePreferences(preferences) : parsePreferences(stored);
}
