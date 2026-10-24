import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyCommand, catchUpStrategy, createWorld, observe } from '../core/engine.ts';
import { CIV_COUNT, DIRECTOR_SEAT, GAME_VERSION, SCHEMA_VERSION, type Command, type TransitionResult, type WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';

interface Options { beats?: number; cityCounts?: number[] }
const epoch = '2026-10-16T00:00:00.000Z';
const root = fileURLToPath(new URL('../', import.meta.url));

function bytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function distribution(values: number[]) {
  const ordered = values.toSorted((left, right) => left - right);
  const percentile = (fraction: number) => ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
  return { count: values.length, minimum: ordered[0] ?? 0, median: percentile(0.5), p95: percentile(0.95), maximum: ordered.at(-1) ?? 0 };
}
function visit(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? visit(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}
function sourceIdentity() {
  const files = [...visit(join(root, 'core')), fileURLToPath(import.meta.url), join(root, 'package.json'), join(root, 'package-lock.json')].toSorted().map((path) => {
    const content = readFileSync(path);
    return { path: relative(root, path), bytes: content.length, sha256: sha256(content) };
  });
  return { sha256: sha256(JSON.stringify(files)), files };
}
function accepted(result: TransitionResult): WorldState {
  assert.equal(result.ok, true, result.error);
  assert.ok(isWorldState(result.state), 'Each measured committed state must be canonical');
  return result.state;
}
function fixture(cityCount: number): WorldState {
  const state = createWorld(17, epoch, 'settlement-production-1');
  const capitals = structuredClone(state.cities);
  const occupied = new Set(state.cities.map((city) => city.tileId));
  const sites = state.tiles.filter((tile) => !occupied.has(tile.id) && tile.owner === null && tile.terrain !== 'ocean' && tile.terrain !== 'mountain');
  for (let index = CIV_COUNT; index < cityCount; index += 1) {
    const capital = capitals[index % CIV_COUNT];
    const site = sites[index - CIV_COUNT];
    assert.ok(capital && site, 'The finite fixture requires an available land tile');
    site.owner = capital.civId;
    state.cities.push({ ...structuredClone(capital), id: `production-city-${index}`, name: `Production ${index}`, tileId: site.id });
  }
  for (const civilization of state.civilizations) {
    civilization.technologies = ['agriculture', 'water-management', 'kiln-firing'];
    civilization.researchTarget = '';
    civilization.researchProgress = 0;
    civilization.resources.energy = 2 * cityCount / CIV_COUNT;
    civilization.resources.materials = cityCount / CIV_COUNT;
  }
  for (const city of state.cities) {
    city.focus = 'research';
    city.buildings = ['farm', 'irrigation', 'kiln'];
    city.buildingOperations = { irrigation: { enabled: true, lastResult: null }, kiln: { enabled: true, lastResult: null } };
  }
  assert.ok(isWorldState(state), 'Synthetic fixtures must satisfy the actual canonical validator');
  return state;
}
function workload(cities: number, beats: number) {
  const started = performance.now();
  let state = fixture(cities);
  const initialSha256 = sha256(JSON.stringify(state));
  let replay: unknown = JSON.parse(JSON.stringify(state));
  assert.ok(isWorldState(replay));
  const transitions: number[] = [];
  const observationsTiming: number[] = [];
  const states: number[] = [];
  const observationsSize: number[] = [];
  const results: number[] = [];
  let actionCommands = 0;
  let strategyCommands = 0;
  let observations = 0;
  let recipeReceipts = 0;
  let operationEvents = 0;
  let operated = 0;
  let blocked = 0;
  let paused = 0;
  let firstOperatedBeat = 0;
  let firstBlockedBeat = 0;
  let maximumObservationRecentEvents = 0;
  let maximumObservedRecipeDefinitions = 0;
  const beatsReport: Array<{ beat: number; operated: number; blocked: number; paused: number; energy: number[] }> = [];
  function commit(transition: (current: WorldState) => TransitionResult, timestamp: string) {
    const original = JSON.stringify(state);
    const transitionStarted = performance.now();
    const result = transition(state);
    transitions.push(performance.now() - transitionStarted);
    assert.equal(JSON.stringify(state), original, 'Real transitions must not mutate their input');
    assert.ok(isWorldState(replay));
    const replayed = transition(replay);
    assert.deepEqual(replayed, result, 'JSON-restored execution must reproduce the exact transition');
    state = accepted(result);
    replay = JSON.parse(JSON.stringify(replayed.state));
    const committed = JSON.stringify(state);
    states.push(bytes(state));
    results.push(bytes(result));
    operationEvents += result.events.filter((event) => event.type === 'building-operation').length;
    for (let seat = 0; seat <= DIRECTOR_SEAT; seat += 1) {
      const observationStarted = performance.now();
      const observed = observe(state, seat, timestamp);
      observationsSize.push(bytes(observed));
      observationsTiming.push(performance.now() - observationStarted);
      observations += 1;
      maximumObservationRecentEvents = Math.max(maximumObservationRecentEvents, observed.recentEvents.length);
      maximumObservedRecipeDefinitions = Math.max(maximumObservedRecipeDefinitions, observed.buildingRecipes?.length ?? 0);
      const city = observed.cities[0];
      if (city) city.name = 'Detached benchmark mutation';
      assert.equal(JSON.stringify(state), committed, 'Every seat observation must be detached');
    }
  }
  for (let index = 0; index < beats; index += 1) {
    if (index === 1 || index === 3) {
      const timestamp = new Date(Date.parse(epoch) + index * 60_000 + 10_000).toISOString();
      for (let seat = 0; seat < CIV_COUNT; seat += 1) {
        const city = state.cities.find((candidate) => candidate.civId === seat);
        assert.ok(city);
        const command: Command = { seat, expectedRevision: state.revision, timestamp, action: { type: 'set-building-operation', cityId: city.id, buildingId: 'kiln', enabled: index === 3 } };
        commit((current) => applyCommand(current, command), timestamp);
        actionCommands += 1;
      }
    }
    const timestamp = new Date(Date.parse(epoch) + (index + 1) * 60_000).toISOString();
    commit((current) => catchUpStrategy(current, timestamp), timestamp);
    strategyCommands += 1;
    const duplicate = catchUpStrategy(state, timestamp);
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.state, state, 'Repeated catchup cannot spend resources again');
    assert.deepEqual(duplicate.events, []);
    const counts = { beat: index + 1, operated: 0, blocked: 0, paused: 0, energy: state.civilizations.map((civilization) => civilization.resources.energy) };
    for (const city of state.cities) {
      assert.equal(Object.keys(city.buildingOperations ?? {}).length, 2);
      for (const operation of Object.values(city.buildingOperations ?? {})) {
        const result = operation.lastResult;
        assert.ok(result);
        assert.equal(result.round, state.round);
        assert.ok(result.status !== 'civic-works', 'The selected settlement-production-1 fixture has no civic-works feature');
        recipeReceipts += 1;
        counts[result.status] += 1;
        if (result.status !== 'operated') {
          assert.deepEqual(result.paid, {});
          assert.deepEqual(result.produced, {});
        }
      }
    }
    operated += counts.operated;
    blocked += counts.blocked;
    paused += counts.paused;
    if (!firstOperatedBeat && counts.operated) firstOperatedBeat = counts.beat;
    if (!firstBlockedBeat && counts.blocked) firstBlockedBeat = counts.beat;
    beatsReport.push(counts);
  }
  const stateBytes = distribution(states);
  const observationBytes = distribution(observationsSize);
  const resultBytes = distribution(results);
  return {
    deterministic: { seed: 17, cities, civilizations: state.civilizations.length, beats, actionCommands, strategyCommands, replayedTransitions: transitions.length, immutableInputsChecked: transitions.length, duplicateCatchupsChecked: beats, observations, recipeReceipts, operationEvents, operationRecords: state.cities.reduce((total, city) => total + Object.keys(city.buildingOperations ?? {}).length, 0), operated, blocked, paused, firstOperatedBeat, firstBlockedBeat, beatsReport, retainedRecentEvents: state.events.length, maximumObservationRecentEvents, maximumObservedRecipeDefinitions, initialSha256, finalSha256: sha256(JSON.stringify(state)), stateBytes, observationBytes, resultBytes },
    timings: { transitionMs: distribution(transitions), observeAndSerializeMs: distribution(observationsTiming), totalWorkloadMs: performance.now() - started },
    payloadEnvelope: { stateBytes: Math.ceil(stateBytes.maximum * 1.25 / 1024) * 1024, observationBytes: Math.ceil(observationBytes.maximum * 1.25 / 1024) * 1024, resultBytes: Math.ceil(resultBytes.maximum * 1.25 / 1024) * 1024 },
  };
}

export function measureProduction(options: Options = {}) {
  const beats = options.beats ?? 10;
  const cityCounts = options.cityCounts ?? [5, 25];
  if (!Number.isSafeInteger(beats) || beats < 4 || beats > 30 || !cityCounts.length || cityCounts.length > 2 || new Set(cityCounts).size !== cityCounts.length || !cityCounts.every((count) => count === 5 || count === 25))
    throw new RangeError('Production workloads must use finite bounded 5 or 25 city fixtures and 4 through 30 beats');
  return {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    identity: { gameVersion: GAME_VERSION, worldSchemaVersion: SCHEMA_VERSION, releaseId: 'settlement-production-1', actionSource: 'contract-probes', source: sourceIdentity(), environment: { node: process.version, v8: process.versions.v8, platform: platform(), architecture: arch(), cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length } },
    methodology: [
      'Finite synthetic canonical fixtures, not a live world or genuine model play; five current-scale cities and twenty-five cities stress five settlements sharing each civilization stockpile',
      'Fixtures start fresh under explicitly selected registered rules with synthetic initial prerequisites; larger settlement reachability through legal expansion actions is not claimed',
      'Each city has farm, irrigation and kiln; opening energy funds one initial kiln beat then passive recovery competes with depletion; first-city kilns pause for beats two and three and resume at four',
      'Measured action and catchup transitions exclude replay/validation from individual timings; total workload includes fixture construction, replay, validation and detached observation checks',
      'Receipt/event/command counts measure externally realized work, not instrumented internal CPU instructions or a complexity proof',
      'UTF-8 uncompressed JSON state, all-six-seat observation and complete transition result sizes; fixture envelopes round measured maximum plus 25 percent upward to 1024 bytes',
      'Elapsed times describe this local process only; no universal millisecond threshold, host quota, archive-growth or database-write claim',
    ],
    configuration: { beats, cityCounts },
    workloads: cityCounts.map((cities) => workload(cities, beats)),
    unmeasured: ['hosted CPU quotas, D1 costs and network latency', 'concurrent service throughput and durable replay archive growth', 'browser rendering, GPU memory and future production catalogue sizes'],
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node benchmarks/production.ts [--out path]');
  const output = args[1] ? resolve(args[1]) : fileURLToPath(new URL('./production-baseline.json', import.meta.url));
  const report = measureProduction();
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, sourceSha256: report.identity.source.sha256, workloads: report.workloads.map(({ deterministic, timings }) => ({ cities: deterministic.cities, receipts: deterministic.recipeReceipts, statuses: { operated: deterministic.operated, blocked: deterministic.blocked, paused: deterministic.paused }, stateBytes: deterministic.stateBytes.maximum, observationBytes: deterministic.observationBytes.maximum, resultBytes: deterministic.resultBytes.maximum, elapsedMs: timings.totalWorkloadMs })) })}\n`);
}
