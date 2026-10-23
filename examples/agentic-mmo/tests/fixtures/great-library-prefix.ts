import assert from 'node:assert/strict';
import { legalActions } from '../../core/engine.ts';
import { freshFixtureJourney, syntheticTechnologies } from './coastal-prefix.ts';

export function greatLibraryPrefix(rulesId = 'settlement-wonders-1') {
  const journey = freshFixtureJourney(rulesId, state => {
    state.calendarMilestones = ['first-harvest', 'roads-between-peoples', 'rise-of-states'];
    for (const seat of [0, 1]) {
      const actor = state.civilizations[seat]; const city = state.cities[seat]; assert.ok(actor && city);
      actor.era = 1; actor.resources.materials = 120; actor.resources.credits = 100; actor.resources.food = 100;
      city.population = 12;
      syntheticTechnologies(state, seat, ['writing', 'civic-institutions']);
    }
  }, 'Synthetic era, prerequisite learning, opening stocks and population; both Campus and Library commitments and all later wonder actions are real');
  const contenders: { seat: number; cityId: string; campusTileId: number }[] = [];
  for (const seat of [0, 1]) {
    const cityId = `city-${seat}`;
    const campus = legalActions(journey.state, seat, journey.time()).find(option => option.action.type === 'build' && option.action.project === 'campus' && option.action.cityId === cityId);
    assert.ok(campus?.action.type === 'build' && campus.action.tileId !== undefined);
    const campusTileId = campus.action.tileId;
    journey.act(campus.action, seat); journey.until(() => !!journey.state.cities.find(city => city.id === cityId)?.buildings.includes('campus'));
    journey.act({ type: 'build', project: 'library', cityId }, seat); journey.until(() => !!journey.state.cities.find(city => city.id === cityId)?.buildings.includes('library'));
    journey.beat(); contenders.push({ seat, cityId, campusTileId });
  }
  return structuredClone({ initial: journey.initial, state: journey.state, steps: journey.steps, timestamp: journey.time(), contenders, provenance: journey.provenance });
}
