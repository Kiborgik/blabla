import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCampaignAdapter } from '../cli/adapter.ts';
import { GameStore, isRecord } from '../cli/store.ts';
import { ECONOMY_RULES, RESOURCE_IDS } from '../core/content.ts';
import { RecoveryProbes } from '../cli/recovery-probes.ts';
import { applyCommand } from '../core/engine.ts';
import { isWorldState } from '../core/validation.ts';
import type { Resources } from '../core/types.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'blabla-recovery-contract-'));
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

void test('default recovery repairs the exact previously observed damage and pays the full canonical vector', () => {
  const item = fixture();
  try {
    const before = item.observe();
    assert.equal(before.repair_target_damage_units, 3500);
    assert.equal(before.repair_reduction_units, ECONOMY_RULES.repair.damageReduction * 100);
    item.call('repair_case');
    const after = item.observe();
    assert.equal(after.repair_accepted, true);
    assert.equal(after.repair_target_damage_units, 1000);
    assert.equal(after.repair_paid_exact_cost, true);
    assert.equal(after.repair_other_cities_unchanged, true);
    assert.equal(after.repair_people_buildings_unchanged, true);
  } finally { item.cleanup(); }
});

void test('fixture selection exposes low and exact-threshold damage before the actual clamped repair', () => {
  const item = fixture();
  try {
    for (const [kind, damage] of [[1, 10], [7, ECONOMY_RULES.repair.damageReduction]] as const) {
      item.call('repair_fixture', kind);
      assert.equal(item.observe().repair_target_damage_units, damage * 100);
      assert.equal(item.observe().repair_accepted, false);
      item.call('repair_case');
      assert.equal(item.observe().repair_accepted, true);
      assert.equal(item.observe().repair_target_damage_units, 0);
      assert.equal(item.observe().repair_paid_exact_cost, true);
      assert.equal(item.observe().repair_people_buildings_unchanged, true);
    }
  } finally { item.cleanup(); }
});

void test('healthy foreign missing and individually unfunded repair cases refuse with zero effects', () => {
  const item = fixture();
  try {
    for (const [kind, damage] of [[2, 0], [3, 35], [4, 0], [5, 35], [6, 35]] as const) {
      item.call('repair_fixture', kind);
      assert.equal(item.observe().repair_target_damage_units, damage * 100);
      item.call('repair_case');
      const after = item.observe();
      assert.equal(after.repair_accepted, false, String(kind));
      assert.equal(after.repair_target_damage_units, damage * 100);
      assert.equal(after.repair_refusal_unchanged, true);
      assert.equal(after.repair_other_cities_unchanged, true);
      assert.equal(after.repair_people_buildings_unchanged, true);
    }
  } finally { item.cleanup(); }
});

void test('repeated repair respects real tactical admission without refreshing or swapping its fixture', () => {
  const item = fixture();
  try {
    item.call('repair_case');
    assert.equal(item.observe().repair_accepted, true);
    const damage = item.observe().repair_target_damage_units;
    item.call('repair_case');
    assert.equal(item.observe().repair_accepted, false);
    assert.equal(item.observe().repair_refusal_unchanged, true);
    assert.equal(item.observe().repair_target_damage_units, damage);
  } finally { item.cleanup(); }
});

void test('recovery setup and commands are deterministic and isolated from every existing adapter fixture', () => {
  const first = fixture();
  const second = fixture();
  try {
    const initial = first.observe();
    const durable = first.store.snapshot();
    for (const item of [first, second]) {
      for (const kind of [0, 1, 2, 3, 4, 5, 6, 7, -1, 99999]) {
        item.call('repair_fixture', kind);
        item.call('repair_case');
      }
    }
    assert.deepEqual(first.observe(), second.observe());
    assert.deepEqual(first.store.snapshot(), durable);
    for (const [key, value] of Object.entries(initial)) {
      if (!key.startsWith('repair_')) assert.deepEqual(first.observe()[key], value, key);
    }
    const repaired = first.observe();
    for (const action of ['legacy_cycle', 'peer_action', 'found', 'feature_window', 'operate', 'production_beat', 'pause', 'consent', 'strategic_beat', 'deployment_poll', 'cue_poll', 'cue_flood']) first.call(action);
    first.call('deployment_offer', 4);
    first.call('cue_append', 0);
    for (const [key, value] of Object.entries(repaired)) {
      if (key.startsWith('repair_')) assert.deepEqual(first.observe()[key], value, key);
    }
    first.reset();
    assert.deepEqual(first.observe(), initial);
  } finally { first.cleanup(); second.cleanup(); }
});

void test('every synthetic case is canonical and the receipt is exactly the real command on the observed world', () => {
  const probes = new RecoveryProbes();
  for (let kind = 0; kind < 8; kind++) {
    probes.prepare(kind);
    const before = probes.snapshot();
    assert.equal(isWorldState(before.state), true);
    assert.equal(before.state.releaseId, 'settlement-recovery-1');
    assert.equal(before.state.cities.filter((city) => city.civId === 0).length, 2);
    assert.deepEqual(before.state.cities.find((city) => city.id === 'city-0')?.buildings, ['farm', 'workshop']);
    const preserved = structuredClone(before.state);
    const expected = applyCommand(before.state, { seat: 0, expectedRevision: before.state.revision, action: { type: 'repair-city', cityId: before.target }, timestamp: before.timestamp });
    const actual = probes.repair();
    assert.deepEqual(actual, expected, String(kind));
    assert.deepEqual(before.state, preserved);
    assert.deepEqual(probes.snapshot().state, expected.state);
    assert.deepEqual(probes.snapshot().result, expected);
    assert.equal(isWorldState(actual.state), true);
    assert.equal(actual.ok, [0, 1, 7].includes(kind));
    assert.equal(probes.observe().repair_accepted, actual.ok);
    assert.equal(probes.observe().repair_target_damage_units, Math.round((actual.state.cities.find((city) => city.id === before.target)?.damage ?? 0) * 100));
    if (!actual.ok) {
      assert.equal(actual.actionOutcome?.code, 'illegal_action');
      assert.deepEqual(actual.state, preserved);
      assert.deepEqual(actual.events, []);
    }
  }
});

void test('accepted repairs pay every canonical resource exactly and preserve all target facts except damage', () => {
  const probes = new RecoveryProbes();
  const cost: Partial<Resources> = ECONOMY_RULES.repair.cost;
  for (const kind of [0, 1, 7]) {
    probes.prepare(kind);
    const before = probes.snapshot();
    const target = before.state.cities.find((city) => city.id === before.target);
    assert.ok(target);
    const result = probes.repair();
    assert.equal(result.ok, true);
    const after = result.state.cities.find((city) => city.id === before.target);
    assert.ok(after);
    assert.deepEqual(after, { ...target, damage: Math.max(0, target.damage - ECONOMY_RULES.repair.damageReduction) });
    assert.deepEqual(result.state.cities.filter((city) => city.id !== before.target), before.state.cities.filter((city) => city.id !== before.target));
    for (const civilization of before.state.civilizations) {
      const next = result.state.civilizations.find((candidate) => candidate.id === civilization.id);
      assert.ok(next);
      for (const resource of RESOURCE_IDS) {
        assert.equal(next.resources[resource], civilization.resources[resource] - (civilization.id === 0 ? cost[resource] ?? 0 : 0));
      }
    }
    const event = result.events.find((entry) => entry.type === 'city-repaired');
    assert.ok(event);
    assert.equal(event.tileId, target.tileId);
    assert.deepEqual(event.effects, [`City damage ${target.damage} → ${after.damage}`, ...RESOURCE_IDS.filter((resource) => (cost[resource] ?? 0) > 0).map((resource) => `Paid ${cost[resource]} ${resource}`)]);
    assert.equal(result.state.revision, before.state.revision + 1);
    assert.equal(result.state.round, before.state.round);
    assert.equal(result.state.year, before.state.year);
  }
});

void test('detached snapshots cannot mutate the fixture and repeated commands return actual admission refusal', () => {
  const probes = new RecoveryProbes();
  const initial = probes.snapshot();
  const detached = probes.snapshot();
  const city = detached.state.cities[0];
  assert.ok(city);
  city.damage = 99;
  city.buildings.length = 0;
  assert.deepEqual(probes.snapshot(), initial);
  assert.equal(probes.repair().ok, true);
  const accepted = probes.snapshot();
  const repeated = probes.repair();
  assert.equal(repeated.ok, false);
  assert.equal(repeated.actionOutcome?.code, 'action_admission_blocked');
  assert.deepEqual(repeated.state, accepted.state);
  assert.deepEqual(repeated.events, []);
  assert.equal(probes.observe().repair_refusal_unchanged, true);
  probes.reset();
  assert.deepEqual(probes.snapshot(), initial);
});
