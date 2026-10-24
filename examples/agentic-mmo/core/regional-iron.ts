import { CIV_COUNT, type Terrain, type WorldState } from './types.ts';
import { reconstructGeneratedGeography } from './generated-geography.ts';

export const REGIONAL_IRON_PLACEMENT_ID = 'regional-iron-1';
export const REGIONAL_IRON_MAXIMUM_STEPS = 5_000_000;
const ELEVATION_UNITS = 4096;
const OFFSETS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;
const TERRAINS: readonly Terrain[] = ['ocean', 'grassland', 'forest', 'desert', 'mountain', 'tundra'];

export interface RegionalIronInput {
  seed: number;
  width: number;
  height: number;
  terrainBasis: ReadonlyArray<readonly [Terrain, number]>;
  genesisCapitalTileIds: readonly number[];
}

export interface RegionalIronApproach {
  civId: number;
  capitalTileId: number;
  tileId: number;
  pathTileIds: number[];
  purchaseTileIds: number[];
}

export type RegionalIronPlan = { status: 'placed'; tileIds: number[]; components: number[][]; approaches: [RegionalIronApproach, RegionalIronApproach]; steps: number }
  | { status: 'no-solution' | 'search-budget-exhausted'; steps: number };

function adjacent(id: number, width: number, height: number): number[] {
  const q = id % width, r = Math.floor(id / width);
  return OFFSETS.flatMap(([dq, dr]) => q + dq >= 0 && q + dq < width && r + dr >= 0 && r + dr < height ? [(r + dr) * width + q + dq] : []).sort((a, b) => a - b);
}

function distance(first: number, second: number, width: number): number {
  const q = first % width - second % width, r = Math.floor(first / width) - Math.floor(second / width);
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

function compare(first: readonly number[], second: readonly number[]): number {
  for (let index = 0; index < Math.min(first.length, second.length); index++) if (first[index] !== second[index]) return first[index]! - second[index]!;
  return first.length - second.length;
}

function rank(seed: number, ids: readonly number[]): number {
  let value = seed ^ 0x52495231;
  for (const id of ids) {
    value ^= Math.imul(id + 1, 0x9e3779b1);
    value = Math.imul(value ^ value >>> 16, 0x7feb352d);
    value = Math.imul(value ^ value >>> 15, 0x846ca68b);
    value ^= value >>> 16;
  }
  return value >>> 0;
}

export function regionalIronComponents(tileIds: readonly number[], width: number, height: number): number[][] {
  const remaining = new Set(tileIds), result: number[][] = [];
  for (const start of [...remaining].sort((a, b) => a - b)) {
    if (!remaining.delete(start)) continue;
    const queue = [start];
    for (const id of queue) for (const next of adjacent(id, width, height)) if (remaining.delete(next)) queue.push(next);
    result.push(queue.sort((a, b) => a - b));
  }
  return result.sort(compare);
}

export function planRegionalIron(input: RegionalIronInput, options: { maximumSteps?: number } = {}): RegionalIronPlan {
  const { seed, width, height, terrainBasis, genesisCapitalTileIds: capitals } = input;
  const maximumSteps = options.maximumSteps ?? REGIONAL_IRON_MAXIMUM_STEPS;
  if (!Number.isSafeInteger(maximumSteps) || maximumSteps < 0 || maximumSteps > REGIONAL_IRON_MAXIMUM_STEPS) throw new RangeError('Regional Iron requires a bounded integer search budget');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 4096
    || terrainBasis.length !== width * height || terrainBasis.some(([terrain, elevation]) => !TERRAINS.includes(terrain) || !Number.isSafeInteger(elevation) || elevation < 0 || elevation > 100 * ELEVATION_UNITS)
    || capitals.length !== CIV_COUNT || new Set(capitals).size !== CIV_COUNT || capitals.some(id => !Number.isSafeInteger(id) || id < 0 || id >= terrainBasis.length || ['ocean', 'mountain'].includes(terrainBasis[id]![0])))
    throw new RangeError('Regional Iron requires exact immutable terrain and five genesis capitals');
  let steps = 0;
  const exhausted = Symbol('regional-iron-search-budget');
  const step = (): void => { if (steps >= maximumSteps) throw exhausted; steps++; };
  try {
    const centers = new Set(capitals), graph = terrainBasis.map((_, id) => { step(); return adjacent(id, width, height); });
    const passable = terrainBasis.map(([terrain]) => terrain !== 'ocean' && terrain !== 'mountain');
    const owner = terrainBasis.map(([terrain], id) => terrain === 'ocean' ? -1 : capitals.findIndex(center => distance(center, id, width) <= 1));
    const eligible = terrainBasis.flatMap(([terrain, elevation], id) => { step(); return terrain !== 'ocean' && terrain !== 'mountain' && elevation >= 70 * ELEVATION_UNITS && elevation <= 88 * ELEVATION_UNITS && !centers.has(id) ? [id] : []; });
    if (eligible.length < 8) return { status: 'no-solution', steps };
    const eligibleSet = new Set(eligible), hills = graph.map(ids => ids.filter(id => eligibleSet.has(id)));
    const land = new Set([capitals[0]!]), landQueue = [...land];
    for (const id of landQueue) for (const next of graph[id]!) {
      step(); if (passable[next] && !land.has(next)) { land.add(next); landQueue.push(next); }
    }
    const capitalGraph = capitals.map((center, civId) => graph.map((ids, id) => id !== center && (!passable[id] || centers.has(id) || distance(center, id, width) > 3 || owner[id] !== -1 && owner[id] !== civId)
      ? [] : ids.filter(next => passable[next] && !centers.has(next) && distance(center, next, width) <= 3 && (owner[next] === -1 || owner[next] === civId))));
    const paths = (civId: number, blocked: ReadonlySet<number>): Map<number, number[]> => {
      const center = capitals[civId]!, found = new Map([[center, [center]]]), queue = [center];
      for (const id of queue) for (const next of capitalGraph[civId]![id]!) {
        step(); if (found.has(next) || blocked.has(next)) continue;
        found.set(next, [...found.get(id)!, next]); queue.push(next);
      }
      return found;
    };
    const toApproach = (civId: number, tileId: number, pathTileIds: number[]): RegionalIronApproach => ({ civId, capitalTileId: capitals[civId]!, tileId, pathTileIds, purchaseTileIds: pathTileIds.filter(id => owner[id] === -1) });
    const routes = capitals.map((_, civId) => paths(civId, new Set()));
    const approaches = new Map(eligible.map(id => [id, owner[id] === -1 ? routes.flatMap((route, civId) => route.has(id) ? [toApproach(civId, id, route.get(id)!)] : []) : []]));
    const pairRoutes = new Map<string, [RegionalIronApproach, RegionalIronApproach] | null>();
    const compatibleApproaches = (first: RegionalIronApproach, second: RegionalIronApproach): [RegionalIronApproach, RegionalIronApproach] | null => {
      if (!first.purchaseTileIds.some(id => second.purchaseTileIds.includes(id))) return [first, second];
      const key = `${first.civId}:${first.tileId}/${second.civId}:${second.tileId}`;
      if (pairRoutes.has(key)) return pairRoutes.get(key)!;
      const current = [first.capitalTileId], seen = new Set(current);
      const search = (id: number): [RegionalIronApproach, RegionalIronApproach] | null => {
        step();
        if (id === first.tileId) {
          const a = toApproach(first.civId, first.tileId, [...current]);
          const b = paths(second.civId, new Set(a.purchaseTileIds)).get(second.tileId);
          return b ? [a, toApproach(second.civId, second.tileId, b)] : null;
        }
        for (const next of capitalGraph[first.civId]![id]!) {
          step(); if (seen.has(next)) continue;
          seen.add(next); current.push(next);
          const result = search(next);
          current.pop(); seen.delete(next);
          if (result) return result;
        }
        return null;
      };
      const result = search(first.capitalTileId); pairRoutes.set(key, result); return result;
    };
    const selectApproaches = (ids: number[]): [RegionalIronApproach, RegionalIronApproach] | null => {
      const choices = ids.flatMap(id => approaches.get(id)!);
      for (let first = 0; first < choices.length; first++) for (let second = first + 1; second < choices.length; second++) {
        step(); const a = choices[first]!, b = choices[second]!;
        if (a.civId === b.civId || a.tileId === b.tileId) continue;
        const result = compatibleApproaches(a, b); if (result) return result;
      }
      return null;
    };
    const pairMap = new Map<string, number[]>(), tripleMap = new Map<string, number[]>();
    for (const id of eligible) for (const next of hills[id]!) {
      step(); if (next < id) continue;
      const pair = [id, next]; pairMap.set(pair.join(','), pair);
      for (const third of new Set([...hills[id]!, ...hills[next]!])) {
        step(); if (third === id || third === next) continue;
        const triple = [id, next, third].sort((a, b) => a - b); tripleMap.set(triple.join(','), triple);
      }
    }
    const ranked = (map: Map<string, number[]>): number[][] => [...map.values()].map(ids => ({ ids, rank: rank(seed, ids) })).sort((a, b) => a.rank - b.rank || compare(a.ids, b.ids)).map(item => item.ids);
    const pairs = ranked(pairMap), triples = ranked(tripleMap);
    const separate = (first: number[], second: number[]): boolean => first.every(id => second.every(other => id !== other && !hills[id]!.includes(other)));
    for (let first = 0; first < triples.length; first++) for (let second = first + 1; second < triples.length; second++) {
      step(); const a = triples[first]!, b = triples[second]!;
      if (!separate(a, b)) continue;
      for (const pair of pairs) {
        step(); if (!separate(a, pair) || !separate(b, pair)) continue;
        const ids = [...a, ...b, ...pair].sort((x, y) => x - y);
        if (ids.filter(id => land.has(id)).length < 6) continue;
        const selected = selectApproaches(ids); if (!selected) continue;
        return { status: 'placed', tileIds: ids, components: [a, b, pair].sort(compare), approaches: selected, steps };
      }
    }
    return { status: 'no-solution', steps };
  } catch (error) {
    if (error === exhausted) return { status: 'search-budget-exhausted', steps };
    throw error;
  }
}

const canonicalPlans = new Map<string, RegionalIronPlan | null>();

export function regionalIronPlanForWorld(state: Pick<WorldState, 'seed' | 'width' | 'height' | 'origin' | 'drainage'>): RegionalIronPlan | null {
  const origin = state.origin, basis = state.drainage?.terrainBasis;
  if (!origin || !['settlement-regional-iron-1', 'settlement-staged-coastal-1', 'settlement-expansion-labor-1'].includes(origin.initialReleaseId ?? '') || origin.generatorVersion !== 'drainage-geography-v2' || origin.seed !== state.seed || !Array.isArray(basis)
    || !Number.isSafeInteger(origin.geographyAttempt) || origin.geographyAttempt! < 0 || origin.geographyAttempt! >= 96) return null;
  const key = JSON.stringify([state.seed, state.width, state.height, origin.geographyAttempt, basis]);
  if (canonicalPlans.has(key)) return structuredClone(canonicalPlans.get(key)!);
  const geography = reconstructGeneratedGeography(state.seed, state.width, state.height, origin.geographyAttempt!);
  const result = !geography || JSON.stringify(geography.drainage.terrainBasis) !== JSON.stringify(basis) ? null
    : planRegionalIron({ seed: state.seed, width: state.width, height: state.height, terrainBasis: basis, genesisCapitalTileIds: geography.capitalTileIds });
  if (canonicalPlans.size >= 32) canonicalPlans.delete(canonicalPlans.keys().next().value!);
  canonicalPlans.set(key, structuredClone(result));
  return result;
}
