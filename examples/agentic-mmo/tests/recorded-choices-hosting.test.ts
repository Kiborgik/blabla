import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { GameAction, WorldState } from '../core/types.ts';
import { isGameEvent } from '../core/validation.ts';
import { RECORDED_CHOICES_FORMAT } from '../server/public-protocol.ts';
import { RECORDED_CHOICE_LIMITS } from '../server/recorded-choices.ts';
import { WorldRepository, type D1Database, type D1Result, type D1Statement, type SqlValue } from '../server/repository.ts';
import { isRecord } from '../server/validation.ts';
import { createWorker } from '../server/worker.ts';
import { coastalDeparturePrefix, coastalPrefixTime } from './fixtures/coastal-prefix.ts';

const actor = 'private-recorded-history-owner';
const model = 'synthetic-recorded-history-fixture';
const cityId = 'city-0';
const format = RECORDED_CHOICES_FORMAT;

class Statement implements D1Statement {
  private readonly database: RecordedDatabase;
  readonly sql: string;
  values: SqlValue[] = [];
  constructor(database: RecordedDatabase, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]): D1Statement { this.values = values; return this; }
  async all(): Promise<D1Result> {
    const results = this.database.sql.prepare(this.sql).all(...this.values);
    this.database.reads.push({ sql: this.sql, values: [...this.values], rows: results.length });
    const hook = this.database.afterRead;
    if (hook) await hook(this.sql);
    return { results, meta: { changes: 0 } };
  }
  execute(): D1Result { this.database.writes++; return { results: [], meta: { changes: Number(this.database.sql.prepare(this.sql).run(...this.values).changes) } }; }
  async run(): Promise<D1Result> { return this.execute(); }
}
class RecordedDatabase implements D1Database {
  readonly sql: DatabaseSync;
  reads: Array<{ sql: string; values: SqlValue[]; rows: number }> = [];
  writes = 0;
  afterRead: ((sql: string) => Promise<void>) | null = null;
  constructor(path: string) { this.sql = new DatabaseSync(path); }
  prepare(sql: string): D1Statement { return new Statement(this, sql); }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
    this.sql.exec('BEGIN');
    try { const result = statements.map(statement => { assert.ok(statement instanceof Statement); return statement.execute(); }); this.sql.exec('COMMIT'); return result; }
    catch (failure) { this.sql.exec('ROLLBACK'); throw failure; }
  }
  records() { return { world: this.sql.prepare('SELECT * FROM world_state').all(), history: this.sql.prepare('SELECT * FROM world_transitions ORDER BY end_revision').all(), receipts: this.sql.prepare('SELECT * FROM world_receipts ORDER BY receipt_key').all(), autonomy: this.sql.prepare('SELECT * FROM world_autonomy').all() }; }
}
class Fixture {
  readonly directory = mkdtempSync(join(tmpdir(), 'recorded-choices-'));
  readonly path = join(this.directory, 'world.sqlite');
  database = new RecordedDatabase(this.path);
  constructor() {
    for (const migration of ['0000_world', '0001_autonomous_policy']) this.database.sql.exec(readFileSync(new URL(`../server/migrations/${migration}.sql`, import.meta.url), 'utf8'));
  }
  get store() { return new WorldRepository(this.database); }
  async state(): Promise<WorldState> { const result = await this.store.read(); assert.ok(result); return result.state; }
  async action(action: GameAction, reason?: string): Promise<WorldState> {
    const state = await this.state(); const timestamp = coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 10);
    await this.store.mutate('action', { seat: 0, expectedRevision: state.revision, action, model, commandId: `choice-${state.revision}`, ...(reason === undefined ? {} : { plan: [{ action, reason }] }) }, actor, timestamp);
    return this.state();
  }
  async beat(): Promise<WorldState> {
    const state = await this.state(); const timestamp = coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60);
    await this.store.mutate('strategy-catchup', { expectedRevision: state.revision, timestamp, model, commandId: `beat-${state.revision}` }, actor, timestamp);
    return this.state();
  }
  async seed() {
    const prefix = coastalDeparturePrefix();
    await this.store.initialize({ seed: prefix.initial.seed, clockEpoch: coastalPrefixTime(0), commandId: 'initialize' }, actor, coastalPrefixTime(0));
    for (const step of prefix.steps) {
      const input = step.input;
      const timestamp = input.kind === 'strategy' ? input.timestamp : input.command.timestamp; assert.ok(timestamp);
      const argument = input.kind === 'strategy' ? { expectedRevision: step.before.revision, timestamp } : input.command;
      await this.store.mutate(input.kind === 'release' ? 'release-apply' : input.kind === 'strategy' ? 'strategy-catchup' : 'action', { ...argument, model, commandId: `prefix-${step.before.revision}` }, actor, timestamp);
    }
    assert.deepEqual(await this.state(), prefix.state);
    const started = await this.action({ type: 'build', project: 'irrigation', cityId }, 'Fund the exact town irrigation works.');
    let completed = started;
    for (let count = 0; count < 20 && !completed.cities.find(city => city.id === cityId)?.buildings.includes('irrigation'); count++) completed = await this.beat();
    assert.ok(completed.cities.find(city => city.id === cityId)?.buildings.includes('irrigation'));
    const operated = await this.beat();
    assert.equal(operated.cities.find(city => city.id === cityId)?.buildingOperations?.irrigation?.lastResult?.status, 'operated');
    return { started, completed, operated };
  }
  reopen() { this.database.sql.close(); this.database = new RecordedDatabase(this.path); }
  request(path: string, method = 'GET') { return createWorker().fetch(new Request(`https://example.test${path}`, { method }), { DB: this.database }); }
  close() { this.database.sql.close(); rmSync(this.directory, { recursive: true, force: true }); }
}
function assertPrivateFree(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const secret of [actor, 'actorUserId', 'request_json', 'response_json', 'receipt_key', 'state_json', 'initial_json', '"tiles":', '"civilizations":', '"actionPlans":', '"transition":', '"commandId":']) assert.equal(serialized.includes(secret), false, secret);
}

await test('recorded choices use strict indexed read-only history and exact detached snapshots', async context => {
  const item = new Fixture();
  try {
    const story = await item.seed();
    item.reopen();
    const checkpoint = item.database.records();
    const current = story.operated.revision;
    const query = { endRevision: story.started.revision, civilizationId: 0, cityId };

    await context.test('fenced pagination returns every exact event once without snapshot or receipt reads', async () => {
      let after = 0; const seen: number[] = []; item.database.reads = [];
      for (let count = 0; count <= current; count++) {
        const page = await item.store.boundedChronicle({ format, after, through: story.completed.revision, limit: 3 });
        assert.equal(page.through, story.completed.revision); assert.equal(page.after, after); assert.ok(page.entries.length <= 3);
        assert.ok(Buffer.byteLength(JSON.stringify(page)) <= RECORDED_CHOICE_LIMITS.pageBytes); assertPrivateFree(page);
        for (const entry of page.entries) {
          assert.ok(entry.endRevision > after && entry.endRevision <= story.completed.revision);
          if (entry.kind !== 'action') assert.equal(entry.recordedReason, null);
          const raw = item.database.sql.prepare('SELECT events_json FROM world_transitions WHERE world_id=? AND end_revision=?').get('main', entry.endRevision); assert.ok(raw && typeof raw.events_json === 'string');
          assert.deepEqual(entry.events, JSON.parse(raw.events_json)); seen.push(entry.endRevision);
        }
        if (!page.hasMore) { assert.equal(page.nextRevision, null); break; }
        assert.equal(page.nextRevision, page.entries.at(-1)?.endRevision); assert.ok(page.nextRevision !== null && page.nextRevision > after); after = page.nextRevision;
      }
      assert.deepEqual(seen, checkpoint.history.filter(row => typeof row.end_revision === 'number' && row.end_revision <= story.completed.revision).map(row => row.end_revision));
      assert.equal(new Set(seen).size, seen.length);
      for (const read of item.database.reads) {
        assert.equal(/state_json|world_receipts|OFFSET/i.test(read.sql), false);
        assert.ok(read.rows <= 4);
        if (read.sql.includes('world_transitions')) {
          assert.match(read.sql, /world_id = \? AND end_revision > \? AND end_revision <= \? ORDER BY end_revision ASC LIMIT \?/);
          const plan = item.database.sql.prepare(`EXPLAIN QUERY PLAN ${read.sql}`).all(...read.values);
          assert.ok(plan.some(row => String(row.detail).includes('SEARCH world_transitions USING INDEX')));
        }
      }
      const empty = await item.store.boundedChronicle({ format, after: story.completed.revision, through: story.completed.revision, limit: 1 });
      assert.deepEqual(empty.entries, []); assert.equal(empty.hasMore, false); assert.equal(empty.nextRevision, null);
    });

    await context.test('exact historical paid start completion and operation survive current growth and returned-object mutation', async () => {
      item.database.reads = [];
      const start = await item.store.recordedChoiceDetail(query);
      assert.equal(start.recordedReason, 'Fund the exact town irrigation works.');
      assert.equal(start.consequences.revision, story.started.revision); assert.equal(start.consequences.basis, 'exact-end-revision-snapshot');
      assert.deepEqual(start.consequences.town.construction.started, story.started.cities.find(city => city.id === cityId)?.construction?.active);
      const complete = await item.store.recordedChoiceDetail({ ...query, endRevision: story.completed.revision });
      assert.deepEqual(complete.consequences.town.construction.completed, story.completed.cities.find(city => city.id === cityId)?.construction?.lastCompleted);
      assert.equal(complete.recordedReason, null);
      const operation = await item.store.recordedChoiceDetail({ ...query, endRevision: current });
      const result = operation.consequences.town.operations.find(operation => operation.buildingId === 'irrigation')?.result;
      assert.deepEqual(result, story.operated.cities.find(city => city.id === cityId)?.buildingOperations?.irrigation?.lastResult);
      assert.ok(result); result.paid.materials = 999;
      assert.ok(start.consequences.town.construction.started); start.consequences.town.construction.started.paid.materials = 888;
      assert.ok(start.entry?.events[0]); start.entry.events[0].effects.push('Detached mutation');
      assert.deepEqual((await item.store.recordedChoiceDetail(query)).consequences.town.construction.started, story.started.cities.find(city => city.id === cityId)?.construction?.active);
      assert.equal(story.operated.cities.find(city => city.id === cityId)?.buildingOperations?.irrigation?.lastResult?.paid.materials, 1);
      for (const detail of [start, complete, operation]) assertPrivateFree(detail);
      for (const read of item.database.reads) {
        assert.match(read.sql, /FROM world_transitions WHERE world_id = \? AND end_revision = \? LIMIT 1$/); assert.equal(read.rows, 1);
        const plan = item.database.sql.prepare(`EXPLAIN QUERY PLAN ${read.sql}`).all(...read.values);
        assert.ok(plan.some(row => String(row.detail).includes('SEARCH world_transitions USING INDEX')));
      }
    });

    await context.test('missing revisions and wrong exact towns remain explicitly unavailable without current-state fallback', async () => {
      const missing = await item.store.recordedChoiceDetail({ ...query, endRevision: current + 100 });
      assert.equal(missing.entry, null); assert.equal(missing.recordedReason, null); assert.equal(missing.consequences.status, 'unavailable');
      assert.equal(missing.consequences.town.unavailableReason, 'transition_not_found');
      const foreign = await item.store.recordedChoiceDetail({ ...query, civilizationId: 1 });
      assert.equal(foreign.consequences.town.status, 'unavailable'); assert.equal(foreign.consequences.town.unavailableReason, 'town_not_owned');
      assert.deepEqual(foreign.consequences.town.operations, []); assert.equal(foreign.consequences.town.construction.active, null);
      const absent = await item.store.recordedChoiceDetail({ ...query, cityId: 'absent-town' });
      assert.equal(absent.consequences.town.unavailableReason, 'town_not_found');
    });

    await context.test('anonymous HTTP versioned routes are narrow and unformatted legacy routes retain their envelopes', async () => {
      const page = await item.request(`/api/chronicle?format=${format}&after=${story.started.revision - 1}&through=${story.started.revision}&limit=1`);
      assert.equal(page.status, 200); const value: unknown = await page.json(); assertPrivateFree(value); assert.ok(isRecord(value) && value.format === format);
      const detail = await item.request(`/api/recorded-choice?format=${format}&endRevision=${story.started.revision}&civilizationId=0&cityId=${cityId}`);
      assert.equal(detail.status, 200); const body: unknown = await detail.json(); assertPrivateFree(body); assert.ok(isRecord(body) && body.recordedReason === 'Fund the exact town irrigation works.');
      const legacy = await item.request('/api/chronicle?after=0&limit=1'); assert.equal(legacy.status, 200);
      const old: unknown = await legacy.json(); assert.ok(isRecord(old) && !Object.hasOwn(old, 'format') && Array.isArray(old.entries));
      assert.ok(isRecord(old.entries[0]) && Object.hasOwn(old.entries[0], 'transition'));
      const raw = await item.store.chronicle(0, 1); assert.equal(raw.entries[0]?.provenance.actorUserId, actor);
      const history = await item.store.history(0, 1); assert.ok(history.entries[0]?.state.tiles.length);
      const post = await item.request(`/api/recorded-choice?format=${format}`, 'POST'); assert.equal(post.status, 401);
    });

    await context.test('versioned malformed duplicate unknown and unsupported queries fail before database access', async () => {
      const pageBase = `/api/chronicle?format=${format}`;
      const detailBase = `/api/recorded-choice?format=${format}&endRevision=${current}&civilizationId=0&cityId=${cityId}`;
      const cases = [
        `${pageBase}&format=${format}`, `${pageBase}&after=0&after=1`, `${pageBase}&unknown=1`, `${pageBase}&after=`, `${pageBase}&after=01`, `${pageBase}&after=1e0`, `${pageBase}&after=1.0`, `${pageBase}&after=%201`, `${pageBase}&after=0x10`, `${pageBase}&after=-1`, `${pageBase}&after=9007199254740992`, `${pageBase}&limit=0`, `${pageBase}&limit=201`, `${pageBase}&through=NaN`, '/api/chronicle?format=other',
        `${detailBase}&civilizationId=1`, `${detailBase}&cityId=city-1`, `${detailBase}&through=1`, `/api/recorded-choice?endRevision=${current}&civilizationId=0&cityId=${cityId}`, `${detailBase.replace(`endRevision=${current}`, 'endRevision=0')}`, `${detailBase.replace('civilizationId=0', 'civilizationId=5')}`, `${detailBase.replace(`cityId=${cityId}`, 'cityId=%00')}`, `${detailBase.replace(`cityId=${cityId}`, 'cityId=')}`,
      ];
      for (const path of cases) { item.database.reads = []; const result = await item.request(path); assert.equal(result.status, 400, path); assert.deepEqual(item.database.reads, [], path); }
      for (const input of [{ format, after: null }, { format, limit: null }, { format, through: null }, { format, actorUserId: actor }]) await assert.rejects(item.store.boundedChronicle(input));
      await assert.rejects(item.store.boundedChronicle({ format, through: current + 1 }), { message: 'invalid_recorded_choice_range' });
      await assert.rejects(item.store.boundedChronicle({ format, after: current, through: current - 1 }), { message: 'invalid_recorded_choice_range' });
    });

    await context.test('strict corrupt events refuse unknown extensions malformed nested receipts and false event revisions without repair', async () => {
      const row = item.database.sql.prepare('SELECT events_json FROM world_transitions WHERE end_revision=?').get(story.started.revision); assert.ok(row && typeof row.events_json === 'string');
      const original: unknown = JSON.parse(row.events_json); assert.ok(Array.isArray(original) && original.every(isGameEvent));
      const first = original[0]; assert.ok(first);
      for (const changed of [{ ...first, actorUserId: actor }, { ...first, unknownStrategicReceipt: true }, { ...first, effects: [] }, { ...first, id: `${current + 100}:0` }, { ...first, territoryAcquisition: { actorUserId: actor } }]) {
        item.database.sql.prepare('UPDATE world_transitions SET events_json=? WHERE end_revision=?').run(JSON.stringify([changed, ...original.slice(1)]), story.started.revision);
        const before = item.database.records();
        await assert.rejects(item.store.boundedChronicle({ format, after: story.started.revision - 1, through: story.started.revision, limit: 1 }), { message: 'corrupt_history' });
        await assert.rejects(item.store.recordedChoiceDetail(query), { message: 'corrupt_history' });
        const http = await item.request(`/api/recorded-choice?format=${format}&endRevision=${story.started.revision}&civilizationId=0&cityId=${cityId}`);
        assert.equal(http.status, 503); assert.deepEqual(await http.json(), { ok: false, error: 'corrupt_history' }); assert.deepEqual(item.database.records(), before);
      }
      item.database.sql.prepare('UPDATE world_transitions SET events_json=? WHERE end_revision=?').run(row.events_json, story.started.revision);
    });

    await context.test('stored scalar enums reject array coercion in metadata actions every plan item and nested Mars receipts', async () => {
      const row = item.database.sql.prepare('SELECT transition_json, events_json FROM world_transitions WHERE end_revision=?').get(story.started.revision);
      assert.ok(row && typeof row.transition_json === 'string' && typeof row.events_json === 'string');
      const transition: unknown = JSON.parse(row.transition_json); assert.ok(isRecord(transition) && isRecord(transition.command));
      const expectedRevision = story.started.revision - 1;
      const timestamp = coastalPrefixTime(story.started.round * 60);
      const eventId = `${story.started.revision}:0`;
      const marsEvent = {
        id: eventId, round: story.started.round, type: 'mars-departed', title: 'Departure', detail: 'mars-0-2', actor: 0, target: 0, tileId: 0, cause: 'Recorded departure', effects: ['Paid recorded costs'], importance: 1,
        marsDeparture: { ruleVersion: 1, civId: 0, mission: 'resupply', sourceCityId: cityId, departureRound: story.started.round, arrivalRound: story.started.round + 4, settlers: 0, launchCost: { materials: 18, energy: 16, credits: 36 }, cargo: { food: 24, materials: 24, energy: 40 }, totalCost: { food: 24, materials: 42, energy: 56, credits: 36 }, sourcePopulationBefore: 8, sourcePopulationAfter: 8, id: 'mars-0-2', eventId, paid: { food: 24, materials: 42, energy: 56, credits: 36 } },
      };
      assert.ok(isGameEvent(marsEvent));
      const cases = [
        { name: 'director kind', transition: { kind: 'director-tick', command: { expectedRevision, kind: ['clock'], intervalId: 'enum-regression', timestamp, event: 'calm', target: 0 } }, events: [] },
        { name: 'history cause kind', transition: { kind: 'history-advance', command: { expectedRevision, cause: { kind: ['event'], id: 'enum-regression' }, reason: 'Retained reason', deltaYears: 1, timestamp } }, events: [] },
        { name: 'expedition mission', transition: { kind: 'action', command: { expectedRevision, seat: 0, action: { type: 'expedition', cityId, mission: ['settle'] } } }, events: [] },
        { name: 'non-head plan mission', transition: { ...transition, command: { ...transition.command, plan: [{ action: transition.command.action, reason: 'Fund the exact town irrigation works.' }, { action: { type: 'expedition', cityId, mission: ['resupply'] }, reason: 'Review future supply' }] } }, events: [] },
        { name: 'nested Mars mission', transition, events: [{ ...marsEvent, marsDeparture: { ...marsEvent.marsDeparture, mission: ['resupply'] } }] },
      ];
      try {
        for (const changed of cases) {
          item.database.sql.prepare('UPDATE world_transitions SET transition_json=?, events_json=? WHERE end_revision=?').run(JSON.stringify(changed.transition), JSON.stringify(changed.events), story.started.revision);
          const before = item.database.records(); const writes = item.database.writes;
          await assert.rejects(item.store.boundedChronicle({ format, after: expectedRevision, through: story.started.revision, limit: 1 }), { message: 'corrupt_history' }, changed.name);
          await assert.rejects(item.store.recordedChoiceDetail(query), { message: 'corrupt_history' }, changed.name);
          for (const path of [`/api/chronicle?format=${format}&after=${expectedRevision}&through=${story.started.revision}&limit=1`, `/api/recorded-choice?format=${format}&endRevision=${story.started.revision}&civilizationId=0&cityId=${cityId}`]) {
            const response = await item.request(path); assert.equal(response.status, 503, changed.name); assert.deepEqual(await response.json(), { ok: false, error: 'corrupt_history' });
          }
          assert.equal(item.database.writes, writes); assert.deepEqual(item.database.records(), before);
        }
      } finally { item.database.sql.prepare('UPDATE world_transitions SET transition_json=?, events_json=? WHERE end_revision=?').run(row.transition_json, row.events_json, story.started.revision); }
    });

    await context.test('exact snapshot plans reject malformed non-head action enums without repairing history', async () => {
      const row = item.database.sql.prepare('SELECT state_json FROM world_transitions WHERE end_revision=?').get(story.started.revision); assert.ok(row && typeof row.state_json === 'string');
      const changed = structuredClone(story.started); const plan = changed.actionPlans?.[0]; assert.ok(plan);
      const action = { type: 'expedition', cityId, mission: ['resupply'] };
      Reflect.set(plan, 'items', [...plan.items, { action, reason: 'Review future supply', status: 'needs-review', result: 'Review before submitting' }]);
      item.database.sql.prepare('UPDATE world_transitions SET state_json=? WHERE end_revision=?').run(JSON.stringify(changed), story.started.revision);
      try {
        const before = item.database.records(); const writes = item.database.writes;
        await assert.rejects(item.store.recordedChoiceDetail(query), { message: 'corrupt_history' });
        assert.equal(item.database.writes, writes); assert.deepEqual(item.database.records(), before);
      } finally { item.database.sql.prepare('UPDATE world_transitions SET state_json=? WHERE end_revision=?').run(row.state_json, story.started.revision); }
    });

    await context.test('exact historical corruption is refused even when the current world is healthy', async () => {
      const row = item.database.sql.prepare('SELECT state_json FROM world_transitions WHERE end_revision=?').get(story.started.revision); assert.ok(row && typeof row.state_json === 'string');
      const corrupt = structuredClone(story.started); const active = corrupt.cities.find(city => city.id === cityId)?.construction?.active; assert.ok(active); Reflect.set(active, 'actorUserId', actor);
      item.database.sql.prepare('UPDATE world_transitions SET state_json=? WHERE end_revision=?').run(JSON.stringify(corrupt), story.started.revision);
      const before = item.database.records(); assert.deepEqual(await item.state(), story.operated);
      await assert.rejects(item.store.recordedChoiceDetail(query), { message: 'corrupt_or_incompatible_world' }); assert.deepEqual(item.database.records(), before);
      item.database.sql.prepare('UPDATE world_transitions SET state_json=? WHERE end_revision=?').run(row.state_json, story.started.revision);
      item.database.sql.prepare('UPDATE world_transitions SET state_json=? WHERE end_revision=?').run(JSON.stringify(story.operated), story.started.revision);
      await assert.rejects(item.store.recordedChoiceDetail(query), { message: 'corrupt_history' });
      item.database.sql.prepare('UPDATE world_transitions SET state_json=? WHERE end_revision=?').run(row.state_json, story.started.revision);
    });

    await context.test('a valid but inconsistent plan reason cannot be claimed as committed snapshot provenance', async () => {
      const row = item.database.sql.prepare('SELECT state_json FROM world_transitions WHERE end_revision=?').get(story.started.revision); assert.ok(row && typeof row.state_json === 'string');
      const changed = structuredClone(story.started); const head = changed.actionPlans?.[0]?.items[0]; assert.ok(head); head.reason = 'A different retained reason';
      item.database.sql.prepare('UPDATE world_transitions SET state_json=? WHERE end_revision=?').run(JSON.stringify(changed), story.started.revision);
      const before = item.database.records(); await assert.rejects(item.store.recordedChoiceDetail(query), { message: 'corrupt_history' }); assert.deepEqual(item.database.records(), before);
      item.database.sql.prepare('UPDATE world_transitions SET state_json=? WHERE end_revision=?').run(row.state_json, story.started.revision);
    });

    await context.test('metadata limits refuse oversized rows before loading and paginate exact output bytes', async () => {
      const originals = item.database.sql.prepare('SELECT end_revision, events_json FROM world_transitions ORDER BY end_revision LIMIT 3').all();
      for (const row of originals) {
        assert.ok(typeof row.events_json === 'string' && typeof row.end_revision === 'number'); const events: unknown = JSON.parse(row.events_json); assert.ok(Array.isArray(events) && events.every(isGameEvent) && events[0]);
        events[0].detail = 'x'.repeat(360 * 1024);
        item.database.sql.prepare('UPDATE world_transitions SET events_json=? WHERE end_revision=?').run(JSON.stringify(events), row.end_revision);
      }
      item.database.reads = [];
      const page = await item.store.boundedChronicle({ format, after: 0, through: 3, limit: 3 });
      assert.equal(page.entries.length, 2); assert.equal(page.hasMore, true); assert.equal(page.nextRevision, 2); assert.ok(Buffer.byteLength(JSON.stringify(page)) <= RECORDED_CHOICE_LIMITS.pageBytes);
      assert.deepEqual(item.database.reads.map(read => read.rows), [1, 3, 2]);
      const first = originals[0]; assert.ok(first && typeof first.events_json === 'string');
      const events: unknown = JSON.parse(first.events_json); assert.ok(Array.isArray(events) && events.every(isGameEvent) && events[0]); events[0].detail = 'x'.repeat(RECORDED_CHOICE_LIMITS.rowBytes);
      item.database.sql.prepare('UPDATE world_transitions SET events_json=? WHERE end_revision=1').run(JSON.stringify(events)); item.database.reads = [];
      await assert.rejects(item.store.boundedChronicle({ format, after: 0, through: 1, limit: 1 }), { message: 'recorded_choice_row_limit' }); assert.equal(item.database.reads.length, 2); assert.ok(item.database.reads.every(read => !read.sql.includes('SELECT start_revision')));
      item.database.reads = []; await assert.rejects(item.store.recordedChoiceDetail({ ...query, endRevision: 1 }), { message: 'recorded_choice_row_limit' }); assert.equal(item.database.reads.length, 1);
      for (const row of originals) { assert.ok(typeof row.events_json === 'string' && typeof row.end_revision === 'number'); item.database.sql.prepare('UPDATE world_transitions SET events_json=? WHERE end_revision=?').run(row.events_json, row.end_revision); }
    });

    assert.equal(item.database.writes, 0); assert.deepEqual(item.database.records(), checkpoint);

    await context.test('captured default fence excludes an actual concurrent commit and continuation remains fixed', async () => {
      item.database.afterRead = async sql => {
        if (sql !== 'SELECT revision FROM world_state WHERE world_id = ?') return;
        item.database.afterRead = null; await item.beat();
      };
      const page = await item.store.boundedChronicle({ format, after: current - 1, limit: 1 });
      assert.equal(page.through, current); assert.deepEqual(page.entries.map(entry => entry.endRevision), [current]); assert.equal(page.hasMore, false);
      const frozen = await item.store.boundedChronicle({ format, after: current, through: page.through, limit: 1 }); assert.deepEqual(frozen.entries, []);
      const fresh = await item.store.boundedChronicle({ format, after: current, limit: 1 }); assert.equal(fresh.through, current + 1); assert.equal(fresh.entries[0]?.endRevision, current + 1);
      assert.deepEqual((await item.store.recordedChoiceDetail(query)).consequences.town.construction.started, story.started.cities.find(city => city.id === cityId)?.construction?.active);
    });

    await context.test('committed procedural provenance supplies its recorded reason without claiming model play', async () => {
      const state = await item.state(); const timestamp = coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 20);
      await item.store.configureSimulation({ commandId: 'activate-fixture', expectedRevision: state.revision, enabled: true }, actor, timestamp);
      await item.store.runSimulation({ commandId: 'wake-fixture' }, actor, timestamp);
      const before = item.database.records(); const writes = item.database.writes;
      const page = await item.store.boundedChronicle({ format, after: state.revision, limit: 20 });
      const entries = page.entries.filter(entry => entry.provenance.kind === 'procedural-policy'); assert.ok(entries.length > 0);
      for (const entry of entries) { assert.equal(entry.provenance.model, null); assert.ok(entry.recordedReason); assert.ok(entry.provenance.policy); assertPrivateFree(entry); }
      assert.deepEqual(item.database.records(), before); assert.equal(item.database.writes, writes);
    });
  } finally { item.close(); }
});
