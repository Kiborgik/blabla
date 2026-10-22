import { isHistoricalEventSelection } from '../core/historical-selection-validation.ts';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ProtocolError } from '../../../adapters/typescript/blabla_adapter.ts';
import {
  applyCommand,
  applyDirectorTick,
  applyHistoryAdvance,
  applyRelease,
  catchUpClock,
  catchUpStrategy,
  createWorld,
  legalActions,
  observe,
} from '../core/engine.ts';
import { observeCompactTrade, type CompactTradeObservation } from '../core/observation.ts';
import { parseUtcTimestamp } from '../core/simulation/clock.ts';
import { isDirectorEvent, isWorldState } from '../core/validation.ts';
import { isGameAction, validateAttachedPlan } from '../core/planning.ts';
import {
  GAME_VERSION,
  SCHEMA_VERSION,
  type ActionOutcome,
  type ActionOption,
  type Observation,
  type CampaignReplay,
  type Command,
  type DirectorTickCommand,
  type GameAction,
  type HistoryAdvanceCommand,
  type ReleaseApplyCommand,
  type ReplayFrame,
  type TransitionResult,
  type WorldState,
} from '../core/types.ts';

export type RecordedTransition =
  | { kind: 'action'; command: Command }
  | { kind: 'director-tick'; command: DirectorTickCommand }
  | { kind: 'clock-catchup'; timestamp: string; expectedRevision: number }
  | { kind: 'strategy-catchup'; timestamp: string; expectedRevision: number }
  | { kind: 'history-advance'; command: HistoryAdvanceCommand }
  | { kind: 'release-apply'; command: ReleaseApplyCommand };

export interface ActionProvenance {
  commandId: string;
  kind: 'development-agent' | 'contract-probe' | 'clock-service';
  operation: RecordedTransition['kind'];
  model: string | null;
  seat: number;
  action: GameAction | DirectorTickCommand | HistoryAdvanceCommand | ReleaseApplyCommand | { timestamp: string };
  revision: number;
  recordedAt: string;
  request: Record<string, unknown>;
  remainingTicks?: number;
  actionOutcome?: ActionOutcome;
}

export interface LocalCampaign {
  schemaVersion: number;
  gameVersion: string;
  initial: WorldState;
  state: WorldState;
  commands: Command[];
  frames: ReplayFrame[];
  provenance: ActionProvenance[];
  lastValid: boolean;
  timeline: RecordedTransition[];
  noOpReceipts?: Array<Pick<ActionProvenance, 'operation' | 'commandId' | 'request' | 'revision' | 'remainingTicks'>>;
}

export interface ActionReply {
  ok: boolean;
  revision: number;
  last_valid: boolean;
  duplicate?: boolean;
  acceptedRevision?: number;
  commandId?: string;
  error?: string;
  remainingTicks?: number;
  actionOutcome?: ActionOutcome;
}

export interface RecordedReplay extends CampaignReplay {
  timeline: RecordedTransition[];
  provenance: ActionProvenance[];
}

interface LocalObservationMetadata {
  releaseId: string;
  unlockedFeatures: string[];
  calendarMilestones: WorldState['calendarMilestones'];
  clockEpoch: string | null;
  clockTicks: number;
  last_valid: boolean;
}

type IndexedActionOption = ActionOption & { choice: number };
export type LocalObservation = Observation & LocalObservationMetadata & { choices: IndexedActionOption[] };
export type CompactLocalObservation = CompactTradeObservation & LocalObservationMetadata & { legalActions: IndexedActionOption[] };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function errorCode(failure: unknown): string | undefined {
  return failure instanceof Error && 'code' in failure && typeof failure.code === 'string'
    ? failure.code
    : undefined;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (failure) {
    return errorCode(failure) !== 'ESRCH';
  }
}

export function atomicWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, path);
    const directory = openSync(dirname(path), 'r');
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function validateCampaign(value: unknown): asserts value is LocalCampaign {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SCHEMA_VERSION ||
    value.gameVersion !== GAME_VERSION
  ) {
    throw new ProtocolError('incompatible durable campaign schema or game version');
  }
  if (
    value.timeline === undefined &&
    Array.isArray(value.commands) &&
    Array.isArray(value.provenance)
  ) {
    value.timeline = value.commands.map((command: unknown) => ({ kind: 'action', command }));
    for (const entry of value.provenance)
      if (isRecord(entry) && entry.operation === undefined) entry.operation = 'action';
  }
  const lastFrame: unknown = Array.isArray(value.frames) ? value.frames.at(-1) : undefined;
  const allowLegacyClock =
    Array.isArray(value.timeline) &&
    value.timeline.every((entry: unknown) => isRecord(entry) && entry.kind === 'action');
  if (
    !isWorldState(value.state, { allowLegacyClock }) ||
    !isWorldState(value.initial, { allowLegacyClock }) ||
    !Array.isArray(value.frames) ||
    !value.frames.every(
      (entry: unknown) => isRecord(entry) && isWorldState(entry.state, { allowLegacyClock }),
    )
  ) {
    throw new ProtocolError('corrupt durable world state');
  }
  if (
    !isRecord(value.state) ||
    !isRecord(value.initial) ||
    !integer(value.state.revision) ||
    value.state.revision < 0 ||
    !integer(value.state.phase) ||
    value.state.phase < 0 ||
    value.state.phase > 5 ||
    !integer(value.state.round) ||
    !integer(value.state.seed) ||
    value.state.schemaVersion !== SCHEMA_VERSION ||
    value.state.gameVersion !== GAME_VERSION ||
    typeof value.state.releaseId !== 'string' ||
    !Array.isArray(value.state.unlockedFeatures) ||
    !Array.isArray(value.state.calendarMilestones) ||
    !Array.isArray(value.state.civilizations) ||
    !Array.isArray(value.state.cities) ||
    !Array.isArray(value.state.tiles) ||
    !Array.isArray(value.commands) ||
    !Array.isArray(value.frames) ||
    !Array.isArray(value.provenance) ||
    (value.noOpReceipts !== undefined && (!Array.isArray(value.noOpReceipts)
      || !value.noOpReceipts.every((entry: unknown) => isRecord(entry) && entry.operation === 'strategy-catchup'
        && typeof entry.commandId === 'string' && entry.commandId.length > 0 && entry.commandId.length <= 500
        && isRecord(entry.request) && integer(entry.revision) && entry.revision >= 0
        && isRecord(value.state) && integer(value.state.revision) && entry.revision <= value.state.revision
        && integer(entry.remainingTicks) && entry.remainingTicks >= 0))) ||
    typeof value.lastValid !== 'boolean' ||
    !Array.isArray(value.timeline) ||
    value.timeline.length !== value.provenance.length ||
    value.timeline.length !== value.frames.length ||
    value.commands.length > value.timeline.length ||
    value.initial.revision !== 0 ||
    (value.frames.length === 0
      ? value.state.revision !== 0
      : !isRecord(lastFrame) ||
        !isRecord(lastFrame.state) ||
        lastFrame.state.revision !== value.state.revision) ||
    !value.timeline.every(
      (entry: unknown) =>
        isRecord(entry) &&
        (entry.kind !== 'action' || isRecord(entry.command) && isGameAction(entry.command.action)) &&
        (entry.kind === 'action' ||
          entry.kind === 'director-tick' ||
          entry.kind === 'clock-catchup' || entry.kind === 'strategy-catchup' || entry.kind === 'history-advance' || entry.kind === 'release-apply'),
    ) ||
    !value.commands.every(
      (entry: unknown) =>
        isRecord(entry) &&
        integer(entry.seat) &&
        integer(entry.expectedRevision) &&
        isGameAction(entry.action),
    ) ||
    !value.frames.every(
      (entry: unknown) => isRecord(entry) && isRecord(entry.state) && Array.isArray(entry.events),
    ) ||
    !value.provenance.every(
      (entry: unknown) =>
        isRecord(entry) &&
        typeof entry.commandId === 'string' &&
        (entry.kind === 'development-agent' ||
          entry.kind === 'contract-probe' ||
          entry.kind === 'clock-service') &&
        integer(entry.seat) &&
        integer(entry.revision) &&
        isRecord(entry.action) &&
        isRecord(entry.request),
    )
  ) {
    throw new ProtocolError('corrupt durable campaign data');
  }
}

export class GameStore {
  readonly path: string;

  constructor(path = resolve(process.cwd(), '.blabla/world.json')) {
    this.path = resolve(path);
  }

  private locked<T>(operation: () => T): T {
    mkdirSync(dirname(this.path), { recursive: true });
    const lock = `${this.path}.lock`;
    const deadline = Date.now() + 15000;
    for (;;) {
      let descriptor: number;
      try {
        descriptor = openSync(lock, 'wx', 0o600);
      } catch (failure) {
        if (errorCode(failure) !== 'EEXIST') throw failure;
        try {
          const before = statSync(lock);
          let abandoned = Date.now() - before.mtimeMs > 30000;
          try {
            const owner: unknown = JSON.parse(readFileSync(lock, 'utf8'));
            if (isRecord(owner) && integer(owner.pid)) abandoned = !alive(owner.pid);
          } catch {
            abandoned = Date.now() - before.mtimeMs > 30000;
          }
          if (abandoned && statSync(lock).ino === before.ino) {
            unlinkSync(lock);
            continue;
          }
        } catch (inspectionFailure) {
          if (errorCode(inspectionFailure) === 'ENOENT') continue;
        }
        if (Date.now() >= deadline)
          throw new ProtocolError('world is busy; retry with the same command id');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        continue;
      }
      try {
        writeFileSync(descriptor, JSON.stringify({ pid: process.pid }));
        return operation();
      } finally {
        closeSync(descriptor);
        unlinkSync(lock);
      }
    }
  }

  private load(): LocalCampaign {
    if (!existsSync(this.path)) throw new ProtocolError('world not initialized; use init');
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      throw new ProtocolError('corrupt durable campaign JSON');
    }
    validateCampaign(value);
    return value;
  }

  initialize(seed = 17, reset = false, clockEpoch?: string): ActionReply {
    if (!integer(seed)) throw new ProtocolError('seed must be a safe integer');
    if (clockEpoch !== undefined && parseUtcTimestamp(clockEpoch) === null)
      throw new ProtocolError('clockEpoch must be an explicit UTC ISO timestamp');
    return this.locked(() => {
      if (existsSync(this.path) && !reset) {
        const current = this.load();
        return {
          ok: false,
          revision: current.state.revision,
          last_valid: current.lastValid,
          error: 'world already initialized',
        };
      }
      const state = createWorld(seed, clockEpoch);
      atomicWrite(this.path, {
        schemaVersion: SCHEMA_VERSION,
        gameVersion: GAME_VERSION,
        initial: state,
        state,
        commands: [],
        frames: [],
        provenance: [],
        timeline: [],
        lastValid: true,
      } satisfies LocalCampaign);
      return { ok: true, revision: state.revision, last_valid: true };
    });
  }

  ensure(): void {
    if (!existsSync(this.path)) this.initialize();
  }

  snapshot(): LocalCampaign {
    return this.locked(() => this.load());
  }

  observation(seat?: unknown, timestamp?: unknown): LocalObservation;
  observation(seat: unknown, timestamp: unknown, observationFormat: 'compact-trade-v1'): CompactLocalObservation;
  observation(seat: unknown, timestamp: unknown, observationFormat: unknown): LocalObservation | CompactLocalObservation;
  observation(seat?: unknown, timestamp?: unknown, observationFormat?: unknown): LocalObservation | CompactLocalObservation {
    if (observationFormat !== undefined && observationFormat !== 'compact-trade-v1')
      throw new ProtocolError('observationFormat must be compact-trade-v1 when supplied');
    const campaign = this.snapshot();
    const selected = seat ?? campaign.state.phase;
    if (!integer(selected) || selected < 0 || selected > 5)
      throw new ProtocolError('seat must be an integer from 0 to 5');
    if (timestamp !== undefined && (typeof timestamp !== 'string' || parseUtcTimestamp(timestamp) === null))
      throw new ProtocolError('timestamp must be an explicit UTC ISO timestamp');
    const at = typeof timestamp === 'string' ? timestamp : undefined;
    const metadata: LocalObservationMetadata = {
      releaseId: campaign.state.releaseId,
      unlockedFeatures: campaign.state.unlockedFeatures,
      calendarMilestones: campaign.state.calendarMilestones,
      clockEpoch: campaign.state.clockEpoch ?? null,
      clockTicks: campaign.state.clockTicks ?? 0,
      last_valid: campaign.lastValid,
    };
    if (observationFormat === 'compact-trade-v1') {
      const compact = observeCompactTrade(campaign.state, selected, at);
      return { ...compact, ...metadata, legalActions: compact.legalActions.map((option, choice) => ({ choice, ...option })) };
    }
    const observation = observe(campaign.state, selected, at);
    return {
      ...observation,
      ...metadata,
      choices: observation.legalActions.map((option, choice) => ({ choice, ...option })),
    };
  }

  submit(input: Record<string, unknown>, contractProbe = false): ActionReply {
    return this.locked(() => {
      const campaign = this.load();
      const refuse = (error: string, actionOutcome?: ActionOutcome): ActionReply => {
        if (!campaign.state.independentTurns && input.plan === undefined) {
          campaign.lastValid = false;
          atomicWrite(this.path, campaign);
        }
        const outcome = actionOutcome ?? (input.plan !== undefined || campaign.state.unlockedFeatures.includes('bounded-plans') ? { status: 'failed' as const, code: 'invalid_command', reason: error } : undefined);
        return { ok: false, revision: campaign.state.revision, last_valid: false, error, ...(outcome ? { actionOutcome: outcome } : {}) };
      };
      const seat = input.seat;
      const expectedRevision = input.expectedRevision;
      const model = contractProbe ? null : input.model;
      const commandId = input.commandId ?? randomUUID();
      if (!integer(seat) || seat < 0 || seat > 5)
        return refuse('seat must be an integer from 0 to 5');
      if (!integer(expectedRevision) || expectedRevision < 0)
        return refuse('expectedRevision must be a nonnegative safe integer');
      if (
        !contractProbe &&
        (typeof model !== 'string' || model.trim().length === 0 || model.length > 200)
      )
        return refuse('development-agent actions require a nonempty model identifier');
      if (typeof commandId !== 'string' || commandId.length === 0 || commandId.length > 200)
        return refuse('commandId must contain 1 to 200 characters');
      const request: Record<string, unknown> = {
        seat,
        expectedRevision,
        model,
        kind: contractProbe ? 'contract-probe' : 'development-agent',
      };
      if (input.choice !== undefined) request.choice = input.choice;
      if (input.action !== undefined) request.action = input.action;
      if (input.timestamp !== undefined) request.timestamp = input.timestamp;
      if (input.plan !== undefined) request.plan = input.plan;
      const prior = campaign.provenance.find(
        (entry) => entry.operation === 'action' && entry.commandId === commandId,
      );
      if (prior) {
        if (!isDeepStrictEqual(prior.request, request))
          return refuse('commandId was already used for a different command');
        if (!campaign.lastValid) {
          campaign.lastValid = true;
          atomicWrite(this.path, campaign);
        }
        return {
          ok: true,
          duplicate: true,
          revision: campaign.state.revision,
          acceptedRevision: prior.revision,
          last_valid: true,
          commandId,
          ...(prior.remainingTicks === undefined ? {} : { remainingTicks: prior.remainingTicks }),
          ...(prior.actionOutcome ? { actionOutcome: prior.actionOutcome } : {}),
        };
      }
      const canRebase = campaign.state.independentTurns !== undefined && input.action !== undefined && input.choice === undefined;
      if (expectedRevision > campaign.state.revision || (expectedRevision !== campaign.state.revision && !canRebase))
        return refuse(`stale revision: expected ${campaign.state.revision}`);
      if (!campaign.state.independentTurns && seat !== campaign.state.phase) return refuse(`active seat is ${campaign.state.phase}`);
      const options = legalActions(campaign.state, seat, undefined, isGameAction(input.action) && input.action.type === 'event' ? input.action : undefined);
      let action: GameAction | undefined;
      if (input.choice !== undefined && input.action !== undefined)
        return refuse('provide either choice or action, not both');
      if (input.choice !== undefined) {
        if (!integer(input.choice) || input.choice < 0 || input.choice >= options.length)
          return refuse(`choice must be an integer from 0 to ${options.length - 1}`);
        action = options[input.choice]?.action;
      } else {
        action = options.find((option) => isDeepStrictEqual(option.action, input.action))?.action;
      }
      if (!action) return refuse('action is not a currently legal option');
      const timestamp = input.timestamp;
      if ((timestamp !== undefined || campaign.state.independentTurns) && (typeof timestamp !== 'string' || parseUtcTimestamp(timestamp) === null)) return refuse('timestamp must be an explicit UTC ISO timestamp');
      const command: Command = { seat, expectedRevision: campaign.state.revision, action, ...(typeof timestamp === 'string' ? { timestamp } : {}) };
      if (input.plan !== undefined) {
        command.observedRevision = expectedRevision;
        const checked = validateAttachedPlan(campaign.state, command, input.plan);
        if (!checked.ok) return refuse(checked.error, { status: 'failed', code: checked.code, reason: checked.error });
        command.plan = checked.plan;
      }
      const result = applyCommand(campaign.state, command);
      if (!result.ok) return refuse(result.error ?? 'command refused by the engine', result.actionOutcome);
      campaign.state = result.state;
      campaign.commands.push(command);
      campaign.frames.push({ state: result.state, events: result.events });
      campaign.timeline.push({ kind: 'action', command });
      campaign.provenance.push({
        commandId,
        operation: 'action',
        kind: contractProbe ? 'contract-probe' : 'development-agent',
        model: typeof model === 'string' ? model : null,
        seat,
        action,
        revision: result.state.revision,
        recordedAt: new Date().toISOString(),
        request,
        ...(result.actionOutcome ? { actionOutcome: result.actionOutcome } : {}),
      });
      campaign.lastValid = true;
      atomicWrite(this.path, campaign);
      return {
        ok: true,
        revision: result.state.revision,
        acceptedRevision: result.state.revision,
        last_valid: true,
        commandId,
        ...(result.actionOutcome ? { actionOutcome: result.actionOutcome } : {}),
      };
    });
  }

  private systemTransition(
    input: Record<string, unknown>,
    operation: 'director-tick' | 'clock-catchup' | 'strategy-catchup',
  ): ActionReply {
    return this.locked(() => {
      const campaign = this.load();
      const refuse = (error: string): ActionReply => {
        if (!campaign.state.independentTurns) {
          campaign.lastValid = false;
          atomicWrite(this.path, campaign);
        }
        return { ok: false, revision: campaign.state.revision, last_valid: false, error };
      };
      if (!isWorldState(campaign.state))
        return refuse(
          'legacy pre-clock history requires an explicit host migration before system operations',
        );
      const revision = input.expectedRevision;
      const timestamp = input.timestamp;
      const model = input.model ?? null;
      const clockService =
        model === null && (operation === 'clock-catchup' || operation === 'strategy-catchup' || input.kind === 'clock');
      if (!integer(revision) || revision < 0)
        return refuse('expectedRevision must be a nonnegative safe integer');
      if (typeof timestamp !== 'string' || parseUtcTimestamp(timestamp) === null)
        return refuse('timestamp must be an explicit UTC ISO timestamp');
      if (
        !clockService &&
        (typeof model !== 'string' || model.trim().length === 0 || model.length > 200)
      )
        return refuse('Director decisions require a nonempty model identifier');
      const kind = input.kind;
      const intervalId = input.intervalId;
      const event = input.event;
      const target = input.target;
      if (Object.hasOwn(input, 'regional') && (operation !== 'director-tick' || !isHistoricalEventSelection(input.regional))) return refuse('invalid regional selection');
      if (
        operation === 'director-tick' &&
        ((kind !== 'event' && kind !== 'review' && kind !== 'clock') ||
          typeof intervalId !== 'string' ||
          intervalId.length === 0 ||
          intervalId.length > 200 ||
          !isDirectorEvent(event) ||
          !integer(target) ||
          target < 0 ||
          target > 4)
      )
        return refuse('invalid Director tick fields');
      const commandId =
        operation === 'director-tick'
          ? `director:${String(kind)}:${String(intervalId)}`
          : (input.commandId ?? randomUUID());
      if (typeof commandId !== 'string' || commandId.length === 0 || commandId.length > 500)
        return refuse('invalid commandId');
      const request: Record<string, unknown> = {
        expectedRevision: revision,
        timestamp,
        model,
        operation,
      };
      if (operation === 'director-tick')
        Object.assign(request, { kind, intervalId, event, target, ...(isHistoricalEventSelection(input.regional) ? { regional: structuredClone(input.regional) } : {}) });
      const prior = campaign.provenance.find(
        (entry) => entry.operation === operation && entry.commandId === commandId,
      ) ?? campaign.noOpReceipts?.find((entry) => entry.operation === operation && entry.commandId === commandId);
      if (prior) {
        if (!isDeepStrictEqual(prior.request, request))
          return refuse('interval or command id was already used with different content');
        if (!campaign.lastValid) {
          campaign.lastValid = true;
          atomicWrite(this.path, campaign);
        }
        return {
          ok: true,
          duplicate: true,
          revision: campaign.state.revision,
          acceptedRevision: prior.revision,
          last_valid: true,
          commandId,
          ...(prior.remainingTicks === undefined ? {} : { remainingTicks: prior.remainingTicks }),
        };
      }
      if (revision !== campaign.state.revision)
        return refuse(`stale revision: expected ${campaign.state.revision}`);
      let result: TransitionResult;
      let transition: RecordedTransition;
      let action: ActionProvenance['action'];
      let remainingTicks: number | undefined;
      if (operation === 'director-tick') {
        if (
          (kind !== 'event' && kind !== 'review' && kind !== 'clock') ||
          typeof intervalId !== 'string' ||
          !isDirectorEvent(event) ||
          !integer(target)
        )
          return refuse('invalid Director tick fields');
        const command: DirectorTickCommand = {
          ...(isHistoricalEventSelection(input.regional) ? { regional: structuredClone(input.regional) } : {}),
          expectedRevision: revision,
          kind,
          intervalId,
          timestamp,
          event,
          target,
        };
        result = applyDirectorTick(campaign.state, command);
        transition = { kind: 'director-tick', command };
        action = command;
      } else {
        const caught = operation === 'strategy-catchup' ? catchUpStrategy(campaign.state, timestamp) : catchUpClock(campaign.state, timestamp);
        result = caught;
        remainingTicks = caught.remainingTicks;
        transition = { kind: operation, timestamp, expectedRevision: revision };
        action = { timestamp };
      }
      if (!result.ok) return refuse(result.error ?? 'system transition refused by engine');
      if (result.state.revision === campaign.state.revision) {
        if (operation === 'strategy-catchup') {
          campaign.noOpReceipts ??= [];
          campaign.noOpReceipts.push({ operation, commandId, request, revision, remainingTicks: remainingTicks ?? 0 });
          campaign.lastValid = true;
          atomicWrite(this.path, campaign);
          return { ok: true, revision, acceptedRevision: revision, last_valid: true, commandId, remainingTicks: remainingTicks ?? 0 };
        }
        if (!campaign.lastValid) {
          campaign.lastValid = true;
          atomicWrite(this.path, campaign);
        }
        return {
          ok: true,
          duplicate: true,
          revision,
          last_valid: true,
          ...(remainingTicks === undefined ? {} : { remainingTicks }),
        };
      }
      campaign.state = result.state;
      campaign.frames.push({ state: result.state, events: result.events });
      campaign.timeline.push(transition);
      campaign.provenance.push({
        commandId,
        operation,
        kind: clockService ? 'clock-service' : 'development-agent',
        model: typeof model === 'string' ? model : null,
        seat: 5,
        action,
        revision: result.state.revision,
        recordedAt: new Date().toISOString(),
        request,
        ...(remainingTicks === undefined ? {} : { remainingTicks }),
      });
      campaign.lastValid = true;
      atomicWrite(this.path, campaign);
      return {
        ok: true,
        revision: result.state.revision,
        acceptedRevision: result.state.revision,
        last_valid: true,
        commandId,
        ...(remainingTicks === undefined ? {} : { remainingTicks }),
      };
    });
  }

  authoredTransition(input: Record<string, unknown>, operation: 'history-advance' | 'release-apply'): ActionReply {
    return this.locked(() => {
      const campaign = this.load();
      const refuse = (error: string): ActionReply => {
        if (!campaign.state.independentTurns) {
          campaign.lastValid = false;
          atomicWrite(this.path, campaign);
        }
        return { ok: false, revision: campaign.state.revision, last_valid: false, error };
      };
      if (!isWorldState(campaign.state)) return refuse('legacy pre-clock history requires an explicit host migration before system operations');
      const expectedRevision = input.expectedRevision;
      const model = input.model;
      const commandId = input.commandId;
      if (!integer(expectedRevision) || expectedRevision < 0) return refuse('expectedRevision must be a nonnegative safe integer');
      if (typeof model !== 'string' || model.trim().length === 0 || model.length > 200) return refuse('authored transitions require a nonempty model identifier');
      if (typeof commandId !== 'string' || commandId.trim().length === 0 || commandId.length > 200) return refuse('commandId must contain 1 to 200 characters');
      let transition: RecordedTransition;
      let action: HistoryAdvanceCommand | ReleaseApplyCommand;
      if (operation === 'history-advance') {
        const cause = input.cause;
        if (!isRecord(cause) || (cause.kind !== 'feature' && cause.kind !== 'event') || typeof cause.id !== 'string'
          || typeof input.reason !== 'string' || !integer(input.deltaYears) || typeof input.timestamp !== 'string') return refuse('invalid history advance fields');
        action = { expectedRevision, cause: { kind: cause.kind, id: cause.id }, reason: input.reason, deltaYears: input.deltaYears, timestamp: input.timestamp };
        transition = { kind: 'history-advance', command: action };
      } else {
        if (typeof input.expectedFromReleaseId !== 'string' || typeof input.targetReleaseId !== 'string') return refuse('exact source and target release IDs are required');
        if (input.timestamp !== undefined && (typeof input.timestamp !== 'string' || parseUtcTimestamp(input.timestamp) === null)) return refuse('timestamp must be an explicit UTC ISO timestamp');
        action = { expectedRevision, expectedFromReleaseId: input.expectedFromReleaseId, targetReleaseId: input.targetReleaseId, ...(typeof input.timestamp === 'string' ? { timestamp: input.timestamp } : {}) };
        transition = { kind: 'release-apply', command: action };
      }
      const request: Record<string, unknown> = { operation, model, ...action };
      const prior = campaign.provenance.find((entry) => entry.operation === operation && entry.commandId === commandId);
      if (prior) {
        if (!isDeepStrictEqual(prior.request, request)) return refuse('commandId was already used with different content');
        if (!campaign.lastValid) { campaign.lastValid = true; atomicWrite(this.path, campaign); }
        return { ok: true, duplicate: true, revision: campaign.state.revision, acceptedRevision: prior.revision, last_valid: true, commandId };
      }
      if (expectedRevision !== campaign.state.revision) return refuse(`stale revision: expected ${campaign.state.revision}`);
      const result = transition.kind === 'history-advance'
        ? applyHistoryAdvance(campaign.state, transition.command) : applyRelease(campaign.state, transition.command);
      if (!result.ok) return refuse(result.error ?? 'authored transition refused by engine');
      campaign.state = result.state;
      campaign.frames.push({ state: result.state, events: result.events });
      campaign.timeline.push(transition);
      campaign.provenance.push({ commandId, operation, kind: 'development-agent', model, seat: 5, action, revision: result.state.revision, recordedAt: new Date().toISOString(), request });
      campaign.lastValid = true;
      atomicWrite(this.path, campaign);
      return { ok: true, revision: result.state.revision, acceptedRevision: result.state.revision, last_valid: true, commandId };
    });
  }

  directorTick(input: Record<string, unknown>): ActionReply {
    return this.systemTransition(input, 'director-tick');
  }

  catchUp(input: Record<string, unknown>): ActionReply {
    return this.systemTransition(input, 'clock-catchup');
  }

  strategyCatchUp(input: Record<string, unknown>): ActionReply {
    return this.systemTransition(input, 'strategy-catchup');
  }

  probe(seat: number, choice: number): ActionReply {
    return this.submit({ seat, choice, expectedRevision: this.snapshot().state.revision }, true);
  }

  replay(): RecordedReplay {
    const campaign = this.snapshot();
    const kinds = new Set(campaign.provenance.map((entry) => entry.kind));
    const source =
      kinds.size > 1
        ? 'mixed'
        : kinds.has('contract-probe')
          ? 'contract-probes'
          : kinds.has('clock-service')
            ? 'builtin-policies'
            : 'development-agents';
    return {
      schemaVersion: SCHEMA_VERSION,
      gameVersion: GAME_VERSION,
      seed: campaign.initial.seed,
      source,
      title: 'Persistent development world',
      initial: campaign.initial,
      frames: campaign.frames,
      commands: campaign.commands,
      timeline: campaign.timeline,
      provenance: campaign.provenance,
    };
  }
}
