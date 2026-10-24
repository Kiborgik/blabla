import { createLandworkPlanner, type FundedImprovementOperationQuote, type FundedLandworkQuote } from './behavior-landwork.ts';
import { IMPROVEMENTS, RESOURCE_IDS } from './content.ts';
import { hasFeatures } from './simulation/history.ts';
import type { GameAction, Resources, WorldState } from './types.ts';

export interface RiverIntakeAssessment {
  readonly quote: FundedLandworkQuote | FundedImprovementOperationQuote;
  readonly marginalFood: number;
  readonly weight: number;
}

export function createRiverIntakePolicy(state: WorldState, civId: number, weights: Readonly<Resources>, constructionPriority: number) {
  const planner = createLandworkPlanner(state, civId);
  const definition = IMPROVEMENTS.find(item => item.id === 'river-intake');
  const cache = new Map<string, RiverIntakeAssessment | null>();
  const value = (amounts: Partial<Resources>): number => RESOURCE_IDS.reduce((total, resource) => total + (amounts[resource] ?? 0) * weights[resource], 0);
  return (action: Extract<GameAction, { type: 'improve' | 'set-improvement-operation' }>): RiverIntakeAssessment | null => {
    const key = `${action.type}/${action.cityId}/${action.tileId}/${action.improvementId}/${action.type === 'improve' || action.enabled}`;
    if (cache.has(key)) return cache.get(key)!;
    const save = (result: RiverIntakeAssessment | null) => { cache.set(key, result); return result; };
    if (state.outcome || !definition || !hasFeatures(state, definition.requiredFeatures) || action.improvementId !== definition.id || action.type === 'set-improvement-operation' && !action.enabled) return save(null);
    const town = state.cities.find(city => city.id === action.cityId && city.civId === civId);
    if (!town || state.tiles.find(tile => tile.id === action.tileId)?.owner !== civId || action.type === 'improve' && town.construction?.active) return save(null);
    const quote = action.type === 'set-improvement-operation' ? planner.riverIntakeOperation(town.id, action.tileId)
      : planner.quote(town.id, action.tileId).quotes.find(item => item.action.type === 'improve' && item.action.improvementId === definition.id);
    if (!quote || Object.values(quote.acquisitionCost).some(amount => amount > 0)) return save(null);
    const marginalFood = quote.marginalOutput.food;
    const net = marginalFood * weights.food - value(quote.operatingInputs);
    if (!(marginalFood > 0) || !(net > 0) || !Number.isFinite(net)) return save(null);
    const weight = net * constructionPriority / (1 + value(quote.setupCost) / 80) / (1 + quote.firstOperationBeat);
    return save(Number.isFinite(weight) && weight > 0 ? Object.freeze({ quote, marginalFood, weight }) : null);
  };
}

export function riverIntakeReason(assessment: RiverIntakeAssessment): string {
  return `Conditionally fund ${assessment.marginalFood} additional Food from an exact river intake after ${assessment.quote.firstOperationBeat} season(s), preserving current work and supplies. Future upstream flow may change; this is not a water right or guaranteed harvest.`;
}
