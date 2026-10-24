import { BORDER_RULES } from '../border-content.ts';
import type { City, WorldState } from '../types.ts';
import { hexDistance } from './geography.ts';

export function borderCurrentTown(state: WorldState, tileId: number): { civId: number; cityId: string } | null {
  const purchase = state.tileAcquisitions?.[String(tileId)];
  if (!purchase) return null;
  const control = state.border?.controls[String(tileId)];
  return control ? { civId: control.civId, cityId: control.cityId } : { civId: purchase.civId, cityId: purchase.cityId };
}

function passable(state: WorldState, tileId: number): boolean {
  const tile = state.tiles.find(candidate => candidate.id === tileId);
  return tile !== undefined && tile.terrain !== 'ocean' && tile.terrain !== 'mountain';
}

export function borderApproachPath(state: WorldState, actorId: number, sourceTileId: number, tileId: number): number[] | null {
  const source = state.tiles.find(tile => tile.id === sourceTileId);
  if (!source || source.owner !== actorId || sourceTileId === tileId || !passable(state, tileId)) return null;
  const queue = [[sourceTileId]];
  const seen = new Set([sourceTileId]);
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index]!;
    if (path.length > BORDER_RULES.maximumPathEdges) continue;
    const current = state.tiles.find(tile => tile.id === path.at(-1))!;
    for (const next of state.tiles.toSorted((a, b) => a.id - b.id)) {
      if (seen.has(next.id) || hexDistance(current, next) !== 1 || !passable(state, next.id) || next.id !== tileId && next.owner !== actorId) continue;
      const result = [...path, next.id];
      if (next.id === tileId) return result;
      seen.add(next.id);
      queue.push(result);
    }
  }
  return null;
}

function cityReferences(state: WorldState, city: City): Array<{ tileId: number; reason: string }> {
  const result: Array<{ tileId: number; reason: string }> = [{ tileId: city.tileId, reason: `Town ${city.id}` }];
  for (const [id, tileId] of Object.entries(city.districtSites ?? {})) result.push({ tileId, reason: `Installed district ${city.id}/${id}` });
  for (const item of Object.values(city.improvements ?? {})) result.push({ tileId: item.tileId, reason: `Installed improvement ${city.id}/${item.improvementId}` });
  for (const [id, tileId] of Object.entries(city.buildingCatchments ?? {})) result.push({ tileId, reason: `Retained catchment ${city.id}/${id}` });
  for (const [id, site] of Object.entries(city.buildingHighGround ?? {})) {
    result.push({ tileId: site.campusTileId, reason: `Retained Campus ${city.id}/${id}` }, { tileId: site.sourceTileId, reason: `Retained high ground ${city.id}/${id}` });
  }
  for (const wonder of Object.values(state.wonders ?? {})) if (wonder.completion.cityId === city.id) result.push({ tileId: wonder.completion.tileId, reason: `Installed wonder ${wonder.completion.wonderId}` });
  for (const rail of Object.values(state.railEdges ?? {})) if (rail.cityId === city.id) result.push({ tileId: rail.tileId, reason: `Installed Rail ${rail.edgeId}` }, { tileId: rail.toTileId, reason: `Installed Rail ${rail.edgeId}` });
  const order = city.construction?.active;
  if (order) {
    if (order.tileId !== undefined) result.push({ tileId: order.tileId, reason: `Paid construction ${order.id}` });
    if ('kind' in order && order.kind === 'rail') result.push({ tileId: order.toTileId, reason: `Paid Rail ${order.id}` });
    if (!('kind' in order)) {
      if (order.catchmentTileId !== undefined) result.push({ tileId: order.catchmentTileId, reason: `Reserved catchment ${order.id}` });
      if (order.highGround) result.push({ tileId: order.highGround.campusTileId, reason: `Reserved Campus ${order.id}` }, { tileId: order.highGround.sourceTileId, reason: `Reserved high ground ${order.id}` });
    }
  }
  return result;
}

function reachable(state: WorldState, city: City, removed: number | null): Set<number> {
  const reached = new Set<number>();
  const queue = [city.tileId];
  if (city.tileId === removed) return reached;
  reached.add(city.tileId);
  for (let index = 0; index < queue.length; index++) {
    const current = state.tiles.find(tile => tile.id === queue[index]);
    if (!current) continue;
    for (const tile of state.tiles) {
      if (tile.id === removed || reached.has(tile.id) || tile.owner !== city.civId || !passable(state, tile.id) || hexDistance(current, tile) !== 1) continue;
      reached.add(tile.id);
      queue.push(tile.id);
    }
  }
  return reached;
}

export function borderSiteReferences(state: WorldState, tileId: number): string[] {
  const blocked = new Set<string>();
  for (const city of state.cities) {
    const references = cityReferences(state, city);
    for (const reference of references) if (reference.tileId === tileId) blocked.add(reference.reason);
    if (state.tiles.find(tile => tile.id === tileId)?.owner !== city.civId) continue;
    const before = reachable(state, city, null);
    const after = reachable(state, city, tileId);
    for (const reference of references) if (reference.tileId !== tileId && before.has(reference.tileId) && !after.has(reference.tileId)) blocked.add(`Owned connection to ${reference.reason}`);
  }
  return [...blocked].sort();
}

export function borderTargetFailure(state: WorldState, actorId: number, sourceCityId: string, tileId: number): string | null {
  const city = state.cities.find(candidate => candidate.id === sourceCityId && candidate.civId === actorId);
  if (!city) return 'The exact owned source town is missing';
  const target = state.tiles.find(tile => tile.id === tileId);
  const purchase = state.tileAcquisitions?.[String(tileId)];
  const current = borderCurrentTown(state, tileId);
  if (!target || target.owner === null || target.owner === actorId || !purchase || !current || target.owner !== current.civId) return 'The target must be an exact purchased rival plot under its recorded current control';
  if (!state.cities.some(candidate => candidate.id === current.cityId && candidate.civId === current.civId)) return 'The target current-control town is missing';
  if (!passable(state, tileId)) return 'The target requires traversable buildable land';
  const references = borderSiteReferences(state, tileId);
  if (references.length) return `The target protects ${references.join('; ')}`;
  if (!borderApproachPath(state, actorId, city.tileId, tileId)) return 'The target needs at most three adjacent edges through owned approach land';
  return null;
}
