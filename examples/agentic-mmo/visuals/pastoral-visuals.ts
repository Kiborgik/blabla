import { observedPastoralSites } from '../core/simulation/pastoral.ts';
import type { WorldState } from '../core/types.ts';
import { mapTileHeight } from './route-paths.ts';

export const PASTORAL_MARK_PATH = 'M6 4V12A6 6 0 0 0 18 12V4H14V12A2 2 0 0 1 10 12V4ZM6 7H10M14 7H18M7 15L10 13M14 13L17 15';
export const CATCHMENT_MARK_PATH = 'M2 21L10 4L17 16M7 10L10 12L12 9M17 9C14 13 12 16 14 19C17 23 23 19 21 16Z';
export interface PastoralSiteView { id: string; tileId: number; q: number; r: number; height: number; revealedTo: number[] }
export interface CatchmentSiteView { id: string; cityId: string; townName: string; civId: number; tileId: number; q: number; r: number; height: number; color: string; status: 'building' | 'built'; workId: string }

export function projectPastoralSites(state: WorldState): PastoralSiteView[] {
  const views = new Map<number, PastoralSiteView>();
  for (const civilization of state.civilizations) {
    for (const site of observedPastoralSites(state, civilization.id).revealedPastoralSites ?? []) {
      const tile = state.tiles.find(candidate => candidate.id === site.tileId);
      if (!tile) continue;
      const view = views.get(tile.id) ?? { id: `horses:${tile.id}`, tileId: tile.id, q: tile.q - (state.width - 1) / 2, r: tile.r - (state.height - 1) / 2, height: mapTileHeight(tile.elevation), revealedTo: [] };
      view.revealedTo.push(civilization.id); views.set(tile.id, view);
    }
  }
  return [...views.values()].toSorted((a, b) => a.tileId - b.tileId);
}

export function visiblePastoralSites(sites: readonly PastoralSiteView[], civilizationId: number): PastoralSiteView[] {
  return sites.filter(site => site.revealedTo.includes(civilizationId));
}

export function pastoralSiteLabel(tileId: number): string { return `Horses · Tile ${tileId} · Revealed site, not stored cargo`; }

export function projectCatchmentSites(state: WorldState): CatchmentSiteView[] {
  return state.cities.flatMap((city): CatchmentSiteView[] => {
    const order = city.construction?.active;
    const active = order && 'buildingId' in order && order.buildingId === 'aqueduct' ? order : null;
    const built = city.buildings.includes('aqueduct');
    const tileId = built ? city.buildingCatchments?.['aqueduct'] : active?.catchmentTileId;
    const tile = state.tiles.find(candidate => candidate.id === tileId);
    const civilization = state.civilizations.find(candidate => candidate.id === city.civId);
    if (!tile || !civilization) return [];
    return [{ id: `catchment:${city.id}:${tile.id}`, cityId: city.id, townName: city.name, civId: city.civId, tileId: tile.id,
      q: tile.q - (state.width - 1) / 2, r: tile.r - (state.height - 1) / 2, height: mapTileHeight(tile.elevation),
      color: /^#[0-9a-f]{6}$/i.test(civilization.color) ? civilization.color : '#b9c9d6', status: built ? 'built' : 'building', workId: built ? 'aqueduct' : `active:${active?.id ?? ''}` }];
  }).toSorted((a, b) => a.tileId - b.tileId || a.cityId.localeCompare(b.cityId));
}
