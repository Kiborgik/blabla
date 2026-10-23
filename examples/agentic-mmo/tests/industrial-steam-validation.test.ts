import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorldState } from '../core/types.ts';
import { isGameEvent, isWorldState } from '../core/validation.ts';
import { industrialSteamJourney, industrialSteamPrefix } from './fixtures/industrial-steam-journey.ts';

function required<T>(value: T | undefined | null): T { assert.ok(value !== undefined && value !== null); return value; }
function coal(state: WorldState) { return required(state.coalDeposits); }
function firstCoal(state: WorldState) { return required(coal(state).deposits[String(required(coal(state).tileIds[0]))]); }

function corrupt(state: WorldState, change: (copy: WorldState) => void, label: string): void {
  const copy = structuredClone(state); change(copy); assert.equal(isWorldState(copy), false, label);
}

void test('fresh industrial rules require all three durable fields', () => {
  const journey = industrialSteamPrefix();
  assert.ok(isWorldState(journey.prepared));
  for (const field of ['coalDeposits', 'railEdges', 'industrialEvidence'] as const) {
    corrupt(journey.prepared, copy => { delete copy[field]; }, `missing ${field}`);
  }
});

void test('Coal validates retained placement identity, finite reserve, exact map, terrain and nonoverlap', () => {
  const state = industrialSteamPrefix().prepared; const layer = coal(state); assert.ok(layer.tileIds.length > 0);
  for (const change of [
    (copy: WorldState) => { coal(copy).placementId = 'iron-placement-1'; },
    (copy: WorldState) => { coal(copy).seed++; },
    (copy: WorldState) => { coal(copy).tileIds.push(required(coal(copy).tileIds[0])); },
    (copy: WorldState) => { firstCoal(copy).initialReserve++; },
    (copy: WorldState) => { firstCoal(copy).remaining = 301; },
    (copy: WorldState) => { firstCoal(copy).resource = 'iron'; },
    (copy: WorldState) => { required(copy.tiles[required(layer.tileIds[0])]).terrain = 'ocean'; },
    (copy: WorldState) => { Object.assign(coal(copy), { regenerated: true }); },
  ]) corrupt(state, change, 'malformed retained Coal layer');
  const later = structuredClone(state); required(later.tiles[required(layer.tileIds[0])]).owner = 0;
  assert.ok(isWorldState(later), 'placement is never regenerated against later ownership');
});

void test('actual positive Foundry proof retains exact payment and residents after pause and event pruning', () => {
  const journey = industrialSteamPrefix(); journey.beat();
  const initial = structuredClone(journey.state); const evidence = required(initial.industrialEvidence); const receipt = required(evidence.foundryOperations[0]);
  assert.ok(isWorldState(initial)); assert.ok(initial.events.some(event => event.id === receipt.eventId && event.industrialFoundry));
  assert.deepEqual(receipt.paid, { energy: 2 }); assert.deepEqual(receipt.strategicPaid, { iron: 1 }); assert.ok((receipt.produced.materials ?? 0) > 0);
  journey.act({ type: 'set-building-operation', cityId: receipt.cityId, buildingId: 'foundry', enabled: false }, receipt.civId); journey.beat();
  const paused = structuredClone(journey.state); assert.equal(required(paused.cities.find(city => city.id === receipt.cityId)).buildingOperations?.foundry?.lastResult?.status, 'paused');
  paused.events = []; assert.ok(isWorldState(paused)); assert.deepEqual(required(paused.industrialEvidence).foundryOperations[0], receipt);
  const proof = (copy: WorldState) => required(required(copy.industrialEvidence).foundryOperations[0]);
  for (const change of [
    (copy: WorldState) => { proof(copy).paid.energy = 0; },
    (copy: WorldState) => { proof(copy).strategicPaid.iron = 0; },
    (copy: WorldState) => { proof(copy).produced.materials = 0; },
    (copy: WorldState) => { proof(copy).residents.allocated = 0; },
    (copy: WorldState) => { proof(copy).residents.available = 0; },
    (copy: WorldState) => { proof(copy).eventId = `${copy.revision + 1}:0`; },
    (copy: WorldState) => { proof(copy).cityId = 'unknown-town'; },
    (copy: WorldState) => { required(copy.industrialEvidence).foundryOperations.push(structuredClone(proof(copy))); },
  ]) corrupt(paused, change, 'invalid durable operated proof');
  corrupt(initial, copy => { required(copy.events.find(event => event.id === receipt.eventId)).industrialFoundry = { ...receipt, round: receipt.round - 1 }; }, 'retained event mismatch');
  corrupt(initial, copy => { required(copy.industrialEvidence).foundryOperations = []; }, 'retained successful event cannot lose its first proof');
  corrupt(initial, copy => { copy.calendarMilestones.push('industrial-world'); }, 'one town without steam cannot prove industrial milestone');
});

let journeyCache: ReturnType<typeof industrialSteamJourney> | undefined;
function story() { journeyCache ??= industrialSteamJourney(); return journeyCache; }

void test('genuine paid Rail uses canonical edges independently of tile assets and validates complete durable identities', () => {
  const journey = story(); const activeStep = required(journey.steps.find(step => step.input.kind === 'action' && step.input.command.action.type === 'build-rail'));
  const active = activeStep.result.state; assert.ok(isWorldState(active));
  const town = required(active.cities.find(city => city.construction?.active && 'kind' in city.construction.active && city.construction.active.kind === 'rail'));
  const order = (copy: WorldState) => { const item = required(required(copy.cities.find(city => city.id === town.id)).construction?.active); assert.ok('kind' in item && item.kind === 'rail'); return item; };
  for (const change of [
    (copy: WorldState) => { order(copy).strategicPaid.coal = 0; },
    (copy: WorldState) => { order(copy).paid.materials = 0; },
    (copy: WorldState) => { order(copy).workDone = order(copy).workRequired; },
    (copy: WorldState) => { order(copy).edgeId = `${order(copy).toTileId}:${order(copy).tileId}`; },
    (copy: WorldState) => { order(copy).toTileId = order(copy).tileId; },
    (copy: WorldState) => { required(copy.tiles.find(tile => tile.id === order(copy).toTileId)).owner = null; },
  ]) corrupt(active, change, 'invalid active paid edge');
  const completed = journey.beforeOffer; assert.ok(isWorldState(completed)); const edge = required(Object.values(required(completed.railEdges))[0]);
  const retained = (copy: WorldState) => required(required(copy.railEdges)[edge.edgeId]);
  for (const change of [
    (copy: WorldState) => { retained(copy).strategicPaid.iron = 0; },
    (copy: WorldState) => { retained(copy).completedRound = retained(copy).startedRound; },
    (copy: WorldState) => { retained(copy).eventId = `${copy.revision + 1}:0`; },
    (copy: WorldState) => { retained(copy).cityId = 'missing-town'; },
    (copy: WorldState) => { required(copy.railEdges)[`${edge.toTileId}:${edge.tileId}`] = retained(copy); },
  ]) corrupt(completed, change, 'invalid completed paid edge');
  for (const step of journey.steps) assert.ok(isWorldState(step.result.state), `actual industrial frame ${step.result.state.revision}`);
});

void test('first faster steam proof validates complete due payment independently of the pruned event window', () => {
  const journey = story(); const state = structuredClone(journey.state); const first = required(required(state.industrialEvidence).steamDelivery);
  assert.ok(isWorldState(state)); assert.equal(first.terms.cadenceRounds, 7); assert.equal(first.terms.transport?.mode, 'steam');
  assert.ok(state.calendarMilestones.includes('industrial-world')); assert.equal(required(state.industrialEvidence).foundryOperations.length, 2);
  const event = required(state.events.find(candidate => candidate.id === first.eventId)); assert.ok(isGameEvent(event));
  const wrongPhase = structuredClone(event); required(wrongPhase.steamDelivery).acceptedRound++; assert.equal(isGameEvent(wrongPhase), false, 'due origin is independently checked without a route or WorldState');
  state.events = []; assert.ok(isWorldState(state));
  const proof = (copy: WorldState) => required(required(copy.industrialEvidence).steamDelivery);
  for (const change of [
    (copy: WorldState) => { Reflect.deleteProperty(proof(copy), 'acceptedRound'); },
    (copy: WorldState) => { proof(copy).acceptedRound++; },
    (copy: WorldState) => { proof(copy).proposerStrategicPaid.coal = 0; },
    (copy: WorldState) => { proof(copy).proposerPaid.food = 0; },
    (copy: WorldState) => { proof(copy).recipientPaid.materials = 0; },
    (copy: WorldState) => { proof(copy).routeId = 'unknown-route'; },
    (copy: WorldState) => { proof(copy).terms.cadenceRounds++; },
    (copy: WorldState) => { const quote = proof(copy).terms.transport; assert.ok(quote?.mode === 'steam'); quote.edgeWeights[0] = 0; },
    (copy: WorldState) => { const quote = proof(copy).terms.transport; assert.ok(quote?.mode === 'steam'); required(quote.railEdges[0]).completionEventId = `${copy.revision + 1}:0`; },
    (copy: WorldState) => { required(copy.industrialEvidence).steamDelivery = null; },
  ]) corrupt(state, change, 'invalid durable due steam proof');
});
