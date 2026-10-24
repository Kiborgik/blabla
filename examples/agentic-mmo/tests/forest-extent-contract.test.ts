import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForestExtentProbe } from '../cli/forest-extent-probe.ts';

await test('forest extent probe stays lazy, rejects unknown actions and resets detached state', () => {
  const probe = new ForestExtentProbe();
  assert.equal(probe.observe().initialized, false);
  assert.equal(probe.snapshot().state, null);
  assert.throws(() => probe.call('invented'), RangeError);
  assert.equal(probe.observe().initialized, false);
  probe.reset(); assert.equal(probe.snapshot().state, null);
});

await test('forest exact real payment completion later production pause and refusal satisfy draft', () => {
  const probe = new ForestExtentProbe();
  const cases: Array<[string, string[]]> = [
    ['start_lumber_mill', ['exact_owned_forest', 'paid_once']],
    ['complete_lumber_mill', ['completed', 'no_completion_output']],
    ['work_lumber_mill', ['staffed', 'materials_made', 'shared_numeric_allocation']],
    ['pause_forest_work', ['paused_or_ineligible', 'no_payment_or_output']],
    ['refuse_forest_action', ['refused', 'no_effects']],
  ];
  for (const [action, fields] of cases) {
    probe.call(action); const observed = probe.observe();
    for (const field of fields) assert.equal(Reflect.get(observed, field), true, `${action}: ${field}`);
  }
  const before = probe.snapshot().state;
  probe.call('refuse_forest_action'); assert.deepEqual(probe.snapshot().state, before);
  const detached = probe.snapshot(); if (detached.state) detached.state.round += 999;
  assert.deepEqual(probe.snapshot().state, before);
});

await test('fresh expanded world supports conserved paid settlement and later output', () => {
  const probe = new ForestExtentProbe();
  const cases: Array<[string, string[]]> = [
    ['found_new_extent_town', ['new_site_reachable', 'new_town_founded', 'population_conserved', 'paid_once', 'only_claimed_center_owned']],
    ['operate_new_extent_town', ['later_base_output']],
    ['refuse_extent_action', ['refused', 'no_effects']],
  ];
  for (const [action, fields] of cases) {
    probe.call(action); const observed = probe.observe();
    for (const field of fields) assert.equal(Reflect.get(observed, field), true, `${action}: ${field}`);
  }
  const before = probe.snapshot().state;
  probe.call('refuse_extent_action'); assert.deepEqual(probe.snapshot().state, before);
});

await test('forest and extent positive fixtures are deterministic and do not share observed state', () => {
  const first = new ForestExtentProbe(); const second = new ForestExtentProbe();
  first.call('work_lumber_mill'); const forest = first.snapshot();
  second.call('found_new_extent_town'); assert.deepEqual(first.snapshot(), forest);
  first.call('found_new_extent_town'); assert.deepEqual(first.snapshot(), second.snapshot());
  first.reset(); assert.equal(first.observe().initialized, false); assert.equal(second.observe().initialized, true);
  first.call('work_lumber_mill'); assert.deepEqual(first.snapshot(), forest);
  first.call('refuse_extent_action'); assert.equal(first.observe().no_effects, true);
  second.call('refuse_forest_action'); assert.equal(second.observe().no_effects, true);
});
