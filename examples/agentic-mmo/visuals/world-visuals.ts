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
  [-.46, -.36], [.04, -.32], [.49, -.23], [-.45, .2],
  [.04, .24], [.48, .32], [-.17, .68], [.22, -.73],
];
const POPULATION_STEPS = [1, 4, 7, 10, 14, 20, 28, 40] as const;
export type SettlementFacts = Pick<City, 'id' | 'civId' | 'tileId' | 'name' | 'population' | 'wellbeing' | 'damage' | 'buildings' | 'buildingOperations'>;

export function populationFootprint(population: number): number {
  return .72 + Math.min(1, Math.log2(Math.max(1, population) + 1) / 6) * .46;
}

export function settlementVisual(city: SettlementFacts, detail: DetailLevel): SettlementVisual {
  const budget = DETAIL_BUDGETS[detail];
  const houses = Math.min(budget.houses, Math.max(1, POPULATION_STEPS.filter((threshold) => city.population >= threshold).length));
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale'], rotation = 0): void => {
    parts.push({ id, shape, material, position, scale, rotation });
  };
  const density = populationFootprint(city.population);
  for (const [index, [siteX, siteZ]] of HOME_SITES.slice(0, houses).entries()) {
    const x = siteX * density;
    const z = siteZ * density;
    const height = (.29 + (index % 3) * .07) * density;
    add(`home-${index}-wall`, 'box', 'plaster', [x, height / 2, z], [.4 * density, height, .36 * density]);
    add(`home-${index}-roof`, 'gable', index === 0 ? 'identity' : 'roof', [x, height + .12, z], [.46 * density, .24, .42 * density], index % 2 ? Math.PI / 2 : 0);
  }
  const appearances = buildingAppearances(city.buildings, detail);
  const buildings = appearances.map(({ icon, label }) => ({ icon, label, value: 1 }));
  const conditionParts = damageParts(city.damage);
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
