import { FEATURES } from '../content.ts';
import {
  DIRECTOR_SEAT,
  type GameEvent,
  type HistoryAdvanceCommand,
  type TransitionResult,
  type WorldState,
} from '../types.ts';
import { parseUtcTimestamp } from './clock.ts';
import { commitEvents, emitEvent } from './events.ts';
import { hasFeatures } from './history.ts';

function rejected(state: WorldState, error: string): TransitionResult {
  return { ok: false, state, events: [], error };
}

function validRevision(state: WorldState, revision: number): boolean {
  return (
    !state.outcome &&
    Number.isSafeInteger(revision) &&
    revision === state.revision &&
    Number.isSafeInteger(revision + 1)
  );
}

export function applyHistoryAdvance(
  state: WorldState,
  command: HistoryAdvanceCommand,
): TransitionResult {
  if (
    typeof command !== 'object' ||
    command === null ||
    !validRevision(state, command.expectedRevision) ||
    !hasFeatures(state, ['history-advancement']) ||
    typeof command.cause !== 'object' ||
    command.cause === null ||
    !['feature', 'event', 'milestone'].includes(command.cause.kind) ||
    typeof command.cause.id !== 'string' ||
    command.cause.id.trim().length === 0 ||
    command.cause.id.length > 128 ||
    typeof command.reason !== 'string' ||
    command.reason.trim().length === 0 ||
    command.reason.length > 1000 ||
    !Number.isSafeInteger(command.deltaYears) ||
    command.deltaYears < 0 ||
    !Number.isSafeInteger(state.year) ||
    !Number.isSafeInteger(state.year + command.deltaYears) ||
    parseUtcTimestamp(command.timestamp) === null
  ) {
    return rejected(
      state,
      'History advancement requires a released capability and valid explicit intent',
    );
  }
  const key = `${command.cause.kind}:${command.cause.id}`;
  if (state.historyAdvances && Object.hasOwn(state.historyAdvances, key))
    return rejected(state, 'This historical cause was already committed');
  const evidence: string[] = [];
  if (command.cause.kind === 'feature') {
    const feature = FEATURES.find((candidate) => candidate.id === command.cause.id);
    if (!feature || !hasFeatures(state, [feature.id]))
      return rejected(state, 'History advancement references no released feature');
    evidence.push(
      `Released feature ${feature.id}: ${feature.name}`,
      `World release ${state.releaseId}`,
    );
  } else if (command.cause.kind === 'milestone') {
    const proof = state.milestoneProofs?.[command.cause.id];
    if (!hasFeatures(state, ['earned-history']) || !proof || !state.calendarMilestones.includes(command.cause.id) || command.deltaYears !== Math.max(0, proof.targetYear - state.year))
      return rejected(state, 'History advancement needs a retained earned milestone and its exact monotonic authored target');
    evidence.push(`Earned milestone ${proof.milestoneId} at round ${proof.round}`, `Retained event ${proof.eventId} at revision ${proof.revision}`, `Authored target year ${proof.targetYear}`);
  } else {
    const event = state.events.find((candidate) => candidate.id === command.cause.id);
    if (!event) return rejected(state, 'History advancement references no recorded event');
    evidence.push(
      `Event ${event.id}: ${event.type}: ${event.title}`,
      `Cause: ${event.cause}`,
      ...event.effects,
    );
  }
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  next.revision += 1;
  next.year += command.deltaYears;
  next.historyAdvances ??= {};
  next.historyAdvances[key] = {
    cause: { ...command.cause },
    reason: command.reason,
    deltaYears: command.deltaYears,
    timestamp: command.timestamp,
    revision: next.revision,
    yearBefore: state.year,
    yearAfter: next.year,
    evidence,
  };
  emitEvent(next, events, {
    type: 'history-advanced',
    title: 'An intentional historical transition',
    detail: command.reason,
    actor: DIRECTOR_SEAT,
    target: null,
    tileId: null,
    cause: `${command.cause.kind} ${command.cause.id} justified an explicit advancement at ${command.timestamp}`,
    effects: [
      `Calendar ${state.year} → ${next.year}`,
      `Reason: ${command.reason}`,
      'Authoritative clock accounting and released capabilities remain unchanged',
    ],
    importance: 5,
  });
  commitEvents(next, events);
  return { ok: true, state: next, events };
}
