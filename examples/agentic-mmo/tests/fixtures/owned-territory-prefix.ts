import assert from 'node:assert/strict';
import { freshFixtureJourney } from './coastal-prefix.ts';

export function ownedTerritoryPrefix() {
  const seat = 2;
  const journey = freshFixtureJourney('settlement-territory-1', state => {
    const actor = state.civilizations[seat]; const city = state.cities[seat]; assert.ok(actor && city);
    actor.era = 1; actor.resources.food = 100; actor.resources.materials = 80; actor.resources.credits = 60; city.population = 12;
  }, 'Fresh territory rules with synthetic era 1 capability, founding stocks and source residents, without earned-history proofs; founding, research, purchases and improvement work use actual paid actions', seat);
  journey.act({ type: 'settle', tileId: 199, sourceCityId: 'city-2' });
  const beforeResearch = structuredClone(journey.state);
  const city = journey.state.cities.find(town => town.civId === seat && town.tileId === 199); assert.ok(city);
  for (const technology of ['agriculture', 'animal-husbandry']) journey.research(technology);
  journey.until(() => (journey.state.cities.find(town => town.id === city.id)?.population ?? 0) > 3);
  return { initial: journey.initial, state: journey.state, steps: journey.steps, beforeResearch, timestamp: journey.time(), seat, cityId: city.id, pathTileIds: [199, 181, 164], provenance: journey.provenance };
}
