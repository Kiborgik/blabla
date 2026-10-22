import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyCommand, applyRelease, catchUpStrategy, createWorld } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { RELEASES } from '../core/release.ts';
import { isGameEvent, isWorldState } from '../core/validation.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { GameStore } from '../cli/store.ts';
import { RECORDED_CHOICES_FORMAT } from '../server/public-protocol.ts';
import { WorldRepository, type D1Database, type D1Statement, type D1Result, type SqlValue } from '../server/repository.ts';
import { isRecord } from '../server/validation.ts';
import { eventLogEntries } from '../web/event-log.ts';
import { storyLanguage } from '../web/story-language.ts';

const epoch = '2026-10-22T00:00:00.000Z';
const latest = 'settlement-regional-targets-1';
const time = (milliseconds: number) => new Date(Date.parse(epoch) + milliseconds).toISOString();

function syntheticInitial(): WorldState {
  let state = createWorld(1701, epoch);
  for (const release of RELEASES) {
    if (!release.compatibleFrom.includes(state.releaseId)) continue;
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, timestamp: epoch });
    assert.ok(result.ok, result.error); state = result.state;
    if (state.releaseId === latest) break;
  }
  state.revision = 0; state.events = []; state.eventCounts = {};
  state.cities.find(city => city.civId === 1)!.population = 10;
  state.cities.find(city => city.civId === 4)!.population = 30;
  state.civilizations[1]!.resources.food = 100; state.civilizations[1]!.resources.energy = 30;
  state.civilizations[4]!.resources.food = 0;
  assert.ok(isWorldState(state), 'explicitly synthetic zero-age stocks/populations, registered combined capabilities');
  return state;
}

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
    catch (failure) { this.sql.exec('ROLLBACK'); throw failure; }
  }
}

async function hosted() {
  const database = new Database(); const store = new WorldRepository(database);
  for (const migration of ['0000_world', '0001_autonomous_policy']) database.sql.exec(readFileSync(new URL(`../server/migrations/${migration}.sql`, import.meta.url), 'utf8'));
  await store.initialize({ seed: 1701, clockEpoch: epoch, commandId: 'synthetic-relief-init' }, 'fixture-owner', epoch);
  const initial = syntheticInitial();
  database.sql.prepare('UPDATE world_state SET initial_json=?, state_json=?').run(JSON.stringify(initial), JSON.stringify(initial));
  const state = async () => { const snapshot = await store.read(); assert.ok(snapshot); return snapshot.state; };
  const action = async (seat: number, value: GameAction, id: string, at = epoch) => {
    const before = await state(); const input = { seat, action: value, expectedRevision: before.revision, model: 'synthetic-relief-integration', commandId: id };
    const reply = await store.mutate('action', input, 'fixture-owner', at); assert.ok(reply.ok); return { input, reply, at };
  };
  return { database, store, state, action };
}

function proposal(state: WorldState): GameAction {
  const route = state.routes.find(candidate => candidate.agreement?.enabled && candidate.owner === 1 && candidate.partner === 4); assert.ok(route);
  return { type: 'propose-relief', routeId: route.id, sourceCityId: route.from, recipientCityId: route.to };
}

async function paidCorridor(fixture: Awaited<ReturnType<typeof hosted>>) {
  await fixture.action(1, { type: 'propose-trade', partner: 4, recipeId: 'harvest-for-materials', sourceCityId: 'city-1', recipientCityId: 'city-4' }, 'trade-offer');
  const offer = (await fixture.state()).tradeOffers?.at(-1); assert.ok(offer);
  await fixture.action(4, { type: 'respond-trade', offerId: offer.id, accept: true }, 'trade-consent');
}

void test('combined generated genesis explicitly enables relief and exact regional targeting without changing prior geneses', () => {
  const prior = createGeneratedWorld(73, epoch, 'settlement-living-partnerships-1'); const saved = JSON.stringify(prior);
  const current = createGeneratedWorld(73, epoch, latest);
  assert.equal(current.origin?.initialReleaseId, latest);
  assert.ok(current.unlockedFeatures.includes('consented-relief') && current.unlockedFeatures.includes('procedural-regional-targets'));
  assert.deepEqual(current.relief, { ruleVersion: 1, active: [], lastResults: [null, null, null, null, null] });
  assert.equal(prior.relief, undefined); assert.equal(JSON.stringify(prior), saved);
  assert.deepEqual(current.tiles, prior.tiles); assert.deepEqual(current.cities, prior.cities);
  assert.ok(isWorldState(current)); assert.ok(isWorldState(JSON.parse(saved)));
  for (const value of ['unknown-release', 1, {}, null]) {
    const malformed = JSON.parse(JSON.stringify(current)); malformed.origin.initialReleaseId = value;
    assert.equal(isWorldState(malformed), false);
  }
});

void test('real hosted consent, later ordinary economy and immutable conserved relief receipts survive duplicate reads and restart', async () => {
  const fixture = await hosted(); const { database, store, state, action } = fixture;
  try {
    await paidCorridor(fixture);
    const offered = await action(1, proposal(await state()), 'relief-offer', time(10_000));
    const proposed = (await state()).relief?.active[0]; assert.ok(proposed?.status === 'proposed');
    const proposalState = await state(); const proposalEvent = proposalState.events.findLast(event => event.type === 'relief-proposed'); assert.ok(proposalEvent);
    const proposalEntry = eventLogEntries([proposalEvent], { civilizations: proposalState.civilizations })[0]; assert.ok(proposalEntry);
    assert.equal(proposalEntry.family, 'relief');
    const proposalStory = storyLanguage(proposalState, proposalEvent, proposalEntry);
    assert.match(proposalStory.title, /offered Food relief/); assert.match(proposalStory.cause, /when this offer was made/);
    assert.match(proposalStory.consequence, /No aid was delivered/);
    assert.equal((await store.mutate('action', offered.input, 'fixture-owner', offered.at)).duplicate, true);
    const consented = await action(4, { type: 'respond-relief', charterId: proposed.id, accept: true }, 'relief-consent', time(10_000));
    const accepted = (await state()).relief?.active[0]; assert.ok(accepted?.status === 'accepted');
    assert.deepEqual(accepted.terms, proposed.terms);
    const before = await state();
    const acceptanceEvent = before.events.findLast(event => event.type === 'relief-accepted'); assert.ok(acceptanceEvent);
    const acceptanceEntry = eventLogEntries([acceptanceEvent], { civilizations: before.civilizations })[0]; assert.ok(acceptanceEntry);
    const acceptanceStory = storyLanguage(before, acceptanceEvent, acceptanceEntry);
    assert.ok(acceptanceStory.consequence.includes(`scheduled for round ${accepted.dueRound}`));
    assert.match(acceptanceStory.consequence, /No aid was delivered/);
    const input = { expectedRevision: before.revision, commandId: 'due-relief', timestamp: time(accepted.dueRound * 60_000) };
    const due = await store.mutate('strategy-catchup', input, 'fixture-owner', input.timestamp); assert.ok(due.ok);
    const final = await state(); const result = final.relief?.lastResults[1]; assert.ok(result?.outcome === 'delivered');
    assert.equal(result.deliveredFood, accepted.terms.food);
    assert.equal(result.before.donorFood - result.after.donorFood, accepted.terms.food);
    assert.equal(result.after.recipientFood - result.before.recipientFood, accepted.terms.food);
    assert.equal(result.before.donorEnergy - result.after.donorEnergy, 1);
    assert.deepEqual(result.charter, accepted); assert.ok(isWorldState(final));
    const deliveredEvent = final.events.find(event => event.id === result.eventId); assert.ok(deliveredEvent);
    const deliveredEntry = eventLogEntries([deliveredEvent], { civilizations: final.civilizations })[0]; assert.ok(deliveredEntry);
    const deliveredStory = storyLanguage(final, deliveredEvent, deliveredEntry);
    assert.ok(deliveredStory.title.includes(final.civilizations[1]!.name) && deliveredStory.title.includes(final.civilizations[4]!.name));
    assert.ok(deliveredStory.consequence.startsWith(`${result.deliveredFood} Food moved from`));
    assert.match(deliveredStory.consequence, /civilization reserves.*1 Energy consumed/);
    assert.ok(!/city-|relief-\d|in \d+ rounds|pantry/.test(JSON.stringify(deliveredStory)));
    assert.equal(deliveredEntry.detail, accepted.id); assert.deepEqual(deliveredEntry.effects, deliveredEvent.effects);
    assert.deepEqual(storyLanguage(final, acceptanceEvent, acceptanceEntry), acceptanceStory);
    const frozen = JSON.stringify(final);
    assert.equal((await store.mutate('strategy-catchup', input, 'fixture-owner', input.timestamp)).duplicate, true);
    assert.equal((await store.mutate('action', consented.input, 'fixture-owner', consented.at)).duplicate, true);
    assert.equal(JSON.stringify(await state()), frozen);
    const restarted = new WorldRepository(database); assert.deepEqual((await restarted.read())?.state, JSON.parse(frozen));
    const page = await restarted.boundedChronicle({ format: RECORDED_CHOICES_FORMAT, after: before.revision, through: final.revision });
    assert.deepEqual(page.entries.flatMap(entry => entry.events).find(event => event.reliefResult)?.reliefResult, result);
    const detail = await restarted.recordedChoiceDetail({ format: RECORDED_CHOICES_FORMAT, endRevision: final.revision, civilizationId: 4, cityId: 'city-4' }); assert.ok(detail.entry);
    assert.deepEqual(detail.entry.events.find(event => event.reliefResult)?.reliefResult, result);
  } finally { database.sql.close(); }
});

for (const outcome of ['declined', 'withdrawn'] as const) void test(`hosted ${outcome} remains zero-effect and public history binds the exact consent action`, async () => {
  const fixture = await hosted(); const { database, store, state, action } = fixture;
  try {
    await paidCorridor(fixture); await action(1, proposal(await state()), 'relief-offer', time(10_000));
    const charter = (await state()).relief?.active[0]; assert.ok(charter);
    const terminal: GameAction = outcome === 'declined' ? { type: 'respond-relief', charterId: charter.id, accept: false } : { type: 'withdraw-relief', charterId: charter.id };
    const seat = outcome === 'declined' ? 4 : 1;
    const before = await state(); await action(seat, terminal, `relief-${outcome}`, time(20_000));
    const final = await state(); const result = final.relief?.lastResults[1]; assert.ok(result?.outcome === outcome);
    assert.deepEqual(final.civilizations.map(civ => civ.resources), before.civilizations.map(civ => civ.resources));
    assert.deepEqual(result.before, result.after); assert.equal(result.deliveredFood, 0);
    const terminalEvent = final.events.find(event => event.id === result.eventId); assert.ok(terminalEvent);
    const terminalEntry = eventLogEntries([terminalEvent], { civilizations: final.civilizations })[0]; assert.ok(terminalEntry);
    const terminalStory = storyLanguage(final, terminalEvent, terminalEntry);
    assert.match(terminalStory.consequence, /No aid was delivered/);
    assert.match(terminalStory.consequence, /This charter charged no supplies or penalty/);
    assert.ok(!terminalStory.consequence.includes('resources were unchanged'));
    const query = { format: RECORDED_CHOICES_FORMAT, after: before.revision, through: final.revision };
    assert.deepEqual((await store.boundedChronicle(query)).entries[0]?.events.find(event => event.reliefResult)?.reliefResult, result);
    const row = database.sql.prepare('SELECT transition_json, events_json FROM world_transitions WHERE end_revision=?').get(final.revision);
    assert.ok(row && typeof row.transition_json === 'string' && typeof row.events_json === 'string');
    const changed: unknown = JSON.parse(row.transition_json); assert.ok(isRecord(changed) && isRecord(changed.command) && isRecord(changed.command.action));
    changed.command.action.charterId = 'relief-1-999';
    database.sql.prepare('UPDATE world_transitions SET transition_json=? WHERE end_revision=?').run(JSON.stringify(changed), final.revision);
    await assert.rejects(store.boundedChronicle(query), { message: 'corrupt_history' });
    database.sql.prepare('UPDATE world_transitions SET transition_json=? WHERE end_revision=?').run(row.transition_json, final.revision);
    const malformed: unknown = JSON.parse(row.events_json); assert.ok(Array.isArray(malformed));
    const event = malformed.find(value => isGameEvent(value) && value.reliefResult); assert.ok(isGameEvent(event) && event.reliefResult);
    event.reliefResult.after.recipientFood += 1; assert.equal(isGameEvent(event), false);
    database.sql.prepare('UPDATE world_transitions SET events_json=? WHERE end_revision=?').run(JSON.stringify(malformed), final.revision);
    await assert.rejects(store.boundedChronicle(query), { message: 'corrupt_history' });
    database.sql.prepare('UPDATE world_transitions SET events_json=? WHERE end_revision=?').run(row.events_json, final.revision);
    assert.equal((await store.boundedChronicle(query)).entries.length, 1);
  } finally { database.sql.close(); }
});

void test('durable CLI relief commands use fresh process state and replay the exact paid outcome from a labelled synthetic genesis', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relief-integration-')); const path = join(directory, 'world.json');
  try {
    const store = new GameStore(path); store.initialize(1701, false, epoch);
    const campaign = store.snapshot(); const initial = syntheticInitial(); campaign.initial = structuredClone(initial); campaign.state = structuredClone(initial);
    writeFileSync(path, JSON.stringify(campaign));
    const submit = (seat: number, action: GameAction, id: string, at: string) => {
      const current = new GameStore(path); const input = { seat, action, expectedRevision: current.snapshot().state.revision, model: 'synthetic-cli-relief', commandId: id, timestamp: at };
      const reply = current.submit(input); assert.ok(reply.ok, reply.error); return input;
    };
    submit(1, { type: 'propose-trade', partner: 4, recipeId: 'harvest-for-materials', sourceCityId: 'city-1', recipientCityId: 'city-4' }, 'trade-offer', epoch);
    const offer = store.snapshot().state.tradeOffers?.at(-1); assert.ok(offer);
    submit(4, { type: 'respond-trade', offerId: offer.id, accept: true }, 'trade-consent', epoch);
    const proposed = submit(1, proposal(store.snapshot().state), 'relief-offer', time(10_000));
    const charter = store.snapshot().state.relief?.active[0]; assert.ok(charter);
    submit(4, { type: 'respond-relief', charterId: charter.id, accept: true }, 'relief-consent', time(10_000));
    const accepted = store.snapshot().state.relief?.active[0]; assert.ok(accepted?.status === 'accepted');
    const due = { expectedRevision: store.snapshot().state.revision, commandId: 'due-relief', timestamp: time(accepted.dueRound * 60_000) };
    assert.ok(new GameStore(path).strategyCatchUp(due).ok);
    const completed = store.snapshot(); assert.equal(completed.state.relief?.lastResults[1]?.outcome, 'delivered');
    const bytes = readFileSync(path, 'utf8'); assert.equal(new GameStore(path).submit(proposed).duplicate, true); assert.equal(readFileSync(path, 'utf8'), bytes);
    let replay = structuredClone(completed.initial);
    for (const transition of completed.timeline) {
      if (transition.kind === 'action') { const result = applyCommand(replay, transition.command); assert.ok(result.ok, result.error); replay = result.state; }
      else { assert.equal(transition.kind, 'strategy-catchup'); assert.ok('timestamp' in transition); const result = catchUpStrategy(replay, transition.timestamp); assert.ok(result.ok, result.error); replay = result.state; }
    }
    assert.deepEqual(replay, completed.state); assert.ok(isWorldState(replay));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
