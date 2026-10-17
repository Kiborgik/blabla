import { TERRITORY_RULES } from '../content.ts';
import type { ActionOption, City, GameEvent, HexTile, TileAcquisitionQuote, TileAcquisitionReceipt, TerritoryObservation, WorldState } from '../types.ts';
import { districtSiteOccupied } from './districts.ts';
import { emitEvent } from './events.ts';
import { hexDistance } from './geography.ts';
import { hasFeatures } from './history.ts';
import { purchasedSiteBlock } from './site-binding.ts';
import { transferCost } from './world.ts';

const offsets = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;

export interface TerritoryAssessment { quote: TileAcquisitionQuote | null; blocker: string | null }

export function createTerritoryPlanner(state: WorldState) {
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const coordinates = new Map(state.tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
  const centers = new Set(state.cities.map(city => city.tileId));
  const trees = new Map<string, Map<number, number[]>>();
  const counts = new Map<number, number>();
  for (const receipt of Object.values(state.tileAcquisitions ?? {})) counts.set(receipt.civId, (counts.get(receipt.civId) ?? 0) + 1);
  const work = { trees: 0, visitedTiles: 0 };
  const nearby = (city: City): HexTile[] => {
    const center = tiles.get(city.tileId); if (!center) return [];
    const result: HexTile[] = [];
    for (let q = -TERRITORY_RULES.range; q <= TERRITORY_RULES.range; q++) for (let r = -TERRITORY_RULES.range; r <= TERRITORY_RULES.range; r++) {
      const tile = coordinates.get(`${center.q + q},${center.r + r}`);
      if (tile && hexDistance(center, tile) <= TERRITORY_RULES.range) result.push(tile);
    }
    return result.toSorted((left, right) => left.id - right.id);
  };
  const paths = (city: City): Map<number, number[]> => {
    const existing = trees.get(city.id); if (existing) return existing;
    const result = new Map<number, number[]>(); trees.set(city.id, result); work.trees++;
    const center = tiles.get(city.tileId); if (!center || center.owner !== city.civId) return result;
    result.set(center.id, [center.id]); const queue = [center];
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index]; if (!current) continue; work.visitedTiles++;
      const path = result.get(current.id); if (!path) continue;
      const neighbors = offsets.flatMap(([q, r]) => { const tile = coordinates.get(`${current.q + q},${current.r + r}`); return tile ? [tile] : []; }).toSorted((left, right) => left.id - right.id);
      for (const tile of neighbors) {
        if (result.has(tile.id) || hexDistance(center, tile) > TERRITORY_RULES.range || centers.has(tile.id)) continue;
        if (tile.owner !== null && (tile.owner !== city.civId || purchasedSiteBlock(state, city, tile.id))) continue;
        result.set(tile.id, [...path, tile.id]);
        if (tile.owner === city.civId) queue.push(tile);
      }
    }
    return result;
  };
  const assess = (civId: number, cityId: string, tileId: number): TerritoryAssessment => {
    if (!hasFeatures(state, [TERRITORY_RULES.featureId])) return { quote: null, blocker: 'Owned territory acquisition is not released' };
    const civilization = state.civilizations.find(candidate => candidate.id === civId);
    const city = state.cities.find(candidate => candidate.id === cityId && candidate.civId === civId);
    if (!city || !civilization) return { quote: null, blocker: 'Acquisition requires the exact existing owned town' };
    const center = tiles.get(city.tileId); const tile = tiles.get(tileId);
    if (!Number.isSafeInteger(tileId) || !tile || !center) return { quote: null, blocker: 'The exact acquisition tile is missing' };
    if (tile.owner !== null) return { quote: null, blocker: 'Only currently unowned land can be acquired' };
    if (tile.terrain === 'ocean' || tile.terrain === 'mountain') return { quote: null, blocker: 'Acquisition requires buildable land' };
    if (centers.has(tile.id) || districtSiteOccupied(state, tile.id)) return { quote: null, blocker: 'A town or completed or reserved asset occupies the tile' };
    const distance = hexDistance(center, tile);
    if (distance < 1 || distance > TERRITORY_RULES.range) return { quote: null, blocker: `Acquisition must be within ${TERRITORY_RULES.range} hexes of the named town` };
    const pathTileIds = paths(city).get(tile.id);
    if (!pathTileIds) return { quote: null, blocker: 'The tile is disconnected from this town’s eligible owned territory' };
    const priorCivilizationPurchases = counts.get(civId) ?? 0;
    const credits = TERRITORY_RULES.baseCredits + TERRITORY_RULES.creditsPerDistance * (distance - 1) + TERRITORY_RULES.creditsPerPriorPurchase * priorCivilizationPurchases;
    const quote: TileAcquisitionQuote = { ruleVersion: TERRITORY_RULES.ruleVersion, cityId, civId, cityTileId: city.tileId, tileId, pathTileIds: [...pathTileIds], distance, priorCivilizationPurchases, paid: { credits } };
    return { quote, blocker: civilization.resources.credits < credits ? `Acquisition requires ${credits} Credits; available ${civilization.resources.credits}` : null };
  };
  return { assess, nearby, work };
}

export function availableTerritoryActions(state: WorldState, civId: number): ActionOption[] {
  if (!hasFeatures(state, [TERRITORY_RULES.featureId])) return [];
  const planner = createTerritoryPlanner(state); const choices: ActionOption[] = [];
  for (const city of state.cities.filter(candidate => candidate.civId === civId)) for (const tile of planner.nearby(city)) {
    const { quote, blocker } = planner.assess(civId, city.id, tile.id); if (!quote || blocker) continue;
    choices.push({ action: { type: 'acquire-tile', cityId: city.id, tileId: tile.id }, label: `${city.name}: acquire tile ${tile.id}`, reason: `Pay ${quote.paid.credits} Credits once; exact town path ${quote.pathTileIds.join(' → ')}. Ownership opens only separately eligible paid work; no immediate output or residents.`, territoryQuote: quote });
  }
  return choices;
}

export function observedTerritory(state: WorldState, civId: number, selectedCityId?: string | null): TerritoryObservation {
  const planner = createTerritoryPlanner(state);
  const purchases = structuredClone(Object.values(state.tileAcquisitions ?? {}).filter(receipt => receipt.civId === civId && (selectedCityId === undefined || receipt.cityId === selectedCityId)).toSorted((left, right) => left.tileId - right.tileId));
  const cities = state.cities.filter(city => city.civId === civId && (selectedCityId === undefined || city.id === selectedCityId)).map(city => {
    const available: TileAcquisitionQuote[] = []; const blocked: Array<{ tileId: number; reason: string }> = [];
    for (const tile of planner.nearby(city)) {
      if (tile.id === city.tileId || tile.owner !== null) continue;
      const { quote, blocker } = planner.assess(civId, city.id, tile.id);
      if (blocker) blocked.push({ tileId: tile.id, reason: blocker }); else if (quote) available.push(quote);
    }
    return { cityId: city.id, available, blocked };
  });
  return { purchases, cities };
}

export function executeTerritoryAcquisition(state: WorldState, civId: number, cityId: string, tileId: number, events: GameEvent[]): void {
  const { quote, blocker } = createTerritoryPlanner(state).assess(civId, cityId, tileId);
  if (!quote || blocker) throw new RangeError(blocker ?? 'Acquisition requires an exact current quote');
  const civilization = state.civilizations.find(candidate => candidate.id === civId); const tile = state.tiles.find(candidate => candidate.id === tileId);
  if (!civilization || !tile || !state.tileAcquisitions) throw new RangeError('Acquisition requires the adopted registry and exact current parties');
  transferCost(civilization.resources, quote.paid); tile.owner = civId;
  const event = emitEvent(state, events, { type: 'territory-acquired', title: `${state.cities.find(city => city.id === cityId)?.name ?? cityId} acquires land`, detail: `${cityId}/${tileId}`, actor: civId, target: civId, tileId, cause: 'The actor explicitly purchased connected unowned land for this exact town', effects: [`Paid ${quote.paid.credits} Credits`, `Tile ${tileId} is bound to town ${cityId}`, 'No construction, resident transfer or output occurs at acquisition'], importance: 3 });
  const receipt: TileAcquisitionReceipt = { ...quote, id: `territory-${state.revision}`, acquiredRound: state.round, eventId: event.id };
  state.tileAcquisitions[String(tileId)] = receipt; event.territoryAcquisition = structuredClone(receipt);
}
