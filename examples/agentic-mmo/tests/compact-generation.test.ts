import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { applyCommand, applyRelease, createWorld, legalActions, observe } from '../core/engine.ts';
import { observeCompactTrade } from '../core/observation.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';

const epoch = '2026-10-16T00:00:00.000Z';
const times = [epoch, '2026-10-16T00:00:10.000Z', '2026-10-16T00:01:00.000Z'];
const releases = ['settlement-foundations-2', 'settlement-independent-1', 'settlement-production-1', 'settlement-frontiers-1', 'settlement-specialization-1', 'settlement-recovery-1', 'settlement-civics-1', 'settlement-charters-1', 'settlement-endpoints-1', 'settlement-land-transport-1', 'settlement-operating-exchange-1'];

function release(state: WorldState, targetReleaseId: string): WorldState {
  const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: epoch });
  assert.ok(result.ok, result.error);
  return result.state;
}

function released(target: string): WorldState {
  let state = createWorld(1701, epoch);
  for (const id of releases) {
    state = release(state, id);
    if (id === target) return state;
  }
  throw new Error(`Unknown fixture release ${target}`);
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
  const firstRelease = releases[0];
  assert.ok(firstRelease);
  const legacy = release(release(createWorld(1701, epoch), firstRelease), 'settlement-trade-1');
  const endpoints = released('settlement-endpoints-1');
  const land = released('settlement-land-transport-1');
  const operating = released('settlement-operating-exchange-1');
  const oldPending = command(endpoints, 0, proposal(endpoints));
  const inheritedPending = release(oldPending, 'settlement-land-transport-1');
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
    oldPending, inheritedPending, pending, accepted, intent: intent.state,
    syntheticMissingIntentTown: invalidated,
  };
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function views(state: WorldState): unknown[] {
  return times.flatMap(timestamp => Array.from({ length: 6 }, (_, seat) => ({ full: observe(state, seat, timestamp), compact: observeCompactTrade(state, seat, timestamp) })));
}

const baseline: Record<string, string> = {
  "initial": "f685037044f001beae88447efdd404a6c7cf74e1a0838aea58005b29eb261a4a",
  "legacy": "768eb563ae2dfc2392778f2cca835e62207d8205929988efa3ebf419a4e6c2c0",
  "endpoints": "f63858afb88c1a2f102e5eec9c49ed2d0fdb4bc9ead16f54dff0f15fb17b2c9c",
  "land": "13f723d93b97135971f7143083ec6b66d6eb9135b2becdb66287c346641c8fde",
  "operating": "372dcc009afcf65a7d221d808ed05b853bf2aad72284a8479ace61d3a3087ce1",
  "syntheticEndpoints25": "52be226e6da77318823464356f23d4e971e2f02cbd69130b4fa03925c6894001",
  "syntheticOperating25": "eefe96e82fbb79b72b8a89b97f621d6cda5a3f175d52e793537c9031dbd8a02e",
  "oldPending": "58dec62ad572004e2c05f6a8d577827af1198725e029fc3426a067a03c092415",
  "inheritedPending": "015678c4640c973fea96eb94234a47e22b2ba0f926e08da4303dda4b4d0124c8",
  "pending": "afd08b3fed71e39f49b097fe03f71a2c827f0ed7582d3f0bc3b342cf55baaa30",
  "accepted": "6a260a12deb109dab5e262b841f8788db93daad662c9b9fa002432183fd0ee96",
  "intent": "134e13d064bb64d70f3fba4337677f28fd6330bbeb9f16030b6f2343d7d05768",
  "syntheticMissingIntentTown": "7c18a48790bc57adaaf8d1c31bcefc7befdf792598b454729784a750711563ac"
};

await test('pre-optimization serialized full and compact views remain byte-exact for every seat, admission boundary and fixture', () => {
  for (const [name, state] of Object.entries(fixtures())) {
    const before = JSON.stringify(state);
    assert.equal(digest(views(state)), baseline[name], name);
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
