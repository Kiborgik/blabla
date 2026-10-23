import { syntheticCurrentWorld } from './fixtures/current-world.ts';
import { createWorld } from '../core/engine.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWorldState } from '../core/validation.ts';

void test('fresh civic rules initialize empty independent lanes without earned progress', () => {
  const state = createWorld(1701, coastalPrefixTime(0), 'settlement-civic-bootstrap-1');
  assert.ok(isWorldState(state));
  assert.equal(state.revision, 0);
  for (const civilization of state.civilizations) {
    assert.deepEqual(civilization.civics, { ruleVersion: 1, completedCivicIds: [], active: null, lastCompleted: null, reformEntitlement: null });
    assert.deepEqual(civilization.government, { ruleVersion: 1, lastSpentReformCompletionEventId: null, active: null, pending: null });
    assert.deepEqual(civilization.technologies, []);
    assert.equal(civilization.researchProgress, 0);
    assert.deepEqual(civilization.resources, ECONOMY_RULES.initialResources);
  }
});

void test('civic selection is explicit, snapshots 16 Culture and spends no stored Culture or Science', () => {
  const state = civicWorld();
  const before = structuredClone(state);
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: actionTime(state), action: { type: 'choose-civic', civicId: 'code-of-laws' } });
  assert.ok(result.ok, result.error);
  assert.deepEqual(state, before);
  assert.deepEqual(result.state.civilizations[0]?.civics?.active, { civicId: 'code-of-laws', startedRound: state.round, progress: 0, requiredCulture: 16 });
  assert.deepEqual(result.state.civilizations[0]?.resources, state.civilizations[0]?.resources);
  assert.equal(result.state.civilizations[0]?.researchTarget, state.civilizations[0]?.researchTarget);
  const again = applyCommand(result.state, { seat: 0, expectedRevision: result.state.revision, timestamp: actionTime(result.state), action: { type: 'choose-civic', civicId: 'code-of-laws' } });
  assert.equal(again.ok, false);
  assert.equal(again.state, result.state);
});

void test('only current productive Culture funds the independent lane and completion grants one exact entitlement', () => {
  const state = civicWorld();
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: actionTime(state), action: { type: 'choose-civic', civicId: 'code-of-laws' } });
  assert.ok(result.ok, result.error);
  const idle = advance(state); const working = advance(result.state);
  const produced = idle.events.find(event => event.type === 'settlement-production' && event.actor === 0)?.effects.find(effect => effect.endsWith(' culture'));
  assert.ok(produced); const budget = Number(produced.split(' ')[1]);
  const invested = Math.min(16, budget, must(idle.state.civilizations[0]).resources.culture);
  assert.equal(must(working.state.civilizations[0]).resources.culture, round(must(idle.state.civilizations[0]).resources.culture - invested));
  assert.equal(must(working.state.civilizations[0]).resources.science, must(idle.state.civilizations[0]).resources.science);
  assert.equal(must(working.state.civilizations[0]).civics?.active?.progress ?? 16, invested);
  let current = working;
  for (let count = 0; count < 20 && must(current.state.civilizations[0]).civics?.active; count++) current = advance(current.state);
  const civic = must(must(current.state.civilizations[0]).civics);
  assert.deepEqual(civic.completedCivicIds, ['code-of-laws']);
  assert.equal(civic.active, null);
  const event = current.events.find(candidate => candidate.type === 'civic-completed' && candidate.actor === 0);
  assert.ok(event);
  assert.deepEqual(civic.reformEntitlement, { civicId: 'code-of-laws', completedRound: current.state.round, completionEventId: event.id });
  assert.deepEqual(civic.lastCompleted, { civicId: 'code-of-laws', completedRound: current.state.round, eventId: event.id });
  assert.equal(advance(current.state).events.filter(candidate => candidate.type === 'civic-completed' && candidate.actor === 0).length, 0);
});

import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import type { WorldState } from '../core/types.ts';
import { coastalPrefixTime } from './fixtures/coastal-prefix.ts';
let cached: WorldState | undefined;
function civicWorld(): WorldState {
  if (!cached) {
    cached = syntheticCurrentWorld('settlement-civic-bootstrap-1', { technologies: ['writing'], buildings: ['campus', 'library', 'granary'], population: 24 });
  }
  return structuredClone(cached);
}
function actionTime(state: WorldState): string { return coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10))); }
function advance(state: WorldState) { const result = catchUpStrategy(state, coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60)); assert.ok(result.ok, result.error); return result; }
function round(value: number): number { return Math.round(value * 100) / 100; }

void test('Chiefdom requires actual completion and atomically spends the latest entitlement for the explicit arrangement', () => {
  const empty = civicWorld(); const action = { type: 'adopt-government', governmentId: 'chiefdom', assignments: urban } as const;
  const denied = act(empty, action); assert.equal(denied.ok, false); assert.equal(denied.state, empty);
  const ready = completed(); const before = structuredClone(ready);
  const result = act(ready, action); assert.ok(result.ok, result.error); assert.deepEqual(ready, before);
  const actor = must(result.state.civilizations[0]);
  assert.deepEqual(actor.government, { ruleVersion: 1, lastSpentReformCompletionEventId: must(must(must(ready.civilizations[0]).civics).lastCompleted).eventId, active: { governmentId: 'chiefdom', assignments: urban, effectiveRound: ready.round, governmentLockUntilRound: ready.round + 4, policyLockUntilRound: ready.round + 4 }, pending: null });
  assert.equal(actor.civics?.reformEntitlement, null); assert.equal(actor.resources.credits, must(ready.civilizations[0]).resources.credits);
  assert.equal(act(result.state, action).ok, false);
  assert.equal(act(result.state, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] }).ok, false);
});

void test('Chiefdom Food and Urban planning work apply at the next opening before productivity and rounding', () => {
  const ready = completed(); const arranged = act(ready, { type: 'adopt-government', governmentId: 'chiefdom', assignments: urban }); assert.ok(arranged.ok, arranged.error);
  const before = advance(ready); const after = advance(arranged.state);
  const expected = ready.cities.filter(city => city.civId === 0).reduce((sum, city) => sum + round(cityProductivity(city)), 0);
  const food = (result: ReturnType<typeof advance>) => Number(result.events.find(event => event.type === 'settlement-production' && event.actor === 0)?.effects[0]?.split(' ')[1]);
  assert.equal(round(food(after) - food(before)), round(expected));
  for (const city of arranged.state.cities.filter(candidate => candidate.civId === 0)) assert.equal(constructionWork(arranged.state, city), round(((city.focus === 'industry' ? 2 : 1) + 1) * cityProductivity(city)));
  assert.equal(must(after.state.civilizations[0]).resources.science, must(before.state.civilizations[0]).resources.science);
});

void test('paid reslot honors the four-beat lock, costs exactly eight Credits, and preserves the government lock', () => {
  let state = act(completed(), { type: 'adopt-government', governmentId: 'chiefdom', assignments: urban }).state;
  const original = must(must(must(state.civilizations[0]).government).active);
  for (let count = 0; count < 4; count++) state = advance(state).state;
  const credits = must(state.civilizations[0]).resources.credits;
  const result = act(state, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] }); assert.ok(result.ok, result.error);
  assert.equal(must(result.state.civilizations[0]).resources.credits, round(credits - 8));
  assert.equal(must(must(must(result.state.civilizations[0]).government).active).governmentLockUntilRound, original.governmentLockUntilRound);
  assert.equal(must(must(must(result.state.civilizations[0]).government).active).policyLockUntilRound, state.round + 4);
});

import { constructionWork } from '../core/simulation/construction.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import type { GameAction, PolicyAssignment } from '../core/types.ts';
const urban: PolicyAssignment[] = [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }];
function act(state: WorldState, action: GameAction) { return applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: actionTime(state), action }); }
function completed(): WorldState { let result = act(civicWorld(), { type: 'choose-civic', civicId: 'code-of-laws' }); assert.ok(result.ok, result.error); for (let count = 0; count < 20 && must(result.state.civilizations[0]).civics?.active; count++) result = advance(result.state); assert.equal(must(result.state.civilizations[0]).civics?.active, null); return result.state; }

void test('synthetic advanced-government switch retains two opening beats, exact payment and both locks', () => {
  GOVERNMENTS.push({ id: 'synthetic-council', name: 'Synthetic transition control', requiredFeatures: ['civic-bootstrap'], requires: ['code-of-laws'], slots: { military: 0, economic: 1, diplomatic: 0, wildcard: 0 }, baseProduction: { food: 3 } });
  try {
    let state = act(completed(), { type: 'adopt-government', governmentId: 'chiefdom', assignments: urban }).state;
    for (let count = 0; count < 4; count++) state = advance(state).state;
    const switched = act(state, { type: 'adopt-government', governmentId: 'synthetic-council', assignments: [] }); assert.ok(switched.ok, switched.error);
    assert.equal(must(switched.state.civilizations[0]).resources.credits, round(must(state.civilizations[0]).resources.credits - 10));
    assert.equal(must(must(must(switched.state.civilizations[0]).government).active).governmentId, 'chiefdom');
    assert.deepEqual(must(must(switched.state.civilizations[0]).government).pending, { targetGovernmentId: 'synthetic-council', targetAssignments: [], acceptedRound: state.round, completionRound: state.round + 2, paidCredits: 10, spentCompletionEventId: null });
    assert.equal(act(switched.state, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] }).ok, false);
    const first = advance(switched.state); assert.equal(must(must(must(first.state.civilizations[0]).government).active).governmentId, 'chiefdom');
    const second = advance(first.state); assert.equal(must(must(must(second.state.civilizations[0]).government).active).governmentId, 'synthetic-council');
    const active = must(must(must(second.state.civilizations[0]).government).active);
    assert.equal(active.effectiveRound, state.round + 2); assert.equal(active.governmentLockUntilRound, state.round + 6); assert.equal(active.policyLockUntilRound, state.round + 6);
    assert.equal(must(must(second.state.civilizations[0]).government).pending, null);
    assert.equal(second.events.filter(event => event.type === 'transition-completed').length, 1);
    assert.equal(advance(second.state).events.filter(event => event.type === 'transition-completed').length, 0);
    const reslot = act(state, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] }); assert.ok(reslot.ok, reslot.error);
    assert.equal(act(reslot.state, { type: 'adopt-government', governmentId: 'synthetic-council', assignments: urban }).ok, false);
  } finally { GOVERNMENTS.pop(); }
});

void test('synthetic transition applies once to six ordinary outputs and cumulative paid receipts, preserving fixed inputs and strategic extraction', () => {
  let state = act(completed(), { type: 'adopt-government', governmentId: 'chiefdom', assignments: urban }).state;
  for (let count = 0; count < 4; count++) state = advance(state).state;
  must(must(state.civilizations[0]).government).pending = { targetGovernmentId: 'chiefdom', targetAssignments: [], acceptedRound: state.round, completionRound: state.round + 2, paidCredits: 10, spentCompletionEventId: null };
  const opening = structuredClone(state); opening.round++;
  const expected = structuredClone(opening); allocateOperations(expected);
  const produced = new Map<string, Partial<Resources>>();
  const receipts = new Map<string, Partial<Resources>>();
  for (const city of expected.cities.filter(candidate => candidate.civId === 0)) {
    const productivity = cityProductivity(city);
    const buildings = productiveBuildings(expected, city);
    const free = buildings.filter(building => !paidRecipe(building)); const paid = buildings.filter(paidRecipe);
    const site = siteProduction(expected, must(expected.tiles.find(tile => tile.id === city.tileId)));
    const totals: Partial<Resources> = {};
    for (const resource of RESOURCE_IDS) {
      let raw = (ECONOMY_RULES.baseProduction[resource] ?? 0) + (resource === 'food' ? 1 : 0) + ((ECONOMY_RULES.focusProduction[city.focus] as Partial<Resources>)[resource] ?? 0) + (site[resource] ?? 0) + (wonderBaseProduction(expected, city)[resource] ?? 0) + free.reduce((sum, building) => sum + (buildingBaseProduction(expected, city, building)[resource] ?? 0), 0);
      let amount = round(raw * productivity * 0.75);
      for (const building of paid) { raw += building.production[resource] ?? 0; const next = round(raw * productivity * 0.75); const values = receipts.get(`${city.id}:${building.id}`) ?? {}; if (round(next - amount) > 0) values[resource] = round(next - amount); receipts.set(`${city.id}:${building.id}`, values); amount = next; }
      for (const improvement of orderedImprovements(city).filter(item => item.operation.lastResult?.status === 'operated')) { raw += IMPROVEMENTS.find(item => item.id === improvement.improvementId)?.production[resource] ?? 0; const next = round(raw * productivity * 0.75); const values = receipts.get(`${city.id}:tile:${improvement.tileId}`) ?? {}; if (round(next - amount) > 0) values[resource] = round(next - amount); receipts.set(`${city.id}:tile:${improvement.tileId}`, values); amount = next; }
      totals[resource] = amount;
    }
    produced.set(city.id, totals);
  }
  const result = advance(state);
  for (const city of result.state.cities.filter(candidate => candidate.civId === 0)) {
    for (const [id, operation] of Object.entries(city.buildingOperations ?? {})) if (operation.lastResult?.status === 'operated') { assert.deepEqual(operation.lastResult.produced, receipts.get(`${city.id}:${id}`)); assert.deepEqual(operation.lastResult.paid, must(must(must(must(expected.cities.find(candidate => candidate.id === city.id)).buildingOperations)[id]).lastResult).paid); }
    for (const improvement of orderedImprovements(city).filter(item => item.operation.lastResult?.status === 'operated')) assert.deepEqual(must(improvement.operation.lastResult).produced, receipts.get(`${city.id}:tile:${improvement.tileId}`));
  }
  const production = must(result.events.find(event => event.type === 'settlement-production' && event.actor === 0));
  for (const resource of ['food', 'science', 'culture'] as const) assert.ok(production.effects.includes(`Produced ${round([...produced.values()].reduce((sum, output) => sum + (output[resource] ?? 0), 0))} ${resource}`));
  const unpenalized = structuredClone(state); must(must(unpenalized.civilizations[0]).government).pending = null; const control = advance(unpenalized);
  assert.deepEqual(result.events.filter(event => event.strategicExtraction).map(event => event.strategicExtraction), control.events.filter(event => event.strategicExtraction).map(event => event.strategicExtraction));
  assert.deepEqual(result.events.filter(event => /trade|shipment/.test(event.type)), control.events.filter(event => /trade|shipment/.test(event.type)));
});

void test('invalid civic and arrangement cases are zero-effect and strict action parsing rejects caller economics', () => {
  const start = civicWorld(); const ready = completed();
  const cases: Array<[WorldState, GameAction]> = [[start, { type: 'choose-civic', civicId: 'invented' }], [ready, { type: 'choose-civic', civicId: 'code-of-laws' }], [ready, { type: 'adopt-government', governmentId: 'invented', assignments: [] }], ...[
    [{ slotType: 'military' as const, slotIndex: 0, policyId: 'urban-planning' }],
    [{ slotType: 'economic' as const, slotIndex: 1, policyId: 'urban-planning' }],
    [...urban, ...urban],
    [{ slotType: 'economic' as const, slotIndex: 0, policyId: 'invented' }],
  ].map(assignments => [ready, { type: 'adopt-government' as const, governmentId: 'chiefdom', assignments }] as [WorldState, GameAction])];
  const poor = structuredClone(ready); must(must(poor.civilizations[0]).civics).reformEntitlement = null; must(poor.civilizations[0]).resources.credits = 9.99; cases.push([poor, { type: 'adopt-government', governmentId: 'chiefdom', assignments: urban }]);
  const forged = structuredClone(ready); must(must(must(forged.civilizations[0]).civics).reformEntitlement).completionEventId = 'invented'; cases.push([forged, { type: 'adopt-government', governmentId: 'chiefdom', assignments: urban }]);
  for (const [state, action] of cases) { const before = structuredClone(state); const result = act(state, action); assert.equal(result.ok, false, JSON.stringify(action)); assert.equal(result.state, state); assert.deepEqual(state, before); assert.deepEqual(result.events, []); }
  assert.equal(isGameAction({ type: 'choose-civic', civicId: 'code-of-laws', cost: 0 }), false);
  assert.equal(isGameAction({ type: 'adopt-government', governmentId: 'chiefdom', assignments: urban, credits: 0 }), false);
  assert.equal(isGameAction({ type: 'adopt-government', governmentId: 'chiefdom', assignments: [{ ...urban[0], extra: true }] }), false);
});

void test('zero current Culture cannot spend an old bank and remaining obligations cap actual investment', () => {
  const state = act(civicWorld(), { type: 'choose-civic', civicId: 'code-of-laws' }).state; state.round++;
  const before = structuredClone(state); resolveCivics(state, 0, 0, []); assert.deepEqual(state, before);
  must(state.civilizations[0]).resources.culture = 1.25; const events: GameEvent[] = []; resolveCivics(state, 0, 12, events);
  assert.equal(must(must(must(state.civilizations[0]).civics).active).progress, 1.25); assert.equal(must(state.civilizations[0]).resources.culture, 0); assert.deepEqual(events, []);
});

import { GOVERNMENTS, ECONOMY_RULES, RESOURCE_IDS, IMPROVEMENTS } from '../core/content.ts';
import { isGameAction } from '../core/planning.ts';
import { resolveCivics } from '../core/simulation/civics.ts';
import { orderedImprovements } from '../core/simulation/improvements.ts';
import { allocateOperations, productiveBuildings, paidRecipe } from '../core/simulation/operations.ts';
import { siteProduction } from '../core/simulation/sites.ts';
import { wonderBaseProduction } from '../core/simulation/wonders.ts';
import { buildingBaseProduction } from '../core/simulation/districts.ts';
import type { Resources, GameEvent } from '../core/types.ts';

function must<T>(value: T | null | undefined): T { if (value === null || value === undefined) throw new RangeError("Required civic fact is missing"); return value; }

void test('consumed reform remains unavailable after event pruning and exact JSON restart', () => {
  const ready = completed(); const token = structuredClone(must(must(ready.civilizations[0]).civics).reformEntitlement);
  let state = act(ready, { type: 'adopt-government', governmentId: 'chiefdom', assignments: urban }).state;
  for (let count = 0; count < 4; count++) state = advance(state).state;
  assert.ok(token); state.events = [];
  const restored: unknown = JSON.parse(JSON.stringify(state)); assert.ok(isWorldState(restored)); state = restored;
  assert.equal(must(must(state.civilizations[0]).government).lastSpentReformCompletionEventId, token.completionEventId);
  must(must(state.civilizations[0]).civics).reformEntitlement = token;
  const before = structuredClone(state); const result = act(state, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] });
  assert.equal(result.ok, false); assert.equal(result.state, state); assert.deepEqual(state, before); assert.deepEqual(result.events, []);
});

void test('canonical civic facts expose the independent lane, exact arrangement and local work without shared mutation', () => {
  const state = civicWorld(); const time = actionTime(state); const observation = observe(state, 0, time);
  assert.equal(observation.decisions?.civic?.status, 'required'); assert.deepEqual(observation.decisions?.civic?.availableIds, ['code-of-laws']);
  assert.equal(observation.governance?.government?.active, null);
  const arranged = act(completed(), { type: 'adopt-government', governmentId: 'chiefdom', assignments: urban }).state;
  const city = must(arranged.cities.find(candidate => candidate.civId === 0)); const projection = projectCapabilities(arranged, 0, city.id, actionTime(arranged));
  assert.equal(projection.governance?.modifiers.constructionWork, 1); assert.equal(projection.governance?.modifiers.baseProduction.food, 1);
  assert.equal(projection.governance?.cityConstructionWork, constructionWork(arranged, city));
  assert.deepEqual(projection.governance?.government, must(arranged.civilizations[0]).government);
  const retained = structuredClone(arranged); if (projection.governance?.government) projection.governance.government.active = null; assert.deepEqual(arranged, retained);
});

import { observe } from '../core/engine.ts';
import { projectCapabilities } from '../core/capabilities.ts';

void test('civic content registration validates bounded slots, productive policies and civic prerequisite graphs', () => {
  const catalogue = structuredClone(CONTENT);
  assert.deepEqual(validateContent(catalogue), []);
  assert.ok(catalogue.governments && catalogue.policies && catalogue.civics, 'Civic definitions belong to validated content');
  const government = catalogue.governments[0]; assert.ok(government); government.slots.economic = 17;
  assert.ok(validateContent(catalogue).some(error => error.includes('slots')));
  const policy = catalogue.policies[0]; assert.ok(policy); policy.requires = ['missing-civic'];
  assert.ok(validateContent(catalogue).some(error => error.includes('missing-civic')));
  const civic = catalogue.civics[0]; assert.ok(civic); civic.requires = [civic.id];
  assert.ok(validateContent(catalogue).some(error => error.includes('cycle')));
});

import { CONTENT, validateContent } from '../core/content.ts';
