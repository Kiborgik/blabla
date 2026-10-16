import { applyCommand, applyDirectorTick, applyHistoryAdvance, applyRelease, catchUpClock, catchUpStrategy, createWorld, legalActions, observe } from '../core/engine.ts';
import { type ActionOutcome, type Command, type DirectorTickCommand, type GameAction, type HistoryAdvanceCommand, type ReleaseApplyCommand, type TransitionResult, type WorldState } from '../core/types.ts';
import { isGameAction, validateAttachedPlan } from '../core/planning.ts';
import { isDirectorEvent } from '../core/validation.ts';
import { decodeHistorySnapshot, HISTORY_SNAPSHOT_PREFIX } from './snapshot-codec.ts';
import { HistoryOutputBudget, selectHistoryRows } from './history-budget.ts';
import { type ActionReceiptRead, readActionReceipt } from './action-receipt.ts';
import type { PublicChronicleEntry, PublicPage, PublicProvenance, PublicTransition } from './public-protocol.ts';
import { assertWorld, boundedInteger, canonical, isRecord, parseJson, record, RequestFailure, text, utc } from './validation.ts';

export type SqlValue = string | number | null;
export interface D1Result { results: unknown[]; meta: { changes: number } }
export interface D1Statement { bind(...values: SqlValue[]): D1Statement; all(): Promise<D1Result>; run(): Promise<D1Result> }
export interface D1Database { prepare(sql: string): D1Statement; batch(statements: D1Statement[]): Promise<D1Result[]> }
export type HostedTransition = PublicTransition;
export interface HostedProvenance extends PublicProvenance { actorUserId: string }
export interface HostedChronicleEntry extends PublicChronicleEntry { provenance: HostedProvenance }
export interface HostedEntry extends HostedChronicleEntry { state: WorldState }
export interface HostedReply { ok: true; revision: number; acceptedRevision: number; duplicate?: boolean; remainingTicks?: number; actionOutcome?: ActionOutcome }
export interface HostedWorld { initial: WorldState; state: WorldState }

function assertReply(value: unknown): asserts value is HostedReply {
  if (!isRecord(value) || value.ok !== true || typeof value.revision !== 'number' || typeof value.acceptedRevision !== 'number') throw new RequestFailure(503, 'corrupt_receipt');
}

function assertChronicleEntry(value: unknown): asserts value is HostedChronicleEntry {
  if (!isRecord(value) || !isRecord(value.transition) || !isRecord(value.provenance) || !Array.isArray(value.events)
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
    if (Date.parse(clockEpoch) > Date.parse(timestamp)) throw new RequestFailure(400, 'future_epoch');
    const key = `initialize:${text(input.commandId, 'command_id')}`;
    const fingerprint = canonical({ operation: 'initialize', input, actorUserId });
    const prior = await this.receipt(key, fingerprint);
    if (prior) return prior;
    const state = createWorld(seed, clockEpoch);
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
        const canRebase = operation === 'action' && current.state.independentTurns !== undefined && input.action !== undefined && input.choice === undefined;
        if (submittedRevision > current.state.revision || (current.state.revision !== submittedRevision && !canRebase)) throw new RequestFailure(409, 'stale_revision');
        const expectedRevision = current.state.revision;
        let transition: HostedTransition;
        let result: TransitionResult;
        let remainingTicks: number | undefined;
        let seat = 5;
        let model: string | null = null;
        if (operation === 'action') {
          model = text(input.model, 'model');
          seat = boundedInteger(input.seat, 0, 5, 'seat');
          if (!current.state.independentTurns && seat !== current.state.phase) throw new RequestFailure(409, 'wrong_active_seat');
          const options = legalActions(current.state, seat);
          let action: GameAction | undefined;
          if (input.choice !== undefined && input.action !== undefined) throw new RequestFailure(400, 'one_action_selector_required');
          if (input.choice !== undefined) action = options[boundedInteger(input.choice, 0, options.length - 1, 'choice')]?.action;
          else action = options.find((option) => canonical(option.action) === canonical(input.action))?.action;
          if (!action) throw new RequestFailure(400, 'illegal_action');
          const command: Command = { seat, expectedRevision, action, ...(current.state.independentTurns ? { timestamp } : {}) };
          if (input.plan !== undefined) {
            command.observedRevision = submittedRevision;
            const checked = validateAttachedPlan(current.state, command, input.plan);
            if (!checked.ok) throw new RequestFailure(400, checked.code, { actionOutcome: { status: 'failed', code: checked.code, reason: checked.error } });
            command.plan = checked.plan;
          }
          transition = { kind: 'action', command };
          result = applyCommand(current.state, command);
        } else if (operation === 'release-apply') {
          model = text(input.model, 'model');
          const command: ReleaseApplyCommand = { expectedRevision, expectedFromReleaseId: text(input.expectedFromReleaseId, 'source_release'), targetReleaseId: text(input.targetReleaseId, 'target_release'), timestamp };
          transition = { kind: 'release-apply', command };
          result = applyRelease(current.state, command);
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
            const command: DirectorTickCommand = { expectedRevision, kind, intervalId: text(input.intervalId, 'interval_id'), timestamp: at, event, target };
            transition = { kind: 'director-tick', command };
            result = applyDirectorTick(current.state, command);
          }
        }
        if (!result.ok) throw new RequestFailure(400, result.actionOutcome?.code ?? (result.error?.startsWith('strategy_catchup_required:') ? 'strategy_catchup_required' : 'engine_refused_transition'), { reason: result.error ?? 'Transition refused', ...(result.actionOutcome ? { actionOutcome: result.actionOutcome } : {}), ...(operation === 'action' ? { admission: observe(current.state, seat).admission } : {}) });
        assertWorld(result.state);
        const reply: HostedReply = { ok: true, revision: result.state.revision, acceptedRevision: result.state.revision, ...(remainingTicks === undefined ? {} : { remainingTicks }), ...(result.actionOutcome ? { actionOutcome: result.actionOutcome } : {}) };
        const provenance: HostedProvenance = { actorUserId, kind: model === null ? 'clock-service' : 'development-agent', model, seat, commandId, recordedAt: timestamp };
        const unchanged = result.state.revision === expectedRevision;
        const statements = unchanged ? [
          this.database.prepare('INSERT OR IGNORE INTO world_receipts (world_id, receipt_key, request_json, response_json) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_state WHERE world_id = ? AND revision = ?)').bind(this.worldId, key, fingerprint, JSON.stringify(reply), this.worldId, expectedRevision),
        ] : [
          this.database.prepare('INSERT INTO world_transitions (world_id, start_revision, end_revision, receipt_key, transition_json, provenance_json, state_json, events_json) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_state WHERE world_id = ? AND revision = ?)').bind(this.worldId, expectedRevision, result.state.revision, key, JSON.stringify(transition), JSON.stringify(provenance), JSON.stringify(result.state), JSON.stringify(result.events), this.worldId, expectedRevision),
          this.database.prepare('UPDATE world_state SET revision = ?, state_json = ?, updated_at = ? WHERE world_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM world_transitions WHERE world_id = ? AND receipt_key = ? AND start_revision = ?)').bind(result.state.revision, JSON.stringify(result.state), timestamp, this.worldId, expectedRevision, this.worldId, key, expectedRevision),
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
