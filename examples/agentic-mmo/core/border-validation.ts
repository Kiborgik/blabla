import { BUILDINGS, IMPROVEMENTS, RESIDENT_CAPACITY_RULES, RESOURCE_IDS, STRATEGIC_RESOURCE_IDS } from './content.ts';
import { BORDER_RULES } from './border-content.ts';
import { KNOWLEDGE_RULES } from './knowledge-content.ts';
import type { BorderAction, BorderClashReceipt, BorderControlReceipt, BorderDepartureQuote, BorderIncident, BorderOperationForecast, BorderParty, BorderResolution, BorderResult, BorderReturnReceipt, BorderState, BorderStepReceipt } from './border-types.ts';
import { CIV_COUNT, type WorldState } from './types.ts';
import { hexDistance } from './simulation/geography.ts';
import { randomStep } from './simulation/random.ts';
import { cityGrowthFacts } from './simulation/growth.ts';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean { return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)); }
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function finite(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum; }
function price(value: unknown): value is number { return finite(value) && Number.isSafeInteger(Math.round(value * 100)) && Math.round(value * 100) / 100 === value; }
function text(value: unknown, maximum = 128): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum; }
function dense(value: unknown, maximum: number): value is unknown[] { return Array.isArray(value) && value.length <= maximum && Object.keys(value).length === value.length && Array.from({ length: value.length }, (_, index) => index).every(index => Object.hasOwn(value, index)); }
function unique(values: readonly unknown[]): boolean { return new Set(values).size === values.length; }
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => equal(item, right[index]));
  return record(left) && record(right) && Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
}
function incidentId(value: unknown): value is string { return text(value) && /^border-[0-4]-[1-9]\d*$/.test(value) && integer(Number(value.split('-')[2]), 1); }
function purchaseId(value: unknown): value is string { return text(value) && /^territory-[1-9]\d*$/.test(value) && integer(Number(value.slice(10)), 1); }
function eventId(value: unknown): value is string { return text(value) && /^[1-9]\d*:(0|[1-9]\d*)$/.test(value) && integer(Number(value.split(':')[0]), 1) && integer(Number(value.split(':')[1])); }
function eventRevision(value: string): number { return Number(value.split(':')[0]); }
function precedes(first: string, second: string): boolean { const a = first.split(':').map(Number); const b = second.split(':').map(Number); return a[0]! < b[0]! || a[0] === b[0] && a[1]! < b[1]!; }
function vector(value: unknown, strategic = false): boolean { return record(value) && Object.entries(value).every(([id, amount]) => (strategic ? STRATEGIC_RESOURCE_IDS : RESOURCE_IDS).some(known => known === id) && (strategic ? integer(amount) : price(amount))); }
function pairKey(first: number, second: number): string { return `${Math.min(first, second)}:${Math.max(first, second)}`; }

export function isBorderAction(value: unknown): value is BorderAction {
  if (!record(value)) return false;
  if (value.type === 'dispatch-border') return keys(value, ['type', 'sourceCityId', 'tileId', 'people']) && text(value.sourceCityId) && integer(value.tileId) && (value.people === 2 || value.people === 3);
  if (value.type === 'respond-border') return incidentId(value.incidentId) && (value.response === 'yield' && keys(value, ['type', 'incidentId', 'response'])
    || value.response === 'defend' && keys(value, ['type', 'incidentId', 'response', 'sourceCityId', 'people']) && text(value.sourceCityId) && (value.people === 2 || value.people === 3));
  return value.type === 'withdraw-border' && keys(value, ['type', 'incidentId']) && incidentId(value.incidentId);
}

function forecast(value: unknown): value is BorderOperationForecast {
  if (!record(value) || !keys(value, ['kind', 'cityId', 'id', 'tileId', 'round', 'horizon', 'inputs', 'strategicInputs', 'residents'])
    || !text(value.cityId) || !text(value.id) || !integer(value.round) || !integer(value.horizon, 1) || !integer(value.round + value.horizon - 1)
    || !vector(value.inputs) || !vector(value.strategicInputs, true) || !integer(value.residents)) return false;
  if (value.kind === 'building') {
    const definition = BUILDINGS.find(item => item.id === value.id);
    return Boolean(definition && (value.tileId === null || integer(value.tileId)) && equal(value.inputs, definition.operatingInputs ?? {})
      && equal(value.strategicInputs, definition.strategicInputs ?? {}) && value.residents === RESIDENT_CAPACITY_RULES.perPaidRecipe);
  }
  const definition = IMPROVEMENTS.find(item => item.id === value.id);
  return value.kind === 'improvement' && integer(value.tileId) && Boolean(definition && equal(value.inputs, definition.operatingInputs ?? {}) && equal(value.strategicInputs, {}) && value.residents === definition.residentsRequired);
}

function quote(value: unknown): value is BorderDepartureQuote {
  if (!record(value) || !keys(value, ['ruleVersion', 'actorId', 'sourceCityId', 'sourceTileId', 'tileId', 'purchaseId', 'people', 'departureRound', 'returnByRound', 'pathTileIds', 'sourcePopulationBefore', 'sourcePopulationAfter', 'setup', 'cargo', 'totalCost', 'legitimacyCost', 'householdReserve', 'promised', 'promisedStrategic', 'operationForecast', 'promiseHorizon'])
    || value.ruleVersion !== 1 || !integer(value.actorId, 0, CIV_COUNT - 1) || !text(value.sourceCityId) || !integer(value.sourceTileId) || !integer(value.tileId) || value.sourceTileId === value.tileId
    || !purchaseId(value.purchaseId) || !(value.people === 2 || value.people === 3) || !integer(value.departureRound) || !integer(value.returnByRound, value.departureRound + 1, value.departureRound + BORDER_RULES.maximumFieldBeats)
    || !dense(value.pathTileIds, BORDER_RULES.maximumPathEdges + 1) || value.pathTileIds.length < 2 || !value.pathTileIds.every(id => integer(id)) || !unique(value.pathTileIds)
    || value.pathTileIds[0] !== value.sourceTileId || value.pathTileIds.at(-1) !== value.tileId
    || !integer(value.sourcePopulationBefore, BORDER_RULES.minimumHomePopulation + value.people) || !integer(value.sourcePopulationAfter, BORDER_RULES.minimumHomePopulation)
    || value.sourcePopulationAfter !== value.sourcePopulationBefore - value.people
    || !record(value.setup) || !keys(value.setup, ['materials', 'credits']) || value.setup.materials !== value.people * BORDER_RULES.setupMaterialsPerPerson || value.setup.credits !== value.people * BORDER_RULES.setupCreditsPerPerson
    || !record(value.cargo) || !keys(value.cargo, ['food']) || value.cargo.food !== value.people * BORDER_RULES.foodPerPersonPerBeat * BORDER_RULES.maximumFieldBeats
    || !record(value.totalCost) || !keys(value.totalCost, ['materials', 'credits', 'food']) || value.totalCost.materials !== value.setup.materials || value.totalCost.credits !== value.setup.credits || value.totalCost.food !== value.cargo.food
    || !(value.legitimacyCost === 0 || value.legitimacyCost === BORDER_RULES.legitimacyCost)
    || !record(value.householdReserve) || !keys(value.householdReserve, ['food']) || !price(value.householdReserve.food)
    || value.householdReserve.food < value.sourcePopulationAfter * BORDER_RULES.foodPerPersonPerBeat * BORDER_RULES.householdReserveBeats
    || !vector(value.promised) || !vector(value.promisedStrategic, true) || !integer(value.promiseHorizon, value.returnByRound - value.departureRound, Math.max(BORDER_RULES.maximumFieldBeats, KNOWLEDGE_RULES.studySeasons))
    || !integer(value.departureRound + value.promiseHorizon) || !dense(value.operationForecast, Number.MAX_SAFE_INTEGER)
    || !value.operationForecast.every(forecast)) return false;
  const forecasts = value.operationForecast; const departureRound = value.departureRound;
  return unique(forecasts.map(item => `${item.kind}:${item.cityId}:${item.id}:${item.tileId}`))
    && forecasts.every(item => item.round === departureRound + 1 && item.horizon === value.promiseHorizon)
    && forecasts.filter(item => item.cityId === value.sourceCityId).reduce((sum, item) => sum + item.residents, 0) <= value.sourcePopulationAfter - RESIDENT_CAPACITY_RULES.communityReserve
    && RESOURCE_IDS.every(id => Number((value.promised as Record<string, number>)[id] ?? 0) >= Math.round(forecasts.reduce((sum, item) => sum + (item.inputs[id] ?? 0) * item.horizon, 0) * 100) / 100)
    && STRATEGIC_RESOURCE_IDS.every(id => Number((value.promisedStrategic as Record<string, number>)[id] ?? 0) >= forecasts.reduce((sum, item) => sum + (item.strategicInputs[id] ?? 0) * item.horizon, 0));
}

function step(value: unknown): value is BorderStepReceipt {
  return record(value) && keys(value, ['round', 'fromTileId', 'toTileId', 'phase', 'people', 'foodBefore', 'foodConsumed', 'foodAfter'])
    && integer(value.round, 1) && integer(value.fromTileId) && integer(value.toTileId) && ['outbound', 'holding', 'returning'].includes(String(value.phase))
    && integer(value.people, 1, 3) && finite(value.foodBefore, 30) && value.foodConsumed === value.people * BORDER_RULES.foodPerPersonPerBeat
    && finite(value.foodAfter, 30) && value.foodAfter === value.foodBefore - value.foodConsumed;
}

function returned(value: unknown): value is BorderReturnReceipt {
  return record(value) && keys(value, ['round', 'eventId', 'sourceCityId', 'people', 'populationBefore', 'populationAfter', 'foodRefunded', 'foodStockBefore', 'foodStockAfter'])
    && integer(value.round, 1) && eventId(value.eventId) && text(value.sourceCityId) && integer(value.people, 1, 3)
    && integer(value.populationBefore, 1) && integer(value.populationAfter) && value.populationAfter === value.populationBefore + value.people
    && finite(value.foodRefunded, 30) && price(value.foodStockBefore) && price(value.foodStockAfter) && value.foodStockAfter === Math.round((value.foodStockBefore + value.foodRefunded) * 100) / 100;
}

function party(value: unknown): value is BorderParty {
  return record(value) && keys(value, ['id', 'side', 'departure', 'departureEventId', 'people', 'casualties', 'positionTileId', 'pathIndex', 'phase', 'food', 'foodConsumed', 'steps', 'returned'])
    && text(value.id) && (value.side === 'initiator' || value.side === 'defender') && quote(value.departure) && eventId(value.departureEventId)
    && integer(value.people, 1, 3) && (value.casualties === 0 || value.casualties === 1) && value.people + value.casualties === value.departure.people
    && integer(value.pathIndex, 0, value.departure.pathTileIds.length - 1) && value.positionTileId === value.departure.pathTileIds[value.pathIndex]
    && ['outbound', 'holding', 'returning', 'returned'].includes(String(value.phase)) && finite(value.food, value.departure.cargo.food) && finite(value.foodConsumed, value.departure.cargo.food)
    && dense(value.steps, BORDER_RULES.maximumFieldBeats) && value.steps.every(step) && (value.returned === null || returned(value.returned));
}

function control(value: unknown): value is BorderControlReceipt {
  return record(value) && keys(value, ['ruleVersion', 'incidentId', 'purchaseId', 'tileId', 'previousCivId', 'previousCityId', 'civId', 'cityId', 'round', 'eventId'])
    && value.ruleVersion === 1 && incidentId(value.incidentId) && purchaseId(value.purchaseId) && integer(value.tileId)
    && integer(value.previousCivId, 0, CIV_COUNT - 1) && integer(value.civId, 0, CIV_COUNT - 1) && value.previousCivId !== value.civId
    && value.incidentId.startsWith(`border-${value.civId}-`) && text(value.previousCityId) && text(value.cityId) && value.previousCityId !== value.cityId && integer(value.round) && eventId(value.eventId);
}

function clash(value: unknown): value is BorderClashReceipt {
  if (!record(value) || !keys(value, ['seedBefore', 'seedAfter', 'roll', 'initiatorPower', 'defenderPower', 'winnerId', 'casualtyCivId', 'casualties'])
    || !integer(value.seedBefore, 0, 0xffffffff) || !integer(value.seedAfter, 0, 0xffffffff) || !finite(value.roll, 1) || value.roll === 1
    || !integer(value.initiatorPower, 2, 3) || !integer(value.defenderPower, 3, 4) || !integer(value.winnerId, 0, CIV_COUNT - 1)
    || !integer(value.casualtyCivId, 0, CIV_COUNT - 1) || value.winnerId === value.casualtyCivId || value.casualties !== 1) return false;
  const draw = randomStep(value.seedBefore);
  return value.seedAfter === draw.seed && value.roll === draw.value;
}

function resolution(value: unknown): value is BorderResolution {
  return record(value) && keys(value, ['round', 'eventId', 'outcome', 'reason', 'clash', 'control']) && integer(value.round) && eventId(value.eventId)
    && ['captured', 'defended', 'withdrawn', 'cancelled'].includes(String(value.outcome)) && text(value.reason, 1000)
    && (value.clash === null || clash(value.clash)) && (value.control === null || control(value.control))
    && (value.outcome === 'captured' ? value.control !== null && value.control.round === value.round && value.control.eventId === value.eventId : value.control === null)
    && (value.outcome === 'withdrawn' || value.outcome === 'cancelled' ? value.clash === null : true);
}

function incidentShape(value: unknown): value is BorderIncident {
  return record(value) && keys(value, ['ruleVersion', 'id', 'sequence', 'initiatorId', 'defenderId', 'sourceCityId', 'defenderCityId', 'tileId', 'purchaseId', 'openedRound', 'openedRevision', 'responseDeadlineRound', 'resolveRound', 'returnByRound', 'response', 'responseRound', 'responseEventId', 'initiator', 'defender', 'resolution'])
    && value.ruleVersion === 1 && integer(value.initiatorId, 0, CIV_COUNT - 1) && integer(value.defenderId, 0, CIV_COUNT - 1) && value.initiatorId !== value.defenderId
    && integer(value.sequence, 1) && incidentId(value.id) && value.id === `border-${value.initiatorId}-${value.sequence}`
    && text(value.sourceCityId) && text(value.defenderCityId) && value.sourceCityId !== value.defenderCityId && integer(value.tileId) && purchaseId(value.purchaseId)
    && integer(value.openedRound) && integer(value.openedRevision, 1) && integer(value.responseDeadlineRound) && value.responseDeadlineRound === value.openedRound + BORDER_RULES.responseWindow
    && integer(value.resolveRound) && value.resolveRound === value.openedRound + BORDER_RULES.resolutionDelay
    && integer(value.returnByRound) && value.returnByRound === value.openedRound + BORDER_RULES.maximumFieldBeats
    && ['pending', 'defend', 'yield'].includes(String(value.response))
    && (value.response === 'pending' ? value.responseRound === null && value.responseEventId === null : integer(value.responseRound, value.openedRound, value.returnByRound) && eventId(value.responseEventId))
    && party(value.initiator) && (value.defender === null || party(value.defender)) && (value.resolution === null || resolution(value.resolution));
}

function resultShape(value: unknown): value is BorderResult {
  return record(value) && keys(value, ['incident', 'completedRound', 'eventId']) && incidentShape(value.incident) && integer(value.completedRound, value.incident.openedRound + 1, value.incident.returnByRound) && eventId(value.eventId);
}

export function validBorderEvent(value: unknown): boolean {
  if (!record(value)) return false;
  const tagged = typeof value.type === 'string' && value.type.startsWith('border-');
  if (!Object.hasOwn(value, 'border')) return !tagged;
  if (!tagged || !eventId(value.id) || !integer(value.round) || !dense(value.effects, Number.MAX_SAFE_INTEGER) || value.effects.length === 0 || !value.effects.every(effect => text(effect, 10000)) || !record(value.border)) return false;
  const payload = value.border;
  if (payload.kind === 'completed') return keys(payload, ['kind', 'result']) && resultShape(payload.result) && value.type === 'border-completed'
    && value.id === payload.result.eventId && value.round === payload.result.completedRound && value.detail === payload.result.incident.id
    && value.actor === payload.result.incident.initiatorId && value.target === payload.result.incident.defenderId && value.tileId === payload.result.incident.tileId;
  if (!incidentId(payload.incidentId) || value.detail !== payload.incidentId || value.type !== `border-${String(payload.kind)}`) return false;
  if (payload.kind === 'departure') return keys(payload, ['kind', 'incidentId', 'party']) && party(payload.party) && value.id === payload.party.departureEventId
    && value.round === payload.party.departure.departureRound && value.actor === payload.party.departure.actorId && value.tileId === payload.party.departure.sourceTileId
    && payload.party.id === `${payload.incidentId}:${payload.party.side}` && payload.party.phase === 'outbound' && payload.party.pathIndex === 0
    && payload.party.steps.length === 0 && payload.party.casualties === 0 && payload.party.food === payload.party.departure.cargo.food && payload.party.foodConsumed === 0 && payload.party.returned === null;
  if (payload.kind === 'response') return keys(payload, ['kind', 'incidentId', 'response', 'actorId', 'reason']) && (payload.response === 'defend' || payload.response === 'yield')
    && (payload.actorId === null || integer(payload.actorId, 0, CIV_COUNT - 1)) && text(payload.reason, 1000) && value.actor === payload.actorId;
  if (payload.kind === 'step') return keys(payload, ['kind', 'incidentId', 'partyId', 'step']) && (payload.partyId === `${payload.incidentId}:initiator` || payload.partyId === `${payload.incidentId}:defender`)
    && step(payload.step) && value.round === payload.step.round && value.tileId === payload.step.toTileId;
  if (payload.kind === 'resolution') return keys(payload, ['kind', 'incidentId', 'resolution']) && resolution(payload.resolution) && value.id === payload.resolution.eventId && value.round === payload.resolution.round;
  return payload.kind === 'return' && keys(payload, ['kind', 'incidentId', 'partyId', 'returned']) && (payload.partyId === `${payload.incidentId}:initiator` || payload.partyId === `${payload.incidentId}:defender`)
    && returned(payload.returned) && value.id === payload.returned.eventId && value.round === payload.returned.round && value.actor === value.target;
}

function historicalQuote(value: BorderDepartureQuote, state: WorldState): boolean {
  const source = state.cities.find(city => city.id === value.sourceCityId);
  const purchase = state.tileAcquisitions?.[String(value.tileId)];
  if (!source || source.civId !== value.actorId || source.tileId !== value.sourceTileId || !purchase || purchase.id !== value.purchaseId
    || purchase.acquiredRound > value.departureRound || value.departureRound > state.round
    || value.operationForecast.length > state.cities.length * (BUILDINGS.length + IMPROVEMENTS.length * state.tiles.length)) return false;
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  for (const [index, id] of value.pathTileIds.entries()) {
    const tile = tiles.get(id); const previous = tiles.get(value.pathTileIds[index - 1] ?? -1);
    if (!tile || tile.terrain === 'ocean' || tile.terrain === 'mountain' || index > 0 && (!previous || hexDistance(previous, tile) !== 1)) return false;
  }
  return value.operationForecast.every(item => state.cities.some(city => city.id === item.cityId && city.civId === value.actorId)
    && (item.tileId === null || tiles.has(item.tileId)));
}

function historicalControl(value: BorderControlReceipt, state: WorldState): boolean {
  const purchase = state.tileAcquisitions?.[String(value.tileId)];
  return Boolean(purchase && purchase.id === value.purchaseId && purchase.acquiredRound <= value.round && value.round <= state.round && eventRevision(value.eventId) <= state.revision
    && state.cities.some(city => city.id === value.previousCityId && city.civId === value.previousCivId)
    && state.cities.some(city => city.id === value.cityId && city.civId === value.civId)
    && !state.cities.some(city => city.tileId === value.tileId));
}

function boundParty(value: BorderParty, incident: BorderIncident, state: WorldState): boolean {
  const initiator = value.side === 'initiator'; const actor = initiator ? incident.initiatorId : incident.defenderId;
  const departure = value.departure; const resolved = incident.resolution;
  if (value.id !== `${incident.id}:${value.side}` || departure.actorId !== actor || departure.tileId !== incident.tileId || departure.purchaseId !== incident.purchaseId
    || departure.returnByRound !== incident.returnByRound || departure.legitimacyCost !== (initiator ? BORDER_RULES.legitimacyCost : 0)
    || !historicalQuote(departure, state) || eventRevision(value.departureEventId) > state.revision
    || (initiator ? departure.sourceCityId !== incident.sourceCityId || departure.departureRound !== incident.openedRound || eventRevision(value.departureEventId) !== incident.openedRevision
      : departure.sourceCityId !== incident.defenderCityId || departure.departureRound < incident.openedRound || departure.departureRound >= incident.responseDeadlineRound || !precedes(incident.initiator.departureEventId, value.departureEventId))) return false;
  const casualty = resolved?.clash?.casualtyCivId === actor ? 1 : 0;
  if (value.casualties !== casualty || value.people !== departure.people - casualty || value.steps.length > departure.returnByRound - departure.departureRound) return false;
  let returnRound = resolved ? resolved.round + (resolved.outcome === 'cancelled' ? 0 : 1) : Infinity;
  const independentReturn = !initiator && incident.response === 'yield' && incident.responseRound !== null && incident.responseEventId !== null;
  if (independentReturn) returnRound = Math.min(returnRound, incident.responseRound! + 1);
  let index = 0; let remaining = departure.cargo.food; let consumed = 0;
  for (const [number, receipt] of value.steps.entries()) {
    const round = departure.departureRound + number + 1;
    const people = departure.people - (resolved?.clash && round > resolved.round && resolved.clash.casualtyCivId === actor ? 1 : 0);
    const phase = round >= returnRound ? 'returning' : index === departure.pathTileIds.length - 1 ? 'holding' : 'outbound';
    const nextIndex = phase === 'returning' ? Math.max(0, index - 1) : phase === 'outbound' ? index + 1 : index;
    if (receipt.round !== round || receipt.round > state.round || receipt.phase !== phase || receipt.people !== people || receipt.foodBefore !== remaining
      || receipt.fromTileId !== departure.pathTileIds[index] || receipt.toTileId !== departure.pathTileIds[nextIndex]) return false;
    index = nextIndex; remaining = receipt.foodAfter; consumed += receipt.foodConsumed;
    if (phase === 'returning' && index === 0 && number !== value.steps.length - 1) return false;
  }
  const last = value.steps.at(-1); const returnedReceipt = value.returned;
  if (value.pathIndex !== index || value.foodConsumed !== consumed) return false;
  if (returnedReceipt !== null) {
    if (value.phase !== 'returned' || index !== 0 || !last || last.phase !== 'returning' || returnedReceipt.round !== last.round
      || returnedReceipt.sourceCityId !== departure.sourceCityId || returnedReceipt.people !== value.people || returnedReceipt.foodRefunded !== remaining || value.food !== 0
      || eventRevision(returnedReceipt.eventId) > state.revision || !precedes(value.departureEventId, returnedReceipt.eventId)) return false;
    if (resolved && !precedes(resolved.eventId, returnedReceipt.eventId)
      && !(independentReturn && precedes(incident.responseEventId!, returnedReceipt.eventId))) return false;
    if (!resolved && !independentReturn) return false;
    return value.foodConsumed + returnedReceipt.foodRefunded === departure.cargo.food;
  }
  if (value.phase === 'returned' || value.food !== remaining || consumed + value.food !== departure.cargo.food
    || value.steps.length !== state.round - departure.departureRound || state.round >= incident.returnByRound || last?.phase === 'returning' && index === 0) return false;
  const expectedPhase = resolved || independentReturn ? 'returning' : index === departure.pathTileIds.length - 1 ? 'holding' : 'outbound';
  return value.phase === expectedPhase;
}

function boundIncident(value: BorderIncident, state: WorldState): boolean {
  if (value.openedRound > state.round || value.openedRevision > state.revision || value.sequence > value.openedRound + 1
    || value.initiator.side !== 'initiator' || value.defender !== null && value.defender.side !== 'defender'
    || !boundParty(value.initiator, value, state) || value.defender !== null && !boundParty(value.defender, value, state)
    || !state.cities.some(city => city.id === value.defenderCityId && city.civId === value.defenderId)) return false;
  if (value.response === 'pending') {
    if (value.defender !== null || state.round >= value.responseDeadlineRound && value.resolution === null) return false;
  } else {
    if (value.responseRound! > state.round || eventRevision(value.responseEventId!) > state.revision || !precedes(value.initiator.departureEventId, value.responseEventId!)) return false;
    if (value.response === 'defend' && (value.defender === null || value.responseRound !== value.defender.departure.departureRound || value.responseRound! >= value.responseDeadlineRound
      || !precedes(value.defender.departureEventId, value.responseEventId!))) return false;
    if (value.defender !== null && !precedes(value.defender.departureEventId, value.responseEventId!)) return false;
  }
  const resolved = value.resolution;
  if (resolved === null) return state.round < value.resolveRound && value.initiator.phase !== 'returning' && value.initiator.phase !== 'returned' && value.initiator.casualties === 0 && (value.defender?.casualties ?? 0) === 0;
  if (resolved.round < value.openedRound || resolved.round > Math.min(value.resolveRound, state.round) || eventRevision(resolved.eventId) > state.revision
    || !precedes(value.initiator.departureEventId, resolved.eventId) || value.defender !== null && !precedes(value.defender.departureEventId, resolved.eventId)) return false;
  if (resolved.outcome === 'captured' || resolved.outcome === 'defended') {
    if (resolved.round !== value.resolveRound || value.initiator.steps.find(item => item.round === resolved.round)?.toTileId !== value.tileId || value.response === 'pending') return false;
    if (resolved.clash === null) {
      if (resolved.outcome !== 'captured' || value.response !== 'yield') return false;
    } else {
      const fight = resolved.clash; const defender = value.defender;
      if (!defender || value.response !== 'defend' || defender.steps.find(item => item.round === resolved.round)?.toTileId !== value.tileId
        || fight.initiatorPower !== value.initiator.departure.people || fight.defenderPower !== defender.departure.people + BORDER_RULES.defenderBonus) return false;
      const winner = fight.roll < fight.initiatorPower / (fight.initiatorPower + fight.defenderPower) ? value.initiatorId : value.defenderId;
      if (fight.winnerId !== winner || fight.casualtyCivId !== (winner === value.initiatorId ? value.defenderId : value.initiatorId)
        || resolved.outcome !== (winner === value.initiatorId ? 'captured' : 'defended')) return false;
    }
  }
  const changed = resolved.control;
  return changed === null || historicalControl(changed, state) && changed.incidentId === value.id && changed.purchaseId === value.purchaseId && changed.tileId === value.tileId
    && changed.previousCivId === value.defenderId && changed.previousCityId === value.defenderCityId && changed.civId === value.initiatorId && changed.cityId === value.sourceCityId;
}

function boundResult(value: BorderResult, state: WorldState): boolean {
  const incident = value.incident;
  if (!boundIncident(incident, state) || !incident.resolution || incident.initiator.returned === null || incident.defender !== null && incident.defender.returned === null
    || value.completedRound !== Math.max(incident.initiator.returned.round, incident.defender?.returned?.round ?? 0)
    || value.completedRound > state.round || eventRevision(value.eventId) > state.revision || !precedes(incident.resolution.eventId, value.eventId)
    || !precedes(incident.initiator.returned.eventId, value.eventId) || incident.defender?.returned && !precedes(incident.defender.returned.eventId, value.eventId)) return false;
  return true;
}

function cooldowns(value: unknown, state: WorldState, sites: boolean, extension: number): value is Record<string, number> {
  return record(value) && Object.keys(value).length <= (sites ? state.tiles.length : CIV_COUNT * (CIV_COUNT - 1) / 2)
    && Object.entries(value).every(([key, until]) => integer(until, 0, Math.min(Number.MAX_SAFE_INTEGER, state.round + extension))
      && (sites ? /^(0|[1-9]\d*)$/.test(key) && Object.hasOwn(state.tileAcquisitions ?? {}, key) : /^[0-4]:[0-4]$/.test(key) && key[0]! < key[2]!));
}

function retainedIncidentEvents(incident: BorderIncident, state: WorldState): boolean {
  for (const event of state.events) {
    const payload = event.border;
    if (!payload || payload.kind === 'completed' || payload.incidentId !== incident.id) continue;
    const member = payload.kind === 'departure' ? [incident.initiator, incident.defender].find(party => party?.id === payload.party.id)
      : payload.kind === 'step' || payload.kind === 'return' ? [incident.initiator, incident.defender].find(party => party?.id === payload.partyId) : null;
    if (payload.kind === 'departure' && (!member || !equal(payload.party.departure, member.departure) || event.id !== member.departureEventId
      || event.target !== (member.side === 'initiator' ? incident.defenderId : incident.initiatorId))) return false;
    if (payload.kind === 'step' && (!member || !member.steps.some(receipt => equal(receipt, payload.step)) || event.actor !== member.departure.actorId
      || event.target !== (member.side === 'initiator' ? incident.defenderId : incident.initiatorId))) return false;
    if (payload.kind === 'return' && (!member || !equal(member.returned, payload.returned) || event.actor !== member.departure.actorId || event.tileId !== member.departure.sourceTileId)) return false;
    if (payload.kind === 'resolution' && (!equal(incident.resolution, payload.resolution) || event.actor !== incident.initiatorId || event.target !== incident.defenderId || event.tileId !== incident.tileId)) return false;
    if (payload.kind === 'response' && (event.target !== incident.initiatorId || event.tileId !== incident.tileId || event.actor !== null && event.actor !== incident.defenderId
      || event.id === incident.responseEventId && (payload.response !== incident.response || event.round !== incident.responseRound))) return false;
  }
  for (const [id, kind] of [[incident.initiator.departureEventId, 'departure'], [incident.defender?.departureEventId, 'departure'], [incident.responseEventId, 'response'], [incident.resolution?.eventId, 'resolution'], [incident.initiator.returned?.eventId, 'return'], [incident.defender?.returned?.eventId, 'return']] as const) {
    if (id && state.events.some(event => event.id === id && (!event.border || event.border.kind !== kind || !('incidentId' in event.border) || event.border.incidentId !== incident.id))) return false;
  }
  return true;
}

export function isBorderState(value: unknown, state: WorldState): value is BorderState {
  if (!record(value) || !keys(value, ['ruleVersion', 'active', 'sequences', 'lastResults', 'controls', 'pairProtectionUntil', 'siteProtectionUntil', 'initiationCooldownUntil', 'dealCooldownUntil', 'draining'])
    || value.ruleVersion !== 1 || !dense(value.active, Math.floor(CIV_COUNT / 2)) || !value.active.every(incidentShape)
    || !dense(value.sequences, CIV_COUNT) || value.sequences.length !== CIV_COUNT || !value.sequences.every(item => integer(item, 0, state.round + 1))
    || !dense(value.lastResults, BORDER_RULES.maximumResults) || !value.lastResults.every(resultShape)
    || !record(value.controls) || Object.keys(value.controls).length > state.tiles.length || !Object.values(value.controls).every(control)
    || !cooldowns(value.pairProtectionUntil, state, false, BORDER_RULES.protectionBeats) || !cooldowns(value.siteProtectionUntil, state, true, BORDER_RULES.protectionBeats)
    || !cooldowns(value.dealCooldownUntil, state, false, BORDER_RULES.dealCooldownAfterCompletion)
    || !dense(value.initiationCooldownUntil, CIV_COUNT) || value.initiationCooldownUntil.length !== CIV_COUNT || !value.initiationCooldownUntil.every(item => integer(item, 0, state.round + BORDER_RULES.initiationCooldownAfterReturn))) return false;
  const active = value.active; const results = value.lastResults; const sequences = value.sequences; const controls = value.controls as Record<string, BorderControlReceipt>;
  const participants = active.flatMap(incident => [incident.initiatorId, incident.defenderId]);
  if (!unique(participants) || !unique(active.map(incident => incident.id)) || !unique(results.map(result => result.incident.id)) || !unique(results.map(result => result.eventId))
    || active.some(incident => results.some(result => result.incident.id === incident.id)) || active.some(incident => !boundIncident(incident, state) || incident.sequence !== sequences[incident.initiatorId]
      || incident.initiator.returned !== null && (incident.defender === null || incident.defender.returned !== null)) || results.some(result => !boundResult(result, state) || result.incident.sequence > (sequences[result.incident.initiatorId] ?? -1))) return false;
  const historical = state.events.flatMap(event => event.border?.kind === 'completed' && resultShape(event.border.result) ? [event.border.result.incident] : []);
  const incidents = [...active, ...results.map(result => result.incident)];
  const known = new Map([...historical, ...incidents].map(incident => [incident.id, incident]));
  for (const incident of known.values()) if (!boundIncident(incident, state) || !retainedIncidentEvents(incident, state)) return false;
  for (const city of state.cities) {
    const reservation = active.flatMap(incident => incident.defender ? [incident.initiator, incident.defender] : [incident.initiator]).reduce((sum, party) => sum + (party.departure.sourceCityId === city.id && party.returned === null ? party.people : 0), 0);
    if (reservation && (!city.housing || city.population + reservation > cityGrowthFacts(state, city).capacity)) return false;
  }
  for (const incident of incidents) {
    if (!retainedIncidentEvents(incident, state)) return false;
    const resolved = incident.resolution; const pair = pairKey(incident.initiatorId, incident.defenderId);
    if (resolved && ((value.pairProtectionUntil[pair] ?? -1) < resolved.round + BORDER_RULES.protectionBeats || (value.siteProtectionUntil[String(incident.tileId)] ?? -1) < resolved.round + BORDER_RULES.protectionBeats)) return false;
    if (incident.initiator.returned && Number(value.initiationCooldownUntil[incident.initiatorId]) < incident.initiator.returned.round + BORDER_RULES.initiationCooldownAfterReturn) return false;
  }
  for (const [key, receipt] of Object.entries(controls)) {
    if (key !== String(receipt.tileId) || !historicalControl(receipt, state) || state.tiles.find(tile => tile.id === receipt.tileId)?.owner !== receipt.civId) return false;
    const known = incidents.find(incident => incident.id === receipt.incidentId);
    if (known && !equal(known.resolution?.control, receipt)) return false;
    const event = state.events.find(event => event.id === receipt.eventId);
    if (event && (event.border?.kind !== 'resolution' || !equal(event.border.resolution.control, receipt))) return false;
  }
  for (const incident of incidents) {
    const captured = incident.resolution?.control; const current = controls[String(incident.tileId)];
    if (captured && (!current || current.eventId === captured.eventId && !equal(current, captured) || precedes(current.eventId, captured.eventId))) return false;
  }
  for (const result of results) {
    if ((value.dealCooldownUntil[pairKey(result.incident.initiatorId, result.incident.defenderId)] ?? -1) < result.completedRound + BORDER_RULES.dealCooldownAfterCompletion) return false;
    const event = state.events.find(event => event.id === result.eventId);
    if (event && (event.border?.kind !== 'completed' || !equal(event.border.result, result))) return false;
  }
  const retainedCompleted = new Set<string>(); const retainedTransitions = new Set<string>(); let previousBorderEvent: string | null = null;
  for (const event of state.events) {
    if (!validBorderEvent(event)) return false;
    const payload = event.border;
    if (!payload) continue;
    if (event.round > state.round || eventRevision(event.id) > state.revision || previousBorderEvent !== null && !precedes(previousBorderEvent, event.id)) return false;
    previousBorderEvent = event.id;
    if (payload.kind === 'completed') {
      if (!boundResult(payload.result, state) || retainedCompleted.has(payload.result.incident.id) || payload.result.incident.sequence > Number(sequences[payload.result.incident.initiatorId])
        || active.some(incident => incident.id === payload.result.incident.id)) return false;
      retainedCompleted.add(payload.result.incident.id);
      const latest = results.find(result => result.incident.id === payload.result.incident.id);
      if (latest && !equal(latest, payload.result)) return false;
    } else {
      if (!known.has(payload.incidentId)) return false;
      const key = payload.kind === 'step' ? `${payload.incidentId}:${payload.partyId}:step:${payload.step.round}` : payload.kind === 'departure' ? `${payload.incidentId}:${payload.party.id}:departure`
        : payload.kind === 'return' ? `${payload.incidentId}:${payload.partyId}:return` : payload.kind === 'resolution' ? `${payload.incidentId}:resolution` : null;
      if (key !== null && retainedTransitions.has(key)) return false;
      if (key !== null) retainedTransitions.add(key);
    }
  }
  if (value.draining !== null) {
    const drain = value.draining;
    if (!record(drain) || !keys(drain, ['round', 'candidate']) || !integer(drain.round, 0, state.round) || !record(drain.candidate)
      || !keys(drain.candidate, ['kind', 'winners', 'round', 'reason']) || drain.candidate.kind !== 'mars' || drain.candidate.round !== drain.round
      || !dense(drain.candidate.winners, CIV_COUNT) || drain.candidate.winners.length === 0 || !unique(drain.candidate.winners)
      || !drain.candidate.winners.every(id => integer(id, 0, CIV_COUNT - 1)) || !text(drain.candidate.reason, 1000) || state.outcome !== null || active.length === 0) return false;
  }
  return state.outcome === null || active.length === 0;
}
