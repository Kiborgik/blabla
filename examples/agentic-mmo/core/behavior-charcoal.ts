import { createLandworkPlanner, projectedLandworkOutput, type FundedCharcoalOperationQuote, type FundedLandworkQuote } from './behavior-landwork.ts';
import { foodAllocation, selectedInstitutionsFunded } from './behavior-paid-food-sites.ts';
import { BUILDINGS, IMPROVEMENTS, RESOURCE_IDS } from './content.ts';
import { buildingEligibility } from './simulation/capabilities.ts';
import { requiredConstructionWork } from './simulation/construction.ts';
import { applyEffects } from './simulation/effects.ts';
import { hasFeatures } from './simulation/history.ts';
import { improvementSiteBlock } from './simulation/improvements.ts';
import { projectOperationAllocation } from './simulation/operations.ts';
import type { GameAction, Resources, WorldState } from './types.ts';

export interface CharcoalAssessment {
  readonly quote: FundedLandworkQuote | FundedCharcoalOperationQuote;
  readonly usefulEnergy: number;
  readonly weight: number;
}

export function createCharcoalClearingPolicy(state: WorldState, civId: number, weights: Readonly<Resources>, constructionPriority: number, focusLocks: readonly { cityId: string; untilRound: number }[]) {
  const actor = state.civilizations.find(actor => actor.id === civId);
  const definition = IMPROVEMENTS.find(definition => definition.id === 'charcoal-clearing');
  const lumber = IMPROVEMENTS.find(definition => definition.id === 'lumber-mill');
  const planner = createLandworkPlanner(state, civId);
  const cached = new Map<string, CharcoalAssessment | null>();
  const value = (resources: Partial<Resources>): number => RESOURCE_IDS.reduce((sum, id) => sum + (resources[id] ?? 0) * weights[id], 0);
  const delta = (after: Resources, before: Resources): Resources => Object.fromEntries(RESOURCE_IDS.map(id => [id, Math.round((after[id] - before[id]) * 100) / 100])) as Resources;
  return (action: Extract<GameAction, { type: 'improve' | 'set-improvement-operation' }>): CharcoalAssessment | null => {
    const key = `${action.type}/${action.cityId}/${action.tileId}/${action.improvementId}/${action.type === 'improve' || action.enabled}`; if (cached.has(key)) return cached.get(key)!;
    const save = (assessment: CharcoalAssessment | null) => { cached.set(key, assessment); return assessment; };
    if (state.civicWorks?.active.some(commission => commission.civId === civId)) return save(null);
    if (!actor || !definition || !hasFeatures(state, definition.requiredFeatures) || action.improvementId !== definition.id || action.type === 'set-improvement-operation' && !action.enabled) return save(null);
    const city = state.cities.find(city => city.id === action.cityId && city.civId === civId);
    if (!city || state.tiles.find(tile => tile.id === action.tileId)?.owner !== civId) return save(null);
    const operationOnly = action.type === 'set-improvement-operation';
    if (!operationOnly && (city.construction?.active || !lumber || !state.tiles.some(tile => tile.id !== action.tileId && improvementSiteBlock(state, city, lumber, tile.id) === null))) return save(null);
    const quote = operationOnly ? planner.charcoalOperation(city.id, action.tileId)
      : planner.quote(city.id, action.tileId).quotes.find(quote => quote.action.type === 'improve' && quote.action.improvementId === definition.id);
    if (!quote) return save(null);
    const baseline = projectOperationAllocation(state, opening => {
      if (operationOnly) opening.cities.find(town => town.id === city.id)!.improvements![String(action.tileId)]!.operation.enabled = false;
    });
    const output = projectedLandworkOutput(baseline, civId);
    const usefulEnergy = Math.min(quote.marginalOutput.energy, Math.max(0, quote.protectedBudget.ordinary.energy / quote.protectedHorizon - output.energy));
    if ('requiredByBorder' in quote && quote.requiredByBorder) return save(Object.freeze({ quote, usefulEnergy, weight: 0 }));
    const net = usefulEnergy * weights.energy - value(quote.operatingInputs);
    if (!(usefulEnergy > 0) || !(net > 0) || !Number.isFinite(net)) return save(null);
    const baselineFood = foodAllocation(baseline, civId);
    for (const town of baseline.cities.filter(town => town.civId === civId && town.focus !== 'industry')) {
      if (!hasFeatures(state, ['city-specialization']) || focusLocks.some(lock => lock.untilRound > state.round && (lock.cityId === '*' || lock.cityId === town.id))) continue;
      const industry = { ...baseline, cities: baseline.cities.map(candidate => candidate.id === town.id ? { ...candidate, focus: 'industry' as const } : candidate) };
      const alternative = delta(projectedLandworkOutput(industry, civId), output);
      const alternativeFood = foodAllocation(industry, civId);
      if (alternative.energy >= usefulEnergy && value(alternative) >= net && alternativeFood.total >= baselineFood.total
        && [...baselineFood.producers].every(key => alternativeFood.producers.has(key)) && selectedInstitutionsFunded(industry, civId)) return save(null);
    }
    const artisan = BUILDINGS.find(building => building.id === 'workshop');
    if (!operationOnly && artisan && requiredConstructionWork(artisan.id) <= definition.requiredWork) {
      const eligibility = buildingEligibility(state, civId, artisan, city.id);
      const funded = RESOURCE_IDS.every(id => actor.resources[id] >= quote.protectedBudget.ordinary[id] - (quote.setupCost[id] ?? 0) - 2 * (quote.operatingInputs[id] ?? 0) + (artisan.cost[id] ?? 0));
      if (!eligibility.completed && eligibility.blockers.length === 0 && funded) {
        const alternative = { ...baseline, cities: baseline.cities.map(town => town.id === city.id ? { ...town, buildings: [...town.buildings, artisan.id] } : town) };
        applyEffects(alternative, civId, artisan.effects, city.id);
        const additional = delta(projectedLandworkOutput(alternative, civId), output);
        if (additional.energy >= usefulEnergy && value(additional) >= net && foodAllocation(alternative, civId).total >= baselineFood.total) return save(null);
      }
    }
    const weight = net * constructionPriority / (1 + value(quote.setupCost) / 80) / (1 + quote.firstOperationBeat);
    return save(Number.isFinite(weight) && weight > 0 ? Object.freeze({ quote, usefulEnergy, weight }) : null);
  };
}
