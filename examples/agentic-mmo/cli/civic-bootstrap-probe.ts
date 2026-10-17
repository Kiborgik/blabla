import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { BUILDINGS, GOVERNMENTS, RESOURCE_IDS, ECONOMY_RULES, IMPROVEMENTS } from '../core/content.ts';
import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import { constructionWork } from '../core/simulation/construction.ts';
import { governmentActionBlock } from '../core/simulation/government.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import { allocateOperations, paidRecipe, productiveBuildings } from '../core/simulation/operations.ts';
import { buildingBaseProduction } from '../core/simulation/districts.ts';
import { orderedImprovements } from '../core/simulation/improvements.ts';
import { wonderBaseProduction } from '../core/simulation/wonders.ts';
import { siteProduction } from '../core/simulation/sites.ts';
import { isWorldState } from '../core/validation.ts';
import type { GameAction, Resources, TransitionResult, WorldState } from '../core/types.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixStep } from '../tests/fixtures/coastal-prefix.ts';
import { civicBootstrapJourney } from '../tests/fixtures/civic-bootstrap-journey.ts';

const actions = ['adopt_civic_release', 'start_civic', 'invest_culture', 'complete_civic', 'adopt_arrangement', 'work_with_arrangement', 'resolve_government_transition', 'refuse_civic_action', 'replay_civic_history'];
function actor(state: WorldState) { const result = state.civilizations.find(candidate => candidate.id === 0); assert.ok(result); return result; }
function time(state: WorldState): string { return coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ((state.independentTurns?.lastActionWindow[0] ?? -1) + 1) * 10)); }
function nextBeat(state: WorldState): TransitionResult { const result = catchUpStrategy(state, coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60)); assert.ok(result.ok, result.error); return result; }
function command(state: WorldState, action: GameAction) { return applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: time(state), action }); }
function round(value: number): number { return Math.round(value * 100) / 100; }
function production(result: TransitionResult, resource: string): number { const event = result.events.find(candidate => candidate.type === 'settlement-production' && candidate.actor === 0); const effect = event?.effects.find(candidate => candidate.endsWith(` ${resource}`)); assert.ok(effect); return Number(effect.split(' ')[1]); }
function science(state: WorldState) { const civilization = actor(state); return { resources: civilization.resources.science, technologies: civilization.technologies, target: civilization.researchTarget, progress: civilization.researchProgress, completion: civilization.lastResearchCompletion }; }
function ordinaryOutputs(state: WorldState, multiplier: number): Resources {
  const allocated = structuredClone(state); allocateOperations(allocated);
  const result: Resources = { food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 };
  for (const city of allocated.cities.filter(candidate => candidate.civId === 0)) {
    const buildings = productiveBuildings(allocated, city); const free = buildings.filter(building => !paidRecipe(building)); const paid = buildings.filter(paidRecipe);
    const tile = allocated.tiles.find(candidate => candidate.id === city.tileId); assert.ok(tile);
    const terrain = siteProduction(allocated, tile); const focus: Partial<Resources> = ECONOMY_RULES.focusProduction[city.focus];
    const improvements = orderedImprovements(city).filter(item => item.operation.lastResult?.status === 'operated');
    for (const resource of RESOURCE_IDS) {
      const raw = (ECONOMY_RULES.baseProduction[resource] ?? 0) + (resource === 'food' ? 1 : 0) + (focus[resource] ?? 0) + (terrain[resource] ?? 0) + (wonderBaseProduction(allocated, city)[resource] ?? 0) + free.reduce((sum, building) => sum + (buildingBaseProduction(allocated, city, building)[resource] ?? 0), 0) + paid.reduce((sum, building) => sum + (building.production[resource] ?? 0), 0) + improvements.reduce((sum, improvement) => sum + (IMPROVEMENTS.find(definition => definition.id === improvement.improvementId)?.production[resource] ?? 0), 0);
      result[resource] = round(result[resource] + round(raw * cityProductivity(city) * multiplier));
    }
  }
  return result;
}

function paidInputs(result: TransitionResult) { return result.state.cities.filter(city => city.civId === 0).flatMap(city => Object.values(city.buildingOperations ?? {}).map(operation => operation.lastResult?.paid)); }
function exempt(result: TransitionResult) { return { extractions: result.events.flatMap(event => event.strategicExtraction ? [event.strategicExtraction] : []), transfers: result.events.filter(event => /trade|shipment/.test(event.type)) }; }

export class CivicBootstrapProbe {
  private path: ReturnType<typeof civicBootstrapJourney> | null = null;
  private state: WorldState | null = null;
  private before: WorldState | null = null;
  private result: TransitionResult | null = null;
  private control: TransitionResult | null = null;
  private operation = '';
  private predicates: Record<string, boolean> = {};
  private replayedFrames = 0;
  private transition: TransitionResult[] = [];

  reset(): void { this.state = null; this.before = null; this.result = null; this.control = null; this.operation = ''; this.predicates = {}; this.replayedFrames = 0; this.transition = []; }
  snapshot() { return structuredClone({ state: this.state, before: this.before, result: this.result, control: this.control, operation: this.operation, predicates: this.predicates, replayedFrames: this.replayedFrames, transition: this.transition }); }
  private getPath() { this.path ??= civicBootstrapJourney(); return this.path; }
  private select(step: CoastalPrefixStep): void { this.before = structuredClone(step.before); this.result = replayCoastalStep(this.before, structuredClone(step.input)); assert.deepEqual(this.before, step.before); assert.deepEqual(this.result, step.result); assert.ok(this.result.ok, this.result.error); assert.ok(isWorldState(this.result.state)); this.state = this.result.state; }

  call(action: string): void {
    if (!actions.includes(action)) throw new RangeError(`Unknown civic action ${action}`);
    const path = this.getPath(); this.operation = action; this.predicates = {}; this.control = null; this.replayedFrames = 0; this.transition = [];
    if (action === 'replay_civic_history') {
      this.before = structuredClone(path.initial); let state = structuredClone(path.initial);
      for (const step of path.steps) { assert.deepEqual(state, step.before); const retained = structuredClone(state); const result = replayCoastalStep(state, structuredClone(step.input)); assert.deepEqual(state, retained); assert.deepEqual(result, step.result); assert.ok(isWorldState(result.state)); state = result.state; this.result = result; this.replayedFrames++; }
      this.state = state; this.predicates = { replay_exact: equal(state, path.operated) && this.replayedFrames === path.steps.length, legacy_preserved: equal(path.beforeRelease.civilizations.map(civilization => civilization.technologies), path.adopted.civilizations.map(civilization => civilization.technologies)) }; return;
    }
    if (action === 'refuse_civic_action') {
      this.state ??= structuredClone(path.adopted); this.before = structuredClone(this.state); this.result = command(this.state, { type: 'adopt-government', governmentId: 'missing-government', assignments: [] }); this.state = this.result.state;
      this.predicates = { refused: !this.result.ok, no_effects: equal(this.state, this.before) && this.result.events.length === 0 }; return;
    }
    if (action === 'resolve_government_transition') { this.switchControl(); return; }
    const destination = action === 'adopt_civic_release' ? path.adopted : action === 'start_civic' ? path.selected : action === 'invest_culture' ? path.invested : action === 'complete_civic' ? path.completed : action === 'adopt_arrangement' ? path.arranged : path.built;
    const step = path.steps.find(candidate => candidate.result.state.revision === destination.revision); assert.ok(step); this.select(step); assert.ok(this.before && this.state && this.result);
    const before = actor(this.before); const after = actor(this.state);
    if (action === 'adopt_civic_release') this.predicates = {
      migrated_empty: this.state.civilizations.every(civilization => equal(civilization.civics, { ruleVersion: 1, completedCivicIds: [], active: null, lastCompleted: null, reformEntitlement: null }) && equal(civilization.government, { ruleVersion: 1, lastSpentReformCompletionEventId: null, active: null, pending: null })),
      legacy_preserved: equal(science(this.before), science(this.state)) && equal(this.before.cities, this.state.cities) && equal(this.before.tiles, this.state.tiles) && equal(this.before.independentTurns, this.state.independentTurns) && this.before.year === this.state.year && this.before.clockTicks === this.state.clockTicks && this.before.civilizations.every((civilization, index) => equal(civilization.resources, this.state?.civilizations[index]?.resources)),
    };
    if (action === 'start_civic') this.predicates = { selected_explicitly: before.civics?.active === null && after.civics?.active?.civicId === 'code-of-laws', cost_snapshotted: after.civics?.active?.requiredCulture === 16 && after.civics.active.progress === 0 && equal(before.resources, after.resources), science_independent: equal(science(this.before), science(this.state)) };
    if (action === 'invest_culture') {
      const idle = structuredClone(this.before); assert.ok(actor(idle).civics); actor(idle).civics = { ...actor(idle).civics, ruleVersion: 1, completedCivicIds: [], active: null, lastCompleted: null, reformEntitlement: null };
      this.control = replayCoastalStep(idle, structuredClone(step.input)); assert.ok(this.control.ok); const active = before.civics?.active; assert.ok(active);
      const expected = Math.min(production(this.control, 'culture'), actor(this.control.state).resources.culture, active.requiredCulture - active.progress);
      const actual = round((after.civics?.active?.progress ?? active.requiredCulture) - active.progress);
      this.predicates = { current_culture_only: actual === expected, culture_conserved: after.resources.culture === round(actor(this.control.state).resources.culture - expected), science_independent: equal(science(this.state), science(this.control.state)) };
    }
    if (action === 'complete_civic') {
      const completion = this.result.events.find(event => event.type === 'civic-completed' && event.actor === 0);
      const repeated = nextBeat(this.state);
      this.predicates = { completed_once: this.result.events.filter(event => event.type === 'civic-completed' && event.actor === 0).length === 1 && repeated.events.every(event => event.type !== 'civic-completed' || event.actor !== 0) && equal(after.civics?.completedCivicIds, ['code-of-laws']), entitlement_exact: !!completion && equal(after.civics?.lastCompleted, { civicId: 'code-of-laws', completedRound: completion.round, eventId: completion.id }) && equal(after.civics?.reformEntitlement, { civicId: 'code-of-laws', completedRound: completion.round, completionEventId: completion.id }), successor_unselected: after.civics?.active === null };
    }
    if (action === 'adopt_arrangement') {
      const active = after.government?.active; assert.ok(active); const refused = command(this.state, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] });
      this.predicates = { target_prerequisites: !!before.civics?.completedCivicIds.includes('code-of-laws'), assignments_valid: governmentActionBlock(this.before, 0, active.governmentId, active.assignments) === null && equal(active.assignments, [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }]), payment_exact: after.resources.credits === before.resources.credits && after.civics?.reformEntitlement === null && after.government?.lastSpentReformCompletionEventId === before.civics?.lastCompleted?.eventId, commitment_enforced: active.governmentLockUntilRound === this.state.round + 4 && active.policyLockUntilRound === this.state.round + 4 && !refused.ok && equal(refused.state, this.state) };
    }
    if (action === 'work_with_arrangement') this.workControl(step);
  }

  private workControl(step: CoastalPrefixStep): void {
    const path = this.getPath(); assert.ok(this.before && this.state && this.result);
    const city = this.before.cities.find(candidate => candidate.id === path.cityId); const built = this.state.cities.find(candidate => candidate.id === path.cityId); assert.ok(city?.construction?.active && built);
    const order = city.construction.active; const expectedWork = round(((city.focus === 'industry' ? 2 : 1) + 1) * cityProductivity(city));
    const idle = structuredClone(this.before); const idleCity = idle.cities.find(candidate => candidate.id === city.id); assert.ok(idleCity?.construction); idleCity.construction.active = null;
    this.control = replayCoastalStep(idle, structuredClone(step.input)); assert.ok(this.control.ok);
    const noFood = structuredClone(path.arranged); const government = actor(noFood).government; assert.ok(government); government.active = null;
    const withFood = nextBeat(path.arranged); const withoutFood = nextBeat(noFood);
    const foodDifference = round(path.arranged.cities.filter(candidate => candidate.civId === 0).reduce((sum, candidate) => sum + cityProductivity(candidate), 0));
    const withoutBuilding = structuredClone(path.built); const removed = withoutBuilding.cities.find(candidate => candidate.id === city.id); assert.ok(removed); removed.buildings = removed.buildings.filter(id => id !== path.buildingId);
    const laterControl = nextBeat(withoutBuilding); const definition = BUILDINGS.find(candidate => candidate.id === path.buildingId); assert.ok(definition);
    this.predicates = { opening_food_exact: round(production(withFood, 'food') - production(withoutFood, 'food')) === foodDifference, opening_work_exact: constructionWork(this.before, city) === expectedWork && order.workDone + expectedWork >= order.workRequired && built.construction?.lastCompleted?.workRequired === order.workRequired, completion_before_output: equal(this.state.civilizations.map(civilization => civilization.resources), this.control.state.civilizations.map(civilization => civilization.resources)) && built.buildings.includes(path.buildingId) && production(path.operationStep.result, 'food') > production(laterControl, 'food') && (definition.production.food ?? 0) > 0 };
  }

  private switchControl(): void {
    const path = this.getPath(); let state = structuredClone(path.arranged);
    for (let count = 0; count < 4; count++) state = nextBeat(state).state;
    GOVERNMENTS.push({ id: 'synthetic-probe-council', name: 'Synthetic probe council', requiredFeatures: ['civic-bootstrap'], requires: ['code-of-laws'], slots: { military: 0, economic: 1, diplomatic: 0, wildcard: 0 }, baseProduction: { food: 3 } });
    try {
      this.before = structuredClone(state); const accepted = command(state, { type: 'adopt-government', governmentId: 'synthetic-probe-council', assignments: [] }); assert.ok(accepted.ok, accepted.error);
      const control = structuredClone(accepted.state); const government = actor(control).government; assert.ok(government); government.pending = null;
      this.control = nextBeat(control); const first = nextBeat(accepted.state); const second = nextBeat(first.state); const third = nextBeat(second.state);
      this.transition = [accepted, first, second, third]; this.result = second; this.state = second.state;
      const opening = structuredClone(accepted.state); opening.round++; const ordinary = ordinaryOutputs(opening, 1); const reduced = ordinaryOutputs(opening, 0.75);
      const active = actor(second.state).government?.active; const refused = command(accepted.state, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] });
      const controlResult = this.control;
      this.predicates = { transition_timing_exact: actor(first.state).government?.active?.governmentId === 'chiefdom' && actor(first.state).government?.pending?.completionRound === state.round + 2 && active?.governmentId === 'synthetic-probe-council' && active.effectiveRound === state.round + 2 && actor(second.state).government?.pending === null && second.events.filter(event => event.type === 'transition-completed').length === 1 && third.events.every(event => event.type !== 'transition-completed'), transition_outputs_exact: RESOURCE_IDS.every(resource => round(actor(controlResult.state).resources[resource] - actor(first.state).resources[resource]) === round(ordinary[resource] - reduced[resource])), fixed_transfers_preserved: equal(paidInputs(first), paidInputs(this.control)) && equal(exempt(first), exempt(this.control)), commitment_enforced: active?.governmentLockUntilRound === state.round + 6 && active.policyLockUntilRound === state.round + 6 && !refused.ok && equal(refused.state, accepted.state) };
    } finally { GOVERNMENTS.pop(); }
  }

  observe() { return { initialized: this.state !== null, ...this.predicates, replayed_frames: this.replayedFrames, provenance: this.operation === 'resolve_government_transition' ? 'Actual generic switch actions with a synthetic advanced-government definition; not a released advanced government' : this.operation === 'work_with_arrangement' || this.operation === 'invest_culture' ? 'Legal civic journey with explicitly synthetic idle, modifier-removal and construction-removal controls' : 'Legal Observatory-to-civic journey and exact deterministic replay' }; }
}
