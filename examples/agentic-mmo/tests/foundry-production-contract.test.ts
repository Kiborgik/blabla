import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FoundryProductionProbe } from '../cli/foundry-production-probe.ts';

await test('foundry standalone probe is lazy and unknown actions leave it untouched', () => {
  const probe = new FoundryProductionProbe(); const before = probe.snapshot();
  assert.equal(probe.observe().initialized, false); assert.throws(() => probe.call('invented'), RangeError); assert.deepEqual(probe.snapshot(), before);
  probe.reset(); assert.deepEqual(probe.snapshot(), before);
});

await test('foundry all nine draft actions expose actual transition-derived predicates', context => {
  const probe = new FoundryProductionProbe();
  const cases = [
    ['start_foundry', ['same_town', 'paid_once']], ['complete_foundry', ['completed', 'no_completion_output']],
    ['work_foundry', ['iron_paid', 'energy_paid', 'staffed', 'materials_made']], ['block_foundry', ['blocked', 'no_payment_or_output']],
    ['pause_foundry', ['paused', 'no_payment_or_output']], ['defer_arriving_iron', ['opening_stock_only']],
    ['resume_iron_exchange', ['iron_paid', 'shipment_resumed']], ['refuse_foundry_action', ['refused', 'no_effects']],
    ['replay_foundry_history', ['replay_exact']],
  ] as const;
  for (const [action, fields] of cases) {
    const start = performance.now(); probe.call(action);
    for (const field of fields) assert.equal(Reflect.get(probe.observe(), field), true, `${action}: ${field}`);
    context.diagnostic(`${action}: ${Math.round(performance.now() - start)}ms`);
  }
  assert.equal(probe.observe().replayed_frames, 686);
});

await test('foundry probe retains concrete operation and later shipment separately', () => {
  const probe = new FoundryProductionProbe(); probe.call('work_foundry'); const worked = probe.snapshot(); assert.ok(worked.state);
  const receipt = worked.state.cities.find(city => city.id === 'city-1')?.buildingOperations?.foundry?.lastResult; assert.ok(receipt);
  assert.deepEqual(receipt.strategicPaid, { iron: 1 }); assert.deepEqual(receipt.paid, { energy: 2 }); assert.equal(receipt.residents?.allocated, 3); assert.equal(receipt.produced.materials, 13.2);
  assert.equal(probe.observe().shipment_resumed, false);
  probe.call('resume_iron_exchange'); const resumed = probe.snapshot(); assert.ok(resumed.state && resumed.before && resumed.result);
  const prior = resumed.before.routes.find(route => route.id === 'route-338')?.agreement; const after = resumed.state.routes.find(route => route.id === 'route-338')?.agreement; assert.ok(prior && after);
  assert.equal(after.deliveryCount, prior.deliveryCount + 1); assert.equal(after.lastDeliveryRound, 589); assert.deepEqual(after.terms, prior.terms);
  assert.ok(resumed.result.events.some(event => event.strategicShipment?.routeId === 'route-338' && event.strategicShipment.proposerSent.iron === 2));
});

await test('foundry shortage and deferred extraction controls remain explicit synthetic states', () => {
  const probe = new FoundryProductionProbe(); probe.call('block_foundry'); const blocked = probe.snapshot();
  assert.match(probe.observe().provenance, /synthetic/); assert.equal(blocked.scarcity.length, 3);
  for (const control of blocked.scarcity) {
    const before = control.before.civilizations.find(actor => actor.id === 1); const after = control.after.civilizations.find(actor => actor.id === 1); assert.ok(before && after);
    assert.deepEqual(after.resources, before.resources); assert.deepEqual(after.strategicResources, before.strategicResources);
  }
  assert.equal(probe.observe().materials_made, false); probe.call('defer_arriving_iron'); assert.equal(probe.observe().opening_stock_only, true);
  const deferred = probe.snapshot(); assert.ok(deferred.deferred); assert.equal(deferred.deferred.afterExtraction.civilizations[0]?.strategicResources?.iron, 2);
  assert.equal(deferred.deferred.nextOpening.civilizations[0]?.strategicResources?.iron, 1);
});

await test('foundry refusal snapshots reset and separate instances are isolated', () => {
  const first = new FoundryProductionProbe(); const second = new FoundryProductionProbe(); first.call('work_foundry'); const retained = first.snapshot();
  assert.equal(second.observe().initialized, false); first.call('refuse_foundry_action'); assert.equal(first.observe().no_effects, true); assert.deepEqual(first.snapshot().state, retained.state);
  first.call('refuse_foundry_action'); assert.deepEqual(first.snapshot().state, retained.state);
  second.call('work_foundry'); assert.deepEqual(second.snapshot(), retained);
  const detached = second.snapshot(); assert.ok(detached.state); detached.state.cities.length = 0; assert.deepEqual(second.snapshot(), retained);
  first.reset(); assert.equal(first.observe().initialized, false); assert.deepEqual(second.snapshot(), retained);
  first.call('work_foundry'); assert.deepEqual(first.snapshot(), retained);
});
