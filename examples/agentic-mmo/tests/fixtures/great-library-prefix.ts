import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { legalActions } from '../../core/engine.ts';
import type { GameAction } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import { coastalDeparturePrefix, coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';

export function greatLibraryPrefix() {
  const prefix = coastalDeparturePrefix();
  let state = prefix.state;
  const steps: CoastalPrefixStep[] = [...prefix.steps];
  const time = (): string => coastalPrefixTime(Math.max(
    (state.independentTurns?.strategyTicks ?? 0) * 60 + 20,
    ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10),
  ));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state);
    const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error);
    assert.deepEqual(state, before);
    assert.ok(isWorldState(result.state));
    steps.push({ input, before, result }); state = result.state;
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean): void => {
    for (let count = 0; count < 48 && !condition(); count++) beat();
    assert.ok(condition(), 'Bounded legal preparation must reach its stated existing capability');
  };
  const act = (seat: number, action: GameAction): void => {
    assert.ok(legalActions(state, seat, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify({ seat, action }));
    commit({ kind: 'action', command: { seat, expectedRevision: state.revision, timestamp: time(), action } });
  };
  for (const targetReleaseId of ['settlement-residents-1', 'settlement-coastal-1', 'settlement-research-rate-1', 'settlement-writing-1', 'settlement-mining-1', 'settlement-metal-learning-1']) {
    commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: time() } });
  }
  const contenders: { seat: number; cityId: string; campusTileId: number }[] = [];
  for (const seat of [0, 1]) {
    const cityId = `city-${seat}`;
    for (const technology of ['agriculture', 'writing']) {
      if (state.civilizations.find(civilization => civilization.id === seat)?.technologies.includes(technology)) continue;
      act(seat, { type: 'research', technology });
      until(() => !!state.civilizations.find(civilization => civilization.id === seat)?.technologies.includes(technology));
    }
    const campus = legalActions(state, seat, time()).find(option => option.action.type === 'build' && option.action.project === 'campus' && option.action.cityId === cityId);
    assert.ok(campus?.action.type === 'build' && campus.action.tileId !== undefined);
    const campusTileId = campus.action.tileId;
    act(seat, campus.action);
    until(() => !!state.cities.find(city => city.id === cityId)?.buildings.includes('campus'));
    act(seat, { type: 'build', project: 'library', cityId });
    until(() => !!state.cities.find(city => city.id === cityId)?.buildings.includes('library'));
    beat();
    contenders.push({ seat, cityId, campusTileId });
  }
  act(0, { type: 'build', project: 'farm', cityId: 'city-0' });
  until(() => !!state.cities.find(city => city.id === 'city-0')?.buildings.includes('farm'));
  for (const seat of [0, 1]) {
    act(seat, { type: 'research', technology: 'civic-institutions' });
    until(() => !!state.civilizations.find(civilization => civilization.id === seat)?.technologies.includes('civic-institutions'));
  }
  for (const [proposer, recipient] of [[0, 2], [2, 1], [1, 3]] as const) {
    act(proposer, { type: 'propose-trade', partner: recipient, recipeId: 'harvest-for-materials', sourceCityId: `city-${proposer}`, recipientCityId: `city-${recipient}` });
    const offer = state.tradeOffers?.find(candidate => candidate.proposer === proposer && candidate.recipient === recipient && candidate.status === 'pending');
    assert.ok(offer);
    act(recipient, { type: 'respond-trade', offerId: offer.id, accept: true });
    beat();
  }
  until(() => state.calendarMilestones.includes('rise-of-states'));
  until(() => contenders.every(contender => {
    const civilization = state.civilizations.find(candidate => candidate.id === contender.seat);
    return !!civilization && civilization.resources.materials >= 50 && civilization.resources.credits >= 25;
  }));
  return structuredClone({ initial: prefix.initial, state, steps, timestamp: time(), contenders });
}
