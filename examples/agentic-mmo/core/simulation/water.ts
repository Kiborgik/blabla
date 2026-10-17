import type { City, WorldState } from '../types.ts';
import { hexDistance } from './geography.ts';

export function availableMountainCatchments(state: WorldState, city: City): number[] {
  const center = state.tiles.find(tile => tile.id === city.tileId);
  if (!center) return [];
  return state.tiles.filter(tile => tile.terrain === 'mountain' && hexDistance(center, tile) === 1).map(tile => tile.id).toSorted((left, right) => left - right);
}

export function selectedMountainCatchment(state: WorldState, city: City): number | undefined {
  return availableMountainCatchments(state, city)[0];
}
