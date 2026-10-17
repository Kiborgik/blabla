import type { City, WorldState } from '../types.ts';
import { hasFeatures } from './history.ts';

export function purchasedSiteBlock(state: WorldState, city: City, tileId: number): string | null {
  if (!hasFeatures(state, ['owned-territory'])) return null;
  const receipt = state.tileAcquisitions?.[String(tileId)];
  return receipt && (receipt.cityId !== city.id || receipt.civId !== city.civId) ? 'The purchased site belongs to another exact town' : null;
}
