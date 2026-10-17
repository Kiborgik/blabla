import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, applyRelease, catchUpStrategy, legalActions, observe } from '../core/engine.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { isGameAction } from '../core/planning.ts';
import { projectCapabilities } from '../core/capabilities.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { decisionObligations } from '../core/simulation/decisions.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';
import { workedResourcePrefix } from './mining-resource-prefix.test.ts';

await test('prior Writing history retains its Library and has no worked Mine action', () => {
  const { state, timestamp } = workedResourcePrefix();
  const before = structuredClone(state);
  assert.equal(state.releaseId, 'settlement-writing-1');
  assert.ok(state.cities[0]?.buildings.includes('library'));
  assert.ok(!legalActions(state, 0, timestamp).some(option => option.action.type === 'improve'));
  assert.deepEqual(state, before);
});

await test('the explicit compatible Mine release opens actual Mining research on the unchanged legal world', () => {
  const { state, timestamp } = workedResourcePrefix();
  const before = structuredClone(state);
  const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-mining-1', timestamp });
  assert.ok(result.ok, result.error);
  assert.deepEqual(state, before);
  assert.deepEqual(result.state.tiles, before.tiles);
  assert.ok(legalActions(result.state, 0, timestamp).some(option => option.action.type === 'research' && option.action.technology === 'mining'));
  const selected = applyCommand(result.state, { seat: 0, expectedRevision: result.state.revision, timestamp, action: { type: 'research', technology: 'mining' } });
  assert.ok(selected.ok, selected.error);
  assert.equal(selected.state.civilizations[0]?.researchTarget, 'mining');
});

export function mineJourney() {
  const prefix = workedResourcePrefix();
  let state = prefix.state;
  const steps: CoastalPrefixStep[] = [];
  const time = () => {
    assert.ok(state.independentTurns);
    return coastalPrefixTime(Math.max(state.independentTurns.strategyTicks * 60 + 20, ((state.independentTurns.lastActionWindow[0] ?? -1) + 1) * 10));
  };
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state);
    const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error);
    assert.deepEqual(state, before);
    steps.push({ input, before, result }); state = result.state;
  };
  const act = (action: GameAction): void => {
    assert.ok(legalActions(state, 0, time()).some(option => sameAction(option.action, action)), JSON.stringify(action));
    commit({ kind: 'action', command: { seat: 0, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const beat = (): void => { assert.ok(state.independentTurns); commit({ kind: 'strategy', timestamp: coastalPrefixTime((state.independentTurns.strategyTicks + 1) * 60) }); };
  commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-mining-1', timestamp: time() } });
  act({ type: 'research', technology: 'mining' });
  for (let count = 0; count < 20 && !state.civilizations[0]?.technologies.includes('mining'); count++) beat();
  assert.ok(state.civilizations[0]?.technologies.includes('mining'));
  const ready = structuredClone(state);
  const start = (tileId: number): void => act({ type: 'improve', cityId: 'city-0', tileId, improvementId: 'mine' });
  const finish = (): void => {
    for (let count = 0; count < 20 && state.cities[0]?.construction?.active; count++) beat();
    assert.equal(state.cities[0]?.construction?.active, null);
  };
  return { prefix, ready, get state() { return state; }, steps, time, act, beat, start, finish };
}

function nextBeat(state: WorldState): WorldState {
  assert.ok(state.independentTurns);
  const result = catchUpStrategy(state, coastalPrefixTime((state.independentTurns.strategyTicks + 1) * 60));
  assert.ok(result.ok, result.error);
  return result.state;
}

await test('strict improvement actions keep exact city, tile and catalogue identity', () => {
  const action = { type: 'improve', cityId: 'city-0', tileId: 56, improvementId: 'mine' } as const;
  assert.ok(isGameAction(action));
  assert.ok(isGameAction({ ...action, type: 'set-improvement-operation', enabled: false }));
  for (const invalid of [{ ...action, tileId: -1 }, { ...action, tileId: 1.5 }, { ...action, cityId: '' }, { ...action, extra: true }, { type: 'improve', tileId: 56, improvementId: 'mine' }]) assert.equal(isGameAction(invalid), false);
  assert.ok(sameAction(action, action));
  assert.equal(sameAction(action, { ...action, tileId: 58 }), false);
});

await test('legal Mine start pays once and reserves an exact owned hill in the existing town lane', () => {
  const journey = mineJourney(); const before = structuredClone(journey.state);
  const sites = legalActions(before, 0, journey.time()).flatMap(option => option.action.type === 'improve' && option.action.cityId === 'city-0' ? [option.action.tileId] : []);
  assert.deepEqual(sites, [56, 58]);
  journey.start(56);
  const city = journey.state.cities[0]; assert.ok(city);
  const order = city.construction?.active; assert.ok(order && 'kind' in order);
  assert.equal(order.kind, 'improvement'); assert.equal(order.tileId, 56);
  assert.equal(order.improvementId, 'mine'); assert.equal(order.workRequired, 4); assert.equal(order.workDone, 0);
  assert.deepEqual(order.paid, { materials: 6, credits: 3 });
  assert.equal('buildingId' in order, false);
  assert.equal(journey.state.civilizations[0]?.resources.materials, (before.civilizations[0]?.resources.materials ?? 0) - 6);
  assert.equal(journey.state.civilizations[0]?.resources.credits, (before.civilizations[0]?.resources.credits ?? 0) - 3);
  assert.equal(city.improvements, undefined);
  assert.ok(!city.buildings.includes('mine')); assert.deepEqual(journey.state.tiles, before.tiles);
  assert.equal(decisionObligations(journey.state, 0).construction[0]?.targetId, 'improvement:mine');
});

await test('foreign, missing, low, occupied and second-lane improvement starts have zero effects', () => {
  const journey = mineJourney();
  const invalid: GameAction[] = [
    { type: 'improve', cityId: 'city-1', tileId: 56, improvementId: 'mine' },
    { type: 'improve', cityId: 'missing', tileId: 56, improvementId: 'mine' },
    ...[39, 40, 57, 99999, 31].map(tileId => ({ type: 'improve' as const, cityId: 'city-0', tileId, improvementId: 'mine' })),
  ];
  const refuse = (action: GameAction): void => {
    const before = JSON.stringify(journey.state);
    const result = applyCommand(journey.state, { seat: 0, expectedRevision: journey.state.revision, timestamp: journey.time(), action });
    assert.equal(result.ok, false); assert.deepEqual(result.events, []); assert.equal(JSON.stringify(result.state), before); assert.equal(JSON.stringify(journey.state), before);
  };
  invalid.forEach(refuse); journey.start(56);
  refuse({ type: 'improve', cityId: 'city-0', tileId: 58, improvementId: 'mine' });
  refuse({ type: 'build', cityId: 'city-0', project: 'farm' });
});

await test('completion retains the exact installation and no completion-beat allocation or output', context => {
  const journey = mineJourney(); journey.start(56); const order = structuredClone(journey.state.cities[0]?.construction?.active); journey.finish();
  const city = journey.state.cities[0]; const mine = city?.improvements?.['56']; assert.ok(city && mine && order);
  assert.equal(mine.tileId, 56); assert.equal(mine.improvementId, 'mine');
  assert.deepEqual(mine.completion, city.construction?.lastCompleted);
  assert.equal(mine.completion.orderId, order.id); assert.deepEqual(mine.completion.paid, order.paid);
  assert.equal(mine.operation.enabled, true); assert.equal(mine.operation.lastResult, null);
  assert.ok(!city.buildings.includes('mine'));
  journey.beat(); const result = journey.state.cities[0]?.improvements?.['56']?.operation.lastResult; assert.ok(result);
  assert.equal(result.status, 'operated'); assert.equal(result.residents.allocated, 1); assert.deepEqual(result.paid, {});
  assert.ok((result.produced.materials ?? 0) > 2);
  context.diagnostic(JSON.stringify({ legalPrefix: 58, successorTransitions: journey.steps.length, revision: journey.state.revision, round: journey.state.round, result }));
});

await test('legal pause preserves its receipt and equal-beat paused control isolates actual output', () => {
  const journey = mineJourney(); journey.start(56); journey.finish(); journey.beat();
  const enabled = structuredClone(journey.state);
  const receipt = structuredClone(enabled.cities[0]?.improvements?.['56']?.operation.lastResult);
  journey.act({ type: 'set-improvement-operation', cityId: 'city-0', tileId: 56, improvementId: 'mine', enabled: false });
  assert.deepEqual(journey.state.cities[0]?.improvements?.['56']?.operation.lastResult, receipt);
  const control = nextBeat(journey.state); const operated = nextBeat(enabled);
  const result = operated.cities[0]?.improvements?.['56']?.operation.lastResult; assert.ok(result);
  assert.equal(Math.round(((operated.civilizations[0]?.resources.materials ?? 0) - (control.civilizations[0]?.resources.materials ?? 0)) * 100) / 100, result.produced.materials);
  assert.equal(control.cities[0]?.improvements?.['56']?.operation.lastResult?.residents.allocated, 0);
  assert.deepEqual(control.cities[0]?.improvements?.['56']?.operation.lastResult?.produced, {});
  journey.act({ type: 'set-improvement-operation', cityId: 'city-0', tileId: 56, improvementId: 'mine', enabled: true });
  assert.deepEqual(journey.state.cities[0]?.improvements?.['56']?.operation.lastResult, receipt);
  assert.equal(nextBeat(journey.state).cities[0]?.improvements?.['56']?.operation.lastResult?.status, 'operated');
});

await test('synthetic opening scarcity after legal two-Mine construction preserves paid-recipe priority and numeric site order', () => {
  const journey = mineJourney(); journey.start(58); journey.finish(); journey.start(56); journey.finish();
  const state = structuredClone(journey.state); const city = state.cities[0]; assert.ok(city);
  city.population = 7;
  const allocated = nextBeat(state); const result = allocated.cities[0]; assert.ok(result);
  assert.equal(result.buildingOperations?.library?.lastResult?.residents?.allocated, 3);
  assert.equal(result.improvements?.['56']?.operation.lastResult?.residents.allocated, 1);
  assert.equal(result.improvements?.['58']?.operation.lastResult?.blockedReason, 'resident-shortage');
  assert.equal(result.improvements?.['58']?.operation.lastResult?.residents.allocated, 0);
  assert.equal(result.improvements?.['58']?.operation.lastResult?.residents.openingPopulation, 7);
  assert.equal(state.cities[0]?.population, 7);
  const paused = structuredClone(state); assert.ok(paused.cities[0]?.buildingOperations?.library);
  paused.cities[0].buildingOperations.library.enabled = false;
  const freed = nextBeat(paused);
  assert.equal(freed.cities[0]?.improvements?.['56']?.operation.lastResult?.residents.allocated, 1);
  assert.equal(freed.cities[0]?.improvements?.['58']?.operation.lastResult?.residents.allocated, 1);
});

await test('installed Mine completion survives later same-town construction and canonical detached replay', () => {
  const journey = mineJourney(); journey.start(56); journey.finish();
  const first = structuredClone(journey.state.cities[0]?.improvements?.['56']?.completion);
  journey.start(58); journey.finish(); journey.beat();
  assert.deepEqual(journey.state.cities[0]?.improvements?.['56']?.completion, first);
  assert.notDeepEqual(journey.state.cities[0]?.construction?.lastCompleted, first);
  for (const step of journey.steps) {
    const decoded: unknown = JSON.parse(JSON.stringify(step.before)); assert.ok(isWorldState(decoded));
    assert.deepEqual(replayCoastalStep(decoded, structuredClone(step.input)), step.result);
    assert.ok(isWorldState(step.result.state));
  }
});

await test('canonical observations retain exact Mine work, sites, completion and historical operation separately', () => {
  const journey = mineJourney(); journey.start(56); journey.finish(); journey.beat();
  const observation = observe(journey.state, 0, journey.time());
  assert.deepEqual(observation.cities[0]?.improvements, journey.state.cities[0]?.improvements);
  const projection = projectCapabilities(journey.state, 0, 'city-0', journey.time());
  assert.ok('improvements' in projection);
  assert.ok(JSON.stringify(projection.improvements).includes('improvement:mine'));
  const original = JSON.stringify(journey.state);
  const observedMine = observation.cities[0]?.improvements?.['56']; assert.ok(observedMine);
  observedMine.operation.enabled = false;
  assert.equal(JSON.stringify(journey.state), original);
});

await test('synthetic later site loss keeps retained installation but allocates and produces nothing', () => {
  const journey = mineJourney(); journey.start(56); journey.finish();
  const state = structuredClone(journey.state); const site = state.tiles.find(tile => tile.id === 56); assert.ok(site);
  site.terrain = 'ocean';
  const after = nextBeat(state); const mine = after.cities[0]?.improvements?.['56']; assert.ok(mine);
  assert.equal(mine.operation.lastResult?.blockedReason, 'site-ineligible');
  assert.equal(mine.operation.lastResult?.residents.allocated, 0);
  assert.deepEqual(mine.operation.lastResult?.produced, {});
  assert.deepEqual(mine.completion, state.cities[0]?.improvements?.['56']?.completion);
});

await test('worked-land adoption refuses unprocessed strategy without changing the legal old world', () => {
  const { state } = workedResourcePrefix(); assert.ok(state.independentTurns);
  const before = JSON.stringify(state);
  const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-mining-1', timestamp: coastalPrefixTime((state.independentTurns.strategyTicks + 1) * 60) });
  assert.equal(result.ok, false); assert.match(result.error ?? '', /strategy_catchup_required/);
  assert.equal(JSON.stringify(result.state), before); assert.equal(JSON.stringify(state), before);
});

await test('legal conserved founding can leave a retained Mine without opening residents', () => {
  const journey = mineJourney(); journey.start(56); journey.finish(); journey.beat();
  let foundings = 0;
  for (let count = 0; count < 30; count++) {
    const city = journey.state.cities[0]; assert.ok(city);
    if (city.improvements?.['56']?.operation.lastResult?.blockedReason === 'resident-shortage') break;
    const option = legalActions(journey.state, 0, journey.time()).find(candidate => candidate.action.type === 'settle' && candidate.action.sourceCityId === city.id);
    if (option) {
      const population = journey.state.cities.reduce((sum, town) => sum + town.population, 0);
      journey.act(option.action); foundings++;
      assert.equal(journey.state.cities.reduce((sum, town) => sum + town.population, 0), population);
    } else journey.beat();
  }
  assert.ok(foundings > 0);
  const result = journey.state.cities[0]?.improvements?.['56']?.operation.lastResult; assert.ok(result);
  assert.equal(result.blockedReason, 'resident-shortage'); assert.equal(result.residents.allocated, 0); assert.deepEqual(result.produced, {});
});

await test('synthetic scarce opening materials cannot use that beat Mine output for irrigation', () => {
  const journey = mineJourney(); journey.start(56); journey.finish();
  const state = structuredClone(journey.state); const civ = state.civilizations[0]; const city = state.cities[0]; assert.ok(civ && city);
  city.buildings.push('irrigation'); city.buildingOperations ??= {}; city.buildingOperations.irrigation = { enabled: true, lastResult: null };
  civ.resources.materials = 0;
  const after = nextBeat(state); const result = after.cities[0]; assert.ok(result);
  assert.equal(result.buildingOperations?.irrigation?.lastResult?.status, 'blocked');
  assert.deepEqual(result.buildingOperations?.irrigation?.lastResult?.paid, {});
  assert.ok((result.improvements?.['56']?.operation.lastResult?.produced.materials ?? 0) > 0);
  assert.ok((after.civilizations[0]?.resources.materials ?? 0) >= 1);
  assert.equal(nextBeat(after).cities[0]?.buildingOperations?.irrigation?.lastResult?.status, 'operated');
});

await test('synthetic blocked paid recipe releases residents while same-beat growth cannot staff a Mine', () => {
  const journey = mineJourney(); journey.start(56); journey.finish();
  const state = structuredClone(journey.state); const city = state.cities[0]; const civ = state.civilizations[0]; assert.ok(city && civ);
  city.population = 4; civ.resources.credits = 0;
  const freed = nextBeat(state);
  assert.equal(freed.cities[0]?.buildingOperations?.library?.lastResult?.status, 'blocked');
  assert.equal(freed.cities[0]?.improvements?.['56']?.operation.lastResult?.residents.allocated, 1);
  city.population = 3;
  const grown = nextBeat(state);
  assert.equal(grown.cities[0]?.population, 4);
  assert.equal(grown.cities[0]?.improvements?.['56']?.operation.lastResult?.residents.openingPopulation, 3);
  assert.equal(grown.cities[0]?.improvements?.['56']?.operation.lastResult?.residents.allocated, 0);
});

await test('exact Mine plan preserves its second site without automatic construction', () => {
  const journey = mineJourney(); const action: GameAction = { type: 'improve', cityId: 'city-0', tileId: 56, improvementId: 'mine' };
  const result = applyCommand(journey.state, { seat: 0, expectedRevision: journey.state.revision, timestamp: journey.time(), action,
    plan: [{ action, reason: 'Use this owned hill for materials' }, { action: { ...action, tileId: 58 }, reason: 'Review the second hill after completion' }] });
  assert.ok(result.ok, result.error);
  assert.equal(result.state.actionPlans?.[0]?.items[0]?.status, 'completed');
  assert.equal(observe(result.state, 0, journey.time()).actionPlan?.items[1]?.status, 'blocked');
  let state = result.state;
  for (let count = 0; count < 20 && state.cities[0]?.construction?.active; count++) state = nextBeat(state);
  assert.equal(state.cities[0]?.construction?.active, null); assert.equal(state.cities[0]?.improvements?.['58'], undefined);
  assert.ok(state.independentTurns);
  assert.equal(observe(state, 0, coastalPrefixTime(state.independentTurns.strategyTicks * 60 + 20)).actionPlan?.items[1]?.status, 'ready');
  assert.equal(state.actionPlans?.[0]?.items[1]?.action.type, 'improve');
});

await test('canonical Mine rows expose exact references and Planned support before adoption', () => {
  const prior = workedResourcePrefix();
  assert.equal(projectCapabilities(prior.state, 0, 'city-0', prior.timestamp).improvements?.[0]?.status, 'planned');
  const journey = mineJourney(); const options = legalActions(journey.state, 0, journey.time());
  const row = projectCapabilities(journey.state, 0, 'city-0', journey.time(), { revision: journey.state.revision, seat: 0, observedAt: journey.time(), legalActions: options }).improvements?.[0]; assert.ok(row);
  assert.deepEqual(row.availableSites.map(site => site.tileId), [56, 58]);
  assert.deepEqual(row.choiceRefs.map(index => options[index]?.action), row.availableSites.map(site => ({ type: 'improve', cityId: 'city-0', tileId: site.tileId, improvementId: 'mine' })));
  const state = JSON.stringify(journey.state); const firstSite = row.availableSites[0]; assert.ok(firstSite); firstSite.baseProduction.materials = 999;
  assert.equal(JSON.stringify(journey.state), state);
});

await test('a paid Mine site excludes another town district or improvement reservation globally', () => {
  const journey = mineJourney(); const other = journey.state.cities.find(city => city.civId === 0 && city.id !== 'city-0'); assert.ok(other);
  const campus: GameAction = { type: 'build', cityId: other.id, project: 'campus', tileId: 56 };
  assert.ok(legalActions(journey.state, 0, journey.time()).some(option => sameAction(option.action, campus)));
  journey.start(56);
  for (const action of [campus, { type: 'improve' as const, cityId: other.id, tileId: 56, improvementId: 'mine' }]) {
    const before = JSON.stringify(journey.state);
    const result = applyCommand(journey.state, { seat: 0, expectedRevision: journey.state.revision, timestamp: journey.time(), action });
    assert.equal(result.ok, false); assert.equal(JSON.stringify(result.state), before); assert.deepEqual(result.events, []);
  }
  journey.finish();
  assert.ok(!legalActions(journey.state, 0, journey.time()).some(option => option.action.type === 'build' && option.action.tileId === 56));
});

await test('synthetic unavailable construction stocks refuse without partial payment or reservation', () => {
  const journey = mineJourney(); const state = structuredClone(journey.state); const civ = state.civilizations[0]; assert.ok(civ); civ.resources.materials = 5;
  const before = JSON.stringify(state);
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: journey.time(), action: { type: 'improve', cityId: 'city-0', tileId: 56, improvementId: 'mine' } });
  assert.equal(result.ok, false); assert.equal(JSON.stringify(state), before); assert.equal(JSON.stringify(result.state), before); assert.deepEqual(result.events, []);
});

await test('synthetic later site ownership loss preserves paid work and completes without redirecting', () => {
  const journey = mineJourney(); journey.start(56);
  let state = structuredClone(journey.state); const tile = state.tiles.find(site => site.id === 56); assert.ok(tile); tile.owner = 1;
  const order = structuredClone(state.cities[0]?.construction?.active); assert.ok(order);
  for (let count = 0; count < 20 && state.cities[0]?.construction?.active; count++) state = nextBeat(state);
  const installed = state.cities[0]?.improvements?.['56']; assert.ok(installed);
  assert.equal(installed.completion.orderId, order.id); assert.deepEqual(installed.completion.paid, order.paid); assert.equal(installed.operation.lastResult, null);
  const after = nextBeat(state);
  assert.equal(after.cities[0]?.improvements?.['56']?.operation.lastResult?.blockedReason, 'site-ineligible');
  assert.deepEqual(after.cities[0]?.improvements?.['56']?.operation.lastResult?.produced, {});
  assert.equal(after.cities[0]?.improvements?.['58'], undefined);
});
