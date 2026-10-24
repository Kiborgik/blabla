import { woodlandContinuousCapacity } from '../behavior-woodlands.ts';
import { BORDER_RULES } from '../border-content.ts';
import type { BorderAction, BorderClashReceipt, BorderDepartureAction, BorderDepartureQuote, BorderEvent, BorderIncident, BorderParty, BorderPromises, BorderQuoteResult, BorderResolution, BorderState, BorderStepReceipt } from '../border-types.ts';
import { isBorderAction } from '../border-validation.ts';
import { RESOURCE_IDS, STRATEGIC_RESOURCE_IDS } from '../content.ts';
import type { ActionOption, GameAction, GameEvent, Resources, StrategicResources, WorldState } from '../types.ts';
import { borderApproachPath, borderCurrentTown, borderTargetFailure } from './border-sites.ts';
import { emitEvent } from './events.ts';
import { householdFoodUpkeep } from './food-security.ts';
import { cityGrowthFacts } from './growth.ts';
import { hasFeatures } from './history.ts';
import { knowledgePromisedResources } from './knowledge-compacts.ts';
import { projectOperationAllocation } from './operations.ts';
import { randomStep } from './random.ts';
import { reliefPromisedResources } from './relief-charters.ts';
import { strategicObligations } from './trade.ts';

const cents = (value: number): number => Math.round(value * 100);
const quantize = (value: number): number => cents(value) / 100;
const pair = (first: number, second: number): string => `${Math.min(first, second)}:${Math.max(first, second)}`;
const recognized = (action: GameAction): boolean => ['dispatch-border', 'respond-border', 'withdraw-border'].includes(action.type);

export function createBorderState(state: Pick<WorldState, 'civilizations'>): BorderState {
  return { ruleVersion: 1, active: [], sequences: state.civilizations.map(() => 0), lastResults: [], controls: {}, pairProtectionUntil: {}, siteProtectionUntil: {}, initiationCooldownUntil: state.civilizations.map(() => 0), dealCooldownUntil: {}, draining: null };
}

export function borderReturnReservations(state: WorldState, cityId: string): number {
  return (state.border?.active ?? []).flatMap(incident => incident.defender ? [incident.initiator, incident.defender] : [incident.initiator]).reduce((sum, party) => sum + (party.departure.sourceCityId === cityId && party.returned === null ? party.people : 0), 0);
}

export function borderFieldPopulation(state: WorldState, actorId: number): number {
  return state.cities.filter(city => city.civId === actorId).reduce((sum, city) => sum + borderReturnReservations(state, city.id), 0);
}

export function borderDealFailure(state: WorldState, firstId: number, secondId: number): string | null {
  if (!state.border) return null;
  const key = pair(firstId, secondId);
  if (state.border.active.some(incident => pair(incident.initiatorId, incident.defenderId) === key)) return 'A supplied border incident blocks new bilateral deals until both parties return';
  return state.round < (state.border.dealCooldownUntil[key] ?? 0) ? 'The completed border incident still blocks new bilateral deals' : null;
}

function addOrdinary(target: Partial<Resources>, source: Partial<Resources>, count = 1): void {
  for (const resource of RESOURCE_IDS) if ((source[resource] ?? 0) > 0) target[resource] = quantize((target[resource] ?? 0) + source[resource]! * count);
}

function addStrategic(target: StrategicResources, source: StrategicResources, count = 1): void {
  for (const resource of STRATEGIC_RESOURCE_IDS) if ((source[resource] ?? 0) > 0) target[resource] = (target[resource] ?? 0) + source[resource]! * count;
}

export function borderPromisedResources(state: WorldState, actorId: number, rounds: number): BorderPromises {
  const accepted = (state.knowledge?.active ?? []).filter(compact => compact.status === 'accepted' && (compact.terms.teacherId === actorId || compact.terms.learnerId === actorId));
  const horizon = Math.max(rounds, ...accepted.map(compact => compact.status === 'accepted' ? compact.deadlineRound - state.round : 0));
  const result: BorderPromises = { ordinary: {}, strategic: {}, operationForecast: [], horizon, failure: null };
  if (state.civicWorks?.active.some(commission => commission.civId === actorId)) return { ...result, failure: 'An active civic-works commission is outside the border departure operation forecast' };
  if (!Number.isSafeInteger(horizon) || horizon < 1 || !Number.isSafeInteger(state.round + horizon)) return { ...result, failure: 'The protected commitment horizon exceeds safe round accounting' };
  addOrdinary(result.ordinary, knowledgePromisedResources(state, actorId));
  addOrdinary(result.ordinary, reliefPromisedResources(state, actorId));
  const end = state.round + horizon;
  for (const project of state.publicProjects ?? []) {
    if (project.status !== 'committed' || project.dueRound > end) continue;
    if (project.proposer === actorId) addOrdinary(result.ordinary, project.terms.proposerContribution);
    if (project.recipient === actorId) addOrdinary(result.ordinary, project.terms.recipientContribution);
  }
  for (const route of state.routes) {
    const agreement = route.agreement;
    if (!agreement?.enabled || route.owner !== actorId && route.partner !== actorId) continue;
    const first = Math.max(state.round + 1, agreement.nextDeliveryRound);
    if (first > end) continue;
    const count = 1 + Math.floor((end - first) / agreement.terms.cadenceRounds);
    const side = route.owner === actorId ? 'proposer' : 'recipient';
    addOrdinary(result.ordinary, side === 'proposer' ? agreement.terms.proposerCargo : agreement.terms.recipientCargo, count);
    addOrdinary(result.ordinary, side === 'proposer' ? agreement.terms.proposerUpkeep : agreement.terms.recipientUpkeep, count);
    addStrategic(result.strategic, strategicObligations(agreement.terms, side), count);
  }
  const projected = projectOperationAllocation(state);
  for (const city of projected.cities.filter(candidate => candidate.civId === actorId)) {
    for (const [id, operation] of Object.entries(city.buildingOperations ?? {})) {
      const receipt = operation.lastResult;
      if (receipt?.status !== 'operated') continue;
      result.operationForecast.push({ kind: 'building', cityId: city.id, id, tileId: city.districtSites?.[id] ?? null, round: projected.round, horizon, inputs: { ...receipt.paid }, strategicInputs: { ...receipt.strategicPaid }, residents: receipt.residents?.allocated ?? 0 });
      addOrdinary(result.ordinary, receipt.paid, horizon);
      addStrategic(result.strategic, receipt.strategicPaid ?? {}, horizon);
    }
    for (const improvement of Object.values(city.improvements ?? {})) {
      const receipt = improvement.operation.lastResult;
      if (receipt?.status !== 'operated') continue;
      result.operationForecast.push({ kind: 'improvement', cityId: city.id, id: improvement.improvementId, tileId: improvement.tileId, round: projected.round, horizon, inputs: { ...receipt.paid }, strategicInputs: {}, residents: receipt.residents.allocated });
      addOrdinary(result.ordinary, receipt.paid, horizon);
      if (!woodlandContinuousCapacity(state, improvement.improvementId, improvement.tileId, horizon)) result.failure ??= `Woodland ${city.id}/${improvement.tileId} cannot fund ${horizon} continuous operations from its opening stock`;
    }
  }
  for (const compact of accepted) {
    const teacher = compact.terms.teacherId === actorId;
    const cityId = teacher ? compact.terms.teacherCityId : compact.terms.learnerCityId;
    const institutionId = teacher ? compact.terms.teacherInstitutionId : compact.terms.learnerInstitutionId;
    if (!result.operationForecast.some(operation => operation.kind === 'building' && operation.cityId === cityId && operation.id === institutionId)) result.failure = `Accepted Knowledge institution ${cityId}/${institutionId} would lack its actual next-opening inputs or residents`;
  }
  if (RESOURCE_IDS.some(resource => !Number.isSafeInteger(cents(result.ordinary[resource] ?? 0))) || STRATEGIC_RESOURCE_IDS.some(resource => !Number.isSafeInteger(result.strategic[resource] ?? 0))) result.failure = 'Protected promises exceed safe resource accounting';
  return result;
}

function commonFailure(state: WorldState, actorId: number): string | null {
  if (state.outcome) return 'The world has reached its terminal outcome';
  if (!state.civilizations.some(civ => civ.id === actorId)) return 'Only an existing civilization can act';
  return !state.border || !hasFeatures(state, [BORDER_RULES.featureId]) ? 'Supplied borders are not released' : null;
}

function responseIncident(state: WorldState, actorId: number, incidentId: string): BorderIncident | null {
  return state.border?.active.find(incident => incident.id === incidentId && incident.defenderId === actorId) ?? null;
}

export function quoteBorderDeparture(state: WorldState, actorId: number, action: BorderDepartureAction): BorderQuoteResult {
  const refuse = (reason: string): BorderQuoteResult => ({ ok: false, reason });
  if (!isBorderAction(action) || action.type !== 'dispatch-border' && !(action.type === 'respond-border' && action.response === 'defend')) return refuse('A departure requires an exact dispatch or funded defense action');
  const common = commonFailure(state, actorId); if (common) return refuse(common);
  const border = state.border!;
  const civ = state.civilizations.find(candidate => candidate.id === actorId)!;
  const city = state.cities.find(candidate => candidate.id === action.sourceCityId && candidate.civId === actorId);
  if (!city) return refuse('The exact owned source town is missing');
  let tileId: number;
  let returnByRound: number;
  let legitimacyCost: number;
  if (action.type === 'dispatch-border') {
    if (!Number.isSafeInteger((border.sequences[actorId] ?? 0) + 1)) return refuse('Border sequence accounting is exhausted');
    if (border.draining) return refuse('Existing field parties are draining before terminal evaluation; new incidents are blocked');
    if (!civ.technologies.includes(BORDER_RULES.requiredTechnology)) return refuse('Initiation requires Civic institutions');
    if (state.round < (border.initiationCooldownUntil[actorId] ?? 0)) return refuse('The initiator is still recovering after its previous return');
    const invalid = borderTargetFailure(state, actorId, city.id, action.tileId); if (invalid) return refuse(invalid);
    const target = borderCurrentTown(state, action.tileId)!;
    if (border.active.some(incident => [incident.initiatorId, incident.defenderId].some(id => id === actorId || id === target.civId))) return refuse('Either participant already has an active border incident');
    if (state.round < (border.pairProtectionUntil[pair(actorId, target.civId)] ?? 0) || state.round < (border.siteProtectionUntil[String(action.tileId)] ?? 0)) return refuse('The pair or exact site remains protected after resolution');
    tileId = action.tileId;
    returnByRound = state.round + BORDER_RULES.maximumFieldBeats;
    legitimacyCost = BORDER_RULES.legitimacyCost;
  } else {
    const incident = responseIncident(state, actorId, action.incidentId);
    if (!incident || incident.resolution || incident.response !== 'pending' || state.round >= incident.responseDeadlineRound) return refuse('The exact pending response window is closed');
    if (city.id !== incident.defenderCityId) return refuse('Defense must depart from the exact current-control town');
    const current = borderCurrentTown(state, incident.tileId);
    if (current?.civId !== actorId || current.cityId !== city.id || state.tiles.find(tile => tile.id === incident.tileId)?.owner !== actorId) return refuse('The exact defending plot is no longer controlled by this town');
    tileId = incident.tileId;
    returnByRound = incident.returnByRound;
    legitimacyCost = 0;
  }
  if (!Number.isSafeInteger(returnByRound + BORDER_RULES.protectionBeats + BORDER_RULES.initiationCooldownAfterReturn)) return refuse('The bounded lifecycle exceeds safe round accounting');
  if (city.population - action.people < BORDER_RULES.minimumHomePopulation) return refuse('At least three actual residents must remain at home');
  if (city.population + borderReturnReservations(state, city.id) > cityGrowthFacts(state, city).capacity) return refuse('The town lacks factual housing for its reserved residents');
  const path = borderApproachPath(state, actorId, city.tileId, tileId);
  if (!path) return refuse('The party needs at most three adjacent owned approach edges');
  if (civ.legitimacy < legitimacyCost) return refuse('Initiation requires its one-time three Legitimacy payment');
  const setup = { materials: action.people * BORDER_RULES.setupMaterialsPerPerson, credits: action.people * BORDER_RULES.setupCreditsPerPerson };
  const cargo = { food: action.people * BORDER_RULES.foodPerPersonPerBeat * BORDER_RULES.maximumFieldBeats };
  const totalCost = { ...setup, ...cargo };
  const projected = structuredClone(state);
  projected.cities.find(candidate => candidate.id === city.id)!.population -= action.people;
  const promises = borderPromisedResources(projected, actorId, returnByRound - state.round);
  if (promises.failure) return refuse(promises.failure);
  const householdReserve = { food: quantize(projected.cities.filter(candidate => candidate.civId === actorId).reduce((sum, candidate) => sum + householdFoodUpkeep(projected, candidate.population), 0) * BORDER_RULES.householdReserveBeats) };
  for (const resource of RESOURCE_IDS) {
    const debit = resource === 'materials' ? totalCost.materials : resource === 'credits' ? totalCost.credits : resource === 'food' ? totalCost.food : 0;
    const required = quantize(debit + (resource === 'food' ? householdReserve.food : 0) + (promises.ordinary[resource] ?? 0));
    if (!Number.isSafeInteger(cents(required)) || !Number.isSafeInteger(cents(civ.resources[resource]))) return refuse('Departure exceeds safe resource accounting');
    if (cents(civ.resources[resource]) < cents(required)) return refuse(`Departure needs ${required} ${resource}, including separate household reserve and protected promises; available ${civ.resources[resource]}`);
  }
  for (const resource of STRATEGIC_RESOURCE_IDS) if ((civ.strategicResources?.[resource] ?? 0) < (promises.strategic[resource] ?? 0)) return refuse(`Protected strategic commitments need ${promises.strategic[resource]} ${resource}`);
  return { ok: true, quote: { ruleVersion: 1, actorId, sourceCityId: city.id, sourceTileId: city.tileId, tileId, purchaseId: state.tileAcquisitions![String(tileId)]!.id, people: action.people, departureRound: state.round, returnByRound, pathTileIds: path, sourcePopulationBefore: city.population, sourcePopulationAfter: city.population - action.people, setup, cargo, totalCost, legitimacyCost, householdReserve, promised: promises.ordinary, promisedStrategic: promises.strategic, operationForecast: promises.operationForecast, promiseHorizon: promises.horizon } };
}

export function borderActionFailure(state: WorldState, actorId: number, action: GameAction): string | null {
  if (!recognized(action)) return null;
  if (!isBorderAction(action)) return 'The border action shape is not exact';
  const common = commonFailure(state, actorId); if (common) return common;
  if (action.type === 'dispatch-border' || action.type === 'respond-border' && action.response === 'defend') {
    const result = quoteBorderDeparture(state, actorId, action); return result.ok ? null : result.reason;
  }
  const incident = state.border!.active.find(candidate => candidate.id === action.incidentId);
  if (!incident || incident.resolution) return 'The exact unresolved incident is missing';
  if (action.type === 'respond-border') return incident.defenderId !== actorId || incident.response !== 'pending' || state.round >= incident.responseDeadlineRound ? 'Only the pending defender can yield before the response deadline' : null;
  if (incident.initiatorId === actorId) return null;
  if (incident.defenderId !== actorId || !incident.defender) return 'Only an actually departed participant can withdraw';
  return incident.defender.phase === 'returning' || incident.defender.phase === 'returned' ? 'The defender is already returning or returned' : null;
}

export function availableBorderActions(state: WorldState, actorId: number): ActionOption[] {
  if (commonFailure(state, actorId)) return [];
  const actions: BorderAction[] = [];
  for (const incident of state.border!.active) {
    if (incident.resolution) continue;
    if (incident.initiatorId === actorId || incident.defenderId === actorId && incident.defender) actions.push({ type: 'withdraw-border', incidentId: incident.id });
    if (incident.defenderId === actorId && incident.response === 'pending') {
      actions.push({ type: 'respond-border', incidentId: incident.id, response: 'yield' });
      for (const people of [2, 3] as const) actions.push({ type: 'respond-border', incidentId: incident.id, response: 'defend', sourceCityId: incident.defenderCityId, people });
    }
  }
  if (!state.border!.active.some(incident => incident.initiatorId === actorId || incident.defenderId === actorId) && !state.border!.draining) {
    for (const city of state.cities.filter(candidate => candidate.civId === actorId)) for (const purchase of Object.values(state.tileAcquisitions ?? {})) {
      if (borderTargetFailure(state, actorId, city.id, purchase.tileId)) continue;
      for (const people of [2, 3] as const) actions.push({ type: 'dispatch-border', sourceCityId: city.id, tileId: purchase.tileId, people });
    }
  }
  return actions.flatMap((action): ActionOption[] => {
    if (action.type === 'dispatch-border' || action.type === 'respond-border' && action.response === 'defend') {
      const result = quoteBorderDeparture(state, actorId, action);
      return result.ok ? [{ action, label: `${action.type === 'dispatch-border' ? 'Dispatch' : 'Defend with'} ${action.people} supplied residents`, reason: `Pay ${result.quote.totalCost.materials} Materials, ${result.quote.totalCost.credits} Credits and ${result.quote.totalCost.food} field Food; keep household reserve and all protected commitments. Return by round ${result.quote.returnByRound}.`, borderQuote: result.quote }] : [];
    }
    return borderActionFailure(state, actorId, action) ? [] : [{ action, label: action.type === 'withdraw-border' ? 'Withdraw the actual field party' : 'Yield without funding a defender', reason: action.type === 'withdraw-border' ? 'Reverse only actual travelled edges and return survivors and unused paid cargo; no refund of setup.' : 'No defensive departure or payment; fixed resolution timing remains.' }];
  });
}

function event(state: WorldState, events: GameEvent[], incident: Pick<BorderIncident, 'id' | 'initiatorId' | 'defenderId' | 'tileId'>, payload: BorderEvent, actor: number | null, target: number | null, tileId: number, cause: string, effects: string[]): GameEvent {
  return emitEvent(state, events, { type: `border-${payload.kind}`, title: `Supplied border ${payload.kind}`, detail: incident.id, actor, target, tileId, cause, effects, importance: payload.kind === 'step' ? 1 : 3, border: structuredClone(payload) });
}

function depart(state: WorldState, events: GameEvent[], incident: Pick<BorderIncident, 'id' | 'initiatorId' | 'defenderId' | 'tileId'>, quote: BorderDepartureQuote, side: BorderParty['side']): BorderParty {
  const city = state.cities.find(candidate => candidate.id === quote.sourceCityId)!;
  const civ = state.civilizations.find(candidate => candidate.id === quote.actorId)!;
  city.population -= quote.people;
  civ.resources.materials = quantize(civ.resources.materials - quote.setup.materials);
  civ.resources.credits = quantize(civ.resources.credits - quote.setup.credits);
  civ.resources.food = quantize(civ.resources.food - quote.cargo.food);
  civ.legitimacy = quantize(civ.legitimacy - quote.legitimacyCost);
  const party: BorderParty = { id: `${incident.id}:${side}`, side, departure: structuredClone(quote), departureEventId: `${state.revision}:${events.length}`, people: quote.people, casualties: 0, positionTileId: quote.sourceTileId, pathIndex: 0, phase: 'outbound', food: quote.cargo.food, foodConsumed: 0, steps: [], returned: null };
  event(state, events, incident, { kind: 'departure', incidentId: incident.id, party }, quote.actorId, side === 'initiator' ? incident.defenderId : incident.initiatorId, quote.sourceTileId, 'Actual residents departed their exact town after the complete supplies and setup were paid', [`Home residents ${quote.sourcePopulationBefore} → ${quote.sourcePopulationAfter}`, `Paid ${quote.setup.materials} Materials, ${quote.setup.credits} Credits, ${quote.cargo.food} field Food and ${quote.legitimacyCost} Legitimacy`, 'No movement occurs on departure; return housing remains reserved']);
  return party;
}

function respond(state: WorldState, events: GameEvent[], incident: BorderIncident, response: 'defend' | 'yield', actorId: number | null, reason: string): void {
  incident.response = response;
  incident.responseRound = state.round;
  incident.responseEventId = `${state.revision}:${events.length}`;
  event(state, events, incident, { kind: 'response', incidentId: incident.id, response, actorId, reason }, actorId, incident.initiatorId, incident.tileId, reason, [response === 'defend' ? 'The exact defender party has departed with fully paid setup and cargo' : incident.defender ? 'The actual defender reverses its travelled path with no new payment or casualty' : 'No defensive residents departed and no defensive payment was taken', `Resolution remains due at round ${incident.resolveRound}`]);
}

function resolve(state: WorldState, events: GameEvent[], incident: BorderIncident, outcome: BorderResolution['outcome'], reason: string, clash: BorderClashReceipt | null = null): void {
  if (incident.resolution) return;
  const resolution: BorderResolution = { round: state.round, eventId: `${state.revision}:${events.length}`, outcome, reason, clash, control: null };
  if (outcome === 'captured') {
    resolution.control = { ruleVersion: 1, incidentId: incident.id, purchaseId: incident.purchaseId, tileId: incident.tileId, previousCivId: incident.defenderId, previousCityId: incident.defenderCityId, civId: incident.initiatorId, cityId: incident.sourceCityId, round: state.round, eventId: resolution.eventId };
    state.tiles.find(tile => tile.id === incident.tileId)!.owner = incident.initiatorId;
    state.border!.controls[String(incident.tileId)] = structuredClone(resolution.control);
  }
  incident.resolution = resolution;
  for (const party of incident.defender ? [incident.initiator, incident.defender] : [incident.initiator]) if (!party.returned) party.phase = 'returning';
  state.border!.pairProtectionUntil[pair(incident.initiatorId, incident.defenderId)] = state.round + BORDER_RULES.protectionBeats;
  state.border!.siteProtectionUntil[String(incident.tileId)] = state.round + BORDER_RULES.protectionBeats;
  event(state, events, incident, { kind: 'resolution', incidentId: incident.id, resolution }, incident.initiatorId, incident.defenderId, incident.tileId, reason, [outcome === 'captured' ? 'Only this unworked purchased plot changed current control; the original paid purchase receipt is unchanged' : 'The incident transfers no current control', clash ? `One seeded clash; civilization ${clash.casualtyCivId} lost one actual field resident` : 'No clash and no casualty', 'Living parties return along only their actual travelled paths']);
}

export function executeBorderAction(state: WorldState, actorId: number, action: GameAction, events: GameEvent[]): boolean {
  if (!recognized(action)) return false;
  const failure = borderActionFailure(state, actorId, action);
  if (failure) throw new RangeError(failure);
  if (!isBorderAction(action)) throw new RangeError('Malformed border action');
  if (action.type === 'dispatch-border') {
    const quoted = quoteBorderDeparture(state, actorId, action);
    if (!quoted.ok) throw new RangeError(quoted.reason);
    const current = borderCurrentTown(state, action.tileId)!;
    const sequence = state.border!.sequences[actorId]! + 1;
    state.border!.sequences[actorId] = sequence;
    const identity = { id: `border-${actorId}-${sequence}`, initiatorId: actorId, defenderId: current.civId, tileId: action.tileId };
    const initiator = depart(state, events, identity, quoted.quote, 'initiator');
    state.border!.active.push({ ...identity, ruleVersion: 1, sequence, sourceCityId: action.sourceCityId, defenderCityId: current.cityId, purchaseId: quoted.quote.purchaseId, openedRound: state.round, openedRevision: state.revision, responseDeadlineRound: state.round + BORDER_RULES.responseWindow, resolveRound: state.round + BORDER_RULES.resolutionDelay, returnByRound: quoted.quote.returnByRound, response: 'pending', responseRound: null, responseEventId: null, initiator, defender: null, resolution: null });
    return true;
  }
  const incident = state.border!.active.find(candidate => candidate.id === action.incidentId)!;
  if (action.type === 'respond-border') {
    if (action.response === 'defend') {
      const quoted = quoteBorderDeparture(state, actorId, action);
      if (!quoted.ok) throw new RangeError(quoted.reason);
      incident.defender = depart(state, events, incident, quoted.quote, 'defender');
    }
    respond(state, events, incident, action.response, actorId, action.response === 'defend' ? 'The current-control town explicitly funds a defense' : 'The defender explicitly declines to fund a field party');
  } else if (actorId === incident.initiatorId) resolve(state, events, incident, 'withdrawn', 'The initiator withdrew; setup stays paid and the party physically returns');
  else {
    incident.defender!.phase = 'returning';
    respond(state, events, incident, 'yield', actorId, 'The departed defender withdraws from its actual committed position');
  }
  return true;
}

function returnHome(state: WorldState, events: GameEvent[], incident: BorderIncident, party: BorderParty): void {
  const city = state.cities.find(candidate => candidate.id === party.departure.sourceCityId && candidate.civId === party.departure.actorId);
  const civ = state.civilizations.find(candidate => candidate.id === party.departure.actorId);
  if (!city || !civ) throw new RangeError('Reserved return requires its existing exact home town');
  const refunded = party.food;
  const returned = { round: state.round, eventId: `${state.revision}:${events.length}`, sourceCityId: city.id, people: party.people, populationBefore: city.population, populationAfter: city.population + party.people, foodRefunded: refunded, foodStockBefore: civ.resources.food, foodStockAfter: quantize(civ.resources.food + refunded) };
  if (!Number.isSafeInteger(cents(returned.foodStockAfter))) throw new RangeError('Returning cargo exceeds safe resource accounting');
  city.population = returned.populationAfter;
  civ.resources.food = returned.foodStockAfter;
  party.food = 0;
  party.returned = returned;
  party.phase = 'returned';
  if (party.side === 'initiator') state.border!.initiationCooldownUntil[incident.initiatorId] = state.round + BORDER_RULES.initiationCooldownAfterReturn;
  event(state, events, incident, { kind: 'return', incidentId: incident.id, partyId: party.id, returned }, civ.id, civ.id, city.tileId, 'Survivors reached their recorded home after ordinary home work and meals', [`Returned ${party.people} residents to reserved places`, `Refunded ${refunded} unused prepaid Food exactly once`, 'No returned residents work or take a second home meal this beat']);
}

function stepParty(state: WorldState, events: GameEvent[], incident: BorderIncident, party: BorderParty): void {
  if (party.returned || state.round <= party.departure.departureRound || party.steps.at(-1)?.round === state.round) return;
  if (state.round !== party.departure.departureRound + party.steps.length + 1 || state.round > party.departure.returnByRound) throw new RangeError('A supplied party requires contiguous bounded ordinary beats');
  const phase = party.phase;
  if (phase === 'returned') return;
  const fromTileId = party.positionTileId;
  if (phase === 'returning') party.pathIndex = Math.max(0, party.pathIndex - 1);
  else if (phase === 'outbound') party.pathIndex++;
  party.positionTileId = party.departure.pathTileIds[party.pathIndex]!;
  const meal = party.people * BORDER_RULES.foodPerPersonPerBeat;
  if (party.food < meal) throw new RangeError('Prepaid field cargo must cover every living party meal');
  const receipt: BorderStepReceipt = { round: state.round, fromTileId, toTileId: party.positionTileId, phase, people: party.people, foodBefore: party.food, foodConsumed: meal, foodAfter: quantize(party.food - meal) };
  party.food = receipt.foodAfter;
  party.foodConsumed = quantize(party.foodConsumed + meal);
  party.steps.push(receipt);
  if (phase === 'outbound' && party.pathIndex === party.departure.pathTileIds.length - 1) party.phase = 'holding';
  event(state, events, incident, { kind: 'step', incidentId: incident.id, partyId: party.id, step: receipt }, party.departure.actorId, party.side === 'initiator' ? incident.defenderId : incident.initiatorId, party.positionTileId, 'A real ordinary beat advances at most one recorded edge and feeds the living field party', [`Tile ${fromTileId} → ${party.positionTileId}; ${phase}`, `${party.people} living residents consumed ${meal} prepaid Food; ${party.food} remains`]);
  if (phase === 'returning' && party.pathIndex === 0) returnHome(state, events, incident, party);
}

function incidentFailure(state: WorldState, incident: BorderIncident): string | null {
  const current = borderCurrentTown(state, incident.tileId);
  if (current?.civId !== incident.defenderId || current.cityId !== incident.defenderCityId || state.tileAcquisitions?.[String(incident.tileId)]?.id !== incident.purchaseId) return 'The exact target current-control or original purchase identity changed';
  const target = borderTargetFailure(state, incident.initiatorId, incident.sourceCityId, incident.tileId);
  if (target) return target;
  for (const party of incident.defender ? [incident.initiator, incident.defender] : [incident.initiator]) {
    if (party.phase === 'returning' || party.phase === 'returned') continue;
    if (party.departure.pathTileIds.slice(0, -1).some(id => state.tiles.find(tile => tile.id === id)?.owner !== party.departure.actorId)) return 'A recorded owned approach changed before resolution';
  }
  return null;
}

export function resolveBorderIncidents(state: WorldState, events: GameEvent[]): void {
  if (!state.border || state.outcome) return;
  for (const incident of [...state.border.active].sort((a, b) => a.initiatorId - b.initiatorId || a.sequence - b.sequence)) {
    if (!incident.resolution) {
      const invalid = incidentFailure(state, incident);
      if (invalid) resolve(state, events, incident, 'cancelled', invalid);
      if (incident.response === 'pending' && state.round >= incident.responseDeadlineRound) respond(state, events, incident, 'yield', null, 'The exact two-round response window ended without a funded defense');
    }
    stepParty(state, events, incident, incident.initiator);
    if (incident.defender) stepParty(state, events, incident, incident.defender);
    if (!incident.resolution && state.round >= incident.resolveRound) {
      if (incident.initiator.phase !== 'holding' || incident.initiator.positionTileId !== incident.tileId) resolve(state, events, incident, 'cancelled', 'The initiator did not actually arrive by the fixed resolution beat');
      else if (incident.response === 'defend' && incident.defender?.phase === 'holding' && incident.defender.positionTileId === incident.tileId) {
        const seedBefore = state.rng;
        const draw = randomStep(seedBefore);
        state.rng = draw.seed;
        const initiatorPower = incident.initiator.people;
        const defenderPower = incident.defender.people + BORDER_RULES.defenderBonus;
        const won = draw.value < initiatorPower / (initiatorPower + defenderPower);
        const loser = won ? incident.defender : incident.initiator;
        loser.people--;
        loser.casualties = 1;
        const clash: BorderClashReceipt = { seedBefore, seedAfter: draw.seed, roll: draw.value, initiatorPower, defenderPower, winnerId: won ? incident.initiatorId : incident.defenderId, casualtyCivId: loser.departure.actorId, casualties: 1 };
        resolve(state, events, incident, won ? 'captured' : 'defended', 'Both paid parties arrived; one seeded clash with a one-point defensive advantage decides the exact plot', clash);
      } else resolve(state, events, incident, 'captured', 'The supplied initiator arrived at the exact unworked plot without a holding funded defender');
    }
    if (incident.resolution && incident.initiator.returned && (!incident.defender || incident.defender.returned)) {
      const result = { incident: structuredClone(incident), completedRound: state.round, eventId: `${state.revision}:${events.length}` };
      state.border.lastResults = [...state.border.lastResults, result].slice(-BORDER_RULES.maximumResults);
      state.border.dealCooldownUntil[pair(incident.initiatorId, incident.defenderId)] = state.round + BORDER_RULES.dealCooldownAfterCompletion;
      state.border.active = state.border.active.filter(candidate => candidate.id !== incident.id);
      event(state, events, incident, { kind: 'completed', result }, incident.initiatorId, incident.defenderId, incident.tileId, 'Every departed survivor has physically returned and every unused cargo refund is final', [`Incident ${incident.id} completed at round ${state.round}`, `New bilateral deals remain blocked until round ${state.round + BORDER_RULES.dealCooldownAfterCompletion}`]);
    }
  }
}
