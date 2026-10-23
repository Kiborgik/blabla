import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { applyCommand, createWorld, legalActions, observe } from '../core/engine.ts';
import { observeCompactTrade } from '../core/observation.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const times = [epoch, '2026-10-16T00:00:10.000Z', '2026-10-16T00:01:00.000Z'];

function released(target: string): WorldState {
  return createWorld(1701, epoch, target);
}

function syntheticTowns(state: WorldState): WorldState {
  const capitals = structuredClone(state.cities);
  const occupied = new Set(state.cities.map(city => city.tileId));
  const sites = state.tiles.filter(tile => !occupied.has(tile.id) && tile.owner === null && tile.terrain !== 'mountain' && tile.terrain !== 'ocean');
  for (let index = 5; index < 25; index++) {
    const template = capitals[index % 5];
    const site = sites[index - 5];
    assert.ok(template && site);
    site.owner = template.civId;
    state.cities.push({ ...structuredClone(template), id: `generation-town-${index}`, name: `Generation town ${index}`, tileId: site.id, population: 3 });
  }
  assert.ok(isWorldState(state));
  return state;
}

function command(state: WorldState, seat: number, action: GameAction): WorldState {
  const result = applyCommand(state, { seat, action, expectedRevision: state.revision, timestamp: epoch });
  assert.ok(result.ok, result.error);
  return result.state;
}

function proposal(state: WorldState): Extract<GameAction, { type: 'propose-trade' }> {
  const action = legalActions(state, 0, epoch).find(option => option.action.type === 'propose-trade')?.action;
  assert.ok(action?.type === 'propose-trade');
  return action;
}

function fixtures(): Record<string, WorldState> {
  const legacy = released('settlement-trade-1');
  const endpoints = released('settlement-endpoints-1');
  const land = released('settlement-land-transport-1');
  const operating = released('settlement-operating-exchange-1');
  const oldPending = command(endpoints, 0, proposal(endpoints));
  const pending = command(land, 0, proposal(land));
  const offer = pending.tradeOffers?.find(candidate => candidate.status === 'pending');
  assert.ok(offer);
  const accepted = command(pending, offer.recipient, { type: 'respond-trade', offerId: offer.id, accept: true });
  const intent = applyCommand(operating, {
    seat: 0, action: { type: 'wait' }, expectedRevision: operating.revision, timestamp: epoch,
    plan: [{ action: { type: 'wait' }, reason: 'Review the next window' }, { action: proposal(operating), reason: 'Consider the exact quoted towns' }],
  });
  assert.ok(intent.ok, intent.error);
  const invalidated = structuredClone(intent.state);
  const followUp = invalidated.actionPlans?.[0]?.items[1]?.action;
  assert.ok(followUp?.type === 'propose-trade');
  invalidated.cities = invalidated.cities.filter(city => city.id !== followUp.sourceCityId);
  return {
    initial: createWorld(1701, epoch), legacy, endpoints, land, operating,
    syntheticEndpoints25: syntheticTowns(structuredClone(endpoints)),
    syntheticOperating25: syntheticTowns(structuredClone(operating)),
    oldPending, pending, accepted, intent: intent.state,
    syntheticMissingIntentTown: invalidated,
  };
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function views(state: WorldState): unknown[] {
  return times.flatMap(timestamp => Array.from({ length: 6 }, (_, seat) => ({ full: observe(state, seat, timestamp), compact: observeCompactTrade(state, seat, timestamp) })));
}

await test('fresh-rule full and compact views restart byte-exactly for every seat and admission boundary', () => {
  for (const [name, state] of Object.entries(fixtures())) {
    const before = JSON.stringify(state);
    assert.equal(digest(views(state)), digest(views(JSON.parse(before))), name);
    assert.equal(JSON.stringify(state), before, name);
  }
});

await test('single canonical enumeration retains every ordered action, label and quote in both presentation paths', () => {
  for (const [name, state] of Object.entries(fixtures())) for (const timestamp of times) for (let seat = 0; seat < 6; seat++) {
    const full = observe(state, seat, timestamp);
    const compact = observeCompactTrade(state, seat, timestamp);
    assert.deepEqual(full.legalActions, legalActions(state, seat, timestamp), name);
    assert.deepEqual(compact.legalActions.map(({ action, label, tradeQuote }) => ({ action, label, tradeQuote })), full.legalActions.map(({ action, label, tradeQuote }) => ({ action, label, tradeQuote })), name);
    assert.deepEqual(compact.actionPlan, full.actionPlan, name);
    assert.deepEqual(compact.tradeOffers, full.tradeOffers, name);
    assert.deepEqual(compact.routes, full.routes, name);
  }
});

await test('optimized compact results remain detached across calls, exact quotes and source records', () => {
  const state = syntheticTowns(released('settlement-operating-exchange-1'));
  const before = JSON.stringify(state);
  const compact = observeCompactTrade(state, 0, epoch);
  const stable = JSON.stringify(compact);
  const quotes = compact.legalActions.flatMap(option => option.tradeQuote ? [option.tradeQuote] : []);
  assert.equal(quotes.length, 200);
  const first = quotes[0];
  const other = quotes[1];
  assert.ok(first && other);
  const otherBefore = JSON.stringify(other);
  first.transport.tileIds[0] = -1;
  first.cadenceRounds = 999;
  assert.equal(JSON.stringify(other), otherBefore);
  const fact = compact.tradeFacts.cities[0];
  assert.ok(fact);
  fact.baseOutputsBeforeFocusAndProductivity.food = 999;
  assert.equal(JSON.stringify(state), before);
  assert.equal(JSON.stringify(observeCompactTrade(state, 0, epoch)), stable);
});
