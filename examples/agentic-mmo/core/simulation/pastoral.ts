import { PASTORAL_RULES } from '../content.ts';
import type { HexTile, Observation, PastoralSiteLayer, WorldState } from '../types.ts';
import { districtSiteOccupied } from './districts.ts';
import { hexDistance } from './geography.ts';
import { hasFeatures } from './history.ts';
import { sitePlacementRank } from './site-placement.ts';
import { citiesOf } from './world.ts';

export function createPastoralSites(state: WorldState): PastoralSiteLayer {
  const rules = PASTORAL_RULES.placement;
  const rank = (tileId: number): number => sitePlacementRank(state.seed, tileId, rules.seedMultiplier, rules.mixMultipliers, rules.seedSalt);
  const centers = new Set(state.cities.map(city => city.tileId));
  const candidates = state.tiles.filter(tile => tile.terrain === 'grassland' && tile.resource === null && !centers.has(tile.id) && !districtSiteOccupied(state, tile.id) && !state.strategicDeposits?.deposits[String(tile.id)])
    .toSorted((left, right) => rank(left.id) - rank(right.id) || left.id - right.id);
  const selected: HexTile[] = [];
  const available = (tile: HexTile): boolean => selected.every(other => hexDistance(tile, other) >= rules.frontierMinimumDistance);
  for (const civilization of state.civilizations.toSorted((left, right) => left.id - right.id)) {
    const towns = citiesOf(state, civilization.id).map(city => state.tiles.find(tile => tile.id === city.tileId)).filter((tile): tile is HexTile => tile !== undefined);
    const candidate = candidates.find(tile => tile.owner === civilization.id && available(tile) && towns.some(center => hexDistance(center, tile) <= rules.ownedSiteRange));
    if (candidate && selected.length < rules.maximumSites) selected.push(candidate);
  }
  for (const candidate of candidates) {
    if (selected.length >= rules.maximumSites) break;
    if (available(candidate)) selected.push(candidate);
  }
  return {
    ruleVersion: PASTORAL_RULES.ruleVersion, placementId: rules.id, seed: state.seed, tileIds: selected.map(tile => tile.id),
    sites: Object.fromEntries(selected.map(tile => [String(tile.id), { tileId: tile.id, resource: PASTORAL_RULES.resource }])),
  };
}

export function revealedHorseSite(state: WorldState, civilizationId: number, tileId: number): boolean {
  return hasFeatures(state, [PASTORAL_RULES.featureId]) && !!state.civilizations.find(civilization => civilization.id === civilizationId)?.technologies.includes(PASTORAL_RULES.revealTechnology) && state.pastoralSites?.sites[String(tileId)]?.resource === PASTORAL_RULES.resource;
}

export function observedPastoralSites(state: WorldState, civilizationId: number): Pick<Observation, 'revealedPastoralSites'> {
  if (!hasFeatures(state, [PASTORAL_RULES.featureId])) return {};
  const civilization = state.civilizations.find(candidate => candidate.id === civilizationId);
  if (!civilization) return {};
  return { revealedPastoralSites: civilization.technologies.includes(PASTORAL_RULES.revealTechnology) ? structuredClone(Object.values(state.pastoralSites?.sites ?? {}).toSorted((left, right) => left.tileId - right.tileId)) : [] };
}
