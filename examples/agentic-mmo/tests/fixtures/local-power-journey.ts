import assert from 'node:assert/strict';
import { freshFixtureJourney, syntheticInstitution, syntheticTechnologies } from './coastal-prefix.ts';

export function localPowerJourney(rulesId = 'settlement-local-power-1') {
  const journey = freshFixtureJourney(rulesId, state => {
    const actor = state.civilizations[0]; const city = state.cities[0]; assert.ok(actor && city);
    actor.era = 3; actor.resources = { food: 100, materials: 160, credits: 140, energy: 30, culture: 0, science: 0 }; city.population = 16;
    state.calendarMilestones = ['first-harvest', 'roads-between-peoples', 'rise-of-states', 'connected-world'];
    syntheticTechnologies(state, 0, ['industrialization']);
    syntheticInstitution(state, city.id, 'campus', 39); syntheticInstitution(state, city.id, 'library'); syntheticInstitution(state, city.id, 'industrial-zone', 40);
  }, 'Synthetic era-three prerequisite learning, stocks, residents and Campus/Library/Industrial zone sites; Coal Mine, plant and Factory are real paid construction and operation');
  const { initial, steps, seat, time, act, beat, until, commit } = journey;
  const prepared = structuredClone(journey.state);
  act({ type: 'improve', cityId: 'city-0', tileId: 56, improvementId: 'mine' });
  until(() => !!journey.state.cities[0]?.improvements?.['56'], 'Actual paid Coal Mine completes');
  until(() => (journey.state.civilizations[0]?.strategicResources?.coal ?? 0) >= 8, 'Actual finite extraction supplies opening Coal');
  const selected = journey.state.cities.filter(city => city.civId === seat && city.buildings.includes('industrial-zone')).toSorted((left, right) => right.population - left.population || left.id.localeCompare(right.id))[0];
  assert.ok(selected); const cityId = selected.id;
  for (const buildingId of Object.keys(selected.buildingOperations ?? {}).toSorted()) {
    if (journey.state.cities.find(city => city.id === cityId)?.buildingOperations?.[buildingId]?.enabled)
      act({ type: 'set-building-operation', cityId, buildingId, enabled: false });
  }
  const beforePlant = structuredClone(journey.state);
  act({ type: 'build', cityId, project: 'coal-plant' });
  const plantStarted = structuredClone(journey.state);
  until(() => !!journey.state.cities.find(city => city.id === cityId)?.buildings.includes('coal-plant'), 'The paid Coal plant completes through real work');
  const plantCompleted = structuredClone(journey.state);
  act({ type: 'build', cityId, project: 'factory' });
  const factoryStarted = structuredClone(journey.state);
  until(() => !!journey.state.cities.find(city => city.id === cityId)?.buildings.includes('factory'), 'The paid Factory completes through real work');
  const factoryCompleted = structuredClone(journey.state);
  until(() => !!journey.state.cities.find(city => city.id === cityId)?.localPower?.lastProductiveBeat, 'Actual opening Coal and residents fund the same-town positive Factory consumer');
  const productive = structuredClone(journey.state);
  act({ type: 'set-building-operation', cityId, buildingId: 'factory', enabled: false });
  const paused = structuredClone(journey.state);
  beat(); const unused = structuredClone(journey.state);
  return { initial, steps, seat, cityId, prepared, provenance: journey.provenance, beforePlant, plantStarted, plantCompleted, factoryStarted, factoryCompleted, productive, paused, unused, get state() { return journey.state; }, time, act, beat, until, commit };
}
