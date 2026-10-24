import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyCommand, applyDirectorTick, applyHistoryAdvance, catchUpClock, catchUpStrategy, legalActions } from '../core/engine.ts';
import { TURN_RULES } from '../core/content.ts';
import { DIRECTOR_SEAT, GAME_VERSION, SCHEMA_VERSION } from '../core/types.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type HostedTransition, type SqlValue } from '../server/repository.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const epoch = '2026-10-16T00:00:00.000Z';
const actor = 'synthetic-storage-fixture';
const model = 'synthetic-storage-driver';
const actorCount = DIRECTOR_SEAT + 1;
const registeredRulesId = 'settlement-recovery-1';
const tables = ['world_state', 'world_transitions', 'world_receipts'] as const;
type StoredRequest = { operation: HostedTransition['kind']; input: Record<string, unknown>; timestamp: string; acceptedRevision: number };

function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function jsonBytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
function visit(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? visit(path) : /\.(ts|sql)$/.test(entry.name) ? [path] : [];
  });
}
function sourceIdentity() {
  const files = [...visit(join(root, 'core')), ...visit(join(root, 'server')), fileURLToPath(import.meta.url), join(root, 'tests/hosted-storage.test.ts'), join(root, 'package.json'), join(root, 'package-lock.json')].toSorted().map((path) => {
    const bytes = readFileSync(path);
    return { path: relative(root, path), bytes: bytes.length, sha256: sha256(bytes) };
  });
  return { sha256: sha256(JSON.stringify(files)), files };
}

class LocalDatabase implements D1Database {
  readonly sqlite = new DatabaseSync(':memory:');
  constructor() {
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    this.sqlite.exec(readFileSync(join(root, 'server/migrations/0000_world.sql'), 'utf8'));
  }
  prepare(sql: string): D1Statement {
    let values: SqlValue[] = [];
    const statement: D1Statement = {
      bind: (...next) => { values = next; return statement; },
      all: async () => ({ results: this.sqlite.prepare(sql).all(...values), meta: { changes: 0 } }),
      run: async () => ({ results: [], meta: { changes: Number(this.sqlite.prepare(sql).run(...values).changes) } }),
    };
    return statement;
  }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
    this.sqlite.exec('BEGIN');
    try {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (failure) { this.sqlite.exec('ROLLBACK'); throw failure; }
  }
}

function scalar(database: DatabaseSync, sql: string): number {
  const row = database.prepare(sql).get();
  assert.ok(row);
  const value = Object.values(row)[0];
  assert.equal(typeof value, 'number');
  return Number(value);
}

function columnBytes(database: DatabaseSync) {
  const columns: Record<string, Record<string, number>> = {};
  let utf8BytesBeyondCodepoints = 0;
  for (const table of tables) {
    const totals: Record<string, number> = {};
    for (const field of database.prepare(`PRAGMA table_info(${table})`).all()) {
      if (field.type !== 'TEXT') continue;
      const column = String(field.name);
      assert.match(column, /^[a-z_]+$/);
      const sqlBytes = scalar(database, `SELECT COALESCE(SUM(length(CAST(${column} AS BLOB))), 0) FROM ${table}`);
      const values = database.prepare(`SELECT ${column} AS value FROM ${table}`).all();
      const bufferBytes = values.reduce((total, row) => {
        assert.equal(typeof row.value, 'string');
        return total + Buffer.byteLength(String(row.value), 'utf8');
      }, 0);
      assert.equal(sqlBytes, bufferBytes, `UTF-8 byte counts must agree for ${table}.${column}`);
      utf8BytesBeyondCodepoints += sqlBytes - scalar(database, `SELECT COALESCE(SUM(length(${column})), 0) FROM ${table}`);
      totals[column] = sqlBytes;
    }
    columns[table] = totals;
  }
  return { columns, utf8BytesBeyondCodepoints, totalTextBytes: Object.values(columns).flatMap((fields) => Object.values(fields)).reduce((sum, bytes) => sum + bytes, 0) };
}

async function replay(repository: WorldRepository) {
  const current = await repository.read();
  assert.ok(current);
  let state = current.initial;
  let frames = 0;
  let snapshotMapBytes = 0;
  let snapshotRecentEventBytes = 0;
  let retainedSnapshotBytes = 0;
  let retainedSnapshots = 0;
  let after = 0;
  for (;;) {
    const page = await repository.history(after, 200);
    for (const entry of page.entries) {
      const transition = entry.transition;
      const result = transition.kind === 'action' ? applyCommand(state, transition.command)
          : transition.kind === 'director-tick' ? applyDirectorTick(state, transition.command)
            : transition.kind === 'history-advance' ? applyHistoryAdvance(state, transition.command)
              : transition.kind === 'clock-catchup' ? catchUpClock(state, transition.timestamp) : catchUpStrategy(state, transition.timestamp);
      assert.ok(result.ok, result.error);
      assert.deepEqual(result.state, entry.state);
      assert.deepEqual(result.events, entry.events);
      state = result.state;
      frames += 1;
      snapshotMapBytes += jsonBytes(entry.state.tiles);
      snapshotRecentEventBytes += jsonBytes(entry.state.events);
      if (frames % 50 === 0) {
        retainedSnapshots += 1;
        retainedSnapshotBytes += jsonBytes(entry.state);
      }
    }
    if (!page.hasMore) break;
    assert.ok(page.nextRevision !== null && page.nextRevision > after);
    after = page.nextRevision;
  }
  assert.deepEqual(state, current.state);
  return { frames, finalSha256: sha256(JSON.stringify(state)), snapshotMapBytes, snapshotRecentEventBytes, retainedSnapshots, retainedSnapshotBytes };
}

async function sample(database: LocalDatabase, repository: WorldRepository, transitions: number, noOpReceipts: number, first: StoredRequest, last: StoredRequest) {
  const current = await repository.read();
  assert.ok(current?.state.independentTurns);
  const timestamp = new Date(Date.parse(epoch) + current.state.independentTurns.strategyTicks * TURN_RULES.strategyIntervalMs).toISOString();
  const input = { expectedRevision: current.state.revision, timestamp, model, commandId: `storage-noop-${transitions}` };
  const noOp = await repository.mutate('strategy-catchup', input, actor, last.timestamp);
  assert.equal(noOp.acceptedRevision, current.state.revision);
  assert.equal(noOp.remainingTicks, 0);
  const before = columnBytes(database.sqlite);
  const changesBefore = scalar(database.sqlite, 'SELECT total_changes()');
  const rowCount = () => tables.reduce((total, table) => total + scalar(database.sqlite, `SELECT COUNT(*) FROM ${table}`), 0);
  const rowsBefore = rowCount();
  const retryRequests = [first, last, { operation: 'strategy-catchup' as const, input, timestamp: last.timestamp, acceptedRevision: noOp.acceptedRevision }];
  for (const request of retryRequests) {
    const receipt = await repository.mutate(request.operation, request.input, actor, request.timestamp);
    assert.equal(receipt.duplicate, true);
    assert.equal(receipt.acceptedRevision, request.acceptedRevision);
    assert.equal(receipt.revision, current.state.revision);
  }
  const after = columnBytes(database.sqlite);
  assert.equal(scalar(database.sqlite, 'SELECT total_changes()'), changesBefore);
  assert.deepEqual(before, after);
  const bytes = (table: string, column: string) => after.columns[table]?.[column] ?? 0;
  const initialStateBytes = bytes('world_state', 'initial_json');
  const currentStateBytes = bytes('world_state', 'state_json');
  const snapshotBytes = bytes('world_transitions', 'state_json');
  const commandBytes = bytes('world_transitions', 'transition_json');
  const provenanceBytes = bytes('world_transitions', 'provenance_json');
  const eventBytes = bytes('world_transitions', 'events_json');
  const receiptRequestBytes = bytes('world_receipts', 'request_json');
  const receiptResponseBytes = bytes('world_receipts', 'response_json');
  const totalJsonBytes = initialStateBytes + currentStateBytes + snapshotBytes + commandBytes + provenanceBytes + eventBytes + receiptRequestBytes + receiptResponseBytes;
  const replayed = await replay(repository);
  const localPageSize = scalar(database.sqlite, 'PRAGMA page_size');
  const localPageCount = scalar(database.sqlite, 'PRAGMA page_count');
  assert.equal(scalar(database.sqlite, 'SELECT COUNT(*) FROM world_transitions'), transitions);
  assert.equal(scalar(database.sqlite, 'SELECT COUNT(*) FROM world_receipts'), transitions + 1 + noOpReceipts);
  return {
    transitions, revision: current.state.revision, round: current.state.round, receipts: transitions + 1 + noOpReceipts, noOpReceipts,
    ...after, initialStateBytes, currentStateBytes, snapshotBytes, commandBytes, provenanceBytes, eventBytes, receiptRequestBytes, receiptResponseBytes, totalJsonBytes,
    currentMapBytes: jsonBytes(current.state.tiles), currentRecentEventBytes: jsonBytes(current.state.events), retainedEvents: current.state.events.length,
    snapshotMapBytes: replayed.snapshotMapBytes, snapshotRecentEventBytes: replayed.snapshotRecentEventBytes,
    localPageSize, localPageCount, localAllocationBytes: localPageSize * localPageCount,
    retriesChecked: retryRequests.length, retryAddedRows: rowCount() - rowsBefore, retryAddedTextBytes: after.totalTextBytes - before.totalTextBytes,
    replay: { frames: replayed.frames, finalSha256: replayed.finalSha256 },
    projection: { interval: 50, retainedSnapshots: replayed.retainedSnapshots, retainedSnapshotBytes: replayed.retainedSnapshotBytes, omittedSnapshotBytes: snapshotBytes - replayed.retainedSnapshotBytes, projectedJsonBytes: totalJsonBytes - snapshotBytes + replayed.retainedSnapshotBytes },
  };
}

export async function measureHostedStorage(counts = [10, 100, 1000]) {
  if (!counts.length || counts.length > 10 || counts.some((count, index) => !Number.isSafeInteger(count) || count < 8 || count > 1000 || (index > 0 && count <= (counts[index - 1] ?? Infinity))))
    throw new RangeError('Choose one to ten increasing transition samples from 8 through 1000');
  const source = sourceIdentity();
  const database = new LocalDatabase();
  const repository = new WorldRepository(database);
  const samples: Awaited<ReturnType<typeof sample>>[] = [];
  const operationCounts: Record<string, number> = {};
  let first: StoredRequest | undefined;
  try {
    await repository.initialize({ seed: 1701, clockEpoch: epoch, registeredRulesId, commandId: 'storage-initialize' }, actor, epoch);
    for (let number = 1; number <= (counts.at(-1) ?? 0); number += 1) {
      const current = await repository.read();
      assert.ok(current);
      let operation: HostedTransition['kind'] = 'action';
      let timestamp = epoch;
      let input: Record<string, unknown>;
      {
        const step = number - 1;
        const seat = step % (actorCount + 1);
        const beat = Math.floor(step / (actorCount + 1));
        timestamp = new Date(Date.parse(epoch) + (beat + (seat === actorCount ? 1 : 0)) * TURN_RULES.strategyIntervalMs).toISOString();
        if (seat === actorCount) {
          operation = 'strategy-catchup';
          input = { expectedRevision: current.state.revision, timestamp, model, commandId: `storage-${number}` };
        } else {
          const options = legalActions(current.state, seat, timestamp);
          const chosen = options.find((option) => option.action.type === 'research' && option.action.technology === 'agriculture')
            ?? options.find((option) => option.action.type === 'build' && option.action.project === 'farm')
            ?? options.find((option) => option.action.type === 'focus' && option.action.focus === 'growth')
            ?? options.find((option) => option.action.type === 'wait');
          assert.ok(chosen, 'The synthetic fixture must choose an actually legal action');
          input = { seat, expectedRevision: current.state.revision, action: chosen.action, model, commandId: `storage-${number}` };
        }
      }
      const receipt = await repository.mutate(operation, input, actor, timestamp);
      const request = { operation, input, timestamp, acceptedRevision: receipt.acceptedRevision };
      first ??= request;
      operationCounts[operation] = (operationCounts[operation] ?? 0) + 1;
      assert.equal(receipt.acceptedRevision, number);
      if (counts.includes(number)) samples.push(await sample(database, repository, number, samples.length + 1, first, request));
    }
    assert.equal(sourceIdentity().sha256, source.sha256, 'Measured source must stay unchanged during the run');
    return {
      measuredAt: new Date().toISOString(),
      identity: { gameVersion: GAME_VERSION, worldSchemaVersion: SCHEMA_VERSION, source, environment: { node: process.version, sqlite: String(database.sqlite.prepare('SELECT sqlite_version() AS version').get()?.version), platform: platform(), arch: arch() } },
      workload: { source: 'synthetic-deterministic-driver', seed: 1701, epoch, registeredRulesId, operationCounts, maximumTransitions: 1000, actorCount, strategyIntervalMs: TURN_RULES.strategyIntervalMs, actor, model, description: 'Actual hosted repository serialization in isolated SQLite; fresh registered recovery rules, six scripted legal actor commands then one economy beat; research agriculture, build a farm, choose growth, otherwise hold. One explicit no-op strategy receipt per sample. No live world or model-agent decisions.' },
      samples,
      limits: ['UTF-8 column bytes exclude SQLite record/index overhead; local page allocation is separate.', 'Local SQLite is not managed Sites billing, replication, backup, WAL or quota evidence.', 'Checkpoint figures only omit noncheckpoint snapshot JSON hypothetically; no stored row is removed or rewritten.', 'The finite five-city workload is not a bound on all future worlds or throughput.'],
    };
  } finally { database.sqlite.close(); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.length > 2) throw new Error('Usage: node benchmarks/hosted-storage.ts');
  process.stdout.write(`${JSON.stringify(await measureHostedStorage(), null, 2)}\n`);
}
