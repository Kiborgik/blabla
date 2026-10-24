import { BUILDINGS } from './content.ts';
import type { BuildingConstructionOrder, City } from './types.ts';

export const CIVIC_WORKS_RULES = {
  featureId: 'civic-works',
  ruleVersion: 1,
  donorBuildingId: 'kiln',
  civicId: 'state-workforce',
  durationBeats: 2,
  residents: 3,
  perBeatCost: { materials: 1, credits: 2 },
  extraBaseWork: 2,
} as const;

export function civicWorksTargetTile(city: City, order: BuildingConstructionOrder): number | null {
  if (order.tileId !== undefined) return order.tileId;
  const definition = BUILDINGS.find(building => building.id === order.buildingId);
  if (!definition) return null;
  const districts = (definition.requiresBuildings ?? []).filter(id => BUILDINGS.some(building => building.id === id && building.district));
  if (districts.some(id => city.districtSites?.[id] === undefined)) return null;
  const sites = districts.map(id => city.districtSites![id]!);
  const unique = [...new Set(sites)];
  return unique.length > 1 ? null : unique[0] ?? city.tileId;
}
