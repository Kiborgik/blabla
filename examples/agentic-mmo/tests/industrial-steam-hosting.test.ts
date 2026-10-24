import assert from 'node:assert/strict';
import { seedHostedWorld } from './fixtures/current-world.ts';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';
import { industrialSteamJourney, industrialSteamPrefix } from './fixtures/industrial-steam-journey.ts';
import { decodeHistorySnapshot } from '../server/snapshot-codec.ts';
import { createWorker } from '../server/worker.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const actor = 'synthetic-industrial-owner';
const model = 'synthetic-industrial-host-fixture';

class Statement implements D1Statement {
  private readonly database: IndustrialDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: IndustrialDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class IndustrialDatabase implements D1Database {
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
  private readonly directory = mkdtempSync(join(tmpdir(), 'industrial-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new IndustrialDatabase(this.path);
  constructor() { this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8')); }
  get store() { return new WorldRepository(this.database); }
  async state() { const result = await this.store.read(); assert.ok(result); return result.state; }
  async initialize(state: WorldState) { seedHostedWorld(this.database.sql, state); }
  timestamp = coastalPrefixTime(0);
  api(path: string, input?: Record<string, unknown>) { return createWorker(undefined, { now: () => new Date(this.timestamp) }).fetch(new Request(`https://world.test${path}`, input === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': actor }, body: JSON.stringify(input) }), { DB: this.database, AGENT_WRITER_USER_IDS: actor }); }
  mcp(name: string, input: Record<string, unknown>) { return this.api('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } }); }
  async input(commandId: string, action: GameAction) { return { seat: 1, expectedRevision: (await this.state()).revision, model, commandId, action: { type: 'strategy-action', action } }; }
  send(input: Record<string, unknown>, seconds: number) { return this.store.mutate('action', input, actor, coastalPrefixTime(seconds)); }
  async beat() { const state = await this.state(); const seconds = ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60; return this.store.mutate('strategy-catchup', { expectedRevision: state.revision, commandId: `beat-${state.revision}`, timestamp: coastalPrefixTime(seconds), model }, actor, coastalPrefixTime(seconds)); }
  reopen() { this.database.sql.close(); this.database = new IndustrialDatabase(this.path); }
  close() { this.database.sql.close(); rmSync(this.directory, { recursive: true, force: true }); }
}
async function replay(item: Fixture) {
  const saved = await item.store.read(); assert.ok(saved); let state = saved.initial; let after = 0; let count = 0;
  for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
    const page = await item.store.history(after, 25);
    for (const entry of page.entries) {
      const transition = entry.transition;
      const result = transition.kind === 'action' ? applyCommand(state, transition.command) : transition.kind === 'strategy-catchup' ? catchUpStrategy(state, transition.timestamp) : null;
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
  return { seat: input.command.seat, expectedRevision: input.command.expectedRevision, action: { type: 'strategy-action', action: input.command.action }, ...(input.command.plan === undefined ? {} : { plan: input.command.plan }), model, commandId };
}
function sendStep(item: Fixture, step: CoastalPrefixStep, commandId: string) {
  const input = step.input; const timestamp = input.kind === 'strategy' ? input.timestamp : input.command.timestamp; assert.ok(timestamp);
  return item.store.mutate(input.kind === 'strategy' ? 'strategy-catchup' : 'action', stepArguments(step, commandId), actor, timestamp);
}
async function persist(item: Fixture, steps: CoastalPrefixStep[], through = Number.MAX_SAFE_INTEGER, initial = steps[0]?.before): Promise<void> {
  assert.ok(initial); await item.initialize(initial);
  for (const [index, step] of steps.entries()) {
    if (step.result.state.revision > through) break;
    await sendStep(item, step, `industrial-step-${index}`); assert.deepEqual(await item.state(), step.result.state); assert.ok(isWorldState(await item.state()));
  }
}

async function json(response: Response): Promise<Record<string, unknown>> { assert.equal(response.status, 200); const value: unknown = await response.json(); assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value)); return Object.fromEntries(Object.entries(value)); }
async function mcpValue(response: Response): Promise<unknown> { const value = await json(response); assert.ok(typeof value.result === 'object' && value.result !== null); return Reflect.get(value.result, 'structuredContent'); }

await test('fresh industrial initialization survives SQLite restart, refusal and exact operation replay', async () => {
  const journey = industrialSteamPrefix(); const item = new Fixture();
  try {
    await persist(item, journey.steps, journey.prepared.revision, journey.initial); item.reopen();
    const prepared = await item.state(); assert.deepEqual(prepared, journey.prepared);
    assert.deepEqual(await decodeHistorySnapshot(JSON.stringify(prepared)), prepared);
    const records = item.database.records();
    await assert.rejects(item.store.mutate('release-apply', { expectedRevision: prepared.revision, expectedFromReleaseId: prepared.releaseId, targetReleaseId: 'settlement-local-power-1', model, commandId: 'industrial-refused' }, actor, journey.time()), /pre_release_migration_disabled/);
    assert.deepEqual(item.database.records(), records);
    item.timestamp = journey.time();
    const input = { seat: journey.seat, expectedRevision: prepared.revision, model, commandId: 'invalid-rail', action: { type: 'strategy-action', action: { type: 'build-rail', cityId: 'city-1', fromTileId: 1, toTileId: 2, paid: {} } } };
    assert.equal((await item.api('/api/action', input)).status, 400); assert.equal((await item.mcp('play_action', input)).status, 400); assert.deepEqual(item.database.records(), records);
    const observation = await json(await item.api(`/api/observe?seat=${journey.seat}&observationFormat=compact-trade-v1`)); assert.deepEqual(await mcpValue(await item.mcp('observe_world', { seat: journey.seat, observationFormat: 'compact-trade-v1' })), observation);
    await item.beat(); const operated = await item.state(); const proof = operated.industrialEvidence?.foundryOperations[0]; assert.ok(proof);
    item.timestamp = coastalPrefixTime((operated.independentTurns?.strategyTicks ?? 0) * 60 + 20);
    const pause = { seat: proof.civId, expectedRevision: operated.revision, model, commandId: 'pause-proven-foundry', action: { type: 'strategy-action', action: { type: 'set-building-operation', cityId: proof.cityId, buildingId: 'foundry', enabled: false } } };
    const pauseReply = await json(await item.api('/api/action', pause)); const pauseRows = item.database.records();
    const repeatedPause = await mcpValue(await item.mcp('play_action', pause)); assert.ok(typeof repeatedPause === 'object' && repeatedPause !== null); assert.equal(Reflect.get(repeatedPause, 'duplicate'), true); assert.equal(Reflect.get(repeatedPause, 'acceptedRevision'), pauseReply.acceptedRevision); assert.deepEqual(item.database.records(), pauseRows);
    assert.equal((await item.api('/api/action', { ...pause, commandId: 'stale-foundry-pause' })).status, 409); assert.deepEqual(item.database.records(), pauseRows);
    let beats = 1;
    for (let count = 0; count < 24 && (await item.state()).events.some(event => event.id === proof.eventId); count++) { await item.beat(); beats++; }
    const pruned = await item.state(); assert.ok(!pruned.events.some(event => event.id === proof.eventId)); assert.deepEqual(pruned.industrialEvidence?.foundryOperations[0], proof);
    assert.equal(pruned.cities.find(city => city.id === proof.cityId)?.buildingOperations?.foundry?.lastResult?.status, 'paused');
    item.reopen(); assert.deepEqual(await item.state(), pruned); assert.deepEqual(await decodeHistorySnapshot(JSON.stringify(pruned)), pruned);
    assert.equal(await replay(item), journey.steps.length + beats + 1);
    const bad = structuredClone(pruned); delete bad.coalDeposits; assert.equal(isWorldState(bad), false); await assert.rejects(decodeHistorySnapshot(JSON.stringify(bad)), /corrupt_or_incompatible_world/);
    item.database.sql.prepare('UPDATE world_state SET state_json = ?').run(JSON.stringify(bad)); const corruptRows = item.database.records();
    assert.equal((await item.api('/api/world')).status, 503); assert.equal((await item.mcp('observe_world', { seat: journey.seat })).status, 503); assert.deepEqual(item.database.records(), corruptRows);
  } finally { item.close(); }
});

await test('fresh industrial release requests refuse malformed stale and repeated intents with zero SQLite effects', async () => {
  const journey = industrialSteamPrefix(); const item = new Fixture();
  try {
    await persist(item, journey.steps, journey.prepared.revision, journey.initial);
    const state = await item.state(); const rows = item.database.records();
    for (const input of [{}, { expectedRevision: -1 }, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-local-power-1', commandId: 'blocked', model }]) {
      await assert.rejects(item.store.mutate('release-apply', input, actor, journey.time()), /pre_release_migration_disabled/);
      assert.deepEqual(item.database.records(), rows); item.reopen(); assert.deepEqual(await item.state(), state);
    }
  } finally { item.close(); }
});

await test('full legal Coal Rail consent and faster fuel-paid delivery reopen and replay with durable first proofs', async context => {
  const journey = industrialSteamJourney(); const item = new Fixture();
  try {
    await item.initialize(journey.initial);
    const checkpoints = new Set([journey.prepared.revision, journey.researched.revision, journey.coalReady.revision, journey.twoFoundries.revision, journey.proposed.revision, journey.accepted.revision, journey.state.revision]);
    const railStart = journey.steps.find(step => step.input.kind === 'action' && step.input.command.action.type === 'build-rail'); assert.ok(railStart); checkpoints.add(railStart.result.state.revision);
    for (const [index, step] of journey.steps.entries()) {
      await sendStep(item, step, `industrial-story-${index}`); assert.deepEqual(await item.state(), step.result.state);
      if (checkpoints.has(step.result.state.revision)) { item.reopen(); assert.deepEqual(await item.state(), step.result.state); assert.deepEqual(await decodeHistorySnapshot(JSON.stringify(step.result.state)), step.result.state); }
    }
    const initialProof = journey.state.industrialEvidence?.steamDelivery; assert.ok(initialProof);
    assert.ok(initialProof.terms.transport?.mode === 'steam');
    const transport = initialProof.terms.transport;
    assert.equal(transport.baseCadence, 4); assert.equal(transport.unrailedEdges, 9); assert.equal(transport.unrailedCadence, 5);
    const weights = transport.tileIds.slice(1).map((tileId, index) => {
      const from = transport.tileIds[index]; assert.ok(from !== undefined);
      return journey.beforeOffer.railEdges?.[`${Math.min(from, tileId)}:${Math.max(from, tileId)}`] ? 0.25 : 1;
    });
    assert.deepEqual(transport.edgeWeights, weights);
    assert.equal(transport.weightedDistance, weights.reduce((sum, weight) => sum + weight, 0));
    assert.equal(initialProof.terms.cadenceRounds, Math.max(4, Math.ceil(transport.weightedDistance / 2)));
    assert.equal(initialProof.terms.cadenceRounds, 4); assert.ok(initialProof.terms.cadenceRounds < transport.unrailedCadence);
    const beforeRetries = item.database.records();
    for (const [index, step] of journey.steps.entries()) if (step === railStart || step.result.state.revision === journey.accepted.revision) {
      const duplicate = await sendStep(item, step, `industrial-story-${index}`); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, step.result.state.revision); assert.deepEqual(item.database.records(), beforeRetries);
    }
    assert.ok(railStart.input.kind === 'action'); item.timestamp = railStart.input.command.timestamp ?? coastalPrefixTime(0);
    const stale = stepArguments(railStart, 'strict-stale-rail'); assert.equal((await item.api('/api/action', stale)).status, 409); assert.equal((await item.mcp('play_action', stale)).status, 409); assert.deepEqual(item.database.records(), beforeRetries);
    let beats = 0;
    for (; beats < 24; beats++) {
      const state = await item.state(); const last = state.routes.find(connection => connection.id === initialProof.routeId)?.agreement?.lastSteamDelivery;
      if (last && last.eventId !== initialProof.eventId && !state.events.some(event => event.id === initialProof.eventId)) break;
      await item.beat();
    }
    const pruned = await item.state(); const last = pruned.routes.find(connection => connection.id === initialProof.routeId)?.agreement?.lastSteamDelivery;
    assert.ok(last && last.eventId !== initialProof.eventId); assert.ok(!pruned.events.some(event => event.id === initialProof.eventId)); assert.deepEqual(pruned.industrialEvidence?.steamDelivery, initialProof);
    assert.deepEqual(pruned.industrialEvidence?.foundryOperations, journey.state.industrialEvidence?.foundryOperations); assert.equal(pruned.year, journey.prepared.year); assert.equal(pruned.clockTicks, journey.prepared.clockTicks);
    item.reopen(); assert.deepEqual(await item.state(), pruned); assert.deepEqual(await decodeHistorySnapshot(JSON.stringify(pruned)), pruned); assert.equal(await replay(item), journey.steps.length + beats);
    item.timestamp = coastalPrefixTime((pruned.independentTurns?.strategyTicks ?? 0) * 60 + 20);
    const observed = await json(await item.api(`/api/observe?seat=${journey.seat}&observationFormat=compact-trade-v1`)); assert.deepEqual(await mcpValue(await item.mcp('observe_world', { seat: journey.seat, observationFormat: 'compact-trade-v1' })), observed);
    const corrupt = structuredClone(pruned); const proof = corrupt.industrialEvidence?.steamDelivery; assert.ok(proof); proof.acceptedRound++;
    assert.equal(isWorldState(corrupt), false); await assert.rejects(decodeHistorySnapshot(JSON.stringify(corrupt)), /corrupt_or_incompatible_world/);
    item.database.sql.prepare('UPDATE world_state SET state_json = ?').run(JSON.stringify(corrupt)); const rows = item.database.records();
    assert.equal((await item.api('/api/world')).status, 503); assert.equal((await item.mcp('observe_world', { seat: journey.seat })).status, 503); assert.deepEqual(item.database.records(), rows);
    context.diagnostic(JSON.stringify({ legalFrames: journey.steps.length, laterBeats: beats, firstPaidSteamRound: initialProof.round, laterPaidSteamRound: last.round, cadence: initialProof.terms.cadenceRounds, unrailedCadence: transport.unrailedCadence, retainedFoundryTowns: pruned.industrialEvidence?.foundryOperations.map(fact => fact.cityId), clockTicks: pruned.clockTicks }));
  } finally { item.close(); }
});
