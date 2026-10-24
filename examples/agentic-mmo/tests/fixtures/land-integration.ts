import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { applyCommand, catchUpStrategy, createWorld, legalActions } from '../../core/engine.ts';
import { isCoastalSite } from '../../core/simulation/coastal.ts';
import { createLandTransportPlanner } from '../../core/simulation/transport.ts';
import { turnAdmission } from '../../core/simulation/turns.ts';
import type { Command, GameAction, TransitionResult, WorldState } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import { syntheticTechnologies } from './coastal-prefix.ts';

export const LAND_INTEGRATION_RULES = 'settlement-earned-land-integration-1';
export const LAND_INTEGRATION_EPOCH = '2026-10-24T00:00:00.000Z';
export interface LandIntegrationOptions {
  recipient?: boolean;
  coastalAdjacent?: boolean;
  seed?: number;
  recipeId?: 'harvest-for-materials' | 'energy-for-materials';
  rise?: boolean;
  unrelated?: boolean;
}
export type LandIntegrationInput = { kind: 'action'; command: Command } | { kind: 'strategy'; timestamp: string };
export interface LandIntegrationStep { before: WorldState; input: LandIntegrationInput; result: TransitionResult }

export function landTime(state: WorldState, seat = 0): string {
  return turnAdmission(state, seat).nextActionAt!;
}

export function landBeat(state: WorldState): TransitionResult {
  const timestamp = new Date(Date.parse(state.clockEpoch!) + ((state.independentTurns?.strategyTicks ?? 0) + 1) * 60_000).toISOString();
  const result = catchUpStrategy(state, timestamp);
  assert.ok(result.ok, result.error);
  assert.equal(result.remainingTicks, 0);
  return result;
}

export function landAct(state: WorldState, seat: number, action: GameAction): TransitionResult {
  const timestamp = landTime(state, seat);
  assert.ok(legalActions(state, seat, timestamp).some(option => isDeepStrictEqual(option.action, action)), JSON.stringify({ seat, action, timestamp }));
  const result = applyCommand(state, { seat, action, timestamp, expectedRevision: state.revision });
  assert.ok(result.ok, result.error);
  return result;
}

export function replayLandStep(state: WorldState, input: LandIntegrationInput): TransitionResult {
  return input.kind === 'action' ? applyCommand(state, input.command) : catchUpStrategy(state, input.timestamp);
}

export function landIntegrationFixture(options: LandIntegrationOptions = {}) {
  let state = createWorld(options.seed ?? 1701, LAND_INTEGRATION_EPOCH, LAND_INTEGRATION_RULES);
  state.calendarMilestones = ['first-harvest', 'roads-between-peoples', ...(options.rise === false ? [] : ['rise-of-states'])];
  for (const civ of state.civilizations) {
    civ.era = options.rise === false ? 0 : 1;
    civ.resources = { food: 2000, materials: 2000, energy: 2000, credits: 2000, science: 0, culture: 0 };
    syntheticTechnologies(state, civ.id, ['agriculture', 'civic-institutions']);
  }
  for (const city of state.cities) { city.population = 12; city.focus = 'industry'; }
  const provenance = 'Finite contract probe, not autonomous play: fresh selected release and generated geography; synthetic opening stocks, residents, Agriculture/Civic institutions and prior first-harvest/roads/Rise milestones. Ordinary founding, proposal, recipient acceptance and due paid exchange are actual engine transitions; no calendar advance is included.';
  assert.ok(isWorldState(state), 'Fresh synthetic prerequisites must validate');
  const initial = structuredClone(state);
  const steps: LandIntegrationStep[] = [];
  const commit = (input: LandIntegrationInput): void => {
    const before = structuredClone(state);
    const result = replayLandStep(state, input);
    assert.ok(result.ok, result.error);
    assert.deepEqual(state, before);
    assert.ok(isWorldState(result.state), `Actual finite lifecycle frame ${result.state.revision} must validate`);
    steps.push({ before, input, result }); state = result.state;
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: new Date(Date.parse(state.clockEpoch!) + (state.independentTurns!.strategyTicks + 1) * 60_000).toISOString() });
  const act = (seat: number, action: GameAction): void => {
    while (Date.parse(landTime(state, seat)) >= Date.parse(state.clockEpoch!) + (state.independentTurns!.strategyTicks + 1) * 60_000) beat();
    commit({ kind: 'action', command: { seat, action, timestamp: landTime(state, seat), expectedRevision: state.revision } });
  };
  const planner = createLandTransportPlanner(state);
  const candidates = state.civilizations.flatMap(civ => legalActions(state, civ.id, landTime(state, civ.id)).flatMap(option => {
    const action = option.action;
    if (action.type !== 'settle' || !action.sourceCityId || isCoastalSite(state, action.tileId) !== !!options.coastalAdjacent) return [];
    const source = state.cities.find(city => city.id === action.sourceCityId)!;
    if (!options.coastalAdjacent && isCoastalSite(state, source.tileId)) return [];
    return state.cities.flatMap(foreign => {
      if (foreign.civId === civ.id || !options.coastalAdjacent && isCoastalSite(state, foreign.tileId)) return [];
      const quote = planner.quote(foreign.tileId, action.tileId);
      return quote ? [{ action, founder: civ.id, source, foreign, edges: quote.edges }] : [];
    });
  })).sort((a, b) => b.edges - a.edges || a.founder - b.founder || a.action.tileId - b.action.tileId || a.foreign.civId - b.foreign.civId);
  const selected = candidates[0]; assert.ok(selected, 'The fixed generated seed must expose the requested legal land founding and foreign corridor');
  const sourceCityId = selected.source.id;
  act(selected.founder, selected.action);
  const founded = structuredClone(state);
  const town = state.cities.find(city => city.tileId === selected.action.tileId)!;
  const foundedCityId = town.id; const foreignCityId = selected.foreign.id;
  const endpoint = options.unrelated ? sourceCityId : foundedCityId;
  const proposer = options.recipient ? selected.foreign.civId : selected.founder;
  const recipient = options.recipient ? selected.founder : selected.foreign.civId;
  act(proposer, { type: 'propose-trade', partner: recipient, recipeId: options.recipeId ?? 'harvest-for-materials', sourceCityId: options.recipient ? foreignCityId : endpoint, recipientCityId: options.recipient ? endpoint : foreignCityId });
  const proposed = structuredClone(state); const offerId = state.tradeOffers!.at(-1)!.id;
  act(recipient, { type: 'respond-trade', offerId, accept: true });
  const accepted = structuredClone(state); const routeId = state.tradeOffers!.at(-1)!.routeId!;
  const due = state.routes.find(route => route.id === routeId)!.agreement!.nextDeliveryRound;
  assert.ok(due > state.round && due - state.round <= 40, 'The selected finite corridor has a bounded authored first due beat');
  while (state.round + 1 < due) beat();
  const beforeDue = structuredClone(state);
  beat();
  assert.equal(state.routes.find(route => route.id === routeId)!.agreement!.deliveryCount, 1);
  return { initial, founded, proposed, accepted, beforeDue, state, steps, sourceCityId, foundedCityId, foreignCityId, offerId, routeId, provenance };
}
