import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBorderAction } from '../core/border-validation.ts';

void test('current Border action admission accepts only exact bounded command shapes', () => {
  const actions = [
    { type: 'dispatch-border', sourceCityId: 'city-0', tileId: 12, people: 2 },
    { type: 'respond-border', incidentId: 'border-0-1', response: 'defend', sourceCityId: 'city-1', people: 3 },
    { type: 'respond-border', incidentId: 'border-0-1', response: 'yield' },
    { type: 'withdraw-border', incidentId: 'border-0-1' },
  ];
  for (const action of actions) {
    assert.ok(isBorderAction(action));
    assert.equal(isBorderAction({ ...action, ignored: true }), false);
    for (const key of Object.keys(action)) {
      const missing = { ...action } as Record<string, unknown>;
      delete missing[key];
      assert.equal(isBorderAction(missing), false, key);
    }
  }
  for (const invalid of [null, [], {}, { ...actions[0], people: 1 }, { ...actions[0], people: 4 }, { ...actions[0], people: 2.5 },
    { ...actions[0], tileId: NaN }, { ...actions[0], tileId: Infinity }, { ...actions[0], tileId: -1 }, { ...actions[0], tileId: Number.MAX_SAFE_INTEGER + 1 },
    { ...actions[0], sourceCityId: ' ' }, { ...actions[0], sourceCityId: 'x'.repeat(129) }, { ...actions[1], response: 'attack' },
    { ...actions[2], sourceCityId: 'city-1' }, { ...actions[3], incidentId: 'border-5-1' }, { ...actions[3], incidentId: 'border-0-0' },
    { ...actions[3], incidentId: 'border-0-01' }, { ...actions[3], incidentId: 'border-0-9007199254740992' }]) assert.equal(isBorderAction(invalid), false);
});

import type { BorderIncident, BorderResult } from '../core/border-types.ts';
import { isBorderState, validBorderEvent } from '../core/border-validation.ts';
import { borderReturnReservations, resolveBorderIncidents } from '../core/simulation/border-incidents.ts';
import type { GameEvent, WorldState } from '../core/types.ts';
import { isGameEvent, isWorldState } from '../core/validation.ts';
import { borderAction, borderBeat, dispatchBorder, syntheticBorderCorridor, INITIATOR, DEFENDER } from './fixtures/border-current.ts';

function current(state: WorldState): BorderIncident {
  const incident = state.border!.active[0];
  assert.ok(incident);
  return incident;
}

function latest(state: WorldState): BorderResult {
  const result = state.border!.lastResults.at(-1);
  assert.ok(result);
  return result;
}

function rejected(state: WorldState, mutate: (copy: WorldState) => void, message: string): void {
  const copy = structuredClone(state);
  copy.events = [];
  mutate(copy);
  assert.equal(isBorderState(copy.border, copy), false, message);
}

function completed(defend = false): WorldState {
  const state = syntheticBorderCorridor();
  dispatchBorder(state);
  if (defend) borderAction(state, DEFENDER, { type: 'respond-border', incidentId: current(state).id, response: 'defend', sourceCityId: 'city-1', people: 3 });
  while (state.border!.active.length) borderBeat(state);
  assert.ok(isBorderState(state.border, state));
  assert.ok(isWorldState(state));
  return state;
}

void test('current Border state has closed bounded keys, dense arrays and exact departure prices without retained duplicate receipts', () => {
  const state = syntheticBorderCorridor();
  assert.ok(isBorderState(state.border, state));
  dispatchBorder(state);
  assert.ok(isBorderState(state.border, state));
  const mutations: Array<[string, (copy: WorldState) => void]> = [
    ['unknown state key', copy => { Object.assign(copy.border!, { oldSave: true }); }],
    ['sparse sequence array', copy => { delete copy.border!.sequences[0]; }],
    ['extra sequence cell', copy => { copy.border!.sequences.push(0); }],
    ['unbounded sequence', copy => { copy.border!.sequences[0] = Number.MAX_SAFE_INTEGER; }],
    ['unknown incident key', copy => { Object.assign(current(copy), { ignored: 1 }); }],
    ['fractional round', copy => { current(copy).openedRound += 0.5; }],
    ['unsafe revision', copy => { current(copy).openedRevision = Number.MAX_SAFE_INTEGER + 1; }],
    ['extended response deadline', copy => { current(copy).responseDeadlineRound++; }],
    ['extended resolution deadline', copy => { current(copy).resolveRound++; }],
    ['extended return deadline', copy => { current(copy).returnByRound++; }],
    ['forged people', copy => { current(copy).initiator.people++; }],
    ['free setup', copy => { current(copy).initiator.departure.setup.materials = 0; }],
    ['free cargo', copy => { current(copy).initiator.departure.cargo.food = 0; }],
    ['wrong total price', copy => { current(copy).initiator.departure.totalCost.credits++; }],
    ['free initiation legitimacy', copy => { current(copy).initiator.departure.legitimacyCost = 0; }],
    ['unpaid home reserve', copy => { current(copy).initiator.departure.householdReserve.food = 0; }],
    ['nonfinite promise', copy => { current(copy).initiator.departure.promised.food = Infinity; }],
    ['unsafe ordinary price', copy => { current(copy).initiator.departure.promised.food = Number.MAX_SAFE_INTEGER; }],
    ['fractional strategic promise', copy => { current(copy).initiator.departure.promisedStrategic.iron = 0.1; }],
    ['unknown resource', copy => { Object.assign(current(copy).initiator.departure.promised, { crystals: 1 }); }],
    ['unsafe promise horizon', copy => { current(copy).initiator.departure.promiseHorizon = Number.MAX_SAFE_INTEGER; }],
    ['unconserved source residents', copy => { current(copy).initiator.departure.sourcePopulationAfter++; }],
    ['nonadjacent route', copy => { current(copy).initiator.departure.pathTileIds[1] = copy.tiles.at(-1)!.id; }],
    ['duplicate route tile', copy => { current(copy).initiator.departure.pathTileIds[1] = current(copy).initiator.departure.sourceTileId; }],
    ['wrong original purchase', copy => { current(copy).purchaseId = 'territory-999'; current(copy).initiator.departure.purchaseId = 'territory-999'; }],
    ['duplicate active participants', copy => { copy.border!.active.push(structuredClone(current(copy))); }],
    ['unreserved returning housing', copy => { copy.cities.find(city => city.id === 'city-0')!.population = 100; }],
  ];
  for (const [name, mutate] of mutations) rejected(state, mutate, name);
});

void test('field receipts prove every actual adjacent movement, living meal, phase and bounded round', () => {
  const state = syntheticBorderCorridor();
  dispatchBorder(state);
  borderBeat(state);
  assert.ok(isBorderState(state.border, state));
  for (const [name, mutate] of [
    ['missing beat', (copy: WorldState) => { current(copy).initiator.steps = []; }],
    ['duplicate beat', (copy: WorldState) => { current(copy).initiator.steps.push(structuredClone(current(copy).initiator.steps[0]!)); }],
    ['future beat', (copy: WorldState) => { current(copy).initiator.steps[0]!.round++; }],
    ['teleport', (copy: WorldState) => { current(copy).initiator.steps[0]!.toTileId = current(copy).tileId; }],
    ['unearned holding phase', (copy: WorldState) => { current(copy).initiator.steps[0]!.phase = 'holding'; }],
    ['unearned return', (copy: WorldState) => { current(copy).initiator.phase = 'returning'; }],
    ['unpaid meal', (copy: WorldState) => { current(copy).initiator.steps[0]!.foodConsumed = 0; }],
    ['invented remaining cargo', (copy: WorldState) => { current(copy).initiator.food++; }],
    ['phantom casualty', (copy: WorldState) => { current(copy).initiator.people--; current(copy).initiator.casualties = 1; }],
  ] as const) rejected(state, mutate, name);
});

void test('unopposed completed capture retains immutable purchase and validates historical balances independently of current stocks and population', () => {
  const state = completed();
  const result = latest(state);
  const incident = result.incident;
  assert.equal(incident.resolution!.outcome, 'captured');
  assert.equal(incident.resolution!.clash, null);
  assert.equal(state.tileAcquisitions![String(incident.tileId)]!.civId, DEFENDER);
  assert.equal(state.tiles.find(tile => tile.id === incident.tileId)!.owner, INITIATOR);
  const original = structuredClone(state.tileAcquisitions);
  const restarted = JSON.parse(JSON.stringify(state)) as WorldState;
  assert.ok(isWorldState(restarted));
  assert.deepEqual(restarted.tileAcquisitions, original);
  restarted.events = [];
  restarted.civilizations[INITIATOR]!.resources.food += 77;
  restarted.cities.find(city => city.id === incident.sourceCityId)!.population = 3;
  assert.ok(isBorderState(restarted.border, restarted), 'Historical return arithmetic is its own before/after fact, not today’s mutable balance or population');
  for (const [name, mutate] of [
    ['double refund', (copy: WorldState) => { latest(copy).incident.initiator.returned!.foodRefunded++; latest(copy).incident.initiator.returned!.foodStockAfter++; }],
    ['invented returned population', (copy: WorldState) => { latest(copy).incident.initiator.returned!.populationAfter++; }],
    ['wrong return town', (copy: WorldState) => { latest(copy).incident.initiator.returned!.sourceCityId = 'city-1'; }],
    ['live cargo after refund', (copy: WorldState) => { latest(copy).incident.initiator.food = 1; }],
    ['uncompleted return', (copy: WorldState) => { latest(copy).incident.initiator.returned = null; }],
    ['forged current control', (copy: WorldState) => { copy.border!.controls[String(incident.tileId)]!.civId = 2; }],
    ['rewritten purchase identity', (copy: WorldState) => { copy.border!.controls[String(incident.tileId)]!.purchaseId = 'territory-999'; }],
    ['missing control overlay', (copy: WorldState) => { delete copy.border!.controls[String(incident.tileId)]; }],
    ['erased pair protection', (copy: WorldState) => { copy.border!.pairProtectionUntil = {}; }],
    ['erased site protection', (copy: WorldState) => { copy.border!.siteProtectionUntil = {}; }],
    ['erased return cooldown', (copy: WorldState) => { copy.border!.initiationCooldownUntil[INITIATOR] = 0; }],
    ['erased deal cooldown', (copy: WorldState) => { copy.border!.dealCooldownUntil = {}; }],
    ['duplicate result', (copy: WorldState) => { copy.border!.lastResults.push(structuredClone(latest(copy))); }],
  ] as const) rejected(state, mutate, name);
  const before = structuredClone(state);
  const duplicate: GameEvent[] = [];
  resolveBorderIncidents(state, duplicate);
  assert.deepEqual(state, before);
  assert.deepEqual(duplicate, []);
});

void test('one seeded clash conserves living residents and actual casualty meals through restart and final return', () => {
  const state = syntheticBorderCorridor();
  dispatchBorder(state);
  borderAction(state, DEFENDER, { type: 'respond-border', incidentId: current(state).id, response: 'defend', sourceCityId: 'city-1', people: 3 });
  while (!current(state).resolution) borderBeat(state);
  const incident = current(state);
  assert.ok(incident.resolution!.clash);
  assert.equal(incident.initiator.casualties + incident.defender!.casualties, 1);
  assert.equal(incident.initiator.people + incident.defender!.people, 4);
  const restarted = JSON.parse(JSON.stringify(state)) as WorldState;
  assert.ok(isWorldState(restarted));
  while (state.border!.active.length) { borderBeat(state); borderBeat(restarted); assert.deepEqual(restarted, state); }
  for (const [name, mutate] of [
    ['forged seeded draw', (copy: WorldState) => { latest(copy).incident.resolution!.clash!.roll = 0.5; }],
    ['forged RNG successor', (copy: WorldState) => { latest(copy).incident.resolution!.clash!.seedAfter++; }],
    ['invented defensive power', (copy: WorldState) => { latest(copy).incident.resolution!.clash!.defenderPower++; }],
    ['second casualty', (copy: WorldState) => { const value = latest(copy).incident; const winner = value.initiator.casualties ? value.defender! : value.initiator; winner.casualties = 1; winner.people--; }],
    ['missing clash', (copy: WorldState) => { latest(copy).incident.resolution!.clash = null; }],
    ['altered casualty meals', (copy: WorldState) => { latest(copy).incident.initiator.steps.at(-1)!.people = 3; }],
    ['return before its cause', (copy: WorldState) => { latest(copy).incident.initiator.returned!.eventId = latest(copy).incident.initiator.departureEventId; }],
  ] as const) rejected(state, mutate, name);
});

void test('independent defender withdrawal may return before resolution in that same round, but never before its actual withdrawal cause', () => {
  const state = syntheticBorderCorridor();
  dispatchBorder(state);
  borderBeat(state);
  borderAction(state, DEFENDER, { type: 'respond-border', incidentId: current(state).id, response: 'defend', sourceCityId: 'city-1', people: 2 });
  borderBeat(state);
  borderBeat(state);
  borderAction(state, DEFENDER, { type: 'withdraw-border', incidentId: current(state).id });
  borderBeat(state);
  borderBeat(state);
  const incident = current(state);
  assert.ok(incident.defender!.returned);
  assert.equal(incident.defender!.returned!.round, incident.resolution!.round);
  const index = (id: string): number => Number(id.split(':')[1]);
  assert.equal(incident.defender!.returned!.eventId.split(':')[0], incident.resolution!.eventId.split(':')[0]);
  assert.ok(index(incident.defender!.returned!.eventId) < index(incident.resolution!.eventId));
  assert.ok(isBorderState(state.border, state));
  assert.ok(isWorldState(JSON.parse(JSON.stringify(state))));
  rejected(state, copy => { current(copy).responseEventId = current(copy).resolution!.eventId; }, 'The later resolution cannot stand in for the earlier independent withdrawal');
  rejected(state, copy => { current(copy).responseRound = current(copy).defender!.returned!.round; }, 'The defender cannot return before its first reverse beat');
  while (state.border!.active.length) borderBeat(state);
  assert.equal(latest(state).incident.defender!.casualties, 0);
  assert.ok(isBorderState(state.border, state));
});

void test('source withdrawal returns on one actual beat and every Border event keeps global nonempty effects', () => {
  const state = syntheticBorderCorridor();
  dispatchBorder(state);
  const incident = current(state);
  borderAction(state, INITIATOR, { type: 'withdraw-border', incidentId: incident.id });
  assert.equal(borderReturnReservations(state, incident.sourceCityId), 2);
  borderBeat(state);
  const result = latest(state);
  assert.equal(result.incident.initiator.steps.length, 1);
  assert.equal(result.incident.initiator.steps[0]!.fromTileId, result.incident.initiator.steps[0]!.toTileId);
  assert.equal(result.incident.initiator.steps[0]!.foodConsumed, 2.5);
  assert.equal(result.incident.initiator.returned!.foodRefunded, 17.5);
  assert.equal(borderReturnReservations(state, incident.sourceCityId), 0);
  for (const event of state.events.filter(event => event.border)) {
    assert.ok(validBorderEvent(event));
    assert.ok(isGameEvent(event));
    assert.equal(validBorderEvent({ ...event, effects: [] }), false);
    assert.equal(isGameEvent({ ...event, effects: [] }), false);
    assert.equal(validBorderEvent({ ...event, border: { ...event.border!, extra: true } }), false);
    const noPayload = { ...event };
    delete noPayload.border;
    assert.equal(validBorderEvent(noPayload), false);
  }
  const falseEvent = structuredClone(state.events.find(event => event.border)!);
  falseEvent.type = 'ordinary';
  assert.equal(validBorderEvent(falseEvent), false);
});

void test('an invalidated unoccupied approach cancels before that beat movement and still conserves the exact bounded return', () => {
  const state = syntheticBorderCorridor();
  dispatchBorder(state);
  const incident = current(state);
  const approach = incident.initiator.departure.pathTileIds.at(-2)!;
  state.tiles.find(tile => tile.id === approach)!.owner = null;
  assert.ok(isWorldState(state), 'Changing an unoccupied ordinary approach does not rewrite any paid purchase receipt');
  borderBeat(state);
  const result = latest(state);
  assert.equal(result.incident.resolution!.outcome, 'cancelled');
  assert.equal(result.incident.resolution!.clash, null);
  assert.equal(result.incident.initiator.steps[0]!.phase, 'returning');
  assert.equal(result.incident.initiator.steps[0]!.round, result.incident.resolution!.round);
  assert.equal(result.incident.initiator.returned!.people, 2);
  assert.ok(isWorldState(JSON.parse(JSON.stringify(state))));
  rejected(state, copy => { latest(copy).incident.initiator.steps[0]!.phase = 'outbound'; }, 'A pre-meal cancellation cannot advance outward in that same beat');
});
