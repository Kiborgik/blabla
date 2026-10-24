export function normalizeSeed(seed: number): number {
  if (!Number.isSafeInteger(seed)) throw new RangeError('Seed must be a safe integer');
  return seed >>> 0;
}

export function randomStep(seed: number): { value: number; seed: number } {
  let next = seed || 0x6d2b79f5;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return { value: (next >>> 0) / 0x100000000, seed: next >>> 0 };
}
