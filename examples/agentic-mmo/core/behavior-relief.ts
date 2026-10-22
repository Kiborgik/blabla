import type { BehaviorProfile } from './behavior-profiles.ts';
import { BUILDINGS, ECONOMY_RULES, IMPROVEMENTS, INDUSTRIAL_RULES, PUBLIC_PROJECT_RECIPES, TRADE_RECIPES, WONDERS } from './content.ts';
import { RELIEF_RULES } from './relief-content.ts';
import type { ReliefCharter } from './relief-types.ts';
import { hasFeatures } from './simulation/history.ts';
import { quoteReliefProposal, reliefActionFailure, reliefPromisedResources } from './simulation/relief-charters.ts';
import { quoteMarsMission } from './simulation/spaceflight.ts';
import type { ActionOption, Civilization, Resources, TradeTerms, WorldState } from './types.ts';

interface Assessment { weight: number | null; priority: number; reason: string; protected: boolean }
interface Supplies { food: number; energy: number }
export interface ReliefPlan {
  readonly assessments: ReadonlyMap<ActionOption, Assessment>;
  readonly promised: Readonly<Partial<Resources>>;
}

const upkeep = (state: WorldState, seat: number): number => state.cities.filter(city => city.civId === seat).reduce((total, city) => total + city.population * ECONOMY_RULES.populationFoodUpkeep, 0);
const add = (supplies: Supplies, cost: Partial<Resources>, count = 1): void => { supplies.food += (cost.food ?? 0) * count; supplies.energy += (cost.energy ?? 0) * count; };
const horizon = (state: WorldState, charter: ReliefCharter): number => Math.max(0, charter.status === 'accepted' ? charter.dueRound - state.round : charter.expiresRound - state.round + charter.terms.travelRounds);

function committedSupplies(state: WorldState, seat: number, rounds: number): Supplies {
  const relief = reliefPromisedResources(state, seat); const total = { food: relief.food ?? 0, energy: relief.energy ?? 0 };
  for (const route of state.routes) {
    const agreement = route.agreement;
    if (!agreement?.enabled || route.owner !== seat && route.partner !== seat) continue;
    const first = Math.max(state.round, agreement.nextDeliveryRound); const end = state.round + rounds;
    if (first > end) continue;
    const count = Math.floor((end - first) / agreement.terms.cadenceRounds) + 1;
    add(total, route.owner === seat ? agreement.terms.proposerCargo : agreement.terms.recipientCargo, count);
    add(total, route.owner === seat ? agreement.terms.proposerUpkeep : agreement.terms.recipientUpkeep, count);
  }
  for (const project of state.publicProjects ?? []) {
    if (project.status !== 'committed' || project.dueRound > state.round + rounds) continue;
    if (project.proposer === seat) add(total, project.terms.proposerContribution);
    if (project.recipient === seat) add(total, project.terms.recipientContribution);
  }
  return total;
}

function donorAtRisk(state: WorldState, charter: ReliefCharter): boolean {
  const donor = state.civilizations.find(actor => actor.id === charter.terms.donorId);
  if (!donor) return true;
  const promised = committedSupplies(state, donor.id, horizon(state, charter));
  return donor.resources.food < promised.food + upkeep(state, donor.id) * 2 || donor.resources.energy < promised.energy;
}

function actionSupplies(state: WorldState, actor: Civilization, option: ActionOption, rounds: number): Supplies {
  const action = option.action; const cost: Supplies = { food: 0, energy: 0 };
  const trade = (terms: TradeTerms, proposer: boolean): void => {
    const count = Math.max(1, Math.floor(rounds / (option.tradeQuote?.cadenceRounds ?? terms.cadenceRounds)));
    add(cost, proposer ? terms.proposerCargo : terms.recipientCargo, count);
    add(cost, proposer ? terms.proposerUpkeep : terms.recipientUpkeep, count);
    if (proposer) add(cost, terms.constructionCost);
  };
  switch (action.type) {
    case 'build': add(cost, BUILDINGS.find(item => item.id === action.project)?.cost ?? {}); break;
    case 'improve': add(cost, IMPROVEMENTS.find(item => item.id === action.improvementId)?.cost ?? {}); break;
    case 'build-wonder': add(cost, WONDERS.find(item => item.id === action.wonderId)?.cost ?? {}); break;
    case 'build-rail': add(cost, INDUSTRIAL_RULES.railCost); break;
    case 'settle': case 'settle-coast': add(cost, ECONOMY_RULES.settle.cost); break;
    case 'repair': case 'repair-city': add(cost, ECONOMY_RULES.repair.cost); break;
    case 'expedition': add(cost, quoteMarsMission(state, actor.id, action.cityId, action.mission)?.totalCost ?? {}); break;
    case 'set-building-operation': if (action.enabled) add(cost, BUILDINGS.find(item => item.id === action.buildingId)?.operatingInputs ?? {}); break;
    case 'propose-trade': {
      const recipe = TRADE_RECIPES.find(item => item.id === action.recipeId); if (recipe) trade(recipe.terms, true); break;
    }
    case 'respond-trade': {
      const offer = state.tradeOffers?.find(item => item.id === action.offerId); if (action.accept && offer) trade(offer.terms, false); break;
    }
    case 'propose-public-project': add(cost, PUBLIC_PROJECT_RECIPES.find(item => item.id === action.recipeId)?.terms.proposerContribution ?? {}); break;
    case 'respond-public-project': {
      const project = state.publicProjects?.find(item => item.id === action.projectId); if (action.accept && project) add(cost, project.terms.recipientContribution); break;
    }
    default: break;
  }
  return cost;
}

export function deriveReliefPlan(state: WorldState, actor: Civilization, profile: BehaviorProfile, options: readonly ActionOption[]): ReliefPlan {
  const assessments = new Map<ActionOption, Assessment>();
  if (!state.relief || !hasFeatures(state, [RELIEF_RULES.featureId])) return { assessments, promised: {} };
  const promised = reliefPromisedResources(state, actor.id);
  const outgoing = state.relief.active.filter(charter => charter.terms.donorId === actor.id);
  const rounds = Math.max(0, ...outgoing.map(charter => horizon(state, charter)));
  const held = outgoing.length ? committedSupplies(state, actor.id, rounds) : { food: 0, energy: 0 };
  const reserve = upkeep(state, actor.id) * 2;
  const spendsPromiseOrReserve = (option: ActionOption): boolean => {
    if (!outgoing.length) return false;
    const cost = actionSupplies(state, actor, option, rounds);
    return (cost.food > 0 || cost.energy > 0) && (actor.resources.food < held.food + reserve + cost.food || actor.resources.energy < held.energy + cost.energy);
  };
  for (const option of options) {
    const action = option.action; const assessment: Assessment = { weight: null, priority: 0, reason: '', protected: false };
    if (spendsPromiseOrReserve(option)) { assessment.weight = 0; assessment.protected = true; }
    if ((action.type === 'respond-trade' || action.type === 'respond-public-project') && !action.accept
      && spendsPromiseOrReserve({ ...option, action: { ...action, accept: true } })) {
      assessment.weight = action.type === 'respond-trade' ? 30 * profile.priorities.trade : 80 * profile.priorities.recovery;
      assessment.priority = action.type === 'respond-trade' ? 3 : 4;
      assessment.reason = `Decline ${action.type === 'respond-trade' ? action.offerId : action.projectId}; the new obligation would consume promised relief supplies or the donor town reserve.`;
    }
    if (action.type === 'propose-relief') {
      const quote = quoteReliefProposal(state, actor.id, action);
      assessment.weight = 0;
      if (quote.ok) {
        const terms = quote.terms; const target = Math.max(1, upkeep(state, terms.recipientId) * 2);
        const need = Math.max(0, target - terms.proposal.recipientFood);
        const preference = (profile.priorities.trade + profile.priorities.recovery + profile.priorities.civic) / 3;
        assessment.weight = (16 + terms.food) * preference * (1 + Math.min(1, need / target)) / Math.max(1, terms.travelRounds / 2);
        assessment.priority = 1;
        assessment.reason = `Offer ${terms.food} Food relief from unpromised surplus; retain four upkeep beats and seek explicit consent, not immediate delivery.`;
      }
    } else if (action.type === 'respond-relief' || action.type === 'withdraw-relief') {
      assessment.weight = 0;
      const charter = state.relief.active.find(candidate => candidate.id === action.charterId);
      if (charter && !reliefActionFailure(state, actor.id, action)) {
        if (action.type === 'respond-relief') {
          const useful = actor.resources.food < upkeep(state, actor.id) * 2;
          const funded = !reliefActionFailure(state, actor.id, { ...action, accept: true });
          const accept = useful && funded;
          if (action.accept === accept) {
            assessment.weight = (accept ? 80 : 40) * profile.priorities.recovery;
            assessment.priority = accept ? 4 : 3;
            assessment.reason = accept ? `Accept the exact ${charter.terms.food} Food relief for current town reserves; no stock arrives until the funded due transfer.`
              : `Decline ${charter.id}; ${useful ? 'the exact offer is no longer currently deliverable' : 'current Food already covers two upkeep beats'}. No penalty or resized cargo.`;
          }
        } else {
          const donor = actor.id === charter.terms.donorId;
          const risk = donor && donorAtRisk(state, charter);
          const recovered = !donor && actor.resources.food >= upkeep(state, actor.id) * 3;
          if (risk || recovered) {
            assessment.weight = 80 * profile.priorities.recovery; assessment.priority = risk ? 5 : 3;
            assessment.reason = risk ? `Withdraw ${charter.id} explicitly; current supplies and other promises no longer protect two upkeep beats or the agreed Energy.`
              : `Withdraw ${charter.id} explicitly; current Food covers three upkeep beats, so this aid is no longer useful. No penalty.`;
          }
        }
      }
    } else if (action.type === 'stop-trade') {
      const useful = state.relief.active.some(charter => charter.terms.routeId === action.routeId
        && (charter.terms.donorId === actor.id || charter.terms.recipientId === actor.id) && !donorAtRisk(state, charter)
        && (state.civilizations.find(civ => civ.id === charter.terms.recipientId)?.resources.food ?? Infinity) < upkeep(state, charter.terms.recipientId) * 3);
      if (useful) { assessment.weight = 0; assessment.protected = true; }
    }
    assessments.set(option, assessment);
  }
  return { assessments, promised };
}

export function reliefWeight(option: ActionOption, base: number, plan: ReliefPlan): number { return plan.assessments.get(option)?.weight ?? base; }
export function reliefPriority(option: ActionOption, plan: ReliefPlan): number { return plan.assessments.get(option)?.priority ?? 0; }
export function reliefReason(option: ActionOption, plan: ReliefPlan): string | null { return plan.assessments.get(option)?.reason || null; }
export function reliefProtects(option: ActionOption, plan: ReliefPlan): boolean { return plan.assessments.get(option)?.protected ?? false; }
