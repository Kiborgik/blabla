import { applyCommand, applyHistoryAdvance, catchUpClock, catchUpStrategy } from '../../core/engine.ts';
import { behaviorPolicyVersion, chooseCivilizationBehavior, chooseDirectorBehavior, isBehaviorMemory } from '../../core/behaviors.ts';
import { createGeneratedWorld } from '../../core/generated-world.ts';
import { isGameAction } from '../../core/planning.ts';
import { nextEarnedHistoryAdvance } from '../../core/simulation/history.ts';
import { DIRECTOR_SEAT } from '../../core/types.ts';
import { isWorldState } from '../../core/validation.ts';
import type { LocalSimulation } from '../../web/local-simulation.ts';

const EPOCH = '2000-01-01T00:00:00.000Z';
const LOCAL_SIMULATION_STEP_MS = 10_000;
const MAXIMUM_STEPS = 60;
type Rules = NonNullable<Parameters<typeof createGeneratedWorld>[2]>;

export function createRegisteredSimulation(seed: number, rules: Rules): LocalSimulation {
  const state = createGeneratedWorld(seed, EPOCH, rules);
  return { version: 2, source: 'local-procedural', policyVersion: behaviorPolicyVersion(state), seed: state.seed, timestamp: EPOCH, steps: 0, state, memories: Array.from({ length: DIRECTOR_SEAT + 1 }, () => null), decisions: [] };
}

export function parseRegisteredSimulation(value: unknown): LocalSimulation | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const run = value as Record<string, unknown>;
  if (run.version !== 2 || run.source !== 'local-procedural' || !Number.isSafeInteger(run.seed) || !Number.isSafeInteger(run.steps) || Number(run.steps) < 0
    || typeof run.timestamp !== 'string' || Date.parse(run.timestamp) !== Date.parse(EPOCH) + Number(run.steps) * LOCAL_SIMULATION_STEP_MS
    || !isWorldState(run.state) || run.state.seed !== run.seed || run.state.clockEpoch !== EPOCH || behaviorPolicyVersion(run.state) !== run.policyVersion
    || !Array.isArray(run.memories) || run.memories.length !== DIRECTOR_SEAT + 1
    || !run.memories.every((memory, seat) => memory === null || isBehaviorMemory(memory) && memory.policyVersion === run.policyVersion && memory.seat === seat && memory.seed === run.seed && memory.lastDecisionRound <= (run.state as LocalSimulation['state']).round && memory.decisionCount <= Number(run.steps))
    || !Array.isArray(run.decisions) || run.decisions.length > DIRECTOR_SEAT + 1) return null;
  const seats = new Set<number>();
  for (const item of run.decisions) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const decision = item as Record<string, unknown>;
    if (!Number.isSafeInteger(decision.seat) || Number(decision.seat) < 0 || Number(decision.seat) > DIRECTOR_SEAT || seats.has(Number(decision.seat))
      || !isGameAction(decision.action) || typeof decision.reason !== 'string' || typeof decision.profileId !== 'string' || typeof decision.phase !== 'string'
      || !Number.isSafeInteger(decision.revision) || Number(decision.revision) < 0 || Number(decision.revision) > run.state.revision) return null;
    seats.add(Number(decision.seat));
  }
  return structuredClone(run) as unknown as LocalSimulation;
}

export function advanceRegisteredSimulation(run: LocalSimulation, steps = 1): LocalSimulation {
  if (!Number.isSafeInteger(steps) || steps < 1 || steps > MAXIMUM_STEPS) throw new RangeError('Local advancement needs between one and sixty virtual steps');
  const checked = parseRegisteredSimulation(run);
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
