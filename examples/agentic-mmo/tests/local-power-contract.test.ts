import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

void test('the approved local Power draft is registered before runtime and retains eight actions fourteen rules', () => {
  assert.match(readFileSync(new URL('../project.bla', import.meta.url), 'utf8'), /draft behavior "contracts\/local-power\.bla"/);
  const contract = readFileSync(new URL('../contracts/local-power.bla', import.meta.url), 'utf8');
  assert.equal([...contract.matchAll(/^action /gm)].length, 8); assert.equal([...contract.matchAll(/    expect /g)].length, 14);
});

import { LocalPowerProbe } from '../cli/local-power-probe.ts';
void test('local Power probe derives all fourteen rules from genuine source transitions and labeled controls', context => {
  const probe = new LocalPowerProbe(); const initial = probe.snapshot();
  assert.equal(probe.observe().initialized, false); assert.throws(() => probe.call('invented'), RangeError); assert.deepEqual(probe.snapshot(), initial);
  const contract = readFileSync(new URL('../contracts/local-power.bla', import.meta.url), 'utf8'); const failures: string[] = [];
  for (const match of contract.matchAll(/when (\w+) \{([\s\S]*?)\n\}/g)) {
    const action = match[1]; assert.ok(action); probe.call(action);
    context.diagnostic(`${action}: ${JSON.stringify(probe.observe())}`);
    for (const field of new Set([...match[2]?.matchAll(/after\.(\w+)/g) ?? []].map(item => item[1]))) if (Reflect.get(probe.observe(), field ?? '') !== true) failures.push(`${action}: ${field}`);
  }
  assert.deepEqual(failures, []);
  const detached = probe.snapshot(); if (detached.state) detached.state.cities.length = 0; assert.notDeepEqual(detached, probe.snapshot());
  probe.reset(); assert.deepEqual(probe.snapshot(), initial);
});
