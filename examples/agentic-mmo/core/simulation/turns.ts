import { TURN_RULES } from '../content.ts';
import {
  DIRECTOR_SEAT,
  type Command,
  type GameEvent,
  type IndependentTurns,
  type StrategyCatchupResult,
  type TurnAdmission,
  type WorldState,
} from '../types.ts';
import { parseUtcTimestamp } from './time.ts';
import { resolveEconomy } from './economy.ts';
import { commitEvents, emitEvent } from './events.ts';
import { hasFeatures, resolveHistory } from './history.ts';

export function usesIndependentTurns(state: WorldState): boolean {
  return hasFeatures(state, ['independent-actions']);
}

export function createIndependentTurns(epoch: string): IndependentTurns {
  if (parseUtcTimestamp(epoch) === null)
    throw new RangeError('Independent actions require an explicit UTC epoch');
  return {
    epoch,
    strategyTicks: 0,
    lastActionWindow: Array.from({ length: DIRECTOR_SEAT + 1 }, () => -1),
    actionsInWindow: Array.from({ length: DIRECTOR_SEAT + 1 }, () => 0),
  };
}

export function strategyTimingError(state: WorldState, timestamp?: string): string | null {
  if (!usesIndependentTurns(state)) return null;
  const turns = state.independentTurns;
  const time = timestamp === undefined ? null : parseUtcTimestamp(timestamp);
  const epoch = turns ? parseUtcTimestamp(turns.epoch) : null;
  if (!turns || epoch === null || time === null || time < epoch)
    return 'Independent actions require an explicit UTC timestamp at or after their epoch';
  const boundary = epoch + turns.strategyTicks * TURN_RULES.strategyIntervalMs;
  if (time < boundary) return 'Action timestamp predates the latest realized strategic boundary';
  if (time >= boundary + TURN_RULES.strategyIntervalMs)
    return 'strategy_catchup_required: realize due strategic beats before admitting this action';
  return null;
}

export function admissionError(state: WorldState, seat: number, timestamp?: string): string | null {
  if (!usesIndependentTurns(state)) return seat === state.phase ? null : 'Actor is out of turn';
  const chronology = strategyTimingError(state, timestamp);
  if (chronology) return chronology;
  const turns = state.independentTurns;
  const time = timestamp === undefined ? null : parseUtcTimestamp(timestamp);
  const epoch = turns ? parseUtcTimestamp(turns.epoch) : null;
  if (!turns || time === null || epoch === null)
    return 'Independent action timing ledger is invalid';
  const window = Math.floor((time - epoch) / TURN_RULES.tacticalWindowMs);
  const previous = turns.lastActionWindow[seat];
  const spent = turns.actionsInWindow[seat];
  if (
    previous === undefined ||
    spent === undefined ||
    window < previous ||
    (window === previous && spent >= TURN_RULES.actionsPerWindow)
  )
    return 'Actor tactical allowance is exhausted or the action window is stale';
  return null;
}

export function canAct(state: WorldState, seat: number, timestamp?: string): boolean {
  return (
    Number.isInteger(seat) &&
    seat >= 0 &&
    seat <= DIRECTOR_SEAT &&
    !state.outcome &&
    (usesIndependentTurns(state) && timestamp === undefined
      ? true
      : admissionError(state, seat, timestamp) === null)
  );
}

export function turnAdmission(state: WorldState, seat: number): TurnAdmission {
  const turns = state.independentTurns;
  if (!usesIndependentTurns(state) || !turns)
    return { mode: 'sequential', nextActionAt: null, nextStrategyAt: null };
  const epoch = parseUtcTimestamp(turns.epoch);
  if (epoch === null) throw new RangeError('Independent action epoch is invalid');
  const previous = turns.lastActionWindow[seat] ?? -1;
  const spent = turns.actionsInWindow[seat] ?? 0;
  const earliestWindow = previous + (spent >= TURN_RULES.actionsPerWindow ? 1 : 0);
  const earliest = Math.max(
    epoch + turns.strategyTicks * TURN_RULES.strategyIntervalMs,
    epoch + Math.max(0, earliestWindow) * TURN_RULES.tacticalWindowMs,
  );
  return {
    mode: 'independent',
    nextActionAt: new Date(earliest).toISOString(),
    nextStrategyAt: new Date(
      epoch + (turns.strategyTicks + 1) * TURN_RULES.strategyIntervalMs,
    ).toISOString(),
  };
}

export function finishAction(state: WorldState, command: Command, events: GameEvent[]): void {
  if (usesIndependentTurns(state)) {
    const turns = state.independentTurns;
    const time = command.timestamp === undefined ? null : parseUtcTimestamp(command.timestamp);
    const epoch = turns ? parseUtcTimestamp(turns.epoch) : null;
    if (!turns || time === null || epoch === null)
      throw new RangeError('Admitted independent action lost its timing ledger');
    const window = Math.floor((time - epoch) / TURN_RULES.tacticalWindowMs);
    const spent =
      turns.lastActionWindow[command.seat] === window
        ? (turns.actionsInWindow[command.seat] ?? 0)
        : 0;
    turns.lastActionWindow[command.seat] = window;
    turns.actionsInWindow[command.seat] = spent + 1;
    return;
  }
  state.phase = (state.phase + 1) % (DIRECTOR_SEAT + 1);
  if (state.phase === 0) {
    state.round += 1;
    if (state.directorCooldown > 0 && command.action.type !== 'event') state.directorCooldown -= 1;
    resolveEconomy(state, events);
  }
}

export function catchUpStrategy(state: WorldState, timestamp: string): StrategyCatchupResult {
  const turns = state.independentTurns;
  const epoch = turns ? parseUtcTimestamp(turns.epoch) : null;
  const time = parseUtcTimestamp(timestamp);
  if (
    !usesIndependentTurns(state) ||
    !turns ||
    epoch === null ||
    time === null ||
    time < epoch ||
    state.outcome
  )
    return {
      ok: false,
      state,
      events: [],
      remainingTicks: 0,
      error:
        'Strategic catchup requires an independent running world and an explicit UTC timestamp at or after its epoch',
    };
  const totalDue = Math.floor((time - epoch) / TURN_RULES.strategyIntervalMs);
  const due = Math.max(0, totalDue - turns.strategyTicks);
  const count = Math.min(due, TURN_RULES.maximumCatchupTicks);
  if (!Number.isSafeInteger(state.revision + count) || !Number.isSafeInteger(state.round + count))
    return {
      ok: false,
      state,
      events: [],
      remainingTicks: due,
      error: 'Strategic catchup would exceed safe counters',
    };
  let next = state;
  const events: GameEvent[] = [];
  for (let index = 0; index < count && !next.outcome; index += 1) {
    const tick = structuredClone(next);
    const ledger = tick.independentTurns;
    if (!ledger) throw new RangeError('Strategic ledger disappeared');
    tick.revision += 1;
    tick.round += 1;
    ledger.strategyTicks += 1;
    if (tick.directorCooldown > 0) tick.directorCooldown -= 1;
    const tickEvents: GameEvent[] = [];
    resolveEconomy(tick, tickEvents);
    emitEvent(tick, tickEvents, {
      type: 'strategy-beat',
      title: 'Standing orders shape the world',
      detail: `Strategic economy beat ${ledger.strategyTicks}`,
      actor: null,
      target: null,
      tileId: null,
      cause: `The independent economy interval became due at ${new Date(epoch + ledger.strategyTicks * TURN_RULES.strategyIntervalMs).toISOString()}`,
      effects: [
        'Settlements produce and consume supplies; research and standing agreements resolve',
        'No actor participation or calendar advancement is required',
      ],
      importance: 2,
    });
    resolveHistory(tick, tickEvents);
    commitEvents(tick, tickEvents);
    events.push(...tickEvents);
    next = tick;
  }
  return {
    ok: true,
    state: next,
    events,
    remainingTicks: Math.max(0, totalDue - (next.independentTurns?.strategyTicks ?? 0)),
  };
}
