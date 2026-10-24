import assert from 'node:assert/strict';
import { freshFixtureJourney } from './coastal-prefix.ts';

export function mapExpansionPrefix(rulesId = 'settlement-world-expansion-1') {
  const journey = freshFixtureJourney(rulesId, state => {
    const actor = state.civilizations[2]; const city = state.cities[2]; assert.ok(actor && city);
    actor.resources.food = 100; actor.resources.materials = 80; actor.resources.credits = 60; city.population = 12;
  }, 'Fresh expanded selected rules with synthetic founding stocks and source residents; both frontier settlements are paid conserved actions', 2);
  journey.act({ type: 'settle', tileId: 199, sourceCityId: 'city-2' });
  return { ...journey, get state() { return journey.state; }, timestamp: journey.time(), sourceCityId: 'city-2', frontierTileId: 199, targetTileId: 218 };
}

export function mapExpansionJourney() {
  const previous = mapExpansionPrefix(); const prepared = structuredClone(previous.state);
  previous.act({ type: 'settle', sourceCityId: previous.sourceCityId, tileId: previous.targetTileId });
  const founded = structuredClone(previous.state); previous.beat(); const operationStep = previous.steps.at(-1); assert.ok(operationStep);
  return { previous, initial: previous.initial, steps: previous.steps, prepared, founded, operated: previous.state, operationStep, state: previous.state, timestamp: previous.time(), provenance: previous.provenance };
}
