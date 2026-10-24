import { nextEarnedHistoryAdvance } from '../core/simulation/history.ts';
import { BEHAVIOR_POLICY_VERSION, behaviorPolicyVersion, chooseCivilizationBehavior, chooseDirectorBehavior, createBehaviorMemory, isBehaviorMemory, type BehaviorMemory } from '../core/behaviors.ts';
import { TURN_RULES } from '../core/content.ts';
import { applyCommand, applyHistoryAdvance, catchUpClock, catchUpStrategy } from '../core/engine.ts';
import { DIRECTOR_SEAT, type Command, type TransitionResult, type WorldState } from '../core/types.ts';
import type { PublicProvenance, PublicTransition } from './public-protocol.ts';
import { assertWorld, isRecord, RequestFailure, safeInteger, utc } from './validation.ts';

export interface AutonomousState {
  version: 1;
  policyVersion: string;
  enabled: boolean;
  activatedAt: string;
  lastWakeAt: string | null;
  lastDecisionWindow: number;
  wakeCount: number;
  lastCommandKey: string;
  memories: BehaviorMemory[];
}

export interface AutonomousRecord { revision: number; state: AutonomousState }
export interface AutonomousStep { transition: PublicTransition; provenance: PublicProvenance; result: TransitionResult; receiptKey: string }
export interface AutonomousWake {
  state: WorldState;
  runtime: AutonomousState;
  steps: AutonomousStep[];
  decisions: number;
  strategyTicks: number;
  clockTicks: number;
  remainingStrategyTicks: number;
  remainingClockTicks: number;
}

export function createAutonomousState(world: WorldState, timestamp: string, enabled: boolean, key: string): AutonomousState {
  utc(timestamp);
  if (behaviorPolicyVersion(world) !== BEHAVIOR_POLICY_VERSION) throw new RequestFailure(409, 'unsupported_hosted_policy_version');
  return { version: 1, policyVersion: BEHAVIOR_POLICY_VERSION, enabled, activatedAt: timestamp, lastWakeAt: null, lastDecisionWindow: -1, wakeCount: 0, lastCommandKey: key, memories: Array.from({ length: DIRECTOR_SEAT + 1 }, (_, seat) => createBehaviorMemory(world, seat)) };
}

export function assertAutonomousState(value: unknown, world: WorldState): asserts value is AutonomousState {
  if (!isRecord(value) || Object.keys(value).length !== 9 || value.version !== 1 || value.policyVersion !== BEHAVIOR_POLICY_VERSION || value.policyVersion !== behaviorPolicyVersion(world) || typeof value.enabled !== 'boolean'
    || typeof value.activatedAt !== 'string' || !Number.isFinite(Date.parse(value.activatedAt))
    || value.lastWakeAt !== null && (typeof value.lastWakeAt !== 'string' || !Number.isFinite(Date.parse(value.lastWakeAt)) || Date.parse(value.lastWakeAt) < Date.parse(value.activatedAt))
    || !safeInteger(value.lastDecisionWindow) || value.lastDecisionWindow < -1 || !safeInteger(value.wakeCount) || value.wakeCount < 0
    || (value.lastWakeAt === null) !== (value.wakeCount === 0)
    || value.lastDecisionWindow > Math.floor((Date.parse(value.lastWakeAt === null ? value.activatedAt : String(value.lastWakeAt)) - Date.parse(value.activatedAt)) / TURN_RULES.tacticalWindowMs)
    || typeof value.lastCommandKey !== 'string' || value.lastCommandKey.length === 0 || value.lastCommandKey.length > 240
    || !Array.isArray(value.memories) || value.memories.length !== DIRECTOR_SEAT + 1
    || !value.memories.every((memory: unknown, seat: number) => isBehaviorMemory(memory) && memory.policyVersion === value.policyVersion && memory.seed === world.seed && memory.seat === seat && memory.lastDecisionRound <= world.round && memory.decisionCount <= Number(value.wakeCount))
    || (value.lastDecisionWindow === -1) !== value.memories.every((memory: BehaviorMemory) => memory.decisionCount === 0)) throw new RequestFailure(503, 'corrupt_or_incompatible_simulation');
  try { utc(value.activatedAt); if (value.lastWakeAt !== null) utc(value.lastWakeAt); } catch { throw new RequestFailure(503, 'corrupt_or_incompatible_simulation'); }
}

export function planAutonomousWake(world: WorldState, previous: AutonomousState, timestamp: string, commandId: string): AutonomousWake {
  utc(timestamp);
  assertAutonomousState(previous, world);
  if (!previous.enabled) throw new RequestFailure(409, 'simulation_not_active');
  if (Date.parse(timestamp) < Date.parse(previous.lastWakeAt ?? previous.activatedAt)) throw new RequestFailure(409, 'stale_simulation_timestamp');
  if (!Number.isSafeInteger(previous.wakeCount + 1)) throw new RequestFailure(503, 'simulation_counter_exhausted');
  const runtime = structuredClone(previous);
  runtime.lastWakeAt = timestamp;
  runtime.wakeCount += 1;
  runtime.lastCommandKey = `simulation-wake:${commandId}`;
  const wake: AutonomousWake = { state: world, runtime, steps: [], decisions: 0, strategyTicks: 0, clockTicks: 0, remainingStrategyTicks: 0, remainingClockTicks: 0 };
  if (world.outcome) return wake;
  const append = (transition: PublicTransition, result: TransitionResult, suffix: string, provenance?: PublicProvenance) => {
    if (!result.ok) throw new RequestFailure(503, 'simulation_transition_refused', { reason: result.error ?? 'Unknown engine refusal' });
    assertWorld(result.state);
    const receiptKey = `simulation-step:${commandId}:${suffix}`;
    if (result.state.revision !== wake.state.revision) wake.steps.push({ transition, result, receiptKey, provenance: provenance ?? { kind: 'clock-service', model: null, seat: DIRECTOR_SEAT, commandId: receiptKey, recordedAt: timestamp } });
    wake.state = result.state;
  };
  if (wake.state.independentTurns) {
    const caught = catchUpStrategy(wake.state, timestamp);
    wake.strategyTicks = caught.state.revision - wake.state.revision;
    wake.remainingStrategyTicks = caught.remainingTicks;
    append({ kind: 'strategy-catchup', expectedRevision: wake.state.revision, timestamp }, caught, 'strategy');
  }
  if (wake.state.clockEpoch !== null && !wake.state.outcome) {
    const caught = catchUpClock(wake.state, timestamp);
    wake.clockTicks = caught.state.revision - wake.state.revision;
    wake.remainingClockTicks = caught.remainingTicks;
    append({ kind: 'clock-catchup', expectedRevision: wake.state.revision, timestamp }, caught, 'clock');
  }
  const window = Math.floor((Date.parse(timestamp) - Date.parse(runtime.activatedAt)) / TURN_RULES.tacticalWindowMs);
  if (wake.remainingStrategyTicks > 0 || wake.remainingClockTicks > 0 || window <= runtime.lastDecisionWindow) return wake;
  const historical = nextEarnedHistoryAdvance(wake.state, timestamp);
  if (historical) {
    const receiptKey = `simulation-step:${commandId}:history`;
    append({ kind: 'history-advance', command: historical }, applyHistoryAdvance(wake.state, historical), 'history', { kind: 'procedural-policy', model: null, seat: DIRECTOR_SEAT, commandId: receiptKey, recordedAt: timestamp, policy: { version: BEHAVIOR_POLICY_VERSION, profileId: 'earned-history', phase: 'historical-continuity', reason: historical.reason, decision: runtime.wakeCount, seed: wake.state.seed } });
  }
  for (let index = 0; index <= DIRECTOR_SEAT && !wake.state.outcome; index += 1) {
    const seat = wake.state.independentTurns ? index : wake.state.phase;
    const memory = runtime.memories[seat];
    if (!memory) throw new RequestFailure(503, 'corrupt_or_incompatible_simulation');
    const decision = seat === DIRECTOR_SEAT ? chooseDirectorBehavior(wake.state, memory, timestamp) : chooseCivilizationBehavior(wake.state, seat, memory, timestamp);
    if (decision.action === null) {
      if (!wake.state.independentTurns) break;
      continue;
    }
    const command: Command = { seat, expectedRevision: wake.state.revision, action: decision.action, ...(wake.state.independentTurns ? { timestamp } : {}), ...(wake.state.unlockedFeatures.includes('bounded-plans') ? { observedRevision: wake.state.revision, plan: [{ action: decision.action, reason: decision.explanation.reason }] } : {}) };
    const result = applyCommand(wake.state, command);
    const commandKey = `simulation-step:${commandId}:seat-${seat}`;
    append({ kind: 'action', command }, result, `seat-${seat}`, { kind: 'procedural-policy', model: null, seat, commandId: commandKey, recordedAt: timestamp, policy: { version: BEHAVIOR_POLICY_VERSION, profileId: decision.explanation.profileId, phase: decision.explanation.phase, reason: decision.explanation.reason, decision: decision.memory.decisionCount, seed: decision.memory.seed } });
    runtime.memories[seat] = decision.memory;
    wake.decisions += 1;
  }
  if (wake.decisions > 0) runtime.lastDecisionWindow = window;
  assertAutonomousState(runtime, wake.state);
  return wake;
}
