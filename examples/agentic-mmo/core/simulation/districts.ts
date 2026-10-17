import { purchasedSiteBlock } from './site-binding.ts';
import { DISTRICT_RULES, IMPROVEMENT_RULES, RESOURCE_IDS } from '../content.ts';
import type { BuildingDefinition, City, Resource, Resources, WorldState } from '../types.ts';
import { hexDistance } from './geography.ts';
import { hasFeatures } from './history.ts';

export function districtSiteOccupied(state: WorldState, tileId: number, installed?: { cityId: string; tileId: number }): boolean {
  return Object.values(state.wonders ?? {}).some(wonder => wonder.completion.tileId === tileId) || state.cities.some(city => Object.values(city.districtSites ?? {}).includes(tileId) || (city.construction?.active?.tileId === tileId && !('kind' in city.construction.active && city.construction.active.kind === 'rail')) || (hasFeatures(state, [IMPROVEMENT_RULES.featureId]) && Object.values(city.improvements ?? {}).some(improvement => improvement.tileId === tileId && !(installed?.cityId === city.id && installed.tileId === tileId))));
}

export function districtCapacity(city: City): number {
  return DISTRICT_RULES.baseCapacity + Math.floor(city.population / DISTRICT_RULES.populationPerDistrict);
}

export function districtCount(city: City): number {
  return Object.keys(city.districtSites ?? {}).length + (city.construction?.active && !('kind' in city.construction.active) && city.construction.active.tileId !== undefined ? 1 : 0);
}

export function districtSiteBlock(state: WorldState, city: City, building: BuildingDefinition, tileId: number): string | null {
  if (!hasFeatures(state, [DISTRICT_RULES.featureId]) || !building.district) return 'District planning is unavailable';
  const site = state.tiles.find(tile => tile.id === tileId);
  const center = state.tiles.find(tile => tile.id === city.tileId);
  if (!Number.isSafeInteger(tileId) || !site || !center) return 'The exact district site is missing';
  if (site.owner !== city.civId) return 'The district site must already belong to this civilization';
  const binding = purchasedSiteBlock(state, city, tileId); if (binding) return binding;
  if (site.terrain === 'ocean' || site.terrain === 'mountain') return 'The district requires a buildable land site';
  if (hexDistance(center, site) > building.district.range) return `The district site must be within ${building.district.range} hexes of this town`;
  if (state.cities.some(candidate => candidate.tileId === tileId)) return 'A city center occupies this site';
  if (districtSiteOccupied(state, tileId)) return 'A completed or reserved district occupies this site';
  return null;
}

export function availableDistrictSites(state: WorldState, city: City, building: BuildingDefinition): number[] {
  if (districtCount(city) >= districtCapacity(city)) return [];
  return state.tiles.filter(tile => districtSiteBlock(state, city, building, tile.id) === null).map(tile => tile.id).toSorted((a, b) => a - b);
}

export interface DistrictAdjacencyFacts {
  source: 'terrain' | 'improvement' | 'wonder';
  tileIds: number[];
  resource: Resource;
  amount: number;
  maximum: number;
  bonus: number;
}

export function districtAdjacencyFacts(state: WorldState, building: BuildingDefinition, tileId: number): DistrictAdjacencyFacts | null {
  const rule = building.district?.adjacency;
  const site = state.tiles.find(tile => tile.id === tileId);
  if (!rule || !site || !hasFeatures(state, [DISTRICT_RULES.featureId])) return null;
  const installations = rule.wonder === true
    ? new Set(Object.values(state.wonders ?? {}).map(wonder => wonder.completion.tileId))
    : rule.improvement === undefined ? null : new Set(state.cities.flatMap(city => Object.values(city.improvements ?? {}).filter(improvement => improvement.improvementId === rule.improvement).map(improvement => improvement.tileId)));
  const tileIds = state.tiles.filter(tile => hexDistance(site, tile) === 1 && (installations ? installations.has(tile.id) : tile.terrain === rule.terrain)).map(tile => tile.id).toSorted((left, right) => left - right);
  return { source: rule.wonder === true ? 'wonder' : installations ? 'improvement' : 'terrain', tileIds, resource: rule.resource, amount: rule.amount, maximum: rule.maximum, bonus: Math.min(rule.maximum, tileIds.length * rule.amount) };
}

export function buildingBaseProduction(state: WorldState, city: City, building: BuildingDefinition, tileId = city.districtSites?.[building.id]): Partial<Resources> {
  const result = { ...building.production };
  if (!building.district || !hasFeatures(state, [DISTRICT_RULES.featureId])) return result;
  const site = state.tiles.find(tile => tile.id === tileId);
  if (!site) return {};
  const adjacency = districtAdjacencyFacts(state, building, site.id);
  if (adjacency) result[adjacency.resource] = (result[adjacency.resource] ?? 0) + adjacency.bonus;
  return result;
}

export function describeDistrictProduction(state: WorldState, city: City, building: BuildingDefinition, tileId: number): string {
  const output = buildingBaseProduction(state, city, building, tileId);
  return `Exact district site ${tileId}; base output including actual adjacency before town productivity: ${RESOURCE_IDS.filter(resource => (output[resource] ?? 0) > 0).map(resource => `${resource} ${output[resource]}`).join(', ')}. Site reserved at paid start; no territorial expansion.`;
}
