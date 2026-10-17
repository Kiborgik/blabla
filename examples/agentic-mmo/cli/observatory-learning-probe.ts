import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { RESOURCE_IDS } from '../core/content.ts';
import { applyCommand } from '../core/engine.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { isHillSite } from '../core/simulation/improvements.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import type { TransitionResult, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixStep } from '../tests/fixtures/coastal-prefix.ts';
import { observatoryLearningOperationJourney } from '../tests/fixtures/observatory-learning-journey.ts';

const actions = ['start_observatory', 'complete_observatory', 'work_observatory', 'block_observatory', 'refuse_observatory_action', 'replay_observatory_history'];
function town(state: WorldState) { const city = state.cities.find(value => value.id === 'city-0'); assert.ok(city); return city; }
function actor(state: WorldState, seat = 0) { const civilization = state.civilizations.find(value => value.id === seat); assert.ok(civilization); return civilization; }
function receipt(state: WorldState) { return town(state).buildingOperations?.observatory?.lastResult; }
function time(state: WorldState): string { return coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 50, ((state.independentTurns?.lastActionWindow[0] ?? -1) + 1) * 10)); }
function allocationConserved(before: WorldState, after: WorldState): boolean {
  return after.civilizations.every(civilization => {
    const prior = actor(before, civilization.id);
    const results = after.cities.filter(city => city.civId === civilization.id).flatMap(city => Object.values(city.buildingOperations ?? {}).flatMap(operation => operation.lastResult ? [operation.lastResult] : []));
    return RESOURCE_IDS.every(resource => Math.abs(prior.resources[resource] - civilization.resources[resource] - results.reduce((sum, result) => sum + (result.paid[resource] ?? 0), 0)) < 1e-8)
      && (prior.strategicResources?.iron ?? 0) - (civilization.strategicResources?.iron ?? 0) === results.reduce((sum, result) => sum + (result.strategicPaid?.iron ?? 0), 0);
  });
}

export class ObservatoryLearningProbe {
  private path: ReturnType<typeof observatoryLearningOperationJourney> | null = null;
  private state: WorldState | null = null;
  private before: WorldState | null = null;
  private result: TransitionResult | null = null;
  private repeated: TransitionResult | null = null;
  private control: TransitionResult | null = null;
  private allocation: WorldState | null = null;
  private scarcity: Array<{ missing: string; before: WorldState; after: WorldState }> = [];
  private replayedFrames = 0;
  private operation = '';

  reset(): void { this.state = null; this.before = null; this.result = null; this.repeated = null; this.control = null; this.allocation = null; this.scarcity = []; this.replayedFrames = 0; this.operation = ''; }
  snapshot() { return structuredClone({ state: this.state, before: this.before, result: this.result, repeated: this.repeated, control: this.control, allocation: this.allocation, scarcity: this.scarcity, replayedFrames: this.replayedFrames, operation: this.operation }); }
  private getPath() { this.path ??= observatoryLearningOperationJourney(); return this.path; }
  private select(step: CoastalPrefixStep): void {
    this.before = structuredClone(step.before); this.result = replayCoastalStep(this.before, structuredClone(step.input));
    assert.deepEqual(this.before, step.before); assert.deepEqual(this.result, step.result); assert.ok(this.result.ok, this.result.error); assert.ok(isWorldState(this.result.state)); this.state = this.result.state;
  }

  call(action: string): void {
    if (!actions.includes(action)) throw new RangeError(`Unknown Observatory action ${action}`);
    const path = this.getPath(); this.operation = action; this.repeated = null; this.control = null; this.allocation = null; this.scarcity = []; this.replayedFrames = 0;
    if (action === 'refuse_observatory_action') {
      this.state ??= structuredClone(path.researched); this.before = structuredClone(this.state);
      this.result = applyCommand(this.state, { seat: 0, expectedRevision: this.state.revision, timestamp: time(this.state), action: { type: 'build', project: 'observatory', cityId: 'missing-observatory-town' } });
      assert.deepEqual(this.state, this.before); this.state = this.result.state; return;
    }
    if (action === 'replay_observatory_history') {
      this.before = structuredClone(path.journey.initial); let state = structuredClone(this.before);
      for (const step of path.journey.steps) {
        assert.deepEqual(state, step.before); const before = structuredClone(state); const result = replayCoastalStep(state, structuredClone(step.input));
        assert.deepEqual(state, before); assert.deepEqual(result, step.result); assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state)); state = result.state; this.result = result; this.replayedFrames++;
      }
      this.state = state; return;
    }
    if (action === 'block_observatory') {
      this.before = structuredClone(path.completed); this.state = structuredClone(path.completed); this.result = null;
      for (const missing of ['credits', 'residents']) {
        const before = structuredClone(path.completed);
        for (const city of before.cities) for (const [id, operation] of Object.entries(city.buildingOperations ?? {})) operation.enabled = city.id === 'city-0' && id === 'observatory';
        if (missing === 'credits') actor(before).resources.credits = 0; else town(before).population = 5;
        const after = structuredClone(before); allocateOperations(after); this.scarcity.push({ missing, before, after });
      }
      return;
    }
    const destination = action === 'start_observatory' ? path.started : action === 'complete_observatory' ? path.completed : path.operated;
    const step = path.journey.steps.find(value => value.result.state.revision === destination.revision); assert.ok(step); this.select(step); assert.ok(this.state && this.before);
    if (action === 'start_observatory') this.repeated = applyCommand(this.state, { seat: 0, expectedRevision: this.state.revision, timestamp: time(this.state), action: { type: 'build', cityId: 'city-0', project: 'observatory' } });
    if (action === 'complete_observatory') {
      const synthetic = structuredClone(this.before); const lane = town(synthetic).construction; assert.ok(lane); lane.active = null;
      const retained = structuredClone(synthetic); this.control = replayCoastalStep(synthetic, structuredClone(step.input)); assert.deepEqual(synthetic, retained); assert.ok(this.control.ok, this.control.error);
    }
    if (action === 'work_observatory') { this.allocation = structuredClone(this.before); allocateOperations(this.allocation); }
  }

  observe() {
    const state = this.state; const before = this.before; const path = this.path; const action = this.operation;
    const city = state ? town(state) : null; const active = city?.construction?.active; const order = active && !('kind' in active) ? active : null;
    const last = city?.construction?.lastCompleted; const completion = last && !('kind' in last) ? last : null;
    const highGround = order?.highGround; const campus = before?.tiles.find(tile => tile.id === highGround?.campusTileId); const source = before?.tiles.find(tile => tile.id === highGround?.sourceTileId);
    const result = state ? receipt(state) : null; const allocated = this.allocation ? receipt(this.allocation) : null;
    const exactPayment = !!state && !!before && !!order && equal(order.paid, { materials: 30, credits: 16 }) && RESOURCE_IDS.every(resource => Math.abs(actor(before).resources[resource] - actor(state).resources[resource] - (order.paid[resource] ?? 0)) < 1e-8) && equal(actor(before).strategicResources, actor(state).strategicResources);
    const paid = !!before && !!this.allocation && allocationConserved(before, this.allocation);
    return {
      initialized: state !== null,
      provenance: !state ? 'Uninitialized; no journey executed' : action === 'block_observatory' ? 'Explicit synthetic opening Credit/resident controls detached from the actual legal Observatory journey' : action === 'complete_observatory' ? 'Actual completion with explicit synthetic order-removal equal-beat comparison' : 'Actual immutable legal Observatory journey and exact engine transitions',
      replayed_frames: this.replayedFrames,
      same_town: action === 'start_observatory' && city?.id === path?.journey.cityId && city?.civId === path?.journey.seat && order?.cityId === city?.id && order?.buildingId === 'observatory',
      exact_campus: action === 'start_observatory' && !!before && !!highGround && town(before).buildings.includes('campus') && town(before).districtSites?.campus === highGround.campusTileId && campus?.owner === city?.civId,
      adjacent_high_ground: action === 'start_observatory' && !!campus && !!source && hexDistance(campus, source) === 1 && (source.terrain === 'mountain' || isHillSite(source)),
      paid_once: action === 'start_observatory' && exactPayment && this.repeated?.ok === false && equal(this.repeated.state, state) && this.repeated.events.length === 0,
      completed: action === 'complete_observatory' && city?.buildings.includes('observatory') === true && completion?.buildingId === 'observatory' && completion.cityId === city.id && !!completion.highGround && equal(completion.highGround, city.buildingHighGround?.observatory) && state?.events.some(event => event.id === completion.eventId && event.effects.includes(`Retained Campus ${completion.highGround?.campusTileId} high ground ${completion.highGround?.sourceTileId}`)) === true,
      no_completion_output: action === 'complete_observatory' && result === null && this.control?.ok === true && equal(this.control.state.civilizations, state?.civilizations),
      credits_paid: action === 'work_observatory' && paid && result?.status === 'operated' && equal(result.paid, { credits: 2 }) && equal(allocated?.paid, result.paid),
      residents_allocated: action === 'work_observatory' && result?.residents?.allocated === 3 && allocated?.residents?.allocated === 3,
      science_made: action === 'work_observatory' && !!before && result?.status === 'operated' && (result.produced.science ?? 0) > 0 && result.produced.science === Math.round(7 * cityProductivity(town(before)) * 100) / 100,
      blocked: action === 'block_observatory' && this.scarcity.length === 2 && this.scarcity.every(control => receipt(control.after)?.status === 'blocked'),
      no_payment_or_output: action === 'block_observatory' && this.scarcity.length === 2 && this.scarcity.every(control => { const value = receipt(control.after); return equal(control.before.civilizations, control.after.civilizations) && !!value && equal(value.paid, {}) && equal(value.produced, {}) && value.residents?.allocated === 0; }),
      refused: action === 'refuse_observatory_action' && this.result?.ok === false,
      no_effects: action === 'refuse_observatory_action' && this.result?.ok === false && equal(before, state) && this.result.events.length === 0,
      replay_exact: action === 'replay_observatory_history' && !!path && this.replayedFrames === path.journey.steps.length && equal(state, path.journey.state),
    };
  }
}
