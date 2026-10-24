import { WOODLAND_RULES } from '../woodland-content.ts';
import type { WoodlandBeatEntry, WoodlandImprovementId, WoodlandOperationReceipt, WoodlandPlan, WoodlandState } from '../woodland-types.ts';
import type { City, CityImprovement, GameEvent, HexTile, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';

export function isWoodlandImprovement(improvementId: string): improvementId is WoodlandImprovementId {
  return improvementId === 'lumber-mill' || improvementId === 'charcoal-clearing';
}

export function createWoodlands(tiles: readonly HexTile[]): WoodlandState {
  return {
    ruleVersion: WOODLAND_RULES.ruleVersion,
    profileId: WOODLAND_RULES.profileId,
    stands: Object.fromEntries(tiles.filter(tile => tile.terrain === 'forest').toSorted((a, b) => a.id - b.id).map(tile => [String(tile.id), { stock: WOODLAND_RULES.capacity, lastHarvestRound: null }])),
    lastBeat: null,
  };
}

export function prepareWoodlandBeat(state: WorldState): WoodlandPlan | null {
  if (!hasFeatures(state, [WOODLAND_RULES.featureId])) return null;
  const layer = state.woodlands;
  if (!layer || layer.ruleVersion !== WOODLAND_RULES.ruleVersion || layer.profileId !== WOODLAND_RULES.profileId) throw new RangeError('Woodland operation requires its fresh registered inventory');
  const previousRound = layer.lastBeat?.round ?? 0;
  if (!Number.isSafeInteger(state.round) || !Number.isSafeInteger(previousRound) || previousRound < 0 || state.round !== previousRound + 1) throw new RangeError('Woodland economy round must be the next consecutive round');
  const forest = state.tiles.filter(tile => tile.terrain === 'forest').toSorted((a, b) => a.id - b.id);
  if (Object.keys(layer.stands).length !== forest.length) throw new RangeError('Woodland inventory must cover the exact forest sites');
  const entries = forest.map((tile): WoodlandBeatEntry => {
    const stand = layer.stands[String(tile.id)];
    if (!stand || !Number.isSafeInteger(stand.stock) || stand.stock < 0 || stand.stock > WOODLAND_RULES.capacity || (stand.lastHarvestRound !== null && (!Number.isSafeInteger(stand.lastHarvestRound) || stand.lastHarvestRound < 1 || stand.lastHarvestRound > previousRound))) throw new RangeError('Woodland site requires bounded whole work-lots and a completed harvest round');
    const recovered = Math.min(WOODLAND_RULES.recoveryPerIdleBeat, WOODLAND_RULES.capacity - stand.stock);
    return { tileId: tile.id, opening: stand.stock, harvested: 0, recovered, closing: stand.stock + recovered, harvester: null };
  });
  return { ruleVersion: WOODLAND_RULES.ruleVersion, profileId: WOODLAND_RULES.profileId, round: state.round, entries };
}

function plannedStand(plan: WoodlandPlan, tileId: number): WoodlandBeatEntry {
  const entry = plan.entries.find(candidate => candidate.tileId === tileId);
  if (!entry) throw new RangeError('Woodland operation requires its exact registered forest site');
  return entry;
}

export function woodlandOperationReceipt(plan: WoodlandPlan, tileId: number): WoodlandOperationReceipt {
  const entry = plannedStand(plan, tileId);
  return { ruleVersion: plan.ruleVersion, profileId: plan.profileId, tileId, required: WOODLAND_RULES.lotsPerOperation, opening: entry.opening, harvested: entry.harvested, recovered: entry.recovered, closing: entry.closing };
}

export function reserveWoodlandHarvest(plan: WoodlandPlan, city: City, improvement: CityImprovement): WoodlandOperationReceipt {
  const entry = plannedStand(plan, improvement.tileId);
  const completion = improvement.completion;
  if (!isWoodlandImprovement(improvement.improvementId) || !improvement.operation.enabled || completion.cityId !== city.id || completion.improvementId !== improvement.improvementId || completion.tileId !== improvement.tileId || !completion.orderId || completion.completedRound >= plan.round) throw new RangeError('Woodland harvest requires its exact previously completed enabled improvement');
  if (entry.harvester !== null || entry.harvested !== 0 || entry.opening < WOODLAND_RULES.lotsPerOperation) throw new RangeError('Woodland harvest requires one unreserved opening work-lot');
  entry.harvested = WOODLAND_RULES.lotsPerOperation;
  entry.recovered = 0;
  entry.closing = entry.opening - entry.harvested;
  entry.harvester = { cityId: city.id, civId: city.civId, improvementId: improvement.improvementId, orderId: completion.orderId };
  return woodlandOperationReceipt(plan, improvement.tileId);
}

function receiptMatches(receipt: WoodlandOperationReceipt | undefined, plan: WoodlandPlan, entry: WoodlandBeatEntry): boolean {
  return !!receipt && receipt.ruleVersion === plan.ruleVersion && receipt.profileId === plan.profileId && receipt.tileId === entry.tileId && receipt.required === WOODLAND_RULES.lotsPerOperation && receipt.opening === entry.opening && receipt.harvested === entry.harvested && receipt.recovered === entry.recovered && receipt.closing === entry.closing;
}

export function recordWoodlands(state: WorldState, plan: WoodlandPlan | null, events: GameEvent[]): void {
  if (!plan) {
    if (hasFeatures(state, [WOODLAND_RULES.featureId])) throw new RangeError('Woodland economy requires its prepared plan');
    return;
  }
  const opening = prepareWoodlandBeat(state);
  if (!opening || !state.woodlands || plan.ruleVersion !== opening.ruleVersion || plan.profileId !== opening.profileId || plan.round !== opening.round || plan.entries.length !== opening.entries.length) throw new RangeError('Woodland commit requires its exact prepared opening round');
  for (const [index, entry] of plan.entries.entries()) {
    const expected = opening.entries[index]!;
    const harvested = entry.harvester === null ? 0 : WOODLAND_RULES.lotsPerOperation;
    const recovered = harvested === 0 ? expected.recovered : 0;
    if (entry.tileId !== expected.tileId || entry.opening !== expected.opening || entry.harvested !== harvested || entry.recovered !== recovered || entry.closing !== entry.opening - harvested + recovered || entry.closing < 0) throw new RangeError('Woodland commit must conserve its exact opening work-lots');
    if (entry.harvester) {
      const identity = entry.harvester;
      const city = state.cities.find(candidate => candidate.id === identity.cityId && candidate.civId === identity.civId);
      const improvement = city?.improvements?.[String(entry.tileId)];
      const result = improvement?.operation.lastResult;
      if (!improvement || improvement.improvementId !== identity.improvementId || improvement.completion.orderId !== identity.orderId || improvement.completion.cityId !== identity.cityId || improvement.completion.tileId !== entry.tileId || improvement.completion.improvementId !== identity.improvementId || improvement.completion.completedRound >= plan.round || result?.round !== plan.round || result.status !== 'operated' || !receiptMatches(result.woodland, plan, entry)) throw new RangeError('Woodland harvest must match the exact current completed operation');
    }
  }
  for (const city of state.cities) for (const improvement of Object.values(city.improvements ?? {})) {
    const result = improvement.operation.lastResult;
    if (!isWoodlandImprovement(improvement.improvementId) || result?.round !== plan.round) continue;
    const entry = plannedStand(plan, improvement.tileId);
    if (!receiptMatches(result.woodland, plan, entry) || (result.status === 'operated') !== (entry.harvester?.cityId === city.id && entry.harvester.orderId === improvement.completion.orderId)) throw new RangeError('Woodland operation receipt must agree with its actual harvest or idle recovery');
  }
  const event = emitEvent(state, events, {
    type: 'woodland-beat', title: 'Worked woodlands complete a season', detail: `${plan.profileId} at strategic round ${plan.round}`,
    actor: null, target: null, tileId: null,
    cause: 'Fully funded and staffed existing forest operations use one local work-lot; only stands with no harvest recover one lot, capped at eight',
    effects: [`Harvested work-lots ${plan.entries.reduce((sum, entry) => sum + entry.harvested, 0)}`, `Recovered work-lots ${plan.entries.reduce((sum, entry) => sum + entry.recovered, 0)}`, 'Recovery is not operation output; forest terrain is unchanged'],
    importance: plan.entries.some(entry => entry.harvested > 0) ? 2 : 1,
  });
  for (const entry of plan.entries) {
    const stand = state.woodlands.stands[String(entry.tileId)]!;
    stand.stock = entry.closing;
    if (entry.harvested > 0) stand.lastHarvestRound = plan.round;
  }
  state.woodlands.lastBeat = { ...structuredClone(plan), eventId: event.id };
}
