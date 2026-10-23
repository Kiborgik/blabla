import { RELEASES } from '../core/release.ts';
import { BEHAVIOR_POLICY_VERSION, behaviorPolicyVersion } from '../core/behaviors.ts';
import { isHistoricalEventSelection } from '../core/historical-selection-validation.ts';
import { applyCommand, applyDirectorTick, applyHistoryAdvance, catchUpClock, catchUpStrategy, createWorld, legalActions, observe } from '../core/engine.ts';
import { type ActionOutcome, type Command, type DirectorTickCommand, type GameAction, type HistoryAdvanceCommand, type TransitionResult, type WorldState } from '../core/types.ts';
import { isGameAction, validateAttachedPlan } from '../core/planning.ts';
import { isDirectorEvent } from '../core/validation.ts';
import { decisionActionBlock } from '../core/simulation/decisions.ts';
import { readBoundedChronicle, readRecordedChoiceDetail } from './recorded-choices.ts';
import { decodeHistorySnapshot, HISTORY_SNAPSHOT_PREFIX } from './snapshot-codec.ts';
import { HistoryOutputBudget, selectHistoryRows } from './history-budget.ts';
import { type ActionReceiptRead, readActionReceipt } from './action-receipt.ts';
import { assertAutonomousState, createAutonomousState, planAutonomousWake, type AutonomousRecord } from './autonomous-runner.ts';
import { isPublicProvenance, type PublicChronicleEntry, type PublicPage, type PublicProvenance, type PublicTransition } from './public-protocol.ts';
import { assertWorld, boundedInteger, canonical, isRecord, parseJson, record, RequestFailure, text, utc } from './validation.ts';

export type SqlValue = string | number | null;
export interface D1Result { results: unknown[]; meta: { changes: number } }
export interface D1Statement { bind(...values: SqlValue[]): D1Statement; all(): Promise<D1Result>; run(): Promise<D1Result> }
export interface D1Database { prepare(sql: string): D1Statement; batch(statements: D1Statement[]): Promise<D1Result[]> }
export type HostedTransition = PublicTransition;
export interface HostedProvenance extends PublicProvenance { actorUserId: string }
export interface HostedChronicleEntry extends PublicChronicleEntry { provenance: HostedProvenance }
export interface HostedEntry extends HostedChronicleEntry { state: WorldState }
export interface HostedReply { ok: true; revision: number; acceptedRevision: number; duplicate?: boolean; remainingTicks?: number; actionOutcome?: ActionOutcome; operation?: 'strategy-action' | 'strategy-catchup'; strategyTicks?: number; strategyTimestamp?: string; strategyStartRevision?: number; strategyEndRevision?: number }
export interface HostedWorld { initial: WorldState; state: WorldState }
export interface SimulationStatus { configured: boolean; enabled: boolean; runtimeRevision: number; policyVersion: string | null; activatedAt: string | null; lastWakeAt: string | null; wakeCount: number; actors: Array<{ seat: number; profileId: string; phase: string; decisions: number }> }

function assertReply(value: unknown): asserts value is HostedReply {
  if (!isRecord(value) || value.ok !== true || typeof value.revision !== 'number' || typeof value.acceptedRevision !== 'number') throw new RequestFailure(503, 'corrupt_receipt');
}

function assertChronicleEntry(value: unknown): asserts value is HostedChronicleEntry {
  if (!isRecord(value) || !isRecord(value.transition) || !isPublicProvenance(value.provenance) || !Array.isArray(value.events)
    || value.transition.kind === 'action' && (!isRecord(value.transition.command) || !isGameAction(value.transition.command.action))
    || typeof value.startRevision !== 'number' || !Number.isSafeInteger(value.startRevision) || value.startRevision < 0
    || typeof value.endRevision !== 'number' || !Number.isSafeInteger(value.endRevision) || value.endRevision <= value.startRevision) throw new RequestFailure(503, 'corrupt_history');
}

function chronicleEntry(value: unknown): HostedChronicleEntry {
  const row = record(value);
  if (typeof row.transition_json !== 'string' || typeof row.provenance_json !== 'string' || typeof row.events_json !== 'string') throw new RequestFailure(503, 'corrupt_history');
  const entry: unknown = { startRevision: row.start_revision, endRevision: row.end_revision, transition: parseJson(row.transition_json), provenance: parseJson(row.provenance_json), events: parseJson(row.events_json) };
  assertChronicleEntry(entry);
  return entry;
}

type StrategyIntent = { kind: 'action'; action: GameAction } | { kind: 'upkeep'; timestamp: string };

function strategyIntent(input: Record<string, unknown>, timestamp: string): StrategyIntent | null {
  const action = input.action;
  if (!isRecord(action) || action.type !== 'strategy-action' && action.type !== 'strategy-catchup') return null;
  const combined = action.type === 'strategy-action';
  const fields = ['seat', 'expectedRevision', 'model', 'commandId', 'action', ...(combined ? ['plan'] : [])];
  if (Object.keys(input).some(key => !fields.includes(key)) || Object.keys(action).length !== 2) throw new RequestFailure(400, 'invalid_strategy_action');
  boundedInteger(input.seat, 0, 5, 'seat');
  boundedInteger(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'revision');
  text(input.model, 'model');
  text(input.commandId, 'command_id');
  if (combined) {
    if (!isGameAction(action.action)) throw new RequestFailure(400, 'invalid_strategy_action');
    return { kind: 'action', action: action.action };
  }
  const at = utc(action.timestamp);
  if (Date.parse(at) > Date.parse(timestamp)) throw new RequestFailure(400, 'future_timestamp');
  return { kind: 'upkeep', timestamp: at };
}

export class WorldRepository {
  private readonly database: D1Database;
  private readonly worldId: string;
  constructor(database: D1Database, worldId = 'main') { this.database = database; this.worldId = worldId; }

  worldEtag(revision: number): string { return `W/"world-v1-${encodeURIComponent(this.worldId)}-${revision}"`; }

  actionReceipt(input: Record<string, unknown>, actorUserId: string): Promise<ActionReceiptRead> {
    return readActionReceipt(this.database, this.worldId, input, actorUserId);
  }

  async revision(): Promise<number | null> {
    const result = await this.database.prepare('SELECT revision FROM world_state WHERE world_id = ?').bind(this.worldId).all();
    const row = result.results[0];
    if (row === undefined) return null;
    if (!isRecord(row) || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 0) throw new RequestFailure(503, 'corrupt_world_revision');
    return row.revision;
  }

  async read(): Promise<HostedWorld | null> {
    const result = await this.database.prepare('SELECT revision, initial_json, state_json FROM world_state WHERE world_id = ?').bind(this.worldId).all();
    const row = result.results[0];
    if (row === undefined) return null;
    if (!isRecord(row) || typeof row.initial_json !== 'string' || typeof row.state_json !== 'string') throw new RequestFailure(503, 'corrupt_world_row');
    const initial = parseJson(row.initial_json);
    const state = parseJson(row.state_json);
    assertWorld(initial);
    assertWorld(state);
    if (row.revision !== state.revision) throw new RequestFailure(503, 'corrupt_world_revision');
    return { initial, state };
  }

  private async readSimulation(): Promise<{ world: WorldState; runtime: AutonomousRecord | null } | null> {
    const result = await this.database.prepare('SELECT w.revision AS world_revision, w.initial_json AS initial_json, w.state_json AS world_json, a.revision AS runtime_revision, a.state_json AS runtime_json FROM world_state w LEFT JOIN world_autonomy a ON a.world_id = w.world_id WHERE w.world_id = ?').bind(this.worldId).all();
    const row = result.results[0];
    if (row === undefined) return null;
    if (!isRecord(row) || typeof row.initial_json !== 'string' || typeof row.world_json !== 'string') throw new RequestFailure(503, 'corrupt_world_row');
    assertWorld(parseJson(row.initial_json));
    const world = parseJson(row.world_json);
    assertWorld(world);
    if (row.world_revision !== world.revision) throw new RequestFailure(503, 'corrupt_world_revision');
    if (row.runtime_revision === null && row.runtime_json === null) return { world, runtime: null };
    if (typeof row.runtime_revision !== 'number' || !Number.isSafeInteger(row.runtime_revision) || row.runtime_revision < 1 || typeof row.runtime_json !== 'string') throw new RequestFailure(503, 'corrupt_or_incompatible_simulation');
    const state = parseJson(row.runtime_json);
    assertAutonomousState(state, world);
    return { world, runtime: { revision: row.runtime_revision, state } };
  }

  async simulation(): Promise<SimulationStatus> {
    const current = await this.readSimulation();
    if (!current) throw new RequestFailure(503, 'world_not_initialized');
    const { runtime } = current;
    return runtime === null ? { configured: false, enabled: false, runtimeRevision: 0, policyVersion: null, activatedAt: null, lastWakeAt: null, wakeCount: 0, actors: [] }
      : { configured: true, enabled: runtime.state.enabled, runtimeRevision: runtime.revision, policyVersion: runtime.state.policyVersion, activatedAt: runtime.state.activatedAt, lastWakeAt: runtime.state.lastWakeAt, wakeCount: runtime.state.wakeCount, actors: runtime.state.memories.map(memory => ({ seat: memory.seat, profileId: memory.profileId, phase: memory.phase, decisions: memory.decisionCount })) };
  }

  async configureSimulation(input: Record<string, unknown>, actorUserId: string, timestamp: string): Promise<HostedReply> {
    if (Object.keys(input).some(key => !['commandId', 'expectedRevision', 'enabled'].includes(key)) || typeof input.enabled !== 'boolean') throw new RequestFailure(400, 'invalid_simulation_activation');
    const expectedRevision = boundedInteger(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'revision');
    const key = `simulation-configure:${text(input.commandId, 'command_id')}`;
    utc(timestamp);
    const fingerprint = canonical({ operation: 'simulation-configure', input, actorUserId });
    const prior = await this.receipt(key, fingerprint);
    if (prior) return prior;
    try {
      const observed = await this.readSimulation();
      if (!observed) throw new RequestFailure(503, 'world_not_initialized');
      const { world, runtime: current } = observed;
      if (world.revision !== expectedRevision) throw new RequestFailure(409, 'stale_revision');
      if (world.outcome && input.enabled) throw new RequestFailure(409, 'world_finished');
      if (behaviorPolicyVersion(world) !== BEHAVIOR_POLICY_VERSION) throw new RequestFailure(409, 'unsupported_hosted_policy_version');
      const revision = (current?.revision ?? 0) + 1;
      if (!Number.isSafeInteger(revision)) throw new RequestFailure(503, 'simulation_counter_exhausted');
      const state = current ? { ...current.state, enabled: input.enabled, lastCommandKey: key } : createAutonomousState(world, timestamp, input.enabled, key);
      const serialized = JSON.stringify(state);
      const reply = { ok: true as const, revision: expectedRevision, acceptedRevision: expectedRevision, simulation: { enabled: state.enabled, runtimeRevision: revision, policyVersion: state.policyVersion } };
      const change = current === null
        ? this.database.prepare('INSERT INTO world_autonomy (world_id, revision, state_json, updated_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_state WHERE world_id = ? AND revision = ?)').bind(this.worldId, revision, serialized, timestamp, this.worldId, expectedRevision)
        : this.database.prepare('UPDATE world_autonomy SET revision = ?, state_json = ?, updated_at = ? WHERE world_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM world_state WHERE world_id = ? AND revision = ?)').bind(revision, serialized, timestamp, this.worldId, current.revision, this.worldId, expectedRevision);
      const committed = await this.database.batch([
        change,
        this.database.prepare('INSERT INTO world_receipts (world_id, receipt_key, request_json, response_json) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_autonomy WHERE world_id = ? AND revision = ? AND state_json = ?)').bind(this.worldId, key, fingerprint, JSON.stringify(reply), this.worldId, revision, serialized),
      ]);
      if (committed[0]?.meta.changes === 1) return reply;
      throw new RequestFailure(409, 'stale_simulation_revision');
    } catch (failure) {
      const retry = await this.receipt(key, fingerprint);
      if (retry) return retry;
      throw failure;
    }
  }

  async runSimulation(input: Record<string, unknown>, actorUserId: string, timestamp: string): Promise<HostedReply> {
    if (Object.keys(input).some(key => key !== 'commandId')) throw new RequestFailure(400, 'invalid_simulation_wake');
    const commandId = text(input.commandId, 'command_id');
    const key = `simulation-wake:${commandId}`;
    utc(timestamp);
    const fingerprint = canonical({ operation: 'simulation-wake', input, actorUserId });
    const prior = await this.receipt(key, fingerprint);
    if (prior) return prior;
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await this.readSimulation();
        if (!current) throw new RequestFailure(503, 'world_not_initialized');
        const { world, runtime } = current;
        if (!runtime) throw new RequestFailure(409, 'simulation_not_active');
        if (!Number.isSafeInteger(runtime.revision + 1)) throw new RequestFailure(503, 'simulation_counter_exhausted');
        const wake = planAutonomousWake(world, runtime.state, timestamp, commandId);
        const expectedRevision = world.revision;
        const runtimeRevision = runtime.revision + 1;
        const serialized = JSON.stringify(wake.runtime);
        const reply = { ok: true as const, revision: wake.state.revision, acceptedRevision: wake.state.revision, simulation: { runtimeRevision, policyVersion: wake.runtime.policyVersion, decisions: wake.decisions, strategyTicks: wake.strategyTicks, clockTicks: wake.clockTicks, remainingStrategyTicks: wake.remainingStrategyTicks, remainingClockTicks: wake.remainingClockTicks, commandIds: wake.steps.filter(step => step.transition.kind === 'action').map(step => step.provenance.commandId), lastWakeAt: timestamp } };
        const statements: D1Statement[] = [];
        for (const step of wake.steps) {
          const startRevision = step.transition.kind === 'action' ? step.transition.command.expectedRevision : 'expectedRevision' in step.transition ? step.transition.expectedRevision : step.transition.command.expectedRevision;
          statements.push(this.database.prepare('INSERT INTO world_transitions (world_id, start_revision, end_revision, receipt_key, transition_json, provenance_json, state_json, events_json) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_state WHERE world_id = ? AND revision = ?) AND EXISTS (SELECT 1 FROM world_autonomy WHERE world_id = ? AND revision = ?)').bind(this.worldId, startRevision, step.result.state.revision, step.receiptKey, JSON.stringify(step.transition), JSON.stringify({ ...step.provenance, actorUserId }), JSON.stringify(step.result.state), JSON.stringify(step.result.events), this.worldId, expectedRevision, this.worldId, runtime.revision));
          statements.push(this.database.prepare('INSERT INTO world_receipts (world_id, receipt_key, request_json, response_json) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_transitions WHERE world_id = ? AND receipt_key = ?) AND EXISTS (SELECT 1 FROM world_autonomy WHERE world_id = ? AND revision = ?)').bind(this.worldId, step.receiptKey, canonical({ operation: 'simulation-step', transition: step.transition, policy: step.provenance.policy ?? null, actorUserId }), JSON.stringify({ ok: true, revision: step.result.state.revision, acceptedRevision: step.result.state.revision, ...(step.result.actionOutcome ? { actionOutcome: step.result.actionOutcome } : {}) }), this.worldId, step.receiptKey, this.worldId, runtime.revision));
        }
        const last = wake.steps.at(-1);
        if (last) statements.push(this.database.prepare('UPDATE world_state SET revision = ?, state_json = ?, updated_at = ? WHERE world_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM world_transitions WHERE world_id = ? AND receipt_key = ?) AND EXISTS (SELECT 1 FROM world_autonomy WHERE world_id = ? AND revision = ?)').bind(wake.state.revision, JSON.stringify(wake.state), timestamp, this.worldId, expectedRevision, this.worldId, last.receiptKey, this.worldId, runtime.revision));
        const runtimeIndex = statements.length;
        statements.push(last
          ? this.database.prepare('UPDATE world_autonomy SET revision = ?, state_json = ?, updated_at = ? WHERE world_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM world_state WHERE world_id = ? AND revision = ?) AND EXISTS (SELECT 1 FROM world_transitions WHERE world_id = ? AND receipt_key = ?)').bind(runtimeRevision, serialized, timestamp, this.worldId, runtime.revision, this.worldId, wake.state.revision, this.worldId, last.receiptKey)
          : this.database.prepare('UPDATE world_autonomy SET revision = ?, state_json = ?, updated_at = ? WHERE world_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM world_state WHERE world_id = ? AND revision = ?)').bind(runtimeRevision, serialized, timestamp, this.worldId, runtime.revision, this.worldId, expectedRevision));
        statements.push(this.database.prepare('INSERT INTO world_receipts (world_id, receipt_key, request_json, response_json) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_autonomy WHERE world_id = ? AND revision = ? AND state_json = ?)').bind(this.worldId, key, fingerprint, JSON.stringify(reply), this.worldId, runtimeRevision, serialized));
        const committed = await this.database.batch(statements);
        if (committed[runtimeIndex]?.meta.changes === 1) return reply;
        const retry = await this.receipt(key, fingerprint);
        if (retry) return retry;
      }
      throw new RequestFailure(409, 'concurrent_retry_limit');
    } catch (failure) {
      const retry = await this.receipt(key, fingerprint);
      if (retry) return retry;
      throw failure;
    }
  }

  private async receipt(key: string, fingerprint: string): Promise<HostedReply | null> {
    const result = await this.database.prepare('SELECT request_json, response_json FROM world_receipts WHERE world_id = ? AND receipt_key = ?').bind(this.worldId, key).all();
    const row = result.results[0];
    if (row === undefined) return null;
    if (!isRecord(row) || row.request_json !== fingerprint) throw new RequestFailure(409, 'idempotency_key_reused');
    if (typeof row.response_json !== 'string') throw new RequestFailure(503, 'corrupt_receipt');
    const reply = parseJson(row.response_json);
    assertReply(reply);
    const current = await this.read();
    return { ...reply, revision: current?.state.revision ?? reply.revision, duplicate: true };
  }

  async initialize(input: Record<string, unknown>, actorUserId: string, timestamp: string): Promise<HostedReply> {
    const seed = boundedInteger(input.seed, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'seed');
    const clockEpoch = utc(input.clockEpoch);
    const registeredRulesId = input.registeredRulesId;
    if (registeredRulesId !== undefined && (typeof registeredRulesId !== 'string' || !RELEASES.some(rules => rules.id === registeredRulesId))) throw new RequestFailure(400, 'unknown_registered_rules');
    if (Date.parse(clockEpoch) > Date.parse(timestamp)) throw new RequestFailure(400, 'future_epoch');
    const key = `initialize:${text(input.commandId, 'command_id')}`;
    const fingerprint = canonical({ operation: 'initialize', input, actorUserId });
    const prior = await this.receipt(key, fingerprint);
    if (prior) return prior;
    const state = createWorld(seed, clockEpoch, registeredRulesId);
    const reply: HostedReply = { ok: true, revision: 0, acceptedRevision: 0 };
    try {
      await this.database.batch([
        this.database.prepare('INSERT INTO world_state (world_id, revision, initial_json, state_json, updated_at) VALUES (?, 0, ?, ?, ?)').bind(this.worldId, JSON.stringify(state), JSON.stringify(state), timestamp),
        this.database.prepare('INSERT INTO world_receipts (world_id, receipt_key, request_json, response_json) VALUES (?, ?, ?, ?)').bind(this.worldId, key, fingerprint, JSON.stringify(reply)),
      ]);
      return reply;
    } catch (failure) {
      const retry = await this.receipt(key, fingerprint);
      if (retry) return retry;
      if (await this.read()) throw new RequestFailure(409, 'world_already_initialized');
      throw failure;
    }
  }

  async mutate(operation: HostedTransition['kind'], input: Record<string, unknown>, actorUserId: string, timestamp: string): Promise<HostedReply> {
    if (operation === 'release-apply') throw new RequestFailure(409, 'pre_release_migration_disabled');
    const intent = operation === 'action' ? strategyIntent(input, timestamp) : null;
    if (intent?.kind === 'upkeep') {
      const reply = await this.mutate('strategy-catchup', { ...input, timestamp: intent.timestamp }, actorUserId, timestamp);
      return { ...reply, operation: 'strategy-catchup' };
    }
    const submittedRevision = boundedInteger(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'revision');
    const commandId = operation === 'director-tick' ? `${text(input.kind, 'tick_kind')}:${text(input.intervalId, 'interval_id')}` : text(input.commandId, 'command_id');
    const key = `${operation}:${commandId}`;
    const fingerprint = canonical({ operation, input, actorUserId });
    const prior = await this.receipt(key, fingerprint);
    if (prior) return prior;
    let actionLifecycle = operation === 'action' && input.plan !== undefined;
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await this.read();
        if (!current) throw new RequestFailure(503, 'world_not_initialized');
        actionLifecycle ||= operation === 'action' && current.state.unlockedFeatures.includes('bounded-plans');
        const canRebase = operation === 'action' && intent === null && current.state.independentTurns !== undefined && input.action !== undefined && input.choice === undefined;
        if (submittedRevision > current.state.revision || (current.state.revision !== submittedRevision && !canRebase)) throw new RequestFailure(409, 'stale_revision');
        const expectedRevision = current.state.revision;
        let transition: HostedTransition;
        let result: TransitionResult;
        let remainingTicks: number | undefined;
        let seat = 5;
        let model: string | null = null;
        let actionState = current.state;
        let upkeep: { transition: HostedTransition; result: TransitionResult } | null = null;
        if (intent?.kind === 'action') {
          const caught = catchUpStrategy(current.state, timestamp);
          if (!caught.ok) throw new RequestFailure(400, 'engine_refused_transition', { reason: caught.error ?? 'Strategic catchup refused' });
          if (caught.remainingTicks > 0) throw new RequestFailure(400, 'strategy_backlog_remaining', { remainingTicks: caught.state.revision - expectedRevision + caught.remainingTicks, processedTicks: 0, reason: 'Use explicit upkeep-only to drain the bounded backlog, then observe and choose again' });
          assertWorld(caught.state);
          actionState = caught.state;
          if (caught.state.revision !== expectedRevision) upkeep = { transition: { kind: 'strategy-catchup', expectedRevision, timestamp }, result: caught };
        }
        if (operation === 'action') {
          model = text(input.model, 'model');
          seat = boundedInteger(input.seat, 0, 5, 'seat');
          if (!actionState.independentTurns && seat !== actionState.phase) throw new RequestFailure(409, 'wrong_active_seat');
          const selector = intent?.kind === 'action' ? intent.action : input.action;
          const options = legalActions(actionState, seat, undefined, isGameAction(selector) && selector.type === 'event' ? selector : undefined);
          let action: GameAction | undefined;
          if (input.choice !== undefined && input.action !== undefined) throw new RequestFailure(400, 'one_action_selector_required');
          if (input.choice !== undefined) action = options[boundedInteger(input.choice, 0, options.length - 1, 'choice')]?.action;
          else {
            const exact = selector;
            action = options.find((option) => canonical(option.action) === canonical(exact))?.action;
            if (!action && isGameAction(exact) && decisionActionBlock(actionState, seat, exact)) action = exact;
          }
          if (!action) throw new RequestFailure(400, 'illegal_action');
          const command: Command = { seat, expectedRevision: actionState.revision, action, ...(actionState.independentTurns ? { timestamp } : {}) };
          if (input.plan !== undefined) {
            command.observedRevision = submittedRevision;
            const checked = validateAttachedPlan(actionState, command, input.plan);
            if (!checked.ok) throw new RequestFailure(400, checked.code, { actionOutcome: { status: 'failed', code: checked.code, reason: checked.error } });
            command.plan = checked.plan;
          }
          transition = { kind: 'action', command };
          result = applyCommand(actionState, command);
        } else {
          const at = utc(input.timestamp);
          if (Date.parse(at) > Date.parse(timestamp)) throw new RequestFailure(400, 'future_timestamp');
          if (operation === 'history-advance') {
            model = text(input.model, 'model');
            const cause = record(input.cause);
            if (cause.kind !== 'feature' && cause.kind !== 'event') throw new RequestFailure(400, 'invalid_history_cause');
            const command: HistoryAdvanceCommand = { expectedRevision, cause: { kind: cause.kind, id: text(cause.id, 'cause_id', 128) }, reason: text(input.reason, 'reason', 1000), deltaYears: boundedInteger(input.deltaYears, 0, Number.MAX_SAFE_INTEGER, 'delta_years'), timestamp: at };
            transition = { kind: 'history-advance', command };
            result = applyHistoryAdvance(current.state, command);
          } else if (operation === 'clock-catchup' || operation === 'strategy-catchup') {
            if (input.model !== undefined) model = text(input.model, 'model');
            transition = { kind: operation, expectedRevision, timestamp: at };
            const caught = operation === 'strategy-catchup' ? catchUpStrategy(current.state, at) : catchUpClock(current.state, at);
            result = caught;
            remainingTicks = caught.remainingTicks;
          } else {
            const kind = input.kind;
            if (kind !== 'clock' && kind !== 'event' && kind !== 'review') throw new RequestFailure(400, 'invalid_tick_kind');
            if (kind !== 'clock' || input.model !== undefined) model = text(input.model, 'model');
            const event = input.event ?? 'calm';
            if (!isDirectorEvent(event)) throw new RequestFailure(400, 'invalid_event');
            const target = boundedInteger(input.target ?? 0, 0, 4, 'target');
            if (Object.hasOwn(input, 'regional') && !isHistoricalEventSelection(input.regional)) throw new RequestFailure(400, 'invalid_regional_selection');
            const command: DirectorTickCommand = { ...(isHistoricalEventSelection(input.regional) ? { regional: structuredClone(input.regional) } : {}), expectedRevision, kind, intervalId: text(input.intervalId, 'interval_id'), timestamp: at, event, target };
            transition = { kind: 'director-tick', command };
            result = applyDirectorTick(current.state, command);
          }
        }
        if (!result.ok) throw new RequestFailure(400, result.actionOutcome?.code ?? (result.error?.startsWith('strategy_catchup_required:') ? 'strategy_catchup_required' : 'engine_refused_transition'), { reason: result.error ?? 'Transition refused', ...(result.actionOutcome ? { actionOutcome: result.actionOutcome } : {}), ...(operation === 'action' ? { admission: observe(current.state, seat).admission } : {}) });
        assertWorld(result.state);
        const reply: HostedReply = { ok: true, revision: result.state.revision, acceptedRevision: result.state.revision, ...(remainingTicks === undefined ? {} : { remainingTicks }), ...(result.actionOutcome ? { actionOutcome: result.actionOutcome } : {}), ...(intent?.kind === 'action' ? { operation: 'strategy-action' as const, strategyTicks: actionState.revision - expectedRevision, strategyTimestamp: timestamp, strategyStartRevision: expectedRevision, strategyEndRevision: actionState.revision, remainingTicks: 0 } : {}) };
        const provenance: HostedProvenance = { actorUserId, kind: model === null ? 'clock-service' : 'development-agent', model, seat, commandId, recordedAt: timestamp };
        const unchanged = result.state.revision === expectedRevision;
        const preflightKey = `strategy-before-action:${commandId}`;
        const preflightStatements = upkeep === null ? [] : [
          this.database.prepare('INSERT INTO world_transitions (world_id, start_revision, end_revision, receipt_key, transition_json, provenance_json, state_json, events_json) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_state WHERE world_id = ? AND revision = ?)').bind(this.worldId, expectedRevision, upkeep.result.state.revision, preflightKey, JSON.stringify(upkeep.transition), JSON.stringify({ ...provenance, kind: 'clock-service', model: null, seat: 5, commandId: preflightKey }), JSON.stringify(upkeep.result.state), JSON.stringify(upkeep.result.events), this.worldId, expectedRevision),
        ];
        const statements = unchanged ? [
          this.database.prepare('INSERT OR IGNORE INTO world_receipts (world_id, receipt_key, request_json, response_json) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_state WHERE world_id = ? AND revision = ?)').bind(this.worldId, key, fingerprint, JSON.stringify(reply), this.worldId, expectedRevision),
        ] : [
          ...preflightStatements,
          this.database.prepare('INSERT INTO world_transitions (world_id, start_revision, end_revision, receipt_key, transition_json, provenance_json, state_json, events_json) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_state WHERE world_id = ? AND revision = ?)').bind(this.worldId, actionState.revision, result.state.revision, key, JSON.stringify(transition), JSON.stringify(provenance), JSON.stringify(result.state), JSON.stringify(result.events), this.worldId, expectedRevision),
          this.database.prepare('UPDATE world_state SET revision = ?, state_json = ?, updated_at = ? WHERE world_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM world_transitions WHERE world_id = ? AND receipt_key = ? AND start_revision = ?)').bind(result.state.revision, JSON.stringify(result.state), timestamp, this.worldId, expectedRevision, this.worldId, key, actionState.revision),
          this.database.prepare('INSERT OR IGNORE INTO world_receipts (world_id, receipt_key, request_json, response_json) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_transitions WHERE world_id = ? AND receipt_key = ?)').bind(this.worldId, key, fingerprint, JSON.stringify(reply), this.worldId, key),
        ];
        const committed = await this.database.batch(statements);
        if (committed[0]?.meta.changes === 1) return reply;
        const retry = await this.receipt(key, fingerprint);
        if (retry) return retry;
        if (!canRebase) throw new RequestFailure(409, 'stale_revision');
      }
      throw new RequestFailure(409, 'concurrent_retry_limit');
    } catch (failure) {
      const retry = await this.receipt(key, fingerprint);
      if (retry) return retry;
      if (actionLifecycle && failure instanceof RequestFailure && failure.details.actionOutcome === undefined)
        throw new RequestFailure(failure.status, failure.code, { ...failure.details, actionOutcome: { status: 'failed', code: failure.code, reason: failure.code.replaceAll('_', ' ') } });
      throw failure;
    }
  }

  boundedChronicle(input: Record<string, unknown>) { return readBoundedChronicle(this.database, this.worldId, input); }

  recordedChoiceDetail(input: Record<string, unknown>) { return readRecordedChoiceDetail(this.database, this.worldId, input); }

  private async chroniclePage(after: number, limit: number): Promise<{ rows: unknown[]; hasMore: boolean }> {
    boundedInteger(after, 0, Number.MAX_SAFE_INTEGER, 'after');
    boundedInteger(limit, 1, 200, 'limit');
    const result = await this.database.prepare('SELECT start_revision, end_revision, transition_json, provenance_json, events_json FROM world_transitions WHERE world_id = ? AND end_revision > ? ORDER BY end_revision ASC LIMIT ?').bind(this.worldId, after, limit + 1).all();
    return { rows: result.results.slice(0, limit), hasMore: result.results.length > limit };
  }

  async chronicle(after = 0, limit = 50): Promise<PublicPage<HostedChronicleEntry>> {
    const page = await this.chroniclePage(after, limit);
    const entries = page.rows.map(chronicleEntry);
    return { entries, hasMore: page.hasMore, nextRevision: page.hasMore ? entries.at(-1)?.endRevision ?? null : null };
  }

  async history(after = 0, limit = 50): Promise<PublicPage<HostedEntry>> {
    boundedInteger(after, 0, Number.MAX_SAFE_INTEGER, 'after');
    boundedInteger(limit, 1, 200, 'limit');
    const metadata = await this.database.prepare('SELECT end_revision, length(CAST(state_json AS BLOB)) AS snapshot_bytes, length(CAST(transition_json AS BLOB)) + length(CAST(provenance_json AS BLOB)) + length(CAST(events_json AS BLOB)) AS detail_bytes, substr(state_json, 1, ?) = ? AS encoded FROM world_transitions WHERE world_id = ? AND end_revision > ? ORDER BY end_revision ASC LIMIT ?').bind(HISTORY_SNAPSHOT_PREFIX.length, HISTORY_SNAPSHOT_PREFIX, this.worldId, after, limit + 1).all();
    const selected = selectHistoryRows(metadata.results, after, limit);
    const last = selected.revisions.at(-1);
    if (last === undefined) return { entries: [], hasMore: false, nextRevision: null };
    const page = await this.database.prepare('SELECT start_revision, end_revision, transition_json, provenance_json, state_json, events_json FROM world_transitions WHERE world_id = ? AND end_revision > ? AND end_revision <= ? ORDER BY end_revision ASC LIMIT ?').bind(this.worldId, after, last, selected.revisions.length).all();
    if (page.results.length !== selected.revisions.length || page.results.some((row, index) => !isRecord(row) || row.end_revision !== selected.revisions[index])) throw new RequestFailure(503, 'corrupt_history');
    const budget = new HistoryOutputBudget();
    const entries: HostedEntry[] = [];
    for (const value of page.results) {
      if (budget.full) break;
      const row = record(value);
      if (typeof row.state_json !== 'string') throw new RequestFailure(503, 'corrupt_history');
      const state = await decodeHistorySnapshot(row.state_json);
      if (state.revision !== row.end_revision) throw new RequestFailure(503, 'corrupt_history');
      const entry = { ...chronicleEntry(row), state };
      if (!budget.accept(entry)) break;
      entries.push(entry);
    }
    const hasMore = selected.hasMore || entries.length < page.results.length;
    return { entries, hasMore, nextRevision: hasMore ? entries.at(-1)?.endRevision ?? null : null };
  }
}
