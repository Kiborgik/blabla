import { behaviorPolicyVersion, civilizationBehaviorProfile, type BehaviorProfile } from './behavior-profiles.ts';
import { BUILDINGS, ECONOMY_RULES, IMPROVEMENTS, INDUSTRIAL_RULES, PUBLIC_PROJECT_RECIPES, RESEARCH_INVESTMENT_RULES, RESOURCE_IDS, STRATEGIC_RESOURCE_IDS, TRADE_RECIPES, WONDERS } from './content.ts';
import { KNOWLEDGE_RULES } from './knowledge-content.ts';
import type { KnowledgeCompact, KnowledgeTerms } from './knowledge-types.ts';
import { buildingBaseProduction } from './simulation/districts.ts';
import { civilizationFoodUpkeep, forecastCivilizationFoodProduction } from './simulation/food-security.ts';
import { governmentModifiers, governmentPrice } from './simulation/government.ts';
import { hasFeatures } from './simulation/history.ts';
import { knowledgeActionFailure, knowledgeCompactFailure, knowledgePromisedResources, quoteKnowledgeProposal } from './simulation/knowledge-compacts.ts';
import { paidRecipe } from './simulation/operations.ts';
import { reliefPromisedResources } from './simulation/relief-charters.ts';
import { siteProduction } from './simulation/sites.ts';
import { quoteMarsMission } from './simulation/spaceflight.ts';
import { strategicObligations } from './simulation/trade.ts';
import { transportBlock } from './simulation/transport.ts';
import { wonderBaseProduction } from './simulation/wonders.ts';
import { cityProductivity } from './simulation/world.ts';
import type { ActionOption, Civilization, GameAction, Resources, StrategicResources, TradeTerms, WorldState } from './types.ts';

export interface KnowledgeEstimate {
  readonly kind: 'estimate';
  readonly nextStudyRound: number | null;
  readonly settlementRound: number | null;
  readonly sciencePerRound: number;
  readonly remainingWork: number;
  readonly projectedRemainingWork: number;
  readonly expectedWork: number;
  readonly studiesRemaining: number;
}
interface Assessment { weight: number | null; priority: number; reason: string; protected: boolean; estimate?: KnowledgeEstimate }
interface Budget { ordinary: Resources; strategic: StrategicResources }
interface Opportunity { estimate: KnowledgeEstimate; useful: boolean; gain: number; reason: string }
export interface KnowledgePlan {
  readonly assessments: ReadonlyMap<ActionOption, Assessment>;
  readonly promised: Readonly<Partial<Resources>>;
}

const empty = (): Resources => ({ food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 });
const quantize = (amount: number): number => Math.round(amount * 100) / 100;
const add = (target: Resources, cost: Partial<Resources>, count = 1): void => { for (const resource of RESOURCE_IDS) target[resource] += (cost[resource] ?? 0) * count; };
const addStrategic = (target: StrategicResources, cost: StrategicResources, count = 1): void => { for (const resource of STRATEGIC_RESOURCE_IDS) target[resource] = (target[resource] ?? 0) + (cost[resource] ?? 0) * count; };

function scienceEstimate(state: WorldState, actor: Civilization): number {
  const government = governmentModifiers(state, actor.id);
  return quantize(state.cities.filter(city => city.civId === actor.id).reduce((total, city) => {
    const site = state.tiles.find(tile => tile.id === city.tileId);
    const buildings = BUILDINGS.filter(building => city.buildings.includes(building.id) && hasFeatures(state, building.requiredFeatures));
    const passive = buildings.filter(building => !paidRecipe(building)).reduce((sum, building) => sum + (buildingBaseProduction(state, city, building).science ?? 0), 0);
    const raw = ECONOMY_RULES.baseProduction.science + (government.baseProduction.science ?? 0)
      + ((ECONOMY_RULES.focusProduction[city.focus] as Partial<Resources>).science ?? 0)
      + (site ? siteProduction(state, site).science ?? 0 : 0) + passive + (wonderBaseProduction(state, city).science ?? 0);
    const actual = buildings.filter(paidRecipe).reduce((sum, building) => {
      const operation = city.buildingOperations?.[building.id]; const result = operation?.lastResult;
      return sum + (operation?.enabled && result?.round === state.round && result.status === 'operated' ? result.produced.science ?? 0 : 0);
    }, 0) + Object.values(city.improvements ?? {}).reduce((sum, improvement) => {
      const result = improvement.operation.lastResult;
      return sum + (improvement.operation.enabled && result?.round === state.round && result.status === 'operated' ? result.produced.science ?? 0 : 0);
    }, 0);
    return total + quantize(raw * cityProductivity(city) * government.ordinaryOutputMultiplier) + actual;
  }, 0));
}

function estimate(state: WorldState, terms: KnowledgeTerms, compact?: KnowledgeCompact): KnowledgeEstimate {
  const learner = state.civilizations.find(actor => actor.id === terms.learnerId);
  const agreement = state.routes.find(route => route.id === terms.routeId)?.agreement;
  const studiesRemaining = Math.max(0, terms.requiredStudies - (compact?.status === 'accepted' ? compact.studies.length : 0));
  const sciencePerRound = learner ? scienceEstimate(state, learner) : 0;
  const remainingWork = Math.max(0, terms.costBasis - (learner?.researchProgress ?? terms.costBasis));
  const nextStudyRound = agreement?.enabled ? Math.max(state.round + 1, agreement.nextDeliveryRound) : null;
  const settlementRound = nextStudyRound === null ? null : nextStudyRound + Math.max(0, studiesRemaining - 1) * terms.tradeTerms.cadenceRounds;
  const deadline = compact?.status === 'accepted' ? compact.deadlineRound : state.round + terms.studyCadences * terms.tradeTerms.cadenceRounds;
  const ordinary = sciencePerRound * Math.max(0, (settlementRound ?? state.round) - state.round)
    + (!hasFeatures(state, [RESEARCH_INVESTMENT_RULES.featureId]) ? learner?.resources.science ?? 0 : 0);
  const projectedRemainingWork = quantize(Math.max(0, remainingWork - ordinary));
  const expectedWork = settlementRound !== null && settlementRound <= deadline && learner?.researchTarget === terms.technologyId
    ? Math.min(terms.nominalAmount, projectedRemainingWork) : 0;
  return { kind: 'estimate', nextStudyRound, settlementRound, sciencePerRound, remainingWork, projectedRemainingWork, expectedWork, studiesRemaining };
}

export function exchangePromisedResources(state: WorldState, seat: number, rounds: number, excludingCompactId?: string): Budget {
  const result: Budget = { ordinary: empty(), strategic: {} };
  add(result.ordinary, knowledgePromisedResources(state, seat, excludingCompactId));
  add(result.ordinary, reliefPromisedResources(state, seat));
  const end = state.round + rounds;
  for (const project of state.publicProjects ?? []) if (project.status === 'committed' && project.dueRound <= end) {
    if (project.proposer === seat) add(result.ordinary, project.terms.proposerContribution);
    if (project.recipient === seat) add(result.ordinary, project.terms.recipientContribution);
  }
  for (const route of state.routes) {
    const agreement = route.agreement;
    if (!agreement?.enabled || route.owner !== seat && route.partner !== seat) continue;
    const first = Math.max(state.round + 1, agreement.nextDeliveryRound);
    const count = first > end ? 0 : Math.floor((end - first) / agreement.terms.cadenceRounds) + 1;
    const proposer = route.owner === seat;
    add(result.ordinary, proposer ? agreement.terms.proposerCargo : agreement.terms.recipientCargo, count);
    add(result.ordinary, proposer ? agreement.terms.proposerUpkeep : agreement.terms.recipientUpkeep, count);
    addStrategic(result.strategic, strategicObligations(agreement.terms, proposer ? 'proposer' : 'recipient'), count);
  }
  return result;
}

function commitments(state: WorldState, seat: number, rounds: number, excludingCompactId?: string, terms?: KnowledgeTerms): Budget {
  const result = exchangePromisedResources(state, seat, rounds, excludingCompactId);
  for (const city of state.cities.filter(city => city.civId === seat)) {
    for (const building of BUILDINGS) {
      const selected = terms && (terms.teacherId === seat ? terms.teacherCityId === city.id && terms.teacherInstitutionId === building.id : terms.learnerCityId === city.id && terms.learnerInstitutionId === building.id);
      if (!city.buildings.includes(building.id) || !city.buildingOperations?.[building.id]?.enabled && !selected) continue;
      add(result.ordinary, building.operatingInputs ?? {}, rounds); addStrategic(result.strategic, building.strategicInputs ?? {}, rounds);
    }
    for (const improvement of Object.values(city.improvements ?? {})) if (improvement.operation.enabled)
      add(result.ordinary, IMPROVEMENTS.find(definition => definition.id === improvement.improvementId)?.operatingInputs ?? {}, rounds);
    if (city.damage >= 25) add(result.ordinary, ECONOMY_RULES.repair.cost);
  }
  result.ordinary.food += civilizationFoodUpkeep(state, seat) * 2;
  return result;
}

function householdRisk(state: WorldState, actor: Civilization): boolean {
  const upkeep = civilizationFoodUpkeep(state, actor.id);
  return actor.resources.food < upkeep * 2
    || actor.resources.food < upkeep * 4 && forecastCivilizationFoodProduction(state, actor.id) < upkeep;
}

function affordable(actor: Civilization, held: Budget, contribution: Partial<Resources>): boolean {
  return RESOURCE_IDS.every(resource => actor.resources[resource] >= held.ordinary[resource] + (contribution[resource] ?? 0))
    && STRATEGIC_RESOURCE_IDS.every(resource => (actor.strategicResources?.[resource] ?? 0) >= (held.strategic[resource] ?? 0));
}

function value(actor: Civilization, profile: BehaviorProfile, vector: Partial<Resources>): number {
  return RESOURCE_IDS.reduce((total, resource) => {
    const reserve = resource === 'materials' ? 12 : resource === 'credits' ? 8 : resource === 'culture' && actor.civics?.active ? 6 : 0;
    const civic = resource === 'culture' && actor.civics?.active ? 1 + profile.priorities.civic * Math.min(1, reserve / Math.max(1, actor.resources.culture)) : 1;
    return total + (vector[resource] ?? 0) * profile.resources[resource] * (1 + reserve / Math.max(1, actor.resources[resource])) * civic;
  }, 0);
}

function opportunity(state: WorldState, actor: Civilization, profile: BehaviorProfile, terms: KnowledgeTerms, compact?: KnowledgeCompact): Opportunity {
  const projected = estimate(state, terms, compact);
  const bad = (reason: string): Opportunity => ({ estimate: projected, useful: false, gain: 0, reason });
  const identity = knowledgeCompactFailure(state, { terms }); if (identity) return bad(identity.detail);
  if (projected.expectedWork <= 0) return bad(projected.projectedRemainingWork <= 0 ? 'ordinary research is estimated to finish before the second lesson; retain self-reliant learning' : 'the remaining route window cannot fit the required fresh lessons');
  const rounds = Math.max(1, (projected.settlementRound ?? state.round + 1) - state.round);
  for (const id of [terms.teacherId, terms.learnerId]) {
    const participant = state.civilizations.find(candidate => candidate.id === id);
    const contribution = id === terms.teacherId ? terms.teacherContribution : terms.learnerContribution;
    if (!participant || householdRisk(state, participant) || !affordable(participant, commitments(state, id, rounds, compact?.id, terms), contribution))
      return bad('current Food reserves, operation upkeep, exact contributions or existing commitments need these supplies');
    if (compact?.status !== 'accepted' && state.cities.some(city => city.civId === id && city.damage >= 25))
      return bad('serious town repairs take precedence over a new teaching commitment');
  }
  const route = state.routes.find(candidate => candidate.id === terms.routeId)!;
  const proposer = route.owner === actor.id;
  const outgoing = empty(); add(outgoing, proposer ? terms.tradeTerms.proposerCargo : terms.tradeTerms.recipientCargo); add(outgoing, proposer ? terms.tradeTerms.proposerUpkeep : terms.tradeTerms.recipientUpkeep);
  const incoming = empty(); add(incoming, proposer ? terms.tradeTerms.recipientCargo : terms.tradeTerms.proposerCargo); add(incoming, proposer ? terms.tradeTerms.proposerYield : terms.tradeTerms.recipientYield);
  if (value(actor, profile, incoming) < value(actor, profile, outgoing) * 0.55) return bad('the underlying exchange currently consumes too much useful supply; ordinary learning remains available');
  const interrupted = route.damage >= terms.tradeTerms.damageDisableAt || !!(terms.tradeTerms.transport && transportBlock(state, terms.tradeTerms.transport, terms.fromTileId, terms.toTileId))
    || [[terms.teacherCityId, terms.teacherInstitutionId], [terms.learnerCityId, terms.learnerInstitutionId]].some(([cityId, institutionId]) => {
      const operation = state.cities.find(city => city.id === cityId)?.buildingOperations?.[institutionId!];
      return !operation?.enabled || operation.lastResult?.round !== state.round || operation.lastResult.status !== 'operated';
    });
  const credibility = interrupted ? 0.9 : 1;
  const teacher = actor.id === terms.teacherId;
  const gain = teacher
    ? value(actor, profile, terms.transferred) * Math.min(1, projected.expectedWork / Math.max(0.01, terms.nominalAmount)) * credibility - value(actor, profile, terms.teacherContribution)
    : projected.expectedWork * profile.resources.science * profile.priorities.research * credibility / (1 + rounds / 12) - value(actor, profile, terms.learnerContribution);
  return gain > 0 ? { estimate: projected, useful: true, gain, reason: interrupted ? 'recoverable operation or route interruption still leaves an estimated opportunity' : 'current full contributions and ordinary operations fit' }
    : bad('the full fixed price is not worth the estimated remaining work or Culture opportunity cost; retain self-reliant learning');
}

function actionCost(state: WorldState, actor: Civilization, option: ActionOption, rounds: number): Partial<Resources> {
  const action = option.action; const cost = empty();
  const trade = (terms: TradeTerms, proposer: boolean): void => {
    const count = Math.max(1, Math.ceil(rounds / (option.tradeQuote?.cadenceRounds ?? terms.cadenceRounds)));
    add(cost, proposer ? terms.proposerCargo : terms.recipientCargo, count); add(cost, proposer ? terms.proposerUpkeep : terms.recipientUpkeep, count);
    if (proposer) add(cost, terms.constructionCost);
  };
  switch (action.type) {
    case 'build': add(cost, BUILDINGS.find(item => item.id === action.project)?.cost ?? {}); break;
    case 'improve': add(cost, IMPROVEMENTS.find(item => item.id === action.improvementId)?.cost ?? {}); break;
    case 'build-wonder': add(cost, WONDERS.find(item => item.id === action.wonderId)?.cost ?? {}); break;
    case 'build-rail': add(cost, INDUSTRIAL_RULES.railCost); break;
    case 'acquire-tile': add(cost, option.territoryQuote?.paid ?? {}); break;
    case 'settle': case 'settle-coast': add(cost, ECONOMY_RULES.settle.cost); break;
    case 'repair': case 'repair-city': add(cost, ECONOMY_RULES.repair.cost); break;
    case 'expedition': add(cost, quoteMarsMission(state, actor.id, action.cityId, action.mission)?.totalCost ?? {}); break;
    case 'adopt-government': cost.credits = governmentPrice(state, actor.id, action.governmentId).credits; break;
    case 'set-building-operation': if (action.enabled) add(cost, BUILDINGS.find(item => item.id === action.buildingId)?.operatingInputs ?? {}); break;
    case 'set-improvement-operation': if (action.enabled) add(cost, IMPROVEMENTS.find(item => item.id === action.improvementId)?.operatingInputs ?? {}); break;
    case 'propose-trade': { const recipe = TRADE_RECIPES.find(item => item.id === action.recipeId); if (recipe) trade(recipe.terms, true); break; }
    case 'respond-trade': { const offer = state.tradeOffers?.find(item => item.id === action.offerId); if (action.accept && offer) trade(offer.terms, false); break; }
    case 'propose-public-project': add(cost, PUBLIC_PROJECT_RECIPES.find(item => item.id === action.recipeId)?.terms.proposerContribution ?? {}); break;
    case 'respond-public-project': { const project = state.publicProjects?.find(item => item.id === action.projectId); if (action.accept && project) add(cost, project.terms.recipientContribution); break; }
    default: break;
  }
  return cost;
}

function protectedNeeds(state: WorldState, actor: Civilization, action: GameAction): boolean {
  if (action.type === 'research' || action.type === 'choose-civic' || action.type === 'expedition' && action.mission === 'resupply') return true;
  if (hasFeatures(state, ['recurring-decisions']) && ['build', 'improve', 'build-wonder', 'build-rail'].includes(action.type)) return true;
  if (action.type === 'repair-city') return (state.cities.find(city => city.id === action.cityId)?.damage ?? 0) >= 25;
  if (action.type === 'repair') {
    const route = state.routes.find(candidate => candidate.id === action.routeId);
    return !!route?.agreement && route.damage >= route.agreement.terms.damageDisableAt;
  }
  if (!householdRisk(state, actor)) return false;
  if (action.type === 'build' || action.type === 'set-building-operation' && action.enabled)
    return (BUILDINGS.find(building => building.id === (action.type === 'build' ? action.project : action.buildingId))?.production.food ?? 0) > 0;
  if (action.type === 'improve' || action.type === 'set-improvement-operation' && action.enabled)
    return (IMPROVEMENTS.find(improvement => improvement.id === action.improvementId)?.production.food ?? 0) > 0;
  if (action.type === 'propose-trade' || action.type === 'respond-trade' && action.accept) {
    const terms = action.type === 'propose-trade' ? TRADE_RECIPES.find(recipe => recipe.id === action.recipeId)?.terms : state.tradeOffers?.find(offer => offer.id === action.offerId)?.terms;
    return !!terms && (action.type === 'propose-trade' ? terms.recipientCargo.food ?? 0 : terms.proposerCargo.food ?? 0) > (action.type === 'propose-trade' ? terms.proposerCargo.food ?? 0 : terms.recipientCargo.food ?? 0);
  }
  return false;
}

export function knowledgeCommitmentHorizon(state: WorldState, seat: number): number {
  const accepted = (state.knowledge?.active ?? []).filter(compact => compact.status === 'accepted' && (compact.terms.teacherId === seat || compact.terms.learnerId === seat));
  return Math.max(1, ...accepted.map(compact => Math.min(compact.terms.studyCadences * compact.terms.tradeTerms.cadenceRounds, Math.max(1, (estimate(state, compact.terms, compact).settlementRound ?? state.round + 1) - state.round))));
}

export function deriveKnowledgePlan(state: WorldState, actor: Civilization, profile: BehaviorProfile, options: readonly ActionOption[]): KnowledgePlan {
  const assessments = new Map<ActionOption, Assessment>();
  if (!state.knowledge || !hasFeatures(state, [KNOWLEDGE_RULES.featureId])) return { assessments, promised: {} };
  const promised = knowledgePromisedResources(state, actor.id);
  const accepted = state.knowledge.active.filter(compact => compact.status === 'accepted' && (compact.terms.teacherId === actor.id || compact.terms.learnerId === actor.id));
  const rounds = knowledgeCommitmentHorizon(state, actor.id);
  const held = accepted.length ? commitments(state, actor.id, rounds) : null;
  const spendingPromise = (option: ActionOption): boolean => {
    if (!held || protectedNeeds(state, actor, option.action)) return false;
    const cost = actionCost(state, actor, option, rounds);
    return RESOURCE_IDS.some(resource => (cost[resource] ?? 0) > 0 && actor.resources[resource] < held.ordinary[resource] + (cost[resource] ?? 0));
  };
  for (const option of options) {
    const action = option.action; const assessment: Assessment = { weight: null, priority: 0, reason: '', protected: false };
    if (spendingPromise(option)) {
      assessment.weight = 0; assessment.protected = true;
      assessment.reason = 'Keep accepted teaching contributions and current operation supplies before elective spending; these are soft promises, not escrow.';
    }
    if ((action.type === 'respond-trade' || action.type === 'respond-public-project') && !action.accept
      && spendingPromise({ ...option, action: { ...action, accept: true } })) {
      assessment.weight = 18 * profile.priorities.trade;
      assessment.reason = 'Decline the additional obligation; accepted teaching contributions and current needs already use these supplies.';
    }
    if (action.type === 'propose-knowledge') {
      assessment.weight = 0;
      const quote = quoteKnowledgeProposal(state, actor.id, action);
      if (quote.ok) {
        const result = opportunity(state, actor, profile, quote.terms);
        const learner = state.civilizations.find(candidate => candidate.id === quote.terms.learnerId)!;
        const partner = opportunity(state, learner, civilizationBehaviorProfile(state.seed, learner.id, behaviorPolicyVersion(state)), quote.terms);
        assessment.estimate = result.estimate;
        if (result.useful && partner.useful) assessment.weight = (6 + result.gain * 3) * profile.priorities.trade;
        assessment.reason = result.useful && partner.useful
          ? `Offer optional teaching; estimate ${result.estimate.expectedWork} work after round ${result.estimate.settlementRound} exchanges, not guaranteed. Full price remains due only on settlement.`
          : `Do not offer teaching; ${result.useful ? partner.reason : result.reason}.`;
      }
    } else if (action.type === 'respond-knowledge' || action.type === 'withdraw-knowledge') {
      assessment.weight = 0;
      const compact = state.knowledge.active.find(candidate => candidate.id === action.compactId);
      if (compact && !knowledgeActionFailure(state, actor.id, action)) {
        const result = opportunity(state, actor, profile, compact.terms, compact); assessment.estimate = result.estimate;
        const acceptanceFailure = action.type === 'respond-knowledge' ? knowledgeActionFailure(state, actor.id, { ...action, accept: true }) : null;
        const useful = result.useful && !acceptanceFailure;
        if (action.type === 'respond-knowledge' && action.accept === useful) {
          assessment.weight = useful ? (8 + result.gain) * profile.priorities.research : 18 * profile.priorities.recovery;
          assessment.reason = useful
            ? `Accept ${compact.id}; estimate ${result.estimate.expectedWork} work by round ${result.estimate.settlementRound}, after ordinary Science. Full fixed price, no guaranteed lessons or escrow.`
            : `Decline ${compact.id}; ${acceptanceFailure ?? result.reason}. Ordinary research can continue without teaching.`;
        } else if (action.type === 'withdraw-knowledge' && !useful) {
          assessment.weight = 18 * profile.priorities.recovery;
          assessment.reason = `Withdraw ${compact.id}; ${result.reason}. No penalty; self-reliant learning and recovery remain available.`;
        }
      }
    }
    assessments.set(option, assessment);
  }
  return { assessments, promised };
}

export function knowledgeWeight(option: ActionOption, base: number, plan: KnowledgePlan): number { return plan.assessments.get(option)?.weight ?? base; }
export function knowledgePriority(option: ActionOption, plan: KnowledgePlan): number { return plan.assessments.get(option)?.priority ?? 0; }
export function knowledgeReason(option: ActionOption, plan: KnowledgePlan): string | null { return plan.assessments.get(option)?.reason || null; }
export function knowledgeProtects(option: ActionOption, plan: KnowledgePlan): boolean { return plan.assessments.get(option)?.protected ?? false; }
