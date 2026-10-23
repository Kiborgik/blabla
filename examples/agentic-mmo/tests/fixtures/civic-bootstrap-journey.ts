import assert from 'node:assert/strict';
import { legalActions } from '../../core/engine.ts';
import { BUILDINGS } from '../../core/content.ts';
import { freshFixtureJourney, syntheticInstitution, syntheticTechnologies } from './coastal-prefix.ts';

export function civicBootstrapJourney(rulesId = 'settlement-civic-bootstrap-1') {
  const journey = freshFixtureJourney(rulesId, state => {
    const actor = state.civilizations[0]; const city = state.cities[0]; assert.ok(actor && city);
    actor.era = 2; actor.resources = { food: 100, materials: 80, credits: 80, energy: 30, culture: 0, science: 0 }; city.population = 12;
    state.calendarMilestones = ['first-harvest', 'roads-between-peoples', 'rise-of-states', 'connected-world'];
    syntheticTechnologies(state, 0, ['construction']);
    syntheticInstitution(state, city.id, 'theater-square', 40);
  }, 'Synthetic era, prerequisite learning, opening stocks, population and Theater site; civic research, government and subsequent construction are real');
  const { steps, seat, time, act, beat, until } = journey;
  const prepared = structuredClone(journey.state);
  act({ type: 'choose-civic', civicId: 'code-of-laws' }); const selected = structuredClone(journey.state);
  beat(); const invested = structuredClone(journey.state);
  until(() => must(must(journey.state.civilizations[seat]).civics).completedCivicIds.includes('code-of-laws'));
  const completed = structuredClone(journey.state);
  act({ type: 'adopt-government', governmentId: 'chiefdom', assignments: [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }] }); const arranged = structuredClone(journey.state);
  const build = legalActions(journey.state, seat, time()).find(option => {
    const action = option.action;
    if (action.type !== 'build') return false;
    const definition = BUILDINGS.find(building => building.id === action.project);
    return definition && !definition.district && !definition.operatingInputs && Object.values(definition.production).some(amount => amount > 0);
  });
  assert.ok(build && build.action.type === 'build' && build.action.cityId, 'The legal civic journey must expose a real construction consumer');
  const cityId = build.action.cityId; const buildingId = build.action.project;
  act(build.action); const started = structuredClone(journey.state);
  until(() => must(journey.state.cities.find(city => city.id === cityId)).buildings.includes(buildingId));
  const built = structuredClone(journey.state); const completionStep = must(steps.at(-1));
  beat(); const operated = structuredClone(journey.state); const operationStep = must(steps.at(-1));
  return { initial: journey.initial, steps, seat, cityId, buildingId, prepared, provenance: journey.provenance, selected, invested, completed, arranged, started, built, completionStep, operated, operationStep, get state() { return journey.state; }, time, act, beat };
}

function must<T>(value: T | null | undefined): T { if (value === null || value === undefined) throw new RangeError("Required civic fact is missing"); return value; }
