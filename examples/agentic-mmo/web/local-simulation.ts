import { applyCommand, applyRelease, catchUpClock, catchUpStrategy, createWorld } from '../core/engine.ts';
import { BEHAVIOR_POLICY_VERSION, chooseCivilizationBehavior, chooseDirectorBehavior, isBehaviorMemory, type BehaviorMemory } from '../core/behaviors.ts';
import { RELEASES } from '../core/release.ts';
import { DIRECTOR_SEAT, type GameAction, type WorldState } from '../core/types.ts';
import { isGameAction } from '../core/planning.ts';
import { isWorldState } from '../core/validation.ts';
import type { LiveSnapshot } from './live-world.ts';

export const LOCAL_SIMULATION_STORAGE_KEY = 'civitas:procedural-observatory:v1';
export const LOCAL_SIMULATION_STEP_MS = 10_000;
const EPOCH = '2000-01-01T00:00:00.000Z';
const MAXIMUM_STEPS = 60;

export interface LocalDecision { seat: number; action: GameAction; reason: string; profileId: string; phase: string; revision: number }
export interface LocalSimulation {
  version: 1;
  source: 'local-procedural';
  policyVersion: string;
  seed: number;
  timestamp: string;
  steps: number;
  state: WorldState;
  memories: Array<BehaviorMemory | null>;
  decisions: LocalDecision[];
}

export function createLocalSimulation(seed = 1701): LocalSimulation {
  let state = createWorld(seed, EPOCH);
  for (const release of RELEASES.slice(1)) {
    const result = applyRelease(state, { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: release.id, timestamp: EPOCH });
    if (!result.ok) throw new Error(`Local observatory release refused: ${result.error ?? release.id}`);
    state = result.state;
  }
  return { version: 1, source: 'local-procedural', policyVersion: BEHAVIOR_POLICY_VERSION, seed: state.seed, timestamp: EPOCH, steps: 0, state, memories: Array.from({ length: DIRECTOR_SEAT + 1 }, () => null), decisions: [] };
}

export function parseLocalSimulation(value: unknown): LocalSimulation | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const run = value as Record<string, unknown>;
  if (run.version !== 1 || run.source !== 'local-procedural' || run.policyVersion !== BEHAVIOR_POLICY_VERSION
    || !Number.isSafeInteger(run.seed) || Number(run.seed) < 0 || Number(run.seed) > 0xffffffff
    || !Number.isSafeInteger(run.steps) || Number(run.steps) < 0
    || typeof run.timestamp !== 'string' || Date.parse(run.timestamp) !== Date.parse(EPOCH) + Number(run.steps) * LOCAL_SIMULATION_STEP_MS
    || !isWorldState(run.state) || run.state.seed !== run.seed || run.state.clockEpoch !== EPOCH
    || !Array.isArray(run.memories) || run.memories.length !== DIRECTOR_SEAT + 1
    || !run.memories.every((memory, seat) => memory === null || isBehaviorMemory(memory) && memory.seat === seat && memory.seed === run.seed && memory.lastDecisionRound <= (run.state as WorldState).round && memory.decisionCount <= Number(run.steps))
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
  return structuredClone(run) as unknown as LocalSimulation;
}

export function advanceLocalSimulation(run: LocalSimulation, steps = 1): LocalSimulation {
  if (!Number.isSafeInteger(steps) || steps < 1 || steps > MAXIMUM_STEPS) throw new RangeError('Local advancement needs between one and sixty virtual steps');
  const checked = parseLocalSimulation(run);
  if (!checked) throw new Error('The saved local observatory is incompatible or corrupt; preserve it rather than reset silently');
  const next = checked;
  for (let index = 0; index < steps && !next.state.outcome; index += 1) {
    const timestamp = new Date(Date.parse(EPOCH) + (next.steps + 1) * LOCAL_SIMULATION_STEP_MS).toISOString();
    const strategic = catchUpStrategy(next.state, timestamp);
    if (!strategic.ok || strategic.remainingTicks > 0) throw new Error(`Local economy refused: ${strategic.error ?? 'bounded catchup exceeded'}`);
    const clock = catchUpClock(strategic.state, timestamp);
    if (!clock.ok || clock.remainingTicks > 0) throw new Error(`Local clock refused: ${clock.error ?? 'bounded catchup exceeded'}`);
    next.state = clock.state;
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

export function localSimulationSnapshot(run: LocalSimulation): LiveSnapshot {
  return { identity: `local:${run.version}:${run.policyVersion}:${run.seed}`, state: run.state };
}
