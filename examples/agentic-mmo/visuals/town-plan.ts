import type { BuildingSite } from './building-visuals.ts';

export interface TownLot extends BuildingSite { id: string }
export const TOWN_FARM_LOTS: readonly [TownLot, TownLot] = [
  { id: 'farm-main', x: .755, z: -.3, width: .41, depth: .36, height: 1 },
  { id: 'farm-rear', x: .685, z: -.58, width: .27, depth: .2, height: 1 },
];

export interface TownPlanV1 {
  version: 1;
  topology: 'crescent' | 'split-court' | 'ridge-terrace';
  landmarkLot: TownLot;
  supportLots: readonly TownLot[];
  constructionLot: TownLot;
  farmLots: readonly TownLot[];
  homeLots: readonly TownLot[];
  approach: TownLot;
}

function planHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export function townPlanV1(city: { id: string; worldSeed?: number }): TownPlanV1 {
  const key = JSON.stringify(['town-plan-v1', city.worldSeed ?? 0, city.id]);
  const variation = (domain: string): number => planHash(`${key}:${domain}`) / 4294967296;
  const topology = (['crescent', 'split-court', 'ridge-terrace'] as const)[planHash(key) % 3]!;
  const mirror = variation('handedness') < .5 ? -1 : 1;
  const lot = (id: string, x: number, z: number, width: number, depth: number, height = 1): TownLot => ({ id, x: x * mirror, z, width, depth, height });
  const homeLots = Array.from({ length: 6 }, (_, index) => {
    const row = Math.floor(index / 2);
    const side = index % 2 === 0 ? -1 : 1;
    const offsetX = (variation(`cluster-${side}-x`) - .5) * .008;
    const offsetZ = (variation(`cluster-${side}-z`) - .5) * .008;
    const x = topology === 'crescent' ? .63 - .06 * row - .035 * row * row
      : topology === 'split-court' ? .43
      : side < 0 ? .65 - .15 * row : .4 + .03 * row;
    const z = topology === 'crescent' ? .06 + .32 * row
      : topology === 'split-court' ? .12 + .3 * row
      : side < 0 ? .04 + .31 * row : .14 + .3 * row;
    return lot(`home-${index}`, side * x + offsetX, z + offsetZ, .29, .29);
  });
  return {
    version: 1,
    topology,
    landmarkLot: lot('landmark', (variation('center-x') - .5) * .05, -.31 + (variation('center-z') - .5) * .024, .76, .52),
    supportLots: [-1, 1].map((side, index) => lot(`support-${index}`, side * .64, -.52 + (variation(`support-${side}`) - .5) * .018, .3, .28, .62)),
    constructionLot: lot('construction', (variation('construction-x') - .5) * .06, -.79, .46, .22, .85),
    farmLots: TOWN_FARM_LOTS,
    homeLots,
    approach: lot('approach', 0, .43, .18, .86, 0),
  };
}
