import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { ECONOMY_RULES, RESOURCE_IDS } from '../core/content.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { createLandTransportPlanner } from '../core/simulation/transport.ts';
import type { TransitionResult, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { forestProductionOperationJourney } from '../tests/fixtures/forest-production-journey.ts';
import { mapExpansionJourney } from '../tests/fixtures/map-expansion-journey.ts';
import { waterLandTown } from '../tests/fixtures/water-land-journey.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixStep } from '../tests/fixtures/coastal-prefix.ts';

const actions = ['start_lumber_mill', 'complete_lumber_mill', 'work_lumber_mill', 'pause_forest_work', 'refuse_forest_action', 'found_new_extent_town', 'operate_new_extent_town', 'refuse_extent_action'];
const people = (state: WorldState): number => state.cities.reduce((sum, city) => sum + city.population, 0);
const time = (state: WorldState): string => coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 30);

export class ForestExtentProbe {
  private forest: ReturnType<typeof forestProductionOperationJourney> | null = null;
  private extent: ReturnType<typeof mapExpansionJourney> | null = null;
  private state: WorldState | null = null;
  private before: WorldState | null = null;
  private result: TransitionResult | null = null;
  private control: TransitionResult | null = null;
  private operation = '';

  reset(): void { this.state = null; this.before = null; this.result = null; this.control = null; this.operation = ''; }
  snapshot() { return structuredClone({ state: this.state, before: this.before, result: this.result, control: this.control, operation: this.operation }); }

  private select(step: CoastalPrefixStep): void {
    this.before = structuredClone(step.before);
    this.result = replayCoastalStep(this.before, structuredClone(step.input));
    assert.deepEqual(this.before, step.before); assert.deepEqual(this.result, step.result);
    assert.ok(this.result.ok, this.result.error); assert.ok(isWorldState(this.result.state)); this.state = this.result.state;
  }

  call(action: string): void {
    if (!actions.includes(action)) throw new RangeError(`Unknown forest-extent action ${action}`);
    this.operation = action; this.control = null;
    if (action.startsWith('refuse_')) {
      if (!this.state) { this.forest ??= forestProductionOperationJourney(); this.state = structuredClone(this.forest.ready); }
      this.before = structuredClone(this.state);
      const inner = action === 'refuse_forest_action'
        ? { type: 'improve' as const, cityId: 'missing-forest-town', tileId: 56, improvementId: 'lumber-mill' }
        : { type: 'settle' as const, sourceCityId: 'missing-extent-town', tileId: 218 };
      this.result = applyCommand(this.state, { seat: 0, expectedRevision: this.state.revision, timestamp: time(this.state), action: inner });
      assert.deepEqual(this.state, this.before); this.state = this.result.state; return;
    }
    if (['start_lumber_mill', 'complete_lumber_mill', 'work_lumber_mill', 'pause_forest_work'].includes(action)) {
      this.forest ??= forestProductionOperationJourney(); const basis = this.forest;
      const destination = action === 'start_lumber_mill' ? basis.started : action === 'complete_lumber_mill' ? basis.completed : basis.operated;
      const step = basis.journey.steps.find(value => value.result.state.revision === destination.revision); assert.ok(step); this.select(step);
      if (action === 'complete_lumber_mill') {
        const detached = structuredClone(step.before); const city = waterLandTown(detached, basis.cityId);
        assert.ok(city.construction?.active); city.construction.active = null;
        this.control = replayCoastalStep(detached, structuredClone(step.input)); assert.ok(this.control.ok);
      }
      if (action === 'pause_forest_work') {
        assert.ok(this.state);
        const paused = applyCommand(this.state, { seat: 0, expectedRevision: this.state.revision, timestamp: time(this.state), action: { type: 'set-improvement-operation', cityId: basis.cityId, tileId: basis.tileId, improvementId: 'lumber-mill', enabled: false } });
        assert.ok(paused.ok, paused.error); assert.ok(isWorldState(paused.state));
        this.before = structuredClone(paused.state);
        this.result = catchUpStrategy(this.before, coastalPrefixTime(((this.before.independentTurns?.strategyTicks ?? 0) + 1) * 60));
        assert.deepEqual(this.before, paused.state); assert.ok(this.result.ok, this.result.error); assert.ok(isWorldState(this.result.state)); this.state = this.result.state;
      }
      return;
    }
    this.extent ??= mapExpansionJourney(); const basis = this.extent;
    const destination = action === 'found_new_extent_town' ? basis.founded : basis.operated;
    const step = basis.steps.find(value => value.result.state.revision === destination.revision); assert.ok(step); this.select(step);
    if (action === 'operate_new_extent_town') {
      const detached = structuredClone(step.before);
      detached.cities = detached.cities.filter(city => city.tileId !== basis.previous.targetTileId);
      this.control = replayCoastalStep(detached, structuredClone(step.input)); assert.ok(this.control.ok, this.control.error);
    }
  }

  observe() {
    const state = this.state; const before = this.before; const action = this.operation;
    const city = state && this.forest ? waterLandTown(state, this.forest.cityId) : null;
    const oldCity = before && this.forest ? waterLandTown(before, this.forest.cityId) : null;
    const mill = city?.improvements?.[String(this.forest?.tileId)]; const operation = mill?.operation.lastResult;
    const order = city?.construction?.active;
    const opening = before && action === 'work_lumber_mill' ? structuredClone(before) : null;
    if (opening) allocateOperations(opening);
    const allocationCity = opening && this.forest ? waterLandTown(opening, this.forest.cityId) : null;
    const forestTile = before?.tiles.find(tile => tile.id === this.forest?.tileId);
    const extent = this.extent; const newTown = state && extent ? state.cities.find(town => town.tileId === extent.previous.targetTileId) : null;
    const delta = state && this.control && extent ? Object.fromEntries(RESOURCE_IDS.map(resource => [resource, Math.round(((state.civilizations[extent.previous.seat]?.resources[resource] ?? 0) - (this.control?.state.civilizations[extent.previous.seat]?.resources[resource] ?? 0)) * 100) / 100])) : null;
    const exactPayment = (seat: number, paid: Partial<Record<(typeof RESOURCE_IDS)[number], number>>): boolean => !!state && !!before && RESOURCE_IDS.every(resource => Math.abs((before.civilizations[seat]?.resources[resource] ?? 0) - (state.civilizations[seat]?.resources[resource] ?? 0) - (paid[resource] ?? 0)) < 1e-8);
    return {
      initialized: state !== null,
      provenance: state ? 'Synthetic named fresh-rule prerequisites followed by actual paid forest work or founding; named positive replays its exact retained transition' : 'Uninitialized; no fixture executed',
      control_provenance: this.control ? `Synthetic detached ${action === 'complete_lumber_mill' ? 'unfinished-order' : 'missing-new-town'} same-beat engine control` : null,
      resource_delta_against_control: delta,
      exact_owned_forest: action === 'start_lumber_mill' && forestTile?.terrain === 'forest' && forestTile.owner === oldCity?.civId && !!order && 'kind' in order && order.kind === 'improvement' && order.tileId === forestTile.id && order.improvementId === 'lumber-mill' && !!before && legalActions(before, 0, time(before)).some(option => option.action.type === 'improve' && option.action.tileId === forestTile.id && option.action.cityId === oldCity?.id && option.action.improvementId === 'lumber-mill'),
      paid_once: action === 'start_lumber_mill' ? !!order && exactPayment(0, order.paid) : action === 'found_new_extent_town' && !!extent && exactPayment(extent.previous.seat, ECONOMY_RULES.settle.cost),
      completed: action === 'complete_lumber_mill' && mill?.improvementId === 'lumber-mill' && mill.completion.tileId === this.forest?.tileId && mill.completion.orderId === oldCity?.construction?.active?.id,
      no_completion_output: action === 'complete_lumber_mill' && mill?.operation.lastResult === null && !!this.control && equal(this.control.state.civilizations[0]?.resources, state?.civilizations[0]?.resources),
      staffed: action === 'work_lumber_mill' && operation?.status === 'operated' && operation.residents.allocated === 1 && operation.residents.openingPopulation === oldCity?.population,
      materials_made: action === 'work_lumber_mill' && (operation?.produced.materials ?? 0) > 0 && equal(operation?.paid, {}) && operation?.extraction === undefined,
      shared_numeric_allocation: action === 'work_lumber_mill' && !!allocationCity && !!city && Object.entries(allocationCity.improvements ?? {}).every(([id, item]) => equal(item.operation.lastResult?.residents, city.improvements?.[id]?.operation.lastResult?.residents)) && Object.entries(allocationCity.buildingOperations ?? {}).every(([id, item]) => equal(item.lastResult?.residents, city.buildingOperations?.[id]?.lastResult?.residents)),
      paused_or_ineligible: action === 'pause_forest_work' && mill?.operation.enabled === false && operation?.status === 'paused',
      no_payment_or_output: action === 'pause_forest_work' && operation?.residents.allocated === 0 && equal(operation.paid, {}) && equal(operation.produced, {}),
      new_site_reachable: action === 'found_new_extent_town' && !!before && !!extent && createLandTransportPlanner(before).quote(extent.previous.frontierTileId, extent.previous.targetTileId) !== null,
      new_town_founded: action === 'found_new_extent_town' && !!newTown && !!before && !before.cities.some(town => town.id === newTown.id) && newTown.civId === extent?.previous.seat,
      population_conserved: action === 'found_new_extent_town' && !!state && !!before && people(state) === people(before),
      only_claimed_center_owned: action === 'found_new_extent_town' && !!state && !!before && !!newTown && state.tiles.every((tile, index) => tile.id === newTown.tileId ? tile.owner === newTown.civId && before.tiles[index]?.owner === null : equal(tile, before.tiles[index])),
      later_base_output: action === 'operate_new_extent_town' && !!newTown && !!before && !!state && state.round > before.round && newTown.buildings.length === 0 && !!delta && (delta.materials ?? 0) > 0,
      refused: this.result?.ok === false,
      no_effects: this.result?.ok === false && equal(this.result.state, before) && this.result.events.length === 0,
    };
  }
}
