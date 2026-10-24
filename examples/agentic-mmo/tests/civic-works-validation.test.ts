import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVE_LOCAL_RELEASE_ID, advanceLocalSimulation, createLocalSimulation, parseLocalSimulation } from '../web/local-simulation.ts';
import { isGameAction } from '../core/planning.ts';
import { isGameEvent, isWorldState } from '../core/validation.ts';
import { isCivicWorksReceipt } from '../core/civic-works-validation.ts';
import { borderPromisedResources } from '../core/simulation/border-incidents.ts';
import { executeAction } from '../core/simulation/commands.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { BUILDINGS } from '../core/content.ts';
import type { GameEvent } from '../core/types.ts';
import type { CivicWorksReceipt } from '../core/civic-works-types.ts';
import { acceptCivicWorksFixture, advanceCivicWorksFixture, civicWorksFixture } from './fixtures/civic-works.ts';
import { syntheticTechnologies } from './fixtures/coastal-prefix.ts';

test('current fresh genesis initializes the bounded civic works layer', () => {
  const run = createLocalSimulation(73);
  assert.equal(run.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.ok(run.state.unlockedFeatures.includes('civic-works'));
  assert.deepEqual(run.state.civicWorks, { ruleVersion: 1, active: [], lastResults: [null, null, null, null, null] });
  assert.equal(isWorldState(run.state), true);
});

test('commission action parsing binds one exact order and the Kiln', () => {
  const action = { type: 'commission-civic-works', cityId: 'city-0', orderId: 'construction-3', donorBuildingId: 'kiln' };
  assert.equal(isGameAction(action), true);
  assert.equal(isGameAction({ ...action, donorBuildingId: 'workshop' }), false);
  assert.equal(isGameAction({ ...action, orderId: '' }), false);
  assert.equal(isGameAction({ ...action, work: 2 }), false);
});

test('unreleased civic works state is rejected rather than activated', () => {
  const run = createLocalSimulation(73);
  run.state.unlockedFeatures = run.state.unlockedFeatures.filter(feature => feature !== 'civic-works');
  run.state.civicWorks = { ruleVersion: 1, active: [], lastResults: [null, null, null, null, null] };
  assert.equal(isWorldState(run.state), false);
});

test('current generated restart preserves exact current state and controller continuation', () => {
  const started = createLocalSimulation(73);
  const progressed = advanceLocalSimulation(started);
  const restored = parseLocalSimulation(JSON.parse(JSON.stringify(progressed)));
  assert.ok(restored);
  assert.deepEqual(restored, progressed);
  assert.deepEqual(advanceLocalSimulation(restored), advanceLocalSimulation(progressed));
});

test('paid civic work survives serialization while synchronized arithmetic and payment forgeries fail', () => {
  const state = civicWorksFixture();
  acceptCivicWorksFixture(state);
  advanceCivicWorksFixture(state);
  assert.equal(isWorldState(state), true);
  assert.equal(isWorldState(JSON.parse(JSON.stringify(state))), true);
  const mutations: Array<(receipt: CivicWorksReceipt) => void> = [
    receipt => { receipt.extraWork += .1; },
    receipt => { receipt.ordinaryWork += .1; },
    receipt => { receipt.paid.materials = 0; },
    receipt => { receipt.residents!.allocated = 2; },
    receipt => { receipt.workBasis!.capitalPercent = 15; },
    receipt => { receipt.expiresRound++; },
    receipt => { receipt.acceptedEventId = '999999:0'; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(state);
    const receipt = changed.civicWorks!.lastResults[0]!;
    mutate(receipt);
    changed.events.find(event => event.id === receipt.eventId)!.civicWorks = structuredClone(receipt);
    assert.equal(isWorldState(changed), false, mutate.toString());
  }
});

test('ordinary operation cannot retain a crew marker or lose its exact worked receipt', () => {
  const state = civicWorksFixture();
  acceptCivicWorksFixture(state);
  advanceCivicWorksFixture(state);
  const ordinary = structuredClone(state);
  ordinary.cities[0]!.buildingOperations!.kiln!.lastResult!.status = 'operated';
  assert.equal(isWorldState(ordinary), false);
  const detached = structuredClone(state);
  detached.civicWorks!.lastResults[0] = null;
  assert.equal(isWorldState(detached), false);
  const event = structuredClone(state.events.find(event => event.type === 'civic-works-worked')!);
  delete event.civicWorks;
  assert.equal(isGameEvent(event), false);
  const substituted = structuredClone(state);
  const operation = substituted.cities[0]!.buildingOperations!.kiln!.lastResult!;
  operation.status = 'operated';
  delete operation.civicWorksCommissionId;
  operation.paid = { energy: 2 }; operation.produced = { materials: 9 };
  assert.equal(isWorldState(substituted), false);
  const pausedLater = structuredClone(state);
  pausedLater.cities[0]!.buildingOperations!.kiln!.enabled = false;
  assert.equal(isWorldState(pausedLater), true);
});

test('active commissions bind actual parent district sites and one civilization record', () => {
  const state = civicWorksFixture('library');
  acceptCivicWorksFixture(state);
  assert.equal(isWorldState(state), true);
  const wrongSite = structuredClone(state);
  wrongSite.civicWorks!.active[0]!.targetTileId = state.cities[0]!.tileId;
  assert.equal(isWorldState(wrongSite), false);
  const duplicate = structuredClone(state);
  duplicate.civicWorks!.active.push(structuredClone(duplicate.civicWorks!.active[0]!));
  assert.equal(isWorldState(duplicate), false);
});

test('authoritative border promises refuse active crew forecasts without changing existing state', () => {
  const state = civicWorksFixture();
  assert.equal(borderPromisedResources(state, 0, 2).failure, null);
  acceptCivicWorksFixture(state);
  const before = structuredClone(state);
  assert.match(borderPromisedResources(state, 0, 2).failure!, /active civic-works commission/i);
  assert.deepEqual(state, before);
});

test('current receipt identity and work remain bound to the exact active commission', () => {
  const state = civicWorksFixture();
  acceptCivicWorksFixture(state);
  advanceCivicWorksFixture(state);
  assert.equal(state.civicWorks!.active.length, 1);
  const mutations: Array<(receipt: CivicWorksReceipt) => void> = [
    receipt => { receipt.orderId = 'construction-999999'; },
    receipt => { receipt.buildingId = 'library'; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(state);
    const receipt = changed.civicWorks!.lastResults[0]!;
    mutate(receipt);
    changed.events.find(event => event.id === receipt.eventId)!.civicWorks = structuredClone(receipt);
    assert.equal(isWorldState(changed), false, mutate.toString());
  }
  const changedWork = structuredClone(state);
  changedWork.cities[0]!.construction!.active!.workDone += .01;
  assert.equal(isWorldState(changedWork), false);
});

test('a later actual commission preserves the former terminal receipt without rebinding its history', () => {
  const state = civicWorksFixture();
  acceptCivicWorksFixture(state);
  advanceCivicWorksFixture(state);
  advanceCivicWorksFixture(state);
  const previous = structuredClone(state.civicWorks!.lastResults[0]);
  assert.equal(previous!.terminal, 'order-completed');
  assert.equal(isWorldState(state), true);
  syntheticTechnologies(state, 0, BUILDINGS.find(building => building.id === 'irrigation')!.requires);
  state.revision++;
  const events: GameEvent[] = [];
  executeAction(state, 0, { type: 'build', cityId: 'city-0', project: 'irrigation' }, events);
  commitEvents(state, events);
  acceptCivicWorksFixture(state);
  assert.notEqual(state.civicWorks!.active[0]!.id, previous!.commissionId);
  assert.deepEqual(state.civicWorks!.lastResults[0], previous);
  assert.equal(isWorldState(state), true);
  const forged = structuredClone(state);
  forged.civicWorks!.lastResults[0]!.buildingId = 'library';
  forged.events.find(event => event.id === previous!.eventId)!.civicWorks = structuredClone(forged.civicWorks!.lastResults[0]!);
  assert.equal(isWorldState(forged), false);
});

test('current expiry preserves the exact unfinished ordinary order even after the commission retires', () => {
  const state = civicWorksFixture();
  acceptCivicWorksFixture(state);
  state.cities[0]!.buildingOperations!.kiln!.enabled = false;
  advanceCivicWorksFixture(state);
  advanceCivicWorksFixture(state);
  assert.equal(state.civicWorks!.active.length, 0);
  assert.equal(state.civicWorks!.lastResults[0]!.terminal, 'expired');
  assert.equal(isWorldState(state), true);
  for (const field of ['orderId', 'buildingId'] as const) {
    const changed = structuredClone(state);
    const receipt = changed.civicWorks!.lastResults[0]!;
    receipt[field] = field === 'orderId' ? 'construction-999999' : 'library';
    changed.events.find(event => event.id === receipt.eventId)!.civicWorks = structuredClone(receipt);
    assert.equal(isWorldState(changed), false);
  }
  advanceCivicWorksFixture(state);
  assert.equal(isWorldState(state), true);
});

test('retained event identities and impossible terminal statuses fail closed', () => {
  const state = civicWorksFixture();
  acceptCivicWorksFixture(state);
  advanceCivicWorksFixture(state);
  for (const kind of ['acceptance-detail', 'acceptance-order', 'result-detail']) {
    const changed = structuredClone(state);
    const receipt = changed.civicWorks!.lastResults[0]!;
    const accepted = changed.events.find(event => event.id === receipt.acceptedEventId)!;
    const result = changed.events.find(event => event.id === receipt.eventId)!;
    if (kind === 'acceptance-detail') accepted.detail = 'civic-works-999999';
    if (kind === 'acceptance-order') { accepted.effects.push(accepted.effects[0]!); accepted.effects[0] = 'City city-0; order construction-999999; donor kiln'; }
    if (kind === 'result-detail') result.detail = 'civic-works-999999';
    assert.equal(isWorldState(changed), false, kind);
  }
  const lost = structuredClone(state.civicWorks!.lastResults[0]!);
  Object.assign(lost, { status: 'blocked', terminal: 'order-lost', paid: {}, residents: null, workBasis: null, ordinaryWork: 0, extraWork: 0, workBefore: 0, workRequired: 0 });
  assert.equal(isCivicWorksReceipt(lost), false);
  advanceCivicWorksFixture(state);
  const completed = structuredClone(state.civicWorks!.lastResults[0]!);
  Object.assign(completed, { status: 'blocked', paid: {}, residents: null, extraWork: 0, workBefore: completed.workRequired - completed.ordinaryWork });
  assert.equal(isCivicWorksReceipt(completed), false);
});
