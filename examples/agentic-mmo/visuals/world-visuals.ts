import { damageCondition, damageParts } from './damage-visuals.ts';
import { allocateBuildingParts, buildingAppearances } from './building-visuals.ts';
import type { City, WorldState } from '../core/types.ts';
import { DETAIL_BUDGETS } from './visual-language.ts';
import type { DetailLevel, VisualIcon, VISUAL_PALETTE } from './visual-language.ts';
export { createEventCueTracker, eventVisual } from './event-visuals.ts';
export type { VisualDelta, VisualEvent } from './event-visuals.ts';
export { DETAIL_BUDGETS, ICON_PATHS, METRIC_LABELS, VISUAL_PALETTE, visualDetail } from './visual-language.ts';
export type { DetailLevel, VisualIcon } from './visual-language.ts';

export interface VisualPart {
  id: string;
  shape: 'box' | 'gable' | 'cylinder' | 'cone' | 'canopy';
  material: keyof typeof VISUAL_PALETTE | 'identity';
  position: readonly [number, number, number];
  scale: readonly [number, number, number];
  rotation: number;
}

export interface VisualBadge { icon: VisualIcon; label: string; value: number }
export interface SettlementVisual {
  cityId: string;
  civId: number;
  tileId: number;
  name: string;
  population: number;
  houses: number;
  parts: VisualPart[];
  buildings: VisualBadge[];
  conditions: VisualBadge[];
  detail: DetailLevel;
}

const HOME_SITES: ReadonlyArray<readonly [number, number]> = [
  [-.29, -.42], [.27, -.42], [-.29, .03], [.27, .03],
  [-.29, .48], [.27, .48], [-.3, -.83], [.28, -.83],
];
const POPULATION_STEPS = [1, 4, 7, 10, 14, 20, 28, 40] as const;
export type SettlementFacts = Pick<City, 'id' | 'civId' | 'tileId' | 'name' | 'population' | 'wellbeing' | 'damage' | 'buildings' | 'buildingOperations'>;

export function populationFootprint(population: number): number {
  return .72 + Math.min(1, Math.log2(Math.max(1, population) + 1) / 6) * .46;
}

export function settlementVisual(city: SettlementFacts, detail: DetailLevel): SettlementVisual {
  const budget = DETAIL_BUDGETS[detail];
  const appearances = buildingAppearances(city.buildings, detail);
  const conditionParts = damageParts(city.damage);
  const houseBudget = Math.floor((budget.parts - appearances.reduce((count, appearance) => count + appearance.corePartIds.length, 0) - conditionParts.length) / 2);
  const houses = Math.min(budget.houses, houseBudget, Math.max(1, POPULATION_STEPS.filter((threshold) => city.population >= threshold).length));
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale'], rotation = 0): void => {
    parts.push({ id, shape, material, position, scale, rotation });
  };
  const density = populationFootprint(city.population);
  const tier = city.population >= 28 ? 3 : city.population >= 14 ? 2 : city.population >= 7 ? 1 : 0;
  for (const [index, [siteX, siteZ]] of HOME_SITES.slice(0, houses).entries()) {
    const x = siteX * density;
    const z = siteZ * density;
    const height = .22 + tier * .17 + (index % 2) * .06;
    const width = .35 + tier * .045;
    add(`home-${index}-wall`, 'box', 'plaster', [x, height / 2, z], [width, height, .32 + tier * .025]);
    add(`home-${index}-roof`, 'gable', index % 3 === 0 ? 'identity' : 'roof', [x, height + .12, z], [width + .08, .24, .4 + tier * .025]);
  }
  const buildings = appearances.map(({ icon, label }) => ({ icon, label, value: 1 }));
  parts.push(...allocateBuildingParts(appearances, budget.parts - parts.length - conditionParts.length));
  const conditions: VisualBadge[] = [];
  if (city.wellbeing < 40) conditions.push({ icon: 'wellbeing', label: 'Wellbeing', value: city.wellbeing });
  const damaged = damageCondition(city.damage);
  if (damaged) conditions.push(damaged);
  parts.push(...conditionParts);
  return { cityId: city.id, civId: city.civId, tileId: city.tileId, name: city.name, population: city.population,
    houses, parts, buildings, conditions, detail };
}

export function projectWorldVisuals(state: WorldState, detail: DetailLevel): SettlementVisual[] {
  return state.cities.map((city) => settlementVisual(city, detail));
}
