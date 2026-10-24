import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LandTransportProbes } from '../cli/land-transport-probes.ts';
import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import { TURN_RULES } from '../core/content.ts';
import { isWorldState } from '../core/validation.ts';
import { createCampaignAdapter } from '../cli/adapter.ts';
import { GameStore, isRecord } from '../cli/store.ts';

await test('land contract actions have real bindings and positive consent and due witnesses', () => {
  const directory = mkdtempSync(join(tmpdir(), 'land-bindings-'));
  try {
    const store = new GameStore(join(directory, 'world.json'));
    const adapter = createCampaignAdapter(store);
    adapter.handle({ op: 'reset' });
    const before = store.snapshot();
    const call = (name: string, args: number[] = []) => adapter.handle({ op: 'call', name, args });
    const observe = () => { const view = adapter.handle({ op: 'observe' }); assert.ok(isRecord(view)); return view; };
    const initial = observe();
    call('eligible_land_consent_fixture');
    assert.equal(observe().land_consent_eligible, true, 'Eligible land consent action must bind to an actual engine fixture');
    assert.equal(initial.land_initialized, false, 'Unrelated reset must not build geographic fixtures');
    assert.equal(observe().land_consent_eligible, true);
    assert.equal(observe().land_quote_valid, true);
    call('consent_land_exchange');
    assert.equal(observe().land_consent_accepted, true);
    assert.equal(observe().land_quote_preserved, true);
    call('funded_due_land_fixture');
    assert.equal(observe().land_attempt_due, true);
    assert.equal(observe().land_exchange_funded, true);
    call('resolve_land_exchange');
    assert.equal(observe().land_delivered, true);
    assert.equal(observe().land_payment_exact, true);
    call('restart_consented_exchange');
    assert.equal(observe().land_restart_preserved, true);
    assert.deepEqual(store.snapshot(), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

await test('positive consent is the exact canonical command result and keeps quoted terms', () => {
  const probes = new LandTransportProbes();
  probes.prepare(1);
  const before = probes.snapshot();
  assert.ok(before.state);
  assert.equal(before.synthetic, '');
  const offer = before.state.tradeOffers?.[0];
  assert.ok(offer?.terms.transport);
  const actual = applyCommand(before.state, { seat: 3, expectedRevision: before.state.revision, action: { type: 'respond-trade', offerId: offer.id, accept: true }, timestamp: '2026-10-16T00:00:00.000Z' });
  probes.consent();
  const after = probes.snapshot();
  assert.deepEqual(after.result, actual);
  assert.deepEqual(after.state, actual.state);
  assert.deepEqual(after.state?.routes[0]?.agreement?.terms, offer.terms);
  assert.equal(probes.observe().land_cadence_exact, true);
  assert.equal(after.state?.routes[0]?.agreement?.nextDeliveryRound, 5);
  probes.consent();
  assert.equal(probes.observe().land_consent_accepted, false);
  assert.equal(probes.observe().land_refusal_unchanged, true);
  assert.deepEqual(probes.snapshot().state, after.state);
});

await test('funded due fixture is a legal journey and resolves through a complete replayable economy beat', () => {
  const probes = new LandTransportProbes();
  probes.prepare(2);
  const before = probes.snapshot();
  assert.ok(before.state);
  assert.equal(before.synthetic, '');
  assert.equal(before.state.round, 4);
  assert.equal(probes.observe().land_attempt_due, true);
  assert.equal(probes.observe().land_exchange_funded, true);
  assert.equal(probes.observe().land_quote_valid, true);
  const restored: unknown = JSON.parse(JSON.stringify(before.state));
  assert.ok(isWorldState(restored));
  const timestamp = new Date(Date.parse('2026-10-16T00:00:00.000Z') + 5 * TURN_RULES.strategyIntervalMs).toISOString();
  const actual = catchUpStrategy(restored, timestamp);
  probes.resolve();
  const after = probes.snapshot();
  assert.deepEqual(after.result, actual);
  assert.deepEqual(after.state, actual.state);
  assert.equal(probes.observe().land_delivered, true);
  assert.equal(probes.observe().land_attempt_due, false);
  assert.equal(probes.observe().land_last_attempt_due, true);
  assert.equal(probes.observe().land_payment_exact, true);
  assert.equal(after.state?.routes[0]?.agreement?.nextDeliveryRound, 10);
  assert.equal(after.control?.state.routes[0]?.agreement?.enabled, false);
  assert.equal(after.control?.state.routes[0]?.agreement?.deliveryCount, 0);
  assert.equal(after.state?.routes[0]?.agreement?.deliveryCount, 1);
  probes.resolve();
  assert.equal(probes.observe().land_delivered, false);
  assert.equal(probes.observe().land_attempt_due, false);
  assert.equal(probes.observe().land_last_attempt_due, false);
  assert.equal(probes.observe().land_refusal_unchanged, true);
});

await test('synthetic impassable quote refuses consent with no payment or retargeting', () => {
  const probes = new LandTransportProbes();
  probes.prepare(3);
  const before = probes.snapshot();
  assert.match(before.synthetic, /Synthetic impassable/);
  assert.equal(probes.observe().land_quote_valid, false);
  assert.equal(probes.observe().land_consent_eligible, false);
  probes.consent();
  assert.equal(probes.observe().land_consent_accepted, false);
  assert.equal(probes.observe().land_refusal_unchanged, true);
  assert.deepEqual(probes.snapshot().state, before.state);
  assert.match(probes.snapshot().result?.error ?? '', /not legal/);
  probes.quote();
  assert.equal(probes.observe().land_quote_valid, true);
  assert.equal(probes.observe().land_cadence_exact, true);
});

await test('synthetic path damage and shortage block due exchange without altering the control economy', () => {
  for (const kind of [4, 5, 7]) {
    const probes = new LandTransportProbes();
    probes.prepare(kind);
    const before = probes.snapshot();
    assert.ok(before.synthetic.startsWith('Synthetic'));
    assert.equal(probes.observe().land_attempt_due, true);
    if (kind === 4) assert.equal(probes.observe().land_quote_valid, false);
    if (kind === 5) assert.equal(probes.observe().land_exchange_funded, false);
    if (kind === 7) {
      assert.equal(probes.observe().land_route_usable, false);
      assert.equal(probes.observe().land_exchange_funded, true);
      assert.equal(probes.observe().land_quote_valid, true);
    }
    probes.resolve();
    const after = probes.snapshot();
    assert.equal(probes.observe().land_delivered, false);
    assert.equal(probes.observe().land_refusal_unchanged, true);
    assert.deepEqual(after.state?.civilizations.map(owner => owner.resources), after.control?.state.civilizations.map(owner => owner.resources));
    assert.deepEqual(after.state?.routes[0]?.agreement?.terms, before.state?.routes[0]?.agreement?.terms);
    assert.equal(after.state?.routes[0]?.agreement?.lastAttemptRound, 5);
    assert.equal(after.state?.routes[0]?.agreement?.nextDeliveryRound, 10);
    assert.equal(after.result?.events.some(event => event.type === 'trade-blocked'), true);
  }
});

await test('a valid funded early exchange remains unpaid before its accepted interval', () => {
  const probes = new LandTransportProbes();
  probes.prepare(6);
  assert.equal(probes.observe().land_quote_valid, true);
  assert.equal(probes.observe().land_exchange_funded, true);
  assert.equal(probes.observe().land_attempt_due, false);
  probes.resolve();
  assert.equal(probes.observe().land_delivered, false);
  assert.equal(probes.observe().land_refusal_unchanged, true);
  assert.equal(probes.snapshot().state?.routes[0]?.agreement?.lastAttemptRound, null);
});

await test('current land acceptance preserves exact quoted terms and schedule across JSON restart', () => {
  const probes = new LandTransportProbes();
  probes.restartConsented();
  const restarted = probes.snapshot().restarted;
  assert.ok(restarted);
  assert.equal(restarted.before.round, 2);
  const offer = restarted.before.tradeOffers?.[0]; const agreement = restarted.accepted.routes[0]?.agreement;
  assert.ok(offer && agreement); assert.equal(offer.terms.transport?.mode, 'land');
  assert.equal(agreement.nextDeliveryRound, agreement.acceptedRound + offer.terms.cadenceRounds);
  assert.deepEqual(agreement.terms, offer.terms);
  assert.deepEqual(restarted.before, restarted.restored);
  assert.deepEqual(restarted.accepted, restarted.replay);
  assert.equal(probes.observe().land_restart_preserved, true);
});

await test('initialization is lazy, hostile fixture integers are bounded, and reset and snapshots are detached', () => {
  const first = new LandTransportProbes();
  const second = new LandTransportProbes();
  assert.equal(first.snapshot().state, null);
  assert.equal(first.observe().land_initialized, false);
  for (const kind of [0, 1, 2, 3, 4, 5, 6, 7, -1, Number.MAX_SAFE_INTEGER]) {
    first.prepare(kind);
    second.prepare(kind);
    assert.deepEqual(first.snapshot(), second.snapshot());
    assert.deepEqual(first.observe(), second.observe());
    const detached = first.snapshot();
    assert.ok(detached.state);
    detached.state.routes.length = 0;
    detached.state.civilizations.length = 0;
    assert.deepEqual(first.snapshot(), second.snapshot());
  }
  first.reset();
  assert.equal(first.snapshot().state, null);
  assert.equal(first.observe().land_initialized, false);
  first.prepare(2);
  second.prepare(2);
  assert.deepEqual(first.snapshot(), second.snapshot());
});
