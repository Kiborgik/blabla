import { conditionDrainage, drainageFacts, RIVER_MINIMUM_CONTRIBUTING_LAND_TILES, type DrainageLayerV1 } from './drainage.ts';
import { CIV_COUNT, type HexTile, type Terrain } from './types.ts';
import { INDUSTRIAL_RULES } from './content.ts';
import { hexDistance } from './simulation/geography.ts';
import { isHillSite } from './simulation/improvements.ts';
import { normalizeSeed, randomStep } from './simulation/random.ts';
import { createCoastalPlanner, coastalPathBlock } from './simulation/coastal.ts';
import { createLandTransportPlanner, landTransportCadence } from './simulation/transport.ts';

export const GENERATED_GEOGRAPHY_VERSION = 'drainage-geography-v2';

export interface GeneratedGeography {
  version: typeof GENERATED_GEOGRAPHY_VERSION;
  width: number;
  height: number;
  tiles: HexTile[];
  drainage: DrainageLayerV1;
  capitalTileIds: number[];
  rng: number;
}

const OFFSETS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;
const MAXIMUM_ATTEMPTS = 96;

function hash(seed: number, q: number, r: number): number {
  let value = seed ^ Math.imul(q, 0x9e3779b1) ^ Math.imul(r, 0x85ebca6b);
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return (value ^ value >>> 16) >>> 0;
}

function noise(seed: number, q: number, r: number): number {
  const x = Math.floor(q), y = Math.floor(r);
  const dx = q - x, dy = r - y;
  const sx = dx * dx * (3 - 2 * dx), sy = dy * dy * (3 - 2 * dy);
  const north = hash(seed, x, y) * (1 - sx) + hash(seed, x + 1, y) * sx;
  const south = hash(seed, x, y + 1) * (1 - sx) + hash(seed, x + 1, y + 1) * sx;
  return (north * (1 - sy) + south * sy) / 0x100000000;
}

function adjacent(tiles: HexTile[], tile: HexTile, width: number, height: number): HexTile[] {
  return OFFSETS.flatMap(([dq, dr]) => {
    const q = tile.q + dq, r = tile.r + dr;
    return q >= 0 && q < width && r >= 0 && r < height ? [tiles[r * width + q]!] : [];
  });
}

function landmass(tiles: HexTile[], width: number, height: number): Set<number> {
  const remaining = new Set(tiles.filter(tile => tile.terrain !== 'ocean' && tile.terrain !== 'mountain').map(tile => tile.id));
  let largest = new Set<number>();
  while (remaining.size) {
    const start = remaining.values().next().value!;
    const component = new Set([start]);
    const queue = [tiles[start]!];
    remaining.delete(start);
    for (const tile of queue) for (const neighbor of adjacent(tiles, tile, width, height)) {
      if (!remaining.delete(neighbor.id)) continue;
      component.add(neighbor.id);
      queue.push(neighbor);
    }
    if (component.size > largest.size) largest = component;
  }
  return largest;
}

function landscape(seed: number, width: number, height: number): HexTile[] {
  const scores: number[] = [];
  for (let r = 0; r < height; r++) for (let q = 0; q < width; q++) {
    const x = (q / (width - 1) - .5) * 2 + (noise(seed ^ 0x57415250, q / 7, r / 7) - .5) * .42;
    const y = (r / (height - 1) - .5) * 2 + (noise(seed ^ 0x57415251, q / 8, r / 8) - .5) * .34;
    scores.push(q === 0 || r === 0 || q === width - 1 || r === height - 1 ? -10 : 1 - x * x * .8 - y * y * .65 + (noise(seed, q / 6, r / 7) - .5) * .85);
  }
  const coverage = .65 + noise(seed ^ 0x434f4153, 1, 1) * .09;
  const cutoff = scores.toSorted((a, b) => b - a)[Math.floor(width * height * coverage)]!;
  const tiles: HexTile[] = [];
  for (let r = 0; r < height; r++) for (let q = 0; q < width; q++) {
    const score = scores[r * width + q]!;
    const ridge = 1 - Math.abs(noise(seed ^ 0x52494447, q / 5, r / 5.5) * 2 - 1);
    const elevation = score < cutoff ? Math.max(0, Math.min(29, Math.floor(18 + (score - cutoff) * 24))) : Math.min(100, Math.round(30 + ridge ** 3 * 65));
    const moisture = noise(seed ^ 0x5241494e, q / 4.5, r / 6) * .8 + noise(seed ^ 0x57455453, q / 11, r / 10) * .2;
    const latitude = Math.abs(r / (height - 1) - .5) * 2;
    const terrain: Terrain = score < cutoff ? 'ocean' : elevation > 88 ? 'mountain'
      : latitude > .8 && moisture < .6 ? 'tundra' : moisture > .57 ? 'forest' : moisture < .31 && latitude < .8 ? 'desert' : 'grassland';
    tiles.push({ id: r * width + q, q, r, terrain, elevation, owner: null, resource: null });
  }
  const isolated = tiles.filter(tile => tile.terrain === 'mountain' && !adjacent(tiles, tile, width, height).some(neighbor => neighbor.terrain === 'mountain'));
  for (const tile of isolated) { tile.terrain = 'grassland'; tile.elevation = 85; }
  return tiles;
}

function connectedOpportunities(tiles: HexTile[], capitals: HexTile[], width: number, height: number): boolean {
  const coast = (tile: HexTile): boolean => adjacent(tiles, tile, width, height).some(neighbor => neighbor.terrain === 'ocean');
  const frontier = tiles.filter(tile => tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && capitals.every(capital => hexDistance(tile, capital) >= 2));
  const coastal = createCoastalPlanner({ tiles });
  if (!capitals.filter(coast).every(capital => frontier.some(tile => {
    if (hexDistance(capital, tile) <= 3) return false;
    const quote = coastal.quote(capital.id, tile.id);
    return quote !== null && coastalPathBlock({ tiles }, quote, capital.id, tile.id) === null;
  }))) return false;
  if (!capitals.filter(capital => !coast(capital)).some(capital => {
    const owned = tiles.filter(tile => tile.terrain !== 'ocean' && hexDistance(capital, tile) <= 1);
    return frontier.some(tile => coast(tile) && owned.some(home => hexDistance(home, tile) <= 2));
  })) return false;
  const land = createLandTransportPlanner({ tiles });
  return capitals.some(from => capitals.some(to => {
    const quote = land.quote(from.id, to.id);
    if (!quote || quote.edges < 9) return false;
    const ownedEdges = quote.tileIds.slice(1).filter((id, index) => capitals.some(capital => hexDistance(capital, tiles[id]!) <= 1 && hexDistance(capital, tiles[quote.tileIds[index]!]!) <= 1)).length;
    const weighted = quote.edges - ownedEdges * (INDUSTRIAL_RULES.plainWeight - INDUSTRIAL_RULES.railWeight);
    return Math.max(4, Math.ceil(weighted / INDUSTRIAL_RULES.edgesPerBeat)) < landTransportCadence(4, quote);
  }));
}

function startingSites(tiles: HexTile[], width: number, height: number, seed: number): number[] | null {
  const continent = landmass(tiles, width, height);
  const passable = tiles.filter(tile => tile.terrain !== 'ocean' && tile.terrain !== 'mountain');
  if (continent.size < passable.length * .7 || tiles.filter(isHillSite).length < 32 || tiles.filter(tile => tile.terrain === 'mountain').length < 4) return null;
  const coastal = (tile: HexTile): boolean => adjacent(tiles, tile, width, height).some(neighbor => neighbor.terrain === 'ocean');
  const candidates = tiles.filter(tile => {
    if (tile.terrain !== 'grassland' || !continent.has(tile.id)) return false;
    const nearby = passable.filter(other => continent.has(other.id) && hexDistance(tile, other) <= 3);
    return nearby.length >= 12 && nearby.filter(isHillSite).length >= 3 && nearby.some(other => other.terrain === 'forest')
      && adjacent(tiles, tile, width, height).some(isHillSite);
  });
  const rank = (tile: HexTile): number => hash(seed ^ 0x53544152, tile.q, tile.r);
  const coasts = candidates.filter(coastal).toSorted((a, b) => rank(a) - rank(b));
  for (const first of coasts.slice(0, 24)) {
    const selected = [first];
    while (selected.length < CIV_COUNT) {
      const available = candidates.filter(tile => selected.every(other => hexDistance(tile, other) >= 6));
      const next = available.toSorted((a, b) => {
        const distance = (tile: HexTile): number => Math.min(...selected.map(other => hexDistance(tile, other)));
        return distance(b) - distance(a) || rank(a) - rank(b);
      })[0];
      if (!next) break;
      selected.push(next);
    }
    if (selected.length !== CIV_COUNT || selected.every(coastal)
      || Math.max(...selected.map(tile => tile.r)) - Math.min(...selected.map(tile => tile.r)) < 12) continue;
    const compositions = selected.map(center => ['grassland', 'forest', 'desert', 'tundra', 'mountain', 'ocean'].map(terrain => tiles.filter(tile => tile.terrain === terrain && hexDistance(center, tile) <= 3).length).join(','));
    if (new Set(compositions).size < 3 || !connectedOpportunities(tiles, selected, width, height)) continue;
    return selected.toSorted((a, b) => hash(seed ^ 0x43495653, a.id, 0) - hash(seed ^ 0x43495653, b.id, 0)).map(tile => tile.id);
  }
  return null;
}

function riverOpportunities(tiles: HexTile[], drainage: DrainageLayerV1, capitalTileIds: number[], width: number, height: number): boolean {
  const facts = drainageFacts(drainage, tiles);
  const lengths = Array<number>(tiles.length).fill(0);
  for (const tile of tiles.toSorted((a, b) => a.elevation - b.elevation || a.id - b.id)) {
    const fact = facts[tile.id]!;
    if (fact.downstreamTileId !== null && fact.contributingLandTiles >= RIVER_MINIMUM_CONTRIBUTING_LAND_TILES) lengths[tile.id] = lengths[fact.downstreamTileId]! + 1;
  }
  return lengths.some(length => length >= 4) && capitalTileIds.some(id => adjacent(tiles, tiles[id]!, width, height)
    .some(tile => tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && facts[tile.id]!.contributingLandTiles >= RIVER_MINIMUM_CONTRIBUTING_LAND_TILES));
}

function generateFromCandidates(seed: number, width: number, height: number, candidate: (seed: number, width: number, height: number) => HexTile[]): GeneratedGeography {
  const normalized = normalizeSeed(seed);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 18 || height < 24 || width * height > 4096)
    throw new RangeError('Drainage geography requires integer dimensions of at least 18 × 24 and at most 4096 tiles');
  for (let attempt = 0; attempt < MAXIMUM_ATTEMPTS; attempt++) {
    const candidateSeed = hash(normalized ^ 0x434f4e54, attempt, width * height);
    const conditioned = conditionDrainage(candidate(candidateSeed, width, height), width, height);
    if (!conditioned) continue;
    const { tiles, drainage } = conditioned;
    const capitalTileIds = startingSites(tiles, width, height, candidateSeed);
    if (!capitalTileIds || !riverOpportunities(tiles, drainage, capitalTileIds, width, height)) continue;
    return { version: GENERATED_GEOGRAPHY_VERSION, width, height, tiles, drainage, capitalTileIds, rng: randomStep(candidateSeed).seed };
  }
  throw new RangeError(`No viable ${GENERATED_GEOGRAPHY_VERSION} geography for seed ${normalized} within ${MAXIMUM_ATTEMPTS} attempts`);
}

export function generateGeography(seed: number, width = 18, height = 24): GeneratedGeography {
  return generateFromCandidates(seed, width, height, landscape);
}

export function generateGeographyWithCandidateForTest(seed: number, width: number, height: number, candidate: (seed: number, width: number, height: number) => HexTile[]): GeneratedGeography {
  return generateFromCandidates(seed, width, height, candidate);
}
