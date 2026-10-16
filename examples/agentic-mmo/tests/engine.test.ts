import assert from 'node:assert/strict';
import test from 'node:test';
import * as engine from '../core/engine.ts';
import {
  applyCommand,
  applyDirectorTick,
  catchUpClock,
  createWorld,
  legalActions,
  observe,
} from '../core/engine.ts';
import { chooseAction, simulate } from '../core/policies.ts';
import {
  CIV_COUNT,
  DIRECTOR_SEAT,
  type Command,
  type HistoryAdvanceCommand,
  type GameAction,
  type ReleaseApplyCommand,
  type WorldState,
} from '../core/types.ts';
import { RELEASES } from '../core/release.ts';
import {
  ECONOMY_RULES,
  RESOURCE_IDS,
  TRADE_RECIPES,
  TRADE_RULES,
  TURN_RULES,
} from '../core/content.ts';
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

await test('registered compatible release upgrades preserve the actual world and clock', () => {
  assert.equal(typeof engine.applyRelease, 'function');
  let state = createWorld(8, '2026-10-16T00:00:00.000Z');
  state = play(state);
  state = catchUpClock(state, '2026-10-16T00:06:00.000Z').state;
  const before = structuredClone(state);
  const result = engine.applyRelease(state, {
    expectedRevision: state.revision,
    expectedFromReleaseId: state.releaseId,
    targetReleaseId: 'settlement-foundations-2',
  });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(state, before);
  assert.equal(result.state.releaseId, 'settlement-foundations-2');
  assert.deepEqual(
    result.state.unlockedFeatures,
    RELEASES.find((release) => release.id === result.state.releaseId)?.featureIds,
  );
  assert.equal(result.state.revision, before.revision + 1);
  assert.deepEqual(
    {
      ...result.state,
      revision: before.revision,
      releaseId: before.releaseId,
      unlockedFeatures: before.unlockedFeatures,
      events: before.events,
      eventCounts: before.eventCounts,
    },
    before,
  );
  assert.equal(result.events[0]?.type, 'release-applied');
  assert.ok(result.events[0]?.cause.includes(before.releaseId));
  assert.equal(Object.hasOwn(result.state, 'historyAdvances'), false);
});

await test('unknown, repeated, downgraded and incompatible release commands preserve state identity', () => {
  assert.equal(typeof engine.applyRelease, 'function');
  const initial = createWorld(8);
  const command = {
    expectedRevision: initial.revision,
    expectedFromReleaseId: initial.releaseId,
    targetReleaseId: 'settlement-foundations-2',
  };
  const upgraded = engine.applyRelease(initial, command).state;
  const cases: Array<[WorldState, ReleaseApplyCommand]> = [
    [initial, { ...command, targetReleaseId: 'unregistered' }],
    [initial, { ...command, expectedRevision: 99 }],
    [initial, { ...command, expectedFromReleaseId: 'other-release' }],
    [initial, { ...command, targetReleaseId: initial.releaseId }],
    [{ ...initial, schemaVersion: 99 }, command],
    [{ ...initial, gameVersion: 'incompatible' }, command],
    [{ ...initial, unlockedFeatures: [...initial.unlockedFeatures, 'trade-routes'] }, command],
    [
      upgraded,
      {
        ...command,
        expectedRevision: upgraded.revision,
        expectedFromReleaseId: upgraded.releaseId,
      },
    ],
    [
      upgraded,
      {
        ...command,
        expectedRevision: upgraded.revision,
        expectedFromReleaseId: upgraded.releaseId,
        targetReleaseId: initial.releaseId,
      },
    ],
  ];
  for (const [state, input] of cases) {
    const before = structuredClone(state);
    const result = engine.applyRelease(state, input);
    assert.equal(result.ok, false);
    assert.equal(result.state, state);
    assert.deepEqual(result.events, []);
    assert.deepEqual(state, before);
  }
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
  assert.equal(typeof engine.applyRelease, 'function');
  const state = createWorld(8, '2026-10-16T00:00:00.000Z');
  const result = engine.applyRelease(state, {
    expectedRevision: state.revision,
    expectedFromReleaseId: state.releaseId,
    targetReleaseId: 'settlement-foundations-2',
  });
  assert.equal(result.ok, true, result.error);
  return result.state;
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
    { ...command, expectedRevision: 0 },
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
  const original = createWorld(8);
  original.outcome = terminal.outcome;
  const release = engine.applyRelease(original, {
    expectedRevision: original.revision,
    expectedFromReleaseId: original.releaseId,
    targetReleaseId: state.releaseId,
  });
  assert.equal(release.ok, false);
  assert.equal(release.state, original);
});

function tradeFixture(): WorldState {
  const state = createWorld(8);
  state.unlockedFeatures.push('trade-routes');
  return state;
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
  const recipe = TRADE_RECIPES[0];
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
  const recipe = TRADE_RECIPES[0];
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
  const recipe = TRADE_RECIPES[0];
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
  const state = upgradedWorld();
  const result = engine.applyRelease(state, {
    expectedRevision: state.revision,
    expectedFromReleaseId: state.releaseId,
    targetReleaseId: 'settlement-independent-1',
    timestamp: independentEpoch,
  });
  assert.equal(result.ok, true, result.error);
  return result.state;
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
    { ...independentCommand(state, 4), expectedRevision: 0 },
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

await test('independent release activation requires an explicit epoch and preserves old replay mode', () => {
  const state = upgradedWorld();
  const command = {
    expectedRevision: state.revision,
    expectedFromReleaseId: state.releaseId,
    targetReleaseId: 'settlement-independent-1',
  };
  const missing = engine.applyRelease(state, command);
  assert.equal(missing.ok, false);
  assert.equal(missing.state, state);
  assert.equal(applyCommand(state, independentCommand(state, 2)).ok, false);
  const released = engine.applyRelease(state, { ...command, timestamp: independentEpoch });
  assert.equal(released.ok, true, released.error);
  assert.equal(released.state.independentTurns?.epoch, independentEpoch);
  assert.equal(released.state.independentTurns?.strategyTicks, 0);
  assert.equal(released.state.round, state.round);
  assert.equal(released.state.year, state.year);
  assert.equal(Object.hasOwn(state, 'independentTurns'), false);
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
  const recipe = TRADE_RECIPES[0];
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
