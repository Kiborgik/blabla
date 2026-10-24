import assert from 'node:assert/strict';
import { test } from 'node:test';
import { behaviorPolicyVersion, civilizationBehaviorProfile } from '../core/behavior-profiles.ts';
import { deriveProgressionPlan, progressionWeight } from '../core/behavior-progression.ts';
import { assessCivilizationBehavior, chooseCivilizationBehavior, createBehaviorMemory, type BehaviorMemory } from '../core/behaviors.ts';
import { BUILDINGS, ECONOMY_RULES, RESOURCE_IDS, TECHNOLOGIES } from '../core/content.ts';
import { applyCommand, legalActions } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { createCoastalPlanner, foundingSiteEligible, isCoastalSite } from '../core/simulation/coastal.ts';
import { decisionObligations } from '../core/simulation/decisions.ts';
import { commitEvents } from '../core/simulation/events.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import { availableReliefActions, executeReliefAction } from '../core/simulation/relief-charters.ts';
import { siteProduction } from '../core/simulation/sites.ts';
import { executeTradeAction } from '../core/simulation/trade.ts';
import { isWorldState } from '../core/validation.ts';
import type { ActionOption, City, Civilization, GameAction, GameEvent, WorldState } from '../core/types.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const timestamp = '2026-10-24T00:00:50.000Z';
const cursors = Array.from({ length: 24 }, (_, index) => index);

function fixture() {
  const state = createGeneratedWorld(73, epoch, 'settlement-learning-patronage-1', 'cultural-toponyms-v1', 'strategic-temperaments-v1');
  const actor = state.civilizations[0]!;
  syntheticTechnologies(state, actor.id, ['water-management', 'civic-institutions']);
  for (const civilization of state.civilizations) civilization.resources = { food: 10000, materials: 10000, energy: 10000, credits: 10000, science: 0, culture: 10000 };
  const planner = createCoastalPlanner(state);
  const owned = state.tiles.filter(tile => tile.owner === actor.id);
  const sites = state.tiles.filter(tile => foundingSiteEligible(state, tile) && isCoastalSite(state, tile.id)).toSorted((a, b) => a.id - b.id);
  const tile = sites.find(source => sites.some(destination => hexDistance(source, destination) > 2 && owned.every(home => hexDistance(home, destination) > 2) && planner.quote(source.id, destination.id)));
  assert.ok(tile, 'Fixed generated geography must contain an exact source and distant ocean beneficiary');
  const source: City = { id: 'synthetic-coastal-source', name: 'Controlled coastal prerequisite', civId: actor.id, tileId: tile.id, ...ECONOMY_RULES.initialCity, population: 8, wellbeing: 50, focus: 'industry', buildings: [], housing: { ruleVersion: 1, origin: 'founded', establishedRound: 0, baseCapacity: 8 }, construction: { active: null, lastCompleted: null } };
  tile.owner = actor.id; state.cities.push(source);
  const destination = sites.find(destination => foundingSiteEligible(state, destination) && hexDistance(tile, destination) > 2 && owned.every(home => hexDistance(home, destination) > 2) && planner.quote(tile.id, destination.id));
  assert.ok(destination);
  assert.ok(isWorldState(state));
  return { state, actor, source, destination, yard: { type: 'build', cityId: source.id, project: 'boat-yard' } as const, founding: { type: 'settle-coast', sourceCityId: source.id, tileId: destination.id } as const };
}

function profile(state: WorldState, seat = 0) { return civilizationBehaviorProfile(state.seed, seat, behaviorPolicyVersion(state)); }
function options(state: WorldState, seat = 0) { return legalActions(state, seat, timestamp); }
function option(state: WorldState, action: GameAction): ActionOption {
  const result = options(state).find(candidate => sameAction(candidate.action, action));
  assert.ok(result, `Expected actual legal action ${JSON.stringify(action)}`); return result;
}
function assessed(state: WorldState, action: GameAction) {
  const candidates = assessCivilizationBehavior(state, 0, createBehaviorMemory(state, 0), options(state)).candidates;
  const result = candidates.find(candidate => sameAction(candidate.option.action, action));
  assert.ok(result); return result;
}
function originalGoals(state: WorldState, actor: Civilization): Set<string> {
  const coastal = state.unlockedFeatures.includes('coastal-founding') && (state.eventCounts['coastal-founded'] ?? 0) === 0 && !state.cities.some(city => city.coastalFounding);
  const targets = coastal ? ['navigation'] : !state.calendarMilestones.includes('industrial-world') ? ['industrialization', 'steam-power'] : ['computing', 'spaceflight'];
  const goals = new Set<string>();
  const visit = (id: string): void => {
    if (actor.technologies.includes(id) || goals.has(id)) return;
    goals.add(id); TECHNOLOGIES.find(technology => technology.id === id)?.requires.forEach(visit);
  };
  [...targets, 'agriculture', 'writing', 'currency', 'education', 'banking', 'masonry', 'fuel-management'].forEach(visit);
  return goals;
}
function withoutNavigation(goals: ReadonlySet<string>): string[] { return [...goals].filter(id => id !== 'navigation').sort(); }
function draw(state: WorldState, memoryFields: Partial<BehaviorMemory> = {}) {
  const before = structuredClone(state);
  const decisions = cursors.map(decisionCount => {
    const memory = { ...createBehaviorMemory(state, 0), ...memoryFields, decisionCount };
    const memoryBefore = structuredClone(memory);
    const decision = chooseCivilizationBehavior(state, 0, memory, timestamp);
    assert.deepEqual(decision, chooseCivilizationBehavior(JSON.parse(JSON.stringify(state)) as WorldState, 0, structuredClone(memory), timestamp));
    assert.deepEqual(memory, memoryBefore);
    if (decision.action) assert.ok(options(state).some(candidate => sameAction(candidate.action, decision.action)));
    return decision;
  });
  assert.deepEqual(state, before); return decisions;
}
function readyFounding() {
  const result = fixture();
  syntheticTechnologies(result.state, 0, ['navigation']); syntheticInstitution(result.state, result.source.id, 'boat-yard');
  assert.ok(isWorldState(result.state)); option(result.state, result.founding); return result;
}
function onlyYardAtSource(state: WorldState, source: City): void {
  for (const candidate of options(state)) {
    const action = candidate.action;
    if (action.type === 'build' && action.cityId === source.id && action.project !== 'boat-yard' && !source.buildings.includes(action.project)) syntheticInstitution(state, source.id, action.project, action.tileId);
  }
  const lane = decisionObligations(state, 0).construction.find(item => item.cityId === source.id)!;
  assert.deepEqual(lane.availableIds, ['boat-yard']); assert.ok(isWorldState(state));
}
function preserveRequiredWork(state: WorldState): void {
  state.civilizations[0]!.researchTarget = 'writing'; state.civilizations[0]!.researchProgress = 1;
  state.civilizations[0]!.civics!.active = { civicId: 'code-of-laws', startedRound: state.round, progress: 0, requiredCulture: 16 };
  for (const city of state.cities.filter(city => city.civId === 0)) {
    const building = BUILDINGS.find(item => !city.buildings.includes(item.id) && item.id === 'workshop')!;
    assert.ok(building);
    state.revision++;
    city.construction = { active: { id: `construction-${state.revision}`, cityId: city.id, buildingId: building.id, ruleVersion: 1, startedRound: state.round, paid: { ...building.cost }, workRequired: 4, workDone: 0 }, lastCompleted: null };
  }
  assert.ok(isWorldState(state));
  const obligations = decisionObligations(state, 0);
  assert.equal(obligations.research.status, 'active'); assert.equal(obligations.civic?.status, 'active');
  assert.ok(obligations.construction.every(lane => lane.status === 'active'));
}
function reliefCorridor(state: WorldState): void {
  const trade = options(state).filter(candidate => candidate.action.type === 'propose-trade' && candidate.action.recipeId === 'harvest-for-materials' && candidate.tradeQuote?.transport.mode === 'land' && candidate.tradeQuote.transport.edges <= 12).toSorted((a, b) => (a.tradeQuote?.transport.edges ?? 99) - (b.tradeQuote?.transport.edges ?? 99))[0];
  assert.ok(trade?.action.type === 'propose-trade', 'Fixed generated geography has a short legal consenting corridor');
  const partner = trade.action.partner;
  state.revision++; let events: GameEvent[] = []; executeTradeAction(state, 0, trade.action, events); commitEvents(state, events);
  const offer = state.tradeOffers!.at(-1)!;
  state.revision++; events = []; executeTradeAction(state, partner, { type: 'respond-trade', offerId: offer.id, accept: true }, events); commitEvents(state, events);
  const recipient = state.cities.find(city => city.id === offer.to)!; recipient.population = 30;
  state.civilizations[partner]!.resources.food = 0;
  assert.ok(availableReliefActions(state, 0).some(candidate => candidate.action.type === 'propose-relief'));
  assert.ok(isWorldState(state));
}

void test('Navigation alone changes in the exact existing research target closure for current snapshots', () => {
  const supported = fixture(); const unsupported = structuredClone(supported.state);
  for (const city of unsupported.cities.filter(city => city.civId === 0)) city.population = 5;
  const missingPrerequisite = structuredClone(supported.state); missingPrerequisite.civilizations[0]!.technologies = ['agriculture', 'water-management'];
  const completed = readyFounding();
  const applied = applyCommand(completed.state, { seat: 0, expectedRevision: completed.state.revision, timestamp, action: completed.founding });
  assert.ok(applied.ok, applied.error);
  const unrelatedWitness = structuredClone(applied.state); unrelatedWitness.civilizations[0]!.technologies = unrelatedWitness.civilizations[0]!.technologies.filter(id => id !== 'navigation');
  for (const [state, expectedNavigation] of [[supported.state, true], [unsupported, false], [missingPrerequisite, false], [completed.state, false], [applied.state, false], [unrelatedWitness, false]] as const) {
    assert.ok(isWorldState(state));
    for (const actor of state.civilizations) {
      const before = structuredClone(state); const plan = deriveProgressionPlan(state, actor, profile(state, actor.id), options(state, actor.id));
      assert.deepEqual(withoutNavigation(plan.researchGoals), withoutNavigation(originalGoals(state, actor)));
      assert.equal(plan.researchGoals.has('navigation'), actor.id === 0 && expectedNavigation);
      const navigation = options(state, actor.id).find(candidate => candidate.action.type === 'research' && candidate.action.technology === 'navigation');
      if (navigation) assert.equal(progressionWeight(navigation, 11, state, actor, profile(state, actor.id), plan), expectedNavigation && actor.id === 0 ? 55 : 5.5);
      assert.deepEqual(state, before);
    }
  }
  assert.equal(deriveProgressionPlan(supported.state, supported.actor, profile(supported.state), options(supported.state)).researchGoals.has('navigation'), true);
  assert.equal(deriveProgressionPlan(unsupported, unsupported.civilizations[0]!, profile(unsupported), options(unsupported)).researchGoals.has('navigation'), false);
});

void test('no prospect removes only Navigation bonus and leaves an ordinary required research choice', () => {
  const { state, actor } = fixture();
  for (const city of state.cities.filter(city => city.civId === actor.id)) city.population = 5;
  syntheticTechnologies(state, actor.id, TECHNOLOGIES.filter(technology => technology.id !== 'navigation').map(technology => technology.id));
  assert.ok(isWorldState(state));
  const action = { type: 'research', technology: 'navigation' } as const; const candidate = assessed(state, action);
  const definition = TECHNOLOGIES.find(item => item.id === 'navigation')!; const p = profile(state);
  const base = (8 + TECHNOLOGIES.filter(item => item.requires.includes(definition.id)).length) * p.priorities.research / (1 + definition.cost / 80);
  assert.equal(candidate.weight, base * 0.5); assert.equal(candidate.coastalHold, null); assert.equal(candidate.lane, 'research');
  const decisions = draw(state, { urgentStreak: 2, lastRequiredLane: 'construction:synthetic-coastal-source' });
  assert.ok(decisions.every(decision => sameAction(action, decision.action)));
});

void test('supported Yard uses original positive construction and cost utility without a global floor', context => {
  const { state, actor, yard } = fixture(); const p = profile(state); const building = BUILDINGS.find(item => item.id === 'boat-yard')!;
  const base = (4 + 3 * p.priorities.expansion) * p.priorities.construction / (1 + RESOURCE_IDS.reduce((sum, resource) => sum + (building.cost[resource] ?? 0) * p.resources[resource], 0) / 80);
  const candidate = assessed(state, yard);
  assert.ok(base > 0); assert.equal(candidate.weight, base); assert.equal(candidate.coastalHold, null);
  const plan = deriveProgressionPlan(state, actor, p, options(state)); assert.equal(progressionWeight(option(state, yard), base, state, actor, p, plan), base);
  const decisions = draw(state, { urgentStreak: 2, lastRequiredLane: 'construction:city-0' });
  const selected = decisions.flatMap((decision, index) => sameAction(yard, decision.action) ? [index] : []);
  assert.ok(selected.length > 0, 'The fixed complete-menu draw corpus must retain a positive supported Yard control');
  const chosen = decisions[selected[0]!]!; assert.ok(chosen.action);
  const before = structuredClone(state);
  const paid = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp, action: chosen.action }); assert.ok(paid.ok, paid.error);
  assert.ok(isWorldState(paid.state)); assert.deepEqual(state, before);
  const order = paid.state.cities.find(city => city.id === yard.cityId)!.construction!.active;
  assert.ok(order && !('kind' in order)); assert.equal(order.buildingId, 'boat-yard'); assert.deepEqual(order.paid, building.cost);
  for (const resource of RESOURCE_IDS) assert.equal(paid.state.civilizations[0]!.resources[resource], actor.resources[resource] - (building.cost[resource] ?? 0));
  context.diagnostic(JSON.stringify({ fixedSeed: state.seed, cursors, selectedYardCursors: selected, sourceCityId: yard.cityId, worldRevision: state.revision, lastRequiredLane: 'construction:city-0', noNaturalUptakeClaim: true }));
});

void test('supported sea founding retains ordinary raw site utility and no extra-town or global phase exception', () => {
  const { state, actor, founding, destination } = readyFounding(); const p = profile(state);
  const memory = createBehaviorMemory(state, 0); const assessment = assessCivilizationBehavior(state, 0, memory, options(state));
  const candidate = assessment.candidates.find(item => sameAction(item.option.action, founding))!;
  const raw = (8 + RESOURCE_IDS.reduce((sum, resource) => sum + (siteProduction(state, destination)[resource] ?? 0) * p.resources[resource], 0)) * p.priorities.expansion * (assessment.phase === 'expansion' ? 2 : 1);
  assert.equal(candidate.weight, raw); assert.equal(candidate.coastalHold, null);
  const plan = deriveProgressionPlan(state, actor, p, options(state)); assert.equal(progressionWeight(option(state, founding), 17, state, actor, p, plan), 17);
  const capped = { ...p, settlementGoal: state.cities.filter(city => city.civId === 0).length };
  const result = assessCivilizationBehavior(state, 0, { ...memory, phase: 'expansion' }, options(state), capped);
  assert.equal(result.candidates.find(item => sameAction(item.option.action, founding))!.weight, 0); assert.notEqual(result.phase, 'expansion');
});

void test('typed Yard hold survives required and urgent pools while unrelated required lanes remain useful', () => {
  const { state, source, yard } = fixture(); onlyYardAtSource(state, source); source.population = 6; state.civilizations[0]!.resources.materials = 21.99;
  assert.equal(projectOperationAllocation(state).cities.find(city => city.id === source.id)!.buildingOperations!.irrigation!.lastResult!.status, 'operated');
  const candidate = assessed(state, yard); assert.equal(candidate.weight, 0); assert.ok(candidate.coastalHold); assert.match(candidate.coastalHold.reason, /preparation-waiting: opening-budget/); assert.equal(candidate.lane, `construction:${source.id}`);
  for (const urgentStreak of [0, 2]) {
    const decisions = draw(state, { urgentStreak, lastRequiredLane: 'construction:city-0' });
    assert.ok(decisions.every(decision => !sameAction(yard, decision.action)));
    assert.ok(decisions.every(decision => decision.explanation.required));
  }
  const noProspect = structuredClone(state);
  for (const city of noProspect.cities.filter(city => city.civId === 0)) city.population = 5;
  assert.ok(assessed(noProspect, yard).coastalHold);
  assert.ok(draw(noProspect, { urgentStreak: 2, lastRequiredLane: 'construction:city-0' }).every(decision => !sameAction(yard, decision.action)));
  const damaged = structuredClone(state); damaged.cities.find(city => city.id === source.id)!.damage = 30;
  const decisions = draw(damaged, { urgentStreak: 0, lastRequiredLane: 'construction:city-0' });
  assert.ok(decisions.every(decision => !sameAction(yard, decision.action)));
  assert.ok(decisions.some(decision => decision.action?.type === 'repair-city'));
  const funded = structuredClone(state); funded.civilizations[0]!.resources.materials = 22;
  assert.equal(funded.cities.find(city => city.id === source.id)!.population, 6);
  const positive = draw(funded, { urgentStreak: 2, lastRequiredLane: 'construction:city-0' });
  assert.ok(positive.every(decision => sameAction(yard, decision.action)));
  assert.match(positive[0]!.explanation.reason, /coastal preparation/i);
  assert.match(positive[0]!.explanation.reason, /no residents move; fresh departure check required/i);
  assert.match(positive[0]!.explanation.reason, /14 Materials \+ 10 Credits/);
  assert.match(positive[0]!.explanation.reason, /current towns and commitments funded for 8 beats/);
  assert.ok(positive[0]!.explanation.reason.length <= 280);
  assert.doesNotMatch(positive[0]!.explanation.reason, /will (found|complete|reach)|guarantee/i);
});

void test('Yard hold survives relief competition and a live promise without displacing consented cargo', () => {
  const { state, source, yard } = fixture(); onlyYardAtSource(state, source); source.population = 6; reliefCorridor(state); state.civilizations[0]!.resources.materials = 21.99;
  const competition = draw(state, { urgentStreak: 0, lastRequiredLane: 'construction:city-0' });
  assert.ok(competition.some(decision => decision.action?.type === 'propose-relief'));
  assert.ok(competition.every(decision => !sameAction(yard, decision.action)));
  const proposal = availableReliefActions(state, 0).find(candidate => candidate.action.type === 'propose-relief')!;
  state.revision++; let events: GameEvent[] = []; assert.ok(executeReliefAction(state, 0, proposal.action, events)); commitEvents(state, events);
  const charter = state.relief!.active[0]!;
  state.revision++; events = []; assert.ok(executeReliefAction(state, charter.terms.recipientId, { type: 'respond-relief', charterId: charter.id, accept: true }, events)); commitEvents(state, events);
  assert.ok(isWorldState(state)); const promise = structuredClone(state.relief);
  assert.ok(assessed(state, yard).coastalHold);
  assert.ok(draw(state, { urgentStreak: 2, lastRequiredLane: 'construction:city-0' }).every(decision => !sameAction(yard, decision.action)));
  assert.deepEqual(state.relief, promise);
});

void test('unsafe sea departure stays out of ordinary and emergency draws while a supported control remains selectable', () => {
  const { state, source, founding } = readyFounding(); syntheticInstitution(state, source.id, 'irrigation'); source.population = 6; preserveRequiredWork(state);
  const candidate = assessed(state, founding); assert.equal(candidate.weight, 0); assert.ok(candidate.coastalHold);
  assert.ok(draw(state).every(decision => decision.action?.type !== 'settle-coast'));
  const damaged = structuredClone(state); damaged.cities.find(city => city.id === source.id)!.damage = 30;
  assert.ok(draw(damaged).every(decision => decision.action?.type !== 'settle-coast'));
  const funded = structuredClone(state); funded.cities.find(city => city.id === source.id)!.population = 9;
  const positive = draw(funded);
  assert.ok(positive.some(decision => decision.action?.type === 'settle-coast'));
  for (const decision of positive.filter(decision => decision.action?.type === 'settle-coast')) {
    const witness = deriveProgressionPlan(funded, funded.civilizations[0]!, profile(funded), options(funded)).coastalOpportunity.assessment(decision.action!).witness;
    assert.ok(witness && witness.protectedHorizon >= 8 && witness.protectedHorizon <= 18);
    assert.ok(decision.explanation.reason.startsWith(`Coastal departure: transfer 3 residents and pay founding costs; growing households and retained commitments funded for ${witness.protectedHorizon} beats `));
    assert.ok(decision.explanation.reason.length <= 280);
    assert.doesNotMatch(decision.explanation.reason, /will (found|complete|reach)|guarantee/i);
  }
});

void test('already paid Yard and active research remain unchanged through no-prospect chooser evaluation and restart', () => {
  const { state, source, yard } = fixture();
  const paid = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: epoch, action: yard }); assert.ok(paid.ok, paid.error);
  const started = applyCommand(paid.state, { seat: 0, expectedRevision: paid.state.revision, timestamp: '2026-10-24T00:00:10.000Z', action: { type: 'research', technology: 'navigation' } }); assert.ok(started.ok, started.error);
  for (const city of started.state.cities.filter(city => city.civId === 0)) city.population = 5;
  assert.ok(isWorldState(started.state)); const before = structuredClone(started.state);
  assert.ok(!options(started.state).some(candidate => candidate.action.type === 'research' || candidate.action.type === 'build' && candidate.action.cityId === source.id));
  draw(started.state);
  assert.deepEqual(started.state, before); assert.equal(started.state.civilizations[0]!.researchTarget, 'navigation');
  assert.deepEqual(started.state.cities.find(city => city.id === source.id)!.construction, before.cities.find(city => city.id === source.id)!.construction);
  assert.equal(started.state.civilizations[0]!.resources.science, 0);
});
