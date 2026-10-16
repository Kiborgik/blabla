import { ACTION_FEATURES, RESOURCE_IDS } from '../content.ts';
import type { BuildingDefinition, TechnologyDefinition, WorldState } from '../types.ts';
import { hasFeatures } from './history.ts';
import { citiesOf } from './world.ts';

export type CapabilityBlocker =
  | { kind: 'feature'; featureId: string }
  | { kind: 'technology'; technologyId: string }
  | { kind: 'civilization'; civilizationId: number }
  | { kind: 'era'; required: number; available: number }
  | { kind: 'resource'; resource: typeof RESOURCE_IDS[number]; required: number; available: number }
  | { kind: 'city-selection' }
  | { kind: 'missing-city'; cityId: string }
  | { kind: 'foreign-city'; cityId: string; owner: number }
  | { kind: 'missing-site'; cityId: string }
  | { kind: 'active-commitment'; targetId: string }
  | { kind: 'legacy-target'; cityId: string };

export interface CapabilityEligibility {
  completed: boolean;
  researching: boolean;
  blockers: CapabilityBlocker[];
  targetCityId: string | null;
}

function featureBlockers(state: WorldState, required: readonly string[]): CapabilityBlocker[] {
  return [...new Set(required)].filter(id => !state.unlockedFeatures.includes(id)).map(featureId => ({ kind: 'feature', featureId }));
}

export function researchEligibility(state: WorldState, civilizationId: number, technology: TechnologyDefinition): CapabilityEligibility {
  const civilization = state.civilizations.find(candidate => candidate.id === civilizationId);
  const blockers = featureBlockers(state, [...ACTION_FEATURES.research, ...technology.requiredFeatures]);
  if (!civilization) blockers.push({ kind: 'civilization', civilizationId });
  else for (const technologyId of technology.requires) if (!civilization.technologies.includes(technologyId)) blockers.push({ kind: 'technology', technologyId });
  if (hasFeatures(state, ['recurring-decisions']) && civilization?.researchTarget && civilization.researchTarget !== technology.id)
    blockers.push({ kind: 'active-commitment', targetId: civilization.researchTarget });
  return { completed: civilization?.technologies.includes(technology.id) ?? false, researching: civilization?.researchTarget === technology.id, blockers, targetCityId: null };
}

export function buildingEligibility(state: WorldState, civilizationId: number, building: BuildingDefinition, cityId?: string | null): CapabilityEligibility {
  const civilization = state.civilizations.find(candidate => candidate.id === civilizationId);
  const cities = citiesOf(state, civilizationId);
  const specialized = hasFeatures(state, ['city-specialization']);
  const first = cities.find(city => !city.buildings.includes(building.id));
  const city = cityId === undefined ? first : state.cities.find(candidate => candidate.id === cityId);
  const blockers = featureBlockers(state, [...ACTION_FEATURES.build, ...building.requiredFeatures]);
  if (!civilization) blockers.push({ kind: 'civilization', civilizationId });
  else {
    for (const technologyId of building.requires) if (!civilization.technologies.includes(technologyId)) blockers.push({ kind: 'technology', technologyId });
    if (civilization.era < building.minEra) blockers.push({ kind: 'era', required: building.minEra, available: civilization.era });
    for (const resource of RESOURCE_IDS) {
      const required = building.cost[resource] ?? 0;
      if (civilization.resources[resource] < required) blockers.push({ kind: 'resource', resource, required, available: civilization.resources[resource] });
    }
  }
  if (cityId === null || (cityId === undefined && !city)) blockers.push({ kind: 'city-selection' });
  else if (!city) blockers.push({ kind: 'missing-city', cityId: cityId ?? '' });
  else if (city.civId !== civilizationId) blockers.push({ kind: 'foreign-city', cityId: city.id, owner: city.civId });
  else if (specialized && !state.tiles.some(tile => tile.id === city.tileId)) blockers.push({ kind: 'missing-site', cityId: city.id });
  else if (!specialized && cityId !== undefined && !city.buildings.includes(building.id) && first && first.id !== city.id) blockers.push({ kind: 'legacy-target', cityId: first.id });
  if (hasFeatures(state, ['recurring-decisions']) && city?.construction?.active)
    blockers.push({ kind: 'active-commitment', targetId: city.construction.active.buildingId });
  return {
    completed: city !== undefined && city.civId === civilizationId && city.buildings.includes(building.id),
    researching: false,
    blockers,
    targetCityId: city?.civId === civilizationId ? city.id : null,
  };
}
