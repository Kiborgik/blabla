import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { chooseCivilizationBehavior, chooseDirectorBehavior, createBehaviorMemory, isBehaviorMemory } from '../core/behaviors.ts';
import { ECONOMY_RULES, LOCAL_GROWTH_RULES } from '../core/content.ts';
import { applyCommand, legalActions } from '../core/engine.ts';
import { RELEASES } from '../core/release.ts';
import { sameAction } from '../core/simulation/choices.ts';
import type { HexTile } from '../core/types.ts';
import { ACTIVE_LOCAL_POLICY_VERSION, ACTIVE_LOCAL_RELEASE_ID, createLocalSimulation, advanceLocalSimulation, parseLocalSimulation, type LocalSimulation } from '../web/local-simulation.ts';

const EPOCH = '2000-01-01T00:00:00.000Z';
const POLICY = 'weighted-civilizations-v5-funded-landwork';
const RELEASE = 'settlement-productive-frontiers-1';
const TERRAINS = ['grassland', 'forest', 'desert', 'tundra', 'mountain', 'ocean'];
const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const;
const json = (value: unknown): string => JSON.stringify(value) ?? 'undefined';
const digest = (value: unknown): string => createHash('sha256').update(json(value)).digest('hex');
const passable = (tile: HexTile): boolean => tile.terrain !== 'ocean' && tile.terrain !== 'mountain';
const distance = (a: HexTile, b: HexTile): number => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));

export interface GeneratedControllerSample {
  seed: number; width: number; height: number; tile_count: number;
  land_count: number; passable_count: number; connected_count: number;
  land_fraction: number; connected_fraction: number; connected_capitals: number;
  capital_count: number; minimum_spacing: number; viable_capitals: number;
  coastal_capitals: number; neighborhood_kinds: number;
  terrain_signature: string; start_signature: string; origin_json: string; expected_origin_json: string;
  world_digest: string; repeat_world_digest: string; policy_version: string; release_id: string; genesis_errors: number;
}

export interface GeneratedControllerDecision {
  seat: number; action_digest: string; repeated_action_digest: string;
  decision_digest: string; repeated_decision_digest: string;
  input_world_before: string; input_world_after: string; input_memory_before: string; input_memory_after: string;
  policy_version: string; profile_id: string; explanation_profile_id: string; source: string;
  cursor_before: number; cursor_after: number; revision_before: number; revision_after: number;
  accepted: boolean; memory_valid: boolean; legal_member: boolean; genesis_before: string; genesis_after: string;
}

export interface GeneratedControllerContinuation {
  step: number; left_revision: number; right_revision: number;
  left_world_digest: string; right_world_digest: string; left_memory_digest: string; right_memory_digest: string;
  left_decision_digest: string; right_decision_digest: string; left_envelope_digest: string; right_envelope_digest: string;
  left_genesis: string; right_genesis: string;
}

export function inspectGeneratedSample(seed: number, run: LocalSimulation, repeat: LocalSimulation): GeneratedControllerSample {
  const state = run.state;
  const expectedOrigin = { kind: 'generated', generatorVersion: 'coherent-geography-v1', seed: seed >>> 0, clockEpoch: EPOCH, namingVersion: 'cultural-toponyms-v1', temperamentVersion: 'strategic-temperaments-v1', initialReleaseId: RELEASE };
  let errors = 0;
  const check = (condition: boolean): void => { if (!condition) errors += 1; };
  check(isDeepStrictEqual(state.origin, expectedOrigin));
  check(state.seed === (seed >>> 0));
  check(run.seed === state.seed);
  check(run.version === 2 && run.source === 'local-procedural');
  check(run.policyVersion === POLICY && run.policyVersion === ACTIVE_LOCAL_POLICY_VERSION);
  check(state.releaseId === RELEASE && state.releaseId === ACTIVE_LOCAL_RELEASE_ID);
  check(run.timestamp === EPOCH && run.steps === 0);
  check(run.memories.length === 6 && run.memories.every(memory => memory === null));
  check(run.decisions.length === 0);
  check(state.revision === 0 && state.round === 0 && state.clockTicks === 0 && state.clockEpoch === EPOCH);
  check(state.independentTurns?.epoch === EPOCH && state.independentTurns.strategyTicks === 0);
  check(state.independentTurns?.lastActionWindow.length === 6 && state.independentTurns.lastActionWindow.every(window => window === -1));
  check(state.independentTurns?.actionsInWindow.length === 6 && state.independentTurns.actionsInWindow.every(count => count === 0));
  check(state.width === 18 && state.height === 24 && state.tiles.length === 432);
  check(Number.isSafeInteger(state.rng) && state.rng >= 0 && state.rng <= 0xffffffff);
  const release = RELEASES.find(candidate => candidate.id === RELEASE);
  check(release !== undefined && state.schemaVersion === release.schemaVersion && state.gameVersion === release.gameVersion && isDeepStrictEqual([...state.unlockedFeatures].sort(), [...release.featureIds].sort()));
  for (const [index, tile] of state.tiles.entries()) {
    check(tile.id === index);
    check(tile.q === index % state.width && tile.r === Math.floor(index / state.width));
    check(Number.isInteger(tile.elevation) && tile.elevation >= 0 && tile.elevation <= 100);
    check(TERRAINS.includes(tile.terrain));
    check(tile.terrain !== 'ocean' || tile.elevation < 30);
    check(tile.terrain !== 'mountain' || tile.elevation > 88);
  }
  check(state.civilizations.length === 5 && new Set(state.civilizations.map(civ => civ.id)).size === 5);
  for (const [seat, civ] of state.civilizations.entries()) {
    check(civ.id === seat);
    check(isDeepStrictEqual(civ.resources, ECONOMY_RULES.initialResources));
    check(civ.technologies.length === 0 && civ.researchTarget === '' && civ.researchProgress === 0 && civ.lastResearchCompletion === undefined);
    check(civ.era === 0 && civ.marsPopulation === 0 && civ.marsProgress === 0);
    check(civ.civics?.completedCivicIds.length === 0 && civ.civics.active === null && civ.civics.lastCompleted === null);
  }
  check(state.cities.length === 5 && new Set(state.cities.map(city => city.id)).size === 5 && new Set(state.cities.map(city => city.civId)).size === 5);
  for (const [seat, city] of state.cities.entries()) {
    check(city.id === `city-${seat}` && city.civId === seat);
    check(city.population === 6 && city.population === ECONOMY_RULES.initialCity.population);
    check(city.housing?.baseCapacity === 20 && city.housing.baseCapacity === LOCAL_GROWTH_RULES.initialCapitalBaseCapacity && city.housing.origin === 'initial-capital' && city.housing.establishedRound === 0);
    check(city.buildings.length === 0 && !city.construction?.lastCompleted && !city.construction?.active);
    const tile = state.tiles.find(candidate => candidate.id === city.tileId);
    check(tile !== undefined && tile.terrain === 'grassland' && tile.owner === city.civId && tile.resource === 'food');
  }
  check(state.routes.length === 0 && state.treaties.length === 0 && state.calendarMilestones.length === 0 && state.outcome === null);
  check(state.events.length === 1);
  const foundation = state.events[0];
  check(foundation?.id === '0:foundation' && foundation.round === 0 && foundation.type === 'world-founded' && foundation.actor === null && foundation.target === null && foundation.tileId === null);
  check(isDeepStrictEqual(state.eventCounts, { 'world-founded': 1 }));
  const byCoordinate = new Map(state.tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
  const capitals = state.cities.map(city => state.tiles.find(tile => tile.id === city.tileId));
  const connected = new Set<number>();
  const first = capitals[0];
  const queue: HexTile[] = [];
  if (first && passable(first)) { queue.push(first); connected.add(first.id); }
  for (let head = 0; head < queue.length; head += 1) {
    const tile = queue[head]!;
    for (const [dq, dr] of DIRECTIONS) {
      const neighbor = byCoordinate.get(`${tile.q + dq},${tile.r + dr}`);
      if (neighbor && passable(neighbor) && !connected.has(neighbor.id)) { connected.add(neighbor.id); queue.push(neighbor); }
    }
  }
  let minimum = Number.POSITIVE_INFINITY;
  let viable = 0;
  let coastal = 0;
  const neighborhoods = new Set<string>();
  for (const [index, capital] of capitals.entries()) {
    if (!capital) { minimum = 0; continue; }
    for (const other of capitals.slice(index + 1)) minimum = Math.min(minimum, other ? distance(capital, other) : 0);
    const nearby = state.tiles.filter(tile => distance(capital, tile) <= 3);
    if (capital.terrain === 'grassland' && nearby.filter(passable).length >= 12 && nearby.some(tile => tile.terrain === 'forest')) viable += 1;
    if (passable(capital) && state.tiles.some(tile => tile.terrain === 'ocean' && distance(capital, tile) === 1)) coastal += 1;
    neighborhoods.add(TERRAINS.map(terrain => nearby.filter(tile => tile.terrain === terrain).length).join(','));
  }
  const land = state.tiles.filter(tile => tile.terrain !== 'ocean').length;
  const traversable = state.tiles.filter(passable).length;
  return {
    seed, width: state.width, height: state.height, tile_count: state.tiles.length,
    land_count: land, passable_count: traversable, connected_count: connected.size,
    land_fraction: state.tiles.length ? land / state.tiles.length : 0, connected_fraction: traversable ? connected.size / traversable : 0,
    connected_capitals: capitals.filter(tile => tile && connected.has(tile.id)).length,
    capital_count: state.cities.length, minimum_spacing: Number.isFinite(minimum) ? minimum : 0,
    viable_capitals: viable, coastal_capitals: coastal, neighborhood_kinds: neighborhoods.size,
    terrain_signature: digest(state.tiles.map(tile => [tile.id, tile.q, tile.r, tile.terrain, tile.elevation])),
    start_signature: digest(state.cities.map(city => [city.id, city.civId, city.tileId])),
    origin_json: json(state.origin), expected_origin_json: json(expectedOrigin),
    world_digest: digest(state), repeat_world_digest: digest(repeat.state), policy_version: run.policyVersion, release_id: state.releaseId, genesis_errors: errors,
  };
}

export function inspectControllerCheckpoint(checkpoint: LocalSimulation, restored: LocalSimulation | null) {
  return {
    gc_checkpoint_parse_accepted: restored !== null,
    gc_checkpoint_steps: checkpoint.steps, gc_restored_steps: restored?.steps ?? 0,
    gc_checkpoint_revision: checkpoint.state.revision,
    gc_checkpoint_populated_memories: checkpoint.memories.filter((memory, seat) => memory !== null && isBehaviorMemory(memory) && memory.policyVersion === POLICY && memory.seat === seat && memory.seed === checkpoint.seed && memory.decisionCount > 0).length,
    gc_checkpoint_world_digest: digest(checkpoint.state), gc_restored_world_digest: restored ? digest(restored.state) : '',
    gc_checkpoint_memory_digest: digest(checkpoint.memories), gc_restored_memory_digest: restored ? digest(restored.memories) : '',
    gc_checkpoint_envelope_digest: digest(checkpoint), gc_restored_envelope_digest: restored ? digest(restored) : '',
    gc_checkpoint_genesis: json(checkpoint.state.origin),
  };
}

export function inspectControllerContinuation(step: number, left: LocalSimulation, right: LocalSimulation): GeneratedControllerContinuation {
  return {
    step, left_revision: left.state.revision, right_revision: right.state.revision,
    left_world_digest: digest(left.state), right_world_digest: digest(right.state),
    left_memory_digest: digest(left.memories), right_memory_digest: digest(right.memories),
    left_decision_digest: digest(left.decisions), right_decision_digest: digest(right.decisions),
    left_envelope_digest: digest(left), right_envelope_digest: digest(right),
    left_genesis: json(left.state.origin), right_genesis: json(right.state.origin),
  };
}

interface ProbeDependencies {
  create: typeof createLocalSimulation;
  chooseCivilization: typeof chooseCivilizationBehavior;
  chooseDirector: typeof chooseDirectorBehavior;
  apply: typeof applyCommand;
  legal: typeof legalActions;
  parse: typeof parseLocalSimulation;
  advance: typeof advanceLocalSimulation;
}

function emptyObservation() {
  return {
    gc_samples: [] as GeneratedControllerSample[], gc_decisions: [] as GeneratedControllerDecision[],
    gc_checkpoint_parse_accepted: false, gc_checkpoint_steps: 0, gc_restored_steps: 0,
    gc_checkpoint_revision: 0, gc_checkpoint_populated_memories: 0,
    gc_checkpoint_world_digest: '', gc_restored_world_digest: '', gc_checkpoint_memory_digest: '', gc_restored_memory_digest: '',
    gc_checkpoint_envelope_digest: '', gc_restored_envelope_digest: '',
    gc_checkpoint_before_digest: '', gc_checkpoint_after_digest: '', gc_checkpoint_genesis: '',
    gc_continuation: [] as GeneratedControllerContinuation[],
  };
}

export class GeneratedControllerProbes {
  private observations = emptyObservation();
  private readonly dependencies: ProbeDependencies;

  constructor(dependencies: Partial<ProbeDependencies> = {}) {
    this.dependencies = { create: createLocalSimulation, chooseCivilization: chooseCivilizationBehavior, chooseDirector: chooseDirectorBehavior, apply: applyCommand, legal: legalActions, parse: parseLocalSimulation, advance: advanceLocalSimulation, ...dependencies };
  }

  reset(): void { this.observations = emptyObservation(); }

  observe() { return structuredClone(this.observations); }

  observeGeneratedWorld(): void {
    this.observations.gc_samples = [];
    for (const seed of [73, 1701, 90210]) this.observations.gc_samples.push(inspectGeneratedSample(seed, this.dependencies.create(seed), this.dependencies.create(seed)));
  }

  decide(): void {
    this.observations.gc_decisions = [];
    const run = this.dependencies.create(1701);
    const timestamp = new Date(Date.parse(run.state.clockEpoch!) + 10_000).toISOString();
    for (let seat = 0; seat <= 5; seat += 1) {
      const memory = run.memories[seat] ?? createBehaviorMemory(run.state, seat);
      const worlds = [structuredClone(run.state), structuredClone(run.state)] as const;
      const memories = [structuredClone(memory), structuredClone(memory)] as const;
      const worldBefore = digest(worlds);
      const memoryBefore = digest(memories);
      const choose = (index: 0 | 1) => seat === 5 ? this.dependencies.chooseDirector(worlds[index], memories[index], timestamp) : this.dependencies.chooseCivilization(worlds[index], seat, memories[index], timestamp);
      const first = choose(0);
      const repeated = choose(1);
      const revisionBefore = run.state.revision;
      const genesisBefore = json(run.state.origin);
      const legal = first.action !== null && this.dependencies.legal(run.state, seat, timestamp, first.action.type === 'event' ? first.action : undefined).some(option => sameAction(option.action, first.action));
      const result = first.action === null ? null : this.dependencies.apply(run.state, { seat, expectedRevision: run.state.revision, timestamp, action: first.action, ...(run.state.unlockedFeatures.includes('bounded-plans') ? { observedRevision: run.state.revision, plan: [{ action: first.action, reason: first.explanation.reason }] } : {}) });
      if (result?.ok) { run.state = result.state; run.memories[seat] = first.memory; }
      const retained = run.memories[seat] ?? memory;
      this.observations.gc_decisions.push({
        seat, action_digest: digest(first.action), repeated_action_digest: digest(repeated.action),
        decision_digest: digest(first), repeated_decision_digest: digest(repeated),
        input_world_before: worldBefore, input_world_after: digest(worlds), input_memory_before: memoryBefore, input_memory_after: digest(memories),
        policy_version: retained.policyVersion, profile_id: retained.profileId, explanation_profile_id: first.explanation.profileId, source: run.source,
        cursor_before: memory.decisionCount, cursor_after: retained.decisionCount,
        revision_before: revisionBefore, revision_after: run.state.revision, accepted: result?.ok ?? false,
        memory_valid: isBehaviorMemory(retained) && retained.policyVersion === POLICY && retained.policyVersion === ACTIVE_LOCAL_POLICY_VERSION && retained.seed === run.seed && retained.seat === seat,
        legal_member: legal, genesis_before: genesisBefore, genesis_after: json(run.state.origin),
      });
    }
  }

  restartController(): void {
    const empty = emptyObservation();
    this.observations = { ...empty, gc_samples: this.observations.gc_samples, gc_decisions: this.observations.gc_decisions };
    let checkpoint = this.dependencies.create(1701);
    checkpoint = this.dependencies.advance(checkpoint, 1);
    checkpoint = this.dependencies.advance(checkpoint, 1);
    const serialized = JSON.stringify(checkpoint);
    const parsedInput: unknown = JSON.parse(serialized);
    const checkpointBefore = digest(checkpoint);
    const parsedBefore = digest(parsedInput);
    const restored = this.dependencies.parse(parsedInput);
    Object.assign(this.observations, inspectControllerCheckpoint(checkpoint, restored));
    this.observations.gc_checkpoint_before_digest = digest({ checkpoint: checkpointBefore, parsed: parsedBefore, restored: digest(restored) });
    if (restored) {
      let left = checkpoint;
      let right = restored;
      for (let step = 3; step <= 4; step += 1) {
        left = this.dependencies.advance(left, 1);
        right = this.dependencies.advance(right, 1);
        this.observations.gc_continuation.push(inspectControllerContinuation(step, left, right));
      }
    }
    this.observations.gc_checkpoint_after_digest = digest({ checkpoint: digest(checkpoint), parsed: digest(parsedInput), restored: digest(restored) });
  }
}
