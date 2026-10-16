import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, legalActions } from '../core/engine.ts';
import { isWorldState } from '../core/validation.ts';
import { greatLibraryPrefix } from './fixtures/great-library-prefix.ts';
import { replayCoastalStep } from './fixtures/coastal-prefix.ts';

await test('two distinct civilizations legally finish Writing and operate their own learning cities', context => {
  const prefix = greatLibraryPrefix();
  assert.equal(prefix.state.releaseId, 'settlement-metal-learning-1');
  assert.ok(prefix.state.calendarMilestones.includes('rise-of-states'));
  assert.ok(prefix.state.routes.filter(route => route.active).length >= 3);
  assert.equal(new Set(prefix.contenders.map(contender => contender.seat)).size, 2);
  for (const contender of prefix.contenders) {
    const civilization = prefix.state.civilizations.find(candidate => candidate.id === contender.seat);
    const city = prefix.state.cities.find(candidate => candidate.id === contender.cityId);
    assert.ok(civilization && city);
    assert.equal(city.civId, civilization.id);
    assert.ok(civilization.era >= 1, 'The accepted Great library construction gate requires an actually reached era1');
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
  context.diagnostic(JSON.stringify({ basis: 'Legal deterministic engine prefix, not native play or future wonder eligibility', transitions: prefix.steps.length, revision: prefix.state.revision, round: prefix.state.round, contenders: prefix.contenders }));
});

await test('every retained transition replays from detached initial JSON with canonical frames and immutable inputs', () => {
  const prefix = greatLibraryPrefix();
  let state: unknown = JSON.parse(JSON.stringify(prefix.initial)); assert.ok(isWorldState(state));
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

await test('current release refuses Great library for both prepared cities without payment or future effects', () => {
  const prefix = greatLibraryPrefix();
  for (const contender of prefix.contenders) {
    const before = structuredClone(prefix.state);
    const action = { type: 'build', project: 'great-library', cityId: contender.cityId } as const;
    assert.equal(legalActions(prefix.state, contender.seat, prefix.timestamp).some(option => option.action.type === 'build' && option.action.project === 'great-library'), false);
    const refused = applyCommand(prefix.state, { seat: contender.seat, expectedRevision: prefix.state.revision, timestamp: prefix.timestamp, action });
    assert.equal(refused.ok, false); assert.deepEqual(refused.events, []);
    assert.deepEqual(refused.state, before); assert.deepEqual(prefix.state, before);
    assert.ok(!prefix.state.cities.some(city => city.buildings.includes('great-library') || city.construction?.active?.buildingId === 'great-library'));
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
