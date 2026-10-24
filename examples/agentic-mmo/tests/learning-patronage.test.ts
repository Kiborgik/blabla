import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, CIVICS, CIVIC_RULES, ECONOMY_RULES, POLICIES, RESOURCE_IDS, WONDERS } from '../core/content.ts';
import { applyCommand, catchUpStrategy, createWorld, legalActions } from '../core/engine.ts';
import { cityResourceProduction } from '../core/learning-patronage.ts';
import { constructionWork } from '../core/simulation/construction.ts';
import { buildingBaseProduction } from '../core/simulation/districts.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { commitEvents, emitEvent } from '../core/simulation/events.ts';
import { adoptGovernment, availableGovernmentActions, governmentActionBlock, governmentModifiers, governmentPrice } from '../core/simulation/government.ts';
import { allocateOperations, projectOperationAllocation } from '../core/simulation/operations.ts';
import { siteProduction } from '../core/simulation/sites.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import type { City, GameAction, GameEvent, PolicyAssignment, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { decodeHistorySnapshot } from '../server/snapshot-codec.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';
import { acceptKnowledge, knowledgeEconomy, syntheticKnowledgeCorridor, TEACHER, LEARNER } from './fixtures/knowledge-current.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const rulesId = 'settlement-learning-patronage-1';
const q = (value: number): number => Math.round(value * 100) / 100;
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const town = (state: WorldState): City => state.cities.find(city => city.id === 'city-0')!;
const assignment = (policyId = 'learning-patronage', slotType: 'economic' | 'wildcard' = 'economic'): PolicyAssignment[] => [{ slotType, slotIndex: 0, policyId }];

function completedCivics(state: WorldState, seat = 0): void {
  state.revision++;
  const events: GameEvent[] = [];
  const civicId = CIVICS.at(-1)!.id;
  const event = emitEvent(state, events, { type: 'civic-completed', title: 'Synthetic completed civic prerequisites', detail: 'Conditional fixture, not natural progression', actor: seat, target: seat, tileId: null, cause: 'Explicit synthetic setup', effects: [`Completed civic ${civicId}`], importance: 1 });
  state.civilizations[seat]!.civics = { ruleVersion: 1, completedCivicIds: CIVICS.map(civic => civic.id), active: null, lastCompleted: { civicId, completedRound: state.round, eventId: event.id }, reformEntitlement: { civicId, completedRound: state.round, completionEventId: event.id } };
  commitEvents(state, events);
}

function conditionalWorld(buildings: string[] = ['academy']): WorldState {
  const state = createWorld(1701, epoch, rulesId);
  const city = town(state); const actor = state.civilizations[0]!;
  actor.resources = { food: 300, materials: 300, credits: 300, energy: 300, culture: 300, science: 17.31 };
  actor.era = 3; actor.researchTarget = ''; city.population = 18;
  city.wellbeing = 47.3; city.infrastructure = 0.7; city.damage = 7.9; city.focus = 'research';
  const ids = buildings.some(id => BUILDINGS.find(building => building.id === id)?.requiresBuildings?.includes('campus')) ? ['campus', ...buildings] : buildings;
  for (const id of [...new Set(ids)]) {
    syntheticTechnologies(state, 0, BUILDINGS.find(building => building.id === id)!.requires);
    syntheticInstitution(state, city.id, id);
  }
  completedCivics(state);
  return state;
}

function arrange(state: WorldState, assignments = assignment(), governmentId = 'chiefdom'): void {
  state.revision++;
  const events: GameEvent[] = [];
  adoptGovernment(state, 0, governmentId, assignments, events);
  commitEvents(state, events);
}

function economy(state: WorldState): GameEvent[] {
  state.round++; state.revision++;
  const events: GameEvent[] = [];
  resolveEconomy(state, events); commitEvents(state, events);
  return events;
}

function actualAction(state: WorldState, action: GameAction): WorldState {
  const before = structuredClone(state);
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: at(state.round * 60 + 20), action });
  assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state));
  return result.state;
}

function actualBeat(state: WorldState): WorldState {
  const before = structuredClone(state);
  const result = catchUpStrategy(state, at((state.round + 1) * 60));
  assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state));
  const restored: unknown = JSON.parse(JSON.stringify(state)); assert.ok(isWorldState(restored));
  assert.deepEqual(catchUpStrategy(restored, at((state.round + 1) * 60)), result);
  return result.state;
}

void test('Learning patronage is the released State workforce alternative to Urban planning, not a new slot or civic', () => {
  const learning = POLICIES.find(policy => policy.id === 'learning-patronage')!;
  const urban = POLICIES.find(policy => policy.id === 'urban-planning')!;
  assert.deepEqual(learning.requires, ['state-workforce']); assert.equal(learning.slotType, 'economic');
  assert.ok(learning.requiredFeatures.includes('learning-patronage'));
  assert.equal(learning.exclusiveGroup, 'economic-priority'); assert.equal(urban.exclusiveGroup, learning.exclusiveGroup);
  assert.deepEqual(learning.institutionalSciencePercent, { percent: 25, buildingIds: ['library', 'academy', 'university'] });
  assert.equal(learning.constructionWork, 0); assert.equal(urban.constructionWork, 1);
  assert.equal(CIVICS.length, 6);
  const state = conditionalWorld();
  assert.equal(governmentActionBlock(state, 0, 'chiefdom', assignment()), null);
  state.civilizations[0]!.civics!.completedCivicIds = ['code-of-laws', 'craftsmanship', 'foreign-trade', 'early-empire'];
  state.civilizations[0]!.civics!.lastCompleted!.civicId = 'early-empire';
  state.civilizations[0]!.civics!.reformEntitlement!.civicId = 'early-empire';
  state.events.find(event => event.id === state.civilizations[0]!.civics!.lastCompleted!.eventId)!.effects = ['Completed civic early-empire'];
  assert.match(governmentActionBlock(state, 0, 'chiefdom', assignment())!, /unavailable/);
  assert.equal(governmentActionBlock(state, 0, 'chiefdom', assignment('urban-planning')), null);
  state.civilizations[0]!.civics!.completedCivicIds.push('state-workforce');
  state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== 'learning-patronage');
  assert.match(governmentActionBlock(state, 0, 'chiefdom', assignment())!, /unavailable/);
});

void test('data-defined exclusivity rejects both Autocracy cross-slot permutations while preserving compatible wildcard choices', () => {
  const state = conditionalWorld();
  for (const [economic, wildcard] of [['learning-patronage', 'urban-planning'], ['urban-planning', 'learning-patronage']] as const) {
    const both = [...assignment(economic), ...assignment(wildcard, 'wildcard')];
    assert.match(governmentActionBlock(state, 0, 'autocracy', both)!, /economic-priority|exclusive/);
    const before = structuredClone(state); assert.throws(() => adoptGovernment(state, 0, 'autocracy', both, []), /economic-priority|exclusive/); assert.deepEqual(state, before);
  }
  for (const governmentId of ['chiefdom', 'autocracy']) {
    const actions = availableGovernmentActions(state, 0).filter(option => option.action.type === 'adopt-government' && option.action.governmentId === governmentId);
    assert.ok(actions.some(option => option.action.type === 'adopt-government' && option.action.assignments.some(value => value.policyId === 'learning-patronage')));
    assert.ok(actions.every(option => option.action.type === 'adopt-government' && option.action.assignments.filter(value => POLICIES.find(policy => policy.id === value.policyId)?.exclusiveGroup === 'economic-priority').length <= 1));
  }
  assert.equal(governmentActionBlock(state, 0, 'autocracy', assignment('learning-patronage', 'wildcard')), null);
  const other = { ...POLICIES.find(policy => policy.id === 'urban-planning')!, id: 'synthetic-other-priority', exclusiveGroup: 'other-group' };
  POLICIES.push(other);
  try {
    assert.equal(governmentActionBlock(state, 0, 'autocracy', [...assignment(), ...assignment(other.id, 'wildcard')]), null);
    other.exclusiveGroup = 'economic-priority';
    assert.match(governmentActionBlock(state, 0, 'autocracy', [...assignment(), ...assignment(other.id, 'wildcard')])!, /economic-priority|exclusive/);
  } finally { POLICIES.pop(); }
});

void test('each paid staffed institution earns the exact separate rounded bonus without changing payment or non-Science output', () => {
  for (const buildingIds of [['library'], ['academy'], ['university'], ['library', 'academy', 'university']]) {
    const learning = conditionalWorld(buildingIds); const baseline = structuredClone(learning);
    arrange(learning); arrange(baseline, []);
    const opening = structuredClone(learning); const projected = projectOperationAllocation(learning);
    const projection = cityResourceProduction(projected, town(projected), 'science');
    const city = town(opening); const productivity = cityProductivity(city);
    let raw = ECONOMY_RULES.baseProduction.science + 3 + (siteProduction(opening, opening.tiles.find(tile => tile.id === city.tileId)!).science ?? 0)
      + city.buildings.filter(id => !buildingIds.includes(id)).reduce((sum, id) => sum + (buildingBaseProduction(opening, city, BUILDINGS.find(building => building.id === id)!).science ?? 0), 0);
    const exactBase = new Map<string, number>();
    for (const id of buildingIds.toSorted()) {
      const before = q(raw * productivity); raw += BUILDINGS.find(building => building.id === id)!.production.science!;
      exactBase.set(id, q(q(raw * productivity) - before));
    }
    assert.deepEqual(learning, opening);
    economy(learning); economy(baseline);
    let bonus = 0;
    for (const id of buildingIds) {
      const result = town(learning).buildingOperations![id]!.lastResult!;
      const base = town(baseline).buildingOperations![id]!.lastResult!;
      const unboostedScience = base.produced.science!;
      assert.equal(unboostedScience, exactBase.get(id));
      const bonusScience = q(unboostedScience * 0.25); bonus = q(bonus + bonusScience);
      assert.equal(result.status, 'operated'); assert.deepEqual(result.paid, BUILDINGS.find(building => building.id === id)!.operatingInputs);
      assert.deepEqual(result.paid, base.paid); assert.deepEqual(result.residents, base.residents); assert.equal(result.residents!.allocated, 3);
      assert.deepEqual(result.policyContribution, { policyId: 'learning-patronage', percent: 25, unboostedScience, bonusScience });
      assert.equal(result.produced.science, q(unboostedScience + bonusScience));
      assert.deepEqual(projection.buildings.find(building => building.buildingId === id)?.policyContribution, result.policyContribution);
      for (const resource of RESOURCE_IDS.filter(resource => resource !== 'science')) assert.equal(result.produced[resource], base.produced[resource]);
    }
    assert.equal(learning.civilizations[0]!.resources.science, q(baseline.civilizations[0]!.resources.science + bonus));
    assert.equal(projection.total, q(learning.civilizations[0]!.resources.science - opening.civilizations[0]!.resources.science));
    for (const resource of RESOURCE_IDS.filter(resource => resource !== 'science')) assert.equal(learning.civilizations[0]!.resources[resource], baseline.civilizations[0]!.resources[resource]);
    assert.deepEqual(town(learning).lastFoodSupply, town(baseline).lastFoodSupply);
  }
});

void test('paused, unpaid, underfunded, unstaffed and zero-productivity institutions earn no patronage bonus', () => {
  const mutations: Array<[string, (state: WorldState) => void, string]> = [
    ['paused', state => { town(state).buildingOperations!.academy!.enabled = false; }, 'paused'],
    ['no Credits', state => { state.civilizations[0]!.resources.credits = 0; }, 'blocked'],
    ['fractional Credits', state => { state.civilizations[0]!.resources.credits = 0.99; }, 'blocked'],
    ['no Culture', state => { state.civilizations[0]!.resources.culture = 0; }, 'blocked'],
    ['no residents', state => { town(state).population = 3; }, 'blocked'],
    ['partial resident capacity', state => { town(state).population = 5; }, 'blocked'],
    ['zero productivity', state => { town(state).damage = 100; }, 'operated'],
  ];
  for (const [label, mutate, status] of mutations) {
    const state = conditionalWorld(); arrange(state); mutate(state); economy(state);
    const result = town(state).buildingOperations!.academy!.lastResult!;
    assert.equal(result.status, status, label); assert.equal(result.policyContribution, undefined, label); assert.deepEqual(result.produced, {}, label);
    assert.deepEqual(result.paid, status === 'operated' ? { culture: 2, credits: 1 } : {}, label);
    assert.equal(result.residents!.allocated, status === 'operated' ? 3 : 0, label);
  }
});

void test('the pure production authority refuses stale or partial receipt bonus and never modifies its source', () => {
  const state = conditionalWorld(); arrange(state); state.round++; allocateOperations(state);
  const result = town(state).buildingOperations!.academy!.lastResult!;
  const cases: Array<(candidate: WorldState) => void> = [
    candidate => { town(candidate).buildingOperations!.academy!.lastResult!.round--; },
    candidate => { town(candidate).buildingOperations!.academy!.lastResult!.paid.credits = 0.99; },
    candidate => { town(candidate).buildingOperations!.academy!.lastResult!.residents!.allocated = 2; },
    candidate => { const residents = town(candidate).buildingOperations!.academy!.lastResult!.residents!; residents.required = 1; residents.allocated = 1; },
    candidate => { candidate.civilizations[0]!.government!.active!.assignments = []; },
    candidate => { candidate.unlockedFeatures = candidate.unlockedFeatures.filter(feature => feature !== 'learning-patronage'); },
  ];
  assert.equal(result.status, 'operated');
  for (const mutate of cases) {
    const candidate = structuredClone(state); mutate(candidate); const before = structuredClone(candidate);
    assert.equal(cityResourceProduction(candidate, town(candidate), 'science').buildings.find(building => building.buildingId === 'academy')!.policyContribution, undefined);
    assert.deepEqual(candidate, before);
  }
});

void test('base, terrain, focus, Campus, Observatory and powered laboratory Science remain unboosted, as does stored Science', () => {
  for (const ids of [[], ['campus'], ['observatory'], ['coal-plant', 'research-lab']]) {
    const learning = conditionalWorld(ids); const baseline = structuredClone(learning);
    learning.civilizations[0]!.strategicResources = { coal: 100 }; baseline.civilizations[0]!.strategicResources = { coal: 100 };
    learning.tiles.find(tile => tile.id === town(learning).tileId)!.resource = 'science'; baseline.tiles.find(tile => tile.id === town(baseline).tileId)!.resource = 'science';
    learning.civilizations[0]!.resources.science = 400; baseline.civilizations[0]!.resources.science = 400;
    arrange(learning); arrange(baseline, []); economy(learning); economy(baseline);
    assert.deepEqual(learning.civilizations[0]!.resources, baseline.civilizations[0]!.resources);
    assert.deepEqual(town(learning).buildingOperations, town(baseline).buildingOperations);
    for (const id of ids.filter(id => id === 'observatory' || id === 'research-lab')) {
      const result = town(learning).buildingOperations![id]!.lastResult!;
      assert.equal(result.status, 'operated'); assert.ok(result.produced.science! > 0); assert.equal(result.policyContribution, undefined);
    }
  }
});

void test('earlier rounded patronage bonuses cannot contaminate later excluded paid outputs', () => {
  const learning = conditionalWorld(['academy', 'library', 'observatory', 'coal-plant', 'research-lab', 'university']);
  learning.civilizations[0]!.strategicResources = { coal: 100 };
  town(learning).population = 24;
  const baseline = structuredClone(learning); arrange(learning); arrange(baseline, []);
  economy(learning); economy(baseline);
  for (const id of ['observatory', 'research-lab']) {
    assert.equal(town(learning).buildingOperations![id]!.lastResult!.status, 'operated');
    assert.deepEqual(town(learning).buildingOperations![id]!.lastResult, town(baseline).buildingOperations![id]!.lastResult);
  }
});

void test('Great library passive output and raw stored Science do not acquire an institutional multiplier', () => {
  const learning = conditionalWorld([]); const wonder = WONDERS.find(candidate => candidate.id === 'great-library')!;
  learning.wonders![wonder.id] = { ruleVersion: 1, completion: { kind: 'wonder', ruleVersion: 1, wonderId: wonder.id, orderId: 'synthetic-passive-wonder', civId: 0, cityId: town(learning).id, tileId: 40, startedRound: 0, completedRound: 0, paid: { ...wonder.cost }, workRequired: wonder.requiredWork, eventId: '1:0' }, losses: [], boostLimit: 2, boostPercent: 20, boosts: [] };
  learning.civilizations[0]!.researchTarget = 'agriculture'; learning.civilizations[0]!.resources.science = 400;
  const baseline = structuredClone(learning); arrange(learning); arrange(baseline, []);
  const projected = projectOperationAllocation(learning); const expected = cityResourceProduction(projected, town(projected), 'science').total;
  economy(learning); economy(baseline);
  assert.equal(learning.civilizations[0]!.researchProgress, expected);
  assert.equal(learning.civilizations[0]!.resources.science, 400);
  assert.deepEqual(learning.civilizations[0]!.resources, baseline.civilizations[0]!.resources);
  assert.equal(learning.civilizations[0]!.researchProgress, baseline.civilizations[0]!.researchProgress);
});

void test('actual adoption, reslot and two-beat transition preserve reform, prices, locks and historical receipt through exact restart', async context => {
  let state = conditionalWorld(['academy', 'library']);
  syntheticTechnologies(state, 0, ['education']);
  assert.ok(isWorldState(state));
  const opening = structuredClone(state.civilizations[0]!.resources);
  const reform = state.civilizations[0]!.civics!.reformEntitlement!;
  assert.deepEqual(governmentPrice(state, 0, 'chiefdom'), { credits: 0, completionEventId: reform.completionEventId });
  state = actualAction(state, { type: 'adopt-government', governmentId: 'chiefdom', assignments: assignment() });
  assert.deepEqual(state.civilizations[0]!.resources, opening);
  assert.equal(state.civilizations[0]!.government!.lastSpentReformCompletionEventId, reform.completionEventId);
  assert.equal(town(state).buildingOperations!.academy!.lastResult, null);
  state = actualBeat(state);
  state = actualAction(state, { type: 'build', project: 'university', cityId: town(state).id });
  const order = structuredClone(town(state).construction!.active!);
  const afterStart = structuredClone(state.civilizations[0]!.resources);
  assert.deepEqual(order.paid, { materials: 28, credits: 14 });
  assert.match(governmentActionBlock(state, 0, 'chiefdom', assignment('urban-planning'))!, /commitment/);
  assert.equal(CIVIC_RULES.commitmentBeats, 4); assert.equal(CIVIC_RULES.transitionBeats, 2);
  while (state.round < 4) state = actualBeat(state);
  const historical = structuredClone(town(state).buildingOperations!.academy!.lastResult!);
  const work = structuredClone(town(state).construction!.active!);
  const beforeReslotCredits = state.civilizations[0]!.resources.credits;
  state = actualAction(state, { type: 'adopt-government', governmentId: 'chiefdom', assignments: assignment('urban-planning') });
  assert.equal(state.civilizations[0]!.resources.credits, q(beforeReslotCredits - 8));
  assert.deepEqual(town(state).buildingOperations!.academy!.lastResult, historical);
  assert.deepEqual(town(state).construction!.active, work);
  assert.deepEqual(await decodeHistorySnapshot(JSON.stringify(state)), state);
  const expectedWork = constructionWork(state, town(state));
  state = actualBeat(state);
  assert.equal(town(state).construction!.active!.workDone, q(work.workDone + expectedWork));
  assert.deepEqual(town(state).construction!.active!.paid, order.paid);
  assert.equal(town(state).buildingOperations!.academy!.lastResult!.policyContribution, undefined);
  while (state.round < 8) state = actualBeat(state);
  const credits = state.civilizations[0]!.resources.credits;
  state = actualAction(state, { type: 'adopt-government', governmentId: 'autocracy', assignments: assignment('learning-patronage', 'wildcard') });
  assert.equal(state.civilizations[0]!.resources.credits, q(credits - 10));
  const pending = structuredClone(state.civilizations[0]!.government!.pending!);
  assert.equal(pending.completionRound, state.round + 2);
  for (let beat = 0; beat < 2; beat++) {
    const openingCity = structuredClone(town(state)); const projected = projectOperationAllocation(state);
    assert.equal(governmentModifiers(projected, 0).ordinaryOutputMultiplier, 0.75);
    const ordinary = cityResourceProduction(projected, town(projected), 'science');
    state = actualBeat(state);
    assert.equal(town(state).buildingOperations!.academy!.lastResult!.policyContribution, undefined);
    assert.equal(town(state).buildingOperations!.academy!.lastResult!.produced.science, ordinary.buildings.find(building => building.buildingId === 'academy')!.amount);
    assert.ok(cityProductivity(openingCity) > 0);
    if (beat === 0) assert.equal(state.civilizations[0]!.government!.active!.governmentId, 'chiefdom');
  }
  assert.equal(state.civilizations[0]!.government!.pending, null);
  assert.equal(state.civilizations[0]!.government!.active!.governmentId, 'autocracy');
  assert.equal(state.civilizations[0]!.government!.active!.policyLockUntilRound, pending.completionRound + 4);
  assert.deepEqual(await decodeHistorySnapshot(JSON.stringify(state)), state);
  state = actualBeat(state);
  assert.ok(town(state).buildingOperations!.academy!.lastResult!.policyContribution!.bonusScience > 0);
  assert.ok(state.civilizations[0]!.resources.materials >= afterStart.materials);
  assert.ok(legalActions(state, 0, at(state.round * 60 + 20)).every(option => option.action.type !== 'adopt-government'));
  context.diagnostic(JSON.stringify({ provenance: 'Synthetic civic and institution prerequisites; real legal adoption, paid construction, working beats, reslot, transition and current-version replay/restart', reform: reform.completionEventId, universityOrder: order.id, transitionRound: pending.acceptedRound, finalRound: state.round }));
});

void test('the old Learning arrangement earns only transition-reduced output until its pending replacement takes effect', () => {
  let state = conditionalWorld(); state = actualAction(state, { type: 'adopt-government', governmentId: 'chiefdom', assignments: assignment() });
  for (let count = 0; count < 4; count++) state = actualBeat(state);
  state = actualAction(state, { type: 'adopt-government', governmentId: 'autocracy', assignments: assignment('urban-planning') });
  for (let count = 0; count < 2; count++) {
    const projected = projectOperationAllocation(state); const output = cityResourceProduction(projected, town(projected), 'science');
    assert.equal(governmentModifiers(projected, 0).ordinaryOutputMultiplier, 0.75);
    state = actualBeat(state);
    assert.deepEqual(town(state).buildingOperations!.academy!.lastResult!.policyContribution, output.buildings.find(building => building.buildingId === 'academy')!.policyContribution);
    assert.ok(town(state).buildingOperations!.academy!.lastResult!.policyContribution!.bonusScience > 0);
  }
  const historical = structuredClone(town(state).buildingOperations!.academy!.lastResult!);
  assert.equal(state.civilizations[0]!.government!.active!.assignments[0]!.policyId, 'urban-planning');
  assert.ok(isWorldState(state)); assert.deepEqual(JSON.parse(JSON.stringify(state)).cities.find((city: City) => city.id === 'city-0').buildingOperations.academy.lastResult, historical);
  state = actualBeat(state); assert.equal(town(state).buildingOperations!.academy!.lastResult!.policyContribution, undefined);
});

void test('fully paid two-season teaching retains the same grant and contributions rather than multiplying its separate work', () => {
  const baseline = syntheticKnowledgeCorridor();
  baseline.unlockedFeatures.push('learning-patronage');
  completedCivics(baseline, TEACHER); completedCivics(baseline, LEARNER);
  const learning = structuredClone(baseline);
  for (const state of [baseline, learning]) {
    for (const seat of [TEACHER, LEARNER]) {
      state.revision++; const events: GameEvent[] = [];
      adoptGovernment(state, seat, 'chiefdom', state === learning ? assignment() : [], events); commitEvents(state, events);
    }
    acceptKnowledge(state);
  }
  for (let count = 0; count < 2; count++) {
    const actualEvents = knowledgeEconomy(learning); knowledgeEconomy(baseline);
    const study = actualEvents.find(event => event.knowledgeStudy)!.knowledgeStudy!;
    assert.deepEqual(study.attempt.blockers, []);
    assert.equal(study.studyCount, count + 1);
  }
  const actual = learning.knowledge!.lastResults[TEACHER]!; const control = baseline.knowledge!.lastResults[TEACHER]!;
  assert.equal(actual.outcome, 'completed'); assert.equal(actual.amount, control.amount); assert.equal(actual.nominalAmount, control.nominalAmount);
  assert.deepEqual(actual.teacherPaid, { culture: 2 }); assert.deepEqual(actual.teacherPaid, control.teacherPaid);
  assert.deepEqual(actual.learnerPaid, { materials: 3, credits: 4 }); assert.deepEqual(actual.learnerPaid, control.learnerPaid);
  assert.equal(actual.researchCompletionEventId, null);
  assert.ok(learning.cities.find(city => city.civId === TEACHER)!.buildingOperations!.academy!.lastResult!.policyContribution!.bonusScience > 0);
});
