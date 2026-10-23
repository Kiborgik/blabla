import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

void test('industrial steam draft is registered before runtime implementation', () => {
  assert.match(readFileSync(new URL('../project.bla', import.meta.url), 'utf8'), /draft behavior "contracts\/industrial-steam\.bla"/);
  assert.match(readFileSync(new URL('../contracts/industrial-steam.bla', import.meta.url), 'utf8'), /industrial-era-requires-two-operated-towns-and-a-genuine-steam-delivery/);
});

import { IndustrialSteamProbe } from '../cli/industrial-steam-probe.ts';
void test('industrial probe is lazy, detached and derives all eleven current rules from transitions or labelled controls', context => {
  const probe = new IndustrialSteamProbe(); const initial = probe.snapshot();
  assert.equal(probe.observe().initialized, false); assert.throws(() => probe.call('invented'), RangeError); assert.deepEqual(probe.snapshot(), initial);
  const contract = readFileSync(new URL('../contracts/industrial-steam.bla', import.meta.url), 'utf8');
  const failures: string[] = [];
  for (const match of contract.matchAll(/when (\w+) \{([\s\S]*?)\n\}/g)) {
    const action = match[1]; assert.ok(action); probe.call(action); context.diagnostic(`${action}: controls ${probe.observe().controls}, replayed frames ${probe.observe().replayed_frames}`);
    for (const field of new Set([...match[2]?.matchAll(/after\.(\w+)/g) ?? []].map(item => item[1]))) if (Reflect.get(probe.observe(), field ?? '') !== true) failures.push(`${action}: ${field}`);
    if (action === 'consent_steam_exchange') {
      const control = probe.snapshot().priorConsent; assert.ok(control);
      const prior = control.before.routes.find(route => route.id === control.routeId); assert.ok(prior?.agreement);
      assert.equal(prior.agreement.terms.transport?.mode, 'land');
      assert.equal(prior.agreement.nextDeliveryRound, prior.agreement.acceptedRound + prior.agreement.terms.cadenceRounds);
      assert.deepEqual(control.after.routes.find(route => route.id === prior.id), prior);
      assert.equal(control.after.routes.length, control.before.routes.length + 1);
    }
    if (action === 'replay_industrial_history') {
      const replay = probe.snapshot(); assert.ok(replay.before && replay.state);
      assert.ok(Object.keys(replay.before.strategicDeposits?.deposits ?? {}).length > 0);
      assert.deepEqual(replay.state.strategicDeposits, replay.before.strategicDeposits);
    }

  }
  assert.deepEqual(failures, []);
  const detached = probe.snapshot(); if (detached.state) detached.state.cities.length = 0; assert.notDeepEqual(probe.snapshot(), detached);
  probe.reset(); assert.deepEqual(probe.snapshot(), initial);
});
