import { ACTION_FEATURES, BUILDINGS, RESIDENT_CAPACITY_RULES, RESOURCE_IDS, STRATEGIC_RESOURCE_IDS, TECHNOLOGIES } from '../content.ts';
import { KNOWLEDGE_INSTITUTION_IDS, KNOWLEDGE_RULES, KNOWLEDGE_TECHNOLOGY_IDS } from '../knowledge-content.ts';
import type { KnowledgeAction, KnowledgeBalances, KnowledgeCompact, KnowledgeInstitutionId, KnowledgeInstitutionProof, KnowledgeProposalQuote, KnowledgeReason, KnowledgeResult, KnowledgeState, KnowledgeStudyAttempt, KnowledgeStudySeason, KnowledgeTerms } from '../knowledge-types.ts';
import { isKnowledgeAction, isKnowledgeInstitutionProof, isKnowledgeTerms, knowledgeOperationEventMatches } from '../knowledge-validation.ts';
import type { ActionOption, GameAction, GameEvent, Resources, WorldState } from '../types.ts';
import { researchEligibility } from './capabilities.ts';
import { emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';
import { completeResearch } from './research.ts';
import { isTransportQuote, transportBlock } from './transport.ts';
import { civilizationById } from './world.ts';

type Failure = { reason: KnowledgeReason; detail: string };
type Accepted = Extract<KnowledgeCompact, { status: 'accepted' }>;
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equal(value, right[index]));
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
  const first = left as Record<string, unknown>; const second = right as Record<string, unknown>;
  return Object.keys(first).length === Object.keys(second).length && Object.keys(first).every(key => Object.hasOwn(second, key) && equal(first[key], second[key]));
}
function cents(value: number): number | null {
  const rounded = Math.round(value * 100);
  return Number.isFinite(value) && value >= 0 && Number.isSafeInteger(rounded) && Math.abs(value * 100 - rounded) <= 1e-7 ? rounded : null;
}
function recognized(action: GameAction): action is KnowledgeAction { return ['propose-knowledge', 'respond-knowledge', 'withdraw-knowledge'].includes(action.type); }
function unorderedPair(first: number, second: number): string { return `${Math.min(first, second)}:${Math.max(first, second)}`; }
function failure(reason: KnowledgeReason, detail: string): Failure { return { reason, detail }; }
function commonFailure(state: WorldState, actor: number): string | null {
  if (state.outcome) return 'The world has already reached its terminal outcome';
  if (!state.civilizations.some(civ => civ.id === actor)) return 'Only an existing civilization can act on knowledge compacts';
  if (!state.knowledge || !hasFeatures(state, [KNOWLEDGE_RULES.featureId])) return 'Knowledge compacts are not released';
  return null;
}

export function createKnowledgeState(state: Pick<WorldState, 'civilizations'>): KnowledgeState {
  return { ruleVersion: 2, active: [], sequences: state.civilizations.map(() => 0), lastResults: state.civilizations.map(() => null), grants: state.civilizations.map(() => ({ engineering: null, education: null, printing: null, banking: null })) };
}

export function knowledgePromisedResources(state: WorldState, actor: number, excludingCompactId?: string, includeProposed = false): Partial<Resources> {
  const result: Partial<Resources> = {};
  for (const compact of state.knowledge?.active ?? []) {
    if (compact.id === excludingCompactId || compact.status === 'proposed' && !includeProposed) continue;
    const contribution = compact.terms.teacherId === actor ? compact.terms.teacherContribution : compact.terms.learnerId === actor ? compact.terms.learnerContribution : null;
    if (contribution) for (const resource of RESOURCE_IDS) if (contribution[resource]) result[resource] = (result[resource] ?? 0) + contribution[resource]!;
  }
  return result;
}

function institutionIdentityFailure(state: WorldState, civId: number, cityId: string, tileId: number, institutionId: KnowledgeInstitutionId): string | null {
  const civ = state.civilizations.find(civ => civ.id === civId); const city = state.cities.find(city => city.id === cityId && city.civId === civId && city.tileId === tileId);
  const definition = BUILDINGS.find(building => building.id === institutionId);
  if (!civ || !city || !definition || !KNOWLEDGE_INSTITUTION_IDS.includes(institutionId) || !city.buildings.includes(institutionId)) return 'The exact completed institution at its owned endpoint is missing';
  if (!hasFeatures(state, [...definition.requiredFeatures, 'resident-capacity']) || definition.requires.some(id => !civ.technologies.includes(id)) || civ.era < definition.minEra || definition.requiresBuildings?.some(id => !city.buildings.includes(id))) return 'The exact institution no longer meets its released technology, era or same-town building prerequisites';
  return null;
}

function institutionProof(state: WorldState, civId: number, cityId: string, tileId: number, institutionId: KnowledgeInstitutionId, events: readonly GameEvent[], currentRevision: boolean): { proof: KnowledgeInstitutionProof | null; reason: string | null } {
  const invalid = institutionIdentityFailure(state, civId, cityId, tileId, institutionId); if (invalid) return { proof: null, reason: invalid };
  const definition = BUILDINGS.find(building => building.id === institutionId)!; const city = state.cities.find(city => city.id === cityId)!;
  const operation = city.buildingOperations?.[institutionId]; const result = operation?.lastResult;
  if (!operation?.enabled) return { proof: null, reason: 'The selected institution is paused' };
  if (!result || result.round !== state.round) return { proof: null, reason: 'The selected institution has no same-round operation receipt' };
  if (result.status !== 'operated') return { proof: null, reason: `The selected institution ${result.status} instead of operating` };
  if (!Number.isFinite(result.produced.science) || (result.produced.science ?? 0) <= 0) return { proof: null, reason: 'The selected institution produced no positive Science' };
  if (result.shortages.length || result.strategicShortages?.length || RESOURCE_IDS.some(resource => (result.paid[resource] ?? 0) !== (definition.operatingInputs?.[resource] ?? 0)) || STRATEGIC_RESOURCE_IDS.some(resource => (result.strategicPaid?.[resource] ?? 0) !== (definition.strategicInputs?.[resource] ?? 0))) return { proof: null, reason: 'The selected institution did not pay its complete ordinary inputs' };
  const residents = result.residents;
  if (!residents || residents.ruleVersion !== RESIDENT_CAPACITY_RULES.ruleVersion || residents.communityReserve !== RESIDENT_CAPACITY_RULES.communityReserve || residents.required !== RESIDENT_CAPACITY_RULES.perPaidRecipe || residents.allocated !== residents.required || residents.available < residents.required || residents.available > Math.max(0, residents.openingPopulation - residents.communityReserve)) return { proof: null, reason: 'The selected institution did not allocate its complete local residents' };
  const candidates = events.filter(event => event.type === 'building-operation' && event.actor === civId && event.target === civId && event.tileId === tileId && event.detail === `${cityId}/${institutionId} at strategic round ${state.round}` && event.round === state.round && (currentRevision ? event.id.startsWith(`${state.revision}:`) : Number(event.id.split(':')[0]) <= state.revision))
    .map(event => ({ event, proof: { civId, cityId, tileId, institutionId, inputs: { ...definition.operatingInputs }, residentsRequired: RESIDENT_CAPACITY_RULES.perPaidRecipe, result: structuredClone(result), operationEventId: event.id } }))
    .filter(candidate => isKnowledgeInstitutionProof(candidate.proof) && knowledgeOperationEventMatches(candidate.event, candidate.proof));
  return candidates.length === 1 ? { proof: candidates[0]!.proof, reason: null } : { proof: null, reason: 'The selected institution needs one exact current paid operation event' };
}

function proofs(state: WorldState, terms: KnowledgeTerms, events: readonly GameEvent[] = state.events, currentRevision = false) {
  return { teacher: institutionProof(state, terms.teacherId, terms.teacherCityId, terms.teacherTileId, terms.teacherInstitutionId, events, currentRevision), learner: institutionProof(state, terms.learnerId, terms.learnerCityId, terms.learnerTileId, terms.learnerInstitutionId, events, currentRevision) };
}

export function knowledgeCompactFailure(state: WorldState, compact: Pick<KnowledgeCompact, 'terms'>): Failure | null {
  return targetFailure(state, compact.terms);
}

function targetFailure(state: WorldState, terms: KnowledgeTerms): Failure | null {
  if (!hasFeatures(state, [KNOWLEDGE_RULES.featureId])) return failure('feature-unreleased', 'Knowledge compacts are no longer released');
  const route = state.routes.find(route => route.id === terms.routeId);
  if (!route) return failure('route-missing', 'The exact consenting route is missing');
  if (!route.agreement?.enabled) return failure('route-consent-stopped', 'Consent for the bound trade route stopped');
  if (route.agreement.offerId !== terms.agreementOfferId || route.agreement.acceptedRound !== terms.agreementAcceptedRound) return failure('agreement-replaced', 'The exact accepted trade agreement was replaced');
  if (route.owner !== terms.owner || route.partner !== terms.partner) return failure('route-participants-changed', 'The route-oriented participants changed');
  if (route.from !== terms.fromCityId || route.to !== terms.toCityId || !state.cities.some(city => city.id === terms.fromCityId && city.civId === terms.owner && city.tileId === terms.fromTileId) || !state.cities.some(city => city.id === terms.toCityId && city.civId === terms.partner && city.tileId === terms.toTileId)) return failure('route-endpoints-changed', 'An exact owned route endpoint changed');
  if (!equal(route.agreement.terms, terms.tradeTerms)) return failure('trade-terms-changed', 'The complete immutable trade terms changed');
  const teacher = state.civilizations.find(civ => civ.id === terms.teacherId)!; const learner = state.civilizations.find(civ => civ.id === terms.learnerId)!;
  if (!teacher?.technologies.includes(terms.technologyId)) return failure('teacher-knowledge-missing', 'The named teacher no longer knows the agreed discovery');
  if (learner?.technologies.includes(terms.technologyId)) return failure('target-already-completed', 'The learner already completed the discovery through ordinary research');
  if (!learner || learner.researchTarget !== terms.technologyId) return failure('target-changed', 'The learner no longer has the exact active research target');
  const technology = TECHNOLOGIES.find(technology => technology.id === terms.technologyId);
  if (!technology || technology.cost !== terms.costBasis) return failure('cost-basis-changed', 'The agreed discovery cost basis changed');
  if (!equal([...new Set([...ACTION_FEATURES.research, ...technology.requiredFeatures])], terms.requiredFeatures) || !equal(technology.requires, terms.prerequisites) || researchEligibility(state, terms.learnerId, technology).blockers.length) return failure('target-ineligible', 'The active discovery no longer meets its ordinary released prerequisites');
  for (const [civId, cityId, tileId, institutionId] of [[terms.teacherId, terms.teacherCityId, terms.teacherTileId, terms.teacherInstitutionId], [terms.learnerId, terms.learnerCityId, terms.learnerTileId, terms.learnerInstitutionId]] as const) {
    const invalid = institutionIdentityFailure(state, civId, cityId, tileId, institutionId); if (invalid) return failure('institution-identity-changed', invalid);
  }
  if (state.knowledge?.grants[terms.learnerId]?.[terms.technologyId]) return failure('entitlement-used', 'This learner already received its one knowledge compact contribution for this discovery');
  return null;
}

function routeAvailableFailure(state: WorldState, terms: KnowledgeTerms): string | null {
  const route = state.routes.find(route => route.id === terms.routeId)!; const transport = terms.tradeTerms.transport;
  if (!transport || !isTransportQuote(transport, state.tiles.length) || transport.edges < 1 || transport.edges > KNOWLEDGE_RULES.maximumEdges || !Number.isSafeInteger(terms.tradeTerms.cadenceRounds) || terms.tradeTerms.cadenceRounds < 1 || terms.tradeTerms.cadenceRounds > KNOWLEDGE_RULES.maximumCadence) return 'Knowledge compacts need an explicit supported corridor of one to twelve edges and cadence one to six rounds';
  const agreement = route.agreement!;
  if (!Number.isSafeInteger(agreement.deliveryCount) || agreement.deliveryCount < 1 || !Number.isSafeInteger(agreement.lastDeliveryRound) || agreement.lastDeliveryRound! < agreement.acceptedRound + agreement.terms.cadenceRounds || agreement.lastDeliveryRound! > state.round) return 'The exact consenting corridor must have completed an ordinary shipment before teaching';
  if (!route.active || agreement.blockedReason !== null || agreement.blockedBy !== null) return 'The exact consenting corridor has an unresolved blockage';
  if (route.damage >= terms.tradeTerms.damageDisableAt) return 'Current route damage prevents the agreed exchange';
  return transportBlock(state, transport, terms.fromTileId, terms.toTileId);
}

function balances(state: WorldState, terms: KnowledgeTerms): KnowledgeBalances {
  return { teacher: { ...civilizationById(state, terms.teacherId).resources }, learner: { ...civilizationById(state, terms.learnerId).resources } };
}

function fundingFailure(state: WorldState, terms: KnowledgeTerms, budgets?: Map<number, Resources>): Failure | null {
  const stock = balances(state, terms); const teacherBudget = budgets?.get(terms.teacherId) ?? stock.teacher; const learnerBudget = budgets?.get(terms.learnerId) ?? stock.learner;
  const touched = [stock.teacher.credits, stock.teacher.culture, stock.learner.materials, stock.learner.credits, teacherBudget.culture, learnerBudget.materials, learnerBudget.credits];
  if (touched.some(value => cents(value) === null) || !Number.isSafeInteger(cents(stock.teacher.credits)! + 300)) return failure('unsafe-accounting', 'The complete teaching transaction exceeds exact safe hundredths accounting');
  if (cents(learnerBudget.materials)! < 300 || cents(learnerBudget.credits)! < 400 || cents(stock.learner.materials)! < 300 || cents(stock.learner.credits)! < 400) return failure('learner-contribution-shortfall', 'The learner cannot fund all three Materials and four Credits from the phase-opening budget');
  if (cents(teacherBudget.culture)! < 200 || cents(stock.teacher.culture)! < 200) return failure('teacher-contribution-shortfall', 'The teacher cannot fund both Culture from the phase-opening budget');
  return null;
}

function workQuote(state: WorldState, terms: KnowledgeTerms): { progressBefore: number; progressAfter: number; amount: number; unusedAmount: number } | Failure {
  const progress = civilizationById(state, terms.learnerId).researchProgress; const cost = cents(terms.costBasis); const before = cents(progress); const nominal = cents(terms.nominalAmount);
  if (cost === null || before === null || nominal === null) return failure('unsafe-accounting', 'Research work cannot be represented in exact safe hundredths');
  const amount = Math.min(nominal, cost - before);
  if (amount <= 0) return failure('no-positive-work', 'The active research target has no positive remaining eligible work');
  return { progressBefore: progress, progressAfter: (before + amount) / 100, amount: amount / 100, unusedAmount: (nominal - amount) / 100 };
}

export function quoteKnowledgeProposal(state: WorldState, actor: number, action: Extract<KnowledgeAction, { type: 'propose-knowledge' }>): KnowledgeProposalQuote {
  const refuse = (reason: string): KnowledgeProposalQuote => ({ ok: false, reason });
  if (!isKnowledgeAction(action)) return refuse('Knowledge proposal fields are malformed');
  const common = commonFailure(state, actor); if (common) return refuse(common);
  const layer = state.knowledge!;
  if (!Number.isSafeInteger(layer.sequences[actor]! + 1) || !Number.isSafeInteger(state.round + KNOWLEDGE_RULES.pendingLifetime + KNOWLEDGE_RULES.studySeasons * KNOWLEDGE_RULES.studyInterval + KNOWLEDGE_RULES.cooldownRounds)) return refuse('Knowledge sequence or timing accounting is exhausted');
  if (layer.active.length >= state.civilizations.length || layer.active.some(compact => compact.terms.teacherId === actor)) return refuse('The teacher or bounded knowledge ledger already has an active compact');
  const previous = layer.lastResults[actor]; if (previous && state.round < previous.resolvedRound + KNOWLEDGE_RULES.cooldownRounds) return refuse(`This teacher may offer again from round ${previous.resolvedRound + KNOWLEDGE_RULES.cooldownRounds}`);
  const route = state.routes.find(route => route.id === action.routeId);
  if (!route?.agreement?.enabled || route.owner !== actor && route.partner !== actor) return refuse('Only a participant of an enabled consenting route can offer knowledge');
  const learnerId = route.owner === actor ? route.partner : route.owner;
  if (learnerId === actor || layer.active.some(compact => compact.terms.learnerId === learnerId || unorderedPair(compact.terms.teacherId, compact.terms.learnerId) === unorderedPair(actor, learnerId))) return refuse('The learner or this pair already has an active compact');
  const from = state.cities.find(city => city.id === route.from && city.civId === route.owner); const to = state.cities.find(city => city.id === route.to && city.civId === route.partner);
  const teacherCity = route.owner === actor ? from : to; const learnerCity = route.owner === actor ? to : from;
  if (!from || !to || !teacherCity || !learnerCity || action.teacherCityId !== teacherCity.id || action.learnerCityId !== learnerCity.id) return refuse('Knowledge must bind the exact owned towns of the route');
  const teacher = civilizationById(state, actor); const learner = civilizationById(state, learnerId); const technology = TECHNOLOGIES.find(technology => technology.id === action.technologyId);
  if (!technology || !KNOWLEDGE_TECHNOLOGY_IDS.includes(action.technologyId) || cents(technology.cost) === null) return refuse('The discovery is outside the finite supported knowledge catalogue');
  const terms: KnowledgeTerms = {
    ruleVersion: 2, routeId: route.id, agreementOfferId: route.agreement.offerId, agreementAcceptedRound: route.agreement.acceptedRound,
    owner: route.owner, partner: route.partner, fromCityId: from.id, toCityId: to.id, fromTileId: from.tileId, toTileId: to.tileId, tradeTerms: structuredClone(route.agreement.terms),
    teacherId: actor, learnerId, teacherCityId: teacherCity.id, learnerCityId: learnerCity.id, teacherTileId: teacherCity.tileId, learnerTileId: learnerCity.tileId, teacherInstitutionId: action.teacherInstitutionId, learnerInstitutionId: action.learnerInstitutionId,
    technologyId: action.technologyId, costBasis: technology.cost, requiredFeatures: [...new Set([...ACTION_FEATURES.research, ...technology.requiredFeatures])], prerequisites: [...technology.requires], basisReleaseId: state.releaseId,
    learnerContribution: { ...KNOWLEDGE_RULES.learnerContribution }, teacherContribution: { ...KNOWLEDGE_RULES.teacherContribution }, transferred: { ...KNOWLEDGE_RULES.transferred }, consumed: { ...KNOWLEDGE_RULES.consumed }, percent: 10,
    nominalAmount: Math.floor(cents(technology.cost)! / 10) / 100, requiredStudies: 2, pendingLifetime: 8, studySeasons: 3, studyInterval: 1,
    names: { teacher: teacher.name, learner: learner.name, teacherCity: teacherCity.name, learnerCity: learnerCity.name, teacherInstitution: BUILDINGS.find(building => building.id === action.teacherInstitutionId)!.name, learnerInstitution: BUILDINGS.find(building => building.id === action.learnerInstitutionId)!.name, technology: technology.name },
  };
  if (!isKnowledgeTerms(terms)) return refuse('The exact knowledge and accepted trade terms do not match their versioned catalogue');
  const target = targetFailure(state, terms); if (target) return refuse(target.detail);
  const routeBlock = routeAvailableFailure(state, terms); if (routeBlock) return refuse(routeBlock);
  const current = proofs(state, terms); if (current.teacher.reason || current.learner.reason) return refuse(current.teacher.reason ?? current.learner.reason!);
  const funds = fundingFailure(state, terms); if (funds) return refuse(funds.detail);
  const work = workQuote(state, terms); return 'reason' in work ? refuse(work.detail) : { ok: true, terms };
}

export function knowledgeActionFailure(state: WorldState, actor: number, action: GameAction): string | null {
  if (!recognized(action)) return null;
  if (!isKnowledgeAction(action)) return 'Knowledge action fields are malformed';
  const common = commonFailure(state, actor); if (common) return common;
  if (action.type === 'propose-knowledge') { const quote = quoteKnowledgeProposal(state, actor, action); return quote.ok ? null : quote.reason; }
  const compact = state.knowledge!.active.find(compact => compact.id === action.compactId);
  if (!compact) return 'The exact knowledge compact is absent or already resolved';
  if (compact.status === 'proposed' && state.round >= compact.expiresRound || compact.status === 'accepted' && state.round > compact.deadlineRound) return 'The compact consent or study window has ended';
  if (action.type === 'withdraw-knowledge') return actor === compact.terms.teacherId || compact.status === 'accepted' && actor === compact.terms.learnerId ? null : 'Only the teacher or a consenting learner can withdraw';
  if (actor !== compact.terms.learnerId || compact.status !== 'proposed') return 'Only the named learner can respond to a pending knowledge offer';
  if (!action.accept) return null;
  const target = targetFailure(state, compact.terms); if (target) return target.detail;
  const route = routeAvailableFailure(state, compact.terms); if (route) return route;
  const current = proofs(state, compact.terms); if (current.teacher.reason || current.learner.reason) return current.teacher.reason ?? current.learner.reason;
  if (!Number.isSafeInteger(state.round + compact.terms.studySeasons * compact.terms.studyInterval + KNOWLEDGE_RULES.cooldownRounds)) return 'Knowledge acceptance exceeds safe timing accounting';
  const funds = fundingFailure(state, compact.terms); if (funds) return funds.detail;
  const work = workQuote(state, compact.terms); return 'reason' in work ? work.detail : null;
}

function description(terms: KnowledgeTerms): string {
  return `${terms.names.teacher} teaching ${terms.names.technology} to ${terms.names.learner}, ${terms.teacherCityId} to ${terms.learnerCityId} on ${terms.routeId}. Due: learner three Materials and four Credits; teacher two Culture. Three Credits transfer to the teacher and one Credit is consumed. Two new supported study seasons with both selected institutions actually paying their normal inputs and producing Science permit at most ${terms.nominalAmount} research work once. The full price remains due for reduced remaining work; unused assistance is discarded. No escrow, extra cargo or free technology.`;
}

export function availableKnowledgeActions(state: WorldState, actor: number): ActionOption[] {
  if (commonFailure(state, actor)) return [];
  const options: ActionOption[] = [];
  for (const route of state.routes.toSorted((left, right) => left.id.localeCompare(right.id))) {
    if (route.owner !== actor && route.partner !== actor) continue;
    const learner = civilizationById(state, route.owner === actor ? route.partner : route.owner);
    if (!KNOWLEDGE_TECHNOLOGY_IDS.some(id => id === learner.researchTarget)) continue;
    for (const teacherInstitutionId of KNOWLEDGE_INSTITUTION_IDS) for (const learnerInstitutionId of KNOWLEDGE_INSTITUTION_IDS) {
      const action: Extract<KnowledgeAction, { type: 'propose-knowledge' }> = { type: 'propose-knowledge', routeId: route.id, teacherCityId: route.owner === actor ? route.from : route.to, learnerCityId: route.owner === actor ? route.to : route.from, technologyId: learner.researchTarget as KnowledgeTerms['technologyId'], teacherInstitutionId, learnerInstitutionId };
      const quote = quoteKnowledgeProposal(state, actor, action);
      if (quote.ok) options.push({ action, label: `Offer ${quote.terms.names.technology} teaching to ${quote.terms.names.learner}`, reason: `${description(quote.terms)} Consent expires after eight rounds; two studies must succeed within three seasons after acceptance; ordinary shipments keep their existing cadence.` });
    }
  }
  for (const compact of state.knowledge!.active) {
    const actions: KnowledgeAction[] = [{ type: 'withdraw-knowledge', compactId: compact.id }];
    if (compact.status === 'proposed') actions.push({ type: 'respond-knowledge', compactId: compact.id, accept: false }, { type: 'respond-knowledge', compactId: compact.id, accept: true });
    for (const action of actions) if (!knowledgeActionFailure(state, actor, action)) options.push({ action, label: `${action.type === 'withdraw-knowledge' ? 'Withdraw' : action.type === 'respond-knowledge' && action.accept ? 'Accept' : 'Decline'} ${compact.id}`, reason: `${description(compact.terms)} ${compact.status === 'proposed' ? `Consent expires at round ${compact.expiresRound}.` : `${compact.studies.length}/2 qualifying studies; deadline round ${compact.deadlineRound} inclusive.`} Refusal or withdrawal has no teaching payment or penalty.` });
  }
  return options;
}

function finish(state: WorldState, compact: KnowledgeCompact, outcome: KnowledgeResult['outcome'], why: Failure, actor: number | null, events: GameEvent[], budgets?: Map<number, Resources>): void {
  const terms = compact.terms; const before = balances(state, terms); const learner = civilizationById(state, terms.learnerId); const teacher = civilizationById(state, terms.teacherId);
  const work = outcome === 'completed' ? workQuote(state, terms) : null;
  if (work && 'reason' in work) throw new RangeError('Successful knowledge settlement requires preflighted positive safe work');
  const progressBefore = learner.researchProgress;
  let researchCompletionEventId: string | null = null;
  if (work) {
    learner.resources.materials = (cents(learner.resources.materials)! - 300) / 100; learner.resources.credits = (cents(learner.resources.credits)! - 400) / 100;
    teacher.resources.culture = (cents(teacher.resources.culture)! - 200) / 100; teacher.resources.credits = (cents(teacher.resources.credits)! + 300) / 100;
    if (budgets) {
      const learnerBudget = budgets.get(terms.learnerId)!; const teacherBudget = budgets.get(terms.teacherId)!;
      learnerBudget.materials = (cents(learnerBudget.materials)! - 300) / 100; learnerBudget.credits = (cents(learnerBudget.credits)! - 400) / 100; teacherBudget.culture = (cents(teacherBudget.culture)! - 200) / 100;
    }
    learner.researchProgress = work.progressAfter;
    if (work.progressAfter >= terms.costBasis) researchCompletionEventId = completeResearch(state, terms.learnerId, TECHNOLOGIES.find(technology => technology.id === terms.technologyId)!, events, `Ordinary research and ${work.amount} fully paid knowledge compact work completed the active discovery`).id;
  }
  const result: KnowledgeResult = {
    ruleVersion: 2, compact: structuredClone(compact), outcome, reason: why.reason, detail: why.detail, actor, resolvedRound: state.round, resolvedRevision: state.revision, eventId: `${state.revision}:${events.length}`,
    before, after: balances(state, terms), learnerPaid: work ? { ...terms.learnerContribution } : {}, teacherPaid: work ? { ...terms.teacherContribution } : {}, transferred: work ? { ...terms.transferred } : {}, consumed: work ? { ...terms.consumed } : {},
    nominalAmount: terms.nominalAmount, amount: work?.amount ?? 0, unusedAmount: work?.unusedAmount ?? terms.nominalAmount, progressBefore, progressAfter: work?.progressAfter ?? progressBefore, researchCompletionEventId,
  };
  emitEvent(state, events, { type: `knowledge-${outcome}`, title: work ? `${terms.names.learner} gains ${work.amount} work toward ${terms.names.technology}` : `Knowledge compact ${outcome}`, detail: compact.id, actor, target: terms.learnerId, tileId: terms.learnerTileId, cause: why.detail, effects: work ? [`Teacher ${terms.names.teacher}; learner paid three Materials and four Credits, teacher paid two Culture`, `Three Credits transferred; three Materials, two Culture and one Credit consumed; unused work ${result.unusedAmount}`, researchCompletionEventId ? `Actual discovery completion: ${researchCompletionEventId}` : 'The discovery remains an ordinary active research target'] : ['No teaching payment, work, grant or penalty; previous ordinary trades and institution operation remain unchanged'], importance: 3, knowledgeResult: structuredClone(result) });
  state.knowledge!.lastResults[terms.teacherId] = structuredClone(result);
  if (work) state.knowledge!.grants[terms.learnerId]![terms.technologyId] = structuredClone(result);
  state.knowledge!.active = state.knowledge!.active.filter(candidate => candidate.id !== compact.id);
}

export function executeKnowledgeAction(state: WorldState, actor: number, action: GameAction, events: GameEvent[]): boolean {
  if (!recognized(action) || knowledgeActionFailure(state, actor, action)) return false;
  if (action.type === 'propose-knowledge') {
    const quote = quoteKnowledgeProposal(state, actor, action); if (!quote.ok) return false;
    const sequence = state.knowledge!.sequences[actor]! + 1; state.knowledge!.sequences[actor] = sequence;
    const compact: KnowledgeCompact = { id: `knowledge-${actor}-${sequence}`, sequence, proposedRound: state.round, proposedRevision: state.revision, terms: structuredClone(quote.terms), status: 'proposed', expiresRound: state.round + KNOWLEDGE_RULES.pendingLifetime };
    state.knowledge!.active.push(compact); state.knowledge!.active.sort((left, right) => left.terms.teacherId - right.terms.teacherId || left.sequence - right.sequence);
    emitEvent(state, events, { type: 'knowledge-proposed', title: `${quote.terms.names.teacher} offers ${quote.terms.names.technology} teaching`, detail: compact.id, actor, target: quote.terms.learnerId, tileId: quote.terms.learnerTileId, cause: 'The teacher offered immutable terms over an existing consenting trade route', effects: [description(quote.terms), `Consent expires at round ${compact.expiresRound}; nothing paid or reserved`], importance: 3, knowledgeCompact: structuredClone(compact) }); return true;
  }
  const compact = state.knowledge!.active.find(compact => compact.id === action.compactId)!;
  if (action.type === 'withdraw-knowledge' || !action.accept) {
    finish(state, compact, action.type === 'withdraw-knowledge' ? 'withdrawn' : 'declined', action.type === 'withdraw-knowledge' ? failure('withdrawn-by-participant', `Civilization ${actor} withdrew the compact without penalty`) : failure('declined-by-learner', `Civilization ${actor} declined the compact without penalty`), actor, events); return true;
  }
  const accepted: Accepted = { id: compact.id, sequence: compact.sequence, proposedRound: compact.proposedRound, proposedRevision: compact.proposedRevision, terms: structuredClone(compact.terms), status: 'accepted', acceptedRound: state.round, acceptedRevision: state.revision, lastAttemptRound: state.round, deadlineRound: state.round + compact.terms.studySeasons * compact.terms.studyInterval, studies: [], lastStudyAttempt: null };
  state.knowledge!.active = state.knowledge!.active.map(candidate => candidate.id === compact.id ? accepted : candidate);
  emitEvent(state, events, { type: 'knowledge-accepted', title: `${compact.terms.names.learner} accepts ${compact.terms.names.technology} teaching`, detail: compact.id, actor, target: compact.terms.teacherId, tileId: compact.terms.learnerTileId, cause: 'The named learner accepted the full immutable teaching terms separately from trade consent', effects: [description(compact.terms), `Only new institution-operation seasons after round ${accepted.acceptedRound} and revision ${accepted.acceptedRevision} count; deadline ${accepted.deadlineRound} inclusive`], importance: 3, knowledgeCompact: structuredClone(accepted) }); return true;
}

function studySeason(state: WorldState, terms: KnowledgeTerms): KnowledgeStudySeason {
  const { routeId, agreementOfferId, agreementAcceptedRound, owner, partner, fromCityId, toCityId, fromTileId, toTileId, tradeTerms } = terms;
  return { routeId, agreementOfferId, agreementAcceptedRound, owner, partner, fromCityId, toCityId, fromTileId, toTileId, tradeTerms: structuredClone(tradeTerms), round: state.round, revision: state.revision };
}

export function resolveKnowledgeCompacts(state: WorldState, events: GameEvent[]): void {
  if (state.outcome || !state.knowledge) return;
  const budgets = new Map(state.civilizations.map(civ => [civ.id, { ...civ.resources }]));
  for (const compact of state.knowledge.active.toSorted((left, right) => left.terms.teacherId - right.terms.teacherId || left.sequence - right.sequence)) {
    if (compact.status === 'proposed' && state.round >= compact.expiresRound) { finish(state, compact, 'expired', failure('consent-window-ended', `The eight-round consent window ended at round ${compact.expiresRound}`), null, events); continue; }
    const invalid = targetFailure(state, compact.terms); if (invalid) { finish(state, compact, 'failed', invalid, null, events); continue; }
    if (compact.status !== 'accepted') continue;
    let ready = false;
    if (state.round > compact.lastAttemptRound && state.round > compact.acceptedRound && state.round <= compact.deadlineRound && state.revision > compact.acceptedRevision) {
      compact.lastAttemptRound = state.round;
      const current = proofs(state, compact.terms, events, true);
      const season = studySeason(state, compact.terms);
      const attempt: KnowledgeStudyAttempt = { season, teacher: current.teacher.proof, learner: current.learner.proof, blockers: [] };
      const routeBlock = routeAvailableFailure(state, compact.terms);
      if (current.teacher.reason) attempt.blockers.push({ party: 'teacher', reason: current.teacher.reason });
      if (current.learner.reason) attempt.blockers.push({ party: 'learner', reason: current.learner.reason });
      if (routeBlock) attempt.blockers.push({ party: 'route', reason: routeBlock });
      compact.lastStudyAttempt = structuredClone(attempt);
      if (!attempt.blockers.length && attempt.teacher && attempt.learner && compact.studies.length < KNOWLEDGE_RULES.requiredStudies)
        compact.studies.push({ season: structuredClone(season), teacher: structuredClone(attempt.teacher), learner: structuredClone(attempt.learner) });
      emitEvent(state, events, { type: 'knowledge-study', title: attempt.blockers.length ? 'A supported study season did not qualify' : `${compact.terms.names.teacher} and ${compact.terms.names.learner} record a supported study season`, detail: compact.id, actor: compact.terms.teacherId, target: compact.terms.learnerId, tileId: compact.terms.learnerTileId, cause: attempt.blockers.length ? attempt.blockers.map(blocker => `${blocker.party}: ${blocker.reason}`).join('; ') : 'Both exact institutions operated with positive Science, complete normal inputs and residents on the live consenting corridor', effects: [`${compact.studies.length}/2 supported study seasons; current operation events ${attempt.teacher?.operationEventId ?? 'absent'}, ${attempt.learner?.operationEventId ?? 'absent'}`, 'Ordinary operation costs remain paid; no extra cargo or Science stock transfer'], importance: 2, knowledgeStudy: { compactId: compact.id, attempt: structuredClone(attempt), studyCount: compact.studies.length } });
      ready = compact.studies.length === KNOWLEDGE_RULES.requiredStudies;
    }
    if (ready) {
      const funding = fundingFailure(state, compact.terms, budgets); const work = workQuote(state, compact.terms); const blocked = funding ?? ('reason' in work ? work : null);
      finish(state, compact, blocked ? 'failed' : 'completed', blocked ?? failure('settled', 'Two fresh paid institutional studies funded the full one-time contribution after ordinary research'), null, events, budgets);
    } else if (state.round >= compact.deadlineRound) finish(state, compact, 'failed', failure('study-window-ended', `The inclusive study deadline ${compact.deadlineRound} ended with ${compact.studies.length}/2 qualifying studies`), null, events);
  }
}
