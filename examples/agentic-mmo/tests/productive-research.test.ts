import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, applyRelease, catchUpStrategy, legalActions } from '../core/engine.ts';
import { TECHNOLOGIES } from '../core/content.ts';
import { isWorldState } from '../core/validation.ts';
import type { TransitionResult, WorldState } from '../core/types.ts';
import { coastalDeparturePrefix, coastalPrefixTime } from './fixtures/coastal-prefix.ts';

const rounded = (value: number) => Math.round(value * 100) / 100;
function civ(state: WorldState) { const value = state.civilizations[0]; assert.ok(value); return value; }
function accepted(result: TransitionResult): WorldState { assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state)); return result.state; }
function nextBeat(state: WorldState): string { assert.ok(state.independentTurns); return coastalPrefixTime((state.independentTurns.strategyTicks + 1) * 60); }
function actionTime(state: WorldState): string { assert.ok(state.independentTurns); return coastalPrefixTime(state.independentTurns.strategyTicks * 60 + 20); }
function adopt(state: WorldState, targetReleaseId: string, timestamp = actionTime(state)): TransitionResult { return applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp }); }
function prepared(productive = true): WorldState {
  let state = coastalDeparturePrefix().state;
  for (const release of ['settlement-residents-1', 'settlement-coastal-1']) state = accepted(adopt(state, release));
  return productive ? accepted(adopt(state, 'settlement-research-rate-1')) : state;
}
function start(state: WorldState): WorldState {
  const before = JSON.stringify(state);
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: actionTime(state), action: { type: 'research', technology: 'civic-institutions' } });
  assert.equal(JSON.stringify(state), before);
  const after = accepted(result);
  assert.equal(civ(after).resources.science, civ(state).resources.science);
  assert.equal(civ(after).researchProgress, 0);
  return after;
}
function advance(state: WorldState): TransitionResult {
  const before = JSON.stringify(state);
  const result = catchUpStrategy(state, nextBeat(state));
  accepted(result);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(result, catchUpStrategy(JSON.parse(before), nextBeat(state)));
  return result;
}
function cost(): number { const technology = TECHNOLOGIES.find(value => value.id === 'civic-institutions'); assert.ok(technology); return technology.cost; }
function invested(state: WorldState): number { return civ(state).technologies.includes('civic-institutions') ? cost() : civ(state).researchProgress; }
function idleProduction(state: WorldState): number {
  const idle = structuredClone(state);
  civ(idle).researchTarget = '';
  civ(idle).researchProgress = 0;
  return rounded(civ(advance(idle).state).resources.science - civ(idle).resources.science);
}

await test('productive release: a synthetic idle bank cannot accelerate actual legal research selection', context => {
  const base = prepared();
  const results = [0, 1000].map(bank => {
    const branch = structuredClone(base);
    civ(branch).resources.science = bank;
    const started = start(branch);
    const generated = idleProduction(started);
    const after = advance(started).state;
    assert.ok(generated > 0 && generated < cost());
    assert.equal(invested(after), generated);
    assert.equal(civ(after).resources.science, bank);
    assert.equal(civ(after).researchTarget, 'civic-institutions');
    return { bank, generated, progress: civ(after).researchProgress };
  });
  assert.equal(results[0]?.progress, results[1]?.progress);
  context.diagnostic(JSON.stringify({ fixture: 'legal prefix and selection; explicitly synthetic bank-only branches', results }));
});

await test('synthetic fully damaged towns produce no research capacity despite retained reserves', () => {
  const state = prepared();
  civ(state).resources.science = 1000;
  for (const city of state.cities.filter(value => value.civId === 0)) city.damage = 100;
  const started = start(state);
  assert.equal(idleProduction(started), 0);
  const after = advance(started).state;
  assert.equal(civ(after).researchProgress, 0);
  assert.equal(civ(after).resources.science, 1000);
});

await test('actual quantized multi-town output includes only a funded academy operation', context => {
  const outcomes = ['funded', 'paused', 'blocked'].map(mode => {
    const enabled = mode !== 'paused';
    const state = prepared();
    civ(state).resources.science = 1000;
    if (mode === 'blocked') civ(state).resources.culture = 0;
    const city = state.cities.find(value => value.civId === 0 && value.population >= 6); assert.ok(city);
    city.buildings.push('academy');
    city.buildingOperations = { ...city.buildingOperations, academy: { enabled, lastResult: null } };
    const started = start(state);
    const generated = idleProduction(started);
    const after = advance(started).state;
    const operation = after.cities.find(value => value.id === city.id)?.buildingOperations?.academy?.lastResult;
    assert.equal(operation?.status, mode === 'funded' ? 'operated' : mode);
    assert.equal(invested(after), Math.min(generated, cost()));
    return { mode, generated, academyScience: operation?.produced.science ?? 0 };
  });
  const [funded, paused, blocked] = outcomes; assert.ok(funded && paused && blocked);
  assert.equal(blocked.generated, paused.generated);
  assert.equal(blocked.academyScience, 0);
  assert.equal(rounded(funded.generated - paused.generated), funded.academyScience);
  assert.ok(funded.academyScience > 0);
  context.diagnostic(JSON.stringify({ fixture: 'synthetic installed academy after legal prefix; real opening allocation and aggregate output', outcomes }));
});

await test('remaining fractional cost caps spending and completion appears exactly once', () => {
  const started = start(prepared());
  civ(started).researchProgress = cost() - 0.01;
  const bank = civ(started).resources.science;
  const generated = idleProduction(started);
  const result = advance(started);
  assert.equal(civ(result.state).resources.science, rounded(bank + generated - 0.01));
  assert.equal(result.events.filter(value => value.type === 'research-completed' && value.actor === 0).length, 1);
  assert.equal(advance(result.state).events.filter(value => value.type === 'research-completed' && value.actor === 0).length, 0);
});

await test('sufficient actual productivity may still finish a discovery in one beat', () => {
  const state = prepared();
  for (const city of state.cities.filter(value => value.civId === 0)) { city.focus = 'research'; city.infrastructure = 100; }
  const started = start(state);
  assert.ok(idleProduction(started) >= cost());
  assert.ok(civ(advance(started).state).technologies.includes('civic-institutions'));
});

await test('unmodified legal journey retains intermediate progress, completion and next available research', context => {
  let state = start(prepared());
  const progress: number[] = [];
  let completions = 0;
  for (let count = 0; count < 32; count += 1) {
    if (civ(state).technologies.includes('civic-institutions')) break;
    const previous = state;
    const generated = idleProduction(previous);
    const result = advance(previous);
    state = result.state;
    const delta = rounded(invested(state) - invested(previous));
    assert.ok(delta > 0 && delta <= generated);
    progress.push(invested(state));
    completions += result.events.filter(value => value.type === 'research-completed' && value.actor === 0).length;
  }
  assert.ok(progress.length > 1);
  assert.equal(completions, 1);
  assert.equal(civ(state).lastResearchCompletion?.technologyId, 'civic-institutions');
  assert.ok(legalActions(state, 0, actionTime(state)).some(value => value.action.type === 'research' && value.action.technology === 'navigation'));
  context.diagnostic(JSON.stringify({ fixture: 'entirely legal release/start/beat journey without resource or technology edits', progress }));
});

await test('caught-up adoption preserves active progress and stock; overdue adoption refuses atomically', () => {
  const started = start(prepared(false));
  const progressed = advance(started).state;
  assert.equal(civ(progressed).researchTarget, 'civic-institutions');
  assert.ok(civ(progressed).researchProgress > 0);
  const before = JSON.stringify(progressed);
  const refused = adopt(progressed, 'settlement-research-rate-1', nextBeat(progressed));
  assert.equal(refused.ok, false);
  assert.match(refused.error ?? '', /strategy|strategic|catch/i);
  assert.equal(JSON.stringify(refused.state), before);
  assert.deepEqual(refused.events, []);
  assert.equal(JSON.stringify(progressed), before);
  const adopted = accepted(adopt(progressed, 'settlement-research-rate-1'));
  assert.deepEqual(adopted.civilizations, progressed.civilizations);
  assert.deepEqual(adopted.cities, progressed.cities);
  assert.deepEqual(adopted.independentTurns, progressed.independentTurns);
});

await test('idle and pre-start beats retain science without retroactive investment', () => {
  const before = prepared();
  const idle = advance(before).state;
  assert.ok(civ(idle).resources.science > civ(before).resources.science);
  assert.equal(civ(idle).researchProgress, 0);
  const started = start(idle);
  assert.equal(civ(started).researchProgress, 0);
  const noBeat = catchUpStrategy(started, actionTime(started));
  assert.equal(noBeat.state, started);
  assert.deepEqual(noBeat.events, []);
  assert.equal(civ(advance(started).state).researchProgress, idleProduction(started));
});

await test('old coastal release retains bank-funded completion and exact JSON replay', () => {
  const state = prepared(false);
  civ(state).resources.science = 1000;
  const started = start(state);
  assert.ok(idleProduction(started) < cost());
  assert.ok(civ(advance(started).state).technologies.includes('civic-institutions'));
});

await test('batched post-start catch-up matches separate productive beats and never reuses their budget', () => {
  const started = start(prepared());
  let separate = started;
  for (let count = 0; count < 3; count += 1) separate = advance(separate).state;
  assert.ok(separate.independentTurns);
  const timestamp = coastalPrefixTime(separate.independentTurns.strategyTicks * 60);
  const batched = accepted(catchUpStrategy(started, timestamp));
  assert.deepEqual(batched, separate);
  assert.equal(catchUpStrategy(batched, timestamp).state, batched);
});

await test('research selected one millisecond before the boundary receives only that actual beat output', () => {
  const state = prepared();
  civ(state).resources.science = 1000;
  const timestamp = new Date(Date.parse(nextBeat(state)) - 1).toISOString();
  const started = accepted(applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp, action: { type: 'research', technology: 'civic-institutions' } }));
  const result = advance(started);
  assert.equal(civ(result.state).researchProgress, idleProduction(started));
  assert.ok(civ(result.state).researchProgress < cost());
});

await test('research-start facts describe the applied rule while historical event wording stays exact', () => {
  for (const productive of [false, true]) {
    const state = prepared(productive);
    const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: actionTime(state), action: { type: 'research', technology: 'civic-institutions' } });
    accepted(result);
    const event = result.events.find(value => value.type === 'research-started'); assert.ok(event);
    assert.equal(event.cause, productive
      ? 'The civilization committed science produced by its settlements each strategic beat to a released technology'
      : 'The civilization committed its accumulated and future science to a released technology');
  }
});
