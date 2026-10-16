import { RESOURCE_IDS } from '../content.ts';
import type { City, Civilization, Resources, WorldState } from '../types.ts';

export function civilizationById(state: WorldState, id: number): Civilization {
  const civilization = state.civilizations.find((candidate) => candidate.id === id);
  if (!civilization) throw new RangeError(`Unknown civilization ${id}`);
  return civilization;
}

export function citiesOf(state: WorldState, id: number): City[] {
  return state.cities.filter((city) => city.civId === id);
}

export function canAfford(resources: Resources, cost: Partial<Resources>): boolean {
  return RESOURCE_IDS.every((resource) => resources[resource] >= (cost[resource] ?? 0));
}

export function transferCost(
  resources: Resources,
  cost: Partial<Resources>,
  direction: -1 | 1 = -1,
): void {
  for (const resource of RESOURCE_IDS) {
    resources[resource] = Math.max(0, resources[resource] + direction * (cost[resource] ?? 0));
  }
}

export function totalPopulation(state: WorldState, id: number): number {
  return citiesOf(state, id).reduce((total, city) => total + city.population, 0);
}

export function clamp(value: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  return Math.min(maximum, Math.max(minimum, value));
}
