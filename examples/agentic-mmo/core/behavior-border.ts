import { woodlandOperationCapacity } from './behavior-woodlands.ts';
import { BORDER_RULES } from './border-content.ts';
import type { BorderDepartureQuote, BorderPromises } from './border-types.ts';
import type { BehaviorProfile } from './behavior-profiles.ts';
import { BUILDINGS, IMPROVEMENTS, RESIDENT_CAPACITY_RULES, RESOURCE_IDS } from './content.ts';
import { borderActionFailure, borderDealFailure, borderPromisedResources, quoteBorderDeparture } from './simulation/border-incidents.ts';
import { buildingEligibility, improvementEligibility } from './simulation/capabilities.ts';
import { buildingBaseProduction, districtSiteBlock } from './simulation/districts.ts';
import { civilizationFoodUpkeep } from './simulation/food-security.ts';
import { improvementSiteBlock } from './simulation/improvements.ts';
import { createTerritoryPlanner } from './simulation/territory.ts';
import type { ActionOption, Civilization, GameAction, Resources, WorldState } from './types.ts';

interface Assessment { weight: number | null; priority: number; reason: string; protected: boolean }
interface SiteValue { value: number; use: string | null }
interface PeacefulValue extends SiteValue { tileId: number | null; credits: number; distance: number }
export interface BorderPlan { readonly assessments: ReadonlyMap<ActionOption, Assessment> }

function resourceValue(resources: Partial<Resources>, profile: BehaviorProfile): number {
  return RESOURCE_IDS.reduce((sum, resource) => sum + (resources[resource] ?? 0) * profile.resources[resource], 0);
}

function futureSite(state: WorldState, actorId: number, cityId: string, tileId: number, paid: Partial<Resources>, promises: BorderPromises, reserveFood: number, population: number): WorldState {
  const actor = state.civilizations.find(candidate => candidate.id === actorId)!;
  const resources = { ...actor.resources };
  for (const resource of RESOURCE_IDS) resources[resource] -= (paid[resource] ?? 0) + (promises.ordinary[resource] ?? 0) + (resource === 'food' ? reserveFood : 0);
  const purchase = state.tileAcquisitions?.[String(tileId)];
  const controls = { ...state.border!.controls };
  const current = controls[String(tileId)] ?? purchase;
  if (purchase && current && (current.civId !== actorId || current.cityId !== cityId)) controls[String(tileId)] = {
    ruleVersion: 1, incidentId: 'border-policy-projection', purchaseId: purchase.id, tileId,
    previousCivId: current.civId, previousCityId: current.cityId, civId: actorId, cityId,
    round: state.round, eventId: 'border-policy-projection',
  };
  return { ...state, border: { ...state.border!, controls },
    tiles: state.tiles.map(tile => tile.id === tileId ? { ...tile, owner: actorId } : tile),
    cities: state.cities.map(city => city.id === cityId ? { ...city, population } : city),
    civilizations: state.civilizations.map(candidate => candidate.id === actorId ? { ...candidate, resources } : candidate),
  };
}

function usefulSite(state: WorldState, actorId: number, cityId: string, tileId: number, profile: BehaviorProfile, promises: BorderPromises): SiteValue {
  const city = state.cities.find(candidate => candidate.id === cityId && candidate.civId === actorId);
  const actor = state.civilizations.find(candidate => candidate.id === actorId);
  const result: SiteValue = { value: 0, use: null };
  if (!city || !actor || promises.failure || city.construction?.active || RESOURCE_IDS.some(resource => actor.resources[resource] < 0)) return result;
  const availableResidents = city.population - RESIDENT_CAPACITY_RULES.communityReserve - promises.operationForecast.filter(operation => operation.cityId === cityId).reduce((sum, operation) => sum + operation.residents, 0);
  const retain = (outputs: Partial<Resources>, inputs: Partial<Resources>, cost: Partial<Resources>, name: string, operations: number = BORDER_RULES.maximumFieldBeats): void => {
    const net = resourceValue(outputs, profile) - resourceValue(inputs, profile);
    const value = Math.max(0, net) * operations / (1 + resourceValue(cost, profile) / 30);
    if (value > result.value) { result.value = value; result.use = name; }
  };
  for (const definition of IMPROVEMENTS) {
    if (definition.id === 'charcoal-clearing' || availableResidents < definition.residentsRequired || improvementSiteBlock(state, city, definition, tileId)
      || improvementEligibility(state, actorId, definition, cityId).blockers.length
      || RESOURCE_IDS.some(resource => actor.resources[resource] < (definition.cost[resource] ?? 0) + (definition.operatingInputs?.[resource] ?? 0) * BORDER_RULES.householdReserveBeats)) continue;
    retain(definition.production, definition.operatingInputs ?? {}, definition.cost, definition.name, woodlandOperationCapacity(state, definition.id, tileId, BORDER_RULES.maximumFieldBeats));
  }
  for (const definition of BUILDINGS) {
    if (!definition.district || districtSiteBlock(state, city, definition, tileId)) continue;
    const eligibility = buildingEligibility(state, actorId, definition, cityId);
    if (eligibility.completed || eligibility.blockers.length) continue;
    retain(buildingBaseProduction(state, city, definition, tileId), definition.operatingInputs ?? {}, definition.cost, definition.name);
  }
  return result;
}

function quotedValue(state: WorldState, quote: BorderDepartureQuote, profile: BehaviorProfile): SiteValue {
  const promises: BorderPromises = { ordinary: quote.promised, strategic: quote.promisedStrategic, operationForecast: quote.operationForecast, horizon: quote.promiseHorizon, failure: null };
  const projected = futureSite(state, quote.actorId, quote.sourceCityId, quote.tileId, quote.totalCost, promises, quote.householdReserve.food, quote.sourcePopulationBefore - 1);
  const useful = usefulSite(projected, quote.actorId, quote.sourceCityId, quote.tileId, profile, promises);
  const cost = resourceValue(quote.totalCost, profile) + quote.legitimacyCost * 2 + quote.people * (quote.returnByRound - quote.departureRound);
  return { ...useful, value: useful.value / (1 + cost / 30 + (quote.pathTileIds.length - 1) / 3) };
}

function bestPeacefulSite(state: WorldState, actor: Civilization, cityId: string, profile: BehaviorProfile): PeacefulValue {
  const city = state.cities.find(candidate => candidate.id === cityId && candidate.civId === actor.id);
  const best: PeacefulValue = { value: 0, use: null, tileId: null, credits: 0, distance: 0 };
  if (!city) return best;
  const promises = borderPromisedResources(state, actor.id, BORDER_RULES.maximumFieldBeats);
  if (promises.failure) return best;
  const planner = createTerritoryPlanner(state);
  for (const tile of planner.nearby(city)) {
    const { quote, blocker } = planner.assess(actor.id, city.id, tile.id);
    if (!quote || blocker) continue;
    const projected = futureSite(state, actor.id, city.id, tile.id, quote.paid, promises, civilizationFoodUpkeep(state, actor.id) * BORDER_RULES.householdReserveBeats, city.population);
    const useful = usefulSite(projected, actor.id, city.id, tile.id, profile, promises);
    const value = useful.value / (1 + resourceValue(quote.paid, profile) / 30 + quote.distance / 3);
    if (value > best.value) Object.assign(best, { value, use: useful.use, tileId: tile.id, credits: quote.paid.credits, distance: quote.distance });
  }
  return best;
}

function newDealPartner(state: WorldState, actorId: number, action: GameAction): number | null {
  if (action.type === 'propose-trade' || action.type === 'trade' || action.type === 'federate') return action.partner;
  if (action.type === 'respond-trade') {
    const offer = state.tradeOffers?.find(candidate => candidate.id === action.offerId);
    return offer?.recipient === actorId ? offer.proposer : null;
  }
  if (action.type === 'respond-public-project') {
    const project = state.publicProjects?.find(candidate => candidate.id === action.projectId);
    return project?.recipient === actorId ? project.proposer : null;
  }
  if (action.type === 'respond-relief') {
    const charter = state.relief?.active.find(candidate => candidate.id === action.charterId);
    return charter?.terms.recipientId === actorId ? charter.terms.donorId : null;
  }
  if (action.type === 'respond-knowledge') {
    const compact = state.knowledge?.active.find(candidate => candidate.id === action.compactId);
    return compact?.terms.learnerId === actorId ? compact.terms.teacherId : null;
  }
  if (action.type === 'propose-public-project' || action.type === 'propose-relief' || action.type === 'propose-knowledge') {
    const route = state.routes.find(candidate => candidate.id === action.routeId);
    return route?.owner === actorId ? route.partner : route?.partner === actorId ? route.owner : null;
  }
  return null;
}

export function deriveBorderPlan(state: WorldState, actor: Civilization, profile: BehaviorProfile, options: readonly ActionOption[]): BorderPlan {
  const assessments = new Map<ActionOption, Assessment>();
  const peaceful = new Map<string, PeacefulValue>();
  const defenses = new Map<string, number>();
  for (const option of options) {
    const action = option.action;
    const assessment: Assessment = { weight: null, priority: 0, reason: '', protected: false };
    if (state.civicWorks?.active.some(commission => commission.civId === actor.id) && (action.type === 'dispatch-border' || action.type === 'respond-border' && action.response === 'defend')) {
      assessments.set(option, { weight: 0, priority: 0, protected: true, reason: 'Active civic-works fees and returning Kiln production are outside this border departure forecast; withdrawal and yielding remain available.' });
      continue;
    }
    const partner = newDealPartner(state, actor.id, action);
    const blockedDeal = partner === null ? null : borderDealFailure(state, actor.id, partner);
    if (blockedDeal) {
      const decline = 'accept' in action && !action.accept;
      assessment.weight = decline ? 40 * profile.priorities.trade : 0;
      assessment.priority = decline ? 3 : 0;
      assessment.protected = !decline;
      assessment.reason = `${decline ? 'Decline the new promise' : 'Do not start a new bilateral promise'}: ${blockedDeal}. Existing accepted commitments remain unchanged.`;
    }
    if (action.type === 'dispatch-border' || action.type === 'respond-border' && action.response === 'defend') {
      const result = quoteBorderDeparture(state, actor.id, action);
      assessment.weight = 0;
      if (!result.ok) { assessment.protected = true; assessment.reason = result.reason; }
      else {
        const quote = result.quote;
        const useful = quotedValue(state, quote, profile);
        const prices = `${quote.people} residents; ${quote.totalCost.materials} Materials, ${quote.totalCost.credits} Credits, ${quote.totalCost.food} field Food; retain ${quote.sourcePopulationAfter} at home`;
        if (action.type === 'dispatch-border') {
          let alternative = peaceful.get(quote.sourceCityId);
          if (!alternative) { alternative = bestPeacefulSite(state, actor, quote.sourceCityId, profile); peaceful.set(quote.sourceCityId, alternative); }
          const appetite = profile.priorities.expansion / ((profile.priorities.recovery + profile.priorities.trade + profile.priorities.civic) / 3);
          const contestedShare = quote.people / (quote.people + 3 + BORDER_RULES.defenderBonus);
          assessment.weight = useful.value * appetite * contestedShare / (1 + alternative.value / Math.max(1, useful.value));
          assessment.reason = `${prices}. Potential paid ${useful.use ?? 'use unavailable'} after return; no immediate output. ${alternative.tileId === null ? 'No funded useful neutral site' : `Compare neutral ${alternative.tileId}: ${alternative.credits} Credits, distance ${alternative.distance}`}. Clash outcome is uncertain.`;
        } else {
          const incident = state.border!.active.find(candidate => candidate.id === action.incidentId)!;
          const chance = (quote.people + BORDER_RULES.defenderBonus) / (quote.people + BORDER_RULES.defenderBonus + incident.initiator.people);
          assessment.weight = useful.value * chance * profile.priorities.recovery * 4;
          assessment.priority = assessment.weight > 0 ? 4 : 0;
          assessment.reason = `${prices}. Defend potential paid ${useful.use ?? 'use unavailable'} without spending promised supplies; the defensive advantage does not guarantee a win.`;
          defenses.set(action.incidentId, Math.max(defenses.get(action.incidentId) ?? 0, assessment.weight));
        }
      }
    } else if (action.type === 'respond-border' || action.type === 'withdraw-border') {
      const failure = borderActionFailure(state, actor.id, action);
      assessment.weight = 0;
      if (failure) { assessment.protected = true; assessment.reason = failure; }
      else if (action.type === 'respond-border') {
        assessment.priority = 4;
        assessment.reason = 'Yield the exact unworked plot without a defensive departure or new payment; existing promises and household residents remain protected.';
      } else {
        const risk = actor.resources.food < civilizationFoodUpkeep(state, actor.id) * BORDER_RULES.householdReserveBeats;
        assessment.weight = (risk ? 80 : 0.5) * profile.priorities.recovery;
        assessment.priority = risk ? 5 : 0;
        assessment.reason = `${risk ? 'Current home Food is below two upkeep beats; withdraw' : 'Keep a voluntary withdrawal alternative'}; actual survivors retrace travelled edges and unused paid cargo returns only on arrival.`;
      }
    }
    assessments.set(option, assessment);
  }
  for (const option of options) if (option.action.type === 'respond-border' && option.action.response === 'yield') {
    const assessment = assessments.get(option)!;
    if (!assessment.protected) assessment.weight = 30 * profile.priorities.recovery / (1 + (defenses.get(option.action.incidentId) ?? 0) / 10);
  }
  return { assessments };
}

export function borderWeight(option: ActionOption, base: number, plan: BorderPlan): number { return plan.assessments.get(option)?.weight ?? base; }
export function borderPriority(option: ActionOption, plan: BorderPlan): number { return plan.assessments.get(option)?.priority ?? 0; }
export function borderReason(option: ActionOption, plan: BorderPlan): string | null { return plan.assessments.get(option)?.reason || null; }
export function borderProtects(option: ActionOption, plan: BorderPlan): boolean { return plan.assessments.get(option)?.protected ?? false; }
