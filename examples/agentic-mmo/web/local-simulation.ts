import { applyCommand, applyHistoryAdvance, catchUpClock, catchUpStrategy } from '../core/engine.ts';
import { behaviorPolicyVersion, chooseCivilizationBehavior, chooseDirectorBehavior, isBehaviorMemory, isLegacyBehaviorMemory, type LegacyBehaviorMemory, type BehaviorMemory } from '../core/behaviors.ts';
import { LEGACY_BEHAVIOR_POLICY_VERSION } from '../core/behavior-profiles.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { RELEASES } from '../core/release.ts';
import { nextEarnedHistoryAdvance } from '../core/simulation/history.ts';
import { DIRECTOR_SEAT, type GameAction, type StrategicTemperamentVersion, type WorldState } from '../core/types.ts';
import { isGameAction } from '../core/planning.ts';
import { isWorldState } from '../core/validation.ts';
import type { LiveSnapshot } from './live-world.ts';

export const LOCAL_SIMULATION_STORAGE_KEY = 'civitas:procedural-observatory:knowledge-compacts-v1';
export const LIVING_SIMULATION_STORAGE_KEY = 'civitas:procedural-observatory:living-world-v1';
export const PARTNERSHIPS_SIMULATION_STORAGE_KEY = 'civitas:procedural-observatory:partnerships-v1';
export const ACTIVE_LOCAL_RELEASE_ID = 'settlement-knowledge-compacts-1';
export const PRIOR_GENERATED_SIMULATION_STORAGE_KEY = 'civitas:procedural-observatory:v2';
export const PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY = 'civitas:procedural-observatory:v1';
export const LOCAL_SIMULATION_STEP_MS = 10_000;
const EPOCH = '2000-01-01T00:00:00.000Z';
const MAXIMUM_STEPS = 60;

export interface LocalDecision { seat: number; action: GameAction; reason: string; profileId: string; phase: string; revision: number }
export interface LocalSimulation {
  version: 2;
  source: 'local-procedural';
  policyVersion: string;
  seed: number;
  timestamp: string;
  steps: number;
  state: WorldState;
  memories: Array<BehaviorMemory | null>;
  decisions: LocalDecision[];
}

export interface PreviousLocalSimulation extends Omit<LocalSimulation, 'version' | 'memories'> {
  readonly version: 1;
  readonly memories: ReadonlyArray<LegacyBehaviorMemory | null>;
}

export function createLocalSimulation(seed = 1701, initialReleaseId: 'settlement-interplanetary-1' | 'settlement-living-partnerships-1' | 'settlement-relief-charters-1' | 'settlement-regional-targets-1' | 'settlement-food-budget-1' | 'settlement-knowledge-compacts-1' = ACTIVE_LOCAL_RELEASE_ID, temperamentVersion?: StrategicTemperamentVersion): LocalSimulation {
  const state = createGeneratedWorld(seed, EPOCH, initialReleaseId, initialReleaseId === ACTIVE_LOCAL_RELEASE_ID ? 'cultural-toponyms-v1' : undefined, temperamentVersion);
  return { version: 2, source: 'local-procedural', policyVersion: behaviorPolicyVersion(state), seed: state.seed, timestamp: EPOCH, steps: 0, state, memories: Array.from({ length: DIRECTOR_SEAT + 1 }, () => null), decisions: [] };
}

export function createFreshLocalSimulation(seed = 1701): LocalSimulation {
  return createLocalSimulation(seed, ACTIVE_LOCAL_RELEASE_ID, 'strategic-temperaments-v1');
}

function parseRun(value: unknown, previous: boolean): LocalSimulation | PreviousLocalSimulation | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const run = value as Record<string, unknown>;
  if (run.version !== (previous ? 1 : 2) || run.source !== 'local-procedural'
    || !Number.isSafeInteger(run.seed) || Number(run.seed) < 0 || Number(run.seed) > 0xffffffff
    || !Number.isSafeInteger(run.steps) || Number(run.steps) < 0
    || typeof run.timestamp !== 'string' || Date.parse(run.timestamp) !== Date.parse(EPOCH) + Number(run.steps) * LOCAL_SIMULATION_STEP_MS
    || !isWorldState(run.state) || run.state.seed !== run.seed || run.state.clockEpoch !== EPOCH
    || run.policyVersion !== (previous ? LEGACY_BEHAVIOR_POLICY_VERSION : behaviorPolicyVersion(run.state))
    || (previous ? run.state.origin !== undefined || run.state.unlockedFeatures.includes('interplanetary-logistics') : run.state.origin?.generatorVersion !== 'coherent-geography-v1')
    || !Array.isArray(run.memories) || run.memories.length !== DIRECTOR_SEAT + 1
    || !run.memories.every((memory, seat) => memory === null || (previous ? isLegacyBehaviorMemory(memory) : isBehaviorMemory(memory)) && memory.policyVersion === run.policyVersion && memory.seat === seat && memory.seed === run.seed && memory.lastDecisionRound <= (run.state as WorldState).round && memory.decisionCount <= Number(run.steps))
    || !Array.isArray(run.decisions) || run.decisions.length > DIRECTOR_SEAT + 1) return null;
  const seats = new Set<number>();
  for (const value of run.decisions) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const decision = value as Record<string, unknown>;
    if (!Number.isSafeInteger(decision.seat) || Number(decision.seat) < 0 || Number(decision.seat) > DIRECTOR_SEAT || seats.has(Number(decision.seat))
      || !isGameAction(decision.action) || typeof decision.reason !== 'string' || decision.reason.length > 1000
      || typeof decision.profileId !== 'string' || typeof decision.phase !== 'string'
      || !Number.isSafeInteger(decision.revision) || Number(decision.revision) < 0 || Number(decision.revision) > run.state.revision) return null;
    seats.add(Number(decision.seat));
  }
  return structuredClone(run) as unknown as LocalSimulation | PreviousLocalSimulation;
}

export function parseLocalSimulation(value: unknown): LocalSimulation | null { return parseRun(value, false) as LocalSimulation | null; }
export function parseActiveLocalSimulation(value: unknown): LocalSimulation | null {
  const run = parseLocalSimulation(value);
  if (!run || run.state.origin?.initialReleaseId !== ACTIVE_LOCAL_RELEASE_ID
    || run.state.releaseId !== ACTIVE_LOCAL_RELEASE_ID) return null;
  const release = RELEASES.find(candidate => candidate.id === run.state.releaseId);
  return release && release.schemaVersion === run.state.schemaVersion && release.gameVersion === run.state.gameVersion
    && run.state.unlockedFeatures.length === release.featureIds.length
    && new Set(run.state.unlockedFeatures).size === run.state.unlockedFeatures.length
    && release.featureIds.every(feature => run.state.unlockedFeatures.includes(feature)) ? run : null;
}
export function parsePreviousLocalSimulation(value: unknown): PreviousLocalSimulation | null { return parseRun(value, true) as PreviousLocalSimulation | null; }

export function advanceLocalSimulation(run: LocalSimulation, steps = 1): LocalSimulation {
  if (!Number.isSafeInteger(steps) || steps < 1 || steps > MAXIMUM_STEPS) throw new RangeError('Local advancement needs between one and sixty virtual steps');
  const checked = parseLocalSimulation(run);
  if (!checked) throw new Error('The saved local observatory is incompatible or corrupt; preserve it rather than reset silently');
  const next = checked;
  for (let index = 0; index < steps && !next.state.outcome; index += 1) {
    const timestamp = new Date(Date.parse(EPOCH) + (next.steps + 1) * LOCAL_SIMULATION_STEP_MS).toISOString();
    const strategic = catchUpStrategy(next.state, timestamp);
    if (!strategic.ok || strategic.remainingTicks > 0 && !strategic.state.outcome) throw new Error(`Local economy refused: ${strategic.error ?? 'bounded catchup exceeded'}`);
    next.state = strategic.state;
    if (next.state.outcome) { next.steps += 1; next.timestamp = timestamp; break; }
    const clock = catchUpClock(strategic.state, timestamp);
    if (!clock.ok || clock.remainingTicks > 0) throw new Error(`Local clock refused: ${clock.error ?? 'bounded catchup exceeded'}`);
    next.state = clock.state;
    const historical = nextEarnedHistoryAdvance(next.state, timestamp);
    if (historical) {
      const result = applyHistoryAdvance(next.state, historical);
      if (!result.ok) throw new Error(`Earned history refused: ${result.error ?? 'unknown refusal'}`);
      next.state = result.state;
    }
    for (let seat = 0; seat <= DIRECTOR_SEAT && !next.state.outcome; seat += 1) {
      const memory = next.memories[seat] ?? undefined;
      const decision = seat === DIRECTOR_SEAT ? chooseDirectorBehavior(next.state, memory, timestamp) : chooseCivilizationBehavior(next.state, seat, memory, timestamp);
      if (decision.action === null) continue;
      const result = applyCommand(next.state, { seat, expectedRevision: next.state.revision, timestamp, action: decision.action, ...(next.state.unlockedFeatures.includes('bounded-plans') ? { observedRevision: next.state.revision, plan: [{ action: decision.action, reason: decision.explanation.reason }] } : {}) });
      if (!result.ok) throw new Error(`Procedural choice refused: ${result.error ?? 'unknown refusal'}`);
      next.state = result.state;
      next.memories[seat] = decision.memory;
      const latest = { seat, action: decision.action, reason: decision.explanation.reason, profileId: decision.explanation.profileId, phase: decision.explanation.phase, revision: result.state.revision };
      next.decisions = [...next.decisions.filter(previous => previous.seat !== seat), latest].sort((a, b) => a.seat - b.seat);
    }
    next.steps += 1;
    next.timestamp = timestamp;
  }
  return next;
}

export function localSimulationSnapshot(run: LocalSimulation | PreviousLocalSimulation): LiveSnapshot {
  const genesis = run.state.origin?.initialReleaseId;
  const naming = run.state.origin?.namingVersion;
  const temperament = run.state.origin?.temperamentVersion;
  return { identity: `local:${run.state.origin?.generatorVersion ?? 'legacy-foundation-v1'}:${run.seed}:${run.state.clockEpoch}${genesis ? `:${genesis}` : ''}${naming ? `:${naming}` : ''}${temperament ? `:${temperament}` : ''}`, state: run.state };
}
