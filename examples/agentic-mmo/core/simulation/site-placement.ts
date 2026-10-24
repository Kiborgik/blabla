export function sitePlacementRank(seed: number, tileId: number, seedMultiplier: number, mixMultipliers: readonly [number, number], salt = 0): number {
  let value = (seed ^ salt ^ Math.imul(tileId + 1, seedMultiplier)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), mixMultipliers[0]) >>> 0;
  value = Math.imul(value ^ (value >>> 15), mixMultipliers[1]) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}
