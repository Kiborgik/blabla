import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEHAVIOR_PROFILES, civilizationBehaviorProfile } from '../core/behavior-profiles.ts';
import { BEHAVIOR_POLICY_VERSION, chooseCivilizationBehavior, chooseDirectorBehavior, createBehaviorMemory, isBehaviorMemory, isLegacyBehaviorMemory, type BehaviorMemory } from '../core/behaviors.ts';
import { BUILDINGS, CIVICS, TECHNOLOGIES, TURN_RULES } from '../core/content.ts';
import { applyCommand, applyRelease, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { RELEASES } from '../core/release.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { decisionObligations } from '../core/simulation/decisions.ts';
import { DIRECTOR_SEAT, type Command, type WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';

const epoch = '2026-01-01T00:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();

function releasedWorld(seed = 41): WorldState {
  let state = createWorld(seed);
  for (const release of RELEASES.slice(1)) {
    const applied = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, timestamp: epoch });
    assert.ok(applied.ok, `${release.id}: ${applied.error}`);
    state = applied.state;
    if (release.id === 'settlement-interplanetary-1') break;
  }
  assert.equal(state.releaseId, 'settlement-interplanetary-1');
  assert.ok(isWorldState(state));
  return state;
}

function freeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}

void test('authored personalities stay distinct, positive, soft and seeded without changing the catalogue', () => {
  assert.equal(BEHAVIOR_PROFILES.length, 5);
  assert.equal(new Set(BEHAVIOR_PROFILES.map(profile => profile.id)).size, 5);
  const before = structuredClone(BEHAVIOR_PROFILES);
  for (let seat = 0; seat < 5; seat++) {
    const profile = civilizationBehaviorProfile(41, seat);
    assert.deepEqual(profile, civilizationBehaviorProfile(41, seat));
    assert.notDeepEqual(profile.resources, civilizationBehaviorProfile(42, seat).resources);
    assert.ok(Object.values(profile.resources).every(weight => weight > 0 && Number.isFinite(weight)));
    assert.ok(Object.values(profile.priorities).every(weight => weight > 0 && Number.isFinite(weight)));
  }
  assert.deepEqual(BEHAVIOR_PROFILES, before);
  assert.throws(() => civilizationBehaviorProfile(41, 5), RangeError);
});

void test('choice is pure, deterministic, legal and carries bounded procedural provenance', () => {
  const state = releasedWorld();
  const memory = createBehaviorMemory(state, 0);
  const before = structuredClone(state);
  freeze(state); freeze(memory);
  const first = chooseCivilizationBehavior(state, 0, memory, epoch);
  assert.deepEqual(first, chooseCivilizationBehavior(state, 0, memory, epoch));
  assert.deepEqual(state, before);
  assert.ok(first.action && legalActions(state, 0, epoch).some(option => sameAction(option.action, first.action)));
  assert.equal(first.memory.decisionCount, 1);
  assert.equal(memory.decisionCount, 0);
  assert.equal(first.memory.policyVersion, BEHAVIOR_POLICY_VERSION);
  assert.equal(first.explanation.profileId, first.memory.profileId);
  assert.ok(first.explanation.reason.length > 0 && first.explanation.reason.length <= 280);
  assert.ok(isBehaviorMemory(JSON.parse(JSON.stringify(first.memory))));
});

void test('empty admission never fabricates wait or spends a decision cursor', () => {
  const sequential = createWorld(41);
  assert.equal(chooseCivilizationBehavior(sequential, 1).action, null);
  const state = releasedWorld();
  const memory = createBehaviorMemory(state, 0);
  const missingTime = chooseCivilizationBehavior(state, 0, memory);
  assert.equal(missingTime.action, null);
  assert.deepEqual(missingTime.memory, memory);
  const first = chooseCivilizationBehavior(state, 0, memory, epoch);
  assert.ok(first.action);
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: epoch, action: first.action });
  assert.ok(result.ok, result.error);
  const exhausted = chooseCivilizationBehavior(result.state, 0, first.memory, epoch);
  assert.equal(exhausted.action, null);
  assert.deepEqual(exhausted.memory, first.memory);
  const overdue = chooseCivilizationBehavior(result.state, 0, first.memory, at(60));
  assert.equal(overdue.action, null);
  assert.deepEqual(overdue.memory, first.memory);
});

void test('persisted memory rejects wrong versions, profiles, unsafe counters and cross-world reuse', () => {
  const state = releasedWorld();
  const memory = createBehaviorMemory(state, 0);
  for (const corruption of [
    { version: 3 }, { policyVersion: 'made-up-model' }, { profileId: 'pelagos-traders' },
    { seat: -1 }, { decisionCount: NaN }, { decisionCount: Number.MAX_SAFE_INTEGER + 1 },
    { seed: -1 }, { phase: 'unrestricted' }, { focusLocks: [{ cityId: 'city-0', focus: 'war', untilRound: 2 }] },
  ]) assert.equal(isBehaviorMemory({ ...memory, ...corruption }), false, JSON.stringify(corruption));
  assert.throws(() => chooseCivilizationBehavior(state, 1, memory, epoch), RangeError);
  assert.throws(() => chooseCivilizationBehavior(releasedWorld(42), 0, memory, epoch), RangeError);
});

void test('legacy v1 memory remains readable but cannot activate or silently reset a v2 controller', () => {
  const state = releasedWorld();
  const memory = createBehaviorMemory(state, 0);
  const legacy = { ...memory, version: 1, policyVersion: 'weighted-civilizations-v1', decisionCount: 37, lastRequiredLane: 'research' };
  const before = structuredClone(legacy);
  freeze(legacy);
  assert.equal(memory.version, 2);
  assert.equal(BEHAVIOR_POLICY_VERSION, 'weighted-civilizations-v2');
  assert.ok(isLegacyBehaviorMemory(legacy));
  assert.equal(isBehaviorMemory(legacy), false);
  assert.equal(isLegacyBehaviorMemory(memory), false);
  assert.throws(() => chooseCivilizationBehavior(state, 0, legacy as unknown as BehaviorMemory, epoch), RangeError);
  assert.deepEqual(legacy, before);
  for (const patch of [{ decisionCount: -1 }, { urgentStreak: 3 }, { profileId: 'new-profile' }, { policyVersion: BEHAVIOR_POLICY_VERSION }, { phase: 'future-phase' }, { focusLocks: [{ cityId: 'city-0', focus: 'future-focus', untilRound: 2 }] }])
    assert.equal(isLegacyBehaviorMemory({ ...legacy, ...patch }), false);
});

void test('synthetic required-lane scenario covers research, civics and every exact owned town fairly', () => {
  let state = releasedWorld();
  const actor = state.civilizations[0]; assert.ok(actor);
  actor.technologies = ['agriculture'];
  actor.resources = { food: 200, materials: 200, credits: 200, energy: 100, science: 0, culture: 0 };
  const settle = legalActions(state, 0, epoch).find(option => option.action.type === 'settle'); assert.ok(settle);
  const settled = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: epoch, action: settle.action });
  assert.ok(settled.ok, settled.error); state = settled.state;
  let memory = createBehaviorMemory(state, 0);
  const chosen = new Set<string>();
  for (let turn = 1; turn <= 4; turn++) {
    const decision = chooseCivilizationBehavior(state, 0, memory, at(turn * 10));
    assert.ok(decision.action && decision.explanation.required);
    assert.ok(decision.memory.lastRequiredLane);
    chosen.add(decision.memory.lastRequiredLane);
    const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: at(turn * 10), action: decision.action });
    assert.ok(result.ok, result.error); state = result.state; memory = decision.memory;
  }
  assert.deepEqual([...chosen].sort(), ['civic', ...state.cities.filter(city => city.civId === 0).map(city => `construction:${city.id}`), 'research'].sort());
  const lanes = decisionObligations(state, 0);
  assert.equal(lanes.research.status, 'active');
  assert.equal(lanes.civic?.status, 'active');
  assert.ok(lanes.construction.every(lane => lane.status === 'active'));
});

void test('every personality interrupts its preference to protect critically low food', () => {
  const state = releasedWorld();
  for (const actor of state.civilizations) actor.resources.food = 0;
  for (const city of state.cities) city.focus = 'industry';
  for (let seat = 0; seat < 5; seat++) {
    const decision = chooseCivilizationBehavior(state, seat, undefined, epoch);
    assert.equal(decision.explanation.phase, 'survival');
    assert.deepEqual(decision.action, { type: 'focus', cityId: `city-${seat}`, focus: 'growth' });
    assert.ok(legalActions(state, seat, epoch).some(option => sameAction(option.action, decision.action)));
  }
});

void test('synthetic severe damage selects real paid recovery without mutating stocks or waiving obligations', () => {
  const state = releasedWorld(); const city = state.cities[0]; const actor = state.civilizations[0]; assert.ok(city && actor);
  city.damage = 75; actor.resources.food = 100;
  const before = structuredClone(state);
  const decision = chooseCivilizationBehavior(state, 0, undefined, epoch);
  assert.deepEqual(decision.action, { type: 'repair-city', cityId: city.id });
  assert.equal(decision.explanation.phase, 'recovery');
  assert.deepEqual(state, before);
  assert.ok(decision.action);
  const applied = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: epoch, action: decision.action });
  assert.ok(applied.ok, applied.error);
  assert.equal(applied.state.cities[0]?.damage, 50);
  assert.equal(applied.state.civilizations[0]?.resources.materials, actor.resources.materials - 5);
  assert.equal(applied.state.civilizations[0]?.resources.energy, actor.resources.energy - 2);
});

void test('synthetic focus commitment resists tactical thrashing but a food emergency can interrupt', () => {
  const state = createWorld(41); const actor = state.civilizations[0]; const city = state.cities[0]; assert.ok(actor && city);
  actor.researchTarget = 'agriculture'; actor.resources.food = 200; city.focus = 'growth';
  const memory = createBehaviorMemory(state, 0);
  memory.focusLocks = [{ cityId: '*', focus: 'growth', untilRound: 6 }];
  const held = chooseCivilizationBehavior(state, 0, memory);
  assert.deepEqual(held.action, { type: 'wait' });
  actor.resources.food = 0; city.focus = 'research'; memory.focusLocks = [{ cityId: '*', focus: 'research', untilRound: 6 }];
  const emergency = chooseCivilizationBehavior(state, 0, memory);
  assert.deepEqual(emergency.action, { type: 'focus', focus: 'growth' });
});

void test('seeded soft preferences produce different choices rather than five rigid scripts', () => {
  const counts = Array.from({ length: 5 }, () => new Map<string, number>());
  for (let seed = 1; seed <= 80; seed++) for (let seat = 0; seat < 5; seat++) {
    const state = createWorld(seed); state.phase = seat;
    for (const actor of state.civilizations) { actor.researchTarget = 'agriculture'; actor.resources.food = 200; }
    for (const city of state.cities) city.focus = 'industry';
    const action = chooseCivilizationBehavior(state, seat).action;
    const key = action?.type === 'focus' ? action.focus : action?.type ?? 'none';
    const count = counts[seat]; assert.ok(count); count.set(key, (count.get(key) ?? 0) + 1);
  }
  assert.ok((counts[0]?.get('research') ?? 0) > (counts[4]?.get('research') ?? 0));
  assert.ok((counts[4]?.get('culture') ?? 0) > (counts[0]?.get('culture') ?? 0));
  assert.ok((counts[3]?.get('diplomacy') ?? 0) > (counts[0]?.get('diplomacy') ?? 0));
  assert.ok((counts[0]?.size ?? 0) > 1);
});

void test('Director is seeded, release-gated, pure and honors the engine cooldown', () => {
  const state = createWorld(41); state.phase = DIRECTOR_SEAT;
  const before = structuredClone(state);
  const selected = chooseDirectorBehavior(state);
  assert.deepEqual(selected, chooseDirectorBehavior(state));
  assert.deepEqual(state, before);
  assert.ok(selected.action && legalActions(state, DIRECTOR_SEAT).some(option => sameAction(option.action, selected.action)));
  assert.equal(selected.explanation.profileId, 'world-director');
  state.directorCooldown = 2;
  const held = chooseDirectorBehavior(state, selected.memory);
  assert.deepEqual(held.action, { type: 'wait' });
  assert.ok(isBehaviorMemory(held.memory));
});

interface Campaign { state: WorldState; memories: Array<BehaviorMemory | undefined>; commands: Command[] }

function play(campaign: Campaign, rounds: number): Campaign {
  let state = campaign.state;
  const memories = structuredClone(campaign.memories);
  const commands = [...campaign.commands];
  const initialRound = state.round;
  for (let round = initialRound; round < initialRound + rounds; round++) {
    for (let window = 0; window < TURN_RULES.strategyIntervalMs / TURN_RULES.tacticalWindowMs; window++) {
      const timestamp = at(round * 60 + window * 10);
      for (let seat = 0; seat <= DIRECTOR_SEAT; seat++) {
        const decision = seat === DIRECTOR_SEAT ? chooseDirectorBehavior(state, memories[seat], timestamp) : chooseCivilizationBehavior(state, seat, memories[seat], timestamp);
        if (!decision.action) continue;
        assert.ok(legalActions(state, seat, timestamp).some(option => sameAction(option.action, decision.action)));
        const oldResearch = state.civilizations[seat]?.researchTarget;
        if (oldResearch) assert.notEqual(decision.action.type, 'research');
        if ('cityId' in decision.action && ['build', 'improve', 'build-wonder', 'build-rail'].includes(decision.action.type))
          assert.equal(state.cities.find(city => city.id === Reflect.get(decision.action as object, 'cityId'))?.construction?.active ?? null, null);
        const command: Command = { seat, expectedRevision: state.revision, timestamp, action: decision.action };
        const applied = applyCommand(state, command);
        assert.ok(applied.ok, JSON.stringify({ command, error: applied.error }));
        state = applied.state; memories[seat] = decision.memory; commands.push(command);
      }
    }
    const advanced = catchUpStrategy(state, at((round + 1) * 60));
    assert.ok(advanced.ok, advanced.error); state = advanced.state;
  }
  return { state, memories, commands };
}

void test('historical interplanetary campaign autonomously commits, pays, completes and resumes the same seeded history', context => {
  const initial = releasedWorld(41);
  const middle = play({ state: initial, memories: [], commands: [] }, 12);
  const continued = play(middle, 12);
  const restored = play(JSON.parse(JSON.stringify(middle)) as Campaign, 12);
  assert.deepEqual(continued, restored);
  assert.ok(isWorldState(continued.state));
  for (const actor of continued.state.civilizations) {
    assert.ok(actor.technologies.length >= 2, `${actor.name} completes multiple discoveries`);
    assert.ok((actor.civics?.completedCivicIds.length ?? 0) >= 1, `${actor.name} completes a civic`);
    assert.ok(continued.state.cities.some(city => city.civId === actor.id && city.buildings.length > 0), `${actor.name} completes paid construction`);
    assert.ok(continued.commands.some(command => command.seat === actor.id && command.action.type === 'research'));
    assert.ok(continued.commands.some(command => command.seat === actor.id && command.action.type === 'choose-civic'));
  }
  assert.ok(continued.commands.some(command => command.action.type === 'settle' || command.action.type === 'settle-coast'));
  assert.ok(continued.commands.some(command => command.action.type === 'propose-trade'));
  assert.ok(continued.commands.some(command => command.action.type === 'respond-trade' && command.action.accept));
  assert.ok(continued.state.routes.some(route => (route.agreement?.deliveryCount ?? 0) > 0));
  assert.ok(continued.commands.some(command => command.action.type === 'repair-city'));
  assert.deepEqual(initial, releasedWorld(41));
  context.diagnostic(JSON.stringify({ rounds: continued.state.round, commands: continued.commands.length, cities: continued.state.cities.length, discoveries: continued.state.civilizations.map(actor => actor.technologies.length), civics: continued.state.civilizations.map(actor => actor.civics?.completedCivicIds.length), deliveries: continued.state.routes.reduce((sum, route) => sum + (route.agreement?.deliveryCount ?? 0), 0) }));
});

void test('synthetic completed catalogue does not invent research, repeat a finished civic or replace work', () => {
  const state = releasedWorld(); const actor = state.civilizations[0]; const city = state.cities[0]; assert.ok(actor?.civics && city);
  actor.technologies = TECHNOLOGIES.map(technology => technology.id);
  actor.civics.completedCivicIds = CIVICS.map(civic => civic.id);
  city.buildings = BUILDINGS.filter(building => !building.district).map(building => building.id);
  city.construction = { active: { id: 'synthetic-active', cityId: city.id, buildingId: 'campus', ruleVersion: 1, startedRound: 0, paid: { materials: 16, credits: 8 }, workRequired: 8, workDone: 3 }, lastCompleted: null };
  const decision = chooseCivilizationBehavior(state, 0, undefined, epoch);
  assert.notEqual(decision.action?.type, 'research');
  assert.notEqual(decision.action?.type, 'choose-civic');
  assert.notEqual(decision.action?.type, 'build');
  assert.ok(city.construction.active);
  assert.equal(city.construction.active.workDone, 3);
});
