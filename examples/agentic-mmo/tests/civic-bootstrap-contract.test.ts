import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

void test('civic draft contract is registered before implementation', () => {
  assert.match(readFileSync(new URL('../project.bla', import.meta.url), 'utf8'), /draft behavior "contracts\/civic-bootstrap\.bla"/);
  assert.match(readFileSync(new URL('../contracts/civic-bootstrap.bla', import.meta.url), 'utf8'), /only-actual-culture-output-funds-civic-work/);
});

import { CivicBootstrapProbe } from '../cli/civic-bootstrap-probe.ts';

void test('civic standalone probe is lazy and refuses unknown operations without effects', () => {
  const probe = new CivicBootstrapProbe(); const before = probe.snapshot();
  assert.equal(probe.observe().initialized, false); assert.throws(() => probe.call('invented'), RangeError); assert.deepEqual(probe.snapshot(), before);
  probe.reset(); assert.deepEqual(probe.snapshot(), before);
});

void test('eight civic draft actions derive their predicates from actual transitions and labeled controls', context => {
  const probe = new CivicBootstrapProbe();
  const cases = [
    ['start_civic', ['selected_explicitly', 'cost_snapshotted', 'science_independent']],
    ['invest_culture', ['current_culture_only', 'culture_conserved', 'science_independent']],
    ['complete_civic', ['completed_once', 'entitlement_exact', 'successor_unselected']],
    ['adopt_arrangement', ['target_prerequisites', 'assignments_valid', 'payment_exact', 'commitment_enforced']],
    ['work_with_arrangement', ['opening_food_exact', 'opening_work_exact', 'completion_before_output']],
    ['resolve_government_transition', ['transition_timing_exact', 'transition_outputs_exact', 'fixed_transfers_preserved', 'commitment_enforced']],
    ['refuse_civic_action', ['refused', 'no_effects']],
    ['replay_civic_history', ['replay_exact']],
  ] as const;
  for (const [action, fields] of cases) { const start = performance.now(); probe.call(action); for (const field of fields) assert.equal(Reflect.get(probe.observe(), field), true, `${action}: ${field}`); context.diagnostic(`${action}: ${Math.round(performance.now() - start)}ms`); if (action === 'resolve_government_transition') assert.match(probe.observe().provenance, /synthetic advanced-government/); }
  const replayed = probe.snapshot().state; assert.ok(replayed); assert.equal(probe.observe().replayed_frames, replayed.revision);
  const retained = probe.snapshot(); const detached = probe.snapshot(); assert.ok(detached.state); detached.state.cities.length = 0; assert.deepEqual(probe.snapshot(), retained);
  probe.call('refuse_civic_action'); assert.deepEqual(probe.snapshot().state, retained.state); probe.reset(); assert.equal(probe.observe().initialized, false);
});
