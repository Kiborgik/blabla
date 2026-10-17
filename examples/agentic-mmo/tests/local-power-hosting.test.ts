import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, applyRelease, catchUpStrategy } from '../core/engine.ts';
import type { GameAction } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';
import { localPowerJourney } from './fixtures/local-power-journey.ts';
import { decodeHistorySnapshot } from '../server/snapshot-codec.ts';
import { createWorker } from '../server/worker.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const actor = 'synthetic-local-power-owner';
const model = 'synthetic-local-power-host-fixture';

class Statement implements D1Statement {
  private readonly database: PowerDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: PowerDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class PowerDatabase implements D1Database {
  readonly sql: DatabaseSync;
  beforeBatch: (() => void) | null = null;
  constructor(path: string) { this.sql = new DatabaseSync(path); }
  prepare(sql: string): D1Statement { return new Statement(this, sql); }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
    const hook = this.beforeBatch; this.beforeBatch = null; hook?.(); this.sql.exec('BEGIN');
    try { const result = statements.map(statement => { assert.ok(statement instanceof Statement); return statement.execute(); }); this.sql.exec('COMMIT'); return result; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
  records() { return { state: this.sql.prepare('SELECT * FROM world_state').all(), history: this.sql.prepare('SELECT * FROM world_transitions ORDER BY end_revision').all(), receipts: this.sql.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all() }; }
}
class Fixture {
  private readonly directory = mkdtempSync(join(tmpdir(), 'power-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new PowerDatabase(this.path);
  constructor() { this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8')); }
  get store() { return new WorldRepository(this.database); }
  async state() { const result = await this.store.read(); assert.ok(result); return result.state; }
  async initialize() { await this.store.initialize({ seed: 1701, clockEpoch: coastalPrefixTime(0), commandId: 'initialize' }, actor, coastalPrefixTime(0)); }
  timestamp = coastalPrefixTime(0);
  api(path: string, input?: Record<string, unknown>) { return createWorker(undefined, { now: () => new Date(this.timestamp) }).fetch(new Request(`https://world.test${path}`, input === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': actor }, body: JSON.stringify(input) }), { DB: this.database, AGENT_WRITER_USER_IDS: actor }); }
  mcp(name: string, input: Record<string, unknown>) { return this.api('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } }); }
  async input(commandId: string, action: GameAction) { return { seat: 1, expectedRevision: (await this.state()).revision, model, commandId, action: { type: 'strategy-action', action } }; }
  send(input: Record<string, unknown>, seconds: number) { return this.store.mutate('action', input, actor, coastalPrefixTime(seconds)); }
  async beat() { const state = await this.state(); const seconds = ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60; return this.store.mutate('strategy-catchup', { expectedRevision: state.revision, commandId: `beat-${state.revision}`, timestamp: coastalPrefixTime(seconds), model }, actor, coastalPrefixTime(seconds)); }
  reopen() { this.database.sql.close(); this.database = new PowerDatabase(this.path); }
  close() { this.database.sql.close(); rmSync(this.directory, { recursive: true, force: true }); }
}
async function replay(item: Fixture) {
  const saved = await item.store.read(); assert.ok(saved); let state = saved.initial; let after = 0; let count = 0;
  for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
    const page = await item.store.history(after, 25);
    for (const entry of page.entries) {
      const transition = entry.transition;
      const result = transition.kind === 'action' ? applyCommand(state, transition.command) : transition.kind === 'release-apply' ? applyRelease(state, transition.command) : transition.kind === 'strategy-catchup' ? catchUpStrategy(state, transition.timestamp) : null;
      assert.ok(result?.ok, result?.error); assert.ok(isWorldState(entry.state)); assert.deepEqual(result.state, entry.state); assert.deepEqual(result.events, entry.events); state = result.state; count++;
    }
    if (!page.hasMore) { assert.deepEqual(state, saved.state); return count; }
    assert.ok(page.nextRevision !== null && page.nextRevision > after); after = page.nextRevision;
  }
  return assert.fail('bounded replay did not terminate');
}

function stepArguments(step: CoastalPrefixStep, commandId: string): Record<string, unknown> {
  const input = step.input;
  if (input.kind === 'strategy') return { expectedRevision: step.before.revision, timestamp: input.timestamp, model, commandId };
  if (input.kind === 'release') return { ...input.command, model, commandId };
  return { seat: input.command.seat, expectedRevision: input.command.expectedRevision, action: { type: 'strategy-action', action: input.command.action }, ...(input.command.plan === undefined ? {} : { plan: input.command.plan }), model, commandId };
}
function sendStep(item: Fixture, step: CoastalPrefixStep, commandId: string) {
  const input = step.input; const timestamp = input.kind === 'strategy' ? input.timestamp : input.command.timestamp; assert.ok(timestamp);
  return item.store.mutate(input.kind === 'strategy' ? 'strategy-catchup' : input.kind === 'release' ? 'release-apply' : 'action', stepArguments(step, commandId), actor, timestamp);
}
async function json(response: Response): Promise<Record<string, unknown>> { assert.equal(response.status, 200); const value: unknown = await response.json(); assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value)); return Object.fromEntries(Object.entries(value)); }
async function mcpValue(response: Response): Promise<unknown> { const value = await json(response); assert.ok(typeof value.result === 'object' && value.result !== null); return Reflect.get(value.result, 'structuredContent'); }

await test('real local Power adoption, paid construction and consumer survive SQLite reopening and exact replay', async context => {
  const journey = localPowerJourney(); const item = new Fixture();
  try {
    await item.initialize();
    const checkpoints = new Set([journey.beforeRelease.revision, journey.adopted.revision, journey.plantStarted.revision, journey.plantCompleted.revision, journey.factoryStarted.revision, journey.factoryCompleted.revision, journey.productive.revision, journey.paused.revision, journey.unused.revision]);
    const release = journey.steps.find(step => step.result.state.revision === journey.adopted.revision); assert.ok(release?.input.kind === 'release');
    const plant = journey.steps.find(step => step.result.state.revision === journey.plantStarted.revision); assert.ok(plant?.input.kind === 'action');
    const pause = journey.steps.find(step => step.result.state.revision === journey.paused.revision); assert.ok(pause?.input.kind === 'action');
    let priorRows: unknown;
    for (const [index, step] of journey.steps.entries()) {
      if (step === release) priorRows = item.database.sql.prepare('SELECT * FROM world_transitions ORDER BY end_revision').all();
      await sendStep(item, step, `local-power-story-${index}`); assert.deepEqual(await item.state(), step.result.state);
      if (step === release) assert.deepEqual(item.database.sql.prepare('SELECT * FROM world_transitions WHERE end_revision <= ? ORDER BY end_revision').all(step.before.revision), priorRows);
      if (checkpoints.has(step.result.state.revision)) { item.reopen(); assert.deepEqual(await item.state(), step.result.state); assert.deepEqual(await decodeHistorySnapshot(JSON.stringify(step.result.state)), step.result.state); }
    }
    const town = journey.unused.cities.find(city => city.id === journey.cityId); assert.ok(town?.localPower?.lastProductiveBeat);
    const proof = town.localPower.lastProductiveBeat;
    assert.equal(proof.generated, 8); assert.equal(proof.consumed, 3); assert.equal(proof.expired, 5);
    assert.equal(proof.operations.find(operation => operation.buildingId === 'factory')?.result.produced.materials, 23.4);
    assert.equal(town.localPower.lastBeat?.expired, 8);
    const rows = item.database.records();
    for (const step of [release, plant, pause]) {
      const duplicate = await sendStep(item, step, `local-power-story-${journey.steps.indexOf(step)}`);
      assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, step.result.state.revision); assert.deepEqual(item.database.records(), rows);
    }
    item.timestamp = pause.input.command.timestamp ?? coastalPrefixTime(0);
    const pauseInput = stepArguments(pause, `local-power-story-${journey.steps.indexOf(pause)}`);
    const repeated = await mcpValue(await item.mcp('play_action', pauseInput)); assert.ok(typeof repeated === 'object' && repeated !== null); assert.equal(Reflect.get(repeated, 'duplicate'), true); assert.deepEqual(item.database.records(), rows);
    assert.equal((await item.api('/api/action', { ...pauseInput, commandId: 'stale-power-pause' })).status, 409);
    assert.equal((await item.mcp('play_action', { ...pauseInput, commandId: 'stale-power-pause' })).status, 409); assert.deepEqual(item.database.records(), rows);
    const forged = { ...pauseInput, commandId: 'caller-supplied-power', expectedRevision: journey.unused.revision, action: { type: 'strategy-action', action: { ...pause.input.command.action, localPower: 8 } } };
    assert.equal((await item.api('/api/action', forged)).status, 400); assert.equal((await item.mcp('play_action', forged)).status, 400); assert.deepEqual(item.database.records(), rows);
    let beats = 0;
    while ((await item.state()).events.some(event => event.id === proof.eventId) && beats < 24) { await item.beat(); beats++; }
    const pruned = await item.state(); assert.ok(!pruned.events.some(event => event.id === proof.eventId));
    assert.deepEqual(pruned.cities.find(city => city.id === journey.cityId)?.localPower?.lastProductiveBeat, proof);
    assert.equal(pruned.year, journey.beforeRelease.year); assert.equal(pruned.clockTicks, journey.beforeRelease.clockTicks);
    item.reopen(); assert.deepEqual(await item.state(), pruned); assert.deepEqual(await decodeHistorySnapshot(JSON.stringify(pruned)), pruned);
    assert.equal(await replay(item), journey.steps.length + beats);
    item.timestamp = coastalPrefixTime((pruned.independentTurns?.strategyTicks ?? 0) * 60 + 20);
    const observation = await json(await item.api(`/api/observe?seat=${journey.seat}&observationFormat=compact-trade-v1`));
    assert.deepEqual(await mcpValue(await item.mcp('observe_world', { seat: journey.seat, observationFormat: 'compact-trade-v1' })), observation);
    const bad = structuredClone(pruned); const ledger = bad.cities.find(city => city.id === journey.cityId)?.localPower; assert.ok(ledger?.lastProductiveBeat); ledger.lastProductiveBeat.expired++;
    assert.equal(isWorldState(bad), false); await assert.rejects(decodeHistorySnapshot(JSON.stringify(bad)), /corrupt_or_incompatible_world/);
    item.database.sql.prepare('UPDATE world_state SET state_json = ?').run(JSON.stringify(bad)); const corruptedRows = item.database.records();
    assert.equal((await item.api('/api/world')).status, 503); assert.equal((await item.mcp('observe_world', { seat: journey.seat })).status, 503); assert.deepEqual(item.database.records(), corruptedRows);
    context.diagnostic(JSON.stringify({ legalFrames: journey.steps.length, productiveRound: proof.round, productiveEvent: proof.eventId, generated: proof.generated, consumed: proof.consumed, expired: proof.expired, pruningBeats: beats, historyReplayed: journey.steps.length + beats }));
  } finally { item.close(); }
});
