import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { RELEASES } from '../core/release.ts';
import { isWorldState } from '../core/validation.ts';
import { ACTIVE_LOCAL_POLICY_VERSION, ACTIVE_LOCAL_RELEASE_ID, LOCAL_SIMULATION_STORAGE_KEY, advanceLocalSimulation, createLocalSimulation, parseLocalSimulation } from '../web/local-simulation.ts';
import { processLocalSimulationRequest } from '../web/local-simulation-worker.ts';

const epoch = '2000-01-01T00:00:00.000Z';
const rules = 'settlement-productive-frontiers-1';

void test('frontier rules create fresh cumulative content without inventing a satellite or a plan', () => {
  const parent = RELEASES.find(release => release.id === 'settlement-charcoal-clearing-1');
  const release = RELEASES.find(candidate => candidate.id === rules);
  assert.ok(parent && release);
  assert.deepEqual(release.featureIds, [...parent.featureIds, 'productive-frontier-founding']);
  const world = createGeneratedWorld(73, epoch, rules, 'cultural-toponyms-v1', 'strategic-temperaments-v1');
  assert.ok(isWorldState(world));
  assert.equal(world.releaseId, rules);
  assert.equal(world.origin?.initialReleaseId, rules);
  assert.equal(world.round, 0);
  assert.equal(world.revision, 0);
  assert.equal(world.cities.length, 5);
  assert.equal(world.cities.reduce((sum, city) => sum + city.population, 0), 30);
  assert.ok(world.cities.every(city => city.buildings.length === 0 && !city.construction?.active && !city.construction?.lastCompleted));
  assert.deepEqual(world.events.map(event => event.type), ['world-founded']);
  assert.ok(!Object.hasOwn(world, 'frontierPlans'));
});

void test('current local genesis retains frontier content and exact same-version continuation', () => {
  const initial = createLocalSimulation(73);
  assert.equal(initial.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.ok(initial.state.unlockedFeatures.includes('productive-frontier-founding'));
  assert.ok(initial.state.unlockedFeatures.includes('charcoal-clearing'));
  assert.equal(initial.policyVersion, ACTIVE_LOCAL_POLICY_VERSION);
  assert.equal(initial.policyVersion, 'weighted-civilizations-v5-funded-landwork');
  assert.ok(LOCAL_SIMULATION_STORAGE_KEY.startsWith('civitas:procedural-observatory:'));
  const before = JSON.stringify(initial);
  const prefix = advanceLocalSimulation(initial, 2);
  const restored = parseLocalSimulation(JSON.parse(JSON.stringify(prefix)));
  assert.ok(restored);
  const next = advanceLocalSimulation(restored, 2);
  assert.deepEqual(next, advanceLocalSimulation(initial, 4));
  const reply = processLocalSimulationRequest({ id: 58, run: restored, steps: 2 });
  assert.ok(reply.ok);
  assert.deepEqual(reply.run, next);
  assert.equal(JSON.stringify(initial), before);
});

void test('frontier genesis and current parser reject incomplete rules without mutating the record', () => {
  const world = createGeneratedWorld(73, epoch, rules, 'cultural-toponyms-v1', 'strategic-temperaments-v1');
  for (const feature of ['productive-frontier-founding', 'charcoal-clearing', 'funded-landwork-planning', 'food-budget']) {
    const invalid = structuredClone(world);
    invalid.unlockedFeatures = invalid.unlockedFeatures.filter(value => value !== feature);
    const before = JSON.stringify(invalid);
    assert.equal(isWorldState(invalid), false, feature);
    assert.equal(JSON.stringify(invalid), before);
  }
  const run = createLocalSimulation(73);
  run.state.unlockedFeatures = run.state.unlockedFeatures.filter(feature => feature !== 'productive-frontier-founding');
  const before = JSON.stringify(run);
  assert.equal(parseLocalSimulation(run), null);
  assert.equal(processLocalSimulationRequest({ id: 59, run, steps: 1 }).ok, false);
  assert.equal(JSON.stringify(run), before);
});
