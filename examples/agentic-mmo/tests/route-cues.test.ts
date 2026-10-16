import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameEvent, PublicProjectResult } from '../core/types.ts';
import type { RouteView } from '../visuals/route-visuals.ts';
import { projectRouteCues } from '../visuals/route-cues.ts';
import type { RouteCueObservation } from '../visuals/route-cues.ts';

function route(): RouteView {
  return { id: 'route-frontier', from: 'frontier', to: 'harbor', owner: 0, partner: 1, active: true, damage: 0, volume: 7,
    ownerName: 'Aster', partnerName: 'Pelagos',
    fromTown: { id: 'frontier', name: 'Far Hearth', civilization: 'Aster', color: '#d9b96f', q: 2, r: 3 },
    toTown: { id: 'harbor', name: 'Tidehaven', civilization: 'Pelagos', color: '#65c8d0', q: 8, r: 1 },
    agreement: { offerId: 'offer-exact', enabled: true, acceptedRound: 2, nextDeliveryRound: 12, lastAttemptRound: 8,
      lastDeliveryRound: 8, deliveryCount: 2, blockedBy: null, blockedReason: null, closedRound: null,
      terms: { recipeId: 'fixture-exchange', recipeVersion: 1, constructionCost: { materials: 12 },
        proposerCargo: { food: 4 }, recipientCargo: { materials: 3 }, proposerUpkeep: { energy: 1 }, recipientUpkeep: { energy: 2 },
        proposerYield: { credits: 2 }, recipientYield: { credits: 3 }, cadenceRounds: 4, damageDisableAt: 50 } } };
}
function delivery(id = '11:0'): GameEvent {
  return { id, round: 8, type: 'trade-delivered', title: 'An exchange', detail: 'route-frontier', actor: 0, target: 1, tileId: 999,
    cause: 'Accepted offer offer-exact reached strategic round 8 with both combined obligations supplied',
    effects: ['7 cargo exchanged atomically', 'Agreed upkeep consumed and commerce credited', 'Next shipment: round 12'], importance: 3 };
}
function repair(outcome: PublicProjectResult['outcome'] = 'completed', id = '11:1'): GameEvent {
  const completed = outcome === 'completed';
  return { id, round: 8, type: `public-project-${outcome}`, title: 'Joint repair result', detail: 'project-exact', actor: 1, target: 0, tileId: 999,
    cause: 'Recorded resolution', effects: [], importance: 3,
    publicProjectResult: { projectId: 'project-exact', routeId: 'route-frontier', agreementOfferId: 'offer-exact', outcome,
      reason: completed ? 'Both contributions paid' : 'Recorded reason', proposer: 1, recipient: 0,
      proposerPaid: completed ? { materials: 5, credits: 2 } : {}, recipientPaid: completed ? { materials: 7 } : {},
      damageBefore: 12, damageAfter: completed ? 0 : 12 } };
}
function observation(events: GameEvent[] = [delivery()], routes: RouteView[] = [route()]): RouteCueObservation {
  return { identity: 'world-run-a', revision: 11, mode: 'live', events, routes };
}
const previous = { identity: 'world-run-a', revision: 10 };

void test('initial observation and changed world identity baseline without replay', () => {
  const initial = projectRouteCues(null, observation());
  assert.deepEqual(initial, { cursor: { identity: 'world-run-a', revision: 11 }, cues: [] });
  assert.deepEqual(projectRouteCues(previous, { ...observation(), identity: 'world-run-b' }).cues, []);
});

void test('new committed delivery binds exact frontier endpoints and separates cargo upkeep and commerce', () => {
  const cue = projectRouteCues(previous, observation()).cues[0];
  assert.ok(cue?.kind === 'delivery');
  assert.equal(cue.routeId, 'route-frontier');
  assert.equal(cue.agreementOfferId, 'offer-exact');
  assert.deepEqual(cue.endpoints, { fromCityId: 'frontier', toCityId: 'harbor', owner: 0, partner: 1 });
  assert.equal(cue.mapAnchor?.from.name, 'Far Hearth');
  assert.equal(cue.mapAnchor?.to.name, 'Tidehaven');
  assert.equal(cue.aggregateCargo, 7);
  assert.equal(cue.factSource, 'bound-agreement');
  assert.deepEqual(cue.exchange?.proposer, { civilization: 0, cargo: { food: 4 }, paidUpkeep: { energy: 1 }, creditedCommerce: { credits: 2 } });
  assert.deepEqual(cue.exchange?.recipient, { civilization: 1, cargo: { materials: 3 }, paidUpkeep: { energy: 2 }, creditedCommerce: { credits: 3 } });
  assert.equal(cue.accent, 'delivery');
});

void test('missing or unsafe delivery binding keeps only the recorded aggregate without guessed towns', () => {
  const mutations: Array<(value: RouteView) => void> = [
    (value) => { delete value.agreement; },
    (value) => { if (value.agreement) value.agreement.offerId = 'replacement'; },
    (value) => { value.owner = 4; },
    (value) => { value.illustrative = true; },
    (value) => { if (value.agreement) value.agreement.acceptedRound = 9; },
    (value) => { if (value.agreement) value.agreement.lastDeliveryRound = null; },
    (value) => { if (value.agreement) value.agreement.deliveryCount = 0; },
    (value) => { if (value.agreement) value.agreement.terms.proposerCargo.food = 99; },
  ];
  const cases = [[], ...mutations.map((mutate) => { const value = route(); mutate(value); return [value]; })];
  for (const routes of cases) {
    const cue = projectRouteCues(previous, observation([delivery()], routes)).cues[0];
    assert.ok(cue?.kind === 'delivery');
    assert.equal(cue.aggregateCargo, 7);
    assert.equal(cue.factSource, 'event-aggregate');
    assert.equal(cue.exchange, null);
    assert.equal(cue.endpoints, null);
    assert.equal(cue.mapAnchor, null);
    assert.equal(cue.accent, 'none');
  }
});

void test('delivery does not depend on current active volume enabled or repaired condition', () => {
  const stopped = route();
  stopped.active = false; stopped.volume = 0; stopped.damage = 80;
  assert.ok(stopped.agreement);
  stopped.agreement.enabled = false; stopped.agreement.closedRound = 9; stopped.agreement.lastAttemptRound = 9;
  stopped.agreement.blockedReason = 'A later failed attempt';
  assert.equal(projectRouteCues(previous, observation([delivery()], [stopped])).cues[0]?.accent, 'delivery');
});

void test('missing endpoint retains exact IDs and payment facts while suppressing map accents', () => {
  const missing = route(); missing.fromTown = null;
  const cue = projectRouteCues(previous, observation([delivery()], [missing])).cues[0];
  assert.ok(cue?.kind === 'delivery');
  assert.equal(cue.endpoints?.fromCityId, 'frontier');
  assert.ok(cue.exchange);
  assert.equal(cue.mapAnchor, null);
  assert.equal(cue.accent, 'none');
  const town = route().fromTown; assert.ok(town);
  missing.fromTown = { ...town, id: 'capital' };
  assert.equal(projectRouteCues(previous, observation([delivery()], [missing])).cues[0]?.mapAnchor, null);
});

void test('unrecognized delivery grammar and invalid aggregate never invent resource amounts', () => {
  for (const patch of [
    { cause: 'An offer probably delivered' }, { actor: 4 }, { target: 4 },
    { effects: [] }, { effects: ['NaN cargo exchanged atomically'] },
    { effects: ['7 cargo exchanged atomically', '7 cargo exchanged atomically'] },
  ]) {
    const cue = projectRouteCues(previous, observation([{ ...delivery(), ...patch }])).cues[0];
    assert.ok(cue?.kind === 'delivery');
    assert.equal(cue.exchange, null);
    assert.equal(cue.accent, 'none');
  }
});

void test('zero recorded cargo and zero vectors do not earn a delivery accent', () => {
  const empty = route(); assert.ok(empty.agreement);
  empty.agreement.terms.proposerCargo = {}; empty.agreement.terms.recipientCargo = {};
  const event = delivery(); event.effects = ['0 cargo exchanged atomically'];
  const cue = projectRouteCues(previous, observation([event], [empty])).cues[0];
  assert.ok(cue?.kind === 'delivery');
  assert.equal(cue.aggregateCargo, 0); assert.equal(cue.accent, 'none');
});

void test('charter result preserves reversed proposer identity paid amounts and clamped repair separately from current damage', () => {
  const current = route(); current.damage = 35;
  const cue = projectRouteCues(previous, observation([repair()], [current])).cues[0];
  assert.ok(cue?.kind === 'public-repair');
  assert.equal(cue.result.proposer, 1);
  assert.deepEqual(cue.result.proposerPaid, { materials: 5, credits: 2 });
  assert.deepEqual(cue.result.recipientPaid, { materials: 7 });
  assert.equal(cue.damageReduction, 12);
  assert.equal(cue.currentDamage, 35);
  assert.equal(cue.accent, 'repair');
  assert.equal(cue.mapAnchor?.from.id, 'frontier');
});

void test('all non-completed charter outcomes preserve facts but never earn repair or cargo accents', () => {
  for (const outcome of ['declined', 'cancelled', 'expired', 'failed', 'no-work-needed'] as const) {
    const cue = projectRouteCues(previous, observation([repair(outcome)])).cues[0];
    assert.ok(cue?.kind === 'public-repair');
    assert.equal(cue.result.outcome, outcome);
    assert.deepEqual(cue.result.proposerPaid, {});
    assert.deepEqual(cue.result.recipientPaid, {});
    assert.equal(cue.accent, 'none');
  }
});

void test('zero and missing damage reductions stay factual without a repair accent', () => {
  for (const [before, after] of [[0, 0], [null, null], [12, 12]] as const) {
    const event = repair(); assert.ok(event.publicProjectResult);
    event.publicProjectResult.damageBefore = before; event.publicProjectResult.damageAfter = after;
    const cue = projectRouteCues(previous, observation([event])).cues[0];
    assert.ok(cue?.kind === 'public-repair');
    assert.equal(cue.damageReduction, before === null ? null : 0);
    assert.equal(cue.accent, 'none');
  }
});

void test('missing or replaced charter route preserves its structured receipt without borrowing current endpoints', () => {
  const changed = route(); assert.ok(changed.agreement); changed.agreement.offerId = 'replacement';
  for (const routes of [[], [changed]]) {
    const cue = projectRouteCues(previous, observation([repair()], routes)).cues[0];
    assert.ok(cue?.kind === 'public-repair');
    assert.deepEqual(cue.result, repair().publicProjectResult);
    assert.equal(cue.mapAnchor, null); assert.equal(cue.endpoints, null);
    assert.equal(cue.currentDamage, null); assert.equal(cue.accent, 'none');
  }
});

void test('proposal commitment blocked shipment and mismatched charter result emit no result cue', () => {
  for (const type of ['trade-proposed', 'trade-accepted', 'trade-blocked', 'public-project-proposed', 'public-project-committed'])
    assert.deepEqual(projectRouteCues(previous, observation([{ ...delivery(), type }])).cues, []);
  const event = repair(); event.type = 'public-project-failed';
  assert.deepEqual(projectRouteCues(previous, observation([event])).cues, []);
});

void test('repeated polling same revision and out-of-order snapshots cannot replay a result', () => {
  const first = projectRouteCues(previous, observation());
  assert.equal(first.cues.length, 1);
  assert.deepEqual(projectRouteCues(first.cursor, observation()).cues, []);
  assert.deepEqual(projectRouteCues(first.cursor, { ...observation(), revision: 9 }), { cursor: first.cursor, cues: [] });
  assert.deepEqual(projectRouteCues(first.cursor, { ...observation(), revision: 12 }).cues, []);
});

void test('history leaves the live watermark unchanged and baseline consumes unseen results without replay', () => {
  const history = projectRouteCues(previous, { ...observation(), mode: 'history' });
  assert.deepEqual(history.cues, []);
  assert.equal(history.cursor?.revision, previous.revision);
  assert.equal(history.cursor?.identity, previous.identity);
  const hidden = projectRouteCues(previous, { ...observation(), mode: 'baseline' });
  assert.deepEqual(hidden.cues, []);
  assert.equal(hidden.cursor?.revision, 11);
  assert.deepEqual(projectRouteCues(hidden.cursor, observation()).cues, []);
});

void test('only committed source revision IDs between watermarks are eligible and duplicate IDs appear once', () => {
  const events = ['old', '10:7', '12:0', '999999999999999999:0', '11:0', '11:0'].map((id) => delivery(id));
  assert.deepEqual(projectRouteCues(previous, observation(events)).cues.map((cue) => cue.eventId), ['11:0']);
});

void test('one narrow slot and at most three shared slots consume overflow without later replay', () => {
  const current = observation([delivery('11:0'), repair('completed', '11:1'), delivery('11:2'), repair('failed', '11:3')]);
  const narrow = projectRouteCues(previous, current, 1);
  assert.deepEqual(narrow.cues.map((cue) => cue.eventId), ['11:3']);
  assert.equal(projectRouteCues(previous, current, 50).cues.length, 3);
  assert.deepEqual(projectRouteCues(narrow.cursor, current, 3).cues, []);
  const none = projectRouteCues(previous, current, 0);
  assert.deepEqual(none.cues, []); assert.equal(none.cursor?.revision, 11);
});

void test('event scan is bounded to the latest96 and deterministic for equal-importance outcomes', () => {
  const current = observation([delivery('11:0'), ...Array.from({ length: 96 }, (_, i) => ({ ...delivery(`11:${i + 1}`), type: 'clock-tick' }))]);
  assert.deepEqual(projectRouteCues(previous, current).cues, []);
  const shuffled = observation([delivery('11:8'), repair('completed', '11:2')]);
  assert.deepEqual(projectRouteCues(previous, shuffled).cues.map((cue) => cue.eventId), ['11:8', '11:2']);
});

void test('projection never mutates source cursor events routes or retained terms and clones exposed receipt facts', () => {
  const current = observation([delivery(), repair()]); const before = structuredClone(current); const old = structuredClone(previous);
  const result = projectRouteCues(previous, current);
  assert.equal(result.cues.length, 2);
  assert.deepEqual(current, before); assert.deepEqual(previous, old);
  for (const cue of result.cues) {
    if (cue.mapAnchor) cue.mapAnchor.from.name = 'Changed locally';
    if (cue.kind === 'delivery' && cue.exchange) cue.exchange.proposer.cargo.food = 999;
    if (cue.kind === 'public-repair') cue.result.proposerPaid.materials = 999;
  }
  assert.deepEqual(current, before);
});

void test('actual engine delivery IDs belong to the committed revision and are new above the prior watermark', async () => {
  const { createWorld } = await import('../core/engine.ts');
  const { resolveTrade } = await import('../core/simulation/trade.ts');
  const state = createWorld(1701);
  state.revision = 11; state.round = 8;
  const from = state.cities[0]; const to = state.cities[1];
  assert.ok(from && to); from.id = 'frontier'; to.id = 'harbor';
  const current = route(); assert.ok(current.agreement); current.agreement.nextDeliveryRound = 8; current.agreement.lastAttemptRound = null;
  state.routes = [current];
  for (const civilization of state.civilizations)
    civilization.resources = { food: 100, materials: 100, energy: 100, credits: 100, science: 100, culture: 100 };
  const events: GameEvent[] = [];
  resolveTrade(state, events);
  assert.equal(events[0]?.id, '11:0');
  const result = projectRouteCues(previous, observation(events, [current]));
  assert.equal(result.cues.length, 1);
  assert.equal(result.cues[0]?.eventId, '11:0');
  assert.equal(result.cues[0]?.accent, 'delivery');
});

void test('returning from history baselines the latest live view before admitting another new result', () => {
  const historical = projectRouteCues(previous, { ...observation(), revision: 9, mode: 'history' });
  const resumed = projectRouteCues(historical.cursor, observation());
  assert.deepEqual(resumed.cues, []);
  assert.equal(resumed.cursor?.revision, 11);
  const newlyCommitted = projectRouteCues(resumed.cursor, { ...observation([delivery('12:0')]), revision: 12 });
  assert.equal(newlyCommitted.cues.length, 1);
  const same = projectRouteCues(historical.cursor, { ...observation(), revision: 10 });
  assert.equal(projectRouteCues(same.cursor, observation()).cues.length, 1);
});
