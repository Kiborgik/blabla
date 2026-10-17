import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SecondGovernmentProbe, SECOND_GOVERNMENT_ACTIONS } from '../cli/second-government-probe.ts';
import { CivicBootstrapProbe } from '../cli/civic-bootstrap-probe.ts';

void test('second government contract remains a cohesive registered civic draft', () => {
  const contract = readFileSync(new URL('../contracts/civic-bootstrap.bla', import.meta.url), 'utf8');
  assert.match(readFileSync(new URL('../project.bla', import.meta.url), 'utf8'), /draft behavior "contracts\/civic-bootstrap\.bla"/);
  assert.equal([...contract.matchAll(/^action /gm)].length, 17); assert.equal([...contract.matchAll(/expect "/g)].length, 23);
  for (const action of SECOND_GOVERNMENT_ACTIONS) assert.ok(contract.includes(`action ${action}()`));
});

void test('second government probes reject unknown actions lazily and return detached snapshots', () => {
  for (const probe of [new SecondGovernmentProbe(), new CivicBootstrapProbe()]) {
    const before = probe.snapshot(); assert.equal(probe.observe().initialized, false);
    assert.throws(() => probe.call('invented-second-government'), RangeError); assert.deepEqual(probe.snapshot(), before);
    probe.reset(); assert.deepEqual(probe.snapshot(), before);
  }
});

void test('eight second government actions witness all fourteen exact draft rules', context => {
  const contract = readFileSync(new URL('../contracts/civic-bootstrap.bla', import.meta.url), 'utf8');
  const probe = new CivicBootstrapProbe();
  for (const action of SECOND_GOVERNMENT_ACTIONS) {
    const started = performance.now(); probe.call(action);
    const body = contract.split(`when ${action} {`)[1]?.split('}')[0]; assert.ok(body);
    for (const match of body.matchAll(/after\.(\w+)(?: == (\d+))?/g)) assert.equal(Reflect.get(probe.observe(), match[1]!), match[2] === undefined ? true : Number(match[2]), `${action}: ${match[1]}`);
    context.diagnostic(`${action}: ${Math.round(performance.now() - started)}ms`);
  }
  assert.equal(probe.observe().replayed_frames, 906);
  const original = probe.snapshot(); const copy = probe.snapshot(); assert.ok(copy.state); copy.state.cities.length = 0;
  assert.deepEqual(probe.snapshot(), original); assert.throws(() => probe.call('invented-second-government'), RangeError); assert.deepEqual(probe.snapshot(), original);
  probe.reset(); assert.equal(probe.observe().initialized, false);
});
