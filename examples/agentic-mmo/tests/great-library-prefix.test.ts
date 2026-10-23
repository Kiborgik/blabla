import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, legalActions } from '../core/engine.ts';
import type { WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { greatLibraryPrefix } from './fixtures/great-library-prefix.ts';
import { replayCoastalStep } from './fixtures/coastal-prefix.ts';

await test('two distinct civilizations with synthetic Writing prerequisites pay for and operate their own learning cities', context => {
  const prefix = greatLibraryPrefix();
  assert.equal(prefix.initial.releaseId, 'settlement-wonders-1'); assert.equal(prefix.initial.revision, 0);
  assert.deepEqual(prefix.state.calendarMilestones, prefix.initial.calendarMilestones);
  assert.deepEqual(prefix.state.routes, []); assert.deepEqual(prefix.initial.routes, []);
  assert.equal(new Set(prefix.contenders.map(contender => contender.seat)).size, 2);
  for (const contender of prefix.contenders) {
    const civilization = prefix.state.civilizations.find(candidate => candidate.id === contender.seat);
    const city = prefix.state.cities.find(candidate => candidate.id === contender.cityId);
    assert.ok(civilization && city);
    assert.equal(city.civId, civilization.id);
    assert.equal(civilization.era, 1);
    assert.equal(prefix.initial.civilizations[contender.seat]?.era, 1);
    assert.ok(prefix.initial.civilizations[contender.seat]?.technologies.includes('writing'));
    assert.deepEqual(prefix.initial.cities.find(candidate => candidate.id === contender.cityId)?.buildings, []);
    for (const project of ['campus', 'library']) assert.ok(prefix.steps.some(step => step.input.kind === 'action' && step.input.command.seat === contender.seat && step.input.command.action.type === 'build' && step.input.command.action.project === project));
    assert.ok(civilization.technologies.includes('writing'));
    assert.equal(civilization.researchTarget, '');
    assert.equal(city.construction?.active, null);
    assert.ok(city.buildings.includes('campus') && city.buildings.includes('library'));
    assert.equal(city.districtSites?.campus, contender.campusTileId);
    assert.equal(city.buildingOperations?.library?.lastResult?.status, 'operated');
    assert.deepEqual(city.buildingOperations?.library?.lastResult?.paid, { credits: 1 });
    assert.ok((city.buildingOperations?.library?.lastResult?.produced.science ?? 0) > 0);
    assert.equal(city.buildingOperations?.library?.lastResult?.residents?.allocated, 3);
    assert.ok(civilization.resources.materials >= 50 && civilization.resources.credits >= 25);
  }
  context.diagnostic(JSON.stringify({ basis: 'Declared synthetic era, Writing and resources; actual paid Campus and Library construction and operation, not native play', transitions: prefix.steps.length, revision: prefix.state.revision, round: prefix.state.round, contenders: prefix.contenders }));
});

await test('every retained transition replays from detached initial JSON with canonical frames and immutable inputs', () => {
  const prefix = greatLibraryPrefix();
  const restored: unknown = JSON.parse(JSON.stringify(prefix.initial)); assert.ok(isWorldState(restored));
  let state: WorldState = restored;
  for (const step of prefix.steps) {
    assert.deepEqual(state, step.before);
    const before = JSON.stringify(state);
    const result = replayCoastalStep(state, structuredClone(step.input));
    assert.equal(result.ok, true); assert.deepEqual(result, step.result);
    assert.equal(JSON.stringify(state), before); assert.ok(isWorldState(result.state));
    state = result.state;
  }
  assert.deepEqual(state, prefix.state);
});

await test('fresh Wonders rules offer actual wonder commands while explicit fresh metal rules refuse without payment', () => {
  const current = greatLibraryPrefix(); const historical = greatLibraryPrefix('settlement-metal-learning-1');
  for (const contender of current.contenders) {
    const option = legalActions(current.state, contender.seat, current.timestamp).find(candidate => candidate.action.type === 'build-wonder' && candidate.action.wonderId === 'great-library' && candidate.action.cityId === contender.cityId);
    assert.ok(option?.action.type === 'build-wonder');
    const before = structuredClone(historical.state);
    assert.equal(legalActions(historical.state, contender.seat, historical.timestamp).some(candidate => candidate.action.type === 'build-wonder'), false);
    const refused = applyCommand(historical.state, { seat: contender.seat, expectedRevision: historical.state.revision, timestamp: historical.timestamp, action: option.action });
    assert.equal(refused.ok, false); assert.deepEqual(refused.events, []);
    assert.deepEqual(refused.state, before); assert.deepEqual(historical.state, before);
    assert.deepEqual(historical.state.wonders ?? {}, {});
    assert.ok(historical.state.cities.every(city => (city.construction?.active ?? null) === null));
  }
});

await test('independent preparations are deterministic and returned histories are detached', () => {
  const first = greatLibraryPrefix(); const second = greatLibraryPrefix();
  assert.deepEqual(first, second);
  const before = structuredClone(second);
  first.state.civilizations[0]!.resources.food += 1;
  assert.deepEqual(second, before);
  assert.notDeepEqual(first.state, second.state);
});
