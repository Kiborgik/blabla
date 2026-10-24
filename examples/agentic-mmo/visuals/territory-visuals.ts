import type { BorderControlReceipt } from '../core/border-types.ts';
import { IMPROVEMENTS } from '../core/content.ts';
import { isImprovementOrder } from '../core/simulation/improvements.ts';
import { mapTileHeight } from './route-paths.ts';
import type { CapabilityProjection } from '../core/capabilities.ts';
import type { CityImprovement, ImprovementConstructionOrder, Terrain, TileAcquisitionQuote, TileAcquisitionReceipt, WorldState } from '../core/types.ts';

export interface TerritoryPoint { tileId: number; q: number; r: number; height: number }
export interface AcquiredLandView {
  receipt: TileAcquisitionReceipt;
  point: TerritoryPoint | null;
  currentOwner: number | null;
  control?: BorderControlReceipt;
  townName: string | null;
}
export const TERRITORY_PAGE_SIZE = 6;
export const TERRITORY_OUTLINE_LIMIT = 24;
export function projectAcquiredLand(state: WorldState): AcquiredLandView[] {
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const towns = new Map(state.cities.map(city => [city.id, city]));
  return Object.values(state.tileAcquisitions ?? {}).toSorted((left, right) => left.tileId - right.tileId).map(receipt => {
    const tile = tiles.get(receipt.tileId);
    const control = state.border?.controls[String(receipt.tileId)];
    const exact = control?.purchaseId === receipt.id && control.civId === tile?.owner ? control : undefined;
    const town = towns.get(exact?.cityId ?? receipt.cityId);
    return { receipt: structuredClone(receipt), currentOwner: tile?.owner ?? null, townName: town?.civId === (exact?.civId ?? receipt.civId) ? town.name : null, ...(exact ? { control: structuredClone(exact) } : {}),
      point: tile ? { tileId: tile.id, q: tile.q - (state.width - 1) / 2, r: tile.r - (state.height - 1) / 2, height: mapTileHeight(tile.elevation) } : null };
  });
}
export function selectedAcquiredLand(plots: readonly AcquiredLandView[], cityId: string): AcquiredLandView[] {
  return plots.filter(plot => (plot.control?.cityId ?? plot.receipt.cityId) === cityId && plot.townName && plot.point && plot.currentOwner === (plot.control?.civId ?? plot.receipt.civId)).slice(0, TERRITORY_OUTLINE_LIMIT);
}
export function territoryPage<T>(rows: readonly T[], page: number): { rows: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(rows.length / TERRITORY_PAGE_SIZE));
  const current = Math.max(0, Math.min(pages - 1, Number.isFinite(page) ? Math.trunc(page) : 0));
  return { rows: rows.slice(current * TERRITORY_PAGE_SIZE, (current + 1) * TERRITORY_PAGE_SIZE), page: current, pages, total: rows.length };
}
export interface TerritoryWorkView {
  improvementId: string;
  name: string;
  status: 'building' | 'built';
  construction: ImprovementConstructionOrder | null;
  installed: CityImprovement | null;
}
export interface TerritorySiteView extends TerritoryPoint {
  terrain: Terrain;
  owner: number | null;
  resources: Array<{ id: string; name: string }>;
  work: TerritoryWorkView | null;
}
export interface TerritoryPurchaseView {
  receipt: TileAcquisitionReceipt;
  site: TerritorySiteView | null;
  historicalPath: TerritoryPoint[] | null;
}
export interface TerritoryQuoteView { quote: TileAcquisitionQuote; site: TerritorySiteView | null }
export interface TownTerritoryView {
  status: 'available' | 'planned' | 'unavailable';
  reason: string | null;
  revision: number;
  cityId: string | null;
  cityName: string | null;
  civilizationId: number;
  purchases: TerritoryPurchaseView[];
  controls?: BorderControlReceipt[];
  available: TerritoryQuoteView[];
  blocked: Array<{ tileId: number; reason: string }>;
}
export function projectTownTerritory(state: WorldState, projection: CapabilityProjection): TownTerritoryView {
  const result: TownTerritoryView = { status: 'unavailable', reason: null, revision: state.revision, cityId: projection.cityId,
    cityName: null, civilizationId: projection.civilizationId, purchases: [], available: [], blocked: [] };
  if (projection.revision !== state.revision || projection.releaseId !== state.releaseId) {
    result.reason = 'The territory view belongs to a different world revision.'; return result;
  }
  const city = state.cities.find(candidate => candidate.id === projection.cityId && candidate.civId === projection.civilizationId);
  if (!city) { result.reason = 'The exact town is unavailable.'; return result; }
  result.cityName = city.name;
  result.controls = Object.values(state.border?.controls ?? {}).filter(control => control.cityId === city.id && control.civId === city.civId
    && state.tiles.find(tile => tile.id === control.tileId)?.owner === city.civId).map(control => structuredClone(control)).toSorted((a, b) => a.tileId - b.tileId);
  if (!projection.territory) { result.status = 'planned'; result.reason = 'Land acquisition is not included in this world release.'; return result; }
  result.status = 'available';
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const point = (tileId: number): TerritoryPoint | null => {
    const tile = tiles.get(tileId);
    return tile ? { tileId, q: tile.q - (state.width - 1) / 2, r: tile.r - (state.height - 1) / 2, height: mapTileHeight(tile.elevation) } : null;
  };
  const work = (tileId: number): TerritoryWorkView | null => {
    for (const row of projection.improvements ?? []) {
      const installed = row.installed.find(item => item.cityId === city.id && item.tileId === tileId);
      if (installed) return { improvementId: installed.improvementId, name: IMPROVEMENTS.find(item => item.id === installed.improvementId)?.name ?? 'Worked site',
        status: 'built', construction: null, installed: structuredClone({ improvementId: installed.improvementId, tileId: installed.tileId, completion: installed.completion, operation: installed.operation }) };
      const active = row.construction;
      if (active && isImprovementOrder(active) && active.cityId === city.id && active.tileId === tileId) {
        return { improvementId: active.improvementId, name: IMPROVEMENTS.find(item => item.id === active.improvementId)?.name ?? 'Worked site',
          status: 'building', construction: structuredClone(active), installed: null };
      }
    }
    return null;
  };
  const site = (tileId: number): TerritorySiteView | null => {
    const tile = tiles.get(tileId); const location = point(tileId);
    if (!tile || !location) return null;
    const resources: TerritorySiteView['resources'] = [];
    if (projection.pastoral?.revealedPastoralSites?.some(item => item.tileId === tileId)) resources.push({ id: 'horses', name: 'Horses' });
    if (projection.strategic?.revealedDeposits?.some(item => item.tileId === tileId && item.resource === 'iron')) resources.push({ id: 'iron', name: 'Iron' });
    return { ...location, terrain: tile.terrain, owner: tile.owner, resources, work: work(tileId) };
  };
  result.purchases = projection.territory.purchases.filter(receipt => receipt.cityId === city.id && receipt.civId === city.civId)
    .toSorted((left, right) => left.tileId - right.tileId).map(receipt => {
      const points = receipt.pathTileIds.map(point);
      const bound = receipt.cityTileId === city.tileId && receipt.pathTileIds[0] === receipt.cityTileId && receipt.pathTileIds.at(-1) === receipt.tileId;
      return { receipt: structuredClone(receipt), site: site(receipt.tileId), historicalPath: bound && points.every(item => item !== null) ? points : null };
    });
  const current = projection.territory.cities.find(item => item.cityId === city.id);
  result.available = (current?.available ?? []).filter(quote => quote.cityId === city.id && quote.civId === city.civId)
    .toSorted((left, right) => left.tileId - right.tileId).map(quote => ({ quote: structuredClone(quote), site: site(quote.tileId) }));
  result.blocked = structuredClone(current?.blocked ?? []).toSorted((left, right) => left.tileId - right.tileId);
  return result;
}
