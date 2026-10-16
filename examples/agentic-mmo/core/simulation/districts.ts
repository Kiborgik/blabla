import { DISTRICT_RULES, IMPROVEMENT_RULES, RESOURCE_IDS } from '../content.ts';
import type { BuildingDefinition, City, Resources, WorldState } from '../types.ts';
import { hexDistance } from './geography.ts';
import { hasFeatures } from './history.ts';

export function districtSiteOccupied(state: WorldState, tileId: number, installed?: { cityId: string; tileId: number }): boolean {
  return state.cities.some(city => Object.values(city.districtSites ?? {}).includes(tileId) || city.construction?.active?.tileId === tileId || (hasFeatures(state, [IMPROVEMENT_RULES.featureId]) && Object.values(city.improvements ?? {}).some(improvement => improvement.tileId === tileId && !(installed?.cityId === city.id && installed.tileId === tileId))));
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

export function buildingBaseProduction(state: WorldState, city: City, building: BuildingDefinition, tileId = city.districtSites?.[building.id]): Partial<Resources> {
  const result = { ...building.production };
  if (!building.district || !hasFeatures(state, [DISTRICT_RULES.featureId])) return result;
  const site = state.tiles.find(tile => tile.id === tileId);
  if (!site) return {};
  const rule = building.district.adjacency;
  const count = state.tiles.filter(tile => tile.terrain === rule.terrain && hexDistance(site, tile) === 1).length;
  result[rule.resource] = (result[rule.resource] ?? 0) + Math.min(rule.maximum, count * rule.amount);
  return result;
}

export function describeDistrictProduction(state: WorldState, city: City, building: BuildingDefinition, tileId: number): string {
  const output = buildingBaseProduction(state, city, building, tileId);
  return `Exact district site ${tileId}; base output including actual adjacency before town productivity: ${RESOURCE_IDS.filter(resource => (output[resource] ?? 0) > 0).map(resource => `${resource} ${output[resource]}`).join(', ')}. Site reserved at paid start; no territorial expansion.`;
}
