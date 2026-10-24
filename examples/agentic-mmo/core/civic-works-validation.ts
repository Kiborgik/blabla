import { BUILDINGS, CONSTRUCTION_RULES, FOCUS_IDS, GOVERNMENTS, POLICIES, RESIDENT_CAPACITY_RULES } from './content.ts';
import { CIVIC_WORKS_RULES, civicWorksTargetTile } from './civic-works-content.ts';
import type { CivicWorksAction, CivicWorksCommission, CivicWorksReceipt, CivicWorksState } from './civic-works-types.ts';
import { CIV_COUNT, type WorldState } from './types.ts';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, names: readonly string[]): boolean { return Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)); }
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max; }
function amount(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.round(value * 100) / 100 === value; }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 1000; }
function dense(value: unknown): value is unknown[] { return Array.isArray(value) && Object.keys(value).length === value.length && Array.from(value).every((_, index) => Object.hasOwn(value, index)); }
function empty(value: unknown): boolean { return record(value) && Object.keys(value).length === 0; }
function same(left: unknown, right: unknown): boolean { return left === right || record(left) && record(right) && Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && same(left[key], right[key])); }
function revision(value: unknown, prefix: string): number | null { if (typeof value !== 'string' || !value.startsWith(prefix)) return null; const suffix = value.slice(prefix.length); if (!/^[1-9]\d*$/.test(suffix)) return null; const n = Number(suffix); return integer(n, 1) ? n : null; }
function eventRevision(value: unknown): number | null { if (typeof value !== 'string' || !/^[1-9]\d*:(0|[1-9]\d*)$/.test(value)) return null; const n = Number(value.split(':')[0]); return integer(n, 1) ? n : null; }

export function isCivicWorksAction(value: unknown): value is CivicWorksAction {
  return record(value) && keys(value, ['type', 'cityId', 'orderId', 'donorBuildingId']) && value.type === 'commission-civic-works'
    && text(value.cityId) && value.cityId.length <= 128 && revision(value.orderId, 'construction-') !== null && value.donorBuildingId === 'kiln';
}

function residents(value: unknown): boolean {
  return record(value) && keys(value, ['ruleVersion', 'openingPopulation', 'communityReserve', 'required', 'available', 'allocated'])
    && value.ruleVersion === RESIDENT_CAPACITY_RULES.ruleVersion && integer(value.openingPopulation, 1)
    && value.communityReserve === RESIDENT_CAPACITY_RULES.communityReserve && value.required === CIVIC_WORKS_RULES.residents
    && value.allocated === CIVIC_WORKS_RULES.residents && integer(value.available, CIVIC_WORKS_RULES.residents, Math.max(0, value.openingPopulation - RESIDENT_CAPACITY_RULES.communityReserve));
}

export function isCivicWorksOperation(value: unknown, buildingId: string, features: readonly string[], round: number): boolean {
  return features.includes(CIVIC_WORKS_RULES.featureId) && features.includes('resident-capacity') && buildingId === 'kiln'
    && record(value) && keys(value, ['round', 'status', 'paid', 'produced', 'shortages', 'residents', 'civicWorksCommissionId'])
    && value.status === 'civic-works' && integer(value.round, 1, round) && revision(value.civicWorksCommissionId, 'civic-works-') !== null
    && empty(value.paid) && empty(value.produced) && dense(value.shortages) && value.shortages.length === 0 && residents(value.residents);
}

export function isCivicWorksReceipt(value: unknown): value is CivicWorksReceipt {
  if (!record(value) || !keys(value, ['ruleVersion', 'commissionId', 'civId', 'cityId', 'orderId', 'buildingId', 'targetTileId', 'donorBuildingId', 'firstRound', 'expiresRound', 'acceptedEventId', 'round', 'eventId', 'status', 'reason', 'paid', 'residents', 'workBasis', 'ordinaryWork', 'extraWork', 'workBefore', 'workRequired', 'terminal'])
    || value.ruleVersion !== CIVIC_WORKS_RULES.ruleVersion || !integer(value.civId, 0, CIV_COUNT - 1) || !text(value.cityId)
    || revision(value.orderId, 'construction-') === null || !BUILDINGS.some(building => building.id === value.buildingId)
    || !integer(value.targetTileId) || value.donorBuildingId !== 'kiln' || !integer(value.firstRound, 1)
    || !integer(value.expiresRound, value.firstRound) || value.expiresRound !== value.firstRound + CIVIC_WORKS_RULES.durationBeats - 1 || !integer(value.round, value.firstRound)
    || !text(value.reason) || !amount(value.ordinaryWork) || !amount(value.extraWork) || !amount(value.workBefore) || !amount(value.workRequired)
    || value.workBefore > value.workRequired || Math.round((value.workBefore + value.ordinaryWork + value.extraWork) * 100) > Math.round(value.workRequired * 100)
    || !['order-completed', 'order-lost', 'expired', null].includes(value.terminal as string | null)) return false;
  const accepted = revision(value.commissionId, 'civic-works-'); const current = eventRevision(value.eventId);
  if (accepted === null || eventRevision(value.acceptedEventId) !== accepted || current === null || current < accepted) return false;
  if (value.terminal === 'expired' && value.round < Number(value.expiresRound)
    || value.terminal === 'order-lost' && value.status !== 'ended'
    || value.terminal === 'order-completed' && value.status !== 'worked' && value.status !== 'ended'
    || value.terminal === 'order-completed' && (value.workRequired <= 0 || Math.round((value.workBefore + value.ordinaryWork + value.extraWork) * 100) !== Math.round(value.workRequired * 100))) return false;
  if (value.workBasis === null) {
    if (value.terminal !== 'order-lost' || value.workBefore !== 0 || value.workRequired !== 0 || value.ordinaryWork !== 0 || value.extraWork !== 0) return false;
  } else {
    const basis = value.workBasis;
    if (!record(basis) || !keys(basis, ['wellbeing', 'damage', 'infrastructure', 'focus', 'governmentWork', 'capitalPercent'])
      || !amount(basis.wellbeing) || basis.wellbeing > 100 || !amount(basis.damage) || basis.damage > 100 || !amount(basis.infrastructure)
      || !FOCUS_IDS.some(focus => focus === basis.focus) || ![0, ...POLICIES.map(policy => policy.constructionWork)].includes(basis.governmentWork as number)
      || ![0, ...GOVERNMENTS.map(government => government.capitalConstructionWorkPercent ?? 0)].includes(basis.capitalPercent as number)
      || basis.capitalPercent !== 0 && value.cityId !== `city-${value.civId}`) return false;
    const multiplier = (0.5 + basis.wellbeing / 100) * (1 - basis.damage / 100) * (1 + basis.infrastructure / 10) * (1 + Number(basis.capitalPercent) / 100);
    const capacity = Math.round(((basis.focus === 'industry' ? CONSTRUCTION_RULES.industryWork : CONSTRUCTION_RULES.baseWork) + Number(basis.governmentWork)) * multiplier * 100) / 100;
    const ordinary = Math.round(Math.min(value.workRequired - value.workBefore, capacity) * 100) / 100;
    if (value.ordinaryWork !== ordinary) return false;
    const extra = Math.min(Math.round((value.workRequired - value.workBefore - ordinary) * 100) / 100, Math.round(CIVIC_WORKS_RULES.extraBaseWork * multiplier * 100) / 100);
    if (value.status === 'worked' && value.extraWork !== extra) return false;
  }
  if (value.status === 'worked') return value.round <= value.expiresRound && value.extraWork > 0 && value.ordinaryWork > 0
    && record(value.paid) && keys(value.paid, ['materials', 'credits']) && value.paid.materials === CIVIC_WORKS_RULES.perBeatCost.materials && value.paid.credits === CIVIC_WORKS_RULES.perBeatCost.credits
    && residents(value.residents) && value.terminal !== 'order-lost';
  return (value.status === 'blocked' || value.status === 'ended') && empty(value.paid) && value.residents === null && value.extraWork === 0
    && (value.terminal !== 'order-lost' || value.workBefore === 0 && value.workRequired === 0 && value.ordinaryWork === 0)
    && (value.status !== 'ended' || value.terminal !== null);
}

export function validCivicWorksEvent(value: Record<string, unknown>): boolean {
  const types = ['civic-works-worked', 'civic-works-blocked', 'civic-works-ended'];
  if (!Object.hasOwn(value, 'civicWorks')) return !types.includes(String(value.type));
  const receipt = value.civicWorks;
  return isCivicWorksReceipt(receipt) && value.id === receipt.eventId && value.detail === receipt.commissionId && value.round === receipt.round
    && value.actor === receipt.civId && value.target === receipt.civId && value.tileId === receipt.targetTileId && value.type === `civic-works-${receipt.status}`;
}

function commission(value: unknown, world: WorldState): value is CivicWorksCommission {
  if (!record(value) || !keys(value, ['id', 'civId', 'cityId', 'orderId', 'buildingId', 'targetTileId', 'donorBuildingId', 'acceptedRound', 'firstRound', 'expiresRound', 'acceptedEventId'])
    || !integer(value.civId, 0, CIV_COUNT - 1) || !text(value.cityId) || !integer(value.targetTileId, 0, world.tiles.length - 1)
    || value.donorBuildingId !== 'kiln' || !integer(value.acceptedRound, 0, world.round) || value.firstRound !== value.acceptedRound + 1
    || value.expiresRound !== value.acceptedRound + CIVIC_WORKS_RULES.durationBeats || Number(value.expiresRound) <= world.round) return false;
  const accepted = revision(value.id, 'civic-works-');
  if (accepted === null || accepted > world.revision || eventRevision(value.acceptedEventId) !== accepted) return false;
  const city = world.cities.find(city => city.id === value.cityId && city.civId === value.civId); const order = city?.construction?.active;
  if (!city || !order || 'kind' in order || order.id !== value.orderId || order.buildingId !== value.buildingId || civicWorksTargetTile(city, order) !== value.targetTileId) return false;
  const event = world.events.find(event => event.id === value.acceptedEventId);
  return !event || event.type === 'civic-works-accepted' && event.detail === value.id && event.actor === value.civId && event.target === value.civId && event.tileId === value.targetTileId && event.round === value.acceptedRound
    && event.effects[0] === `City ${value.cityId}; order ${value.orderId}; donor ${value.donorBuildingId}`;
}

export function isCivicWorksState(value: unknown, world: WorldState): value is CivicWorksState {
  if (!record(value) || !keys(value, ['ruleVersion', 'active', 'lastResults']) || value.ruleVersion !== CIVIC_WORKS_RULES.ruleVersion
    || !dense(value.active) || value.active.length > CIV_COUNT || !value.active.every(entry => commission(entry, world))
    || new Set(value.active.map(entry => entry.civId)).size !== value.active.length || new Set(value.active.map(entry => entry.id)).size !== value.active.length
    || !dense(value.lastResults) || value.lastResults.length !== CIV_COUNT) return false;
  for (const [civId, last] of value.lastResults.entries()) {
    if (last === null) continue;
    if (!isCivicWorksReceipt(last) || last.civId !== civId || last.round > world.round || eventRevision(last.eventId)! > world.revision
      || !world.cities.some(city => city.id === last.cityId && city.civId === civId) || last.targetTileId >= world.tiles.length) return false;
    const retained = world.events.find(event => event.id === last.eventId);
    if (retained && !same(retained.civicWorks, last)) return false;
    const accepted = world.events.find(event => event.id === last.acceptedEventId);
    if (accepted && (accepted.type !== 'civic-works-accepted' || accepted.detail !== last.commissionId || accepted.actor !== civId || accepted.target !== civId || accepted.tileId !== last.targetTileId || accepted.round !== last.firstRound - 1
      || accepted.effects[0] !== `City ${last.cityId}; order ${last.orderId}; donor ${last.donorBuildingId}`)) return false;
    const active = value.active.find(entry => entry.id === last.commissionId);
    const city = world.cities.find(city => city.id === last.cityId)!;
    const order = city.construction?.active;
    if (active) {
      if (last.terminal !== null || active.civId !== last.civId || active.cityId !== last.cityId || active.orderId !== last.orderId
        || active.buildingId !== last.buildingId || active.targetTileId !== last.targetTileId || active.donorBuildingId !== last.donorBuildingId
        || active.firstRound !== last.firstRound || active.expiresRound !== last.expiresRound || active.acceptedEventId !== last.acceptedEventId
        || !order || order.workRequired !== last.workRequired || order.workDone !== Math.round((last.workBefore + last.ordinaryWork + last.extraWork) * 100) / 100) return false;
    } else if (last.terminal === null) return false;
    if (last.terminal === 'expired' && last.round === world.round
      && (!order || 'kind' in order || order.id !== last.orderId || order.buildingId !== last.buildingId
        || civicWorksTargetTile(city, order) !== last.targetTileId || order.workRequired !== last.workRequired
        || order.workDone !== Math.round((last.workBefore + last.ordinaryWork + last.extraWork) * 100) / 100)) return false;
    if (last.terminal === 'expired' && order && !('kind' in order) && order.id === last.orderId
      && (order.buildingId !== last.buildingId || civicWorksTargetTile(city, order) !== last.targetTileId || order.workRequired !== last.workRequired
        || order.workDone < Math.round((last.workBefore + last.ordinaryWork + last.extraWork) * 100) / 100)) return false;
    const completion = city.construction?.lastCompleted;
    if (last.terminal === 'order-completed' && (completion?.orderId === last.orderId || last.round === world.round)
      && (!completion || 'kind' in completion || completion.orderId !== last.orderId || completion.buildingId !== last.buildingId
        || completion.completedRound !== last.round || completion.workRequired !== last.workRequired
        || civicWorksTargetTile(city, { ...completion, id: completion.orderId, ruleVersion: 1, workDone: completion.workRequired }) !== last.targetTileId)) return false;
    if (last.status === 'worked' && last.round === world.round) {
      const operation = city.buildingOperations?.kiln?.lastResult;
      if (!isCivicWorksOperation(operation, 'kiln', world.unlockedFeatures, world.round) || operation?.round !== last.round
        || operation.civicWorksCommissionId !== last.commissionId || !same(operation.residents, last.residents)) return false;
    }
  }
  for (const event of world.events) {
    if (!Object.hasOwn(event, 'civicWorks')) continue;
    const receipt = event.civicWorks;
    if (!isCivicWorksReceipt(receipt) || event.id !== receipt.eventId || event.detail !== receipt.commissionId || event.round !== receipt.round || event.actor !== receipt.civId || event.target !== receipt.civId
      || event.tileId !== receipt.targetTileId || event.type !== `civic-works-${receipt.status}` || eventRevision(receipt.eventId)! > world.revision) return false;
  }
  for (const city of world.cities) for (const [buildingId, operation] of Object.entries(city.buildingOperations ?? {})) {
    const receipt = operation.lastResult;
    if (!receipt || receipt.status !== 'civic-works') { if (receipt && Object.hasOwn(receipt, 'civicWorksCommissionId')) return false; continue; }
    const last = value.lastResults[city.civId];
    if (buildingId !== 'kiln' || !isCivicWorksReceipt(last) || last.status !== 'worked' || last.cityId !== city.id || last.round !== receipt.round
      || last.commissionId !== receipt.civicWorksCommissionId || !same(last.residents, receipt.residents)) return false;
  }
  return true;
}
