import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalGrowthProbe } from '../cli/local-growth-probe.ts';

await test('local growth probe is lazy isolated and resets without a legal journey', () => {
  const first = new LocalGrowthProbe(); const second = new LocalGrowthProbe();
  const initial = first.observe();
  assert.equal(initial.initialized, false);
  for (let count = 0; count < 20; count++) { first.reset(); assert.deepEqual(first.observe(), initial); }
  assert.deepEqual(second.observe(), initial);
  assert.throws(() => first.call('absent'), /Unknown/);
  assert.deepEqual(first.observe(), initial);
});

await test('local growth six real actions expose positive adoption completion growth staffing founding and refusal', () => {
  const probe = new LocalGrowthProbe(); const other = new LocalGrowthProbe(); const untouched = other.observe();
  probe.call('adopt_local_housing');
  assert.equal(probe.observe().preserved, true); assert.equal(probe.observe().conserved_old_people, true);
  probe.call('complete_granary');
  assert.equal(probe.observe().exact_local_capacity, true); assert.equal(probe.observe().completion_no_population, true);
  assert.equal(probe.observe().eligible_funded_growth, true);
  const before = probe.snapshot();
  probe.call('grow_with_food');
  for (const field of ['grew', 'exact_local_capacity', 'paid_exact_food', 'growth_uses_old_opening_allocation'] as const) assert.equal(probe.observe()[field], true, field);
  assert.deepEqual(before.state, probe.snapshot().before);
  assert.equal(probe.observe().population, 21);
  probe.call('allocate_later_resident');
  assert.equal(probe.observe().next_opening_supports_recipe, true); assert.equal(probe.observe().complete_recipe_inputs, true);
  probe.call('found_housed_town');
  assert.equal(probe.observe().correct_founded_capacity, true); assert.equal(probe.observe().conserved_old_people, true);
  probe.call('refuse_invalid_growth');
  assert.equal(probe.observe().refused, true); assert.equal(probe.observe().no_effects, true);
  const detached = probe.snapshot(); assert.ok(detached.state); detached.state.round = -99;
  assert.notEqual(probe.snapshot().state?.round, -99);
  assert.deepEqual(other.observe(), untouched);
  assert.deepEqual(probe.snapshot().result?.events, []);
});

await test('local growth observed scarcity and full capacity never masquerade as command refusal', () => {
  const probe = new LocalGrowthProbe();
  for (const mode of ['shortage', 'wellbeing', 'capacity'] as const) {
    probe.prepareScarcity(mode);
    assert.match(probe.observe().provenance, /Synthetic/);
    assert.equal(probe.observe().eligible_funded_growth, false);
    const before = probe.snapshot().state;
    probe.call('grow_with_food');
    assert.deepEqual(probe.snapshot().before, before);
    assert.equal(probe.observe().grew, false);
    assert.equal(probe.observe().refused, false);
  }
});

await test('local growth repeated action order has actual finite transitions and deterministic reset', () => {
  const probe = new LocalGrowthProbe();
  probe.call('allocate_later_resident'); const first = probe.snapshot();
  probe.reset(); probe.call('allocate_later_resident'); assert.deepEqual(probe.snapshot(), first);
  probe.call('complete_granary');
  for (let count = 0; count < 6; count++) {
    const eligible = probe.observe().eligible_funded_growth; probe.call('grow_with_food');
    const after = probe.observe();
    if (eligible) assert.equal(after.grew, true);
    if (after.grew) for (const field of ['exact_local_capacity', 'paid_exact_food', 'growth_uses_old_opening_allocation'] as const) assert.equal(after[field], true, field);
  }
  assert.equal(probe.observe().population, 24); assert.equal(probe.observe().grew, false);
  probe.call('adopt_local_housing'); assert.equal(probe.observe().next_opening_supports_recipe, false);
});
