import { PUBLIC_PROJECT_RECIPES, PUBLIC_PROJECT_RULES, RESOURCE_IDS } from '../content.ts';
import type { ActionOption, GameAction, GameEvent, PublicProject, PublicProjectResult, PublicProjectTerms, Resources, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';
import { canAfford, citiesOf, civilizationById, transferCost } from './world.ts';

type ProjectAction = Extract<GameAction, { type: 'propose-public-project' | 'respond-public-project' | 'cancel-public-project' }>;

function pair(a: number, b: number): string { return `${Math.min(a, b)}:${Math.max(a, b)}`; }
function amounts(vector: Partial<Resources>): string {
  return RESOURCE_IDS.filter((resource) => (vector[resource] ?? 0) > 0).map((resource) => `${resource} ${vector[resource]}`).join(', ');
}
function termsDescription(terms: PublicProjectTerms): string {
  return `Proposer pledges ${amounts(terms.proposerContribution)}; recipient pledges ${amounts(terms.recipientContribution)}. Repair up to ${terms.damageReduction} damage. Unfunded pledge: no reservation; later spending may prevent fulfillment.`;
}
function targetFailure(state: WorldState, project: Pick<PublicProject, 'routeId' | 'agreementOfferId' | 'proposer' | 'recipient' | 'terms'>): string | null {
  const route = state.routes.find((candidate) => candidate.id === project.routeId);
  if (!route) return `Route ${project.routeId} is missing`;
  if (!route.agreement?.enabled) return `Route ${project.routeId} consent is stopped`;
  if (route.agreement.offerId !== project.agreementOfferId) return 'The bound route agreement was replaced';
  if (pair(route.owner, route.partner) !== pair(project.proposer, project.recipient)) return 'Route participants no longer match the charter';
  if (!state.cities.some((city) => city.id === route.from && city.civId === route.owner)
    || !state.cities.some((city) => city.id === route.to && city.civId === route.partner)) return 'An owned route endpoint is missing';
  const recipe = PUBLIC_PROJECT_RECIPES.find((candidate) => candidate.id === project.terms.recipeId);
  if (!recipe || !hasFeatures(state, recipe.requiredFeatures)) return 'The charter recipe is unavailable';
  for (const seat of [project.proposer, project.recipient]) {
    if (!state.civilizations.find((civilization) => civilization.id === seat)?.technologies.includes(recipe.requiredTechnology))
      return `Civilization ${seat} lacks ${recipe.requiredTechnology}`;
    if (!citiesOf(state, seat).some((city) => city.buildings.includes(recipe.requiredBuilding)))
      return `Civilization ${seat} lacks an owned ${recipe.requiredBuilding}`;
  }
  return null;
}
function paymentFailure(state: WorldState, project: PublicProject): string | null {
  for (const [seat, cost] of [[project.proposer, project.terms.proposerContribution], [project.recipient, project.terms.recipientContribution]] as const) {
    const resources = civilizationById(state, seat).resources;
    if (!canAfford(resources, cost)) return `Civilization ${seat} contribution shortage: ${RESOURCE_IDS.filter((resource) => resources[resource] < (cost[resource] ?? 0)).map((resource) => `${resource} ${resources[resource]}/${cost[resource]}`).join(', ')}`;
  }
  return null;
}

export function publicProjectActionFailure(state: WorldState, seat: number, action: ProjectAction): string | null {
  if (!hasFeatures(state, ['public-projects'])) return 'Public projects are not released';
  if (action.type === 'propose-public-project') {
    const route = state.routes.find((candidate) => candidate.id === action.routeId);
    const recipe = PUBLIC_PROJECT_RECIPES.find((candidate) => candidate.id === action.recipeId);
    if (!route?.agreement || !recipe) return 'The exact agreed route or charter recipe is missing';
    if (!Number.isSafeInteger(state.round + recipe.terms.pendingLifetimeRounds)) return 'The charter expiry would exceed safe round accounting';
    if (route.owner !== seat && route.partner !== seat) return 'Only a route participant can propose this charter';
    const recipient = route.owner === seat ? route.partner : route.owner;
    const failure = targetFailure(state, { routeId: route.id, agreementOfferId: route.agreement.offerId, proposer: seat, recipient, terms: recipe.terms });
    if (failure) return failure;
    if (route.damage <= 0) return 'The route already needs no repair';
    if ((state.publicProjects ?? []).length >= PUBLIC_PROJECT_RULES.maxActiveTotal) return 'The bounded public project capacity is full';
    if ((state.publicProjects ?? []).filter((project) => pair(project.proposer, project.recipient) === pair(seat, recipient)).length >= PUBLIC_PROJECT_RULES.maxActivePerPair)
      return 'These partners already have a pending or committed charter';
    return null;
  }
  const project = state.publicProjects?.find((candidate) => candidate.id === action.projectId);
  if (!project) return 'The exact public project is missing or already resolved';
  if (action.type === 'cancel-public-project') {
    if (seat !== project.proposer && (project.status !== 'committed' || seat !== project.recipient)) return 'This actor cannot cancel that charter';
    return null;
  }
  if (project.status !== 'pending' || state.round >= project.expiresRound) return 'The charter is no longer awaiting consent';
  if (seat !== project.recipient) return 'Only the named recipient can respond';
  if (!action.accept) return null;
  if (!Number.isSafeInteger(state.round + project.terms.completionDelayRounds)) return 'The charter due round would exceed safe round accounting';
  const failure = targetFailure(state, project);
  if (failure) return failure;
  if ((state.routes.find((route) => route.id === project.routeId)?.damage ?? 0) <= 0) return 'The route already needs no repair';
  return paymentFailure(state, project);
}

export function availablePublicProjectActions(state: WorldState, seat: number): ActionOption[] {
  if (!hasFeatures(state, ['public-projects'])) return [];
  const choices: ActionOption[] = [];
  for (const route of state.routes) for (const recipe of PUBLIC_PROJECT_RECIPES) {
    const action: ProjectAction = { type: 'propose-public-project', routeId: route.id, recipeId: recipe.id };
    if (publicProjectActionFailure(state, seat, action)) continue;
    choices.push({ action, label: `Propose ${recipe.name} for ${route.id}`, reason: `${termsDescription(recipe.terms)} Pending until round ${state.round + recipe.terms.pendingLifetimeRounds}; due ${recipe.terms.completionDelayRounds} rounds after acceptance.` });
  }
  for (const project of state.publicProjects ?? []) {
    const actions: ProjectAction[] = [{ type: 'cancel-public-project', projectId: project.id }];
    if (project.status === 'pending') actions.push({ type: 'respond-public-project', projectId: project.id, accept: false }, { type: 'respond-public-project', projectId: project.id, accept: true });
    for (const action of actions) {
      if (publicProjectActionFailure(state, seat, action)) continue;
      choices.push({ action, label: `${action.type === 'cancel-public-project' ? 'Cancel' : action.type === 'respond-public-project' && action.accept ? 'Accept' : 'Decline'} ${project.id}`, reason: `${termsDescription(project.terms)} ${project.status === 'pending' ? `Expires round ${project.expiresRound}; accepting now makes repair due round ${state.round + project.terms.completionDelayRounds}.` : `Due round ${project.dueRound}, after production, upkeep and trade.`}` });
    }
  }
  return choices;
}

function finish(state: WorldState, project: PublicProject, outcome: PublicProjectResult['outcome'], reason: string, events: GameEvent[], actor: number = project.proposer): void {
  const route = state.routes.find((candidate) => candidate.id === project.routeId);
  const before = route?.damage ?? null;
  const proposerPaid: Partial<Resources> = outcome === 'completed' ? structuredClone(project.terms.proposerContribution) : {};
  const recipientPaid: Partial<Resources> = outcome === 'completed' ? structuredClone(project.terms.recipientContribution) : {};
  if (outcome === 'completed' && route) {
    transferCost(civilizationById(state, project.proposer).resources, proposerPaid);
    transferCost(civilizationById(state, project.recipient).resources, recipientPaid);
    route.damage = Math.max(0, route.damage - project.terms.damageReduction);
  }
  const result: PublicProjectResult = { projectId: project.id, routeId: project.routeId, agreementOfferId: project.agreementOfferId, outcome, reason, proposer: project.proposer, recipient: project.recipient, proposerPaid, recipientPaid, damageBefore: before, damageAfter: route?.damage ?? null };
  emitEvent(state, events, {
    type: `public-project-${outcome}`, title: `Joint road repair ${outcome}`, detail: project.id,
    actor, target: actor === project.proposer ? project.recipient : project.proposer,
    tileId: state.cities.find((city) => city.id === route?.from)?.tileId ?? null,
    cause: reason, effects: [`Proposer paid: ${amounts(proposerPaid) || 'none'}`, `Recipient paid: ${amounts(recipientPaid) || 'none'}`, `Route damage ${before ?? 'missing'} → ${result.damageAfter ?? 'missing'}`, 'No shipment is created by this charter outcome'], importance: 3, publicProjectResult: result,
  });
  state.publicProjects = (state.publicProjects ?? []).filter((candidate) => candidate.id !== project.id);
}

export function executePublicProjectAction(state: WorldState, seat: number, action: ProjectAction, events: GameEvent[]): void {
  const failure = publicProjectActionFailure(state, seat, action);
  if (failure) throw new RangeError(failure);
  if (action.type === 'propose-public-project') {
    const route = state.routes.find((candidate) => candidate.id === action.routeId);
    const recipe = PUBLIC_PROJECT_RECIPES.find((candidate) => candidate.id === action.recipeId);
    if (!route?.agreement || !recipe) throw new RangeError('Exact charter target is missing');
    const project: PublicProject = { id: `project-${state.revision}`, routeId: route.id, agreementOfferId: route.agreement.offerId, proposer: seat, recipient: route.owner === seat ? route.partner : route.owner, terms: structuredClone(recipe.terms), proposedRound: state.round, status: 'pending', expiresRound: state.round + recipe.terms.pendingLifetimeRounds };
    state.publicProjects ??= [];
    state.publicProjects.push(project);
    emitEvent(state, events, { type: 'public-project-proposed', title: 'A shared repair is proposed', detail: project.id, actor: seat, target: project.recipient, tileId: null, cause: `Exact route ${route.id}, agreement ${route.agreement.offerId}, recipe ${recipe.id} version ${recipe.version}`, effects: [termsDescription(project.terms), `Consent expires round ${project.expiresRound}`, 'No stock collected or reserved'], importance: 3 });
    return;
  }
  const project = state.publicProjects?.find((candidate) => candidate.id === action.projectId);
  if (!project) throw new RangeError('Exact charter is missing');
  if (action.type === 'cancel-public-project' || !action.accept) {
    finish(state, project, action.type === 'cancel-public-project' ? 'cancelled' : 'declined', `Civilization ${seat} explicitly ${action.type === 'cancel-public-project' ? 'cancelled' : 'declined'} the charter`, events, seat);
    return;
  }
  const committed: PublicProject = { id: project.id, routeId: project.routeId, agreementOfferId: project.agreementOfferId, proposer: project.proposer, recipient: project.recipient, terms: project.terms, proposedRound: project.proposedRound, status: 'committed', acceptedRound: state.round, dueRound: state.round + project.terms.completionDelayRounds };
  state.publicProjects = (state.publicProjects ?? []).map((candidate) => candidate.id === project.id ? committed : candidate);
  emitEvent(state, events, { type: 'public-project-committed', title: 'Both partners commit to a shared repair', detail: project.id, actor: seat, target: project.proposer, tileId: null, cause: `Recipient accepted exact charter ${project.id}`, effects: [termsDescription(project.terms), `Due round ${committed.dueRound}, after production, upkeep and trade`, 'No stock collected or reserved; route condition and cargo are unchanged'], importance: 3 });
}

export function resolvePublicProjects(state: WorldState, events: GameEvent[]): void {
  if (!hasFeatures(state, ['public-projects'])) return;
  for (const project of (state.publicProjects ?? []).toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (project.status === 'pending' && state.round >= project.expiresRound) {
      finish(state, project, 'expired', `Consent window ended at round ${project.expiresRound}`, events);
      continue;
    }
    if (project.status === 'committed' && state.round < project.dueRound) continue;
    const failure = targetFailure(state, project);
    if (failure) { finish(state, project, 'failed', failure, events); continue; }
    const route = state.routes.find((candidate) => candidate.id === project.routeId);
    if (route?.damage === 0) { finish(state, project, 'no-work-needed', 'The exact route is already fully repaired', events); continue; }
    if (project.status === 'pending') continue;
    const shortage = paymentFailure(state, project);
    finish(state, project, shortage ? 'failed' : 'completed', shortage ?? 'Both complete contributions paid after ordinary production, upkeep and trade', events);
  }
}
