import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { BUILDINGS, TECHNOLOGIES } from '../../core/content.ts';
import { applyCommand, catchUpStrategy, createWorld, legalActions } from '../../core/engine.ts';
import { availableDistrictSites } from '../../core/simulation/districts.ts';
import { paidRecipe } from '../../core/simulation/operations.ts';
import type { Command, GameAction, TransitionResult, WorldState } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';

export type CoastalPrefixInput = { kind: 'action'; command: Command } | { kind: 'strategy'; timestamp: string };
export interface CoastalPrefixStep { input: CoastalPrefixInput; before: WorldState; result: TransitionResult }
export interface CoastalPrefix { initial: WorldState; state: WorldState; steps: CoastalPrefixStep[]; departureCityId: string; timestamp: string; provenance: string }
export const COASTAL_PREFIX_EPOCH = '2026-10-16T00:00:00.000Z';
export function coastalPrefixTime(seconds: number): string { return new Date(Date.parse(COASTAL_PREFIX_EPOCH) + seconds * 1000).toISOString(); }

export function replayCoastalStep(state: WorldState, input: CoastalPrefixInput): TransitionResult {
  return input.kind === 'action' ? applyCommand(state, input.command) : catchUpStrategy(state, input.timestamp);
}

export function syntheticTechnologies(state: WorldState, seat: number, technologies: readonly string[]): void {
  const actor = state.civilizations.find(candidate => candidate.id === seat); assert.ok(actor);
  for (const id of technologies) {
    const definition = TECHNOLOGIES.find(candidate => candidate.id === id); assert.ok(definition);
    assert.ok(definition.requiredFeatures.every(feature => state.unlockedFeatures.includes(feature)), `Synthetic prerequisite ${id} requires selected rules`);
    syntheticTechnologies(state, seat, definition.requires);
    if (!actor.technologies.includes(id)) actor.technologies.push(id);
  }
}

export function syntheticInstitution(state: WorldState, cityId: string, buildingId: string, tileId?: number): void {
  const city = state.cities.find(candidate => candidate.id === cityId); const building = BUILDINGS.find(candidate => candidate.id === buildingId); assert.ok(city && building);
  assert.ok(building.requiredFeatures.every(feature => state.unlockedFeatures.includes(feature)));
  assert.ok(!city.buildings.includes(buildingId));
  if (building.district) {
    const sites = availableDistrictSites(state, city, building);
    const site = tileId ?? sites.find(id => !state.strategicDeposits?.deposits[String(id)] && !state.coalDeposits?.deposits[String(id)] && !state.pastoralSites?.sites[String(id)]);
    assert.ok(site !== undefined && sites.includes(site), `Synthetic ${buildingId} needs an available exact site`);
    city.districtSites ??= {}; city.districtSites[buildingId] = site;
  }
  city.buildings.push(buildingId);
  if (paidRecipe(building)) { city.buildingOperations ??= {}; city.buildingOperations[buildingId] = { enabled: true, lastResult: null }; }
}

export function freshFixtureJourney(rulesId: string, syntheticPrerequisites: (state: WorldState) => void, provenance: string, seat = 0) {
  let state = createWorld(1701, COASTAL_PREFIX_EPOCH, rulesId);
  const selectedFeatures = [...state.unlockedFeatures];
  syntheticPrerequisites(state);
  assert.equal(state.releaseId, rulesId); assert.deepEqual(state.unlockedFeatures, selectedFeatures);
  assert.equal(state.revision, 0); assert.equal(state.round, 0);
  assert.ok(isWorldState(state), `Invalid fresh synthetic prerequisites for ${rulesId}`);
  const initial = structuredClone(state); const steps: CoastalPrefixStep[] = [];
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(actor => ((state.independentTurns?.lastActionWindow[actor.id] ?? -1) + 1) * 10)));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state); const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state), `Invalid actual ${rulesId} frame ${result.state.revision}`);
    steps.push({ before, input, result }); state = result.state;
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const act = (action: GameAction, actor = seat): void => {
    if (Date.parse(time()) >= Date.parse(coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60))) beat();
    assert.ok(legalActions(state, actor, time()).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify({ actor, action }));
    commit({ kind: 'action', command: { seat: actor, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const until = (condition: () => boolean, label = 'Bounded actual fixture outcome', limit = 160): void => { for (let count = 0; count < limit && !condition(); count++) beat(); assert.ok(condition(), label); };
  const research = (technology: string, actor = seat): void => {
    if (state.civilizations[actor]?.technologies.includes(technology)) return;
    const definition = TECHNOLOGIES.find(candidate => candidate.id === technology); assert.ok(definition);
    for (const prerequisite of definition.requires) research(prerequisite, actor);
    act({ type: 'research', technology }, actor); until(() => !!state.civilizations[actor]?.technologies.includes(technology), `Actual productive research ${technology}`);
  };
  return { initial, steps, seat, provenance, get state() { return state; }, time, commit, act, beat, until, research };
}

export function coastalDeparturePrefix(rulesId = 'settlement-coastal-1'): CoastalPrefix {
  const journey = freshFixtureJourney(rulesId, () => {}, 'Fresh selected rules; actual paid land founding, research and growth');
  journey.act({ type: 'focus', cityId: 'city-0', focus: 'growth' });
  journey.act({ type: 'settle', sourceCityId: 'city-0', tileId: 23 });
  const departure = journey.state.cities.find(city => city.tileId === 23 && city.civId === 0); assert.ok(departure);
  for (const technology of ['agriculture', 'water-management']) journey.research(technology);
  journey.until(() => (journey.state.cities.find(city => city.id === departure.id)?.population ?? 0) >= 6);
  return structuredClone({ initial: journey.initial, state: journey.state, steps: journey.steps, departureCityId: departure.id, timestamp: journey.time(), provenance: journey.provenance });
}
