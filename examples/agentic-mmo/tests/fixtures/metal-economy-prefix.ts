import assert from 'node:assert/strict';
import { isWorldState } from '../../core/validation.ts';
import { mineJourney } from '../worked-mines.test.ts';

export function metalEconomyPrefix() {
  const journey = mineJourney();
  journey.start(56);
  journey.finish();
  journey.start(58);
  journey.finish();
  journey.beat();
  assert.ok(isWorldState(journey.state));
  const city = journey.state.cities.find(candidate => candidate.id === 'city-0');
  assert.ok(city?.improvements?.['56'] && city.improvements['58']);
  for (const mine of Object.values(city.improvements)) assert.equal(mine.operation.lastResult?.status, 'operated');
  return structuredClone({ initial: journey.prefix.initial, state: journey.state, steps: [...journey.prefix.steps, ...journey.steps], timestamp: journey.time(), cityId: city.id, tileIds: [56, 58], recipientCityId: 'city-1' });
}
