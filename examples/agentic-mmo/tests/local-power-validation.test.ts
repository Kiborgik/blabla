import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LocalPowerBeatReceipt, WorldState } from '../core/types.ts';
import { isGameEvent, isWorldState } from '../core/validation.ts';
import { localPowerJourney } from './fixtures/local-power-journey.ts';

function required<T>(value: T | null | undefined): T { assert.ok(value !== null && value !== undefined); return value; }
let cached: ReturnType<typeof localPowerJourney> | undefined;
function story() { cached ??= localPowerJourney(); return cached; }
function town(state: WorldState) { return required(state.cities.find(city => city.id === story().cityId)); }
function beat(state: WorldState): LocalPowerBeatReceipt { return required(required(town(state).localPower).lastBeat); }
function corrupt(state: WorldState, change: (copy: WorldState) => void, label: string): void {
  const copy = structuredClone(state); change(copy); assert.equal(isWorldState(copy), false, label);
}

void test('local Power migration and every genuine paid construction and consumer frame validate', () => {
  const journey = story();
  assert.ok(isWorldState(journey.beforeRelease)); assert.ok(isWorldState(journey.adopted));
  assert.ok(journey.adopted.cities.every(city => city.localPower === undefined));
  for (const step of journey.steps) assert.ok(isWorldState(step.result.state), `legal frame ${step.result.state.revision}`);
  corrupt(journey.beforeRelease, copy => { town(copy).localPower = { ruleVersion: 1, lastBeat: null, lastProductiveBeat: null }; }, 'unreleased field');
  corrupt(journey.plantCompleted, copy => { delete town(copy).localPower; }, 'installed plant requires bounded ledger');
  corrupt(journey.productive, copy => { Object.assign(required(town(copy).localPower), { storedPower: 5 }); }, 'no spendable receipt balance');
});

void test('closed Power receipts enforce exact recipe, atomic payment, residents, phase and conservation after pruning', () => {
  const state = structuredClone(story().productive); state.events = [];
  assert.ok(isWorldState(state));
  const changes: Array<(copy: WorldState) => void> = [
    copy => { beat(copy).expired++; },
    copy => { beat(copy).operations.reverse(); },
    copy => { beat(copy).operations.push(structuredClone(required(beat(copy).operations[0]))); },
    copy => { required(beat(copy).operations[0]).recipe.strategicInputs.coal = 1; },
    copy => { required(beat(copy).operations[0]).result.strategicPaid.coal = 1; },
    copy => { required(beat(copy).operations[0]).result.emissionsProduced = 3; },
    copy => { required(beat(copy).operations[0]).result.localPower.generated = 9; },
    copy => { required(beat(copy).operations[1]).result.localPower.availableBefore = 11; },
    copy => { required(beat(copy).operations[1]).result.localPower.consumed = 0; },
    copy => { required(beat(copy).operations[1]).result.residents.allocated = 0; },
    copy => { required(beat(copy).operations[1]).result.residents.available = beat(copy).openingPopulation; },
    copy => { required(beat(copy).operations[1]).result.produced.science = 1; },
    copy => { required(beat(copy).operations[1]).result.operationEventId = beat(copy).eventId; },
    copy => { beat(copy).eventId = `${copy.revision + 1}:0`; },
    copy => { beat(copy).cityId = 'missing-town'; },
  ];
  for (const [index, change] of changes.entries()) corrupt(state, change, `invalid pruned receipt ${index}`);
});

void test('paused or blocked attempts preserve positive consumer history without unpaid or zero-output credit', () => {
  const state = structuredClone(story().unused); state.events = [];
  assert.ok(isWorldState(state));
  const ledger = required(town(state).localPower); assert.equal(beat(state).expired, 8);
  assert.equal(required(ledger.lastProductiveBeat).round, story().productive.round);
  corrupt(state, copy => { required(town(copy).localPower).lastProductiveBeat = structuredClone(beat(copy)); }, 'generation alone is not productive');
  corrupt(state, copy => { required(beat(copy).operations[1]).result.paid.energy = 1; }, 'paused operation cannot pay');
  corrupt(state, copy => { required(beat(copy).operations[1]).result.status = 'blocked'; }, 'blocked requires an actual shortage');
  corrupt(story().productive, copy => { required(town(copy).localPower).lastProductiveBeat = null; }, 'latest positive cannot lose durable proof');
  const noOutput = structuredClone(state); const proof = required(required(town(noOutput).localPower).lastProductiveBeat);
  required(proof.operations[1]).result.produced.materials = 0;
  assert.equal(isWorldState(noOutput), false, 'paid zero output does not justify productive history');
});

void test('retained Power beat and operation event identities cross-check exact bounded snapshots', () => {
  const state = story().productive; const receipt = beat(state);
  const event = required(state.events.find(item => item.id === receipt.eventId)); assert.ok(isGameEvent(event));
  const invalid = structuredClone(event); required(invalid.localPower).consumed++; assert.equal(isGameEvent(invalid), false);
  const absent = structuredClone(event); delete absent.localPower; assert.equal(isGameEvent(absent), false);
  corrupt(state, copy => { required(required(copy.events.find(item => item.id === receipt.eventId)).localPower).openingPopulation++; }, 'retained closed beat differs');
  corrupt(state, copy => { required(copy.events.find(item => item.id === required(receipt.operations[0]).result.operationEventId)).actor = 4; }, 'retained operation actor differs');
  corrupt(state, copy => { required(required(town(copy).buildingOperations?.factory?.lastResult).localPower).consumed = 2; }, 'current operation differs from closed snapshot');
  const historic = structuredClone(story().unused); historic.events = [];
  const prior = required(required(town(historic).localPower).lastProductiveBeat); prior.civId = (prior.civId + 1) % 5;
  assert.ok(isWorldState(historic), 'historical receipt owner does not derive from current ownership after event pruning');
});
