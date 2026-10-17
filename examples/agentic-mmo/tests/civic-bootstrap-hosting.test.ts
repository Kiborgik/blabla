import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { GOVERNMENTS } from '../core/content.ts';
import { applyCommand, applyRelease, catchUpStrategy } from '../core/engine.ts';
import { RELEASES } from '../core/release.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';
import { decodeHistorySnapshot } from '../server/snapshot-codec.ts';
import { createWorker } from '../server/worker.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const actor = 'synthetic-civic-persistence-owner';
const model = 'synthetic-civic-persistence-fixture';
const time = (seconds: number) => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
class Statement implements D1Statement {
  private readonly sql: DatabaseSync; private readonly query: string; private values: SqlValue[] = [];
  constructor(sql: DatabaseSync, query: string) { this.sql = sql; this.query = query; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.sql.prepare(this.query).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.sql.prepare(this.query).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class Database implements D1Database {
  readonly sql: DatabaseSync;
  constructor(path: string) { this.sql = new DatabaseSync(path); }
  prepare(query: string): D1Statement { return new Statement(this.sql, query); }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
    this.sql.exec('BEGIN');
    try { const result = statements.map(statement => { assert.ok(statement instanceof Statement); return statement.execute(); }); this.sql.exec('COMMIT'); return result; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
  records() { return ['world_state', 'world_transitions', 'world_receipts'].map(table => this.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()); }
}
class Fixture {
  private readonly directory = mkdtempSync(join(tmpdir(), 'civic-host-')); private readonly path = join(this.directory, 'world.sqlite');
  database = new Database(this.path); seconds = 0;
  constructor() { this.database.sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8')); }
  get store() { return new WorldRepository(this.database); }
  get env() { return { DB: this.database, AGENT_WRITER_USER_IDS: actor }; }
  get worker() { return createWorker(undefined, { now: () => new Date(time(this.seconds)) }); }
  async state(): Promise<WorldState> { const saved = await this.store.read(); assert.ok(saved); return saved.state; }
  async initialize(target = 'settlement-civic-bootstrap-1') {
    await this.store.initialize({ seed: 1701, clockEpoch: epoch, commandId: 'initialize' }, actor, epoch);
    for (const release of RELEASES) {
      const state = await this.state(); if (!release.compatibleFrom.includes(state.releaseId)) continue;
      await this.store.mutate('release-apply', { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, commandId: `release-${release.id}`, model }, actor, epoch);
      if (release.id === target) break;
    }
    assert.equal((await this.state()).releaseId, target);
  }
  async input(commandId: string, action: GameAction) {
    const state = await this.state(); this.seconds = Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ((state.independentTurns?.lastActionWindow[4] ?? -1) + 1) * 10);
    return { seat: 4, expectedRevision: state.revision, model, commandId, action: { type: 'strategy-action', action } };
  }
  async beat() {
    const state = await this.state(); this.seconds = ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60;
    return this.store.mutate('strategy-catchup', { expectedRevision: state.revision, commandId: `beat-${state.revision}`, timestamp: time(this.seconds), model }, actor, time(this.seconds));
  }
  async complete() {
    for (let index = 0; index < 20 && (await this.state()).civilizations[4]!.civics!.active; index++) await this.beat();
    assert.deepEqual((await this.state()).civilizations[4]!.civics!.completedCivicIds, ['code-of-laws']);
  }
  api(path: string, input?: Record<string, unknown>) {
    return this.worker.fetch(new Request(`https://world.test${path}`, input === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': actor }, body: JSON.stringify(input) }), this.env);
  }
  mcp(name: string, input: Record<string, unknown>) { return this.api('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } }); }
  reopen() { this.database.sql.close(); this.database = new Database(this.path); }
  close() { this.database.sql.close(); rmSync(this.directory, { recursive: true, force: true }); }
}
async function json(response: Response): Promise<Record<string, unknown>> { assert.equal(response.status, 200); const value: unknown = await response.json(); assert.ok(typeof value === 'object' && value !== null); return value as Record<string, unknown>; }
async function mcpValue(response: Response): Promise<Record<string, unknown>> { const value = await json(response); return (value.result as { structuredContent: Record<string, unknown> }).structuredContent; }
async function replay(item: Fixture) {
  const saved = await item.store.read(); assert.ok(saved); let state = saved.initial; let after = 0;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = await item.store.history(after, 25);
    for (const entry of page.entries) {
      const transition = entry.transition;
      const result = transition.kind === 'action' ? applyCommand(state, transition.command) : transition.kind === 'release-apply' ? applyRelease(state, transition.command) : transition.kind === 'strategy-catchup' ? catchUpStrategy(state, transition.timestamp) : null;
      assert.ok(result?.ok, result?.error); assert.ok(isWorldState(entry.state)); assert.deepEqual(result.state, entry.state); assert.deepEqual(result.events, entry.events); state = result.state;
    }
    if (!page.hasMore) { assert.deepEqual(state, saved.state); return; }
    assert.ok(page.nextRevision !== null && page.nextRevision > after); after = page.nextRevision;
  }
  assert.fail('bounded replay did not terminate');
}

await test('actual civic work, entitlement, first adoption and paid reslot survive SQLite reopen and exact replay', async () => {
  const item = new Fixture();
  try {
    await item.initialize('settlement-observatory-1'); const previous = await item.state(); item.reopen(); assert.deepEqual(await item.state(), previous);
    await item.store.mutate('release-apply', { expectedRevision: previous.revision, expectedFromReleaseId: previous.releaseId, targetReleaseId: 'settlement-civic-bootstrap-1', commandId: 'civic-release', model }, actor, epoch);
    const migrated = await item.state();
    for (const [index, civilization] of migrated.civilizations.entries()) { assert.deepEqual(civilization.resources, previous.civilizations[index]!.resources); assert.deepEqual(civilization.technologies, previous.civilizations[index]!.technologies); assert.equal(civilization.researchProgress, previous.civilizations[index]!.researchProgress); }
    const selection = await item.input('choose-code', { type: 'choose-civic', civicId: 'code-of-laws' }); const accepted = await json(await item.api('/api/action', selection));
    await item.beat(); const partial = await item.state(); assert.ok(partial.civilizations[4]!.civics!.active!.progress > 0); item.reopen(); assert.deepEqual(await item.state(), partial);
    await item.complete(); const ready = await item.state(); const entitlement = ready.civilizations[4]!.civics!.reformEntitlement; assert.ok(entitlement); item.reopen(); assert.deepEqual(await item.state(), ready);
    const arrangement = await item.input('adopt-chiefdom', { type: 'adopt-government', governmentId: 'chiefdom', assignments: [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }] });
    const adopted = await mcpValue(await item.mcp('play_action', arrangement)); const arranged = await item.state();
    assert.equal(arranged.civilizations[4]!.resources.credits, ready.civilizations[4]!.resources.credits); assert.equal(arranged.civilizations[4]!.civics!.reformEntitlement, null); assert.equal(arranged.civilizations[4]!.government!.lastSpentReformCompletionEventId, entitlement.completionEventId);
    item.reopen(); assert.deepEqual(await item.state(), arranged);
    const records = item.database.records(); const duplicate = await mcpValue(await item.mcp('play_action', arrangement)); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.acceptedRevision, adopted.acceptedRevision); assert.deepEqual(item.database.records(), records);
    const startDuplicate = await json(await item.api('/api/action', selection)); assert.equal(startDuplicate.acceptedRevision, accepted.acceptedRevision); assert.equal(startDuplicate.duplicate, true); assert.deepEqual(item.database.records(), records);
    const receipt = await mcpValue(await item.mcp('action_receipt', { commandId: 'adopt-chiefdom' })); assert.equal(receipt.status, 'accepted');
    for (let index = 0; index < 4; index++) await item.beat();
    const beforeReslot = await item.state(); const reslot = await item.input('paid-reslot', { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] }); await json(await item.api('/api/action', reslot));
    assert.equal((await item.state()).civilizations[4]!.resources.credits, Math.round((beforeReslot.civilizations[4]!.resources.credits - 8) * 100) / 100);
    for (let index = 0; index < 22; index++) await item.beat();
    const pruned = await item.state(); assert.ok(!pruned.events.some(event => event.id === entitlement.completionEventId || event.type === 'arrangement-accepted'));
    item.reopen(); assert.deepEqual(await item.state(), pruned); assert.equal(pruned.civilizations[4]!.government!.lastSpentReformCompletionEventId, entitlement.completionEventId);
    assert.deepEqual(await decodeHistorySnapshot(JSON.stringify(pruned)), pruned); await replay(item);
    const http = await json(await item.api('/api/observe?seat=4&observationFormat=compact-trade-v1')); const mcp = await mcpValue(await item.mcp('observe_world', { seat: 4, observationFormat: 'compact-trade-v1' })); assert.deepEqual(mcp, http);
    const corrupt = structuredClone(pruned); corrupt.civilizations[4]!.civics!.reformEntitlement = entitlement;
    assert.equal(isWorldState(corrupt), false); await assert.rejects(decodeHistorySnapshot(JSON.stringify(corrupt)), /corrupt_or_incompatible_world/);
    item.database.sql.prepare('UPDATE world_state SET state_json = ?').run(JSON.stringify(corrupt)); const corruptRows = item.database.records();
    assert.equal((await item.api('/api/world')).status, 503); assert.equal((await item.mcp('observe_world', { seat: 4 })).status, 503); assert.deepEqual(item.database.records(), corruptRows);
  } finally { item.close(); }
});

await test('invalid civic actions and strict stale revisions preserve all SQLite records on HTTP and MCP', async () => {
  const item = new Fixture();
  try {
    await item.initialize(); const base = await item.input('valid-civic', { type: 'choose-civic', civicId: 'code-of-laws' });
    const invalid = [{ type: 'choose-civic', civicId: 'code-of-laws', progress: 16 }, { type: 'choose-civic', civicId: 'unknown' }, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] }, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning', price: 0 }] }];
    for (const [index, action] of invalid.entries()) {
      const before = item.database.records(); const input = { ...base, commandId: `invalid-${index}`, action: { type: 'strategy-action', action } };
      assert.equal((await item.api('/api/action', input)).status, 400); assert.deepEqual(item.database.records(), before);
      assert.equal((await item.mcp('play_action', input)).status, 400); assert.deepEqual(item.database.records(), before);
    }
    await json(await item.api('/api/action', base)); const rows = item.database.records();
    assert.equal((await item.api('/api/action', { ...base, commandId: 'strict-stale' })).status, 409); assert.deepEqual(item.database.records(), rows);
    await item.complete(); const noPolicies = await item.input('empty-arrangement', { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] });
    for (const assignments of [[{ slotType: 'military', slotIndex: 0, policyId: 'urban-planning' }], [{ slotType: 'economic', slotIndex: 1, policyId: 'urban-planning' }], [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }, { slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }]]) {
      const before = item.database.records(); assert.equal((await item.api('/api/action', { ...noPolicies, action: { type: 'strategy-action', action: { type: 'adopt-government', governmentId: 'chiefdom', assignments } } })).status, 400); assert.deepEqual(item.database.records(), before);
    }
  } finally { item.close(); }
});

await test('synthetic second-government pending transition reopens and completes after exactly two durable beats', async () => {
  GOVERNMENTS.push({ id: 'synthetic-council', name: 'Synthetic persistence fixture', requiredFeatures: ['civic-bootstrap'], requires: ['code-of-laws'], slots: { military: 0, economic: 1, diplomatic: 0, wildcard: 0 }, baseProduction: {} });
  const item = new Fixture();
  try {
    await item.initialize(); await json(await item.api('/api/action', await item.input('choose', { type: 'choose-civic', civicId: 'code-of-laws' }))); await item.complete();
    await json(await item.api('/api/action', await item.input('chiefdom', { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] })));
    for (let index = 0; index < 4; index++) await item.beat();
    const before = await item.state(); await json(await item.api('/api/action', await item.input('switch', { type: 'adopt-government', governmentId: 'synthetic-council', assignments: [] })));
    const pending = await item.state(); assert.equal(pending.civilizations[4]!.government!.pending!.completionRound, before.round + 2); item.reopen(); assert.deepEqual(await item.state(), pending);
    await item.beat(); const first = await item.state(); assert.ok(first.civilizations[4]!.government!.pending); item.reopen(); assert.deepEqual(await item.state(), first);
    await item.beat(); const finished = await item.state(); assert.equal(finished.civilizations[4]!.government!.pending, null); assert.equal(finished.civilizations[4]!.government!.active!.effectiveRound, before.round + 2); assert.equal(finished.civilizations[4]!.government!.active!.governmentLockUntilRound, before.round + 6); item.reopen(); assert.deepEqual(await item.state(), finished); await replay(item);
  } finally { item.close(); GOVERNMENTS.pop(); }
});
