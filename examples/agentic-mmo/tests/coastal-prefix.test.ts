import assert from 'node:assert/strict';
import test from 'node:test';
import { ECONOMY_RULES, RESOURCE_IDS } from '../core/content.ts';
import { applyCommand, legalActions } from '../core/engine.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalDeparturePrefix, replayCoastalStep } from './fixtures/coastal-prefix.ts';

await test('legal coastal departure transfers the existing three residents and pays current founding costs once', () => {
  const prefix = coastalDeparturePrefix();
  const frame = prefix.steps.find(step => step.input.kind === 'action' && step.input.command.action.type === 'settle');
  assert.ok(frame);
  const before = frame.before.cities.find(city => city.id === 'city-0');
  const home = frame.result.state.cities.find(city => city.id === 'city-0');
  const departure = frame.result.state.cities.find(city => city.id === prefix.departureCityId);
  assert.ok(before && home && departure);
  assert.equal(departure.tileId, 23);
  assert.equal(departure.population, ECONOMY_RULES.settle.population);
  assert.equal(home.population, before.population - departure.population);
  assert.ok(home.population >= ECONOMY_RULES.settle.minimumSourcePopulation);
  assert.equal(frame.before.cities.reduce((sum, city) => sum + city.population, 0), frame.result.state.cities.reduce((sum, city) => sum + city.population, 0));
  const prior = frame.before.civilizations[0];
  const current = frame.result.state.civilizations[0];
  assert.ok(prior && current);
  for (const resource of RESOURCE_IDS) {
    const cost = Object.entries(ECONOMY_RULES.settle.cost).find(([key]) => key === resource)?.[1] ?? 0;
    assert.equal(current.resources[resource], prior.resources[resource] - cost);
  }
  assert.equal(departure.focus, before.focus);
});

await test('fresh coastal rules retain real strategic growth and research before Navigation is learned', context => {
  const prefix = coastalDeparturePrefix();
  const departure = prefix.state.cities.find(city => city.id === prefix.departureCityId);
  assert.ok(departure);
  assert.ok(departure.population >= 6);
  assert.ok(prefix.state.civilizations[0]?.technologies.includes('water-management'));
  assert.equal(prefix.state.civilizations[0]?.technologies.includes('navigation'), false);
  assert.equal(prefix.state.unlockedFeatures.includes('navigation'), true);
  assert.deepEqual(prefix.state.unlockedFeatures, prefix.initial.unlockedFeatures);
  assert.equal(prefix.initial.revision, 0);
  assert.equal(prefix.state.releaseId, 'settlement-coastal-1');
  const growth = prefix.steps.flatMap(step => step.result.events).filter(event => event.type === 'population-growth' && event.tileId === 23);
  assert.ok(growth.length >= 3);
  assert.ok(prefix.steps.some(step => step.input.kind === 'action' && step.input.command.action.type === 'research' && step.input.command.action.technology === 'water-management'));
  assert.ok(prefix.steps.flatMap(step => step.result.events).some(event => event.type === 'research-completed' && event.actor === 0 && event.id === prefix.state.civilizations[0]?.lastResearchCompletion?.eventId));
  context.diagnostic(JSON.stringify({ steps: prefix.steps.length, round: prefix.state.round, revision: prefix.state.revision, departureCityId: departure.id, population: departure.population, departureGrowthEvents: growth.length, technologies: prefix.state.civilizations[0]?.technologies }));
});

await test('destination26 remains an otherwise habitable coastal site outside every owned land frontier', () => {
  const prefix = coastalDeparturePrefix();
  const target = prefix.state.tiles.find(tile => tile.id === 26);
  assert.ok(target);
  assert.equal(target.owner, null);
  assert.ok(target.terrain !== 'ocean' && target.terrain !== 'mountain');
  assert.ok(prefix.state.tiles.some(tile => tile.terrain === 'ocean' && hexDistance(tile, target) === 1));
  for (const tile of prefix.state.tiles.filter(candidate => candidate.owner === 0)) assert.ok(hexDistance(tile, target) > 2);
  for (const city of prefix.state.cities) {
    const tile = prefix.state.tiles.find(candidate => candidate.id === city.tileId);
    assert.ok(tile);
    assert.ok(hexDistance(tile, target) >= 2);
  }
  const options = legalActions(prefix.state, 0, prefix.timestamp);
  assert.ok(options.some(option => option.action.type === 'settle' && option.action.sourceCityId === prefix.departureCityId));
  assert.equal(options.some(option => option.action.type === 'settle' && option.action.tileId === 26), false);
  const before = JSON.stringify(prefix.state);
  const result = applyCommand(prefix.state, { seat: 0, expectedRevision: prefix.state.revision, timestamp: prefix.timestamp, action: { type: 'settle', sourceCityId: prefix.departureCityId, tileId: 26 } });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result.state), before);
  assert.deepEqual(result.events, []);
  assert.equal(JSON.stringify(prefix.state), before);
});

await test('every retained prefix frame replays from unchanged seed1701 through exact canonical commands', () => {
  const prefix = coastalDeparturePrefix();
  let state = prefix.initial;
  const geography = state.tiles.map(({ owner: _owner, ...tile }) => tile);
  for (const step of prefix.steps) {
    assert.deepEqual(state, step.before);
    const restored: unknown = JSON.parse(JSON.stringify(state));
    assert.ok(isWorldState(restored));
    const before = structuredClone(restored);
    const result = replayCoastalStep(restored, step.input);
    assert.deepEqual(result, step.result);
    assert.deepEqual(restored, before);
    assert.ok(isWorldState(result.state));
    assert.deepEqual(result.state.tiles.map(({ owner: _owner, ...tile }) => tile), geography);
    state = result.state;
  }
  assert.deepEqual(state, prefix.state);
  const second = coastalDeparturePrefix();
  assert.deepEqual(second, prefix);
  const mutated = prefix.state.cities[0];
  assert.ok(mutated);
  mutated.population = 999;
  assert.notEqual(second.state.cities[0]?.population, 999);
});
