import { damageCondition, damageParts } from './damage-visuals.ts';
import { townPlanV1 } from './town-plan.ts';
import { allocateBuildingParts, buildingAppearance, installedBuildingBadges, placeBuildingParts } from './building-visuals.ts';
import { settlementDevelopment, settlementConstruction, settlementOperationParts, settlementLandmarks } from './settlement-development.ts';
import type { SettlementDevelopment, SettlementConstruction } from './settlement-development.ts';
import type { City, WorldState } from '../core/types.ts';
import { DETAIL_BUDGETS, civilizationIdentity } from './visual-language.ts';
import type { DetailLevel, VisualIcon, VISUAL_PALETTE } from './visual-language.ts';
export { createEventCueTracker, eventVisual } from './event-visuals.ts';
export type { VisualDelta, VisualEvent } from './event-visuals.ts';
export { DETAIL_BUDGETS, ICON_PATHS, METRIC_LABELS, VISUAL_PALETTE, visualDetail, settlementDetail } from './visual-language.ts';
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
  landmarks: string[];
  summarizedBuildings: string[];
}

export const SETTLEMENT_RENDER_SCALE = .7;

const POPULATION_STEPS = [1, 4, 7, 10, 14, 20, 28, 40] as const;
export type SettlementFacts = Pick<City, 'id' | 'civId' | 'tileId' | 'name' | 'population' | 'wellbeing' | 'damage' | 'buildings' | 'buildingOperations' | 'construction' | 'localPower'> & { worldSeed?: number; round?: number; terminal?: boolean };

export function populationFootprint(population: number): number {
  return .58 + Math.min(1, Math.log2(Math.max(1, population) + 1) / 6) * .26;
}

export function settlementVisual(city: SettlementFacts, detail: DetailLevel): SettlementVisual {
  const budget = DETAIL_BUDGETS[detail];
  const plan = townPlanV1(city);
  const buildingSites = [plan.landmarkLot, ...plan.supportLots];
  const development = settlementDevelopment(city);
  const construction = settlementConstruction(city, detail);
  const appearances = settlementLandmarks(city, detail, construction.facts !== null);
  const identity = civilizationIdentity(city.civId);
  const operations = settlementOperationParts(city, detail);
  const placed = appearances.map((appearance, index) => {
    const site = buildingSites[index] ?? plan.landmarkLot;
    const reference = buildingAppearance(appearance.id, 'close')?.parts ?? appearance.parts;
    return { ...appearance, parts: placeBuildingParts(appearance.parts, reference, site) };
  });
  const operationParts = appearances.flatMap((appearance, index) => {
    const cues = operations.filter(part => part.id.startsWith(`operation:${appearance.id}:`));
    const reference = buildingAppearance(appearance.id, 'close')?.parts ?? appearance.parts;
    return placeBuildingParts(cues, reference, buildingSites[index] ?? plan.landmarkLot);
  });
  const reference = construction.facts ? buildingAppearance(construction.facts.buildingId, 'close')?.parts ?? [] : [];
  const constructionParts = placeBuildingParts(construction.parts, reference, plan.constructionLot);
  const primitive = development.stage === 'primitive';
  const hearth = primitive && appearances.length === 0;
  const maximumHouses = detail === 'far' ? 3 : detail === 'mid' ? 4 : appearances.length > 2 || construction.facts ? 5 : 6;
  const reserved = 3 + Number(hearth) + constructionParts.length + operationParts.length;
  const houseBudget = Math.floor((budget.parts - reserved - placed.reduce((sum, appearance) => sum + appearance.corePartIds.length, 0)) / 2);
  const houses = Math.max(1, Math.min(maximumHouses, houseBudget, POPULATION_STEPS.filter(threshold => city.population >= threshold).length));
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale'], rotation = 0): void => {
    parts.push({ id, shape, material, position, scale, rotation });
  };
  const tier = city.population >= 28 ? 3 : city.population >= 14 ? 2 : city.population >= 7 ? 1 : 0;
  for (const [index, { x, z }] of plan.homeLots.slice(0, houses).entries()) {
    const height = (primitive ? .16 : .25) + tier * .035 + (index % 2) * .035;
    const width = .18 + tier * .01;
    const roofHeight = primitive ? .25 : identity.roofHeight;
    const rotation = primitive ? 0 : identity.rotation;
    add(`home-${index}-wall`, primitive ? 'cylinder' : 'box', primitive ? 'timber' : identity.wall, [x, height / 2, z], [width, height, width]);
    add(`home-${index}-roof`, primitive ? 'cone' : identity.roofShape, primitive ? index % 2 ? 'grain' : identity.roof : identity.roof,
      [x, height + roofHeight / 2, z], [width + .055, roofHeight, width + .055], rotation);
  }
  if (hearth) add('home-hearth', 'cylinder', 'stone', [plan.landmarkLot.x, .045, plan.landmarkLot.z], [.23, .09, .23]);
  const buildings = installedBuildingBadges(city.buildings);
  parts.push(...allocateBuildingParts(placed, budget.parts - parts.length - 3 - constructionParts.length - operationParts.length));
  parts.push(...constructionParts, ...operationParts);
  const conditions: VisualBadge[] = [];
  if (city.wellbeing < 40) conditions.push({ icon: 'wellbeing', label: 'Wellbeing', value: city.wellbeing });
  const damaged = damageCondition(city.damage);
  if (damaged) conditions.push(damaged);
  parts.push(...damageParts(city.damage).map(part => ({ ...part,
    position: [part.position[0] * .58, part.position[1], part.position[2] * .58] as const,
    scale: [part.scale[0] * .58, part.scale[1], part.scale[2] * .58] as const,
  })));
  const landmarks = appearances.map(appearance => appearance.id);
  const summarizedBuildings = installedBuildingBadges(city.buildings.filter(id => !landmarks.includes(id))).map(building => building.label);
  return { cityId: city.id, civId: city.civId, tileId: city.tileId, name: city.name, population: city.population,
    houses, parts, buildings, conditions, detail, development, construction: construction.facts, landmarks, summarizedBuildings };
}

export function projectWorldVisuals(state: WorldState, detail: DetailLevel): SettlementVisual[] {
  return state.cities.map((city) => settlementVisual({ ...city, worldSeed: state.seed, round: state.round, terminal: state.outcome !== null }, detail));
}
