import { railEdgeId } from './rail.ts';
import { INDUSTRIAL_RULES, LAND_TRANSPORT_RULES } from '../content.ts';
import type { HexTile, LandTransportQuote, SteamTransportQuote, TransportQuote, WorldState } from '../types.ts';
import { hexDistance } from './geography.ts';

const neighbors = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;

export function isLandTransportQuote(value: unknown, maxTiles: number): value is LandTransportQuote {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const fields = Object.keys(value);
  if (fields.length !== 4 || !fields.every(key => ['mode', 'ruleVersion', 'tileIds', 'edges'].includes(key))) return false;
  if (!('mode' in value) || value.mode !== 'land' || !('ruleVersion' in value) || value.ruleVersion !== 1
    || !('tileIds' in value) || !Array.isArray(value.tileIds) || value.tileIds.length < 2 || value.tileIds.length > maxTiles
    || !('edges' in value) || value.edges !== value.tileIds.length - 1) return false;
  const ids: unknown[] = value.tileIds;
  for (let index = 0; index < ids.length; index++) if (!Object.hasOwn(ids, index) || !Number.isSafeInteger(ids[index]) || Number(ids[index]) < 0) return false;
  return new Set(ids).size === ids.length;
}

export function landTransportTopologyBlock(state: Pick<WorldState, 'tiles'>, quote: LandTransportQuote, fromTileId: number, toTileId: number): string | null {
  if (!isLandTransportQuote(quote, state.tiles.length)) return 'Land quote has malformed or unsupported path data';
  if (quote.tileIds[0] !== fromTileId || quote.tileIds.at(-1) !== toTileId) return 'Land quote does not match its exact endpoint tiles';
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  let previous: HexTile | undefined;
  for (const id of quote.tileIds) {
    const tile = tiles.get(id);
    if (!tile) return `Land quote tile ${id} is missing`;
    if (previous && hexDistance(previous, tile) !== 1) return `Land quote hop to tile ${id} is not adjacent`;
    previous = tile;
  }
  return null;
}

export function landTransportBlock(state: Pick<WorldState, 'tiles'>, quote: LandTransportQuote, fromTileId: number, toTileId: number): string | null {
  const topology = landTransportTopologyBlock(state, quote, fromTileId, toTileId);
  if (topology) return topology;
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  for (const id of quote.tileIds) {
    const tile = tiles.get(id);
    if (tile && !LAND_TRANSPORT_RULES.passable[tile.terrain]) return `Land quote tile ${id} is impassable ${tile.terrain}`;
  }
  return null;
}

export function createLandTransportPlanner(state: Pick<WorldState, 'tiles'>) {
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const coordinates = new Map(state.tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
  const trees = new Map<number, Map<number, number | null>>();
  const work = { trees: 0, visitedTiles: 0 };
  const quote = (fromTileId: number, toTileId: number): LandTransportQuote | null => {
    let tree = trees.get(fromTileId);
    if (!tree) {
      tree = new Map<number, number | null>();
      trees.set(fromTileId, tree);
      work.trees += 1;
      const origin = tiles.get(fromTileId);
      if (origin && LAND_TRANSPORT_RULES.passable[origin.terrain]) {
        const queue = [origin];
        tree.set(origin.id, null);
        for (let index = 0; index < queue.length; index++) {
          const current = queue[index];
          if (!current) continue;
          work.visitedTiles += 1;
          for (const [q, r] of neighbors) {
            const next = coordinates.get(`${current.q + q},${current.r + r}`);
            if (!next || tree.has(next.id) || !LAND_TRANSPORT_RULES.passable[next.terrain]) continue;
            tree.set(next.id, current.id);
            queue.push(next);
          }
        }
      }
    }
    if (fromTileId === toTileId || !tree.has(toTileId)) return null;
    const tileIds: number[] = [];
    let current: number | null | undefined = toTileId;
    while (current !== null && current !== undefined) {
      tileIds.push(current);
      current = tree.get(current);
    }
    tileIds.reverse();
    return { mode: 'land', ruleVersion: LAND_TRANSPORT_RULES.ruleVersion, tileIds, edges: tileIds.length - 1 };
  };
  return { quote, work };
}

export function landTransportCadence(baseCadence: number, quote: LandTransportQuote): number {
  return Math.max(baseCadence, Math.ceil(quote.edges / LAND_TRANSPORT_RULES.edgesPerBeat));
}

export function describeLandTransport(quote: LandTransportQuote, cadence: number): string {
  return `Land path ${quote.tileIds.join(' → ')}; ${quote.edges} edges; exchange every ${cadence} rounds, first due ${cadence} rounds after acceptance. Open-border civilian transit; no cargo is in transit before the due exchange`;
}

function landShape(quote: TransportQuote): LandTransportQuote { return { mode: 'land', ruleVersion: 1, tileIds: quote.tileIds, edges: quote.edges }; }

export function isSteamTransportQuote(value: unknown, maxTiles: number): value is SteamTransportQuote {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const fields = ['mode', 'ruleVersion', 'tileIds', 'edges', 'edgeWeights', 'railEdges', 'weightedDistance', 'baseCadence', 'unrailedEdges', 'unrailedCadence', 'proposerFuel'];
  if (Object.keys(value).length !== fields.length || !fields.every(key => Object.hasOwn(value, key))) return false;
  const quote = value as SteamTransportQuote;
  if (quote.mode !== 'steam' || quote.ruleVersion !== 1 || !isLandTransportQuote(landShape(quote), maxTiles)
    || !Array.isArray(quote.edgeWeights) || quote.edgeWeights.length !== quote.edges || !Array.from(quote.edgeWeights).every(weight => weight === 1 || weight === 0.25)
    || !Array.isArray(quote.railEdges) || !Number.isSafeInteger(quote.baseCadence) || quote.baseCadence < 1
    || !Number.isSafeInteger(quote.unrailedEdges) || quote.unrailedEdges < 1 || quote.unrailedEdges > quote.edges
    || quote.unrailedCadence !== Math.max(quote.baseCadence, Math.ceil(quote.unrailedEdges / INDUSTRIAL_RULES.edgesPerBeat))
    || quote.weightedDistance !== quote.edgeWeights.reduce((sum, weight) => sum + weight, 0)
    || typeof quote.proposerFuel !== 'object' || quote.proposerFuel === null || Object.keys(quote.proposerFuel).length !== 1 || quote.proposerFuel.coal !== 1) return false;
  const ids = quote.edgeWeights.flatMap((weight, index) => weight === 0.25 ? [railEdgeId(quote.tileIds[index]!, quote.tileIds[index + 1]!)] : []);
  return quote.railEdges.length === ids.length && Array.from(quote.railEdges).every((edge, index) => typeof edge === 'object' && edge !== null && Object.keys(edge).length === 2 && edge.edgeId === ids[index] && typeof edge.completionEventId === 'string' && /^[1-9]\d*:\d+$/.test(edge.completionEventId) && edge.completionEventId.length <= 128);
}

export function isTransportQuote(value: unknown, maxTiles: number): value is TransportQuote { return isLandTransportQuote(value, maxTiles) || isSteamTransportQuote(value, maxTiles); }

export function transportTopologyBlock(state: Pick<WorldState, 'tiles'>, quote: TransportQuote, fromTileId: number, toTileId: number): string | null {
  if (!isTransportQuote(quote, state.tiles.length)) return 'Transport quote has malformed or unsupported versioned data';
  return landTransportTopologyBlock(state, landShape(quote), fromTileId, toTileId);
}

export function transportBlock(state: Pick<WorldState, 'tiles' | 'railEdges'>, quote: TransportQuote, fromTileId: number, toTileId: number): string | null {
  const topology = transportTopologyBlock(state, quote, fromTileId, toTileId); if (topology) return topology;
  const passability = landTransportBlock(state, landShape(quote), fromTileId, toTileId); if (passability) return passability;
  if (quote.mode === 'steam') for (const reference of quote.railEdges) if (state.railEdges?.[reference.edgeId]?.eventId !== reference.completionEventId) return `Required completed Rail ${reference.edgeId} is missing`;
  return null;
}

export function transportCadence(baseCadence: number, quote: TransportQuote): number {
  return quote.mode === 'land' ? landTransportCadence(baseCadence, quote) : Math.max(quote.baseCadence, Math.ceil(quote.weightedDistance / INDUSTRIAL_RULES.edgesPerBeat));
}

export function describeTransport(quote: TransportQuote, cadence: number): string {
  return quote.mode === 'land' ? describeLandTransport(quote, cadence) : `Steam path ${quote.tileIds.join(' → ')}; weighted distance ${quote.weightedDistance}; ${quote.railEdges.length} retained Rail edges; exchange every ${cadence} rounds versus unrailed ${quote.unrailedCadence}. Proposer pays one Coal only on a fully funded successful due exchange; no physical cargo is in transit`;
}

export function createSteamTransportPlanner(state: Pick<WorldState, 'tiles' | 'railEdges'>) {
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const coordinates = new Map(state.tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
  const unrailed = createLandTransportPlanner(state);
  const trees = new Map<number, Map<number, { distance: number; previous: number | null }>>();
  const work = { trees: 0, visitedTiles: 0, relaxedEdges: 0 };
  const quote = (fromTileId: number, toTileId: number, baseCadence: number): SteamTransportQuote | null => {
    const baseline = unrailed.quote(fromTileId, toTileId); if (!baseline || !Number.isSafeInteger(baseCadence) || baseCadence < 1) return null;
    let tree = trees.get(fromTileId);
    if (!tree) {
      tree = new Map(); trees.set(fromTileId, tree); work.trees++;
      tree.set(fromTileId, { distance: 0, previous: null }); const queue = [{ id: fromTileId, distance: 0 }]; const settled = new Set<number>();
      while (queue.length) {
        queue.sort((left, right) => left.distance - right.distance || left.id - right.id);
        const current = queue.shift(); if (!current || settled.has(current.id)) continue;
        settled.add(current.id); work.visitedTiles++;
        const tile = tiles.get(current.id); if (!tile) continue;
        const adjacent = neighbors.flatMap(([q, r]) => { const next = coordinates.get(`${tile.q + q},${tile.r + r}`); return next && LAND_TRANSPORT_RULES.passable[next.terrain] ? [next] : []; }).toSorted((left, right) => left.id - right.id);
        for (const next of adjacent) {
          work.relaxedEdges++;
          const distance = current.distance + (state.railEdges?.[railEdgeId(current.id, next.id)] ? 1 : 4);
          const retained = tree.get(next.id);
          if (!retained || distance < retained.distance) { tree.set(next.id, { distance, previous: current.id }); queue.push({ id: next.id, distance }); }
        }
      }
    }
    if (!tree.has(toTileId)) return null;
    const tileIds: number[] = []; let current: number | null = toTileId;
    while (current !== null) { tileIds.push(current); current = tree.get(current)?.previous ?? null; }
    tileIds.reverse();
    const edgeWeights: number[] = []; const railEdges: SteamTransportQuote['railEdges'] = [];
    for (let index = 1; index < tileIds.length; index++) {
      const first = tileIds[index - 1]; const second = tileIds[index]; if (first === undefined || second === undefined) throw new RangeError('Transport path is incomplete');
      const edgeId = railEdgeId(first, second); const rail = state.railEdges?.[edgeId];
      edgeWeights.push(rail ? INDUSTRIAL_RULES.railWeight : INDUSTRIAL_RULES.plainWeight);
      if (rail) railEdges.push({ edgeId, completionEventId: rail.eventId });
    }
    return { mode: 'steam', ruleVersion: 1, tileIds, edges: tileIds.length - 1, edgeWeights, railEdges, weightedDistance: edgeWeights.reduce((sum, weight) => sum + weight, 0), baseCadence, unrailedEdges: baseline.edges, unrailedCadence: landTransportCadence(baseCadence, baseline), proposerFuel: { coal: 1 } };
  };
  return { quote, work, unrailedWork: unrailed.work };
}
