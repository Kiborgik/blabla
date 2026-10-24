import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCampaignAdapter } from '../cli/adapter.ts';
import { GameStore, isRecord } from '../cli/store.ts';
import { PublicProjectProbes } from '../cli/public-project-probes.ts';
import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import { RESOURCE_IDS, TURN_RULES } from '../core/content.ts';
import { isWorldState } from '../core/validation.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'blabla-project-contract-'));
  const store = new GameStore(join(directory, 'world.json'));
  const adapter = createCampaignAdapter(store);
  adapter.handle({ op: 'reset' });
  return {
    store,
    call(name: string, ...args: number[]) { adapter.handle({ op: 'call', name, args }); },
    observe() { const value = adapter.handle({ op: 'observe' }); assert.ok(isRecord(value)); return value; },
    reset() { adapter.handle({ op: 'reset' }); },
    cleanup() { rmSync(directory, { recursive: true, force: true }); },
  };
}

void test('legal charter consent commits without immediate payment repair or cargo and completes only on its due beat', () => {
  const item = fixture();
  try {
    const before = item.observe();
    assert.equal(before.project_committed, false);
    item.call('project_consent');
    const committed = item.observe();
    assert.equal(committed.project_last_valid, true);
    assert.equal(committed.project_committed, true);
    assert.equal(committed.project_paid_units, 0);
    assert.equal(committed.project_route_damage_units, before.project_route_damage_units);
    assert.equal(committed.project_delivery_count, before.project_delivery_count);
    assert.equal(committed.project_due, false);
    item.call('project_due_beat');
    assert.equal(item.observe().project_completed, false);
    assert.equal(item.observe().project_due, true);
    item.call('project_due_beat');
    const completed = item.observe();
    assert.equal(completed.project_completed, true);
    assert.equal(completed.project_paid_units, 600);
    assert.equal(completed.project_atomic_contributions, true);
    assert.equal(completed.project_clamped_repair, true);
    assert.equal(completed.project_shipments_preserved, true);
    item.call('project_due_beat');
    assert.equal(item.observe().project_completed, false);
    assert.equal(item.observe().project_paid_units, 0);
  } finally { item.cleanup(); }
});

void test('committed cancellation and repeated consent or cancellation expose real zero-effect refusals', () => {
  const item = fixture();
  try {
    item.call('project_consent');
    item.call('project_consent');
    assert.equal(item.observe().project_last_valid, false);
    assert.equal(item.observe().project_refusal_unchanged, true);
    item.call('project_fixture', 1);
    item.call('project_cancel');
    assert.equal(item.observe().project_last_valid, true);
    assert.equal(item.observe().project_committed, false);
    assert.equal(item.observe().project_paid_units, 0);
    item.call('project_cancel');
    assert.equal(item.observe().project_last_valid, false);
    assert.equal(item.observe().project_refusal_unchanged, true);
  } finally { item.cleanup(); }
});

void test('explicit due fixtures isolate clamp shortage and target invalidation from ordinary economic work', () => {
  const item = fixture();
  try {
    for (const kind of [2, 3, 4, 5, 6, 7, 8, 9]) {
      item.call('project_fixture', kind);
      assert.equal(item.observe().project_due, true, String(kind));
      item.call('project_due_beat');
      const after = item.observe();
      assert.equal(after.project_completed, kind === 2 || kind === 3, String(kind));
      assert.equal(after.project_paid_units, kind === 2 || kind === 3 ? 600 : 0, String(kind));
      for (const field of ['project_atomic_contributions', 'project_zero_payment_without_completion', 'project_clamped_repair', 'project_shipments_preserved']) assert.equal(after[field], true, `${kind}:${field}`);
      if (kind === 3) assert.equal(after.project_route_damage_units, 0);
    }
  } finally { item.cleanup(); }
});

void test('project probes preserve other adapter fixtures and durable campaign in both directions and reset deterministically', () => {
  const item = fixture();
  try {
    const initial = item.observe();
    const durable = item.store.snapshot();
    item.call('project_fixture', 2);
    item.call('project_due_beat');
    const completed = item.observe();
    assert.deepEqual(item.store.snapshot(), durable);
    for (const [key, value] of Object.entries(initial)) if (!key.startsWith('project_')) assert.deepEqual(completed[key], value, key);
    for (const action of ['legacy_cycle', 'peer_action', 'found', 'feature_window', 'operate', 'production_beat', 'pause', 'consent', 'strategic_beat', 'deployment_poll', 'cue_poll', 'cue_flood', 'repair_case']) item.call(action);
    item.call('repair_fixture', 1);
    for (const [key, value] of Object.entries(completed)) if (key.startsWith('project_')) assert.deepEqual(item.observe()[key], value, key);
    item.reset();
    assert.deepEqual(item.observe(), initial);
  } finally { item.cleanup(); }
});

void test('all selected fixtures are canonical and each beat equals actual and no-charter engine transitions', () => {
  const probes = new PublicProjectProbes();
  for (let kind = 0; kind < 10; kind++) {
    probes.prepare(kind);
    const before = probes.snapshot();
    assert.equal(isWorldState(before.state), true);
    assert.equal(before.synthetic, kind >= 3 && kind <= 8);
    assert.equal(before.state.releaseId, 'settlement-charters-1');
    const ledger = before.state.independentTurns;
    assert.ok(ledger);
    const timestamp = new Date(Date.parse(ledger.epoch) + (ledger.strategyTicks + 1) * TURN_RULES.strategyIntervalMs).toISOString();
    const control = structuredClone(before.state);
    control.publicProjects = [];
    const expected = catchUpStrategy(before.state, timestamp);
    const baseline = catchUpStrategy(control, timestamp);
    assert.equal(probes.observe().project_due, kind >= 2);
    const actual = probes.dueBeat();
    assert.deepEqual(actual, expected, String(kind));
    assert.deepEqual(probes.snapshot().control, baseline, String(kind));
    assert.deepEqual(probes.snapshot().state, expected.state);
    assert.equal(isWorldState(actual.state), true);
    assert.equal(actual.state.round, before.state.round + 1);
    assert.equal(probes.snapshot().timestamp, timestamp);
    assert.deepEqual(probes.snapshot().project.terms, before.project.terms);
  }
});

void test('consent and cancellation use exactly the observed world without changing captured pledge terms', () => {
  const probes = new PublicProjectProbes();
  const initial = probes.snapshot();
  const expected = applyCommand(initial.state, { seat: initial.project.recipient, action: { type: 'respond-public-project', projectId: initial.project.id, accept: true }, expectedRevision: initial.state.revision, timestamp: initial.timestamp });
  assert.deepEqual(probes.consent(), expected);
  assert.deepEqual(expected.state.civilizations, initial.state.civilizations);
  assert.deepEqual(expected.state.routes, initial.state.routes);
  assert.deepEqual(expected.state.publicProjects?.[0]?.terms, initial.project.terms);
  const committed = probes.snapshot();
  const repeated = probes.consent();
  assert.equal(repeated.ok, false);
  assert.deepEqual(repeated.state, committed.state);
  assert.deepEqual(repeated.events, []);
  const cancellation = applyCommand(committed.state, { seat: committed.project.proposer, action: { type: 'cancel-public-project', projectId: committed.project.id }, expectedRevision: committed.state.revision, timestamp: committed.timestamp });
  assert.deepEqual(probes.cancel(), cancellation);
  assert.equal(cancellation.ok, true);
  assert.deepEqual(cancellation.state.civilizations, committed.state.civilizations);
  assert.deepEqual(cancellation.state.routes, committed.state.routes);
  assert.equal(probes.observe().project_completed, false);
  const cancelled = probes.snapshot();
  assert.equal(probes.cancel().ok, false);
  assert.deepEqual(probes.snapshot().state, cancelled.state);
  assert.equal(probes.observe().project_paid_units, 0);
});

void test('completion charges every captured contribution exactly relative to actual ordinary economy', () => {
  const probes = new PublicProjectProbes();
  for (const kind of [2, 3]) {
    probes.prepare(kind);
    const before = probes.snapshot();
    const result = probes.dueBeat();
    const control = probes.snapshot().control;
    assert.ok(control?.ok);
    const receipt = result.events.find((event) => event.publicProjectResult?.projectId === before.project.id)?.publicProjectResult;
    assert.ok(receipt?.outcome === 'completed');
    assert.deepEqual(receipt.proposerPaid, before.project.terms.proposerContribution);
    assert.deepEqual(receipt.recipientPaid, before.project.terms.recipientContribution);
    for (const owner of control.state.civilizations) {
      const actual = result.state.civilizations.find((candidate) => candidate.id === owner.id);
      assert.ok(actual);
      for (const resource of RESOURCE_IDS) {
        const cost = owner.id === before.project.proposer ? before.project.terms.proposerContribution[resource] ?? 0 : owner.id === before.project.recipient ? before.project.terms.recipientContribution[resource] ?? 0 : 0;
        assert.ok(Math.abs(actual.resources[resource] - (owner.resources[resource] - cost)) < 1e-9);
      }
    }
    assert.notDeepEqual(control.state.civilizations, before.state.civilizations);
    const target = control.state.routes.find((route) => route.id === before.project.routeId);
    assert.ok(target);
    assert.deepEqual(result.state.routes, control.state.routes.map((route) => route.id === target.id ? { ...route, damage: Math.max(0, route.damage - before.project.terms.damageReduction) } : route));
  }
});

void test('shipment preservation allows real cargo before partial repair and later cargo after damaged-route repair', () => {
  const probes = new PublicProjectProbes();
  probes.prepare(3);
  const before = probes.observe();
  probes.dueBeat();
  assert.ok(probes.observe().project_delivery_count > before.project_delivery_count);
  assert.equal(probes.observe().project_shipments_preserved, true);
  const snapshot = probes.snapshot();
  const actual = snapshot.state.routes.find((route) => route.id === snapshot.project.routeId);
  const control = snapshot.control?.state.routes.find((route) => route.id === snapshot.project.routeId);
  assert.deepEqual(actual?.agreement, control?.agreement);
  assert.equal(actual?.volume, control?.volume);
  probes.prepare(2);
  const blocked = probes.observe().project_delivery_count;
  probes.dueBeat();
  assert.equal(probes.observe().project_delivery_count, blocked);
  for (let n = 0; n < 4 && probes.observe().project_delivery_count === blocked; n++) probes.dueBeat();
  assert.ok(probes.observe().project_delivery_count > blocked);
  assert.equal(probes.observe().project_completed, false);
  assert.equal(probes.observe().project_paid_units, 0);
});

void test('pending expiry and repeated resolution reset terminal flags without project payment', () => {
  const probes = new PublicProjectProbes();
  const initial = probes.snapshot();
  for (let n = 0; n < initial.project.terms.pendingLifetimeRounds; n++) {
    probes.dueBeat();
    assert.equal(probes.observe().project_completed, false);
    assert.equal(probes.observe().project_paid_units, 0);
    assert.equal(probes.observe().project_zero_payment_without_completion, true);
  }
  const expired = probes.snapshot();
  assert.equal(expired.state.publicProjects?.length, 0);
  assert.equal(expired.result?.events.find((event) => event.publicProjectResult)?.publicProjectResult?.outcome, 'expired');
  assert.equal(probes.consent().ok, false);
  assert.deepEqual(probes.snapshot().state, expired.state);
  assert.equal(probes.observe().project_refusal_unchanged, true);
  probes.dueBeat();
  assert.equal(probes.snapshot().result?.events.some((event) => event.publicProjectResult), false);
});

void test('fixture baselines and detached snapshots reset identically without cross-instance mutation', () => {
  const first = new PublicProjectProbes();
  const second = new PublicProjectProbes();
  const initial = first.snapshot();
  const detached = first.snapshot();
  detached.state.routes.length = 0;
  detached.project.terms.damageReduction = 99;
  assert.deepEqual(first.snapshot(), initial);
  for (const kind of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, -1, 999]) {
    first.prepare(kind);
    second.prepare(kind);
    assert.deepEqual(first.snapshot(), second.snapshot());
    assert.deepEqual(first.dueBeat(), second.dueBeat());
    assert.deepEqual(first.observe(), second.observe());
  }
  first.reset();
  assert.deepEqual(first.snapshot(), initial);
});
