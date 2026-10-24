import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { isWorldState } from '../core/validation.ts';
import type { GameAction } from '../core/types.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { coastalDeparturePrefix, coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';

export function workedResourcePrefix(rulesId = 'settlement-writing-1') {
  const prefix = coastalDeparturePrefix(rulesId);
  let state = prefix.state;
  const steps: CoastalPrefixStep[] = [...prefix.steps];
  const time = () => { assert.ok(state.independentTurns); return coastalPrefixTime(state.independentTurns.strategyTicks * 60 + 20); };
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state);
    const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error);
    assert.deepEqual(state, before);
    assert.ok(isWorldState(result.state));
    steps.push({ input, before, result }); state = result.state;
  };
  const perform = (action: GameAction): void => {
    const timestamp = time();
    assert.ok(legalActions(state, 0, timestamp).some(option => JSON.stringify(option.action) === JSON.stringify(action)));
    commit({ kind: 'action', command: { seat: 0, expectedRevision: state.revision, timestamp, action } });
  };
  const beat = (): void => { assert.ok(state.independentTurns); commit({ kind: 'strategy', timestamp: coastalPrefixTime((state.independentTurns.strategyTicks + 1) * 60) }); };
  const research = (technology: string): void => {
    perform({ type: 'research', technology });
    for (let count = 0; count < 40; count++) { if (state.civilizations[0]?.technologies.includes(technology)) break; beat(); }
    assert.ok(state.civilizations[0]?.technologies.includes(technology));
  };
  const construct = (project: string, tileId?: number): void => {
    perform({ type: 'build', project, cityId: 'city-0', ...(tileId === undefined ? {} : { tileId }) });
    for (let count = 0; count < 32; count++) { if (state.cities[0]?.buildings.includes(project)) break; beat(); }
    assert.ok(state.cities[0]?.buildings.includes(project));
  };
  research('writing'); construct('campus', 39); construct('library'); beat(); research('kiln-firing');
  return { initial: prefix.initial, beforeWriting: prefix.state, state, steps, timestamp: time() };
}

await test('fresh Writing rules and legal actions reach owned resource sites through useful Writing and Kiln research', context => {
  const prefix = workedResourcePrefix(); const city = prefix.state.cities[0]; assert.ok(city);
  assert.equal(prefix.state.releaseId, 'settlement-writing-1');
  assert.ok(prefix.state.civilizations[0]?.technologies.includes('kiln-firing'));
  assert.ok(prefix.state.civilizations[0]?.technologies.includes('writing'));
  assert.deepEqual(city.districtSites, { campus: 39 });
  assert.equal(city.buildingOperations?.library?.lastResult?.status, 'operated');
  assert.deepEqual(city.buildingOperations?.library?.lastResult?.paid, { credits: 1 });
  assert.ok((city.buildingOperations?.library?.lastResult?.produced.science ?? 0) > 0);
  assert.deepEqual(prefix.state.tiles, prefix.beforeWriting.tiles);
  context.diagnostic(JSON.stringify({ fixture: 'entirely legal source fixture, not native play', transitions: prefix.steps.length, revision: prefix.state.revision, round: prefix.state.round, population: city.population, technologies: prefix.state.civilizations[0]?.technologies, library: city.buildingOperations?.library?.lastResult }));
});

await test('every prefix input and result replays exactly from detached JSON without editing previous frames', () => {
  const prefix = workedResourcePrefix(); let state = prefix.initial;
  for (const step of prefix.steps) {
    const before = JSON.stringify(state); const decoded: unknown = JSON.parse(before); assert.ok(isWorldState(decoded));
    const result = replayCoastalStep(decoded, structuredClone(step.input));
    assert.deepEqual(result, step.result); assert.equal(JSON.stringify(state), before);
    state = result.state;
  }
  assert.deepEqual(state, prefix.state);
});

await test('existing owned elevations support a proposed hill classification without changing terrain or granting Mining', context => {
  const { state } = workedResourcePrefix(); const city = state.cities[0]; assert.ok(city);
  const center = state.tiles.find(tile => tile.id === city.tileId); assert.ok(center);
  const owned = state.tiles.filter(tile => tile.owner === city.civId && tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && tile.id !== city.tileId && hexDistance(center, tile) <= 3);
  const facts = owned.map(tile => ({ id: tile.id, elevation: tile.elevation, terrain: tile.terrain, owner: tile.owner, resource: tile.resource, cityCenter: state.cities.some(candidate => candidate.tileId === tile.id), reservedOrCompletedCampus: Object.values(city.districtSites ?? {}).includes(tile.id) }));
  const proposed = facts.filter(tile => tile.elevation >= 70 && tile.elevation <= 88 && !tile.cityCenter && !tile.reservedOrCompletedCampus);
  assert.deepEqual(proposed.map(tile => [tile.id, tile.elevation, tile.terrain, tile.owner, tile.resource]), [[56, 71, 'forest', 0, null], [58, 83, 'forest', 0, null]]);
  assert.ok(!state.civilizations[0]?.technologies.includes('mining'));
  context.diagnostic(JSON.stringify({ basis: 'existing map facts; 70–88 is Creative proposed versioned threshold, not current engine eligibility', owned: facts, proposed }));
});

await test('existing marker and stock shapes do not pretend to contain finite iron deposits', context => {
  const { state } = workedResourcePrefix();
  const markers = state.tiles.filter(tile => tile.resource !== null).map(tile => ({ id: tile.id, resource: tile.resource }));
  assert.equal(markers.length, 5); assert.ok(markers.every(marker => marker.resource === 'food'));
  assert.ok(!state.tiles.some(tile => 'deposit' in tile || 'depositId' in tile));
  assert.ok(!state.civilizations.some(civilization => 'iron' in civilization.resources));
  context.diagnostic(JSON.stringify({ currentMarkers: markers, terrain: [...new Set(state.tiles.map(tile => tile.terrain))].toSorted() }));
});

await test('unreleased Mining selection has zero effects on the valid owned-site prefix', () => {
  const { state, timestamp } = workedResourcePrefix(); const before = JSON.stringify(state);
  assert.ok(!legalActions(state, 0, timestamp).some(option => option.action.type === 'research' && option.action.technology === 'mining'));
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp, action: { type: 'research', technology: 'mining' } });
  assert.equal(result.ok, false); assert.deepEqual(result.events, []); assert.equal(JSON.stringify(result.state), before); assert.equal(JSON.stringify(state), before);
});

await test('current due beats are real transitions rather than fixture patches', () => {
  const prefix = workedResourcePrefix();
  for (const step of prefix.steps.filter(candidate => candidate.input.kind === 'strategy')) {
    const result = step.input.kind === 'strategy' ? catchUpStrategy(step.before, step.input.timestamp) : null;
    assert.deepEqual(result, step.result);
  }
});
