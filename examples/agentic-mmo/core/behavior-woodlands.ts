import { IMPROVEMENTS } from './content.ts';
import { hasFeatures } from './simulation/history.ts';
import { isWoodlandImprovement } from './simulation/woodlands.ts';
import type { CityImprovement, GameAction, WorldState } from './types.ts';
import { WOODLAND_RULES } from './woodland-content.ts';

function openingStock(state: WorldState, tileId: number): number | null {
  if (!Number.isSafeInteger(tileId) || tileId < 0 || !Number.isSafeInteger(state.round) || state.round < 0 || state.tiles.find(tile => tile.id === tileId)?.terrain !== 'forest') return null;
  const layer = state.woodlands;
  if (!layer || layer.ruleVersion !== WOODLAND_RULES.ruleVersion || layer.profileId !== WOODLAND_RULES.profileId || !layer.stands || typeof layer.stands !== 'object' || Array.isArray(layer.stands) || !Object.hasOwn(layer.stands, String(tileId))) return null;
  const stand = layer.stands[String(tileId)];
  if (!stand || typeof stand !== 'object' || Array.isArray(stand) || !Number.isSafeInteger(stand.stock) || stand.stock < 0 || stand.stock > WOODLAND_RULES.capacity || stand.lastHarvestRound !== null && (!Number.isSafeInteger(stand.lastHarvestRound) || stand.lastHarvestRound < 1 || stand.lastHarvestRound > state.round)) return null;
  return stand.stock;
}

function exactSite(state: WorldState, civId: number, cityId: string, tileId: number): CityImprovement | null {
  const city = state.cities.find(city => city.id === cityId && city.civId === civId);
  const site = city?.improvements?.[String(tileId)];
  if (!site || !isWoodlandImprovement(site.improvementId) || site.tileId !== tileId || typeof site.operation?.enabled !== 'boolean' || state.tiles.find(tile => tile.id === tileId)?.owner !== civId) return null;
  const completion = site.completion;
  if (!completion || completion.kind !== 'improvement' || completion.cityId !== cityId || completion.tileId !== tileId || completion.improvementId !== site.improvementId || typeof completion.orderId !== 'string' || completion.orderId.length === 0 || !Number.isSafeInteger(completion.completedRound) || completion.completedRound < 0 || completion.completedRound > state.round) return null;
  return site;
}

function promisedByBorder(state: WorldState, civId: number, cityId: string, site: CityImprovement): boolean {
  return (state.border?.active ?? []).some(incident => (incident.defender ? [incident.initiator, incident.defender] : [incident.initiator]).some(party => party.departure.actorId === civId && party.returned === null && party.departure.operationForecast.some(operation => operation.kind === 'improvement' && operation.cityId === cityId && operation.id === site.improvementId && operation.tileId === site.tileId)));
}

export function woodlandOperationCapacity(state: WorldState, improvementId: string, tileId: number, horizon: number): number {
  if (!Number.isSafeInteger(horizon) || horizon < 1 || !IMPROVEMENTS.some(definition => definition.id === improvementId)) return 0;
  if (!hasFeatures(state, [WOODLAND_RULES.featureId]) || !isWoodlandImprovement(improvementId)) return horizon;
  if (!Number.isSafeInteger(state.round + horizon)) return 0;
  const stock = openingStock(state, tileId);
  return stock === null ? 0 : Math.min(horizon, Math.floor(stock / WOODLAND_RULES.lotsPerOperation));
}

export function woodlandContinuousCapacity(state: WorldState, improvementId: string, tileId: number, horizon: number): boolean {
  return Number.isSafeInteger(horizon) && horizon >= 1 && woodlandOperationCapacity(state, improvementId, tileId, horizon) === horizon;
}

export function woodlandOperationDesired(state: WorldState, civId: number, cityId: string, tileId: number, economicDesired: boolean): boolean {
  if (!hasFeatures(state, [WOODLAND_RULES.featureId])) return economicDesired;
  const installed = state.cities.find(city => city.id === cityId && city.civId === civId)?.improvements?.[String(tileId)];
  if (installed && IMPROVEMENTS.some(definition => definition.id === installed.improvementId) && !isWoodlandImprovement(installed.improvementId)) return economicDesired;
  const site = exactSite(state, civId, cityId, tileId);
  if (!site) return false;
  const stock = openingStock(state, tileId);
  if (stock === null) return false;
  if (stock < WOODLAND_RULES.lotsPerOperation) return site.operation.enabled;
  return promisedByBorder(state, civId, cityId, site) || economicDesired;
}

export function woodlandOperationAllowed(state: WorldState, civId: number, action: Extract<GameAction, { type: 'set-improvement-operation' }>, economicDesired: boolean): boolean {
  if (!hasFeatures(state, [WOODLAND_RULES.featureId])) return true;
  if (!IMPROVEMENTS.some(definition => definition.id === action.improvementId)) return false;
  if (!isWoodlandImprovement(action.improvementId)) return true;
  const site = exactSite(state, civId, action.cityId, action.tileId);
  if (!site || site.improvementId !== action.improvementId || openingStock(state, action.tileId) === null) return false;
  return action.enabled !== site.operation.enabled && action.enabled === woodlandOperationDesired(state, civId, action.cityId, action.tileId, economicDesired);
}
