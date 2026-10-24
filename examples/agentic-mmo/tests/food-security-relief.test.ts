import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import { FOOD_BUDGET_RULES } from '../core/food-security-content.ts';
import { RELIEF_RULES } from '../core/relief-content.ts';
import { isReliefResult, isReliefState, validReliefEvent } from '../core/relief-validation.ts';
import { applyDirectorEvent } from '../core/simulation/commands.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { civilizationFoodUpkeep, forecastCivilizationFoodProduction } from '../core/simulation/food-security.ts';
import { executeReliefAction, quoteReliefProposal, reliefActionFailure, resolveReliefCharters } from '../core/simulation/relief-charters.ts';
import { executeTradeAction } from '../core/simulation/trade.ts';
import { isWorldState } from '../core/validation.ts';
import type { ReliefAction, ReliefCharter, ReliefState } from '../core/relief-types.ts';
import type { GameEvent, WorldState } from '../core/types.ts';

const epoch = '2026-10-22T00:00:00.000Z';
function released(budget: boolean): WorldState {
  return createWorld(1701, epoch, budget ? 'settlement-food-budget-1' : 'settlement-regional-targets-1');
}
function corridor(budget = true): WorldState {
  const state = released(budget); const donor = state.civilizations[1]!; const recipient = state.civilizations[4]!;
  donor.resources = { ...donor.resources, food: 300, energy: 100, materials: 100, credits: 100 };
  state.revision++; let events: GameEvent[] = [];
  executeTradeAction(state, 1, { type: 'propose-trade', partner: 4, recipeId: 'energy-for-materials', sourceCityId: 'city-1', recipientCityId: 'city-4' }, events); commitEvents(state, events);
  const before = { ...donor.resources }; state.revision++; events = [];
  executeTradeAction(state, 4, { type: 'respond-trade', offerId: state.tradeOffers!.at(-1)!.id, accept: true }, events); commitEvents(state, events);
  assert.equal(donor.resources.materials, before.materials - 6); assert.equal(donor.resources.credits, before.credits - 8);
  assert.equal(state.routes[0]!.agreement!.terms.transport!.edges, 4);
  state.cities.find(city => city.civId === 1)!.population = budget ? 48 : 10;
  state.cities.find(city => city.civId === 4)!.population = budget ? 48 : 30;
  recipient.resources.food = budget ? 55 : 0;
  assert.ok(isWorldState(state)); return state;
}
const proposal = (state: WorldState): Extract<ReliefAction, { type: 'propose-relief' }> => ({ type: 'propose-relief', routeId: state.routes[0]!.id, sourceCityId: 'city-1', recipientCityId: 'city-4' });
function act(state: WorldState, seat: number, action: ReliefAction): GameEvent[] {
  state.revision++; const events: GameEvent[] = [];
  assert.equal(reliefActionFailure(state, seat, action), null); assert.ok(executeReliefAction(state, seat, action, events)); commitEvents(state, events); return events;
}
function accept(state: WorldState): ReliefCharter {
  act(state, 1, proposal(state)); const pending = state.relief!.active[0]!;
  act(state, 4, { type: 'respond-relief', charterId: pending.id, accept: true }); return state.relief!.active[0]!;
}
function beat(state: WorldState): void { state.round++; state.revision++; const events: GameEvent[] = []; resolveEconomy(state, events); commitEvents(state, events); }
function resolve(state: WorldState, round: number): GameEvent[] { state.round = round; state.revision++; const events: GameEvent[] = []; resolveReliefCharters(state, events); commitEvents(state, events); return events; }
function damagedRecipient(state: WorldState): void {
  const capital = state.cities.find(city => city.civId === 4)!;
  capital.population = 24; capital.wellbeing = 100; capital.focus = 'industry'; capital.buildings = ['farm', 'granary', 'water-mill', 'irrigation']; capital.buildingOperations = { irrigation: { enabled: true, lastResult: null } };
  for (let index = 0; index < 2; index++) {
    const tile = state.tiles.find(tile => tile.owner === 4 && tile.id !== capital.tileId && !state.cities.some(city => city.tileId === tile.id))!;
    tile.terrain = 'forest'; tile.resource = 'food';
    state.cities.push({ ...structuredClone(capital), id: `synthetic-recipient-${index}`, tileId: tile.id, population: 12, buildings: ['farm', 'granary'], buildingOperations: {}, housing: { ruleVersion: 1, baseCapacity: 8, establishedRound: 0, origin: 'founded' } });
  }
  state.civilizations[4]!.resources.materials = 100;
  applyDirectorEvent(state, 'earthquake', 4, []);
}

void test('new proposal facts retain the exact Food rule and fixed two/four meal-beat thresholds', () => {
  const state = corridor(); const quote = quoteReliefProposal(state, 1, proposal(state)); assert.ok(quote.ok);
  assert.equal(quote.terms.food, 36); assert.equal(quote.terms.energy, 1); assert.equal(quote.terms.travelRounds, 2);
  assert.ok('kind' in quote.terms.proposal); assert.equal(quote.terms.proposal.kind, 'versioned-food'); assert.equal(quote.terms.proposal.foodRule, FOOD_BUDGET_RULES.ruleId);
  assert.equal(quote.terms.proposal.recipientPopulation, 48); assert.equal(civilizationFoodUpkeep(state, 4), 60);
  state.civilizations[4]!.resources.food = 114;
  const minimum = quoteReliefProposal(state, 1, proposal(state)); assert.ok(minimum.ok); assert.equal(minimum.terms.food, 6);
  state.civilizations[4]!.resources.food = 114.01; assert.equal(quoteReliefProposal(state, 1, proposal(state)).ok, false);
  state.civilizations[4]!.resources.food = 55; state.civilizations[1]!.resources.food = 240 + quote.terms.proposal.promisedFood + 5.99;
  assert.equal(quoteReliefProposal(state, 1, proposal(state)).ok, false);
  assert.equal(RELIEF_RULES.minimumFood, 6); assert.equal(RELIEF_RULES.maximumFood, 36);
});

void test('conditional ordinary-quake36 bridge conserves actual Food and buys a supplied beat rather than a nominal delivery', () => {
  const state = corridor(); damagedRecipient(state);
  assert.equal(forecastCivilizationFoodProduction(state, 4), 39.99); assert.equal(civilizationFoodUpkeep(state, 4), 60);
  const charter = accept(state); assert.equal(charter.terms.food, 36); assert.equal(charter.status, 'accepted');
  const without = structuredClone(state); act(without, 4, { type: 'withdraw-relief', charterId: charter.id });
  beat(state); beat(without); assert.equal(state.civilizations[4]!.resources.food, 34.99);
  const restored = JSON.parse(JSON.stringify(state)) as WorldState;
  beat(state); beat(restored); beat(without); assert.deepEqual(state, restored);
  assert.equal(without.civilizations[4]!.resources.food, 14.98); assert.equal(Math.round(state.civilizations[4]!.resources.food * 100) / 100, 50.98);
  const result = state.relief!.lastResults[1]!; assert.equal(result.outcome, 'delivered'); assert.equal(result.before.recipientFood, 14.98); assert.equal(result.after.recipientFood, result.before.recipientFood + 36);
  assert.equal(result.after.donorFood, result.before.donorFood - 36); assert.equal(result.after.donorEnergy, result.before.donorEnergy - 1); assert.deepEqual(result.paid, { food: 36, energy: 1 }); assert.ok(isReliefResult(result));
  beat(state); beat(without);
  assert.equal(state.civilizations[4]!.resources.food, 30.97);
  assert.ok(state.cities.filter(city => city.civId === 4).every(city => city.lastFoodSupply?.supplied));
  assert.ok(without.cities.filter(city => city.civId === 4).some(city => city.lastFoodSupply?.supplied === false));
  assert.equal(Math.round(without.cities.filter(city => city.civId === 4).reduce((sum, city) => sum + city.lastFoodSupply!.paid, 0) * 100) / 100, 54.97);
  const exact = structuredClone(state.relief); resolveReliefCharters(state, []); assert.deepEqual(state.relief, exact);
});

void test('new consent cannot resize cargo and blocked route, insufficient complete funding, and withdrawal transfer nothing', () => {
  for (const reason of ['route', 'food', 'energy', 'withdrawal'] as const) {
    const state = corridor(); const charter = accept(state); assert.equal(charter.status, 'accepted'); if (charter.status !== 'accepted') continue;
    state.civilizations[4]!.resources.food = 200;
    if (reason === 'route') state.routes[0]!.damage = 50;
    if (reason === 'food') state.civilizations[1]!.resources.food = 35.99;
    if (reason === 'energy') state.civilizations[1]!.resources.energy = 0;
    const before = structuredClone(state.civilizations);
    if (reason === 'withdrawal') act(state, 4, { type: 'withdraw-relief', charterId: charter.id }); else resolve(state, charter.dueRound);
    assert.deepEqual(state.civilizations, before); assert.equal(state.relief!.lastResults[1]!.deliveredFood, 0); assert.equal(state.relief!.lastResults[1]!.charter.terms.food, 36);
  }
  const state = corridor(); const charter = accept(state); assert.equal(charter.status, 'accepted'); if (charter.status !== 'accepted') return;
  state.civilizations[4]!.resources.food = 200; resolve(state, charter.dueRound); assert.equal(state.civilizations[4]!.resources.food, 236);
});

void test('old and new relief proof variants reject excess, missing, unknown, and reinterpreted rule fields after event pruning', () => {
  for (const budget of [false, true]) {
    const state = corridor(budget); const charter = accept(state); assert.equal(charter.status, 'accepted'); if (charter.status !== 'accepted') continue;
    const events = resolve(state, charter.dueRound); const event = events.find(event => event.reliefResult)!;
    assert.ok(validReliefEvent(event)); assert.ok(isReliefResult(event.reliefResult)); state.events = [];
    const mutations: Array<(layer: ReliefState) => void> = [
      layer => { Object.assign(layer.lastResults[1]!.charter.terms.proposal, { ignored: true }); },
      layer => { Object.assign(layer.lastResults[1]!.charter.terms.proposal, { foodRule: 'food-budget-99', kind: 'versioned-food' }); },
      layer => { Object.assign(layer.lastResults[1]!.charter.terms.proposal, { foodRule: 'legacy-food-1', kind: 'versioned-food' }); },
      layer => { const facts = layer.lastResults[1]!.charter.terms.proposal as unknown as Record<string, unknown>; if (budget) delete facts.foodRule; else facts.foodRule = 'food-budget-1'; },
      layer => { const facts = layer.lastResults[1]!.charter.terms.proposal as unknown as Record<string, unknown>; if (budget) { delete facts.kind; delete facts.foodRule; } else { facts.kind = 'versioned-food'; facts.foodRule = 'food-budget-1'; } },
      layer => { layer.lastResults[1]!.after.recipientFood++; },
    ];
    for (const mutate of mutations) { const changed = structuredClone(state); mutate(changed.relief!); assert.equal(isReliefResult(changed.relief!.lastResults[1]), false); assert.equal(isReliefState(changed.relief, changed), false); }
  }
});
