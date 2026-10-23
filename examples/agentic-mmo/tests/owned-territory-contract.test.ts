import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OwnedTerritoryProbe } from '../cli/owned-territory-probe.ts';

await test('territory probe is lazy and unknown actions remain adapter errors', () => {
  const probe = new OwnedTerritoryProbe();
  assert.equal(probe.observe().initialized, false); assert.equal(probe.snapshot().state, null);
  assert.throws(() => probe.call('invented'), RangeError);
  probe.reset(); assert.equal(probe.observe().initialized, false);
});

await test('real payment beneficiary and later purchased horse output satisfy contract', context => {
  const probe = new OwnedTerritoryProbe();
  for (const [action, fields] of [
    ['purchase_exact_land', ['exact_beneficiary', 'paid_once', 'connected_path_retained', 'actual_owner_changed']],
    ['work_purchased_resource', ['same_town_worked', 'later_staffed_output', 'retained_resource_unchanged']],
  ] as const) {
    const started = performance.now(); probe.call(action);
    for (const field of fields) assert.equal(Reflect.get(probe.observe(), field), true, `${action}: ${field}`);
    context.diagnostic(`${action}: ${Math.round(performance.now() - started)}ms`);
  }
  const snapshot = probe.snapshot(); assert.ok(snapshot.state);
  const receipt = snapshot.state.tileAcquisitions?.['164']; assert.ok(receipt); assert.equal(receipt.paid.credits, 18); assert.equal(receipt.civId, 2); assert.equal(receipt.cityTileId, 199);
  const city = snapshot.state.cities.find(town => town.id === receipt.cityId); assert.ok(city);
  assert.ok((city.improvements?.['164']?.operation.lastResult?.produced.food ?? 0) > 0);
  probe.call('refuse_territory_action'); assert.equal(probe.observe().refused, true); assert.equal(probe.observe().no_effects, true);
  assert.deepEqual(probe.snapshot().state, snapshot.state);
  probe.call('refuse_territory_action'); assert.deepEqual(probe.snapshot().state, snapshot.state);
});

await test('real new-row purchased forest produces and full canonical history replays', context => {
  const probe = new OwnedTerritoryProbe(); let started = performance.now(); probe.call('work_new_extent_land');
  context.diagnostic(`work_new_extent_land: ${Math.round(performance.now() - started)}ms`);
  assert.equal(probe.observe().same_town_worked, true); assert.equal(probe.observe().later_staffed_output, true);
  const state = probe.snapshot().state; assert.ok(state);
  const receipt = state.tileAcquisitions?.['237']; assert.ok(receipt); assert.deepEqual(receipt.pathTileIds, [218, 219, 237]);
  const city = state.cities.find(town => town.id === receipt.cityId); assert.ok(city); assert.equal(city.tileId, 218);
  assert.ok((city.improvements?.['237']?.operation.lastResult?.produced.materials ?? 0) > 0);
  started = performance.now(); probe.call('replay_territory_history'); context.diagnostic(`replay_territory_history: ${Math.round(performance.now() - started)}ms`);
  assert.equal(probe.observe().history_retained, true); assert.deepEqual(probe.snapshot().state, state);
});

await test('territory snapshots reset and instances preserve two-way isolation', () => {
  const first = new OwnedTerritoryProbe(); const second = new OwnedTerritoryProbe();
  first.call('purchase_exact_land'); const retained = first.snapshot();
  assert.equal(second.observe().initialized, false); second.call('refuse_territory_action'); assert.equal(second.observe().no_effects, true);
  assert.deepEqual(first.snapshot(), retained);
  second.call('purchase_exact_land'); assert.deepEqual(second.snapshot(), retained);
  const detached = second.snapshot(); assert.ok(detached.state); const tile = detached.state.tiles[164]; assert.ok(tile); tile.owner = null;
  assert.deepEqual(second.snapshot(), retained);
  first.reset(); assert.equal(first.observe().initialized, false); assert.deepEqual(second.snapshot(), retained);
  first.call('purchase_exact_land'); assert.deepEqual(first.snapshot(), retained);
});
