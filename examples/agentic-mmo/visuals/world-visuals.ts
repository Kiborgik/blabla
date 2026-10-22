import { damageCondition, damageParts } from './damage-visuals.ts';
import { allocateBuildingParts, buildingAppearances, installedBuildingBadges } from './building-visuals.ts';
import { settlementDevelopment, settlementConstruction, settlementOperationParts } from './settlement-development.ts';
import type { SettlementDevelopment, SettlementConstruction } from './settlement-development.ts';
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
  development: SettlementDevelopment;
  construction: SettlementConstruction | null;
}

export const SETTLEMENT_RENDER_SCALE = .7;

const HOME_SITES: ReadonlyArray<readonly [number, number]> = [
  [-.29, -.42], [.27, -.42], [-.29, .03], [.27, .03],
  [-.29, .48], [.27, .48], [-.3, -.83], [.28, -.83],
];
const POPULATION_STEPS = [1, 4, 7, 10, 14, 20, 28, 40] as const;
export type SettlementFacts = Pick<City, 'id' | 'civId' | 'tileId' | 'name' | 'population' | 'wellbeing' | 'damage' | 'buildings' | 'buildingOperations' | 'construction' | 'localPower'> & { round?: number; terminal?: boolean };

export function populationFootprint(population: number): number {
  return .72 + Math.min(1, Math.log2(Math.max(1, population) + 1) / 6) * .46;
}

export function settlementVisual(city: SettlementFacts, detail: DetailLevel): SettlementVisual {
  const budget = DETAIL_BUDGETS[detail];
  const appearances = buildingAppearances(city.buildings, detail);
  const conditionParts = damageParts(city.damage);
  const development = settlementDevelopment(city);
  const construction = settlementConstruction(city, detail);
  const operations = settlementOperationParts(city, detail);
  const hearth = development.stage === 'primitive' ? 1 : 0;
  const houseBudget = Math.floor((budget.parts - appearances.reduce((count, appearance) => count + appearance.corePartIds.length, 0) - 3 - construction.parts.length - operations.length - hearth) / 2);
  const houses = Math.max(1, Math.min(budget.houses, houseBudget, Math.max(1, POPULATION_STEPS.filter((threshold) => city.population >= threshold).length)));
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale'], rotation = 0): void => {
    parts.push({ id, shape, material, position, scale, rotation });
  };
  const density = populationFootprint(city.population);
  const tier = city.population >= 28 ? 3 : city.population >= 14 ? 2 : city.population >= 7 ? 1 : 0;
  for (const [index, [siteX, siteZ]] of HOME_SITES.slice(0, houses).entries()) {
    const x = siteX * density;
    const z = siteZ * density;
    const identity = Math.abs(city.civId) % 3;
    const primitive = development.stage === 'primitive';
    const modern = development.stage === 'industrial' || development.stage === 'launch';
    const height = (primitive ? .17 + tier * .035 : modern ? .42 + tier * .1 : .22 + tier * .13) + (index % 2) * .04;
    const width = primitive ? .39 : .34 + tier * .025;
    const roofHeight = primitive ? .34 : modern ? .08 : .24;
    add(`home-${index}-wall`, primitive ? 'cylinder' : 'box', primitive ? 'timber' : modern ? 'plaster' : 'stone', [x, height / 2, z], [width, height, primitive ? .39 : .34]);
    add(`home-${index}-roof`, primitive ? 'cone' : modern ? 'box' : 'gable', modern ? (index % 3 === 0 ? 'identity' : 'metal') : index % 3 === 1 ? 'grain' : 'roof', [x, height + roofHeight / 2, z], [width + .08, roofHeight, primitive ? .47 : .42], !primitive && !modern && identity === 1 ? Math.PI / 2 : 0);
  }
  if (hearth) add('home-hearth', 'cylinder', 'stone', [0, .045, .1], [.23, .09, .23]);
  const buildings = installedBuildingBadges(city.buildings);
  parts.push(...allocateBuildingParts(appearances, budget.parts - parts.length - 3 - construction.parts.length - operations.length));
  parts.push(...construction.parts, ...operations);
  const conditions: VisualBadge[] = [];
  if (city.wellbeing < 40) conditions.push({ icon: 'wellbeing', label: 'Wellbeing', value: city.wellbeing });
  const damaged = damageCondition(city.damage);
  if (damaged) conditions.push(damaged);
  parts.push(...conditionParts);
  return { cityId: city.id, civId: city.civId, tileId: city.tileId, name: city.name, population: city.population,
    houses, parts, buildings, conditions, detail, development, construction: construction.facts };
}

export function projectWorldVisuals(state: WorldState, detail: DetailLevel): SettlementVisual[] {
  return state.cities.map((city) => settlementVisual({ ...city, round: state.round, terminal: state.outcome !== null }, detail));
}
