import assert from 'node:assert/strict';
import test from 'node:test';
import * as engine from '../core/engine.ts';
import { applyCommand, applyDirectorTick, catchUpClock, createWorld, legalActions, observe } from '../core/engine.ts';
import { chooseAction, simulate } from '../core/policies.ts';
import { CIV_COUNT, DIRECTOR_SEAT, type Command, type ActionOption, type HistoryAdvanceCommand, type GameAction, type WorldState, type Resources } from '../core/types.ts';
import { RELEASES } from '../core/release.ts';
import { BUILDINGS, ECONOMY_RULES, RESOURCE_IDS, TRADE_RECIPES, TRADE_RULES, TURN_RULES } from '../core/content.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { applyEffects } from '../core/simulation/effects.ts';
import { milestoneEligible } from '../core/simulation/history.ts';
import { resolveTrade } from '../core/simulation/trade.ts';
import { isWorldState } from '../core/validation.ts';

function play(state: WorldState): WorldState {
  const result = applyCommand(state, {
    seat: state.phase,
    expectedRevision: state.revision,
    action: chooseAction(state, state.phase),
  });
  assert.equal(result.ok, true, result.error);
  assert.ok(isWorldState(result.state));
  return result.state;
}

await test('seeded worlds contain five civilizations and actual owned starting cities', () => {
  const world = createWorld(17);
  assert.deepEqual(world, createWorld(17));
  assert.notDeepEqual(world.tiles, createWorld(18).tiles);
  assert.equal(world.civilizations.length, CIV_COUNT);
  assert.equal(world.cities.length, CIV_COUNT);
  assert.equal(new Set(world.cities.map((city) => city.civId)).size, CIV_COUNT);
  for (const city of world.cities) {
    assert.equal(world.tiles.find((tile) => tile.id === city.tileId)?.owner, city.civId);
    assert.ok(city.population > 0);
  }
});

await test('all six seats use one command boundary and a full cycle resolves exactly one round', () => {
  let state = createWorld(5);
  const initial = structuredClone(state);
  for (let seat = 0; seat <= DIRECTOR_SEAT; seat += 1) {
    assert.equal(state.phase, seat);
    const observation = observe(state, seat);
    assert.deepEqual(observation.legalActions, legalActions(state, seat));
    assert.ok(observation.legalActions.length > 0);
    const before = structuredClone(state);
    const result = applyCommand(state, {
      seat,
      expectedRevision: state.revision,
      action: observation.legalActions[0]?.action ?? { type: 'wait' },
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.state.revision, state.revision + 1);
    assert.deepEqual(state, before);
    assert.ok(result.events.every((event) => event.id && event.cause && event.effects.length > 0));
    state = result.state;
  }
  assert.equal(state.round, initial.round + 1);
  assert.equal(state.phase, 0);
  assert.notDeepEqual(state.civilizations, initial.civilizations);
});

await test('wrong seats, stale revisions and unknown actions preserve the whole state', () => {
  const state = createWorld(5);
  const before = structuredClone(state);
  const invalid: Command[] = [
    { seat: 1, expectedRevision: 0, action: { type: 'wait' } },
    { seat: 0, expectedRevision: 99, action: { type: 'wait' } },
    { seat: -1, expectedRevision: 0, action: { type: 'wait' } },
    { seat: 0, expectedRevision: 0, action: { type: 'settle', tileId: -1 } },
    { seat: 0, expectedRevision: 0, action: { type: 'research', technology: 'missing' } },
    { seat: 0, expectedRevision: 0, action: { type: 'event', event: 'earthquake', target: 1 } },
  ];
  for (const command of invalid) {
    const result = applyCommand(state, command);
    assert.equal(result.ok, false);
    assert.equal(result.state, state);
    assert.deepEqual(state, before);
    assert.deepEqual(result.events, []);
  }
});

await test('built-in replay records commands that reproduce every committed frame', () => {
  const replay = simulate(21, 5, 'balanced');
  assert.equal(replay.source, 'builtin-policies');
  assert.ok(replay.commands.length > 0);
  let state = replay.initial;
  for (const command of replay.commands) {
    const result = applyCommand(state, command);
    assert.equal(result.ok, true, result.error);
    state = result.state;
    const frame = replay.frames.find((candidate) => candidate.state.revision === state.revision);
    if (frame) assert.deepEqual(frame.state, state);
  }
  assert.deepEqual(replay, simulate(21, 5, 'balanced'));
});

await test('headless policies produce deterministic structured turns without a renderer', () => {
  let left = createWorld(39);
  let right = createWorld(39);
  for (let step = 0; step < 24; step += 1) {
    left = play(left);
    right = play(right);
  }
  assert.deepEqual(left, right);
});

await test('ordinary research and construction change capabilities without advancing the clock', () => {
  let state = createWorld(8);
  for (let step = 0; step < 60; step += 1) state = play(state);
  assert.ok(
    state.civilizations.some((civilization) => civilization.technologies.includes('agriculture')),
  );
  assert.ok(state.cities.some((city) => city.buildings.includes('farm')));
  assert.ok(state.calendarMilestones.includes('first-harvest'));
  assert.equal(state.year, createWorld(8).year);
  assert.ok(state.civilizations.every((civilization) => civilization.era === 0));
  assert.equal(state.outcome, null);
  assert.ok(state.civilizations.every((civilization) => civilization.marsPopulation === 0));
});

await test('six-minute clock catchup advances ten years per persisted tick and repeated reads are idempotent', () => {
  const state = createWorld(8, '2026-10-16T00:00:00.000Z');
  const result = catchUpClock(state, '2026-10-16T01:00:00.000Z');
  assert.equal(result.ok, true, result.error);
  assert.equal(result.remainingTicks, 0);
  assert.equal(result.state.clockTicks, 10);
  assert.equal(result.state.year, state.year + 100);
  assert.equal(result.state.revision, 10);
  assert.equal(result.state.phase, state.phase);
  assert.equal(result.state.round, state.round);
  assert.equal(result.events.filter((event) => event.type === 'clock-major-milestone').length, 1);
  assert.ok(result.events.every((event) => event.cause.includes('2026-10-16T')));
  const again = catchUpClock(result.state, '2026-10-16T01:00:00.000Z');
  assert.deepEqual(again.state, result.state);
  assert.deepEqual(again.events, []);
  assert.ok(result.state.civilizations.every((civilization) => civilization.era === 0));
});

await test('catchup bounds missed intervals without losing remaining authoritative time', () => {
  const state = createWorld(8, '2026-10-16T00:00:00.000Z');
  const first = catchUpClock(state, '2026-10-18T00:00:00.000Z');
  assert.equal(first.ok, true, first.error);
  assert.equal(first.state.clockTicks, 240);
  assert.equal(first.remainingTicks, 240);
  const second = catchUpClock(first.state, '2026-10-18T00:00:00.000Z');
  assert.equal(second.state.clockTicks, 480);
  assert.equal(second.remainingTicks, 0);
  assert.equal(second.state.year, state.year + 4800);
});

await test('Director event and review pulses add no years and reject repeated intervals', () => {
  const state = createWorld(8);
  const tick = {
    expectedRevision: 0,
    kind: 'event' as const,
    intervalId: '2026-10-16T00',
    timestamp: '2026-10-16T00:00:00.000Z',
    event: 'resource-boom' as const,
    target: 0,
  };
  const result = applyDirectorTick(state, tick);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.year, state.year);
  assert.notDeepEqual(result.state.civilizations[0]?.resources, state.civilizations[0]?.resources);
  assert.equal(result.state.phase, state.phase);
  const duplicate = applyDirectorTick(result.state, {
    ...tick,
    expectedRevision: result.state.revision,
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.state, result.state);
  const review = applyDirectorTick(result.state, {
    ...tick,
    kind: 'review',
    expectedRevision: result.state.revision,
  });
  assert.equal(review.ok, true, review.error);
  assert.equal(review.state.year, state.year);
});

await test('clock commands cannot invent arbitrary intervals or bypass the persisted epoch', () => {
  const state = createWorld(8, '2026-10-16T00:00:00.000Z');
  const result = applyDirectorTick(state, {
    expectedRevision: state.revision,
    kind: 'clock',
    intervalId: 'invented',
    timestamp: '2026-10-16T00:06:00.000Z',
    event: 'calm',
    target: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, state);
  assert.equal(catchUpClock(state, '2026-10-15T23:00:00.000Z').ok, false);
  assert.equal(catchUpClock(state, 'not-a-timestamp').ok, false);
});

await test('built farms causally improve real food supplies and generic disasters reduce working city output', () => {
  const baseline = createWorld(8);
  const farmWorld = structuredClone(baseline);
  const damagedWorld = structuredClone(baseline);
  const farmCity = farmWorld.cities[0];
  assert.ok(farmCity);
  farmCity.buildings.push('farm');
  const effects = applyEffects(damagedWorld, 0, [{ kind: 'city', field: 'damage', amount: 60 }]);
  assert.ok(effects.some((effect) => effect.includes('damage')));
  resolveEconomy(baseline, []);
  resolveEconomy(farmWorld, []);
  resolveEconomy(damagedWorld, []);
  assert.ok(
    (farmWorld.civilizations[0]?.resources.food ?? 0) >
      (baseline.civilizations[0]?.resources.food ?? 0),
  );
  assert.ok(
    (damagedWorld.civilizations[0]?.resources.science ?? 0) <
      (baseline.civilizations[0]?.resources.science ?? 0),
  );
});

await test('damage stops due consented cargo and commerce without revoking the agreement', () => {
  const intact = agreementFixture();
  const broken = structuredClone(intact);
  const route = broken.routes[0];
  assert.ok(route?.agreement);
  route.damage = route.agreement.terms.damageDisableAt;
  const due = route.agreement.nextDeliveryRound;
  const delivered = waitForRound(intact, due);
  const blocked = waitForRound(broken, due);
  assert.equal(delivered.routes[0]?.active, true);
  assert.equal(blocked.routes[0]?.active, false);
  assert.equal(blocked.routes[0]?.agreement?.enabled, true);
  assert.equal(blocked.routes[0]?.agreement?.deliveryCount, 0);
  assert.ok(blocked.routes[0]?.agreement?.blockedReason);
  assert.ok(
    !legalActions(blocked, blocked.phase).some(
      (choice) => choice.action.type === 'propose-trade' && choice.action.partner === 1,
    ),
  );
  assert.ok(
    (delivered.civilizations[1]?.resources.food ?? 0) >
      (blocked.civilizations[1]?.resources.food ?? 0),
  );
});

await test('an unconsented legacy route cannot spend a partner stockpile or ship cargo', () => {
  const baseline = createWorld(8);
  const legacy = structuredClone(baseline);
  legacy.routes.push({
    id: 'old-unconsented-route',
    from: 'city-0',
    to: 'city-1',
    owner: 0,
    partner: 1,
    active: true,
    damage: 0,
    volume: 4,
  });
  resolveEconomy(baseline, []);
  resolveEconomy(legacy, []);
  assert.deepEqual(
    legacy.civilizations.map((civilization) => civilization.resources),
    baseline.civilizations.map((civilization) => civilization.resources),
  );
  assert.equal(legacy.routes[0]?.active, false);
  assert.equal(legacy.routes[0]?.volume, 0);
});

await test('unreleased actions remain unavailable even after arbitrarily late clock years', () => {
  const state = createWorld(8);
  state.year = 5000;
  const choices = legalActions(state, 0);
  assert.ok(
    !choices.some((choice) =>
      ['settle', 'trade', 'federate', 'expedition'].includes(choice.action.type),
    ),
  );
  assert.ok(
    !choices.some(
      (choice) => choice.action.type === 'research' && choice.action.technology !== 'agriculture',
    ),
  );
  const director = structuredClone(state);
  director.phase = DIRECTOR_SEAT;
  assert.ok(
    legalActions(director, DIRECTOR_SEAT).every(
      (choice) =>
        choice.action.type !== 'event' ||
        !['earthquake', 'crypto-boom', 'ufo-contact'].includes(choice.action.event),
    ),
  );
});

await test('history evidence persists independently of bounded recent events', () => {
  const state = createWorld(8);
  state.eventCounts['old-harvest'] = 4;
  state.events = [];
  assert.equal(
    milestoneEligible(state, [], {
      id: 'test-history',
      name: 'Observed history',
      requiredFeatures: ['settlement-turns'],
      requiresMilestones: [],
      conditions: [{ kind: 'recorded-event-count', eventType: 'old-harvest', minimum: 4 }],
      year: -9000,
      era: 0,
      explanation: 'Four historical harvests were recorded',
    }),
    true,
  );
});

await test('observations are detached and completed runs refuse additional world commands', () => {
  const state = createWorld(8);
  const snapshot = observe(state, 0);
  if (snapshot.civilization) snapshot.civilization.resources.food = 0;
  assert.equal(state.civilizations[0]?.resources.food, ECONOMY_RULES.initialResources.food);
  state.outcome = {
    kind: 'mars',
    winners: [0],
    round: state.round,
    reason: 'Archived terminal fixture',
  };
  const result = applyCommand(state, { seat: 0, expectedRevision: 0, action: { type: 'wait' } });
  assert.equal(result.ok, false);
  assert.equal(result.state, state);
  assert.deepEqual(legalActions(state, 0), []);
});

await test('Director shock cooldown counts complete subsequent working rounds', () => {
  const initial = createWorld(8);
  initial.phase = DIRECTOR_SEAT;
  const shock = applyCommand(initial, {
    seat: DIRECTOR_SEAT,
    expectedRevision: initial.revision,
    action: { type: 'event', event: 'drought', target: 0 },
  });
  assert.equal(shock.ok, true, shock.error);
  assert.equal(shock.state.directorCooldown, 2);
  let state = shock.state;
  for (let round = 0; round < 2; round += 1) {
    for (let seat = 0; seat < DIRECTOR_SEAT; seat += 1) state = play(state);
    assert.ok(legalActions(state, DIRECTOR_SEAT).every((choice) => choice.action.type !== 'event'));
    const result = applyCommand(state, {
      seat: DIRECTOR_SEAT,
      expectedRevision: state.revision,
      action: { type: 'wait' },
    });
    assert.equal(result.ok, true, result.error);
    state = result.state;
  }
  for (let seat = 0; seat < DIRECTOR_SEAT; seat += 1) state = play(state);
  assert.ok(legalActions(state, DIRECTOR_SEAT).some((choice) => choice.action.type === 'event'));
});

await test('fresh registered rules initialize capability state without migration history', () => {
  const foundation = createWorld(8);
  const current = createWorld(8, '2026-10-16T00:00:00.000Z', 'settlement-decisions-1');
  assert.equal(foundation.releaseId, 'settlement-foundations-1');
  assert.equal(current.releaseId, 'settlement-decisions-1');
  assert.deepEqual(current.unlockedFeatures, RELEASES.find(rules => rules.id === current.releaseId)?.featureIds);
  assert.equal(current.revision, 0);
  assert.equal(current.round, 0);
  assert.deepEqual(current.events.map(event => event.type), ['world-founded']);
  assert.deepEqual(current.actionPlans, Array.from({ length: DIRECTOR_SEAT + 1 }, () => null));
  assert.equal(current.independentTurns?.strategyTicks, 0);
  assert.ok(isWorldState(current));
  assert.deepEqual(JSON.parse(JSON.stringify(current)), current);
  assert.throws(() => createWorld(8, undefined, 'settlement-independent-1'), /epoch/);
  assert.throws(() => createWorld(8, '2026-10-16T00:00:00.000Z', 'unknown-rules'), /registered/);
});

function historyCommand(state: WorldState): HistoryAdvanceCommand {
  return {
    expectedRevision: state.revision,
    cause: { kind: 'feature', id: 'settlement-production' },
    reason: 'Working settlements sustain a new historical period',
    deltaYears: 35,
    timestamp: '2026-10-16T00:01:00.000Z',
  };
}

function upgradedWorld(): WorldState {
  return createWorld(8, '2026-10-16T00:00:00.000Z', 'settlement-foundations-2');
}

await test('intentional history advancement records one causal receipt without consuming the clock', () => {
  assert.equal(typeof engine.applyHistoryAdvance, 'function');
  const state = play(upgradedWorld());
  const before = structuredClone(state);
  const command = historyCommand(state);
  const result = engine.applyHistoryAdvance(state, command);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(state, before);
  assert.equal(result.state.year, before.year + command.deltaYears);
  assert.equal(result.state.revision, before.revision + 1);
  assert.equal(result.state.phase, before.phase);
  assert.equal(result.state.round, before.round);
  assert.equal(result.state.clockEpoch, before.clockEpoch);
  assert.equal(result.state.clockTicks, before.clockTicks);
  const receipt = result.state.historyAdvances?.['feature:settlement-production'];
  assert.ok(receipt);
  assert.deepEqual(receipt.cause, command.cause);
  assert.equal(receipt.reason, command.reason);
  assert.equal(receipt.deltaYears, command.deltaYears);
  assert.equal(receipt.yearBefore, before.year);
  assert.equal(receipt.yearAfter, result.state.year);
  assert.ok(receipt.evidence.length > 0);
  assert.equal(result.events[0]?.type, 'history-advanced');
  assert.ok(result.events[0]?.cause.includes(command.cause.id));
  const tick = catchUpClock(result.state, '2026-10-16T00:06:00.000Z');
  assert.equal(tick.ok, true, tick.error);
  assert.equal(tick.state.year, result.state.year + 10);
  assert.equal(tick.state.clockTicks, 1);
  assert.deepEqual(tick.state.historyAdvances, result.state.historyAdvances);
  assert.deepEqual(tick.state.unlockedFeatures, state.unlockedFeatures);
});

await test('history advancement requires a shipped capability and real eligible cause', () => {
  assert.equal(typeof engine.applyHistoryAdvance, 'function');
  const original = createWorld(8);
  const upgraded = upgradedWorld();
  for (const [state, command] of [
    [original, historyCommand(original)],
    [
      upgraded,
      { ...historyCommand(upgraded), cause: { kind: 'feature', id: 'interplanetary-logistics' } },
    ],
    [upgraded, { ...historyCommand(upgraded), cause: { kind: 'event', id: 'invented-event' } }],
  ] as const) {
    const before = structuredClone(state);
    const result = engine.applyHistoryAdvance(state, command);
    assert.equal(result.ok, false);
    assert.equal(result.state, state);
    assert.deepEqual(state, before);
  }
});

await test('actual event evidence and duplicate history causes survive bounded event trimming', () => {
  assert.equal(typeof engine.applyHistoryAdvance, 'function');
  const state = upgradedWorld();
  const cause = state.events[0];
  assert.ok(cause);
  const command: HistoryAdvanceCommand = {
    ...historyCommand(state),
    cause: { kind: 'event', id: cause.id },
    deltaYears: 0,
  };
  const result = engine.applyHistoryAdvance(state, command);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.year, state.year);
  const receipt = result.state.historyAdvances?.[`event:${cause.id}`];
  assert.ok(receipt?.evidence.some((evidence) => evidence.includes(cause.title)));
  const trimmed = catchUpClock(result.state, '2026-10-16T12:00:00.000Z').state;
  assert.ok(!trimmed.events.some((event) => event.id === cause.id));
  assert.deepEqual(trimmed.historyAdvances?.[`event:${cause.id}`], receipt);
  const duplicate = engine.applyHistoryAdvance(trimmed, {
    ...command,
    expectedRevision: trimmed.revision,
    deltaYears: 50,
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.state, trimmed);
});

await test('invalid history deltas, revisions, reasons and timestamps never mutate the world', () => {
  assert.equal(typeof engine.applyHistoryAdvance, 'function');
  const state = upgradedWorld();
  const command = historyCommand(state);
  for (const input of [
    { ...command, deltaYears: -1 },
    { ...command, deltaYears: 0.5 },
    { ...command, deltaYears: NaN },
    { ...command, deltaYears: Infinity },
    { ...command, deltaYears: Number.MAX_SAFE_INTEGER + 1 },
    { ...command, expectedRevision: state.revision + 1 },
    { ...command, reason: '' },
    { ...command, reason: '   ' },
    { ...command, timestamp: '2026-02-30T00:00:00.000Z' },
    { ...command, timestamp: '2026-10-16T00:01:00+00:00' },
  ]) {
    const before = structuredClone(state);
    const result = engine.applyHistoryAdvance(state, input);
    assert.equal(result.ok, false);
    assert.equal(result.state, state);
    assert.deepEqual(result.events, []);
    assert.deepEqual(state, before);
  }
  const overflowing = { ...state, year: Number.MAX_SAFE_INTEGER };
  assert.equal(engine.applyHistoryAdvance(overflowing, historyCommand(overflowing)).ok, false);
});

await test('hybrid evolution remains deterministic, detached, cause-idempotent and terminal-safe', () => {
  const state = upgradedWorld();
  const command = historyCommand(state);
  const left = engine.applyHistoryAdvance(state, command);
  const right = engine.applyHistoryAdvance(upgradedWorld(), historyCommand(upgradedWorld()));
  assert.equal(left.ok, true, left.error);
  assert.deepEqual(left, right);
  command.cause.id = 'director-events';
  assert.equal(
    left.state.historyAdvances?.['feature:settlement-production']?.cause.id,
    'settlement-production',
  );
  const duplicate = engine.applyHistoryAdvance(left.state, {
    ...historyCommand(left.state),
    reason: 'A different reason cannot reuse the same historical cause',
    deltaYears: 50,
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.state, left.state);
  const terminal: WorldState = {
    ...state,
    outcome: { kind: 'mars', winners: [0], round: state.round, reason: 'Archived run' },
  };
  assert.equal(engine.applyHistoryAdvance(terminal, historyCommand(terminal)).state, terminal);
  assert.equal(engine.applyHistoryAdvance(terminal, historyCommand(terminal)).ok, false);
});

function tradeFixture(): WorldState {
  return createWorld(8, '2026-10-16T00:00:00.000Z', 'settlement-trade-1');
}

function turn(state: WorldState, action: GameAction): WorldState {
  const result = applyCommand(state, {
    seat: state.phase,
    expectedRevision: state.revision,
    action,
  });
  assert.equal(result.ok, true, result.error);
  assert.ok(isWorldState(result.state));
  return result.state;
}

function waitForSeat(state: WorldState, seat: number): WorldState {
  let next = state;
  while (next.phase !== seat) next = turn(next, { type: 'wait' });
  return next;
}

function waitForRound(state: WorldState, round: number): WorldState {
  let next = state;
  while (next.round < round) next = turn(next, { type: 'wait' });
  return next;
}

function proposalFixture(): WorldState {
  const recipe = TRADE_RECIPES.find(candidate => candidate.id === 'harvest-for-materials');
  assert.ok(recipe);
  return turn(tradeFixture(), { type: 'propose-trade', partner: 1, recipeId: recipe.id });
}

function agreementFixture(): WorldState {
  const state = proposalFixture();
  const offer = state.tradeOffers?.[0];
  assert.ok(offer);
  return turn(state, { type: 'respond-trade', offerId: offer.id, accept: true });
}

await test('trade proposals are immediate consent requests with no imposed shipment or recipient payment', () => {
  const initial = tradeFixture();
  const state = proposalFixture();
  const offer = state.tradeOffers?.[0];
  assert.ok(offer);
  assert.equal(offer.status, 'pending');
  assert.equal(offer.expiresRound, state.round + TRADE_RULES.offerExpiryRounds);
  assert.deepEqual(
    state.civilizations.map((civilization) => civilization.resources),
    initial.civilizations.map((civilization) => civilization.resources),
  );
  assert.equal(state.routes.length, 0);
  assert.equal(observe(state, 1).tradeOffers?.[0]?.id, offer.id);
  assert.equal(observe(state, 2).tradeOffers?.length, 0);
  const noOffer = waitForRound(turn(initial, { type: 'wait' }), 2);
  const pending = waitForRound(state, 2);
  assert.deepEqual(
    pending.civilizations.map((civilization) => civilization.resources),
    noOffer.civilizations.map((civilization) => civilization.resources),
  );
  assert.equal(pending.routes.length, 0);
});

await test('only the named recipient accepts once and crossed pending offers remain unavailable', () => {
  const proposal = proposalFixture();
  const offer = proposal.tradeOffers?.[0];
  assert.ok(offer);
  assert.ok(
    !legalActions(proposal, 1).some(
      (choice) => choice.action.type === 'propose-trade' && choice.action.partner === 0,
    ),
  );
  const thirdParty = waitForSeat(proposal, 2);
  const wrong = applyCommand(thirdParty, {
    seat: 2,
    expectedRevision: thirdParty.revision,
    action: { type: 'respond-trade', offerId: offer.id, accept: true },
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.state, thirdParty);
  const stale = applyCommand(proposal, {
    seat: 1,
    expectedRevision: proposal.revision - 1,
    action: { type: 'respond-trade', offerId: offer.id, accept: true },
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.state, proposal);
  const withdraw = applyCommand(proposal, {
    seat: 1,
    expectedRevision: proposal.revision,
    action: { type: 'withdraw-trade', offerId: offer.id },
  });
  assert.equal(withdraw.ok, false);
  assert.equal(withdraw.state, proposal);
  const state = agreementFixture();
  const route = state.routes[0];
  assert.ok(route?.agreement);
  assert.equal(state.tradeOffers?.[0]?.status, 'accepted');
  assert.equal(route.agreement.enabled, true);
  assert.equal(route.agreement.nextDeliveryRound, route.agreement.terms.cadenceRounds);
  assert.equal(route.agreement.deliveryCount, 0);
  assert.equal(route.active, false);
  assert.equal(route.volume, 0);
  for (const resource of RESOURCE_IDS)
    assert.equal(
      state.civilizations[0]?.resources[resource],
      (proposal.civilizations[0]?.resources[resource] ?? 0) -
        (offer.terms.constructionCost[resource] ?? 0),
    );
  assert.deepEqual(state.civilizations[1]?.resources, proposal.civilizations[1]?.resources);
  const recipient = waitForSeat(state, 1);
  const duplicate = applyCommand(recipient, {
    seat: 1,
    expectedRevision: recipient.revision,
    action: { type: 'respond-trade', offerId: offer.id, accept: true },
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.state, recipient);
  assert.equal(recipient.routes.length, 1);
});

await test('pending offers can be declined or withdrawn only by their named actor and expire after eight rounds', () => {
  const state = proposalFixture();
  const offer = state.tradeOffers?.[0];
  assert.ok(offer);
  const declined = turn(state, { type: 'respond-trade', offerId: offer.id, accept: false });
  assert.equal(declined.tradeOffers?.[0]?.status, 'declined');
  assert.equal(declined.routes.length, 0);
  const proposer = waitForSeat(state, 0);
  const withdrawn = turn(proposer, { type: 'withdraw-trade', offerId: offer.id });
  assert.equal(withdrawn.tradeOffers?.[0]?.status, 'withdrawn');
  const expired = waitForRound(state, offer.expiresRound);
  assert.equal(expired.tradeOffers?.[0]?.status, 'expired');
  const recipient = waitForSeat(expired, 1);
  const refused = applyCommand(recipient, {
    seat: 1,
    expectedRevision: recipient.revision,
    action: { type: 'respond-trade', offerId: offer.id, accept: true },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.state, recipient);
});

await test('acceptance validates current construction affordability and endpoints atomically', () => {
  const proposal = proposalFixture();
  const offer = proposal.tradeOffers?.[0];
  assert.ok(offer);
  const poor = structuredClone(proposal);
  const proposer = poor.civilizations[0];
  assert.ok(proposer);
  proposer.resources.materials = 0;
  const noEndpoint = structuredClone(proposal);
  noEndpoint.cities = noEndpoint.cities.filter((city) => city.id !== offer.to);
  for (const state of [poor, noEndpoint]) {
    const before = structuredClone(state);
    const result = applyCommand(state, {
      seat: state.phase,
      expectedRevision: state.revision,
      action: { type: 'respond-trade', offerId: offer.id, accept: true },
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, state);
    assert.deepEqual(state, before);
  }
});

await test('agreed shipments happen on strictly later strategic beats and conserve actual cargo', () => {
  const accepted = agreementFixture();
  const route = accepted.routes[0];
  assert.ok(route?.agreement);
  const due = route.agreement.nextDeliveryRound;
  const beforeBeat = waitForRound(accepted, due - 1);
  assert.equal(beforeBeat.routes[0]?.agreement?.deliveryCount, 0);
  const unshipped = structuredClone(accepted);
  const disabled = unshipped.routes[0]?.agreement;
  assert.ok(disabled);
  disabled.enabled = false;
  disabled.closedRound = unshipped.round;
  const baseline = waitForRound(unshipped, due);
  const delivered = waitForRound(accepted, due);
  const actual = delivered.routes[0];
  assert.ok(actual?.agreement);
  assert.equal(actual.agreement.deliveryCount, 1);
  assert.equal(actual.agreement.lastDeliveryRound, due);
  assert.equal(actual.agreement.nextDeliveryRound, due + actual.agreement.terms.cadenceRounds);
  assert.equal(actual.active, true);
  const terms = actual.agreement.terms;
  for (const resource of [
    'food',
    'materials',
    'energy',
    'credits',
    'science',
    'culture',
  ] as const) {
    const ownerDelta =
      -(terms.proposerCargo[resource] ?? 0) -
      (terms.proposerUpkeep[resource] ?? 0) +
      (terms.recipientCargo[resource] ?? 0) +
      (terms.proposerYield[resource] ?? 0);
    const partnerDelta =
      -(terms.recipientCargo[resource] ?? 0) -
      (terms.recipientUpkeep[resource] ?? 0) +
      (terms.proposerCargo[resource] ?? 0) +
      (terms.recipientYield[resource] ?? 0);
    assert.ok(
      Math.abs(
        (delivered.civilizations[0]?.resources[resource] ?? 0) -
          (baseline.civilizations[0]?.resources[resource] ?? 0) -
          ownerDelta,
      ) < 0.000001,
    );
    assert.ok(
      Math.abs(
        (delivered.civilizations[1]?.resources[resource] ?? 0) -
          (baseline.civilizations[1]?.resources[resource] ?? 0) -
          partnerDelta,
      ) < 0.000001,
    );
  }
});

await test('either agreed participant stops future shipments while outsiders cannot stop them', () => {
  const state = agreementFixture();
  const route = state.routes[0];
  assert.ok(route?.agreement);
  const outsider = applyCommand(state, {
    seat: state.phase,
    expectedRevision: state.revision,
    action: { type: 'stop-trade', routeId: route.id },
  });
  assert.equal(outsider.ok, false);
  assert.equal(outsider.state, state);
  for (const seat of [0, 1]) {
    const participant = waitForSeat(state, seat);
    const stopped = turn(participant, { type: 'stop-trade', routeId: route.id });
    assert.equal(stopped.routes[0]?.agreement?.enabled, false);
    assert.equal(stopped.routes[0]?.active, false);
    assert.equal(observe(stopped, seat).routes.length, 0);
    assert.equal(observe(stopped, seat).tradeOffers?.length, 0);
    assert.equal(stopped.tradeOffers?.[0]?.status, 'accepted');
    assert.equal(
      waitForRound(stopped, route.agreement.nextDeliveryRound + 4).routes[0]?.agreement
        ?.deliveryCount,
      0,
    );
  }
});

await test('shipment affordability sums overlapping cargo and upkeep before touching either endpoint', () => {
  for (const blockedId of [0, 1]) {
    const state = agreementFixture();
    const agreement = state.routes[0]?.agreement;
    assert.ok(agreement);
    agreement.terms.proposerCargo = { energy: 4 };
    agreement.terms.recipientCargo = { energy: 4 };
    agreement.terms.proposerUpkeep = { energy: 1 };
    agreement.terms.recipientUpkeep = { energy: 1 };
    for (const civilization of state.civilizations)
      civilization.resources.energy = civilization.id === blockedId ? 4.5 : 100;
    state.round = agreement.nextDeliveryRound;
    const stocks = structuredClone(
      state.civilizations.map((civilization) => civilization.resources),
    );
    const events: import('../core/types.ts').GameEvent[] = [];
    resolveTrade(state, events);
    assert.deepEqual(
      state.civilizations.map((civilization) => civilization.resources),
      stocks,
    );
    assert.equal(agreement.enabled, true);
    assert.equal(agreement.blockedBy, blockedId);
    assert.ok(agreement.blockedReason);
    assert.equal(agreement.deliveryCount, 0);
    assert.equal(events[0]?.type, 'trade-blocked');
    assert.equal(events[0]?.target, blockedId);
  }
});

await test('a strategic beat delivers at most once and retains last-shipment facts between beats', () => {
  const state = agreementFixture();
  const agreement = state.routes[0]?.agreement;
  assert.ok(agreement);
  state.round = agreement.nextDeliveryRound;
  resolveTrade(state, []);
  const delivered = structuredClone(state);
  resolveTrade(state, []);
  assert.deepEqual(state, delivered);
  state.round += 1;
  const beforeNextBeat = structuredClone(state.routes);
  resolveTrade(state, []);
  assert.deepEqual(state.routes, beforeNextBeat);
  assert.equal(agreement.deliveryCount, 1);
});

await test('accepting on a strategic beat schedules only the next strictly later beat', () => {
  const state = waitForRound(tradeFixture(), 4);
  const recipe = TRADE_RECIPES.find(candidate => candidate.id === 'harvest-for-materials');
  assert.ok(recipe);
  const proposal = turn(state, { type: 'propose-trade', partner: 1, recipeId: recipe.id });
  const offer = proposal.tradeOffers?.[0];
  assert.ok(offer);
  const accepted = turn(proposal, { type: 'respond-trade', offerId: offer.id, accept: true });
  assert.equal(accepted.routes[0]?.agreement?.nextDeliveryRound, 8);
  assert.equal(waitForRound(accepted, 7).routes[0]?.agreement?.deliveryCount, 0);
  assert.equal(waitForRound(accepted, 8).routes[0]?.agreement?.deliveryCount, 1);
});

await test('accepted terms are detached from both the pending offer and later catalogue changes', () => {
  const recipe = TRADE_RECIPES.find(candidate => candidate.id === 'harvest-for-materials');
  assert.ok(recipe);
  const saved = structuredClone(recipe.terms);
  try {
    const proposal = proposalFixture();
    const offer = proposal.tradeOffers?.[0];
    assert.ok(offer);
    recipe.terms.proposerCargo.food = 999;
    recipe.terms.cadenceRounds = 100;
    const accepted = turn(proposal, { type: 'respond-trade', offerId: offer.id, accept: true });
    const terms = accepted.routes[0]?.agreement?.terms;
    assert.deepEqual(terms, saved);
    const storedOffer = accepted.tradeOffers?.[0];
    assert.ok(storedOffer);
    storedOffer.terms.proposerCargo.food = 123;
    assert.deepEqual(terms, saved);
  } finally {
    recipe.terms = saved;
  }
});

await test('new consent actions remain release-gated and legacy unilateral trade is never legal', () => {
  for (const state of [createWorld(8), tradeFixture()]) {
    assert.ok(!legalActions(state, state.phase).some((choice) => choice.action.type === 'trade'));
    const legacy = applyCommand(state, {
      seat: state.phase,
      expectedRevision: state.revision,
      action: { type: 'trade', partner: 1 },
    });
    assert.equal(legacy.ok, false);
    assert.equal(legacy.state, state);
  }
  const initial = createWorld(8);
  assert.ok(
    !legalActions(initial, initial.phase).some((choice) =>
      ['propose-trade', 'respond-trade', 'withdraw-trade', 'stop-trade'].includes(
        choice.action.type,
      ),
    ),
  );
});

await test('route agreement is the only consent authority and stopping leaves no apparently active trade treaty', () => {
  const state = agreementFixture();
  assert.equal(state.treaties.filter((treaty) => treaty.kind === 'trade').length, 0);
  const route = state.routes[0];
  assert.ok(route);
  const stopped = turn(waitForSeat(state, 0), { type: 'stop-trade', routeId: route.id });
  assert.equal(stopped.treaties.filter((treaty) => treaty.kind === 'trade').length, 0);
  assert.equal(stopped.routes[0]?.agreement?.enabled, false);
});

await test('built-in policy selects legal consent actions rather than the retired unilateral command', () => {
  const state = tradeFixture();
  const civilization = state.civilizations[0];
  assert.ok(civilization);
  civilization.researchTarget = 'agriculture';
  const proposal = chooseAction(state, 0);
  assert.equal(proposal.type, 'propose-trade');
  const offered = turn(state, proposal);
  const recipient = offered.civilizations[1];
  assert.ok(recipient);
  recipient.researchTarget = 'agriculture';
  const response = chooseAction(offered, 1);
  assert.equal(response.type, 'respond-trade');
  assert.ok(response.type === 'respond-trade' && response.accept);
});

await test('actual round resolution produces a valid blocked agreement when a participant cannot supply upkeep', () => {
  let state = waitForRound(agreementFixture(), 3);
  state = waitForSeat(state, DIRECTOR_SEAT);
  const owner = state.civilizations[0];
  const city = state.cities.find((candidate) => candidate.civId === 0);
  assert.ok(owner && city);
  owner.resources.energy = 0;
  city.damage = 100;
  const blocked = turn(state, { type: 'wait' });
  assert.equal(blocked.round, 4);
  assert.equal(blocked.routes[0]?.agreement?.blockedBy, 0);
  assert.equal(blocked.routes[0]?.agreement?.enabled, true);
  assert.equal(blocked.routes[0]?.agreement?.deliveryCount, 0);
  assert.equal(blocked.routes[0]?.active, false);
  assert.ok(isWorldState(blocked));
});

const independentEpoch = '2026-10-16T00:00:00.000Z';

function independentFixture(): WorldState {
  return createWorld(8, '2026-10-16T00:00:00.000Z', 'settlement-independent-1');
}

function independentCommand(
  state: WorldState,
  seat: number,
  timestamp = independentEpoch,
  action: GameAction = { type: 'wait' },
): Command {
  return { seat, expectedRevision: state.revision, timestamp, action };
}

await test('released independent actors act without a phase barrier or another civilization participating', () => {
  const state = independentFixture();
  const before = structuredClone(state);
  const first = applyCommand(state, independentCommand(state, 3));
  assert.equal(first.ok, true, first.error);
  const second = applyCommand(first.state, independentCommand(first.state, 1));
  assert.equal(second.ok, true, second.error);
  assert.deepEqual(state, before);
  assert.equal(second.state.revision, state.revision + 2);
  assert.equal(second.state.phase, state.phase);
  assert.equal(second.state.round, state.round);
  assert.equal(second.state.year, state.year);
  assert.deepEqual(second.state.civilizations, state.civilizations);
});

await test('per-actor tactical windows renew without idle credits or participation barriers', () => {
  const state = independentFixture();
  const first = applyCommand(state, independentCommand(state, 2));
  assert.equal(first.ok, true, first.error);
  const repeated = applyCommand(first.state, independentCommand(first.state, 2));
  assert.equal(repeated.ok, false);
  assert.equal(repeated.state, first.state);
  const later = new Date(Date.parse(independentEpoch) + TURN_RULES.tacticalWindowMs).toISOString();
  const next = applyCommand(first.state, independentCommand(first.state, 2, later));
  assert.equal(next.ok, true, next.error);
  assert.equal(next.state.round, state.round);
  assert.equal(applyCommand(next.state, independentCommand(next.state, 2, later)).ok, false);
  const muchLater = new Date(
    Date.parse(independentEpoch) + 100 * TURN_RULES.tacticalWindowMs,
  ).toISOString();
  const caughtUp = engine.catchUpStrategy(next.state, muchLater);
  assert.equal(caughtUp.ok, true, caughtUp.error);
  const resumed = applyCommand(caughtUp.state, independentCommand(caughtUp.state, 2, muchLater));
  assert.equal(resumed.ok, true, resumed.error);
  assert.equal(
    applyCommand(resumed.state, independentCommand(resumed.state, 2, muchLater)).ok,
    false,
  );
});

await test('refused independent commands preserve budgets and all world effects', () => {
  const state = independentFixture();
  for (const command of [
    { seat: 4, expectedRevision: state.revision, action: { type: 'wait' } } as Command,
    independentCommand(state, 4, 'not-a-time'),
    independentCommand(state, 4, '2026-10-15T23:59:59.000Z'),
    { ...independentCommand(state, 4), expectedRevision: state.revision + 1 },
    independentCommand(state, 4, independentEpoch, { type: 'build', project: 'missing' }),
  ]) {
    const before = structuredClone(state);
    const result = applyCommand(state, command);
    assert.equal(result.ok, false);
    assert.equal(result.state, state);
    assert.deepEqual(result.events, []);
    assert.deepEqual(state, before);
  }
  assert.equal(applyCommand(state, independentCommand(state, 4)).ok, true);
});

await test('strategic catchup produces shared economy without actor participation or calendar movement', () => {
  assert.equal(typeof engine.catchUpStrategy, 'function');
  const state = independentFixture();
  const timestamp = new Date(
    Date.parse(independentEpoch) + 2 * TURN_RULES.strategyIntervalMs,
  ).toISOString();
  const result = engine.catchUpStrategy(state, timestamp);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.round, state.round + 2);
  assert.equal(result.state.revision, state.revision + 2);
  assert.equal(result.state.independentTurns?.strategyTicks, 2);
  assert.equal(result.state.year, state.year);
  assert.equal(result.state.clockEpoch, state.clockEpoch);
  assert.equal(result.state.clockTicks, state.clockTicks);
  assert.equal(result.state.phase, state.phase);
  assert.notDeepEqual(result.state.civilizations, state.civilizations);
  const again = engine.catchUpStrategy(result.state, timestamp);
  assert.equal(again.ok, true, again.error);
  assert.equal(again.state, result.state);
  assert.deepEqual(again.events, []);
  assert.equal(again.remainingTicks, 0);
});

await test('missed strategic beats are bounded and frozen older action times cannot spend later production', () => {
  assert.equal(typeof engine.catchUpStrategy, 'function');
  const state = independentFixture();
  const due = 2 * TURN_RULES.maximumCatchupTicks;
  const timestamp = new Date(
    Date.parse(independentEpoch) + due * TURN_RULES.strategyIntervalMs,
  ).toISOString();
  const first = engine.catchUpStrategy(state, timestamp);
  assert.equal(first.ok, true, first.error);
  assert.equal(first.state.independentTurns?.strategyTicks, TURN_RULES.maximumCatchupTicks);
  assert.equal(first.remainingTicks, TURN_RULES.maximumCatchupTicks);
  const second = engine.catchUpStrategy(first.state, timestamp);
  assert.equal(second.ok, true, second.error);
  assert.equal(second.state.independentTurns?.strategyTicks, due);
  assert.equal(second.remainingTicks, 0);
  const old = applyCommand(second.state, independentCommand(second.state, 0, independentEpoch));
  assert.equal(old.ok, false);
  assert.equal(old.state, second.state);
  const current = applyCommand(second.state, independentCommand(second.state, 0, timestamp));
  assert.equal(current.ok, true, current.error);
});

await test('independent observations expose actor readiness while unused windows require no manufactured commands', () => {
  const initial = independentFixture();
  const state = applyCommand(initial, independentCommand(initial, 3)).state;
  assert.ok(isWorldState(state));
  const view = observe(state, 3, independentEpoch);
  assert.equal(view.activeSeat, null);
  assert.equal(view.admission?.mode, 'independent');
  assert.equal(view.admission?.nextActionAt, '2026-10-16T00:00:10.000Z');
  assert.equal(view.admission?.nextStrategyAt, '2026-10-16T00:01:00.000Z');
  assert.deepEqual(view.legalActions, []);
  assert.ok(legalActions(state, 3).length > 0);
  assert.ok(legalActions(state, 2, independentEpoch).length > 0);
  assert.deepEqual(legalActions(state, 6, independentEpoch), []);
  const afterIdle = engine.catchUpStrategy(state, '2026-10-16T00:03:00.000Z');
  assert.equal(afterIdle.ok, true, afterIdle.error);
  assert.ok(isWorldState(afterIdle.state));
  assert.equal(afterIdle.state.revision, state.revision + 3);
  assert.equal(afterIdle.state.round, state.round + 3);
  assert.deepEqual(
    afterIdle.state.independentTurns?.lastActionWindow,
    state.independentTurns?.lastActionWindow,
  );
  assert.deepEqual(
    afterIdle.state.independentTurns?.actionsInWindow,
    state.independentTurns?.actionsInWindow,
  );
  assert.equal(afterIdle.events.filter((event) => event.type === 'strategy-beat').length, 3);
  assert.equal(
    afterIdle.events.some((event) => event.type === 'action-held'),
    false,
  );
});

await test('future action orders cannot retroactively influence unrealized production', () => {
  const state = independentFixture();
  const before = structuredClone(state);
  const action: GameAction = { type: 'focus', focus: 'research' };
  const timestamp = '2026-10-16T00:02:00.000Z';
  const refused = applyCommand(state, independentCommand(state, 3, timestamp, action));
  assert.equal(refused.ok, false);
  assert.match(refused.error ?? '', /^strategy_catchup_required:/);
  assert.equal(refused.state, state);
  assert.deepEqual(state, before);
  assert.deepEqual(legalActions(state, 3, timestamp), []);
  const caughtUp = engine.catchUpStrategy(state, timestamp);
  assert.equal(caughtUp.ok, true, caughtUp.error);
  const accepted = applyCommand(
    caughtUp.state,
    independentCommand(caughtUp.state, 3, timestamp, action),
  );
  assert.equal(accepted.ok, true, accepted.error);
  assert.equal(accepted.state.round, caughtUp.state.round);
  assert.deepEqual(accepted.state.civilizations, caughtUp.state.civilizations);
  assert.ok(isWorldState(accepted.state));
});

await test('consensual trade ships on slower economy beats even when every actor remains idle', () => {
  const state = independentFixture();
  const recipe = TRADE_RECIPES.find(candidate => candidate.id === 'harvest-for-materials');
  assert.ok(recipe);
  const offered = applyCommand(
    state,
    independentCommand(state, 0, independentEpoch, {
      type: 'propose-trade',
      partner: 1,
      recipeId: recipe.id,
    }),
  );
  assert.equal(offered.ok, true, offered.error);
  const offer = offered.state.tradeOffers?.[0];
  assert.ok(offer);
  const accepted = applyCommand(
    offered.state,
    independentCommand(offered.state, 1, independentEpoch, {
      type: 'respond-trade',
      offerId: offer.id,
      accept: true,
    }),
  );
  assert.equal(accepted.ok, true, accepted.error);
  assert.equal(accepted.state.routes[0]?.agreement?.nextDeliveryRound, 4);
  assert.equal(accepted.state.routes[0]?.agreement?.deliveryCount, 0);
  const early = engine.catchUpStrategy(accepted.state, '2026-10-16T00:03:00.000Z');
  assert.equal(early.ok, true, early.error);
  assert.equal(early.state.routes[0]?.agreement?.deliveryCount, 0);
  const due = engine.catchUpStrategy(early.state, '2026-10-16T00:04:00.000Z');
  assert.equal(due.ok, true, due.error);
  assert.equal(due.state.routes[0]?.agreement?.deliveryCount, 1);
  assert.equal(due.state.routes[0]?.agreement?.nextDeliveryRound, 8);
  assert.equal(due.state.routes[0]?.active, true);
  assert.equal(due.events.filter((event) => event.type === 'trade-delivered').length, 1);
  for (const generated of [offered.state, accepted.state, early.state, due.state])
    assert.ok(isWorldState(generated));
});

await test('Director command budgets and shock cooldown advance independently of civilization participation', () => {
  const state = independentFixture();
  const shocked = applyCommand(
    state,
    independentCommand(state, DIRECTOR_SEAT, independentEpoch, {
      type: 'event',
      event: 'drought',
      target: 0,
    }),
  );
  assert.equal(shocked.ok, true, shocked.error);
  assert.equal(shocked.state.directorCooldown, 2);
  assert.equal(
    applyCommand(shocked.state, independentCommand(shocked.state, DIRECTOR_SEAT)).ok,
    false,
  );
  const later = '2026-10-16T00:00:10.000Z';
  assert.ok(
    legalActions(shocked.state, DIRECTOR_SEAT, later).every(
      (choice) => choice.action.type !== 'event',
    ),
  );
  const next = engine.catchUpStrategy(shocked.state, '2026-10-16T00:01:00.000Z');
  assert.equal(next.state.directorCooldown, 1);
  const finished = engine.catchUpStrategy(next.state, '2026-10-16T00:02:00.000Z');
  assert.equal(finished.state.directorCooldown, 0);
  assert.ok(
    legalActions(finished.state, DIRECTOR_SEAT, '2026-10-16T00:02:00.000Z').some(
      (choice) => choice.action.type === 'event',
    ),
  );
  assert.ok(isWorldState(finished.state));
});

await test('protected Director shocks cannot alter unrealized strategic history', () => {
  const state = independentFixture();
  for (const kind of ['event', 'review'] as const) {
    const command = {
      expectedRevision: state.revision,
      kind,
      intervalId: `chronology-${kind}`,
      timestamp: '2026-10-16T00:02:00.000Z',
      event: 'drought',
      target: 0,
    } as const;
    const result = applyDirectorTick(state, command);
    assert.equal(result.ok, false);
    assert.equal(result.state, state);
    assert.deepEqual(result.events, []);
    assert.match(result.error ?? '', /^strategy_catchup_required:/);
    const caughtUp = engine.catchUpStrategy(state, command.timestamp);
    assert.equal(caughtUp.ok, true, caughtUp.error);
    const accepted = applyDirectorTick(caughtUp.state, { ...command, expectedRevision: caughtUp.state.revision });
    assert.equal(accepted.ok, true, accepted.error);
    assert.equal(accepted.state.round, caughtUp.state.round);
    assert.deepEqual(accepted.state.independentTurns, caughtUp.state.independentTurns);
    assert.ok(isWorldState(accepted.state));
  }
});

function restartWorld(state: WorldState): WorldState {
  const parsed: unknown = JSON.parse(JSON.stringify(state));
  assert.ok(isWorldState(parsed));
  return parsed;
}

await test('mixed independent actor and strategic transitions reproduce exact states after JSON restart', () => {
  const initial = independentFixture();
  let live = initial;
  let replay = restartWorld(initial);
  for (let beat = 0; beat < 12; beat += 1) {
    const timestamp = new Date(
      Date.parse(independentEpoch) + beat * TURN_RULES.strategyIntervalMs,
    ).toISOString();
    const first = engine.catchUpStrategy(live, timestamp);
    const repeated = engine.catchUpStrategy(replay, timestamp);
    assert.equal(first.ok, true, first.error);
    assert.deepEqual(first, repeated);
    live = first.state;
    replay = restartWorld(repeated.state);
    for (const seat of [3, 1, 4]) {
      const command = independentCommand(
        live,
        seat,
        timestamp,
        chooseAction(live, seat, 'balanced', timestamp),
      );
      const result = applyCommand(live, command);
      const replayed = applyCommand(replay, command);
      assert.equal(result.ok, true, result.error);
      assert.deepEqual(result, replayed);
      live = result.state;
      replay = restartWorld(replayed.state);
      assert.ok(isWorldState(live));
    }
  }
  assert.equal(live.round, initial.round + 11);
  assert.equal(live.revision, initial.revision + 47);
  assert.equal(live.year, initial.year);
  assert.equal(live.independentTurns?.lastActionWindow[0], -1);
  assert.equal(live.independentTurns?.lastActionWindow[2], -1);
  assert.equal(live.independentTurns?.lastActionWindow[DIRECTOR_SEAT], -1);
});

function plannedFixture(): WorldState {
  return createWorld(8, '2026-10-16T00:00:00.000Z', 'settlement-plans-1');
}

function plannedCommand(state: WorldState, seat = 0): Command {
  return {
    ...independentCommand(state, seat, independentEpoch, { type: 'focus', focus: 'industry' }),
    observedRevision: 0,
    plan: [
      { action: { type: 'focus', focus: 'industry' }, reason: 'Prepare materials for future building' },
      { action: { type: 'focus', focus: 'growth' }, reason: 'Then review food needs' },
    ],
  };
}

await test('real accepted commands complete the attached head and retain original context without autoexecuting follow-up', () => {
  const state = plannedFixture();
  const command = plannedCommand(state);
  const result = applyCommand(state, command);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.actionOutcome?.status, 'completed');
  assert.equal(result.actionOutcome?.code, 'action_completed');
  const plan = result.state.actionPlans?.[0];
  assert.ok(plan);
  assert.equal(plan.observedRevision, 0);
  assert.equal(plan.committedRevision, state.revision + 1);
  assert.deepEqual(plan.items.map((item) => item.status), ['completed', 'needs-review']);
  assert.equal(result.state.cities.find((city) => city.civId === 0)?.focus, 'industry');
  assert.equal(result.state.revision, state.revision + 1);
  assert.ok(isWorldState(result.state));
  const head = command.plan?.[0];
  assert.ok(head);
  head.reason = 'Changed outside the committed world';
  assert.notEqual(plan.items[0]?.reason, head.reason);
});

await test('plan observation derives readiness without mutating canonical slots or admitting actions', () => {
  const result = applyCommand(plannedFixture(), plannedCommand(plannedFixture()));
  assert.equal(result.ok, true, result.error);
  const original = structuredClone(result.state);
  const now = observe(result.state, 0, independentEpoch);
  assert.equal(now.actionPlan?.items[1]?.status, 'blocked');
  const later = observe(result.state, 0, '2026-10-16T00:00:10.000Z');
  assert.equal(later.actionPlan?.items[1]?.status, 'ready');
  assert.equal(later.actionPlan?.items[0]?.status, 'completed');
  assert.equal(observe(result.state, 1, '2026-10-16T00:00:10.000Z').actionPlan, null);
  const observedItem = later.actionPlan?.items[1];
  assert.ok(observedItem);
  observedItem.reason = 'External mutation';
  assert.deepEqual(result.state, original);
  const caught = engine.catchUpStrategy(result.state, '2026-10-16T00:01:00.000Z');
  assert.equal(caught.ok, true, caught.error);
  assert.deepEqual(caught.state.actionPlans, original.actionPlans);
  assert.equal(caught.state.cities.find((city) => city.civId === 0)?.focus, 'industry');
});

await test('malformed, mismatched, stale, illegal and budget-blocked plans never alter world or prior intent', () => {
  const state = plannedFixture();
  const first = applyCommand(state, plannedCommand(state));
  assert.equal(first.ok, true, first.error);
  const current = first.state;
  const valid = { ...plannedCommand(current), timestamp: '2026-10-16T00:00:10.000Z', action: { type: 'wait' }, plan: [{ action: { type: 'wait' }, reason: 'Wait for circumstances' }] } satisfies Command;
  const cases: Array<[Command, string, string]> = [
    [{ ...valid, plan: [{ action: { type: 'wait' }, reason: '' }] }, 'invalid_plan', 'failed'],
    [{ ...valid, plan: [{ action: { type: 'focus', focus: 'culture' }, reason: 'Mismatch' }] }, 'plan_head_mismatch', 'failed'],
    [{ ...valid, observedRevision: current.revision + 1 }, 'invalid_plan_context', 'failed'],
    [{ ...valid, expectedRevision: current.revision - 1 }, 'invalid_command', 'failed'],
    [{ ...valid, timestamp: independentEpoch }, 'action_admission_blocked', 'blocked'],
    [{ ...valid, timestamp: '2026-10-16T00:01:00.000Z' }, 'strategy_catchup_required', 'blocked'],
    [{ ...valid, action: { type: 'build', project: 'missing' }, plan: [{ action: { type: 'build', project: 'missing' }, reason: 'Impossible' }] }, 'illegal_action', 'failed'],
  ];
  const original = structuredClone(current);
  for (const [command, code, status] of cases) {
    const refused = applyCommand(current, command);
    assert.equal(refused.ok, false, code);
    assert.equal(refused.state, current, code);
    assert.deepEqual(refused.events, []);
    assert.equal(refused.actionOutcome?.code, code);
    assert.equal(refused.actionOutcome?.status, status);
    assert.equal(refused.actionOutcome?.reason, refused.error);
    assert.deepEqual(current, original);
  }
});

await test('old releases reject attached plans but preserve ordinary direct-command result and state shapes', () => {
  const state = independentFixture();
  const planned = applyCommand(state, plannedCommand(state));
  assert.equal(planned.ok, false);
  assert.equal(planned.state, state);
  assert.equal(planned.actionOutcome?.code, 'plan_not_released');
  for (const plan of [undefined, []]) {
    const command: Command = { ...independentCommand(state, 0), ...(plan === undefined ? {} : { plan }) };
    const direct = applyCommand(state, command);
    assert.equal(direct.ok, true, direct.error);
    assert.equal(Object.hasOwn(direct, 'actionOutcome'), false);
    assert.equal(Object.hasOwn(direct.state, 'actionPlans'), false);
  }
});

await test('accepted direct commands clear only their own prior plan while peer records remain intact', () => {
  const first = applyCommand(plannedFixture(), plannedCommand(plannedFixture()));
  assert.equal(first.ok, true, first.error);
  const peer = applyCommand(first.state, plannedCommand(first.state, 1));
  assert.equal(peer.ok, true, peer.error);
  for (const plan of [undefined, []]) {
    const command: Command = { ...independentCommand(peer.state, 0, '2026-10-16T00:00:10.000Z'), ...(plan === undefined ? {} : { plan }) };
    const cleared = applyCommand(peer.state, command);
    assert.equal(cleared.ok, true, cleared.error);
    assert.equal(cleared.state.actionPlans?.[0], null);
    assert.deepEqual(cleared.state.actionPlans?.[1], peer.state.actionPlans?.[1]);
    assert.equal(cleared.state.actionPlans?.length, DIRECTOR_SEAT + 1);
    assert.equal(cleared.actionOutcome?.status, 'completed');
    assert.ok(isWorldState(cleared.state));
  }
});

await test('explicit plan replacement and clearing reproduce identical engine state across JSON restart', () => {
  let live = plannedFixture();
  let replay = restartWorld(live);
  const commands: Command[] = [plannedCommand(live)];
  for (let index = 0; index < 3; index += 1) {
    const command = commands[index];
    assert.ok(command);
    const result = applyCommand(live, command);
    const replayed = applyCommand(replay, structuredClone(command));
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result, replayed);
    live = result.state;
    replay = restartWorld(replayed.state);
    if (index === 0) commands.push({ ...independentCommand(live, 0, '2026-10-16T00:00:10.000Z', { type: 'focus', focus: 'growth' }), observedRevision: live.revision, plan: [{ action: { type: 'focus', focus: 'growth' }, reason: 'Act after reviewing food reserves' }] });
    if (index === 1) {
      assert.equal(live.actionPlans?.[0]?.items.length, 1);
      commands.push(independentCommand(live, 0, '2026-10-16T00:00:20.000Z'));
    }
  }
  assert.equal(live.actionPlans?.[0], null);
  assert.equal(live.revision, plannedFixture().revision + 3);
  assert.equal(live.cities.find((city) => city.civId === 0)?.focus, 'growth');
});

function productionFixture(): WorldState {
  return createWorld(8, '2026-10-16T00:00:00.000Z', 'settlement-production-1');
}

function equippedProduction(): WorldState {
  const state = productionFixture();
  const city = state.cities[0];
  const civilization = state.civilizations[0];
  assert.ok(city && civilization);
  city.buildings = ['irrigation', 'kiln'];
  city.buildingOperations = { irrigation: { enabled: true, lastResult: null }, kiln: { enabled: true, lastResult: null } };
  civilization.technologies.push('agriculture', 'water-management', 'kiln-firing');
  return state;
}

await test('production release is explicit and each research branch unlocks only its paid building', () => {
  for (const [technology, project, other] of [['water-management', 'irrigation', 'kiln'], ['kiln-firing', 'kiln', 'irrigation']]) {
    assert.ok(technology && project && other);
    let state = productionFixture();
    const civilization = state.civilizations[0];
    assert.ok(civilization);
    civilization.technologies.push('agriculture');
    civilization.resources.science = 16;
    const selected = applyCommand(state, independentCommand(state, 0, independentEpoch, { type: 'research', technology }));
    assert.equal(selected.ok, true, selected.error);
    const worked = engine.catchUpStrategy(selected.state, '2026-10-16T00:01:00.000Z');
    assert.equal(worked.ok, true, worked.error);
    state = worked.state;
    assert.ok(state.civilizations[0]?.technologies.includes(technology));
    assert.ok(legalActions(state, 0, '2026-10-16T00:01:00.000Z').some(({ action }) => action.type === 'build' && action.project === project));
    assert.ok(!legalActions(state, 0, '2026-10-16T00:01:00.000Z').some(({ action }) => action.type === 'build' && action.project === other));
    const built = applyCommand(state, independentCommand(state, 0, '2026-10-16T00:01:00.000Z', { type: 'build', project }));
    assert.equal(built.ok, true, built.error);
    assert.deepEqual(built.state.cities[0]?.buildingOperations?.[project], { enabled: true, lastResult: null });
    assert.ok(isWorldState(built.state));
  }
  const old = independentFixture();
  assert.ok(!legalActions(old, 0, independentEpoch).some(({ action }) => action.type === 'research' && action.technology === 'water-management'));
  assert.equal(Object.hasOwn(observe(old, 0), 'buildingRecipes'), false);
});

await test('paid production uses opening stocks and never funds a recipe from same-beat outputs', () => {
  const state = equippedProduction();
  const civilization = state.civilizations[0];
  const city = state.cities[0];
  assert.ok(civilization && city);
  civilization.resources.materials = 0;
  civilization.resources.energy = 2;
  resolveEconomy(state, []);
  assert.deepEqual(city.buildingOperations?.irrigation?.lastResult, { round: state.round, status: 'blocked', paid: {}, produced: {}, shortages: [{ resource: 'materials', required: 1, available: 0 }] });
  assert.equal(city.buildingOperations?.kiln?.lastResult?.status, 'operated');
  assert.deepEqual(city.buildingOperations?.kiln?.lastResult?.paid, { energy: 2 });
  assert.ok((city.buildingOperations?.kiln?.lastResult?.produced.materials ?? 0) > 0);
  resolveEconomy(state, []);
  assert.equal(city.buildingOperations?.irrigation?.lastResult?.status, 'operated');
  const empty = equippedProduction();
  const emptyCivilization = empty.civilizations[0];
  assert.ok(emptyCivilization);
  emptyCivilization.resources.energy = 0;
  empty.cities[0]?.buildings.push('workshop');
  resolveEconomy(empty, []);
  assert.equal(empty.cities[0]?.buildingOperations?.kiln?.lastResult?.status, 'blocked');
  assert.deepEqual(empty.cities[0]?.buildingOperations?.kiln?.lastResult?.paid, {});
});

await test('recipe allocation is stable by city identity and paused recipes leave opening inputs for peers', () => {
  const state = equippedProduction();
  const first = state.cities[0];
  const civilization = state.civilizations[0];
  assert.ok(first && civilization);
  first.id = 'recipe-a';
  const second = structuredClone(first);
  second.id = 'recipe-b';
  state.cities.push(second);
  civilization.resources.energy = 2;
  civilization.resources.materials = 1;
  const reversed = structuredClone(state);
  reversed.cities.reverse();
  for (const world of [state, reversed]) resolveEconomy(world, []);
  for (const city of [first, second]) {
    assert.deepEqual(city.buildingOperations, reversed.cities.find((candidate) => candidate.id === city.id)?.buildingOperations);
  }
  assert.equal(first.buildingOperations?.kiln?.lastResult?.status, 'operated');
  assert.equal(second.buildingOperations?.kiln?.lastResult?.status, 'blocked');
  const operation = first.buildingOperations?.kiln;
  assert.ok(operation);
  operation.enabled = false;
  civilization.resources.energy = 2;
  resolveEconomy(state, []);
  assert.deepEqual(operation.lastResult, { round: state.round, status: 'paused', paid: {}, produced: {}, shortages: [] });
  assert.equal(second.buildingOperations?.kiln?.lastResult?.status, 'operated');
});

await test('pause and resume are exact paid-building actions with preserved history and zero-write refusals', () => {
  const state = equippedProduction();
  resolveEconomy(state, []);
  const city = state.cities[0];
  assert.ok(city);
  const action: GameAction = { type: 'set-building-operation', cityId: city.id, buildingId: 'kiln', enabled: false };
  const stopped = applyCommand(state, independentCommand(state, 0, independentEpoch, action));
  assert.equal(stopped.ok, true, stopped.error);
  assert.equal(stopped.state.cities[0]?.buildingOperations?.kiln?.enabled, false);
  assert.deepEqual(stopped.state.cities[0]?.buildingOperations?.kiln?.lastResult, city.buildingOperations?.kiln?.lastResult);
  const snapshot = structuredClone(stopped.state);
  for (const invalid of [action, { ...action, cityId: 'missing' }, { ...action, buildingId: 'farm' }]) {
    const result = applyCommand(stopped.state, independentCommand(stopped.state, 0, '2026-10-16T00:00:10.000Z', invalid));
    assert.equal(result.ok, false);
    assert.equal(result.state, stopped.state);
    assert.deepEqual(result.state, snapshot);
  }
  const foreign = applyCommand(state, independentCommand(state, 1, independentEpoch, action));
  assert.equal(foreign.ok, false);
  assert.equal(foreign.state, state);
  const resumed = applyCommand(stopped.state, independentCommand(stopped.state, 0, '2026-10-16T00:00:10.000Z', { ...action, enabled: true }));
  assert.equal(resumed.ok, true, resumed.error);
});

await test('operation observations are detached and mixed action and strategy replay preserves exact receipts', () => {
  let state = equippedProduction();
  let replay = restartWorld(state);
  const city = state.cities[0];
  assert.ok(city);
  const observation = observe(state, 0, independentEpoch);
  assert.deepEqual(observation.buildingRecipes, [
    { buildingId: 'irrigation', inputs: { materials: 1 }, outputs: { food: 5 } },
    { buildingId: 'kiln', inputs: { energy: 2 }, outputs: { materials: 4 } },
  ]);
  const recipe = observation.buildingRecipes?.[0];
  assert.ok(recipe);
  recipe.inputs.materials = 999;
  assert.equal(observe(state, 0).buildingRecipes?.[0]?.inputs.materials, 1);
  for (const [index, enabled] of [false, true].entries()) {
    const time = `2026-10-16T00:0${index}:10.000Z`;
    const action: GameAction = { type: 'set-building-operation', cityId: city.id, buildingId: 'kiln', enabled };
    const command = independentCommand(state, 0, time, action);
    const accepted = applyCommand(state, command);
    assert.equal(accepted.ok, true, accepted.error);
    assert.deepEqual(accepted, applyCommand(replay, structuredClone(command)));
    state = accepted.state;
    replay = restartWorld(state);
    const boundary = `2026-10-16T00:0${index + 1}:00.000Z`;
    const worked = engine.catchUpStrategy(state, boundary);
    assert.equal(worked.ok, true, worked.error);
    assert.deepEqual(worked, engine.catchUpStrategy(replay, boundary));
    state = worked.state;
    replay = restartWorld(state);
    assert.deepEqual(engine.catchUpStrategy(state, boundary).state, state);
  }
});

await test('generic full-vector input allocation is atomic and a blocked recipe leaves every stock for later recipes', () => {
  const kiln = BUILDINGS.find((building) => building.id === 'kiln');
  assert.ok(kiln);
  const authored = kiln.operatingInputs;
  try {
    kiln.operatingInputs = { energy: 2, credits: 3 };
    const state = equippedProduction();
    const first = state.cities[0];
    const civilization = state.civilizations[0];
    assert.ok(first && civilization);
    first.id = 'a';
    civilization.resources.energy = 2;
    civilization.resources.credits = 2;
    const baseline = structuredClone(state);
    const operation = baseline.cities[0]?.buildingOperations?.kiln;
    assert.ok(operation);
    operation.enabled = false;
    resolveEconomy(state, []);
    resolveEconomy(baseline, []);
    assert.deepEqual(first.buildingOperations?.kiln?.lastResult, { round: state.round, status: 'blocked', paid: {}, produced: {}, shortages: [{ resource: 'credits', required: 3, available: 2 }] });
    assert.deepEqual(civilization.resources, baseline.civilizations[0]?.resources);
    const funded = equippedProduction();
    const fundedCivilization = funded.civilizations[0];
    assert.ok(fundedCivilization);
    fundedCivilization.resources.energy = 2;
    fundedCivilization.resources.credits = 3;
    resolveEconomy(funded, []);
    assert.deepEqual(funded.cities[0]?.buildingOperations?.kiln?.lastResult?.paid, { energy: 2, credits: 3 });
  } finally {
    if (authored === undefined) delete kiln.operatingInputs;
    else kiln.operatingInputs = authored;
  }
});

await test('legacy aggregate production rounding survives fractional productivity and paid receipts reconcile exact extra yields', () => {
  for (const wellbeing of [23, 57.3, 99]) {
    const state = productionFixture();
    const city = state.cities[0];
    const civilization = state.civilizations[0];
    assert.ok(city && civilization);
    city.buildings = ['workshop', 'farm'];
    city.wellbeing = wellbeing;
    city.damage = 17.7;
    city.infrastructure = 2.3;
    civilization.resources.food = 0;
    const before = structuredClone(civilization.resources);
    const productivity = (0.5 + wellbeing / 100) * (1 - city.damage / 100) * (1 + city.infrastructure / 10);
    const site = state.tiles.find((tile) => tile.id === city.tileId);
    const expected = { ...before };
    const focus: Partial<Resources> = ECONOMY_RULES.focusProduction[city.focus];
    for (const resource of RESOURCE_IDS) {
      const raw = (ECONOMY_RULES.baseProduction[resource] ?? 0) + (focus[resource] ?? 0)
        + city.buildings.reduce((sum, id) => sum + (BUILDINGS.find((building) => building.id === id)?.production[resource] ?? 0), 0)
        + (site?.resource === resource ? 1 : 0);
      expected[resource] = Math.round((before[resource] + Math.round(raw * productivity * 100) / 100) * 100) / 100;
    }
    expected.food = Math.round(Math.max(0, expected.food - Math.round(city.population * ECONOMY_RULES.populationFoodUpkeep * 100) / 100) * 100) / 100;
    const paid = structuredClone(state);
    const paidCity = paid.cities[0];
    assert.ok(paidCity);
    paidCity.buildings.push('kiln');
    paidCity.buildingOperations = { kiln: { enabled: true, lastResult: null } };
    resolveEconomy(state, []);
    resolveEconomy(paid, []);
    assert.deepEqual(civilization.resources, expected);
    const receipt = paidCity.buildingOperations.kiln?.lastResult;
    assert.equal(receipt?.status, 'operated');
    for (const resource of RESOURCE_IDS) {
      const actualDifference: number = Math.round(((paid.civilizations[0]?.resources[resource] ?? 0) - civilization.resources[resource]) * 100) / 100;
      assert.equal(actualDifference, Math.round(((receipt?.produced[resource] ?? 0) - (receipt?.paid[resource] ?? 0)) * 100) / 100);
    }
  }
});

await test('zero-productivity paid recipes still pay complete inputs and report empty actual outputs', () => {
  const state = equippedProduction();
  const city = state.cities[0];
  assert.ok(city);
  city.damage = 100;
  resolveEconomy(state, []);
  assert.deepEqual(city.buildingOperations?.kiln?.lastResult?.produced, {});
  assert.deepEqual(city.buildingOperations?.kiln?.lastResult?.paid, { energy: 2 });
  assert.equal(city.buildingOperations?.kiln?.lastResult?.status, 'operated');
});

await test('an earlier blocked multi-input recipe does not reserve scarce inputs from a later funded recipe', () => {
  const irrigation = BUILDINGS.find((building) => building.id === 'irrigation');
  assert.ok(irrigation);
  const authored = irrigation.operatingInputs;
  try {
    irrigation.operatingInputs = { energy: 1, credits: 3 };
    const state = equippedProduction();
    const civilization = state.civilizations[0];
    assert.ok(civilization);
    civilization.resources.energy = 2;
    civilization.resources.credits = 2;
    resolveEconomy(state, []);
    assert.equal(state.cities[0]?.buildingOperations?.irrigation?.lastResult?.status, 'blocked');
    assert.deepEqual(state.cities[0]?.buildingOperations?.irrigation?.lastResult?.paid, {});
    assert.equal(state.cities[0]?.buildingOperations?.kiln?.lastResult?.status, 'operated');
    assert.deepEqual(state.cities[0]?.buildingOperations?.kiln?.lastResult?.paid, { energy: 2 });
  } finally {
    if (authored === undefined) delete irrigation.operatingInputs;
    else irrigation.operatingInputs = authored;
  }
});

function frontierFixture(): WorldState {
  return createWorld(8, '2026-10-16T00:00:00.000Z', 'settlement-frontiers-1');
}

function frontierAction(state: WorldState, seat = 0, timestamp = independentEpoch): Extract<GameAction, { type: 'settle' }> {
  const choice = legalActions(state, seat, timestamp).find(({ action }) => action.type === 'settle');
  assert.ok(choice && choice.action.type === 'settle', 'A funded population-six city must offer a nearby frontier');
  return choice.action;
}

await test('frontier founding transfers three people from the explicit source and pays exactly once without rewriting the map', () => {
  const state = frontierFixture();
  const source = state.cities[0];
  const civilization = state.civilizations[0];
  assert.ok(source && civilization);
  source.focus = 'culture';
  const action = frontierAction(state);
  assert.equal(action.sourceCityId, source.id);
  const before = structuredClone(state);
  const population = state.cities.reduce((sum, city) => sum + city.population, 0);
  const result = applyCommand(state, independentCommand(state, 0, independentEpoch, action));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(state, before);
  assert.equal(result.state.cities.reduce((sum, city) => sum + city.population, 0), population);
  assert.equal(result.state.cities.find((city) => city.id === source.id)?.population, 3);
  const founded = result.state.cities.at(-1);
  assert.ok(founded);
  assert.equal(founded.id, `city-0-${state.revision + 1}`);
  assert.equal(founded.population, 3);
  assert.equal(founded.focus, 'culture');
  assert.deepEqual(founded.buildings, []);
  const costs: Partial<Resources> = ECONOMY_RULES.settle.cost;
  for (const resource of RESOURCE_IDS) {
    assert.equal(result.state.civilizations[0]?.resources[resource], civilization.resources[resource] - (costs[resource] ?? 0));
  }
  assert.deepEqual(result.state.tiles.map((tile) => ({ ...tile, owner: null })), state.tiles.map((tile) => ({ ...tile, owner: null })));
  assert.equal(result.state.tiles.find((tile) => tile.id === action.tileId)?.owner, 0);
  assert.ok(isWorldState(result.state));
  assert.deepEqual(applyCommand(restartWorld(state), structuredClone(independentCommand(state, 0, independentEpoch, action))), result);
});

await test('missing, foreign, depleted sources and unaffordable or occupied frontiers refuse without any effect', () => {
  const state = frontierFixture();
  const action = frontierAction(state);
  const foreign = state.cities.find((city) => city.civId === 1);
  assert.ok(foreign);
  const cases: Array<{ state: WorldState; action: GameAction }> = [
    { state, action: { type: 'settle', tileId: action.tileId } },
    { state, action: { ...action, sourceCityId: 'missing' } },
    { state, action: { ...action, sourceCityId: foreign.id } },
  ];
  for (const mutation of ['population', 'cost', 'occupied'] as const) {
    const altered = structuredClone(state);
    const source = altered.cities.find((city) => city.id === action.sourceCityId);
    const civilization = altered.civilizations[0];
    const site = altered.tiles.find((tile) => tile.id === action.tileId);
    assert.ok(source && civilization && site);
    if (mutation === 'population') source.population = 5;
    if (mutation === 'cost') civilization.resources.materials = 11;
    if (mutation === 'occupied') site.owner = 1;
    cases.push({ state: altered, action });
  }
  for (const entry of cases) {
    const before = structuredClone(entry.state);
    const result = applyCommand(entry.state, independentCommand(entry.state, 0, independentEpoch, entry.action));
    assert.equal(result.ok, false);
    assert.equal(result.state, entry.state);
    assert.deepEqual(result.events, []);
    assert.deepEqual(entry.state, before);
  }
});

await test('settlers inherit the named source rather than first-city focus and a depleted source cannot found twice', () => {
  const state = frontierFixture();
  const first = applyCommand(state, independentCommand(state, 0, independentEpoch, frontierAction(state)));
  assert.equal(first.ok, true, first.error);
  const capital = first.state.cities[0];
  const source = first.state.cities.at(-1);
  assert.ok(capital && source);
  capital.focus = 'industry';
  source.population = 6;
  source.focus = 'diplomacy';
  const civilization = first.state.civilizations[0];
  assert.ok(civilization);
  civilization.resources = { ...civilization.resources, food: 100, materials: 100, credits: 100 };
  const action = frontierAction(first.state, 0, '2026-10-16T00:00:10.000Z');
  assert.equal(action.sourceCityId, source.id);
  const second = applyCommand(first.state, independentCommand(first.state, 0, '2026-10-16T00:00:10.000Z', action));
  assert.equal(second.ok, true, second.error);
  assert.equal(second.state.cities.at(-1)?.focus, 'diplomacy');
  assert.equal(second.state.cities.find((city) => city.id === source.id)?.population, 3);
  assert.ok(!legalActions(second.state, 0, '2026-10-16T00:00:20.000Z').some(({ action: next }) => next.type === 'settle'));
});

function roundFrontierAmount(value: number): number { return Math.round(value * 100) / 100; }

await test('terrain production is additive with deposits and productivity under fresh terrain-production rules', () => {
  for (const [terrain, resource] of [['grassland', 'food'], ['forest', 'materials']] as const) {
    const old = productionFixture();
    const city = old.cities[0];
    assert.ok(city);
    city.wellbeing = 40;
    city.damage = 20;
    city.infrastructure = 2;
    const site = old.tiles.find((tile) => tile.id === city.tileId);
    assert.ok(site);
    site.terrain = terrain;
    site.resource = resource;
    const current = frontierFixture();
    Object.assign(current.cities[0]!, { wellbeing: city.wellbeing, damage: city.damage, infrastructure: city.infrastructure });
    const currentSite = current.tiles.find(tile => tile.id === city.tileId);
    assert.ok(currentSite);
    Object.assign(currentSite, { terrain, resource });
    const noDeposit = structuredClone(current);
    const plain = noDeposit.tiles.find((tile) => tile.id === city.tileId);
    assert.ok(plain);
    plain.resource = null;
    const productivity = (0.5 + city.wellbeing / 100) * (1 - city.damage / 100) * (1 + city.infrastructure / 10);
    const focus: Partial<Resources> = ECONOMY_RULES.focusProduction[city.focus];
    const raw = ECONOMY_RULES.baseProduction[resource] + (focus[resource] ?? 0);
    resolveEconomy(old, []);
    resolveEconomy(current, []);
    resolveEconomy(noDeposit, []);
    assert.equal(roundFrontierAmount((current.civilizations[0]?.resources[resource] ?? 0) - (old.civilizations[0]?.resources[resource] ?? 0)), roundFrontierAmount(roundFrontierAmount((raw + 3) * productivity) - roundFrontierAmount((raw + 1) * productivity)));
    assert.equal(roundFrontierAmount((current.civilizations[0]?.resources[resource] ?? 0) - (noDeposit.civilizations[0]?.resources[resource] ?? 0)), roundFrontierAmount(roundFrontierAmount((raw + 3) * productivity) - roundFrontierAmount((raw + 2) * productivity)));
  }
  const old = productionFixture();
  assert.ok(!legalActions(old, 0, independentEpoch).some(({ action }) => action.type === 'settle'));
});

await test('two civilizations contesting one frontier preserve the losing source, costs and admission ledger', () => {
  const state = frontierFixture();
  const first = frontierAction(state);
  const target = state.tiles.find((tile) => tile.id === first.tileId);
  assert.ok(target);
  const approach = state.tiles.find((tile) => tile.owner === null && tile.id !== target.id && hexDistance(tile, target) <= 2 && !state.cities.some((city) => city.tileId === tile.id));
  assert.ok(approach);
  approach.owner = 1;
  const second = legalActions(state, 1, independentEpoch).find(({ action }) => action.type === 'settle' && action.tileId === target.id)?.action;
  assert.ok(second && second.type === 'settle');
  const beforePopulation = state.cities.reduce((sum, city) => sum + city.population, 0);
  const won = applyCommand(state, independentCommand(state, 0, independentEpoch, first));
  assert.equal(won.ok, true, won.error);
  const snapshot = structuredClone(won.state);
  const lost = applyCommand(won.state, independentCommand(won.state, 1, independentEpoch, second));
  assert.equal(lost.ok, false);
  assert.equal(lost.state, won.state);
  assert.deepEqual(lost.state, snapshot);
  assert.equal(lost.state.cities.reduce((sum, city) => sum + city.population, 0), beforePopulation);
  assert.equal(lost.state.cities.filter((city) => city.tileId === target.id).length, 1);
  assert.ok(isWorldState(lost.state));
});

await test('frontier choices retain territory reach and city spacing without a new source-distance restriction', () => {
  const state = frontierFixture();
  const choices = legalActions(state, 0, independentEpoch).filter(({ action }) => action.type === 'settle');
  assert.ok(choices.length > 0);
  for (const { action } of choices) {
    assert.ok(action.type === 'settle');
    const site = state.tiles.find((tile) => tile.id === action.tileId);
    assert.ok(site);
    assert.equal(site.owner, null);
    assert.ok(site.terrain !== 'ocean' && site.terrain !== 'mountain');
    assert.ok(state.tiles.some((tile) => tile.owner === 0 && hexDistance(tile, site) <= 2));
    assert.ok(state.cities.every((city) => {
      const existing = state.tiles.find((tile) => tile.id === city.tileId);
      return existing !== undefined && hexDistance(existing, site) >= 2;
    }));
  }
  const source = state.cities.find((city) => city.civId === 0);
  assert.ok(source);
  const sourceSite = state.tiles.find((tile) => tile.id === source.tileId);
  assert.ok(sourceSite);
  const distant = state.tiles.find((tile) => tile.owner === null && tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && hexDistance(tile, sourceSite) > 2 && state.cities.every((city) => {
    const existing = state.tiles.find((candidate) => candidate.id === city.tileId);
    return existing !== undefined && hexDistance(existing, tile) >= 2;
  }));
  assert.ok(distant);
  const approach = state.tiles.find((tile) => tile.owner === null && tile.id !== distant.id && hexDistance(tile, distant) <= 2);
  assert.ok(approach);
  approach.owner = 0;
  assert.ok(legalActions(state, 0, independentEpoch).some(({ action }) => action.type === 'settle' && action.tileId === distant.id && action.sourceCityId === source.id));
});

await test('new terrain materials cannot retroactively fund an opening-stock recipe', () => {
  const state = frontierFixture();
  const city = state.cities[0];
  const civilization = state.civilizations[0];
  assert.ok(city && civilization);
  const site = state.tiles.find((tile) => tile.id === city.tileId);
  assert.ok(site);
  site.terrain = 'forest';
  civilization.resources.materials = 0;
  city.buildings = ['irrigation'];
  city.buildingOperations = { irrigation: { enabled: true, lastResult: null } };
  resolveEconomy(state, []);
  assert.equal(city.buildingOperations.irrigation?.lastResult?.status, 'blocked');
  assert.deepEqual(city.buildingOperations.irrigation?.lastResult?.paid, {});
  assert.ok(civilization.resources.materials > 0);
});

await test('compact frontier choices expose actual terrain, deposit and base yields from candidate sites', () => {
  const state = frontierFixture();
  const candidates = legalActions(state, 0, independentEpoch).filter(({ action }) => action.type === 'settle');
  const first = candidates[0]?.action;
  const second = candidates.find(({ action }) => action.type === 'settle' && first?.type === 'settle' && action.tileId !== first.tileId)?.action;
  assert.ok(first?.type === 'settle' && second?.type === 'settle');
  const grassland = state.tiles.find((tile) => tile.id === first.tileId);
  const forest = state.tiles.find((tile) => tile.id === second.tileId);
  assert.ok(grassland && forest);
  grassland.terrain = 'grassland';
  grassland.resource = 'materials';
  forest.terrain = 'forest';
  forest.resource = null;
  const observed = observe(state, 0, independentEpoch);
  const grassChoice = observed.legalActions.find(({ action }) => action.type === 'settle' && action.tileId === grassland.id);
  const forestChoice = observed.legalActions.find(({ action }) => action.type === 'settle' && action.tileId === forest.id);
  assert.ok(grassChoice && forestChoice);
  assert.match(grassChoice.reason, /Terrain grassland: food \+2/);
  assert.match(grassChoice.reason, /Deposit materials: materials \+1/);
  assert.match(grassChoice.reason, /Base yields before focus and productivity: food 6, materials 3, energy 1, credits 2, science 1, culture 1/);
  assert.match(forestChoice.reason, /Terrain forest: materials \+2/);
  assert.match(forestChoice.reason, /Deposit none/);
  assert.match(forestChoice.reason, /Base yields before focus and productivity: food 4, materials 4, energy 1, credits 2, science 1, culture 1/);
  assert.equal(Object.hasOwn(observed, 'tiles'), false);
});

function twoFrontierCities(rulesId = 'settlement-frontiers-1'): WorldState {
  const state = createWorld(8, independentEpoch, rulesId);
  const civilization = state.civilizations[0];
  assert.ok(civilization);
  civilization.technologies.push('agriculture', 'water-management', 'kiln-firing');
  civilization.resources = { food: 100, materials: 100, energy: 100, credits: 100, science: 0, culture: 0 };
  const founded = applyCommand(state, independentCommand(state, 0, independentEpoch, frontierAction(state)));
  assert.equal(founded.ok, true, founded.error);
  return founded.state;
}

function specializationFixture(): WorldState {
  return twoFrontierCities('settlement-specialization-1');
}

await test('specialized focus and construction act on the exact owned city and preserve every other city', () => {
  const state = specializationFixture();
  const own = state.cities.filter((city) => city.civId === 0);
  const first = own[0];
  const second = own[1];
  assert.ok(first && second);
  const command = independentCommand(state, 0, '2026-10-16T00:00:10.000Z', { type: 'focus', focus: 'culture', cityId: second.id });
  const focused = applyCommand(state, command);
  assert.equal(focused.ok, true, focused.error);
  assert.equal(focused.state.cities.find((city) => city.id === second.id)?.focus, 'culture');
  assert.deepEqual(focused.state.cities.filter((city) => city.id !== second.id), state.cities.filter((city) => city.id !== second.id));
  const before = structuredClone(focused.state);
  const built = applyCommand(focused.state, independentCommand(focused.state, 0, '2026-10-16T00:00:20.000Z', { type: 'build', project: 'irrigation', cityId: second.id }));
  assert.equal(built.ok, true, built.error);
  assert.ok(built.state.cities.find((city) => city.id === second.id)?.buildings.includes('irrigation'));
  assert.deepEqual(built.state.cities.find((city) => city.id === second.id)?.buildingOperations?.irrigation, { enabled: true, lastResult: null });
  assert.deepEqual(built.state.cities.filter((city) => city.id !== second.id), before.cities.filter((city) => city.id !== second.id));
  assert.deepEqual(focused.state, before);
  assert.equal(built.state.civilizations[0]?.resources.materials, (before.civilizations[0]?.resources.materials ?? 0) - 12);
  assert.equal(built.state.civilizations[0]?.resources.credits, (before.civilizations[0]?.resources.credits ?? 0) - 8);
  assert.deepEqual(applyCommand(restartWorld(state), structuredClone(command)), focused);
  assert.ok(isWorldState(built.state));
});

await test('city specialization refuses missing, foreign, disappeared and duplicate targets without redirecting', () => {
  const state = specializationFixture();
  const own = state.cities.find((city) => city.civId === 0);
  const foreign = state.cities.find((city) => city.civId === 1);
  assert.ok(own && foreign);
  own.buildings.push('farm');
  own.focus = 'culture';
  const cases: GameAction[] = [
    { type: 'focus', focus: 'industry' },
    { type: 'build', project: 'farm' },
    { type: 'focus', focus: 'industry', cityId: 'missing' },
    { type: 'build', project: 'farm', cityId: 'missing' },
    { type: 'focus', focus: 'industry', cityId: foreign.id },
    { type: 'build', project: 'farm', cityId: foreign.id },
    { type: 'focus', focus: 'culture', cityId: own.id },
    { type: 'build', project: 'farm', cityId: own.id },
  ];
  const before = structuredClone(state);
  for (const action of cases) {
    const refused = applyCommand(state, independentCommand(state, 0, '2026-10-16T00:00:10.000Z', action));
    assert.equal(refused.ok, false);
    assert.equal(refused.state, state);
    assert.deepEqual(refused.events, []);
    assert.deepEqual(state, before);
  }
  const remaining = state.cities.find((city) => city.civId === 0 && city.id !== own.id);
  assert.ok(remaining);
  assert.ok(legalActions(state, 0, '2026-10-16T00:00:10.000Z').some(({ action }) => action.type === 'build' && action.cityId === remaining.id && action.project === 'farm'));
  const disappeared = structuredClone(state);
  disappeared.cities = disappeared.cities.filter((city) => city.id !== remaining.id);
  const queued: GameAction = { type: 'build', project: 'workshop', cityId: remaining.id };
  const refused = applyCommand(disappeared, independentCommand(disappeared, 0, '2026-10-16T00:00:10.000Z', queued));
  assert.equal(refused.ok, false);
  assert.equal(refused.state, disappeared);
  assert.deepEqual(refused.state.cities.find((city) => city.id === own.id), own);
});

await test('owned focus and construction choices reveal the exact city geography without dumping the map', () => {
  const state = specializationFixture();
  const cities = state.cities.filter((city) => city.civId === 0);
  const first = cities[0];
  const second = cities[1];
  assert.ok(first && second);
  const grass = state.tiles.find((tile) => tile.id === first.tileId);
  const forest = state.tiles.find((tile) => tile.id === second.tileId);
  assert.ok(grass && forest);
  grass.terrain = 'grassland';
  grass.resource = 'food';
  forest.terrain = 'forest';
  forest.resource = null;
  const observation = observe(state, 0, '2026-10-16T00:00:10.000Z');
  for (const type of ['focus', 'build']) {
    const grassChoice = observation.legalActions.find(({ action }) => (action.type === 'focus' || action.type === 'build') && action.type === type && action.cityId === first.id);
    const forestChoice = observation.legalActions.find(({ action }) => (action.type === 'focus' || action.type === 'build') && action.type === type && action.cityId === second.id);
    assert.ok(grassChoice && forestChoice);
    assert.match(grassChoice.reason, /Terrain grassland: food \+2/);
    assert.match(grassChoice.reason, /Deposit food: food \+1/);
    assert.match(forestChoice.reason, /Terrain forest: materials \+2/);
    assert.match(forestChoice.reason, /Deposit none/);
  }
  assert.equal(Object.hasOwn(observation, 'tiles'), false);
});

await test('older releases retain untargeted focus and first-eligible construction replay behavior', () => {
  const state = twoFrontierCities();
  const capital = state.cities.find((city) => city.civId === 0);
  assert.ok(capital);
  capital.buildings.push('farm');
  const focus = independentCommand(state, 0, '2026-10-16T00:00:10.000Z', { type: 'focus', focus: 'diplomacy' });
  const focused = applyCommand(state, focus);
  assert.equal(focused.ok, true, focused.error);
  assert.ok(focused.state.cities.filter((city) => city.civId === 0).every((city) => city.focus === 'diplomacy'));
  assert.deepEqual(applyCommand(restartWorld(state), focus), focused);
  const build = independentCommand(focused.state, 0, '2026-10-16T00:00:20.000Z', { type: 'build', project: 'farm' });
  const built = applyCommand(focused.state, build);
  assert.equal(built.ok, true, built.error);
  assert.ok(built.state.cities.filter((city) => city.civId === 0).every((city) => city.buildings.includes('farm')));
  assert.deepEqual(applyCommand(restartWorld(focused.state), build), built);
  const targeted = applyCommand(state, { ...focus, action: { type: 'focus', focus: 'culture', cityId: capital.id } });
  assert.equal(targeted.ok, false);
  assert.equal(targeted.state, state);
});

function recoveryFixture(): WorldState {
  return twoFrontierCities('settlement-recovery-1');
}

await test('released earthquake and exact paid city recovery restore next-beat output without inventing infrastructure', () => {
  const state = recoveryFixture();
  const shock = applyCommand(state, independentCommand(state, DIRECTOR_SEAT, '2026-10-16T00:00:10.000Z', { type: 'event', event: 'earthquake', target: 0 }));
  assert.equal(shock.ok, true, shock.error);
  const city = shock.state.cities.find((candidate) => candidate.civId === 0);
  assert.ok(city);
  assert.equal(city.damage, 35);
  assert.equal(city.infrastructure, state.cities.find((candidate) => candidate.id === city.id)?.infrastructure);
  const before = structuredClone(shock.state);
  const command = independentCommand(shock.state, 0, '2026-10-16T00:00:10.000Z', { type: 'repair-city', cityId: city.id });
  const repaired = applyCommand(shock.state, command);
  assert.equal(repaired.ok, true, repaired.error);
  assert.deepEqual(repaired.events.find((event) => event.type === 'city-repaired')?.effects, ['City damage 35 → 10', 'Paid 5 materials', 'Paid 2 energy']);
  assert.equal(repaired.state.cities.find((candidate) => candidate.id === city.id)?.damage, 10);
  assert.deepEqual(repaired.state.cities.filter((candidate) => candidate.id !== city.id), before.cities.filter((candidate) => candidate.id !== city.id));
  assert.equal(repaired.state.cities.find((candidate) => candidate.id === city.id)?.infrastructure, city.infrastructure);
  assert.deepEqual(repaired.state.cities.find((candidate) => candidate.id === city.id)?.buildings, city.buildings);
  assert.equal(repaired.state.civilizations[0]?.resources.materials, (before.civilizations[0]?.resources.materials ?? 0) - 5);
  assert.equal(repaired.state.civilizations[0]?.resources.energy, (before.civilizations[0]?.resources.energy ?? 0) - 2);
  assert.deepEqual(shock.state, before);
  assert.deepEqual(applyCommand(restartWorld(shock.state), command), repaired);
  const duplicate = applyCommand(repaired.state, command);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.state, repaired.state);
  const damagedBeat = engine.catchUpStrategy(shock.state, '2026-10-16T00:01:00.000Z');
  const repairedBeat = engine.catchUpStrategy(repaired.state, '2026-10-16T00:01:00.000Z');
  assert.equal(damagedBeat.ok, true, damagedBeat.error);
  assert.equal(repairedBeat.ok, true, repairedBeat.error);
  assert.ok((repairedBeat.state.civilizations[0]?.resources.food ?? 0) > (damagedBeat.state.civilizations[0]?.resources.food ?? 0));
  assert.deepEqual(repairedBeat.state.cities.filter((candidate) => candidate.id !== city.id), damagedBeat.state.cities.filter((candidate) => candidate.id !== city.id));
  const final = applyCommand(repaired.state, independentCommand(repaired.state, 0, '2026-10-16T00:00:20.000Z', command.action));
  assert.equal(final.ok, true, final.error);
  assert.equal(final.state.cities.find((candidate) => candidate.id === city.id)?.damage, 0);
  assert.equal(final.state.civilizations[0]?.resources.materials, (repaired.state.civilizations[0]?.resources.materials ?? 0) - 5);
  assert.equal(final.state.civilizations[0]?.resources.energy, (repaired.state.civilizations[0]?.resources.energy ?? 0) - 2);
  assert.ok(isWorldState(final.state));
});

await test('city repair rejects foreign, missing, healthy and unaffordable exact targets atomically', () => {
  const state = recoveryFixture();
  const own = state.cities.find((city) => city.civId === 0);
  const foreign = state.cities.find((city) => city.civId === 1);
  assert.ok(own && foreign);
  foreign.damage = 35;
  for (const cityId of [own.id, foreign.id, 'missing']) {
    const before = structuredClone(state);
    const result = applyCommand(state, independentCommand(state, 0, '2026-10-16T00:00:10.000Z', { type: 'repair-city', cityId }));
    assert.equal(result.ok, false);
    assert.equal(result.state, state);
    assert.deepEqual(result.events, []);
    assert.deepEqual(state, before);
  }
  own.damage = 35;
  for (const [resource, amount] of [['materials', 4.99], ['energy', 1.99]] as const) {
    const poor = structuredClone(state);
    const civilization = poor.civilizations[0];
    assert.ok(civilization);
    civilization.resources[resource] = amount;
    const before = structuredClone(poor);
    const result = applyCommand(poor, independentCommand(poor, 0, '2026-10-16T00:00:10.000Z', { type: 'repair-city', cityId: own.id }));
    assert.equal(result.ok, false);
    assert.equal(result.state, poor);
    assert.deepEqual(result.events, []);
    assert.deepEqual(poor, before);
  }
  const legacy = specializationFixture();
  const city = legacy.cities.find((candidate) => candidate.civId === 0);
  assert.ok(city);
  city.damage = 35;
  assert.equal(applyCommand(legacy, independentCommand(legacy, 0, '2026-10-16T00:00:10.000Z', { type: 'repair-city', cityId: city.id })).ok, false);
});

await test('direct and scheduled earthquake effects select recovery data while historical infrastructure loss replays unchanged', () => {
  for (const released of [false, true]) {
    const state = released ? recoveryFixture() : specializationFixture();
    if (!released) state.unlockedFeatures.push('disaster-recovery');
    const before = structuredClone(state);
    const directCommand = independentCommand(state, DIRECTOR_SEAT, '2026-10-16T00:00:10.000Z', { type: 'event', event: 'earthquake', target: 0 });
    const direct = applyCommand(state, directCommand);
    const scheduledCommand = { expectedRevision: state.revision, kind: 'event', intervalId: 'recovery-probe', timestamp: '2026-10-16T00:00:10.000Z', event: 'earthquake', target: 0 } as const;
    const scheduled = applyDirectorTick(state, scheduledCommand);
    assert.equal(direct.ok, true, direct.error);
    assert.equal(scheduled.ok, true, scheduled.error);
    assert.deepEqual(direct.state.cities, scheduled.state.cities);
    for (const city of state.cities.filter((candidate) => candidate.civId === 0)) {
      const after = direct.state.cities.find((candidate) => candidate.id === city.id);
      assert.equal(after?.damage, 35);
      assert.equal(after.infrastructure, released ? city.infrastructure : Math.max(0, city.infrastructure - 1));
    }
    assert.deepEqual(applyCommand(restartWorld(state), directCommand), direct);
    assert.deepEqual(applyDirectorTick(restartWorld(state), scheduledCommand), scheduled);
    assert.deepEqual(state, before);
  }
  const old = specializationFixture();
  assert.equal(legalActions(old, DIRECTOR_SEAT, independentEpoch).some(({ action }) => action.type === 'event' && action.event === 'earthquake'), false);
});

await test('building choices disclose paid and free construction commitments before spending without changing exact actions', () => {
  const state = specializationFixture();
  const city = state.cities.find((candidate) => candidate.civId === 0);
  assert.ok(city);
  const before = structuredClone(state);
  const observation = observe(state, 0, '2026-10-16T00:00:10.000Z');
  const expectations = [
    ['irrigation', 'materials 12, credits 8', 'materials 1', 'food 5'],
    ['kiln', 'materials 10, credits 8', 'energy 2', 'materials 4'],
    ['farm', 'materials 8, credits 4', 'none', 'food 4'],
    ['workshop', 'materials 12, credits 8', 'none', 'materials 3, energy 1'],
  ];
  for (const [project, cost, inputs, outputs] of expectations) {
    const option: ActionOption | undefined = observation.legalActions.find(({ action }) => action.type === 'build' && action.project === project && action.cityId === city.id);
    assert.ok(option);
    assert.deepEqual(option.action, { type: 'build', project, cityId: city.id });
    assert.ok(option.reason.includes(`Construction cost from shared supplies: ${cost}.`));
    assert.ok(option.reason.includes(`Recurring inputs per economy beat: ${inputs}.`));
    assert.ok(option.reason.includes(`Base building output per economy beat before productivity: ${outputs}; not net stock gain.`));
  }
  assert.deepEqual(state, before);
  const hidden = independentFixture();
  const civilization = hidden.civilizations[0];
  assert.ok(civilization);
  civilization.technologies.push('agriculture', 'water-management', 'kiln-firing');
  civilization.resources.materials = 100;
  civilization.resources.credits = 100;
  const oldOptions = observe(hidden, 0, independentEpoch).legalActions;
  assert.equal(oldOptions.some(({ action }) => action.type === 'build' && ['irrigation', 'kiln'].includes(action.project)), false);
  const farm = oldOptions.find(({ action }) => action.type === 'build' && action.project === 'farm');
  assert.ok(farm);
  assert.deepEqual(farm.action, { type: 'build', project: 'farm' });
  assert.match(farm.reason, /Recurring inputs per economy beat: none\./);
  assert.match(farm.reason, /Base building output per economy beat before productivity: food 4; not net stock gain\./);
});

await test('construction explanations follow catalogue values in canonical resource order rather than copied tuning', () => {
  const building = BUILDINGS.find((candidate) => candidate.id === 'irrigation');
  assert.ok(building);
  const original = { cost: building.cost, operatingInputs: building.operatingInputs, production: building.production };
  try {
    building.cost = { credits: 3.5, materials: 9 };
    building.operatingInputs = { energy: 0.75, materials: 2.5 };
    building.production = { culture: 0, materials: 1.25, food: 7.5 };
    const state = specializationFixture();
    const option = observe(state, 0, '2026-10-16T00:00:10.000Z').legalActions.find(({ action }) => action.type === 'build' && action.project === 'irrigation');
    assert.ok(option);
    assert.match(option.reason, /Construction cost from shared supplies: materials 9, credits 3.5\./);
    assert.match(option.reason, /Recurring inputs per economy beat: materials 2.5, energy 0.75\./);
    assert.match(option.reason, /Base building output per economy beat before productivity: food 7.5, materials 1.25; not net stock gain\./);
    assert.doesNotMatch(option.reason, /culture 0/);
    building.operatingInputs = {};
    building.production = {};
    const empty = observe(state, 0, '2026-10-16T00:00:10.000Z').legalActions.find(({ action }) => action.type === 'build' && action.project === 'irrigation');
    assert.ok(empty);
    assert.match(empty.reason, /Recurring inputs per economy beat: none\./);
    assert.match(empty.reason, /Base building output per economy beat before productivity: none; not net stock gain\./);
  } finally {
    building.cost = original.cost;
    if (original.operatingInputs) building.operatingInputs = original.operatingInputs;
    else delete building.operatingInputs;
    building.production = original.production;
  }
});
