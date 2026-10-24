import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { RESOURCE_IDS } from '../core/content.ts';
import { applyCommand } from '../core/engine.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { extractCityMetals, strategicCapacity } from '../core/simulation/metals.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import type { TransitionResult, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { foundryProductionOperationJourney } from '../tests/fixtures/foundry-production-journey.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixStep } from '../tests/fixtures/coastal-prefix.ts';

const actions = ['start_foundry', 'complete_foundry', 'work_foundry', 'block_foundry', 'pause_foundry', 'defer_arriving_iron', 'resume_iron_exchange', 'refuse_foundry_action', 'replay_foundry_history'];
function town(state: WorldState, id = 'city-1') { const city = state.cities.find(value => value.id === id); assert.ok(city); return city; }
function actor(state: WorldState, seat = 1) { const civilization = state.civilizations.find(value => value.id === seat); assert.ok(civilization); return civilization; }
function receipt(state: WorldState, id = 'city-1') { return town(state, id).buildingOperations?.foundry?.lastResult; }
function time(state: WorldState): string { return coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 30, ((state.independentTurns?.lastActionWindow[1] ?? -1) + 1) * 10)); }
function basis() {
  const path = foundryProductionOperationJourney(); const routeId = path.journey.previous.routeId;
  const count = path.completed.routes.find(route => route.id === routeId)?.agreement?.deliveryCount; assert.ok(count !== undefined);
  path.journey.until(() => (path.journey.state.routes.find(route => route.id === routeId)?.agreement?.deliveryCount ?? 0) > count);
  const shipment = path.journey.steps.at(-1); assert.ok(shipment);
  return { ...path, shipment };
}
function noRecipeEffects(state: WorldState): boolean {
  const value = receipt(state);
  return !!value && equal(value.paid, {}) && equal(value.strategicPaid, {}) && equal(value.produced, {}) && value.residents?.allocated === 0;
}
function allocationConserved(before: WorldState, after: WorldState): boolean {
  return after.civilizations.every(civilization => {
    const prior = actor(before, civilization.id); const receipts = after.cities.filter(city => city.civId === civilization.id).flatMap(city => Object.values(city.buildingOperations ?? {}).flatMap(operation => operation.lastResult ? [operation.lastResult] : []));
    return RESOURCE_IDS.every(resource => Math.abs(prior.resources[resource] - civilization.resources[resource] - receipts.reduce((sum, result) => sum + (result.paid[resource] ?? 0), 0)) < 1e-8)
      && (prior.strategicResources?.iron ?? 0) - (civilization.strategicResources?.iron ?? 0) === receipts.reduce((sum, result) => sum + (result.strategicPaid?.iron ?? 0), 0);
  });
}

export class FoundryProductionProbe {
  private path: ReturnType<typeof basis> | null = null;
  private state: WorldState | null = null;
  private before: WorldState | null = null;
  private result: TransitionResult | null = null;
  private repeated: TransitionResult | null = null;
  private control: TransitionResult | null = null;
  private allocation: WorldState | null = null;
  private scarcity: Array<{ missing: string; before: WorldState; after: WorldState }> = [];
  private deferred: { before: WorldState; opening: WorldState; afterExtraction: WorldState; nextOpening: WorldState; cityId: string; seat: number } | null = null;
  private replayedFrames = 0;
  private operation = '';

  reset(): void { this.state = null; this.before = null; this.result = null; this.repeated = null; this.control = null; this.allocation = null; this.scarcity = []; this.deferred = null; this.replayedFrames = 0; this.operation = ''; }
  snapshot() { return structuredClone({ state: this.state, before: this.before, result: this.result, repeated: this.repeated, control: this.control, allocation: this.allocation, scarcity: this.scarcity, deferred: this.deferred, replayedFrames: this.replayedFrames, operation: this.operation }); }
  private getPath() { this.path ??= basis(); return this.path; }
  private select(step: CoastalPrefixStep): void {
    this.before = structuredClone(step.before); this.result = replayCoastalStep(this.before, structuredClone(step.input));
    assert.deepEqual(this.before, step.before); assert.deepEqual(this.result, step.result); assert.ok(this.result.ok, this.result.error); assert.ok(isWorldState(this.result.state)); this.state = this.result.state;
  }

  call(action: string): void {
    if (!actions.includes(action)) throw new RangeError(`Unknown Foundry action ${action}`);
    this.operation = action; this.repeated = null; this.control = null; this.allocation = null; this.scarcity = []; this.deferred = null; this.replayedFrames = 0;
    const path = this.getPath(); const cityId = path.journey.cityId; const seat = path.journey.seat;
    if (action === 'refuse_foundry_action') {
      this.state ??= structuredClone(path.journey.prepared); this.before = structuredClone(this.state);
      this.result = applyCommand(this.state, { seat, expectedRevision: this.state.revision, timestamp: time(this.state), action: { type: 'build', project: 'foundry', cityId: 'missing-foundry-town' } });
      assert.deepEqual(this.state, this.before); this.state = this.result.state; return;
    }
    if (action === 'replay_foundry_history') {
      this.before = structuredClone(path.journey.initial); let state = structuredClone(this.before);
      for (const step of path.journey.steps) { assert.deepEqual(state, step.before); const before = structuredClone(state); const result = replayCoastalStep(state, structuredClone(step.input)); assert.deepEqual(state, before); assert.deepEqual(result, step.result); assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state)); state = result.state; this.result = result; this.replayedFrames++; }
      this.state = state; return;
    }
    if (action === 'pause_foundry') {
      const initial = structuredClone(path.operated); const paused = applyCommand(initial, { seat, expectedRevision: initial.revision, timestamp: time(initial), action: { type: 'set-building-operation', cityId, buildingId: 'foundry', enabled: false } });
      assert.ok(paused.ok, paused.error); assert.deepEqual(initial, path.operated); this.before = structuredClone(paused.state);
      this.result = replayCoastalStep(this.before, { kind: 'strategy', timestamp: coastalPrefixTime(((this.before.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
      assert.ok(this.result.ok, this.result.error); assert.deepEqual(this.before, paused.state); assert.ok(isWorldState(this.result.state)); this.state = this.result.state; return;
    }
    if (action === 'block_foundry' || action === 'defer_arriving_iron') {
      this.before = structuredClone(path.completed); this.state = structuredClone(path.completed); this.result = null;
      const synthetic = structuredClone(path.completed);
      for (const city of synthetic.cities) for (const operation of Object.values(city.buildingOperations ?? {})) operation.enabled = false;
      if (action === 'block_foundry') {
        const operation = town(synthetic).buildingOperations?.foundry; assert.ok(operation); operation.enabled = true; town(synthetic).population = 6; actor(synthetic).strategicResources = { iron: 1 }; actor(synthetic).resources.energy = 2;
        for (const missing of ['iron', 'energy', 'residents']) {
          const before = structuredClone(synthetic);
          if (missing === 'iron') actor(before).strategicResources = { iron: 0 }; else if (missing === 'energy') actor(before).resources.energy = 1; else town(before).population = 5;
          const after = structuredClone(before); allocateOperations(after); this.scarcity.push({ missing, before, after });
        }
      } else {
        const source = receipt(path.operated); assert.ok(source); const donor = town(synthetic, path.journey.previous.donorCityId); donor.buildings.push('foundry'); donor.population = 7; donor.buildingOperations ??= {}; donor.buildingOperations.foundry = { enabled: true, lastResult: structuredClone(source) };
        actor(synthetic, donor.civId).strategicResources = { iron: 0 }; actor(synthetic, donor.civId).resources.energy = 2;
        const before = structuredClone(synthetic); allocateOperations(synthetic); const opening = structuredClone(synthetic); extractCityMetals(synthetic, donor); const afterExtraction = structuredClone(synthetic); synthetic.round++; allocateOperations(synthetic);
        this.deferred = { before, opening, afterExtraction, nextOpening: synthetic, cityId: donor.id, seat: donor.civId };
      }
      return;
    }
    const destination = action === 'start_foundry' ? path.started : action === 'complete_foundry' ? path.completed : action === 'resume_iron_exchange' ? path.shipment.result.state : path.operated;
    const step = path.journey.steps.find(value => value.result.state.revision === destination.revision); assert.ok(step); this.select(step); assert.ok(this.state && this.before);
    if (action === 'start_foundry') this.repeated = applyCommand(this.state, { seat, expectedRevision: this.state.revision, timestamp: time(this.state), action: { type: 'build', cityId, project: 'foundry' } });
    if (action === 'complete_foundry') {
      const synthetic = structuredClone(this.before); const construction = town(synthetic).construction; assert.ok(construction); construction.active = null;
      const retained = structuredClone(synthetic); this.control = replayCoastalStep(synthetic, structuredClone(step.input)); assert.deepEqual(synthetic, retained); assert.ok(this.control.ok, this.control.error);
    }
    if (action === 'work_foundry' || action === 'resume_iron_exchange') { this.allocation = structuredClone(this.before); allocateOperations(this.allocation); }
  }

  observe() {
    const state = this.state; const before = this.before; const path = this.path; const action = this.operation;
    const city = state ? town(state) : null; const order = city?.construction?.active; const completion = city?.construction?.lastCompleted;
    const result = state ? receipt(state) : null; const allocated = this.allocation ? receipt(this.allocation) : null;
    const paid = !!before && !!this.allocation && allocationConserved(before, this.allocation);
    const operating = action === 'work_foundry' || action === 'resume_iron_exchange';
    const exactStartPayment = !!state && !!before && !!order && 'buildingId' in order && equal(order.paid, { materials: 32, credits: 16 }) && RESOURCE_IDS.every(resource => Math.abs(actor(before).resources[resource] - actor(state).resources[resource] - (order.paid[resource] ?? 0)) < 1e-8) && equal(actor(before).strategicResources, actor(state).strategicResources);
    const route = state?.routes.find(value => value.id === path?.journey.previous.routeId)?.agreement; const priorRoute = before?.routes.find(value => value.id === path?.journey.previous.routeId)?.agreement;
    const shipment = this.result?.events.find(event => event.strategicShipment?.routeId === path?.journey.previous.routeId)?.strategicShipment;
    const d = this.deferred;
    return {
      initialized: state !== null,
      provenance: state ? action === 'block_foundry' || action === 'defer_arriving_iron' ? 'Explicit synthetic opening-ledger control detached from the actual legal Foundry journey' : 'Synthetic named fresh-rule prerequisites followed by actual paid Foundry transitions; completion exclusion uses a labeled detached order-removal control' : 'Uninitialized; no journey executed',
      replayed_frames: this.replayedFrames,
      same_town: action === 'start_foundry' && city?.id === path?.journey.cityId && city?.buildings.includes('industrial-zone') === true && !!order && 'buildingId' in order && order.buildingId === 'foundry' && order.cityId === city.id,
      paid_once: action === 'start_foundry' && exactStartPayment && this.repeated?.ok === false && equal(this.repeated.state, state) && this.repeated.events.length === 0,
      completed: action === 'complete_foundry' && city?.buildings.includes('foundry') === true && !!completion && 'buildingId' in completion && completion.buildingId === 'foundry' && completion.cityId === city.id && city.construction?.active === null,
      no_completion_output: action === 'complete_foundry' && !!before && !!state && !!this.control && !town(before).buildings.includes('foundry') && result === null && equal(this.control.state.civilizations, state.civilizations),
      iron_paid: operating && result?.status === 'operated' && equal(result.strategicPaid, { iron: 1 }) && equal(result.strategicPaid, allocated?.strategicPaid) && paid,
      energy_paid: operating && result?.status === 'operated' && equal(result.paid, { energy: 2 }) && equal(result.paid, allocated?.paid) && paid,
      staffed: operating && result?.residents?.allocated === 3 && result.residents.required === 3 && equal(result.residents, allocated?.residents),
      materials_made: action === 'work_foundry' && !!before && result?.status === 'operated' && (result.produced.materials ?? 0) > 0 && result.produced.materials === Math.round(8 * cityProductivity(town(before)) * 100) / 100 && !!completion && 'buildingId' in completion && result.round > completion.completedRound,
      blocked: action === 'block_foundry' && this.scarcity.length === 3 && this.scarcity.every(value => receipt(value.after)?.status === 'blocked'),
      paused: action === 'pause_foundry' && city?.buildingOperations?.foundry?.enabled === false && result?.status === 'paused',
      no_payment_or_output: action === 'pause_foundry' ? !!state && noRecipeEffects(state) : action === 'block_foundry' && this.scarcity.length === 3 && this.scarcity.every(value => noRecipeEffects(value.after) && equal(actor(value.before).resources, actor(value.after).resources) && equal(actor(value.before).strategicResources, actor(value.after).strategicResources)),
      opening_stock_only: action === 'defer_arriving_iron' && !!d && actor(d.before, d.seat).strategicResources?.iron === 0 && receipt(d.opening, d.cityId)?.status === 'blocked' && equal(receipt(d.opening, d.cityId)?.paid, {}) && equal(receipt(d.opening, d.cityId)?.strategicPaid, {}) && actor(d.opening, d.seat).resources.energy === 2 && actor(d.afterExtraction, d.seat).strategicResources?.iron === 2 && equal(receipt(d.opening, d.cityId), receipt(d.afterExtraction, d.cityId)) && receipt(d.nextOpening, d.cityId)?.status === 'operated' && actor(d.nextOpening, d.seat).strategicResources?.iron === 1 && actor(d.nextOpening, d.seat).resources.energy === 0,
      shipment_resumed: action === 'resume_iron_exchange' && !!route && !!priorRoute && route.deliveryCount === priorRoute.deliveryCount + 1 && route.lastDeliveryRound === state?.round && equal(route.terms, priorRoute.terms) && !!shipment && equal(shipment.proposerSent, { iron: 2 }) && !!state && !!before && !!path && actor(state).strategicResources?.iron === (actor(before).strategicResources?.iron ?? 0) - (result?.strategicPaid?.iron ?? 0) + (shipment.proposerSent.iron ?? 0) - (shipment.recipientSent.iron ?? 0) && actor(path.completed).strategicResources?.iron === strategicCapacity(path.completed, 1, 'iron'),
      refused: this.result?.ok === false,
      no_effects: this.result?.ok === false && equal(this.result.state, before) && this.result.events.length === 0,
      replay_exact: action === 'replay_foundry_history' && !!path && this.replayedFrames === path.journey.steps.length && equal(state, path.shipment.result.state),
    };
  }
}
