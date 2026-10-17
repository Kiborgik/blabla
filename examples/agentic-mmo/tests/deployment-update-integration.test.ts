import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createViewerUpdates, preferencesAfterUpdate, updateHistoryState } from '../web/viewer-updates.ts';
import type { ViewerUpdatePorts, UpdateNotice } from '../web/viewer-updates.ts';
import { DEFAULT_PREFERENCES } from '../web/viewer-state.ts';
import { UPDATE_COOLDOWN_MS, UPDATE_RETRY_PARAM } from '../web/deployment-update.ts';

const old = { schemaVersion: 1 as const, version: 'local-old', buildId: 'local-old', publishedAt: '2026-10-16T12:00:00Z' };
const next = { ...old, version: 'local-new', buildId: 'local-new', publishedAt: '2026-10-16T14:00:00Z' };
const prefs = { ...DEFAULT_PREFERENCES, selectedCity: 'frontier-town', theme: 'dark' as const, effects: 'calm' as const, x: 7, zoom: 1.7 };
function fixture(overrides: Partial<ViewerUpdatePorts> = {}) {
  let time = Date.parse('2026-10-16T15:00:00Z'); let href = 'https://viewer.example/?other=keep#events';
  let attempt: string | null = null; let history: unknown = { unrelated: { scroll: 19 }, route: ['keep'] };
  const notices: (UpdateNotice | null)[] = []; const navigations: { href: string; reload: boolean }[] = []; const saved: unknown[] = [];
  const ports: ViewerUpdatePorts = { current: old, fetchRelease: async () => next, now: () => time, href: () => href, preferences: () => prefs,
    attempts: { read: () => attempt, write: (value) => { attempt = value; } }, readHistory: () => history,
    replaceHistory: (state, url) => { history = state; href = url; }, savePreferences: (value) => { saved.push(structuredClone(value)); },
    navigate: (url, reload) => { navigations.push({ href: url, reload }); }, notice: (value) => { notices.push(value); }, ...overrides };
  return { ports, notices, navigations, saved, history: () => history, href: () => href, advance: () => { time += UPDATE_COOLDOWN_MS; } };
}

void test('single-flight manifest reads and a consumed decision allow one navigation per document', async () => {
  let calls = 0; let release: ((value: unknown) => void) | undefined;
  const f = fixture({ fetchRelease: () => { calls += 1; return new Promise((resolve) => { release = resolve; }); } });
  const viewer = createViewerUpdates(f.ports); const one = viewer.check(); const two = viewer.check();
  assert.equal(calls, 1); release?.(next); await Promise.all([one, two]); await viewer.check();
  assert.equal(f.navigations.length, 1); assert.equal(calls, 1); assert.equal(f.navigations[0]?.reload, true);
  assert.equal(new URL(f.href()).searchParams.get('other'), 'keep'); assert.equal(new URL(f.href()).hash, '#events');
  assert.doesNotMatch(f.navigations[0]?.href ?? '', /frontier-town|theme|zoom/);
  f.advance(); await viewer.check(); assert.equal(f.notices.at(-1)?.action, 'update'); assert.equal(f.navigations.length, 1);
});

void test('throwing session storage still navigates and compatible preferences survive in history', async () => {
  const f = fixture({ attempts: { read: () => { throw new DOMException('blocked', 'SecurityError'); }, write: () => { throw new Error('full'); } }, savePreferences: () => { throw new Error('denied'); } });
  const previous = structuredClone(f.history()); await createViewerUpdates(f.ports).check();
  assert.equal(f.navigations.length, 1); assert.deepEqual(preferencesAfterUpdate(next.buildId, null, f.history()), prefs);
  assert.deepEqual(updateHistoryState(f.history()), previous);
  assert.deepEqual(preferencesAfterUpdate('unrelated', null, f.history()), DEFAULT_PREFERENCES);
});

void test('startup restores every unknown history value and cleans only the successful marker without navigating', async () => {
  for (const previous of [undefined, null, 7, 'keep', ['a', { nested: 9 }], { arbitrary: { token: 'local-only' } }]) {
    const f = fixture({ readHistory: () => previous }); await createViewerUpdates(f.ports).check();
    const wrapped = f.history(); let restored: unknown; let cleaned = '';
    const loaded = fixture({ current: next, href: f.href, readHistory: () => wrapped, replaceHistory: (state, href) => { restored = state; cleaned = href; }, fetchRelease: async () => next });
    await createViewerUpdates(loaded.ports).check();
    assert.deepEqual(restored, previous); assert.equal(new URL(cleaned).searchParams.has(UPDATE_RETRY_PARAM), false);
    assert.equal(new URL(cleaned).hash, '#events'); assert.equal(loaded.navigations.length, 0);
  }
});

void test('stale first HTML gets a cooled second attempt then stops automatically', async () => {
  const f = fixture(); await createViewerUpdates(f.ports).check();
  const stale = createViewerUpdates(f.ports); await stale.check(); assert.equal(f.navigations.length, 1);
  assert.equal(f.notices.at(-1)?.action, 'update'); f.advance(); await stale.check(); assert.equal(f.navigations.length, 2);
  const stillStale = createViewerUpdates(f.ports); await stillStale.check();
  assert.match(f.notices.at(-1)?.message ?? '', /two tries/); assert.equal(f.notices.at(-1)?.action, 'update');
  for (let i = 0; i < 5; i += 1) { f.advance(); await stillStale.check(); }
  assert.equal(f.navigations.length, 2); stillStale.act(); assert.equal(f.navigations.length, 3);
});

void test('failed history write falls back to marker-bearing navigation when settings storage works', async () => {
  const f = fixture({ replaceHistory: () => { throw new DOMException('cannot clone', 'DataCloneError'); } });
  await createViewerUpdates(f.ports).check(); assert.equal(f.navigations.length, 1); assert.equal(f.navigations[0]?.reload, false);
  assert.ok(new URL(f.navigations[0]?.href ?? '').searchParams.get(UPDATE_RETRY_PARAM)); assert.deepEqual(f.saved, [prefs]);
});

void test('all persistence failures require a readable explicit update with a settings warning', async () => {
  const f = fixture({ savePreferences: () => { throw new Error('unavailable'); }, readHistory: () => { throw new Error('unavailable'); }, attempts: { read: () => { throw new Error('unavailable'); }, write: () => { throw new Error('unavailable'); } } });
  const viewer = createViewerUpdates(f.ports); await viewer.check();
  assert.equal(f.navigations.length, 0); assert.match(f.notices.at(-1)?.message ?? '', /settings may reset/); assert.equal(f.notices.at(-1)?.action, 'update');
  f.advance(); await viewer.check(); assert.match(f.notices.at(-1)?.message ?? '', /settings may reset/); assert.equal(f.navigations.length, 0); viewer.act(); assert.equal(f.navigations.length, 1);
  assert.equal(f.navigations[0]?.reload, false);
});

void test('navigation failure stays manual and cannot trigger a polling loop', async () => {
  let tries = 0; const f = fixture({ navigate: () => { tries += 1; throw new Error('navigation refused'); } });
  const viewer = createViewerUpdates(f.ports); await viewer.check(); await viewer.check(); f.advance(); await viewer.check();
  assert.equal(tries, 1); assert.equal(f.notices.at(-1)?.action, 'update'); viewer.act(); assert.equal(tries, 2);
});

void test('a failed manifest read releases single-flight state for a later check', async () => {
  let reads = 0; const f = fixture({ fetchRelease: async () => { reads += 1; if (reads === 1) throw new Error('offline'); return next; } });
  const viewer = createViewerUpdates(f.ports); await viewer.check(); assert.equal(f.notices.at(-1)?.action, 'check');
  await viewer.check(); assert.equal(reads, 2); assert.equal(f.navigations.length, 1);
});

void test('unchanged or invalid manifests never write preferences or navigate', async () => {
  for (const remote of [old, null, { ...next, schemaVersion: 2 }]) {
    const f = fixture({ fetchRelease: async () => remote }); await createViewerUpdates(f.ports).check();
    assert.equal(f.navigations.length, 0); assert.equal(f.saved.length, 0);
  }
});

void test('disposal prevents an in-flight response from navigating or presenting a stale notice', async () => {
  let release: ((value: unknown) => void) | undefined;
  const f = fixture({ fetchRelease: () => new Promise((resolve) => { release = resolve; }) });
  const viewer = createViewerUpdates(f.ports); const pending = viewer.check(); viewer.dispose(); release?.(next); await pending;
  assert.equal(f.navigations.length, 0); assert.equal(f.notices.length, 0); await viewer.check(); viewer.act(); assert.equal(f.navigations.length, 0);
});

void test('manual update saves the latest camera rather than the old polling snapshot', async () => {
  let preferences = prefs;
  const f = fixture({ preferences: () => preferences }); const first = createViewerUpdates(f.ports); await first.check();
  const stale = createViewerUpdates(f.ports); await stale.check(); preferences = { ...prefs, x: 42 }; stale.act();
  assert.equal(preferencesAfterUpdate(next.buildId, null, f.history()).x, 42);
});
