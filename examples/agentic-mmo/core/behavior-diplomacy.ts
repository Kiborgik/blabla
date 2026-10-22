import { civilizationBehaviorProfile, type BehaviorProfile } from './behavior-profiles.ts';
import { BUILDINGS, ECONOMY_RULES, IMPROVEMENTS, INDUSTRIAL_RULES, PUBLIC_PROJECT_RECIPES, RESOURCE_IDS, STRATEGIC_RESOURCE_IDS, TRADE_RECIPES, WONDERS } from './content.ts';
import { governmentPrice } from './simulation/government.ts';
import { hasFeatures } from './simulation/history.ts';
import { quoteMarsMission } from './simulation/spaceflight.ts';
import { strategicObligations } from './simulation/trade.ts';
import type { ActionOption, Civilization, PublicProject, Resources, Route, StrategicResources, TradeTerms, WorldState } from './types.ts';

interface Budget { ordinary: Resources; strategic: StrategicResources }
interface Assessment { weight: number | null; priority: number; reason: string; protected: boolean }
interface RoutePlan { useful: boolean; funded: boolean; stop: boolean; urgentRepair: boolean; shared: boolean; reason: string }
export interface DiplomacyPlan {
  readonly assessments: ReadonlyMap<ActionOption, Assessment>;
  readonly routes: ReadonlyMap<string, RoutePlan>;
  readonly promised: Readonly<Resources>;
}

const empty = (): Resources => ({ food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 });
const samePair = (route: Route, a: number, b: number): boolean => route.owner === a && route.partner === b || route.owner === b && route.partner === a;
const add = (target: Resources, source: Partial<Resources>): void => { for (const resource of RESOURCE_IDS) target[resource] += source[resource] ?? 0; };
const sum = (...vectors: Partial<Resources>[]): Resources => { const result = empty(); vectors.forEach(vector => add(result, vector)); return result; };
const upkeep = (state: WorldState, seat: number): number => state.cities.filter(city => city.civId === seat).reduce((total, city) => total + city.population * ECONOMY_RULES.populationFoodUpkeep, 0);

function obligations(terms: TradeTerms, proposer: boolean): Budget {
  return { ordinary: sum(proposer ? terms.proposerCargo : terms.recipientCargo, proposer ? terms.proposerUpkeep : terms.recipientUpkeep), strategic: strategicObligations(terms, proposer ? 'proposer' : 'recipient') };
}

function commitments(state: WorldState, seat: number, horizon: number, excludedRoute?: string, excludedProject?: string): Budget {
  const budget: Budget = { ordinary: empty(), strategic: {} };
  for (const project of state.publicProjects ?? []) {
    if (project.status !== 'committed' || project.id === excludedProject || project.proposer !== seat && project.recipient !== seat) continue;
    add(budget.ordinary, project.proposer === seat ? project.terms.proposerContribution : project.terms.recipientContribution);
  }
  for (const route of state.routes) {
    if (!route.agreement?.enabled || route.id === excludedRoute || route.owner !== seat && route.partner !== seat || route.agreement.nextDeliveryRound > state.round + horizon) continue;
    const due = obligations(route.agreement.terms, route.owner === seat); add(budget.ordinary, due.ordinary);
    for (const resource of STRATEGIC_RESOURCE_IDS) budget.strategic[resource] = (budget.strategic[resource] ?? 0) + (due.strategic[resource] ?? 0);
  }
  return budget;
}

function affordable(state: WorldState, actor: Civilization, cost: Budget, held: Budget, foodReserve = true): boolean {
  return RESOURCE_IDS.every(resource => actor.resources[resource] >= cost.ordinary[resource] + held.ordinary[resource] + (resource === 'food' && foodReserve ? upkeep(state, actor.id) * 2 : 0))
    && STRATEGIC_RESOURCE_IDS.every(resource => (actor.strategicResources?.[resource] ?? 0) >= (cost.strategic[resource] ?? 0) + (held.strategic[resource] ?? 0));
}

function utility(state: WorldState, actor: Civilization, profile: BehaviorProfile, terms: TradeTerms, proposer: boolean): { gain: number; loss: number; useful: boolean; harmful: boolean } {
  const incoming = proposer ? terms.recipientCargo : terms.proposerCargo;
  const received = proposer ? terms.proposerYield : terms.recipientYield;
  const due = obligations(terms, proposer);
  const desired: Resources = { food: upkeep(state, actor.id) * 4, materials: 24, energy: 12, credits: 24, science: 0, culture: 0 };
  let gain = 0; let loss = 0; let stableGain = 0; let stableLoss = 0;
  for (const resource of RESOURCE_IDS) {
    const weight = profile.resources[resource];
    const need = 1 + desired[resource] / Math.max(1, actor.resources[resource] + desired[resource]);
    const incomingAmount = (incoming[resource] ?? 0) + (received[resource] ?? 0);
    gain += incomingAmount * weight * need; loss += due.ordinary[resource] * weight * need;
    stableGain += incomingAmount * weight; stableLoss += due.ordinary[resource] * weight;
  }
  const receivedStrategic = proposer ? terms.strategicCargo?.recipient : terms.strategicCargo?.proposer;
  for (const resource of STRATEGIC_RESOURCE_IDS) {
    const need = (actor.strategicResources?.[resource] ?? 0) < 6 ? 3 : 1;
    gain += (receivedStrategic?.[resource] ?? 0) * need; loss += (due.strategic[resource] ?? 0) * need;
    stableGain += (receivedStrategic?.[resource] ?? 0) * 2; stableLoss += due.strategic[resource] ?? 0;
  }
  if (terms.transport?.mode === 'steam' && terms.transport.railEdges.length && terms.cadenceRounds < terms.transport.unrailedCadence) {
    const cadenceBenefit = Math.min(1.25, terms.transport.unrailedCadence / terms.cadenceRounds);
    gain *= cadenceBenefit; stableGain *= cadenceBenefit;
  }
  return { gain, loss, useful: gain >= loss * 0.85 || stableGain >= stableLoss * 0.85, harmful: gain < loss * 0.55 && stableGain < stableLoss * 0.7 };
}

function routePlan(state: WorldState, route: Route, actor: Civilization, profile: BehaviorProfile): RoutePlan {
  const agreement = route.agreement;
  if (!agreement?.enabled) return { useful: false, funded: false, stop: false, urgentRepair: false, shared: false, reason: 'The exact route no longer has active consent.' };
  const proposer = route.owner === actor.id;
  const other = state.civilizations.find(candidate => candidate.id === (proposer ? route.partner : route.owner));
  const value = utility(state, actor, profile, agreement.terms, proposer);
  const own = obligations(agreement.terms, proposer);
  const partner = obligations(agreement.terms, !proposer);
  const funded = affordable(state, actor, own, commitments(state, actor.id, 2, route.id), false)
    && !!other && affordable(state, other, partner, commitments(state, other.id, 2, route.id), false);
  const incoming = proposer ? agreement.terms.recipientCargo : agreement.terms.proposerCargo;
  const outgoing = proposer ? agreement.terms.proposerCargo : agreement.terms.recipientCargo;
  const foodDanger = (outgoing.food ?? 0) > (incoming.food ?? 0) && actor.resources.food < upkeep(state, actor.id) * 2;
  const mature = state.round - agreement.acceptedRound >= Math.max(8, agreement.terms.cadenceRounds * 3);
  const stale = state.round - (agreement.lastDeliveryRound ?? agreement.acceptedRound) >= Math.max(8, agreement.terms.cadenceRounds * 3);
  const attempted = agreement.lastAttemptRound !== null && agreement.lastAttemptRound > (agreement.lastDeliveryRound ?? agreement.acceptedRound);
  const unsupplied = stale && attempted && agreement.blockedBy !== null && !funded;
  const uneconomic = mature && value.harmful;
  const stop = foodDanger && agreement.nextDeliveryRound <= state.round + 2 || unsupplied || uneconomic;
  const critical = (incoming.food ?? 0) > 0 && actor.resources.food < upkeep(state, actor.id) * 3
    || (incoming.energy ?? 0) > 0 && actor.resources.energy < 5;
  const shared = !!other && utility(state, other, civilizationBehaviorProfile(state.seed, other.id), agreement.terms, !proposer).useful && value.useful && !stop;
  return { useful: value.useful && !stop, funded, stop, shared,
    urgentRepair: !stop && value.useful && route.damage >= agreement.terms.damageDisableAt && critical && agreement.nextDeliveryRound <= state.round + 2,
    reason: foodDanger ? 'Outgoing food would endanger town meals.' : unsupplied ? `No shipment since round ${agreement.lastDeliveryRound ?? agreement.acceptedRound}; current cargo remains unfunded.` : uneconomic ? 'The mature exchange currently consumes substantially more useful supplies than it returns.' : 'Retain this useful exchange through temporary shortages and modest changes in demand.' };
}

function projectUseful(state: WorldState, project: PublicProject, routes: ReadonlyMap<string, RoutePlan>): boolean {
  const route = state.routes.find(candidate => candidate.id === project.routeId);
  return !!route?.agreement?.enabled && route.agreement.offerId === project.agreementOfferId && route.damage > 0 && routes.get(route.id)?.shared === true;
}

function projectAffordable(state: WorldState, project: Pick<PublicProject, 'id' | 'proposer' | 'recipient' | 'terms'>): boolean {
  return ([project.proposer, project.recipient] as const).every(seat => {
    const actor = state.civilizations.find(candidate => candidate.id === seat);
    const ordinary = sum(seat === project.proposer ? project.terms.proposerContribution : project.terms.recipientContribution);
    return !!actor && affordable(state, actor, { ordinary, strategic: {} }, commitments(state, seat, project.terms.completionDelayRounds, undefined, project.id));
  });
}

function actionCost(state: WorldState, actor: Civilization, option: ActionOption): Budget {
  const action = option.action;
  let ordinary: Partial<Resources> = {}; let strategic: StrategicResources = {};
  switch (action.type) {
    case 'build': ordinary = BUILDINGS.find(item => item.id === action.project)?.cost ?? {}; break;
    case 'improve': ordinary = IMPROVEMENTS.find(item => item.id === action.improvementId)?.cost ?? {}; break;
    case 'build-wonder': ordinary = WONDERS.find(item => item.id === action.wonderId)?.cost ?? {}; break;
    case 'build-rail': ordinary = INDUSTRIAL_RULES.railCost; strategic = INDUSTRIAL_RULES.railStrategicCost; break;
    case 'acquire-tile': ordinary = option.territoryQuote?.paid ?? {}; break;
    case 'settle': case 'settle-coast': ordinary = ECONOMY_RULES.settle.cost; break;
    case 'repair': case 'repair-city': ordinary = ECONOMY_RULES.repair.cost; break;
    case 'expedition': ordinary = quoteMarsMission(state, actor.id, action.cityId, action.mission)?.totalCost ?? {}; break;
    case 'adopt-government': ordinary = { credits: governmentPrice(state, actor.id, action.governmentId).credits }; break;
    case 'set-building-operation': {
      const building = BUILDINGS.find(item => item.id === action.buildingId);
      if (action.enabled) { ordinary = building?.operatingInputs ?? {}; strategic = building?.strategicInputs ?? {}; }
      break;
    }
    default: break;
  }
  return { ordinary: sum(ordinary), strategic };
}

function tradeFeasible(state: WorldState, actor: Civilization, partner: Civilization, terms: TradeTerms, proposer: boolean): boolean {
  return ([{ actor, proposer }, { actor: partner, proposer: !proposer }]).every(side => {
    const cost = obligations(terms, side.proposer);
    if (side.proposer) add(cost.ordinary, terms.constructionCost);
    return affordable(state, side.actor, cost, commitments(state, side.actor.id, Infinity))
      && utility(state, side.actor, civilizationBehaviorProfile(state.seed, side.actor.id), terms, side.proposer).useful;
  });
}

function reconsidering(state: WorldState, seat: number, partner: number, terms: TradeTerms): boolean {
  const previous = state.routes.filter(route => samePair(route, seat, partner) && route.agreement?.closedRound !== null && !route.agreement?.enabled)
    .toSorted((a, b) => (b.agreement?.closedRound ?? -1) - (a.agreement?.closedRound ?? -1))[0];
  if (previous?.agreement && state.round - (previous.agreement.closedRound ?? 0) < Math.max(4, previous.agreement.terms.cadenceRounds * 2)) {
    const faster = terms.transport?.mode === 'steam' && previous.agreement.terms.transport?.mode !== 'steam' && terms.cadenceRounds < previous.agreement.terms.cadenceRounds;
    if (!faster) return true;
  }
  return (state.tradeOffers ?? []).some(offer => (offer.proposer === seat && offer.recipient === partner || offer.proposer === partner && offer.recipient === seat)
    && ['declined', 'expired', 'withdrawn'].includes(offer.status) && offer.terms.recipeId === terms.recipeId && state.round < offer.createdRound + 8);
}

export function deriveDiplomacyPlan(state: WorldState, actor: Civilization, profile: BehaviorProfile, options: readonly ActionOption[]): DiplomacyPlan {
  const assessments = new Map<ActionOption, Assessment>(); const routes = new Map<string, RoutePlan>(); const promised = empty();
  if (!hasFeatures(state, ['partnership-stewardship'])) return { assessments, routes, promised };
  for (const route of state.routes) if (route.owner === actor.id || route.partner === actor.id) routes.set(route.id, routePlan(state, route, actor, profile));
  for (const project of state.publicProjects ?? []) if (project.status === 'committed' && (project.proposer === actor.id || project.recipient === actor.id))
    add(promised, project.proposer === actor.id ? project.terms.proposerContribution : project.terms.recipientContribution);
  const held = commitments(state, actor.id, 2);
  const protecting = RESOURCE_IDS.some(resource => held.ordinary[resource] > 0) || STRATEGIC_RESOURCE_IDS.some(resource => (held.strategic[resource] ?? 0) > 0);
  for (const option of options) {
    const action = option.action;
    const assessment: Assessment = { weight: null, priority: 0, reason: '', protected: false };
    const cost = actionCost(state, actor, option);
    const spends = RESOURCE_IDS.some(resource => cost.ordinary[resource] > 0) || STRATEGIC_RESOURCE_IDS.some(resource => (cost.strategic[resource] ?? 0) > 0);
    if (protecting && spends && !affordable(state, actor, cost, held, false)) {
      assessment.weight = 0; assessment.protected = true;
    }
    if (action.type === 'propose-public-project') {
      const route = state.routes.find(candidate => candidate.id === action.routeId);
      const recipe = PUBLIC_PROJECT_RECIPES.find(candidate => candidate.id === action.recipeId);
      const partner = route?.owner === actor.id ? route.partner : route?.owner;
      const plan = routes.get(action.routeId);
      const worthwhile = !!route && !!recipe && partner !== undefined && plan?.shared && !plan.urgentRepair
        && projectAffordable(state, { id: '', proposer: actor.id, recipient: partner, terms: recipe.terms });
      assessment.weight = worthwhile ? 36 * profile.priorities.trade * profile.priorities.recovery : 0;
      assessment.priority = worthwhile ? 2 : 0;
      assessment.reason = `Offer a delayed shared repair of ${action.routeId}; both partners can cover their exact pledges without escrow.`;
    } else if (action.type === 'respond-public-project' || action.type === 'cancel-public-project') {
      const project = state.publicProjects?.find(candidate => candidate.id === action.projectId);
      const worthwhile = !!project && projectUseful(state, project, routes) && projectAffordable(state, project);
      const chosen = action.type === 'cancel-public-project' ? !worthwhile : action.accept === worthwhile;
      assessment.weight = chosen ? 80 : 0; assessment.priority = chosen ? 4 : 0;
      assessment.reason = worthwhile && project ? `Accept ${project.id}; preserve unfunded contributions for repair due round ${state.round + project.terms.completionDelayRounds}.`
        : `Decline or cancel ${action.projectId}; current supplies or the exact useful repair no longer support this promise.`;
    } else if (action.type === 'repair') {
      const route = state.routes.find(candidate => candidate.id === action.routeId); const plan = routes.get(action.routeId);
      const project = state.publicProjects?.find(candidate => candidate.routeId === action.routeId);
      const cooperative = options.some(candidate => {
        const proposal = candidate.action;
        return proposal.type === 'propose-public-project' && proposal.routeId === action.routeId
          && PUBLIC_PROJECT_RECIPES.some(recipe => recipe.id === proposal.recipeId && route && projectAffordable(state, { id: '', proposer: actor.id, recipient: route.owner === actor.id ? route.partner : route.owner, terms: recipe.terms }));
      });
      const waiting = project?.status === 'committed' && project.dueRound <= (route?.agreement?.nextDeliveryRound ?? 0);
      const immediate = plan?.urgentRepair && !waiting;
      const solo = plan?.useful && (immediate || !project && !cooperative);
      assessment.weight = solo && !assessment.protected ? (route?.damage ?? 0) * profile.priorities.recovery : 0;
      assessment.priority = assessment.weight > 0 && route && route.damage >= (route.agreement?.terms.damageDisableAt ?? 50) ? 5 : 0;
      assessment.reason = `Pay the solo repair cost for ${action.routeId}; waiting would delay needed supplies or no affordable shared repair is available.`;
    } else if (action.type === 'stop-trade') {
      const plan = routes.get(action.routeId); assessment.weight = plan?.stop ? 45 * profile.priorities.trade : 0;
      assessment.priority = plan?.stop ? 2 : 0; assessment.reason = `End ${action.routeId}. ${plan?.reason ?? ''} Consider separately consenting suppliers.`;
    } else if (action.type === 'propose-trade' || action.type === 'respond-trade' || action.type === 'withdraw-trade') {
      const offer = action.type === 'propose-trade' ? undefined : state.tradeOffers?.find(candidate => candidate.id === action.offerId);
      const recipe = action.type === 'propose-trade' ? TRADE_RECIPES.find(candidate => candidate.id === action.recipeId) : undefined;
      const terms = offer?.terms ?? (recipe ? { ...recipe.terms, ...(option.tradeQuote ? { transport: option.tradeQuote.transport, cadenceRounds: option.tradeQuote.cadenceRounds } : {}) } : undefined);
      const partnerId = action.type === 'propose-trade' ? action.partner : offer?.proposer === actor.id ? offer.recipient : offer?.proposer;
      const partner = state.civilizations.find(candidate => candidate.id === partnerId);
      const proposer = action.type !== 'respond-trade';
      const feasible = !!terms && !!partner && tradeFeasible(state, actor, partner, terms, proposer);
      if (action.type === 'propose-trade') {
        const usefulTransport = action.transportMode !== 'steam' || terms?.transport?.mode === 'steam' && terms.transport.railEdges.length > 0 && terms.cadenceRounds < terms.transport.unrailedCadence;
        const useful = feasible && usefulTransport && terms && !reconsidering(state, actor.id, action.partner, terms);
        assessment.weight = useful ? Math.max(8, utility(state, actor, profile, terms, true).gain) * profile.priorities.trade / Math.max(1, terms.cadenceRounds / 4) : 0;
        if (useful && action.transportMode === 'steam') assessment.weight *= 25;
        assessment.reason = `Seek fresh consent from ${partner?.name ?? 'the partner'} for an exchange both sides can currently supply; shipment remains later.`;
      } else if (action.type === 'respond-trade') {
        assessment.weight = action.accept === feasible ? 30 * profile.priorities.trade * (action.accept && terms?.transport?.mode === 'steam' ? 12 : 1) : 0;
        assessment.priority = assessment.weight > 0 ? 3 : 0;
        assessment.reason = `${action.accept ? 'Accept' : 'Decline'} ${action.offerId}; ${feasible ? 'both cargo budgets and existing promises fit' : 'current cargo, town needs or existing promises do not support this exchange'}.`;
      } else {
        assessment.weight = feasible ? 0 : 12; assessment.priority = feasible ? 0 : 2;
        assessment.reason = `Withdraw ${action.offerId}; current supplies no longer support the offered exchange.`;
      }
    }
    assessments.set(option, assessment);
  }
  return { assessments, routes, promised };
}

export function diplomacyWeight(option: ActionOption, base: number, plan: DiplomacyPlan): number { return plan.assessments.get(option)?.weight ?? base; }
export function diplomacyPriority(option: ActionOption, plan: DiplomacyPlan): number { return plan.assessments.get(option)?.priority ?? 0; }
export function diplomacyReason(option: ActionOption, plan: DiplomacyPlan): string | null { return plan.assessments.get(option)?.reason || null; }
export function diplomacyProtects(option: ActionOption, plan: DiplomacyPlan): boolean { return plan.assessments.get(option)?.protected ?? false; }
