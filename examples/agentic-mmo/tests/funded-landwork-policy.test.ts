import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLandworkPlanner } from '../core/behavior-landwork.ts';
import { FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION, TEMPERAMENT_BEHAVIOR_POLICY_VERSION, behaviorDrawVersion, civilizationBehaviorProfile } from '../core/behavior-profiles.ts';
import { deriveProgressionPlan, progressionAcquisitionPurpose, progressionWeight } from '../core/behavior-progression.ts';
import { assessCivilizationBehavior, chooseCivilizationBehavior, chooseDirectorBehavior, createBehaviorMemory, isBehaviorMemory, type BehaviorMemory } from '../core/behaviors.ts';
import { RESOURCE_IDS } from '../core/content.ts';
import { applyCommand, legalActions } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { decisionObligations } from '../core/simulation/decisions.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { STRATEGIC_TEMPERAMENT_VERSION } from '../core/strategic-temperaments.ts';
import type { ActionOption, GameAction, Resources, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const optionsAt = (state: WorldState, seconds = 30): ActionOption[] => legalActions(state, 0, at(seconds));
function act(state: WorldState, action: GameAction, seconds: number): WorldState {
  const result = applyCommand(state, { seat: 0, action, expectedRevision: state.revision, timestamp: at(seconds) });
  assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state)); return result.state;
}
function fixture(busy = true) {
  let state = createGeneratedWorld(73, epoch, 'settlement-funded-landwork-1', undefined, STRATEGIC_TEMPERAMENT_VERSION);
  const actor = state.civilizations[0]!; const city = state.cities.find(item => item.civId === 0)!; const center = state.tiles[city.tileId]!;
  actor.resources = { food: 500, materials: 200, energy: 200, credits: 200, science: 0, culture: 0 };
  actor.technologies = ['agriculture', 'kiln-firing', 'mining']; city.population = 5; city.focus = 'industry';
  const reserved = new Set([...state.strategicDeposits!.tileIds, ...state.coalDeposits!.tileIds, ...state.pastoralSites!.tileIds, ...state.cities.map(item => item.tileId)]);
  const neighbors = state.tiles.filter(tile => tile.owner === 0 && !reserved.has(tile.id) && tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && hexDistance(center, tile) === 1).toSorted((a, b) => a.id - b.id);
  const work = neighbors[0]; const purchase = neighbors[1]; assert.ok(work && purchase);
  for (const tile of state.tiles) if (hexDistance(center, tile) <= 3 && tile.id !== center.id) {
    if (!reserved.has(tile.id)) tile.elevation = 40;
    else if (tile.owner === 0 && tile.elevation >= 70 && tile.elevation <= 88) tile.owner = 1;
  }
  work.terrain = 'grassland'; work.elevation = busy ? 75 : 40;
  purchase.terrain = 'grassland'; purchase.elevation = 75; purchase.owner = null;
  assert.ok(isWorldState(state));
  if (busy) state = act(state, { type: 'improve', cityId: city.id, tileId: work.id, improvementId: 'mine' }, 0);
  state = act(state, { type: 'research', technology: 'writing' }, 10);
  const civic = legalActions(state, 0, at(20)).find(option => option.action.type === 'choose-civic'); assert.ok(civic);
  state = act(state, civic.action, 20);
  return { state, cityId: city.id, tileId: purchase.id, workTileId: work.id };
}
function assessed(state: WorldState, options = optionsAt(state), memory = createBehaviorMemory(state, 0)) {
  return assessCivilizationBehavior(state, 0, memory, options);
}
function purchaseCandidate(state: WorldState, tileId: number, options = optionsAt(state)) {
  const candidate = assessed(state, options).candidates.find(item => item.option.action.type === 'acquire-tile' && item.option.action.tileId === tileId);
  assert.ok(candidate); return candidate;
}

void test('funded exact next-use land reaches the ordinary pool behind retained paid work without a forced lane or weight floor', () => {
  const { state, cityId, tileId } = fixture(); const before = structuredClone(state);
  const obligations = decisionObligations(state, 0);
  assert.equal(obligations.research.status, 'active'); assert.equal(obligations.civic?.status, 'active');
  assert.equal(obligations.construction.find(item => item.cityId === cityId)?.status, 'active');
  const candidate = purchaseCandidate(state, tileId);
  assert.ok(candidate.weight > 0); assert.equal(candidate.lane, null); assert.equal(candidate.urgent, false); assert.equal(candidate.protected, false);
  const quotes = createLandworkPlanner(state, 0).quote(cityId, tileId).quotes;
  const quote = quotes.find(item => item.action.type === 'improve' && item.action.improvementId === 'mine'); assert.ok(quote);
  assert.equal(quote.orderId, state.cities.find(item => item.id === cityId)!.construction!.active!.id);
  assert.ok(quote.waitBeats > 0 && quote.waitBeats <= 2); assert.ok(quote.firstOperationBeat <= 8);
  assert.equal(quote.acquisitionDelayBeats, 1); assert.equal(quote.startDelayBeats, quote.waitBeats);
  const profile = civilizationBehaviorProfile(state.seed, 0, FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION);
  const value = (resources: Partial<Resources>): number => RESOURCE_IDS.reduce((sum, resource) => sum + (resources[resource] ?? 0) * profile.resources[resource], 0);
  const expected = 2 * (value(quote.marginalOutput) - value(quote.operatingInputs)) * profile.priorities.expansion
    / (1 + (value(quote.acquisitionCost) + value(quote.setupCost)) / 80) / (1 + quote.firstOperationBeat) * 0.5;
  assert.equal(candidate.weight, expected);
  assert.equal(assessed(state).candidates.filter(item => item.option.action.type === 'acquire-tile' && item.weight > 0).length, 1);
  assert.deepEqual(state, before);
});

void test('a fixed conditional decision corpus selects legal purchases with exact intended use and non-guaranteed timing', context => {
  const { state, cityId, tileId } = fixture(); const before = structuredClone(state);
  const decisions = Array.from({ length: 64 }, (_, decisionCount) => chooseCivilizationBehavior(state, 0, {
    ...createBehaviorMemory(state, 0), decisionCount, focusLocks: [{ cityId, focus: 'industry', untilRound: 6 }],
  }, at(30)));
  context.diagnostic(JSON.stringify({ conditionalFixtureOnly: true, seed: state.seed, cursors: decisions.length, counts: Object.fromEntries([...new Set(decisions.map(item => item.action?.type ?? 'none'))].map(type => [type, decisions.filter(item => (item.action?.type ?? 'none') === type).length])) }));
  const selected = decisions.find(decision => decision.action?.type === 'acquire-tile' && decision.action.tileId === tileId); assert.ok(selected);
  context.diagnostic(JSON.stringify({ selectedAction: selected.action, reason: selected.explanation.reason }));
  assert.equal(selected.explanation.required, false);
  assert.match(selected.explanation.reason, new RegExp(`Mine.*tile ${tileId}.*${cityId}`));
  assert.match(selected.explanation.reason, /Conditional first operation within 5 beats if this work is chosen next and conditions hold/);
  assert.doesNotMatch(selected.explanation.reason, /will (produce|complete)|guaranteed|earned|income received/i);
  const quote = createLandworkPlanner(state, 0).quote(cityId, tileId).quotes[0]!;
  assert.ok(selected.explanation.reason.includes(String(quote.firstOperationBeat)));
  assert.ok(selected.action); const purchased = act(state, selected.action, 30);
  assert.deepEqual(purchased.cities, state.cities);
  assert.deepEqual(purchased.civilizations[0]!.resources, { ...state.civilizations[0]!.resources, credits: state.civilizations[0]!.resources.credits - quote.acquisitionCost.credits! });
  assert.equal(purchased.tiles[tileId]!.owner, 0); assert.deepEqual(state, before);
});

void test('idle acquisition copy separates conservative command admission from nonexistent paid work', context => {
  const { state, cityId, tileId } = fixture(false); const city = state.cities.find(item => item.id === cityId)!;
  city.buildings.push('farm', 'workshop', 'kiln'); city.buildingOperations = { kiln: { enabled: false, lastResult: null } };
  assert.ok(isWorldState(state)); assert.equal(decisionObligations(state, 0).construction.find(item => item.cityId === cityId)?.status, 'blocked');
  const quote = createLandworkPlanner(state, 0).quote(cityId, tileId).quotes[0]; assert.ok(quote);
  assert.equal(quote.orderId, null); assert.equal(quote.waitBeats, 0); assert.equal(quote.acquisitionDelayBeats, 1); assert.equal(quote.startDelayBeats, 1);
  assert.equal(quote.firstOperationBeat, quote.startDelayBeats + quote.workBeats + 1);
  const before = structuredClone(state);
  const decisions = Array.from({ length: 64 }, (_, decisionCount) => chooseCivilizationBehavior(state, 0, {
    ...createBehaviorMemory(state, 0), decisionCount, focusLocks: [{ cityId, focus: 'industry', untilRound: 6 }],
  }, at(30)));
  context.diagnostic(JSON.stringify({ conditionalIdleFixtureOnly: true, seed: state.seed, cursors: decisions.length, counts: Object.fromEntries([...new Set(decisions.map(item => item.action?.type ?? 'none'))].map(type => [type, decisions.filter(item => (item.action?.type ?? 'none') === type).length])) }));
  const selected = decisions.find(decision => decision.action?.type === 'acquire-tile' && decision.action.tileId === tileId); assert.ok(selected);
  context.diagnostic(JSON.stringify({ selectedIdleAction: selected.action, reason: selected.explanation.reason }));
  assert.match(selected.explanation.reason, /allow up to 1 beat for command admission/);
  assert.doesNotMatch(selected.explanation.reason, /retain paid work/);
  assert.match(selected.explanation.reason, new RegExp(`Conditional first operation within ${quote.firstOperationBeat} beats if this work is chosen next and conditions hold`));
  assert.match(selected.explanation.reason, /next work is not automatic/); assert.deepEqual(state, before);
});

void test('required research and emergency damage still preempt funded optional acquisition without replacing paid construction', () => {
  const { state, cityId, tileId } = fixture(); const paid = structuredClone(state.cities.find(item => item.id === cityId)!.construction);
  const required = structuredClone(state); required.civilizations[0]!.researchTarget = '';
  assert.ok(purchaseCandidate(required, tileId).weight > 0);
  const decision = chooseCivilizationBehavior(required, 0, undefined, at(30));
  assert.equal(decision.action?.type, 'research'); assert.equal(decision.explanation.required, true);
  const emergency = structuredClone(state); emergency.cities.find(item => item.id === cityId)!.damage = 30;
  const repair = chooseCivilizationBehavior(emergency, 0, undefined, at(30));
  assert.deepEqual(repair.action, { type: 'repair-city', cityId }); assert.equal(repair.explanation.required, false);
  const hungry = structuredClone(state); hungry.civilizations[0]!.resources.food = 0;
  assert.equal(purchaseCandidate(hungry, tileId).weight, 0);
  assert.deepEqual(required.cities.find(item => item.id === cityId)!.construction, paid);
  assert.deepEqual(emergency.cities.find(item => item.id === cityId)!.construction, paid);
  const idle = fixture(false); assert.ok(purchaseCandidate(idle.state, idle.tileId).weight > 0);
  const building = chooseCivilizationBehavior(idle.state, 0, undefined, at(30));
  assert.equal(building.action?.type, 'build'); assert.equal(building.explanation.required, true);
});

void test('unsupported land or unaffordable exact work scores zero instead of crediting a bought tile town-center yield', () => {
  const { state, cityId, tileId } = fixture();
  for (const mutate of [
    (value: WorldState) => { value.tiles[tileId]!.elevation = 40; },
    (value: WorldState) => { value.civilizations[0]!.resources.materials = 5; },
    (value: WorldState) => { value.cities.find(item => item.id === cityId)!.population = 4; },
    (value: WorldState) => { value.civilizations[0]!.technologies = ['agriculture']; },
  ]) {
    const refused = structuredClone(state); mutate(refused);
    assert.equal(createLandworkPlanner(refused, 0).quote(cityId, tileId).quotes.length, 0);
    assert.equal(purchaseCandidate(refused, tileId).weight, 0);
  }
  const legacy = structuredClone(state); legacy.unlockedFeatures = legacy.unlockedFeatures.filter(feature => feature !== 'funded-landwork-planning'); legacy.tiles[tileId]!.elevation = 40;
  assert.equal(createBehaviorMemory(legacy, 0).policyVersion, TEMPERAMENT_BEHAVIOR_POLICY_VERSION);
  assert.ok(purchaseCandidate(legacy, tileId).weight > 0);
});

void test('an equally useful funded owned site defeats another purchase even while the same paid lane remains busy', () => {
  const { state, cityId, tileId } = fixture();
  const options = optionsAt(state); const purchase = options.find(option => option.action.type === 'acquire-tile' && option.action.tileId === tileId); assert.ok(purchase);
  const owned = act(state, purchase.action, 30); const ownedQuote = createLandworkPlanner(owned, 0).owned(cityId).find(item => item.tileId === tileId); assert.ok(ownedQuote);
  assert.deepEqual(ownedQuote.acquisitionCost, {}); assert.equal(ownedQuote.orderId, state.cities.find(item => item.id === cityId)!.construction!.active!.id);
  const extra = owned.tiles.find(tile => tile.owner === null && tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && hexDistance(tile, owned.tiles[tileId]!) === 1
    && hexDistance(tile, owned.tiles[owned.cities.find(item => item.id === cityId)!.tileId]!) <= 3
    && ![...owned.strategicDeposits!.tileIds, ...owned.coalDeposits!.tileIds, ...owned.pastoralSites!.tileIds].includes(tile.id)); assert.ok(extra);
  extra.elevation = 75;
  assert.ok(createLandworkPlanner(owned, 0).quote(cityId, extra.id).quotes.length > 0);
  assert.equal(purchaseCandidate(owned, extra.id, optionsAt(owned, 40)).weight, 0);
  assert.deepEqual(owned.cities.find(item => item.id === cityId)!.construction, state.cities.find(item => item.id === cityId)!.construction);
});

void test('dedicated Rail and scarce strategic extraction retain their previous separate valuation and zero gate', () => {
  const { state, tileId } = fixture(); const actor = state.civilizations[0]!; const profile = civilizationBehaviorProfile(state.seed, 0, FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION);
  const option = optionsAt(state).find(item => item.action.type === 'acquire-tile' && item.action.tileId === tileId); assert.ok(option);
  const plan = deriveProgressionPlan(state, actor, profile, [option]);
  const rail = { ...plan, usefulRailTiles: new Set([tileId]) };
  assert.equal(progressionAcquisitionPurpose(option.action, actor, rail), 'rail');
  assert.equal(progressionWeight(option, 5, state, actor, profile, rail), 60);
  assert.equal(progressionWeight(option, 90, state, actor, profile, rail), 90);
  assert.equal(progressionWeight(option, 0, state, actor, profile, rail), 0);
  const deposit = { ...rail, deposits: new Map([[tileId, { tileId, resource: 'iron' as const, initialReserve: 100, remaining: 100 }]]) };
  assert.equal(progressionAcquisitionPurpose(option.action, actor, deposit), 'strategic-extraction');
  assert.equal(progressionWeight(option, 5, state, actor, profile, deposit), 80);
  assert.equal(progressionWeight(option, 90, state, actor, profile, deposit), 90);
  assert.equal(progressionWeight(option, 0, state, actor, profile, deposit), 0);
  assert.equal(progressionAcquisitionPurpose(option.action, actor, plan), null);
  assert.equal(progressionWeight(option, 5, state, actor, profile, plan), 2.5);
});

void test('a separately revealed scarce deposit keeps its legacy acquisition value when ordinary setup is insolvent', () => {
  const { state, tileId, cityId } = fixture(); const actor = state.civilizations[0]!;
  actor.technologies.push('bronze-working'); actor.resources.materials = 5;
  const layer = state.strategicDeposits!; const previous = layer.tileIds[0]!; const deposit = layer.deposits[String(previous)]!;
  layer.tileIds[0] = tileId; delete layer.deposits[String(previous)]; layer.deposits[String(tileId)] = { ...deposit, tileId };
  assert.equal(createLandworkPlanner(state, 0).quote(cityId, tileId).quotes.length, 0);
  const legacy = structuredClone(state); legacy.unlockedFeatures = legacy.unlockedFeatures.filter(feature => feature !== 'funded-landwork-planning');
  const current = purchaseCandidate(state, tileId); const old = purchaseCandidate(legacy, tileId);
  assert.equal(current.weight, old.weight); assert.ok(current.weight >= 80);
});

void test('current memory and decision restart are deterministic without persisted landwork intentions or Director reseeding', () => {
  const { state } = fixture(); const memory = createBehaviorMemory(state, 0); const before = structuredClone(state);
  assert.equal(memory.policyVersion, FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION); assert.ok(isBehaviorMemory(memory));
  assert.equal(Object.hasOwn(memory, 'landwork'), false); assert.equal(Object.hasOwn(memory, 'landworkPlan'), false);
  const restored = JSON.parse(JSON.stringify(state)) as WorldState; const restoredMemory = JSON.parse(JSON.stringify(memory)) as BehaviorMemory;
  assert.deepEqual(chooseCivilizationBehavior(restored, 0, restoredMemory, at(30)), chooseCivilizationBehavior(state, 0, memory, at(30)));
  assert.deepEqual(assessed(restored), assessed(state)); assert.deepEqual(state, before);
  const legacy = structuredClone(state); legacy.unlockedFeatures = legacy.unlockedFeatures.filter(feature => feature !== 'funded-landwork-planning');
  assert.deepEqual(civilizationBehaviorProfile(state.seed, 0, FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION), civilizationBehaviorProfile(state.seed, 0, TEMPERAMENT_BEHAVIOR_POLICY_VERSION));
  assert.equal(behaviorDrawVersion(FUNDED_LANDWORK_BEHAVIOR_POLICY_VERSION), behaviorDrawVersion(TEMPERAMENT_BEHAVIOR_POLICY_VERSION));
  const currentDirector = chooseDirectorBehavior(state, undefined, at(30)); const oldDirector = chooseDirectorBehavior(legacy, undefined, at(30));
  assert.deepEqual({ ...currentDirector, memory: { ...currentDirector.memory, policyVersion: oldDirector.memory.policyVersion } }, oldDirector);
});
