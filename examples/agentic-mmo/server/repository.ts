import { applyCommand, applyDirectorTick, catchUpClock, createWorld, legalActions } from '../core/engine.ts';
import { type Command, type DirectorTickCommand, type GameAction, type GameEvent, type TransitionResult, type WorldState } from '../core/types.ts';
import { assertWorld, boundedInteger, canonical, isRecord, parseJson, record, RequestFailure, text, utc } from './validation.ts';

export type SqlValue = string | number | null;
export interface D1Result { results: unknown[]; meta: { changes: number } }
export interface D1Statement { bind(...values: SqlValue[]): D1Statement; all(): Promise<D1Result>; run(): Promise<D1Result> }
export interface D1Database { prepare(sql: string): D1Statement; batch(statements: D1Statement[]): Promise<D1Result[]> }
export type HostedTransition =
  | { kind: 'action'; command: Command }
  | { kind: 'director-tick'; command: DirectorTickCommand }
  | { kind: 'clock-catchup'; expectedRevision: number; timestamp: string };
export interface HostedProvenance { actorUserId: string; kind: 'development-agent' | 'clock-service'; model: string | null; seat: number; commandId: string; recordedAt: string }
export interface HostedEntry { transition: HostedTransition; provenance: HostedProvenance; state: WorldState; events: GameEvent[]; startRevision: number; endRevision: number }
export interface HostedReply { ok: true; revision: number; acceptedRevision: number; duplicate?: boolean; remainingTicks?: number }
export interface HostedWorld { initial: WorldState; state: WorldState }

function assertReply(value: unknown): asserts value is HostedReply {
  if (!isRecord(value) || value.ok !== true || typeof value.revision !== 'number' || typeof value.acceptedRevision !== 'number') throw new RequestFailure(503, 'corrupt_receipt');
}

function assertEntry(value: unknown): asserts value is HostedEntry {
  if (!isRecord(value) || !isRecord(value.transition) || !isRecord(value.provenance) || !Array.isArray(value.events)
    || typeof value.startRevision !== 'number' || typeof value.endRevision !== 'number') throw new RequestFailure(503, 'corrupt_history');
  assertWorld(value.state);
}

export class WorldRepository {
  private readonly database: D1Database;
  private readonly worldId: string;
  constructor(database: D1Database, worldId = 'main') { this.database = database; this.worldId = worldId; }

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
    const expectedRevision = boundedInteger(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'revision');
    const commandId = operation === 'director-tick' ? `${text(input.kind, 'tick_kind')}:${text(input.intervalId, 'interval_id')}` : text(input.commandId, 'command_id');
    const key = `${operation}:${commandId}`;
    const fingerprint = canonical({ operation, input, actorUserId });
    const prior = await this.receipt(key, fingerprint);
    if (prior) return prior;
    const current = await this.read();
    if (!current) throw new RequestFailure(503, 'world_not_initialized');
    if (current.state.revision !== expectedRevision) throw new RequestFailure(409, 'stale_revision');
    let transition: HostedTransition;
    let result: TransitionResult;
    let remainingTicks: number | undefined;
    let seat = 5;
    let model: string | null = null;
    if (operation === 'action') {
      model = text(input.model, 'model');
      seat = boundedInteger(input.seat, 0, 5, 'seat');
      if (seat !== current.state.phase) throw new RequestFailure(409, 'wrong_active_seat');
      const options = legalActions(current.state, seat);
      let action: GameAction | undefined;
      if (input.choice !== undefined && input.action !== undefined) throw new RequestFailure(400, 'one_action_selector_required');
      if (input.choice !== undefined) action = options[boundedInteger(input.choice, 0, options.length - 1, 'choice')]?.action;
      else action = options.find((option) => canonical(option.action) === canonical(input.action))?.action;
      if (!action) throw new RequestFailure(400, 'illegal_action');
      const command: Command = { seat, expectedRevision, action };
      transition = { kind: 'action', command };
      result = applyCommand(current.state, command);
    } else {
      const at = utc(input.timestamp);
      if (Date.parse(at) > Date.parse(timestamp)) throw new RequestFailure(400, 'future_timestamp');
      if (operation === 'clock-catchup') {
        if (input.model !== undefined) model = text(input.model, 'model');
        transition = { kind: 'clock-catchup', expectedRevision, timestamp: at };
        const caught = catchUpClock(current.state, at);
        result = caught;
        remainingTicks = caught.remainingTicks;
      } else {
        const kind = input.kind;
        if (kind !== 'clock' && kind !== 'event' && kind !== 'review') throw new RequestFailure(400, 'invalid_tick_kind');
        if (kind !== 'clock' || input.model !== undefined) model = text(input.model, 'model');
        const event = input.event ?? 'calm';
        if (event !== 'calm' && event !== 'drought' && event !== 'earthquake' && event !== 'resource-boom' && event !== 'crypto-boom' && event !== 'ufo-contact') throw new RequestFailure(400, 'invalid_event');
        const target = boundedInteger(input.target ?? 0, 0, 4, 'target');
        const command: DirectorTickCommand = { expectedRevision, kind, intervalId: text(input.intervalId, 'interval_id'), timestamp: at, event, target };
        transition = { kind: 'director-tick', command };
        result = applyDirectorTick(current.state, command);
      }
    }
    if (!result.ok) throw new RequestFailure(400, 'engine_refused_transition');
    assertWorld(result.state);
    const reply: HostedReply = { ok: true, revision: result.state.revision, acceptedRevision: result.state.revision, ...(remainingTicks === undefined ? {} : { remainingTicks }) };
    const provenance: HostedProvenance = { actorUserId, kind: model === null ? 'clock-service' : 'development-agent', model, seat, commandId, recordedAt: timestamp };
    const unchanged = result.state.revision === expectedRevision;
    const statements = unchanged ? [
      this.database.prepare('INSERT OR IGNORE INTO world_receipts (world_id, receipt_key, request_json, response_json) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_state WHERE world_id = ? AND revision = ?)').bind(this.worldId, key, fingerprint, JSON.stringify(reply), this.worldId, expectedRevision),
    ] : [
      this.database.prepare('INSERT INTO world_transitions (world_id, start_revision, end_revision, receipt_key, transition_json, provenance_json, state_json, events_json) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_state WHERE world_id = ? AND revision = ?)').bind(this.worldId, expectedRevision, result.state.revision, key, JSON.stringify(transition), JSON.stringify(provenance), JSON.stringify(result.state), JSON.stringify(result.events), this.worldId, expectedRevision),
      this.database.prepare('UPDATE world_state SET revision = ?, state_json = ?, updated_at = ? WHERE world_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM world_transitions WHERE world_id = ? AND receipt_key = ? AND start_revision = ?)').bind(result.state.revision, JSON.stringify(result.state), timestamp, this.worldId, expectedRevision, this.worldId, key, expectedRevision),
      this.database.prepare('INSERT OR IGNORE INTO world_receipts (world_id, receipt_key, request_json, response_json) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_transitions WHERE world_id = ? AND receipt_key = ?)').bind(this.worldId, key, fingerprint, JSON.stringify(reply), this.worldId, key),
    ];
    try {
      const committed = await this.database.batch(statements);
      if (committed[0]?.meta.changes === 1) return reply;
    } catch (failure) {
      const retry = await this.receipt(key, fingerprint);
      if (retry) return retry;
      throw failure;
    }
    const retry = await this.receipt(key, fingerprint);
    if (retry) return retry;
    throw new RequestFailure(409, 'stale_revision');
  }

  async history(after = 0, limit = 50): Promise<{ entries: HostedEntry[]; hasMore: boolean; nextRevision: number | null }> {
    boundedInteger(after, 0, Number.MAX_SAFE_INTEGER, 'after');
    boundedInteger(limit, 1, 200, 'limit');
    const result = await this.database.prepare('SELECT start_revision, end_revision, transition_json, provenance_json, state_json, events_json FROM world_transitions WHERE world_id = ? AND end_revision > ? ORDER BY end_revision ASC LIMIT ?').bind(this.worldId, after, limit + 1).all();
    const entries = result.results.slice(0, limit).map((value) => {
      const row = record(value);
      if (typeof row.transition_json !== 'string' || typeof row.provenance_json !== 'string' || typeof row.state_json !== 'string' || typeof row.events_json !== 'string') throw new RequestFailure(503, 'corrupt_history');
      const entry: unknown = { startRevision: row.start_revision, endRevision: row.end_revision, transition: parseJson(row.transition_json), provenance: parseJson(row.provenance_json), state: parseJson(row.state_json), events: parseJson(row.events_json) };
      assertEntry(entry);
      return entry;
    });
    const hasMore = result.results.length > limit;
    return { entries, hasMore, nextRevision: hasMore ? entries.at(-1)?.endRevision ?? null : null };
  }
}
