import assert from 'node:assert/strict';
import { districtSiteOccupied } from '../../core/simulation/districts.ts';
import { hexDistance } from '../../core/simulation/geography.ts';
import { isWorldState } from '../../core/validation.ts';
import { localGrowthOperationJourney } from './local-growth-journey.ts';

export function waterLandPrefix() {
  const growth = localGrowthOperationJourney();
  const state = growth.operated;
  const pastureCity = state.cities.find(city => city.id === 'city-1'); assert.ok(pastureCity);
  const pastureCenter = state.tiles.find(tile => tile.id === pastureCity.tileId); assert.ok(pastureCenter);
  const pastureCandidates = state.tiles.filter(tile => tile.owner === pastureCity.civId && tile.terrain === 'grassland' && hexDistance(tile, pastureCenter) <= 3 && !state.cities.some(city => city.tileId === tile.id) && !districtSiteOccupied(state, tile.id)).map(tile => tile.id).toSorted((a, b) => a - b);
  const tileId = pastureCandidates[0]; assert.equal(tileId, 47);
  const millCity = state.cities.find(city => city.id === 'city-0'); assert.ok(millCity); assert.ok(millCity.buildings.includes('irrigation'));
  const catchmentCity = state.cities.find(city => city.id === 'city-0-14'); assert.ok(catchmentCity);
  const catchmentCenter = state.tiles.find(tile => tile.id === catchmentCity.tileId); assert.ok(catchmentCenter);
  const mountainTileIds = state.tiles.filter(tile => tile.terrain === 'mountain' && hexDistance(tile, catchmentCenter) === 1).map(tile => tile.id).toSorted((a, b) => a - b);
  assert.ok(mountainTileIds.length > 0); assert.ok(isWorldState(state));
  return structuredClone({
    initial: growth.journey.initial, state, steps: growth.journey.steps, timestamp: growth.journey.time(),
    pasture: { seat: pastureCity.civId, cityId: pastureCity.id, tileId, candidateTileIds: pastureCandidates },
    mill: { seat: millCity.civId, cityId: millCity.id, irrigation: millCity.buildingOperations?.irrigation?.lastResult },
    aqueduct: { seat: catchmentCity.civId, cityId: catchmentCity.id, mountainTileIds },
    provenance: 'Entirely legal 217-transition local-growth predecessor; grassland is candidate geography, not a retained or revealed horse deposit',
  });
}
