import { projectAcquiredLand } from '../visuals/territory-visuals.ts';
import { projectPastoralSites, projectCatchmentSites } from '../visuals/pastoral-visuals.ts';
import { projectWonderSites } from '../visuals/wonder-visuals.ts';
import { projectRevealedDeposits } from '../visuals/strategic-resource-visuals.ts';
import { projectRoutePath, mapTileHeight } from '../visuals/route-paths.ts';
import { BUILDINGS, ERAS, IMPROVEMENTS } from '../core/content.ts';
import { buildingBaseProduction, districtAdjacencyFacts } from '../core/simulation/districts.ts';
import type { ImprovementView } from '../visuals/improvement-visuals.ts';
import type { DistrictView } from '../visuals/district-visuals.ts';
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
  const districts = state.cities.flatMap((city): DistrictView[] => {
    const order = city.construction?.active;
    const active = order && 'buildingId' in order ? order : null;
    const town = cityById.get(city.id);
    if (!town) return [];
    return BUILDINGS.filter(definition => definition.district).flatMap((definition): DistrictView[] => {
      const built = city.buildings.includes(definition.id);
      const tileId = built ? city.districtSites?.[definition.id] : active?.buildingId === definition.id ? active.tileId : undefined;
      const tile = tileId === undefined ? undefined : tiles.get(tileId);
      if (!tile || tile.terrain === 'ocean') return [];
      const attachments = BUILDINGS.filter(item => item.requiresBuildings?.includes(definition.id)).flatMap(item => {
        const status = city.buildings.includes(item.id) ? 'built' as const : active?.buildingId === item.id ? 'building' as const : null;
        return status ? [{ buildingId: item.id, name: item.name, status }] : [];
      });
      return [{ id: `district:${city.id}:${definition.id}`, buildingId: definition.id, name: definition.name, attachments,
        cityId: city.id, townName: city.name, civId: city.civId, tileId: tile.id,
        q: tile.q - centerQ, r: tile.r - centerR, height: mapTileHeight(tile.elevation), color: town.color,
        status: built ? 'built' : 'building', library: attachments.find(item => item.buildingId === 'library')?.status ?? 'absent',
        construction: active && (active.buildingId === definition.id || attachments.some(item => item.buildingId === active.buildingId)) ? structuredClone(active) : null,
        baseProduction: buildingBaseProduction(state, city, definition, tile.id),
        ...((definition.district?.adjacency?.improvement || definition.district?.adjacency?.wonder) ? { adjacency: districtAdjacencyFacts(state, definition, tile.id) } : {}) }];
    });
  }).toSorted((a, b) => a.tileId - b.tileId || a.id.localeCompare(b.id));
  const improvements = state.cities.flatMap((city): ImprovementView[] => {
    const town = cityById.get(city.id);
    if (!town) return [];
    const installed = Object.values(city.improvements ?? {});
    const order = city.construction?.active;
    const active = order && 'kind' in order && order.kind === 'improvement' ? order : null;
    const records = [
      ...installed.map(item => ({ improvementId: item.improvementId, tileId: item.tileId, instance: item.completion.orderId, construction: null, completion: item.completion, operation: item.operation })),
      ...(active ? [{ improvementId: active.improvementId, tileId: active.tileId, instance: active.id, construction: active, completion: null, operation: null }] : []),
    ];
    return records.flatMap((record): ImprovementView[] => {
      const tile = tiles.get(record.tileId);
      const definition = IMPROVEMENTS.find(item => item.id === record.improvementId);
      if (!tile || !definition || tile.terrain === 'ocean') return [];
      return [{ id: `improvement:${city.id}:${record.tileId}:${record.instance}`, cityId: city.id, townName: city.name, civId: city.civId,
        improvementId: record.improvementId, name: definition.name, tileId: tile.id, q: tile.q - centerQ, r: tile.r - centerR,
        height: mapTileHeight(tile.elevation), color: town.color, status: record.construction ? 'building' : 'built',
        construction: structuredClone(record.construction), completion: structuredClone(record.completion), operation: structuredClone(record.operation),
        baseProduction: structuredClone(definition.production), residentsRequired: definition.residentsRequired }];
    });
  }).toSorted((a, b) => a.tileId - b.tileId || a.id.localeCompare(b.id));
  const town = (id: string) => {
    const city = cityById.get(id);
    return city ? { id, name: city.capital, civilization: city.name, color: city.color, q: city.q, r: city.r } : null;
  };
  const routes: AtlasWorld['routes'] = state.routes.map((route) => ({
    ...structuredClone(route), path: projectRoutePath(route, state), ownerName: civilizations.get(route.owner)?.name ?? `Civilization ${route.owner}`, partnerName: civilizations.get(route.partner)?.name ?? `Civilization ${route.partner}`, fromTown: town(route.from), toTown: town(route.to),
  }));
  return {
    illustrative: false,
    acquiredLand: projectAcquiredLand(state),
    cities,
    districts,
    pastoralSites: projectPastoralSites(state),
    catchments: projectCatchmentSites(state),
    wonders: projectWonderSites(state),
    improvements,
    deposits: projectRevealedDeposits(state),
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
