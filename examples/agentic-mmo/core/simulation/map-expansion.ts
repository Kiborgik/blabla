import { WORLD_EXPANSION_RULES } from '../content.ts';
import type { WorldState } from '../types.ts';
import { createMap } from './geography.ts';

export function mapExpansionBlock(state: WorldState): string | null {
  const rules = WORLD_EXPANSION_RULES;
  if (state.width !== rules.fromWidth || state.height !== rules.fromHeight || state.tiles.length !== rules.fromWidth * rules.fromHeight)
    return 'World expansion requires the exact retained predecessor extent';
  if (!state.tiles.every((tile, index) => tile.id === index && tile.q === index % rules.fromWidth && tile.r === Math.floor(index / rules.fromWidth)))
    return 'World expansion requires canonical retained tile identities and coordinates';
  return null;
}

export function expandMapExtent(state: WorldState): void {
  const blocker = mapExpansionBlock(state);
  if (blocker) throw new RangeError(blocker);
  const rules = WORLD_EXPANSION_RULES;
  const generated = createMap(state.seed, rules.width, rules.height);
  state.tiles.push(...generated.tiles.slice(state.tiles.length));
  state.width = rules.width;
  state.height = rules.height;
}
