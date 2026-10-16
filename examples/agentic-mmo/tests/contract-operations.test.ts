import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCampaignAdapter } from '../cli/adapter.ts';
import { GameStore, isRecord } from '../cli/store.ts';
import { BUILDINGS, TRADE_RECIPES, TRADE_RULES } from '../core/content.ts';
import { OperationsProbes } from '../cli/operations-probes.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { applyCommand, applyRelease, catchUpStrategy, createWorld } from '../core/engine.ts';
import { isWorldState } from '../core/validation.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'blabla-operation-contract-'));
  const store = new GameStore(join(directory, 'world.json'));
  const adapter = createCampaignAdapter(store);
  adapter.handle({ op: 'reset' });
  return {
    store,
    call(name: string) { adapter.handle({ op: 'call', name, args: [] }); },
    observe() {
      const value = adapter.handle({ op: 'observe' });
      assert.ok(isRecord(value));
      return value;
    },
    reset() { adapter.handle({ op: 'reset' }); },
    cleanup() { rmSync(directory, { recursive: true, force: true }); },
  };
}

void test('allocation pays the authored material recipe once and refuses partial inputs after depletion', () => {
  const item = fixture();
  try {
    const irrigation = BUILDINGS.find((building) => building.id === 'irrigation');
    assert.ok(irrigation?.operatingInputs?.materials);
    const cost = irrigation.operatingInputs.materials * 100;
    assert.equal(item.observe().production_stock_units, cost);
    assert.equal(item.observe().production_inputs_available, true);
    item.call('operate');
    assert.equal(item.observe().production_stock_units, 0);
    assert.equal(item.observe().production_paid_units, cost);
    assert.equal(item.observe().production_produced_units, 0);
    assert.equal(item.observe().production_inputs_available, false);
    item.call('operate');
    assert.equal(item.observe().production_stock_units, 0);
    assert.equal(item.observe().production_paid_units, 0);
    assert.equal(item.observe().production_produced_units, 0);
  } finally { item.cleanup(); }
});

void test('actual pause spends nothing and paused allocation preserves stock', () => {
  const item = fixture();
  try {
    const before = item.observe();
    item.call('pause');
    assert.equal(item.observe().production_enabled, false);
    assert.equal(item.observe().production_stock_units, before.production_stock_units);
    item.call('operate');
    assert.equal(item.observe().production_stock_units, before.production_stock_units);
    assert.equal(item.observe().production_paid_units, 0);
    assert.equal(item.observe().production_produced_units, 0);
  } finally { item.cleanup(); }
});

void test('supplied economy produces real recipe output while allocator alone does not', () => {
  const item = fixture();
  try {
    item.call('production_beat');
    const view = item.observe();
    assert.equal(view.production_paid_units, 100);
    assert.equal(typeof view.production_produced_units, 'number');
    assert.ok(Number(view.production_produced_units) > 0);
    assert.ok(Number(view.production_stock_units) > 0);
  } finally { item.cleanup(); }
});

void test('starved and paused economy receipts stay zero even while unrelated production changes stock', () => {
  for (const action of ['operate', 'pause']) {
    const item = fixture();
    try {
      item.call(action);
      const before = item.observe();
      item.call('production_beat');
      const after = item.observe();
      assert.equal(after.production_paid_units, 0);
      assert.equal(after.production_produced_units, 0);
      assert.notEqual(after.production_stock_units, before.production_stock_units);
    } finally { item.cleanup(); }
  }
});

void test('real recipient consent creates a standing agreement without cargo and repeat consent is refused', () => {
  const item = fixture();
  try {
    assert.equal(item.observe().strategy_can_consent, true);
    assert.equal(item.observe().strategy_agreement_enabled, false);
    item.call('consent');
    const accepted = item.observe();
    assert.equal(accepted.strategy_last_valid, true);
    assert.equal(accepted.strategy_agreement_enabled, true);
    assert.equal(accepted.strategy_delivery_count, 0);
    assert.ok(Number(accepted.strategy_next_delivery_round) > Number(accepted.strategy_round));
    item.call('consent');
    assert.equal(item.observe().strategy_last_valid, false);
    assert.equal(item.observe().strategy_agreement_enabled, true);
    assert.equal(item.observe().strategy_delivery_count, 0);
  } finally { item.cleanup(); }
});

void test('cargo is delivered by the real due strategic beat and not by acceptance or earlier beats', () => {
  const item = fixture();
  try {
    const recipe = TRADE_RECIPES.find((candidate) => candidate.id === 'harvest-for-materials');
    assert.ok(recipe);
    item.call('consent');
    for (let round = 1; round <= recipe.terms.cadenceRounds; round++) {
      item.call('strategic_beat');
      assert.equal(item.observe().strategy_round, round);
      assert.equal(item.observe().strategy_delivery_count, round === recipe.terms.cadenceRounds ? 1 : 0);
      assert.equal(item.observe().strategy_agreement_enabled, true);
    }
  } finally { item.cleanup(); }
});

void test('expired offers remain refused rather than fabricating consent', () => {
  const item = fixture();
  try {
    for (let round = 0; round < TRADE_RULES.offerExpiryRounds; round++) item.call('strategic_beat');
    assert.equal(item.observe().strategy_can_consent, false);
    item.call('consent');
    assert.equal(item.observe().strategy_last_valid, false);
    assert.equal(item.observe().strategy_agreement_enabled, false);
    assert.equal(item.observe().strategy_delivery_count, 0);
  } finally { item.cleanup(); }
});

void test('operation and strategy probes are deterministic, resettable and isolated from all older worlds', () => {
  const first = fixture();
  const second = fixture();
  try {
    const before = first.observe();
    const saved = first.store.snapshot();
    for (const item of [first, second]) {
      for (const action of ['operate', 'production_beat', 'pause', 'consent', 'strategic_beat']) item.call(action);
    }
    assert.deepEqual(first.observe(), second.observe());
    assert.deepEqual(first.store.snapshot(), saved);
    for (const [key, value] of Object.entries(before)) {
      if (!key.startsWith('production_') && !key.startsWith('strategy_')) assert.deepEqual(first.observe()[key], value, key);
    }
    const operating = first.observe();
    for (const action of ['legacy_cycle', 'peer_action', 'found', 'feature_window']) first.call(action);
    for (const [key, value] of Object.entries(operating)) {
      if (key.startsWith('production_') || key.startsWith('strategy_')) assert.deepEqual(first.observe()[key], value, key);
    }
    first.reset();
    assert.deepEqual(first.observe(), before);
  } finally { first.cleanup(); second.cleanup(); }
});

void test('synthetic operation observations exactly project real component results and an actual pause receipt', () => {
  const probes = new OperationsProbes();
  let expected = probes.snapshot().production;
  assert.deepEqual(expected.cities[0]?.buildings, ['irrigation']);
  assert.deepEqual(expected.civilizations[0]?.technologies, []);
  allocateOperations(expected);
  probes.operate();
  assert.deepEqual(probes.snapshot().production, expected);
  const timestamp = '2026-10-16T00:01:00.000Z';
  const beat = catchUpStrategy(expected, timestamp);
  assert.equal(beat.ok, true);
  expected = beat.state;
  probes.productionBeat();
  assert.equal(probes.snapshot().productionTimestamp, timestamp);
  assert.deepEqual(probes.snapshot().production, expected);
  assert.deepEqual(probes.snapshot().productionEvents, beat.events);
  const pause = applyCommand(expected, { seat: 0, expectedRevision: expected.revision, action: { type: 'set-building-operation', cityId: 'city-0', buildingId: 'irrigation', enabled: false }, timestamp });
  assert.equal(pause.ok, true);
  assert.deepEqual(probes.pause(), pause);
  assert.deepEqual(probes.snapshot().production, pause.state);
  const saved = probes.snapshot();
  assert.equal(probes.pause().ok, false);
  assert.deepEqual(probes.snapshot(), saved);
  const detachedOwner = probes.snapshot().production.civilizations[0];
  assert.ok(detachedOwner);
  detachedOwner.resources.materials = 999;
  assert.deepEqual(probes.snapshot(), saved);
});

void test('strategy setup and due shipment replay through the actual engine with immutable terms and genuine events', () => {
  const epoch = '2026-10-16T00:00:00.000Z';
  let expected = createWorld(17, epoch);
  for (const targetReleaseId of ['settlement-foundations-2', 'settlement-independent-1']) {
    const next = applyRelease(expected, { expectedRevision: expected.revision, expectedFromReleaseId: expected.releaseId, targetReleaseId, timestamp: epoch });
    assert.equal(next.ok, true);
    expected = next.state;
  }
  const proposed = applyCommand(expected, { seat: 0, expectedRevision: expected.revision, action: { type: 'propose-trade', partner: 1, recipeId: 'harvest-for-materials' }, timestamp: epoch });
  assert.equal(proposed.ok, true);
  const probes = new OperationsProbes();
  assert.deepEqual(probes.snapshot().strategy, proposed.state);
  const offer = proposed.state.tradeOffers?.[0];
  assert.ok(offer);
  const accepted = applyCommand(proposed.state, { seat: 1, expectedRevision: proposed.state.revision, action: { type: 'respond-trade', offerId: offer.id, accept: true }, timestamp: epoch });
  assert.equal(accepted.ok, true);
  assert.deepEqual(probes.consent(), accepted);
  assert.deepEqual(probes.snapshot().strategy, accepted.state);
  assert.equal(accepted.state.routes[0]?.active, false);
  assert.equal(accepted.state.routes[0]?.volume, 0);
  assert.deepEqual(accepted.state.routes[0]?.agreement?.terms, offer.terms);
  assert.equal(probes.consent().ok, false);
  assert.deepEqual(probes.snapshot().strategy, accepted.state);
  const waited = applyCommand(accepted.state, { seat: 2, expectedRevision: accepted.state.revision, action: { type: 'wait' }, timestamp: epoch });
  assert.equal(waited.ok, true);
  assert.deepEqual(waited.state.routes, accepted.state.routes);
  expected = accepted.state;
  for (let round = 1; round <= offer.terms.cadenceRounds; round++) {
    probes.strategicBeat();
    const next = catchUpStrategy(expected, probes.snapshot().timestamp);
    assert.equal(next.ok, true);
    expected = next.state;
    assert.deepEqual(probes.snapshot().strategy, expected);
    assert.deepEqual(expected.routes[0]?.agreement?.terms, offer.terms);
  }
  const route = expected.routes[0];
  assert.ok(route?.agreement);
  assert.equal(route.agreement.deliveryCount, 1);
  assert.equal(route.agreement.lastDeliveryRound, offer.terms.cadenceRounds);
  assert.ok(route.volume > 0);
  assert.ok(expected.events.some((event) => event.type === 'trade-delivered' && event.detail === route.id));
});

void test('mixed synthetic allocation, scheduled production and pause keep a canonical independent world', () => {
  const probes = new OperationsProbes();
  for (const action of ['operate', 'productionBeat', 'pause', 'operate', 'productionBeat', 'pause'] as const) {
    const before = probes.snapshot().production;
    assert.equal(isWorldState(before), true, `before ${action}`);
    probes[action]();
    const after = probes.snapshot().production;
    assert.equal(isWorldState(after), true, `after ${action}`);
    assert.equal(after.round, before.round + (action === 'productionBeat' ? 1 : 0));
    assert.equal(after.independentTurns?.strategyTicks, after.round);
  }
  assert.equal(probes.snapshot().strategy.round, 0);
});
