import type { CampusHighGroundSite, City, WorldState } from '../types.ts';
import { hexDistance } from './geography.ts';
import { isHillSite } from './improvements.ts';

export function availableCampusHighGround(state: WorldState, city: City): CampusHighGroundSite[] {
  const campusTileId = city.districtSites?.campus;
  if (!city.buildings.includes('campus') || campusTileId === undefined) return [];
  const campus = state.tiles.find(tile => tile.id === campusTileId && tile.owner === city.civId);
  if (!campus) return [];
  return state.tiles.filter(tile => hexDistance(campus, tile) === 1 && (tile.terrain === 'mountain' || isHillSite(tile))).map(tile => ({ campusTileId, sourceTileId: tile.id })).toSorted((left, right) => left.sourceTileId - right.sourceTileId);
}

export function selectedCampusHighGround(state: WorldState, city: City): CampusHighGroundSite | undefined {
  return availableCampusHighGround(state, city)[0];
}
