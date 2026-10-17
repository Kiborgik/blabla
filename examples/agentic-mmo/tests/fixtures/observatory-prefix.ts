import assert from 'node:assert/strict';
import { hexDistance } from '../../core/simulation/geography.ts';
import { isHillSite } from '../../core/simulation/improvements.ts';
import { foundryProductionOperationJourney } from './foundry-production-journey.ts';

export function observatoryPrefix() {
  const { journey } = foundryProductionOperationJourney(); const seat = 0; const cityId = 'city-0';
  const beforePause = structuredClone(journey.state);
  const city = beforePause.cities.find(candidate => candidate.id === cityId && candidate.civId === seat); assert.ok(city);
  const campusTileId = city.districtSites?.campus; assert.ok(campusTileId !== undefined && city.buildings.includes('campus'));
  const campus = beforePause.tiles.find(tile => tile.id === campusTileId); assert.ok(campus);
  const highGroundTileIds = beforePause.tiles.filter(tile => hexDistance(campus, tile) === 1 && (tile.terrain === 'mountain' || isHillSite(tile))).map(tile => tile.id).toSorted((left, right) => left - right);
  journey.act({ type: 'set-building-operation', cityId, buildingId: 'fuel-yard', enabled: false }, seat);
  const pauseStep = journey.steps.at(-1); assert.ok(pauseStep); const paused = structuredClone(journey.state);
  journey.beat(); const staffedStep = journey.steps.at(-1); assert.ok(staffedStep);
  return { initial: structuredClone(journey.initial), state: structuredClone(journey.state), steps: structuredClone(journey.steps), timestamp: journey.time(), seat, cityId, campusTileId, highGroundTileIds, beforePause, paused, pauseStep: structuredClone(pauseStep), staffedStep: structuredClone(staffedStep) };
}
