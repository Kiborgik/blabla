import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { GameStore } from '../cli/store.ts';
import { applyCommand, applyHistoryAdvance, createWorld } from '../core/engine.ts';
import { isWorldState } from '../core/validation.ts';
import { RECORDED_CHOICES_FORMAT } from '../server/public-protocol.ts';
import { WorldRepository, type D1Database, type D1Statement, type SqlValue } from '../server/repository.ts';
import { RequestFailure } from '../server/validation.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const rules = 'settlement-foundations-2';
const actor = 'current-record-fixture';
const history = { expectedRevision: 0, cause: { kind: 'feature', id: 'history-advancement' }, reason: 'Current calendar receipt', deltaYears: 7, timestamp: epoch, model: actor, commandId: 'current-history' };
const action = { expectedRevision: 1, seat: 0, action: { type: 'wait' }, timestamp: epoch, model: actor, commandId: 'current-action' };
const retiredTransition = { kind: 'release-apply', command: { expectedRevision: 0, expectedFromReleaseId: 'settlement-foundations-1', targetReleaseId: rules, timestamp: epoch } };

function localFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'current-command-records-'));
  const store = new GameStore(join(directory, 'world.json'));
  assert.equal(store.initialize(17, false, epoch, rules).ok, true);
  assert.equal(store.authoredTransition(history, 'history-advance').ok, true);
  assert.equal(store.submit(action).ok, true);
  return { store, close: () => rmSync(directory, { recursive: true, force: true }) };
}

function hostedFixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../server/migrations/0000_world.sql', import.meta.url), 'utf8'));
  let reads = 0;
  const database: D1Database = {
    prepare(query) {
      let values: SqlValue[] = [];
      const statement: D1Statement = {
        bind(...next) { values = next; return statement; },
        async all() { reads++; return { results: sql.prepare(query).all(...values), meta: { changes: 0 } }; },
        async run() { return { results: [], meta: { changes: Number(sql.prepare(query).run(...values).changes) } }; },
      };
      return statement;
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try { const result = await Promise.all(statements.map(statement => statement.run())); sql.exec('COMMIT'); return result; }
      catch (failure) { sql.exec('ROLLBACK'); throw failure; }
    },
  };
  return {
    sql, database, reads: () => reads, repository: new WorldRepository(database),
    records: () => ['world_state', 'world_transitions', 'world_receipts'].map(table => sql.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all()),
  };
}

void test('current housing refuses the retired adoption origin without rewriting the world', () => {
  const state = createWorld(17, epoch, 'settlement-knowledge-compacts-1');
  assert.equal(isWorldState(state), true);
  const housing = state.cities[0]?.housing;
  assert.ok(housing);
  Object.assign(housing, { origin: 'legacy-adoption' });
  const before = JSON.stringify(state);
  assert.equal(isWorldState(state), false);
  assert.equal(JSON.stringify(state), before);
});

void test('current CLI calendar and action receipts survive restart and replay without duplicate writes', () => {
  const item = localFixture();
  try {
    const bytes = readFileSync(item.store.path, 'utf8');
    const reopened = new GameStore(item.store.path);
    assert.equal(reopened.authoredTransition(history, 'history-advance').acceptedRevision, 1);
    assert.equal(reopened.submit(action).acceptedRevision, 2);
    const campaign = reopened.snapshot();
    assert.equal(campaign.state.year, -9993);
    assert.equal(campaign.state.historyAdvances?.['feature:history-advancement']?.deltaYears, 7);
    assert.deepEqual(campaign.timeline.map(entry => entry.kind), ['history-advance', 'action']);
    let state = campaign.initial;
    for (const [index, transition] of reopened.replay().timeline.entries()) {
      assert.ok(transition.kind === 'history-advance' || transition.kind === 'action');
      const result = transition.kind === 'history-advance' ? applyHistoryAdvance(state, transition.command) : applyCommand(state, transition.command);
      assert.equal(result.ok, true, result.error);
      assert.deepEqual({ state: result.state, events: result.events }, campaign.frames[index]);
      state = result.state;
    }
    assert.deepEqual(state, campaign.state);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
  } finally { item.close(); }
});

void test('CLI refuses retired or incomplete command records without repairing bytes or creating a request lock', () => {
  const item = localFixture();
  try {
    const campaign = item.store.snapshot();
    const malformed = [
      { ...campaign, timeline: [retiredTransition, ...campaign.timeline.slice(1)] },
      { ...campaign, timeline: undefined },
      ...['release-apply', undefined, 'action'].map(operation => ({ ...campaign, provenance: campaign.provenance.map((entry, index) => index === 0 ? { ...entry, operation } : entry) })),
    ];
    for (const record of malformed) {
      const bytes = JSON.stringify(record);
      writeFileSync(item.store.path, bytes);
      assert.throws(() => new GameStore(item.store.path).replay(), /corrupt durable campaign data/);
      assert.throws(() => item.store.authoredTransition({}, 'release-apply'), /pre_release_migration_disabled/);
      assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
      assert.equal(existsSync(`${item.store.path}.lock`), false);
    }
  } finally { item.close(); }
});

void test('hosted current records replay while retired command records are refused read-only', async () => {
  const item = hostedFixture();
  try {
    await item.repository.initialize({ seed: 17, clockEpoch: epoch, registeredRulesId: rules, commandId: 'current-init' }, actor, epoch);
    await item.repository.mutate('history-advance', history, actor, epoch);
    await item.repository.mutate('action', action, actor, epoch);
    const saved = item.records();
    const reopened = new WorldRepository(item.database);
    assert.equal((await reopened.mutate('history-advance', history, actor, epoch)).acceptedRevision, 1);
    assert.equal((await reopened.mutate('action', action, actor, epoch)).acceptedRevision, 2);
    const current = await reopened.read();
    assert.ok(current);
    assert.equal(current.state.year, -9993);
    assert.equal(current.state.historyAdvances?.['feature:history-advancement']?.revision, 1);
    const entries = (await reopened.history()).entries;
    assert.deepEqual(entries.map(entry => entry.transition.kind), ['history-advance', 'action']);
    let state = current.initial;
    for (const entry of entries) {
      const transition = entry.transition;
      assert.ok(transition.kind === 'history-advance' || transition.kind === 'action');
      const result = transition.kind === 'history-advance' ? applyHistoryAdvance(state, transition.command) : applyCommand(state, transition.command);
      assert.equal(result.ok, true, result.error);
      assert.deepEqual(result.state, entry.state);
      assert.deepEqual(result.events, entry.events);
      state = result.state;
    }
    assert.deepEqual(state, current.state);
    assert.deepEqual((await reopened.boundedChronicle({ format: RECORDED_CHOICES_FORMAT })).entries.map(entry => entry.kind), ['history-advance', 'action']);
    assert.equal((await reopened.recordedChoiceDetail({ endRevision: 1, civilizationId: 0, cityId: 'city-0' })).entry?.kind, 'history-advance');
    assert.deepEqual(item.records(), saved);

    for (const transition of [retiredTransition, { ...entries[0]?.transition, kind: ['action'] }]) {
      item.sql.prepare('UPDATE world_transitions SET transition_json = ? WHERE end_revision = 1').run(JSON.stringify(transition));
      const refused = item.records();
      const reads = item.reads();
      await assert.rejects(reopened.mutate('release-apply', {}, actor, epoch), (failure: unknown) => failure instanceof RequestFailure && failure.code === 'pre_release_migration_disabled');
      assert.equal(item.reads(), reads);
      for (const read of [
        () => reopened.history(),
        () => reopened.chronicle(),
        () => reopened.boundedChronicle({ format: RECORDED_CHOICES_FORMAT }),
        () => reopened.recordedChoiceDetail({ endRevision: 1, civilizationId: 0, cityId: 'city-0' }),
      ]) await assert.rejects(read(), (failure: unknown) => failure instanceof RequestFailure && failure.code === 'corrupt_history');
      assert.deepEqual(item.records(), refused);
    }
  } finally { item.sql.close(); }
});
