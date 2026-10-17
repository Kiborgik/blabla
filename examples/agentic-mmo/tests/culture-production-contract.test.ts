import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorldState } from '../core/types.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { CultureProductionProbe } from '../cli/culture-production-probe.ts';

await test('culture probe stays lazy and unknown actions are adapter errors', () => {
  const probe = new CultureProductionProbe(); assert.equal(probe.observe().initialized, false);
  assert.equal(probe.snapshot().state, null); assert.throws(() => probe.call('invented'), RangeError);
  probe.reset(); assert.equal(probe.observe().initialized, false);
});

await test('actual exact Theater payment completion and later completed-wonder Culture satisfy predicates', context => {
  const probe = new CultureProductionProbe();
  for (const [action, fields] of [
    ['start_theater', ['paid_once', 'exact_site']],
    ['complete_theater', ['completed', 'no_completion_output']],
    ['work_theater', ['completed_wonder_only', 'culture_made']],
  ] as const) {
    const started = performance.now(); probe.call(action);
    for (const field of fields) assert.equal(Reflect.get(probe.observe(), field), true, `${action}: ${field}`);
    context.diagnostic(`${action}: ${Math.round(performance.now() - started)}ms`);
  }
  const value = probe.snapshot(); assert.ok(value.state); assert.ok(value.control);
  const actual = value.state.civilizations[0]; const control = value.control.state.civilizations[0]; assert.ok(actual && control); assert.ok(actual.resources.culture > control.resources.culture);
  probe.call('refuse_culture_action'); assert.equal(probe.observe().refused, true); assert.equal(probe.observe().no_effects, true);
  assert.deepEqual(probe.snapshot().state, value.state);
  probe.call('refuse_culture_action'); assert.deepEqual(probe.snapshot().state, value.state);
});

await test('actual locally staffed Printing pays complete inputs and legal pause stops recipe output', () => {
  const probe = new CultureProductionProbe(); probe.call('work_printing_house');
  for (const field of ['same_town', 'staffed', 'inputs_paid', 'culture_made'] as const) assert.equal(probe.observe()[field], true, field);
  const value = probe.snapshot(); const town = value.state?.cities.find(city => city.id === 'city-0'); assert.ok(town);
  const result = town.buildingOperations?.['printing-house']?.lastResult; assert.ok(result);
  assert.deepEqual(result.paid, { materials: 1 }); assert.equal(result.residents?.allocated, 3); assert.equal(result.produced.culture, 11.7);
  probe.call('pause_printing_house'); assert.equal(probe.observe().paused, true); assert.equal(probe.observe().no_payment_or_output, true);
  assert.equal(probe.observe().culture_made, false);
});

await test('culture replay snapshots reset and both instances are isolated', context => {
  const first = new CultureProductionProbe(); const second = new CultureProductionProbe();
  first.call('work_printing_house'); const retained = first.snapshot();
  assert.equal(second.observe().initialized, false); second.call('refuse_culture_action'); assert.equal(second.observe().no_effects, true);
  assert.deepEqual(first.snapshot(), retained);
  const started = performance.now(); second.call('replay_culture_history'); context.diagnostic(`replay_culture_history: ${Math.round(performance.now() - started)}ms`);
  assert.equal(second.observe().replay_exact, true); assert.deepEqual(second.snapshot().state, retained.state);
  const detached = first.snapshot(); assert.ok(detached.state); const owner = detached.state.civilizations[0]; assert.ok(owner); owner.resources.materials = -1;
  assert.deepEqual(first.snapshot(), retained); second.reset(); assert.equal(second.observe().initialized, false); assert.deepEqual(first.snapshot(), retained);
  second.call('work_printing_house'); assert.deepEqual(second.snapshot(), retained);
});

await test('explicit synthetic printing input and local resident shortages allocate nothing', () => {
  const probe = new CultureProductionProbe(); probe.call('work_printing_house'); const before = probe.snapshot().before; assert.ok(before);
  for (const shortage of ['materials', 'residents']) {
    const synthetic: WorldState = structuredClone(before); const city = synthetic.cities.find(town => town.id === 'city-0'); assert.ok(city);
    const owner = synthetic.civilizations[0]; assert.ok(owner); if (shortage === 'materials') owner.resources.materials = 0; else city.population = 3;
    allocateOperations(synthetic);
    const result = city.buildingOperations?.['printing-house']?.lastResult; assert.ok(result);
    assert.equal(result.status, 'blocked'); assert.deepEqual(result.paid, {}); assert.deepEqual(result.produced, {}); assert.equal(result.residents?.allocated, 0);
  }
  assert.deepEqual(probe.snapshot().before, before);
});
