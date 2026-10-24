import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createCoastalOpportunity } from '../core/behavior-coastal-opportunity.ts';
import { createProductiveFrontierAssessment } from '../core/behavior-frontier.ts';
import { createFoundingProtection } from '../core/behavior-founding-protection.ts';
import { assessCivilizationBehavior, createBehaviorMemory } from '../core/behaviors.ts';
import { behaviorPolicyVersion, civilizationBehaviorProfile } from '../core/behavior-profiles.ts';
import { deriveProgressionPlan, progressionAcquisitionPurpose, progressionWeight } from '../core/behavior-progression.ts';
import { BUILDINGS, ECONOMY_RULES, RESOURCE_IDS } from '../core/content.ts';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { coastalPathBlock, createCoastalPlanner, foundingSiteEligible, isCoastalSite } from '../core/simulation/coastal.ts';
import { cityGrowthFacts } from '../core/simulation/growth.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { turnAdmission } from '../core/simulation/turns.ts';
import { observedStrategicResources } from '../core/simulation/metals.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import { isWorldState } from '../core/validation.ts';
import type { ActionOption, City, Resources, WorldState } from '../core/types.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const timestamp = '2026-10-24T00:00:50.000Z';

function fixture() {
  const state = createGeneratedWorld(73, epoch, 'settlement-learning-patronage-1', 'cultural-toponyms-v1', 'strategic-temperaments-v1');
  const actor = state.civilizations[0]!;
  syntheticTechnologies(state, actor.id, ['water-management', 'civic-institutions', 'masonry']);
  for (const civilization of state.civilizations) civilization.resources = { food: 10000, materials: 10000, energy: 10000, credits: 10000, science: 0, culture: 10000 };
  const planner = createCoastalPlanner(state);
  const owned = state.tiles.filter(tile => tile.owner === actor.id);
  const sites = state.tiles.filter(tile => foundingSiteEligible(state, tile) && isCoastalSite(state, tile.id)).toSorted((a, b) => a.id - b.id);
  const tile = sites.find(source => sites.some(destination => hexDistance(source, destination) > 2 && owned.every(home => hexDistance(home, destination) > 2) && planner.quote(source.id, destination.id)));
  assert.ok(tile);
  const source: City = { id: 'synthetic-coastal-source', name: 'Controlled coastal prerequisite', civId: actor.id, tileId: tile.id, ...ECONOMY_RULES.initialCity, population: 6, wellbeing: 50, focus: 'industry', buildings: [], housing: { ruleVersion: 1, origin: 'founded', establishedRound: 0, baseCapacity: 8 }, construction: { active: null, lastCompleted: null } };
  tile.owner = actor.id; state.cities.push(source);
  syntheticInstitution(state, source.id, 'granary');
  assert.ok(isWorldState(state));
  const destinationTile = sites.find(destination => foundingSiteEligible(state, destination) && hexDistance(tile, destination) > 2 && owned.every(home => hexDistance(home, destination) > 2) && planner.quote(tile.id, destination.id));
  assert.ok(destinationTile);
  const destination: City = { id: 'conditional-coastal-town', name: 'Uncreated conditional town', civId: actor.id, tileId: destinationTile.id, ...ECONOMY_RULES.initialCity, population: 3, focus: source.focus, buildings: [], housing: { ruleVersion: 1, origin: 'founded', establishedRound: 0, baseCapacity: 8 } };
  const yard = { type: 'build', cityId: source.id, project: 'boat-yard' } as const;
  const departure = { type: 'settle-coast', sourceCityId: source.id, tileId: destinationTile.id } as const;
  return { state, actor, source, destination, destinationTile, yard, departure };
}

function options(state: WorldState) { return legalActions(state, 0, timestamp); }

void test('F1 original assessment permits present Yard while the identical snapshot cannot preserve departure staff', () => {
  const { state, source, destination, yard } = fixture();
  syntheticInstitution(state, source.id, 'irrigation');
  assert.equal(projectOperationAllocation(state).cities.find(city => city.id === source.id)!.buildingOperations!.irrigation!.lastResult!.status, 'operated');
  const before = structuredClone(state);
  const legal = options(state);
  assert.ok(legal.some(option => sameAction(option.action, yard)));
  const departure = createFoundingProtection(state, 0).fund({ source, destination, horizon: 8, foundingCost: ECONOMY_RULES.settle.cost, setupCost: {}, allocationMode: 'actual-payment', requireEnabledOperations: true });
  assert.equal(departure.facts, null);
  assert.match(departure.reason!, /protected-operation/);
  const preparation = createCoastalOpportunity(state, 0, legal).assessment(yard);
  assert.equal(preparation.hold, false, `Current-town preparation must not spend three residents: ${preparation.reason}`);
  assert.ok(preparation.witness);
  assert.equal(preparation.witness.mode, 'preparation');
  assert.equal(preparation.witness.populationTransfer, 0);
  assert.equal('foundingCost' in preparation.witness, false);
  assert.ok(preparation.witness.households.every(home => !home.prospective));
  assert.equal(preparation.witness.households.find(home => home.cityId === source.id)!.openingPopulation, 6);
  assert.deepEqual(preparation.witness.setupCost, { materials: 14, credits: 10 });
  assert.deepEqual(preparation.witness.allocations.find(allocation => allocation.key === `${source.id}/building/irrigation`), { key: `${source.id}/building/irrigation`, openingPopulation: 6, required: 3, available: 3, allocated: 3 });
  const candidate = assessCivilizationBehavior(state, 0, createBehaviorMemory(state, 0), legal).candidates.find(candidate => sameAction(candidate.option.action, yard));
  assert.ok(candidate && candidate.weight > 0);
  assert.equal(candidate.coastalHold, null);
  assert.deepEqual(state, before);
});

function currentFunding(state: WorldState, setupCost: Partial<Resources> = { materials: 14, credits: 10 }) {
  return createFoundingProtection(state, 0).fund({ kind: 'current-towns', horizon: 8, setupCost, allocationMode: 'actual-payment', requireEnabledOperations: true });
}

function departingFunding(state: WorldState, source: City, destination: City) {
  return createFoundingProtection(state, 0).fund({ source, destination, horizon: 8, foundingCost: ECONOMY_RULES.settle.cost, setupCost: {}, allocationMode: 'actual-payment', requireEnabledOperations: true });
}

void test('F2 independent Food sums separate unchanged current households from uncreated departure households', () => {
  const { state, source, destination, actor, yard } = fixture();
  const capital = state.cities.find(city => city.id === 'city-0')!;
  assert.equal(capital.population, 6); assert.equal(cityGrowthFacts(state, capital).capacity, 20);
  assert.equal(source.population, 6); assert.equal(cityGrowthFacts(state, source).capacity, 12);
  const stayingResidents = [6, 7, 8, 9, 10, 11, 12, 12];
  const departingResidents = [3, 4, 5, 6, 7, 8, 9, 10];
  const arrivingResidents = [3, 4, 5, 6, 7, 8, 8, 8];
  const stayingFood = stayingResidents.reduce((sum, population) => sum + population, 0) * 1.25 + [7, 7, 8, 8, 8, 8].reduce((a, b) => a + b, 0);
  const departingFood = departingResidents.reduce((sum, population) => sum + population, 0) * 1.25 + [6, 7, 7, 7, 7, 8, 8, 8].reduce((a, b) => a + b, 0);
  const arrivingFood = arrivingResidents.reduce((sum, population) => sum + population, 0) * 1.25 + [6, 7, 7, 7, 7].reduce((a, b) => a + b, 0);
  const capitalFood = [6, 7, 8, 9, 10, 11, 12, 13].reduce((sum, population) => sum + population, 0) * 1.25 + [7, 7, 8, 8, 8, 8, 9, 9].reduce((a, b) => a + b, 0);
  assert.equal(stayingFood, 139.75); assert.equal(departingFood, 123); assert.equal(arrivingFood, 95.25);
  assert.equal(departingFood + arrivingFood + 10, 228.25); assert.equal(capitalFood, 159);
  const before = structuredClone(state);
  const shared = createFoundingProtection(state, 0);
  const preparation = shared.fund({ kind: 'current-towns', horizon: 8, setupCost: { materials: 14, credits: 10 }, allocationMode: 'actual-payment', requireEnabledOperations: true });
  const departure = shared.fund({ source, destination, horizon: 8, foundingCost: ECONOMY_RULES.settle.cost, setupCost: {}, allocationMode: 'actual-payment', requireEnabledOperations: true });
  assert.ok(preparation.facts, preparation.reason ?? ''); assert.ok(departure.facts, departure.reason ?? '');
  assert.deepEqual(preparation.facts.households.map(home => [home.cityId, home.prospective, home.openingPopulation, home.capacity, home.growthCount]), [['city-0', false, 6, 20, 8], [source.id, false, 6, 12, 6]]);
  assert.deepEqual(departure.facts.households.map(home => [home.cityId, home.prospective, home.openingPopulation, home.capacity, home.growthCount]), [['city-0', false, 6, 20, 8], [source.id, false, 3, 12, 8], [null, true, 3, 8, 5]]);
  assert.equal(preparation.facts.protectedBudget.ordinary.food, capitalFood + 139.75);
  assert.equal(departure.facts.protectedBudget.ordinary.food, capitalFood + 228.25);
  assert.deepEqual(state, before);
  actor.resources.food = capitalFood + 180;
  const boundary = structuredClone(state);
  assert.ok(currentFunding(state).facts);
  const refused = departingFunding(state, source, destination);
  assert.equal(refused.facts, null); assert.match(refused.reason!, /opening-budget/);
  const publicPreparation = createCoastalOpportunity(state, 0, options(state)).assessment(yard);
  assert.equal(publicPreparation.hold, false); assert.equal(publicPreparation.witness!.protectedHorizon, 8);
  assert.deepEqual(state, boundary);
});

void test('F3 exact Yard and eight retained recipes need present Materials despite productive Granary and workshop', () => {
  const { state, actor, source, yard } = fixture();
  syntheticInstitution(state, source.id, 'irrigation'); syntheticInstitution(state, source.id, 'workshop');
  actor.resources.materials = 21.99;
  assert.ok(isWorldState(state));
  assert.ok(options(state).some(option => sameAction(option.action, yard)));
  const denied = createCoastalOpportunity(state, 0, options(state)).assessment(yard);
  assert.equal(denied.hold, true); assert.match(denied.reason!, /opening-budget/);
  actor.resources.materials = 22;
  const before = structuredClone(state);
  const funded = createCoastalOpportunity(state, 0, options(state)).assessment(yard);
  assert.equal(funded.hold, false); assert.equal(funded.witness!.protectedBudget.ordinary.materials, 14 + 8);
  assert.equal(funded.witness!.protectedBudget.ordinary.credits, 10);
  assert.deepEqual(funded.witness!.retainedOperations, [`${source.id}/building/irrigation`]);
  assert.deepEqual(funded.witness!.allocations, [{ key: `${source.id}/building/irrigation`, openingPopulation: 6, required: 3, available: 3, allocated: 3 }]);
  assert.equal(funded.witness!.protectedBudget.ordinary.science, 0);
  assert.deepEqual(state, before);
});

void test('F3 completed capabilities revalidate full departure and conserve exact payment and population once', () => {
  const { state, actor, source, departure } = fixture();
  source.population = 9;
  syntheticTechnologies(state, 0, ['navigation']); syntheticInstitution(state, source.id, 'boat-yard'); syntheticInstitution(state, source.id, 'irrigation');
  assert.ok(isWorldState(state));
  const opportunity = createCoastalOpportunity(state, 0, options(state)).assessment(departure);
  assert.equal(opportunity.hold, false); assert.ok(opportunity.witness && opportunity.witness.mode === 'founding');
  assert.equal(opportunity.witness.populationTransfer, 3); assert.deepEqual(opportunity.witness.foundingCost, { food: 10, materials: 12, credits: 8 });
  assert.deepEqual(opportunity.witness.setupCost, {});
  actor.resources = { ...opportunity.witness.protectedBudget.ordinary };
  const before = structuredClone(state);
  assert.equal(createCoastalOpportunity(state, 0, options(state)).assessment(departure).hold, false);
  const command = { seat: 0, expectedRevision: state.revision, timestamp, action: departure };
  const applied = applyCommand(state, command); assert.ok(applied.ok, applied.error); assert.ok(isWorldState(applied.state));
  assert.equal(applied.state.cities.reduce((sum, city) => sum + city.population, 0), state.cities.reduce((sum, city) => sum + city.population, 0));
  assert.equal(applied.state.cities.find(city => city.id === source.id)!.population, 6);
  const founded = applied.state.cities.find(city => city.tileId === departure.tileId)!;
  assert.equal(founded.population, 3); assert.deepEqual(founded.buildings, []); assert.equal(founded.construction?.active ?? null, null);
  assert.deepEqual(founded.coastalFounding!.paid, { food: 10, materials: 12, credits: 8 });
  for (const resource of RESOURCE_IDS) assert.equal(applied.state.civilizations[0]!.resources[resource], actor.resources[resource] - (ECONOMY_RULES.settle.cost[resource as keyof typeof ECONOMY_RULES.settle.cost] ?? 0));
  const repeated = applyCommand(applied.state, command); assert.equal(repeated.ok, false); assert.deepEqual(repeated.state, applied.state); assert.deepEqual(repeated.events, []);
  assert.deepEqual(applyCommand(JSON.parse(JSON.stringify(state)) as WorldState, command), applied);
  assert.deepEqual(state, before);
  const unsafe = structuredClone(state); unsafe.cities.find(city => city.id === source.id)!.population = 6; unsafe.civilizations[0]!.resources.food = 10000;
  const hold = createCoastalOpportunity(unsafe, 0, options(unsafe)).assessment(departure);
  assert.equal(hold.hold, true); assert.match(hold.reason!, /protected-operation/);
  assert.ok(unsafe.cities.find(city => city.id === source.id)!.buildings.includes('boat-yard'));
  assert.ok(unsafe.civilizations[0]!.technologies.includes('navigation'));
});

for (const yardStage of ['missing', 'active', 'completed'] as const) for (const navigationStage of ['missing', 'active', 'completed', 'other-active'] as const) {
  void test(`F6 ${yardStage} Yard and ${navigationStage} Navigation preserve exact independent stages`, () => {
    const initial = fixture(); let state = initial.state;
    if (yardStage === 'active') {
      const paid = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: epoch, action: initial.yard }); assert.ok(paid.ok, paid.error); state = paid.state;
      assert.equal(state.civilizations[0]!.resources.materials, 10000 - 14); assert.equal(state.civilizations[0]!.resources.credits, 10000 - 10);
    } else if (yardStage === 'completed') syntheticInstitution(state, initial.source.id, 'boat-yard');
    const source = state.cities.find(city => city.id === initial.source.id)!; const actor = state.civilizations[0]!;
    syntheticInstitution(state, source.id, 'irrigation');
    if (navigationStage === 'completed') syntheticTechnologies(state, 0, ['navigation']);
    if (navigationStage === 'active' || navigationStage === 'other-active') { actor.researchTarget = navigationStage === 'active' ? 'navigation' : 'writing'; actor.researchProgress = 1; }
    assert.ok(isWorldState(state)); const before = structuredClone(state); const choices = options(state);
    const current = createCoastalOpportunity(state, 0, choices); const navigation = { type: 'research', technology: 'navigation' } as const;
    assert.equal(current.navigationGoal, navigationStage === 'missing');
    assert.equal(current.assessment(navigation).hold, false);
    const preparation = yardStage === 'missing' ? current.assessment(initial.yard) : current.assessment(navigation);
    if (yardStage === 'missing' || navigationStage === 'missing') {
      assert.ok(preparation.witness && preparation.witness.mode === 'preparation', preparation.reason ?? '');
      assert.equal(preparation.witness.yard, yardStage); assert.equal(preparation.witness.populationTransfer, 0);
      assert.deepEqual(preparation.witness.setupCost, yardStage === 'missing' ? { materials: 14, credits: 10 } : {});
      assert.equal(preparation.witness.protectedBudget.ordinary.materials, 8 + (yardStage === 'missing' ? 14 : 0));
      assert.equal(preparation.witness.protectedBudget.ordinary.credits, yardStage === 'missing' ? 10 : 0);
      assert.ok(preparation.witness.households.every(home => !home.prospective));
      assert.equal('foundingCost' in preparation.witness, false);
    }
    if (yardStage !== 'missing') assert.equal(choices.some(option => sameAction(option.action, initial.yard)), false);
    const profile = civilizationBehaviorProfile(state.seed, 0, behaviorPolicyVersion(state));
    const plan = deriveProgressionPlan(state, actor, profile, choices);
    const ordinaryNavigation = choices.find(option => sameAction(option.action, navigation));
    if (ordinaryNavigation) assert.equal(progressionWeight(ordinaryNavigation, 11, state, actor, profile, plan), 55);
    const departure = current.assessment(initial.departure);
    assert.equal(departure.hold, true);
    if (yardStage === 'completed' && navigationStage === 'completed') assert.match(departure.reason!, /protected-operation/);
    else assert.match(departure.reason!, /not-ready/);
    assert.deepEqual(state, before);
  });
}

void test('F6 busy missing-Yard lane has no coastal Navigation bonus but ordinary legal Navigation remains', () => {
  const { state, source, yard } = fixture();
  const paid = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: epoch, action: { type: 'build', cityId: source.id, project: 'workshop' } });
  assert.ok(paid.ok, paid.error); assert.ok(isWorldState(paid.state));
  const before = structuredClone(paid.state); const choices = options(paid.state);
  const navigation = choices.find(option => option.action.type === 'research' && option.action.technology === 'navigation'); assert.ok(navigation);
  assert.equal(choices.some(option => sameAction(option.action, yard)), false);
  const current = createCoastalOpportunity(paid.state, 0, choices);
  assert.equal(current.navigationGoal, false); assert.equal(current.assessment(navigation.action).hold, false); assert.equal(current.assessment(navigation.action).witness, null);
  const actor = paid.state.civilizations[0]!; const profile = civilizationBehaviorProfile(paid.state.seed, 0, behaviorPolicyVersion(paid.state));
  assert.equal(progressionWeight(navigation, 11, paid.state, actor, profile, deriveProgressionPlan(paid.state, actor, profile, choices)), 5.5);
  assert.deepEqual(paid.state, before);
});

for (const paidStage of ['active', 'completed'] as const) void test(`F6 ${paidStage} paid port suppresses the same shore only after full departure funding`, () => {
  const initial = fixture(); let state = initial.state; initial.source.population = 9;
  const planner = createCoastalPlanner(state);
  const sourceTile = state.tiles.find(tile => tile.id === initial.source.tileId)!;
  const paidTile = state.tiles.find(tile => foundingSiteEligible(state, tile) && isCoastalSite(state, tile.id) && hexDistance(tile, sourceTile) >= 2 && hexDistance(tile, initial.destinationTile) > 2 && planner.quote(tile.id, initial.destinationTile.id));
  assert.ok(paidTile, 'The single map needs a distinct port serving the same exact distant shore');
  const paid: City = { ...structuredClone(initial.source), id: 'synthetic-paid-port', name: 'Controlled paid port', tileId: paidTile.id, population: 6 };
  state.cities.push(paid); paidTile.owner = 0; syntheticInstitution(state, paid.id, 'irrigation');
  for (const tile of state.tiles) if (tile.id !== initial.destinationTile.id && foundingSiteEligible(state, tile)) tile.owner = 1;
  if (paidStage === 'active') {
    const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: epoch, action: { type: 'build', cityId: paid.id, project: 'boat-yard' } }); assert.ok(result.ok, result.error); state = result.state;
  } else syntheticInstitution(state, paid.id, 'boat-yard');
  const paidSource = state.cities.find(city => city.id === paid.id)!;
  assert.ok(isWorldState(state)); const before = structuredClone(state);
  const current = currentFunding(state, {}); assert.ok(current.facts, current.reason ?? '');
  const departure = departingFunding(state, paidSource, initial.destination); assert.equal(departure.facts, null); assert.match(departure.reason!, /protected-operation/);
  const viableAlternative = createCoastalOpportunity(state, 0, options(state)).assessment(initial.yard);
  assert.equal(viableAlternative.hold, false, viableAlternative.reason ?? ''); assert.equal(viableAlternative.witness!.tileId, initial.destinationTile.id);
  assert.deepEqual(state, before);
  paidSource.population = 9;
  assert.ok(departingFunding(state, paidSource, initial.destination).facts);
  const redundant = createCoastalOpportunity(state, 0, options(state)).assessment(initial.yard);
  assert.equal(redundant.hold, true); assert.match(redundant.reason!, /existing-investment/);
  const notActuallyReady = createCoastalOpportunity(state, 0, options(state)).assessment({ type: 'settle-coast', sourceCityId: paid.id, tileId: initial.destinationTile.id });
  assert.equal(notActuallyReady.hold, true); assert.match(notActuallyReady.reason!, /not-ready/);
});

void test('F7 preparation remains exact-current-only and never substitutes for departure capability or path', () => {
  const { state, source, yard, departure } = fixture();
  const choices = options(state); const current = createCoastalOpportunity(state, 0, choices);
  const prepared = current.assessment(yard); assert.ok(prepared.witness);
  assert.equal(prepared.witness.revision, state.revision); assert.equal(prepared.witness.round, state.round);
  assert.equal(current.assessment(departure).hold, true);
  const missingOption = createCoastalOpportunity(state, 0, choices.filter(option => !sameAction(option.action, yard)));
  assert.equal(missingOption.assessment(yard).hold, true); assert.equal(missingOption.navigationGoal, false);
  const rejected = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp, action: departure });
  assert.equal(rejected.ok, false); assert.deepEqual(rejected.state, state); assert.deepEqual(rejected.events, []);
  state.revision++; assert.equal(current.assessment(yard).hold, true); assert.match(current.assessment(yard).reason!, /stale/);
  assert.equal(createCoastalOpportunity(state, 0, options(state)).assessment(yard).hold, false);
  source.population = 5;
  assert.equal(createCoastalOpportunity(state, 0, options(state)).assessment(yard).hold, true);
});

void test('F7 completed current departure rejects claimed endpoints and altered exact legal ocean quotes', () => {
  const { state, source, departure } = fixture(); source.population = 9;
  syntheticTechnologies(state, 0, ['navigation']); syntheticInstitution(state, source.id, 'boat-yard');
  const choices = options(state); const selected = choices.find(option => sameAction(option.action, departure)); assert.ok(selected?.coastalQuote);
  assert.equal(coastalPathBlock(state, selected.coastalQuote, source.tileId, departure.tileId), null);
  assert.equal(createCoastalOpportunity(state, 0, choices).assessment(departure).hold, false);
  const altered: ActionOption = { ...selected, coastalQuote: { ...selected.coastalQuote, tileIds: [source.tileId, departure.tileId], edges: 1 } };
  const before = structuredClone(state);
  assert.equal(createCoastalOpportunity(state, 0, [altered]).assessment(departure).hold, true);
  assert.equal(createCoastalOpportunity(state, 0, choices.filter(option => !sameAction(option.action, departure))).assessment(departure).hold, true);
  assert.deepEqual(state, before);
  const claimed = structuredClone(state); claimed.tiles.find(tile => tile.id === departure.tileId)!.owner = 1;
  assert.ok(isWorldState(claimed)); assert.equal(createCoastalOpportunity(claimed, 0, options(claimed)).assessment(departure).hold, true);
});

const oraclePath = process.env.FRONTIER_PARITY_ORACLE;
if (oraclePath) {
  const legacy = await import(pathToFileURL(oraclePath).href) as typeof import('../core/behavior-frontier.ts');
  const legacyProgression = await import(pathToFileURL(join(dirname(oraclePath), 'behavior-progression.ts')).href) as typeof import('../core/behavior-progression.ts');
  const legacyEngine = await import(pathToFileURL(join(dirname(oraclePath), 'engine.ts')).href) as typeof import('../core/engine.ts');
  const legacyMetals = await import(pathToFileURL(join(dirname(oraclePath), 'simulation/metals.ts')).href) as typeof import('../core/simulation/metals.ts');
  for (const variant of ['funded', 'food-short', 'material-short', 'pending-housing', 'pending-recipe'] as const) void test(`F8 old dependency-pinned fresh Farm full facts parity: ${variant}`, () => {
    const { state } = fixture();
    const inland = options(state).find(option => option.action.type === 'settle' && option.action.sourceCityId === 'city-0'); assert.ok(inland?.action.type === 'settle');
    const oldFounding = legacy.createProductiveFrontierAssessment(state, 0).founding(inland.action);
    const newFounding = createProductiveFrontierAssessment(state, 0).founding(inland.action);
    assert.ok(oldFounding.quote); assert.deepEqual(newFounding, oldFounding);
    const founded = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp, action: inland.action }); assert.ok(founded.ok, founded.error);
    const foundedTileId = inland.action.tileId;
    const town = founded.state.cities.find(city => city.tileId === foundedTileId)!;
    if (variant === 'food-short') founded.state.civilizations[0]!.resources.food = 0;
    if (variant === 'material-short') founded.state.civilizations[0]!.resources.materials = BUILDINGS.find(building => building.id === 'farm')!.cost.materials! - 0.01;
    if (variant === 'pending-housing' || variant === 'pending-recipe') {
      const city = founded.state.cities.find(city => city.id === 'city-0')!;
      city.population = 9;
      const definition = BUILDINGS.find(building => building.id === (variant === 'pending-housing' ? 'granary' : 'irrigation'))!;
      founded.state.revision++;
      city.construction = { active: { id: `construction-${founded.state.revision}`, cityId: city.id, buildingId: definition.id, ruleVersion: 1, startedRound: founded.state.round, paid: { ...definition.cost }, workRequired: variant === 'pending-housing' ? 8 : 6, workDone: 1 }, lastCompleted: null };
    }
    assert.ok(isWorldState(founded.state));
    const before = structuredClone(founded.state);
    const oldFarm = legacy.createProductiveFrontierAssessment(founded.state, 0).farm(town.id);
    const newFarm = createProductiveFrontierAssessment(founded.state, 0).farm(town.id);
    if (variant === 'food-short' || variant === 'material-short') { assert.equal(oldFarm.quote, null); assert.match(oldFarm.reason!, variant === 'material-short' ? /Farm-unavailable/ : /opening-budget/); }
    else { assert.ok(oldFarm.quote, oldFarm.reason ?? ''); assert.equal(oldFarm.quote.mode, 'farm'); }
    assert.deepEqual(newFarm, oldFarm);
    assert.deepEqual(founded.state, before);
  });
  void test('F8 old dependency-pinned exact-state Iron reveal and acquisition purposes remain unchanged', () => {
    const state = createGeneratedWorld(73, epoch, 'settlement-regional-iron-1', 'cultural-toponyms-v1', 'strategic-temperaments-v1');
    let strategicActions = 0;
    for (const actor of state.civilizations) {
      actor.resources = { food: 10000, materials: 10000, energy: 10000, credits: 10000, science: 0, culture: 10000 };
      assert.deepEqual(observedStrategicResources(state, actor.id), legacyMetals.observedStrategicResources(state, actor.id));
      syntheticTechnologies(state, actor.id, ['bronze-working']);
      const before = structuredClone(state);
      const observed = observedStrategicResources(state, actor.id); assert.ok(observed.revealedDeposits!.some(deposit => deposit.resource === 'iron'));
      assert.deepEqual(observed, legacyMetals.observedStrategicResources(state, actor.id));
      const choices = legalActions(state, actor.id, timestamp); const profile = civilizationBehaviorProfile(state.seed, actor.id, behaviorPolicyVersion(state));
      const oldPlan = legacyProgression.deriveProgressionPlan(state, actor, profile, choices); const newPlan = deriveProgressionPlan(state, actor, profile, choices);
      for (const option of choices.filter(option => option.action.type === 'acquire-tile')) {
        const oldPurpose = legacyProgression.progressionAcquisitionPurpose(option.action, actor, oldPlan);
        assert.equal(progressionAcquisitionPurpose(option.action, actor, newPlan), oldPurpose);
        assert.equal(progressionWeight(option, 11, state, actor, profile, newPlan), legacyProgression.progressionWeight(option, 11, state, actor, profile, oldPlan));
        if (oldPurpose === 'strategic-extraction') strategicActions++;
      }
      assert.deepEqual(state, before);
    }
    assert.ok(strategicActions > 0);
  });
  void test('F8 old dependency-pinned finite Mine pays, completes and extracts identical final opening reserve', () => {
    let state = createGeneratedWorld(73, epoch, 'settlement-regional-iron-1', 'cultural-toponyms-v1', 'strategic-temperaments-v1');
    for (const actor of state.civilizations) {
      actor.resources = { food: 10000, materials: 10000, energy: 10000, credits: 10000, science: 0, culture: 10000 };
      syntheticTechnologies(state, actor.id, ['bronze-working']);
    }
    const choice = state.civilizations.flatMap(actor => legalActions(state, actor.id, epoch).map(option => ({ actor, option }))).find(({ option }) => option.action.type === 'acquire-tile' && state.strategicDeposits!.tileIds.includes(option.action.tileId));
    assert.ok(choice?.option.action.type === 'acquire-tile');
    const acquisition = choice.option.action; const seat = choice.actor.id;
    const purchaseCommand = { seat, expectedRevision: state.revision, timestamp: epoch, action: acquisition };
    const purchase = applyCommand(state, purchaseCommand); assert.ok(purchase.ok, purchase.error);
    assert.deepEqual(purchase, legacyEngine.applyCommand(structuredClone(state), purchaseCommand)); state = purchase.state;
    const action = { type: 'improve', cityId: acquisition.cityId, tileId: acquisition.tileId, improvementId: 'mine' } as const;
    assert.ok(legalActions(state, seat, timestamp).some(option => sameAction(option.action, action)));
    const command = { seat, expectedRevision: state.revision, timestamp, action };
    const paid = applyCommand(state, command); assert.ok(paid.ok, paid.error);
    assert.deepEqual(paid, legacyEngine.applyCommand(structuredClone(state), command)); state = paid.state;
    for (let beats = 0; beats < 4 && state.cities.find(city => city.id === action.cityId)!.construction?.active; beats++) {
      const at = turnAdmission(state, seat).nextStrategyAt; assert.ok(at);
      const next = catchUpStrategy(state, at); assert.ok(next.ok, next.error);
      assert.deepEqual(next, legacyEngine.catchUpStrategy(structuredClone(state), at)); state = next.state;
    }
    const city = state.cities.find(city => city.id === action.cityId)!;
    assert.equal(city.construction?.active ?? null, null); assert.ok(city.improvements?.[String(action.tileId)]);
    state.strategicDeposits!.deposits[String(action.tileId)]!.remaining = 1;
    const before = structuredClone(state); const at = turnAdmission(state, seat).nextStrategyAt; assert.ok(at);
    const exhausted = catchUpStrategy(state, at); assert.ok(exhausted.ok, exhausted.error);
    assert.deepEqual(exhausted, legacyEngine.catchUpStrategy(structuredClone(state), at)); assert.deepEqual(state, before);
    const extraction = exhausted.state.cities.find(city => city.id === action.cityId)!.improvements![String(action.tileId)]!.operation.lastResult!.extraction;
    assert.ok(extraction); assert.equal(extraction.quantity, 1); assert.equal(extraction.reserveBefore, 1); assert.equal(extraction.reserveAfter, 0);
    assert.equal(exhausted.state.civilizations[seat]!.strategicResources!.iron, (state.civilizations[seat]!.strategicResources?.iron ?? 0) + 1);
  });
}
