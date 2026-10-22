import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { applyCommand, applyDirectorTick, applyRelease, createWorld, legalActions } from '../core/engine.ts';
import { chooseDirectorBehavior, createBehaviorMemory } from '../core/behaviors.ts';
import { RELEASES } from '../core/release.ts';
import { isGameAction } from '../core/planning.ts';
import { historicalEventCandidates, historicalEventInstanceId } from '../core/historical-selection.ts';
import { isGameEvent, isWorldState } from '../core/validation.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { GameStore } from '../cli/store.ts';
import { WorldRepository, type D1Database, type D1Statement, type D1Result, type SqlValue } from '../server/repository.ts';
import { RECORDED_CHOICES_FORMAT } from '../server/public-protocol.ts';
import { isRecord } from '../server/validation.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const latest = 'settlement-regional-targets-1';
const prior = 'settlement-living-partnerships-1';

function world(target = latest): WorldState {
  let state = createWorld(1701, epoch);
  for (const release of RELEASES) {
    if (!release.compatibleFrom.includes(state.releaseId)) continue;
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, timestamp: epoch });
    assert.equal(result.ok, true, result.error); state = result.state;
    if (state.releaseId === target) break;
  }
  assert.equal(state.releaseId, target); assert.ok(isWorldState(state)); return state;
}

function selected(state: WorldState) {
  const action = legalActions(state, 5, epoch).map(option => option.action).find(action => action.type === 'event' && action.regional);
  assert.ok(action?.type === 'event' && action.regional);
  return { ...action, regional: action.regional };
}

function tick(state: WorldState, action = selected(state)) {
  return { expectedRevision: state.revision, kind: 'event' as const, intervalId: 'regional-fixture', timestamp: epoch, event: action.event, target: action.target, regional: action.regional };
}

void test('exact regional action survives admission, attached plan, revision increment and committed receipt validation', () => {
  const state = world(); const action = selected(state); const before = JSON.stringify(state);
  const command = { expectedRevision: state.revision, seat: 5, action, timestamp: epoch, plan: [{ action, reason: 'Apply the exact observed regional conditions.' }] };
  assert.ok(isGameAction(action));
  const result = applyCommand(state, command); assert.equal(result.ok, true, result.error);
  assert.equal(JSON.stringify(state), before); assert.ok(isWorldState(result.state));
  const event = result.events.find(event => event.regionalEvent); assert.ok(event?.regionalEvent);
  assert.deepEqual(event.regionalEvent.selection, action.regional);
  assert.equal(event.regionalEvent.revision, state.revision + 1); assert.equal(event.regionalEvent.eventId, event.id);
  assert.equal(result.state.eventCounts[action.event], (state.eventCounts[action.event] ?? 0) + 1);
  assert.equal(result.state.rng, state.rng); assert.ok(isGameEvent(event));
  assert.deepEqual(applyCommand(JSON.parse(before), JSON.parse(JSON.stringify(command))), result);
  assert.equal(isGameAction({ ...action, regional: { ...action.regional, extra: true } }), false);
  const wrongReceipt = structuredClone(event); assert.ok(wrongReceipt.regionalEvent); wrongReceipt.regionalEvent.civId = (action.target + 1) % 5;
  assert.equal(isGameEvent(wrongReceipt), false);
});

void test('tick selection and old release shape are exact, with zero-effect refusal before interval commit', () => {
  const state = world(); const action = selected(state); const command = tick(state, action); const before = JSON.stringify(state);
  const missing = { expectedRevision: state.revision, kind: 'event' as const, intervalId: command.intervalId, timestamp: epoch, event: action.event, target: action.target };
  assert.equal(applyDirectorTick(state, missing).ok, false);
  const stale = structuredClone(command); stale.regional.local.cityId = 'missing-city';
  assert.equal(applyDirectorTick(state, stale).ok, false); assert.equal(JSON.stringify(state), before);
  const result = applyDirectorTick(state, command); assert.equal(result.ok, true, result.error); assert.ok(isWorldState(result.state));
  assert.deepEqual(result.events.find(event => event.regionalEvent)?.regionalEvent?.selection, action.regional);
  assert.equal(applyDirectorTick(result.state, { ...command, expectedRevision: result.state.revision }).ok, false);
  const old = world(prior); const oldAction = legalActions(old, 5, epoch).map(option => option.action).find(option => option.type === 'event' && option.event === action.event && option.target === action.target);
  assert.ok(oldAction?.type === 'event'); assert.equal(Object.hasOwn(oldAction, 'regional'), false);
  assert.equal(applyDirectorTick(old, { ...missing, expectedRevision: old.revision }).ok, true);
  assert.equal(applyDirectorTick(old, { ...command, expectedRevision: old.revision }).ok, false);
});

void test('explicit local target remains pinned instead of being replaced by a fresh menu lottery', () => {
  const state = world();
  const option = legalActions(state, 5, epoch).map(option => option.action).find(action => action.type === 'event' && action.regional && historicalEventCandidates(state, action.event, action.target).flatMap(group => group.locals).length > 1);
  assert.ok(option?.type === 'event' && option.regional);
  const local = historicalEventCandidates(state, option.event, option.target).flatMap(group => group.locals).find(local => JSON.stringify(local) !== JSON.stringify(option.regional?.local)); assert.ok(local);
  const pinned = { ...option, regional: { ...option.regional, local: structuredClone(local) } };
  const result = applyCommand(state, { expectedRevision: state.revision, seat: 5, action: pinned, timestamp: epoch });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.events.find(event => event.regionalEvent)?.regionalEvent?.selection.local, local);
});

void test('local target payload does not change the legacy family/civilization Director lottery', () => {
  const old = world(prior); const current = world();
  const family = (action: GameAction | null) => action?.type === 'event' ? { type: action.type, event: action.event, target: action.target } : action;
  for (let index = 0; index < 64; index++) {
    const memory = createBehaviorMemory(old, 5); memory.decisionCount = index;
    const before = JSON.stringify([old, current, memory]);
    assert.deepEqual(family(chooseDirectorBehavior(current, memory, epoch).action), family(chooseDirectorBehavior(old, memory, epoch).action), `decision ${index}`);
    assert.equal(JSON.stringify([old, current, memory]), before);
  }
});

void test('local CLI persists exact selectors, duplicate identity and deterministic replay', () => {
  const directory = mkdtempSync(join(tmpdir(), 'regional-cli-')); const path = join(directory, 'world.json'); const store = new GameStore(path);
  try {
    assert.equal(store.initialize(1701, false, epoch).ok, true);
    for (const release of RELEASES) {
      const state = store.snapshot().state; if (!release.compatibleFrom.includes(state.releaseId)) continue;
      const reply = store.authoredTransition({ expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, timestamp: epoch, model: 'synthetic-release-fixture', commandId: release.id }, 'release-apply');
      assert.equal(reply.ok, true, reply.error); if (release.id === latest) break;
    }
    const state = store.snapshot().state; const command = { ...tick(state), model: 'synthetic-regional-fixture' };
    const reply = store.directorTick(command); assert.equal(reply.ok, true, reply.error);
    const committed = readFileSync(path, 'utf8'); assert.equal(store.directorTick(command).duplicate, true); assert.equal(readFileSync(path, 'utf8'), committed);
    const altered = structuredClone(command); altered.regional.local.cityId = 'different-city';
    assert.equal(store.directorTick(altered).ok, false); assert.equal(readFileSync(path, 'utf8'), committed);
    const replay = store.replay(); let replayed = replay.initial;
    for (const transition of replay.timeline) {
      let result;
      if (transition.kind === 'release-apply') result = applyRelease(replayed, transition.command);
      else { assert.equal(transition.kind, 'director-tick'); assert.ok(transition.kind === 'director-tick'); result = applyDirectorTick(replayed, transition.command); }
      assert.equal(result.ok, true, result.error); replayed = result.state;
    }
    assert.deepEqual(replayed, store.snapshot().state);
    assert.deepEqual(store.snapshot().state.events.findLast(event => event.regionalEvent)?.regionalEvent?.selection, command.regional);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

class Statement implements D1Statement {
  readonly database: DatabaseSync; readonly sql: string; values: SqlValue[] = [];
  constructor(database: DatabaseSync, sql: string) { this.database = database; this.sql = sql; }
  bind(...values: SqlValue[]) { this.values = values; return this; }
  async all(): Promise<D1Result> { return { results: this.database.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  execute(): D1Result { return { results: [], meta: { changes: Number(this.database.prepare(this.sql).run(...this.values).changes) } }; }
  async run() { return this.execute(); }
}
class Database implements D1Database {
  readonly sql = new DatabaseSync(':memory:');
  prepare(sql: string) { return new Statement(this.sql, sql); }
  async batch(statements: D1Statement[]) {
    this.sql.exec('BEGIN');
    try { const results = statements.map(statement => { assert.ok(statement instanceof Statement); return statement.execute(); }); this.sql.exec('COMMIT'); return results; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}

async function hostedWorld() {
  const database = new Database(); const store = new WorldRepository(database);
  for (const migration of ['0000_world', '0001_autonomous_policy']) database.sql.exec(readFileSync(new URL(`../server/migrations/${migration}.sql`, import.meta.url), 'utf8'));
  await store.initialize({ seed: 1701, clockEpoch: epoch, commandId: 'regional-init' }, 'fixture-owner', epoch);
  for (const release of RELEASES) {
    const snapshot = await store.read(); assert.ok(snapshot); const state = snapshot.state;
    if (!release.compatibleFrom.includes(state.releaseId)) continue;
    await store.mutate('release-apply', { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, timestamp: epoch, model: 'synthetic-release-fixture', commandId: release.id }, 'fixture-owner', epoch);
    if (release.id === latest) break;
  }
  const snapshot = await store.read(); assert.ok(snapshot); const state = snapshot.state;
  return { database, store, state };
}

void test('host tick and public recorded history preserve selectors and reject same-ID retargeting', async () => {
  const { database, store, state } = await hostedWorld();
  try {
    const command = { ...tick(state), model: 'synthetic-regional-fixture' };
    const reply = await store.mutate('director-tick', command, 'fixture-owner', epoch); assert.equal(reply.ok, true);
    assert.equal((await store.mutate('director-tick', command, 'fixture-owner', epoch)).duplicate, true);
    const altered = structuredClone(command); altered.regional.local.cityId = 'other-city';
    await assert.rejects(store.mutate('director-tick', altered, 'fixture-owner', epoch), { message: 'idempotency_key_reused' });
    const page = await store.boundedChronicle({ format: RECORDED_CHOICES_FORMAT, after: state.revision, through: state.revision + 1, limit: 1 });
    assert.equal(page.entries.length, 1); assert.deepEqual(page.entries[0]?.events.find(event => event.regionalEvent)?.regionalEvent?.selection, command.regional);
    const entry = page.entries[0]; assert.ok(entry?.kind === 'director-tick');
    const row = database.sql.prepare('SELECT transition_json FROM world_transitions WHERE end_revision=?').get(state.revision + 1);
    assert.ok(row && typeof row.transition_json === 'string'); assert.deepEqual(JSON.parse(row.transition_json).command.regional, command.regional);
    const current = await store.read(); assert.ok(current && isWorldState(current.state));
  } finally { database.sql.close(); }
});

for (const kind of ['action', 'director-tick'] as const) void test(`host ${kind} joins exact command, selector and single regional receipt in page and detail`, async () => {
  const { database, store, state } = await hostedWorld();
  try {
    const action = selected(state);
    const input = kind === 'action'
      ? { expectedRevision: state.revision, seat: 5, action, model: 'synthetic-regional-fixture', commandId: 'regional-action' }
      : { ...tick(state, action), model: 'synthetic-regional-fixture' };
    const reply = await store.mutate(kind, input, 'fixture-owner', epoch); assert.equal(reply.ok, true);
    assert.equal((await store.mutate(kind, input, 'fixture-owner', epoch)).duplicate, true);
    const changed = structuredClone(input);
    if ('action' in changed && changed.action) changed.action.regional.local.cityId = 'different-city';
    else { assert.ok('regional' in changed && changed.regional); changed.regional.local.cityId = 'different-city'; }
    await assert.rejects(store.mutate(kind, changed, 'fixture-owner', epoch), { message: 'idempotency_key_reused' });
    const end = state.revision + 1;
    const pageInput = { format: RECORDED_CHOICES_FORMAT, after: state.revision, through: end, limit: 1 };
    const detailInput = { format: RECORDED_CHOICES_FORMAT, endRevision: end, civilizationId: action.target, cityId: action.regional.local.cityId };
    const page = await store.boundedChronicle(pageInput); const detail = await store.recordedChoiceDetail(detailInput);
    assert.equal(page.entries.length, 1); assert.ok(detail);
    assert.deepEqual(page.entries[0]?.events.find(event => event.regionalEvent)?.regionalEvent?.selection, action.regional);
    if (kind === 'action') assert.deepEqual(page.entries[0]?.action, action);
    const saved = database.sql.prepare('SELECT transition_json, events_json FROM world_transitions WHERE end_revision=?').get(end);
    assert.ok(saved && typeof saved.transition_json === 'string' && typeof saved.events_json === 'string');
    const mutations = ['selector', 'civilization', 'family', 'missing-receipt', 'orphan-receipt', 'duplicate-receipt'] as const;
    for (const mutation of mutations) {
      const transition: unknown = JSON.parse(saved.transition_json); const rawEvents: unknown = JSON.parse(saved.events_json);
      assert.ok(isRecord(transition) && isRecord(transition.command) && Array.isArray(rawEvents));
      const command = kind === 'action' ? transition.command.action : transition.command; assert.ok(isRecord(command));
      const selection = command.regional; assert.ok(isRecord(selection) && isRecord(selection.local));
      const event = rawEvents.find(value => isGameEvent(value) && value.regionalEvent); assert.ok(isGameEvent(event) && event.regionalEvent);
      if (mutation === 'selector') {
        const oldCity = selection.local.cityId; selection.local.cityId = 'different-city';
        if (isRecord(selection.local.route)) {
          if (selection.local.route.fromCityId === oldCity) selection.local.route.fromCityId = 'different-city';
          if (selection.local.route.toCityId === oldCity) selection.local.route.toCityId = 'different-city';
        }
      }
      if (mutation === 'civilization') command.target = (action.target + 1) % 5;
      if (mutation === 'family') {
        const family = action.event === 'cultivated-harvest' ? 'forest-fire' : 'cultivated-harvest';
        command.event = family;
        const common = { kind: family, cityId: action.regional.local.cityId, tileId: action.regional.local.tileId };
        command.regional = { ...selection, instanceId: historicalEventInstanceId(state.seed, family, action.target, action.regional.occurrence), local: family === 'forest-fire' ? { ...common, forestTileId: action.regional.local.tileId + 1 } : common };
      }
      if (mutation === 'missing-receipt') delete event.regionalEvent;
      if (mutation === 'orphan-receipt') delete command.regional;
      if (mutation === 'duplicate-receipt') {
        const duplicate = structuredClone(event); assert.ok(duplicate.regionalEvent);
        duplicate.id = `${end}:999`; duplicate.regionalEvent.eventId = duplicate.id;
        assert.ok(isGameEvent(duplicate)); rawEvents.push(duplicate);
      }
      assert.ok(rawEvents.every(isGameEvent), mutation);
      assert.ok(isGameAction(kind === 'action' ? command : { type: 'event', event: command.event, target: command.target, ...(command.regional === undefined ? {} : { regional: command.regional }) }), mutation);
      database.sql.prepare('UPDATE world_transitions SET transition_json=?, events_json=? WHERE end_revision=?').run(JSON.stringify(transition), JSON.stringify(rawEvents), end);
      await assert.rejects(store.boundedChronicle(pageInput), { message: 'corrupt_history' }, mutation);
      await assert.rejects(store.recordedChoiceDetail(detailInput), { message: 'corrupt_history' }, mutation);
      database.sql.prepare('UPDATE world_transitions SET transition_json=?, events_json=? WHERE end_revision=?').run(saved.transition_json, saved.events_json, end);
    }
    assert.deepEqual(await store.boundedChronicle(pageInput), page);
    assert.deepEqual(await store.recordedChoiceDetail(detailInput), detail);
  } finally { database.sql.close(); }
});
