import { borderDealFailure } from './border-incidents.ts';
import { FOOD_BUDGET_RULES } from '../food-security-content.ts';
import { foodRuleId, foodUpkeepPerResident, householdFoodUpkeep } from './food-security.ts';
import { RELIEF_RULES } from '../relief-content.ts';
import type { ReliefAction, ReliefBalances, ReliefCharter, ReliefProposalQuote, ReliefResult, ReliefState, ReliefTerms } from '../relief-types.ts';
import { isReliefAction } from '../relief-validation.ts';
import type { ActionOption, GameAction, GameEvent, Resources, WorldState } from '../types.ts';
import { emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';
import { isTransportQuote, landTransportBlock } from './transport.ts';
import { totalPopulation } from './world.ts';

function pair(first: number, second: number): string { return `${Math.min(first, second)}:${Math.max(first, second)}`; }
function recognized(action: GameAction): action is ReliefAction { return ['propose-relief', 'respond-relief', 'withdraw-relief'].includes(action.type); }
function commonFailure(state: WorldState, actor: number): string | null {
  if (state.outcome) return 'The world has already reached its terminal outcome';
  if (!state.civilizations.some(civ => civ.id === actor)) return 'Only an existing civilization can act on relief';
  if (!state.relief || !hasFeatures(state, [RELIEF_RULES.featureId])) return 'Consented relief is not released';
  return null;
}

export function createReliefState(state: Pick<WorldState, 'civilizations'>): ReliefState {
  return { ruleVersion: 1, active: [], lastResults: Array.from({ length: state.civilizations.length }, () => null) };
}

export function reliefPromisedResources(state: WorldState, donorId: number, excludingCharterId?: string): Partial<Resources> {
  const charters = state.relief?.active.filter(charter => charter.terms.donorId === donorId && charter.id !== excludingCharterId) ?? [];
  if (!charters.length) return {};
  return { food: charters.reduce((sum, charter) => sum + charter.terms.food, 0), energy: charters.reduce((sum, charter) => sum + charter.terms.energy, 0) };
}

function promises(state: WorldState, donorId: number, horizonRounds: number, excludingCharterId?: string): { food: number; energy: number } {
  const relief = reliefPromisedResources(state, donorId, excludingCharterId);
  const result = { food: relief.food ?? 0, energy: relief.energy ?? 0 };
  const end = state.round + horizonRounds;
  for (const route of state.routes) {
    const agreement = route.agreement;
    if (!agreement?.enabled || route.owner !== donorId && route.partner !== donorId) continue;
    const first = Math.max(state.round, agreement.nextDeliveryRound);
    if (first > end) continue;
    const count = Math.floor((end - first) / agreement.terms.cadenceRounds) + 1;
    const cargo = route.owner === donorId ? agreement.terms.proposerCargo : agreement.terms.recipientCargo;
    const upkeep = route.owner === donorId ? agreement.terms.proposerUpkeep : agreement.terms.recipientUpkeep;
    for (const resource of ['food', 'energy'] as const) result[resource] += count * ((cargo[resource] ?? 0) + (upkeep[resource] ?? 0));
  }
  for (const project of state.publicProjects ?? []) {
    if (project.status !== 'committed' || project.dueRound > end) continue;
    const contribution = project.proposer === donorId ? project.terms.proposerContribution : project.recipient === donorId ? project.terms.recipientContribution : null;
    if (contribution) for (const resource of ['food', 'energy'] as const) result[resource] += contribution[resource] ?? 0;
  }
  return result;
}

function targetFailure(state: WorldState, terms: ReliefTerms): string | null {
  if (!hasFeatures(state, [RELIEF_RULES.featureId])) return 'Consented relief is no longer released';
  const route = state.routes.find(route => route.id === terms.routeId);
  if (!route) return 'The exact consenting relief route is missing';
  if (!route.agreement?.enabled) return 'Consent for the bound route has stopped';
  if (route.agreement.offerId !== terms.agreementOfferId) return 'The bound trade agreement was replaced';
  if (pair(route.owner, route.partner) !== pair(terms.donorId, terms.recipientId)) return 'The bound route participants have changed';
  const source = state.cities.find(city => city.id === terms.sourceCityId && city.civId === terms.donorId && city.tileId === terms.sourceTileId);
  const recipient = state.cities.find(city => city.id === terms.recipientCityId && city.civId === terms.recipientId && city.tileId === terms.recipientTileId);
  if (!source || !recipient) return 'An exact owned relief town is missing or changed';
  const forward = route.owner === terms.donorId;
  if ((forward ? route.from : route.to) !== source.id || (forward ? route.to : route.from) !== recipient.id) return 'The route no longer connects the exact relief towns';
  const transport = route.agreement.terms.transport;
  if (!transport || !isTransportQuote(transport, state.tiles.length)) return 'The bound route no longer retains a supported explicit land corridor';
  const path = forward ? transport.tileIds : transport.tileIds.toReversed();
  if (transport.edges !== terms.path.edges || path.length !== terms.path.tileIds.length || !path.every((id, index) => id === terms.path.tileIds[index])) return 'The consenting route path changed';
  if (route.agreement.terms.damageDisableAt !== terms.damageDisableAt) return 'The consenting route damage threshold changed';
  if (route.damage >= terms.damageDisableAt) return 'Route damage prevents the agreed relief transfer';
  return landTransportBlock(state, terms.path, terms.sourceTileId, terms.recipientTileId);
}

function balances(state: WorldState, terms: ReliefTerms): ReliefBalances {
  const donor = state.civilizations.find(civ => civ.id === terms.donorId)!;
  const recipient = state.civilizations.find(civ => civ.id === terms.recipientId)!;
  return { donorFood: donor.resources.food, donorEnergy: donor.resources.energy, recipientFood: recipient.resources.food };
}

function fundingFailure(state: WorldState, charter: ReliefCharter, horizonRounds: number): string | null {
  const stock = balances(state, charter.terms); const committed = promises(state, charter.terms.donorId, horizonRounds, charter.id);
  if (stock.donorFood - committed.food < charter.terms.food) return 'The donor cannot fund the complete agreed Food after existing commitments';
  if (stock.donorEnergy - committed.energy < charter.terms.energy) return 'The donor cannot fund the agreed Energy after existing commitments';
  if (!Number.isFinite(stock.recipientFood + charter.terms.food) || stock.recipientFood + charter.terms.food > Number.MAX_SAFE_INTEGER) return 'Recipient Food would exceed safe resource accounting';
  return null;
}

export function quoteReliefProposal(state: WorldState, actor: number, action: Extract<ReliefAction, { type: 'propose-relief' }>): ReliefProposalQuote {
  const refuse = (reason: string): ReliefProposalQuote => ({ ok: false, reason });
  if (!isReliefAction(action)) return refuse('Relief proposal fields are malformed');
  const common = commonFailure(state, actor); if (common) return refuse(common);
  if (!Number.isSafeInteger(state.round + RELIEF_RULES.pendingLifetime + Math.ceil(RELIEF_RULES.maximumEdges / RELIEF_RULES.edgesPerRound))) return refuse('Relief timing would exceed safe round accounting');
  const layer = state.relief!;
  if (layer.active.length >= state.civilizations.length || layer.active.some(charter => charter.terms.donorId === actor)) return refuse('This donor or the bounded relief ledger already has an active charter');
  const last = layer.lastResults[actor];
  if (last && state.round < last.resolvedRound + RELIEF_RULES.cooldownRounds) return refuse(`This donor may reconsider relief from round ${last.resolvedRound + RELIEF_RULES.cooldownRounds}`);
  if (!Number.isSafeInteger((last?.charter.sequence ?? 0) + 1)) return refuse('Relief sequence accounting is exhausted');
  const route = state.routes.find(route => route.id === action.routeId);
  if (!route?.agreement?.enabled || route.owner !== actor && route.partner !== actor) return refuse('Only a participant of an enabled consenting route can propose relief');
  const recipientId = route.owner === actor ? route.partner : route.owner;
  const border = borderDealFailure(state, actor, recipientId); if (border) return refuse(border);
  if (layer.active.some(charter => pair(charter.terms.donorId, charter.terms.recipientId) === pair(actor, recipientId))) return refuse('These partners already have an active relief charter');
  const source = state.cities.find(city => city.id === action.sourceCityId && city.civId === actor);
  const recipient = state.cities.find(city => city.id === action.recipientCityId && city.civId === recipientId);
  const transport = route.agreement.terms.transport;
  if (!source || !recipient || !transport || !isTransportQuote(transport, state.tiles.length) || transport.edges > RELIEF_RULES.maximumEdges) return refuse('Relief requires exact towns and an explicit land corridor of at most twelve edges');
  const travelRounds = Math.max(RELIEF_RULES.minimumTravelRounds, Math.ceil(transport.edges / RELIEF_RULES.edgesPerRound));
  const horizonRounds = RELIEF_RULES.pendingLifetime + travelRounds; const committed = promises(state, actor, horizonRounds);
  const donorStock = state.civilizations.find(civ => civ.id === actor)!.resources;
  const recipientStock = state.civilizations.find(civ => civ.id === recipientId)!.resources;
  const donorPopulation = totalPopulation(state, actor); const recipientPopulation = totalPopulation(state, recipientId);
  const food = Math.floor(Math.min(RELIEF_RULES.maximumFood, householdFoodUpkeep(state, recipientPopulation) * 2 - recipientStock.food, donorStock.food - committed.food - householdFoodUpkeep(state, donorPopulation) * 4));
  if (food < RELIEF_RULES.minimumFood) return refuse('Initial recipient need and unpromised donor surplus do not support six Food');
  if (donorStock.energy - committed.energy < RELIEF_RULES.energyCost) return refuse('The donor lacks one unpromised Energy');
  const terms: ReliefTerms = {
    ruleVersion: 1, routeId: route.id, agreementOfferId: route.agreement.offerId, donorId: actor, recipientId,
    sourceCityId: source.id, recipientCityId: recipient.id, sourceTileId: source.tileId, recipientTileId: recipient.tileId,
    path: { mode: 'land', ruleVersion: 1, tileIds: route.owner === actor ? [...transport.tileIds] : transport.tileIds.toReversed(), edges: transport.edges },
    damageDisableAt: route.agreement.terms.damageDisableAt, food, energy: 1, travelRounds,
    proposal: { ...(foodRuleId(state) === FOOD_BUDGET_RULES.ruleId ? { kind: 'versioned-food' as const, foodRule: FOOD_BUDGET_RULES.ruleId } : {}), donorPopulation, recipientPopulation, donorFood: donorStock.food, donorEnergy: donorStock.energy, recipientFood: recipientStock.food, promisedFood: committed.food, promisedEnergy: committed.energy, horizonRounds },
  };
  const target = targetFailure(state, terms); return target ? refuse(target) : { ok: true, terms };
}

export function reliefActionFailure(state: WorldState, actor: number, action: GameAction): string | null {
  if (!recognized(action)) return null;
  if (!isReliefAction(action)) return 'Relief action fields are malformed';
  const common = commonFailure(state, actor); if (common) return common;
  if (action.type === 'propose-relief') { const quote = quoteReliefProposal(state, actor, action); return quote.ok ? null : quote.reason; }
  const charter = state.relief!.active.find(charter => charter.id === action.charterId);
  if (!charter) return 'The exact relief charter is absent or already resolved';
  if (action.type === 'withdraw-relief') return actor === charter.terms.donorId || charter.status === 'accepted' && actor === charter.terms.recipientId ? null : 'Only the donor, or a consenting recipient, can withdraw relief';
  if (actor !== charter.terms.recipientId) return 'Only the named recipient can respond to relief';
  if (charter.status !== 'proposed' || state.round >= charter.expiresRound) return 'This charter is no longer awaiting consent';
  if (!action.accept) return null;
  const border = borderDealFailure(state, charter.terms.donorId, charter.terms.recipientId); if (border) return border;
  if (!Number.isSafeInteger(state.round + charter.terms.travelRounds)) return 'Relief due round would exceed safe accounting';
  return targetFailure(state, charter.terms) ?? fundingFailure(state, charter, charter.terms.travelRounds);
}

function description(terms: ReliefTerms): string {
  return `${terms.food} Food from ${terms.sourceCityId} to ${terms.recipientCityId}; donor pays ${terms.energy} Energy only at delivery. Initial proposal need was ${terms.proposal.recipientPopulation * foodUpkeepPerResident('kind' in terms.proposal ? terms.proposal.foodRule : 'legacy-food-1') * 2 - terms.proposal.recipientFood} Food; current need may change. ${terms.path.edges} land edges, ${terms.travelRounds} rounds after acceptance. No stock reserved and no cargo in transit.`;
}

export function availableReliefActions(state: WorldState, actor: number): ActionOption[] {
  if (commonFailure(state, actor)) return [];
  const options: ActionOption[] = [];
  for (const route of state.routes.toSorted((left, right) => left.id.localeCompare(right.id))) {
    if (route.owner !== actor && route.partner !== actor) continue;
    const action: ReliefAction = { type: 'propose-relief', routeId: route.id, sourceCityId: route.owner === actor ? route.from : route.to, recipientCityId: route.owner === actor ? route.to : route.from };
    const quote = quoteReliefProposal(state, actor, action);
    if (quote.ok) options.push({ action, label: `Offer ${quote.terms.food} Food relief to ${quote.terms.recipientCityId}`, reason: description(quote.terms) });
  }
  for (const charter of state.relief!.active) {
    const actions: ReliefAction[] = [{ type: 'withdraw-relief', charterId: charter.id }];
    if (charter.status === 'proposed') actions.push({ type: 'respond-relief', charterId: charter.id, accept: false }, { type: 'respond-relief', charterId: charter.id, accept: true });
    for (const action of actions) if (!reliefActionFailure(state, actor, action)) options.push({ action, label: `${action.type === 'withdraw-relief' ? 'Withdraw' : action.type === 'respond-relief' && action.accept ? 'Accept' : 'Decline'} ${charter.id}`, reason: `${description(charter.terms)} ${charter.status === 'proposed' ? `Consent expires at round ${charter.expiresRound}.` : `Due round ${charter.dueRound}.`} Withdrawal has no penalty.` });
  }
  return options;
}

function finish(state: WorldState, charter: ReliefCharter, outcome: ReliefResult['outcome'], reason: string, actor: number | null, events: GameEvent[]): void {
  const before = balances(state, charter.terms); const delivered = outcome === 'delivered';
  if (delivered) {
    const donor = state.civilizations.find(civ => civ.id === charter.terms.donorId)!; const recipient = state.civilizations.find(civ => civ.id === charter.terms.recipientId)!;
    donor.resources.food -= charter.terms.food; donor.resources.energy -= charter.terms.energy; recipient.resources.food += charter.terms.food;
  }
  const result: ReliefResult = { ruleVersion: 1, charter: structuredClone(charter), outcome, reason, actor, resolvedRound: state.round, eventId: `${state.revision}:${events.length}`, before, after: balances(state, charter.terms), paid: { food: delivered ? charter.terms.food : 0, energy: delivered ? charter.terms.energy : 0 }, deliveredFood: delivered ? charter.terms.food : 0 };
  emitEvent(state, events, { type: `relief-${outcome}`, title: `Food relief ${outcome}`, detail: charter.id, actor, target: charter.terms.recipientId, tileId: charter.terms.recipientTileId, cause: reason, effects: [`Food delivered ${result.deliveredFood}; donor paid Food ${result.paid.food} and Energy ${result.paid.energy}`, delivered ? 'The complete agreed transfer is conserved; Energy is consumed' : 'No resources changed and no penalty was applied'], importance: 3, reliefResult: structuredClone(result) });
  state.relief!.lastResults[charter.terms.donorId] = structuredClone(result);
  state.relief!.active = state.relief!.active.filter(candidate => candidate.id !== charter.id);
}

export function executeReliefAction(state: WorldState, actor: number, action: GameAction, events: GameEvent[]): boolean {
  if (!recognized(action) || reliefActionFailure(state, actor, action)) return false;
  if (action.type === 'propose-relief') {
    const quote = quoteReliefProposal(state, actor, action); if (!quote.ok) return false;
    const sequence = (state.relief!.lastResults[actor]?.charter.sequence ?? 0) + 1;
    const charter: ReliefCharter = { id: `relief-${actor}-${sequence}`, sequence, proposedRound: state.round, terms: structuredClone(quote.terms), status: 'proposed', expiresRound: state.round + RELIEF_RULES.pendingLifetime };
    state.relief!.active.push(charter); state.relief!.active.sort((left, right) => left.terms.donorId - right.terms.donorId);
    emitEvent(state, events, { type: 'relief-proposed', title: 'One-way Food relief offered', detail: charter.id, actor, target: charter.terms.recipientId, tileId: charter.terms.recipientTileId, cause: 'The donor offered initial need-based relief over an existing consenting corridor', effects: [description(charter.terms), `Consent expires at round ${charter.expiresRound}`], importance: 3 }); return true;
  }
  const charter = state.relief!.active.find(charter => charter.id === action.charterId)!;
  if (action.type === 'withdraw-relief' || !action.accept) {
    finish(state, charter, action.type === 'withdraw-relief' ? 'withdrawn' : 'declined', `Civilization ${actor} explicitly ${action.type === 'withdraw-relief' ? 'withdrew' : 'declined'} the relief charter`, actor, events); return true;
  }
  const accepted: ReliefCharter = { id: charter.id, sequence: charter.sequence, proposedRound: charter.proposedRound, terms: structuredClone(charter.terms), status: 'accepted', acceptedRound: state.round, dueRound: state.round + charter.terms.travelRounds };
  state.relief!.active = state.relief!.active.map(candidate => candidate.id === charter.id ? accepted : candidate);
  emitEvent(state, events, { type: 'relief-accepted', title: 'Food relief accepted', detail: charter.id, actor, target: charter.terms.donorId, tileId: charter.terms.recipientTileId, cause: 'The named recipient accepted the exact immutable relief terms', effects: [description(charter.terms), `Full transfer is due round ${accepted.dueRound}; no payment occurred at acceptance`], importance: 3 }); return true;
}

export function resolveReliefCharters(state: WorldState, events: GameEvent[]): void {
  if (state.outcome || !state.relief) return;
  for (const charter of state.relief.active.toSorted((left, right) => left.terms.donorId - right.terms.donorId)) {
    if (charter.status === 'proposed' && state.round >= charter.expiresRound) { finish(state, charter, 'expired', `Consent expired at round ${charter.expiresRound}`, null, events); continue; }
    const invalid = targetFailure(state, charter.terms);
    if (invalid) { finish(state, charter, 'failed', invalid, null, events); continue; }
    if (charter.status !== 'accepted' || state.round < charter.dueRound) continue;
    const failure = fundingFailure(state, charter, 0);
    finish(state, charter, failure ? 'failed' : 'delivered', failure ?? 'The complete consented Food and Energy were funded after ordinary economy, trade and public projects', null, events);
  }
}
