import { ECONOMY_RULES } from './content.ts';
import { RELIEF_RULES } from './relief-content.ts';
import type { ReliefAction, ReliefBalances, ReliefCharter, ReliefProposalFacts, ReliefResult, ReliefState, ReliefTerms } from './relief-types.ts';
import { CIV_COUNT, type WorldState } from './types.ts';
import { isLandTransportQuote, landTransportTopologyBlock } from './simulation/transport.ts';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean { return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)); }
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function finite(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum; }
function text(value: unknown, maximum = 128): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum; }
function dense(value: unknown, maximum: number): value is unknown[] { return Array.isArray(value) && value.length <= maximum && Object.keys(value).length === value.length && Array.from({ length: value.length }, (_, index) => index).every(index => Object.hasOwn(value, index)); }
function charterId(value: unknown): value is string {
  if (!text(value) || !/^relief-[0-4]-[1-9]\d*$/.test(value)) return false;
  return integer(Number(value.split('-')[2]), 1);
}
function eventId(value: unknown): value is string {
  if (!text(value) || !/^[1-9]\d*:(0|[1-9]\d*)$/.test(value)) return false;
  const parts = value.split(':'); return integer(Number(parts[0]), 1) && integer(Number(parts[1]));
}
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equal(value, right[index]));
  return record(left) && record(right) && Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
}

export function isReliefAction(value: unknown): value is ReliefAction {
  if (!record(value)) return false;
  if (value.type === 'propose-relief') return keys(value, ['type', 'routeId', 'sourceCityId', 'recipientCityId']) && text(value.routeId) && text(value.sourceCityId) && text(value.recipientCityId) && value.sourceCityId !== value.recipientCityId;
  if (value.type === 'respond-relief') return keys(value, ['type', 'charterId', 'accept']) && charterId(value.charterId) && typeof value.accept === 'boolean';
  return value.type === 'withdraw-relief' && keys(value, ['type', 'charterId']) && charterId(value.charterId);
}

function proposalFacts(value: unknown): value is ReliefProposalFacts {
  return record(value) && keys(value, ['donorPopulation', 'recipientPopulation', 'donorFood', 'donorEnergy', 'recipientFood', 'promisedFood', 'promisedEnergy', 'horizonRounds'])
    && integer(value.donorPopulation, 1) && integer(value.recipientPopulation, 1)
    && ['donorFood', 'donorEnergy', 'recipientFood', 'promisedFood', 'promisedEnergy'].every(key => finite(value[key]))
    && integer(value.horizonRounds, RELIEF_RULES.pendingLifetime + RELIEF_RULES.minimumTravelRounds, RELIEF_RULES.pendingLifetime + Math.ceil(RELIEF_RULES.maximumEdges / RELIEF_RULES.edgesPerRound));
}

function terms(value: unknown): value is ReliefTerms {
  if (!record(value) || !keys(value, ['ruleVersion', 'routeId', 'agreementOfferId', 'donorId', 'recipientId', 'sourceCityId', 'recipientCityId', 'sourceTileId', 'recipientTileId', 'path', 'damageDisableAt', 'food', 'energy', 'travelRounds', 'proposal'])
    || value.ruleVersion !== RELIEF_RULES.ruleVersion || !text(value.routeId) || !text(value.agreementOfferId)
    || !integer(value.donorId, 0, CIV_COUNT - 1) || !integer(value.recipientId, 0, CIV_COUNT - 1) || value.donorId === value.recipientId
    || !text(value.sourceCityId) || !text(value.recipientCityId) || value.sourceCityId === value.recipientCityId
    || !integer(value.sourceTileId) || !integer(value.recipientTileId) || value.sourceTileId === value.recipientTileId
    || !isLandTransportQuote(value.path, RELIEF_RULES.maximumEdges + 1) || !dense(value.path.tileIds, RELIEF_RULES.maximumEdges + 1)
    || value.path.tileIds[0] !== value.sourceTileId || value.path.tileIds.at(-1) !== value.recipientTileId
    || !finite(value.damageDisableAt, 100) || value.damageDisableAt === 0
    || !integer(value.food, RELIEF_RULES.minimumFood, RELIEF_RULES.maximumFood) || value.energy !== RELIEF_RULES.energyCost
    || !integer(value.travelRounds) || value.travelRounds !== Math.max(RELIEF_RULES.minimumTravelRounds, Math.ceil(value.path.edges / RELIEF_RULES.edgesPerRound))
    || !proposalFacts(value.proposal) || value.proposal.horizonRounds !== RELIEF_RULES.pendingLifetime + value.travelRounds) return false;
  const facts = value.proposal;
  return value.food === Math.floor(Math.min(RELIEF_RULES.maximumFood, facts.recipientPopulation * ECONOMY_RULES.populationFoodUpkeep * 2 - facts.recipientFood, facts.donorFood - facts.promisedFood - facts.donorPopulation * ECONOMY_RULES.populationFoodUpkeep * 4))
    && facts.donorEnergy - facts.promisedEnergy >= value.energy;
}

function charter(value: unknown): value is ReliefCharter {
  if (!record(value) || !terms(value.terms) || !integer(value.sequence, 1) || value.id !== `relief-${value.terms.donorId}-${value.sequence}` || !text(value.id)
    || !integer(value.proposedRound) || value.sequence - 1 > Math.floor(value.proposedRound / RELIEF_RULES.cooldownRounds) || !Number.isSafeInteger(value.proposedRound + RELIEF_RULES.pendingLifetime)) return false;
  const base = ['id', 'sequence', 'proposedRound', 'terms', 'status'];
  if (value.status === 'proposed') return keys(value, [...base, 'expiresRound']) && value.expiresRound === value.proposedRound + RELIEF_RULES.pendingLifetime;
  return value.status === 'accepted' && keys(value, [...base, 'acceptedRound', 'dueRound'])
    && integer(value.acceptedRound, value.proposedRound, value.proposedRound + RELIEF_RULES.pendingLifetime - 1)
    && integer(value.dueRound) && value.dueRound === value.acceptedRound + value.terms.travelRounds;
}

function balances(value: unknown): value is ReliefBalances { return record(value) && keys(value, ['donorFood', 'donorEnergy', 'recipientFood']) && Object.values(value).every(amount => finite(amount)); }

export function isReliefResult(value: unknown): value is ReliefResult {
  if (!record(value) || !keys(value, ['ruleVersion', 'charter', 'outcome', 'reason', 'actor', 'resolvedRound', 'eventId', 'before', 'after', 'paid', 'deliveredFood'])
    || value.ruleVersion !== RELIEF_RULES.ruleVersion || !charter(value.charter) || !text(value.reason, 1000) || !eventId(value.eventId)
    || !integer(value.resolvedRound, value.charter.status === 'accepted' ? value.charter.acceptedRound : value.charter.proposedRound)
    || !balances(value.before) || !balances(value.after) || !record(value.paid) || !keys(value.paid, ['food', 'energy'])
    || !integer(value.paid.food, 0, RELIEF_RULES.maximumFood) || !integer(value.paid.energy, 0, RELIEF_RULES.energyCost) || !integer(value.deliveredFood, 0, RELIEF_RULES.maximumFood)) return false;
  const agreed = value.charter;
  if (value.outcome === 'delivered') return agreed.status === 'accepted' && value.resolvedRound >= agreed.dueRound && value.actor === null
    && value.paid.food === agreed.terms.food && value.paid.energy === agreed.terms.energy && value.deliveredFood === agreed.terms.food
    && value.after.donorFood === value.before.donorFood - agreed.terms.food && value.after.donorEnergy === value.before.donorEnergy - agreed.terms.energy
    && value.after.recipientFood === value.before.recipientFood + agreed.terms.food;
  if (value.paid.food !== 0 || value.paid.energy !== 0 || value.deliveredFood !== 0 || !equal(value.before, value.after)) return false;
  if (value.outcome === 'declined') return agreed.status === 'proposed' && value.actor === agreed.terms.recipientId && value.resolvedRound < agreed.expiresRound;
  if (value.outcome === 'withdrawn') return value.actor === agreed.terms.donorId || agreed.status === 'accepted' && value.actor === agreed.terms.recipientId;
  if (value.outcome === 'expired') return agreed.status === 'proposed' && value.actor === null && value.resolvedRound >= agreed.expiresRound;
  return value.outcome === 'failed' && value.actor === null;
}

export function validReliefEvent(value: unknown): boolean {
  if (!record(value)) return false;
  const terminal = ['relief-delivered', 'relief-declined', 'relief-withdrawn', 'relief-expired', 'relief-failed'].includes(String(value.type));
  if (!Object.hasOwn(value, 'reliefResult')) return !terminal;
  const result = value.reliefResult;
  return isReliefResult(result) && value.type === `relief-${result.outcome}` && value.id === result.eventId && value.round === result.resolvedRound
    && value.actor === result.actor && value.target === result.charter.terms.recipientId && value.tileId === result.charter.terms.recipientTileId
    && value.detail === result.charter.id && value.cause === result.reason;
}

function historicalCharter(value: ReliefCharter, state: WorldState): boolean {
  return value.proposedRound <= state.round && (value.status !== 'accepted' || value.acceptedRound <= state.round)
    && state.civilizations.some(civ => civ.id === value.terms.donorId) && state.civilizations.some(civ => civ.id === value.terms.recipientId)
    && landTransportTopologyBlock(state, value.terms.path, value.terms.sourceTileId, value.terms.recipientTileId) === null;
}

function historicalResult(value: ReliefResult, state: WorldState): boolean {
  return historicalCharter(value.charter, state) && value.resolvedRound <= state.round && Number(value.eventId.split(':')[0]) <= state.revision;
}

export function isReliefState(value: unknown, state: WorldState): value is ReliefState {
  if (!record(value) || !keys(value, ['ruleVersion', 'active', 'lastResults']) || value.ruleVersion !== RELIEF_RULES.ruleVersion
    || !dense(value.active, CIV_COUNT) || !dense(value.lastResults, state.civilizations.length) || value.lastResults.length !== state.civilizations.length) return false;
  const latest: Array<ReliefResult | null> = []; const latestEventIds = new Set<string>();
  for (const [donor, result] of value.lastResults.entries()) {
    if (result !== null) {
      if (!isReliefResult(result) || result.charter.terms.donorId !== donor || !historicalResult(result, state) || latestEventIds.has(result.eventId)) return false;
      latestEventIds.add(result.eventId);
    }
    latest.push(result as ReliefResult | null);
  }
  let previousDonor = -1; const pairs = new Set<string>(); const active = new Map<number, ReliefCharter>();
  for (const raw of value.active) {
    if (!charter(raw) || !historicalCharter(raw, state) || raw.terms.donorId <= previousDonor) return false;
    const { donorId, recipientId } = raw.terms; const last = latest[donorId];
    if (raw.sequence !== (last?.charter.sequence ?? 0) + 1 || last && raw.proposedRound < last.resolvedRound + RELIEF_RULES.cooldownRounds) return false;
    if (!state.cities.some(city => city.id === raw.terms.sourceCityId && city.tileId === raw.terms.sourceTileId)
      || !state.cities.some(city => city.id === raw.terms.recipientCityId && city.tileId === raw.terms.recipientTileId)) return false;
    const pair = `${Math.min(donorId, recipientId)}:${Math.max(donorId, recipientId)}`;
    if (pairs.has(pair)) return false;
    pairs.add(pair); active.set(donorId, raw); previousDonor = donorId;
  }
  const retained = new Map<string, ReliefResult>(); const retainedIds = new Set<string>();
  for (const event of state.events) {
    if (!validReliefEvent(event)) return false;
    if (!event.reliefResult) continue;
    const result = event.reliefResult; const donor = result.charter.terms.donorId; const last = latest[donor];
    if (!historicalResult(result, state) || !last || result.charter.sequence > last.charter.sequence || result.resolvedRound > last.resolvedRound
      || active.get(donor)?.id === result.charter.id || retained.has(result.charter.id) || retainedIds.has(result.eventId)) return false;
    if (result.charter.sequence === last.charter.sequence && !equal(result, last)) return false;
    retained.set(result.charter.id, result); retainedIds.add(result.eventId);
  }
  for (const result of latest) {
    if (result === null) continue;
    if (state.events.some(event => event.id === result.eventId && !equal(event.reliefResult, result))) return false;
    const history = [...retained.values()].filter(earlier => earlier.charter.terms.donorId === result.charter.terms.donorId && earlier.charter.sequence < result.charter.sequence);
    history.push(result); history.sort((left, right) => left.charter.sequence - right.charter.sequence);
    for (let index = 1; index < history.length; index++) {
      const earlier = history[index - 1]!; const later = history[index]!;
      if (later.charter.sequence - earlier.charter.sequence > Math.floor((later.charter.proposedRound - earlier.resolvedRound) / RELIEF_RULES.cooldownRounds)
        || Number(later.eventId.split(':')[0]) <= Number(earlier.eventId.split(':')[0])) return false;
    }
  }
  return true;
}
