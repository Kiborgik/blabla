import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CIVICS, GOVERNMENTS, validateContent } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { RELEASES } from '../core/release.ts';
import { constructionWork, openingConstructionWork } from '../core/simulation/construction.ts';
import { civicActionBlock } from '../core/simulation/civics.ts';
import { governmentModifiers, observedGovernment } from '../core/simulation/government.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import type { ConstructionOrder, WorldState } from '../core/types.ts';

const branch = [
  ['craftsmanship', 22, ['code-of-laws']],
  ['foreign-trade', 24, ['code-of-laws']],
  ['early-empire', 30, ['foreign-trade']],
  ['state-workforce', 40, ['craftsmanship', 'early-empire']],
  ['political-philosophy', 48, ['state-workforce', 'foreign-trade']],
] as const;
const q = (value: number): number => Math.round(value * 100) / 100;

function syntheticGovernment(): WorldState {
  const state = createWorld(41); state.unlockedFeatures.push('civic-bootstrap', 'second-government', 'recurring-decisions');
  const actor = state.civilizations[0]; const city = state.cities[0]; assert.ok(actor && city);
  actor.civics = { ruleVersion: 1, completedCivicIds: ['code-of-laws', ...branch.map(([id]) => id)], active: null, lastCompleted: null, reformEntitlement: null };
  actor.government = { ruleVersion: 1, lastSpentReformCompletionEventId: null, active: { governmentId: 'autocracy', assignments: [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }], effectiveRound: 0, governmentLockUntilRound: 4, policyLockUntilRound: 4 }, pending: null };
  city.focus = 'growth'; city.wellbeing = 71.7; city.infrastructure = 0; city.damage = 0;
  return state;
}

void test('second government catalogue keeps the accepted branch, costs, slots and additive gate', () => {
  for (const [id, cost, requires] of branch) {
    const civic = CIVICS.find(candidate => candidate.id === id); assert.ok(civic, `Missing civic ${id}`);
    assert.equal(civic.cost, cost); assert.deepEqual(civic.requires, requires);
    assert.deepEqual(civic.requiredFeatures, ['civic-bootstrap', 'second-government']); assert.equal(Reflect.get(civic, 'minEra'), undefined);
  }
  const autocracy = GOVERNMENTS.find(candidate => candidate.id === 'autocracy'); assert.ok(autocracy);
  assert.deepEqual(autocracy.requires, ['political-philosophy']); assert.deepEqual(autocracy.slots, { military: 2, economic: 1, diplomatic: 0, wildcard: 1 });
  assert.deepEqual(autocracy.baseProduction, {}); assert.equal(Reflect.get(autocracy, 'capitalConstructionWorkPercent'), 15);
  assert.deepEqual(GOVERNMENTS.map(candidate => candidate.id), ['chiefdom', 'autocracy']); assert.deepEqual(validateContent(), []);
  const release = RELEASES.find(candidate => candidate.id === 'settlement-second-government-1'); assert.ok(release);
  assert.ok(release.featureIds.includes('second-government'));
});

void test('synthetic capital work adds policy work before productivity and rounds only after the fifteen-percent bonus', () => {
  const state = syntheticGovernment(); const city = state.cities[0]; assert.ok(city);
  const base = 2 * cityProductivity(city); assert.notEqual(q(base * 1.15), q(q(base) * 1.15));
  assert.equal(constructionWork(state, city), q(base * 1.15));
  assert.equal(Reflect.get(governmentModifiers(state, 0), 'capitalConstructionWorkPercent'), 15);
});

void test('synthetic capital identity is the still-owned original ID rather than name or list order', () => {
  const state = syntheticGovernment(); const original = state.cities[0]; assert.ok(original);
  const other = { ...structuredClone(original), id: 'city-0-999' }; state.cities.unshift(other);
  assert.equal(constructionWork(state, other), q(2 * cityProductivity(other)));
  assert.equal(Reflect.get(observedGovernment(state, 0), 'originalCapitalCityId'), original.id);
  original.civId = 1;
  assert.equal(Reflect.get(observedGovernment(state, 0), 'originalCapitalCityId'), null);
  state.cities = state.cities.filter(city => city.id !== original.id);
  assert.equal(Reflect.get(observedGovernment(state, 0), 'originalCapitalCityId'), null);
});

void test('synthetic opening work covers all four existing construction order families', () => {
  const state = syntheticGovernment(); const city = state.cities[0]; assert.ok(city);
  const common = { id: 'construction-1', cityId: city.id, ruleVersion: 1 as const, startedRound: 0, paid: { materials: 3 }, workRequired: 20, workDone: 0 };
  const orders: ConstructionOrder[] = [
    { ...common, buildingId: 'granary' },
    { ...common, kind: 'improvement', improvementId: 'mine', tileId: 1 },
    { ...common, kind: 'wonder', wonderId: 'great-library', tileId: 1 },
    { ...common, kind: 'rail', edgeId: '1:2', tileId: 1, toTileId: 2, strategicPaid: { iron: 1 } },
  ];
  for (const order of orders) {
    city.construction = { active: order, lastCompleted: null }; const before = structuredClone(order);
    assert.equal(openingConstructionWork(state).get(city.id), q(2 * cityProductivity(city) * 1.15)); assert.deepEqual(order, before);
  }
});

void test('synthetic branch admission adds no era gate and unreleased capital modifiers stay unavailable', () => {
  const state = syntheticGovernment(); const actor = state.civilizations[0]; const city = state.cities[0]; assert.ok(actor?.civics && city);
  actor.era = 0; actor.civics.completedCivicIds = ['code-of-laws', 'craftsmanship', 'foreign-trade', 'early-empire'];
  assert.equal(civicActionBlock(state, 0, 'state-workforce'), null);
  state.unlockedFeatures = state.unlockedFeatures.filter(id => id !== 'second-government');
  assert.notEqual(civicActionBlock(state, 0, 'state-workforce'), null);
  assert.equal(constructionWork(state, city), q(2 * cityProductivity(city)));
});

void test('second government registered rules add their capability to local Power rules', () => {
  const release = RELEASES.find(candidate => candidate.id === 'settlement-second-government-1'); const previous = RELEASES.find(candidate => candidate.id === 'settlement-local-power-1');
  assert.ok(release && previous, 'The registered second-government rules must exist');
  assert.deepEqual(release.featureIds, [...previous.featureIds, 'second-government']);
});

import { secondGovernmentJourney } from './fixtures/second-government-journey.ts';

void test('one real five-civic journey changes government, improves paid capital work, reslots and returns', context => {
  const path = secondGovernmentJourney();
  assert.equal(path.civicFrames.length, 5);
  assert.equal(path.accepted.civilizations[path.seat]?.government?.pending?.targetGovernmentId, 'autocracy');
  assert.equal(path.firstTransitionBeat.civilizations[path.seat]?.government?.active?.governmentId, 'chiefdom');
  assert.equal(path.transitionCompleted.civilizations[path.seat]?.government?.active?.governmentId, 'autocracy');
  const city = path.constructionStarted.cities.find(candidate => candidate.id === path.cityId); assert.ok(city?.construction?.active);
  const control = structuredClone(path.constructionStarted); const government = control.civilizations[path.seat]?.government; assert.ok(government?.active); government.active.governmentId = 'chiefdom';
  const baseline = constructionWork(control, city); const actual = constructionWork(path.constructionStarted, city); assert.ok(actual > baseline);
  assert.equal(path.firstWorkBeat.cities.find(candidate => candidate.id === city.id)?.construction?.active?.workDone, actual);
  assert.equal(path.built.cities.find(candidate => candidate.id === city.id)?.construction?.lastCompleted?.orderId, city.construction.active.id);
  assert.equal(path.reslotted.civilizations[path.seat]?.resources.credits, q((path.beforeReslot.civilizations[path.seat]?.resources.credits ?? 0) - 8));
  assert.equal(path.returnAccepted.civilizations[path.seat]?.resources.credits, q((path.beforeReturn.civilizations[path.seat]?.resources.credits ?? 0) - 10));
  assert.equal(path.returned.civilizations[path.seat]?.government?.active?.governmentId, 'chiefdom');
  context.diagnostic(JSON.stringify({ steps: path.steps.length, cityId: path.cityId, order: city.construction.active, baselineWork: baseline, actualWork: actual, transitionRounds: [path.accepted.round, path.firstTransitionBeat.round, path.transitionCompleted.round], completedRound: path.built.round }));
});
