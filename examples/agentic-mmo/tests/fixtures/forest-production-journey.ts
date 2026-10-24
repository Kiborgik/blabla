import assert from 'node:assert/strict';
import { freshFixtureJourney, syntheticInstitution, syntheticTechnologies } from './coastal-prefix.ts';
import { waterLandTown } from './water-land-journey.ts';

export function forestProductionJourney() {
  const journey = freshFixtureJourney('settlement-forest-production-1', state => {
    const actor = state.civilizations[0]; const city = state.cities[0]; assert.ok(actor && city);
    actor.era = 1; actor.resources = { food: 100, materials: 60, credits: 60, energy: 30, culture: 0, science: 0 }; city.population = 12;
    state.calendarMilestones = ['first-harvest', 'roads-between-peoples', 'rise-of-states'];
    syntheticTechnologies(state, 0, ['writing', 'engineering']);
    syntheticInstitution(state, city.id, 'campus', 39); syntheticInstitution(state, city.id, 'library');
  }, 'Synthetic era, stocks, residents, prerequisite technologies and Campus/Library; Archery, Machinery and worked Lumber mill are actual paid gameplay');
  return { ...journey, prepared: structuredClone(journey.state), get state() { return journey.state; } };
}

export function forestProductionOperationJourney() {
  const journey = forestProductionJourney(); const cityId = 'city-0'; const tileId = 56;
  journey.research('archery'); const archeryCompleted = structuredClone(journey.state);
  journey.research('machinery'); const ready = structuredClone(journey.state);
  journey.act({ type: 'improve', cityId, tileId, improvementId: 'lumber-mill' }); const started = structuredClone(journey.state);
  journey.until(() => !!waterLandTown(journey.state, cityId).improvements?.[String(tileId)]);
  const completed = structuredClone(journey.state); const completionStep = journey.steps.at(-1); assert.ok(completionStep);
  journey.beat(); const operated = structuredClone(journey.state);
  return { journey, cityId, tileId, archeryCompleted, ready, started, completed, completionStep, operated };
}
