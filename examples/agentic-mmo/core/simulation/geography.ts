import type { HexTile, Terrain } from '../types.ts';
import { randomStep } from './random.ts';

export function hexDistance(
  left: Pick<HexTile, 'q' | 'r'>,
  right: Pick<HexTile, 'q' | 'r'>,
): number {
  const q = left.q - right.q;
  const r = left.r - right.r;
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

export function createMap(
  seed: number,
  width: number,
  height: number,
): { tiles: HexTile[]; seed: number } {
  const tiles: HexTile[] = [];
  let current = seed;
  for (let r = 0; r < height; r += 1) {
    for (let q = 0; q < width; q += 1) {
      const sample = randomStep(current);
      current = sample.seed;
      const elevation = Math.floor(sample.value * 100);
      const coastal = q === 0 || r === 0 || q === width - 1 || r === height - 1;
      const terrain: Terrain =
        coastal && elevation < 65
          ? 'ocean'
          : elevation > 88
            ? 'mountain'
            : r < 2 && elevation > 60
              ? 'tundra'
              : elevation < 23
                ? 'desert'
                : elevation < 58
                  ? 'grassland'
                  : 'forest';
      tiles.push({ id: r * width + q, q, r, terrain, elevation, owner: null, resource: null });
    }
  }
  return { tiles, seed: current };
}
