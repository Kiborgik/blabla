import { isDeepStrictEqual } from 'node:util';
import { applyCommand, applyRelease, createWorld } from '../core/engine.ts';
import { ECONOMY_RULES, RESOURCE_IDS } from '../core/content.ts';
import type { Resources, TransitionResult, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';

const EPOCH = '2026-10-16T00:00:00.000Z';

function createSyntheticRecoveryFixture(kind: number): { state: WorldState; target: string } {
  let state = createWorld(17, EPOCH);
  for (const targetReleaseId of ['settlement-foundations-2', 'settlement-independent-1', 'settlement-production-1', 'settlement-frontiers-1', 'settlement-specialization-1', 'settlement-recovery-1']) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId, timestamp: EPOCH });
    if (!result.ok) throw new Error(`Recovery probe release failed: ${result.error}`);
    state = result.state;
  }
  const own = state.cities.find((city) => city.id === 'city-0');
  const foreign = state.cities.find((city) => city.id === 'city-1');
  const owner = state.civilizations.find((civilization) => civilization.id === 0);
  const tile = state.tiles.find((site) => site.terrain !== 'ocean' && !state.cities.some((city) => city.tileId === site.id));
  if (!own || !foreign || !owner || !tile) throw new Error('Synthetic recovery fixture requires named settlements, owner and a distinct land tile');
  own.damage = kind === 1 ? 10 : kind === 2 ? 0 : kind === 7 ? ECONOMY_RULES.repair.damageReduction : 35;
  own.buildings = ['farm', 'workshop'];
  foreign.damage = 35;
  tile.owner = 0;
  state.cities.push({ ...structuredClone(own), id: 'synthetic-sibling', name: 'Synthetic sibling', tileId: tile.id, damage: 40 });
  const cost: Partial<Resources> = ECONOMY_RULES.repair.cost;
  for (const resource of RESOURCE_IDS) if ((cost[resource] ?? 0) > 0) owner.resources[resource] = cost[resource] ?? 0;
  if (kind === 5) owner.resources.materials = Math.max(0, ECONOMY_RULES.repair.cost.materials - .01);
  if (kind === 6) owner.resources.energy = Math.max(0, ECONOMY_RULES.repair.cost.energy - .01);
  const target = kind === 3 ? foreign.id : kind === 4 ? 'synthetic-missing-city' : own.id;
  if (!isWorldState(state)) throw new Error('Synthetic recovery fixture is not a canonical world');
  return { state, target };
}

function preservedCityFacts(state: WorldState) {
  return state.cities.map((city) => ({ id: city.id, population: city.population, buildings: city.buildings, infrastructure: city.infrastructure }));
}

export class RecoveryProbes {
  private state!: WorldState;
  private target = '';
  private accepted = false;
  private paidExactCost = false;
  private otherCitiesUnchanged = true;
  private peopleBuildingsUnchanged = true;
  private refusalUnchanged = true;
  private result: TransitionResult | null = null;

  constructor() { this.reset(); }

  reset(): void { this.prepare(0); }

  prepare(kind: number): void {
    const fixture = createSyntheticRecoveryFixture(kind);
    this.state = fixture.state;
    this.target = fixture.target;
    this.accepted = false;
    this.paidExactCost = false;
    this.otherCitiesUnchanged = true;
    this.peopleBuildingsUnchanged = true;
    this.refusalUnchanged = true;
    this.result = null;
  }

  snapshot() { return structuredClone({ state: this.state, target: this.target, timestamp: EPOCH, result: this.result }); }

  observe() {
    return {
      repair_accepted: this.accepted,
      repair_target_damage_units: Math.round((this.state.cities.find((city) => city.id === this.target)?.damage ?? 0) * 100),
      repair_reduction_units: Math.round(ECONOMY_RULES.repair.damageReduction * 100),
      repair_paid_exact_cost: this.paidExactCost,
      repair_other_cities_unchanged: this.otherCitiesUnchanged,
      repair_people_buildings_unchanged: this.peopleBuildingsUnchanged,
      repair_refusal_unchanged: this.refusalUnchanged,
    };
  }

  repair(): TransitionResult {
    if (!isWorldState(this.state)) throw new Error('Recovery command requires a canonical fixture');
    const before = structuredClone(this.state);
    const result = applyCommand(this.state, { seat: 0, expectedRevision: this.state.revision, action: { type: 'repair-city', cityId: this.target }, timestamp: EPOCH });
    if (!isWorldState(result.state)) throw new Error('Recovery command returned a noncanonical world');
    const cost: Partial<Resources> = ECONOMY_RULES.repair.cost;
    this.accepted = result.ok;
    this.paidExactCost = result.ok && before.civilizations.every((civilization) => {
      const after = result.state.civilizations.find((candidate) => candidate.id === civilization.id);
      return after !== undefined && RESOURCE_IDS.every((resource) => after.resources[resource] === civilization.resources[resource] - (civilization.id === 0 ? cost[resource] ?? 0 : 0));
    });
    this.otherCitiesUnchanged = isDeepStrictEqual(before.cities.filter((city) => city.id !== this.target), result.state.cities.filter((city) => city.id !== this.target));
    this.peopleBuildingsUnchanged = isDeepStrictEqual(preservedCityFacts(before), preservedCityFacts(result.state));
    this.refusalUnchanged = isDeepStrictEqual(before, result.state) && result.events.length === 0;
    this.state = result.state;
    this.result = result;
    return result;
  }
}
