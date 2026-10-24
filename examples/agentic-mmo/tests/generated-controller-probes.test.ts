import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GeneratedControllerProbes, inspectGeneratedSample, inspectControllerCheckpoint, inspectControllerContinuation, type GeneratedControllerDecision, type GeneratedControllerSample, type GeneratedControllerContinuation } from '../cli/generated-controller-probes.ts';
import { createCampaignAdapter } from '../cli/adapter.ts';
import { GameStore, isRecord } from '../cli/store.ts';
import { chooseCivilizationBehavior, chooseDirectorBehavior, createBehaviorMemory } from '../core/behaviors.ts';
import { applyCommand, legalActions } from '../core/engine.ts';
import { createLocalSimulation, advanceLocalSimulation, parseLocalSimulation, type LocalSimulation } from '../web/local-simulation.ts';

function geographyHolds(s: GeneratedControllerSample): boolean {
  return s.width === 18 && s.height === 24 && s.tile_count === 432
    && s.land_count > 0 && s.passable_count > 0 && s.passable_count <= s.land_count
    && s.connected_count > 0 && s.connected_count <= s.passable_count
    && s.land_fraction >= .55 && s.land_fraction <= .8 && s.connected_fraction >= .7 && s.connected_fraction <= 1
    && s.connected_capitals === 5 && s.capital_count === 5 && s.minimum_spacing >= 6
    && s.viable_capitals === 5 && s.coastal_capitals > 0 && s.coastal_capitals < 5 && s.neighborhood_kinds >= 3;
}

function genesisHolds(s: GeneratedControllerSample): boolean {
  return s.genesis_errors === 0 && s.policy_version === 'weighted-civilizations-v5-funded-landwork'
    && s.release_id === 'settlement-productive-frontiers-1' && s.origin_json === s.expected_origin_json && s.world_digest === s.repeat_world_digest;
}

function decisionHolds(d: GeneratedControllerDecision): boolean {
  return d.seat >= 0 && d.seat <= 5 && d.accepted && d.legal_member && d.revision_after === d.revision_before + 1
    && d.action_digest === d.repeated_action_digest && d.decision_digest === d.repeated_decision_digest
    && d.input_world_before === d.input_world_after && d.input_memory_before === d.input_memory_after
    && d.memory_valid && d.cursor_after === d.cursor_before + 1 && d.policy_version === 'weighted-civilizations-v5-funded-landwork'
    && d.profile_id === d.explanation_profile_id && d.source === 'local-procedural' && d.genesis_before === d.genesis_after;
}

function continuationHolds(c: GeneratedControllerContinuation, revision: number, genesis: string): boolean {
  return c.step >= 3 && c.step <= 4 && c.left_revision > revision && c.left_revision === c.right_revision
    && c.left_world_digest === c.right_world_digest && c.left_memory_digest === c.right_memory_digest
    && c.left_decision_digest === c.right_decision_digest && c.left_envelope_digest === c.right_envelope_digest
    && c.left_genesis === genesis && c.right_genesis === genesis;
}

await test('reset is unexercised, synchronous and factory-free; generation errors surface', () => {
  let calls = 0;
  const probes = new GeneratedControllerProbes({ create: () => { calls += 1; throw new Error('broken current factory'); } });
  probes.reset();
  assert.equal(calls, 0);
  for (const [key, value] of Object.entries(probes.observe())) {
    assert.ok(key.startsWith('gc_'));
    assert.ok(Array.isArray(value) ? value.length === 0 : value === false || value === 0 || value === '');
  }
  assert.throws(() => probes.observeGeneratedWorld(), /broken current factory/);
  assert.throws(() => probes.decide(), /broken current factory/);
  assert.throws(() => probes.restartController(), /broken current factory/);
  assert.equal(calls, 3);
});

await test('raw geography and genesis inspection rejects malformed tiles, starts, severed paths, forests and pre-earned supplies', () => {
  const original = createLocalSimulation(1701);
  const inspect = (mutate: (run: LocalSimulation) => void) => {
    const changed = structuredClone(original);
    mutate(changed);
    return inspectGeneratedSample(1701, changed, changed);
  };
  const positive = inspectGeneratedSample(1701, original, original);
  assert.ok(geographyHolds(positive), JSON.stringify(positive));
  assert.ok(genesisHolds(positive), JSON.stringify(positive));
  assert.equal(positive.land_fraction, positive.land_count / positive.tile_count);
  assert.equal(positive.connected_fraction, positive.connected_count / positive.passable_count);
  const geographyMutations: Array<[string, (run: LocalSimulation) => void]> = [
    ['duplicate starts', run => { run.state.cities[1]!.tileId = run.state.cities[0]!.tileId; }],
    ['ocean start', run => { run.state.tiles[run.state.cities[0]!.tileId]!.terrain = 'ocean'; }],
    ['isolated capital', run => {
      const center = run.state.tiles[run.state.cities[0]!.tileId]!;
      for (const tile of run.state.tiles) if (Math.max(Math.abs(tile.q - center.q), Math.abs(tile.r - center.r), Math.abs(tile.q + tile.r - center.q - center.r)) === 1) { tile.terrain = 'mountain'; tile.elevation = 95; }
    }],
    ['empty forest neighborhoods', run => { for (const tile of run.state.tiles) if (tile.terrain === 'forest') tile.terrain = 'grassland'; }],
  ];
  for (const [name, mutate] of geographyMutations) assert.equal(geographyHolds(inspect(mutate)), false, name);
  const genesisMutations: Array<[string, (run: LocalSimulation) => void]> = [
    ['tile ID', run => { run.state.tiles[0]!.id = 432; }],
    ['tile coordinate', run => { run.state.tiles[0]!.q = 18; }],
    ['tile elevation', run => { run.state.tiles[0]!.elevation = 101; }],
    ['stock', run => { run.state.civilizations[0]!.resources.food += 1; }],
    ['technology', run => { run.state.civilizations[0]!.technologies.push('pottery'); }],
    ['population', run => { run.state.cities[0]!.population += 1; }],
    ['housing', run => { run.state.cities[0]!.housing!.baseCapacity += 1; }],
    ['building', run => { run.state.cities[0]!.buildings.push('granary'); }],
    ['foundation event', run => { run.state.events = []; }],
    ['temperament marker', run => { delete run.state.origin!.temperamentVersion; }],
    ['release marker', run => { delete run.state.origin!.initialReleaseId; }],
    ['policy rollback', run => { run.policyVersion = 'weighted-civilizations-v2'; }],
    ['seed mismatch', run => { run.state.seed = 73; }],
    ['strategy tick', run => { run.state.independentTurns!.strategyTicks = 1; }],
  ];
  for (const [name, mutate] of genesisMutations) {
    const sample = inspect(mutate);
    assert.ok(sample.genesis_errors > 0, name);
    assert.equal(genesisHolds(sample), false, name);
  }
  const repeated = structuredClone(original);
  repeated.state.rng ^= 1;
  assert.equal(genesisHolds(inspectGeneratedSample(1701, original, repeated)), false);
  const constant = [73, 1701, 90210].map(seed => inspectGeneratedSample(seed, original, original));
  assert.equal(new Set(constant.map(sample => sample.terrain_signature)).size, 1);
  assert.equal(new Set(constant.map(sample => sample.start_signature)).size, 1);
  assert.ok(constant.filter(sample => sample.seed !== 1701).every(sample => sample.genesis_errors > 0));
});

await test('six real decisions use detached equivalent inputs, exact current commands and Director dispatch', () => {
  const calls: number[] = [];
  let factories = 0;
  let applications = 0;
  const probes = new GeneratedControllerProbes({
    create: seed => { factories += 1; return createLocalSimulation(seed); },
    chooseCivilization: (world, seat, memory, timestamp) => { calls.push(seat); return chooseCivilizationBehavior(world, seat, memory, timestamp); },
    chooseDirector: (world, memory, timestamp) => { calls.push(5); return chooseDirectorBehavior(world, memory, timestamp); },
    apply: (world, command) => {
      applications += 1;
      assert.equal(command.timestamp, '2000-01-01T00:00:10.000Z');
      assert.equal(command.expectedRevision, world.revision);
      assert.equal(command.observedRevision, world.revision);
      assert.deepEqual(command.plan?.map(item => item.action), [command.action]);
      return applyCommand(world, command);
    },
  });
  probes.decide();
  const decisions = probes.observe().gc_decisions;
  assert.equal(factories, 1);
  assert.equal(applications, 6);
  assert.deepEqual(calls, [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.deepEqual(decisions.map(decision => decision.seat), [0, 1, 2, 3, 4, 5]);
  assert.ok(decisions.every(decisionHolds), JSON.stringify(decisions));
  assert.equal(decisions[5]!.profile_id, 'world-director');
  assert.deepEqual(decisions.map(decision => decision.revision_after), [1, 2, 3, 4, 5, 6]);
  assert.ok(decisions.every(decision => decision.cursor_before === 0 && decision.cursor_after === 1));
});

await test('chooser mutations, all-null decisions, cursor drift and policy drift cannot certify success', () => {
  const mutations = new GeneratedControllerProbes({
    chooseCivilization: (world, seat, memory, timestamp) => {
      const decision = chooseCivilizationBehavior(world, seat, memory, timestamp);
      if (seat === 0) world.rng ^= 1;
      if (seat === 1) memory!.decisionCount += 1;
      if (seat === 2) decision.memory.decisionCount += 1;
      if (seat === 3) Reflect.set(decision.memory, 'policyVersion', 'weighted-civilizations-v1');
      if (seat === 4) decision.explanation.profileId = 'wrong-profile';
      return decision;
    },
  });
  mutations.decide();
  const bad = mutations.observe().gc_decisions;
  assert.ok(bad.slice(0, 5).every(decision => !decisionHolds(decision)));
  assert.notEqual(bad[0]!.input_world_before, bad[0]!.input_world_after);
  assert.notEqual(bad[1]!.input_memory_before, bad[1]!.input_memory_after);
  assert.equal(bad[2]!.cursor_after, 2);
  const refused = new GeneratedControllerProbes({
    chooseCivilization: (state, seat, memory) => ({ action: null, memory: memory ?? createBehaviorMemory(state, seat), explanation: { profileId: memory!.profileId, phase: memory!.phase, reason: 'no choice', required: false } }),
    chooseDirector: (state, memory) => ({ action: null, memory: memory ?? createBehaviorMemory(state, 5), explanation: { profileId: 'world-director', phase: 'director', reason: 'no choice', required: false } }),
    apply: () => { throw new Error('null choices must never be applied'); },
  });
  refused.decide();
  assert.equal(refused.observe().gc_decisions.length, 6);
  assert.ok(refused.observe().gc_decisions.every(decision => !decisionHolds(decision) && !decision.accepted && decision.cursor_after === 0));
});

await test('a faulty menu cannot substitute for engine acceptance, and omitted applications cannot advance revisions', () => {
  const invalid = { type: 'research', technology: 'not-a-technology' } as const;
  const probes = new GeneratedControllerProbes({
    chooseCivilization: (world, seat, memory, timestamp) => {
      const decision = chooseCivilizationBehavior(world, seat, memory, timestamp);
      if (seat === 0) decision.action = invalid;
      return decision;
    },
    legal: (world, seat, timestamp, selected) => seat === 0 ? [{ action: invalid, label: 'faulty menu', reason: 'negative fixture' }] : legalActions(world, seat, timestamp, selected),
    apply: (world, command) => command.seat === 1 ? applyCommand(world, { ...command, expectedRevision: -1 })
      : command.seat === 2 ? { ok: true, state: world, events: [] } : applyCommand(world, command),
  });
  probes.decide();
  const decisions = probes.observe().gc_decisions;
  assert.equal(decisions[0]!.legal_member, true);
  assert.equal(decisions[0]!.accepted, false);
  assert.equal(decisions[0]!.cursor_after, 0);
  assert.equal(decisions[1]!.accepted, false);
  assert.equal(decisions[1]!.cursor_after, 0);
  assert.equal(decisions[2]!.accepted, true);
  assert.equal(decisions[2]!.revision_after, decisions[2]!.revision_before);
  assert.ok(decisions.slice(0, 3).every(decision => !decisionHolds(decision)));
});

await test('restart uses a full progressed checkpoint and exactly four ten-second windows; every full-field corruption remains observable', () => {
  let factories = 0;
  let parses = 0;
  const advances: LocalSimulation[] = [];
  const checkpoints: LocalSimulation[] = [];
  const probes = new GeneratedControllerProbes({
    create: seed => { factories += 1; return createLocalSimulation(seed); },
    parse: value => { parses += 1; checkpoints.push(structuredClone(value) as LocalSimulation); return parseLocalSimulation(value); },
    advance: (run, steps) => {
      assert.equal(steps, 1);
      const next = advanceLocalSimulation(run, steps);
      advances.push(structuredClone(next));
      return next;
    },
  });
  probes.restartController();
  assert.equal(factories, 1);
  assert.equal(parses, 1);
  assert.deepEqual(advances.map(run => run.steps), [1, 2, 3, 3, 4, 4]);
  assert.deepEqual(advances.map(run => run.timestamp), ['2000-01-01T00:00:10.000Z', '2000-01-01T00:00:20.000Z', '2000-01-01T00:00:30.000Z', '2000-01-01T00:00:30.000Z', '2000-01-01T00:00:40.000Z', '2000-01-01T00:00:40.000Z']);
  assert.ok(advances.every(run => run.state.independentTurns?.strategyTicks === 0));
  const observed = probes.observe();
  assert.equal(observed.gc_checkpoint_parse_accepted, true);
  assert.equal(observed.gc_checkpoint_steps, 2);
  assert.equal(observed.gc_restored_steps, 2);
  assert.ok(observed.gc_checkpoint_revision > 0);
  assert.equal(observed.gc_checkpoint_populated_memories, 6);
  assert.equal(observed.gc_checkpoint_world_digest, observed.gc_restored_world_digest);
  assert.equal(observed.gc_checkpoint_memory_digest, observed.gc_restored_memory_digest);
  assert.equal(observed.gc_checkpoint_envelope_digest, observed.gc_restored_envelope_digest);
  assert.equal(observed.gc_checkpoint_before_digest, observed.gc_checkpoint_after_digest);
  assert.deepEqual(observed.gc_continuation.map(step => step.step), [3, 4]);
  assert.ok(observed.gc_continuation.every(step => continuationHolds(step, observed.gc_checkpoint_revision, observed.gc_checkpoint_genesis)));
  const saved = checkpoints[0];
  assert.ok(saved);
  const memoryMutations: Array<[string, (run: LocalSimulation) => void]> = [
    ['drop memories', run => { run.memories = Array.from({ length: 6 }, () => null); }],
    ['reset cursors', run => { for (const memory of run.memories) memory!.decisionCount = 0; }],
    ['nonzero cursor', run => { run.memories[0]!.decisionCount -= 1; }],
    ['required lane', run => { run.memories[0]!.lastRequiredLane = 'changed-lane'; }],
    ['focus lock', run => { run.memories[0]!.focusLocks.push({ cityId: 'city-0', focus: 'growth', untilRound: 5 }); }],
  ];
  for (const [name, mutate] of memoryMutations) {
    const changed = structuredClone(saved);
    mutate(changed);
    const sample = inspectControllerCheckpoint(saved, changed);
    assert.notEqual(sample.gc_checkpoint_memory_digest, sample.gc_restored_memory_digest, name);
  }
  const rerolled = inspectControllerCheckpoint(saved, createLocalSimulation(1701));
  assert.notEqual(rerolled.gc_checkpoint_world_digest, rerolled.gc_restored_world_digest);
  assert.notEqual(rerolled.gc_checkpoint_steps, rerolled.gc_restored_steps);
  const wrongGenesis = structuredClone(saved);
  wrongGenesis.state.origin!.initialReleaseId = 'settlement-food-budget-1';
  assert.equal(parseLocalSimulation(wrongGenesis), null);
  assert.equal(inspectControllerCheckpoint(saved, parseLocalSimulation(wrongGenesis)).gc_checkpoint_parse_accepted, false);
  const suffix = advances[2]!;
  const worldMutations: Array<[string, (run: LocalSimulation) => void]> = [
    ['rng', run => { run.state.rng ^= 1; }],
    ['events', run => { run.state.events[0]!.detail += ' changed'; }],
    ['commitment', run => { run.state.civilizations[0]!.researchProgress += 1; }],
    ['plan', run => { run.state.actionPlans = []; }],
    ['name', run => { run.state.cities[0]!.name += ' renamed'; }],
    ['origin', run => { run.state.origin!.seed += 1; }],
    ['decision', run => { run.decisions[0]!.reason += ' changed'; }],
    ['timestamp', run => { run.timestamp = '2000-01-01T00:00:40.000Z'; }],
    ...memoryMutations,
  ];
  for (const [name, mutate] of worldMutations) {
    const changed = structuredClone(suffix);
    mutate(changed);
    assert.equal(continuationHolds(inspectControllerContinuation(3, suffix, changed), saved.state.revision, observed.gc_checkpoint_genesis), false, name);
  }
});

await test('checkpoint restoration rejects parser-return decision corruption even when later windows reconverge', () => {
  const mutations: Array<[string, (run: LocalSimulation) => void]> = [
    ['changed decision', run => { run.decisions[0]!.reason += ' corrupted during restore'; }],
    ['cleared decisions', run => { run.decisions = []; }],
  ];
  for (const [name, mutate] of mutations) {
    const probes = new GeneratedControllerProbes({
      parse: value => {
        const restored = parseLocalSimulation(value);
        assert.ok(restored);
        assert.equal(restored.decisions.length, 6);
        mutate(restored);
        return restored;
      },
    });
    probes.restartController();
    const observed = probes.observe();
    assert.equal(observed.gc_checkpoint_parse_accepted, true, name);
    assert.equal(observed.gc_checkpoint_world_digest, observed.gc_restored_world_digest, name);
    assert.equal(observed.gc_checkpoint_memory_digest, observed.gc_restored_memory_digest, name);
    assert.equal(observed.gc_checkpoint_steps, observed.gc_restored_steps, name);
    assert.equal(observed.gc_checkpoint_before_digest, observed.gc_checkpoint_after_digest, name);
    assert.equal(observed.gc_continuation.length, 2, name);
    assert.ok(observed.gc_continuation.every(step => continuationHolds(step, observed.gc_checkpoint_revision, observed.gc_checkpoint_genesis)), name);
    assert.notEqual(observed.gc_checkpoint_envelope_digest, observed.gc_restored_envelope_digest, name);
  }
});

await test('parser input mutation and checkpoint mutation are not hidden by matching continuations', () => {
  const probes = new GeneratedControllerProbes({
    parse: value => {
      const restored = parseLocalSimulation(value);
      (value as LocalSimulation).state.rng ^= 1;
      return restored;
    },
  });
  probes.restartController();
  assert.notEqual(probes.observe().gc_checkpoint_before_digest, probes.observe().gc_checkpoint_after_digest);
});

await test('real adapter dispatch/reset exercises all probes without mutating legacy observations, store or generic revision', () => {
  const directory = mkdtempSync(join(tmpdir(), 'generated-controller-bindings-'));
  try {
    const store = new GameStore(join(directory, 'world.json'));
    const adapter = createCampaignAdapter(store);
    adapter.handle({ op: 'reset' });
    const snapshot = store.snapshot();
    const observe = () => { const value = adapter.handle({ op: 'observe' }); assert.ok(isRecord(value)); return value; };
    const legacy = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('gc_')));
    const initial = observe();
    assert.equal(snapshot.state.seed, 17);
    assert.deepEqual(initial.gc_samples, []);
    assert.deepEqual(initial.gc_decisions, []);
    assert.equal(initial.gc_checkpoint_parse_accepted, false);
    for (const action of ['observe_generated_world', 'decide', 'restart_controller']) {
      assert.deepEqual(adapter.handle({ op: 'call', name: action, args: [] }), { ok: true });
      assert.deepEqual(legacy(observe()), legacy(initial));
      assert.deepEqual(store.snapshot(), snapshot);
    }
    const after = observe();
    const samples = after.gc_samples as GeneratedControllerSample[];
    assert.deepEqual(samples.map(sample => sample.seed), [73, 1701, 90210]);
    assert.equal(new Set(samples.map(sample => sample.terrain_signature)).size, 3);
    assert.equal(new Set(samples.map(sample => sample.start_signature)).size, 3);
    assert.ok(samples.every(sample => geographyHolds(sample) && genesisHolds(sample)), JSON.stringify(samples));
    assert.ok((after.gc_decisions as GeneratedControllerDecision[]).every(decisionHolds));
    assert.equal((after.gc_decisions as GeneratedControllerDecision[]).length, 6);
    assert.equal(after.gc_checkpoint_parse_accepted, true);
    assert.equal((after.gc_continuation as GeneratedControllerContinuation[]).length, 2);
    adapter.handle({ op: 'reset' });
    assert.deepEqual(observe(), initial);
    assert.deepEqual(store.snapshot(), snapshot);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
