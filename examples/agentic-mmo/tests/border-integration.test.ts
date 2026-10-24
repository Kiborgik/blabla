import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESOURCE_IDS, SPACEFLIGHT_RULES } from '../core/content.ts';
import { isGameAction } from '../core/planning.ts';
import type { GameAction, GameEvent, Resources, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { availableBorderActions, borderFieldPopulation } from '../core/simulation/border-incidents.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { allocateOperations, emitOperations } from '../core/simulation/operations.ts';
import { recordLocalPower } from '../core/simulation/local-power.ts';
import { launchMarsMission, resolveSpaceflight } from '../core/simulation/spaceflight.ts';
import { readBoundedChronicle } from '../server/recorded-choices.ts';
import { RECORDED_CHOICES_FORMAT } from '../server/public-protocol.ts';
import type { D1Database, D1Statement } from '../server/repository.ts';
import { projectAcquiredLand, selectedAcquiredLand } from '../visuals/territory-visuals.ts';
import { borderClashCues } from '../visuals/border-visuals.ts';
import { projectWorld } from '../web/live-world.ts';
import { civilizationSummary } from '../web/spectator-hud.ts';
import { createCueStream } from '../web/world-cues.ts';
import { ACTIVE_LOCAL_RELEASE_ID, LOCAL_SIMULATION_STORAGE_KEY, createLocalSimulation, parseLocalSimulation } from '../web/local-simulation.ts';
import { borderAction, borderBeat, borderTargetTileId, borderTimestamp, dispatchBorder, syntheticBorderCorridor } from './fixtures/border-current.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';

function recordedDatabase(events: GameEvent[], action: GameAction, start: number, end: number, timestamp: string): D1Database {
  const row = { start_revision: start, end_revision: end,
    transition_json: JSON.stringify({ kind: 'action', command: { seat: 0, expectedRevision: start, action, timestamp } }),
    provenance_json: JSON.stringify({ kind: 'development-agent', model: 'synthetic-current-record', seat: 0, commandId: 'synthetic-border-row', recordedAt: timestamp }),
    events_json: JSON.stringify(events) };
  return { prepare(sql): D1Statement { return { bind() { return this; }, async all() { return { results: sql.startsWith('SELECT revision') ? [{ revision: end }] : sql.includes('detail_bytes') ? [{ end_revision: end, detail_bytes: Buffer.byteLength(JSON.stringify(row)) }] : [row], meta: { changes: 0 } }; }, async run() { throw new Error('Read-only synthetic row'); } }; }, async batch() { throw new Error('Read-only synthetic row'); } };
}

void test('fresh current genesis includes border state and exact restart without migration actions', () => {
  const initial = createLocalSimulation(73);
  assert.equal(initial.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.match(LOCAL_SIMULATION_STORAGE_KEY, /^civitas:procedural-observatory:/);
  assert.ok(initial.state.unlockedFeatures.includes('supplied-borders'));
  assert.deepEqual(initial.state.border?.active, []);
  assert.deepEqual(parseLocalSimulation(JSON.parse(JSON.stringify(initial))), initial);
  assert.equal(isGameAction({ type: 'dispatch-border', sourceCityId: 'city-0', tileId: 30, people: 2 }), true);
  assert.equal(isGameAction({ type: 'dispatch-border', sourceCityId: 'city-0', tileId: 30, people: 4 }), false);
  assert.equal(isGameAction({ type: 'release-apply', releaseId: ACTIVE_LOCAL_RELEASE_ID }), false);
});

void test('actual departures keep living people visible while town geometry remains settled and capture has separate control', () => {
  const state = syntheticBorderCorridor(); const purchased = structuredClone(state.tileAcquisitions![String(borderTargetTileId(state))]);
  dispatchBorder(state);
  assert.equal(borderFieldPopulation(state, 0), 2);
  assert.equal(projectWorld(state).cities.find(city => city.id === 0)?.population, 4);
  assert.match(civilizationSummary(state, 0), /6 people · 2 away/);
  assert.equal(projectWorld(state).borderIncidents?.length, 1);
  for (let beat = 0; beat < 8; beat++) borderBeat(state);
  assert.deepEqual(state.tileAcquisitions![String(borderTargetTileId(state))], purchased);
  const land = projectAcquiredLand(state); const captured = land.find(plot => plot.receipt.tileId === borderTargetTileId(state))!;
  assert.equal(captured.receipt.civId, 1); assert.equal(captured.control?.civId, 0);
  assert.ok(selectedAcquiredLand(land, 'city-0').includes(captured));
  assert.equal(selectedAcquiredLand(land, 'city-1').includes(captured), false);
});

void test('current recorded departure binds exact action and payment receipt and rejects edited action', async () => {
  const state = syntheticBorderCorridor(); const option = availableBorderActions(state, 0).find(option => option.action.type === 'dispatch-border' && option.action.people === 2)!;
  assert.ok(option && option.action.type === 'dispatch-border');
  const action = option.action; const start = state.revision; const timestamp = borderTimestamp(state, 0);
  const events = borderAction(state, 0, action);
  const page = await readBoundedChronicle(recordedDatabase(events, action, start, state.revision, timestamp), 'synthetic-border', { format: RECORDED_CHOICES_FORMAT });
  assert.deepEqual(page.entries[0]?.action, action);
  await assert.rejects(readBoundedChronicle(recordedDatabase(events, { ...action, people: 3 }, start, state.revision, timestamp), 'synthetic-border', { format: RECORDED_CHOICES_FORMAT }), /corrupt_history/);
});

void test('only a new exact recorded clash creates one pulse and baseline history never replays it', () => {
  const state = syntheticBorderCorridor(); const id = dispatchBorder(state, 3).id;
  borderAction(state, 1, { type: 'respond-border', incidentId: id, response: 'defend', sourceCityId: 'city-1', people: 2 });
  const stream = createCueStream();
  const observe = () => stream.observe({ identity: 'controlled-current', revision: state.revision, mode: 'live', events: state.events, routes: projectWorld(state).routes, clashes: borderClashCues(state) }, 3);
  assert.equal(observe().events.length, 0);
  for (let beat = 0; beat < 4; beat++) { borderBeat(state); assert.equal(observe().events.some(event => event.eventId === state.border!.active[0]!.resolution?.eventId), false); }
  borderBeat(state);
  const clash = borderClashCues(state); assert.equal(clash.length, 1);
  assert.equal(observe().events.filter(event => event.eventId === clash[0]!.eventId).length, 1);
  assert.equal(observe().events.length, 0);
});

function paidMarsPreparation(): WorldState {
  const state = syntheticBorderCorridor(); const city = state.cities[0]!; const civ = state.civilizations[0]!;
  syntheticTechnologies(state, 0, ['spaceflight']); civ.era = 5; city.population = 15;
  civ.resources = Object.fromEntries(RESOURCE_IDS.map(resource => [resource, 1000])) as Resources; civ.strategicResources = { coal: 60 };
  syntheticInstitution(state, city.id, 'industrial-zone'); syntheticInstitution(state, city.id, 'coal-plant'); syntheticInstitution(state, city.id, 'launchpad');
  state.revision++; const operations: GameEvent[] = []; allocateOperations(state); emitOperations(state, city, operations); recordLocalPower(state, city, operations); commitEvents(state, operations);
  assert.ok(isWorldState(state), 'Explicit synthetic technologies, stocks and launch installations remain canonical');
  state.revision++; const events: GameEvent[] = []; launchMarsMission(state, 0, { type: 'expedition', cityId: city.id, mission: 'settle' }, events); commitEvents(state, events);
  assert.ok(isWorldState(state), 'Actual paid launch and conserved population validate');
  for (let count = 0; count < 16 && state.civilizations[0]!.marsSupplyStreak < 2; count++) {
    borderBeat(state);
    if (state.spaceflight!.civilizations[0]!.colony && state.spaceflight!.civilizations[0]!.missionsLaunched === 1) {
      state.revision++; const resupply: GameEvent[] = [];
      launchMarsMission(state, 0, { type: 'expedition', cityId: city.id, mission: 'resupply' }, resupply); commitEvents(state, resupply);
      assert.ok(isWorldState(state), 'Real paid resupply and its still-in-transit cargo validate');
    }
  }
  assert.equal(state.civilizations[0]!.marsSupplyStreak, 2); assert.equal(state.outcome, null);
  return state;
}

void test('real paid Mars candidate waits for finite physical returns and rechecks the current supplied season', () => {
  const state = paidMarsPreparation(); const opened = state.round; dispatchBorder(state);
  borderBeat(state); assert.equal(state.outcome, null); assert.ok(state.border?.draining);
  assert.deepEqual(state.border.draining.candidate.winners, [0]);
  assert.equal(availableBorderActions(state, 2).some(option => option.action.type === 'dispatch-border'), false);
  const restarted = JSON.parse(JSON.stringify(state)) as WorldState; assert.ok(isWorldState(restarted));
  for (let count = 0; count < 8 && state.border!.active.length; count++) { borderBeat(state); borderBeat(restarted); assert.deepEqual(restarted, state); }
  assert.equal(state.round, opened + 8); assert.equal(state.border!.active.length, 0); assert.equal(state.border!.draining, null);
  const finalOutcome = ((world: WorldState) => world.outcome)(state);
  assert.equal(finalOutcome?.kind, 'mars'); assert.equal(finalOutcome?.round, state.round);
  assert.equal(state.spaceflight!.civilizations[0]!.lastUpkeep?.round, state.round); assert.equal(state.spaceflight!.civilizations[0]!.lastUpkeep?.status, 'supplied');
  assert.equal(state.civilizations[0]!.marsProgress, SPACEFLIGHT_RULES.habitat.requiredWork);
});

void test('isolated drain resolver discards a synthetic stale candidate rather than manufacturing a winner', () => {
  const state = syntheticBorderCorridor(); state.border!.draining = { round: state.round, candidate: { kind: 'mars', winners: [0], round: state.round, reason: 'Synthetic stale candidate for resolver-only test' } };
  assert.equal(isWorldState(state), false, 'This isolated malformed input is not a valid persisted checkpoint');
  state.revision++; const events: GameEvent[] = []; resolveSpaceflight(state, events); commitEvents(state, events);
  assert.equal(state.outcome, null); assert.equal(state.border!.draining, null);
  assert.equal(events.some(event => event.type === 'outcome-drain-ended'), true);
  assert.ok(isWorldState(state));
});
