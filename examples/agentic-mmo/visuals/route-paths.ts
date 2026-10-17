import type { Route, WorldState } from '../core/types.ts';
import { isLandTransportQuote, landTransportBlock, landTransportTopologyBlock } from '../core/simulation/transport.ts';
import { visibleRoutes } from './route-visuals.ts';
import type { RouteView } from './route-visuals.ts';

export interface RoutePathPoint { tileId: number | null; q: number; r: number; height: number }
export interface RoutePath { kind: 'schematic' | 'land' | 'unavailable'; points: RoutePathPoint[]; currentBlock: string | null; reason: string | null }
export const ROUTE_EDGE_LIMIT = 512;
export const ROUTE_TOTAL_EDGE_LIMIT = 4096;
export const ROUTE_TILE_PAGE_SIZE = 32;

export function mapTileHeight(elevation: number): number { return 0.25 + Math.max(0, Math.min(elevation / 100, 1)) * 0.22; }

export function hasRouteQuote(route: Route): boolean {
  return route.agreement !== undefined && Object.hasOwn(route.agreement.terms, 'transport');
}

function unavailable(reason: string): RoutePath { return { kind: 'unavailable', points: [], currentBlock: null, reason }; }

export function projectRoutePath(route: Route, state: Pick<WorldState, 'tiles' | 'cities' | 'width' | 'height'>): RoutePath {
  const from = state.cities.find(city => city.id === route.from && city.civId === route.owner);
  const to = state.cities.find(city => city.id === route.to && city.civId === route.partner);
  if (!from || !to) return unavailable('An exact endpoint is unavailable.');
  const quote = route.agreement?.terms.transport;
  const quoted = hasRouteQuote(route);
  if (quoted) {
    if (!isLandTransportQuote(quote, state.tiles.length)) return unavailable('The retained path is malformed or unsupported.');
    const reason = landTransportTopologyBlock(state, quote, from.tileId, to.tileId);
    if (reason) return unavailable(reason);
  }
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const ids = quoted && quote ? quote.tileIds : [from.tileId, to.tileId];
  const points: RoutePathPoint[] = [];
  for (const id of ids) {
    const tile = tiles.get(id);
    if (!tile) return unavailable(`Recorded tile ${id} is unavailable.`);
    points.push({ tileId: id, q: tile.q - (state.width - 1) / 2, r: tile.r - (state.height - 1) / 2,
      height: quoted ? mapTileHeight(tile.elevation) + 0.06 : 0.72 });
  }
  return { kind: quoted ? 'land' : 'schematic', points,
    currentBlock: quoted && quote ? landTransportBlock(state, quote, from.tileId, to.tileId) : null, reason: null };
}

export function routePathPoints(route: RouteView): readonly RoutePathPoint[] {
  if (route.path) return route.path.points;
  if (hasRouteQuote(route) || !route.fromTown || !route.toTown) return [];
  return [route.fromTown, route.toTown].map(town => ({ tileId: null, q: town.q, r: town.r, height: 0.72 }));
}

export function routePathOmission(route: RouteView): string | null {
  if (route.path?.reason) return route.path.reason;
  const points = routePathPoints(route);
  if (points.length < 2) return 'The recorded path is unavailable on this map.';
  if (points.length - 1 > ROUTE_EDGE_LIMIT) return 'Path hidden by the map detail limit. All recorded tiles remain available below.';
  return null;
}

export function visibleRoutePaths(routes: readonly RouteView[], selected: string | null): RouteView[] {
  let remaining = ROUTE_TOTAL_EDGE_LIMIT;
  return visibleRoutes(routes, selected).filter(route => {
    const edges = routePathPoints(route).length - 1;
    if (routePathOmission(route) || edges > remaining) return false;
    remaining -= edges;
    return true;
  });
}

export function routeTilePage(route: RouteView, page: number): { ids: number[]; page: number; pages: number; total: number } {
  const quote = route.agreement?.terms.transport;
  const ids = isLandTransportQuote(quote, Number.MAX_SAFE_INTEGER) ? quote.tileIds : [];
  const pages = Math.max(1, Math.ceil(ids.length / ROUTE_TILE_PAGE_SIZE));
  const current = Math.max(0, Math.min(pages - 1, Number.isFinite(page) ? Math.trunc(page) : 0));
  return { ids: ids.slice(current * ROUTE_TILE_PAGE_SIZE, (current + 1) * ROUTE_TILE_PAGE_SIZE), page: current, pages, total: ids.length };
}
