import { DIRECTOR_CLOCK_RULES, DIRECTOR_EVENTS } from '../content.ts';
import {
  DIRECTOR_SEAT,
  type DirectorTickCommand,
  type GameEvent,
  type TransitionResult,
  type WorldState,
} from '../types.ts';
import { applyDirectorEvent } from './commands.ts';
import { commitEvents, emitEvent } from './events.ts';
import { hasFeatures, resolveHistory } from './history.ts';

export function parseUtcTimestamp(timestamp: string): number | null {
  if (
    typeof timestamp !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp)
  )
    return null;
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return null;
  const normalized = new Date(value).toISOString();
  return normalized === timestamp || normalized.replace('.000Z', 'Z') === timestamp ? value : null;
}

function rejected(state: WorldState, error: string): TransitionResult {
  return { ok: false, state, events: [], error };
}

export function applyDirectorTick(
  state: WorldState,
  command: DirectorTickCommand,
): TransitionResult {
  if (
    typeof command !== 'object' ||
    command === null ||
    state.outcome ||
    command.expectedRevision !== state.revision ||
    !Number.isSafeInteger(command.expectedRevision) ||
    !['clock', 'event', 'review'].includes(command.kind) ||
    typeof command.intervalId !== 'string' ||
    command.intervalId.trim().length === 0 ||
    command.intervalId.length > 128
  ) {
    return rejected(
      state,
      'Director tick has an invalid kind, interval, revision or terminal state',
    );
  }
  const timestamp = parseUtcTimestamp(command.timestamp);
  if (timestamp === null)
    return rejected(state, 'Director tick requires a valid explicit UTC timestamp');
  const key = `${command.kind}:${command.intervalId}`;
  if (Object.hasOwn(state.directorIntervals, key))
    return rejected(state, 'Director interval was already committed');
  if (command.kind === 'clock') {
    const epoch = state.clockEpoch === null ? null : parseUtcTimestamp(state.clockEpoch);
    const nextIndex = state.clockTicks + 1;
    if (
      epoch === null ||
      command.intervalId !== String(nextIndex) ||
      timestamp < epoch + nextIndex * DIRECTOR_CLOCK_RULES.intervalMs
    ) {
      return rejected(state, 'Clock tick must be the next due interval from the persisted epoch');
    }
  } else {
    const event = DIRECTOR_EVENTS.find((candidate) => candidate.id === command.event);
    const era = Math.max(...state.civilizations.map((civilization) => civilization.era));
    if (
      !event ||
      !hasFeatures(state, event.requiredFeatures) ||
      event.minEra > era ||
      !state.civilizations.some((civilization) => civilization.id === command.target)
    ) {
      return rejected(state, 'Director event is unavailable or targets no civilization');
    }
  }
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  next.revision += 1;
  next.directorIntervals[key] = command.timestamp;
  if (command.kind === 'clock') {
    next.clockTicks += 1;
    next.year += DIRECTOR_CLOCK_RULES.yearsPerTick;
    emitEvent(next, events, {
      type: 'clock-tick',
      title: 'The world clock advances',
      detail: `Authoritative clock interval ${next.clockTicks}`,
      actor: DIRECTOR_SEAT,
      target: null,
      tileId: null,
      cause: `The persisted six-minute interval became due at ${command.timestamp}`,
      effects: [`Calendar ${state.year} → ${next.year}`, 'Released capabilities remain unchanged'],
      importance: 1,
    });
    if (next.clockTicks % DIRECTOR_CLOCK_RULES.majorEveryTicks === 0) {
      emitEvent(next, events, {
        type: 'clock-major-milestone',
        title: 'A century passes',
        detail: `${next.clockTicks} authoritative clock intervals have completed`,
        actor: DIRECTOR_SEAT,
        target: null,
        tileId: null,
        cause: `Clock interval ${next.clockTicks} completed at ${command.timestamp}`,
        effects: [
          `The world has advanced ${DIRECTOR_CLOCK_RULES.majorEveryTicks * DIRECTOR_CLOCK_RULES.yearsPerTick} years since its previous century marker`,
          'Feature availability remains independent of the calendar',
        ],
        importance: 4,
      });
    }
  } else {
    applyDirectorEvent(
      next,
      command.event,
      command.target,
      events,
      `The World Director ${command.kind} interval ${command.intervalId} was submitted at ${command.timestamp}`,
    );
    next.year +=
      command.kind === 'event'
        ? DIRECTOR_CLOCK_RULES.eventAdvanceYears
        : DIRECTOR_CLOCK_RULES.reviewAdvanceYears;
  }
  resolveHistory(next, events);
  commitEvents(next, events);
  return { ok: true, state: next, events };
}

export function catchUpClock(
  state: WorldState,
  timestamp: string,
): TransitionResult & { remainingTicks: number } {
  const time = parseUtcTimestamp(timestamp);
  const epoch = state.clockEpoch === null ? null : parseUtcTimestamp(state.clockEpoch);
  if (time === null || epoch === null || time < epoch || state.outcome) {
    return {
      ...rejected(
        state,
        'Clock catchup requires a running world, persisted epoch and a valid UTC timestamp at or after it',
      ),
      remainingTicks: 0,
    };
  }
  const totalDue = Math.floor((time - epoch) / DIRECTOR_CLOCK_RULES.intervalMs);
  const due = Math.max(0, totalDue - state.clockTicks);
  let next = state;
  const events: GameEvent[] = [];
  const count = Math.min(due, DIRECTOR_CLOCK_RULES.maxCatchUpTicks);
  for (let index = 0; index < count; index += 1) {
    const tickIndex = next.clockTicks + 1;
    const result = applyDirectorTick(next, {
      expectedRevision: next.revision,
      kind: 'clock',
      intervalId: String(tickIndex),
      timestamp: new Date(epoch + tickIndex * DIRECTOR_CLOCK_RULES.intervalMs).toISOString(),
      event: 'calm',
      target: 0,
    });
    if (!result.ok)
      return { ...result, events, remainingTicks: Math.max(0, totalDue - next.clockTicks) };
    next = result.state;
    events.push(...result.events);
  }
  return { ok: true, state: next, events, remainingTicks: Math.max(0, totalDue - next.clockTicks) };
}
