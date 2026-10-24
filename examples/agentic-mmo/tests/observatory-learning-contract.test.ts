import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cityProductivity } from '../core/simulation/world.ts';
import { ObservatoryLearningProbe } from '../cli/observatory-learning-probe.ts';

await test('observatory standalone probe is lazy and rejects unknown actions without effects', () => {
  const probe = new ObservatoryLearningProbe(); const before = probe.snapshot();
  assert.equal(probe.observe().initialized, false); assert.throws(() => probe.call('invented'), RangeError); assert.deepEqual(probe.snapshot(), before);
  probe.reset(); assert.deepEqual(probe.snapshot(), before);
});

await test('observatory six draft actions derive their predicates from actual transitions', context => {
  const probe = new ObservatoryLearningProbe();
  const cases = [
    ['start_observatory', ['same_town', 'exact_campus', 'adjacent_high_ground', 'paid_once']],
    ['complete_observatory', ['completed', 'no_completion_output']],
    ['work_observatory', ['credits_paid', 'residents_allocated', 'science_made']],
    ['block_observatory', ['blocked', 'no_payment_or_output']],
    ['refuse_observatory_action', ['refused', 'no_effects']],
    ['replay_observatory_history', ['replay_exact']],
  ] as const;
  for (const [action, fields] of cases) {
    const start = performance.now(); probe.call(action);
    for (const field of fields) assert.equal(Reflect.get(probe.observe(), field), true, `${action}: ${field}`);
    context.diagnostic(`${action}: ${Math.round(performance.now() - start)}ms`);
  }
  const replayed = probe.snapshot().state; assert.ok(replayed); assert.equal(probe.observe().replayed_frames, replayed.revision);
});

await test('observatory probe preserves exact source and distinct completion and operation facts', () => {
  const probe = new ObservatoryLearningProbe(); probe.call('start_observatory');
  const order = probe.snapshot().state?.cities.find(city => city.id === 'city-0')?.construction?.active;
  assert.ok(order && !('kind' in order)); assert.deepEqual(order.highGround, { campusTileId: 39, sourceTileId: 22 }); assert.deepEqual(order.paid, { materials: 30, credits: 16 });
  probe.call('complete_observatory'); const completion = probe.snapshot(); assert.ok(completion.control?.ok);
  assert.equal(completion.state?.cities.find(city => city.id === 'city-0')?.buildingOperations?.observatory?.lastResult, null);
  assert.equal(probe.observe().science_made, false); assert.match(probe.observe().provenance, /synthetic order-removal/);
  probe.call('work_observatory'); const receipt = probe.snapshot().state?.cities.find(city => city.id === 'city-0')?.buildingOperations?.observatory?.lastResult;
  assert.ok(receipt); assert.equal(receipt.round, probe.snapshot().state?.round); assert.equal(receipt.round, (probe.snapshot().before?.round ?? -1) + 1); assert.deepEqual(receipt.paid, { credits: 2 }); assert.equal(receipt.residents?.allocated, 3); const opening = probe.snapshot().before?.cities.find(city => city.id === 'city-0'); assert.ok(opening); assert.deepEqual(receipt.produced, { science: Math.round(7 * cityProductivity(opening) * 100) / 100 });
});

await test('observatory synthetic shortages preserve complete opening resources', () => {
  const probe = new ObservatoryLearningProbe(); probe.call('block_observatory'); const snapshot = probe.snapshot();
  assert.match(probe.observe().provenance, /synthetic/); assert.deepEqual(snapshot.scarcity.map(item => item.missing), ['credits', 'residents']);
  for (const control of snapshot.scarcity) {
    assert.deepEqual(control.after.civilizations, control.before.civilizations);
    const result = control.after.cities.find(city => city.id === 'city-0')?.buildingOperations?.observatory?.lastResult; assert.ok(result);
    assert.equal(result.status, 'blocked'); assert.deepEqual(result.paid, {}); assert.deepEqual(result.produced, {}); assert.equal(result.residents?.allocated, 0);
  }
  assert.equal(probe.observe().science_made, false);
});

await test('observatory repeated refusal reset and detached instances preserve exact states', () => {
  const first = new ObservatoryLearningProbe(); const second = new ObservatoryLearningProbe(); first.call('work_observatory'); const retained = first.snapshot();
  assert.equal(second.observe().initialized, false); first.call('refuse_observatory_action'); assert.equal(first.observe().no_effects, true); assert.deepEqual(first.snapshot().state, retained.state);
  first.call('refuse_observatory_action'); assert.deepEqual(first.snapshot().state, retained.state);
  second.call('work_observatory'); assert.deepEqual(second.snapshot(), retained);
  const detached = second.snapshot(); assert.ok(detached.state); detached.state.cities.length = 0; assert.deepEqual(second.snapshot(), retained);
  first.reset(); assert.equal(first.observe().initialized, false); assert.deepEqual(second.snapshot(), retained); first.call('work_observatory'); assert.deepEqual(first.snapshot(), retained);
});
