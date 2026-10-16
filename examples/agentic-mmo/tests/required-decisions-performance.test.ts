import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { cpus, platform } from 'node:os';
import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { projectCapabilities } from '../core/capabilities.ts';
import { BUILDINGS, RESOURCE_IDS, TECHNOLOGIES } from '../core/content.ts';
import { applyCommand, applyRelease, catchUpStrategy, createWorld, observe } from '../core/engine.ts';
import { observeCompactTrade } from '../core/observation.ts';
import { decisionObligations } from '../core/simulation/decisions.ts';
import type { GameAction, TransitionResult, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const stamp = (seconds: number) => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const root = fileURLToPath(new URL('../', import.meta.url));
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]);
}
const sourceFiles = [...files(join(root, 'core')), fileURLToPath(import.meta.url)].toSorted().map(path => ({ path: relative(root, path), sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));

function fixture(ownedTowns: number): WorldState {
  assert.ok([1, 5, 25].includes(ownedTowns), 'Only finite declared workloads are supported');
  let state = createWorld(1701, epoch);
  for (const targetReleaseId of ['settlement-foundations-2', 'settlement-independent-1', 'settlement-production-1', 'settlement-frontiers-1', 'settlement-specialization-1', 'settlement-recovery-1', 'settlement-civics-1', 'settlement-charters-1', 'settlement-endpoints-1', 'settlement-land-transport-1', 'settlement-operating-exchange-1', 'settlement-decisions-1']) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: epoch });
    assert.equal(result.ok, true, result.error);
    state = result.state;
  }
  const capital = state.cities.find(city => city.civId === 0);
  assert.ok(capital);
  const sites = state.tiles.filter(tile => tile.owner === null && tile.terrain !== 'ocean' && tile.terrain !== 'mountain');
  for (let index = 1; index < ownedTowns; index++) {
    const site = sites[index - 1];
    assert.ok(site);
    site.owner = 0;
    state.cities.push({ ...structuredClone(capital), id: `cost-town-${index}`, name: `Cost town ${index}`, tileId: site.id });
  }
  for (const city of state.cities) {
    city.buildings = [];
    city.wellbeing = 0;
    city.infrastructure = 0;
    city.focus = 'culture';
  }
  for (const civilization of state.civilizations) {
    civilization.technologies = ['agriculture'];
    for (const resource of RESOURCE_IDS) civilization.resources[resource] = 1000;
  }
  assert.ok(isWorldState(state), 'Synthetic setup must be canonical before measured real transitions');
  return state;
}

function timed(run: () => unknown) {
  for (let index = 0; index < 5; index++) run();
  const samples = Array.from({ length: 20 }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }).toSorted((a, b) => a - b);
  return { count: samples.length, minimum: samples[0], median: samples[10], maximum: samples.at(-1) };
}

function measure(ownedTowns: number, timings: boolean) {
  let state = fixture(ownedTowns);
  const initialHash = hash(state);
  let commands = 0;
  let strategyBeats = 0;
  let replayed = 0;
  let seconds = 0;
  let peakActive = 0;
  const samples: Array<{ phase: string; stateBytes: number; compactBytes: number; projectionBytes: number; decisionBytes: number; receiptBytes: number; active: number; completed: number; researchReceipts: number; legalChoices: number; lanes: number; eligibilityUpperBound: number }> = [];
  function commit(run: (world: WorldState) => TransitionResult): void {
    const before = structuredClone(state);
    const restored: unknown = JSON.parse(JSON.stringify(state));
    assert.ok(isWorldState(restored));
    const result = run(state);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(run(restored), result);
    assert.deepEqual(state, before);
    assert.ok(isWorldState(result.state));
    state = result.state;
    replayed++;
    peakActive = Math.max(peakActive, state.cities.filter(city => city.construction?.active).length);
  }
  function catchUp(at: number): void {
    const prior = state.independentTurns?.strategyTicks;
    assert.notEqual(prior, undefined);
    commit(world => catchUpStrategy(world, stamp(at)));
    strategyBeats += (state.independentTurns?.strategyTicks ?? 0) - (prior ?? 0);
  }
  function act(action: GameAction): void {
    catchUp(seconds);
    commit(world => applyCommand(world, { seat: 0, action, expectedRevision: world.revision, timestamp: stamp(seconds) }));
    commands++;
    seconds += 10;
  }
  function snapshot(phase: string): void {
    const before = structuredClone(state);
    const full = observe(state, 0, stamp(seconds));
    const compact = observeCompactTrade(state, 0, stamp(seconds));
    const projection = projectCapabilities(state, 0, 'city-0', stamp(seconds));
    const decisions = decisionObligations(state, 0);
    assert.deepEqual(compact.legalActions.map(option => option.action), full.legalActions.map(option => option.action));
    assert.deepEqual(compact.decisions, decisions);
    assert.deepEqual(projection.decisions, decisions);
    assert.deepEqual(projection.legalActions, []);
    assert.equal(decisions.construction.length, ownedTowns);
    assert.equal(projection.buildings.length, BUILDINGS.length);
    const receipts = state.cities.flatMap(city => city.construction?.lastCompleted ? [city.construction.lastCompleted] : []);
    const research = state.civilizations.flatMap(civilization => civilization.lastResearchCompletion ? [civilization.lastResearchCompletion] : []);
    const active = state.cities.filter(city => city.construction?.active).length;
    assert.ok(active <= ownedTowns && receipts.length <= ownedTowns && research.length <= 5);
    samples.push({ phase, stateBytes: bytes(state), compactBytes: bytes(compact), projectionBytes: bytes(projection), decisionBytes: bytes(decisions), receiptBytes: bytes({ construction: receipts, research }), active, completed: receipts.length, researchReceipts: research.length, legalChoices: compact.legalActions.length, lanes: decisions.construction.length + 1, eligibilityUpperBound: TECHNOLOGIES.length + ownedTowns * BUILDINGS.length });
    assert.deepEqual(state, before);
  }
  function finishOrders(): void {
    for (let index = 0; index < 20; index++) {
      if (!state.cities.some(city => city.construction?.active)) break;
      assert.ok(state.independentTurns);
      seconds = (state.independentTurns.strategyTicks + 1) * 60;
      catchUp(seconds);
    }
    assert.equal(state.cities.some(city => city.construction?.active), false);
    seconds += 10;
  }
  snapshot('idle');
  act({ type: 'research', technology: 'civic-institutions' });
  const targets = state.cities.filter(city => city.civId === 0).map(city => city.id);
  for (const cityId of targets) act({ type: 'build', project: 'farm', cityId });
  snapshot('first-orders');
  finishOrders();
  snapshot('first-completions');
  for (const cityId of targets) act({ type: 'build', project: 'workshop', cityId });
  snapshot('second-orders');
  finishOrders();
  snapshot('second-completions');
  assert.equal(commands, 1 + 2 * ownedTowns);
  assert.equal(state.eventCounts['construction-started'], 2 * ownedTowns);
  assert.equal(state.eventCounts['building-completed'], 2 * ownedTowns);
  assert.equal(state.cities.filter(city => city.construction?.lastCompleted).length, ownedTowns);
  assert.ok(state.cities.filter(city => city.civId === 0).every(city => city.construction?.lastCompleted?.buildingId === 'workshop'));
  assert.ok(state.events.length <= 96);
  const beforeTiming = hash(state);
  assert.ok(state.independentTurns);
  const next = stamp((state.independentTurns.strategyTicks + 1) * 60);
  const costs = timings ? {
    validationMs: timed(() => assert.ok(isWorldState(state))),
    decisionsMs: timed(() => decisionObligations(state, 0)),
    projectionMs: timed(() => projectCapabilities(state, 0, 'city-0', stamp(seconds))),
    compactMs: timed(() => observeCompactTrade(state, 0, stamp(seconds))),
    strategicBeatMs: timed(() => catchUpStrategy(state, next)),
  } : null;
  assert.equal(hash(state), beforeTiming);
  return { deterministic: { ownedTowns, totalCities: state.cities.length, commands, strategyBeats, replayed, peakActive, retainedEvents: state.events.length, initialHash, finalHash: hash(state), samples }, costs };
}

const measuredEnvelopes = new Map([[1, {"stateBytes": 76800, "compactBytes": 33792, "projectionBytes": 8192, "receiptBytes": 1024}], [5, {"stateBytes": 78848, "compactBytes": 105472, "projectionBytes": 14336, "receiptBytes": 2048}], [25, {"stateBytes": 94208, "compactBytes": 457728, "projectionBytes": 41984, "receiptBytes": 6144}]]);

for (const towns of [1, 5, 25]) {
  await test(`finite synthetic ${towns}-town recurring loop retains bounded orders, exact replay and complete projection`, context => {
    const measured = measure(towns, true);
    assert.deepEqual(measure(towns, false).deterministic, measured.deterministic);
    assert.equal(measured.deterministic.peakActive, towns);
    const envelope = measuredEnvelopes.get(towns);
    assert.ok(envelope);
    for (const sample of measured.deterministic.samples) {
      for (const key of ['stateBytes', 'compactBytes', 'projectionBytes', 'receiptBytes'] as const)
        assert.ok(sample[key] <= envelope[key], `${towns}/${sample.phase}/${key} exceeds its measured finite envelope`);
    }
    context.diagnostic(JSON.stringify({ environment: { node: process.version, platform: platform(), cpu: cpus()[0]?.model }, sourceDigest: hash(sourceFiles), sourceFiles, ...measured }));
  });
}
