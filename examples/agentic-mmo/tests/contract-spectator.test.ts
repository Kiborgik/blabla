import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCampaignAdapter } from '../cli/adapter.ts';
import { GameStore, isRecord } from '../cli/store.ts';
import { SpectatorPolicyProbes } from '../cli/spectator-probes.ts';
import { createEventCueTracker } from '../visuals/event-visuals.ts';
import { parseRelease, shouldReload } from '../web/viewer-state.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'blabla-spectator-contract-'));
  const store = new GameStore(join(directory, 'world.json'));
  const adapter = createCampaignAdapter(store);
  adapter.handle({ op: 'reset' });
  return {
    store,
    call(name: string, ...args: number[]) { adapter.handle({ op: 'call', name, args }); },
    observe() {
      const value = adapter.handle({ op: 'observe' });
      assert.ok(isRecord(value));
      return value;
    },
    reset() { adapter.handle({ op: 'reset' }); },
    cleanup() { rmSync(directory, { recursive: true, force: true }); },
  };
}

void test('deployment policy requests a newer distinct release once while its attempt is retained', () => {
  const item = fixture();
  try {
    assert.equal(item.observe().reload_requests, 0);
    item.call('deployment_offer', 4);
    assert.equal(item.observe().reload_remote_valid, true);
    assert.equal(item.observe().reload_newer, true);
    assert.equal(item.observe().reload_distinct, true);
    assert.equal(item.observe().reload_attempted, false);
    item.call('deployment_poll');
    assert.equal(item.observe().reload_requested, true);
    assert.equal(item.observe().reload_requests, 1);
    assert.equal(item.observe().reload_attempted, true);
    item.call('deployment_poll');
    assert.equal(item.observe().reload_requested, false);
    assert.equal(item.observe().reload_requests, 1);
  } finally { item.cleanup(); }
});

void test('invalid, same-build, older and equal-time releases never request a reload', () => {
  const item = fixture();
  try {
    for (const kind of [0, 1, 2, 3, -1, 999999]) {
      item.call('deployment_offer', kind);
      item.call('deployment_poll');
      assert.equal(item.observe().reload_requested, false, String(kind));
      assert.equal(item.observe().reload_requests, 0);
    }
  } finally { item.cleanup(); }
});

void test('the named newer deployment fixture reaches one real request per fresh offer', () => {
  const item = fixture();
  try {
    for (let count = 1; count <= 2; count++) {
      item.call('deployment_newer');
      const offered = item.observe();
      assert.equal(offered.reload_remote_valid, true);
      assert.equal(offered.reload_newer, true);
      assert.equal(offered.reload_distinct, true);
      assert.equal(offered.reload_attempted, false);
      assert.equal(offered.reload_requests, count - 1);
      item.call('deployment_poll');
      assert.equal(item.observe().reload_requested, true);
      assert.equal(item.observe().reload_attempted, true);
      assert.equal(item.observe().reload_requests, count);
      item.call('deployment_poll');
      assert.equal(item.observe().reload_requested, false);
      assert.equal(item.observe().reload_requests, count);
    }
  } finally { item.cleanup(); }
});

void test('the last twenty attempt limit allows an evicted old build to be requested again', () => {
  const item = fixture();
  try {
    for (let index = 0; index < 20; index++) {
      item.call('deployment_offer', 4);
      item.call('deployment_poll');
    }
    item.call('deployment_offer', 5);
    assert.equal(item.observe().reload_attempted, true);
    item.call('deployment_poll');
    assert.equal(item.observe().reload_requests, 20);
    item.call('deployment_offer', 4);
    item.call('deployment_poll');
    item.call('deployment_offer', 5);
    assert.equal(item.observe().reload_attempted, false);
    item.call('deployment_poll');
    assert.equal(item.observe().reload_requested, true);
    assert.equal(item.observe().reload_requests, 22);
  } finally { item.cleanup(); }
});

void test('first observation suppresses history, then one fresh recognized event produces one cue', () => {
  const item = fixture();
  try {
    assert.equal(item.observe().cue_first_observation, true);
    item.call('cue_append', 0);
    assert.equal(item.observe().cue_count, 0);
    assert.equal(item.observe().cue_first_observation, false);
    item.call('cue_append', 0);
    assert.equal(item.observe().cue_count, 1);
    assert.equal(item.observe().cue_appended_known, true);
    assert.equal(item.observe().cue_ids_from_window, true);
    assert.equal(item.observe().cue_ids_not_in_previous_window, true);
    item.call('cue_poll');
    assert.equal(item.observe().cue_count, 0);
    item.call('cue_new_run');
    assert.equal(item.observe().cue_count, 0);
    item.call('cue_append', 0);
    assert.equal(item.observe().cue_count, 1);
  } finally { item.cleanup(); }
});

void test('unknown event fixtures cannot invent cues and busy input stays capped at three', () => {
  const item = fixture();
  try {
    item.call('cue_flood');
    assert.equal(item.observe().cue_count, 0);
    for (const kind of [1, -1, 99999]) {
      item.call('cue_append', kind);
      assert.equal(item.observe().cue_count, 0);
      assert.equal(item.observe().cue_appended_known, false);
    }
    item.call('cue_flood');
    assert.equal(item.observe().cue_count, 3);
    assert.equal(item.observe().cue_ids_from_window, true);
    assert.equal(item.observe().cue_ids_not_in_previous_window, true);
    item.call('cue_poll');
    assert.equal(item.observe().cue_count, 0);
  } finally { item.cleanup(); }
});

void test('spectator probes reset deterministically and never alter other probe worlds in either direction', () => {
  const first = fixture();
  const second = fixture();
  try {
    const initial = first.observe();
    const saved = first.store.snapshot();
    for (const item of [first, second]) {
      item.call('deployment_offer', 4);
      item.call('deployment_poll');
      item.call('cue_poll');
      item.call('cue_flood');
      item.call('cue_append', 0);
    }
    assert.deepEqual(first.observe(), second.observe());
    assert.deepEqual(first.store.snapshot(), saved);
    for (const [key, value] of Object.entries(initial)) {
      if (!key.startsWith('cue_') && !key.startsWith('reload_')) assert.deepEqual(first.observe()[key], value, key);
    }
    const policy = first.observe();
    for (const action of ['legacy_cycle', 'peer_action', 'found', 'feature_window', 'operate', 'production_beat', 'pause', 'consent', 'strategic_beat']) first.call(action);
    for (const [key, value] of Object.entries(policy)) {
      if (key.startsWith('cue_') || key.startsWith('reload_')) assert.deepEqual(first.observe()[key], value, key);
    }
    first.reset();
    assert.deepEqual(first.observe(), initial);
  } finally { first.cleanup(); second.cleanup(); }
});

void test('reload observations match the existing parser and predicate with bounded detached attempt snapshots', () => {
  const probes = new SpectatorPolicyProbes();
  for (const kind of [0, 1, 2, 3, 4, 5, ...Array.from({ length: 25 }, () => 4)]) {
    probes.deploymentOffer(kind);
    const before = probes.snapshot();
    assert.deepEqual(parseRelease(before.remote), before.remote);
    const decision = shouldReload(before.current, before.remote, before.attempts);
    const count = probes.observe().reload_requests;
    probes.deploymentPoll();
    assert.equal(probes.observe().reload_requested, decision);
    assert.equal(probes.observe().reload_requests, count + Number(decision));
    const after = probes.snapshot();
    assert.deepEqual(after.attempts, decision && before.remote ? [...before.attempts, before.remote.buildId].slice(-20) : before.attempts);
    assert.ok(after.attempts.length <= 20);
  }
  const saved = probes.snapshot();
  const detached = probes.snapshot();
  detached.attempts.length = 0;
  detached.current.buildId = 'mutated';
  assert.deepEqual(probes.snapshot(), saved);
});

void test('probe cues exactly replay the real tracker including last96 filtering and priority order', () => {
  const probes = new SpectatorPolicyProbes();
  const tracker = createEventCueTracker();
  const actions = [() => probes.cuePoll(), () => probes.cueFlood(), () => probes.cuePoll(), () => probes.cueAppend(0), () => probes.cueAppend(1), () => probes.cueNewRun(), () => probes.cueAppend(0)];
  for (const [index, action] of actions.entries()) {
    action();
    const snapshot = probes.snapshot();
    const preserved = structuredClone(snapshot.supplied);
    assert.deepEqual(snapshot.cues, tracker.observe(snapshot.identity, snapshot.supplied));
    assert.deepEqual(snapshot.supplied, preserved);
    assert.ok(snapshot.events.length <= 96);
    assert.ok(snapshot.previous.length <= 96);
    assert.ok(snapshot.supplied.length <= 100);
    if (index === 1) {
      assert.equal(snapshot.supplied.length, 100);
      assert.deepEqual(snapshot.cues.map((cue) => cue.eventId), [snapshot.supplied[10]?.id, snapshot.supplied[99]?.id, snapshot.supplied[98]?.id]);
      assert.ok(!snapshot.cues.some((cue) => cue.eventId === snapshot.supplied[0]?.id));
    }
  }
  const saved = probes.snapshot();
  probes.snapshot().cues.length = 0;
  probes.snapshot().events.length = 0;
  assert.deepEqual(probes.snapshot(), saved);
});

void test('the actual tracker remembers only the previous window rather than permanent event history', () => {
  const probes = new SpectatorPolicyProbes();
  probes.cueAppend(0);
  const old = probes.snapshot().events[0];
  assert.ok(old);
  const tracker = createEventCueTracker();
  assert.deepEqual(tracker.observe('synthetic-window-limit', [old]), []);
  assert.deepEqual(tracker.observe('synthetic-window-limit', []), []);
  assert.equal(tracker.observe('synthetic-window-limit', [old])[0]?.eventId, old.id);
  assert.deepEqual(tracker.observe('synthetic-window-limit', [old]), []);
});
