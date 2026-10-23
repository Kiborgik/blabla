import assert from 'node:assert/strict';
import { createWorld } from '../../core/engine.ts';
import type { KnowledgeAction, KnowledgeCompact } from '../../core/knowledge-types.ts';
import { isKnowledgeState } from '../../core/knowledge-validation.ts';
import { resolveEconomy } from '../../core/simulation/economy.ts';
import { commitEvents } from '../../core/simulation/events.ts';
import { executeKnowledgeAction, knowledgeActionFailure } from '../../core/simulation/knowledge-compacts.ts';
import { availableTradeActions, executeTradeAction } from '../../core/simulation/trade.ts';
import type { GameAction, GameEvent, WorldState } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';

export const TEACHER = 1;
export const LEARNER = 4;
export const KNOWLEDGE_TEST_RULES = 'settlement-knowledge-compacts-1';

type TradeAction = Extract<GameAction, { type: 'propose-trade' | 'respond-trade' | 'withdraw-trade' | 'stop-trade' }>;

export function tradeAction(state: WorldState, actor: number, action: TradeAction): GameEvent[] {
  assert.ok(availableTradeActions(state, actor).some(option => JSON.stringify(option.action) === JSON.stringify(action)), 'The synthetic setup must still use an actually available trade action');
  state.revision++;
  const events: GameEvent[] = [];
  executeTradeAction(state, actor, action, events);
  commitEvents(state, events);
  return events;
}

export function knowledgeAction(state: WorldState, actor: number, action: KnowledgeAction): GameEvent[] {
  assert.equal(knowledgeActionFailure(state, actor, action), null);
  state.revision++;
  const events: GameEvent[] = [];
  assert.ok(executeKnowledgeAction(state, actor, action, events));
  commitEvents(state, events);
  return events;
}

export function knowledgeEconomy(state: WorldState, round = state.routes[0]!.agreement!.nextDeliveryRound): GameEvent[] {
  assert.ok(round > state.round);
  state.round = round;
  state.revision++;
  const events: GameEvent[] = [];
  resolveEconomy(state, events);
  commitEvents(state, events);
  return events;
}

export function assertCurrentKnowledgeWorld(state: WorldState): void {
  assert.equal(state.releaseId, KNOWLEDGE_TEST_RULES);
  assert.ok(isKnowledgeState(state.knowledge, state), 'Current Knowledge ledger and retained receipts must validate');
  assert.ok(isWorldState(state), 'The whole synthetic current-version world must validate');
}

export function syntheticKnowledgeCorridor(): WorldState {
  const state = createWorld(1701, '2026-10-23T00:00:00.000Z', KNOWLEDGE_TEST_RULES);
  const prerequisites = ['agriculture', 'civic-institutions', 'animal-husbandry', 'kiln-firing', 'wheel', 'mining', 'masonry'];
  for (const id of [TEACHER, LEARNER]) {
    const civ = state.civilizations[id]!;
    civ.name = id === TEACHER ? 'Synthetic teachers' : 'Synthetic learners';
    civ.era = 1;
    civ.technologies = [...prerequisites, ...(id === TEACHER ? ['engineering'] : [])];
    civ.resources = { food: 300, materials: 300, energy: 300, credits: 300, science: 0, culture: 300 };
    const city = state.cities.find(item => item.civId === id)!;
    city.name = id === TEACHER ? 'Synthetic teaching town' : 'Synthetic learning town';
    city.population = 6;
    city.wellbeing = 40;
    city.infrastructure = 0;
    city.focus = 'research';
    city.buildings = ['academy'];
    city.buildingOperations = { academy: { enabled: true, lastResult: null } };
  }
  state.civilizations[LEARNER]!.researchTarget = 'engineering';
  assertCurrentKnowledgeWorld(state);
  const before = structuredClone(state.civilizations.map(civ => civ.resources));
  tradeAction(state, TEACHER, { type: 'propose-trade', partner: LEARNER, recipeId: 'harvest-for-materials', sourceCityId: 'city-1', recipientCityId: 'city-4' });
  assert.deepEqual(state.civilizations.map(civ => civ.resources), before);
  tradeAction(state, LEARNER, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true });
  assert.equal(state.civilizations[TEACHER]!.resources.materials, 294);
  assert.equal(state.civilizations[TEACHER]!.resources.credits, 292);
  assert.deepEqual(state.civilizations[LEARNER]!.resources, before[LEARNER]);
  assert.equal(state.routes[0]!.agreement!.deliveryCount, 0);
  knowledgeEconomy(state);
  assert.equal(state.routes[0]!.agreement!.deliveryCount, 1);
  assertCurrentKnowledgeWorld(state);
  return state;
}

export function knowledgeProposal(state: WorldState): Extract<KnowledgeAction, { type: 'propose-knowledge' }> {
  return { type: 'propose-knowledge', routeId: state.routes[0]!.id, teacherCityId: 'city-1', learnerCityId: 'city-4', technologyId: 'engineering', teacherInstitutionId: 'academy', learnerInstitutionId: 'academy' };
}

export function proposeKnowledge(state: WorldState): KnowledgeCompact {
  knowledgeAction(state, TEACHER, knowledgeProposal(state));
  return state.knowledge!.active[0]!;
}

export function acceptKnowledge(state: WorldState): Extract<KnowledgeCompact, { status: 'accepted' }> {
  const proposed = proposeKnowledge(state);
  knowledgeAction(state, LEARNER, { type: 'respond-knowledge', compactId: proposed.id, accept: true });
  const accepted = state.knowledge!.active[0]!;
  assert.equal(accepted.status, 'accepted');
  if (accepted.status !== 'accepted') throw new Error('Expected explicit learner consent');
  return accepted;
}
