import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCommand,
  applyDirectorTick,
  catchUpClock,
  createWorld,
  legalActions,
  observe,
} from '../core/engine.ts';
import { chooseAction, simulate } from '../core/policies.ts';
import { CIV_COUNT, DIRECTOR_SEAT, type Command, type WorldState } from '../core/types.ts';
import { ECONOMY_RULES } from '../core/content.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { applyEffects } from '../core/simulation/effects.ts';
import { milestoneEligible } from '../core/simulation/history.ts';

function play(state: WorldState): WorldState {
  const result = applyCommand(state, {
    seat: state.phase,
    expectedRevision: state.revision,
    action: chooseAction(state, state.phase),
  });
  assert.equal(result.ok, true, result.error);
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

await test('trade moves scarce goods between city endpoints and damage stops cargo and commerce', () => {
  const intact = createWorld(8);
  const broken = structuredClone(intact);
  const route = {
    id: 'test-route',
    from: 'city-0',
    to: 'city-1',
    owner: 0,
    partner: 1,
    active: false,
    damage: 0,
    volume: 0,
  };
  intact.routes.push({ ...route });
  broken.routes.push({ ...route, damage: ECONOMY_RULES.trade.damageDisableAt });
  resolveEconomy(intact, []);
  resolveEconomy(broken, []);
  const intactOwner = intact.civilizations[0];
  const intactPartner = intact.civilizations[1];
  const brokenOwner = broken.civilizations[0];
  const brokenPartner = broken.civilizations[1];
  assert.ok(intactOwner && intactPartner && brokenOwner && brokenPartner);
  assert.equal(intactOwner.resources.food, brokenOwner.resources.food - 2);
  assert.equal(intactPartner.resources.food, brokenPartner.resources.food + 2);
  assert.equal(intactOwner.resources.materials, brokenOwner.resources.materials + 2);
  assert.equal(intactPartner.resources.materials, brokenPartner.resources.materials - 2);
  assert.equal(intactOwner.resources.credits, brokenOwner.resources.credits + 2);
  assert.equal(intactOwner.resources.energy, brokenOwner.resources.energy - 1);
  assert.equal(intact.routes[0]?.active, true);
  assert.equal(broken.routes[0]?.active, false);
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
