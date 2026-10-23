import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createWorld } from '../core/engine.ts';
import { BEHAVIOR_POLICY_VERSION, FOOD_BUDGET_BEHAVIOR_POLICY_VERSION, behaviorPolicyVersion, createBehaviorMemory } from '../core/behaviors.ts';
import { LEGACY_BEHAVIOR_POLICY_VERSION } from '../core/behavior-profiles.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { ACTIVE_LOCAL_RELEASE_ID, LOCAL_SIMULATION_STORAGE_KEY, LIVING_SIMULATION_STORAGE_KEY, createLocalSimulation, advanceLocalSimulation, localSimulationSnapshot, parseLocalSimulation, parseActiveLocalSimulation, parsePreviousLocalSimulation } from '../web/local-simulation.ts';
import { createLocalWorldStorage } from '../web/local-world-storage.ts';
import { processLocalSimulationRequest } from '../web/local-simulation-worker.ts';
import { createWorldViewSession, DEFAULT_WORLD_CAMERA, parseWorldSource, saveWorldView, worldSourceHref, worldViewKey, type WorldViewIdentity } from '../web/world-view.ts';
import { DEFAULT_PREFERENCES, parsePreferences } from '../web/viewer-state.ts';

void test('fresh Knowledge genesis retains Food-v3 policy with version-two checkpoint and memory envelopes', () => {
  const fresh = createLocalSimulation(1701);
  assert.equal(ACTIVE_LOCAL_RELEASE_ID, 'settlement-knowledge-compacts-1');
  assert.equal(LOCAL_SIMULATION_STORAGE_KEY, 'civitas:procedural-observatory:knowledge-compacts-v1');
  assert.equal(fresh.version, 2);
  assert.equal(fresh.policyVersion, FOOD_BUDGET_BEHAVIOR_POLICY_VERSION);
  assert.equal(behaviorPolicyVersion(fresh.state), fresh.policyVersion);
  assert.equal(fresh.state.origin?.initialReleaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.equal(fresh.state.origin?.namingVersion, 'cultural-toponyms-v1');
  assert.ok(fresh.state.unlockedFeatures.includes('food-budget'));
  assert.ok(fresh.state.unlockedFeatures.includes('knowledge-compacts'));
  assert.equal(fresh.state.origin?.temperamentVersion, undefined);
  assert.equal(createBehaviorMemory(fresh.state, 0).version, 2);
  assert.equal(createBehaviorMemory(fresh.state, 0).policyVersion, fresh.policyVersion);
  assert.deepEqual(parseActiveLocalSimulation(JSON.parse(JSON.stringify(fresh))), fresh);
});

void test('world checkpoint and every civilization or Director memory must agree on the original policy', () => {
  for (const release of ['settlement-regional-targets-1', ACTIVE_LOCAL_RELEASE_ID] as const) {
    const run = createLocalSimulation(1701, release);
    const expected = release === ACTIVE_LOCAL_RELEASE_ID ? FOOD_BUDGET_BEHAVIOR_POLICY_VERSION : BEHAVIOR_POLICY_VERSION;
    const other = expected === BEHAVIOR_POLICY_VERSION ? FOOD_BUDGET_BEHAVIOR_POLICY_VERSION : BEHAVIOR_POLICY_VERSION;
    run.memories = run.memories.map((_, seat) => createBehaviorMemory(run.state, seat));
    assert.equal(run.policyVersion, expected);
    assert.ok(parseLocalSimulation(run));
    for (let seat = 0; seat < run.memories.length; seat += 1) {
      const mismatched = structuredClone(run);
      mismatched.memories[seat]!.policyVersion = other;
      const bytes = JSON.stringify(mismatched);
      assert.equal(parseLocalSimulation(mismatched), null);
      assert.equal(parseActiveLocalSimulation(mismatched), null);
      assert.equal(processLocalSimulationRequest({ id: seat, run: mismatched, steps: 1 }).ok, false);
      assert.throws(() => advanceLocalSimulation(mismatched), /incompatible|corrupt/);
      assert.equal(JSON.stringify(mismatched), bytes);
    }
    assert.equal(parseLocalSimulation({ ...run, policyVersion: other }), null);
    const bothWrong = structuredClone(run);
    bothWrong.policyVersion = other;
    bothWrong.memories.forEach(memory => { if (memory) memory.policyVersion = other; });
    assert.equal(parseLocalSimulation(bothWrong), null);
  }
});

void test('legacy version-one checkpoint memories retain their exact policy and names and never enter the Worker', () => {
  const state = createWorld(1701, '2000-01-01T00:00:00.000Z');
  state.cities[0]!.name = 'Dawnwe\u0301ll — historical';
  const prior = { ...createLocalSimulation(), version: 1, policyVersion: LEGACY_BEHAVIOR_POLICY_VERSION, state,
    memories: Array.from({ length: 6 }, (_, seat) => ({ ...createBehaviorMemory(state, seat), version: 1, policyVersion: LEGACY_BEHAVIOR_POLICY_VERSION })) };
  const bytes = JSON.stringify(prior);
  assert.equal(JSON.stringify(parsePreviousLocalSimulation(JSON.parse(bytes))), bytes);
  assert.equal(parseLocalSimulation(prior), null);
  assert.equal(parseActiveLocalSimulation(prior), null);
  assert.equal(processLocalSimulationRequest({ id: 1, run: prior, steps: 1 }).ok, false);
  assert.equal(JSON.stringify(prior), bytes);
  prior.memories[5]!.policyVersion = FOOD_BUDGET_BEHAVIOR_POLICY_VERSION;
  assert.equal(parsePreviousLocalSimulation(prior), null);
});

void test('old living storage is read-only while a distinct current world is saved', async () => {
  for (const naming of [undefined, 'cultural-toponyms-v1'] as const) {
    const old = createLocalSimulation(1701, 'settlement-regional-targets-1');
    old.state = createGeneratedWorld(1701, old.timestamp, 'settlement-regional-targets-1', naming);
    old.state.cities[0]!.name = 'Preserved living town';
    old.memories = old.memories.map((_, seat) => createBehaviorMemory(old.state, seat));
    const bytes = ` \n${JSON.stringify(old)}\n`;
    const records = new Map([[LIVING_SIMULATION_STORAGE_KEY, bytes]]);
    const writes: string[] = [];
    let draws = 0;
    let locked = false;
    const storage = createLocalWorldStorage({ read: key => records.get(key) ?? null,
      write: (key, value) => { assert.equal(locked, true); writes.push(key); records.set(key, value); },
      withLock: async (key, operation) => { assert.equal(key, LOCAL_SIMULATION_STORAGE_KEY); locked = true; try { return operation(); } finally { locked = false; } },
      entropy: () => { assert.equal(locked, true); draws += 1; return 1701; } });
    assert.deepEqual(storage.living().run, old);
    assert.match(storage.living().message, /Previous living world.*Read-only/);
    const fresh = await storage.restore();
    assert.ok(fresh.run);
    assert.notEqual(localSimulationSnapshot(fresh.run).identity, localSimulationSnapshot(old).identity);
    assert.equal(draws, 1);
    assert.deepEqual(writes, [LOCAL_SIMULATION_STORAGE_KEY]);
    assert.equal(records.get(LIVING_SIMULATION_STORAGE_KEY), bytes);
    assert.equal(processLocalSimulationRequest({ id: 1, run: old, steps: 1 }).ok, false);
    const protectedSave = await storage.save(() => old);
    assert.equal(protectedSave.blocked, true);
    assert.equal(protectedSave.ephemeral, true);
    assert.deepEqual(writes, [LOCAL_SIMULATION_STORAGE_KEY]);
    assert.equal(records.get(LIVING_SIMULATION_STORAGE_KEY), bytes);
    assert.deepEqual(JSON.parse(records.get(LOCAL_SIMULATION_STORAGE_KEY)!), fresh.run);
  }
});

void test('Knowledge active parser refuses both an old release and an old genesis with a current release', () => {
  const fresh = createLocalSimulation();
  const olderGenesis = structuredClone(fresh);
  olderGenesis.state.origin!.initialReleaseId = 'settlement-regional-targets-1';
  assert.ok(parseLocalSimulation(olderGenesis));
  assert.equal(parseActiveLocalSimulation(olderGenesis), null);
  assert.equal(processLocalSimulationRequest({ id: 1, run: olderGenesis, steps: 1 }).ok, false);
  const historical = createLocalSimulation(1701, 'settlement-regional-targets-1');
  assert.equal(historical.state.origin?.namingVersion, undefined);
  assert.equal(historical.policyVersion, BEHAVIOR_POLICY_VERSION);
  assert.equal(parseActiveLocalSimulation(historical), null);
});

void test('current Knowledge advancement and JSON restart agree with the Worker without changing input or policy', () => {
  const initial = createLocalSimulation(1701);
  const bytes = JSON.stringify(initial);
  const first = advanceLocalSimulation(initial, 2);
  const restored = parseActiveLocalSimulation(JSON.parse(JSON.stringify(first)));
  assert.ok(restored);
  const continuation = advanceLocalSimulation(restored, 2);
  assert.deepEqual(continuation, advanceLocalSimulation(initial, 4));
  const response = processLocalSimulationRequest({ id: 4, run: restored, steps: 2 });
  assert.ok(response.ok);
  assert.deepEqual(response.run, continuation);
  assert.ok(continuation.memories.every(memory => memory?.policyVersion === FOOD_BUDGET_BEHAVIOR_POLICY_VERSION));
  assert.equal(JSON.stringify(initial), bytes);
  assert.equal(continuation.state.origin?.initialReleaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.equal(continuation.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
});

void test('terminal Knowledge checkpoints remain exact under bounded direct and Worker advancement', () => {
  const terminal = createLocalSimulation();
  terminal.state.outcome = { kind: 'cultural', winners: [0], round: terminal.state.round, reason: 'Terminal checkpoint fixture' };
  const bytes = JSON.stringify(terminal);
  assert.ok(parseActiveLocalSimulation(terminal));
  assert.equal(JSON.stringify(advanceLocalSimulation(terminal, 60)), bytes);
  const reply = processLocalSimulationRequest({ id: 9, run: JSON.parse(bytes), steps: 2 });
  assert.ok(reply.ok);
  assert.equal(JSON.stringify(reply.run), bytes);
  assert.equal(JSON.stringify(terminal), bytes);
});

void test('living fallback restores only its exact former local genesis and body while explicit historical views win', () => {
  const old = createLocalSimulation(1701, 'settlement-regional-targets-1');
  const fresh = createLocalSimulation(1701);
  const identity = localSimulationSnapshot(old).identity;
  const view: WorldViewIdentity = { source: 'living', identity, body: 'earth' };
  const camera = { zoom: 2, x: 18, z: -14, selected: 4, selectedCity: 'saved-old-town' };
  const saved = saveWorldView(DEFAULT_PREFERENCES, { ...view, source: 'local' }, camera);
  const restored = createWorldViewSession().observe(parsePreferences(saved), view);
  assert.equal(restored.restored, true);
  for (const key of ['zoom', 'x', 'z', 'selected', 'selectedCity'] as const) assert.equal(restored.preferences[key], camera[key]);
  for (const other of [{ ...view, body: 'mars' }, { ...view, identity: localSimulationSnapshot(fresh).identity }, { ...view, source: 'shared' as const }, { source: 'local' as const, identity: localSimulationSnapshot(fresh).identity, body: 'earth' }]) {
    const observed = createWorldViewSession().observe(saved, other);
    assert.equal(observed.restored, false);
    for (const key of ['zoom', 'x', 'z', 'selected', 'selectedCity'] as const) assert.equal(observed.preferences[key], DEFAULT_WORLD_CAMERA[key]);
    assert.notEqual(worldViewKey(other), worldViewKey(view));
  }
  const independent = saveWorldView(saved, view, { ...camera, x: 33 });
  assert.equal(createWorldViewSession().observe(independent, view).preferences.x, 33);
  assert.equal(createWorldViewSession().observe(independent, { ...view, source: 'local' }).preferences.x, 18);
  assert.equal(parseWorldSource('living'), 'living');
  assert.equal(parsePreferences({ ...DEFAULT_PREFERENCES, worldSource: 'living' }).worldSource, 'living');
  const href = new URL(worldSourceHref('https://example.test/?world=local&body=mars&sample=1', 'living'));
  assert.equal(href.searchParams.get('world'), 'living');
  assert.equal(href.searchParams.get('body'), 'mars');
  assert.equal(href.searchParams.has('sample'), false);
});

void test('browser historical view stays quiet and resets captured cards across source genesis and body changes', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  assert.match(main, /<option value="living">Previous living world · Read-only<\/option>/);
  assert.match(main, /const livingLocal = localWorldStorage\.living\(\)/);
  assert.match(main, /mode === 'living' \? livingSimulation/);
  assert.match(main, /const quiet = worldBody === 'mars' \|\| mode === 'living'/);
  assert.match(main, /worldViewKey\(\{ source: worldSource, identity: snapshot\?\.identity \?\? '', body: worldBody \}\)/);
  const observe = main.slice(main.indexOf('function observeWorldIdentity'), main.indexOf('function renderInspection'));
  assert.match(observe, /if \(!view\.changed\) return;[\s\S]*clearObservedHistory\(\)/);
  const reset = main.slice(main.indexOf('function clearObservedHistory'), main.indexOf('function observeWorldIdentity'));
  assert.match(reset, /eventHistoryCaptured = false/);
  assert.match(reset, /journeyRevision = -1/);
  assert.match(reset, /observedRouteResults = \[\]/);
  const switchBody = main.slice(main.indexOf('function changeWorldSource'), main.indexOf('let reading = false'));
  assert.match(switchBody, /clearObservedHistory\(\)/);
  assert.match(main, /eventCues\.observe\(\{ identity: observedWorldKey\(\)/);
  assert.match(main, /mode !== 'local'[^\n]*localSimulation\.state\.outcome/);
  assert.match(main, /worldSource === 'living' \? 'previous living'/);
});
