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
import { secondGovernmentJourney } from './fixtures/second-government-journey.ts';
import { decodeHistorySnapshot } from '../server/snapshot-codec.ts';
import { createWorker } from '../server/worker.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';

const actor = 'synthetic-second-government-owner';
const model = 'synthetic-second-government-host-fixture';

class Statement implements D1Statement {
  private readonly database: GovernmentDatabase;
  private readonly sql: string;
  private values: SqlValue[] = [];
  constructor(database: GovernmentDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class GovernmentDatabase implements D1Database {
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
  private readonly directory = mkdtempSync(join(tmpdir(), 'government-host-'));
  private readonly path = join(this.directory, 'world.sqlite');
  database = new GovernmentDatabase(this.path);
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
  reopen() { this.database.sql.close(); this.database = new GovernmentDatabase(this.path); }
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
async function json(response: Response): Promise<Record<string, unknown>> { assert.equal(response.status, 200); const value: unknown = await response.json(); assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value)); return Object.fromEntries(Object.entries(value)); }
async function mcpValue(response: Response): Promise<unknown> { const value = await json(response); assert.ok(typeof value.result === 'object' && value.result !== null); return Reflect.get(value.result, 'structuredContent'); }

await test('real second-government progression, pending reforms and paid capital work survive SQLite and exact replay', async context => {
  const journey = secondGovernmentJourney(); const item = new Fixture();
  try {
    await item.initialize(journey.initial);
    const checkpoints = new Set([journey.prepared, ...journey.civicFrames.flatMap(frame => [frame.selected, frame.completed]), journey.accepted, journey.firstTransitionBeat, journey.transitionCompleted, journey.constructionStarted, journey.firstWorkBeat, journey.built, journey.reslotted, journey.returnAccepted, journey.returnFirstBeat, journey.returned].map(state => state.revision));
    const selection = journey.steps.find(step => step.result.state.revision === journey.civicFrames[0]?.selected.revision); assert.ok(selection?.input.kind === 'action');
    const adoption = journey.steps.find(step => step.result.state.revision === journey.accepted.revision); assert.ok(adoption?.input.kind === 'action');
    const construction = journey.steps.find(step => step.result.state.revision === journey.constructionStarted.revision); assert.ok(construction?.input.kind === 'action');
    const reslot = journey.steps.find(step => step.result.state.revision === journey.reslotted.revision); assert.ok(reslot?.input.kind === 'action');
    const returning = journey.steps.find(step => step.result.state.revision === journey.returnAccepted.revision); assert.ok(returning?.input.kind === 'action');
    for (const [index, step] of journey.steps.entries()) {
      await sendStep(item, step, `government-story-${index}`); assert.deepEqual(await item.state(), step.result.state);
      if (checkpoints.has(step.result.state.revision)) { item.reopen(); assert.deepEqual(await item.state(), step.result.state); assert.deepEqual(await decodeHistorySnapshot(JSON.stringify(step.result.state)), step.result.state); }
    }
    const earned = journey.completed.civilizations.find(civilization => civilization.id === journey.seat)?.civics?.reformEntitlement; assert.ok(earned);
    const pending = journey.accepted.civilizations.find(civilization => civilization.id === journey.seat)?.government?.pending; assert.ok(pending);
    assert.equal(pending.completionRound, pending.acceptedRound + 2); assert.equal(pending.paidCredits, 0); assert.equal(pending.spentCompletionEventId, earned.completionEventId);
    const active = journey.transitionCompleted.civilizations.find(civilization => civilization.id === journey.seat)?.government?.active; assert.ok(active);
    assert.equal(active.governmentId, 'autocracy'); assert.equal(active.governmentLockUntilRound, active.effectiveRound + 4); assert.equal(active.policyLockUntilRound, active.effectiveRound + 4);
    const work = journey.firstWorkBeat.cities.find(city => city.id === journey.cityId)?.construction?.active; assert.ok(work);
    const openingCity = journey.constructionStarted.cities.find(city => city.id === journey.cityId); assert.ok(openingCity);
    assert.ok(active.assignments.some(assignment => assignment.policyId === 'urban-planning'));
    const productivity = (0.5 + openingCity.wellbeing / 100) * (1 - openingCity.damage / 100) * (1 + openingCity.infrastructure / 10);
    const expectedWork = Math.round(((openingCity.focus === 'industry' ? 2 : 1) + 1) * productivity * 1.15 * 100) / 100;
    assert.equal(work.workDone, expectedWork);
    const completed = journey.built.cities.find(city => city.id === journey.cityId)?.construction?.lastCompleted; assert.ok(completed); assert.equal(completed.orderId, work.id); assert.equal(Reflect.get(completed, 'governmentId'), undefined);
    const rows = item.database.records();
    for (const step of [selection, adoption, construction, reslot, returning]) {
      const duplicate = await sendStep(item, step, `government-story-${journey.steps.indexOf(step)}`);
      assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, step.result.state.revision); assert.deepEqual(item.database.records(), rows);
    }
    item.timestamp = adoption.input.command.timestamp ?? coastalPrefixTime(0);
    const adoptionInput = stepArguments(adoption, `government-story-${journey.steps.indexOf(adoption)}`);
    const repeated = await mcpValue(await item.mcp('play_action', adoptionInput)); assert.ok(typeof repeated === 'object' && repeated !== null); assert.equal(Reflect.get(repeated, 'duplicate'), true); assert.equal(Reflect.get(repeated, 'acceptedRevision'), journey.accepted.revision); assert.deepEqual(item.database.records(), rows);
    assert.equal((await item.api('/api/action', { ...adoptionInput, commandId: 'stale-government-adoption' })).status, 409);
    assert.equal((await item.mcp('play_action', { ...adoptionInput, commandId: 'stale-government-adoption' })).status, 409); assert.deepEqual(item.database.records(), rows);
    item.timestamp = coastalPrefixTime((journey.returned.independentTurns?.strategyTicks ?? 0) * 60 + 20);
    for (const [field, value] of [['paidCredits', 0], ['capitalConstructionWorkPercent', 999], ['spentCompletionEventId', earned.completionEventId]] as const) {
      const forged: Record<string, unknown> = { ...adoptionInput, commandId: `caller-${field}`, expectedRevision: journey.returned.revision, action: { type: 'strategy-action', action: { ...adoption.input.command.action, [field]: value } } };
      assert.equal((await item.api('/api/action', forged)).status, 400); assert.equal((await item.mcp('play_action', forged)).status, 400); assert.deepEqual(item.database.records(), rows);
    }
    const locked = { ...adoptionInput, commandId: 'locked-return-government', expectedRevision: journey.returned.revision };
    assert.equal((await item.api('/api/action', locked)).status, 400); assert.equal((await item.mcp('play_action', locked)).status, 400); assert.deepEqual(item.database.records(), rows);
    let beats = 0;
    while ((await item.state()).events.some(event => event.id === earned.completionEventId) && beats < 24) { await item.beat(); beats++; }
    const pruned = await item.state(); assert.ok(!pruned.events.some(event => event.id === earned.completionEventId));
    assert.equal(pruned.civilizations.find(civilization => civilization.id === journey.seat)?.government?.lastSpentReformCompletionEventId, earned.completionEventId);
    assert.equal(pruned.year, journey.initial.year); assert.equal(pruned.clockTicks, journey.initial.clockTicks);
    item.reopen(); assert.deepEqual(await item.state(), pruned); assert.deepEqual(await decodeHistorySnapshot(JSON.stringify(pruned)), pruned);
    assert.equal(await replay(item), journey.steps.length + beats);
    item.timestamp = coastalPrefixTime((pruned.independentTurns?.strategyTicks ?? 0) * 60 + 20);
    const observation = await json(await item.api(`/api/observe?seat=${journey.seat}&observationFormat=compact-trade-v1`));
    assert.deepEqual(await mcpValue(await item.mcp('observe_world', { seat: journey.seat, observationFormat: 'compact-trade-v1' })), observation);
    const bad = structuredClone(pruned); const civics = bad.civilizations.find(civilization => civilization.id === journey.seat)?.civics; assert.ok(civics); civics.reformEntitlement = structuredClone(earned);
    assert.equal(isWorldState(bad), false); await assert.rejects(decodeHistorySnapshot(JSON.stringify(bad)), /corrupt_or_incompatible_world/);
    item.database.sql.prepare('UPDATE world_state SET state_json = ?').run(JSON.stringify(bad)); const corruptedRows = item.database.records();
    assert.equal((await item.api('/api/world')).status, 503); assert.equal((await item.mcp('observe_world', { seat: journey.seat })).status, 503); assert.deepEqual(item.database.records(), corruptedRows);
    context.diagnostic(JSON.stringify({ legalFrames: journey.steps.length, transitionRounds: [journey.accepted.round, journey.firstTransitionBeat.round, journey.transitionCompleted.round], capitalWork: work.workDone, constructionCompletedRound: completed.completedRound, spentCompletion: earned.completionEventId, pruningBeats: beats, historyReplayed: journey.steps.length + beats }));
  } finally { item.close(); }
});

