import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityCatalogue, projectCapabilities, type CapabilityRow } from '../core/capabilities.ts';
import { BUILDINGS, TECHNOLOGIES } from '../core/content.ts';
import { applyCommand, createWorld, catchUpStrategy, legalActions, observe } from '../core/engine.ts';
import type { WorldState } from '../core/types.ts';

const epoch = '2026-10-16T00:00:00.000Z';
function row(rows: CapabilityRow[], nodeId: string): CapabilityRow {
  const value = rows.find(candidate => candidate.nodeId === nodeId);
  assert.ok(value, nodeId);
  return value;
}

function firstCivilization(state: WorldState) {
  const civilization = state.civilizations[0];
  assert.ok(civilization);
  return civilization;
}

function firstCity(state: WorldState) {
  const city = state.cities[0];
  assert.ok(city);
  return city;
}

function withChoices(state: WorldState, cityId: string | null, timestamp = epoch) {
  return projectCapabilities(state, 0, cityId, timestamp, { revision: state.revision, seat: 0, observedAt: timestamp, legalActions: legalActions(state, 0, timestamp) });
}

function released(): WorldState {
  return createWorld(1701, epoch, 'settlement-operating-exchange-1');
}

await test('recurring decision tree exposes the same obligation and exact-town construction activity without implying completion', () => {
  let state = createWorld(1701, epoch, 'settlement-decisions-1');
  let result = applyCommand(state, { seat: 0, expectedRevision: state.revision, action: { type: 'research', technology: 'agriculture' }, timestamp: epoch });
  assert.ok(result.ok, result.error);
  state = result.state;
  for (let seconds = 60; seconds <= 600 && !firstCivilization(state).technologies.includes('agriculture'); seconds += 60) {
    const beat = catchUpStrategy(state, new Date(Date.parse(epoch) + seconds * 1000).toISOString());
    assert.ok(beat.ok, beat.error);
    state = beat.state;
  }
  assert.ok(firstCivilization(state).technologies.includes('agriculture'));
  const at = new Date(Date.parse(epoch) + (state.independentTurns?.strategyTicks ?? 0) * 60000 + 10000).toISOString();
  result = applyCommand(state, { seat: 0, expectedRevision: state.revision, action: { type: 'build', project: 'farm', cityId: 'city-0' }, timestamp: at });
  assert.ok(result.ok, result.error);
  state = result.state;
  const view = projectCapabilities(state, 0, 'city-0', at);
  assert.ok('decisions' in view);
  assert.deepEqual(view.decisions, observe(state, 0, at).decisions);
  const farm = row(view.buildings, 'building:farm');
  assert.equal(farm.status, 'available');
  assert.ok('construction' in farm);
  assert.deepEqual(farm.construction, firstCity(state).construction?.active);
  assert.ok('lastResearchCompletion' in view);
  assert.deepEqual(view.lastResearchCompletion, firstCivilization(state).lastResearchCompletion);
  assert.equal(firstCity(state).buildings.includes('farm'), false);
  assert.deepEqual(farm.choiceRefs, []);
});

await test('complete catalogue retains every actual descriptor and prerequisite edge with detached data', () => {
  const graph = capabilityCatalogue();
  assert.deepEqual(graph.technologies, TECHNOLOGIES);
  assert.deepEqual(graph.buildings, BUILDINGS);
  assert.equal(graph.edges.length, TECHNOLOGIES.reduce((sum, item) => sum + item.requires.length, 0) + BUILDINGS.reduce((sum, item) => sum + item.requires.length, 0));
  assert.ok(graph.edges.some(edge => edge.from === 'technology:kiln-firing' && edge.to === 'technology:fuel-management'));
  assert.ok(graph.technologies[0]);
  graph.technologies[0].requires.push('invented');
  assert.deepEqual(capabilityCatalogue().technologies, TECHNOLOGIES);
});

await test('applied-world status distinguishes Planned, actual Locked and available research without science or era gates', () => {
  const initial = createWorld(1701, epoch);
  const before = structuredClone(initial);
  const view = projectCapabilities(initial, 0, 'city-0', epoch);
  assert.equal(row(view.technologies, 'technology:agriculture').status, 'available');
  assert.equal(row(view.technologies, 'technology:civic-institutions').status, 'planned');
  assert.equal(row(view.buildings, 'building:farm').status, 'locked');
  assert.deepEqual(initial, before);
  const state = released();
  firstCivilization(state).technologies.push('agriculture');
  firstCivilization(state).resources.science = 0;
  const next = withChoices(state, 'city-0');
  const civic = row(next.technologies, 'technology:civic-institutions');
  assert.equal(civic.status, 'available');
  assert.equal(civic.choiceRefs.length, 1);
  const navigation = row(next.technologies, 'technology:navigation');
  assert.equal(navigation.status, 'planned');
  assert.equal(navigation.support, 'catalogue-only');
});

await test('current research remains Available with recorded progress and no duplicate action; admission is separate', () => {
  const state = released();
  const outcome = applyCommand(state, { expectedRevision: state.revision, seat: 0, action: { type: 'research', technology: 'agriculture' }, timestamp: epoch });
  assert.ok(outcome.ok, outcome.error);
  const view = projectCapabilities(outcome.state, 0, 'city-0', epoch);
  const current = row(view.technologies, 'technology:agriculture');
  assert.equal(current.status, 'available');
  assert.deepEqual(current.research, { progress: 0, cost: 10 });
  assert.deepEqual(current.choiceRefs, []);
  assert.ok(view.admission.reason);
  const overdue = projectCapabilities(outcome.state, 0, 'city-0', '2026-10-16T00:01:00.000Z');
  assert.equal(row(overdue.technologies, current.nodeId).status, 'available');
  assert.deepEqual(overdue.legalActions, []);
});

await test('selected-town building gates report exact resources, era and ownership without retargeting', () => {
  const state = released();
  firstCivilization(state).technologies.push('agriculture', 'civic-institutions');
  firstCivilization(state).resources.materials = 0;
  const view = projectCapabilities(state, 0, 'city-0', epoch);
  const academy = row(view.buildings, 'building:academy');
  assert.equal(academy.status, 'locked');
  assert.ok(academy.blockers.some(blocker => blocker.kind === 'era' && blocker.required === 1 && blocker.available === 0));
  assert.ok(academy.blockers.some(blocker => blocker.kind === 'resource' && blocker.resource === 'materials' && blocker.required === 16 && blocker.available === 0));
  for (const cityId of [null, 'missing', 'city-1']) {
    const invalid = projectCapabilities(state, 0, cityId, epoch);
    assert.ok(invalid.buildings.every(item => item.choiceRefs.length === 0));
    assert.ok(row(invalid.buildings, 'building:farm').blockers.some(blocker => ['city-selection', 'missing-city', 'foreign-city'].includes(blocker.kind)));
  }
});

await test('Done is selected-city specific and paused actual operation facts remain distinct from capability status', () => {
  const state = released();
  firstCivilization(state).technologies.push('agriculture', 'water-management');
  firstCity(state).buildings.push('irrigation');
  firstCity(state).buildingOperations = { irrigation: { enabled: false, lastResult: { round: 0, status: 'paused', paid: {}, produced: {}, shortages: [] } } };
  const view = projectCapabilities(state, 0, 'city-0', epoch);
  const irrigation = row(view.buildings, 'building:irrigation');
  assert.equal(irrigation.status, 'done');
  assert.ok(irrigation.operation?.lastResult);
  assert.equal(irrigation.operation.enabled, false);
  assert.equal(irrigation.operation.lastResult.status, 'paused');
  assert.deepEqual(irrigation.choiceRefs, []);
  irrigation.operation.enabled = true;
  assert.equal(firstCity(state).buildingOperations?.irrigation?.enabled, false);
});

await test('exact canonical choices and recorded intent are detached and contain no invented reasons', () => {
  const state = released();
  const outcome = applyCommand(state, { expectedRevision: state.revision, seat: 0, action: { type: 'wait' }, timestamp: epoch, plan: [{ action: { type: 'wait' }, reason: 'Keep supplies for learning' }, { action: { type: 'research', technology: 'agriculture' }, reason: 'Inspect cultivation next' }] });
  assert.ok(outcome.ok, outcome.error);
  const timestamp = '2026-10-16T00:00:10.000Z';
  const view = withChoices(outcome.state, 'city-0', timestamp);
  assert.deepEqual(view.legalActions, legalActions(outcome.state, 0, timestamp));
  assert.deepEqual(view.recordedIntent, outcome.state.actionPlans?.[0]);
  assert.ok(view.recordedIntent?.items[1]);
  assert.equal(view.recordedIntent.items[1].reason, 'Inspect cultivation next');
  view.recordedIntent.items[1].reason = 'tampered';
  assert.equal(outcome.state.actionPlans?.[0]?.items[1]?.reason, 'Inspect cultivation next');
  for (const item of [...view.technologies, ...view.buildings]) for (const index of item.choiceRefs) assert.ok(view.legalActions[index]);
});

await test('legacy first-eligible construction has no invented city action and other towns keep exact status', () => {
  const state = createWorld(1701, epoch);
  firstCivilization(state).technologies.push('agriculture');
  const home = firstCity(state);
  const other = { ...structuredClone(home), id: 'synthetic-other-town', name: 'Other town' };
  state.cities.push(other);
  const first = withChoices(state, home.id);
  const farm = row(first.buildings, 'building:farm');
  assert.equal(farm.status, 'available');
  assert.equal(farm.choiceRefs.length, 1);
  const index = farm.choiceRefs[0];
  assert.ok(index !== undefined);
  assert.deepEqual(first.legalActions[index]?.action, { type: 'build', project: 'farm' });
  const second = projectCapabilities(state, 0, other.id, epoch);
  assert.deepEqual(row(second.buildings, 'building:farm').blockers, [{ kind: 'legacy-target', cityId: home.id }]);
  home.buildings.push('farm');
  assert.equal(row(projectCapabilities(state, 0, home.id, epoch).buildings, 'building:farm').status, 'done');
  assert.equal(row(projectCapabilities(state, 0, other.id, epoch).buildings, 'building:farm').status, 'available');
});

await test('milestone facts use actual evaluator and recorded achievements without treating year as an unlock', () => {
  const state = released();
  state.year = 2200;
  const empty = projectCapabilities(state, 0, 'city-0', epoch);
  assert.equal(empty.milestones.some(item => item.eligible || item.achieved), false);
  firstCivilization(state).technologies.push('agriculture');
  firstCity(state).buildings.push('farm');
  const eligible = projectCapabilities(state, 0, 'city-0', epoch);
  assert.deepEqual(eligible.milestones.find(item => item.id === 'first-harvest'), { id: 'first-harvest', achieved: false, eligible: true });
  state.calendarMilestones.push('first-harvest');
  assert.deepEqual(projectCapabilities(state, 0, 'city-0', epoch).milestones.find(item => item.id === 'first-harvest'), { id: 'first-harvest', achieved: true, eligible: false });
  assert.equal(row(eligible.technologies, 'technology:navigation').status, 'planned');
});

await test('real research and exact construction transitions open and complete nodes without inferred actor motive', () => {
  let state = released();
  const research = applyCommand(state, { expectedRevision: state.revision, seat: 0, action: { type: 'research', technology: 'agriculture' }, timestamp: epoch });
  assert.ok(research.ok, research.error);
  state = research.state;
  let seconds = 0;
  for (let beat = 1; beat <= 5; beat++) {
    seconds = beat * 60;
    const upkeep = catchUpStrategy(state, new Date(Date.parse(epoch) + seconds * 1000).toISOString());
    assert.ok(upkeep.ok, upkeep.error);
    state = upkeep.state;
    if (firstCivilization(state).technologies.includes('agriculture')) break;
  }
  assert.ok(firstCivilization(state).technologies.includes('agriculture'));
  const timestamp = new Date(Date.parse(epoch) + seconds * 1000).toISOString();
  const before = projectCapabilities(state, 0, 'city-0', timestamp);
  assert.equal(row(before.technologies, 'technology:agriculture').status, 'done');
  assert.equal(row(before.buildings, 'building:farm').status, 'available');
  const built = applyCommand(state, { expectedRevision: state.revision, seat: 0, action: { type: 'build', project: 'farm', cityId: 'city-0' }, timestamp });
  assert.ok(built.ok, built.error);
  assert.ok(built.events.some(event => event.type === 'building-completed' && event.actor === 0));
  const after = projectCapabilities(built.state, 0, 'city-0', timestamp);
  assert.equal(row(after.buildings, 'building:farm').status, 'done');
  assert.equal(after.recordedIntent, null);
});

await test('invalid projection identities and timestamps refuse without mutating state', () => {
  const state = released();
  const before = structuredClone(state);
  for (const seat of [-1, 5, 999]) assert.throws(() => projectCapabilities(state, seat, null, epoch), /civilization/);
  assert.throws(() => projectCapabilities(state, 0, 'city-0', 'not-a-time'), /UTC timestamp/);
  assert.deepEqual(state, before);
});

await test('spectator projection avoids full choice generation and explicitly distinguishes unavailable references from supplied empty menus', () => {
  const state = released();
  Object.defineProperty(state, 'tradeOffers', { get: () => { throw new Error('Full trade enumeration is not needed for the capability sheet'); } });
  const view = projectCapabilities(state, 0, 'city-0', epoch);
  assert.equal(view.choiceReferenceState, 'not-provided');
  assert.deepEqual(view.legalActions, []);
  assert.ok(view.technologies.every(item => item.choiceRefs.length === 0));
  assert.equal(row(view.technologies, 'technology:agriculture').status, 'available');
  const supplied = projectCapabilities(state, 0, 'city-0', epoch, { revision: state.revision, seat: 0, observedAt: epoch, legalActions: [] });
  assert.equal(supplied.choiceReferenceState, 'provided');
  assert.deepEqual(supplied.legalActions, []);
});

await test('supplied canonical option context preserves exact bytes and refuses mismatched revision seat or time', () => {
  const state = released();
  const options = legalActions(state, 0, epoch);
  const context = { revision: state.revision, seat: 0, observedAt: epoch, legalActions: options };
  const view = projectCapabilities(state, 0, 'city-0', epoch, context);
  assert.equal(view.choiceReferenceState, 'provided');
  assert.equal(JSON.stringify(view.legalActions), JSON.stringify(options));
  for (const patch of [{ revision: state.revision + 1 }, { seat: 1 }, { observedAt: '2026-10-16T00:00:10.000Z' }])
    assert.throws(() => projectCapabilities(state, 0, 'city-0', epoch, { ...context, ...patch }), /same revision, seat and observation timestamp/);
  assert.ok(view.legalActions[0] && options[0]);
  view.legalActions[0].reason = 'tampered';
  assert.notEqual(options[0].reason, 'tampered');
});
