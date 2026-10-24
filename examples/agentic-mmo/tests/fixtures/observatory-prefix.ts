import assert from 'node:assert/strict';
import { hexDistance } from '../../core/simulation/geography.ts';
import { isHillSite } from '../../core/simulation/improvements.ts';
import { freshFixtureJourney, syntheticInstitution, syntheticTechnologies } from './coastal-prefix.ts';

export function observatoryPrefix() {
  const seat = 0; const cityId = 'city-0'; const campusTileId = 39;
  const journey = freshFixtureJourney('settlement-observatory-1', state => {
    const actor = state.civilizations[seat]; const city = state.cities[seat]; assert.ok(actor && city);
    actor.era = 2; actor.resources = { food: 100, materials: 80, credits: 100, energy: 30, culture: 40, science: 0 }; city.population = 12;
    state.calendarMilestones = ['first-harvest', 'roads-between-peoples', 'rise-of-states', 'connected-world'];
    syntheticTechnologies(state, seat, ['mathematics', 'fuel-management', 'water-management', 'mining']);
    for (const building of ['campus', 'library', 'fuel-yard']) syntheticInstitution(state, cityId, building, building === 'campus' ? campusTileId : undefined);
  }, 'Synthetic era, stocks, residents, prerequisite learning, Campus/Library/Fuel yard and exact high-ground site; Mine58 construction, pause, research and Observatory commitment are real');
  journey.act({ type: 'improve', cityId, tileId: 58, improvementId: 'mine' });
  journey.until(() => !!journey.state.cities.find(city => city.id === cityId)?.improvements?.['58']);
  const beforePause = structuredClone(journey.state); const campus = beforePause.tiles.find(tile => tile.id === campusTileId); assert.ok(campus);
  const highGroundTileIds = beforePause.tiles.filter(tile => hexDistance(campus, tile) === 1 && (tile.terrain === 'mountain' || isHillSite(tile))).map(tile => tile.id).toSorted((left,right)=>left-right);
  journey.act({ type: 'set-building-operation', cityId, buildingId: 'fuel-yard', enabled: false });
  const pauseStep = journey.steps.at(-1); assert.ok(pauseStep); const paused = structuredClone(journey.state);
  journey.beat(); const staffedStep = journey.steps.at(-1); assert.ok(staffedStep);
  return { initial: journey.initial, state: journey.state, steps: journey.steps, timestamp: journey.time(), seat, cityId, campusTileId, highGroundTileIds, beforePause, paused, pauseStep, staffedStep, provenance: journey.provenance };
}
