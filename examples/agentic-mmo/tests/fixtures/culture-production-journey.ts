import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { BUILDINGS } from '../../core/content.ts';
import { legalActions } from '../../core/engine.ts';
import { RELEASES } from '../../core/release.ts';
import { availableDistrictSites } from '../../core/simulation/districts.ts';
import { hexDistance } from '../../core/simulation/geography.ts';
import type { GameAction } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './coastal-prefix.ts';
import { ownedTerritoryJourney } from './owned-territory-journey.ts';
import { waterLandTown } from './water-land-journey.ts';

export function cultureProductionPrefix() {
  const previous = ownedTerritoryJourney(); let state = structuredClone(previous.state);
  const steps: CoastalPrefixStep[] = [...previous.steps]; const seat = 0; const cityId = 'city-0';
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state); const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state), `Canonical culture frame ${result.state.revision}`);
    steps.push({ before, input, result }); state = result.state;
  };
  const act = (action: GameAction, actor = seat): void => {
    assert.ok(legalActions(state, actor, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify({ actor, action }));
    commit({ kind: 'action', command: { seat: actor, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean): void => { for (let count = 0; count < 160 && !condition(); count++) beat(); assert.ok(condition(), 'Bounded actual culture outcome was not reached'); };
  const research = (technology: string): void => { if (state.civilizations[seat]?.technologies.includes(technology)) return; act({ type: 'research', technology }); until(() => !!state.civilizations[seat]?.technologies.includes(technology)); };
  const campus = BUILDINGS.find(building => building.id === 'campus'); assert.ok(campus);
  const sites = availableDistrictSites(state, waterLandTown(state, cityId), campus);
  const adjacent = (left: number, right: number): boolean => { const a = state.tiles.find(tile => tile.id === left); const b = state.tiles.find(tile => tile.id === right); assert.ok(a && b); return hexDistance(a, b) === 1; };
  const wonder = legalActions(state, seat, time()).find(option => {
    const action = option.action;
    return action.type === 'build-wonder' && action.cityId === cityId && sites.some(tileId => tileId !== action.tileId && adjacent(tileId, action.tileId));
  });
  assert.ok(wonder?.action.type === 'build-wonder'); const wonderTileId = wonder.action.tileId;
  const theaterTileId = sites.find(tileId => tileId !== wonderTileId && adjacent(tileId, wonderTileId)); assert.ok(theaterTileId !== undefined);
  act(wonder.action); const wonderActive = structuredClone(state);
  until(() => !!state.wonders?.['great-library']); const wonderCompleted = structuredClone(state);
  for (const technology of ['archery', 'machinery', 'navigation']) research(technology);
  const departureId = 'city-0-14';
  if (!waterLandTown(state, departureId).buildings.includes('boat-yard')) { act({ type: 'build', cityId: departureId, project: 'boat-yard' }); until(() => waterLandTown(state, departureId).buildings.includes('boat-yard')); }
  const coast = legalActions(state, seat, time()).find(option => option.action.type === 'settle-coast'); assert.ok(coast);
  act(coast.action); until(() => state.calendarMilestones.includes('connected-world'));
  return { previous, initial: previous.initial, steps, seat, cityId, wonderTileId, theaterTileId, wonderActive, wonderCompleted, get state() { return state; }, time, act, beat, until, research, commit };
}

export function cultureProductionJourney() {
  const journey = cultureProductionPrefix(); const beforeRelease = structuredClone(journey.state);
  const release = RELEASES.find(candidate => candidate.compatibleFrom.includes(journey.state.releaseId) && candidate.featureIds.includes('culture-production'));
  assert.ok(release, 'Actual compatible culture-production release must expose Construction Theater and Printing house');
  journey.commit({ kind: 'release', command: { expectedRevision: journey.state.revision, expectedFromReleaseId: journey.state.releaseId, targetReleaseId: release.id, timestamp: journey.time() } });
  const adopted = structuredClone(journey.state);
  return { journey, beforeRelease, adopted };
}

export function cultureProductionOperationJourney() {
  const { journey, beforeRelease, adopted } = cultureProductionJourney();
  journey.research('construction'); const constructionReady = structuredClone(journey.state);
  journey.act({ type: 'build', project: 'theater-square', cityId: journey.cityId, tileId: journey.theaterTileId }); const theaterActive = structuredClone(journey.state);
  journey.until(() => waterLandTown(journey.state, journey.cityId).buildings.includes('theater-square'));
  const theaterCompleted = structuredClone(journey.state); const theaterCompletionStep = journey.steps.at(-1); assert.ok(theaterCompletionStep);
  journey.beat(); const theaterOperated = structuredClone(journey.state);
  journey.research('printing'); const printingReady = structuredClone(journey.state);
  journey.act({ type: 'build', project: 'printing-house', cityId: journey.cityId }); const printingActive = structuredClone(journey.state);
  journey.until(() => waterLandTown(journey.state, journey.cityId).buildings.includes('printing-house'));
  const printingCompleted = structuredClone(journey.state);
  journey.beat(); const operated = structuredClone(journey.state);
  return { journey, beforeRelease, adopted, constructionReady, theaterActive, theaterCompleted, theaterCompletionStep, theaterOperated, printingReady, printingActive, printingCompleted, operated };
}
