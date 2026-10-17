import { availableImprovementSites, constructionTarget } from './improvements.ts';
import { availableDistrictSites, districtCapacity, districtCount } from './districts.ts';
import { isCoastalSite } from './coastal.ts';
import { ACTION_FEATURES, BUILDINGS, RESOURCE_IDS } from '../content.ts';
import type { BuildingDefinition, ImprovementDefinition, TechnologyDefinition, WorldState } from '../types.ts';
import { hasFeatures } from './history.ts';
import { citiesOf } from './world.ts';
import { selectedMountainCatchment } from './water.ts';

export type CapabilityBlocker =
  | { kind: 'feature'; featureId: string }
  | { kind: 'technology'; technologyId: string }
  | { kind: 'civilization'; civilizationId: number }
  | { kind: 'era'; required: number; available: number }
  | { kind: 'resource'; resource: typeof RESOURCE_IDS[number]; required: number; available: number }
  | { kind: 'coastal-site'; cityId: string }
  | { kind: 'mountain-catchment'; cityId: string }
  | { kind: 'building'; buildingId: string; cityId: string }
  | { kind: 'district-site'; cityId: string }
  | { kind: 'improvement-site'; cityId: string; improvementId: string }
  | { kind: 'district-capacity'; cityId: string; required: number; available: number }
  | { kind: 'wonder-site'; cityId: string }
  | { kind: 'wonder-contender'; wonderId: string; cityId: string }
  | { kind: 'wonder-completed'; wonderId: string; civilizationId: number }
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
  if (city?.civId === civilizationId && building.siteRequirement === 'coastal' && !isCoastalSite(state, city.tileId)) blockers.push({ kind: 'coastal-site', cityId: city.id });
  if (city?.civId === civilizationId && building.siteRequirement === 'mountain-catchment' && selectedMountainCatchment(state, city) === undefined) blockers.push({ kind: 'mountain-catchment', cityId: city.id });
  if (city?.civId === civilizationId) {
    for (const buildingId of building.requiresBuildings ?? []) {
      const prerequisite = BUILDINGS.find(candidate => candidate.id === buildingId);
      if (!city.buildings.includes(buildingId) || (prerequisite?.district && city.districtSites?.[buildingId] === undefined)) blockers.push({ kind: 'building', buildingId, cityId: city.id });
    }
    if (building.district && !city.buildings.includes(building.id)) {
      if (districtCount(city) >= districtCapacity(city)) blockers.push({ kind: 'district-capacity', cityId: city.id, required: districtCount(city) + 1, available: districtCapacity(city) });
      else if (!availableDistrictSites(state, city, building).length) blockers.push({ kind: 'district-site', cityId: city.id });
    }
  }
  if (hasFeatures(state, ['recurring-decisions']) && city?.construction?.active)
    blockers.push({ kind: 'active-commitment', targetId: constructionTarget(city.construction.active) });
  return {
    completed: city !== undefined && city.civId === civilizationId && city.buildings.includes(building.id),
    researching: false,
    blockers,
    targetCityId: city?.civId === civilizationId ? city.id : null,
  };
}

export function improvementEligibility(state: WorldState, civilizationId: number, definition: ImprovementDefinition, cityId: string | null): CapabilityEligibility {
  const civilization = state.civilizations.find(candidate => candidate.id === civilizationId);
  const city = state.cities.find(candidate => candidate.id === cityId);
  const blockers = featureBlockers(state, [...ACTION_FEATURES.improve, ...definition.requiredFeatures]);
  if (!civilization) blockers.push({ kind: 'civilization', civilizationId });
  else {
    for (const technologyId of definition.requires) if (!civilization.technologies.includes(technologyId)) blockers.push({ kind: 'technology', technologyId });
    if (civilization.era < definition.minEra) blockers.push({ kind: 'era', required: definition.minEra, available: civilization.era });
    for (const resource of RESOURCE_IDS) {
      const required = definition.cost[resource] ?? 0;
      if (civilization.resources[resource] < required) blockers.push({ kind: 'resource', resource, required, available: civilization.resources[resource] });
    }
  }
  if (cityId === null) blockers.push({ kind: 'city-selection' });
  else if (!city) blockers.push({ kind: 'missing-city', cityId });
  else if (city.civId !== civilizationId) blockers.push({ kind: 'foreign-city', cityId, owner: city.civId });
  else {
    if (city.construction?.active) blockers.push({ kind: 'active-commitment', targetId: constructionTarget(city.construction.active) });
    if (!availableImprovementSites(state, city, definition).length) blockers.push({ kind: 'improvement-site', cityId, improvementId: definition.id });
  }
  return { completed: false, researching: false, blockers, targetCityId: city?.civId === civilizationId ? city.id : null };
}
