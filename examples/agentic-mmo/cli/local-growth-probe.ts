import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { BUILDINGS, ECONOMY_RULES, RESOURCE_IDS } from '../core/content.ts';
import { cityGrowthFacts } from '../core/simulation/growth.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import type { TransitionResult, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { localGrowthOperationJourney } from '../tests/fixtures/local-growth-journey.ts';
import { coastalPrefixTime } from '../tests/fixtures/coastal-prefix.ts';

function town(state: WorldState) {
  const city = state.cities.find(candidate => candidate.id === 'city-0');
  assert.ok(city); return city;
}

function beat(state: WorldState): TransitionResult {
  const before = structuredClone(state);
  const result = catchUpStrategy(state, coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60));
  assert.deepEqual(state, before); assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state));
  return result;
}

function people(state: WorldState): number { return state.cities.reduce((sum, city) => sum + city.population, 0); }

export class LocalGrowthProbe {
  private basis: ReturnType<typeof localGrowthOperationJourney> | null = null;
  private state: WorldState | null = null;
  private before: WorldState | null = null;
  private result: TransitionResult | null = null;
  private control: TransitionResult | null = null;
  private operation = '';
  private provenance = 'Uninitialized; no fixture or transition executed';

  reset(): void {
    this.state = null; this.before = null; this.result = null; this.control = null; this.operation = '';
    this.provenance = 'Uninitialized; no fixture or transition executed';
  }

  private legal() {
    this.basis ??= localGrowthOperationJourney();
    return this.basis;
  }

  private select(state: WorldState, operation: string): void {
    this.state = structuredClone(state); this.before = null; this.result = null; this.control = null;
    this.operation = operation; this.provenance = 'Legal immutable engine journey from createWorld; no patched population stocks or era';
  }

  snapshot() { return structuredClone({ state: this.state, before: this.before, result: this.result, control: this.control, operation: this.operation, provenance: this.provenance }); }

  prepareScarcity(mode: 'shortage' | 'wellbeing' | 'capacity'): void {
    if (!['shortage', 'wellbeing', 'capacity'].includes(mode)) throw new RangeError('Unknown scarcity fixture');
    this.select(this.legal().completed, 'scarcity');
    assert.ok(this.state);
    if (mode === 'wellbeing') town(this.state).wellbeing = 0;
    if (mode === 'capacity') town(this.state).population = cityGrowthFacts(this.state, town(this.state)).capacity;
    if (mode === 'shortage') {
      const owner = this.state.civilizations[0]; assert.ok(owner); owner.resources.food = 0;
      for (const city of this.state.cities.filter(candidate => candidate.civId === 0)) city.damage = 100;
    }
    this.provenance = `Synthetic ${mode} component control detached from the legal Granary completion`;
    assert.ok(isWorldState(this.state));
  }

  call(action: string): void {
    if (!['adopt_local_housing', 'complete_granary', 'grow_with_food', 'allocate_later_resident', 'found_housed_town', 'refuse_invalid_growth'].includes(action)) throw new RangeError(`Unknown local-growth action ${action}`);
    const basis = this.legal();
    if (action === 'adopt_local_housing') {
      this.select(basis.journey.adopted, action); this.before = structuredClone(basis.journey.beforeRelease);
      return;
    }
    if (action === 'complete_granary') {
      this.select(basis.completed, action); this.before = structuredClone(basis.completionStep.before); this.result = structuredClone(basis.completionStep.result);
      return;
    }
    if (action === 'allocate_later_resident') {
      this.select(basis.growth, action); this.before = structuredClone(this.state); assert.ok(this.state);
      this.result = beat(this.state); this.state = this.result.state;
      return;
    }
    if (action === 'found_housed_town') {
      this.select(basis.journey.adopted, action); assert.ok(this.state);
      const timestamp = coastalPrefixTime((this.state.independentTurns?.strategyTicks ?? 0) * 60 + 30);
      const option = legalActions(this.state, 0, timestamp).find(candidate => candidate.action.type === 'settle');
      assert.ok(option, 'Actual legal land founding option required');
      this.before = structuredClone(this.state);
      this.result = applyCommand(this.state, { seat: 0, expectedRevision: this.state.revision, timestamp, action: option.action });
      assert.deepEqual(this.state, this.before); assert.ok(this.result.ok, this.result.error); assert.ok(isWorldState(this.result.state)); this.state = this.result.state;
      return;
    }
    if (action === 'refuse_invalid_growth') {
      this.state ??= structuredClone(basis.completed);
      this.before = structuredClone(this.state); this.control = null; this.operation = action;
      this.provenance = 'Actual missing-town Granary command against the observed world';
      this.result = applyCommand(this.state, { seat: 0, expectedRevision: this.state.revision, timestamp: coastalPrefixTime((this.state.independentTurns?.strategyTicks ?? 0) * 60 + 30), action: { type: 'build', project: 'granary', cityId: 'missing-growth-town' } });
      assert.deepEqual(this.state, this.before); this.state = this.result.state;
      return;
    }
    if (!this.state) this.select(basis.completed, action);
    this.operation = action; this.before = structuredClone(this.state); assert.ok(this.state);
    const control = structuredClone(this.state); const city = town(control); assert.ok(city.housing);
    city.housing.baseCapacity = city.population - cityGrowthFacts(control, city).sources.reduce((sum, source) => sum + source.capacity, 0);
    this.control = catchUpStrategy(control, coastalPrefixTime(((control.independentTurns?.strategyTicks ?? 0) + 1) * 60));
    assert.ok(this.control.ok, this.control.error);
    this.result = beat(this.state); this.state = this.result.state;
  }

  observe() {
    const state = this.state; const before = this.before; const city = state ? town(state) : null;
    const oldCity = before ? town(before) : null;
    const facts = state && city ? cityGrowthFacts(state, city) : null;
    const oldFacts = before && oldCity ? cityGrowthFacts(before, oldCity) : null;
    const growth = this.operation === 'grow_with_food' ? this.result?.events.find(event => event.populationGrowth?.cityId === city?.id)?.populationGrowth : undefined;
    const opening = before ? structuredClone(before) : null;
    if (opening) allocateOperations(opening);
    const operation = city?.buildingOperations?.university?.lastResult;
    const university = BUILDINGS.find(building => building.id === 'university');
    const founded = state && before ? state.cities.filter(candidate => !before.cities.some(previous => previous.id === candidate.id)) : [];
    const owned = state?.cities.filter(candidate => candidate.civId === city?.civId) ?? [];
    const conservativeFood = state ? owned.reduce((sum, candidate) => sum + candidate.population * ECONOMY_RULES.populationFoodUpkeep + cityGrowthFacts(state, candidate).nextGrowthFoodCost, 0) + ECONOMY_RULES.growth.foodReserve : 0;
    const funds = state?.civilizations.find(owner => owner.id === city?.civId)?.resources.food ?? 0;
    const exactCapacity = !!facts && !!city?.housing && facts.baseCapacity === city.housing.baseCapacity && facts.capacity === city.housing.baseCapacity + (city.buildings.includes('granary') ? 4 : 0) && (!before || before.cities.filter(previous => previous.id !== city.id).every(previous => { const current = state?.cities.find(candidate => candidate.id === previous.id); return !!state && !!current && cityGrowthFacts(before, previous).capacity === cityGrowthFacts(state, current).capacity; }));
    const actualResources = state?.civilizations[0]?.resources;
    const controlResources = this.control?.state.civilizations[0]?.resources;
    const newTown = founded[0];
    return {
      initialized: state !== null, provenance: this.provenance,
      control_provenance: this.control ? 'Synthetic detached capacity-only growth suppression; all actual input stocks and other mechanics retained' : null,
      population: city?.population ?? 0, capacity: facts?.capacity ?? 0,
      preserved: this.operation === 'adopt_local_housing' && !!state && !!before && equal(state.civilizations, before.civilizations) && equal(state.tiles, before.tiles) && equal(state.routes, before.routes) && equal(state.independentTurns, before.independentTurns) && state.round === before.round && state.year === before.year && state.cities.every(current => { const { housing: _housing, ...retained } = current; return equal(retained, before.cities.find(previous => previous.id === current.id)) && current.housing?.baseCapacity === Math.max(20, current.population); }),
      eligible_funded_growth: !!city && !!facts && city.population < facts.capacity && city.wellbeing >= ECONOMY_RULES.growth.wellbeing && city.damage === 0 && funds >= conservativeFood,
      grew: !!growth && !!city && !!oldCity && city.population === oldCity.population + 1,
      exact_local_capacity: exactCapacity && (!growth || growth.capacity === oldFacts?.capacity),
      paid_exact_food: !!growth && !!oldFacts && !!actualResources && !!controlResources && growth.foodPaid === oldFacts.nextGrowthFoodCost && RESOURCE_IDS.every(resource => Math.abs(controlResources[resource] - actualResources[resource] - (resource === 'food' ? growth.foodPaid : 0)) < 1e-8),
      conserved_old_people: !!state && !!before && people(state) === people(before) && (this.operation !== 'adopt_local_housing' || state.cities.every(current => current.population === before.cities.find(previous => previous.id === current.id)?.population)),
      completion_no_population: this.operation === 'complete_granary' && !!city && !!oldCity && !oldCity.buildings.includes('granary') && city.buildings.includes('granary') && city.population === oldCity.population && !this.result?.events.some(event => event.type === 'population-growth' && event.tileId === city.tileId),
      growth_uses_old_opening_allocation: !!growth && !!opening && !!operation && equal(operation.residents, town(opening).buildingOperations?.university?.lastResult?.residents) && operation.residents?.openingPopulation === oldCity?.population,
      next_opening_supports_recipe: this.operation === 'allocate_later_resident' && !!oldCity && oldCity.population === 21 && operation?.status === 'operated' && operation.residents?.openingPopulation === 21 && operation.residents.allocated === 3 && (operation.produced.science ?? 0) > 0,
      complete_recipe_inputs: this.operation === 'allocate_later_resident' && !!operation && !!university && equal(operation.paid, university.operatingInputs),
      correct_founded_capacity: this.operation === 'found_housed_town' && founded.length === 1 && newTown?.population === 3 && equal(newTown.housing, { ruleVersion: 1, baseCapacity: 8, establishedRound: state?.round, origin: 'founded' }),
      refused: this.result?.ok === false,
      no_effects: this.result?.ok === false && equal(this.result.state, before) && this.result.events.length === 0,
    };
  }
}
