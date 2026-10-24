import { IMPROVEMENTS, RESIDENT_CAPACITY_RULES } from '../content.ts';
import { drainageFacts, type DrainageNode } from '../drainage.ts';
import { RIVER_INTAKE_RULES } from '../river-intake-content.ts';
import type { RiverFlowPlan } from '../river-intake-types.ts';
import type { City, CityImprovement, GameEvent, ImprovementOperationResult, Resources, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';
import { improvementSiteBlock } from './improvements.ts';
import { civilizationById } from './world.ts';

export function riverDrainageNodes(state: WorldState): Map<number, DrainageNode> | null {
  if (!state.drainage || state.drainage.width !== state.width || state.drainage.height !== state.height) return null;
  try {
    return new Map(drainageFacts(state.drainage, state.tiles).map(node => [node.tileId, node]));
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function riverIntakeSiteBlock(state: WorldState, city: City, tileId: number, nodes: ReadonlyMap<number, DrainageNode> | null, installed = false, reservationOrderId?: string): string | null {
  const definition = IMPROVEMENTS.find(candidate => candidate.id === RIVER_INTAKE_RULES.improvementId);
  const actor = state.civilizations.find(candidate => candidate.id === city.civId);
  if (!definition || !hasFeatures(state, definition.requiredFeatures)) return 'River intake operation requires its released features';
  if (!actor || actor.era < definition.minEra || definition.requires.some(technology => !actor.technologies.includes(technology))) return 'The river intake requires completed Water management';
  const center = state.tiles.find(tile => tile.id === city.tileId);
  if (!center || center.owner !== city.civId || !city.buildings.includes(RIVER_INTAKE_RULES.supportBuildingId)) return 'The river intake requires its exact owned town and completed Irrigation';
  const site = state.tiles.find(tile => tile.id === tileId);
  const node = nodes?.get(tileId);
  if (!site || site.terrain === 'ocean' || site.terrain === 'mountain' || !node || node.downstreamTileId === null || node.contributingLandTiles < RIVER_INTAKE_RULES.minimumContributingLand) return 'The river intake requires a current canonical riverbank with at least eight contributing land tiles';
  if (Object.values(city.improvements ?? {}).some(improvement => improvement.improvementId === RIVER_INTAKE_RULES.improvementId && !(installed && improvement.tileId === tileId))) return 'This town already has its one river intake';
  const active = city.construction?.active;
  if (active && 'kind' in active && active.kind === 'improvement' && active.improvementId === RIVER_INTAKE_RULES.improvementId && !(active.id === reservationOrderId && active.tileId === tileId)) return 'This town already reserved its one river intake';
  return null;
}

function openingIntakeResult(state: WorldState, city: City, available: number, budget: Resources): ImprovementOperationResult {
  return {
    round: state.round, status: 'paused', paid: {}, produced: {}, blockedReason: null,
    inputs: [{ resource: 'materials', required: RIVER_INTAKE_RULES.materialsPerOperation, available: budget.materials }], shortages: [],
    residents: { ruleVersion: RESIDENT_CAPACITY_RULES.ruleVersion, openingPopulation: city.population, communityReserve: RESIDENT_CAPACITY_RULES.communityReserve, required: RIVER_INTAKE_RULES.residentsPerOperation, available, allocated: 0 },
  };
}

export function allocateRiverIntakes(state: WorldState, budgets: Map<number, Resources>, residentBudgets: Map<string, number>): RiverFlowPlan | null {
  if (!hasFeatures(state, [RIVER_INTAKE_RULES.featureId]) && !state.cities.some(city => Object.values(city.improvements ?? {}).some(improvement => improvement.improvementId === RIVER_INTAKE_RULES.improvementId))) return null;
  const nodes = riverDrainageNodes(state);
  const definition = IMPROVEMENTS.find(candidate => candidate.id === RIVER_INTAKE_RULES.improvementId);
  const byTile = new Map<number, Array<{ city: City; improvement: CityImprovement }>>();
  for (const city of state.cities.toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    for (const improvement of Object.values(city.improvements ?? {}).filter(item => item.improvementId === RIVER_INTAKE_RULES.improvementId).toSorted((a, b) => a.tileId - b.tileId)) {
      if (improvement.completion.completedRound >= state.round) continue;
      const budget = budgets.get(city.civId); if (!budget) throw new RangeError('A river intake requires its existing civilization budget');
      improvement.operation.lastResult = openingIntakeResult(state, city, residentBudgets.get(city.id) ?? 0, budget);
      if (improvement.operation.enabled) { improvement.operation.lastResult.status = 'blocked'; improvement.operation.lastResult.blockedReason = 'site-ineligible'; }
      const entries = byTile.get(improvement.tileId) ?? []; entries.push({ city, improvement }); byTile.set(improvement.tileId, entries);
    }
  }
  if (!nodes) return null;
  const plan: RiverFlowPlan = { ruleVersion: RIVER_INTAKE_RULES.ruleVersion, ruleId: RIVER_INTAKE_RULES.ruleId, round: state.round, sourceUnits: 0, withdrawals: [], outlets: [] };
  const incoming = new Map<number, number>();
  for (const tile of state.tiles.toSorted((a, b) => b.elevation - a.elevation || a.id - b.id)) {
    const node = nodes.get(tile.id)!;
    let remaining = incoming.get(tile.id) ?? 0;
    if (tile.terrain !== 'ocean') { remaining += RIVER_INTAKE_RULES.runoffPerLandTile; plan.sourceUnits += RIVER_INTAKE_RULES.runoffPerLandTile; }
    for (const { city, improvement } of byTile.get(tile.id) ?? []) {
      const budget = budgets.get(city.civId)!;
      const available = residentBudgets.get(city.id) ?? 0;
      const result = openingIntakeResult(state, city, available, budget);
      improvement.operation.lastResult = result;
      const support = city.buildings.includes(RIVER_INTAKE_RULES.supportBuildingId) ? city.buildingOperations?.[RIVER_INTAKE_RULES.supportBuildingId]?.lastResult : undefined;
      const supportAllocationRound = support?.status === 'operated' && support.round === state.round ? state.round : null;
      if (tile.terrain !== 'ocean' && node.downstreamTileId !== null) result.river = {
        ruleVersion: RIVER_INTAKE_RULES.ruleVersion, ruleId: RIVER_INTAKE_RULES.ruleId,
        tileId: tile.id, downstreamTileId: node.downstreamTileId, outletTileId: node.outletTileId,
        required: RIVER_INTAKE_RULES.flowPerOperation, availableBefore: remaining, withdrawn: 0, remainingAfter: remaining,
        supportBuildingId: RIVER_INTAKE_RULES.supportBuildingId, supportAllocationRound,
      };
      if (!improvement.operation.enabled) continue;
      result.status = 'blocked';
      if (!definition || improvementSiteBlock(state, city, definition, tile.id, true, undefined, nodes)) { result.blockedReason = 'site-ineligible'; continue; }
      if (supportAllocationRound === null) { result.blockedReason = 'support-unfunded'; continue; }
      if (budget.materials < RIVER_INTAKE_RULES.materialsPerOperation) { result.blockedReason = 'input-shortage'; result.shortages = result.inputs!.map(input => ({ ...input })); continue; }
      if (available < RIVER_INTAKE_RULES.residentsPerOperation) { result.blockedReason = 'resident-shortage'; continue; }
      if (remaining < RIVER_INTAKE_RULES.flowPerOperation) { result.blockedReason = 'flow-shortage'; continue; }
      budget.materials -= RIVER_INTAKE_RULES.materialsPerOperation;
      civilizationById(state, city.civId).resources.materials -= RIVER_INTAKE_RULES.materialsPerOperation;
      residentBudgets.set(city.id, available - RIVER_INTAKE_RULES.residentsPerOperation);
      remaining -= RIVER_INTAKE_RULES.flowPerOperation;
      result.status = 'operated'; result.blockedReason = null; result.paid.materials = RIVER_INTAKE_RULES.materialsPerOperation;
      result.residents.allocated = RIVER_INTAKE_RULES.residentsPerOperation;
      result.river!.withdrawn = RIVER_INTAKE_RULES.flowPerOperation; result.river!.remainingAfter = remaining;
      plan.withdrawals.push({ cityId: city.id, civId: city.civId, tileId: tile.id, orderId: improvement.completion.orderId, quantity: RIVER_INTAKE_RULES.flowPerOperation });
    }
    if (node.downstreamTileId === null) plan.outlets.push({ tileId: tile.id, quantity: remaining });
    else incoming.set(node.downstreamTileId, (incoming.get(node.downstreamTileId) ?? 0) + remaining);
  }
  plan.outlets.sort((a, b) => a.tileId - b.tileId);
  return hasFeatures(state, [RIVER_INTAKE_RULES.featureId]) ? plan : null;
}

export function recordRiverFlow(state: WorldState, plan: RiverFlowPlan | null, events: GameEvent[]): void {
  if (!plan) return;
  if (!state.riverFlow || plan.round !== state.round || state.riverFlow.lastBeat?.round === state.round) throw new RangeError('River flow recording requires a fresh current completed economy beat');
  const event = emitEvent(state, events, {
    type: 'river-flow', title: 'River intakes complete a flow season', detail: `${plan.ruleId} at strategic round ${plan.round}`,
    actor: null, target: null, tileId: null,
    cause: 'One renewable runoff unit per land tile followed actual downhill links; all ordinary paid work reserved first, then fully funded intakes withdrew in upstream order with zero return flow',
    effects: [`Land-source units ${plan.sourceUnits}`, `Withdrawn ${plan.withdrawals.reduce((sum, withdrawal) => sum + withdrawal.quantity, 0)}`, `Ocean outlet residual ${plan.outlets.reduce((sum, outlet) => sum + outlet.quantity, 0)}`, ...plan.withdrawals.map(withdrawal => `${withdrawal.cityId}/${withdrawal.tileId}/${withdrawal.orderId}: withdrew ${withdrawal.quantity}`)],
    importance: plan.withdrawals.length ? 2 : 1,
  });
  state.riverFlow.lastBeat = { ...structuredClone(plan), eventId: event.id };
}
