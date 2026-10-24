import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalSimulation, advanceLocalSimulation, parseLocalSimulation } from '../web/local-simulation.ts';
import { createRegisteredSimulation, advanceRegisteredSimulation, parseRegisteredSimulation } from './fixtures/registered-simulation.ts';

void test('component harness constructs selected fresh rules without browser checkpoint adoption', () => {
  const component = createRegisteredSimulation(73, 'settlement-living-partnerships-1');
  assert.equal(component.state.revision, 0);
  assert.equal(component.state.releaseId, 'settlement-living-partnerships-1');
  assert.equal(component.state.origin?.initialReleaseId, component.state.releaseId);
  assert.equal(component.state.origin?.namingVersion, undefined);
  assert.equal(component.state.origin?.temperamentVersion, undefined);
  assert.equal(parseLocalSimulation(component), null);
  assert.deepEqual(parseRegisteredSimulation(component), component);
});

void test('component driver matches actual current commands and deterministic same-version restart', () => {
  for (const seed of [41, 73]) {
    const current = createLocalSimulation(seed);
    const before = structuredClone(current);
    const expected = advanceLocalSimulation(current, 3);
    const actual = advanceRegisteredSimulation(current, 3);
    assert.deepEqual(actual, expected);
    assert.deepEqual(current, before);
    const restarted = parseRegisteredSimulation(JSON.parse(JSON.stringify(actual)));
    assert.ok(restarted);
    assert.deepEqual(advanceRegisteredSimulation(restarted, 2), advanceLocalSimulation(expected, 2));
  }
});

void test('component parser and advancement refuse malformed current facts without mutation', () => {
  const current = createLocalSimulation(73);
  for (const mutate of [
    (run: typeof current) => { run.policyVersion = 'not-a-policy'; },
    (run: typeof current) => { run.steps = -1; },
    (run: typeof current) => { run.state.cities[0]!.population = -1; },
  ]) {
    const bad = structuredClone(current); mutate(bad); const before = structuredClone(bad);
    assert.equal(parseRegisteredSimulation(bad), null);
    assert.throws(() => advanceRegisteredSimulation(bad));
    assert.deepEqual(bad, before);
  }
});
