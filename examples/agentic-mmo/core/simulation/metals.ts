import { COAL_RULES, METAL_RULES, STRATEGIC_RESOURCE_RULES } from '../content.ts';
import type { City, HexTile, Observation, StrategicDepositLayer, StrategicResource, WorldState } from '../types.ts';
import { hexDistance } from './geography.ts';
import { hasFeatures } from './history.ts';
import { isHillSite, orderedImprovements } from './improvements.ts';
import { citiesOf, civilizationById } from './world.ts';
import { sitePlacementRank } from './site-placement.ts';

type DepositRules = typeof METAL_RULES | typeof COAL_RULES;

function placementRank(seed: number, tileId: number, rules: DepositRules): number {
  return sitePlacementRank(rules.resource === 'coal' ? seed ^ rules.placement.seedSalt : seed, tileId, rules.placement.seedMultiplier, rules.placement.mixMultipliers);
}

function createDepositLayer(state: WorldState, rules: DepositRules): StrategicDepositLayer {
  const occupied = new Set(state.cities.flatMap(city => [city.tileId, ...Object.values(city.districtSites ?? {}), ...(city.construction?.active?.tileId === undefined || ('kind' in city.construction.active && city.construction.active.kind === 'improvement' && city.construction.active.improvementId === 'mine') ? [] : [city.construction.active.tileId])]));
  if (rules.resource === 'coal') for (const tileId of [...Object.values(state.wonders ?? {}).map(wonder => wonder.completion.tileId), ...state.cities.flatMap(city => Object.values(city.improvements ?? {}).filter(item => item.improvementId !== 'mine').map(item => item.tileId))]) occupied.add(tileId);
  if (rules.resource === 'coal') for (const tileId of [...(state.strategicDeposits?.tileIds ?? []), ...(state.pastoralSites?.tileIds ?? [])]) occupied.add(tileId);
  const candidates = state.tiles.filter(tile => isHillSite(tile) && tile.resource === null && !occupied.has(tile.id))
    .toSorted((left, right) => placementRank(state.seed, left.id, rules) - placementRank(state.seed, right.id, rules) || left.id - right.id);
  const selected: HexTile[] = [];
  const available = (tile: HexTile): boolean => selected.every(other => hexDistance(tile, other) >= rules.placement.frontierMinimumDistance);
  for (const civilization of state.civilizations.toSorted((left, right) => left.id - right.id)) {
    const centers = citiesOf(state, civilization.id).map(city => state.tiles.find(tile => tile.id === city.tileId)).filter((tile): tile is HexTile => tile !== undefined);
    const candidate = candidates.find(tile => tile.owner === civilization.id && available(tile) && centers.some(center => hexDistance(center, tile) <= rules.placement.ownedSiteRange));
    if (candidate && selected.length < rules.placement.maximumDeposits) selected.push(candidate);
  }
  for (const candidate of candidates) {
    if (selected.length >= rules.placement.maximumDeposits) break;
    if (available(candidate)) selected.push(candidate);
  }
  return {
    ruleVersion: rules.ruleVersion, placementId: rules.placement.id, seed: state.seed, tileIds: selected.map(tile => tile.id),
    deposits: Object.fromEntries(selected.map(tile => [String(tile.id), { tileId: tile.id, resource: rules.resource, initialReserve: rules.initialReserve, remaining: rules.initialReserve }])),
  };
}

export function createStrategicDeposits(state: WorldState): StrategicDepositLayer { return createDepositLayer(state, METAL_RULES); }
export function createCoalDeposits(state: WorldState): StrategicDepositLayer { return createDepositLayer(state, COAL_RULES); }

export function strategicCapacity(state: WorldState, civilizationId: number, resource: StrategicResource = 'iron'): number {
  return citiesOf(state, civilizationId).length * STRATEGIC_RESOURCE_RULES[resource].capacityPerCity;
}

export function observedStrategicResources(state: WorldState, civilizationId: number): Pick<Observation, 'strategicResources' | 'strategicCapacity' | 'strategicCapacities' | 'revealedDeposits'> {
  if (!hasFeatures(state, [METAL_RULES.featureId])) return {};
  const civilization = state.civilizations.find(candidate => candidate.id === civilizationId);
  if (!civilization) return {};
  return structuredClone({
    strategicResources: civilization.strategicResources ?? {}, strategicCapacity: strategicCapacity(state, civilizationId),
    ...(hasFeatures(state, [COAL_RULES.featureId]) ? { strategicCapacities: { iron: strategicCapacity(state, civilizationId), coal: strategicCapacity(state, civilizationId, 'coal') } } : {}),
    revealedDeposits: [state.strategicDeposits, ...(hasFeatures(state, [COAL_RULES.featureId]) ? [state.coalDeposits] : [])].flatMap(layer => Object.values(layer?.deposits ?? {})).filter(deposit => civilization.technologies.includes(STRATEGIC_RESOURCE_RULES[deposit.resource].revealTechnology)).toSorted((left, right) => left.tileId - right.tileId),
  });
}

export function extractCityMetals(state: WorldState, city: City): void {
  if (!hasFeatures(state, [METAL_RULES.featureId])) return;
  const civilization = civilizationById(state, city.civId);
  for (const improvement of orderedImprovements(city)) {
    const result = improvement.operation.lastResult;
    const deposit = state.strategicDeposits?.deposits[String(improvement.tileId)] ?? (hasFeatures(state, [COAL_RULES.featureId]) ? state.coalDeposits?.deposits[String(improvement.tileId)] : undefined);
    if (improvement.improvementId !== 'mine' || result?.status !== 'operated' || !deposit) continue;
    const rules = STRATEGIC_RESOURCE_RULES[deposit.resource];
    const capacity = strategicCapacity(state, city.civId, deposit.resource);
    const stockBefore = civilization.strategicResources?.[deposit.resource] ?? 0;
    const reserveBefore = deposit.remaining;
    const status = !civilization.technologies.includes(rules.revealTechnology) ? 'unrevealed' : reserveBefore === 0 ? 'exhausted' : stockBefore >= capacity ? 'storage-full' : 'extracted';
    const quantity = status === 'extracted' ? Math.min(rules.extractionPerBeat, reserveBefore, Math.max(0, capacity - stockBefore)) : 0;
    deposit.remaining -= quantity;
    if (quantity > 0) { civilization.strategicResources ??= {}; civilization.strategicResources[deposit.resource] = stockBefore + quantity; }
    result.extraction = { ruleVersion: METAL_RULES.ruleVersion, tileId: improvement.tileId, round: state.round, resource: deposit.resource, quantity, reserveBefore, reserveAfter: deposit.remaining, stockBefore, stockAfter: stockBefore + quantity, capacity, status };
  }
}
