import { projectRoutePath, mapTileHeight } from '../visuals/route-paths.ts';
import { ERAS } from '../core/content.ts';
import type { GameEvent, WorldState } from '../core/types.ts';
import { eventVisual } from '../visuals/world-visuals.ts';
import { isWorldState } from '../core/validation.ts';
import type { AtlasCivilization, AtlasWorld } from './atlas.ts';

export interface LiveSnapshot {
  identity: string;
  state: WorldState;
}

export type WorldRead =
  | { kind: 'live'; snapshot: LiveSnapshot }
  | { kind: 'uninitialized' }
  | { kind: 'offline' };

export function parseWorldRead(value: unknown): WorldRead {
  if (value === null || typeof value !== 'object') return { kind: 'offline' };
  if ('error' in value && value.error === 'world_not_initialized') return { kind: 'uninitialized' };
  if (!('ok' in value) || value.ok !== true || !('authoritative' in value) || value.authoritative !== true
    || !('state' in value) || !isWorldState(value.state)
    || !('initial' in value) || !isWorldState(value.initial)) return { kind: 'offline' };
  return {
    kind: 'live',
    snapshot: { identity: JSON.stringify([value.initial.seed, value.initial.clockEpoch]), state: value.state },
  };
}

export function acceptsSnapshot(current: LiveSnapshot | null, incoming: LiveSnapshot): boolean {
  return current === null || incoming.identity !== current.identity || incoming.state.revision >= current.state.revision;
}

export function formatYear(year: number): string {
  return `${Math.abs(year).toLocaleString('en-US')} ${year < 0 ? 'BCE' : 'CE'}`;
}

export function capabilityName(era: number): string {
  return ERAS[era]?.name ?? 'Developing world';
}

export function presentationColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#b9c9d6';
}

export function projectWorld(state: WorldState): AtlasWorld {
  const centerQ = (state.width - 1) / 2;
  const centerR = (state.height - 1) / 2;
  const civilizations = new Map(state.civilizations.map((civ) => [civ.id, civ]));
  const tiles = new Map(state.tiles.map((tile) => [tile.id, tile]));
  const cities: AtlasCivilization[] = state.cities.map((city) => {
    const civ = civilizations.get(city.civId);
    const tile = tiles.get(city.tileId);
    if (!civ || !tile) throw new Error('City refers to an unavailable civilization or tile');
    return {
      id: civ.id, cityId: city.id, name: civ.name, shortName: civ.name,
      capital: city.name, color: presentationColor(civ.color), symbol: civ.name.slice(0, 1),
      character: capabilityName(civ.era), ambition: civ.objective,
      q: tile.q - centerQ, r: tile.r - centerR,
      population: city.population, buildings: [...city.buildings],
      settlement: { id: city.id, civId: city.civId, tileId: city.tileId, name: city.name,
        population: city.population, wellbeing: city.wellbeing, damage: city.damage, buildings: [...city.buildings],
        ...(city.buildingOperations ? { buildingOperations: structuredClone(city.buildingOperations) } : {}) },
    };
  });
  const cityById = new Map(cities.map((city) => [city.cityId, city]));
  const town = (id: string) => {
    const city = cityById.get(id);
    return city ? { id, name: city.capital, civilization: city.name, color: city.color, q: city.q, r: city.r } : null;
  };
  const routes: AtlasWorld['routes'] = state.routes.map((route) => ({
    ...structuredClone(route), path: projectRoutePath(route, state), ownerName: civilizations.get(route.owner)?.name ?? `Civilization ${route.owner}`, partnerName: civilizations.get(route.partner)?.name ?? `Civilization ${route.partner}`, fromTown: town(route.from), toTown: town(route.to),
  }));
  return {
    illustrative: false,
    cities,
    tiles: state.tiles.flatMap((tile) => tile.terrain === 'ocean' ? [] : [{
      id: tile.id, q: tile.q - centerQ, r: tile.r - centerR, owner: tile.owner,
      terrain: tile.terrain, height: mapTileHeight(tile.elevation),
    }]),
    routes,
  };
}

export function latestMeaningfulEvent(events: readonly GameEvent[]): GameEvent | undefined {
  return events.findLast((event) => eventVisual(event) !== null) ?? events.at(-1);
}

export function activityLabel(state: WorldState): string {
  if (state.independentTurns) return `Economy beat ${state.independentTurns.strategyTicks} · Civilizations act independently`;
  const actor = state.civilizations.find((civ) => civ.id === state.phase)?.name ?? 'World Director';
  return `Round ${state.round} · Next: ${actor}`;
}

export function uniqueCivilizations(world: AtlasWorld): AtlasCivilization[] {
  const first = new Map<number, AtlasCivilization>();
  for (const city of world.cities) if (!first.has(city.id)) first.set(city.id, city);
  return [...first.values()].toSorted((a, b) => a.id - b.id);
}
