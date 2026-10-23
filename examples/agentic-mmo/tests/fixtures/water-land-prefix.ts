import assert from 'node:assert/strict';
import { initializeCityHousing } from '../../core/simulation/growth.ts';
import { districtSiteOccupied } from '../../core/simulation/districts.ts';
import { hexDistance } from '../../core/simulation/geography.ts';
import { freshFixtureJourney, syntheticInstitution, syntheticTechnologies } from './coastal-prefix.ts';

export function waterLandPrefix(rulesId = 'settlement-water-land-1') {
  const journey = freshFixtureJourney(rulesId, state => {
    state.calendarMilestones = ['first-harvest', 'roads-between-peoples', 'rise-of-states'];
    for (const seat of [0, 1]) {
      const actor = state.civilizations[seat]; const city = state.cities[seat]; assert.ok(actor && city);
      actor.era = 1; actor.resources = { food: 120, materials: 100, credits: 100, energy: 40, culture: 0, science: 0 }; city.population = 12;
      syntheticTechnologies(state, seat, ['writing', 'kiln-firing', 'mining']);
      syntheticInstitution(state, city.id, 'campus', seat === 0 ? 39 : undefined); syntheticInstitution(state, city.id, 'library');
    }
    syntheticTechnologies(state, 0, ['water-management', 'masonry']); syntheticInstitution(state, 'city-0', 'irrigation');
    const capital = state.cities[0]; const site = state.tiles.find(tile => tile.id === 23); assert.ok(capital && site);
    const catchment = { id: 'synthetic-catchment-town', name: 'Synthetic catchment prerequisite', civId: 0, tileId: 23, population: 8, wellbeing: 65, infrastructure: 1, damage: 0, focus: capital.focus, buildings: [] };
    state.cities.push(catchment); initializeCityHousing(state, catchment, 'founded'); site.owner = 0;
  }, 'Synthetic era, stocks, population, prior learning, Campus/Library/Irrigation sites and mountain-adjacent town; Pasture, Water mill and Aqueduct actions are real');
  const state = journey.state; const catchmentCity = state.cities.find(city => city.id === 'synthetic-catchment-town'); assert.ok(catchmentCity);
  const center = state.tiles.find(tile => tile.id === catchmentCity.tileId); assert.ok(center);
  const mountainTileIds = state.tiles.filter(tile => tile.terrain === 'mountain' && hexDistance(tile, center) === 1).map(tile => tile.id).toSorted((a,b) => a-b); assert.ok(mountainTileIds.length);
  const pastureCity = state.cities[1]; assert.ok(pastureCity); const pastureCenter = state.tiles.find(tile => tile.id === pastureCity.tileId); assert.ok(pastureCenter);
  const candidateTileIds = state.tiles.filter(tile => tile.owner === 1 && tile.terrain === 'grassland' && hexDistance(tile, pastureCenter) <= 3 && !state.cities.some(city => city.tileId === tile.id) && !districtSiteOccupied(state, tile.id)).map(tile => tile.id);
  const tileId = state.pastoralSites?.tileIds.find(id => candidateTileIds.includes(id)); assert.ok(tileId !== undefined);
  return structuredClone({ initial: journey.initial, state, steps: journey.steps, timestamp: journey.time(), pasture: { seat: 1, cityId: pastureCity.id, tileId, candidateTileIds }, mill: { seat: 0, cityId: 'city-0', irrigation: null }, aqueduct: { seat: 0, cityId: catchmentCity.id, mountainTileIds }, provenance: journey.provenance });
}
