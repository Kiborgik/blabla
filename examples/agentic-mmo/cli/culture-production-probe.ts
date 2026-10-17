import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { BUILDINGS, RESOURCE_IDS } from '../core/content.ts';
import { applyCommand } from '../core/engine.ts';
import { buildingBaseProduction, districtAdjacencyFacts } from '../core/simulation/districts.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import type { TransitionResult, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { cultureProductionOperationJourney } from '../tests/fixtures/culture-production-journey.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixStep } from '../tests/fixtures/coastal-prefix.ts';

const actions = ['start_theater', 'complete_theater', 'work_theater', 'work_printing_house', 'pause_printing_house', 'refuse_culture_action', 'replay_culture_history'];
const cityId = 'city-0';
function town(state: WorldState) { const city = state.cities.find(value => value.id === cityId); assert.ok(city); return city; }
function stocks(state: WorldState) { const civilization = state.civilizations[0]; assert.ok(civilization); return civilization.resources; }
function time(state: WorldState): string { return coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 30, ((state.independentTurns?.lastActionWindow[0] ?? -1) + 1) * 10)); }

export class CultureProductionProbe {
  private path: ReturnType<typeof cultureProductionOperationJourney> | null = null;
  private state: WorldState | null = null;
  private before: WorldState | null = null;
  private result: TransitionResult | null = null;
  private control: TransitionResult | null = null;
  private allocation: WorldState | null = null;
  private repeated: TransitionResult | null = null;
  private replayedFrames = 0;
  private operation = '';

  reset(): void { this.state = null; this.before = null; this.result = null; this.control = null; this.allocation = null; this.repeated = null; this.replayedFrames = 0; this.operation = ''; }
  snapshot() { return structuredClone({ state: this.state, before: this.before, result: this.result, control: this.control, allocation: this.allocation, repeated: this.repeated, replayedFrames: this.replayedFrames, operation: this.operation }); }
  private basis() { this.path ??= cultureProductionOperationJourney(); return this.path; }
  private select(step: CoastalPrefixStep): void {
    this.before = structuredClone(step.before); this.result = replayCoastalStep(this.before, structuredClone(step.input));
    assert.deepEqual(this.before, step.before); assert.deepEqual(this.result, step.result); assert.ok(this.result.ok, this.result.error); assert.ok(isWorldState(this.result.state)); this.state = this.result.state;
  }

  call(action: string): void {
    if (!actions.includes(action)) throw new RangeError(`Unknown culture action ${action}`);
    this.operation = action; this.control = null; this.allocation = null; this.repeated = null; this.replayedFrames = 0;
    if (action === 'refuse_culture_action') {
      this.state ??= structuredClone(this.basis().adopted); this.before = structuredClone(this.state);
      this.result = applyCommand(this.state, { seat: 0, expectedRevision: this.state.revision, timestamp: time(this.state), action: { type: 'build', project: 'printing-house', cityId: 'missing-culture-town' } });
      assert.deepEqual(this.state, this.before); this.state = this.result.state; return;
    }
    const path = this.basis();
    if (action === 'replay_culture_history') {
      this.before = structuredClone(path.journey.initial); let state = structuredClone(this.before);
      for (const step of path.journey.steps) { assert.deepEqual(state, step.before); const before = structuredClone(state); const result = replayCoastalStep(state, structuredClone(step.input)); assert.deepEqual(state, before); assert.deepEqual(result, step.result); assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state)); state = result.state; this.result = result; this.replayedFrames++; }
      this.state = state; return;
    }
    if (action === 'pause_printing_house') {
      const initial = structuredClone(path.operated); const paused = applyCommand(initial, { seat: 0, expectedRevision: initial.revision, timestamp: time(initial), action: { type: 'set-building-operation', cityId, buildingId: 'printing-house', enabled: false } });
      assert.ok(paused.ok, paused.error); assert.deepEqual(initial, path.operated); assert.ok(isWorldState(paused.state)); this.before = structuredClone(paused.state);
      this.result = replayCoastalStep(this.before, { kind: 'strategy', timestamp: coastalPrefixTime(((this.before.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
      assert.deepEqual(this.before, paused.state); assert.ok(this.result.ok, this.result.error); assert.ok(isWorldState(this.result.state)); this.state = this.result.state; return;
    }
    const destination = action === 'start_theater' ? path.theaterActive : action === 'complete_theater' ? path.theaterCompleted : action === 'work_theater' ? path.theaterOperated : path.operated;
    const step = path.journey.steps.find(value => value.result.state.revision === destination.revision); assert.ok(step); this.select(step); assert.ok(this.state && this.before);
    if (action === 'start_theater') {
      this.repeated = applyCommand(this.state, { seat: 0, expectedRevision: this.state.revision, timestamp: time(this.state), action: { type: 'build', project: 'theater-square', cityId, tileId: path.journey.theaterTileId } });
    } else if (action === 'complete_theater' || action === 'work_theater') {
      const synthetic = structuredClone(this.before); const city = town(synthetic);
      if (action === 'complete_theater') { assert.ok(city.construction); city.construction.active = null; }
      else { city.buildings = city.buildings.filter(id => id !== 'theater-square'); delete city.districtSites?.['theater-square']; }
      const beforeControl = structuredClone(synthetic); this.control = replayCoastalStep(synthetic, structuredClone(step.input)); assert.deepEqual(synthetic, beforeControl); assert.ok(this.control.ok, this.control.error);
    } else {
      this.allocation = structuredClone(this.before); allocateOperations(this.allocation);
    }
  }

  observe() {
    const state = this.state; const before = this.before; const path = this.path; const action = this.operation;
    const city = state ? town(state) : null; const openingCity = before ? town(before) : null;
    const order = city?.construction?.active; const lastCompleted = city?.construction?.lastCompleted;
    const completion = lastCompleted && 'buildingId' in lastCompleted ? lastCompleted : null;
    const allocation = this.allocation; const control = this.control;
    const definition = BUILDINGS.find(value => value.id === 'theater-square'); const printing = BUILDINGS.find(value => value.id === 'printing-house');
    const receipt = city?.buildingOperations?.['printing-house']?.lastResult;
    const allocated = this.allocation ? town(this.allocation).buildingOperations?.['printing-house']?.lastResult : null;
    const facts = before && definition && path ? districtAdjacencyFacts(before, definition, path.journey.theaterTileId) : null;
    const unfinishedFacts = definition && path ? districtAdjacencyFacts(path.journey.wonderActive, definition, path.journey.theaterTileId) : null;
    const exactPayment = !!state && !!before && !!order && !('kind' in order) && !!definition && equal(order.paid, definition.cost) && RESOURCE_IDS.every(resource => Math.abs(stocks(before)[resource] - stocks(state)[resource] - (order.paid[resource] ?? 0)) < 1e-8);
    const cultureDelta = state && this.control ? stocks(state).culture - stocks(this.control.state).culture : 0;
    const expectedCulture = before && openingCity && definition ? Math.round((buildingBaseProduction(before, openingCity, definition).culture ?? 0) * cityProductivity(openingCity) * 100) / 100 : 0;
    const allocationPaid = !!before && !!allocation && RESOURCE_IDS.every(resource => allocation.civilizations.every((civilization, index) => {
      const prior = before.civilizations[index]; if (!prior || prior.id !== civilization.id) return false;
      const paid = allocation.cities.filter(value => value.civId === civilization.id).reduce((sum, value) => sum + Object.values(value.buildingOperations ?? {}).reduce((total, operation) => total + (operation.lastResult?.paid[resource] ?? 0), 0), 0);
      return Math.abs(prior.resources[resource] - civilization.resources[resource] - paid) < 1e-8;
    }));
    return {
      initialized: state !== null,
      provenance: state ? 'Actual immutable legal culture journey; named completion/output controls are explicitly synthetic detached engine comparisons' : 'Uninitialized; no journey executed',
      replayed_frames: this.replayedFrames,
      paid_once: action === 'start_theater' && exactPayment && this.repeated?.ok === false && equal(this.repeated.state, state) && this.repeated.events.length === 0,
      exact_site: action === 'start_theater' && !!path && !!order && !('kind' in order) && order.buildingId === 'theater-square' && order.cityId === cityId && order.tileId === path.journey.theaterTileId && city?.districtSites?.['theater-square'] === undefined,
      completed: action === 'complete_theater' && city?.buildings.includes('theater-square') === true && completion?.buildingId === 'theater-square' && completion.tileId === path?.journey.theaterTileId && city.construction?.active === null,
      no_completion_output: action === 'complete_theater' && !!state && !!before && !!control && !openingCity?.buildings.includes('theater-square') && RESOURCE_IDS.every(resource => stocks(state)[resource] === stocks(control.state)[resource]),
      completed_wonder_only: action === 'work_theater' && facts?.source === 'wonder' && !!path && equal(facts.tileIds, [path.journey.wonderTileId]) && facts.bonus === 2 && unfinishedFacts?.source === 'wonder' && unfinishedFacts.bonus === 0 && unfinishedFacts.tileIds.length === 0,
      culture_made: action === 'work_theater' ? cultureDelta > 0 && expectedCulture > 0 && Math.abs(cultureDelta - expectedCulture) < 0.011 : action === 'work_printing_house' && receipt?.status === 'operated' && (receipt.produced.culture ?? 0) > 0 && receipt.round > (completion?.completedRound ?? Infinity),
      same_town: action === 'work_printing_house' && city?.id === cityId && city.buildings.includes('theater-square') && city.buildings.includes('printing-house') && completion?.cityId === cityId && completion.buildingId === 'printing-house',
      staffed: action === 'work_printing_house' && receipt?.residents?.allocated === 3 && receipt.residents.required === 3 && receipt.residents.openingPopulation === openingCity?.population && equal(receipt.residents, allocated?.residents),
      inputs_paid: action === 'work_printing_house' && !!printing && receipt?.status === 'operated' && equal(receipt.paid, printing.operatingInputs) && equal(receipt.paid, { materials: 1 }) && equal(receipt.paid, allocated?.paid) && allocationPaid,
      paused: action === 'pause_printing_house' && city?.buildingOperations?.['printing-house']?.enabled === false && receipt?.status === 'paused',
      no_payment_or_output: action === 'pause_printing_house' && receipt?.status === 'paused' && equal(receipt.paid, {}) && equal(receipt.produced, {}) && receipt.residents?.allocated === 0,
      refused: this.result?.ok === false,
      no_effects: this.result?.ok === false && equal(this.result.state, before) && this.result.events.length === 0,
      replay_exact: action === 'replay_culture_history' && !!path && this.replayedFrames === path.journey.steps.length && equal(state, path.operated),
    };
  }
}
