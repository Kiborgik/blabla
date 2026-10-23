import assert from 'node:assert/strict';
import { BUILDINGS } from '../../core/content.ts';
import { legalActions } from '../../core/engine.ts';
import { availableDistrictSites } from '../../core/simulation/districts.ts';
import { hexDistance } from '../../core/simulation/geography.ts';
import { freshFixtureJourney, syntheticInstitution, syntheticTechnologies } from './coastal-prefix.ts';
import { waterLandTown } from './water-land-journey.ts';

export function cultureProductionPrefix() {
  const seat = 0; const cityId = 'city-0';
  const journey = freshFixtureJourney('settlement-culture-production-1', state => {
    const actor = state.civilizations[seat]; const city = state.cities[seat]; assert.ok(actor && city);
    actor.era = 2; actor.resources = { food: 100, materials: 140, credits: 100, energy: 30, culture: 0, science: 0 }; city.population = 16;
    state.calendarMilestones = ['first-harvest', 'roads-between-peoples', 'rise-of-states', 'connected-world'];
    syntheticTechnologies(state, seat, ['education', 'machinery']);
    syntheticInstitution(state, cityId, 'campus', 39); syntheticInstitution(state, cityId, 'library');
  }, 'Synthetic era, stocks, residents, prerequisite learning and Campus/Library site; Great library, second-town founding, Construction, Theater, Printing and Printing house are actual paid gameplay');
  const campus = BUILDINGS.find(building => building.id === 'campus'); assert.ok(campus);
  const sites = availableDistrictSites(journey.state, waterLandTown(journey.state, cityId), campus);
  const adjacent = (left: number, right: number): boolean => { const a = journey.state.tiles.find(tile => tile.id === left); const b = journey.state.tiles.find(tile => tile.id === right); assert.ok(a && b); return hexDistance(a, b) === 1; };
  const wonder = legalActions(journey.state, seat, journey.time()).find(option => {
    const action = option.action;
    return action.type === 'build-wonder' && action.cityId === cityId && sites.some(tileId => tileId !== action.tileId && adjacent(tileId, action.tileId));
  });
  assert.ok(wonder?.action.type === 'build-wonder'); const wonderTileId = wonder.action.tileId;
  const theaterTileId = sites.find(tileId => tileId !== wonderTileId && adjacent(tileId, wonderTileId)); assert.ok(theaterTileId !== undefined);
  journey.act(wonder.action); const wonderActive = structuredClone(journey.state);
  journey.until(() => !!journey.state.wonders?.['great-library']); const wonderCompleted = structuredClone(journey.state);
  journey.act({ type: 'settle', sourceCityId: cityId, tileId: 23 });
  const alternateCity = journey.state.cities.find(city => city.civId === seat && city.tileId === 23); assert.ok(alternateCity);
  return { ...journey, cityId, alternateCityId: alternateCity.id, wonderTileId, theaterTileId, wonderActive, wonderCompleted, get state() { return journey.state; } };
}

export function cultureProductionJourney() {
  const journey = cultureProductionPrefix(); const prepared = structuredClone(journey.state);
  return { journey, prepared };
}

export function cultureProductionOperationJourney() {
  const { journey, prepared } = cultureProductionJourney();
  journey.research('construction'); const constructionReady = structuredClone(journey.state);
  journey.act({ type: 'build', project: 'theater-square', cityId: journey.cityId, tileId: journey.theaterTileId }); const theaterActive = structuredClone(journey.state);
  journey.until(() => waterLandTown(journey.state, journey.cityId).buildings.includes('theater-square'));
  const theaterCompleted = structuredClone(journey.state); const theaterCompletionStep = journey.steps.at(-1); assert.ok(theaterCompletionStep);
  journey.beat(); const theaterOperated = structuredClone(journey.state);
  journey.research('printing'); const printingReady = structuredClone(journey.state);
  journey.act({ type: 'build', project: 'printing-house', cityId: journey.cityId }); const printingActive = structuredClone(journey.state);
  journey.until(() => waterLandTown(journey.state, journey.cityId).buildings.includes('printing-house'));
  const printingCompleted = structuredClone(journey.state); journey.beat(); const operated = structuredClone(journey.state);
  return { journey, prepared, constructionReady, theaterActive, theaterCompleted, theaterCompletionStep, theaterOperated, printingReady, printingActive, printingCompleted, operated };
}
