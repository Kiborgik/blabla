import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import { TURN_RULES } from '../core/content.ts';
import { FeatureProbes } from '../cli/feature-probes.ts';
import { createCampaignAdapter } from '../cli/adapter.ts';
import { GameStore, isRecord } from '../cli/store.ts';

void test('an idle actor does not prevent the real peer from using its independent allowance', () => {
  const probes = new FeatureProbes();
  const before = probes.snapshot();
  assert.equal(probes.observe().independent_mode, true);
  assert.equal(probes.observe().idle_actor, true);
  assert.equal(probes.observe().peer_eligible, true);
  probes.peerAction();
  const after = probes.snapshot();
  const actual = applyCommand(before.concurrent, { seat: 1, expectedRevision: before.concurrent.revision, action: { type: 'wait' }, timestamp: before.timestamp });
  assert.equal(actual.ok, true);
  assert.deepEqual(after.concurrent, actual.state);
  assert.equal(probes.observe().concurrent_last_valid, true);
  assert.equal(probes.observe().concurrent_revision, before.concurrent.revision + 1);
  assert.equal(probes.observe().concurrent_year, before.concurrent.year);
  assert.equal(probes.observe().idle_actor, true);
  assert.equal(after.concurrent.independentTurns?.actionsInWindow[0], 0);
});

void test('exhausted allowance and invalid commands refuse without changing engine state', () => {
  const probes = new FeatureProbes();
  probes.peerAction();
  const accepted = probes.snapshot();
  assert.equal(probes.observe().peer_eligible, false);
  probes.peerAction();
  assert.equal(probes.observe().concurrent_last_valid, false);
  assert.deepEqual(probes.snapshot(), accepted);
  probes.invalidAction();
  assert.equal(probes.observe().concurrent_last_valid, false);
  assert.deepEqual(probes.snapshot(), accepted);
});

void test('ten-second windows restore allowance and invoke actual strategic catchup at its boundary', () => {
  const probes = new FeatureProbes();
  probes.peerAction();
  probes.featureWindow();
  assert.equal(probes.observe().peer_eligible, true);
  for (let index = 1; index < TURN_RULES.strategyIntervalMs / TURN_RULES.tacticalWindowMs; index++) probes.featureWindow();
  const state = probes.snapshot();
  const initial = new FeatureProbes().snapshot();
  const acted = applyCommand(initial.concurrent, { seat: 1, expectedRevision: initial.concurrent.revision, action: { type: 'wait' }, timestamp: initial.timestamp });
  const expected = catchUpStrategy(acted.state, state.timestamp);
  assert.equal(expected.ok, true);
  assert.deepEqual(state.concurrent, expected.state);
  assert.equal(state.concurrent.independentTurns?.strategyTicks, 1);
  assert.equal(state.concurrent.year, initial.concurrent.year);
});

void test('plans are actual accepted attachments and never automatic successor execution', () => {
  for (const size of [0, 1, 2]) {
    const probes = new FeatureProbes();
    const before = probes.observe();
    probes.updatePlan(size);
    assert.equal(probes.observe().concurrent_last_valid, true);
    assert.equal(probes.observe().actionable_plan_items, size);
    assert.equal(probes.observe().concurrent_revision, before.concurrent_revision + 1);
    const plan = probes.snapshot().concurrent.actionPlans?.[1];
    assert.equal(plan?.items.length ?? 0, size);
    if (size === 2) assert.equal(plan?.items[1]?.status, 'needs-review');
  }
});

void test('invalid plan sizes use bounded invalid submissions and preserve existing plans', () => {
  const probes = new FeatureProbes();
  probes.updatePlan(2);
  probes.featureWindow();
  const before = probes.snapshot();
  for (const size of [-1, 3, Number.MAX_SAFE_INTEGER]) {
    probes.updatePlan(size);
    assert.equal(probes.observe().concurrent_last_valid, false);
    assert.deepEqual(probes.snapshot(), before);
    assert.equal(probes.observe().actionable_plan_items, 2);
  }
});

void test('founding transfers real residents and pays actual costs once, then refuses a repeated attempt', () => {
  const probes = new FeatureProbes();
  const before = probes.snapshot();
  assert.equal(probes.observe().frontier_source_population, 6);
  probes.found();
  const after = probes.snapshot();
  const expected = applyCommand(before.frontier, { seat: 0, expectedRevision: before.frontier.revision, action: before.founding, timestamp: before.timestamp });
  assert.equal(expected.ok, true);
  assert.deepEqual(after.frontier, expected.state);
  assert.equal(probes.observe().frontier_accepted, true);
  assert.equal(probes.observe().frontier_source_population, 3);
  assert.equal(probes.observe().frontier_destination_population, 3);
  assert.equal(probes.observe().frontier_total_population, before.frontier.cities.reduce((sum, city) => sum + city.population, 0));
  assert.equal(probes.observe().frontier_paid_units, 3000);
  probes.found();
  assert.equal(probes.observe().frontier_accepted, false);
  assert.equal(probes.observe().frontier_paid_units, 0);
  assert.deepEqual(probes.snapshot(), after);
});

void test('resets and identical sequences are deterministic and snapshots cannot mutate probes', () => {
  const first = new FeatureProbes();
  const second = new FeatureProbes();
  const initial = first.snapshot();
  first.snapshot().concurrent.revision = 999;
  assert.deepEqual(first.snapshot(), initial);
  for (const probes of [first, second]) {
    probes.updatePlan(2);
    probes.invalidAction();
    probes.featureWindow();
    probes.peerAction();
    probes.found();
  }
  assert.deepEqual(first.snapshot(), second.snapshot());
  assert.deepEqual(first.observe(), second.observe());
  first.reset();
  assert.deepEqual(first.snapshot(), initial);
  assert.deepEqual(first.observe(), new FeatureProbes().observe());
});

void test('adapter feature actions leave the durable sequential campaign untouched', () => {
  const directory = mkdtempSync(join(tmpdir(), 'blabla-feature-contract-'));
  try {
    const store = new GameStore(join(directory, 'world.json'));
    const adapter = createCampaignAdapter(store);
    adapter.handle({ op: 'reset' });
    const campaign = store.snapshot();
    for (const [name, args] of [['peer_action', []], ['invalid_action', []], ['feature_window', []], ['update_plan', [2]], ['found', []]] as const)
      adapter.handle({ op: 'call', name, args });
    assert.deepEqual(store.snapshot(), campaign);
    const view = adapter.handle({ op: 'observe' });
    assert.ok(isRecord(view));
    assert.equal(view.revision, 0);
    assert.equal(view.frontier_accepted, true);
    assert.equal(view.concurrent_last_valid, true);
    adapter.handle({ op: 'call', name: 'hold', args: [] });
    assert.equal(store.snapshot().state.revision, 1);
    assert.equal(store.snapshot().provenance[0]?.kind, 'contract-probe');
    adapter.handle({ op: 'reset' });
    const reset = adapter.handle({ op: 'observe' });
    assert.ok(isRecord(reset));
    assert.equal(reset.frontier_destination_population, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

void test('one legacy cycle commits six real holds from every phase and persists one round without changing feature fixtures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'blabla-legacy-cycle-'));
  try {
    for (let phase = 0; phase < 6; phase++) {
      const store = new GameStore(join(directory, `world-${phase}.json`));
      const adapter = createCampaignAdapter(store);
      adapter.handle({ op: 'reset' });
      for (let index = 0; index < phase; index++) adapter.handle({ op: 'call', name: 'hold', args: [] });
      adapter.handle({ op: 'call', name: 'peer_action', args: [] });
      adapter.handle({ op: 'call', name: 'found', args: [] });
      const before = store.snapshot();
      const observed = adapter.handle({ op: 'observe' });
      assert.ok(isRecord(observed));
      adapter.handle({ op: 'call', name: 'legacy_cycle', args: [] });
      const after = store.snapshot();
      assert.equal(after.state.revision, before.state.revision + 6);
      assert.equal(after.state.round, before.state.round + 1);
      assert.equal(after.state.phase, phase);
      assert.equal(after.state.year, before.state.year);
      assert.equal(after.lastValid, true);
      assert.deepEqual(after.commands.slice(-6).map((command) => command.seat), Array.from({ length: 6 }, (_, index) => (phase + index) % 6));
      assert.ok(after.commands.slice(-6).every((command) => command.action.type === 'wait'));
      assert.ok(after.provenance.slice(-6).every((entry) => entry.kind === 'contract-probe' && entry.model === null));
      const current = adapter.handle({ op: 'observe' });
      assert.ok(isRecord(current));
      for (const key of Object.keys(new FeatureProbes().observe())) assert.deepEqual(current[key], observed[key], key);
      adapter.handle({ op: 'call', name: 'restart', args: [] });
      assert.deepEqual(adapter.handle({ op: 'observe' }), current);
      const reopened = new GameStore(store.path);
      const restarted = createCampaignAdapter(reopened);
      restarted.handle({ op: 'call', name: 'restart', args: [] });
      assert.deepEqual(reopened.snapshot(), after);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
