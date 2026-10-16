import { METAL_RULES } from '../content.ts';
import type { City, HexTile, Observation, StrategicDepositLayer, WorldState } from '../types.ts';
import { hexDistance } from './geography.ts';
import { hasFeatures } from './history.ts';
import { isHillSite, orderedImprovements } from './improvements.ts';
import { citiesOf, civilizationById } from './world.ts';

function placementRank(seed: number, tileId: number): number {
  let value = (seed ^ Math.imul(tileId + 1, METAL_RULES.placement.seedMultiplier)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), METAL_RULES.placement.mixMultipliers[0]) >>> 0;
  value = Math.imul(value ^ (value >>> 15), METAL_RULES.placement.mixMultipliers[1]) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

export function createStrategicDeposits(state: WorldState): StrategicDepositLayer {
  const occupied = new Set(state.cities.flatMap(city => [city.tileId, ...Object.values(city.districtSites ?? {}), ...(city.construction?.active?.tileId === undefined || ('kind' in city.construction.active && city.construction.active.kind === 'improvement' && city.construction.active.improvementId === 'mine') ? [] : [city.construction.active.tileId])]));
  const candidates = state.tiles.filter(tile => isHillSite(tile) && tile.resource === null && !occupied.has(tile.id))
    .toSorted((left, right) => placementRank(state.seed, left.id) - placementRank(state.seed, right.id) || left.id - right.id);
  const selected: HexTile[] = [];
  const available = (tile: HexTile): boolean => selected.every(other => hexDistance(tile, other) >= METAL_RULES.placement.frontierMinimumDistance);
  for (const civilization of state.civilizations.toSorted((left, right) => left.id - right.id)) {
    const centers = citiesOf(state, civilization.id).map(city => state.tiles.find(tile => tile.id === city.tileId)).filter((tile): tile is HexTile => tile !== undefined);
    const candidate = candidates.find(tile => tile.owner === civilization.id && available(tile) && centers.some(center => hexDistance(center, tile) <= METAL_RULES.placement.ownedSiteRange));
    if (candidate && selected.length < METAL_RULES.placement.maximumDeposits) selected.push(candidate);
  }
  for (const candidate of candidates) {
    if (selected.length >= METAL_RULES.placement.maximumDeposits) break;
    if (available(candidate)) selected.push(candidate);
  }
  return {
    ruleVersion: METAL_RULES.ruleVersion, placementId: METAL_RULES.placement.id, seed: state.seed, tileIds: selected.map(tile => tile.id),
    deposits: Object.fromEntries(selected.map(tile => [String(tile.id), { tileId: tile.id, resource: METAL_RULES.resource, initialReserve: METAL_RULES.initialReserve, remaining: METAL_RULES.initialReserve }])),
  };
}

export function strategicCapacity(state: WorldState, civilizationId: number): number {
  return citiesOf(state, civilizationId).length * METAL_RULES.capacityPerCity;
}

export function observedStrategicResources(state: WorldState, civilizationId: number): Pick<Observation, 'strategicResources' | 'strategicCapacity' | 'revealedDeposits'> {
  if (!hasFeatures(state, [METAL_RULES.featureId])) return {};
  const civilization = state.civilizations.find(candidate => candidate.id === civilizationId);
  if (!civilization) return {};
  return structuredClone({
    strategicResources: civilization.strategicResources ?? {}, strategicCapacity: strategicCapacity(state, civilizationId),
    revealedDeposits: civilization.technologies.includes(METAL_RULES.revealTechnology) ? Object.values(state.strategicDeposits?.deposits ?? {}).toSorted((left, right) => left.tileId - right.tileId) : [],
  });
}

export function extractCityMetals(state: WorldState, city: City): void {
  if (!hasFeatures(state, [METAL_RULES.featureId])) return;
  const civilization = civilizationById(state, city.civId);
  for (const improvement of orderedImprovements(city)) {
    const result = improvement.operation.lastResult;
    const deposit = state.strategicDeposits?.deposits[String(improvement.tileId)];
    if (improvement.improvementId !== 'mine' || result?.status !== 'operated' || !deposit) continue;
    const capacity = strategicCapacity(state, city.civId);
    const stockBefore = civilization.strategicResources?.[deposit.resource] ?? 0;
    const reserveBefore = deposit.remaining;
    const status = !civilization.technologies.includes(METAL_RULES.revealTechnology) ? 'unrevealed' : reserveBefore === 0 ? 'exhausted' : stockBefore >= capacity ? 'storage-full' : 'extracted';
    const quantity = status === 'extracted' ? Math.min(METAL_RULES.extractionPerBeat, reserveBefore, Math.max(0, capacity - stockBefore)) : 0;
    deposit.remaining -= quantity;
    if (quantity > 0) { civilization.strategicResources ??= {}; civilization.strategicResources[deposit.resource] = stockBefore + quantity; }
    result.extraction = { ruleVersion: METAL_RULES.ruleVersion, tileId: improvement.tileId, round: state.round, resource: deposit.resource, quantity, reserveBefore, reserveAfter: deposit.remaining, stockBefore, stockAfter: stockBefore + quantity, capacity, status };
  }
}
