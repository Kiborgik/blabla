import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  applyCommand,
  applyDirectorTick,
  applyHistoryAdvance,
  catchUpClock,
  createWorld,
  observe,
} from '../core/engine.ts';
import { DIRECTOR_CLOCK_RULES } from '../core/content.ts';
import { chooseAction } from '../core/policies.ts';
import { CURRENT_RELEASE } from '../core/release.ts';
import { GAME_VERSION, SCHEMA_VERSION, type TransitionResult } from '../core/types.ts';

interface Options {
  seeds?: number[];
  actionCounts?: number[];
  historyAdvanceCounts?: number[];
  clockDueTicks?: number;
}

const root = fileURLToPath(new URL('../', import.meta.url));
const epoch = '2026-10-16T00:00:00.000Z';

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function distribution(values: number[]) {
  const ordered = values.toSorted((left, right) => left - right);
  const percentile = (fraction: number) =>
    ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
  return {
    count: ordered.length,
    minimum: ordered[0] ?? 0,
    median: percentile(0.5),
    p95: percentile(0.95),
    maximum: ordered.at(-1) ?? 0,
    mean: ordered.length ? values.reduce((total, value) => total + value, 0) / ordered.length : 0,
  };
}

function visit(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? visit(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

function sourceIdentity() {
  const paths = [
    ...visit(join(root, 'core')),
    join(root, 'package.json'),
    join(root, 'package-lock.json'),
    fileURLToPath(import.meta.url),
  ].toSorted((left, right) => left.localeCompare(right));
  const files = paths.map((path) => {
    const contents = readFileSync(path);
    return { path: relative(root, path), bytes: contents.length, sha256: sha256(contents) };
  });
  return { sha256: sha256(JSON.stringify(files)), files };
}

function accepted(result: TransitionResult) {
  if (!result.ok) throw new Error(result.error ?? 'Benchmark transition was refused');
  return result.state;
}

function workload(seed: number, actions: number) {
  const beforeMemory = process.memoryUsage();
  const started = performance.now();
  let state = createWorld(seed);
  const createWorldMs = performance.now() - started;
  const policy: number[] = [];
  const transition: number[] = [];
  const tacticalTransition: number[] = [];
  const roundResolution: number[] = [];
  const observation: number[] = [];
  const states: number[] = [];
  const observations: number[] = [];
  const events: number[] = [];
  const observationEvents: number[] = [];
  const emittedByType: Record<string, { count: number; utf8Bytes: number }> = {};
  let cumulativeStateBytes = 0;
  let cumulativeEmittedEventBytes = 0;
  for (let index = 0; index < actions; index += 1) {
    const policyStart = performance.now();
    const action = chooseAction(state, state.phase);
    policy.push(performance.now() - policyStart);
    const transitionStart = performance.now();
    const result = applyCommand(state, {
      seat: state.phase,
      expectedRevision: state.revision,
      action,
    });
    state = accepted(result);
    const transitionMs = performance.now() - transitionStart;
    transition.push(transitionMs);
    (state.phase === 0 ? roundResolution : tacticalTransition).push(transitionMs);
    const observationStart = performance.now();
    const observed = observe(state, state.phase);
    const serializedObservation = JSON.stringify(observed);
    observation.push(performance.now() - observationStart);
    observations.push(Buffer.byteLength(serializedObservation, 'utf8'));
    observationEvents.push(observed.recentEvents.length);
    const stateSize = bytes(state);
    states.push(stateSize);
    cumulativeStateBytes += stateSize;
    const emittedBytes = bytes(result.events);
    events.push(emittedBytes);
    cumulativeEmittedEventBytes += emittedBytes;
    for (const event of result.events) {
      const existing = emittedByType[event.type] ?? { count: 0, utf8Bytes: 0 };
      existing.count += 1;
      existing.utf8Bytes += bytes(event);
      emittedByType[event.type] = existing;
    }
  }
  const afterMemory = process.memoryUsage();
  return {
    deterministic: {
      seed,
      actions,
      rounds: state.round,
      revision: state.revision,
      year: state.year,
      releaseId: state.releaseId,
      finalStateSha256: sha256(JSON.stringify(state)),
      civilizations: state.civilizations.length,
      cities: state.cities.length,
      tiles: state.tiles.length,
      buildings: state.cities.reduce((total, city) => total + city.buildings.length, 0),
      routes: state.routes.length,
      retainedRecentEvents: state.events.length,
      retainedRecentEventBytes: bytes(state.events),
      totalRecordedEvents: Object.values(state.eventCounts).reduce(
        (total, count) => total + count,
        0,
      ),
      stateBytes: distribution(states),
      observationBytes: distribution(observations),
      emittedEventBytes: distribution(events),
      observationEventCount: distribution(observationEvents),
      cumulativeStateBytes,
      cumulativeEmittedEventBytes,
      emittedByType,
    },
    timings: {
      createWorldMs,
      policyMs: distribution(policy),
      transitionMs: distribution(transition),
      tacticalTransitionMs: distribution(tacticalTransition),
      roundResolutionMs: distribution(roundResolution),
      observeAndSerializeMs: distribution(observation),
      totalWorkloadMs: performance.now() - started,
    },
    processMemory: {
      heapUsedBefore: beforeMemory.heapUsed,
      heapUsedAfter: afterMemory.heapUsed,
      rssBefore: beforeMemory.rss,
      rssAfter: afterMemory.rss,
    },
  };
}

function clockWorkload(dueTicks: number) {
  let state = createWorld(17, epoch);
  const initialYear = state.year;
  const timestamp = new Date(
    Date.parse(epoch) + dueTicks * DIRECTOR_CLOCK_RULES.intervalMs,
  ).toISOString();
  const batches = [];
  let remainingTicks = dueTicks;
  while (remainingTicks > 0) {
    const priorTicks = state.clockTicks;
    const started = performance.now();
    const result = catchUpClock(state, timestamp);
    state = accepted(result);
    remainingTicks = result.remainingTicks;
    if (state.clockTicks === priorTicks) throw new Error('Clock benchmark did not make progress');
    batches.push({
      processedTicks: state.clockTicks - priorTicks,
      remainingTicks,
      elapsedMs: performance.now() - started,
      resultEventBytes: bytes(result.events),
      stateBytes: bytes(state),
      intervalReceipts: Object.keys(state.directorIntervals).length,
    });
  }
  return {
    dueTicks,
    batches,
    finalTicks: state.clockTicks,
    advancedYears: state.year - initialYear,
    retainedRecentEvents: state.events.length,
    intervalReceiptBytes: bytes(state.directorIntervals),
  };
}

function historyWorkload(counts: number[]) {
  let state = createWorld(17, epoch, 'settlement-foundations-2');
  const samples = [];
  for (const count of counts) {
    const started = performance.now();
    while (Object.keys(state.historyAdvances ?? {}).length < count) {
      const index = Object.keys(state.historyAdvances ?? {}).length;
      const event = applyDirectorTick(state, {
        expectedRevision: state.revision,
        kind: 'event',
        intervalId: `benchmark-${index}`,
        timestamp: epoch,
        event: 'calm',
        target: 0,
      });
      state = accepted(event);
      const cause = event.events[0];
      if (!cause) throw new Error('Benchmark Director event produced no history cause');
      state = accepted(
        applyHistoryAdvance(state, {
          expectedRevision: state.revision,
          cause: { kind: 'event', id: cause.id },
          reason: 'Measured benchmark event-backed history transition',
          deltaYears: 1,
          timestamp: epoch,
        }),
      );
    }
    samples.push({
      receipts: Object.keys(state.historyAdvances ?? {}).length,
      ledgerBytes: bytes(state.historyAdvances ?? {}),
      stateBytes: bytes(state),
      retainedRecentEvents: state.events.length,
      clockTicks: state.clockTicks,
      releaseId: state.releaseId,
      elapsedSincePriorSampleMs: performance.now() - started,
    });
  }
  return samples;
}

export function measureRuntime(options: Options = {}) {
  const seeds = options.seeds ?? [17, 1701, 2026];
  const actionCounts = options.actionCounts ?? [600, 1200];
  const historyAdvanceCounts = options.historyAdvanceCounts ?? [0, 8, 32];
  const clockDueTicks = options.clockDueTicks ?? 480;
  if (
    !seeds.length ||
    !seeds.every(Number.isSafeInteger) ||
    !actionCounts.length ||
    !actionCounts.every((count) => Number.isSafeInteger(count) && count > 0 && count <= 1200) ||
    !historyAdvanceCounts.length ||
    !historyAdvanceCounts.every(
      (count, index) =>
        Number.isSafeInteger(count) &&
        count >= 0 &&
        count <= 128 &&
        (index === 0 || count > (historyAdvanceCounts[index - 1] ?? -1)),
    ) ||
    !Number.isSafeInteger(clockDueTicks) ||
    clockDueTicks < 1 ||
    clockDueTicks > 960
  )
    throw new RangeError('Benchmark workloads must be finite, ordered and bounded');
  const source = sourceIdentity();
  return {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    identity: {
      gameVersion: GAME_VERSION,
      worldSchemaVersion: SCHEMA_VERSION,
      defaultReleaseId: CURRENT_RELEASE.id,
      actionSource: 'builtin-policies',
      source,
      environment: {
        node: process.version,
        v8: process.versions.v8,
        platform: platform(),
        architecture: arch(),
        osRelease: release(),
        cpu: cpus()[0]?.model ?? 'unknown',
        logicalCpus: cpus().length,
      },
    },
    methodology: [
      'Single local Node process; finite seeded workloads; policy actions are scripted, not genuine model play',
      'Per-action timings separate policy choice, pure transition and detached observation plus JSON serialization',
      'Byte counts are UTF-8 JSON without compression; cumulative state bytes model full-snapshot volume, not measured database writes',
      'RSS/heap samples are process-level before/after values, not isolated peak allocation or per-system memory attribution',
      'Timing distributions are observations of this environment, never universal latency guarantees',
    ],
    configuration: { seeds, actionCounts, historyAdvanceCounts, clockDueTicks },
    workloads: seeds.flatMap((seed) => actionCounts.map((actions) => workload(seed, actions))),
    clock: clockWorkload(clockDueTicks),
    history: historyWorkload(historyAdvanceCounts),
    requirements: [
      {
        system: 'simulation',
        measured: 'seeded transition timing, full-state JSON bytes and deterministic counts',
        requirement:
          'Preserve deterministic results and five civilizations; measure again when released mechanics change',
      },
      {
        system: 'agent-observation',
        measured: 'one detached active-seat observation per action including its legal choices',
        requirement:
          'Send compact observations rather than replay archives; at most12 recent events in this current observation API',
      },
      {
        system: 'canonical-events',
        measured: 'emitted bytes, cumulative event counts and retained recent-event bytes in state',
        requirement:
          'Keep current96-event view bound while preserving durable count/receipt evidence; no silent historical deletion',
      },
      {
        system: 'authoritative-clock',
        measured: 'two bounded batches and growing interval receipt bytes',
        requirement:
          'Process at most240 ticks per catchup; expose remaining ticks; interval receipts grow and require an explicit archival design',
      },
      {
        system: 'intentional-history',
        measured: 'actual accepted event-backed ledger entries and serialized growth',
        requirement:
          'Retain all cause-idempotency receipts; no pruning that allows a historical cause to replay',
      },
      {
        system: 'durable-storage',
        measured: 'cumulative full-state serialization volume only',
        requirement:
          'Measure actual D1 write amplification, archive growth and restart cost before setting hosted storage budgets',
      },
      {
        system: 'spectator-renderer',
        measured: 'not measured by this headless harness',
        requirement:
          'Measure actual mobile/WebGL frame time, GPU memory and asset/network bytes separately; animations never block agent turns',
      },
    ],
    unmeasured: [
      'hosted D1 latency, CPU quotas and durable archive growth',
      'authenticated transport/network latency and concurrent service throughput',
      'mobile WebGL/GPU memory, frame time and asset transfer budgets',
      'future trade, institution, military, space and victory mechanics',
    ],
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out'))
    throw new Error('Usage: node benchmarks/runtime.ts [--out path]');
  const output = args[1]
    ? resolve(args[1])
    : join(dirname(fileURLToPath(import.meta.url)), 'runtime-baseline.json');
  const report = measureRuntime();
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ output, sourceSha256: report.identity.source.sha256, workloads: report.workloads.length, actions: report.workloads.reduce((total, run) => total + run.deterministic.actions, 0) })}\n`,
  );
}
