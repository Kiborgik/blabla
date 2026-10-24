import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PoweredScienceProbe, POWERED_SCIENCE_ACTIONS } from '../cli/powered-science-probe.ts';
import { LocalPowerProbe } from '../cli/local-power-probe.ts';

void test('powered Science remains in the cohesive registered fourteen-action twenty-six-rule Power draft', () => {
  const contract = readFileSync(new URL('../contracts/local-power.bla', import.meta.url), 'utf8');
  assert.match(readFileSync(new URL('../project.bla', import.meta.url), 'utf8'), /draft behavior "contracts\/local-power\.bla"/);
  assert.equal([...contract.matchAll(/^action /gm)].length, 14); assert.equal([...contract.matchAll(/expect "/g)].length, 26);
  for (const action of POWERED_SCIENCE_ACTIONS) assert.ok(contract.includes(`action ${action}()`));
});

void test('powered Science probes reject unknown calls lazily without changing snapshots', () => {
  for (const probe of [new PoweredScienceProbe(), new LocalPowerProbe()]) {
    const before = probe.snapshot(); assert.equal(probe.observe().initialized, false); assert.throws(() => probe.call('invented-powered-science'), RangeError); assert.deepEqual(probe.snapshot(), before);
    probe.reset(); assert.deepEqual(probe.snapshot(), before);
  }
});

void test('seven powered Science actions derive all thirteen rules from actual transitions and labelled controls', context => {
  const contract = readFileSync(new URL('../contracts/local-power.bla', import.meta.url), 'utf8'); const probe = new LocalPowerProbe(); const failures: string[] = [];
  for (const action of POWERED_SCIENCE_ACTIONS) {
    probe.call(action); const body = contract.split(`when ${action} {`)[1]?.split('}')[0]; assert.ok(body);
    for (const match of body.matchAll(/after\.(\w+)(?: == (\d+))?/g)) { const field = match[1]; assert.ok(field); if (Reflect.get(probe.observe(), field) !== (match[2] === undefined ? true : Number(match[2]))) failures.push(`${action}: ${field}=${Reflect.get(probe.observe(), field)}`); }
    context.diagnostic(`${action}: ${JSON.stringify(probe.observe())}`);
  }
  assert.deepEqual(failures, []); const replayed = probe.snapshot().state; assert.ok(replayed); assert.equal(probe.observe().replayed_frames, replayed.revision);
  const original = probe.snapshot(); const copy = probe.snapshot(); assert.ok(copy.state); copy.state.cities.length = 0; assert.deepEqual(probe.snapshot(), original);
  assert.throws(() => probe.call('invented-powered-science'), RangeError); assert.deepEqual(probe.snapshot(), original); probe.reset(); assert.equal(probe.observe().initialized, false);
});
