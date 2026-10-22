import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planDeploymentUpdate, prepareDeploymentUpdate, restoreDeploymentPreferences, UPDATE_COOLDOWN_MS, UPDATE_RETRY_PARAM } from '../web/deployment-update.ts';
import type { UpdatePlan, UpdateRequest, UpdateStorage } from '../web/deployment-update.ts';
import { DEFAULT_PREFERENCES, shouldReload } from '../web/viewer-state.ts';
import { createWorldViewSession, saveWorldView } from '../web/world-view.ts';

const current = { schemaVersion: 1 as const, version: '0.1.0-live.9', buildId: 'build-nine', publishedAt: '2026-10-16T12:00:00Z' };
const remote = { ...current, version: '0.1.0-live.10', buildId: 'build-ten', publishedAt: '2026-10-16T14:00:00Z' };
const now = Date.parse('2026-10-16T15:00:00Z');
const preferences = { ...DEFAULT_PREFERENCES, zoom: 1.6, x: 3, z: -8, selected: 1, selectedCity: 'frontier', theme: 'dark' as const, effects: 'calm' as const };

void test('deployment carry retains source-qualified cameras without carrying a world state or exposing identities in URLs', () => {
  const identity = { source: 'previous' as const, identity: 'private-origin-1701', body: 'earth' };
  const qualified = saveWorldView(preferences, identity, preferences);
  const plan = planDeploymentUpdate(request({ preferences: { ...qualified, state: { revision: 999 } } }));
  assert.ok(plan.carry); assert.deepEqual(plan.preferences, qualified);
  const loaded = restoreDeploymentPreferences(remote.buildId, DEFAULT_PREFERENCES, plan.carry);
  assert.equal(loaded.worldSource, 'previous'); assert.deepEqual(loaded.worldViews, qualified.worldViews);
  const view = createWorldViewSession().observe(loaded, identity);
  assert.equal(view.restored, true); assert.equal(view.preferences.selectedCity, preferences.selectedCity);
  assert.doesNotMatch(plan.href ?? '', /private-origin|frontier|zoom/);
  assert.equal('state' in plan.carry.preferences, false);
});
function request(overrides: Partial<UpdateRequest> = {}): UpdateRequest { return { current, remote, url: 'https://viewer.example/atlas?sample=0&other=keep#events', now, preferences, ...overrides }; }
function storage(initial: string | null = null): { port: UpdateStorage; writes: string[] } {
  const writes: string[] = [];
  return { port: { read: () => initial, write: (value) => { writes.push(value); } }, writes };
}

void test('newer validated deployment plans an observational same-origin first attempt', () => {
  const input = request(); const before = structuredClone(input); const plan = planDeploymentUpdate(input);
  assert.equal(plan.status, 'reload'); assert.equal(plan.attempt?.count, 1); assert.ok(plan.href);
  const href = new URL(plan.href);
  assert.equal(href.origin, 'https://viewer.example'); assert.equal(href.pathname, '/atlas'); assert.equal(href.searchParams.get('other'), 'keep'); assert.equal(href.hash, '#events');
  assert.ok(href.searchParams.get(UPDATE_RETRY_PARAM)); assert.deepEqual(input, before);
  assert.doesNotMatch(plan.href, /frontier|zoom|theme|world|dark/);
});

void test('same older invalid or ambiguous-time releases never cause navigation', () => {
  for (const value of [current, { ...remote, publishedAt: current.publishedAt }, { ...remote, publishedAt: '2020-01-01' }, null, { ...remote, schemaVersion: 2 }, { ...remote, buildId: 'x'.repeat(300) }]) {
    assert.notEqual(planDeploymentUpdate(request({ remote: value })).status, 'reload');
  }
  assert.equal(planDeploymentUpdate(request({ url: 'javascript:alert(1)' })).status, 'invalid');
  assert.equal(planDeploymentUpdate(request({ now: Number.NaN })).status, 'invalid');
});

void test('actual throwing storage read and write cannot suppress the first update plan', () => {
  let writes = 0;
  const prepared = prepareDeploymentUpdate(request(), { read: () => { throw new DOMException('blocked', 'SecurityError'); }, write: () => { writes += 1; throw new DOMException('full', 'QuotaExceededError'); } });
  assert.equal(prepared.storageRead, 'failed'); assert.equal(prepared.storageWrite, 'failed'); assert.equal(writes, 1);
  assert.equal(prepared.plan.status, 'reload'); assert.ok(prepared.plan.href);
});

void test('working storage records attempts and malformed JSON is reported without aborting', () => {
  const valid = storage(); const first = prepareDeploymentUpdate(request(), valid.port);
  assert.equal(first.storageRead, 'empty'); assert.equal(first.storageWrite, 'saved'); assert.equal(valid.writes.length, 1);
  const again = prepareDeploymentUpdate(request(), storage(valid.writes[0] ?? null).port);
  assert.equal(again.storageRead, 'stored'); assert.equal(again.plan.status, 'cooldown'); assert.equal(again.storageWrite, 'skipped');
  const bad = prepareDeploymentUpdate(request(), storage('{broken').port);
  assert.equal(bad.storageRead, 'malformed'); assert.equal(bad.plan.status, 'reload');
});

void test('stale HTML gets one cooled retry from the URL even when storage fails again', () => {
  const denied: UpdateStorage = { read: () => { throw new Error('unavailable'); }, write: () => { throw new Error('unavailable'); } };
  const first = prepareDeploymentUpdate(request(), denied).plan; assert.ok(first.href);
  const cool = prepareDeploymentUpdate(request({ url: first.href, now: now + UPDATE_COOLDOWN_MS - 1 }), denied).plan;
  assert.equal(cool.status, 'cooldown'); assert.equal(cool.retryAt, now + UPDATE_COOLDOWN_MS);
  const retry = prepareDeploymentUpdate(request({ url: first.href, now: now + UPDATE_COOLDOWN_MS }), denied).plan;
  assert.equal(retry.status, 'reload'); assert.equal(retry.attempt?.count, 2); assert.ok(retry.href);
  assert.notEqual(retry.href, first.href);
  for (let index = 0; index < 12; index += 1) {
    const exhausted: UpdatePlan = prepareDeploymentUpdate(request({ url: retry.href, now: now + UPDATE_COOLDOWN_MS * (index + 2) }), denied).plan;
    assert.equal(exhausted.status, 'exhausted'); assert.equal(exhausted.href, null);
  }
});

void test('legacy forever-attempted IDs get only a bounded remaining retry', () => {
  assert.equal(shouldReload(current, remote, [remote.buildId]), false);
  const migrated = planDeploymentUpdate(request({ stored: ['older-build', remote.buildId] }));
  assert.equal(migrated.status, 'reload'); assert.equal(migrated.attempt?.count, 2);
  assert.equal(planDeploymentUpdate(request({ stored: migrated.attempt, now: now + UPDATE_COOLDOWN_MS })).status, 'exhausted');
});

void test('loaded target clears only its URL marker and newer deployments receive a fresh allowance', () => {
  const first = planDeploymentUpdate(request()); assert.ok(first.href);
  const loaded = planDeploymentUpdate(request({ current: remote, url: first.href }));
  assert.equal(loaded.status, 'current'); assert.ok(loaded.href); assert.equal(new URL(loaded.href).searchParams.has(UPDATE_RETRY_PARAM), false);
  assert.equal(new URL(loaded.href).searchParams.get('other'), 'keep'); assert.equal(new URL(loaded.href).hash, '#events');
  const newer = { ...remote, buildId: 'build-eleven', publishedAt: '2026-10-16T14:30:00Z' };
  assert.equal(planDeploymentUpdate(request({ remote: newer, stored: { ...first.attempt, count: 2 } })).attempt?.count, 1);
});

void test('a stale manifest cannot oscillate the target and restart a consumed allowance', () => {
  const first = planDeploymentUpdate(request()); assert.ok(first.href);
  const olderTarget = { ...remote, buildId: 'older-target', publishedAt: '2026-10-16T13:00:00Z' };
  assert.equal(planDeploymentUpdate(request({ remote: olderTarget, url: first.href })).status, 'stale-manifest');
  assert.equal(planDeploymentUpdate(request({ remote: { ...remote, buildId: 'same-time-other' }, url: first.href })).status, 'stale-manifest');
});

void test('malformed markers cannot force a redirect or borrow a different source budget', () => {
  for (const marker of ['{bad', JSON.stringify({ schemaVersion: 9 }), JSON.stringify({ schemaVersion: 1, from: current.buildId, to: remote.buildId, count: 99, at: now, targetTime: Date.parse(remote.publishedAt) }), 'x'.repeat(3000)]) {
    const url = new URL(request().url); url.searchParams.set(UPDATE_RETRY_PARAM, marker);
    const plan = planDeploymentUpdate(request({ url: url.href }));
    assert.equal(plan.status, 'reload'); assert.equal(plan.attempt?.count, 1); assert.ok(plan.href); assert.equal(new URL(plan.href).origin, url.origin);
  }
  const first = planDeploymentUpdate(request());
  assert.equal(planDeploymentUpdate(request({ stored: { ...first.attempt, from: 'other-source', count: 2 } })).attempt?.count, 1);
});

void test('the more conservative valid URL or stored attempt wins without mutating either', () => {
  const first = planDeploymentUpdate(request()); assert.ok(first.href); assert.ok(first.attempt);
  const stored = { ...first.attempt, count: 2 as const }; const before = structuredClone(stored);
  assert.equal(planDeploymentUpdate(request({ url: first.href, stored, now: now + UPDATE_COOLDOWN_MS })).status, 'exhausted');
  assert.deepEqual(stored, before);
});

void test('compatible preference carry is sanitized cloned build-bound and never placed in the URL', () => {
  const plan = planDeploymentUpdate(request({ preferences: { ...preferences, world: { revision: 999 } } }));
  assert.deepEqual(plan.preferences, preferences); assert.ok(plan.carry); assert.notEqual(plan.carry.preferences, preferences);
  assert.deepEqual(restoreDeploymentPreferences(remote.buildId, DEFAULT_PREFERENCES, plan.carry), preferences);
  assert.deepEqual(restoreDeploymentPreferences(current.buildId, DEFAULT_PREFERENCES, plan.carry), preferences);
  assert.deepEqual(restoreDeploymentPreferences('unrelated-build', DEFAULT_PREFERENCES, plan.carry), DEFAULT_PREFERENCES);
  assert.deepEqual(restoreDeploymentPreferences(current.buildId, { schemaVersion: 8 }, null), DEFAULT_PREFERENCES);
  assert.doesNotMatch(JSON.stringify(plan.carry), /world|revision/);
});

void test('throwing storage callbacks leave compatible preferences and source objects intact', () => {
  const input = request(); const before = structuredClone(input);
  const prepared = prepareDeploymentUpdate(input, { read: () => null, write: () => { throw new Error('write denied'); } });
  assert.deepEqual(prepared.plan.preferences, preferences); assert.deepEqual(input, before);
  assert.equal(prepared.plan.status, 'reload'); assert.equal(prepared.storageWrite, 'failed');
});

void test('a backward wall clock cannot reset an already used automatic attempt allowance', () => {
  const first = planDeploymentUpdate(request()); assert.ok(first.href);
  const retry = planDeploymentUpdate(request({ url: first.href, now: now - 60_000 }));
  assert.equal(retry.attempt?.count, 2); assert.ok(retry.href);
  const stop = planDeploymentUpdate(request({ url: retry.href, now: now - 120_000 }));
  assert.equal(stop.status, 'exhausted');
});

void test('a temporarily old manifest cannot erase the retry guard for the unseen target', () => {
  const first = planDeploymentUpdate(request()); assert.ok(first.href);
  const retry = planDeploymentUpdate(request({ url: first.href, now: now + UPDATE_COOLDOWN_MS })); assert.ok(retry.href);
  const old = planDeploymentUpdate(request({ remote: current, url: retry.href, now: now + 60_000 }));
  assert.equal(old.status, 'current'); assert.equal(old.href, null);
  assert.equal(planDeploymentUpdate(request({ url: retry.href, now: now + 90_000 })).status, 'exhausted');
});
