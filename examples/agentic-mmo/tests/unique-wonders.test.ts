import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { applyCommand, catchUpStrategy, legalActions, observe } from '../core/engine.ts';
import { RELEASES } from '../core/release.ts';
import { isWorldState } from '../core/validation.ts';
import { isGameAction } from '../core/planning.ts';
import { isWonderOrder } from '../core/simulation/wonders.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import { projectCapabilities } from '../core/capabilities.ts';
import type { GameAction, WonderLossReceipt, WorldState } from '../core/types.ts';
import { greatLibraryPrefix } from './fixtures/great-library-prefix.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';

type WonderAction = Extract<GameAction, { type: 'build-wonder' | 'apply-research-boost' }>;
function record(state: WorldState) { return state.wonders?.['great-library']; }
function typed(action: WonderAction): GameAction { return action; }

export function uniqueWonderJourney() {
  const previous = greatLibraryPrefix();
  let state = structuredClone(previous.state);
  const steps: CoastalPrefixStep[] = [];
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civ => ((state.independentTurns?.lastActionWindow[civ.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state);
    const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state), `Canonical state at revision ${result.state.revision}`);
    steps.push({ input, before, result }); state = result.state;
  };
  const act = (seat: number, action: GameAction): void => {
    const exact = action;
    assert.ok(legalActions(state, seat, time()).some(option => isDeepStrictEqual(option.action, exact)), JSON.stringify({ seat, action }));
    commit({ kind: 'action', command: { seat, expectedRevision: state.revision, timestamp: time(), action: exact } });
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean): void => { for (let count = 0; count < 80 && !condition(); count++) beat(); assert.ok(condition()); };
  commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: 'settlement-manufacturing-1', timestamp: time() } });
  const target = RELEASES.find(release => release.compatibleFrom.includes(state.releaseId) && release.featureIds.includes('unique-wonders'));
  assert.ok(target, 'A compatible unique-wonders release must expose the real Great library path');
  const beforeRelease = structuredClone(state);
  commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: target.id, timestamp: time() } });
  return { previous, beforeRelease, steps, get state() { return state; }, time, act, beat, until };
}
function chooseWonder(journey: ReturnType<typeof uniqueWonderJourney>, seat: number): Extract<GameAction, { type: 'build-wonder' }> {
  const selected = legalActions(journey.state, seat, journey.time()).find(candidate => candidate.action.type === 'build-wonder');
  assert.ok(selected?.action.type === 'build-wonder', 'Released eligible Writing civilization needs exact wonder site choices');
  return selected.action;
}
export function uniqueWonderCompletionJourney() {
  const journey = uniqueWonderJourney();
  const first = chooseWonder(journey, 0); const second = chooseWonder(journey, 1);
  journey.act(0, first); journey.act(1, second);
  const contested = structuredClone(journey.state);
  journey.until(() => !!record(journey.state));
  return { journey, contested, completed: structuredClone(journey.state) };
}

await test('unique wonder historical prefix retains era-one Writing and refuses future exact actions without effects', () => {
  const prefix = greatLibraryPrefix();
  for (const contender of prefix.contenders) {
    const civ = prefix.state.civilizations.find(item => item.id === contender.seat); assert.ok(civ);
    assert.ok(civ.era >= 1 && civ.technologies.includes('writing')); assert.ok(civ.resources.materials >= 50 && civ.resources.credits >= 25);
  }
  const before = structuredClone(prefix.state);
  const result = applyCommand(prefix.state, { seat: 0, expectedRevision: prefix.state.revision, timestamp: prefix.timestamp, action: typed({ type: 'build-wonder', wonderId: 'great-library', cityId: 'city-0', tileId: 56 }) });
  assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(result.events, []);
});

await test('unique wonder compatible adoption preserves stocks sites history and exposes actual exact starts', () => {
  const journey = uniqueWonderJourney();
  assert.deepEqual(journey.state.tiles, journey.beforeRelease.tiles);
  assert.deepEqual(journey.state.civilizations, journey.beforeRelease.civilizations);
  assert.deepEqual(journey.state.cities, journey.beforeRelease.cities);
  assert.ok(chooseWonder(journey, 0)); assert.ok(chooseWonder(journey, 1));
});

await test('unique wonder contender start reserves one exact site and pays fifty materials twenty-five credits once', () => {
  const journey = uniqueWonderJourney(); const action = chooseWonder(journey, 0);
  assert.equal(action.type, 'build-wonder'); if (action.type !== 'build-wonder') return;
  const before = structuredClone(journey.state); journey.act(0, action);
  const order = journey.state.cities.find(city => city.id === action.cityId)?.construction?.active;
  assert.ok(order); assert.ok(isWonderOrder(order)); assert.equal(order.tileId, action.tileId); assert.equal(order.workRequired, 24); assert.equal(order.workDone, 0);
  assert.deepEqual(order.paid, { materials: 50, credits: 25 });
  assert.equal(before.civilizations[0]?.resources.materials, (journey.state.civilizations[0]?.resources.materials ?? 0) + 50);
  assert.equal(before.civilizations[0]?.resources.credits, (journey.state.civilizations[0]?.resources.credits ?? 0) + 25);
  assert.equal(record(journey.state), undefined);
  assert.ok(!legalActions(journey.state, 0, journey.time()).some(candidate => candidate.action.type === 'build-wonder'));
});

await test('unique wonder real contenders resolve one winner and retain exactly one material-only losing settlement', () => {
  const { journey, contested, completed } = uniqueWonderCompletionJourney();
  const won = record(completed); assert.ok(won); assert.equal(won.losses.length, 1); assert.equal(won.boostLimit, 2); assert.deepEqual(won.boosts, []);
  const loss = won.losses[0]; assert.ok(loss); assert.deepEqual(loss.refund, { materials: 25 }); assert.deepEqual(loss.paid, { materials: 50, credits: 25 }); assert.equal(loss.winnerOrderId, won.completion.orderId);
  for (const contender of journey.previous.contenders) assert.equal(completed.cities.find(city => city.id === contender.cityId)?.construction?.active, null);
  assert.equal(contested.cities.filter(city => city.construction?.active && isWonderOrder(city.construction.active)).length, 2);
  journey.beat(); assert.deepEqual(record(journey.state), won);
  for (const step of journey.steps) assert.deepEqual(replayCoastalStep(structuredClone(step.before), step.input), step.result);
});

await test('unique wonder invalid exact towns and occupied foreign or missing sites refuse atomically', () => {
  const journey = uniqueWonderJourney(); const city = journey.state.cities.find(item => item.id === 'city-0'); assert.ok(city);
  const actions: GameAction[] = [
    { type: 'build-wonder', wonderId: 'great-library', cityId: 'city-1', tileId: 31 },
    { type: 'build-wonder', wonderId: 'great-library', cityId: 'missing', tileId: 56 },
    ...[city.tileId, 39, 30, -1].map(tileId => ({ type: 'build-wonder' as const, wonderId: 'great-library', cityId: city.id, tileId })),
  ];
  for (const action of actions) {
    const before = structuredClone(journey.state);
    const result = applyCommand(journey.state, { seat: 0, expectedRevision: journey.state.revision, timestamp: journey.time(), action });
    assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(journey.state, before); assert.deepEqual(result.events, []);
  }
});

await test('unique wonder optional boost preserves idle charges then applies exact active progress without science debit', () => {
  const { journey } = uniqueWonderCompletionJourney(); const won = record(journey.state); assert.ok(won);
  const seat = won.completion.civId;
  assert.ok(!legalActions(journey.state, seat, journey.time()).some(candidate => candidate.action.type === 'apply-research-boost'));
  journey.act(seat, { type: 'research', technology: 'currency' });
  const before = structuredClone(journey.state); journey.act(seat, { type: 'apply-research-boost', wonderId: 'great-library', technology: 'currency' });
  const boost = record(journey.state)?.boosts[0]; assert.ok(boost); assert.equal(boost.technologyId, 'currency'); assert.equal(boost.amount, 25.2); assert.equal(boost.progressBefore, 0); assert.equal(boost.progressAfter, 25.2); assert.equal(boost.unusedAmount, 0);
  assert.equal(journey.state.civilizations[seat]?.resources.science, before.civilizations[seat]?.resources.science);
  assert.equal(journey.state.civilizations[seat]?.researchTarget, 'currency');
  const duplicate = applyCommand(journey.state, { seat, expectedRevision: journey.state.revision, timestamp: journey.time(), action: typed({ type: 'apply-research-boost', wonderId: 'great-library', technology: 'currency' }) });
  assert.equal(duplicate.ok, false); assert.deepEqual(duplicate.state, journey.state);
});

await test('unique wonder exact actions are accepted by the shared parser without admitting malformed site or target', () => {
  assert.equal(isGameAction({ type: 'build-wonder', wonderId: 'great-library', cityId: 'city-0', tileId: 56 }), true);
  assert.equal(isGameAction({ type: 'apply-research-boost', wonderId: 'great-library', technology: 'currency' }), true);
  assert.equal(isGameAction({ type: 'build-wonder', wonderId: 'great-library', cityId: 'city-0', tileId: 1.5 }), false);
  assert.equal(isGameAction({ type: 'apply-research-boost', wonderId: 'great-library', technology: '' }), false);
});

await test('unique wonder Writing town without Campus remains eligible and does not consume a district slot', () => {
  const journey = uniqueWonderJourney();
  const town = journey.state.cities.find(city => city.civId === 0 && !city.buildings.includes('campus')); assert.ok(town);
  const start = legalActions(journey.state, 0, journey.time()).find(candidate => {
    const action = candidate.action;
    return action.type === 'build-wonder' && action.cityId === town.id;
  });
  assert.ok(start, 'Writing and era one must suffice without an added Campus prerequisite');
  journey.act(0, start.action);
  assert.deepEqual(journey.state.cities.find(city => city.id === town.id)?.districtSites, town.districtSites);
});

await test('unique wonder synthetic same-beat thresholds resolve by start round then civilization regardless of city array order', () => {
  const { journey, contested } = uniqueWonderCompletionJourney();
  const fixture = structuredClone(contested);
  for (const town of fixture.cities) if (town.construction?.active && isWonderOrder(town.construction.active)) {
    const order = town.construction?.active; assert.ok(order);
    order.startedRound = fixture.round; order.workDone = order.workRequired - 0.01;
  }
  const timestamp = coastalPrefixTime(((fixture.independentTurns?.strategyTicks ?? 0) + 1) * 60);
  const first = replayCoastalStep(fixture, { kind: 'strategy', timestamp });
  const reordered = structuredClone(fixture); reordered.cities.reverse();
  const second = replayCoastalStep(reordered, { kind: 'strategy', timestamp });
  assert.ok(first.ok && second.ok);
  assert.equal(record(first.state)?.completion.civId, 0);
  assert.deepEqual(record(first.state), record(second.state));
  assert.equal(record(first.state)?.losses.length, 1);
  const earlier = structuredClone(fixture);
  const earlierOrder = earlier.cities.find(city => city.civId === 1)?.construction?.active; assert.ok(earlierOrder);
  earlierOrder.startedRound -= 1;
  const earlierResult = replayCoastalStep(earlier, { kind: 'strategy', timestamp }); assert.ok(earlierResult.ok);
  assert.equal(record(earlierResult.state)?.completion.civId, 1);
  assert.ok(journey.steps.length > 0);
});

await test('unique wonder synthetic capped active progress completes once without stock debit overflow or automatic next target', () => {
  const { journey } = uniqueWonderCompletionJourney(); const won = record(journey.state); assert.ok(won);
  const seat = won.completion.civId; journey.act(seat, { type: 'research', technology: 'currency' });
  const fixture = structuredClone(journey.state); const civ = fixture.civilizations.find(candidate => candidate.id === seat); assert.ok(civ);
  civ.researchProgress = 125;
  const before = structuredClone(fixture);
  const result = applyCommand(fixture, { seat, expectedRevision: fixture.revision, timestamp: journey.time(), action: typed({ type: 'apply-research-boost', wonderId: 'great-library', technology: 'currency' }) });
  assert.ok(result.ok, result.error); assert.deepEqual(fixture, before);
  const after = result.state.civilizations.find(candidate => candidate.id === seat); assert.ok(after);
  assert.equal(after.resources.science, civ.resources.science); assert.equal(after.researchTarget, ''); assert.equal(after.researchProgress, 0);
  assert.equal(after.technologies.filter(id => id === 'currency').length, 1);
  const boost = record(result.state)?.boosts[0]; assert.ok(boost);
  assert.equal(boost.amount, 1); assert.equal(boost.unusedAmount, 24.2); assert.equal(boost.progressAfter, 126);
  assert.equal(result.events.filter(event => event.type === 'research-completed' && event.actor === seat).length, 1);
  const next = replayCoastalStep(result.state, { kind: 'strategy', timestamp: coastalPrefixTime(((result.state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  assert.ok(next.ok); assert.equal(next.events.filter(event => event.type === 'research-completed' && event.actor === seat).length, 0);
});

export function uniqueWonderBoostJourney() {
  const result = uniqueWonderCompletionJourney();
  const { journey } = result;
  const winner = record(journey.state); assert.ok(winner);
  const seat = winner.completion.civId;
  journey.act(seat, { type: 'research', technology: 'currency' });
  journey.act(seat, { type: 'apply-research-boost', wonderId: 'great-library', technology: 'currency' });
  const partial = structuredClone(journey.state);
  journey.until(() => !!journey.state.civilizations.find(civ => civ.id === seat)?.technologies.includes('currency'));
  journey.act(seat, { type: 'research', technology: 'mathematics' });
  journey.until(() => {
    const civ = journey.state.civilizations.find(candidate => candidate.id === seat); assert.ok(civ);
    assert.equal(civ.researchTarget, 'mathematics', 'The legal witness must reach a capped boost before ordinary completion');
    return civ.researchProgress >= 132 - 26.4;
  });
  const beforeCapped = structuredClone(journey.state);
  journey.act(seat, { type: 'apply-research-boost', wonderId: 'great-library', technology: 'mathematics' });
  return { ...result, partial, beforeCapped, boosted: structuredClone(journey.state) };
}

await test('unique wonder legal two-charge journey caps the second distinct active discovery and retains exact replay', () => {
  const { journey, partial, beforeCapped, boosted } = uniqueWonderBoostJourney();
  assert.equal(record(partial)?.boosts.length, 1);
  const completed = record(boosted); assert.ok(completed); assert.equal(completed.boosts.length, 2);
  const boost = completed.boosts[1]; assert.ok(boost); assert.equal(boost.technologyId, 'mathematics'); assert.ok(boost.unusedAmount > 0 && boost.amount > 0);
  const before = beforeCapped.civilizations.find(civ => civ.id === boost.civId); const after = boosted.civilizations.find(civ => civ.id === boost.civId); assert.ok(before && after);
  assert.equal(after.resources.science, before.resources.science); assert.equal(after.researchTarget, ''); assert.equal(after.lastResearchCompletion?.eventId, boost.researchCompletionEventId);
  assert.equal(boost.progressAfter, boost.costBasis); assert.equal(boost.amount + boost.unusedAmount, boost.nominalAmount);
  assert.equal(boosted.events.filter(event => event.id === boost.researchCompletionEventId).length, 1);
  assert.ok(!legalActions(boosted, boost.civId, journey.time()).some(candidate => candidate.action.type === 'apply-research-boost'));
  for (const step of journey.steps) assert.deepEqual(replayCoastalStep(structuredClone(step.before), step.input), step.result);
});

await test('unique wonder completion adds no retroactive science and its next beat adds actual parent-town output only', () => {
  const { journey, completed } = uniqueWonderCompletionJourney();
  const winner = record(completed); assert.ok(winner);
  let control = structuredClone(journey.steps.find(step => step.input.kind === 'action' && step.input.command.action.type === 'build-wonder')?.before); assert.ok(control);
  while (control.round < completed.round) {
    const next = catchUpStrategy(control, coastalPrefixTime(((control.independentTurns?.strategyTicks ?? 0) + 1) * 60)); assert.ok(next.ok); control = next.state;
  }
  for (const civ of completed.civilizations) assert.equal(civ.resources.science, control.civilizations.find(other => other.id === civ.id)?.resources.science);
  const city = completed.cities.find(town => town.id === winner.completion.cityId); assert.ok(city);
  const timestamp = coastalPrefixTime(((control.independentTurns?.strategyTicks ?? 0) + 1) * 60);
  const baseline = catchUpStrategy(control, timestamp); const operated = catchUpStrategy(completed, timestamp); assert.ok(baseline.ok && operated.ok);
  for (const civ of operated.state.civilizations) {
    const other = baseline.state.civilizations.find(candidate => candidate.id === civ.id); assert.ok(other);
    assert.equal(Math.round((civ.resources.science - other.resources.science) * 100) / 100, civ.id === winner.completion.civId ? Math.round(4 * cityProductivity(city) * 100) / 100 : 0);
    const loss: WonderLossReceipt | undefined = winner.losses.find(candidate => candidate.civId === civ.id);
    if (civ.id === winner.completion.civId || loss) {
      assert.equal(Math.round((civ.resources.materials - other.resources.materials) * 100) / 100, loss ? -25 : -50);
      assert.equal(Math.round((civ.resources.credits - other.resources.credits) * 100) / 100, -25);
    }
  }
});

await test('unique wonder canonical facts are detached and preserve exact active and completed targets', () => {
  const { journey, contested, completed } = uniqueWonderCompletionJourney();
  const active = projectCapabilities(contested, 0, 'city-0', coastalPrefixTime((contested.independentTurns?.strategyTicks ?? 0) * 60 + 50)).wonders?.find(row => row.nodeId === 'wonder:great-library');
  assert.ok(active?.construction && isWonderOrder(active.construction)); assert.equal(active.facts.contenders.length, 2);
  const view = observe(contested, 2, journey.time());
  const rival = view.wonders?.find(wonder => wonder.wonderId === 'great-library')?.contenders.find(contender => contender.cityId === 'city-1');
  assert.ok(rival); assert.equal(rival.civId, 1);
  assert.ok(!view.cities.some(city => city.id === rival.cityId));
  const stored = contested.cities.find(city => city.id === rival.cityId)?.construction?.active; assert.ok(stored);
  assert.ok(!('civId' in stored)); assert.equal(rival.tileId, stored.tileId);
  rival.paid.materials = 0; assert.equal(stored.paid.materials, 50);
  const won = record(completed); assert.ok(won);
  const projection = projectCapabilities(completed, won.completion.civId, won.completion.cityId, journey.time());
  const row = projection.wonders?.find(candidate => candidate.nodeId === 'wonder:great-library'); assert.ok(row);
  assert.equal(row.status, 'done'); assert.deepEqual(row.facts.completed, won); assert.equal(row.facts.boost.remaining, 2); assert.ok(row.facts.boost.blocker);
  assert.ok(row.facts.completed); row.facts.completed.losses.length = 0;
  assert.equal(record(completed)?.losses.length, 1);
});

await test('unique wonder completed claim blocks later paid starts and releases only the losing site', () => {
  const { journey, completed } = uniqueWonderCompletionJourney();
  const won = record(completed); assert.ok(won); const loss = won.losses[0]; assert.ok(loss);
  const before = structuredClone(journey.state);
  const refused = applyCommand(journey.state, { seat: loss.civId, expectedRevision: journey.state.revision, timestamp: journey.time(), action: { type: 'build-wonder', wonderId: 'great-library', cityId: loss.cityId, tileId: loss.tileId } });
  assert.equal(refused.ok, false); assert.deepEqual(refused.state, before); assert.deepEqual(refused.events, []);
  const projection = projectCapabilities(completed, loss.civId, loss.cityId, journey.time());
  const row = projection.wonders?.find(candidate => candidate.nodeId === 'wonder:great-library'); assert.ok(row);
  assert.equal(row.status, 'locked'); assert.ok(row.blockers.some(blocker => blocker.kind === 'wonder-completed'));
  assert.ok(!completed.cities.some(city => city.construction?.active?.tileId === loss.tileId));
  assert.ok(!Object.values(completed.wonders ?? {}).some(wonder => wonder.completion.tileId === loss.tileId));
  assert.equal(won.completion.tileId, before.wonders?.['great-library']?.completion.tileId);
});

await test('unique wonder wrong owner target and third boost refuse without changing retained charges or stocks', () => {
  const { journey, completed, boosted } = uniqueWonderBoostJourney();
  const won = record(boosted); assert.ok(won);
  const winner = won.completion.civId;
  const samples = [
    { state: completed, seat: winner, technology: 'currency' },
    { state: boosted, seat: winner, technology: 'mathematics' },
    { state: boosted, seat: winner === 0 ? 1 : 0, technology: 'currency' },
  ];
  for (const sample of samples) {
    const before = structuredClone(sample.state);
    const timestamp = coastalPrefixTime(Math.max((sample.state.independentTurns?.strategyTicks ?? 0) * 60 + 50, ((sample.state.independentTurns?.lastActionWindow[sample.seat] ?? -1) + 1) * 10));
    const result = applyCommand(sample.state, { seat: sample.seat, expectedRevision: sample.state.revision, timestamp, action: { type: 'apply-research-boost', wonderId: 'great-library', technology: sample.technology } });
    assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(sample.state, before); assert.deepEqual(result.events, []);
  }
  assert.ok(journey.steps.length > 0);
});

await test('unique wonder exact two-item plan retains start identity and refuses a mismatched site head', () => {
  const journey = uniqueWonderJourney(); const action = chooseWonder(journey, 0);
  const result = applyCommand(journey.state, { seat: 0, expectedRevision: journey.state.revision, timestamp: journey.time(), action,
    plan: [{ action, reason: 'Compete for this exact learning site.' }, { action: { type: 'research', technology: 'currency' }, reason: 'Prepare the next useful discovery.' }] });
  assert.ok(result.ok, result.error); assert.deepEqual(result.state.actionPlans?.[0]?.items[0]?.action, action); assert.equal(result.state.actionPlans?.[0]?.items.length, 2);
  const mismatch = applyCommand(journey.state, { seat: 0, expectedRevision: journey.state.revision, timestamp: journey.time(), action,
    plan: [{ action: { ...action, tileId: action.tileId + 1 }, reason: 'Different exact site.' }] });
  assert.equal(mismatch.ok, false); assert.deepEqual(mismatch.state, journey.state);
});

await test('unique wonder reservations and completed sites block other exact construction without territorial changes', () => {
  const { journey, contested, completed } = uniqueWonderCompletionJourney(); const won = record(completed); assert.ok(won);
  const other = completed.cities.find(city => city.civId === won.completion.civId && city.id !== won.completion.cityId); assert.ok(other);
  for (const state of [contested, completed]) {
    const before = structuredClone(state);
    const result = applyCommand(state, { seat: other.civId, expectedRevision: state.revision, timestamp: coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 50, ((state.independentTurns?.lastActionWindow[other.civId] ?? -1) + 1) * 10)), action: { type: 'build', cityId: other.id, project: 'campus', tileId: won.completion.tileId } });
    assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(result.events, []);
  }
  assert.deepEqual(completed.tiles, journey.beforeRelease.tiles);
});

await test('unique wonder synthetic ineligible era and unreleased active research cannot consume a retained charge', () => {
  const { journey, completed } = uniqueWonderCompletionJourney(); const won = record(completed); assert.ok(won);
  for (const technology of ['banking', 'spaceflight']) {
    const fixture = structuredClone(completed); const civ = fixture.civilizations.find(candidate => candidate.id === won.completion.civId); assert.ok(civ);
    civ.researchTarget = technology; civ.researchProgress = 0;
    const before = structuredClone(fixture);
    const result = applyCommand(fixture, { seat: civ.id, expectedRevision: fixture.revision, timestamp: journey.time(), action: { type: 'apply-research-boost', wonderId: 'great-library', technology } });
    assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(result.events, []); assert.equal(record(result.state)?.boosts.length, 0);
  }
});
