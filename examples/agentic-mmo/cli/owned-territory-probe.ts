import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { applyCommand } from '../core/engine.ts';
import { RESOURCE_IDS } from '../core/content.ts';
import { createTerritoryPlanner } from '../core/simulation/territory.ts';
import type { TransitionResult, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { ownedTerritoryPastureJourney, ownedTerritoryForestJourney } from '../tests/fixtures/owned-territory-journey.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixStep } from '../tests/fixtures/coastal-prefix.ts';

const actions = ['adopt_territory', 'purchase_exact_land', 'work_purchased_resource', 'work_new_extent_land', 'refuse_territory_action', 'replay_territory_history'];

export class OwnedTerritoryProbe {
  private pasture: ReturnType<typeof ownedTerritoryPastureJourney> | null = null;
  private forest: ReturnType<typeof ownedTerritoryForestJourney> | null = null;
  private state: WorldState | null = null;
  private before: WorldState | null = null;
  private result: TransitionResult | null = null;
  private replayExpected: WorldState | null = null;
  private replayedFrames = 0;
  private operation = '';

  reset(): void { this.state = null; this.before = null; this.result = null; this.replayExpected = null; this.replayedFrames = 0; this.operation = ''; }
  snapshot() { return structuredClone({ state: this.state, before: this.before, result: this.result, replayExpected: this.replayExpected, replayedFrames: this.replayedFrames, operation: this.operation }); }

  private basis() {
    this.pasture ??= this.forest?.pasture ?? ownedTerritoryPastureJourney();
    return this.pasture;
  }

  private select(step: CoastalPrefixStep): void {
    this.before = structuredClone(step.before);
    this.result = replayCoastalStep(this.before, structuredClone(step.input));
    assert.deepEqual(this.before, step.before); assert.deepEqual(this.result, step.result);
    assert.ok(this.result.ok, this.result.error); assert.ok(isWorldState(this.result.state)); this.state = this.result.state;
  }

  call(action: string): void {
    if (!actions.includes(action)) throw new RangeError(`Unknown territory action ${action}`);
    this.operation = action; this.replayExpected = null; this.replayedFrames = 0;
    if (action === 'refuse_territory_action') {
      this.state ??= structuredClone(this.basis().journey.adopted);
      this.before = structuredClone(this.state);
      this.result = applyCommand(this.state, { seat: 2, expectedRevision: this.state.revision, timestamp: coastalPrefixTime((this.state.independentTurns?.strategyTicks ?? 0) * 60 + 30), action: { type: 'acquire-tile', cityId: 'missing-territory-town', tileId: 164 } });
      assert.deepEqual(this.state, this.before); this.state = this.result.state; return;
    }
    if (action === 'work_new_extent_land' || action === 'replay_territory_history') {
      this.forest ??= ownedTerritoryForestJourney(); const basis = this.forest;
      if (action === 'replay_territory_history') {
        this.before = structuredClone(basis.journey.initial); let state = structuredClone(this.before);
        for (const step of basis.journey.steps) {
          assert.deepEqual(state, step.before); const before = structuredClone(state);
          const result = replayCoastalStep(state, structuredClone(step.input));
          assert.deepEqual(state, before); assert.deepEqual(result, step.result); assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state));
          state = result.state; this.result = result; this.replayedFrames++;
        }
        this.state = state; this.replayExpected = structuredClone(basis.operated); return;
      }
      const step = basis.journey.steps.find(value => value.result.state.revision === basis.operated.revision); assert.ok(step); this.select(step); return;
    }
    const basis = this.basis();
    const destination = action === 'adopt_territory' ? basis.journey.adopted : action === 'purchase_exact_land' ? basis.purchased : basis.operated;
    const step = basis.journey.steps.find(value => value.result.state.revision === destination.revision); assert.ok(step); this.select(step);
  }

  observe() {
    const state = this.state; const before = this.before; const action = this.operation;
    const basis = this.pasture ?? this.forest?.pasture;
    const tileId = action === 'work_new_extent_land' ? 237 : 164;
    const receipt = state?.tileAcquisitions?.[String(tileId)];
    const city = state?.cities.find(town => town.id === receipt?.cityId);
    const improvement = city?.improvements?.[String(tileId)]; const operation = improvement?.operation.lastResult;
    const quote = before && basis && action === 'purchase_exact_land' ? createTerritoryPlanner(before).assess(basis.seat, basis.cityId, 164).quote : null;
    const purchaseEvents = this.result?.events.filter(event => event.type === 'territory-acquired') ?? [];
    const paid = action === 'purchase_exact_land' && !!state && !!before && !!receipt && RESOURCE_IDS.every(resource => Math.abs((before.civilizations[receipt.civId]?.resources[resource] ?? 0) - (state.civilizations[receipt.civId]?.resources[resource] ?? 0) - (resource === 'credits' ? receipt.paid.credits : 0)) < 1e-8);
    const priorReceipts = before?.tileAcquisitions ?? {};
    const existingReceiptsPreserved = !!state && Object.entries(priorReceipts).every(([key, value]) => equal(state.tileAcquisitions?.[key], value));
    const worked = action === 'work_purchased_resource' || action === 'work_new_extent_land';
    const preservedKeys: Array<keyof WorldState> = ['tiles', 'cities', 'civilizations', 'routes', 'treaties', 'strategicDeposits', 'pastoralSites', 'rng', 'round', 'year', 'clockTicks', 'independentTurns'];
    return {
      initialized: state !== null,
      provenance: state ? 'Actual immutable legal engine journeys from initialized world; no patched ownership stock research population or era' : 'Uninitialized; no fixture executed',
      replayed_frames: this.replayedFrames,
      adopted: action === 'adopt_territory' && state?.unlockedFeatures.includes('owned-territory') === true && equal(state.tileAcquisitions, {}) && this.result?.ok === true,
      old_ownership_unchanged: action === 'adopt_territory' && !!state && !!before && preservedKeys.every(key => equal(state[key], before[key])),
      exact_beneficiary: action === 'purchase_exact_land' && !!receipt && !!quote && receipt.cityId === quote.cityId && receipt.civId === quote.civId && receipt.cityTileId === quote.cityTileId && receipt.tileId === quote.tileId && receipt.cityId === basis?.cityId,
      paid_once: paid && !!state && !!receipt && !!quote && equal(receipt.paid, quote.paid) && receipt.priorCivilizationPurchases === quote.priorCivilizationPurchases && existingReceiptsPreserved && Object.keys(state.tileAcquisitions ?? {}).length === Object.keys(priorReceipts).length + 1 && purchaseEvents.length === 1 && equal(purchaseEvents[0]?.territoryAcquisition, receipt),
      connected_path_retained: action === 'purchase_exact_land' && !!receipt && !!quote && equal(receipt.pathTileIds, quote.pathTileIds) && equal(receipt.pathTileIds, [199, 181, 164]) && receipt.distance === quote.distance,
      actual_owner_changed: action === 'purchase_exact_land' && !!state && !!before && !!receipt && state.tiles.every((tile, index) => tile.id === receipt.tileId ? before.tiles[index]?.owner === null && tile.owner === receipt.civId && equal({ ...tile, owner: null }, before.tiles[index]) : equal(tile, before.tiles[index])),
      same_town_worked: worked && !!receipt && !!city && !!improvement && city.civId === receipt.civId && city.tileId === receipt.cityTileId && improvement.completion.cityId === receipt.cityId && improvement.completion.tileId === receipt.tileId && improvement.improvementId === (tileId === 164 ? 'pasture' : 'lumber-mill'),
      later_staffed_output: worked && !!before && !!improvement && operation?.status === 'operated' && operation.round > improvement.completion.completedRound && operation.residents.allocated === 1 && operation.residents.openingPopulation === before.cities.find(town => town.id === city?.id)?.population && (operation.produced[tileId === 164 ? 'food' : 'materials'] ?? 0) > 0 && equal(operation.paid, {}) && operation.extraction === undefined,
      retained_resource_unchanged: action === 'work_purchased_resource' && !!state && !!basis && equal(state.pastoralSites, basis.journey.adopted.pastoralSites) && state.pastoralSites?.tileIds.includes(164) === true,
      history_retained: action === 'replay_territory_history' && !!this.forest && this.replayedFrames === this.forest.journey.steps.length && equal(state, this.replayExpected) && equal(state?.tileAcquisitions, this.forest.operated.tileAcquisitions),
      refused: this.result?.ok === false,
      no_effects: this.result?.ok === false && equal(this.result.state, before) && this.result.events.length === 0,
    };
  }
}
