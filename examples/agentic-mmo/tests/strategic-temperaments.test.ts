import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEHAVIOR_POLICY_VERSION, FOOD_BUDGET_BEHAVIOR_POLICY_VERSION, TEMPERAMENT_BEHAVIOR_POLICY_VERSION, BEHAVIOR_PROFILES, behaviorPolicyVersion, behaviorSeed, civilizationBehaviorProfile } from '../core/behavior-profiles.ts';
import { applyStrategicPosture, STRATEGIC_ARCHETYPES, STRATEGIC_TEMPERAMENT_VERSION, strategicTemperament } from '../core/strategic-temperaments.ts';
import { chooseCivilizationBehavior, createBehaviorMemory, isBehaviorMemory } from '../core/behaviors.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import type { Resource, WorldState } from '../core/types.ts';
import type { BehaviorPriority } from '../core/behavior-profiles.ts';

const epoch = '2026-10-22T00:00:00.000Z';

void test('fixed 256-seed corpus allocates exactly one neutral archetype per world with independent bounded posture', () => {
  const templates = structuredClone(BEHAVIOR_PROFILES);
  const seen = Array.from({ length: 5 }, () => new Set<string>());
  const postures = new Set<string>();
  for (let seed = 0; seed < 256; seed++) {
    const allocations = Array.from({ length: 5 }, (_, seat) => strategicTemperament(seed, seat));
    assert.deepEqual(allocations.map(item => item.archetypeId).sort(), [...STRATEGIC_ARCHETYPES].sort());
    for (let seat = 0; seat < 5; seat++) {
      const allocation = allocations[seat]!;
      const profile = civilizationBehaviorProfile(seed, seat, TEMPERAMENT_BEHAVIOR_POLICY_VERSION);
      const template = BEHAVIOR_PROFILES[allocation.templateIndex]!;
      seen[seat]!.add(allocation.archetypeId); postures.add(allocation.posture);
      assert.deepEqual(profile, civilizationBehaviorProfile(seed, seat, TEMPERAMENT_BEHAVIOR_POLICY_VERSION));
      assert.deepEqual(profile, civilizationBehaviorProfile(seed + 0x100000000, seat, TEMPERAMENT_BEHAVIOR_POLICY_VERSION));
      assert.equal(profile.id, allocation.profileId);
      assert.equal(profile.preferredFocus, template.preferredFocus);
      assert.ok(!/aster|verdant|ember|pelagos|vesper/i.test(`${profile.id} ${profile.name}`));
      const neutral = { ...template, resources: { ...template.resources }, priorities: { ...template.priorities } };
      for (const field of Object.keys(neutral.resources) as Resource[]) {
        const variation = 0.9 + (behaviorSeed(`${STRATEGIC_TEMPERAMENT_VERSION}/jitter/${seed}/${seat}/${allocation.archetypeId}/resource/${field}`) % 201) / 1000;
        neutral.resources[field] *= variation;
        assert.ok(profile.resources[field] >= template.resources[field] * 0.9 && profile.resources[field] <= template.resources[field] * 1.1);
      }
      for (const field of Object.keys(neutral.priorities) as BehaviorPriority[]) {
        const variation = 0.9 + (behaviorSeed(`${STRATEGIC_TEMPERAMENT_VERSION}/jitter/${seed}/${seat}/${allocation.archetypeId}/priority/${field}`) % 201) / 1000;
        neutral.priorities[field] *= variation;
      }
      const expected = applyStrategicPosture(neutral, allocation.posture);
      assert.deepEqual(profile.resources, expected.resources);
      assert.deepEqual(profile.priorities, expected.priorities);
      assert.equal(profile.commitmentRounds, expected.commitmentRounds);
      assert.equal(profile.settlementGoal, expected.settlementGoal);
      assert.ok(Object.values(profile.priorities).every(weight => Number.isFinite(weight) && weight > 0));
      assert.ok(Math.abs(profile.priorities.expansion + profile.priorities.construction - neutral.priorities.expansion - neutral.priorities.construction) < 1e-12);
      assert.ok(Math.abs(profile.priorities.trade + profile.priorities.civic - neutral.priorities.trade - neutral.priorities.civic) < 1e-12);
      assert.equal(profile.priorities.research, neutral.priorities.research);
      assert.equal(profile.priorities.recovery, neutral.priorities.recovery);
    }
  }
  assert.ok(seen.every(archetypes => archetypes.size > 1));
  assert.deepEqual([...postures].sort(), ['compact', 'measured', 'outward']);
  assert.deepEqual(BEHAVIOR_PROFILES, templates);
});

void test('posture transfers are compensating preferences without resource bonuses or erased common priorities', () => {
  for (const template of BEHAVIOR_PROFILES) {
    const compact = applyStrategicPosture(template, 'compact');
    const measured = applyStrategicPosture(template, 'measured');
    const outward = applyStrategicPosture(template, 'outward');
    assert.deepEqual(measured, template);
    assert.equal(compact.priorities.construction, template.priorities.construction + 0.15);
    assert.equal(compact.priorities.expansion, template.priorities.expansion - 0.15);
    assert.equal(compact.priorities.civic, template.priorities.civic + 0.15);
    assert.equal(compact.priorities.trade, template.priorities.trade - 0.15);
    assert.equal(outward.priorities.construction, template.priorities.construction - 0.15);
    assert.equal(outward.priorities.expansion, template.priorities.expansion + 0.15);
    assert.equal(outward.priorities.civic, template.priorities.civic - 0.15);
    assert.equal(outward.priorities.trade, template.priorities.trade + 0.15);
    for (const profile of [compact, measured, outward]) assert.deepEqual(profile.resources, template.resources);
    assert.equal(compact.settlementGoal, 3); assert.equal(compact.commitmentRounds, 7);
    assert.equal(outward.settlementGoal, 4); assert.equal(outward.commitmentRounds, 5);
  }
});

void test('only explicit supported origin plus Food selects v4 and old profiles remain literal defaults', () => {
  const state = createGeneratedWorld(73, epoch, 'settlement-food-budget-1');
  assert.equal(behaviorPolicyVersion(state), FOOD_BUDGET_BEHAVIOR_POLICY_VERSION);
  state.origin!.temperamentVersion = STRATEGIC_TEMPERAMENT_VERSION;
  assert.equal(behaviorPolicyVersion(state), TEMPERAMENT_BEHAVIOR_POLICY_VERSION);
  const withoutFood = structuredClone(state); withoutFood.unlockedFeatures = withoutFood.unlockedFeatures.filter(feature => feature !== 'food-budget');
  assert.equal(behaviorPolicyVersion(withoutFood), BEHAVIOR_POLICY_VERSION);
  const unknown = JSON.parse(JSON.stringify(state)) as WorldState;
  Reflect.set(unknown.origin!, 'temperamentVersion', 'strategic-temperaments-v99');
  assert.equal(behaviorPolicyVersion(unknown), FOOD_BUDGET_BEHAVIOR_POLICY_VERSION);
  for (let seat = 0; seat < 5; seat++) {
    const legacy = civilizationBehaviorProfile(73, seat);
    assert.equal(legacy.id, BEHAVIOR_PROFILES[seat]!.id);
    assert.deepEqual(legacy, civilizationBehaviorProfile(73, seat, BEHAVIOR_POLICY_VERSION));
    assert.deepEqual(legacy, civilizationBehaviorProfile(73, seat, FOOD_BUDGET_BEHAVIOR_POLICY_VERSION));
  }
  for (const [seed, seat] of [[NaN, 0], [0, -1], [0, 5], [0, 0.5], [Number.MAX_SAFE_INTEGER + 1, 0]])
    assert.throws(() => civilizationBehaviorProfile(seed!, seat!, TEMPERAMENT_BEHAVIOR_POLICY_VERSION), RangeError);
});

void test('exact seed-seat-policy allocation binds reload memory while unrelated RNG and names cannot reroll it', () => {
  const state = createGeneratedWorld(73, epoch, 'settlement-food-budget-1', 'cultural-toponyms-v1', STRATEGIC_TEMPERAMENT_VERSION);
  const before = structuredClone(state);
  const memories = state.civilizations.map(actor => createBehaviorMemory(state, actor.id));
  for (const memory of memories) {
    assert.ok(isBehaviorMemory(memory));
    assert.equal(memory.profileId, civilizationBehaviorProfile(state.seed, memory.seat, TEMPERAMENT_BEHAVIOR_POLICY_VERSION).id);
    assert.deepEqual(memory, createBehaviorMemory(JSON.parse(JSON.stringify(state)) as WorldState, memory.seat));
    assert.equal(isBehaviorMemory({ ...memory, profileId: memories[(memory.seat + 1) % 5]!.profileId }), false);
    assert.equal(isBehaviorMemory({ ...memory, profileId: 'scholars' }), false);
    assert.equal(isBehaviorMemory({ ...memory, policyVersion: 'weighted-civilizations-v99' }), false);
    assert.equal(isBehaviorMemory({ ...memory, policyVersion: FOOD_BUDGET_BEHAVIOR_POLICY_VERSION }), false);
    assert.throws(() => chooseCivilizationBehavior(state, memory.seat, { ...memory, profileId: 'scholars' }, epoch), RangeError);
  }
  const altered = structuredClone(state); altered.rng ^= 0x12345678;
  delete altered.origin!.namingVersion;
  for (const actor of altered.civilizations) actor.name = `Different ${actor.id}`;
  for (const city of altered.cities) city.name = `Different ${city.id}`;
  assert.deepEqual(altered.civilizations.map(actor => createBehaviorMemory(altered, actor.id)), memories);
  assert.deepEqual(state, before);
});
