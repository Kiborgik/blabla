import assert from 'node:assert/strict';
import { freshFixtureJourney, syntheticInstitution, syntheticTechnologies } from './coastal-prefix.ts';

export function localGrowthPrefix(rulesId = 'settlement-growth-1') {
  const cityId = 'city-0';
  const journey = freshFixtureJourney(rulesId, state => {
    state.calendarMilestones = ['first-harvest', 'roads-between-peoples', 'rise-of-states'];
    for (const actor of state.civilizations) actor.era = 1;
    for (const city of state.cities) city.population = 20;
    const actor = state.civilizations[0]; assert.ok(actor);
    actor.resources = { food: 200, materials: 100, credits: 100, energy: 80, culture: 80, science: 0 };
    syntheticTechnologies(state, 0, ['education', 'fuel-management', 'water-management']);
    for (const building of ['campus', 'library', 'academy', 'fuel-yard', 'irrigation', 'kiln']) syntheticInstitution(state, cityId, building, building === 'campus' ? 39 : undefined);
  }, 'Synthetic population20, prerequisite technologies, stocks and six institutions/sites; University and Granary are paid actual subsequent construction');
  const institutionReady = structuredClone(journey.state);
  journey.act({ type: 'build', project: 'university', cityId });
  journey.until(() => !!journey.state.cities.find(city => city.id === cityId)?.buildings.includes('university'));
  const universityCompleted = structuredClone(journey.state);
  journey.beat(); const blockedBeat = journey.steps.at(-1); assert.ok(blockedBeat?.input.kind === 'strategy');
  return structuredClone({ initial: journey.initial, state: journey.state, steps: journey.steps, timestamp: journey.time(), cityId, institutionReady, universityCompleted, blockedBeat, provenance: journey.provenance });
}
