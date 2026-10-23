import { ACTION_FEATURES, BUILDINGS, RESIDENT_CAPACITY_RULES, RESOURCE_IDS, STRATEGIC_RESOURCE_IDS, TECHNOLOGIES, TRADE_RECIPES } from './content.ts';
import { KNOWLEDGE_INSTITUTION_IDS, KNOWLEDGE_RULES, KNOWLEDGE_TECHNOLOGY_IDS } from './knowledge-content.ts';
import type { KnowledgeAction, KnowledgeBalances, KnowledgeCompact, KnowledgeInstitutionProof, KnowledgeResult, KnowledgeState, KnowledgeStudyAttempt, KnowledgeStudyProof, KnowledgeStudySeason, KnowledgeTerms, ResolvedTradeDelivery } from './knowledge-types.ts';
import { RELEASES } from './release.ts';
import { CIV_COUNT } from './types.ts';
import type { GameEvent, Resources, StrategicResources, TradeTerms, WorldState } from './types.ts';
import { isTransportQuote, transportCadence, transportTopologyBlock } from './simulation/transport.ts';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean { return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)); }
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function text(value: unknown, maximum = 128): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum; }
function dense(value: unknown, maximum: number): value is unknown[] { return Array.isArray(value) && value.length <= maximum && Object.keys(value).length === value.length && Array.from({ length: value.length }, (_, index) => index).every(index => Object.hasOwn(value, index)); }
function compactId(value: unknown): value is string { return text(value) && /^knowledge-[0-4]-[1-9]\d*$/.test(value) && integer(Number(value.split('-')[2]), 1); }
function eventId(value: unknown): value is string { return text(value) && /^[1-9]\d*:(0|[1-9]\d*)$/.test(value) && integer(Number(value.split(':')[0]), 1) && integer(Number(value.split(':')[1])); }
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equal(value, right[index]));
  return record(left) && record(right) && Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
}
function technology(value: unknown): value is KnowledgeTerms['technologyId'] { return KNOWLEDGE_TECHNOLOGY_IDS.some(id => id === value); }
function institution(value: unknown): value is KnowledgeTerms['teacherInstitutionId'] { return KNOWLEDGE_INSTITUTION_IDS.some(id => id === value); }

export function isKnowledgeAction(value: unknown): value is KnowledgeAction {
  if (!record(value)) return false;
  if (value.type === 'propose-knowledge') return keys(value, ['type', 'routeId', 'teacherCityId', 'learnerCityId', 'technologyId', 'teacherInstitutionId', 'learnerInstitutionId']) && text(value.routeId) && text(value.teacherCityId) && text(value.learnerCityId) && value.teacherCityId !== value.learnerCityId && technology(value.technologyId) && institution(value.teacherInstitutionId) && institution(value.learnerInstitutionId);
  if (value.type === 'respond-knowledge') return keys(value, ['type', 'compactId', 'accept']) && compactId(value.compactId) && typeof value.accept === 'boolean';
  return value.type === 'withdraw-knowledge' && keys(value, ['type', 'compactId']) && compactId(value.compactId);
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER; }
function cents(value: unknown): value is number { return finite(value) && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) <= 1e-7; }
function units(value: number): number { return Math.round(value * 100); }
function vector(value: unknown, full = false): value is Partial<Resources> { return record(value) && (!full || keys(value, RESOURCE_IDS)) && Object.entries(value).every(([key, amount]) => RESOURCE_IDS.some(id => id === key) && finite(amount)); }
function strategic(value: unknown): value is StrategicResources { return record(value) && Object.entries(value).every(([key, amount]) => STRATEGIC_RESOURCE_IDS.some(id => id === key) && integer(amount)); }
function strings(value: unknown, maximum: number): value is string[] { return dense(value, maximum) && value.every(item => text(item)) && new Set(value).size === value.length; }
function eventRevision(id: string): number { return Number(id.split(':')[0]); }
function eventOrdinal(id: string): number { return Number(id.split(':')[1]); }
function precedes(first: string, second: string): boolean { return eventRevision(first) < eventRevision(second) || eventRevision(first) === eventRevision(second) && eventOrdinal(first) < eventOrdinal(second); }

function tradeTerms(value: unknown): value is TradeTerms {
  const resourceFields = ['constructionCost', 'proposerCargo', 'recipientCargo', 'proposerUpkeep', 'recipientUpkeep', 'proposerYield', 'recipientYield'] as const;
  const fields = ['recipeId', 'recipeVersion', ...resourceFields, 'cadenceRounds', 'damageDisableAt', 'transport'];
  if (!record(value) || !(keys(value, fields) || keys(value, [...fields, 'strategicCargo'])) || !text(value.recipeId) || !integer(value.recipeVersion, 1)
    || !integer(value.cadenceRounds, 1, KNOWLEDGE_RULES.maximumCadence) || !isTransportQuote(value.transport, KNOWLEDGE_RULES.maximumEdges + 1)
    || !dense(value.transport.tileIds, KNOWLEDGE_RULES.maximumEdges + 1) || !resourceFields.every(field => vector(value[field]))) return false;
  const recipe = TRADE_RECIPES.find(item => item.id === value.recipeId && item.version === value.recipeVersion);
  if (!recipe || value.damageDisableAt !== recipe.terms.damageDisableAt || resourceFields.some(field => !equal(value[field], recipe.terms[field]))
    || value.cadenceRounds !== transportCadence(recipe.terms.cadenceRounds, value.transport)
    || !equal(value.strategicCargo, recipe.terms.strategicCargo)) return false;
  const quote = value.transport;
  return quote.mode === 'land' || quote.baseCadence === recipe.terms.cadenceRounds && dense(quote.edgeWeights, KNOWLEDGE_RULES.maximumEdges) && dense(quote.railEdges, KNOWLEDGE_RULES.maximumEdges)
    && quote.railEdges.every(edge => record(edge) && keys(edge, ['edgeId', 'completionEventId']) && text(edge.edgeId) && eventId(edge.completionEventId));
}

export function isKnowledgeTerms(value: unknown): value is KnowledgeTerms {
  if (!record(value) || !keys(value, ['ruleVersion', 'routeId', 'agreementOfferId', 'agreementAcceptedRound', 'owner', 'partner', 'fromCityId', 'toCityId', 'fromTileId', 'toTileId', 'tradeTerms', 'teacherId', 'learnerId', 'teacherCityId', 'learnerCityId', 'teacherTileId', 'learnerTileId', 'teacherInstitutionId', 'learnerInstitutionId', 'technologyId', 'costBasis', 'requiredFeatures', 'prerequisites', 'basisReleaseId', 'learnerContribution', 'teacherContribution', 'transferred', 'consumed', 'percent', 'nominalAmount', 'requiredStudies', 'pendingLifetime', 'studySeasons', 'studyInterval', 'names'])
    || value.ruleVersion !== KNOWLEDGE_RULES.ruleVersion || !text(value.routeId) || !text(value.agreementOfferId) || !integer(value.agreementAcceptedRound)
    || !['owner', 'partner', 'teacherId', 'learnerId'].every(key => integer(value[key], 0, CIV_COUNT - 1)) || value.owner === value.partner || value.teacherId === value.learnerId
    || !['fromCityId', 'toCityId', 'teacherCityId', 'learnerCityId'].every(key => text(value[key])) || value.fromCityId === value.toCityId
    || !['fromTileId', 'toTileId', 'teacherTileId', 'learnerTileId'].every(key => integer(value[key])) || value.fromTileId === value.toTileId
    || !institution(value.teacherInstitutionId) || !institution(value.learnerInstitutionId) || !technology(value.technologyId) || !tradeTerms(value.tradeTerms)
    || value.tradeTerms.transport!.tileIds[0] !== value.fromTileId || value.tradeTerms.transport!.tileIds.at(-1) !== value.toTileId
    || !strings(value.requiredFeatures, 16) || !strings(value.prerequisites, 16) || !text(value.basisReleaseId)
    || !cents(value.costBasis) || value.costBasis <= 0 || !cents(value.nominalAmount) || value.nominalAmount <= 0
    || value.percent !== KNOWLEDGE_RULES.percent || value.requiredStudies !== KNOWLEDGE_RULES.requiredStudies || value.pendingLifetime !== KNOWLEDGE_RULES.pendingLifetime || value.studySeasons !== KNOWLEDGE_RULES.studySeasons || value.studyInterval !== KNOWLEDGE_RULES.studyInterval
    || !equal(value.learnerContribution, KNOWLEDGE_RULES.learnerContribution) || !equal(value.teacherContribution, KNOWLEDGE_RULES.teacherContribution) || !equal(value.transferred, KNOWLEDGE_RULES.transferred) || !equal(value.consumed, KNOWLEDGE_RULES.consumed)
    || !record(value.names) || !keys(value.names, ['teacher', 'learner', 'teacherCity', 'learnerCity', 'teacherInstitution', 'learnerInstitution', 'technology']) || !Object.values(value.names).every(name => text(name, 256))) return false;
  const definition = TECHNOLOGIES.find(item => item.id === value.technologyId)!;
  const release = RELEASES.find(item => item.id === value.basisReleaseId);
  const teacherIsOwner = value.teacherId === value.owner; const trade = value.tradeTerms;
  const teacherBuilding = BUILDINGS.find(item => item.id === value.teacherInstitutionId)!; const learnerBuilding = BUILDINGS.find(item => item.id === value.learnerInstitutionId)!;
  return value.learnerId === (teacherIsOwner ? value.partner : value.owner) && value.teacherId === (teacherIsOwner ? value.owner : value.partner)
    && value.teacherCityId === (teacherIsOwner ? value.fromCityId : value.toCityId) && value.learnerCityId === (teacherIsOwner ? value.toCityId : value.fromCityId)
    && value.teacherTileId === (teacherIsOwner ? value.fromTileId : value.toTileId) && value.learnerTileId === (teacherIsOwner ? value.toTileId : value.fromTileId)
    && value.costBasis === definition.cost && units(value.nominalAmount) === Math.floor(units(value.costBasis) * KNOWLEDGE_RULES.percent / 100)
    && equal(value.requiredFeatures, [...new Set([...ACTION_FEATURES.research, ...definition.requiredFeatures])]) && equal(value.prerequisites, definition.requires)
    && Boolean(release && [KNOWLEDGE_RULES.featureId, ...value.requiredFeatures, ...teacherBuilding.requiredFeatures, ...learnerBuilding.requiredFeatures,
      ...TRADE_RECIPES.find(item => item.id === trade.recipeId)!.requiredFeatures, ...(trade.transport!.mode === 'steam' ? ['industrial-steam'] : [])].every(id => release.featureIds.includes(id)));
}

export function isResolvedTradeDelivery(value: unknown): value is ResolvedTradeDelivery {
  if (!record(value) || !keys(value, ['ruleVersion', 'routeId', 'agreementOfferId', 'agreementAcceptedRound', 'owner', 'partner', 'fromCityId', 'toCityId', 'fromTileId', 'toTileId', 'round', 'revision', 'eventId', 'deliveryCount', 'tradeTerms', 'proposerPaid', 'recipientPaid', 'proposerStrategicPaid', 'recipientStrategicPaid'])
    || value.ruleVersion !== 1 || !text(value.routeId) || !text(value.agreementOfferId) || !integer(value.agreementAcceptedRound) || !integer(value.round, value.agreementAcceptedRound + 1)
    || !integer(value.revision, 1) || !eventId(value.eventId) || eventRevision(value.eventId) !== value.revision || !integer(value.deliveryCount, 1)
    || !integer(value.owner, 0, CIV_COUNT - 1) || !integer(value.partner, 0, CIV_COUNT - 1) || value.owner === value.partner
    || !text(value.fromCityId) || !text(value.toCityId) || value.fromCityId === value.toCityId || !integer(value.fromTileId) || !integer(value.toTileId) || value.fromTileId === value.toTileId
    || !tradeTerms(value.tradeTerms) || value.tradeTerms.transport!.tileIds[0] !== value.fromTileId || value.tradeTerms.transport!.tileIds.at(-1) !== value.toTileId
    || !vector(value.proposerPaid, true) || !vector(value.recipientPaid, true) || !strategic(value.proposerStrategicPaid) || !strategic(value.recipientStrategicPaid)) return false;
  const terms = value.tradeTerms; const proposerPaid = value.proposerPaid; const recipientPaid = value.recipientPaid;
  const proposerStrategic = { ...terms.strategicCargo?.proposer };
  if (terms.transport!.mode === 'steam') proposerStrategic.coal = (proposerStrategic.coal ?? 0) + terms.transport!.proposerFuel.coal;
  return value.deliveryCount <= Math.floor((value.round - value.agreementAcceptedRound) / terms.cadenceRounds)
    && RESOURCE_IDS.every(id => proposerPaid[id] === (terms.proposerCargo[id] ?? 0) + (terms.proposerUpkeep[id] ?? 0) && recipientPaid[id] === (terms.recipientCargo[id] ?? 0) + (terms.recipientUpkeep[id] ?? 0))
    && equal(value.proposerStrategicPaid, proposerStrategic) && equal(value.recipientStrategicPaid, { ...terms.strategicCargo?.recipient });
}

export function isKnowledgeInstitutionProof(value: unknown): value is KnowledgeInstitutionProof {
  if (!record(value) || !keys(value, ['civId', 'cityId', 'tileId', 'institutionId', 'inputs', 'residentsRequired', 'result', 'operationEventId']) || !integer(value.civId, 0, CIV_COUNT - 1) || !text(value.cityId) || !integer(value.tileId) || !institution(value.institutionId)
    || !eventId(value.operationEventId) || !vector(value.inputs) || value.residentsRequired !== RESIDENT_CAPACITY_RULES.perPaidRecipe || !record(value.result)) return false;
  const definition = BUILDINGS.find(item => item.id === value.institutionId)!; const result = value.result;
  if (!equal(value.inputs, definition.operatingInputs) || !keys(result, ['round', 'status', 'paid', 'produced', 'shortages', 'residents']) || !integer(result.round) || result.status !== 'operated'
    || !equal(result.paid, value.inputs) || !vector(result.produced) || !keys(result.produced, ['science']) || !(result.produced.science! > 0)
    || !dense(result.shortages, 0) || !record(result.residents)) return false;
  const residents = result.residents;
  return keys(residents, ['ruleVersion', 'openingPopulation', 'communityReserve', 'required', 'available', 'allocated']) && residents.ruleVersion === RESIDENT_CAPACITY_RULES.ruleVersion
    && integer(residents.openingPopulation, 1) && residents.communityReserve === RESIDENT_CAPACITY_RULES.communityReserve && residents.required === value.residentsRequired
    && integer(residents.available, residents.required, Math.max(0, residents.openingPopulation - residents.communityReserve)) && residents.allocated === residents.required;
}

export function knowledgeOperationEventMatches(event: GameEvent, proof: KnowledgeInstitutionProof): boolean {
  if (!isKnowledgeInstitutionProof(proof) || event.id !== proof.operationEventId || event.type !== 'building-operation' || event.round !== proof.result.round
    || event.actor !== proof.civId || event.target !== proof.civId || event.tileId !== proof.tileId || event.detail !== `${proof.cityId}/${proof.institutionId} at strategic round ${proof.result.round}`) return false;
  const result = proof.result; const residents = result.residents!;
  const effects = [...RESOURCE_IDS.filter(resource => (result.paid[resource] ?? 0) > 0).map(resource => `Paid ${result.paid[resource]} ${resource}`),
    ...RESOURCE_IDS.filter(resource => (result.produced[resource] ?? 0) > 0).map(resource => `Produced ${result.produced[resource]} ${resource}`),
    `Residents: required ${residents.required}, opening capacity remaining ${residents.available}, allocated ${residents.allocated}; population is not consumed`];
  return equal(event.effects, effects);
}

export function isKnowledgeStudySeason(value: unknown): value is KnowledgeStudySeason {
  return record(value) && keys(value, ['routeId', 'agreementOfferId', 'agreementAcceptedRound', 'owner', 'partner', 'fromCityId', 'toCityId', 'fromTileId', 'toTileId', 'tradeTerms', 'round', 'revision'])
    && text(value.routeId) && text(value.agreementOfferId) && integer(value.agreementAcceptedRound) && integer(value.round, value.agreementAcceptedRound + 1) && integer(value.revision, 1)
    && integer(value.owner, 0, CIV_COUNT - 1) && integer(value.partner, 0, CIV_COUNT - 1) && value.owner !== value.partner
    && text(value.fromCityId) && text(value.toCityId) && value.fromCityId !== value.toCityId && integer(value.fromTileId) && integer(value.toTileId) && value.fromTileId !== value.toTileId
    && tradeTerms(value.tradeTerms) && value.tradeTerms.transport!.tileIds[0] === value.fromTileId && value.tradeTerms.transport!.tileIds.at(-1) === value.toTileId;
}
function proofParty(proof: KnowledgeInstitutionProof, season: KnowledgeStudySeason): boolean {
  return proof.result.round === season.round && eventRevision(proof.operationEventId) === season.revision
    && (proof.civId === season.owner && proof.cityId === season.fromCityId && proof.tileId === season.fromTileId
      || proof.civId === season.partner && proof.cityId === season.toCityId && proof.tileId === season.toTileId);
}
function boundParty(proof: KnowledgeInstitutionProof, terms: KnowledgeTerms, party: 'teacher' | 'learner'): boolean {
  return proof.civId === terms[`${party}Id`] && proof.cityId === terms[`${party}CityId`] && proof.tileId === terms[`${party}TileId`] && proof.institutionId === terms[`${party}InstitutionId`];
}
function boundSeason(season: KnowledgeStudySeason, terms: KnowledgeTerms): boolean {
  return ['routeId', 'agreementOfferId', 'agreementAcceptedRound', 'owner', 'partner', 'fromCityId', 'toCityId', 'fromTileId', 'toTileId', 'tradeTerms'].every(key => equal(season[key as keyof KnowledgeStudySeason], terms[key as keyof KnowledgeTerms]));
}
export function isKnowledgeStudyProof(value: unknown): value is KnowledgeStudyProof {
  return record(value) && keys(value, ['season', 'teacher', 'learner']) && isKnowledgeStudySeason(value.season) && isKnowledgeInstitutionProof(value.teacher) && isKnowledgeInstitutionProof(value.learner)
    && value.teacher.civId !== value.learner.civId && value.teacher.operationEventId !== value.learner.operationEventId && proofParty(value.teacher, value.season) && proofParty(value.learner, value.season);
}
export function isKnowledgeStudyAttempt(value: unknown): value is KnowledgeStudyAttempt {
  if (!record(value) || !keys(value, ['season', 'teacher', 'learner', 'blockers']) || !isKnowledgeStudySeason(value.season) || !dense(value.blockers, 3)
    || !(value.teacher === null || isKnowledgeInstitutionProof(value.teacher) && proofParty(value.teacher, value.season)) || !(value.learner === null || isKnowledgeInstitutionProof(value.learner) && proofParty(value.learner, value.season))) return false;
  const missing: string[] = (['teacher', 'learner'] as const).filter(party => value[party] === null);
  if (value.blockers.some(blocker => record(blocker) && blocker.party === 'route')) missing.push('route');
  return value.blockers.length === missing.length && value.blockers.every((blocker, index) => record(blocker) && keys(blocker, ['party', 'reason']) && blocker.party === missing[index] && text(blocker.reason, 1000))
    && (value.teacher === null || value.learner === null || value.teacher.civId !== value.learner.civId && value.teacher.operationEventId !== value.learner.operationEventId);
}
function seasonGap(previous: KnowledgeStudySeason, next: KnowledgeStudySeason): boolean {
  return next.round > previous.round && next.revision > previous.revision;
}
function operationsPrecede(attempt: Pick<KnowledgeStudyAttempt, 'teacher' | 'learner'>, id: string): boolean {
  return [attempt.teacher, attempt.learner].every(proof => !proof || precedes(proof.operationEventId, id));
}

export function isKnowledgeCompact(value: unknown): value is KnowledgeCompact {
  if (!record(value) || !isKnowledgeTerms(value.terms) || !integer(value.sequence, 1) || !compactId(value.id) || value.id !== `knowledge-${value.terms.teacherId}-${value.sequence}`
    || !integer(value.proposedRound, value.terms.agreementAcceptedRound + value.terms.tradeTerms.cadenceRounds) || !integer(value.proposedRevision, 1) || !integer(value.proposedRound + KNOWLEDGE_RULES.pendingLifetime)
    || value.sequence - 1 > Math.floor(value.proposedRound / KNOWLEDGE_RULES.cooldownRounds)) return false;
  const base = ['id', 'sequence', 'proposedRound', 'proposedRevision', 'terms', 'status'];
  if (value.status === 'proposed') return keys(value, [...base, 'expiresRound']) && value.expiresRound === value.proposedRound + KNOWLEDGE_RULES.pendingLifetime;
  if (value.status !== 'accepted' || !keys(value, [...base, 'acceptedRound', 'acceptedRevision', 'lastAttemptRound', 'deadlineRound', 'studies', 'lastStudyAttempt'])
    || !integer(value.acceptedRound, value.proposedRound, value.proposedRound + KNOWLEDGE_RULES.pendingLifetime - 1) || !integer(value.acceptedRevision, value.proposedRevision + 1)
    || !integer(value.deadlineRound) || value.deadlineRound !== value.acceptedRound + KNOWLEDGE_RULES.studySeasons * KNOWLEDGE_RULES.studyInterval
    || !integer(value.lastAttemptRound, value.acceptedRound, value.deadlineRound) || !dense(value.studies, KNOWLEDGE_RULES.requiredStudies)) return false;
  const terms = value.terms;
  const fresh = (season: KnowledgeStudySeason) => boundSeason(season, terms) && season.round > Number(value.acceptedRound) && season.round <= Number(value.lastAttemptRound)
    && season.revision > Number(value.acceptedRevision);
  let previousRound = value.acceptedRound; let previousRevision = value.acceptedRevision; let last: KnowledgeStudyProof | undefined;
  for (const proof of value.studies) {
    if (!isKnowledgeStudyProof(proof) || !fresh(proof.season) || !boundParty(proof.teacher, terms, 'teacher') || !boundParty(proof.learner, terms, 'learner')
      || proof.season.round <= previousRound || proof.season.revision <= previousRevision) return false;
    previousRound = proof.season.round; previousRevision = proof.season.revision; last = proof;
  }
  if (value.lastStudyAttempt === null) return value.studies.length === 0 && value.lastAttemptRound === value.acceptedRound;
  if (!isKnowledgeStudyAttempt(value.lastStudyAttempt) || !fresh(value.lastStudyAttempt.season) || value.lastStudyAttempt.season.round !== value.lastAttemptRound
    || value.lastStudyAttempt.season.round < previousRound || value.lastStudyAttempt.season.revision < previousRevision
    || value.lastStudyAttempt.teacher && !boundParty(value.lastStudyAttempt.teacher, terms, 'teacher') || value.lastStudyAttempt.learner && !boundParty(value.lastStudyAttempt.learner, terms, 'learner')) return false;
  const attempt = value.lastStudyAttempt;
  return attempt.blockers.length === 0 ? Boolean(last && equal(attempt.season, last.season) && equal(attempt.teacher, last.teacher) && equal(attempt.learner, last.learner))
    : !last || seasonGap(last.season, attempt.season) && value.studies.length < KNOWLEDGE_RULES.requiredStudies;
}

function balances(value: unknown): value is KnowledgeBalances { return record(value) && keys(value, ['teacher', 'learner']) && vector(value.teacher, true) && vector(value.learner, true); }
const failureReasons = ['feature-unreleased', 'route-missing', 'route-consent-stopped', 'agreement-replaced', 'route-participants-changed', 'route-endpoints-changed', 'trade-terms-changed', 'institution-identity-changed', 'teacher-knowledge-missing', 'target-already-completed', 'target-changed', 'target-ineligible', 'cost-basis-changed', 'entitlement-used'] as const;
const settlementFailures = ['learner-contribution-shortfall', 'teacher-contribution-shortfall', 'unsafe-accounting', 'no-positive-work'] as const;

export function isKnowledgeResult(value: unknown): value is KnowledgeResult {
  if (!record(value) || !keys(value, ['ruleVersion', 'compact', 'outcome', 'reason', 'detail', 'actor', 'resolvedRound', 'resolvedRevision', 'eventId', 'before', 'after', 'learnerPaid', 'teacherPaid', 'transferred', 'consumed', 'nominalAmount', 'amount', 'unusedAmount', 'progressBefore', 'progressAfter', 'researchCompletionEventId'])
    || value.ruleVersion !== KNOWLEDGE_RULES.ruleVersion || !isKnowledgeCompact(value.compact) || !text(value.detail, 1000) || !eventId(value.eventId)
    || !integer(value.resolvedRound, value.compact.status === 'accepted' ? value.compact.acceptedRound : value.compact.proposedRound)
    || !integer(value.resolvedRevision, (value.compact.status === 'accepted' ? value.compact.acceptedRevision : value.compact.proposedRevision) + 1) || eventRevision(value.eventId) !== value.resolvedRevision
    || !balances(value.before) || !balances(value.after) || !vector(value.learnerPaid) || !vector(value.teacherPaid) || !vector(value.transferred) || !vector(value.consumed)
    || value.nominalAmount !== value.compact.terms.nominalAmount || !cents(value.amount) || !cents(value.unusedAmount) || !finite(value.progressBefore) || !finite(value.progressAfter)
    || !(value.researchCompletionEventId === null || eventId(value.researchCompletionEventId))) return false;
  const compact = value.compact; const terms = compact.terms;
  const last = compact.status === 'accepted' ? compact.studies.at(-1) : undefined;
  if (compact.status === 'accepted' && compact.lastStudyAttempt && (compact.lastStudyAttempt.season.round > value.resolvedRound || compact.lastStudyAttempt.season.revision > value.resolvedRevision || !operationsPrecede(compact.lastStudyAttempt, value.eventId))) return false;
  if (value.outcome === 'completed') {
    if (compact.status !== 'accepted' || compact.studies.length !== KNOWLEDGE_RULES.requiredStudies || !last || value.reason !== 'settled' || value.actor !== null
      || value.resolvedRound !== last.season.round || value.resolvedRevision !== last.season.revision || value.resolvedRound > compact.deadlineRound
      || !equal(value.learnerPaid, terms.learnerContribution) || !equal(value.teacherPaid, terms.teacherContribution) || !equal(value.transferred, terms.transferred) || !equal(value.consumed, terms.consumed)
      || !cents(value.progressBefore) || !cents(value.progressAfter) || value.amount <= 0 || units(value.progressBefore) >= units(terms.costBasis)
      || units(value.amount) !== Math.min(units(terms.nominalAmount), units(terms.costBasis) - units(value.progressBefore))
      || units(value.progressAfter) !== units(value.progressBefore) + units(value.amount) || units(value.unusedAmount) !== units(terms.nominalAmount) - units(value.amount)) return false;
    for (const party of ['teacher', 'learner'] as const) for (const resource of RESOURCE_IDS) {
      const before = value.before[party][resource]; const after = value.after[party][resource];
      const delta = party === 'teacher' ? resource === 'culture' ? -200 : resource === 'credits' ? 300 : 0 : resource === 'materials' ? -300 : resource === 'credits' ? -400 : 0;
      if (delta === 0 ? before !== after : !cents(before) || !cents(after) || !Number.isSafeInteger(units(before) + delta) || units(after) !== units(before) + delta) return false;
    }
    return value.progressAfter === terms.costBasis ? value.researchCompletionEventId !== null && eventRevision(value.researchCompletionEventId) === value.resolvedRevision && operationsPrecede(last, value.researchCompletionEventId) && precedes(value.researchCompletionEventId, value.eventId)
      : value.researchCompletionEventId === null;
  }
  if (!equal(value.before, value.after) || !equal(value.learnerPaid, {}) || !equal(value.teacherPaid, {}) || !equal(value.transferred, {}) || !equal(value.consumed, {})
    || value.amount !== 0 || value.unusedAmount !== value.nominalAmount || value.progressBefore !== value.progressAfter || value.researchCompletionEventId !== null) return false;
  if (value.outcome === 'declined') return compact.status === 'proposed' && value.reason === 'declined-by-learner' && value.actor === terms.learnerId && value.resolvedRound < compact.expiresRound;
  if (value.outcome === 'withdrawn') return value.reason === 'withdrawn-by-participant' && (value.actor === terms.teacherId || compact.status === 'accepted' && value.actor === terms.learnerId)
    && (compact.status === 'proposed' ? value.resolvedRound < compact.expiresRound : compact.studies.length < KNOWLEDGE_RULES.requiredStudies && value.resolvedRound <= compact.deadlineRound);
  if (value.outcome === 'expired') return compact.status === 'proposed' && value.reason === 'consent-window-ended' && value.actor === null && value.resolvedRound >= compact.expiresRound;
  if (value.outcome !== 'failed' || value.actor !== null) return false;
  if (value.reason === 'study-window-ended') return compact.status === 'accepted' && compact.studies.length < KNOWLEDGE_RULES.requiredStudies && value.resolvedRound >= compact.deadlineRound;
  if (settlementFailures.some(reason => reason === value.reason)) return compact.status === 'accepted' && compact.studies.length === KNOWLEDGE_RULES.requiredStudies && Boolean(last && value.resolvedRound === last.season.round && value.resolvedRevision === last.season.revision);
  return failureReasons.some(reason => reason === value.reason) && (compact.status === 'proposed' ? value.resolvedRound < compact.expiresRound : compact.studies.length < KNOWLEDGE_RULES.requiredStudies);
}

const knowledgePayloads = ['knowledgeCompact', 'knowledgeStudy', 'knowledgeResult'] as const;
function hasKnowledge(value: Record<string, unknown>): boolean { return typeof value.type === 'string' && value.type.startsWith('knowledge-') || knowledgePayloads.some(key => Object.hasOwn(value, key)); }

export function validKnowledgeEvent(value: unknown): boolean {
  if (!record(value)) return false;
  if (!hasKnowledge(value)) return true;
  if (!eventId(value.id) || !integer(value.round) || knowledgePayloads.filter(key => Object.hasOwn(value, key)).length !== 1) return false;
  if (value.type === 'knowledge-proposed' || value.type === 'knowledge-accepted') {
    if (!isKnowledgeCompact(value.knowledgeCompact)) return false;
    const compact = value.knowledgeCompact; const accepted = value.type === 'knowledge-accepted';
    return compact.status === (accepted ? 'accepted' : 'proposed') && value.detail === compact.id && value.tileId === compact.terms.learnerTileId
      && value.actor === (accepted ? compact.terms.learnerId : compact.terms.teacherId) && value.target === (accepted ? compact.terms.teacherId : compact.terms.learnerId)
      && (compact.status === 'accepted' ? compact.acceptedRound === value.round && compact.acceptedRevision === eventRevision(value.id) && compact.studies.length === 0 && compact.lastStudyAttempt === null
        : compact.proposedRound === value.round && compact.proposedRevision === eventRevision(value.id));
  }
  if (value.type === 'knowledge-study') {
    const study = value.knowledgeStudy;
    if (!record(study) || !keys(study, ['compactId', 'attempt', 'studyCount']) || !compactId(study.compactId) || !isKnowledgeStudyAttempt(study.attempt) || !integer(study.studyCount, study.attempt.blockers.length ? 0 : 1, 2)) return false;
    const season = study.attempt.season; const teacher = Number(study.compactId.split('-')[1]); const learner = season.owner === teacher ? season.partner : season.owner;
    return (season.owner === teacher || season.partner === teacher) && value.detail === study.compactId && value.actor === teacher && value.target === learner
      && value.tileId === (season.owner === learner ? season.fromTileId : season.toTileId) && value.round === season.round && eventRevision(value.id) === season.revision && operationsPrecede(study.attempt, value.id)
      && (!study.attempt.teacher || study.attempt.teacher.civId === teacher) && (!study.attempt.learner || study.attempt.learner.civId === learner)
      && (study.attempt.blockers.length === 0 || study.studyCount < 2);
  }
  const result = value.knowledgeResult;
  return isKnowledgeResult(result) && value.type === `knowledge-${result.outcome}` && value.id === result.eventId && value.round === result.resolvedRound
    && value.actor === result.actor && value.target === result.compact.terms.learnerId && value.tileId === result.compact.terms.learnerTileId && value.detail === result.compact.id && value.cause === result.detail;
}

function retainedOperations(attempt: Pick<KnowledgeStudyAttempt, 'teacher' | 'learner'>, state: WorldState): boolean {
  return [attempt.teacher, attempt.learner].every(proof => {
    if (!proof) return true;
    const event = state.events.find(item => item.id === proof.operationEventId);
    return event ? knowledgeOperationEventMatches(event, proof) : !state.events.length || precedes(proof.operationEventId, state.events[0]!.id);
  });
}
function historicalCompact(compact: KnowledgeCompact, state: WorldState): boolean {
  if (compact.proposedRound > state.round || compact.proposedRevision > state.revision || !state.civilizations.some(civ => civ.id === compact.terms.teacherId) || !state.civilizations.some(civ => civ.id === compact.terms.learnerId)
    || transportTopologyBlock(state, compact.terms.tradeTerms.transport!, compact.terms.fromTileId, compact.terms.toTileId) !== null) return false;
  const transport = compact.terms.tradeTerms.transport!;
  if (transport.mode === 'steam' && transport.railEdges.some(edge => eventRevision(edge.completionEventId) > compact.proposedRevision)) return false;
  if (compact.status !== 'accepted') return true;
  if (compact.acceptedRound > state.round || compact.acceptedRevision > state.revision) return false;
  return [...compact.studies, ...(compact.lastStudyAttempt ? [compact.lastStudyAttempt] : [])].every(attempt => attempt.season.round <= state.round && attempt.season.revision <= state.revision && retainedOperations(attempt, state));
}
function historicalResult(result: KnowledgeResult, state: WorldState): boolean {
  if (!historicalCompact(result.compact, state) || result.resolvedRound > state.round || result.resolvedRevision > state.revision) return false;
  const retained = state.events.find(event => event.id === result.eventId);
  if (retained && (!validKnowledgeEvent(retained) || !equal(retained.knowledgeResult, result))) return false;
  if (result.researchCompletionEventId !== null) {
    if (!state.civilizations.find(civ => civ.id === result.compact.terms.learnerId)?.technologies.includes(result.compact.terms.technologyId)) return false;
    const completed = state.events.find(event => event.id === result.researchCompletionEventId);
    if (completed && (completed.type !== 'research-completed' || completed.round !== result.resolvedRound || completed.actor !== result.compact.terms.learnerId || completed.target !== result.compact.terms.learnerId || !completed.effects.includes(`Technology ${result.compact.terms.technologyId} unlocked`))) return false;
  }
  return true;
}
function sameCompactIdentity(first: KnowledgeCompact, second: KnowledgeCompact): boolean {
  return first.id === second.id && first.sequence === second.sequence && first.proposedRound === second.proposedRound && first.proposedRevision === second.proposedRevision && equal(first.terms, second.terms)
    && (first.status !== 'accepted' || second.status !== 'accepted' || first.acceptedRound === second.acceptedRound && first.acceptedRevision === second.acceptedRevision && first.deadlineRound === second.deadlineRound);
}

export function isKnowledgeState(value: unknown, state: WorldState): value is KnowledgeState {
  if (!state.unlockedFeatures.includes(KNOWLEDGE_RULES.featureId)) return value === undefined && !state.events.some(event => hasKnowledge(event as unknown as Record<string, unknown>));
  if (!record(value) || !keys(value, ['ruleVersion', 'active', 'sequences', 'lastResults', 'grants']) || value.ruleVersion !== KNOWLEDGE_RULES.ruleVersion || state.civilizations.length !== CIV_COUNT
    || !dense(value.active, CIV_COUNT) || !dense(value.sequences, CIV_COUNT) || value.sequences.length !== CIV_COUNT || !value.sequences.every(sequence => integer(sequence))
    || !dense(value.lastResults, CIV_COUNT) || value.lastResults.length !== CIV_COUNT || !dense(value.grants, CIV_COUNT) || value.grants.length !== CIV_COUNT
    || !integer(state.round) || !integer(state.revision) || new Set(state.events.map(event => event.id)).size !== state.events.length) return false;
  const sequences = value.sequences as number[]; const latest: Array<KnowledgeResult | null> = []; const active = new Map<number, KnowledgeCompact>();
  const allResults = new Map<string, KnowledgeResult>(); const compacts = new Map<string, KnowledgeCompact>(); const resultEventIds = new Map<string, string>();
  const addCompact = (compact: KnowledgeCompact): boolean => {
    if (!historicalCompact(compact, state) || compact.sequence > sequences[compact.terms.teacherId]!) return false;
    const earlier = compacts.get(compact.id);
    if (earlier && !sameCompactIdentity(earlier, compact)) return false;
    if (earlier?.status === 'accepted' && compact.status === 'accepted') {
      const shorter = earlier.studies.length <= compact.studies.length ? earlier : compact; const longer = shorter === earlier ? compact : earlier;
      if (!shorter.studies.every((proof, index) => equal(proof, longer.studies[index]))) return false;
      if (earlier.lastAttemptRound === compact.lastAttemptRound && !equal(earlier.lastStudyAttempt, compact.lastStudyAttempt)) return false;
    }
    if (!earlier || earlier.status === 'proposed' || compact.status === 'accepted' && (earlier.status !== 'accepted' || compact.lastAttemptRound >= earlier.lastAttemptRound)) compacts.set(compact.id, compact);
    return true;
  };
  const addResult = (result: KnowledgeResult): boolean => {
    if (!historicalResult(result, state) || !addCompact(result.compact)) return false;
    const earlier = allResults.get(result.compact.id); if (earlier && !equal(earlier, result)) return false;
    const eventCompact = resultEventIds.get(result.eventId); if (eventCompact && eventCompact !== result.compact.id) return false;
    allResults.set(result.compact.id, result); resultEventIds.set(result.eventId, result.compact.id); return true;
  };
  for (const [teacher, result] of value.lastResults.entries()) {
    if (result !== null && (!isKnowledgeResult(result) || result.compact.terms.teacherId !== teacher || !addResult(result))) return false;
    latest.push(result as KnowledgeResult | null);
  }
  const grantIds = new Set<string>();
  for (const [learner, slots] of value.grants.entries()) {
    if (!record(slots) || !keys(slots, KNOWLEDGE_TECHNOLOGY_IDS)) return false;
    for (const id of KNOWLEDGE_TECHNOLOGY_IDS) {
      const result = slots[id]; if (result === null) continue;
      if (!isKnowledgeResult(result) || result.outcome !== 'completed' || result.compact.terms.learnerId !== learner || result.compact.terms.technologyId !== id || grantIds.has(result.compact.id) || !addResult(result)) return false;
      grantIds.add(result.compact.id);
    }
  }
  let previousTeacher = -1; const learners = new Set<number>(); const pairs = new Set<string>();
  for (const compact of value.active) {
    if (!isKnowledgeCompact(compact) || !addCompact(compact) || compact.terms.teacherId <= previousTeacher || learners.has(compact.terms.learnerId)
      || compact.status === 'accepted' && (compact.studies.length >= KNOWLEDGE_RULES.requiredStudies || state.round >= compact.deadlineRound)
      || compact.status === 'proposed' && state.round >= compact.expiresRound || allResults.has(compact.id)) return false;
    const teacher = compact.terms.teacherId; const learner = compact.terms.learnerId; const pair = `${Math.min(teacher, learner)}:${Math.max(teacher, learner)}`;
    const previous = latest[teacher]; const granted = (value.grants[learner] as Record<string, unknown>)[compact.terms.technologyId];
    if (pairs.has(pair) || granted !== null || compact.sequence !== sequences[teacher] || compact.sequence !== (previous?.compact.sequence ?? 0) + 1
      || previous && (compact.proposedRound < previous.resolvedRound + KNOWLEDGE_RULES.cooldownRounds || compact.proposedRevision <= previous.resolvedRevision)) return false;
    previousTeacher = teacher; learners.add(learner); pairs.add(pair); active.set(teacher, compact);
  }
  for (let teacher = 0; teacher < CIV_COUNT; teacher++) if (sequences[teacher] !== (active.get(teacher)?.sequence ?? latest[teacher]?.compact.sequence ?? 0)) return false;
  for (const event of state.events) {
    if (!validKnowledgeEvent(event)) return false;
    if (!hasKnowledge(event as unknown as Record<string, unknown>)) continue;
    if (event.round > state.round || eventRevision(event.id) > state.revision) return false;
    if (event.knowledgeCompact && !addCompact(event.knowledgeCompact)) return false;
    if (event.knowledgeResult && !addResult(event.knowledgeResult)) return false;
  }
  for (const result of allResults.values()) {
    const last = latest[result.compact.terms.teacherId];
    if (!last || result.compact.sequence > last.compact.sequence || result.resolvedRound > last.resolvedRound || result.resolvedRevision > last.resolvedRevision || active.get(result.compact.terms.teacherId)?.id === result.compact.id) return false;
    const grant = (value.grants[result.compact.terms.learnerId] as Record<string, unknown>)[result.compact.terms.technologyId];
    if (result.outcome === 'completed' ? !equal(grant, result) : record(grant) && isKnowledgeResult(grant) && grant.compact.id === result.compact.id) return false;
  }
  for (const compact of compacts.values()) {
    const terminal = allResults.get(compact.id); const current = active.get(compact.terms.teacherId);
    if (compact.sequence === sequences[compact.terms.teacherId] && !terminal && current?.id !== compact.id) return false;
    if (terminal && terminal.compact.status === 'proposed' && compact.status === 'accepted') return false;
    if (terminal?.compact.status === 'accepted' && compact.status === 'accepted' && compact.lastAttemptRound > terminal.compact.lastAttemptRound) return false;
  }
  for (let teacher = 0; teacher < CIV_COUNT; teacher++) {
    const history = [...compacts.values()].filter(compact => compact.terms.teacherId === teacher).sort((left, right) => left.sequence - right.sequence);
    for (let index = 1; index < history.length; index++) {
      const previous = history[index - 1]!; const next = history[index]!; const terminal = allResults.get(previous.id);
      if (next.proposedRound < (terminal?.resolvedRound ?? previous.proposedRound) + KNOWLEDGE_RULES.cooldownRounds * (next.sequence - previous.sequence)
        || next.proposedRevision <= (terminal?.resolvedRevision ?? previous.proposedRevision)) return false;
    }
  }
  const attempts = new Map<string, Array<{ attempt: KnowledgeStudyAttempt; count: number }>>();
  for (const event of state.events) {
    const study = event.knowledgeStudy; if (!study) continue;
    const compact = compacts.get(study.compactId); const attempt = study.attempt;
    const teacher = Number(study.compactId.split('-')[1]); const sequence = Number(study.compactId.split('-')[2]); const terminal = allResults.get(study.compactId);
    if (sequence > sequences[teacher]! || !retainedOperations(attempt, state) || terminal && (!precedes(event.id, terminal.eventId) || terminal.researchCompletionEventId !== null && !precedes(event.id, terminal.researchCompletionEventId))) return false;
    if (compact) {
      if (compact.status !== 'accepted' || !boundSeason(attempt.season, compact.terms) || attempt.season.round <= compact.acceptedRound || attempt.season.round > compact.deadlineRound
        || attempt.season.revision <= compact.acceptedRevision || attempt.season.round > compact.lastAttemptRound
        || attempt.teacher && !boundParty(attempt.teacher, compact.terms, 'teacher') || attempt.learner && !boundParty(attempt.learner, compact.terms, 'learner')) return false;
      const count = compact.studies.filter(proof => proof.season.round <= attempt.season.round).length;
      if (count !== study.studyCount || attempt.blockers.length === 0 && (!compact.studies[count - 1] || !equal(compact.studies[count - 1], { season: attempt.season, teacher: attempt.teacher, learner: attempt.learner }))) return false;
      if (attempt.season.round === compact.lastAttemptRound && !equal(attempt, compact.lastStudyAttempt)) return false;
    }
    const retained = attempts.get(study.compactId) ?? [];
    if (retained.some(earlier => earlier.attempt.season.round === attempt.season.round || earlier.attempt.season.revision === attempt.season.revision)) return false;
    retained.push({ attempt, count: study.studyCount }); attempts.set(study.compactId, retained);
  }
  for (const history of attempts.values()) {
    history.sort((left, right) => left.attempt.season.round - right.attempt.season.round);
    for (let index = 1; index < history.length; index++) {
      const previous = history[index - 1]!; const next = history[index]!;
      if (!seasonGap(previous.attempt.season, next.attempt.season) || next.count < previous.count || next.count === previous.count && next.attempt.blockers.length === 0) return false;
    }
  }
  return true;
}
