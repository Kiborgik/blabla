import type { City, WorldState } from '../core/types.ts';
import { DETAIL_BUDGETS } from './visual-language.ts';
import type { DetailLevel, VisualIcon, VISUAL_PALETTE } from './visual-language.ts';
export { createEventCueTracker, eventVisual } from './event-visuals.ts';
export type { VisualDelta, VisualEvent } from './event-visuals.ts';
export { DETAIL_BUDGETS, ICON_PATHS, METRIC_LABELS, VISUAL_PALETTE, visualDetail } from './visual-language.ts';
export type { DetailLevel, VisualIcon } from './visual-language.ts';

export interface VisualPart {
  id: string;
  shape: 'box' | 'gable' | 'cylinder';
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
  [-0.36, -0.3], [0.24, 0.18], [-0.3, 0.34], [0.27, -0.42],
  [0.63, -0.1], [-0.71, -0.12], [0.15, 0.66], [-0.56, 0.65],
];
const POPULATION_STEPS = [1, 4, 7, 10, 14, 20, 28, 40] as const;
export type SettlementFacts = Pick<City, 'id' | 'civId' | 'tileId' | 'name' | 'population' | 'wellbeing' | 'damage' | 'buildings'>;

export function settlementVisual(city: SettlementFacts, detail: DetailLevel): SettlementVisual {
  const budget = DETAIL_BUDGETS[detail];
  const houses = Math.min(budget.houses, Math.max(1, POPULATION_STEPS.filter((threshold) => city.population >= threshold).length));
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale'], rotation = 0): void => {
    parts.push({ id, shape, material, position, scale, rotation });
  };
  for (const [index, [x, z]] of HOME_SITES.slice(0, houses).entries()) {
    const height = 0.3 + (index % 3) * 0.06;
    add(`home-${index}-wall`, 'box', 'plaster', [x, height / 2, z], [0.34, height, 0.3]);
    add(`home-${index}-roof`, 'gable', 'identity', [x, height + 0.1, z], [0.39, 0.2, 0.36], index % 2 ? Math.PI / 2 : 0);
  }
  const buildings: VisualBadge[] = [];
  if (city.buildings.includes('farm')) {
    buildings.push({ icon: 'farm', label: 'Farm', value: 1 });
    add('farm-soil', 'box', 'soil', [1.02, 0.04, 0.35], [0.78, 0.08, 1.12]);
    for (let row = 0; row < budget.fieldRows; row += 1) {
      const x = 1.02 + ((row + 0.5) / budget.fieldRows - 0.5) * 0.7;
      add(`farm-row-${row}`, 'box', 'crop', [x, 0.1, 0.35], [0.11, 0.12, 0.98]);
    }
  }
  if (city.buildings.includes('workshop')) {
    buildings.push({ icon: 'workshop', label: 'Workshop', value: 1 });
    add('workshop-wall', 'box', 'timber', [-1.02, 0.25, 0.37], [0.68, 0.5, 0.7]);
    add('workshop-roof', 'gable', 'roof', [-1.02, 0.65, 0.37], [0.78, 0.32, 0.8]);
    if (detail !== 'far') add('workshop-chimney', 'box', 'stone', [-0.77, 0.55, 0.55], [0.15, 1.1, 0.15]);
    if (detail === 'close') {
      add('workshop-stack-0', 'box', 'timber', [-1.1, 0.1, 0.96], [0.42, 0.2, 0.18]);
      add('workshop-stack-1', 'box', 'grain', [-0.8, 0.08, 0.96], [0.18, 0.16, 0.18]);
    }
  }
  const conditions: VisualBadge[] = [];
  if (city.wellbeing < 40) conditions.push({ icon: 'wellbeing', label: 'Wellbeing', value: city.wellbeing });
  if (city.damage > 0) conditions.push({ icon: 'damage', label: 'Damage', value: city.damage });
  return { cityId: city.id, civId: city.civId, tileId: city.tileId, name: city.name, population: city.population,
    houses, parts: parts.slice(0, budget.parts), buildings, conditions, detail };
}

export function projectWorldVisuals(state: WorldState, detail: DetailLevel): SettlementVisual[] {
  return state.cities.map((city) => settlementVisual(city, detail));
}
