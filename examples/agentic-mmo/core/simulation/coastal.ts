import { ACTION_FEATURES, BUILDINGS, COASTAL_FOUNDING_RULES, ECONOMY_RULES, RESOURCE_IDS } from '../content.ts';
import type { ActionOption, BuildingCapability, City, CoastalFoundingQuote, GameEvent, HexTile, Resources, WorldState } from '../types.ts';
import { hexDistance } from './geography.ts';
import { hasFeatures } from './history.ts';
import { canAfford, citiesOf, civilizationById, transferCost } from './world.ts';
import { describeSettlementSite } from './sites.ts';
import { emitEvent } from './events.ts';

export function isCoastalSite(state: Pick<WorldState, 'tiles'>, tileId: number): boolean {
  const site = state.tiles.find(tile => tile.id === tileId);
  return !!site && site.terrain !== 'ocean' && site.terrain !== 'mountain' && state.tiles.some(tile => tile.terrain === 'ocean' && hexDistance(site, tile) === 1);
}

export function cityHasCapability(city: City, capability: BuildingCapability): boolean {
  return BUILDINGS.some(building => city.buildings.includes(building.id) && building.capabilities?.includes(capability));
}

export function foundingSourceEligible(city: City): boolean {
  return city.population >= ECONOMY_RULES.settle.population + ECONOMY_RULES.settle.minimumSourcePopulation;
}

export function foundingSiteEligible(state: WorldState, tile: HexTile): boolean {
  return tile.owner === null && tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && !state.cities.some(city => {
    const site = state.tiles.find(candidate => candidate.id === city.tileId);
    return site !== undefined && hexDistance(site, tile) < 2;
  });
}

export function foundSettlement(state: WorldState, seat: number, tile: HexTile, source: City | undefined, conserved: boolean): City {
  if (conserved && (!source || source.civId !== seat || !foundingSourceEligible(source))) throw new RangeError('Founding requires an owned source with enough people to preserve its minimum population');
  if (conserved && source) source.population -= ECONOMY_RULES.settle.population;
  const civilization = civilizationById(state, seat);
  transferCost(civilization.resources, ECONOMY_RULES.settle.cost);
  tile.owner = seat;
  const city: City = {
    id: `city-${seat}-${state.revision}`, name: `${civilization.name} ${citiesOf(state, seat).length + 1}`,
    civId: seat, tileId: tile.id, ...ECONOMY_RULES.initialCity,
    population: ECONOMY_RULES.settle.population, focus: source?.focus ?? 'growth', buildings: [],
  };
  state.cities.push(city);
  return city;
}

export function isCoastalFoundingQuote(value: unknown, maxTiles: number): value is CoastalFoundingQuote {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (Object.keys(value).length !== 4 || !('mode' in value) || value.mode !== 'coast' || !('ruleVersion' in value) || value.ruleVersion !== 1
    || !('tileIds' in value) || !Array.isArray(value.tileIds) || value.tileIds.length < 3 || value.tileIds.length > maxTiles
    || !('edges' in value) || value.edges !== value.tileIds.length - 1) return false;
  const ids: unknown[] = value.tileIds;
  for (let index = 0; index < ids.length; index++) if (!Object.hasOwn(ids, index) || !Number.isSafeInteger(ids[index]) || Number(ids[index]) < 0) return false;
  return new Set(ids).size === ids.length;
}

export function coastalTopologyBlock(state: Pick<WorldState, 'tiles'>, quote: CoastalFoundingQuote, fromTileId: number, toTileId: number): string | null {
  if (!isCoastalFoundingQuote(quote, state.tiles.length)) return 'Coastal quote has malformed or unsupported path data';
  if (quote.tileIds[0] !== fromTileId || quote.tileIds.at(-1) !== toTileId) return 'Coastal quote does not match the exact endpoint tiles';
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  let previous: HexTile | undefined;
  for (const id of quote.tileIds) {
    const tile = tiles.get(id);
    if (!tile) return `Coastal quote tile ${id} is missing`;
    if (previous && hexDistance(previous, tile) !== 1) return `Coastal quote hop to tile ${id} is not adjacent`;
    previous = tile;
  }
  return null;
}

export function coastalPathBlock(state: Pick<WorldState, 'tiles'>, quote: CoastalFoundingQuote, fromTileId: number, toTileId: number): string | null {
  const topology = coastalTopologyBlock(state, quote, fromTileId, toTileId);
  if (topology) return topology;
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  for (const [index, id] of quote.tileIds.entries()) {
    const tile = tiles.get(id);
    if (!tile) return `Coastal quote tile ${id} is missing`;
    const endpoint = index === 0 || index === quote.tileIds.length - 1;
    if (endpoint ? tile.terrain === 'ocean' || tile.terrain === 'mountain' : tile.terrain !== 'ocean') return `Coastal quote tile ${id} does not match its land endpoint or ocean interior role`;
  }
  return null;
}

export function createCoastalPlanner(state: Pick<WorldState, 'tiles'>) {
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const coordinates = new Map(state.tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
  const adjacent = (tile: HexTile): HexTile[] => [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]
    .flatMap(([q, r]) => { const next = coordinates.get(`${tile.q + (q ?? 0)},${tile.r + (r ?? 0)}`); return next ? [next] : []; }).toSorted((left, right) => left.id - right.id);
  const trees = new Map<number, Map<number, number | null>>();
  const work = { trees: 0, visitedTiles: 0 };
  const quote = (fromTileId: number, toTileId: number): CoastalFoundingQuote | null => {
    const target = tiles.get(toTileId);
    if (!target || target.terrain === 'ocean' || target.terrain === 'mountain' || fromTileId === toTileId) return null;
    let tree = trees.get(fromTileId);
    if (!tree) {
      tree = new Map(); trees.set(fromTileId, tree); work.trees++;
      const source = tiles.get(fromTileId);
      if (source && source.terrain !== 'ocean' && source.terrain !== 'mountain') {
        const queue = [source]; tree.set(source.id, null);
        for (let index = 0; index < queue.length; index++) {
          const current = queue[index]; if (!current) continue;
          work.visitedTiles++;
          for (const next of adjacent(current)) {
            if (next.terrain !== 'ocean' || tree.has(next.id)) continue;
            tree.set(next.id, current.id); queue.push(next);
          }
        }
      }
    }
    let best: number[] | null = null;
    for (const ocean of adjacent(target).filter(tile => tile.terrain === 'ocean' && tree.has(tile.id))) {
      const path = [target.id];
      let current: number | null | undefined = ocean.id;
      while (current !== null && current !== undefined) { path.push(current); current = tree.get(current); }
      path.reverse();
      if (!best || path.length < best.length) best = path;
    }
    return best ? { mode: 'coast', ruleVersion: COASTAL_FOUNDING_RULES.ruleVersion, tileIds: best, edges: best.length - 1 } : null;
  };
  return { quote, work };
}

export function coastalSourceBlock(state: WorldState, seat: number, sourceCityId: string): string | null {
  if (!hasFeatures(state, ACTION_FEATURES['settle-coast'])) return 'Coastal founding is not released';
  const civilization = state.civilizations.find(candidate => candidate.id === seat);
  if (!civilization?.technologies.includes(COASTAL_FOUNDING_RULES.requiredTechnology)) return `Requires ${COASTAL_FOUNDING_RULES.requiredTechnology}`;
  const source = state.cities.find(city => city.id === sourceCityId && city.civId === seat);
  if (!source) return 'Requires the exact existing owned departure town';
  if (!cityHasCapability(source, COASTAL_FOUNDING_RULES.requiredBuildingCapability)) return 'Requires a completed coastal-departure building; active construction is not ready';
  if (!isCoastalSite(state, source.tileId)) return 'Departure town must border actual ocean';
  if (!foundingSourceEligible(source)) return `Requires ${ECONOMY_RULES.settle.population} people to move and ${ECONOMY_RULES.settle.minimumSourcePopulation} to remain`;
  if (!canAfford(civilization.resources, ECONOMY_RULES.settle.cost)) return 'Insufficient shared founding supplies';
  return null;
}

export function availableCoastalActions(state: WorldState, seat: number): ActionOption[] {
  if (!hasFeatures(state, ACTION_FEATURES['settle-coast'])) return [];
  const cost: Partial<Resources> = ECONOMY_RULES.settle.cost;
  const planner = createCoastalPlanner(state);
  const options: ActionOption[] = [];
  for (const source of citiesOf(state, seat)) {
    if (coastalSourceBlock(state, seat, source.id)) continue;
    for (const tile of state.tiles) {
      if (!foundingSiteEligible(state, tile)) continue;
      const quote = planner.quote(source.tileId, tile.id);
      if (!quote) continue;
      options.push({ action: { type: 'settle-coast', sourceCityId: source.id, tileId: tile.id }, coastalQuote: quote,
        label: `Found coastal settlement at ${tile.q}, ${tile.r} from ${source.name}`,
        reason: `Transfer ${ECONOMY_RULES.settle.population} people; at least ${ECONOMY_RULES.settle.minimumSourcePopulation} remain. Pay ${RESOURCE_IDS.filter(resource => (cost[resource] ?? 0) > 0).map(resource => `${cost[resource]} ${resource}`).join(', ')}. Ocean path ${quote.tileIds.join(' → ')}; ${quote.edges} edges. Found immediately on acceptance; no travel timer. ${describeSettlementSite(state, tile)}` });
    }
  }
  return options;
}

export function executeCoastalFounding(state: WorldState, seat: number, sourceCityId: string, tileId: number, events: GameEvent[]): void {
  const block = coastalSourceBlock(state, seat, sourceCityId);
  const source = state.cities.find(city => city.id === sourceCityId && city.civId === seat);
  const tile = state.tiles.find(candidate => candidate.id === tileId);
  const quote = source ? createCoastalPlanner(state).quote(source.tileId, tileId) : null;
  if (block || !source || !tile || !foundingSiteEligible(state, tile) || !quote) throw new RangeError(block ?? 'Exact coastal site or ocean path is unavailable');
  const city = foundSettlement(state, seat, tile, source, true);
  const cost: Partial<Resources> = ECONOMY_RULES.settle.cost;
  const event = emitEvent(state, events, { type: 'coastal-founded', title: `${city.name} is founded by a coastal expedition`, detail: `From ${source.id} along ${quote.tileIds.join(' → ')}`, actor: seat, target: seat, tileId,
    cause: 'Navigation and an installed coastal departure capability enabled an exact conserved founding',
    effects: [...RESOURCE_IDS.filter(resource => (cost[resource] ?? 0) > 0).map(resource => `Paid ${cost[resource]} ${resource}`), `Source ${source.id} population -${ECONOMY_RULES.settle.population}; ${source.population} remain`, `Population ${city.population}`, `Tile ${tileId} belongs to ${civilizationById(state, seat).name}`], importance: 4 });
  city.coastalFounding = { ruleVersion: COASTAL_FOUNDING_RULES.ruleVersion, sourceCityId, sourceTileId: source.tileId, destinationTileId: tileId, pathTileIds: [...quote.tileIds], population: ECONOMY_RULES.settle.population, paid: structuredClone(ECONOMY_RULES.settle.cost), foundedRound: state.round, eventId: event.id };
  event.coastalFounding = structuredClone(city.coastalFounding);
}
